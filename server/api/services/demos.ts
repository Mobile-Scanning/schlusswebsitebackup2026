import type { Knex } from 'knex';
import { config } from '../config';
import { db } from '../db';
import { parseJson } from './catalogue';
import { featuresOf } from './offerings';
import { reference } from './crypto';
import { queueEmail } from './jobs';
import { getSetting, inbox, notifyStaff, notifyUsers } from './platform';

/**
 * Demos.
 *
 * A customer's demo of a product IS their trial licence for it (licences.type = 'trial'). The database
 * allows exactly one per customer per product, so downloading again, reinstalling or re-registering can
 * never restart a demo. All dates come from the database clock (UTC) – never from the customer's device.
 *
 *   download   → recorded in `downloads` (a download is NOT an installation)
 *   activation → recorded in `licence_activations` by the central licensing API (installed app)
 *   use        → `licences.last_seen_at`, updated whenever the app validates
 *   expiry     → `licences.expires_at`; starts at first download or first activation (product setting)
 */

export const DEMO_STATUSES = ['started', 'downloaded', 'awaiting_activation', 'active', 'expiring_soon', 'expired', 'converted', 'suspended', 'revoked'] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];
export const DEMO_STATUS_LABEL: Record<DemoStatus, string> = {
  started: 'Started – not downloaded',
  downloaded: 'Downloaded',
  awaiting_activation: 'Awaiting activation',
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  converted: 'Converted to package',
  suspended: 'Suspended',
  revoked: 'Revoked',
};

/** SQL expression giving a demo's status (alias `l` = licences). */
export function demoStatusSql(soonDays: number) {
  const soon = Math.max(0, Math.min(90, Math.round(soonDays)));
  return `CASE
    WHEN l.status = 'revoked' THEN 'revoked'
    WHEN l.status = 'suspended' THEN 'suspended'
    WHEN l.converted_at IS NOT NULL THEN 'converted'
    WHEN l.status = 'expired' OR (l.expires_at IS NOT NULL AND l.expires_at <= UTC_TIMESTAMP()) THEN 'expired'
    WHEN l.expires_at IS NULL THEN 'awaiting_activation'
    WHEN l.expires_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${soon} DAY) THEN 'expiring_soon'
    WHEN l.activated_at IS NOT NULL THEN 'active'
    WHEN l.first_downloaded_at IS NOT NULL THEN 'downloaded'
    ELSE 'started' END`;
}

export interface DemoConfig {
  available: boolean; // a downloadable demo is offered
  days: number | null; // demo length (products.trial_days)
  startOn: 'download' | 'activation';
  maxDevices: number;
  offlineDays: number;
}

export function demoConfig(p: { trial_days: number | null; demo_options: unknown; licence_rules: unknown; offering_type?: string | null; features?: unknown }): DemoConfig {
  const o = parseJson<Record<string, unknown>>(p.demo_options, {});
  const r = parseJson<Record<string, unknown>>(p.licence_rules, {});
  return {
    available: !!o['downloadable'] && featuresOf(p).demo, // the offering's "Demo" feature must be on too
    days: p.trial_days ? Number(p.trial_days) : null,
    startOn: o['demoStartOn'] === 'download' ? 'download' : 'activation',
    maxDevices: Number(r['maxDevices'] ?? 1) || 1,
    offlineDays: Number(r['offlineGraceDays'] ?? 7),
  };
}

export type FullAccess = 'off' | 'licensed' | 'registered';
/** Who may download the full installer (products.demo_options.fullAccess). Default: customers with an active licence. */
export const fullAccess = (p: { demo_options: unknown; offering_type?: string | null; features?: unknown }): FullAccess => {
  if (!featuresOf(p).installer) return 'off'; // offering without the "Installer" feature
  const v = parseJson<Record<string, unknown>>(p.demo_options, {})['fullAccess'];
  return v === 'off' || v === 'registered' ? v : 'licensed';
};

/** The newest released FULL version (channel 'release') with an active file – never a demo file. */
export async function currentReleaseVersion(productId: number) {
  return currentVersion(productId, 'release');
}

/** The demo version customers get: the newest released demo version with downloads switched on. */
export interface DemoFile { id: number; platform: string; architecture: string | null; label: string; name: string; size: number | null }
export async function currentDemoVersion(productId: number, trx: Knex | Knex.Transaction = db) {
  return currentVersion(productId, 'demo', trx);
}

async function currentVersion(productId: number, channel: 'demo' | 'release', trx: Knex | Knex.Transaction = db): Promise<{ id: number; version: string; name: string | null; release_date: string | null; release_notes: string | null; min_requirements: string | null; install_instructions: string | null; files: DemoFile[] } | null> {
  const v = await trx('product_versions')
    .where({ product_id: productId, channel, status: 'released', downloads_enabled: true })
    .orderBy([{ column: 'is_latest', order: 'desc' }, { column: 'release_date', order: 'desc' }, { column: 'id', order: 'desc' }])
    .first('id', 'version', 'name', 'release_date', 'release_notes', 'min_requirements', 'install_instructions');
  if (!v) return null;
  const files = await trx('version_files as f')
    .join('media as m', 'm.id', 'f.media_id')
    .where({ 'f.version_id': v.id, 'f.is_active': true })
    .orderBy(['f.sort_order', 'f.id'])
    .select('f.id', 'f.platform', 'f.architecture', 'f.label', 'm.original_name', 'm.size_bytes', 'm.mime');
  return { ...v, files: files.map((f) => ({ id: f.id, platform: f.platform, architecture: f.architecture, label: f.label || f.original_name, name: f.original_name, size: f.size_bytes === null ? null : Number(f.size_bytes) })) };
}

/** Plain-language rule for customers/admins. */
export const startRuleText = (c: Pick<DemoConfig, 'startOn'>) => (c.startOn === 'download' ? 'from the day you first download it' : 'from the day you first activate it in the software');

/* ------------------------------------------------------------------------------------------------
 * Expiry monitoring. Runs inside the web server every 10 minutes (and from the admin "Check now"
 * button). Each (demo, audience, milestone) is recorded once in demo_notices – no duplicate warnings.
 * ------------------------------------------------------------------------------------------------ */
const SA_DAY = (d: Date) => Math.floor((d.getTime() + 2 * 3600_000) / 86400_000); // calendar day in South Africa (UTC+2, no DST)
const fmt = (d: Date) => d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' });

export function milestoneFor(daysLeft: number, expired: boolean, days: number[], notifyExpired: boolean): number | null {
  if (expired) return notifyExpired ? -1 : null;
  const candidates = [...new Set(days)].filter((m) => m >= daysLeft).sort((a, b) => a - b);
  return candidates.length ? candidates[0] : null;
}

export async function runDemoChecks(now = new Date()) {
  const s = await getSetting('demos.notifications');
  const rows = await db('licences as l')
    .join('customers as c', 'c.id', 'l.customer_id')
    .join('products as p', 'p.id', 'l.product_id')
    .where('l.type', 'trial')
    .whereNull('l.converted_at')
    .whereIn('l.status', ['trial', 'expired'])
    .whereNotNull('l.expires_at')
    .where('l.expires_at', '>', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY)'))
    .select('l.id', 'l.status', 'l.expires_at', 'l.licence_key', 'l.product_id', 'c.id as customer_id', 'c.user_id', 'c.full_name', 'c.company', 'c.email', 'c.cellphone', 'p.name as product', 'p.slug');
  let sent = 0;
  for (const r of rows) {
    const exp = new Date(r.expires_at);
    const expired = exp.getTime() <= now.getTime();
    const daysLeft = expired ? 0 : SA_DAY(exp) - SA_DAY(now);
    if (expired && r.status === 'trial') {
      await db.transaction(async (trx) => {
        const n = await trx('licences').where({ id: r.id, status: 'trial' }).update({ status: 'expired', updated_at: new Date() });
        if (n) await trx('licence_events').insert({ licence_id: r.id, event: 'expired', reason: 'Demo period ended (server clock)' });
      });
    }
    const status = expired ? 'Expired' : daysLeft <= s.soonDays ? 'Expiring soon' : 'Active';
    for (const audience of ['admin', 'customer'] as const) {
      const days = audience === 'admin' ? s.adminDays : s.customerDays;
      const m = milestoneFor(daysLeft, expired, days, s.notifyExpired);
      if (m === null) continue;
      try {
        await db.transaction(async (trx) => {
          const [noticeId] = await trx('demo_notices').insert({ licence_id: r.id, audience, milestone: m });
          const when = expired ? 'has expired' : daysLeft === 0 ? 'expires today' : daysLeft === 1 ? 'expires tomorrow' : `expires in ${daysLeft} days`;
          let users = 0;
          let logId: number | null = null;
          if (audience === 'admin') {
            // Potential lead for the SUPPORT team (never sales) – one lead per demo, updated at each milestone.
            const existing = await trx('leads').where({ licence_id: r.id }).first('id', 'status');
            let leadId = existing?.id as number | undefined;
            if (!existing) {
              [leadId] = await trx('leads').insert({ reference: reference('LD'), source: 'demo_expiry', customer_id: r.customer_id, product_id: r.product_id, licence_id: r.id, status: 'new', demo_expires_at: exp, days_remaining: daysLeft });
            } else {
              await trx('leads').where({ id: leadId }).update({ days_remaining: daysLeft, demo_expires_at: exp, updated_at: new Date(), ...(['new', 'contact_required'].includes(existing.status) && daysLeft <= 1 ? { status: 'contact_required' } : {}) });
            }
            await trx('lead_activities').insert({ lead_id: leadId, kind: 'system', body: `Demo ${when} (${fmt(exp)}).` });
            users = await notifyStaff(['leads.view', 'licences.view'], {
              type: 'lead.demo_expiry',
              title: `Potential lead – demo ${when}: ${r.full_name}${r.company ? ` (${r.company})` : ''} · ${r.product}`,
              body: `Expires ${fmt(exp)} · ${daysLeft} day(s) remaining · ${status} · ${r.email}${r.cellphone ? ' · ' + r.cellphone : ''}`,
              link: `/admin/leads/${leadId}`,
            }, trx);
            if (s.emailAdmins) {
              const job = await queueEmail(await inbox('support'), 'lead_new', { when, customer: r.full_name, company: r.company ? ` (${r.company})` : '', email: r.email, phone: r.cellphone ?? '—', product: r.product, expires: fmt(exp), days: daysLeft, link: `${config.appUrl}/admin/leads/${leadId}` }, trx);
              logId = (await trx('email_logs').where({ job_id: job }).first('id'))?.id ?? null;
            }
          } else {
            const headline = expired ? `Your ${r.product} demo has expired` : daysLeft === 0 ? `Your ${r.product} demo expires today` : daysLeft === 1 ? `Your ${r.product} demo expires tomorrow` : `Your ${r.product} demo expires in ${daysLeft} days`;
            if (r.user_id) users = await notifyUsers([r.user_id], { type: 'demo.expiry', title: headline, body: `Talk to SCHLUSS about the available packages to keep using ${r.product}.`, link: `/account/products/${r.slug}` }, trx);
            if (s.emailCustomers) {
              const job = await queueEmail(r.email, 'demo_expiring', { name: r.full_name, product: r.product, headline, expires: expired ? `ended on ${fmt(exp)}` : `ends on ${fmt(exp)}`, productUrl: `${config.appUrl}/products/${r.slug}` }, trx);
              logId = (await trx('email_logs').where({ job_id: job }).first('id'))?.id ?? null;
            }
          }
          await trx('demo_notices').where({ id: noticeId }).update({ notified_users: users, email_log_id: logId });
        });
        sent++;
      } catch (e) {
        if ((e as { code?: string }).code !== 'ER_DUP_ENTRY') throw e; // already sent for this milestone
      }
    }
  }
  return { checked: rows.length, notices: sent };
}

/** Support conversations waiting too long for a reply → one reminder per waiting period. */
export async function runSupportChecks() {
  const s = await getSetting('support.settings');
  const late = await db('tickets')
    .whereIn('status', ['new', 'open', 'awaiting_admin'])
    .where('last_customer_message_at', '<', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)', [Math.max(1, s.overdueHours)]))
    .where((b) => b.whereNull('overdue_notified_at').orWhereRaw('overdue_notified_at < last_customer_message_at'))
    .select('id', 'reference', 'name', 'assigned_to');
  for (const t of late) {
    await db.transaction(async (trx) => {
      const note = { type: 'support.overdue', title: `Waiting over ${s.overdueHours} h for a reply: ${t.name} (${t.reference})`, link: `/admin/support?open=${t.id}` };
      if (t.assigned_to) await notifyUsers([t.assigned_to], note, trx);
      else await notifyStaff(['support.manage'], note, trx);
      await trx('tickets').where({ id: t.id }).update({ overdue_notified_at: new Date() });
    });
  }
  return late.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Start background checks in the web process (not in tests / build). */
export function startScheduler() {
  if (timer || config.isTest || process.env['NO_SCHEDULER']) return;
  const tick = () => {
    runDemoChecks()
      .then(() => runSupportChecks())
      .catch(() => undefined); // database not ready yet – try again next time
  };
  setTimeout(tick, 20_000).unref();
  timer = setInterval(tick, 10 * 60_000);
  timer.unref();
}

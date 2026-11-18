import { randomBytes } from 'node:crypto';
import { Request, Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, badRequest, HttpError, notFound, parse, unauthorised } from '../http';
import { requireAuth } from '../middleware/auth';
import { audit } from '../services/audit';
import { embedUrl, mediaUrl } from '../services/catalogue';
import { ipHash } from '../services/crypto';
import { currentDemoVersion, currentReleaseVersion, DEMO_STATUS_LABEL, demoConfig, DemoStatus, demoStatusSql, fullAccess, startRuleText } from '../services/demos';
import { queueEmail } from '../services/jobs';
import { getSetting, limit, readToken, signToken } from '../services/platform';
import { fileStat, readStream } from '../services/storage';

/**
 * Customer self-service: demo downloads, the per-product setup area, progress and profile.
 * Every query is scoped to the signed-in customer (req.auth.customerId) – customers can never see
 * another customer's records.
 */
export const customerRouter = Router();

const PROFILE_FIELDS = ['company', 'cellphone', 'country', 'province', 'businessType'] as const;
const REQUIRED_FOR_DEMO = ['company', 'cellphone', 'country'] as const;

function customerId(req: Request) {
  const a = req.auth;
  if (!a) throw unauthorised('Please sign in or create a free customer account to download demos.');
  if (a.user.type !== 'customer' || !a.customerId) {
    throw new HttpError(403, 'Demo downloads are for customer accounts. Staff and partners can download installers from the admin or partner portal.', 'customer_only');
  }
  return a.customerId;
}

function licenceKey() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(randomBytes(16), (x) => A[x % A.length]).join('');
  return `SCH-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

async function profile(cid: number) {
  const c = await db('customers').where({ id: cid }).first('full_name', 'email', 'cellphone', 'company', 'country', 'province', 'business_type');
  return { name: c.full_name, email: c.email, cellphone: c.cellphone, company: c.company, country: c.country, province: c.province, businessType: c.business_type };
}

async function soonDays() {
  return (await getSetting('demos.notifications')).soonDays;
}

/** One customer's demo (trial licence) for a product, with its computed status. */
async function demoFor(cid: number, productId: number) {
  const r = await db('licences as l')
    .where({ 'l.customer_id': cid, 'l.product_id': productId, 'l.type': 'trial' })
    .first('l.id', 'l.licence_key', 'l.starts_at', 'l.expires_at', 'l.start_on', 'l.duration_days', 'l.first_downloaded_at', 'l.activated_at', 'l.last_seen_at', 'l.converted_at', db.raw(`${demoStatusSql(await soonDays())} as demo_status`));
  if (!r) return null;
  const downloads = await db('downloads').where({ licence_id: r.id }).count({ n: '*' }).first();
  return {
    licenceKey: r.licence_key,
    status: r.demo_status as DemoStatus,
    statusLabel: DEMO_STATUS_LABEL[r.demo_status as DemoStatus],
    startedAt: r.starts_at,
    expiresAt: r.expires_at,
    startOn: r.start_on,
    days: r.duration_days,
    firstDownloadedAt: r.first_downloaded_at,
    activatedAt: r.activated_at,
    lastSeenAt: r.last_seen_at,
    downloads: Number(downloads?.n ?? 0),
  };
}

async function publishedProduct(slug: string) {
  const p = await db('products').where({ slug: String(slug).slice(0, 180), is_published: true, is_archived: false }).first('id', 'name', 'slug', 'status', 'trial_days', 'demo_options', 'licence_rules', 'system_requirements', 'hero_media_id', 'short_description', 'offering_type', 'features');
  if (!p) throw notFound('Product not found.');
  return p;
}

/* ------------------------------- Demo download flow ------------------------------- */

/** Everything the demo download dialog needs: product demo, the customer's profile and existing demo. */
customerRouter.get(
  '/demos/:slug',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const p = await publishedProduct(String(req.params['slug']));
    const cfg = demoConfig(p);
    const version = cfg.available ? await currentDemoVersion(p.id) : null;
    const prof = await profile(cid);
    res.json({
      product: { name: p.name, slug: p.slug },
      demo: version && cfg.days ? { days: cfg.days, startOn: cfg.startOn, startRule: startRuleText(cfg), version: version.version, requirements: version.min_requirements ?? p.system_requirements, instructions: version.install_instructions, files: version.files } : null,
      profile: prof,
      missing: REQUIRED_FOR_DEMO.filter((k) => !prof[k]),
      existing: await demoFor(cid, p.id),
      privacyVersion: config.legal.privacyVersion,
    });
  }),
);

const downloadSchema = z.object({
  fileId: z.number().int(),
  acceptTerms: z.literal(true, { message: 'Please accept the demo terms to continue' }),
  profile: z
    .object({
      company: z.string().trim().max(191).optional(),
      cellphone: z.string().trim().max(32).regex(/^[+\d][\d\s()-]{6,}$/, 'Enter a valid contact number').optional().or(z.literal('')),
      country: z.string().trim().regex(/^[A-Z]{2}$/, 'Choose a country').optional(),
      province: z.string().trim().max(80).optional(),
      businessType: z.string().trim().max(100).optional(),
    })
    .default({}),
});

customerRouter.post(
  '/demos/:slug/download',
  requireAuth(),
  limit(20, 15, 'Too many download requests. Please wait a few minutes.'),
  ah(async (req, res) => {
    const cid = customerId(req);
    const input = parse(downloadSchema, req.body);
    const p = await publishedProduct(String(req.params['slug']));
    const cfg = demoConfig(p);
    const version = cfg.available && cfg.days ? await currentDemoVersion(p.id) : null;
    if (!version || !version.files.length) throw new HttpError(409, `A downloadable demo of ${p.name} isn't available right now. You can request a live demonstration instead.`, 'no_demo');
    const file = version.files.find((f) => f.id === input.fileId);
    if (!file) throw badRequest('Choose one of the demo files listed.');

    // Save the business details once – the customer never has to type them again.
    const patch: Record<string, unknown> = {};
    const prof = input.profile;
    if (prof.company) patch['company'] = prof.company;
    if (prof.cellphone) patch['cellphone'] = prof.cellphone;
    if (prof.country) patch['country'] = prof.country;
    if (prof.province) patch['province'] = prof.province;
    if (prof.businessType) patch['business_type'] = prof.businessType;
    const current = await profile(cid);
    const merged = { ...current, ...prof } as Record<string, unknown>;
    const missing = REQUIRED_FOR_DEMO.filter((k) => !merged[k]);
    if (missing.length) throw new HttpError(422, 'Please complete your business details.', 'validation_failed', { fields: Object.fromEntries(missing.map((k) => [`profile.${k}`, 'Required for demo downloads'])) });

    const existing = await db('licences').where({ customer_id: cid, product_id: p.id, type: 'trial' }).first();
    if (existing) {
      if (existing.status === 'revoked' || existing.status === 'suspended') throw new HttpError(403, `Your ${p.name} demo is ${existing.status}. Please contact SCHLUSS.`, 'demo_blocked');
      const ended = existing.status === 'expired' || (existing.expires_at && new Date(existing.expires_at) <= new Date());
      if (ended && !existing.converted_at) throw new HttpError(409, `Your ${p.name} demo period has ended. Chat with us or request a quote to continue using ${p.name}.`, 'demo_expired');
    }

    const result = await db.transaction(async (trx) => {
      if (Object.keys(patch).length) await trx('customers').where({ id: cid }).update({ ...patch, updated_at: new Date() });
      await trx('customer_products').insert({ customer_id: cid, product_id: p.id }).onConflict(['customer_id', 'product_id']).ignore();
      await trx('consents').insert({ user_id: req.auth!.user.id, email: req.auth!.user.email, purpose: 'demo_terms', document_version: config.legal.termsVersion, granted: true, source: `demo:${p.slug}`.slice(0, 64), ip_hash: ipHash(req.ip) });

      let licId: number;
      let first = false;
      if (!existing) {
        const key = licenceKey();
        await trx('licences').insert({
          licence_key: key,
          customer_id: cid,
          product_id: p.id,
          type: 'trial',
          status: 'trial',
          starts_at: trx.raw('UTC_TIMESTAMP()'),
          // Starts now (download rule) or stays open until the first activation (activation rule).
          expires_at: cfg.startOn === 'download' ? trx.raw('DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)', [cfg.days]) : null,
          start_on: cfg.startOn,
          duration_days: cfg.days,
          max_devices: cfg.maxDevices,
          offline_grace_days: cfg.offlineDays,
          first_downloaded_at: trx.raw('UTC_TIMESTAMP()'),
        });
        licId = (await trx('licences').where({ licence_key: key }).first('id')).id;
        await trx('licence_events').insert({ licence_id: licId, event: 'demo_created', actor_id: req.auth!.user.id, after: JSON.stringify({ days: cfg.days, startOn: cfg.startOn, version: version.version }) });
        first = true;
      } else {
        licId = existing.id;
        if (!existing.first_downloaded_at) {
          first = true;
          await trx('licences').where({ id: licId }).update({ first_downloaded_at: trx.raw('UTC_TIMESTAMP()'), start_on: existing.start_on ?? 'download', duration_days: existing.duration_days ?? cfg.days, updated_at: new Date() });
        }
      }
      const [downloadId] = await trx('downloads').insert({ customer_id: cid, product_id: p.id, version_id: version.id, version_file_id: file.id, licence_id: licId, status: 'authorised', ip_hash: ipHash(req.ip) });
      await trx('licence_events').insert({ licence_id: licId, event: 'downloaded', actor_id: req.auth!.user.id, after: JSON.stringify({ version: version.version, file: file.label }) });
      if (first) {
        const lic = await trx('licences').where({ id: licId }).first('licence_key');
        const cust = await trx('customers').where({ id: cid }).first('full_name', 'email');
        await queueEmail(cust.email, 'demo_downloaded', { name: cust.full_name, product: p.name, version: version.version, days: cfg.days, startRule: startRuleText(cfg), licenceKey: lic.licence_key, setupUrl: `${config.appUrl}/account/products/${p.slug}` }, trx);
      }
      return { downloadId, licId };
    });
    await audit(req, { action: 'demo.downloaded', subjectType: 'licence', subjectId: result.licId, meta: { product: p.slug, version: version.version, fileId: file.id } });
    const token = signToken({ d: result.downloadId, c: cid }, 10 * 60);
    res.status(201).json({ url: `/api/account/demo-files/${token}`, demo: await demoFor(cid, p.id), setupUrl: `/account/products/${p.slug}`, instructions: version.install_instructions });
  }),
);

/** Signed, 10-minute link → the file. Only the customer it was issued to can use it. */
customerRouter.get(
  ['/demo-files/:token', '/files/:token'],
  ah(async (req, res) => {
    const t = readToken<{ d: number; c: number }>(String(req.params['token']));
    if (!t) throw new HttpError(410, 'This download link has expired. Please start the download again from the product page.', 'link_expired');
    if (!req.auth?.customerId || req.auth.customerId !== t.c) throw unauthorised('Please sign in with the account that requested this download.');
    const d = await db('downloads as d')
      .join('version_files as f', 'f.id', 'd.version_file_id')
      .join('media as m', 'm.id', 'f.media_id')
      .where({ 'd.id': t.d, 'd.customer_id': t.c })
      .first('d.id', 'd.status', 'm.storage_key', 'm.original_name', 'm.mime', 'm.sha256', 'f.is_active');
    if (!d || !d.storage_key || !d.is_active) throw notFound('This file is no longer available.');
    const st = await fileStat(d.storage_key);
    if (!st) throw notFound('This file is no longer available.');
    await db('downloads').where({ id: d.id }).update({ status: 'started' });
    const name = String(d.original_name || 'demo').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    res.set({
      'Content-Type': d.mime || 'application/octet-stream',
      'Content-Length': String(st.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      ...(d.sha256 ? { 'X-Checksum-SHA256': d.sha256 } : {}),
    });
    const stream = readStream(d.storage_key);
    res.on('finish', () => void db('downloads').where({ id: d.id }).update({ status: 'completed', completed_at: new Date() }).catch(() => undefined));
    res.on('close', () => {
      if (!res.writableFinished) void db('downloads').where({ id: d.id }).update({ status: 'failed' }).catch(() => undefined);
    });
    stream.pipe(res);
  }),
);

/* ------------------------------- Full installer (licensed customers) ------------------------------- */

/**
 * Who may download the FULL installer of a product. Never falls back to the demo file and never serves
 * another product's file: the version is looked up by product id and channel 'release' only.
 */
async function installerAccess(cid: number, p: { id: number; demo_options: unknown }) {
  const mode = fullAccess(p);
  if (mode === 'off') return { allowed: false, reason: 'The full installer is supplied by SCHLUSS directly for this product. Chat with us if you need it.', licenceId: null as number | null };
  const lic = await db('licences')
    .where({ customer_id: cid, product_id: p.id })
    .where((w) => w.whereNot('type', 'trial').orWhereNotNull('converted_at'))
    .whereIn('status', ['active', 'trial'])
    .where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', db.raw('UTC_TIMESTAMP()')))
    .orderBy('id', 'desc')
    .first('id');
  if (lic) return { allowed: true, reason: null, licenceId: lic.id as number };
  if (mode === 'registered') return { allowed: true, reason: null, licenceId: null };
  return { allowed: false, reason: 'The full version is available once you have an active licence for this product. You can download the demo, or send us a purchase enquiry.', licenceId: null };
}

customerRouter.get(
  '/installers/:slug',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const p = await publishedProduct(String(req.params['slug']));
    const access = await installerAccess(cid, p);
    const v = await currentReleaseVersion(p.id);
    res.json({
      allowed: access.allowed && !!v?.files.length,
      reason: !v?.files.length ? 'No full installer has been published for this product yet.' : access.reason,
      version: v ? { version: v.version, name: v.name, releaseDate: v.release_date, notes: v.release_notes, requirements: v.min_requirements, instructions: access.allowed ? v.install_instructions : null, files: v.files } : null,
    });
  }),
);

customerRouter.post(
  '/installers/:slug/download',
  requireAuth(),
  limit(20, 15, 'Too many download requests. Please wait a few minutes.'),
  ah(async (req, res) => {
    const cid = customerId(req);
    const { fileId } = parse(z.object({ fileId: z.number().int() }), req.body);
    const p = await publishedProduct(String(req.params['slug']));
    const access = await installerAccess(cid, p);
    if (!access.allowed) throw new HttpError(403, access.reason ?? 'You do not have access to the full installer.', 'installer_forbidden');
    const v = await currentReleaseVersion(p.id);
    const file = v?.files.find((f) => f.id === fileId);
    if (!v || !file) throw badRequest('Choose one of the installer files listed.');
    const [downloadId] = await db('downloads').insert({ customer_id: cid, product_id: p.id, version_id: v.id, version_file_id: file.id, licence_id: access.licenceId, status: 'authorised', ip_hash: ipHash(req.ip) });
    await audit(req, { action: 'installer.downloaded', subjectType: 'product', subjectId: p.id, meta: { version: v.version, fileId: file.id } });
    const token = signToken({ d: downloadId, c: cid }, 10 * 60);
    res.status(201).json({ url: `/api/account/files/${token}`, instructions: v.install_instructions });
  }),
);

/** My demos: every demo with start, expiry, remaining days and status (Active / Expiring soon / Expired …). */
customerRouter.get(
  '/my-demos',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const rows = await db('licences as l').join('products as p', 'p.id', 'l.product_id').where({ 'l.customer_id': cid, 'l.type': 'trial' }).orderBy('l.id', 'desc')
      .select('p.name', 'p.slug', 'l.licence_key', 'l.starts_at', 'l.expires_at', 'l.start_on', 'l.duration_days', 'l.first_downloaded_at', 'l.activated_at', db.raw(`${demoStatusSql(await soonDays())} as demo_status`), db.raw('TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), l.expires_at) as hours_left'));
    res.json(rows.map((r) => ({
      product: { name: r.name, slug: r.slug },
      licenceKey: r.licence_key,
      status: r.demo_status,
      statusLabel: DEMO_STATUS_LABEL[r.demo_status as DemoStatus],
      startedAt: r.activated_at && r.start_on === 'activation' ? r.activated_at : r.first_downloaded_at ?? r.starts_at,
      expiresAt: r.expires_at,
      daysRemaining: r.hours_left == null ? null : Math.max(0, Math.ceil(Number(r.hours_left) / 24)),
      days: r.duration_days,
      startOn: r.start_on,
    })));
  }),
);

/* ------------------------------- Customer dashboard ------------------------------- */
customerRouter.get(
  '/dashboard',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const soon = await soonDays();
    const [interest, demos, packages, steps, done, convs, notes] = await Promise.all([
      db('customer_products as cp').join('products as p', 'p.id', 'cp.product_id').where('cp.customer_id', cid).select('p.id', 'p.name', 'p.slug', 'p.hero_media_id', 'p.short_description', 'p.is_published'),
      db('licences as l').join('products as p', 'p.id', 'l.product_id').where({ 'l.customer_id': cid, 'l.type': 'trial' }).select('l.product_id', 'p.name', 'p.slug', 'p.hero_media_id', 'p.short_description', 'p.is_published', 'l.licence_key', 'l.expires_at', 'l.start_on', 'l.duration_days', 'l.activated_at', 'l.first_downloaded_at', db.raw(`${demoStatusSql(soon)} as demo_status`)),
      db('licences as l').join('products as p', 'p.id', 'l.product_id').leftJoin('product_plans as pl', 'pl.id', 'l.plan_id').where('l.customer_id', cid).whereNot('l.type', 'trial').select('l.product_id', 'p.name', 'p.slug', 'l.licence_key', 'l.type', 'l.status', 'l.starts_at', 'l.expires_at', 'pl.name as plan'),
      db('product_setup_steps').where({ is_enabled: true, is_archived: false }).groupBy('product_id').select('product_id').count({ n: '*' }) as unknown as Promise<Record<string, number>[]>,
      db('customer_step_progress as cs').join('product_setup_steps as s', 's.id', 'cs.step_id').where({ 'cs.customer_id': cid, 's.is_enabled': true, 's.is_archived': false }).groupBy('s.product_id').select('s.product_id').count({ n: '*' }) as unknown as Promise<Record<string, number>[]>,
      db('tickets').where('customer_id', cid).orderBy('last_message_at', 'desc').limit(20).select('reference', 'subject', 'status', 'customer_unread', 'last_message_at', 'product_id'),
      db('notifications').where({ user_id: req.auth!.user.id }).orderBy('id', 'desc').limit(10).select('id', 'type', 'title', 'body', 'link', 'read_at', 'created_at'),
    ]);
    const byProduct = new Map<number, Record<string, unknown>>();
    const base = (r: { product_id?: number; id?: number; name: string; slug: string; hero_media_id: number | null; short_description: string | null; is_published: number }) => {
      const id = (r.product_id ?? r.id)!;
      if (!byProduct.has(id)) byProduct.set(id, { product: { name: r.name, slug: r.slug, image: mediaUrl(r.hero_media_id, r.slug), summary: r.short_description, available: !!r.is_published }, demo: null, packages: [], steps: { total: 0, done: 0 }, conversations: 0, unread: 0 });
      return byProduct.get(id)!;
    };
    interest.forEach((r) => base(r));
    demos.forEach((r) => {
      base(r)['demo'] = { licenceKey: r.licence_key, status: r.demo_status, statusLabel: DEMO_STATUS_LABEL[r.demo_status as DemoStatus], expiresAt: r.expires_at, startOn: r.start_on, days: r.duration_days, activatedAt: r.activated_at, downloadedAt: r.first_downloaded_at };
    });
    for (const k of packages) {
      const e = byProduct.get(k.product_id) ?? base({ ...k, hero_media_id: null, short_description: null, is_published: 1 });
      (e['packages'] as unknown[]).push({ licenceKey: k.licence_key, type: k.type, status: k.status, startsAt: k.starts_at, expiresAt: k.expires_at, plan: k.plan });
    }
    for (const s of steps) { const e = byProduct.get(s['product_id'] as number); if (e) (e['steps'] as { total: number }).total = Number(s['n']); }
    for (const s of done) { const e = byProduct.get(s['product_id'] as number); if (e) (e['steps'] as { done: number }).done = Number(s['n']); }
    for (const c of convs) { const e = c.product_id ? byProduct.get(c.product_id) : null; if (e) { (e['conversations'] as number)++; e['unread'] = (e['unread'] as number) + Number(c.customer_unread); } }
    res.json({
      profile: await profile(cid),
      products: [...byProduct.values()],
      conversations: convs.map((c) => ({ reference: c.reference, subject: c.subject, status: c.status, unread: Number(c.customer_unread), lastMessageAt: c.last_message_at })),
      notifications: notes,
    });
  }),
);

/** Per-product setup area: demo, files, setup steps with progress, videos, documents, links, conversations. */
customerRouter.get(
  '/products/:slug',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const p = await publishedProduct(String(req.params['slug']));
    const cfg = demoConfig(p);
    const version = cfg.available ? await currentDemoVersion(p.id) : null;
    const [steps, items, progress, media, learning, convs, packages] = await Promise.all([
      db('product_setup_steps').where({ product_id: p.id, is_enabled: true, is_archived: false }).orderBy(['sort_order', 'id']).select('id', 'title', 'summary', 'body'),
      db('setup_step_items as i').join('product_setup_steps as s', 's.id', 'i.step_id').leftJoin('media as m', 'm.id', 'i.media_id').where({ 's.product_id': p.id, 's.is_archived': false }).orderBy(['i.sort_order', 'i.id']).select('i.step_id', 'i.kind', 'i.url', 'i.title', 'i.media_id', 'm.kind as media_kind', 'm.title as media_title', 'm.original_name', 'm.external_url', 'm.size_bytes'),
      db('customer_step_progress').where({ customer_id: cid }).select('step_id', 'completed_at'),
      db('product_media as pm').join('media as m', 'm.id', 'pm.media_id').where('pm.product_id', p.id).whereIn('m.visibility', ['public', 'customer']).orderBy(['pm.sort_order', 'pm.id']).select('pm.role', 'pm.caption', 'pm.description', 'pm.duration_seconds', 'pm.thumbnail_media_id', 'm.id', 'm.kind', 'm.title', 'm.external_url', 'm.original_name'),
      db('learning_resources as l').leftJoin('media as m', 'm.id', 'l.media_id').where({ 'l.product_id': p.id, 'l.is_published': true }).whereIn('l.audience', ['customer', 'both']).whereIn('l.visibility', ['public', 'customer']).orderBy(['l.sort_order', 'l.id']).select('l.id', 'l.section', 'l.kind', 'l.title', 'l.summary', 'l.url', 'l.media_id', 'm.kind as media_kind', 'm.external_url', 'm.original_name'),
      db('tickets').where({ customer_id: cid, product_id: p.id }).orderBy('last_message_at', 'desc').select('reference', 'subject', 'status', 'customer_unread', 'last_message_at'),
      db('licences as l').leftJoin('product_plans as pl', 'pl.id', 'l.plan_id').where({ 'l.customer_id': cid, 'l.product_id': p.id }).whereNot('l.type', 'trial').select('l.licence_key', 'l.type', 'l.status', 'l.starts_at', 'l.expires_at', 'pl.name as plan'),
    ]);
    const doneAt = new Map(progress.map((x) => [x.step_id, x.completed_at]));
    const itemUrl = (i: (typeof items)[number]) => (i.kind === 'link' ? i.url : i.external_url ?? mediaUrl(i.media_id, i.original_name || i.media_title || i.title || 'file'));
    res.json({
      product: { name: p.name, slug: p.slug, image: mediaUrl(p.hero_media_id, p.slug), summary: p.short_description, requirements: version?.min_requirements ?? p.system_requirements },
      demo: await demoFor(cid, p.id),
      installer: await (async () => {
        const v = await currentReleaseVersion(p.id);
        if (!v?.files.length || fullAccess(p) === 'off') return null;
        return { version: v.version, releaseDate: v.release_date, access: fullAccess(p), files: v.files.map((f) => ({ id: f.id, platform: f.platform, label: f.label, size: f.size })) };
      })(),
      demoOffer: version && cfg.days ? { days: cfg.days, startOn: cfg.startOn, startRule: startRuleText(cfg), version: version.version, instructions: version.install_instructions, files: version.files } : null,
      packages,
      steps: steps.map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.summary,
        body: s.body,
        completedAt: doneAt.get(s.id) ?? null,
        items: items
          .filter((i) => i.step_id === s.id)
          .map((i) => ({ kind: i.kind, title: i.title || i.media_title || i.original_name || (i.kind === 'demo_download' ? 'Download the demo' : i.kind === 'link' && i.url ? i.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '') : 'Open'), url: i.kind === 'demo_download' ? null : itemUrl(i), embed: i.kind === 'video' ? embedUrl(i.external_url) : null, mediaKind: i.media_kind, size: i.size_bytes === null ? null : Number(i.size_bytes) })),
      })),
      videos: media.filter((m) => ['video', 'external_video'].includes(m.kind)).map((m) => ({ role: m.role, title: m.caption || m.title, description: m.description, duration: m.duration_seconds, url: m.kind === 'external_video' ? m.external_url : mediaUrl(m.id, m.original_name || m.title), embed: embedUrl(m.external_url), thumbnail: mediaUrl(m.thumbnail_media_id, 'thumbnail') })),
      documents: learning.filter((l) => l.kind !== 'link').map((l) => ({ id: l.id, kind: l.kind, section: l.section, title: l.title, summary: l.summary, url: l.url ?? l.external_url ?? mediaUrl(l.media_id, l.original_name || l.title), mediaKind: l.media_kind })),
      links: learning.filter((l) => l.kind === 'link').map((l) => ({ id: l.id, title: l.title, summary: l.summary, url: l.url ?? l.external_url ?? mediaUrl(l.media_id, l.original_name || l.title) })),
      conversations: convs.map((c) => ({ reference: c.reference, subject: c.subject, status: c.status, unread: Number(c.customer_unread), lastMessageAt: c.last_message_at })),
    });
  }),
);

/** Mark a setup step done / not done. Saved to the account, so it follows the customer to any device. */
customerRouter.post(
  '/steps/:id/progress',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const { done } = parse(z.object({ done: z.boolean() }), req.body);
    const id = Number(req.params['id']) || 0;
    const step = await db('product_setup_steps as s').join('products as p', 'p.id', 's.product_id').where({ 's.id': id, 's.is_enabled': true, 's.is_archived': false, 'p.is_published': true }).first('s.id');
    if (!step) throw notFound('Step not found.');
    if (done) await db('customer_step_progress').insert({ customer_id: cid, step_id: id }).onConflict(['customer_id', 'step_id']).ignore();
    else await db('customer_step_progress').where({ customer_id: cid, step_id: id }).del();
    res.json({ ok: true, done });
  }),
);

/* ------------------------------- Profile ------------------------------- */
customerRouter.get(
  '/profile',
  requireAuth(),
  ah(async (req, res) => {
    res.json(await profile(customerId(req)));
  }),
);

customerRouter.patch(
  '/profile',
  requireAuth(),
  ah(async (req, res) => {
    const cid = customerId(req);
    const input = parse(downloadSchema.shape.profile.unwrap(), req.body);
    const row: Record<string, unknown> = {};
    for (const k of PROFILE_FIELDS) if (input[k] !== undefined) row[k === 'businessType' ? 'business_type' : k] = input[k] || null;
    if (Object.keys(row).length) await db('customers').where({ id: cid }).update({ ...row, updated_at: new Date() });
    await audit(req, { action: 'customer.profile_updated', subjectType: 'customer', subjectId: cid, after: Object.keys(row) });
    res.json(await profile(cid));
  }),
);


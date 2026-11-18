import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { db } from './db';
import { errorHandler } from './http';
import { csrfProtection, loadSession } from './middleware/auth';
import { adminSystemRouter } from './routes/admin-system';
import { authRouter } from './routes/auth';
import { adminCatalogueRouter } from './routes/admin-catalogue';
import { adminSalesRouter } from './routes/admin-sales';
import { mediaRouter } from './routes/media';
import { publicRouter } from './routes/public';
import { accountRouter } from './routes/account';
import { adminPlatformRouter } from './routes/admin-platform';
import { customerRouter } from './routes/customer';
import { licensingRouter, notificationsRouter } from './routes/licensing';
import { adminSupportRouter, supportRouter } from './routes/support';
import { adminOpsRouter, whatsappWebhookRouter } from './routes/admin-ops';
import { adminContentRouter, contentRouter } from './routes/content';
import { startScheduler } from './services/demos';
import { config } from './config';
import { notifyStaff } from './services/platform';
import { retryWhatsApp } from './services/whatsapp';
import { rateLimit } from 'express-rate-limit';
import { securityEvent } from './services/security';
import { startMaintenance } from './services/maintenance';

/**
 * The single SCHLUSS backend API. Mounted at /api by src/server.ts (same Node process as Angular SSR).
 */
export function createApi(): Router {
  const api = Router();
  // Keep the raw body: WhatsApp webhooks are verified with an HMAC of the exact bytes Meta sent.
  api.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));
  api.use(cookieParser());
  // A general ceiling per visitor address for the whole API (on top of the stricter limits on sign-in, forms,
  // downloads etc.). Generous enough for normal use of the admin; stops scripts hammering the server.
  if (!config.isTest) {
    api.use(
      rateLimit({
        windowMs: 5 * 60_000,
        limit: Number(process.env['API_RATE_LIMIT'] || 1500),
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        // Not counted: the health check, video streaming (many small range requests), Meta's webhook, and the
        // website's own page rendering, which calls the API from this same machine on behalf of every visitor.
        skip: (req) => req.path === '/health' || req.path.startsWith('/content/stream/') || req.path === '/whatsapp/webhook' || (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.ip)) && !req.headers['x-forwarded-for']),
        handler: (req, res) => {
          securityEvent(req, 'security.rate_limited', { path: req.originalUrl.split('?')[0].slice(0, 200) }, { throttleMs: 10 * 60_000, alert: { title: 'A visitor hit the request limit', body: `${req.ip} sent more than ${process.env['API_RATE_LIMIT'] || 1500} requests in 5 minutes and is being slowed down.` } });
          res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes and try again.' } });
        },
      }),
    );
  }
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store'); // API responses may contain personal data
    res.set('X-Robots-Tag', 'noindex');
    next();
  });
  api.use(loadSession);
  // Meta's webhook is a server-to-server call: it cannot carry our CSRF token; it is HMAC-signed instead.
  api.use((req, res, next) => (req.path === '/whatsapp/webhook' ? next() : csrfProtection(req, res, next)));

  api.get('/health', async (_req, res) => {
    // Readable from the launcher page (index.html opened from the folder) so it can tell the site is running.
    // It only says "up" or "down" – nothing private.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    try {
      await db.raw('SELECT 1');
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  api.use('/auth', authRouter);
  api.use('/public', publicRouter);
  api.use('/account', accountRouter);
  api.use('/account', customerRouter);
  api.use('/support', supportRouter);
  api.use('/licensing', licensingRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/media', mediaRouter);
  api.use('/admin', adminSystemRouter);
  api.use('/admin', adminCatalogueRouter);
  api.use('/admin', adminSalesRouter);
  api.use('/admin', adminPlatformRouter);
  api.use('/admin', adminSupportRouter);
  api.use('/admin', adminOpsRouter);
  api.use('/admin', adminContentRouter);
  api.use('/content', contentRouter);
  api.use('/whatsapp', whatsappWebhookRouter);

  // Development-only inbox: when no mail server is set up locally, emails are saved under storage/dev-mail.
  // Never available in production, or when a real mail server is configured.
  const devMail = () => !config.isProd && !config.isTest && !process.env['MAIL_HOST'];
  api.get('/dev/mail-status', (_req, res) => { res.json({ devInbox: devMail() }); });
  api.get(['/dev/mail', '/dev/mail/:file'], async (req, res) => {
    // Test emails (with sign-in codes) are only ever shown to someone sitting at this computer.
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.ip)) && !req.headers['x-forwarded-for'];
    if (!devMail() || !local) { res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } }); return; }
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'storage/dev-mail');
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.html')).sort().reverse();
    const file = String(req.params['file'] ?? '');
    if (file) {
      if (!files.includes(file)) { res.status(404).send('Not found'); return; }
      res.type('html').send(await readFile(join(dir, file), 'utf8'));
      return;
    }
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Development inbox</title><body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px">
      <h1>Development inbox</h1><p>No mail server is set in <code>.env</code> (MAIL_HOST), so emails are not sent. On this computer only, a copy of each email is kept here so you can test sign-up. Newest first.</p>
      <ul>${files.slice(0, 50).map((f) => `<li><a href="/api/dev/mail/${encodeURIComponent(f)}">${esc(f.replace(/\.html$/, '').replace(/_/g, ' '))}</a></li>`).join('') || '<li>No emails yet – wait 15 seconds after registering, then refresh.</li>'}</ul></body>`);
  });

  api.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
  });
  api.use(errorHandler);
  startScheduler(); // demo expiry + support reminders (no-op in tests)
  startDeliveryChecks();
  startEmailSender();
  startMaintenance();
  return api;
}

let deliveryTimer: NodeJS.Timeout | null = null;
let lastFailedEmailId = 0;
let deliveryStarted = false;
/** Every minute: retry transient WhatsApp failures; tell admins about newly failed emails. */
function startDeliveryChecks() {
  if (deliveryTimer || config.isTest || process.env['NO_SCHEDULER']) return;
  const tick = async () => {
    await retryWhatsApp();
    const failed = await db('email_logs').where('status', 'failed').where('id', '>', lastFailedEmailId).orderBy('id', 'desc').select('id', 'to_email', 'template_key', 'error');
    if (!deliveryStarted) {
      deliveryStarted = true; // first run: don't re-announce history
      lastFailedEmailId = failed[0]?.id ?? 0;
      return;
    }
    if (failed.length) {
      lastFailedEmailId = failed[0].id;
      await notifyStaff(['email_settings.manage', 'settings.manage'], { type: 'email.failed', title: `${failed.length} email${failed.length > 1 ? 's' : ''} could not be sent`, body: `${failed[0].template_key} → ${failed[0].to_email}: ${String(failed[0].error ?? '').slice(0, 200)}`, link: '/admin/email-settings' });
    }
  };
  deliveryTimer = setInterval(() => void tick().catch(() => undefined), 60_000);
  deliveryTimer.unref();
}

/** What the built-in email sender last did – shown in Admin › Email settings so a problem is never silent. */
export const senderState: { enabled: boolean; running: boolean; lastRunAt: string | null; lastOk: boolean | null; lastOutput: string | null; runs: number } = { enabled: false, running: false, lastRunAt: null, lastOk: null, lastOutput: null, runs: 0 };
let rerun = false;
/**
 * Runs the email worker once if anything is waiting (or always, with force). Called every 15 seconds, right
 * after a verification code is queued, and by "Send waiting emails now". Its result – including a crash – is kept.
 */
export async function runEmailSender(force = false): Promise<typeof senderState> {
  if (config.isTest || (!force && process.env['AUTO_SEND_EMAIL'] === 'off')) return senderState;
  if (senderState.running) {
    rerun = true; // something new was queued while a run was in progress – go again afterwards
    return senderState;
  }
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const script = join(process.cwd(), 'server/cli/worker.cjs');
  if (!existsSync(script)) {
    Object.assign(senderState, { lastRunAt: new Date().toISOString(), lastOk: false, lastOutput: `The email sender script was not found at ${script}. Start the website from the project folder.` });
    return senderState;
  }
  if (!force) {
    const pending = await db('jobs').where('status', 'pending').where('run_after', '<=', db.fn.now()).first('id').catch(() => null);
    if (!pending) return senderState;
  }
  senderState.running = true;
  await new Promise<void>((resolve) => {
    execFile(process.execPath, [script], { cwd: process.cwd(), timeout: 90_000 }, (err, stdout, stderr) => {
      const out = `${String(stderr || '').trim()}\n${String(stdout || '').trim()}`.trim();
      Object.assign(senderState, { running: false, runs: senderState.runs + 1, lastRunAt: new Date().toISOString(), lastOk: !err, lastOutput: (err ? `${(err as { killed?: boolean }).killed ? 'The email sender took longer than 90 seconds and was stopped. ' : ''}${out || err.message}` : out).slice(-1500) || null });
      resolve();
    });
  });
  if (rerun) {
    rerun = false;
    return runEmailSender();
  }
  return senderState;
}

/**
 * Sends queued emails from inside the website every 15 seconds, so verification codes go out without a
 * separate command. (A cron job running server/cli/worker.cjs is still fine on the live server – jobs are
 * claimed atomically, so both can run.) Switch off with AUTO_SEND_EMAIL=off.
 */
let senderTimer: NodeJS.Timeout | null = null;
function startEmailSender() {
  if (senderTimer || config.isTest || process.env['AUTO_SEND_EMAIL'] === 'off') return;
  senderState.enabled = true;
  senderTimer = setInterval(() => void runEmailSender(), 15_000);
  senderTimer.unref();
  void runEmailSender();
}

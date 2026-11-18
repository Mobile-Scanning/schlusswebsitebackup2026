#!/usr/bin/env node
/**
 * Background job worker for shared hosting (no Redis / long-running processes).
 * Run from cPanel cron every minute:
 *   * * * * * cd ~/schluss && /path/to/node server/cli/worker.cjs >> storage/logs/worker.log 2>&1
 * Processes a batch of due jobs, then exits. Safe to overlap: jobs are claimed atomically.
 *
 * Email transport: SMTP settings from .env (MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD, MAIL_FROM).
 * Optional second mailbox for business-partner emails: MAIL_SALES_USER, MAIL_SALES_PASSWORD, MAIL_SALES_FROM
 * (same host/port). Partner emails are sent from it; everything else from the main (support) mailbox.
 * If MAIL_HOST is not set, emails are NOT sent – they are marked failed with "mail not configured"
 * (we never pretend delivery succeeded).
 */
const path = require('node:path');
require('./mail-env.cjs');
const nodemailer = require('nodemailer');
const { render, layout } = require('../mail/layout.cjs');

const envName = process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';
const knex = require('knex')(require('../db/knexfile.cjs')[envName]);

const BATCH = Number(process.env.WORKER_BATCH || 20);
const MAX_ATTEMPTS = 5;
const APP_URL = (process.env.APP_URL || 'http://localhost:4200').replace(/\/$/, '');

const defaultFrom = () => process.env.MAIL_FROM || 'SCHLUSS <no-reply@schluss.co.za>';
function smtp(user, pass) {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: Number(process.env.MAIL_PORT) === 465,
    auth: user ? { user, pass } : undefined,
    // Give up quickly when the mail server can't be reached, so the reason is recorded instead of the job hanging.
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    ...(process.env.MAIL_TLS_INSECURE === '1' ? { tls: { rejectUnauthorized: false } } : {}), // local testing only
  });
}
/** The sending mailboxes: { support, sales } – each { mailer, from }. `sales` falls back to support when it has no own login. */
function transport() {
  if (process.env.MAIL_TRANSPORT === 'json') {
    const m = nodemailer.createTransport({ jsonTransport: true }); // tests/dev only
    const salesFrom = process.env.MAIL_SALES_USER ? process.env.MAIL_SALES_FROM || `SCHLUSS Sales <${process.env.MAIL_SALES_USER}>` : defaultFrom();
    return { support: { mailer: m, from: defaultFrom() }, sales: { mailer: m, from: salesFrom } };
  }
  if (!process.env.MAIL_HOST) return null;
  const support = { mailer: smtp(process.env.MAIL_USER, process.env.MAIL_PASSWORD), from: defaultFrom() };
  const sales = process.env.MAIL_SALES_USER
    ? { mailer: smtp(process.env.MAIL_SALES_USER, process.env.MAIL_SALES_PASSWORD), from: process.env.MAIL_SALES_FROM || `SCHLUSS Sales <${process.env.MAIL_SALES_USER}>` }
    : support;
  return { support, sales };
}
/** Business-partner emails go out from the sales mailbox; everything else from support (unless the job says otherwise). */
const accountFor = (payload) => payload.account || (String(payload.template).startsWith('partner_') ? 'sales' : 'support');

async function claim() {
  // Claim one job at a time with an atomic conditional update (works on MySQL & MariaDB).
  // Verification codes first – a customer is waiting on the screen for them.
  const job = await knex('jobs').where('status', 'pending').andWhere('run_after', '<=', knex.fn.now()).orderByRaw(`payload LIKE '%"template":"email_otp"%' DESC`).orderBy('id').first();
  if (!job) return null;
  // run_after doubles as "started at" while a job is running (see the stale-job recovery in run()).
  const n = await knex('jobs').where({ id: job.id, status: 'pending' }).update({ status: 'running', attempts: job.attempts + 1, run_after: knex.fn.now() });
  return n === 1 ? { ...job, attempts: job.attempts + 1 } : claim();
}

async function sendEmail(mailer, payload) {
  const tpl = await knex('email_templates').where({ key: payload.template }).first();
  if (!tpl) throw new Error(`Email template "${payload.template}" not found`);
  const vars = { appUrl: APP_URL, ...payload.vars };
  const subject = render(tpl.subject, vars, { html: false });
  const html = layout({ appUrl: APP_URL, bodyHtml: render(tpl.body_html, vars), preheader: subject });
  if (!mailer) {
    // Development only: keep a local copy so sign-up can be tested before a mailbox is set up.
    // It is still recorded as NOT sent – nothing pretends the email was delivered.
    if (envName === 'development') {
      const fs = require('node:fs');
      const dir = path.join(__dirname, '../../storage/dev-mail');
      fs.mkdirSync(dir, { recursive: true });
      const file = `${new Date().toISOString().replace(/[:.]/g, '-')}_${String(payload.to).replace(/[^\w.@-]/g, '_')}_${payload.template}.html`;
      fs.writeFileSync(path.join(dir, file), `<!-- To: ${payload.to} | Subject: ${subject} -->\n` + html);
      throw new Error(`mail not configured (set MAIL_HOST in .env) – development copy: storage/dev-mail/${file}`);
    }
    throw new Error('mail not configured (set MAIL_HOST in .env)');
  }
  const acct = mailer[accountFor(payload)] || mailer.support;
  let info;
  try {
    info = await acct.mailer.sendMail({ from: acct.from, to: payload.to, subject, html });
  } catch (e) {
    // Record what to do about it, in plain words (shown in Admin › Email settings).
    const sales = accountFor(payload) === 'sales' && process.env.MAIL_SALES_USER;
    const why = await require('./mail-check.cjs').explain(e, { user: sales ? process.env.MAIL_SALES_USER : process.env.MAIL_USER, from: acct.from, passVar: sales ? 'MAIL_SALES_PASSWORD' : 'MAIL_PASSWORD' });
    const err = new Error(why.problem === 'other' ? why.text : `${why.text} [${e.message}]`);
    err.permanent = ['login', 'certificate_name', 'certificate', 'port', 'sender'].includes(why.problem); // won't fix itself – don't retry
    throw err;
  }
  if (payload.logId) await knex('email_logs').where({ id: payload.logId }).update({ status: 'sent', subject, sent_at: knex.fn.now(), provider_message_id: info.messageId || null, error: null });
}

const handlers = { email: sendEmail };

/** One-time codes must not stay readable in the job queue once the email has been sent (or given up on). */
function scrub(job, payload) {
  if (job.type !== 'email' || payload.template !== 'email_otp') return {};
  return { payload: JSON.stringify({ ...payload, vars: { ...payload.vars, code: '[removed]' } }) };
}

async function run() {
  const mailer = transport();
  let processed = 0;
  // A worker that was stopped mid-send (e.g. the mail server never answered) leaves its job "running" – put it back.
  await knex('jobs').where('status', 'running').andWhere('run_after', '<', knex.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 MINUTE)'))
    .update({ status: 'pending', last_error: 'The previous attempt did not finish (the mail server did not answer in time).' });
  for (let i = 0; i < BATCH; i++) {
    const job = await claim();
    if (!job) break;
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(mailer, payload);
      await knex('jobs').where({ id: job.id }).update({ status: 'done', finished_at: knex.fn.now(), last_error: null, ...scrub(job, payload) });
    } catch (e) {
      // A wrong mailbox password won't fix itself: fail straight away so it shows under "Failed emails".
      // A code that is older than a few minutes is useless, so verification emails are not retried for long.
      const otp = job.type === 'email' && payload.template === 'email_otp';
      const final = job.attempts >= (otp ? 2 : MAX_ATTEMPTS) || e.permanent === true || /not configured/.test(e.message);
      const backoffMin = otp ? 1 : Math.min(60, 2 ** job.attempts);
      await knex('jobs').where({ id: job.id }).update({
        status: final ? 'failed' : 'pending',
        last_error: String(e.message).slice(0, 2000),
        run_after: final ? knex.fn.now() : knex.raw('DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)', [backoffMin]),
        finished_at: final ? knex.fn.now() : null,
        ...(final ? scrub(job, payload) : {}),
      });
      if (job.type === 'email' && payload.logId) {
        await knex('email_logs').where({ id: payload.logId }).update({ status: final ? 'failed' : 'queued', error: String(e.message).slice(0, 2000) });
      }
    }
    processed++;
  }
  // Housekeeping: remove expired sessions and stale reset tokens.
  await knex('sessions').where('expires_at', '<', knex.fn.now()).del();
  await knex('password_resets').where('expires_at', '<', knex.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)')).del();
  return processed;
}

if (require.main === module) {
  run()
    .then((n) => console.log(`[worker] ${new Date().toISOString()} processed ${n} job(s)`))
    .catch((e) => {
      console.error('[worker] fatal', e);
      process.exitCode = 1;
    })
    .finally(() => knex.destroy());
}

module.exports = { run, knex, accountFor, transport };

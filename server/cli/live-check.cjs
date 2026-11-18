#!/usr/bin/env node
/**
 * Pre-flight check for the live server:  npm run live:check
 * Reads this folder's .env and says, in plain words, what still has to be fixed before going live.
 * Changes nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
const ROOT = path.join(__dirname, '../..');
const out = [];
const add = (ok, name, text) => out.push({ ok, name, text });
const warn = (name, text) => out.push({ ok: true, warn: true, name, text });
const e = process.env;

(async () => {
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  add(major > 20 || (major === 20 && minor >= 19), 'Node.js', `Version ${process.versions.node}${major > 20 || (major === 20 && minor >= 19) ? '' : ' – SCHLUSS needs 20.19 or newer. Choose a newer Node version at your host.'}`);
  add(fs.existsSync(path.join(ROOT, 'dist/schluss/server/server.mjs')), 'Built website', fs.existsSync(path.join(ROOT, 'dist/schluss/server/server.mjs')) ? 'dist folder is present' : 'The dist folder is missing. Run "npm run build" on your computer and upload the dist folder.');
  add(fs.existsSync(path.join(ROOT, '.env')), 'Settings file', fs.existsSync(path.join(ROOT, '.env')) ? '.env found' : 'There is no .env file in this folder. Copy .env.production.example to .env and fill it in.');
  add(e.NODE_ENV === 'production', 'NODE_ENV', e.NODE_ENV === 'production' ? 'production' : `Is "${e.NODE_ENV || ''}" – set NODE_ENV=production in .env (otherwise sign-in cookies are not secure and test features stay on).`);
  const url = e.APP_URL || '';
  add(/^https:\/\/[^/]+$/.test(url) && !/localhost|127\.0\.0\.1/.test(url), 'APP_URL', /^https:\/\/[^/]+$/.test(url) && !/localhost|127\.0\.0\.1/.test(url) ? url : `Is "${url}" – set APP_URL=https://schluss.co.za (your real address, https, no slash at the end). Links in emails use it.`);
  const secret = e.APP_SECRET || '';
  add(secret.length >= 48 && !/dev-only|change-me/i.test(secret), 'APP_SECRET', secret.length >= 48 && !/dev-only|change-me/i.test(secret) ? 'set' : 'Must be at least 48 random characters. Make one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  add(!!e.DB_NAME && !!e.DB_USER && !!e.DB_PASSWORD, 'Database settings', e.DB_NAME && e.DB_USER && e.DB_PASSWORD ? `${e.DB_USER}@${e.DB_HOST || '127.0.0.1'} / ${e.DB_NAME}` : 'DB_NAME, DB_USER and DB_PASSWORD must be the database details from your host.');

  let knex;
  try {
    knex = require('knex')(require('../db/knexfile.cjs')[e.NODE_ENV === 'production' ? 'production' : 'development']);
    await knex.raw('SELECT 1');
    add(true, 'Database connection', 'Connected');
    const all = fs.readdirSync(path.join(__dirname, '../db/migrations')).filter((f) => f.endsWith('.cjs'));
    const done = await knex('knex_migrations').select('name').catch(() => null);
    if (!done) add(false, 'Database tables', 'No SCHLUSS tables yet – run "npm run db:migrate".');
    else {
      const missing = all.filter((f) => !done.some((d) => d.name === f));
      add(!missing.length, 'Database tables', missing.length ? `${missing.length} update(s) not applied – run "npm run db:migrate".` : 'Up to date');
      const n = async (t) => Number((await knex(t).count({ n: '*' }).first()).n);
      const [products, customers, staff] = [await n('products'), await n('customers'), Number((await knex('users').where({ type: 'staff' }).count({ n: '*' }).first()).n)];
      add(staff > 0, 'Your data', staff > 0 ? `${products} products, ${customers} customers, ${staff} staff login(s)` : 'The database is empty – restore your backup: npm run restore -- "path/to/schluss-backup-…"');
      // Security posture
      const admins = await knex('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id').where({ 'u.type': 'staff', 'u.status': 'active' }).whereIn('r.key', ['super_admin', 'administrator']).distinct('u.id', 'u.mfa_enabled_at');
      const noMfa = admins.filter((a) => !a.mfa_enabled_at).length;
      if (noMfa) warn('Two-step verification', `${noMfa} of ${admins.length} administrator account(s) do not have two-step verification. Switch it on under Admin › My security, then make it compulsory for all staff.`);
      else add(true, 'Two-step verification', `All ${admins.length} administrator account(s) have it`);
      try {
        const grants = (await knex.raw('SHOW GRANTS FOR CURRENT_USER()'))[0].map((g) => Object.values(g)[0]).join(' | ');
        if (/ON \*\.\*/.test(grants) && /ALL PRIVILEGES|SUPER|FILE|GRANT OPTION/.test(grants)) warn('Database user', 'The database user has server-wide privileges. Create a user that only has rights on the SCHLUSS database (SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES) and use it in .env.');
        else add(true, 'Database user', 'Limited to its own database');
      } catch { /* not allowed to read grants – nothing to report */ }
      const media = await knex('media').whereNotNull('storage_key').select('storage_key');
      const root = path.resolve(e.STORAGE_DIR || path.join(ROOT, 'storage'));
      const goneKeys = new Set(media.filter((m) => !fs.existsSync(path.join(root, m.storage_key))).map((m) => m.storage_key));
      // Covers of YouTube/Vimeo videos are recreated automatically, so only other missing files block going live.
      const selfHealing = new Set((await knex('product_content_items as i').join('media as m', 'm.id', 'i.cover_media_id').whereNot('i.video_provider', 'upload').select('m.storage_key')).map((r) => r.storage_key));
      const serious = [...goneKeys].filter((k) => !selfHealing.has(k)).length;
      const gone = goneKeys.size;
      add(serious === 0, 'Uploaded files', serious ? `${serious} of ${media.length} files listed in the database are not in ${root}. Copy the storage folder from your backup (npm run restore does this).` : gone ? `All files are in ${root}, except ${gone} video cover image(s) that the site recreates by itself` : `All ${media.length} files are in ${root}`);
    }
  } catch (err) {
    add(false, 'Database connection', `Could not connect (${err.code || err.message}). Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in .env against your host's database details.`);
  } finally {
    if (knex) await knex.destroy();
  }

  const root = path.resolve(e.STORAGE_DIR || path.join(ROOT, 'storage'));
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, `.write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    add(true, 'Storage folder', `${root} is writable`);
  } catch (err) {
    add(false, 'Storage folder', `${root} cannot be written to (${err.code}). Uploads would fail – fix the folder's permissions or STORAGE_DIR.`);
  }

  try {
    const r = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'mail-check.cjs'), '--json'], { timeout: 90000, encoding: 'utf8' }).trim().split('\n').pop());
    const bad = [...r.steps.filter((s) => !s.ok), ...r.mailboxes.filter((b) => !b.ok)][0];
    add(r.ok, 'Email', r.ok ? 'Both mailboxes can log in' : bad ? bad.text : 'The mail check failed – run "npm run mail:check".');
  } catch (err) {
    let text = 'The mail check failed – run "npm run mail:check" to see why.';
    try {
      const r = JSON.parse(String(err.stdout || '').trim().split('\n').pop());
      const bad = [...r.steps.filter((s) => !s.ok), ...r.mailboxes.filter((b) => !b.ok)][0];
      if (bad) text = bad.text;
    } catch { /* keep the generic text */ }
    add(false, 'Email', text);
  }

  if (e.CSP === 'off') add(false, 'Content-Security-Policy', 'CSP=off is set in .env – remove that line so the browser protection against injected scripts is active.');
  else if (e.CSP === 'report-only') warn('Content-Security-Policy', 'CSP=report-only is set: violations are reported but not blocked. Remove the line to enforce it.');
  else add(true, 'Content-Security-Policy', 'Enforced');
  if (e.FORCE_HTTPS === 'off') warn('HTTPS redirect', 'FORCE_HTTPS=off is set – only use this if your host already redirects every visitor to https.');
  const backups = e.BACKUP_DAILY ? e.BACKUP_DAILY !== 'off' : e.NODE_ENV === 'production';
  if (backups) add(true, 'Automatic backups', `Daily, verified, kept ${e.BACKUP_KEEP_DAYS || 14} days in ${path.resolve(e.BACKUP_DIR || path.join(ROOT, 'backups'))} – also copy them off this server`);
  else warn('Automatic backups', 'Switched off (BACKUP_DAILY=off). Make sure your host backs up the database and the storage folder every day.');
  if (e.MALWARE_SCAN !== 'required') warn('Virus scanning of uploads', 'Uploaded installers and documents are type-checked but only virus-scanned when ClamAV is installed on the server. Ask your host for ClamAV and set MALWARE_SCAN=required.');

  console.log('\nSCHLUSS live check\n');
  for (const o of out) console.log(`${o.warn ? ' WARN ' : o.ok ? '  OK  ' : ' FIX  '} ${o.name}: ${o.text}`);
  const bad = out.filter((o) => !o.ok).length;
  const warns = out.filter((o) => o.warn).length;
  console.log(bad ? `\n${bad} thing(s) to fix before going live${warns ? `, and ${warns} warning(s) to review` : ''}.\n` : warns ? `\nNo blocking problems. ${warns} warning(s) to review before or shortly after going live.\n` : '\nReady to go live.\n');
  process.exit(bad ? 1 : 0);
})();

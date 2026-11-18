#!/usr/bin/env node
/**
 * Makes one complete backup of everything you have saved in SCHLUSS:
 *   - the database (products, videos, customers, settings, enquiries, staff logins, …)
 *   - the storage folder (pictures, cover images, installers, uploaded videos)
 *
 *   npm run backup                – writes a new folder under ./backups
 *   npm run backup -- D:\Backups  – writes it somewhere else
 *
 * Nothing is changed or deleted. The backup is used by `npm run restore` to move the site to another
 * computer or to the live server, and is checked there against the counts recorded here.
 * No mysqldump needed – this reads the database through the website's own connection settings (.env).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const ROOT = path.join(__dirname, '../..');
const envName = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const cfg = require('../db/knexfile.cjs')[envName].connection;
const SKIP_TABLES = new Set(['knex_migrations_lock']); // recreated by the migrations on the target
const SKIP_DATA = new Set(['sessions']); // people simply sign in again on the new server
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

function connect() {
  const conn = mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, charset: 'utf8mb4',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, jsonStrings: true, // values exactly as stored
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
  }).promise();
  return conn.query("SET time_zone = '+00:00'").then(() => conn);
}

async function main() {
  const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  // --mirror (used by the automatic daily backup): uploaded files are kept ONCE in <backup folder>/storage-mirror
  // and only new files are added each day, instead of a full copy of every file in every daily backup.
  const mirror = process.argv.includes('--mirror');
  const dir = path.join(outArg ? path.resolve(outArg) : path.join(ROOT, 'backups'), `schluss-backup-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\nSCHLUSS backup → ${dir}\n`);

  const conn = await connect();
  const [tables] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const names = tables.map((r) => Object.values(r)[0]).filter((t) => !SKIP_TABLES.has(t)).sort();
  if (!names.includes('knex_migrations')) throw new Error('This does not look like a SCHLUSS database (no migrations table). Check DB_NAME in .env.');
  const [mig] = await conn.query('SELECT name FROM knex_migrations ORDER BY id');
  const [[ver]] = await conn.query('SELECT VERSION() AS v');

  const head = `-- SCHLUSS backup ${new Date().toISOString()} · database "${cfg.database}" · server ${ver.v}\nSET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET FOREIGN_KEY_CHECKS = 0;\nSET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n`;
  const data = fs.createWriteStream(path.join(dir, 'database-data.sql')); // rows only – used by "npm run restore"
  const full = fs.createWriteStream(path.join(dir, 'database-full.sql')); // tables + rows – a plain SQL copy (phpMyAdmin etc.)
  data.write(head);
  full.write(head);
  const write = (s, alsoData = true) => { full.write(s); if (alsoData) data.write(s); };

  const counts = {};
  for (const t of names) {
    const [[create]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
    full.write(`\nDROP TABLE IF EXISTS \`${t}\`;\n${create['Create Table']};\n`);
    if (SKIP_DATA.has(t)) { counts[t] = 0; continue; }
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    counts[t] = Number(n);
    if (!counts[t]) continue;
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``);
    const stored = cols.filter((c) => !/GENERATED/i.test(c.Extra || '')).map((c) => c.Field); // generated columns are recalculated
    const colList = stored.map((c) => `\`${c}\``).join(', ');
    const key = cols.filter((c) => c.Key === 'PRI').map((c) => `\`${c.Field}\``).join(', ');
    write(`-- TABLE ${t} (${counts[t]} rows)\n`, t !== 'knex_migrations');
    const PAGE = 500;
    for (let off = 0; off < counts[t]; off += PAGE) {
      const [rows] = await conn.query(`SELECT ${colList} FROM \`${t}\`${key ? ` ORDER BY ${key}` : ''} LIMIT ${PAGE} OFFSET ${off}`);
      // One statement per line, at most ~1 MB each, so any tool (and the restore) can read it line by line.
      let batch = [];
      let size = 0;
      const flush = () => { if (batch.length) write(`INSERT INTO \`${t}\` (${colList}) VALUES ${batch.join(',')};\n`, t !== 'knex_migrations'); batch = []; size = 0; };
      for (const r of rows) {
        // JSON columns that the driver still handed over as objects are written back as JSON text.
        const v = `(${stored.map((c) => mysql.escape(r[c] !== null && typeof r[c] === 'object' && !Buffer.isBuffer(r[c]) ? JSON.stringify(r[c]) : r[c])).join(',')})`;
        if (size + v.length > 900_000) flush();
        batch.push(v);
        size += v.length;
      }
      flush();
    }
    console.log(`  ${String(counts[t]).padStart(7)}  ${t}`);
  }
  const tail = 'SET FOREIGN_KEY_CHECKS = 1;\n-- END OF BACKUP\n';
  data.write(tail);
  full.write(tail);
  await Promise.all([data, full].map((s) => new Promise((r) => s.end(r))));
  await conn.end();

  // Uploaded files
  const storageRoot = path.resolve(process.env.STORAGE_DIR || path.join(ROOT, 'storage'));
  let files = 0;
  let bytes = 0;
  const listing = [];
  if (fs.existsSync(storageRoot)) {
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(storageRoot, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) { if (!['tmp', 'dev-mail', 'logs'].includes(r)) walk(r); continue; }
        const src = path.join(storageRoot, r);
        const dest = mirror ? path.join(dir, '..', 'storage-mirror', r) : path.join(dir, 'storage', r);
        const size = fs.statSync(src).size;
        if (!(mirror && fs.existsSync(dest) && fs.statSync(dest).size === size)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
        files++;
        bytes += size;
        listing.push({ key: r.split(path.sep).join('/'), size });
      }
    };
    walk('');
  }
  console.log(`\n  ${files} uploaded file(s), ${(bytes / 1048576).toFixed(1)} MB  ← ${storageRoot}`);

  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  const manifest = {
    app: 'schluss', createdAt: new Date().toISOString(), database: cfg.database, serverVersion: ver.v,
    migrations: mig.map((m) => m.name), tables: counts, totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    storage: { files, bytes, listing, mirror }, checksums: { 'database-data.sql': sha('database-data.sql'), 'database-full.sql': sha('database-full.sql') },
    notSaved: ['sessions (everyone signs in again)', 'the .env file – keep your own copy; it holds passwords'],
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(dir, 'READ-ME.txt'), [
    'SCHLUSS backup', `Made: ${manifest.createdAt}`, `Database rows: ${manifest.totalRows} in ${Object.keys(counts).length} tables`, `Uploaded files: ${files}`, '',
    'To put this onto another computer or the live server:', '  1. Copy this whole folder there (zip it first if you like).', '  2. In the SCHLUSS project folder on that machine:  npm run db:migrate', '  3. Then:  npm run restore -- "path/to/this/folder"',
    '', 'database-full.sql is an ordinary SQL copy of everything (tables and rows), in case you ever need it.', 'This folder contains customer details and password hashes – keep it private.',
  ].join('\n'));
  console.log(`\nBackup complete: ${manifest.totalRows} database rows in ${Object.keys(counts).length} tables, ${files} files.\nFolder: ${dir}\nKeep it private – it contains customer details.\n`);
}

main().catch((e) => {
  console.error(`\nBackup failed: ${e.message}\nNothing was changed. Check that MySQL is running and the DB_ settings in .env are right.\n`);
  process.exit(1);
});

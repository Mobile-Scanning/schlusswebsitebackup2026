#!/usr/bin/env node
/**
 * Puts a backup made by `npm run backup` into THIS installation (the database and storage folder named in
 * this folder's .env) and checks that everything arrived.
 *
 *   npm run db:migrate                          (first – creates the empty tables)
 *   npm run restore -- "path/to/schluss-backup-…"            refuses if this site already has data
 *   npm run restore -- "path/to/schluss-backup-…" --replace  replaces this site's data with the backup
 *   npm run restore -- "path/to/schluss-backup-…" --check    only compares, changes nothing
 *
 * The rows go in inside the tables created by this version's own migrations, so a backup from MySQL can be
 * restored into MariaDB and the other way round.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const mysql = require('mysql2');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const ROOT = path.join(__dirname, '../..');
const envName = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const cfg = require('../db/knexfile.cjs')[envName].connection;
const args = process.argv.slice(2);
const replace = args.includes('--replace');
const checkOnly = args.includes('--check');
const verifyOnly = args.includes('--verify');
const src = args.find((a) => !a.startsWith('--'));
const fail = (m) => { console.error(`\n${m}\n`); process.exit(1); };

async function main() {
  if (!src) fail('Say which backup to restore:  npm run restore -- "path/to/schluss-backup-YYYYMMDD-HHMM"');
  const dir = path.resolve(src);
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) fail(`No backup found in ${dir} (manifest.json is missing). Give the path of the schluss-backup-… folder itself.`);
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const dataFile = path.join(dir, 'database-data.sql');
  const sum = crypto.createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex');
  if (sum !== manifest.checksums['database-data.sql']) fail('The backup file database-data.sql is damaged or incomplete (it does not match its checksum). Copy the backup folder again.');

  // Where a backed-up file is: inside the backup, or (automatic daily backups) in the shared storage-mirror next to it.
  const backedUp = (key) => [path.join(dir, 'storage', key), path.join(dir, '..', 'storage-mirror', key)].find((f) => fs.existsSync(f)) || null;

  if (verifyOnly) {
    // Integrity check of the backup itself – reads the files, connects to nothing, changes nothing.
    const counts = {};
    let table = null;
    for (const line of fs.readFileSync(dataFile, 'utf8').split('\n')) {
      const t = /^-- TABLE (\S+) \((\d+) rows\)/.exec(line);
      if (t) { table = t[1]; counts[table] = 0; continue; }
      if (table && line.startsWith('INSERT INTO ')) counts[table] += (line.match(/\),\(/g) || []).length + 1;
    }
    const complete = fs.readFileSync(dataFile, 'utf8').trimEnd().endsWith('-- END OF BACKUP');
    const badTables = Object.entries(manifest.tables).filter(([t, n]) => t !== 'knex_migrations' && n > 0 && !(t in counts));
    const badFiles = manifest.storage.listing.filter((f) => { const p = backedUp(f.key); return !p || fs.statSync(p).size !== f.size; });
    const ok = complete && !badTables.length && !badFiles.length;
    console.log(ok ? `Backup verified: checksum matches, ${Object.keys(counts).length} tables present, ${manifest.storage.files} files present.` : `Backup is NOT complete: ${!complete ? 'the database file is cut off; ' : ''}${badTables.length ? badTables.length + ' table(s) missing; ' : ''}${badFiles.length ? badFiles.length + ' file(s) missing' : ''}`);
    process.exit(ok ? 0 : 1);
  }

  console.log(`\nSCHLUSS restore\n  from: ${dir}  (made ${manifest.createdAt})\n  into: database "${cfg.database}" on ${cfg.host}\n`);
  const conn = mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true }).promise();
  await conn.query("SET time_zone = '+00:00'");
  const [tables] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const have = new Set(tables.map((r) => Object.values(r)[0]));
  if (!have.has('knex_migrations')) fail('This database has no SCHLUSS tables yet. Run  npm run db:migrate  first, then run the restore again.');
  const [mig] = await conn.query('SELECT name FROM knex_migrations ORDER BY id');
  const here = mig.map((m) => m.name);
  const missingHere = manifest.migrations.filter((m) => !here.includes(m));
  if (missingHere.length) fail(`This installation is older than the backup (it lacks: ${missingHere.join(', ')}). Install the same or a newer SCHLUSS version here, run  npm run db:migrate , then restore again.`);
  const missingTables = Object.keys(manifest.tables).filter((t) => t !== 'knex_migrations' && !have.has(t));
  if (missingTables.length) fail(`These tables from the backup do not exist here: ${missingTables.join(', ')}. Run  npm run db:migrate  first.`);

  const count = async (t) => Number((await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``))[0][0].n);
  const compare = async () => {
    const diff = [];
    for (const [t, n] of Object.entries(manifest.tables)) {
      if (t === 'knex_migrations' || t === 'sessions') continue;
      const got = await count(t);
      if (got !== n) diff.push(`${t}: backup ${n}, here ${got}`);
    }
    return diff;
  };
  const storageRoot = path.resolve(process.env.STORAGE_DIR || path.join(ROOT, 'storage'));
  const missingFiles = () => manifest.storage.listing.filter((f) => !fs.existsSync(path.join(storageRoot, f.key)) || fs.statSync(path.join(storageRoot, f.key)).size !== f.size);

  if (checkOnly) {
    const d = await compare();
    const f = missingFiles();
    console.log(d.length ? `Database differs from the backup:\n  ${d.join('\n  ')}` : `Database matches the backup (${manifest.totalRows} rows).`);
    console.log(f.length ? `${f.length} of ${manifest.storage.files} uploaded files are missing or different in ${storageRoot}.` : `All ${manifest.storage.files} uploaded files are present in ${storageRoot}.`);
    await conn.end();
    process.exit(d.length || f.length ? 1 : 0);
  }

  // Never overwrite a site that already has real content unless explicitly told to.
  const real = (await count('products')) + (await count('customers')) + (have.has('product_content_items') ? await count('product_content_items') : 0);
  if (real && !replace) fail(`This site already has data (${real} products / customers / videos). Nothing was changed.\nIf you really want to REPLACE it with the backup, run the same command with  --replace  at the end. Make a backup of this site first (npm run backup).`);

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  await conn.query("SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO'");
  await conn.query('SET NAMES utf8mb4');
  try {
    for (const t of Object.keys(manifest.tables)) if (t !== 'knex_migrations') await conn.query(`DELETE FROM \`${t}\``); // also clears seed rows – the backup has its own
    const rl = readline.createInterface({ input: fs.createReadStream(dataFile, 'utf8'), crlfDelay: Infinity });
    let n = 0;
    for await (const line of rl) {
      if (!line.startsWith('INSERT INTO ')) continue;
      await conn.query(line);
      if (++n % 50 === 0) process.stdout.write(`\r  ${n} batches loaded…`);
    }
    process.stdout.write(`\r  ${n} batches loaded.   \n`);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  // Uploaded files (existing files with the same name are identical – names are random – so they are left alone).
  let copied = 0;
  for (const f of manifest.storage.listing) {
    const from = backedUp(f.key);
    const to = path.join(storageRoot, f.key);
    if (!from) continue;
    if (fs.existsSync(to) && fs.statSync(to).size === f.size) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
  console.log(`  ${copied} uploaded file(s) copied to ${storageRoot}`);

  // Proof that nothing was lost
  const diff = await compare();
  const lost = missingFiles();
  let orphans = 0;
  if (have.has('media')) {
    const [media] = await conn.query('SELECT storage_key FROM media WHERE storage_key IS NOT NULL');
    orphans = media.filter((m) => !fs.existsSync(path.join(storageRoot, m.storage_key))).length;
  }
  await conn.end();
  console.log('\nCheck:');
  console.log(diff.length ? `  ✗ Database: ${diff.length} table(s) differ:\n    ${diff.join('\n    ')}` : `  ✓ Database: all ${manifest.totalRows} rows in ${Object.keys(manifest.tables).length} tables match the backup`);
  console.log(lost.length ? `  ✗ Files: ${lost.length} of ${manifest.storage.files} are missing` : `  ✓ Files: all ${manifest.storage.files} uploaded files are in place`);
  if (orphans) console.log(`  ! ${orphans} file(s) listed in the database were already missing when the backup was made (cover images of link videos restore themselves).`);
  if (diff.length || lost.length) fail('The restore did not complete cleanly – do not go live yet. Send this output to whoever supports the site.');
  console.log('\nRestore complete – nothing was lost. Everyone signs in again with their usual password.\n');
}

main().catch((e) => fail(`Restore failed: ${e.message}`));

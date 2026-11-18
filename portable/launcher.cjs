#!/usr/bin/env node
/**
 * SCHLUSS portable launcher – started by START.bat with the Node.js that is inside this folder.
 *
 * Everything the website needs lives in this one folder, so it can be copied to another Windows PC and started
 * with one double-click – nothing has to be installed:
 *   runtime\node      Node.js (included)
 *   runtime\mariadb   the database program (downloaded once, the first time START.bat runs with internet)
 *   database\         the website's data (created on first start; travels with the folder)
 *   storage\          uploaded pictures and files (travels with the folder)
 *   my-data\          put a "schluss-backup-…" folder here and it is loaded automatically on first start
 *
 *   node portable/launcher.cjs          start everything and open the website
 *   node portable/launcher.cjs backup   make a backup of this folder's data into backups\
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';
const NODE = process.execPath;
const RUNTIME = path.join(ROOT, 'runtime');
const MARIA = path.join(RUNTIME, 'mariadb');
const DATA = path.join(ROOT, 'database');
const MYDATA = path.join(ROOT, 'my-data');
const LOGS = path.join(ROOT, 'storage', 'logs');
const STATE = path.join(ROOT, 'portable', 'state.json');
const WEB_PORT = Number(process.env.SCHLUSS_PORT || 4200);
// Tried in order. Any "mariadb-*-winx64.zip" placed in the runtime folder by hand is used instead (no internet needed).
const MARIADB_ZIPS = [
  'https://archive.mariadb.org/mariadb-10.11.6/winx64-packages/mariadb-10.11.6-winx64.zip',
  'https://archive.mariadb.org/mariadb-10.11.9/winx64-packages/mariadb-10.11.9-winx64.zip',
  'https://archive.mariadb.org/mariadb-11.4.3/winx64-packages/mariadb-11.4.3-winx64.zip',
];

const say = (m) => console.log('  ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 1));
class Stop extends Error {}
const stop = (m) => { throw new Stop(m); };

const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '127.0.0.1');
});
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.once('timeout', () => { s.destroy(); resolve(false); });
});
const siteRunning = async (port = WEB_PORT) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    return r.status === 200 || r.status === 503;
  } catch { return false; }
};
const openBrowser = (url) => {
  if (process.env.SCHLUSS_NO_BROWSER) return;
  if (WIN) spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
};

/* ------------------------------------------------------------------ database program */
function bin(name) {
  if (!WIN) return name === 'server' ? 'mariadbd' : 'mariadb-install-db'; // only used when testing on Linux
  const names = name === 'server' ? ['mariadbd.exe', 'mysqld.exe'] : ['mariadb-install-db.exe', 'mysql_install_db.exe'];
  return names.map((n) => path.join(MARIA, 'bin', n)).find((f) => fs.existsSync(f)) || null;
}

function download(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    https.get(url, { timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      let shown = -1;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        const pct = total ? Math.floor((got / total) * 10) * 10 : -1;
        if (pct !== shown && pct >= 0) { shown = pct; process.stdout.write(`\r  downloading the database program… ${pct}%   `); }
      });
      res.pipe(out);
      out.on('finish', () => { process.stdout.write('\n'); out.close(() => resolve()); });
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timed out')); });
  });
}

async function ensureDatabaseProgram() {
  if (!WIN || bin('server')) return;
  fs.mkdirSync(RUNTIME, { recursive: true });
  let zip = fs.readdirSync(RUNTIME).map((f) => path.join(RUNTIME, f)).find((f) => /mariadb-.*win.*\.zip$/i.test(f));
  if (!zip) {
    say('First start on this folder: fetching the database program (about 90 MB, once only)…');
    zip = path.join(RUNTIME, 'mariadb-winx64.zip');
    let ok = false;
    let last = '';
    for (const url of MARIADB_ZIPS) {
      try { await download(url, zip + '.part'); fs.renameSync(zip + '.part', zip); ok = true; break; } catch (e) { last = e.message; fs.rmSync(zip + '.part', { force: true }); }
    }
    if (!ok) {
      stop(`The database program could not be downloaded (${last}).\n  This first start needs an internet connection. Connect and double-click START.bat again.\n  Or, on any computer, download "mariadb-10.11.6-winx64.zip" from https://mariadb.org/download and put the zip file\n  into this folder's "runtime" folder – START.bat will use it.`);
    }
  }
  say('Unpacking the database program…');
  const tmp = path.join(RUNTIME, '_unpack');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  let r = spawnSync('tar', ['-xf', zip, '-C', tmp], { stdio: 'ignore', windowsHide: true });
  if (r.status !== 0) r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`], { stdio: 'ignore', windowsHide: true });
  const inner = fs.existsSync(path.join(tmp, 'bin')) ? tmp : fs.readdirSync(tmp).map((d) => path.join(tmp, d)).find((d) => fs.existsSync(path.join(d, 'bin')));
  if (r.status !== 0 || !inner) stop('The database program could not be unpacked. Delete the "runtime\\_unpack" folder and the zip file in "runtime", then double-click START.bat again.');
  fs.rmSync(MARIA, { recursive: true, force: true });
  fs.renameSync(inner, MARIA);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  if (!bin('server')) stop('The downloaded database program is not the Windows 64-bit version. Download "mariadb-…-winx64.zip" and put it in the "runtime" folder.');
}

function initDataFolder(state) {
  if (fs.existsSync(path.join(DATA, 'mysql'))) return false;
  say('Creating the database for this folder…');
  fs.rmSync(DATA, { recursive: true, force: true });
  state.rootPassword = WIN ? crypto.randomBytes(18).toString('hex') : '';
  const args = WIN ? [`--datadir=${DATA}`, `--password=${state.rootPassword}`] : ['--no-defaults', `--datadir=${DATA}`, '--auth-root-authentication-method=normal', '--skip-test-db', '--user=' + require('node:os').userInfo().username];
  const r = spawnSync(bin('install'), args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(path.join(DATA, 'mysql'))) {
    // Second way: an empty, ready-made database folder that travels with the database program.
    const template = path.join(MARIA, 'data-template');
    if (fs.existsSync(path.join(template, 'mysql'))) {
      fs.rmSync(DATA, { recursive: true, force: true });
      fs.cpSync(template, DATA, { recursive: true });
      fs.rmSync(path.join(DATA, 'my.ini'), { force: true });
      state.rootPassword = '';
      state.rootNeedsPassword = true;
    } else {
      if (r.status === 3221225781 || /VCRUNTIME|MSVCP/i.test(String(r.stderr) + String(r.error || ''))) stop('This computer is missing the Microsoft Visual C++ runtime that the database program needs.\n  Install it from https://aka.ms/vs/17/release/vc_redist.x64.exe (free, from Microsoft) and double-click START.bat again.');
      stop(`The database could not be created.\n  ${(r.stderr || r.stdout || String(r.error || '')).trim().split('\n').slice(-4).join('\n  ')}`);
    }
  }
  writeState(state);
  return true;
}

let dbProc = null;
async function startDatabase(state) {
  // Use the usual port unless something else on this computer has it.
  let port = state.dbPort || 3307;
  for (let i = 0; i < 20 && !(await portFree(port)); i++) port++;
  state.dbPort = port;
  writeState(state);
  fs.mkdirSync(LOGS, { recursive: true });
  const log = fs.openSync(path.join(LOGS, 'database.log'), 'a');
  const args = ['--no-defaults', ...(WIN ? [`--basedir=${MARIA}`] : []), `--datadir=${DATA}`, `--port=${port}`, '--bind-address=127.0.0.1', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', '--max-allowed-packet=64M', '--innodb-flush-log-at-trx-commit=1', ...(WIN ? ['--console'] : ['--user=' + require('node:os').userInfo().username, `--socket=${path.join(DATA, 'schluss.sock')}`, `--pid-file=${path.join(DATA, 'schluss.pid')}`])];
  dbProc = spawn(bin('server'), args, { stdio: ['ignore', log, log], windowsHide: true });
  let exited = null;
  dbProc.on('exit', (code) => { exited = code; });
  dbProc.on('error', (e) => { exited = e.message; });
  for (let i = 0; i < 90; i++) {
    if (exited !== null) {
      if (exited === 3221225781) stop('This computer is missing the Microsoft Visual C++ runtime that the database program needs.\n  Install it from https://aka.ms/vs/17/release/vc_redist.x64.exe (free, from Microsoft) and double-click START.bat again.');
      stop(`The database stopped while starting (${exited}). The reason is at the end of storage\\logs\\database.log.\n  If this folder is still running in another window, close that window first.`);
    }
    if (await portOpen(port)) return port;
    await sleep(500);
  }
  stop('The database did not start within 45 seconds. See storage\\logs\\database.log.');
}

const mysql = () => require(path.join(ROOT, 'node_modules', 'mysql2', 'promise'));
async function rootConnection(state) {
  let last;
  for (let i = 0; i < 20; i++) {
    try { return await mysql().createConnection({ host: '127.0.0.1', port: state.dbPort, user: 'root', password: state.rootPassword || '' }); } catch (e) { last = e; await sleep(500); }
  }
  throw last;
}
async function stopDatabase(state) {
  if (!dbProc) return;
  try {
    const c = await rootConnection(state);
    await c.query('SHUTDOWN').catch(() => undefined);
    await c.end().catch(() => undefined);
  } catch { /* fall through to kill */ }
  for (let i = 0; i < 40 && dbProc.exitCode === null; i++) await sleep(250);
  if (dbProc.exitCode === null) dbProc.kill();
}

/* ------------------------------------------------------------------ settings (.env) */
function setEnvLine(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}=${value}`) : text.trimEnd() + `\n${key}=${value}\n`;
}
function ensureEnv(state) {
  const file = path.join(ROOT, '.env');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  if (!state.dbPassword) state.dbPassword = crypto.randomBytes(18).toString('hex');
  if (!/^APP_SECRET=.{32,}$/m.test(text)) text = setEnvLine(text, 'APP_SECRET', crypto.randomBytes(48).toString('hex'));
  for (const [k, v] of Object.entries({ DB_HOST: '127.0.0.1', DB_PORT: state.dbPort, DB_USER: 'schluss', DB_PASSWORD: state.dbPassword, DB_NAME: 'schluss', STORAGE_DIR: '' })) text = setEnvLine(text, k, v);
  fs.writeFileSync(file, text);
  writeState(state);
}
const childEnv = (state) => ({ ...process.env, DB_HOST: '127.0.0.1', DB_PORT: String(state.dbPort), DB_USER: 'schluss', DB_PASSWORD: state.dbPassword, DB_NAME: 'schluss', STORAGE_DIR: '', MAIL_ENV_LOCKED: '' });
const runNode = (args, state, opts = {}) => spawnSync(NODE, args, { cwd: ROOT, env: childEnv(state), encoding: 'utf8', windowsHide: true, ...opts });

/* ------------------------------------------------------------------ first-time data */
function newestBackup() {
  if (!fs.existsSync(MYDATA)) return null;
  const found = [];
  const look = (dir, depth) => {
    if (fs.existsSync(path.join(dir, 'manifest.json')) && fs.existsSync(path.join(dir, 'database-data.sql'))) return found.push(dir);
    if (depth < 2) for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) look(path.join(dir, e.name), depth + 1);
  };
  look(MYDATA, 0);
  return found.sort((a, b) => fs.statSync(path.join(b, 'manifest.json')).mtimeMs - fs.statSync(path.join(a, 'manifest.json')).mtimeMs)[0] || null;
}

async function prepareData(state) {
  const c = await rootConnection(state);
  if (state.rootNeedsPassword) {
    // The ready-made database folder has no administrator password yet – give it a private one.
    const pw = crypto.randomBytes(18).toString('hex');
    let set = false;
    for (const h of ['localhost', '127.0.0.1', '::1']) { try { await c.query(`ALTER USER 'root'@'${h}' IDENTIFIED BY ?`, [pw]); set = true; } catch { /* that entry does not exist */ } }
    if (set) { await c.query('FLUSH PRIVILEGES'); state.rootPassword = pw; }
    delete state.rootNeedsPassword;
    writeState(state);
  }
  await c.query('CREATE DATABASE IF NOT EXISTS schluss CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  for (const h of ['localhost', '127.0.0.1']) {
    await c.query(`CREATE USER IF NOT EXISTS 'schluss'@'${h}' IDENTIFIED BY ?`, [state.dbPassword]);
    await c.query(`ALTER USER 'schluss'@'${h}' IDENTIFIED BY ?`, [state.dbPassword]);
    await c.query(`GRANT ALL PRIVILEGES ON schluss.* TO 'schluss'@'${h}'`);
  }
  await c.query('FLUSH PRIVILEGES');

  say('Checking the database tables…');
  const mig = runNode([path.join(ROOT, 'node_modules', 'knex', 'bin', 'cli.js'), '--knexfile', path.join(ROOT, 'server', 'db', 'knexfile.cjs'), 'migrate:latest'], state);
  if (mig.status !== 0) { await c.end(); stop(`The database tables could not be prepared:\n  ${(mig.stderr || mig.stdout).trim().split('\n').slice(-5).join('\n  ')}`); }

  const [[{ n }]] = await c.query('SELECT (SELECT COUNT(*) FROM schluss.products) + (SELECT COUNT(*) FROM schluss.customers) + (SELECT COUNT(*) FROM schluss.users) AS n');
  await c.end();
  if (Number(n) > 0) return; // this folder already has its data

  const backup = newestBackup();
  if (backup) {
    say(`Loading your data from my-data\\${path.relative(MYDATA, backup)} …`);
    const r = runNode([path.join(ROOT, 'server', 'cli', 'restore.cjs'), backup], state);
    const out = (r.stdout + '\n' + r.stderr).trim();
    if (r.status !== 0) stop(`Your data could not be loaded:\n  ${out.split('\n').slice(-8).join('\n  ')}`);
    for (const line of out.split('\n').filter((l) => /✓|complete/.test(l))) say(line.trim());
    state.loadedFrom = path.basename(backup);
    state.loadedAt = new Date().toISOString();
    writeState(state);
  } else {
    say('No backup found in the "my-data" folder – starting with an empty website.');
    const seed = runNode([path.join(ROOT, 'node_modules', 'knex', 'bin', 'cli.js'), '--knexfile', path.join(ROOT, 'server', 'db', 'knexfile.cjs'), 'seed:run'], state);
    if (seed.status !== 0) say('(The starter content could not be added – the website still works.)');
    say('To create your first admin login, double-click CREATE-ADMIN.bat after the website has started.');
  }
}

/* ------------------------------------------------------------------ main */
async function boot(state) {
  await ensureDatabaseProgram();
  const fresh = initDataFolder(state);
  await startDatabase(state);
  ensureEnv(state);
  await prepareData(state);
  return fresh;
}

async function main() {
  const mode = process.argv[2] || 'start';
  console.log('\n  SCHLUSS\n');
  fs.mkdirSync(path.join(ROOT, 'portable'), { recursive: true });
  const state = readState();

  if (mode === 'start' && (await siteRunning())) {
    say('The website is already running. Opening it…');
    openBrowser(`http://localhost:${WEB_PORT}/`);
    await sleep(1500);
    return;
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'schluss', 'server', 'server.mjs'))) stop('The built website (the "dist" folder) is missing from this folder. Copy the whole folder again.');
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) stop('The "node_modules" folder is missing from this folder. Copy the whole folder again.');
  if (mode === 'start' && !(await portFree(WEB_PORT))) stop(`Another program on this computer is using port ${WEB_PORT}. Close it (or restart the computer) and double-click START.bat again.`);

  await boot(state);

  if (mode === 'backup') {
    say('Making a backup of this folder\'s data…');
    const r = runNode([path.join(ROOT, 'server', 'cli', 'backup.cjs')], state, { stdio: 'inherit' });
    await stopDatabase(state);
    if (r.status !== 0) stop('The backup did not complete.');
    return;
  }
  if (mode === 'admin') {
    const r = runNode([path.join(ROOT, 'server', 'cli', 'create-admin.cjs')], state, { stdio: 'inherit' });
    await stopDatabase(state);
    if (r.status !== 0) stop('The admin login was not created.');
    return;
  }

  say('Starting the website…');
  const log = fs.openSync(path.join(LOGS, 'website.log'), 'a');
  const web = spawn(NODE, [path.join(ROOT, 'dist', 'schluss', 'server', 'server.mjs')], { cwd: ROOT, env: { ...childEnv(state), PORT: String(WEB_PORT) }, stdio: ['ignore', log, log], windowsHide: true });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\n  Stopping the website and saving the database…');
    web.kill();
    await stopDatabase(state);
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => void shutdown());
  web.on('exit', (code) => { if (!closing) { console.log(`\n  The website stopped unexpectedly (${code}). See storage\\logs\\website.log.`); void shutdown(); } });

  for (let i = 0; i < 80 && !(await siteRunning()); i++) await sleep(500);
  if (!(await siteRunning())) { web.kill(); await stopDatabase(state); stop('The website did not start. The reason is at the end of storage\\logs\\website.log.'); }

  console.log(`\n  The website is running:  http://localhost:${WEB_PORT}\n`);
  console.log('  KEEP THIS WINDOW OPEN while you use the website.');
  console.log('  To stop it (always do this before copying the folder to another computer): close this window.\n');
  openBrowser(`http://localhost:${WEB_PORT}/`);
}

main().catch(async (e) => {
  if (e instanceof Stop) console.log('\n  ' + e.message + '\n');
  else console.log('\n  Something went wrong: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e) + '\n');
  try { await stopDatabase(readState()); } catch { /* nothing running */ }
  process.exitCode = 1;
});

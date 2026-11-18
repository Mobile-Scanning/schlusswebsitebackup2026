// One-time local setup:   npm run setup
//  1. creates .env for local development (if you don't have one yet)
//  2. creates the MySQL/MariaDB database if it doesn't exist
//  3. runs the migrations and seeds (roles, email templates, sample catalogue)
// Safe to run again at any time: it only adds what is missing.
//
// Start over locally:     npm run db:fresh   (asks you to type the database name first)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';

const require = createRequire(import.meta.url);
const { explainDbError } = require('../server/db/explain-error.cjs');
const fresh = process.argv.includes('--fresh');

function fail(e) {
  console.error('\n✖ ' + explainDbError(e));
  process.exit(1);
}

if (!existsSync('.env')) {
  let env = readFileSync('.env.example', 'utf8');
  const set = (key, value) => (env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`));
  set('NODE_ENV', 'development');
  set('APP_URL', 'http://localhost:4200');
  set('APP_SECRET', randomBytes(48).toString('hex'));
  set('DB_HOST', '127.0.0.1');
  set('DB_USER', 'root');
  set('DB_PASSWORD', '');
  set('DB_NAME', 'schluss');
  writeFileSync('.env', env);
  console.log('✔ Created .env for local development (MySQL user "root", no password, database "schluss").');
  console.log('  If your MySQL user or password is different, edit .env and run "npm run setup" again.\n');
}

require('dotenv').config({ quiet: true });
const env = process.env;
if (env.NODE_ENV === 'production' && fresh) {
  console.error('✖ db:fresh is for local development only (NODE_ENV=production in .env).');
  process.exit(1);
}
if (!env.DB_NAME || !/^[A-Za-z0-9_]+$/.test(env.DB_NAME)) {
  console.error('✖ DB_NAME in .env must be a simple name (letters, numbers, underscores), for example: DB_NAME=schluss');
  process.exit(1);
}

// 1. Database
const mysql = require('mysql2/promise');
try {
  const conn = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD });
  const [[{ v }]] = await conn.query('SELECT VERSION() AS v');
  if (fresh) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This deletes EVERYTHING in the local database "${env.DB_NAME}". Type ${env.DB_NAME} to continue: `);
    rl.close();
    if (answer.trim() !== env.DB_NAME) {
      console.log('Cancelled – nothing was changed.');
      process.exit(0);
    }
    await conn.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
    console.log(`✔ Deleted database "${env.DB_NAME}".`);
  }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  console.log(`✔ Connected to the database server (${v}) – database "${env.DB_NAME}" is ready.`);
} catch (e) {
  fail(e);
}

// 2. Tables and starter data
const knexfile = require('../server/db/knexfile.cjs');
const knex = require('knex')(knexfile[env.NODE_ENV === 'production' ? 'production' : 'development']);
try {
  const [batch, done] = await knex.migrate.latest();
  console.log(done.length ? `✔ Created/updated tables (${done.length} migration${done.length > 1 ? 's' : ''}, batch ${batch}).` : '✔ Tables are up to date.');
  const [seeds] = await knex.seed.run();
  console.log(`✔ Loaded starter data (${seeds.length} seed files: roles, email templates, sample catalogue).`);
  const [{ n }] = await knex('users').whereIn('type', ['staff']).count({ n: '*' });
  await knex.destroy();
  console.log('\n✔ Setup complete. Next:');
  if (Number(n) === 0) console.log('  1. Create your admin login:  npm run admin:create');
  console.log(`  ${Number(n) === 0 ? '2' : '1'}. Start the app:            npm start   → open http://localhost:4200`);
} catch (e) {
  await knex.destroy().catch(() => {});
  fail(e);
}

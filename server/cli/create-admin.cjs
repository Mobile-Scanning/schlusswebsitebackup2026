#!/usr/bin/env node
/**
 * Creates (or promotes) the first Super Administrator.
 * Usage:  npm run admin:create            (asks for email, name and password)
 *    or:  node server/cli/create-admin.cjs --email you@schluss.co.za --name "Your Name"
 * The password is read from the ADMIN_PASSWORD env var or asked for (input hidden is not
 * available on all cPanel terminals, so prefer the env var and clear your shell history after).
 */
const path = require('node:path');
const readline = require('node:readline');
const bcrypt = require('bcryptjs');
const env = process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';
const knex = require('knex')(require(path.join(__dirname, '../db/knexfile.cjs'))[env]);
const { explainDbError } = require(path.join(__dirname, '../db/explain-error.cjs'));

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

// One shared prompt, so answers typed (or pasted) ahead are never lost between questions.
let rl;
const queue = [];
const waiting = [];
function ask(q) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : queue.push(l)));
    rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
  }
  process.stdout.write(q);
  return new Promise((res) => (queue.length ? res(queue.shift()) : waiting.push(res)));
}

(async () => {
  try {
    const email = (arg('email') || (await ask('Admin email address: '))).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That is not a valid email address – run the command again.');
    const name = (arg('name') || (await ask('Your name: ')) || 'Administrator').trim();
    const password = process.env.ADMIN_PASSWORD || (await ask('Password (min 12 chars): '));
    if (!password || password.length < 12) throw new Error('Password must be at least 12 characters');

    const role = await knex('roles').where({ key: 'super_admin' }).first('id');
    if (!role) throw new Error('The roles are missing – run: npm run setup');

    const hash = await bcrypt.hash(password, 12);
    let user = await knex('users').where({ email }).first();
    if (user && user.type !== 'staff') throw new Error('That email belongs to a customer/partner account');
    if (!user) {
      const [id] = await knex('users').insert({ type: 'staff', name, email, password_hash: hash, email_verified_at: knex.fn.now() });
      user = { id };
    } else {
      await knex('users').where({ id: user.id }).update({ password_hash: hash, status: 'active', updated_at: knex.fn.now() });
    }
    await knex('user_roles').insert({ user_id: user.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
    await knex('audit_logs').insert({ action: 'cli.super_admin_created', subject_type: 'user', subject_id: user.id, meta: JSON.stringify({ email }) });
    console.log(`Super Administrator ready: ${email}`);
  } catch (e) {
    console.error('✖ ' + (e.code || e.errno ? explainDbError(e) : e.message));
    process.exitCode = 1;
  } finally {
    if (rl) rl.close();
    await knex.destroy();
  }
})();

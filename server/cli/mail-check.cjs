#!/usr/bin/env node
/**
 * Checks the mail server settings in .env, step by step, and says in plain words what is wrong.
 *   npm run mail:check                      – test both mailboxes (connect + log in)
 *   npm run mail:check -- you@example.com   – also send a test email to that address, right now
 * Used by Admin › Email settings › "Check mail server now" (with --json).
 * Nothing is stored and passwords are never printed.
 */
const path = require('node:path');
require('./mail-env.cjs');
const dns = require('node:dns').promises;
const net = require('node:net');
const tls = require('node:tls');
const nodemailer = require('nodemailer');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const sendTo = args.find((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) || null;
const host = (process.env.MAIL_HOST || '').trim();
const port = Number(process.env.MAIL_PORT || 587);
const secure = port === 465;
const insecure = process.env.MAIL_TLS_INSECURE === '1';

const accounts = [
  { key: 'support', label: 'Support mailbox', user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD, from: process.env.MAIL_FROM || 'SCHLUSS <no-reply@schluss.co.za>', passVar: 'MAIL_PASSWORD' },
  ...(process.env.MAIL_SALES_USER ? [{ key: 'sales', label: 'Sales mailbox', user: process.env.MAIL_SALES_USER, pass: process.env.MAIL_SALES_PASSWORD, from: process.env.MAIL_SALES_FROM || `SCHLUSS Sales <${process.env.MAIL_SALES_USER}>`, passVar: 'MAIL_SALES_PASSWORD' }] : []),
];

const tcp = () => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 10000 });
  s.once('connect', () => { s.destroy(); resolve(null); });
  s.once('timeout', () => { s.destroy(); resolve('timeout'); });
  s.once('error', (e) => resolve(e.code || e.message));
});
/** The names on the server's certificate (to suggest the right MAIL_HOST when the name doesn't match). */
const certNames = () => new Promise((resolve) => {
  if (!secure) return resolve([]);
  const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10000 }, () => {
    const c = s.getPeerCertificate();
    const names = String(c.subjectaltname || '').split(',').map((x) => x.trim().replace(/^DNS:/, '')).filter(Boolean);
    if (c.subject && c.subject.CN && !names.includes(c.subject.CN)) names.unshift(c.subject.CN);
    s.destroy();
    resolve(names);
  });
  s.once('error', () => resolve([]));
  s.once('timeout', () => { s.destroy(); resolve([]); });
});

/** Turns a mail error into what to do about it. */
async function explain(e, a) {
  const msg = String((e && e.message) || e);
  const code = e && e.code;
  if (code === 'EAUTH' || (e && e.responseCode === 535) || /Invalid login|authentication failed|535/i.test(msg)) {
    return { problem: 'login', text: `The mail server refused the password for ${a.user}. Copy the password again from your hosting panel into ${a.passVar} in .env (l / I / 1 and O / 0 look alike), save, and restart the website. If you reset the password at your host, use the new one.` };
  }
  if (/altnames|Hostname\/IP does not match|ERR_TLS_CERT_ALTNAME_INVALID/i.test(msg) || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    const names = await certNames();
    const pick = names.find((n) => !n.startsWith('*')) || names[0];
    return { problem: 'certificate_name', names, text: `The mail server's security certificate is not issued for "${host}"${names.length ? ` – it is issued for: ${names.slice(0, 4).join(', ')}` : ''}. ${pick ? `In .env set MAIL_HOST=${pick.replace(/^\*\./, 'mail.')} (your host's own server name), save, and restart.` : 'Ask your host for the mail server name that matches its SSL certificate and use it as MAIL_HOST.'}` };
  }
  if (/self.signed|unable to verify|certificate has expired|CERT_/i.test(msg)) {
    return { problem: 'certificate', text: `The mail server's security certificate could not be verified (${msg}). Ask your host which mail server name to use with SSL, and set it as MAIL_HOST in .env.` };
  }
  if (/wrong version number|SSL routines/i.test(msg)) {
    return { problem: 'port', text: `Port ${port} did not answer with ${secure ? 'SSL' : 'plain SMTP'}. Use MAIL_PORT=465 for SSL/TLS, or MAIL_PORT=587 for STARTTLS.` };
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION' || /timeout|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return { problem: 'blocked', text: `This computer could not reach ${host} on port ${port} (${msg}). A firewall, antivirus “mail shield”, VPN or your internet provider is probably blocking outgoing mail on that port. Allow Node.js through the firewall / switch off the antivirus mail scanning for port ${port}, or try another network (e.g. a phone hotspot).` };
  }
  if (/sender|from address|not owned|553|550/i.test(msg)) {
    return { problem: 'sender', text: `The mail server did not accept the sender address ${a.from} (${msg}). The “from” address must be the mailbox that logs in.` };
  }
  return { problem: 'other', text: msg };
}

async function main() {
  const out = { host, port, ssl: secure, ok: false, steps: [], mailboxes: [], sent: null };
  const step = (name, ok, text) => out.steps.push({ name, ok, text });

  if (!host) {
    step('Settings', false, 'MAIL_HOST is empty in .env, so no email can be sent. Use the .env from the latest download (it has the schluss.co.za mail server filled in) and restart.');
    return out;
  }
  step('Settings', true, `${host}, port ${port}${secure ? ' (SSL/TLS)' : ''}`);

  let ips = [];
  try {
    ips = (await dns.lookup(host, { all: true })).map((r) => r.address);
    step('Find the mail server', true, `${host} → ${ips.join(', ')}`);
  } catch (e) {
    step('Find the mail server', false, `The name "${host}" could not be found (${e.code || e.message}). Check the spelling of MAIL_HOST, and that this computer is online.`);
    return out;
  }

  const t = await tcp();
  if (t) {
    step('Connect', false, `This computer could not reach ${host} on port ${port} (${t}). A firewall, antivirus “mail shield”, VPN or your internet provider is probably blocking outgoing mail on that port. Allow Node.js through the firewall, switch off antivirus mail scanning for port ${port}, or try another network (e.g. a phone hotspot).`);
    return out;
  }
  step('Connect', true, `Port ${port} is reachable`);

  for (const a of accounts) {
    const box = { key: a.key, label: a.label, user: a.user || null, from: a.from, ok: false, text: '' };
    out.mailboxes.push(box);
    if (!a.user || !a.pass) {
      box.text = `${a.user ? a.passVar : 'MAIL_USER'} is empty in .env.`;
      continue;
    }
    const tr = nodemailer.createTransport({ host, port, secure, auth: { user: a.user, pass: a.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000, ...(insecure ? { tls: { rejectUnauthorized: false } } : {}) });
    try {
      await tr.verify();
      box.ok = true;
      box.text = `Logged in as ${a.user}.`;
      if (sendTo && a.key === 'support') {
        try {
          const info = await tr.sendMail({ from: a.from, to: sendTo, subject: 'SCHLUSS mail check – this mailbox can send email', text: `This is a test from the SCHLUSS website, sent ${new Date().toISOString()} from ${a.user}. If you can read this, verification codes and other emails can be sent.` });
          out.sent = { ok: true, to: sendTo, text: `Test email accepted by the mail server for ${sendTo} (${info.response || info.messageId}). If it isn't in the inbox within a minute, check the Spam/Junk folder.` };
        } catch (e) {
          out.sent = { ok: false, to: sendTo, ...(await explain(e, a)) };
        }
      }
    } catch (e) {
      Object.assign(box, await explain(e, a));
    } finally {
      tr.close();
    }
  }
  out.ok = out.mailboxes.length > 0 && out.mailboxes.every((b) => b.ok) && (!out.sent || out.sent.ok);
  return out;
}

module.exports = { explain };
if (require.main === module) {
  main()
    .then((out) => {
      if (asJson) return console.log(JSON.stringify(out));
      console.log('\nSCHLUSS mail check\n');
      for (const s of out.steps) console.log(`${s.ok ? '  OK  ' : ' FAIL '} ${s.name}: ${s.text}`);
      for (const b of out.mailboxes) console.log(`${b.ok ? '  OK  ' : ' FAIL '} ${b.label} (${b.user || 'not set'}): ${b.text}`);
      if (out.sent) console.log(`${out.sent.ok ? '  OK  ' : ' FAIL '} Test email: ${out.sent.text}`);
      console.log(out.ok ? '\nEverything works – the website can send email.\n' : '\nEmail cannot be sent yet – fix the FAIL line above, restart the website and run this again.\n');
      process.exit(out.ok ? 0 : 1);
    })
    .catch((e) => {
      console.log(asJson ? JSON.stringify({ ok: false, steps: [{ name: 'Mail check', ok: false, text: String(e.message || e) }], mailboxes: [], sent: null }) : `Mail check failed: ${e.message || e}`);
      process.exit(1);
    });
}

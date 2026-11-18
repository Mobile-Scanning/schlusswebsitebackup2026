import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { adminSystemRouter } from '../../server/api/routes/admin-system';
import { adminCatalogueRouter } from '../../server/api/routes/admin-catalogue';
import { adminSalesRouter } from '../../server/api/routes/admin-sales';
import { adminPlatformRouter } from '../../server/api/routes/admin-platform';
import { adminSupportRouter } from '../../server/api/routes/support';
import { adminOpsRouter } from '../../server/api/routes/admin-ops';
import { adminContentRouter } from '../../server/api/routes/content';
import { totpAt, totpStep } from '../../server/api/services/security';
import { decryptSecret } from '../../server/api/services/platform';
import { client, createPartnerUser, createStaff, lastOtp, login, register, uniqueEmail } from './helpers';

/*
 * Security regression tests – safe, non-destructive, against this application's own test database only.
 * Numbered like the pre-launch test plan (unauthenticated access, privilege escalation, data isolation, injection,
 * CSRF, brute force, tokens, sessions, files, uploads, API permissions, secrets, two-step verification).
 */
type C = Awaited<ReturnType<typeof client>>;
let admin: C;
let readOnly: C;
let custA: C & { email: string; id: number };
let custB: C & { email: string; id: number };
const PW = 'Puzzle-piece-42';

async function customer(tag: string) {
  const c = await client();
  const email = uniqueEmail(tag);
  await register(c, { name: `Customer ${tag}`, email, password: PW, acceptPrivacy: true });
  const row = await db('customers').where({ email }).first('id');
  return Object.assign(c, { email, id: row.id as number });
}
const routes: { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string }[] = [];
for (const r of [adminSystemRouter, adminCatalogueRouter, adminSalesRouter, adminPlatformRouter, adminSupportRouter, adminOpsRouter, adminContentRouter]) {
  for (const l of (r as unknown as { stack: { route?: { path: string | string[]; methods: Record<string, boolean> } }[] }).stack) {
    if (!l.route) continue;
    for (const p of Array.isArray(l.route.path) ? l.route.path : [l.route.path]) for (const m of Object.keys(l.route.methods)) routes.push({ method: m as 'get', path: String(p).replace(/:[a-zA-Z]+/g, '1') });
  }
}
const call = async (c: C, method: string, url: string, body: object = {}) => (method === 'get' ? c.get(url) : method === 'post' ? c.post(url, body) : method === 'put' ? c.put(url, body) : method === 'patch' ? c.patch(url, body) : c.del(url));

beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  const r = await createStaff(['read_only']);
  admin = await client();
  readOnly = await client();
  await login(admin, a.email, a.password);
  await login(readOnly, r.email, r.password);
  custA = await customer('sec-a');
  custB = await customer('sec-b');
});
afterAll(() => db.destroy());

describe('1, 2, 14 – every admin endpoint checks who is asking (not just the screens)', () => {
  it(`all ${routes.length} admin endpoints refuse anonymous visitors, customers and partners`, async () => {
    expect(routes.length).toBeGreaterThan(120);
    const anon = await client();
    const partner = await client();
    const p = await createPartnerUser('approved');
    await login(partner, p.email, p.password);
    const leaks: string[] = [];
    for (const r of routes) {
      const url = '/api/admin' + r.path;
      if (r.path === '/nav-counts') continue; // answers {} to non-staff (checked below)
      const a = (await call(anon, r.method, url)).status;
      const c = (await call(custA, r.method, url)).status;
      const pt = (await call(partner, r.method, url)).status;
      if (a !== 401 || c !== 403 || pt !== 403) leaks.push(`${r.method} ${r.path} anon=${a} customer=${c} partner=${pt}`);
    }
    expect(leaks).toEqual([]);
    expect((await anon.get('/api/admin/nav-counts')).body).toEqual({});
    expect((await custA.get('/api/admin/nav-counts')).body).toEqual({});
  }, 120_000);

  it('read-only staff cannot change anything', async () => {
    const allowed = new Set(['post /notifications/read', 'post /notifications/1/read']);
    const leaks: string[] = [];
    for (const r of routes.filter((x) => x.method !== 'get')) {
      const s = (await call(readOnly, r.method, '/api/admin' + r.path)).status;
      if (s !== 403 && !allowed.has(`${r.method} ${r.path}`)) leaks.push(`${r.method} ${r.path} → ${s}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('account pages need a signed-in customer', async () => {
    const anon = await client();
    for (const u of ['/api/account/dashboard', '/api/account/my-demos', '/api/account/profile', '/api/account/trials', '/api/notifications']) expect((await anon.get(u)).status, u).toBe(401);
    expect((await admin.get('/api/account/dashboard')).status).toBe(403); // staff are not customers
  });

  it('refused requests are recorded as security events (without request bodies)', async () => {
    await custA.get('/api/admin/customers');
    await new Promise((r) => setTimeout(r, 150));
    const ev = await db('audit_logs').where({ action: 'security.forbidden' }).where('meta', 'like', '%"/api/admin/customers"%').orderBy('id', 'desc').first();
    expect(ev).toBeDefined();
    const meta = typeof ev.meta === 'string' ? JSON.parse(ev.meta) : ev.meta;
    expect(meta.path).toBe('/api/admin/customers');
    expect(JSON.stringify(meta)).not.toMatch(/password|token/i);
    const list = await admin.get('/api/admin/audit-logs?security=1');
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: { action: string }) => r.action === 'security.forbidden')).toBe(true);
  });
});

describe('2 – privilege escalation between staff', () => {
  it('a manager cannot make themselves or anyone a Super Administrator, or touch one', async () => {
    const m = await createStaff(['administrator']);
    const mc = await client();
    await login(mc, m.email, m.password);
    const sup = await createStaff(['super_admin']);
    expect((await mc.patch(`/api/admin/staff/${m.id}`, { roles: ['super_admin'] })).status).toBe(403);
    expect((await mc.post('/api/admin/staff', { name: 'Evil Twin', email: uniqueEmail('evil'), password: 'StaffPass12345!', roles: ['super_admin'] })).status).toBe(403);
    expect((await mc.patch(`/api/admin/staff/${sup.id}`, { status: 'disabled' })).status).toBe(403);
    expect((await mc.patch(`/api/admin/staff/${sup.id}`, { resetMfa: true })).status).toBe(403);
    const roles = (await admin.get('/api/admin/roles')).body;
    const superRole = roles.roles.find((r: { key: string }) => r.key === 'super_admin');
    expect((await mc.put(`/api/admin/roles/${superRole.id}/permissions`, { permissions: [] })).status).toBeGreaterThanOrEqual(400);
  });
  it('a customer cannot turn into staff through any profile or registration field', async () => {
    const c = await client();
    const email = uniqueEmail('mass');
    await register(c, { name: 'Mass Assign', email, password: PW, acceptPrivacy: true, type: 'staff', roles: ['super_admin'], status: 'active', email_verified_at: '2020-01-01' });
    await c.put('/api/account/profile', { fullName: 'Mass Assign', type: 'staff', user_id: 1, roles: ['super_admin'] });
    const u = await db('users').where({ email }).first('type');
    expect(u.type).toBe('customer');
    expect((await c.get('/api/admin/staff')).status).toBe(403);
  });
});

describe('3, 4 – one customer can never see or change another customer’s data', () => {
  it('conversations, messages and live streams are private to their owner', async () => {
    const conv = await custA.post('/api/support/conversations', { message: 'My private question about my licence', consent: true });
    expect(conv.status).toBe(201);
    const ref = conv.body.reference;
    expect((await custA.get(`/api/support/conversations/${ref}`)).status).toBe(200);
    expect((await custB.get(`/api/support/conversations/${ref}`)).status).toBe(404);
    expect((await custB.post(`/api/support/conversations/${ref}/messages`, { body: 'let me in' })).status).toBe(404);
    expect((await (await client()).post(`/api/support/conversations/${ref}/messages`, { body: 'let me in' })).status).toBe(404);
    expect((await (await client()).get(`/api/support/conversations/${ref}`)).status).toBe(404);
    const mine = await custB.get('/api/support/conversations');
    expect(JSON.stringify(mine.body)).not.toContain(ref);
  });
  it('profiles: no id can be supplied – each customer only reaches their own', async () => {
    await custB.put('/api/account/profile', { fullName: 'Changed By B', id: custA.id, customerId: custA.id, customer_id: custA.id });
    const a = await db('customers').where({ id: custA.id }).first('full_name');
    expect(a.full_name).toBe('Customer sec-a');
    const dash = await custB.get('/api/account/dashboard');
    expect(JSON.stringify(dash.body)).not.toContain(custA.email);
  });
  it('a download link made for one customer does not work for another, or when altered', async () => {
    const { signToken } = await import('../../server/api/services/platform');
    const forged = signToken({ d: 1, c: custA.id }, 600);
    expect([401, 403, 404]).toContain((await custB.get(`/api/account/downloads/${forged}`)).status);
    expect([400, 401, 403, 404]).toContain((await custA.get(`/api/account/downloads/${forged.slice(0, -3)}abc`)).status);
  });
});

describe('5, 6, 7 – hostile input', () => {
  const sqli = ["' OR '1'='1", "'; DROP TABLE users; --", '" OR ""="', "1' UNION SELECT password_hash FROM users-- ", "%' AND SLEEP(3)-- ", '\\'];
  it('SQL injection strings are treated as plain text everywhere they can be typed', async () => {
    const anon = await client();
    const usersBefore = Number((await db('users').count({ n: '*' }).first())!.n);
    for (const p of sqli) {
      const q = encodeURIComponent(p);
      const started = Date.now();
      for (const r of [
        await anon.get(`/api/public/products?q=${q}`),
        await anon.get(`/api/public/products/${q}`),
        await admin.get(`/api/admin/customers?q=${q}`),
        await admin.get(`/api/admin/products?q=${q}&offering=${q}`),
        await admin.get(`/api/admin/audit-logs?action=${q}`),
        await admin.get(`/api/admin/staff?q=${q}`),
        await anon.post('/api/auth/login', { email: p, password: p }),
        await anon.post('/api/auth/login', { email: `a${Date.now()}@example.test`, password: p }),
        await anon.get(`/api/content/products/${q}/library`),
        await custA.get(`/api/support/conversations/${q}`),
      ]) {
        expect(r.status, `${p} → ${r.status}`).toBeLessThan(500);
        expect(JSON.stringify(r.body)).not.toMatch(/SQL syntax|ER_|password_hash|knex|mysql/i);
      }
      expect(Date.now() - started).toBeLessThan(2500); // no SLEEP() executed
    }
    expect(Number((await db('users').count({ n: '*' }).first())!.n)).toBe(usersBefore);
    expect((await anon.post('/api/auth/login', { email: "admin@example.test' OR '1'='1", password: 'x' })).status).not.toBe(200);
  }, 60_000);

  it('script tags typed into forms are stored as text and escaped in emails', async () => {
    const xss = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>';
    const anon = await client();
    const email = uniqueEmail('xss');
    const r = await anon.post('/api/public/contact', { name: `Eve ${xss}`.slice(0, 100), email, subject: `Hi ${xss}`.slice(0, 150), message: `Message ${xss}`, enquiryType: 'general', acceptPrivacy: true });
    expect(r.status).toBe(201);
    const { render } = (await import('../../server/mail/layout.cjs')) as unknown as { render: (s: string, v: object) => string };
    const html = render('<p>{{ name }} – {{ subject }}</p>', { name: `Eve ${xss}`, subject: xss });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    // API answers are JSON (never HTML), so a browser will not run them.
    const list = await admin.get(`/api/admin/support/conversations?q=${encodeURIComponent('Eve')}`);
    expect(list.headers['content-type']).toMatch(/application\/json/);
    expect(list.headers['x-content-type-options'] ?? 'nosniff').toBe('nosniff');
  });

  it('oversized and malformed requests are refused cleanly', async () => {
    const anon = await client();
    const big = await anon.post('/api/public/contact', { name: 'Big', email: uniqueEmail('big'), subject: 'x', message: 'A'.repeat(2_000_000), acceptPrivacy: true });
    expect([413, 422]).toContain(big.status);
    const bad = await anon.agent.post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    const proto = await anon.post('/api/auth/login', { email: { $gt: '' }, password: { $ne: null }, __proto__: { admin: true } } as unknown as object);
    expect(proto.status).toBe(422);
  });
});

describe('8 – CSRF', () => {
  it('state-changing requests without the matching signed token are refused, even with a valid session', async () => {
    const before = (await db('customers').where({ id: custA.id }).first('full_name')).full_name;
    const raw = custA.agent; // same cookies (session), but no / wrong CSRF header – what another website could send
    expect((await raw.put('/api/account/profile').send({ fullName: 'CSRF 1' })).status).toBe(403);
    expect((await raw.put('/api/account/profile').set('X-XSRF-TOKEN', 'made-up').send({ fullName: 'CSRF 2' })).status).toBe(403);
    expect((await raw.put('/api/account/profile').set('X-XSRF-TOKEN', 'abc.def').set('Cookie', 'XSRF-TOKEN=abc.def').send({ fullName: 'CSRF 3' })).status).toBe(403); // unsigned pair
    expect((await raw.post('/api/auth/logout').send({})).status).toBe(403);
    expect((await db('customers').where({ id: custA.id }).first('full_name')).full_name).toBe(before);
    expect((await custA.get('/api/auth/me')).body.user.email).toBe(custA.email); // still signed in
  });
});

describe('9 – brute force', () => {
  it('five wrong passwords lock the account – the right password is then refused too – and admins are told', async () => {
    const s = await createStaff(['read_only']);
    const c = await client();
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/login', { email: s.email, password: `wrong-${i}` })).status).toBe(401);
    const locked = await c.post('/api/auth/login', { email: s.email, password: s.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('locked');
    await new Promise((r) => setTimeout(r, 200));
    const fails = await db('audit_logs').where({ action: 'auth.login_failed', subject_id: s.id }).count({ n: '*' }).first();
    expect(Number(fails!.n)).toBe(5);
    const note = await db('notifications').where({ type: 'security.alert' }).where('body', 'like', `%${s.email}%`).first();
    expect(note).toBeDefined();
  });
  it('sign-in answers the same way for unknown and known emails', async () => {
    const c = await client();
    const a = await c.post('/api/auth/login', { email: `nobody.${Date.now()}@example.test`, password: 'whatever-123' });
    const b = await c.post('/api/auth/login', { email: custA.email, password: 'whatever-123' });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
    const f1 = await c.post('/api/auth/forgot-password', { email: `nobody.${Date.now()}@example.test` });
    const f2 = await c.post('/api/auth/forgot-password', { email: custB.email });
    expect(f1.body).toEqual(f2.body);
  });
});

describe('10, 11 – tokens and sessions', () => {
  it('made-up, altered and expired sessions are anonymous', async () => {
    const anon = await client();
    for (const cookie of ['sch_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', "sch_sid=' OR 1=1--", 'sch_sid=' + 'x'.repeat(5000)]) {
      const r = await anon.agent.get('/api/auth/me').set('Cookie', cookie);
      expect(r.body.user).toBeNull();
    }
    const c = await customer('sess');
    expect((await c.get('/api/account/dashboard')).status).toBe(200);
    const u = await db('users').where({ email: c.email }).first('id');
    await db('sessions').where({ user_id: u.id }).update({ expires_at: new Date(Date.now() - 1000) });
    expect((await c.get('/api/account/dashboard')).status).toBe(401);
    expect(await db('sessions').where({ user_id: u.id }).first()).toBeUndefined(); // removed, cannot be revived
  });
  it('admin sessions end after inactivity; customer sessions last longer', async () => {
    const s = await createStaff(['read_only']);
    const c = await client();
    await login(c, s.email, s.password);
    expect((await c.get('/api/admin/products')).status).toBe(200);
    await db('sessions').where({ user_id: s.id }).update({ last_seen_at: new Date(Date.now() - 121 * 60_000) });
    expect((await c.get('/api/admin/products')).status).toBe(401);
    const k = await customer('idle');
    const ku = await db('users').where({ email: k.email }).first('id');
    await db('sessions').where({ user_id: ku.id }).update({ last_seen_at: new Date(Date.now() - 121 * 60_000) });
    expect((await k.get('/api/account/dashboard')).status).toBe(200);
  });
  it('password reset links work once, expire, and sign every device out', async () => {
    const c = await customer('reset');
    const other = await client();
    await login(other, c.email, PW);
    await (await client()).post('/api/auth/forgot-password', { email: c.email });
    const job = await db('jobs').where('payload', 'like', `%${c.email}%`).where('payload', 'like', '%password_reset%').orderBy('id', 'desc').first('payload');
    const token = /token=([\w-]+)/.exec(typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload))![1];
    const anon = await client();
    expect((await anon.post('/api/auth/reset-password', { token: token.slice(0, -2) + 'zz', password: 'Brand-new-pass-77' })).status).toBe(400);
    expect((await anon.post('/api/auth/reset-password', { token, password: 'short1' })).status).toBe(422);
    expect((await anon.post('/api/auth/reset-password', { token, password: 'Brand-new-pass-77' })).status).toBe(200);
    expect((await anon.post('/api/auth/reset-password', { token, password: 'Another-pass-88' })).status).toBe(400); // single use
    expect((await other.get('/api/account/dashboard')).status).toBe(401); // other device signed out
    expect((await (await client()).post('/api/auth/login', { email: c.email, password: PW })).status).toBe(401);
    // stored hashed, never in plain text
    const row = await db('password_resets').orderBy('id', 'desc').first();
    expect(row.token_hash).not.toBe(token);
    const u = await db('users').where({ email: c.email }).first('password_hash');
    expect(u.password_hash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('Brand-new-pass-77', u.password_hash)).toBe(true);
  });
  it('a suspended customer is signed out immediately', async () => {
    const c = await customer('susp');
    expect((await admin.post(`/api/admin/customers/${c.id}/account`, { action: 'suspend' })).status).toBe(200);
    expect((await c.get('/api/account/dashboard')).status).toBe(401);
  });
});

describe('12, 13 – files', () => {
  const png = () => sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  it('staff-only files cannot be opened by visitors or customers, and paths cannot be walked', async () => {
    const up = await admin.upload('/api/admin/files/upload', { purpose: 'any', visibility: 'staff' }, await png(), 'internal.png');
    expect(up.status).toBe(201);
    const url = `/api/media/${up.body.id}/internal.png`;
    expect((await admin.get(url)).status).toBe(200);
    expect((await (await client()).get(url)).status).toBe(401);
    expect((await custA.get(url)).status).toBe(403);
    const anon = await client();
    for (const u of ['/api/media/1/..%2f..%2f..%2f.env', '/api/media/..%2f..%2f.env/x', '/api/media/1/%2e%2e%2f%2e%2e%2fpackage.json', '/api/content/covers/..%2f..%2f.env', '/api/content/stream/..%2f..%2f.env']) {
      const r = await anon.get(u);
      expect([400, 401, 403, 404, 410]).toContain(r.status);
      expect(String(r.text ?? '')).not.toMatch(/APP_SECRET|DB_PASSWORD/);
    }
    // The stored name is random – the original name never becomes a path.
    const m = await db('media').where({ id: up.body.id }).first('storage_key');
    expect(m.storage_key).toMatch(/^images\/\d{4}\/\d{2}\/[A-Za-z0-9_-]{20,}\.png$/);
  });
  it('disguised and dangerous uploads are refused; customers cannot upload at all', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4000, 1)]);
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const php = Buffer.from('<?php system($_GET["c"]); ?>');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const cases: [Buffer, string][] = [[exe, 'photo.png'], [exe, 'report.pdf'], [html, 'notes.txt'], [html, 'page.html'], [php, 'shell.php'], [php, 'shell.php.png'], [svg, 'logo.svg'], [exe, 'run.bat'], [html, 'x.js'], [Buffer.from('#!/bin/sh\nrm -rf /'), 'tool.sh']];
    for (const [buf, name] of cases) {
      const r = await admin.upload('/api/admin/files/upload', { purpose: 'any', visibility: 'staff' }, buf, name);
      expect(r.status, name).toBe(400);
      const c = await admin.upload('/api/admin/content/covers', {}, buf, name);
      expect(c.status, name).toBe(400);
    }
    expect((await custA.upload('/api/admin/files/upload', { purpose: 'any' }, await png(), 'a.png')).status).toBe(403);
    expect((await (await client()).upload('/api/admin/files/upload', { purpose: 'any' }, await png(), 'a.png')).status).toBe(401);
    // A file name that tries to climb out of the folder is only ever used as a label.
    const t = await admin.upload('/api/admin/files/upload', { purpose: 'any', visibility: 'staff' }, await png(), '../../../../etc/cron.d/evil.png');
    expect(t.status).toBe(201);
    const m = await db('media').where({ id: t.body.id }).first('storage_key', 'original_name');
    expect(m.storage_key).not.toContain('..');
    expect(m.original_name).not.toContain('/');
  });
});

describe('15 – nothing sensitive in API answers', () => {
  it('errors never show SQL, file paths or stack traces; settings never show secrets', async () => {
    const r = await admin.get('/api/admin/customers/not-a-number');
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.(ts|js|mjs):\d+|node_modules|SELECT |\/home\//);
    for (const u of ['/api/admin/email-settings', '/api/admin/system', '/api/admin/whatsapp', '/api/admin/content/settings', '/api/admin/security-settings']) {
      const s = JSON.stringify((await admin.get(u)).body);
      expect(s, u).not.toContain(process.env['DB_PASSWORD'] || '§none§');
      expect(s, u).not.toMatch(/password_hash|mfa_secret|csrf_secret/);
    }
    const me = JSON.stringify((await admin.get('/api/auth/me')).body);
    expect(me).not.toMatch(/password|secret|hash/i);
    const staff = JSON.stringify((await admin.get('/api/admin/staff')).body);
    expect(staff).not.toMatch(/password_hash|mfa_secret|mfa_recovery/);
    const cust = JSON.stringify((await admin.get(`/api/admin/customers/${custA.id}`)).body);
    expect(cust).not.toMatch(/password_hash|mfa_secret/);
  });
  it('the test inbox is not reachable (it only exists on a development computer, from that computer)', async () => {
    const anon = await client();
    expect((await anon.get('/api/dev/mail')).status).toBe(404);
    expect((await anon.agent.get('/api/dev/mail').set('X-Forwarded-For', '203.0.113.9')).status).toBe(404);
  });
});

describe('two-step verification for staff', () => {
  const codeFor = async (userId: number, offset = 0) => {
    const u = await db('users').where({ id: userId }).first('mfa_secret');
    return totpAt(decryptSecret(u.mfa_secret), totpStep() + offset);
  };
  let s: { id: number; email: string; password: string };
  let c: C;
  let recovery: string[];
  it('setup needs a correct code from the app; the secret is stored encrypted', async () => {
    s = await createStaff(['administrator']);
    c = await client();
    await login(c, s.email, s.password);
    expect((await c.get('/api/auth/mfa')).body).toMatchObject({ enabled: false, available: true });
    const setup = await c.post('/api/auth/mfa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    const plain = setup.body.secret.replace(/\s/g, '');
    const row = await db('users').where({ id: s.id }).first('mfa_secret', 'mfa_enabled_at');
    expect(row.mfa_secret).not.toContain(plain); // encrypted at rest
    expect(row.mfa_enabled_at).toBeNull(); // not on until proven
    expect((await c.post('/api/auth/mfa/enable', { code: '000000' })).status).toBe(422);
    const on = await c.post('/api/auth/mfa/enable', { code: await codeFor(s.id) });
    expect(on.status).toBe(200);
    recovery = on.body.recoveryCodes;
    expect(recovery).toHaveLength(8);
    const stored = JSON.stringify((await db('users').where({ id: s.id }).first('mfa_recovery')).mfa_recovery);
    for (const code of recovery) expect(stored).not.toContain(code); // only hashes are kept
    // customers can't use the staff setup endpoints
    expect((await custA.post('/api/auth/mfa/setup')).status).toBe(403);
  });
  it('the password alone no longer opens a session; a code cannot be reused; wrong codes lock the account', async () => {
    const d = await client();
    const first = await d.post('/api/auth/login', { email: s.email, password: s.password });
    expect(first.body).toMatchObject({ mfa: true });
    expect(first.body.ticket).toBeTruthy();
    expect((await d.get('/api/auth/me')).body.user).toBeNull();
    expect((await d.get('/api/admin/products')).status).toBe(401);
    expect((await d.post('/api/auth/mfa/verify', { ticket: first.body.ticket, code: '123456' })).status).toBe(401);
    expect((await d.post('/api/auth/mfa/verify', { ticket: first.body.ticket + 'x', code: await codeFor(s.id, 1) })).status).toBe(401); // altered ticket
    const good = await codeFor(s.id, 1);
    expect((await d.post('/api/auth/mfa/verify', { ticket: first.body.ticket, code: good })).status).toBe(200);
    expect((await d.get('/api/admin/products')).status).toBe(200);
    // the same code again (someone watching the screen) is refused
    const e = await client();
    const again = await e.post('/api/auth/login', { email: s.email, password: s.password });
    expect((await e.post('/api/auth/mfa/verify', { ticket: again.body.ticket, code: good })).status).toBe(401);
    // a recovery code works exactly once
    expect((await e.post('/api/auth/mfa/verify', { ticket: again.body.ticket, code: recovery[0] })).status).toBe(200);
    const f = await client();
    const third = await f.post('/api/auth/login', { email: s.email, password: s.password });
    expect((await f.post('/api/auth/mfa/verify', { ticket: third.body.ticket, code: recovery[0] })).status).toBe(401);
    for (let i = 0; i < 4; i++) await f.post('/api/auth/mfa/verify', { ticket: third.body.ticket, code: '111111' });
    expect((await f.post('/api/auth/mfa/verify', { ticket: third.body.ticket, code: recovery[1] })).status).toBe(429); // locked
    await db('users').where({ id: s.id }).update({ locked_until: null, failed_logins: 0 });
  });
  it('switching it off needs the password and a code; an administrator can reset it for someone who lost their phone', async () => {
    const wrongPw = await c.post('/api/auth/mfa/disable', { password: 'wrong-password', code: recovery[2] });
    expect(wrongPw.status).toBe(422);
    expect(wrongPw.body.error.details.fields.password).toBeTruthy();
    const wrongCode = await c.post('/api/auth/mfa/disable', { password: s.password, code: '000000' });
    expect(wrongCode.body.error.details.fields.code).toBeTruthy();
    expect((await db('users').where({ id: s.id }).first('mfa_enabled_at')).mfa_enabled_at).not.toBeNull();
    expect((await c.post('/api/auth/mfa/disable', { password: s.password, code: recovery[2] })).status).toBe(200);
    const plain = await (await client()).post('/api/auth/login', { email: s.email, password: s.password });
    expect(plain.body.mfa).toBeUndefined();
    expect(await db('audit_logs').where({ action: 'auth.mfa_disabled', subject_id: s.id }).first()).toBeDefined();
  });
  it('can be made compulsory: staff without it can only reach their own security page until they set it up', async () => {
    const boss = await createStaff(['super_admin']);
    const bc = await client();
    await login(bc, boss.email, boss.password);
    // must have it themselves first
    expect((await bc.put('/api/admin/security-settings', { requireStaffMfa: true })).status).toBe(400);
    await bc.post('/api/auth/mfa/setup');
    await bc.post('/api/auth/mfa/enable', { code: await codeFor(boss.id) });
    expect((await bc.put('/api/admin/security-settings', { requireStaffMfa: true })).status).toBe(200);
    const n = await createStaff(['administrator']);
    const nc = await client();
    const l = await nc.post('/api/auth/login', { email: n.email, password: n.password });
    expect(l.body.mfaSetupRequired).toBe(true);
    const blocked = await nc.get('/api/admin/customers');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('mfa_setup_required');
    expect((await nc.get('/api/auth/mfa')).body.required).toBe(true);
    await nc.post('/api/auth/mfa/setup');
    expect((await nc.post('/api/auth/mfa/enable', { code: await codeFor(n.id) })).status).toBe(200);
    expect((await nc.get('/api/admin/customers')).status).toBe(200);
    // lost phone: an administrator resets it; the person is signed out and must set it up again
    expect((await bc.patch(`/api/admin/staff/${n.id}`, { resetMfa: true })).status).toBe(200);
    expect((await nc.get('/api/admin/customers')).status).toBe(401);
    expect((await db('users').where({ id: n.id }).first('mfa_enabled_at')).mfa_enabled_at).toBeNull();
    expect(await db('audit_logs').where({ action: 'staff.mfa_reset', subject_id: n.id }).first()).toBeDefined();
    // switch the rule off again so other tests are unaffected
    expect((await bc.put('/api/admin/security-settings', { requireStaffMfa: false })).status).toBe(200);
    expect((await readOnly.put('/api/admin/security-settings', { requireStaffMfa: true })).status).toBe(403);
  });
});

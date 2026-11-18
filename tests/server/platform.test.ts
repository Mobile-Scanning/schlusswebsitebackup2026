import { createPublicKey, verify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, login, uniqueEmail, register } from './helpers';

afterAll(() => db.destroy());

type C = Awaited<ReturnType<typeof client>>;
const reg = (name = 'Demo Tester') => ({ name, email: uniqueEmail('demo'), cellphone: '+27 82 000 0000', company: '', country: 'za', password: 'Puzzle-piece-42', acceptPrivacy: true, marketingOptIn: false });
const exe = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 7)]);

let admin: C;
let productId: number;
let slug: string;

async function customer(name?: string) {
  const c = await client();
  const r = reg(name);
  expect((await register(c, r)).status).toBe(201);
  return Object.assign(c, { email: r.email, password: r.password });
}

beforeAll(async () => {
  const s = await createStaff(['super_admin']);
  admin = await client();
  await login(admin, s.email, s.password);
  slug = `demo-test-${Date.now()}`;
  [productId] = await db('products').insert({ name: 'Demo Test Product', slug, short_description: 'x', status: 'available', is_published: true });
});

describe('demo files (admin)', () => {
  it('accepts a real installer and rejects disguised or unsupported files', async () => {
    const bad = await admin.upload('/api/admin/files/upload', { purpose: 'demo' }, Buffer.from('<html><script>alert(1)</script>'), 'setup.exe');
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/don't match/);
  });

  it('sets up a demo version with a file and demo settings', async () => {
    const html = await admin.upload('/api/admin/files/upload', { purpose: 'demo' }, Buffer.from('<html></html>'), 'page.html');
    expect(html.status).toBe(400);
    const up = await admin.upload('/api/admin/files/upload', { purpose: 'demo' }, exe(), 'DemoSetup.exe');
    expect(up.status).toBe(201);
    expect((await db('media').where({ id: up.body.id }).first()).visibility).toBe('staff');

    let r = await admin.post(`/api/admin/products/${productId}/demo/versions`, { version: '1.0', description: 'First demo', instructions: 'Run DemoSetup.exe', status: 'released' });
    expect(r.status).toBe(201);
    const vid = r.body.versions[0].id;
    r = await admin.post(`/api/admin/demo-versions/${vid}/files`, { mediaId: up.body.id, platform: 'windows', label: 'Windows installer' });
    expect(r.status).toBe(201);
    expect(r.body.live).toBe(false); // not offered until switched on
    r = await admin.put(`/api/admin/products/${productId}/demo/settings`, { available: true, days: 7, startOn: 'activation', maxDevices: 1, offlineDays: 3 });
    expect(r.status).toBe(200);
    expect(r.body.live).toBe(true);
    expect(r.body.settings).toMatchObject({ days: 7, startOn: 'activation' });

    const pub = await admin.get(`/api/public/products/${slug}`);
    expect(pub.body.demo).toMatchObject({ days: 7, startOn: 'activation', version: '1.0' });
    expect(JSON.stringify(pub.body.demo)).not.toContain('storage');
  });
});

let key = '';
describe('customer demo download', () => {
  it('requires sign-in, terms and business details; creates one demo record; link is personal and short-lived', async () => {
    const anon = await client();
    expect((await anon.post(`/api/account/demos/${slug}/download`, { fileId: 1, acceptTerms: true })).status).toBe(401);

    const c = await customer('Thandi Demo');
    const prep = await c.get(`/api/account/demos/${slug}`);
    expect(prep.status).toBe(200);
    expect(prep.body.missing).toEqual(['company']);
    const fileId = prep.body.demo.files[0].id;

    expect((await c.post(`/api/account/demos/${slug}/download`, { fileId })).status).toBe(422); // no terms
    const noProfile = await c.post(`/api/account/demos/${slug}/download`, { fileId, acceptTerms: true });
    expect(noProfile.body.error.details?.fields?.['profile.company'], JSON.stringify(noProfile.body)).toBeTruthy();

    const d = await c.post(`/api/account/demos/${slug}/download`, { fileId, acceptTerms: true, profile: { company: 'Nkosi Retail', cellphone: '+27 82 123 4567', province: 'Gauteng', businessType: 'Retail' } });
    expect(d.status).toBe(201);
    expect(d.body.demo.status).toBe('awaiting_activation'); // activation rule: clock not started yet
    expect(d.body.demo.expiresAt).toBeNull();
    key = d.body.demo.licenceKey;

    const file = await c.agent.get(d.body.url).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (x: Buffer) => ch.push(x)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('attachment');
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('MZ');

    const other = await customer('Someone Else');
    expect((await other.get(d.body.url)).status).toBe(401);
    expect((await anon.get(d.body.url.replace(/.$/, 'x'))).status).toBe(410);

    // profile saved – second download needs no details and creates no second demo
    const again = await c.post(`/api/account/demos/${slug}/download`, { fileId, acceptTerms: true });
    expect(again.status).toBe(201);
    expect(again.body.demo.licenceKey).toBe(key);
    const cust = await db('customers').where({ email: c.email }).first();
    expect(cust).toMatchObject({ company: 'Nkosi Retail', province: 'Gauteng', business_type: 'Retail' });
    expect(await db('licences').where({ customer_id: cust.id, type: 'trial' })).toHaveLength(1);
    expect(await db('downloads').where({ customer_id: cust.id })).toHaveLength(2);
    expect(await db('consents').where({ email: c.email, purpose: 'demo_terms' })).toHaveLength(2);
  });
});

describe('central licensing', () => {
  const dev = (id = 'device-0001-abcdef-xyz') => ({ licenceKey: key, product: slug, deviceId: id, deviceName: 'Till 1', platform: 'windows', appVersion: '1.0' });

  it('activation starts the demo clock on the server and returns a token signed with the public key', async () => {
    const c = await client();
    const r = await c.post('/api/licensing/activate', dev());
    expect(r.status).toBe(200);
    const days = (new Date(r.body.expiresAt).getTime() - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(7);
    expect(new Date(r.body.validUntil).getTime()).toBeLessThanOrEqual(Date.now() + 3 * 86400000 + 5000); // offline grace 3 days
    const pem = (await c.get('/api/licensing/public-key')).text;
    const [body, sig] = r.body.token.split('.');
    expect(verify(null, Buffer.from(body), createPublicKey(pem), Buffer.from(sig, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(body, 'base64url').toString()).licenceKey).toBe(key);

    // re-activating the same device keeps the same dates
    const again = await c.post('/api/licensing/activate', dev());
    expect(again.body.expiresAt).toBe(r.body.expiresAt);
  });

  it('enforces device limit, product match and admin revocation', async () => {
    const c = await client();
    expect((await c.post('/api/licensing/activate', dev('another-device-99999'))).body.error.code).toBe('device_limit');
    expect((await c.post('/api/licensing/activate', { ...dev(), product: 'other-product' })).status).toBe(404);
    expect((await c.post('/api/licensing/validate', dev())).status).toBe(200);
    const lic = await db('licences').where({ licence_key: key }).first();
    expect(lic.activated_at).toBeTruthy();

    const rec = await admin.get(`/api/admin/demos/${lic.id}`);
    expect(rec.body.status).toMatch(/^(active|expiring_soon)$/);
    expect(rec.body.activations).toHaveLength(1);
    expect(rec.body.downloads.length).toBeGreaterThanOrEqual(2);
    expect((await admin.post(`/api/admin/demos/${lic.id}/action`, { action: 'suspend', reason: 'Testing' })).body.status).toBe('suspended');
    expect((await c.post('/api/licensing/validate', dev())).body.error.code).toBe('licence_suspended');
    expect((await admin.post(`/api/admin/demos/${lic.id}/action`, { action: 'reinstate', reason: 'Testing' })).body.status).toMatch(/^(active|expiring_soon)$/);
  });
});

describe('expiry notifications', () => {
  it('sends each milestone once to admins and the customer', async () => {
    const lic = await db('licences').where({ licence_key: key }).first();
    await db('licences').where({ id: lic.id }).update({ expires_at: db.raw('DATE_ADD(UTC_TIMESTAMP(), INTERVAL 50 HOUR)') });
    const r1 = await admin.post('/api/admin/demos/run-checks');
    expect(r1.status).toBe(200);
    const notices = await db('demo_notices').where({ licence_id: lic.id });
    expect(notices.map((n) => n.audience).sort()).toEqual(['admin', 'customer']);
    expect(notices.every((n) => n.milestone === 3)).toBe(true);
    await admin.post('/api/admin/demos/run-checks');
    expect(await db('demo_notices').where({ licence_id: lic.id })).toHaveLength(2); // no duplicates
    const cust = await db('customers').where({ id: lic.customer_id }).first('user_id', 'email');
    expect(await db('notifications').where({ user_id: cust.user_id, type: 'demo.expiry' })).toHaveLength(1);
    expect(await db('email_logs').where({ to_email: cust.email, template_key: 'demo_expiring' })).toHaveLength(1);
    const staffNote = await admin.get('/api/notifications');
    // v7: the admin milestone becomes a potential lead for SUPPORT (never sales)
    const lead = await db('leads').where({ licence_id: lic.id }).first();
    expect(lead).toMatchObject({ source: 'demo_expiry', status: 'new' });
    expect(staffNote.body.data.some((n: { link: string }) => n.link === `/admin/leads/${lead.id}`)).toBe(true);
    const leadMail = await db('email_logs').where({ template_key: 'lead_new' }).orderBy('id', 'desc').first();
    expect(leadMail.to_email).toBe('support@schluss.co.za');
    expect(await db('email_logs').where({ template_key: 'lead_new', to_email: 'sales@schluss.co.za' })).toHaveLength(0);

    // expired → status changes centrally, one "expired" notice
    await db('licences').where({ id: lic.id }).update({ expires_at: db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)') });
    await admin.post('/api/admin/demos/run-checks');
    expect((await db('licences').where({ id: lic.id }).first()).status).toBe('expired');
    expect(await db('demo_notices').where({ licence_id: lic.id, milestone: -1 })).toHaveLength(2);
    const c = await client();
    expect((await c.post('/api/licensing/validate', { licenceKey: key, product: slug, deviceId: 'device-0001-abcdef-xyz' })).body.error.code).toBe('licence_expired');
  });
});

describe('support chat', () => {
  it('visitor → admin reply → visitor sees it; internal notes stay private; others see nothing', async () => {
    const v = await client();
    expect((await v.post('/api/support/conversations', { message: 'Hi', name: 'Vee', email: uniqueEmail('v') })).status).toBe(422); // consent needed
    expect((await v.post('/api/support/conversations', { message: 'Hi', name: 'Vee', email: uniqueEmail('v'), consent: true, website: 'spam' })).status).toBe(422); // honeypot
    const cat = await db('support_categories').where({ slug: 'technical-support' }).first();
    const start = await v.post('/api/support/conversations', { message: 'How do I install the demo?', name: 'Vee Visitor', email: uniqueEmail('v'), consent: true, categoryId: cat.id, product: slug });
    expect(start.status).toBe(201);
    const ref = start.body.reference;
    const t = await db('tickets').where({ reference: ref }).first();
    expect(t).toMatchObject({ channel: 'chat', status: 'new', priority: 'high', admin_unread: 1 });

    const inbox = await admin.get('/api/admin/support/conversations?view=unread');
    expect(inbox.body.data.some((x: { reference: string }) => x.reference === ref)).toBe(true);
    const open = await admin.get(`/api/admin/support/conversations/${t.id}`);
    // customer message + the clearly-labelled automated assistant answer
    expect(open.body.messages.map((m: { author_kind: string }) => m.author_kind)).toEqual(['visitor', 'bot']);
    expect(open.body.visitor_token_hash).toBeUndefined();

    expect((await admin.post(`/api/admin/support/conversations/${t.id}/messages`, { body: 'Internal: check licence', internal: true })).status).toBe(201);
    expect((await admin.post(`/api/admin/support/conversations/${t.id}/messages`, { body: 'Run the installer as administrator.' })).status).toBe(201);
    expect((await v.get('/api/support/unread')).body.unread).toBe(1);
    const thread = await v.get(`/api/support/conversations/${ref}`);
    const human = thread.body.messages.filter((m: { from: string }) => ['me', 'staff'].includes(m.from));
    expect(human.map((m: { body: string }) => m.body)).toEqual(['How do I install the demo?', 'Run the installer as administrator.']);
    expect(thread.body.messages.find((m: { from: string }) => m.from === 'bot').author).toBe('SCHLUSS Assistant (automated)');
    expect(thread.body.humanJoined).toBe(true);
    expect(JSON.stringify(thread.body)).not.toContain('Internal');
    expect((await v.get('/api/support/unread')).body.unread).toBe(0);

    expect((await v.post(`/api/support/conversations/${ref}/messages`, { body: 'Thanks, that worked' })).status).toBe(201);
    expect((await db('tickets').where({ id: t.id }).first()).status).toBe('awaiting_admin');

    const stranger = await client();
    expect((await stranger.get(`/api/support/conversations/${ref}`)).status).toBe(404);
    const cust = await customer();
    expect((await cust.get(`/api/support/conversations/${ref}`)).status).toBe(404);
    expect((await cust.get('/api/admin/support/conversations')).status).toBe(403);

    // categories and assignment
    expect((await admin.patch(`/api/admin/support/conversations/${t.id}`, { status: 'resolved', priority: 'normal' })).status).toBe(200);
    expect((await admin.post('/api/admin/support/categories', { name: 'Hardware' })).status).toBe(201);
  });

  it('signed-in customers keep their conversations on every device', async () => {
    const c = await customer('Chat Customer');
    const r = await c.post('/api/support/conversations', { message: 'Pricing question' });
    expect(r.status).toBe(201);
    const second = await client();
    await login(second, c.email, c.password);
    expect((await second.get('/api/support/conversations')).body.map((x: { reference: string }) => x.reference)).toContain(r.body.reference);
  });
});

describe('setup steps, dashboard and packages', () => {
  it('customer sees steps with mixed media and progress follows them', async () => {
    let r = await admin.post(`/api/admin/products/${productId}/steps`, { title: 'Download your product', items: [{ kind: 'demo_download' }, { kind: 'link', url: 'https://example.com/guide', title: 'Online guide' }] });
    expect(r.status).toBe(201);
    expect((await admin.post(`/api/admin/products/${productId}/steps`, { title: 'Bad', items: [{ kind: 'link', url: 'http://insecure' }] })).status).toBe(422);
    r = await admin.post(`/api/admin/products/${productId}/steps`, { title: 'Install', body: 'Run the installer' });
    const [s1, s2] = r.body;

    const c = await customer();
    const page = await c.get(`/api/account/products/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body.steps.map((s: { title: string }) => s.title)).toEqual(['Download your product', 'Install']);
    expect(page.body.steps[0].items.map((i: { kind: string }) => i.kind)).toEqual(['demo_download', 'link']);
    expect((await c.post(`/api/account/steps/${s1.id}/progress`, { done: true })).status).toBe(200);

    const other = await client();
    await login(other, c.email, c.password);
    const p2 = await other.get(`/api/account/products/${slug}`);
    expect(p2.body.steps[0].completedAt).toBeTruthy();
    expect(p2.body.steps[1].completedAt).toBeNull();

    // removing a completed step archives it (history kept)
    expect((await admin.del(`/api/admin/steps/${s1.id}`)).status).toBe(200);
    expect((await db('product_setup_steps').where({ id: s1.id }).first()).is_archived).toBe(1);
    expect(s2).toBeTruthy();
  });

  it('a package converts a demo only with an explicit admin action', async () => {
    const lic = await db('licences').where({ licence_key: key }).first();
    const bad = await admin.post(`/api/admin/customers/${lic.customer_id}/packages`, { productId, type: 'perpetual', startsAt: '2026-11-13', convertDemo: true });
    expect(bad.status).toBe(422);
    const ok = await admin.post(`/api/admin/customers/${lic.customer_id}/packages`, { productId, type: 'perpetual', startsAt: '2026-11-13', convertDemo: true, confirmPayment: true });
    expect(ok.status).toBe(201);
    const after = await db('licences').where({ id: lic.id }).first();
    expect(after.converted_at).toBeTruthy();
    const list = await admin.get(`/api/admin/customers?demo=converted`);
    expect(list.body.data.some((x: { id: number }) => x.id === lic.customer_id)).toBe(true);
    const detail = await admin.get(`/api/admin/customers/${lic.customer_id}`);
    expect(detail.body.packages).toHaveLength(1);
    expect(detail.body.demos[0].status).toBe('converted');
    expect(detail.body.customer.password_hash).toBeUndefined();
    const sum = await admin.get('/api/admin/demos/summary');
    expect(sum.body.kpis.converted).toBeGreaterThanOrEqual(1);
    expect((await admin.get('/api/admin/overview')).status).toBe(200);
  });

  it('customers only ever see their own dashboard data', async () => {
    const c = await customer();
    const d = await c.get('/api/account/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.products).toHaveLength(0);
    expect((await c.get('/api/admin/customers')).status).toBe(403);
    expect((await c.get('/api/admin/demos')).status).toBe(403);
  });
});

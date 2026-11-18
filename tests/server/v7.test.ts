import { createHmac } from 'node:crypto';
import { createServer, get as httpGet, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, lastOtp, login, makeApp, register, uniqueEmail } from './helpers';

type C = Awaited<ReturnType<typeof client>>;
const reg = (extra: Record<string, unknown> = {}) => ({ name: 'Otto Tester', email: uniqueEmail('otp'), cellphone: '', company: 'Otto Traders', country: 'za', password: 'Puzzle-piece-42', confirmPassword: 'Puzzle-piece-42', acceptPrivacy: true, marketingOptIn: false, ...extra });
const exe = (fill: number) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, fill)]);

let admin: C;
let support: C;
let sales: C;
let productId: number;
let slug: string;
let otherSlug: string;

beforeAll(async () => {
  const [a, s, sa] = await Promise.all([createStaff(['super_admin']), createStaff(['support_agent']), createStaff(['sales_agent'])]);
  admin = await client();
  support = await client();
  sales = await client();
  await login(admin, a.email, a.password);
  await login(support, s.email, s.password);
  await login(sales, sa.email, sa.password);
  slug = `v7-${Date.now()}`;
  otherSlug = `v7-other-${Date.now()}`;
  [productId] = await db('products').insert({ name: 'V7 Product', slug, short_description: 'x', status: 'available', is_published: true, trial_days: 14, demo_options: JSON.stringify({ downloadable: true }) });
  await db('products').insert({ name: 'Other Product', slug: otherSlug, short_description: 'y', status: 'available', is_published: true });
});
afterAll(() => db.destroy());

/* ------------------------------------------------------------------ OTP */
describe('email verification (OTP)', () => {
  it('registration creates an unverified account, no session, and emails a hashed 6-digit code', async () => {
    const c = await client();
    const input = reg();
    const r = await c.post('/api/auth/register', input);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ verify: true, email: input.email, minutes: 5 });
    expect((await c.get('/api/auth/me')).body.user).toBeNull();
    const user = await db('users').where({ email: input.email }).first();
    expect(user.email_verified_at).toBeNull();
    const code = await lastOtp(input.email);
    expect(code).toMatch(/^\d{6}$/);
    const row = await db('email_otps').where({ user_id: user.id }).first();
    expect(row.code_hash).not.toContain(code); // stored hashed only
    // business record created from the company name
    const cust = await db('customers').where({ user_id: user.id }).first();
    expect((await db('businesses').where({ id: cust.business_id }).first()).name).toBe('Otto Traders');
  });

  it('unverified accounts cannot sign in, reach the portal or download', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const l = await c.post('/api/auth/login', { email: input.email, password: input.password });
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe('email_unverified');
    expect((await c.get('/api/account/dashboard')).status).toBe(401);
    expect((await c.post(`/api/account/demos/${slug}/download`, { fileId: 1 })).status).toBe(401);
  });

  it('rejects wrong codes, limits attempts, and accepts the right code once', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const code = await lastOtp(input.email);
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await c.post('/api/auth/verify-email', { email: input.email, code: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_code');
    const ok = await c.post('/api/auth/verify-email', { email: input.email, code });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user.email).toBe(input.email);
    // single use
    const again = await (await client()).post('/api/auth/verify-email', { email: input.email, code });
    expect(again.status).toBe(400);
    expect(await db('email_logs').where({ to_email: input.email, template_key: 'welcome_customer' })).toHaveLength(1);
  });

  it('locks the code after 5 wrong attempts', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const code = await lastOtp(input.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await c.post('/api/auth/verify-email', { email: input.email, code: wrong });
    const r = await c.post('/api/auth/verify-email', { email: input.email, code });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('too_many_attempts');
  });

  it('expired codes are refused', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const code = await lastOtp(input.email);
    const u = await db('users').where({ email: input.email }).first('id');
    await db('email_otps').where({ user_id: u.id }).update({ expires_at: new Date(Date.now() - 1000) });
    const r = await c.post('/api/auth/verify-email', { email: input.email, code });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('code_expired');
  });

  it('resend has a cooldown and invalidates the previous code', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const first = await lastOtp(input.email);
    const tooSoon = await c.post('/api/auth/resend-otp', { email: input.email });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('cooldown');
    const u = await db('users').where({ email: input.email }).first('id');
    await db('email_otps').where({ user_id: u.id }).update({ created_at: new Date(Date.now() - 120_000) });
    expect((await c.post('/api/auth/resend-otp', { email: input.email })).status).toBe(200);
    const second = await lastOtp(input.email);
    if (first !== second) expect((await c.post('/api/auth/verify-email', { email: input.email, code: first })).status).toBe(400);
    expect((await c.post('/api/auth/verify-email', { email: input.email, code: second })).status).toBe(200);
    // resend for unknown emails looks the same (no account enumeration)
    expect((await c.post('/api/auth/resend-otp', { email: uniqueEmail('ghost') })).status).toBe(200);
  });

  it('duplicate registration is refused; password reset only for verified emails', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const dup = await (await client()).post('/api/auth/register', input);
    expect(dup.status).toBe(409);
    await c.post('/api/auth/forgot-password', { email: input.email });
    expect(await db('email_logs').where({ to_email: input.email, template_key: 'password_reset' })).toHaveLength(0);
  });

  it('the worker never keeps the code after sending', async () => {
    const { execFileSync } = await import('node:child_process');
    const input = reg();
    await (await client()).post('/api/auth/register', input);
    execFileSync('node', ['server/cli/worker.cjs', '--once'], { env: { ...process.env, NODE_ENV: 'test' }, stdio: 'ignore' });
    const log = await db('email_logs').where({ to_email: input.email, template_key: 'email_otp' }).first('job_id');
    const job = await db('jobs').where({ id: log.job_id }).first('payload', 'status');
    expect(JSON.stringify(job.payload)).not.toMatch(/"code":"\d{6}"/);
  });
});

/* ------------------------------------------------------------------ routing */
describe('department routing', () => {
  it('chat: technical/general → support only; purchase → sales enquiry', async () => {
    const v = await client();
    const t = await v.post('/api/support/conversations', { message: 'I want to buy it but the installer fails with an error', name: 'Ann', email: uniqueEmail('ann'), consent: true, enquiryType: 'technical', product: slug });
    expect(t.status).toBe(201);
    expect(t.body.department).toBe('support');
    expect(await db('quote_requests').where({ ticket_id: (await db('tickets').where({ reference: t.body.reference }).first('id')).id })).toHaveLength(0);
    const supportMail = await db('email_logs').where({ template_key: 'support_enquiry' }).orderBy('id', 'desc').first();
    expect(supportMail.to_email).toBe('support@schluss.co.za');

    const p = await v.post('/api/support/conversations', { message: 'Please quote 5 licences', name: 'Ben', email: uniqueEmail('ben'), consent: true, enquiryType: 'purchase', quantity: 5, product: slug });
    expect(p.body.department).toBe('sales');
    const tk = await db('tickets').where({ reference: p.body.reference }).first('id');
    const q = await db('quote_requests').where({ ticket_id: tk.id }).first();
    expect(q).toMatchObject({ kind: 'purchase', source: 'chat', quantity: 5, product_id: productId });
    // The enquiry is still filed under Sales in the admin; its notification email goes to the inbox chosen in
    // Admin › Email settings for purchases (support by default since v10.2).
    expect((await db('email_logs').where({ template_key: 'sales_enquiry' }).orderBy('id', 'desc').first()).to_email).toBe('support@schluss.co.za');
  });

  it('no enquiry type defaults to support (never sales)', async () => {
    const r = await (await client()).post('/api/support/conversations', { message: 'What does it cost to purchase?', name: 'Cy', email: uniqueEmail('cy'), consent: true });
    expect(r.body.department).toBe('support');
  });

  it('contact form routes by the chosen type; purchase-enquiry form goes to sales', async () => {
    const c = await client();
    const base = { name: 'Dee', email: uniqueEmail('dee'), subject: 'Hello there', message: 'I would like to purchase but need help first', acceptPrivacy: true };
    const s = await c.post('/api/public/contact', { ...base, enquiryType: 'general' });
    expect(s.body.department).toBe('support');
    const p = await c.post('/api/public/contact', { ...base, enquiryType: 'purchase', product: slug });
    expect(p.body.department).toBe('sales');
    const e = await c.post('/api/public/purchase-enquiry', { name: 'Eve', email: uniqueEmail('eve'), product: slug, quantity: 3, message: 'Quote please', acceptPrivacy: true });
    expect(e.status).toBe(201);
    const q = await db('quote_requests').where({ reference: e.body.reference }).first();
    expect(q).toMatchObject({ source: 'product_page', quantity: 3 });
  });

  it('sales agents see sales enquiries but not the support inbox or leads; support agents the opposite', async () => {
    expect((await sales.get('/api/admin/sales')).status).toBe(200);
    expect((await sales.get('/api/admin/leads')).status).toBe(403);
    expect((await sales.get('/api/admin/support/conversations')).status).toBe(403);
    expect((await support.get('/api/admin/sales')).status).toBe(403);
    expect((await support.get('/api/admin/leads')).status).toBe(200);
    expect((await support.get('/api/admin/support/conversations')).status).toBe(200);
    expect((await support.put('/api/admin/whatsapp', {})).status).toBe(403);
    expect((await support.get('/api/admin/email-settings')).status).toBe(403);
  });
});

/* ------------------------------------------------------------------ leads */
describe('potential leads', () => {
  it('support records attempts and feedback; explicit purchase creates a separate sales enquiry', async () => {
    const c = await client();
    const input = reg();
    await register(c, input);
    const cust = await db('customers as c').join('users as u', 'u.id', 'c.user_id').where('u.email', input.email).first('c.id');
    const created = await support.post('/api/admin/leads', { customerId: cust.id, productId, note: 'Asked about demo' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const call = await support.post(`/api/admin/leads/${id}/activities`, { kind: 'call', outcome: 'No answer', body: 'Tried cellphone' });
    expect(call.body).toMatchObject({ status: 'contacted', contact_attempts: 1 });
    await support.post(`/api/admin/leads/${id}/activities`, { kind: 'feedback', body: 'Likes the product' });
    expect((await support.patch(`/api/admin/leads/${id}`, { status: 'interested' })).body.status).toBe('interested');
    const noConfirm = await support.post(`/api/admin/leads/${id}/sales-enquiry`, { quantity: 2, message: 'Wants 2 licences' });
    expect(noConfirm.status).toBe(422);
    const r = await support.post(`/api/admin/leads/${id}/sales-enquiry`, { quantity: 2, message: 'Wants 2 licences', confirmed: true });
    expect(r.status).toBe(201);
    expect(r.body.sales).toHaveLength(1);
    expect(r.body.activities.length).toBeGreaterThanOrEqual(4);
    const q = await db('quote_requests').where({ lead_id: id }).first();
    expect(q).toMatchObject({ source: 'lead', quantity: 2 });
    // sales can open it, then winning it converts the lead
    expect((await sales.get(`/api/admin/sales/${q.id}`)).status).toBe(200);
    expect((await sales.patch(`/api/admin/sales/${q.id}`, { status: 'won', note: 'Paid' })).status).toBe(200);
    expect((await db('leads').where({ id }).first()).status).toBe('converted');
    // customers never see leads or sales
    expect((await c.get('/api/admin/leads')).status).toBe(403);
    expect((await c.get('/api/admin/sales')).status).toBe(403);
  });
});

/* ------------------------------------------------------------------ installers */
describe('full installer vs demo', () => {
  let demoFileId: number;
  let fullFileId: number;
  it('admin uploads a demo .exe and a separate full .exe', async () => {
    const up = async (fill: number, name: string) => (await admin.upload('/api/admin/files/upload', { purpose: 'demo' }, exe(fill), name)).body;
    const d = await up(1, 'v7-demo-setup.exe');
    const f = await up(2, 'v7-full-setup.exe');
    expect(d.id).toBeTruthy();
    const dv = await admin.post(`/api/admin/products/${productId}/demo/versions`, { version: '1.0.0', status: 'released', instructions: 'Run the demo setup' });
    expect(dv.status).toBe(201);
    expect((await admin.post(`/api/admin/demo-versions/${dv.body.versions[0].id}/files`, { mediaId: d.id, platform: 'windows', label: 'Demo installer' })).status).toBe(201);
    expect((await admin.put(`/api/admin/products/${productId}/demo/settings`, { available: true, days: 14, startOn: 'download', maxDevices: 1, offlineDays: 3 })).status).toBe(200);
    const fv = await admin.post(`/api/admin/products/${productId}/release/versions`, { version: '1.0.0', status: 'released', instructions: 'Run the full setup' });
    expect(fv.status).toBe(201);
    expect(fv.body.channel).toBe('release');
    expect((await admin.post(`/api/admin/demo-versions/${fv.body.versions[0].id}/files`, { mediaId: f.id, platform: 'windows', label: 'Full installer' })).status).toBe(201);
    const demo = await admin.get(`/api/admin/products/${productId}/demo`);
    const full = await admin.get(`/api/admin/products/${productId}/release`);
    expect(demo.body.channel).toBe('demo');
    expect(full.body.channel).toBe('release');
    const pub = await (await client()).get(`/api/public/products/${slug}`);
    demoFileId = pub.body.demo.files[0].id;
    fullFileId = pub.body.installer.files[0].id;
    expect(demoFileId).not.toBe(fullFileId);
    expect(pub.body.installer.access).toBe('licensed');
  });

  it('a customer without a licence gets the demo only; never the full file', async () => {
    const c = await client();
    await register(c, reg());
    const info = await c.get(`/api/account/installers/${slug}`);
    expect(info.body.allowed).toBe(false);
    expect((await c.post(`/api/account/installers/${slug}/download`, { fileId: fullFileId })).status).toBe(403);
    // the demo endpoint refuses the full file id
    const wrong = await c.post(`/api/account/demos/${slug}/download`, { fileId: fullFileId, acceptTerms: true, profile: { company: 'X', cellphone: '0820000000', country: 'ZA' } });
    expect(wrong.status).toBe(400);
    const d = await c.post(`/api/account/demos/${slug}/download`, { fileId: demoFileId, acceptTerms: true, profile: { company: 'X', cellphone: '0820000000', country: 'ZA' } });
    expect(d.status).toBe(201);
    const file = await c.agent.get(d.body.url).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (x: Buffer) => b.push(x)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect((file.body as Buffer)[10]).toBe(1); // demo bytes
  });

  it('a licensed customer downloads the full installer of that product only', async () => {
    const c = await client();
    const input = reg();
    await register(c, input);
    const cust = await db('customers as c').join('users as u', 'u.id', 'c.user_id').where('u.email', input.email).first('c.id');
    await db('licences').insert({ licence_key: `SCH-V7AA-${Date.now() % 10000}-ABCD-EFGH`.slice(0, 24), customer_id: cust.id, product_id: productId, type: 'perpetual', status: 'active', starts_at: new Date() });
    const r = await c.post(`/api/account/installers/${slug}/download`, { fileId: fullFileId });
    expect(r.status).toBe(201);
    const file = await c.agent.get(r.body.url).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (x: Buffer) => b.push(x)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect((file.body as Buffer)[10]).toBe(2); // full bytes
    expect((await c.post(`/api/account/installers/${otherSlug}/download`, { fileId: fullFileId })).status).toBeGreaterThanOrEqual(400);
    // the link is personal
    const stranger = await client();
    await register(stranger, reg());
    expect((await stranger.get(r.body.url)).status).toBe(401);
    expect(await db('downloads').where({ version_file_id: fullFileId, customer_id: cust.id })).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ WhatsApp */
describe('WhatsApp Cloud API (mock Graph server)', () => {
  let server: Server;
  const sent: { to: string; type: string; text?: string; template?: string }[] = [];
  let failNext = 0;
  let n = 0;
  const APP_SECRET = 'test-app-secret';
  const sign = (body: string) => 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
  const hook = (payload: object, sig?: string) => {
    const body = JSON.stringify(payload);
    return admin.agent.post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig ?? sign(body)).send(body);
  };
  const inbound = (from: string, text: string, contextId?: string) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Agent' } }], messages: [{ id: `wamid.in.${Date.now()}.${++n}`, from, type: 'text', text: { body: text }, ...(contextId ? { context: { id: contextId } } : {}) }] } }] }] });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190 } })); return; }
        if (req.method === 'GET') { res.end(JSON.stringify({ display_phone_number: '+27 10 000 0000', verified_name: 'SCHLUSS' })); return; }
        if (failNext > 0) { failNext--; res.writeHead(503); res.end(JSON.stringify({ error: { message: 'Service unavailable' } })); return; }
        const b = JSON.parse(raw);
        sent.push({ to: b.to, type: b.type, text: b.text?.body, template: b.template?.name });
        res.end(JSON.stringify({ messages: [{ id: `wamid.out.${++n}` }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env['WHATSAPP_API_BASE'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('settings: secrets are write-only; switching on needs a phone number id', async () => {
    const base = { enabled: true, phoneNumberId: '', businessAccountId: '', displayNumber: '+27 10 000 0000', agents: [], templateName: '', templateLanguage: 'en' };
    expect((await admin.put('/api/admin/whatsapp', base)).status).toBe(422);
    const r = await admin.put('/api/admin/whatsapp', { ...base, phoneNumberId: '1234567890', agents: [{ number: '+27 82 111 1111', name: 'Sam Support' }], templateName: 'support_forward', accessToken: 'test-token', appSecret: APP_SECRET, verifyToken: 'verify-me' });
    expect(r.status).toBe(200);
    const g = await admin.get('/api/admin/whatsapp');
    expect(JSON.stringify(g.body)).not.toContain('test-token');
    expect(JSON.stringify(g.body)).not.toContain(APP_SECRET);
    expect(g.body.secrets).toMatchObject({ accessToken: 'set', appSecret: 'set', verifyToken: 'set' });
    const stored = await db('settings').where('key', 'whatsapp.secrets').select('value');
    expect(JSON.stringify(stored)).not.toContain('test-token'); // encrypted at rest
    expect((await admin.post('/api/admin/whatsapp/test')).body.ok).toBe(true);
  });

  it('webhook verification echoes the challenge only with the right token', async () => {
    const bad = await admin.agent.get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123');
    expect(bad.status).toBe(403);
    const ok = await admin.agent.get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242');
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('4242');
  });

  it('rejects unsigned / wrongly signed webhooks', async () => {
    const r = await hook(inbound('27821111111', 'hello'), 'sha256=deadbeef');
    expect(r.status).toBe(401);
  });

  it('two concurrent website chats are forwarded; agent replies land in the right chat only, live', async () => {
    sent.length = 0;
    const a = await client();
    const b = await client();
    const ra = await a.post('/api/support/conversations', { message: 'Chat A: activation question xyzzy', name: 'Alice', email: uniqueEmail('a'), consent: true, enquiryType: 'technical' });
    const rb = await b.post('/api/support/conversations', { message: 'Chat B: printer question plugh', name: 'Bob', email: uniqueEmail('b'), consent: true, enquiryType: 'general' });
    expect(sent.filter((s) => s.to === '27821111111')).toHaveLength(2);
    expect(sent[0].type).toBe('template'); // outside the 24 h window → approved template
    const ta = await db('tickets').where({ reference: ra.body.reference }).first();
    const tb = await db('tickets').where({ reference: rb.body.reference }).first();
    const wa = await db('whatsapp_messages').where({ ticket_id: ta.id, direction: 'out' }).first();
    const wb = await db('whatsapp_messages').where({ ticket_id: tb.id, direction: 'out' }).first();
    expect(wa.status).toBe('sent'); // accepted, NOT "delivered"

    // live stream for chat B (plain HTTP so the stream can be closed cleanly)
    const events: string[] = [];
    const srv = makeApp().listen(0);
    const port = (srv.address() as AddressInfo).port;
    const jar = (b.agent as unknown as { jar: { getCookies: (o: object) => { toValueString: () => string }[] } }).jar;
    const cookie = jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }).map((x) => x.toValueString()).join('; ');
    const sseReq = httpGet({ host: '127.0.0.1', port, path: `/api/support/conversations/${rb.body.reference}/stream`, headers: { cookie } }, (res) => { res.on('data', (d: Buffer) => events.push(d.toString())); res.on('error', () => undefined); });
    sseReq.on('error', () => undefined);
    await new Promise((r) => setTimeout(r, 200));

    // agent swipe-replies to chat B's forwarded message (in reverse order on purpose)
    expect((await hook(inbound('27821111111', 'Hi Bob, which printer model?', wb.wa_message_id))).status).toBe(200);
    expect((await hook(inbound('27821111111', 'Hi Alice, enter the SCH- key', wa.wa_message_id))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    sseReq.destroy();
    srv.close();
    expect(events.join('')).toContain('"kind":"message"');

    const threadA = (await a.get(`/api/support/conversations/${ra.body.reference}`)).body.messages.filter((m: { from: string }) => m.from === 'staff').map((m: { body: string }) => m.body);
    const threadB = (await b.get(`/api/support/conversations/${rb.body.reference}`)).body.messages.filter((m: { from: string }) => m.from === 'staff').map((m: { body: string }) => m.body);
    expect(threadA).toEqual(['Hi Alice, enter the SCH- key']);
    expect(threadB).toEqual(['Hi Bob, which printer model?']);
    expect((await db('tickets').where({ id: tb.id }).first()).status).toBe('awaiting_customer');

    // reply by reference prefix (no swipe) also works
    await hook(inbound('27821111111', `${ra.body.reference} Also restart the app`));
    expect((await a.get(`/api/support/conversations/${ra.body.reference}`)).body.messages.filter((m: { from: string }) => m.from === 'staff')).toHaveLength(2);

    // delivery statuses: only what Meta confirms, never backwards
    const st = (id: string, status: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status, recipient_id: '27821111111' }] } }] }] });
    await hook(st(wa.wa_message_id, 'read'));
    await hook(st(wa.wa_message_id, 'delivered'));
    expect((await db('whatsapp_messages').where({ id: wa.id }).first()).status).toBe('read');

    // duplicate webhook delivery is ignored
    const dupe = inbound('27821111111', 'Dupe test', wb.wa_message_id);
    await hook(dupe);
    await hook(dupe);
    expect((await db('ticket_messages').where({ ticket_id: tb.id, body: 'Dupe test' }))).toHaveLength(1);

    // /resolve from WhatsApp
    await hook(inbound('27821111111', '/resolve', wb.wa_message_id));
    expect((await db('tickets').where({ id: tb.id }).first()).status).toBe('resolved');
  });

  it('a customer messaging the WhatsApp number directly gets a conversation; admin replies go back by WhatsApp', async () => {
    sent.length = 0;
    await hook(inbound('27829999999', 'Hello from WhatsApp, demo help please'));
    const t = await db('tickets').where({ channel: 'whatsapp', wa_customer_phone: '27829999999' }).first();
    expect(t).toMatchObject({ department: 'support' });
    const r = await support.post(`/api/admin/support/conversations/${t.id}/messages`, { body: 'Hi! Happy to help.' });
    expect(r.status).toBe(201);
    const out = sent.find((s) => s.to === '27829999999');
    expect(out).toMatchObject({ type: 'text', text: 'Hi! Happy to help.' }); // inside the 24 h window → free text
    const list = await support.get('/api/admin/support/conversations?channel=whatsapp');
    expect(list.body.data.some((x: { id: number }) => x.id === t.id)).toBe(true);
  });

  it('API failures are recorded as failed (never delivered) and retried', async () => {
    failNext = 1;
    const r = await admin.post('/api/admin/whatsapp/test-message', { to: '+27821111111' });
    expect(r.body.ok).toBe(false);
    expect(r.body.status).toBe('failed');
    const { retryWhatsApp } = await import('../../server/api/services/whatsapp');
    expect(await retryWhatsApp()).toBe(1);
    const row = await db('whatsapp_messages').orderBy('id', 'desc').where({ direction: 'out', peer_phone: '27821111111' }).first();
    expect(row.status).toBe('sent');
    expect(row.attempts).toBe(2);
    expect(await db('notifications').where({ type: 'whatsapp.error' }).first()).toBeTruthy();
  });

  it('switched off → messages are not sent and the website chat still works', async () => {
    const s = (await admin.get('/api/admin/whatsapp')).body.settings;
    await admin.put('/api/admin/whatsapp', { ...s, enabled: false });
    sent.length = 0;
    const r = await (await client()).post('/api/support/conversations', { message: 'Offline WA test', name: 'Zed', email: uniqueEmail('z'), consent: true });
    expect(r.status).toBe(201);
    expect(sent).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ admin ops */
describe('admin operations', () => {
  it('email settings, businesses, reports and CSV export', async () => {
    const e = await admin.get('/api/admin/email-settings');
    expect(e.body.departments).toMatchObject({ support: 'support@schluss.co.za', sales: 'sales@schluss.co.za' });
    expect((await admin.put('/api/admin/email-settings', { support: 'not-an-email', sales: 'sales@schluss.co.za', customerAck: true })).status).toBe(422);
    const t = await admin.post('/api/admin/email-settings/test', { department: 'sales' });
    expect(t.body).toMatchObject({ queued: true, to: 'sales@schluss.co.za' });

    const b = await admin.post('/api/admin/businesses', { name: 'Acme Holdings', registrationNumber: '2020/123456/07', country: 'ZA' });
    expect(b.status).toBe(201);
    expect((await admin.get('/api/admin/businesses?q=Acme')).body.data[0].name).toBe('Acme Holdings');

    const rep = await admin.get('/api/admin/reports');
    expect(rep.body).toHaveProperty('conversationsByDepartment');
    const csv = await admin.get('/api/admin/reports/export/leads');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect((await sales.get('/api/admin/reports/export/leads')).status).toBe(403);
    expect((await admin.get('/api/admin/system')).body.scanner).toBeTruthy();
  });

  it('admin can suspend and reactivate a customer, and resend a code to an unverified one', async () => {
    const c = await client();
    const input = reg();
    await c.post('/api/auth/register', input);
    const cust = await db('customers as c').join('users as u', 'u.id', 'c.user_id').where('u.email', input.email).first('c.id');
    await db('email_otps').update({ created_at: new Date(Date.now() - 120_000) });
    expect((await admin.post(`/api/admin/customers/${cust.id}/account`, { action: 'resend_otp' })).status).toBe(200);
    await c.post('/api/auth/verify-email', { email: input.email, code: await lastOtp(input.email) });
    expect((await admin.post(`/api/admin/customers/${cust.id}/account`, { action: 'suspend' })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user).toBeNull();
    expect((await c.post('/api/auth/login', { email: input.email, password: input.password })).status).toBe(401);
    await admin.post(`/api/admin/customers/${cust.id}/account`, { action: 'reactivate' });
    expect((await c.post('/api/auth/login', { email: input.email, password: input.password })).status).toBe(200);
  });
});

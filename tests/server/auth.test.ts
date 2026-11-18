import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { sha256 } from '../../server/api/services/crypto';
import { client, login, makeApp, uniqueEmail, register } from './helpers';
import request from 'supertest';

const validReg = () => ({
  name: 'Thandi Nkosi',
  email: uniqueEmail('cust'),
  cellphone: '+27 82 123 4567',
  company: 'Nkosi Retail',
  country: 'za',
  password: 'Puzzle-piece-42',
  acceptPrivacy: true,
  marketingOptIn: false,
});

afterAll(() => db.destroy());

describe('health', () => {
  it('reports database up', async () => {
    const r = await request(makeApp()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, db: 'up' });
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without a token', async () => {
    const r = await request(makeApp()).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
  });
  it('rejects a forged token even when cookie and header match', async () => {
    const r = await request(makeApp()).post('/api/auth/login').set('Cookie', 'XSRF-TOKEN=abc.def').set('X-XSRF-TOKEN', 'abc.def').send({});
    expect(r.status).toBe(403);
  });
});

describe('customer registration', () => {
  it('validates input with field errors', async () => {
    const c = await client();
    const r = await c.post('/api/auth/register', { ...validReg(), email: 'nope', password: 'short', acceptPrivacy: false });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.details.fields)).toEqual(expect.arrayContaining(['email', 'password', 'acceptPrivacy']));
  });

  it('creates user, customer profile, separate consents, queued welcome email and signs in', async () => {
    const c = await client();
    const input = validReg();
    const r = await register(c, input);
    expect(r.status).toBe(201);

    const me = await c.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ type: 'customer', email: input.email, name: input.name });

    const user = await db('users').where({ email: input.email }).first();
    expect(user.password_hash).not.toContain(input.password);
    const cust = await db('customers').where({ user_id: user.id }).first();
    expect(cust).toMatchObject({ country: 'ZA', company: 'Nkosi Retail' });

    const consents = await db('consents').where({ user_id: user.id }).select('purpose', 'granted');
    expect(consents).toEqual(
      expect.arrayContaining([
        { purpose: 'privacy_policy', granted: 1 },
        { purpose: 'terms', granted: 1 },
        { purpose: 'marketing', granted: 0 }, // marketing NOT implied by accepting terms
      ]),
    );
    const log = await db('email_logs').where({ to_email: input.email, template_key: 'welcome_customer' }).first();
    expect(log.status).toBe('queued');
  });

  it('refuses duplicate email', async () => {
    const c = await client();
    const input = validReg();
    expect((await register(c, input)).status).toBe(201);
    const c2 = await client();
    expect((await c2.post('/api/auth/register', input)).status).toBe(409);
  });
});

describe('login / logout / sessions', () => {
  it('logs in, stores only a hash of the session token, and logs out', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.user).toBeNull();

    const r = await login(c, input.email, input.password);
    const raw = /sch_sid=([^;]+)/.exec(String(r.headers['set-cookie']))![1];
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(await db('sessions').where({ id: raw }).first()).toBeUndefined();
    expect(await db('sessions').where({ id: sha256(decodeURIComponent(raw)) }).first()).toBeDefined();

    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.user).toBeNull();
    expect(await db('sessions').where({ id: sha256(decodeURIComponent(raw)) }).first()).toBeUndefined();
  });

  it('gives the same generic error for unknown email and wrong password', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    const a = await c.post('/api/auth/login', { email: input.email, password: 'wrong-password-1' });
    const b = await c.post('/api/auth/login', { email: uniqueEmail('ghost'), password: 'wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after 5 failed attempts', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: input.email, password: 'wrong-password-1' });
    const r = await c.post('/api/auth/login', { email: input.email, password: input.password });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('locked');
  });

  it('blocks disabled users', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    await db('users').where({ email: input.email }).update({ status: 'disabled' });
    expect((await c.get('/api/auth/me')).body.user).toBeNull(); // existing session dropped
    expect((await c.post('/api/auth/login', { email: input.email, password: input.password })).status).toBe(401);
  });
});

describe('password reset', () => {
  it('responds identically for unknown emails and queues a reset email for real ones', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    const real = await c.post('/api/auth/forgot-password', { email: input.email });
    const fake = await c.post('/api/auth/forgot-password', { email: uniqueEmail('ghost') });
    expect(real.status).toBe(200);
    expect(real.body).toEqual(fake.body);
    const job = await db('jobs').where('type', 'email').orderBy('id', 'desc').first();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(payload.template).toBe('password_reset');
    expect(payload.vars.resetUrl).toMatch(/reset-password\?token=/);
  });

  it('resets with a valid token once, signs out all sessions, and rejects reuse', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    await c.post('/api/auth/forgot-password', { email: input.email });
    const job = await db('jobs').where('type', 'email').orderBy('id', 'desc').first();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const token = new URL(payload.vars.resetUrl).searchParams.get('token')!;

    const other = await client();
    const r = await other.post('/api/auth/reset-password', { token, password: 'Brand-new-pass-9' });
    expect(r.status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user).toBeNull(); // old session invalidated
    expect((await other.post('/api/auth/reset-password', { token, password: 'Another-pass-99' })).status).toBe(400);
    await login(other, input.email, 'Brand-new-pass-9');
  });

  it('rejects expired tokens', async () => {
    const c = await client();
    const input = validReg();
    await register(c, input);
    await c.post('/api/auth/forgot-password', { email: input.email });
    const job = await db('jobs').where('type', 'email').orderBy('id', 'desc').first();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const token = new URL(payload.vars.resetUrl).searchParams.get('token')!;
    await db('password_resets').where({ token_hash: sha256(token) }).update({ expires_at: new Date(Date.now() - 1000) });
    expect((await c.post('/api/auth/reset-password', { token, password: 'Brand-new-pass-9' })).status).toBe(400);
  });
});

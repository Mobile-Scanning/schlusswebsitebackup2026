import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, lastOtp, login, uniqueEmail } from './helpers';

type C = Awaited<ReturnType<typeof client>>;
let admin: C;
let readOnly: C;
const reg = (email: string) => ({ name: 'Otp Tester', email, password: 'Puzzle-piece-42', acceptPrivacy: true });
const otpCount = async (email: string) => Number((await db('email_logs').where({ to_email: email, template_key: 'email_otp' }).count({ n: '*' }).first())!.n);
const ageLastOtp = async (email: string) => {
  const u = await db('users').where({ email }).first('id');
  await db('email_otps').where({ user_id: u.id }).update({ created_at: new Date(Date.now() - 5 * 60_000) });
};

beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  const r = await createStaff(['read_only']);
  admin = await client();
  readOnly = await client();
  await login(admin, a.email, a.password);
  await login(readOnly, r.email, r.password);
});
afterAll(() => db.destroy());

describe('verification code when coming back to an unverified account', () => {
  it('registering again with the same address sends a fresh code (earlier one stops working)', async () => {
    const email = uniqueEmail('otp-again');
    expect((await (await client()).post('/api/auth/register', reg(email))).status).toBe(201);
    const first = await lastOtp(email);
    // Straight away: no second email (60-second cooldown) …
    const soon = await (await client()).post('/api/auth/register', reg(email));
    expect(soon.status).toBe(409);
    expect(soon.body.error.code).toBe('email_unverified');
    expect(await otpCount(email)).toBe(1);
    // … later (e.g. the first email never arrived): a new code is sent automatically.
    await ageLastOtp(email);
    const again = await (await client()).post('/api/auth/register', reg(email));
    expect(again.status).toBe(409);
    expect(await otpCount(email)).toBe(2);
    const second = await lastOtp(email);
    const c = await client();
    if (first !== second) expect((await c.post('/api/auth/verify-email', { email, code: first })).status).toBe(400);
    expect((await c.post('/api/auth/verify-email', { email, code: second })).status).toBe(200);
  });

  it('signing in before verifying also sends a fresh code; a wrong password does not', async () => {
    const email = uniqueEmail('otp-login');
    await (await client()).post('/api/auth/register', reg(email));
    await ageLastOtp(email);
    expect((await (await client()).post('/api/auth/login', { email, password: 'wrong-password-1' })).status).toBe(401);
    expect(await otpCount(email)).toBe(1);
    const r = await (await client()).post('/api/auth/login', { email, password: 'Puzzle-piece-42' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('email_unverified');
    expect(await otpCount(email)).toBe(2);
  });

  it('the page can tell whether the code email really left', async () => {
    const email = uniqueEmail('otp-status');
    const c = await client();
    await c.post('/api/auth/register', reg(email));
    expect((await c.post('/api/auth/otp-status', { email })).body.status).toBe('sending');
    await db('email_logs').where({ to_email: email }).update({ status: 'failed', error: 'The mail server refused the password' });
    expect((await c.post('/api/auth/otp-status', { email })).body.status).toBe('problem');
    await db('email_logs').where({ to_email: email }).update({ status: 'sent', error: null });
    expect((await c.post('/api/auth/otp-status', { email })).body.status).toBe('sent');
    // Says nothing about addresses that aren't waiting for verification, and never returns the error text.
    const other = await c.post('/api/auth/otp-status', { email: uniqueEmail('nobody') });
    expect(other.body).toEqual({ status: 'sending' });
  });
});

describe('admin: suspend and delete customer accounts', () => {
  const customerOf = async (email: string) => (await db('customers').where({ email }).first('id', 'user_id'))!;

  it('suspend signs the customer out and blocks sign-in; reactivate restores it', async () => {
    const email = uniqueEmail('suspend');
    const c = await client();
    await c.post('/api/auth/register', reg(email));
    expect((await c.post('/api/auth/verify-email', { email, code: await lastOtp(email) })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user?.email).toBe(email);
    const cust = await customerOf(email);
    expect((await readOnly.post(`/api/admin/customers/${cust.id}/account`, { action: 'suspend' })).status).toBe(403);
    expect((await admin.post(`/api/admin/customers/${cust.id}/account`, { action: 'suspend' })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user ?? null).toBeNull(); // signed out everywhere
    expect((await (await client()).post('/api/auth/login', { email, password: 'Puzzle-piece-42' })).status).toBe(401);
    const list = (await admin.get(`/api/admin/customers?q=${encodeURIComponent(email)}`)).body.data[0];
    expect(list.login_status).toBe('disabled');
    expect((await admin.post(`/api/admin/customers/${cust.id}/account`, { action: 'reactivate' })).status).toBe(200);
    expect((await (await client()).post('/api/auth/login', { email, password: 'Puzzle-piece-42' })).status).toBe(200);
  });

  it('an account with no history can be deleted; the address can then register again', async () => {
    const email = uniqueEmail('delete');
    await (await client()).post('/api/auth/register', reg(email));
    const cust = await customerOf(email);
    expect((await admin.get(`/api/admin/customers/${cust.id}/delete-check`)).body.canDelete).toBe(true);
    expect((await readOnly.del(`/api/admin/customers/${cust.id}`)).status).toBe(403);
    expect((await admin.del(`/api/admin/customers/${cust.id}`)).status).toBe(200);
    expect(await db('customers').where({ id: cust.id }).first()).toBeUndefined();
    expect(await db('users').where({ id: cust.user_id }).first()).toBeUndefined();
    expect(await db('email_otps').where({ user_id: cust.user_id }).first()).toBeUndefined();
    expect(Number((await db('consents').where({ email }).count({ n: '*' }).first())!.n)).toBeGreaterThan(0); // consent evidence is kept
    expect(await db('audit_logs').where({ action: 'customer.deleted', subject_id: cust.id }).first()).toBeDefined();
    expect((await (await client()).post('/api/auth/register', reg(email))).status).toBe(201);
    expect((await admin.del(`/api/admin/customers/${cust.id}`)).status).toBe(404);
  });

  it('a customer with history (a licence) is never deleted – suspend is offered instead', async () => {
    const email = uniqueEmail('keep');
    await (await client()).post('/api/auth/register', reg(email));
    const cust = await customerOf(email);
    const product = await db('products').first('id');
    await db('licences').insert({ customer_id: cust.id, product_id: product.id, licence_key: `TEST-${Date.now()}`, type: 'trial', status: 'trial', starts_at: new Date() });
    const chk = (await admin.get(`/api/admin/customers/${cust.id}/delete-check`)).body;
    expect(chk.canDelete).toBe(false);
    expect(chk.reason).toMatch(/1 demo or package licence/);
    const r = await admin.del(`/api/admin/customers/${cust.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('customer_in_use');
    expect(r.body.error.message).toMatch(/Suspend/);
    expect(await db('customers').where({ id: cust.id }).first()).toBeDefined();
    expect(await db('users').where({ id: cust.user_id }).first()).toBeDefined();
  });
});

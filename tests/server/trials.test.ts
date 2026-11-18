import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, login, uniqueEmail, register } from './helpers';

afterAll(() => db.destroy());

const reg = () => ({ name: 'Trial Tester', email: uniqueEmail('trial'), cellphone: '+27 82 555 0000', company: 'Trial Co', country: 'za', password: 'Puzzle-piece-42', acceptPrivacy: true, marketingOptIn: false });

async function product(fields: Record<string, unknown>) {
  const slug = `trial-test-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  await db('products').insert({ name: 'Trial Test Product', slug, short_description: 'x', status: 'available', is_published: true, trial_days: 14, ...fields });
  return slug;
}

describe('free trials', () => {
  it('signed-out visitors cannot start a trial', async () => {
    const c = await client();
    const slug = await product({});
    expect((await c.post('/api/account/trials', { product: slug })).status).toBe(401);
  });

  it('staff accounts are told trials are for customers', async () => {
    const s = await createStaff(['super_admin']);
    const c = await client();
    await login(c, s.email, s.password);
    const r = await c.post('/api/account/trials', { product: await product({}) });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('customer_only');
  });

  it('a customer starts one trial per product; the end date comes from the server', async () => {
    const c = await client();
    expect((await register(c, reg())).status).toBe(201);
    const slug = await product({ trial_days: 14 });
    const r = await c.post('/api/account/trials', { product: slug });
    expect(r.status).toBe(201);
    expect(r.body.licenceKey).toMatch(/^SCH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const days = (new Date(r.body.expiresAt).getTime() - new Date(r.body.startsAt).getTime()) / 86400000;
    expect(Math.round(days)).toBe(14);
    expect(r.body.status).toBe('trial');

    // second attempt is refused by the database rule, with a clear message
    const again = await c.post('/api/account/trials', { product: slug });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('trial_used');

    const list = await c.get('/api/account/trials');
    expect(list.body.filter((t: { product: { slug: string } }) => t.product.slug === slug)).toHaveLength(1);
    const mail = await db('email_logs').where({ template_key: 'trial_started' }).orderBy('id', 'desc').first();
    expect(mail).toBeTruthy();
  });

  it('products without a trial, coming soon or unpublished products refuse', async () => {
    const c = await client();
    await register(c, reg());
    expect((await c.post('/api/account/trials', { product: await product({ trial_days: null }) })).body.error.code).toBe('no_trial');
    expect((await c.post('/api/account/trials', { product: await product({ status: 'coming_soon' }) })).body.error.code).toBe('no_trial');
    expect((await c.post('/api/account/trials', { product: await product({ is_published: false }) })).status).toBe(404);
  });
});

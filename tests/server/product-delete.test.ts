import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, login, register, uniqueEmail } from './helpers';

type C = Awaited<ReturnType<typeof client>>;
let admin: C;
let viewer: C;
afterAll(() => db.destroy());
beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  const v = await createStaff(['read_only']);
  admin = await client();
  viewer = await client();
  await login(admin, a.email, a.password);
  await login(viewer, v.email, v.password);
});

describe('deleting products', () => {
  it('deletes an unused product with its plans, features, versions and files; keeps learning material', async () => {
    const [id] = await db('products').insert({ name: 'Delete Me', slug: `del-${Date.now()}`, short_description: 'x', status: 'available' });
    await db('product_plans').insert({ product_id: id, name: 'Basic', model: 'once_off', price_cents: 1000, currency: 'ZAR' });
    await db('product_features').insert({ product_id: id, kind: 'feature', title: 'Fast' });
    const [vid] = await db('product_versions').insert({ product_id: id, channel: 'release', version: '1.0', status: 'released' });
    const [mid] = await db('media').insert({ kind: 'installer', title: 'x', original_name: 'x.exe', storage_key: 'k/x.exe', visibility: 'staff' });
    await db('version_files').insert({ version_id: vid, media_id: mid, platform: 'windows' });
    const [cat] = await db('product_content_categories').insert({ product_id: id, name: 'Getting Started' });
    await db('product_content_items').insert({ product_id: id, category_id: cat, title: 'Intro', video_provider: 'youtube', video_reference: 'aqz-KE-bpKQ' });
    const [lid] = await db('learning_resources').insert({ product_id: id, title: 'Guide', kind: 'article', section: 'getting_started', is_published: true });
    expect((await admin.get(`/api/admin/products/${id}/delete-check`)).body.canDelete).toBe(true);
    expect((await viewer.del(`/api/admin/products/${id}`)).status).toBe(403);
    expect((await admin.del(`/api/admin/products/${id}`)).status).toBe(204);
    expect(await db('products').where({ id }).first()).toBeUndefined();
    expect(await db('product_plans').where({ product_id: id })).toHaveLength(0);
    expect(await db('product_versions').where({ product_id: id })).toHaveLength(0);
    expect(await db('product_content_items').where({ product_id: id })).toHaveLength(0);
    expect(await db('product_content_categories').where({ product_id: id })).toHaveLength(0);
    expect(await db('media').where({ id: mid }).first()).toBeTruthy(); // file stays in the media library
    expect(await db('learning_resources').where({ id: lid }).first()).toMatchObject({ product_id: null, is_published: 0 });
    expect(await db('audit_logs').where({ action: 'product.deleted', subject_id: id }).first()).toBeTruthy();
  });

  it('refuses to delete a product customers depend on, and explains why', async () => {
    const [id] = await db('products').insert({ name: 'In Use', slug: `use-${Date.now()}`, short_description: 'x', status: 'available', is_published: true });
    const c = await client();
    const email = uniqueEmail('del');
    await register(c, { name: 'Del Cust', email, password: 'Puzzle-piece-42', acceptPrivacy: true });
    const cust = await db('customers').where({ email }).first('id');
    await db('licences').insert({ licence_key: `SCH-DEL1-${String(Date.now()).slice(-4)}-AAAA-BBBB`, customer_id: cust.id, product_id: id, type: 'perpetual', status: 'active', starts_at: new Date() });
    const chk = await admin.get(`/api/admin/products/${id}/delete-check`);
    expect(chk.body).toMatchObject({ canDelete: false, usage: { licences: 1 } });
    const r = await admin.del(`/api/admin/products/${id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('product_in_use');
    expect(r.body.error.message).toMatch(/Archive it instead/);
    expect(await db('products').where({ id }).first()).toBeTruthy();
  });
});

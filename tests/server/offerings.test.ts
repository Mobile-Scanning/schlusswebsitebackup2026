import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../server/api/db';
import { client, createStaff, login, makeApp, register, uniqueEmail } from './helpers';

type C = Awaited<ReturnType<typeof client>>;
let admin: C;
const exe = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 5)]);

beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  admin = await client();
  await login(admin, a.email, a.password);
});
afterAll(() => db.destroy());

async function customer() {
  const c = await client();
  const email = uniqueEmail('off');
  await register(c, { name: 'Offering Viewer', email, password: 'Puzzle-piece-42', acceptPrivacy: true });
  return Object.assign(c, { customerId: (await db('customers').where({ email }).first('id')).id as number });
}
async function addVideo(productId: number, title: string, categoryId: number | null) {
  const r = await admin.post(`/api/admin/products/${productId}/content/items`, { title, contentType: 'tutorial', provider: 'youtube', url: 'https://youtu.be/aqz-KE-bpKQ', categoryId, status: 'draft', accessLevel: 'public' });
  expect(r.status).toBe(201);
  await db('product_content_items').where({ id: r.body.savedId }).update({ status: 'published' }); // no cover needed for this test
  return r.body.savedId as number;
}

describe('learning offerings', () => {
  let id: number;
  let slug: string;
  it('creates learning content without installer, demo, trial or pricing, and publishes it', async () => {
    const r = await admin.post('/api/admin/products', { name: 'Inventory Management Learning', offeringType: 'learning', shortDescription: 'Free lessons on inventory.' });
    expect(r.status).toBe(201);
    ({ id, slug } = r.body);
    const p = (await admin.get(`/api/admin/products/${id}`)).body;
    expect(p.offering_type).toBe('learning');
    expect(p.offering_features).toEqual({ installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true });
    expect(p.allowed_features.installer).toBe(false);
    for (const name of ['Getting Started', 'Warehouse Basics']) await admin.post(`/api/admin/products/${id}/content/categories`, { name });
    const cats = (await admin.get(`/api/admin/products/${id}/content`)).body.categories;
    for (let n = 1; n <= 3; n++) await addVideo(id, `Lesson ${n}`, cats[n % 2].id);
    // no category and no pricing needed for learning content
    const pub = await admin.post(`/api/admin/products/${id}/state`, { action: 'publish' });
    expect(pub.status).toBe(200);
    const page = (await request(makeApp()).get(`/api/public/products/${slug}`)).body;
    expect(page).toMatchObject({ offeringType: 'learning', installer: null, demo: null, trialDays: null, plans: [] });
    expect(page.offeringFeatures.learning).toBe(true);
    const lib = (await request(makeApp()).get(`/api/content/products/${slug}/library`)).body;
    expect(lib.total).toBe(3);
    expect(lib.categories).toHaveLength(2);
    const list = (await request(makeApp()).get('/api/public/products?offering=learning&perPage=48')).body.data;
    expect(list.some((x: { slug: string; offeringType: string }) => x.slug === slug && x.offeringType === 'learning')).toBe(true);
  });

  it('refuses software-only actions for learning content (server-side)', async () => {
    const c = await customer();
    expect((await c.post('/api/public/purchase-enquiry', { name: 'Xola Buyer', email: uniqueEmail('x'), product: slug, message: 'I want to buy', acceptPrivacy: true })).body.error.code).toBe('not_for_sale');
    expect((await c.post('/api/account/trials', { product: slug })).body.error.code).toBe('no_trial');
    await db('products').where({ id }).update({ trial_days: 14, demo_options: JSON.stringify({ downloadable: true }) });
    expect((await c.post('/api/account/trials', { product: slug })).body.error.code).toBe('no_trial');
    expect((await c.get(`/api/account/installers/${slug}`)).body.allowed).toBe(false);
    const page = (await request(makeApp()).get(`/api/public/products/${slug}`)).body;
    expect(page.demo).toBeNull();
    expect(page.trialDays).toBeNull();
    // learning offerings can't switch on installers – the type doesn't allow it
    await admin.patch(`/api/admin/products/${id}`, { features: { installer: true, demo: true } });
    expect((await admin.get(`/api/admin/products/${id}`)).body.offering_features.installer).toBe(false);
  });

  it('converts learning → software keeping id, URL, content, ordering, categories and views', async () => {
    const before = (await admin.get(`/api/admin/products/${id}/content`)).body;
    const item = before.items[0].id;
    const c = await customer();
    await c.post(`/api/content/items/${item}/play`);
    const views = await db('product_content_views').where({ product_id: id }).count({ n: '*' }).first();
    const r = await admin.patch(`/api/admin/products/${id}`, { offeringType: 'software', features: { installer: true, demo: false, trial: false, pricing: true, purchase: true, learning: true } });
    expect(r.status).toBe(200);
    const p = (await admin.get(`/api/admin/products/${id}`)).body;
    expect(p).toMatchObject({ id, slug, offering_type: 'software' });
    expect(p.offering_features.installer).toBe(true);
    const after = (await admin.get(`/api/admin/products/${id}/content`)).body;
    expect(after.items.map((i: { id: number; display_order: number; category_id: number }) => [i.id, i.display_order, i.category_id])).toEqual(before.items.map((i: { id: number; display_order: number; category_id: number }) => [i.id, i.display_order, i.category_id]));
    expect(after.categories.map((x: { id: number }) => x.id)).toEqual(before.categories.map((x: { id: number }) => x.id));
    expect((await db('product_content_views').where({ product_id: id }).count({ n: '*' }).first())?.n).toEqual(views?.n);
    expect(await db('audit_logs').where({ action: 'product.offering_type_changed', subject_id: id }).first()).toBeTruthy();
    // now add the installer – the website shows the software sections
    const up = await admin.upload('/api/admin/files/upload', { purpose: 'demo' }, exe(), 'FullSetup.exe');
    const v = await admin.post(`/api/admin/products/${id}/release/versions`, { version: '1.0.0', status: 'released' });
    await admin.post(`/api/admin/demo-versions/${v.body.versions[0].id}/files`, { mediaId: up.body.id, platform: 'windows', label: 'Installer' });
    const page = (await request(makeApp()).get(`/api/public/products/${slug}`)).body;
    expect(page.offeringType).toBe('software');
    expect(page.installer.version).toBe('1.0.0');
    expect((await request(makeApp()).get(`/api/content/products/${slug}/library`)).body.total).toBe(3);
  });

  it('reverse conversion warns about customers and keeps their records', async () => {
    const c = await customer();
    await db('licences').insert({ licence_key: `SCH-OFFR-${String(Date.now()).slice(-4)}-AAAA-BBBB`, customer_id: c.customerId, product_id: id, type: 'perpetual', status: 'active', starts_at: new Date() });
    const r = await admin.patch(`/api/admin/products/${id}`, { offeringType: 'learning' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('confirm_required');
    expect(r.body.error.details.warnings.join(' ')).toMatch(/licence/);
    const ok = await admin.patch(`/api/admin/products/${id}`, { offeringType: 'learning', confirm: true });
    expect(ok.status).toBe(200);
    expect(await db('licences').where({ product_id: id })).toHaveLength(1); // kept
    expect(await db('product_versions').where({ product_id: id })).toHaveLength(1); // kept
    expect((await c.get(`/api/account/installers/${slug}`)).body.allowed).toBe(false); // no longer offered
    expect((await request(makeApp()).get(`/api/public/products/${slug}`)).body.installer).toBeNull();
  });

  it('unpublished offerings and their content are not public', async () => {
    await admin.post(`/api/admin/products/${id}/state`, { action: 'unpublish' });
    expect((await request(makeApp()).get(`/api/public/products/${slug}`)).status).toBe(404);
    expect((await request(makeApp()).get(`/api/content/products/${slug}/library`)).status).toBe(404);
    await admin.post(`/api/admin/products/${id}/state`, { action: 'publish' });
  });
});

describe('Products centre', () => {
  it('lists with stats, type and feature filters; duplicates as a draft with its content', async () => {
    const r = await admin.get('/api/admin/products?offering=learning&perPage=100');
    expect(r.body.stats).toMatchObject({ total: expect.any(Number), learning: expect.any(Number), withDemo: expect.any(Number) });
    expect(r.body.data.every((x: { offering_type: string }) => x.offering_type === 'learning')).toBe(true);
    const withContent = (await admin.get('/api/admin/products?has=content&perPage=100')).body.data;
    expect(withContent.every((x: { content_items: number }) => x.content_items > 0)).toBe(true);
    const search = (await admin.get('/api/admin/products?q=Learning%20content&perPage=100')).body.data;
    expect(search.length).toBeGreaterThan(0);
    const src = withContent[0];
    const d = await admin.post(`/api/admin/products/${src.id}/duplicate`);
    expect(d.status).toBe(201);
    const copy = (await admin.get(`/api/admin/products/${d.body.id}`)).body;
    expect(copy.is_published).toBe(false);
    expect(copy.slug).not.toBe(src.slug);
    expect(copy.summary.contentItems).toBe(src.content_items);
    expect(copy.summary.contentPublished).toBe(0);
    expect(copy.summary.installerVersion).toBeNull(); // installers are not copied
  });

  it('existing software products keep working (legacy rows without stored features)', async () => {
    const [pid] = await db('products').insert({ name: 'Legacy', slug: `legacy-${Date.now()}`, short_description: 'x', status: 'available', is_published: true, trial_days: 7 });
    const p = (await request(makeApp()).get(`/api/public/products/${(await db('products').where({ id: pid }).first('slug')).slug}`)).body;
    expect(p.offeringType).toBe('software');
    expect(p.trialDays).toBe(7);
  });
});

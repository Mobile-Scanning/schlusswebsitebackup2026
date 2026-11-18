import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, login, makeApp, register, uniqueEmail } from './helpers';
import request from 'supertest';

type C = Awaited<ReturnType<typeof client>>;
let admin: C;
let viewer: C;
let pA: { id: number; slug: string };
let pB: { id: number; slug: string };
let coverId: number;
let videoId: number;

const mp4 = (fill = 3) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(200_000, fill)]);
const png = (w = 1280, h = 720) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

async function product(name: string, extra: Record<string, unknown> = {}) {
  const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`;
  const [id] = await db('products').insert({ name, slug, short_description: 'x', status: 'available', is_published: true, ...extra });
  return { id, slug };
}
async function customer() {
  const c = await client();
  const email = uniqueEmail('content');
  await register(c, { name: 'Content Viewer', email, password: 'Puzzle-piece-42', acceptPrivacy: true });
  const cust = await db('customers').where({ email }).first('id');
  return Object.assign(c, { customerId: cust.id as number });
}
const item = (over: Record<string, unknown> = {}) => ({ title: 'Getting started', description: 'Intro', contentType: 'video', provider: 'upload', videoMediaId: videoId, coverMediaId: coverId, durationSeconds: 120, tags: ['intro'], status: 'published', ...over });

beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  const v = await createStaff(['read_only']);
  admin = await client();
  viewer = await client();
  await login(admin, a.email, a.password);
  await login(viewer, v.email, v.password);
  pA = await product('Stocktake A');
  pB = await product('Retail B');
  const cov = await admin.upload('/api/admin/content/covers', {}, await png(), 'cover.png');
  expect(cov.status).toBe(201);
  coverId = cov.body.id;
  const vid = await admin.upload('/api/admin/files/upload', { purpose: 'video', visibility: 'public' }, mp4(), 'intro.mp4');
  expect(vid.status).toBe(201);
  videoId = vid.body.id;
});
afterAll(() => db.destroy());

describe('admin: categories and many items per product', () => {
  let catGS: number;
  let catTut: number;
  it('creates categories and many items of the same type; covers are optimised to WebP', async () => {
    let r = await admin.post(`/api/admin/products/${pA.id}/content/categories`, { name: 'Getting Started' });
    r = await admin.post(`/api/admin/products/${pA.id}/content/categories`, { name: 'Stocktake Tutorials' });
    expect(r.body.categories).toHaveLength(2);
    [catGS, catTut] = r.body.categories.map((c: { id: number }) => c.id);
    for (let n = 1; n <= 6; n++) {
      const x = await admin.post(`/api/admin/products/${pA.id}/content/items`, item({ title: `Tutorial ${n}`, contentType: 'tutorial', categoryId: n <= 3 ? catGS : catTut }));
      expect(x.status).toBe(201);
    }
    const ov = await admin.get(`/api/admin/products/${pA.id}/content`);
    expect(ov.body.stats).toMatchObject({ total: 6, published: 6, categories: 2 });
    expect(ov.body.items.every((i: { content_type: string }) => i.content_type === 'tutorial')).toBe(true);
    const m = await db('media').where({ id: coverId }).first();
    expect(m).toMatchObject({ mime: 'image/webp', visibility: 'staff' });
    expect((await db('media').where({ id: videoId }).first()).visibility).toBe('staff'); // forced private
  });

  it('validates links, cover requirement and category ownership', async () => {
    const bad = await admin.post(`/api/admin/products/${pA.id}/content/items`, item({ provider: 'youtube', url: 'https://example.com/video', videoMediaId: null }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields.url).toMatch(/YouTube/);
    const noCover = await admin.post(`/api/admin/products/${pA.id}/content/items`, item({ coverMediaId: null }));
    // Asked to publish without a cover: kept as a draft (nothing typed is lost) and the reason is returned.
    expect(noCover.status).toBe(201);
    expect(noCover.body.notPublished).toMatch(/cover image/);
    expect(noCover.body.items.find((i: { id: number }) => i.id === noCover.body.savedId).status).toBe('draft');
    expect((await admin.del(`/api/admin/content/items/${noCover.body.savedId}`)).status).toBe(200);
    const otherCat = (await admin.post(`/api/admin/products/${pB.id}/content/categories`, { name: 'B only' })).body.categories[0].id;
    const cross = await admin.post(`/api/admin/products/${pA.id}/content/items`, item({ categoryId: otherCat }));
    expect(cross.status).toBe(422);
    const yt = await admin.post(`/api/admin/products/${pA.id}/content/items`, item({ title: 'YouTube demo', provider: 'youtube', url: YT, videoMediaId: null, categoryId: catGS, accessLevel: 'public' }));
    expect(yt.status).toBe(201);
    expect(yt.body.items.find((i: { title: string }) => i.title === 'YouTube demo').video_reference).toBe('aqz-KE-bpKQ');
    const chk = await admin.post('/api/admin/content/check-link', { url: 'https://youtu.be/aqz-KE-bpKQ', accessLevel: 'authorised' });
    expect(chk.body.provider).toBe('youtube');
    expect(chk.body.warning).toMatch(/can’t limit playback/);
  });

  it('reorders, moves, bulk unpublishes and deletes a category only as chosen', async () => {
    const ov = (await admin.get(`/api/admin/products/${pA.id}/content`)).body;
    const gs = ov.items.filter((i: { category_id: number }) => i.category_id === catGS).map((i: { id: number }) => i.id);
    const order = await admin.post(`/api/admin/products/${pA.id}/content/items/bulk`, { ids: [...gs].reverse(), action: 'order' });
    expect(order.body.items.filter((i: { category_id: number }) => i.category_id === catGS).sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)[0].id).toBe(gs[gs.length - 1]);
    const move = await admin.post(`/api/admin/products/${pA.id}/content/items/bulk`, { ids: [gs[0]], action: 'move', categoryId: catTut });
    expect(move.body.items.find((i: { id: number }) => i.id === gs[0]).category_id).toBe(catTut);
    expect((await viewer.post(`/api/admin/products/${pA.id}/content/items/bulk`, { ids: [gs[0]], action: 'unpublish' })).status).toBe(403);
    // delete needs confirmation; "move" keeps the items
    expect((await admin.post(`/api/admin/content/categories/${catTut}/delete`, { items: 'move', targetCategoryId: catGS })).status).toBe(422);
    const del = await admin.post(`/api/admin/content/categories/${catTut}/delete`, { items: 'move', targetCategoryId: catGS, confirm: true });
    expect(del.body.categories).toHaveLength(1);
    expect(del.body.stats.total).toBe(7);
    await admin.post(`/api/admin/products/${pA.id}/content/categories`, { name: 'Stocktake Tutorials' });
  });
});

describe('customer access, isolation and protection', () => {
  it('public product content: everyone sees published items only, never sources', async () => {
    await db('products').where({ id: pA.id }).update({ content_access: 'public' });
    const items = await db('product_content_items').where({ product_id: pA.id }).select('id');
    await db('product_content_items').where({ id: items[0].id }).update({ status: 'draft' });
    const anon = request(makeApp());
    const lib = await anon.get(`/api/content/products/${pA.slug}/library`);
    expect(lib.status).toBe(200);
    expect(lib.body.total).toBe(6);
    const json = JSON.stringify(lib.body);
    expect(json).not.toMatch(/storage|\/api\/media|videos\/\d{4}|youtube\.com|aqz-KE/);
    expect((await anon.get(`/api/content/products/${pA.slug}/items/${items[0].id}`)).status).toBe(404); // unpublished
    // content of product A can't be opened through product B
    expect((await anon.get(`/api/content/products/${pB.slug}/items/${items[1].id}`)).status).toBe(404);
    const v = await anon.get(`/api/content/products/${pA.slug}/items/${items[2].id}`);
    expect(v.body.product.slug).toBe(pA.slug);
    expect(v.body.position.of).toBeGreaterThan(1);
  });

  it('registered / authorised / demo levels are enforced on the server', async () => {
    await db('products').where({ id: pA.id }).update({ content_access: 'authorised' });
    const id = (await db('product_content_items').where({ product_id: pA.id, status: 'published', video_provider: 'upload' }).first('id')).id;
    const anon = await client();
    const lib = await anon.get(`/api/content/products/${pA.slug}/library`);
    expect(lib.body.total).toBe(1); // only the item explicitly marked public (YouTube demo)
    expect(lib.body.locked).toMatchObject({ code: 'login' });
    expect((await anon.post(`/api/content/items/${id}/play`)).status).toBe(401);
    const c = await customer();
    expect((await c.post(`/api/content/items/${id}/play`)).status).toBe(403);
    expect((await c.get(`/api/content/products/${pA.slug}/library`)).body.locked.code).toBe('licence');
    // licence for ANOTHER product does not help
    await db('licences').insert({ licence_key: `SCH-CNTB-${String(Date.now()).slice(-4)}-AAAA-BBBB`, customer_id: c.customerId, product_id: pB.id, type: 'perpetual', status: 'active', starts_at: new Date() });
    expect((await c.post(`/api/content/items/${id}/play`)).status).toBe(403);
    const [lic] = await db('licences').insert({ licence_key: `SCH-CNTA-${String(Date.now()).slice(-4)}-AAAA-BBBB`, customer_id: c.customerId, product_id: pA.id, type: 'subscription', status: 'active', starts_at: new Date() });
    const play = await c.post(`/api/content/items/${id}/play`);
    expect(play.status).toBe(200);
    expect(play.body.kind).toBe('stream');
    expect(play.body.src).toMatch(/^\/api\/content\/stream\//);
    // expired licence → access revoked
    await db('licences').where({ id: lic }).update({ expires_at: new Date(Date.now() - 1000) });
    expect((await c.post(`/api/content/items/${id}/play`)).status).toBe(403);
    // demo level: an active demo is enough, an expired one isn't
    await db('products').where({ id: pA.id }).update({ content_access: 'demo' });
    const [trial] = await db('licences').insert({ licence_key: `SCH-CNTD-${String(Date.now()).slice(-4)}-AAAA-BBBB`, customer_id: c.customerId, product_id: pA.id, type: 'trial', status: 'trial', starts_at: new Date(), expires_at: new Date(Date.now() + 86400_000) });
    expect((await c.post(`/api/content/items/${id}/play`)).status).toBe(200);
    await db('licences').where({ id: trial }).update({ expires_at: new Date(Date.now() - 1000) });
    expect((await c.post(`/api/content/items/${id}/play`)).status).toBe(403);
    // registered
    await db('products').where({ id: pA.id }).update({ content_access: 'registered' });
    expect((await c.post(`/api/content/items/${id}/play`)).status).toBe(200);
  });

  it('private video streaming: session-bound, range-capable, not openable as a page, re-checks access', async () => {
    const id = (await db('product_content_items').where({ product_id: pA.id, status: 'published', video_provider: 'upload' }).first('id')).id;
    const c = await customer();
    const play = await c.post(`/api/content/items/${id}/play`);
    const src = play.body.src as string;
    const part = await c.agent.get(src).set('Range', 'bytes=0-1023').set('Sec-Fetch-Dest', 'video');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-1023\//);
    expect(part.headers['content-disposition']).toBe('inline');
    expect(part.headers['cache-control']).toMatch(/no-store/);
    expect((await c.agent.get(src).set('Sec-Fetch-Dest', 'document')).status).toBe(403); // address bar / "open in new tab"
    const other = await customer();
    expect((await other.agent.get(src).set('Range', 'bytes=0-10')).status).toBe(403); // copied link, other session
    expect((await request(makeApp()).get(src)).status).toBe(403);
    // the original file is never reachable through the media route for customers
    expect((await c.get(`/api/media/${videoId}/intro.mp4`)).status).toBe(403);
    // revoked: unpublished content stops streaming (fresh link, so no access cache)
    await db('product_content_items').where({ id }).update({ status: 'draft' });
    const again = await c.post(`/api/content/items/${id}/play`);
    expect(again.status).toBe(404);
    await db('product_content_items').where({ id }).update({ status: 'published' });
  });

  it('views are counted once per viewer per window; progress and analytics are recorded', async () => {
    const id = (await db('product_content_items').where({ product_id: pA.id, status: 'published', video_provider: 'upload' }).first('id')).id;
    const c = await customer();
    const a = await c.post(`/api/content/items/${id}/play`);
    const b = await c.post(`/api/content/items/${id}/play`); // refresh
    expect(await db('product_content_views').where({ content_id: id, customer_id: c.customerId })).toHaveLength(1);
    expect(a.body.progressToken).toBeTruthy();
    expect((await c.post(`/api/content/views/${b.body.progressToken}/progress`, { seconds: 60, duration: 120 })).status).toBe(204);
    await c.post(`/api/content/views/${b.body.progressToken}/progress`, { seconds: 118, duration: 120, completed: true });
    const v = await db('product_content_views').where({ content_id: id, customer_id: c.customerId }).first();
    expect(v).toMatchObject({ progress_seconds: 118, completed: 1 });
    const an = await admin.get(`/api/admin/products/${pA.id}/content/analytics`);
    expect(an.body.views).toBeGreaterThanOrEqual(1);
    expect(an.body.uniqueViewers).toBeGreaterThanOrEqual(1);
    expect(an.body.mostViewed[0].views).toBeGreaterThanOrEqual(1);
    expect(an.body.categories.length).toBeGreaterThanOrEqual(1);
    // staff previews are not counted
    await admin.post(`/api/content/items/${id}/play`, { preview: true });
    expect(await db('product_content_views').where({ content_id: id, customer_id: null }).where('viewer_hash', 'like', 'u:%')).toHaveLength(0);
  });

  it('staff can preview unpublished content; customers cannot', async () => {
    const draft = await admin.post(`/api/admin/products/${pA.id}/content/items`, item({ title: 'Draft preview', status: 'draft' }));
    const id = draft.body.savedId;
    expect((await admin.get(`/api/content/products/${pA.slug}/items/${id}?preview=1`)).status).toBe(200);
    expect((await admin.post(`/api/content/items/${id}/play`, { preview: true })).body.kind).toBe('stream');
    const c = await customer();
    expect((await c.get(`/api/content/products/${pA.slug}/items/${id}?preview=1`)).status).toBe(404);
    expect((await c.post(`/api/content/items/${id}/play`, { preview: true })).status).toBe(404);
  });

  it('content settings are admin-only and validated', async () => {
    const s = (await admin.get('/api/admin/content/settings')).body.settings;
    expect(s.defaultAccess).toBe('registered');
    expect((await viewer.put('/api/admin/content/settings', s)).status).toBe(403);
    expect((await admin.put('/api/admin/content/settings', { ...s, streamTokenMinutes: 1 })).status).toBe(422);
    expect((await admin.put('/api/admin/content/settings', { ...s, publishNewItems: true })).status).toBe(200);
    await admin.put('/api/admin/content/settings', s);
  });
});

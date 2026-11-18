import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, login } from './helpers';

/* About SCHLUSS puzzle story: per-offering settings in the Products Management Centre + the public story feed. */
type C = Awaited<ReturnType<typeof client>>;
let admin: C;
let editorNoRights: C;
let anon: C;
const stamp = Date.now();
const ids: Record<string, number> = {};
let imageId: number;
let pdfId: number;

const story = async () => {
  const r = await anon.get('/api/public/about-story');
  expect(r.status).toBe(200);
  return r.body as { story: Record<string, unknown>; pieces: { slug: string; title: string; description: string; puzzle: boolean; benefits: string[]; cover: string | null; image: string | null; problem: string | null; highlight: string | null; category: string }[] };
};
const mine = (p: { slug: string }[]) => p.filter((x) => x.slug.endsWith(`-${stamp}`));
const settings = (o: Partial<Record<string, unknown>> = {}) => ({ show: true, puzzle: true, order: 0, title: null, description: null, problem: null, highlight: null, coverMediaId: null, imageMediaId: null, ...o });

beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  const r = await createStaff(['read_only']);
  admin = await client();
  editorNoRights = await client();
  anon = await client();
  await login(admin, a.email, a.password);
  await login(editorNoRights, r.email, r.password);
  for (const [k, pub] of [['alpha', true], ['beta', true], ['gamma', true], ['draft', false]] as const) {
    const [id] = await db('products').insert({ name: `Story ${k}`, slug: `story-${k}-${stamp}`, short_description: `${k} short description`, status: 'available', is_published: pub });
    ids[k] = id;
  }
  await db('product_features').insert([
    { product_id: ids['alpha'], kind: 'feature', title: 'Feature one', sort_order: 1 },
    { product_id: ids['alpha'], kind: 'benefit', title: 'Saves hours every week', sort_order: 1 },
    { product_id: ids['beta'], kind: 'feature', title: 'Only a feature', sort_order: 1 },
  ]);
  [imageId] = await db('media').insert({ kind: 'image', title: 'about cover', disk: 'private', storage_key: 'images/x.png', mime: 'image/png', size_bytes: 10, visibility: 'staff' });
  [pdfId] = await db('media').insert({ kind: 'pdf', title: 'a pdf', disk: 'private', storage_key: 'docs/x.pdf', mime: 'application/pdf', size_bytes: 10, visibility: 'public' });
});
afterAll(async () => {
  await db('products').whereIn('id', Object.values(ids)).del();
  await db('media').whereIn('id', [imageId, pdfId]).del();
  await db.destroy();
});

describe('About SCHLUSS story', () => {
  it('nothing appears until an admin switches an offering on', async () => {
    const s = await story();
    expect(mine(s.pieces)).toHaveLength(0);
    expect(s.story['meaningTitle']).toBe('What does SCHLUSS mean?');
    expect(s.story['meaningMessage']).toBe('The final piece of the puzzle.');
    expect(s.story['moreTitle']).toBe('And more to come');
    expect(s.story['enabled']).toBe(true);
    expect(s.story['image']).toBeNull(); // the built-in SCHLUSS picture is used
    expect(s.story['timing']).toEqual({ approach: 1.5, tileIn: 0.7, view: 5, tileOut: 0.6, place: 1.5 });
  });

  it('admin settings: permission, validation, images made public', async () => {
    expect((await editorNoRights.put(`/api/admin/products/${ids['alpha']}/about`, settings())).status).toBe(403);
    expect((await admin.put(`/api/admin/products/${ids['alpha']}/about`, settings({ order: -1 }))).status).toBe(422);
    expect((await admin.put(`/api/admin/products/${ids['alpha']}/about`, settings({ coverMediaId: pdfId }))).status).toBe(400);
    expect((await admin.put('/api/admin/products/99999999/about', settings())).status).toBe(404);
    const r = await admin.put(`/api/admin/products/${ids['alpha']}/about`, settings({ order: 20, title: 'Alpha – the stock piece', description: 'Custom puzzle text', problem: 'Stock counts never match', highlight: 'Most popular', coverMediaId: imageId }));
    expect(r.status).toBe(200);
    expect(r.body.about_show).toBe(true);
    expect(r.body.aboutCover).toMatch(/^\/api\/media\//);
    expect((await db('media').where({ id: imageId }).first('visibility')).visibility).toBe('public');
    expect(await db('audit_logs').where({ action: 'product.about_updated', subject_id: String(ids['alpha']) }).first('id')).toBeTruthy();
  });

  it('follows the admin order, uses the puzzle text or falls back to the product text', async () => {
    await admin.put(`/api/admin/products/${ids['beta']}/about`, settings({ order: 10 }));
    await admin.put(`/api/admin/products/${ids['gamma']}/about`, settings({ order: 30, puzzle: false }));
    await admin.put(`/api/admin/products/${ids['draft']}/about`, settings({ order: 5 }));
    const p = mine((await story()).pieces);
    expect(p.map((x) => x.slug)).toEqual([`story-beta-${stamp}`, `story-alpha-${stamp}`, `story-gamma-${stamp}`]); // draft never shows
    const [beta, alpha, gamma] = p;
    expect(alpha).toMatchObject({ title: 'Alpha – the stock piece', description: 'Custom puzzle text', problem: 'Stock counts never match', highlight: 'Most popular', benefits: ['Saves hours every week'], puzzle: true });
    expect(alpha.cover).toMatch(/-about$/);
    expect(beta).toMatchObject({ title: `Story beta`, description: 'beta short description', benefits: ['Only a feature'], problem: null });
    expect(gamma.puzzle).toBe(false); // listed on the page, no puzzle piece
  });

  it('reordering, hiding and unpublishing take effect without code changes', async () => {
    await admin.put(`/api/admin/products/${ids['beta']}/about`, settings({ order: 50 }));
    let p = mine((await story()).pieces).map((x) => x.slug);
    expect(p[p.length - 1]).toBe(`story-beta-${stamp}`);
    await admin.put(`/api/admin/products/${ids['alpha']}/about`, settings({ show: false }));
    p = mine((await story()).pieces).map((x) => x.slug);
    expect(p).not.toContain(`story-alpha-${stamp}`);
    expect(await db('products').where({ id: ids['alpha'] }).first('id')).toBeTruthy(); // hidden, not deleted
    await db('products').where({ id: ids['beta'] }).update({ is_published: false });
    expect(mine((await story()).pieces).map((x) => x.slug)).toEqual([`story-gamma-${stamp}`]);
  });

  it('the fixed first and last pieces, picture, timing and on/off live in Website content', async () => {
    const cur = (await admin.get('/api/admin/site-content')).body.story;
    expect((await admin.put('/api/admin/site-content/story', { ...cur, meaningTitle: '' })).status).toBe(422);
    expect((await admin.put('/api/admin/site-content/story', { ...cur, timing: { ...cur.timing, view: 1 } })).status).toBe(422);
    expect((await admin.put('/api/admin/site-content/story', { ...cur, imageMediaId: pdfId })).status).toBe(400);
    const r = await admin.put('/api/admin/site-content/story', { ...cur, moreTitle: 'And much more to come', imageMediaId: imageId, timing: { ...cur.timing, view: 8 } });
    expect(r.status).toBe(200);
    let s = (await story()).story;
    expect(s['moreTitle']).toBe('And much more to come');
    expect(s['image']).toMatch(/^\/api\/media\/\d+\//);
    expect(s['imageMediaId']).toBeUndefined();
    expect((s['timing'] as { view: number }).view).toBe(8);
    // the picture cannot be deleted while the puzzle uses it
    expect((await admin.del(`/api/admin/media/${imageId}`)).status).toBe(409);
    // switched off: no pieces are sent
    await admin.put('/api/admin/site-content/story', { ...cur, enabled: false });
    expect(mine((await story()).pieces)).toHaveLength(0);
    await admin.del('/api/admin/site-content/story');
    s = (await story()).story;
    expect(s['moreTitle']).toBe('And more to come');
    expect(s['enabled']).toBe(true);
  });

  it('one screen chooses, orders and describes the pieces (bulk)', async () => {
    const list = (await admin.get('/api/admin/about-experience/products')).body as { id: number; show: boolean }[];
    expect(list.find((x) => x.id === ids['gamma'])).toBeTruthy();
    expect((await editorNoRights.put('/api/admin/about-experience/products', { items: [] })).status).toBe(403);
    expect((await admin.put('/api/admin/about-experience/products', { items: [{ id: 99999999, show: true, order: 1 }] })).status).toBe(404);
    await db('products').where({ id: ids['beta'] }).update({ is_published: true });
    const r = await admin.put('/api/admin/about-experience/products', { items: [
      { id: ids['gamma'], show: true, order: 1, description: 'Gamma in one line', tagline: 'Fast' },
      { id: ids['beta'], show: true, order: 2 },
      { id: ids['alpha'], show: false, order: 3 },
    ] });
    expect(r.status).toBe(200);
    const p = mine((await story()).pieces);
    expect(p.map((x) => x.slug)).toEqual([`story-gamma-${stamp}`, `story-beta-${stamp}`]);
    expect(p[0]).toMatchObject({ description: 'Gamma in one line', puzzle: true });
    expect((p[0] as unknown as { tagline: string }).tagline).toBe('Fast');
  });
});

import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { parsePlaylistLink, unsupportedListReason } from '../../server/api/services/youtube-playlist';
import { client, createStaff, login } from './helpers';

/*
 * YouTube is not reachable from the test environment, so the YouTube endpoints (playlist feed, Data API,
 * oEmbed and thumbnails) are answered by a fake that returns the same formats YouTube returns.
 * Everything else (the SCHLUSS API, database, cover processing) is real.
 */
type C = Awaited<ReturnType<typeof client>>;
let admin: C;
let readOnly: C;
let product: { id: number; slug: string };
const realFetch = globalThis.fetch;
const LIST = 'PLtest_playlist_0001';
const vids = ['aaaaaaaaaa1', 'bbbbbbbbbb2', 'ccccccccc_3', 'ddddddddd-4'];
let feedVideos = vids.slice(0, 3);
const notEmbeddable = new Set(['bbbbbbbbbb2']);
const calls: string[] = [];
let thumb: Buffer;

const feed = (ids: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <yt:playlistId>${LIST}</yt:playlistId><title>Stocktake &amp; Setup Tutorials</title>
 ${ids.map((id, n) => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>Lesson ${n + 1} &amp; more</title><media:group><media:title>Lesson ${n + 1}</media:title><media:description>About lesson ${n + 1}</media:description></media:group></entry>`).join('\n')}
</feed>`;

function fakeYouTube(input: string | URL | Request, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const u = new URL(url);
  if (!/youtube\.com|googleapis\.com|ytimg\.com/.test(u.hostname)) return realFetch(input, init);
  calls.push(url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/feeds/videos.xml') {
    return Promise.resolve(u.searchParams.get('playlist_id') === LIST ? new Response(feed(feedVideos), { status: 200 }) : new Response('', { status: 404 }));
  }
  if (u.pathname === '/oembed') {
    const v = new URL(u.searchParams.get('url')!).searchParams.get('v')!;
    return Promise.resolve(notEmbeddable.has(v) ? new Response('Unauthorized', { status: 401 }) : json({ title: `T ${v}`, thumbnail_url: 'x' }));
  }
  if (u.hostname.endsWith('ytimg.com')) {
    // Only the 4:3 "hqdefault" exists, like many older videos.
    return Promise.resolve(u.pathname.endsWith('/hqdefault.jpg') ? new Response(new Uint8Array(thumb), { status: 200 }) : new Response('', { status: 404 }));
  }
  // YouTube Data API v3
  if (u.searchParams.get('key') !== 'test-key') return Promise.resolve(json({ error: { errors: [{ reason: 'keyInvalid' }] } }, 400));
  if (u.pathname.endsWith('/playlists')) return Promise.resolve(json({ items: u.searchParams.get('id') === LIST ? [{ snippet: { title: 'Full course playlist' } }] : [] }));
  if (u.pathname.endsWith('/playlistItems')) {
    const all = Array.from({ length: 60 }, (_, n) => `vid${String(n).padStart(8, '0')}`);
    const page = u.searchParams.get('pageToken') === 'p2' ? 1 : 0;
    const slice = all.slice(page * 50, page * 50 + 50);
    return Promise.resolve(json({ pageInfo: { totalResults: 60 }, nextPageToken: page ? undefined : 'p2', items: slice.map((id, n) => ({ snippet: { title: `API video ${page * 50 + n + 1}`, description: '', position: page * 50 + n, resourceId: { videoId: id } }, status: { privacyStatus: id === 'vid00000003' ? 'private' : 'public' } })) }));
  }
  if (u.pathname.endsWith('/videos')) {
    const ids = u.searchParams.get('id')!.split(',');
    return Promise.resolve(json({ items: ids.filter((id) => id !== 'vid00000003').map((id) => ({ id, contentDetails: { duration: 'PT4M30S' }, status: { embeddable: id !== 'vid00000005', privacyStatus: 'public' } })) }));
  }
  return Promise.resolve(new Response('', { status: 404 }));
}

beforeAll(async () => {
  thumb = await sharp({ create: { width: 480, height: 360, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
  globalThis.fetch = fakeYouTube as typeof fetch;
  delete process.env['YOUTUBE_API_KEY'];
  const a = await createStaff(['super_admin']);
  const r = await createStaff(['read_only']);
  admin = await client();
  readOnly = await client();
  await login(admin, a.email, a.password);
  await login(readOnly, r.email, r.password);
  const slug = `playlist-product-${Date.now()}`;
  const [id] = await db('products').insert({ name: 'Playlist product', slug, short_description: 'x', status: 'available', is_published: true });
  product = { id, slug };
});
afterEach(() => {
  delete process.env['YOUTUBE_API_KEY'];
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.destroy();
});

const url = `https://www.youtube.com/playlist?list=${LIST}`;

describe('playlist links', () => {
  it('recognises playlist ("folder") links and refuses personal lists and mixes', () => {
    expect(parsePlaylistLink(url)).toBe(LIST);
    expect(parsePlaylistLink(`https://youtube.com/watch?v=aaaaaaaaaa1&list=${LIST}&index=2`)).toBe(LIST);
    expect(parsePlaylistLink('https://m.youtube.com/playlist?list=PLabc')).toBe('PLabc');
    expect(parsePlaylistLink('https://www.youtube.com/watch?v=aaaaaaaaaa1')).toBeNull();
    expect(parsePlaylistLink('https://vimeo.com/123456789')).toBeNull();
    expect(unsupportedListReason('WL')).toMatch(/private/);
    expect(unsupportedListReason('RDaaaaaaaaaa1')).toMatch(/Mix/);
    expect(unsupportedListReason(LIST)).toBeNull();
  });

  it('a playlist link pasted as a single video gives a helpful message', async () => {
    const r = await admin.post('/api/admin/content/check-link', { url });
    expect(r.status).toBe(422);
    expect(r.body.error.details.fields.url).toMatch(/Import YouTube playlist/);
    const c = await admin.post(`/api/admin/products/${product.id}/content/items`, { title: 'X video', contentType: 'video', provider: 'youtube', url, tags: [] });
    expect(c.status).toBe(422);
  });
});

describe('import without an API key (public feed, up to 15 videos)', () => {
  let categoryId: number;
  it('previews the playlist with embedding checks', async () => {
    const r = await admin.post(`/api/admin/products/${product.id}/content/playlist/preview`, { url });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Stocktake & Setup Tutorials');
    expect(r.body.source).toBe('feed');
    expect(r.body.videos.map((v: { videoId: string }) => v.videoId)).toEqual(vids.slice(0, 3));
    expect(r.body.videos[1].embeddable).toBe(false);
    expect(r.body.videos[0].embeddable).toBe(true);
    expect(r.body.videos[0].title).toBe('Lesson 1 & more');
    expect(await db('product_content_items').where({ product_id: product.id }).count({ n: '*' }).first()).toMatchObject({ n: 0 }); // preview saves nothing
  });

  it('imports the chosen videos in playlist order into a new category, with covers; unembeddable ones stay drafts', async () => {
    const r = await admin.post(`/api/admin/products/${product.id}/content/playlist/import`, { url, videoIds: vids.slice(0, 3), target: 'new', contentType: 'tutorial', covers: true, publish: true });
    expect(r.status).toBe(201);
    expect(r.body.import).toMatchObject({ imported: 3, published: 2, drafts: 1, skipped: 0, noCover: 0 });
    expect(r.body.import.problems[0]).toMatch(/Lesson 2/);
    categoryId = r.body.import.categoryId;
    const cat = await db('product_content_categories').where({ id: categoryId }).first();
    expect(cat.name).toBe('Stocktake & Setup Tutorials');
    expect(cat.source_playlist).toBe(LIST);
    const items = await db('product_content_items').where({ category_id: categoryId }).orderBy('display_order');
    expect(items.map((i) => i.video_reference)).toEqual(vids.slice(0, 3));
    expect(items.map((i) => i.status)).toEqual(['published', 'draft', 'published']);
    expect(items.every((i) => i.content_type === 'tutorial' && i.source_playlist === LIST && i.cover_media_id)).toBe(true);
    // The 4:3 YouTube thumbnail was cut to a 16:9 cover.
    const media = await db('media').where({ id: items[0].cover_media_id }).first();
    const meta = typeof media.meta === 'string' ? JSON.parse(media.meta) : media.meta;
    expect([meta.width, meta.height]).toEqual([480, 270]);
    expect(media.visibility).toBe('staff');
    // Customers see the two published lessons.
    const lib = await (await client()).get(`/api/content/products/${product.slug}/library`);
    expect(lib.status).toBe(200);
    expect(lib.body.locked.count).toBe(2); // product default: registered customers
  });

  it('importing again only adds new videos (no duplicates) to the same category', async () => {
    feedVideos = vids;
    const p = await admin.post(`/api/admin/products/${product.id}/content/playlist/preview`, { url });
    expect(p.body.existingCategory.id).toBe(categoryId);
    expect(p.body.videos.filter((v: { existingId: number | null }) => v.existingId)).toHaveLength(3);
    const r = await admin.post(`/api/admin/products/${product.id}/content/playlist/import`, { url, videoIds: vids, target: 'existing', categoryId, covers: false, publish: false });
    expect(r.body.import).toMatchObject({ imported: 1, skipped: 3 });
    const items = await db('product_content_items').where({ category_id: categoryId }).orderBy('display_order');
    expect(items.map((i) => i.video_reference)).toEqual(vids);
    expect(items[3].status).toBe('draft');
  });

  it('a missing or private playlist gives a clear message; mixes are refused', async () => {
    const r = await admin.post(`/api/admin/products/${product.id}/content/playlist/preview`, { url: 'https://www.youtube.com/playlist?list=PLmissing' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/private or deleted/);
    const m = await admin.post(`/api/admin/products/${product.id}/content/playlist/preview`, { url: 'https://www.youtube.com/watch?v=aaaaaaaaaa1&list=RDaaaaaaaaaa1' });
    expect(m.status).toBe(422);
  });

  it('read-only staff cannot import', async () => {
    const r = await readOnly.post(`/api/admin/products/${product.id}/content/playlist/import`, { url, videoIds: vids, target: 'none' });
    expect(r.status).toBe(403);
  });
});

describe('import with YOUTUBE_API_KEY (whole playlist)', () => {
  it('reads every page, durations and private / non-embeddable videos', async () => {
    process.env['YOUTUBE_API_KEY'] = 'test-key';
    const r = await admin.post(`/api/admin/products/${product.id}/content/playlist/preview`, { url });
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('api');
    expect(r.body.title).toBe('Full course playlist');
    expect(r.body.videos).toHaveLength(60);
    expect(r.body.complete).toBe(true);
    expect(r.body.videos[0].durationSeconds).toBe(270);
    expect(r.body.videos[3].embeddable).toBe(false);
    expect(r.body.videos[3].problem).toMatch(/private/);
    expect(r.body.videos[5].problem).toMatch(/embedding/);
    // The key never reaches the browser.
    expect(JSON.stringify(r.body)).not.toContain('test-key');
  });

  it('a wrong key is reported clearly', async () => {
    process.env['YOUTUBE_API_KEY'] = 'wrong';
    const r = await admin.post(`/api/admin/products/${product.id}/content/playlist/preview`, { url });
    expect(r.status).toBe(502);
    expect(r.body.error.message).toMatch(/API key/);
  });
});

describe('running order (drag and drop)', () => {
  it('saves category order and moves items between categories in one step', async () => {
    const ov = (await admin.get(`/api/admin/products/${product.id}/content`)).body;
    const c2 = (await admin.post(`/api/admin/products/${product.id}/content/categories`, { name: 'Second' })).body.categories.at(-1).id;
    const first = ov.categories[0].id;
    const ids = ov.items.filter((i: { category_id: number }) => i.category_id === first).sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order).map((i: { id: number }) => i.id);
    const uncategorised = ov.items.filter((i: { category_id: number | null }) => !i.category_id).map((i: { id: number }) => i.id);
    const body = { categories: [c2, first], groups: [{ categoryId: c2, ids: [ids[3], ids[0]] }, { categoryId: first, ids: [ids[2], ids[1]] }, { categoryId: null, ids: uncategorised }] };
    const r = await admin.put(`/api/admin/products/${product.id}/content/layout`, body);
    expect(r.status).toBe(200);
    expect(r.body.categories.map((c: { id: number }) => c.id)).toEqual([c2, first]);
    const inC2 = await db('product_content_items').where({ category_id: c2 }).orderBy('display_order').pluck('id');
    expect(inC2).toEqual([ids[3], ids[0]]);
    const inFirst = await db('product_content_items').where({ category_id: first }).orderBy('display_order').pluck('id');
    expect(inFirst).toEqual([ids[2], ids[1]]);
    // The customer page follows the same order.
    const lib = await (await client()).get(`/api/content/products/${product.slug}/library`);
    expect(lib.status).toBe(200);
  });

  it('refuses an incomplete or foreign list (nothing is changed)', async () => {
    const ov = (await admin.get(`/api/admin/products/${product.id}/content`)).body;
    const cats = ov.categories.map((c: { id: number }) => c.id);
    const r = await admin.put(`/api/admin/products/${product.id}/content/layout`, { categories: cats, groups: [{ categoryId: cats[0], ids: [ov.items[0].id] }] });
    expect(r.status).toBe(400);
    const r2 = await admin.put(`/api/admin/products/${product.id}/content/layout`, { categories: cats, groups: [{ categoryId: cats[0], ids: [...ov.items.map((i: { id: number }) => i.id), 999999] }] });
    expect(r2.status).toBe(400);
    const r3 = await readOnly.put(`/api/admin/products/${product.id}/content/layout`, { categories: cats, groups: [] });
    expect(r3.status).toBe(403);
  });
});

describe('videos not showing on the product page (drafts)', () => {
  let prod: { id: number; slug: string };
  beforeAll(async () => {
    const slug = `visibility-${Date.now()}`;
    const [id] = await db('products').insert({ name: 'Visibility product', slug, short_description: 'x', status: 'available', is_published: true, content_access: 'public' });
    prod = { id, slug };
    feedVideos = vids.slice(0, 3);
  });

  it('a single YouTube link without a cover gets its thumbnail as cover and can be published straight away', async () => {
    const r = await admin.post(`/api/admin/products/${prod.id}/content/items`, { title: 'Single link', contentType: 'video', provider: 'youtube', url: 'https://youtu.be/aaaaaaaaaa1', tags: [], status: 'published' });
    expect(r.status).toBe(201);
    const item = await db('product_content_items').where({ id: r.body.savedId }).first();
    expect(item.status).toBe('published');
    expect(item.cover_media_id).toBeTruthy();
    const lib = await (await client()).get(`/api/content/products/${prod.slug}/library`);
    expect(lib.body.total).toBe(1);
    expect(lib.body.staffNotice).toBeNull();
  });

  it('drafts are explained to staff (admin and product page) and can be published in one click', async () => {
    await admin.post(`/api/admin/products/${prod.id}/content/playlist/import`, { url, videoIds: vids.slice(0, 3), target: 'new', covers: false, publish: false });
    const ov = (await admin.get(`/api/admin/products/${prod.id}/content`)).body;
    // The first playlist video is already in the library (added as a single link), so 2 drafts are imported.
    expect(ov.visibility.drafts).toBe(2);
    // Links without covers count as ready (their thumbnail is used); the non-embeddable one does not.
    expect(ov.visibility.readyDraftIds).toHaveLength(1);
    expect(ov.visibility.draftsNotEmbeddable).toBe(1);
    // Visitors only see the published single video; staff get the reason.
    expect((await (await client()).get(`/api/content/products/${prod.slug}/library`)).body.total).toBe(1);
    const staffLib = (await admin.get(`/api/content/products/${prod.slug}/library`)).body;
    expect(staffLib.staffNotice).toMatch(/2 videos are drafts/);
    expect((await (await client()).get(`/api/content/products/${prod.slug}/library`)).body.staffNotice).toBeNull();
    // "Publish what is ready" – including the non-embeddable one, which is skipped rather than blocking the rest.
    const all = ov.items.filter((i: { status: string }) => i.status === 'draft').map((i: { id: number }) => i.id);
    const r = await admin.post(`/api/admin/products/${prod.id}/content/items/bulk`, { ids: all, action: 'publish', skipProblems: true });
    expect(r.status).toBe(200);
    expect(r.body.skipped).toHaveLength(1);
    expect(r.body.visibility.drafts).toBe(1);
    const lib = (await (await client()).get(`/api/content/products/${prod.slug}/library`)).body;
    expect(lib.total).toBe(2);
    expect(await db('product_content_items').where({ product_id: prod.id, video_reference: 'ccccccccc_3' }).whereNotNull('cover_media_id').count({ n: '*' }).first()).toMatchObject({ n: 1 });
    // Without skipProblems the old all-or-nothing rule still applies.
    const strict = await admin.post(`/api/admin/products/${prod.id}/content/items/bulk`, { ids: all, action: 'publish' });
    expect(strict.status).toBe(400);
  });

  it('switching the Videos feature off is explained to staff', async () => {
    await db('products').where({ id: prod.id }).update({ offering_type: 'software', features: JSON.stringify({ installer: true, demo: false, trial: false, pricing: true, purchase: true, learning: false }) });
    expect((await admin.get(`/api/admin/products/${prod.id}/content`)).body.visibility.learningOn).toBe(false);
    expect((await admin.get(`/api/content/products/${prod.slug}/library`)).body.staffNotice).toMatch(/switched off/);
    expect((await (await client()).get(`/api/content/products/${prod.slug}/library`)).body.total).toBe(0);
  });
});

describe('cover files missing from the storage folder (site files replaced without it)', () => {
  it('link-video covers are recreated from the thumbnails – on request and from the admin', async () => {
    const { unlink } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const slug = `covers-${Date.now()}`;
    const [pid] = await db('products').insert({ name: 'Cover product', slug, short_description: 'x', status: 'available', is_published: true, content_access: 'public' });
    feedVideos = vids.slice(0, 3);
    notEmbeddable.clear();
    await admin.post(`/api/admin/products/${pid}/content/playlist/import`, { url, videoIds: vids.slice(0, 3), target: 'new', covers: true, publish: true });
    const items = await db('product_content_items').where({ product_id: pid }).orderBy('id');
    expect(items.every((i) => i.cover_media_id && i.status === 'published')).toBe(true);
    const anon = await client();
    expect((await anon.get(`/api/content/covers/${items[0].id}`)).status).toBe(200);
    // Lose the files (what happens when the project folder is replaced without "storage").
    const root = process.env['STORAGE_DIR'] || join(process.cwd(), 'storage');
    for (const m of await db('media').whereIn('id', items.map((i) => i.cover_media_id))) await unlink(join(root, m.storage_key));

    const ov = (await admin.get(`/api/admin/products/${pid}/content`)).body;
    expect(ov.visibility.coversMissing).toBe(3);
    expect(ov.visibility.coversRestorable).toHaveLength(3);
    expect(ov.items[0].coverPreview).toBeNull(); // no broken image in the admin
    expect(ov.items[0].coverMissing).toBe(true);

    // A visitor asking for one cover gets it back (recreated on the spot)...
    const one = await anon.get(`/api/content/covers/${items[0].id}`);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toMatch(/^image\//);
    // ...and the admin restores the rest in one go.
    const r = await admin.post(`/api/admin/products/${pid}/content/covers/restore`, {});
    expect(r.body.restore).toMatchObject({ missing: 2, restored: 2 });
    expect(r.body.visibility.coversMissing).toBe(0);
    for (const i of items) expect((await anon.get(`/api/content/covers/${i.id}`)).status).toBe(200);
    expect((await readOnly.post(`/api/admin/products/${pid}/content/covers/restore`, {})).status).toBe(403);
  });
});

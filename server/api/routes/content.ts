import { Router, type Request } from 'express';
import { readFile, unlink } from 'node:fs/promises';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, badRequest, HttpError, notFound, parse } from '../http';
import { can, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { mediaUrl } from '../services/catalogue';
import { allows, checkLink, CONTENT_TYPES, contentSettings, embedUrl, imageTool, Level, LEVELS, levelOf, lockedReason, optimiseCover, parseVideoLink, playbackBinding, providerWarning, TYPE_LABEL, viewerFor, viewerKey, watchUrl } from '../services/content';
import { featuresOf } from '../services/offerings';
import { FILE_TYPES, inspectUpload, readToken, setSetting, signToken, TMP_DIR } from '../services/platform';
import { fileStat, readStream, saveFile } from '../services/storage';
import { MAX_VIDEOS, parsePlaylistLink, PlaylistError, readPlaylist, thumbnailCover, thumbnailUrl, unsupportedListReason, youtubeApiKey } from '../services/youtube-playlist';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;
const num = (v: unknown) => Number(v ?? 0);

/** Public (customer-facing) content library: cards, viewer, playback, progress. Mounted at /api/content. */
export const contentRouter = Router();
/** Admin content management. Mounted at /api/admin. */
export const adminContentRouter = Router();

/* ======================================================================================
 * Shared lookups
 * ====================================================================================== */
async function productBySlug(slug: string, req: Request) {
  const p = await db('products').where({ slug: String(slug).slice(0, 180) }).first('id', 'name', 'slug', 'content_access', 'is_published', 'is_archived', 'offering_type', 'features');
  if (!p) throw notFound('Product not found.');
  // Unpublished products: only staff (preview).
  if ((!p.is_published || p.is_archived) && !(req.auth?.user.type === 'staff' && can(req, 'products.view'))) throw notFound('Product not found.');
  return p;
}

const coverUrl = (item: { id: number; cover_media_id: number | null; updated_at?: Date | string }) => (item.cover_media_id ? `/api/content/covers/${item.id}?v=${item.cover_media_id}` : null);

function card(i: Row, categoryName: string | null) {
  return { id: i.id, title: i.title, description: i.description, type: i.content_type, typeLabel: TYPE_LABEL[i.content_type] ?? 'Video', duration: i.duration_seconds, cover: coverUrl(i), category: categoryName, provider: i.video_provider === 'upload' ? 'secure' : i.video_provider, status: i.status };
}

/** Published items of a product the viewer may open (staff preview: everything, incl. drafts when preview=1). */
async function visibleItems(req: Request, product: Row, preview: boolean) {
  const s = await contentSettings();
  const v = await viewerFor(req, product.id);
  const q = db('product_content_items as i').leftJoin('product_content_categories as c', 'c.id', 'i.category_id').where('i.product_id', product.id).where((w) => w.whereNull('c.id').orWhere('c.product_id', product.id));
  if (!(preview && v.staff)) q.where('i.status', 'published').where((w) => w.whereNull('c.id').orWhere('c.status', 'active'));
  const items = (await q.orderBy([{ column: 'c.display_order' }, { column: 'c.id' }, { column: 'i.display_order' }, { column: 'i.id' }]).select('i.*', 'c.name as category_name', 'c.description as category_description', 'c.display_order as category_order')) as Row[];
  const enabled = s.providers as Record<string, boolean>;
  // An offering with the "Learning content" feature switched off shows no content (staff can still preview).
  const learningOn = featuresOf(product).learning || (preview && v.staff);
  const usable = learningOn ? items.filter((i) => enabled[i.video_provider] !== false && (i.video_provider === 'upload' ? !!i.video_media_id : !!i.video_reference)) : [];
  const withLevel = usable.map((i) => ({ ...i, level: levelOf(i, product, s.defaultAccess as Level) }));
  return { viewer: v, allowed: withLevel.filter((i) => allows(i.level, v)), locked: withLevel.filter((i) => !allows(i.level, v)), settings: s };
}

/* ======================================================================================
 * Customer-facing
 * ====================================================================================== */

/** The product's library: categories with cover cards. Only content the viewer may open is listed. */
contentRouter.get(
  '/products/:slug/library',
  ah(async (req, res) => {
    const product = await productBySlug(String(req.params['slug']), req);
    const preview = req.query['preview'] === '1';
    const { viewer, allowed, locked, settings } = await visibleItems(req, product, preview);
    const groups = new Map<string, { id: number | null; name: string; description: string | null; items: Row[] }>();
    for (const i of allowed) {
      const key = String(i.category_id ?? 'none');
      if (!groups.has(key)) groups.set(key, { id: i.category_id, name: i.category_name ?? 'More videos', description: i.category_description ?? null, items: [] });
      groups.get(key)!.items.push(card(i, i.category_name));
    }
    const lockedLevel = locked[0]?.level ?? null;
    // Learning progress for signed-in customers (per lesson: furthest point watched, completed).
    let progress: { completed: number; total: number } | null = null;
    if (viewer.customerId && allowed.length) {
      const rows = (await db('product_content_views').where({ customer_id: viewer.customerId }).whereIn('content_id', allowed.map((i) => i.id)).groupBy('content_id')
        .select('content_id', db.raw('MAX(percent) as percent'), db.raw('MAX(completed) as completed'))) as Row[];
      const by = new Map(rows.map((r) => [r.content_id, r]));
      for (const g of groups.values()) for (const c of g.items) { const r = by.get(c.id); c.watched = !!Number(r?.completed); c.percent = Number(r?.percent ?? 0); }
      progress = { completed: rows.filter((r) => Number(r.completed)).length, total: allowed.length };
    }
    // Staff looking at the live page: say plainly why content they added isn't listed for customers.
    let staffNotice: string | null = null;
    if (viewer.staff && !preview) staffNotice = await hiddenReason(product, settings);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      progress,
      staffNotice,
      product: { name: product.name, slug: product.slug },
      categories: [...groups.values()],
      total: allowed.length,
      locked: locked.length ? { count: locked.length, ...lockedReason(lockedLevel as Level, viewer, product.name) } : null,
      preview: preview && viewer.staff,
      defaultAccess: settings.defaultAccess,
    });
  }),
);

/** Why content of a product isn't on the website (for staff): drafts, hidden categories, switched-off sources. Null when nothing is hidden. */
async function hiddenReason(product: Row, settings: Row): Promise<string | null> {
  const rows = (await db('product_content_items as i').leftJoin('product_content_categories as c', 'c.id', 'i.category_id').where('i.product_id', product.id).select('i.status', 'i.video_provider', 'i.video_reference', 'i.video_media_id', 'c.status as category_status')) as Row[];
  if (!rows.length) return null;
  const enabled = settings.providers as Record<string, boolean>;
  const parts: string[] = [];
  if (!featuresOf(product).learning) parts.push('the “Videos / lessons” feature is switched off for this offering');
  const drafts = rows.filter((r) => r.status !== 'published').length;
  const hiddenCat = rows.filter((r) => r.status === 'published' && r.category_status === 'hidden').length;
  const offSource = rows.filter((r) => r.status === 'published' && enabled[r.video_provider] === false).length;
  if (drafts) parts.push(`${drafts} ${drafts === 1 ? 'video is a draft' : 'videos are drafts'} (not published yet)`);
  if (hiddenCat) parts.push(`${hiddenCat} ${hiddenCat === 1 ? 'video is' : 'videos are'} in a hidden category`);
  if (offSource) parts.push(`${offSource} ${offSource === 1 ? 'video uses' : 'videos use'} a video source that is switched off in Video & content settings`);
  return parts.length ? `Only you (staff) see this: customers don’t see all of this product’s videos because ${parts.join('; ')}. Open the product in Admin › Products › Videos / lessons to publish them.` : null;
}

/** Viewer page data: details + previous/next within the same category. Never contains the video source. */
contentRouter.get(
  '/products/:slug/items/:id',
  ah(async (req, res) => {
    const product = await productBySlug(String(req.params['slug']), req);
    const id = Number(req.params['id']) || 0;
    const preview = req.query['preview'] === '1';
    const { viewer, allowed, locked } = await visibleItems(req, product, preview);
    const item = allowed.find((i) => i.id === id);
    if (!item) {
      const l = locked.find((i) => i.id === id);
      if (l) throw new HttpError(viewer.registered ? 403 : 401, lockedReason(l.level, viewer, product.name).message, 'content_locked');
      throw notFound('This video is not available.');
    }
    const siblings = allowed.filter((i) => (i.category_id ?? null) === (item.category_id ?? null));
    const at = siblings.findIndex((i) => i.id === id);
    const brief = (i: Row | undefined) => (i ? { id: i.id, title: i.title, cover: coverUrl(i), duration: i.duration_seconds } : null);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      ...card(item, item.category_name),
      tags: item.tags ? (typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags) : [],
      product: { name: product.name, slug: product.slug },
      position: { index: at + 1, of: siblings.length },
      previous: brief(siblings[at - 1]),
      next: brief(siblings[at + 1]),
      preview: preview && viewer.staff,
    });
  }),
);

/**
 * Start playback. Access is checked again here. Returns either the provider's official embed player URL
 * (YouTube/Vimeo) or a short-lived, session-bound streaming link for privately hosted videos – never a
 * file URL. Also records the view (once per viewer per window, so refreshing doesn't inflate counts).
 */
contentRouter.post(
  '/items/:id/play',
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const preview = req.body?.preview === true;
    const raw = await db('product_content_items').where({ id }).first('product_id');
    if (!raw) throw notFound('This video is not available.');
    const product = await db('products').where({ id: raw.product_id }).first('id', 'name', 'slug', 'content_access', 'is_published', 'is_archived', 'offering_type', 'features');
    const { viewer, allowed, locked, settings } = await visibleItems(req, await productBySlug(product.slug, req), preview);
    const item = allowed.find((i) => i.id === id);
    if (!item) {
      const l = locked.find((i) => i.id === id);
      if (l) throw new HttpError(viewer.registered ? 403 : 401, lockedReason(l.level, viewer, product.name).message, 'content_locked');
      throw notFound('This video is not available.');
    }
    let viewId: number | null = null;
    if (!viewer.staff) {
      const key = viewerKey(req);
      const recent = await db('product_content_views').where({ content_id: id, viewer_hash: key }).where('viewed_at', '>', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)', [settings.viewWindowMinutes])).orderBy('id', 'desc').first('id');
      viewId = recent?.id ?? (await db('product_content_views').insert({ content_id: id, product_id: product.id, customer_id: viewer.customerId, viewer_hash: key, viewed_at: db.raw('UTC_TIMESTAMP()') }))[0];
    }
    const progressToken = viewId ? signToken({ v: viewId, c: id }, 6 * 3600) : null;
    res.set('Cache-Control', 'private, no-store');
    if (item.video_provider === 'upload') {
      const m = await db('media').where({ id: item.video_media_id }).first('id', 'mime');
      if (!m) throw notFound('This video is not available.');
      const token = signToken({ i: id, m: m.id, b: playbackBinding(req), s: preview ? 1 : 0 }, settings.streamTokenMinutes * 60);
      res.json({ kind: 'stream', src: `/api/content/stream/${token}`, mime: m.mime, renewAfterSeconds: Math.max(60, settings.streamTokenMinutes * 60 - 60), progressToken });
      return;
    }
    res.json({ kind: 'embed', provider: item.video_provider, src: embedUrl(item.video_provider, item.video_reference), progressToken });
  }),
);

/**
 * Private video streaming. The link is short-lived, bound to the browser session that asked for it,
 * re-checks access (so revoked/expired access stops playback), supports seeking (HTTP Range), is never
 * cached, and refuses to open as a normal page (so “open/save video” from the address bar is blocked).
 */
const accessCache = new Map<string, number>();
contentRouter.get(
  '/stream/:token',
  ah(async (req, res) => {
    const t = readToken<{ i: number; m: number; b: string; s?: number }>(String(req.params['token']));
    if (!t) throw new HttpError(410, 'This playback link has expired. Reload the page to continue watching.', 'link_expired');
    if (t.b !== playbackBinding(req)) throw new HttpError(403, 'This playback link belongs to another browser session.', 'forbidden');
    const dest = req.get('sec-fetch-dest');
    if (dest && !['video', 'audio', 'empty'].includes(dest)) throw new HttpError(403, 'This video can only be watched on the SCHLUSS website.', 'forbidden');
    // Re-validate access at most once a minute per link (cheap enough for range requests).
    const ck = String(req.params['token']).slice(-24);
    if ((accessCache.get(ck) ?? 0) < Date.now() - 60_000) {
      const item = await db('product_content_items').where({ id: t.i }).first('product_id', 'video_media_id');
      if (!item || item.video_media_id !== t.m) throw notFound('This video is not available.');
      const product = await db('products').where({ id: item.product_id }).first('slug');
      const { allowed } = await visibleItems(req, await productBySlug(product.slug, req), !!t.s);
      if (!allowed.some((i) => i.id === t.i)) throw new HttpError(403, 'You no longer have access to this video.', 'content_locked');
      accessCache.set(ck, Date.now());
      if (accessCache.size > 5000) accessCache.clear();
    }
    const m = await db('media').where({ id: t.m }).first('storage_key', 'mime');
    const st = m?.storage_key ? await fileStat(m.storage_key) : null;
    if (!m || !st) throw notFound('This video is not available.');
    const size = st.size;
    const common = {
      'Content-Type': m.mime || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Robots-Tag': 'noindex, nofollow',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '');
    if (range) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (!range[1] && !range[2]) [start, end] = [0, size - 1];
      end = Math.min(end, size - 1, start + 8 * 1024 * 1024 - 1); // serve in chunks of at most 8 MB
      if (start < 0 || start >= size || end < start) {
        res.status(416).set({ 'Content-Range': `bytes */${size}` }).end();
        return;
      }
      res.status(206).set({ ...common, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
      readStream(m.storage_key, { start, end }).pipe(res);
      return;
    }
    res.status(200).set({ ...common, 'Content-Length': String(size) });
    readStream(m.storage_key).pipe(res);
  }),
);

/** Playback progress (sent by the viewer every ~15 s, on pause and at the end). */
contentRouter.post(
  '/views/:token/progress',
  ah(async (req, res) => {
    const t = readToken<{ v: number; c: number }>(String(req.params['token']));
    if (!t) {
      res.status(204).end();
      return;
    }
    const input = parse(z.object({ seconds: z.number().min(0).max(86400), duration: z.number().min(0).max(86400).nullable().optional(), completed: z.boolean().optional() }), req.body);
    const v = await db('product_content_views').where({ id: t.v, content_id: t.c }).first();
    if (!v) {
      res.status(204).end();
      return;
    }
    const duration = Math.round(input.duration || v.duration_seconds || 0) || null;
    const seconds = Math.max(v.progress_seconds, Math.round(input.seconds));
    const percent = duration ? Math.min(100, Math.round((seconds / duration) * 100)) : v.percent;
    const completed = !!v.completed || !!input.completed || percent >= 95;
    await db('product_content_views').where({ id: v.id }).update({ progress_seconds: seconds, duration_seconds: duration, percent, completed, last_progress_at: db.raw('UTC_TIMESTAMP()') });
    res.status(204).end();
  }),
);

/** Cover images, only for content the viewer may see (staff: all). */
contentRouter.get(
  '/covers/:id',
  ah(async (req, res) => {
    const item = await db('product_content_items as i').join('products as p', 'p.id', 'i.product_id').where('i.id', Number(req.params['id']) || 0).first('i.id', 'i.status', 'i.access_level', 'i.cover_media_id', 'p.id as product_id', 'p.content_access', 'p.is_published');
    if (!item?.cover_media_id) throw notFound();
    const v = await viewerFor(req, item.product_id);
    const s = await contentSettings();
    const level = levelOf(item, item, s.defaultAccess as Level);
    if (!v.staff && (item.status !== 'published' || !item.is_published || !allows(level, v))) throw notFound();
    let m = await db('media').where({ id: item.cover_media_id }).first('storage_key', 'mime', 'sha256');
    let st = m?.storage_key ? await fileStat(m.storage_key) : null;
    if (!st) {
      // The image file is gone from the storage folder: recreate it from the video's thumbnail (link videos only).
      const fresh = await restoreCover(item.id);
      m = fresh ? await db('media').where({ id: fresh }).first('storage_key', 'mime', 'sha256') : null;
      st = m?.storage_key ? await fileStat(m.storage_key) : null;
    }
    if (!st) throw notFound();
    res.set({ 'Content-Type': m.mime, 'Content-Length': String(st.size), 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': level === 'public' && item.status === 'published' ? 'public, max-age=86400' : 'private, max-age=3600' });
    readStream(m.storage_key).pipe(res);
  }),
);

/* ======================================================================================
 * Admin
 * ====================================================================================== */
const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' || v == null ? null : v));

async function productOr404(id: number) {
  const p = await db('products').where({ id }).first('id', 'name', 'slug', 'content_access', 'is_published', 'is_archived', 'offering_type', 'features');
  if (!p) throw notFound('Product not found.');
  return p;
}

/* ---- Cover files that are missing from the storage folder ---- */
const restoring = new Map<number, Promise<number | null>>();
/**
 * A YouTube/Vimeo item whose cover FILE is missing (e.g. the storage folder was not copied when the site was
 * updated or moved): make a new cover from the video's thumbnail. Returns the new media id, or null.
 * Uploaded-video items can't be restored this way – their cover has to be uploaded again.
 */
const restoreFailed = new Map<number, number>();
function restoreCover(itemId: number, force = false): Promise<number | null> {
  const running = restoring.get(itemId);
  if (running) return running;
  // A thumbnail that couldn't be downloaded is not tried again on every page view.
  if ((restoreFailed.get(itemId) ?? 0) > Date.now() - 10 * 60_000 && !force) return Promise.resolve(null);
  const job = (async () => {
    const i = await db('product_content_items').where({ id: itemId }).first('id', 'title', 'cover_media_id', 'video_provider', 'video_reference', 'embed_check', 'updated_by', 'created_by');
    if (!i || i.video_provider === 'upload') return null;
    if (i.cover_media_id) {
      const m = await db('media').where({ id: i.cover_media_id }).first('storage_key');
      if (m?.storage_key && (await fileStat(m.storage_key))) return i.cover_media_id as number; // already fine
    }
    const check = i.embed_check ? (typeof i.embed_check === 'string' ? JSON.parse(i.embed_check) : i.embed_check) : null;
    const cover = await automaticCover(i, check, i.title, i.updated_by ?? i.created_by);
    if (!cover) {
      restoreFailed.set(itemId, Date.now());
      return null;
    }
    restoreFailed.delete(itemId);
    await db('product_content_items').where({ id: i.id }).update({ cover_media_id: cover });
    return cover;
  })().finally(() => restoring.delete(itemId));
  restoring.set(itemId, job);
  return job;
}

/** Which files of a product's content are missing on disk. */
async function missingFiles(items: Row[]) {
  const ids = [...new Set(items.flatMap((i) => [i.cover_media_id, i.video_media_id]).filter(Boolean))] as number[];
  const media = ids.length ? await db('media').whereIn('id', ids).select('id', 'storage_key') : [];
  const gone = new Set<number>();
  await Promise.all(media.map(async (m: Row) => { if (!m.storage_key || !(await fileStat(m.storage_key))) gone.add(m.id); }));
  return gone;
}

/** For the admin: which items customers can't see, and which drafts are ready to publish in one click. */
async function visibilityReport(p: Row, s: Row, categories: Row[], items: Row[], gone: Set<number>) {
  const hiddenCats = new Set(categories.filter((c) => c.status === 'hidden').map((c) => c.id));
  const enabled = s.providers as Record<string, boolean>;
  const check = (i: Row) => (i.embed_check ? (typeof i.embed_check === 'string' ? JSON.parse(i.embed_check) : i.embed_check) : null);
  const drafts = items.filter((i) => i.status !== 'published');
  // Video links without a cover get their thumbnail when published, so they count as ready too.
  const ready = drafts.filter((i) => check(i)?.ok !== false && (!s.coverRequired || i.cover_media_id || i.video_provider !== 'upload'));
  return {
    learningOn: featuresOf(p).learning,
    drafts: drafts.length,
    readyDraftIds: ready.map((i) => i.id),
    draftsNeedingCover: drafts.filter((i) => s.coverRequired && !i.cover_media_id && i.video_provider === 'upload').length,
    draftsNotEmbeddable: drafts.filter((i) => check(i)?.ok === false).length,
    inHiddenCategories: items.filter((i) => i.status === 'published' && hiddenCats.has(i.category_id)).length,
    sourceOff: items.filter((i) => i.status === 'published' && enabled[i.video_provider] === false).length,
    productPublished: !!p.is_published && !p.is_archived,
    // Files that are in the database but no longer in the storage folder
    coversMissing: items.filter((i) => i.cover_media_id && gone.has(i.cover_media_id)).length,
    coversRestorable: items.filter((i) => i.cover_media_id && gone.has(i.cover_media_id) && i.video_provider !== 'upload').map((i) => i.id),
    videosMissing: items.filter((i) => i.video_provider === 'upload' && i.video_media_id && gone.has(i.video_media_id)).length,
  };
}

async function adminOverview(productId: number) {
  const p = await productOr404(productId);
  const s = await contentSettings();
  const [categories, items, viewsByItem] = await Promise.all([
    db('product_content_categories').where({ product_id: productId }).orderBy(['display_order', 'id']).select('*'),
    db('product_content_items as i').leftJoin('media as cm', 'cm.id', 'i.cover_media_id').leftJoin('media as vm', 'vm.id', 'i.video_media_id').where('i.product_id', productId).orderBy(['i.display_order', 'i.id'])
      .select('i.*', 'cm.original_name as cover_name', 'vm.original_name as video_name', 'vm.size_bytes as video_size'),
    db('product_content_views').where({ product_id: productId }).groupBy('content_id').select('content_id').count({ n: '*' }) as unknown as Promise<Row[]>,
  ]);
  const views = new Map(viewsByItem.map((r: Row) => [r.content_id, num(r.n)]));
  const gone = await missingFiles(items);
  const lastUpdated = [...items.map((i: Row) => i.updated_at), ...categories.map((c: Row) => c.updated_at)].sort().pop() ?? null;
  return {
    product: { id: p.id, name: p.name, slug: p.slug, contentAccess: p.content_access, effectiveAccess: p.content_access ?? s.defaultAccess },
    settings: { defaultAccess: s.defaultAccess, providers: s.providers, coverRequired: s.coverRequired, imageOptimisation: !!(await imageTool()) },
    stats: { total: items.length, published: items.filter((i: Row) => i.status === 'published').length, unpublished: items.filter((i: Row) => i.status !== 'published').length, categories: categories.length, lastUpdated },
    visibility: await visibilityReport(p, s, categories, items, gone),
    categories: categories.map((c: Row) => ({ ...c, items: items.filter((i: Row) => i.category_id === c.id).length })),
    items: items.map((i: Row) => ({
      ...i,
      tags: i.tags ? (typeof i.tags === 'string' ? JSON.parse(i.tags) : i.tags) : [],
      embed_check: i.embed_check ? (typeof i.embed_check === 'string' ? JSON.parse(i.embed_check) : i.embed_check) : null,
      coverPreview: i.cover_media_id && !gone.has(i.cover_media_id) ? mediaUrl(i.cover_media_id, 'cover') : null,
      coverMissing: !!i.cover_media_id && gone.has(i.cover_media_id),
      videoMissing: i.video_provider === 'upload' && !!i.video_media_id && gone.has(i.video_media_id),
      link: i.video_provider !== 'upload' && i.video_reference ? watchUrl(i.video_provider, i.video_reference) : null,
      views: views.get(i.id) ?? 0,
      warning: providerWarning(i.video_provider, levelOf(i, p, s.defaultAccess as Level)),
    })),
  };
}

adminContentRouter.get('/products/:id/content', requirePermission('products.view'), ah(async (req, res) => res.json(await adminOverview(Number(req.params['id']) || 0))));

adminContentRouter.put(
  '/products/:id/content/access',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const { access } = parse(z.object({ access: z.enum(['default', ...LEVELS] as [string, ...string[]]) }), req.body);
    await productOr404(id);
    await db('products').where({ id }).update({ content_access: access === 'default' ? null : access, updated_at: new Date() });
    await audit(req, { action: 'content.access_changed', subjectType: 'product', subjectId: id, after: { access } });
    res.json(await adminOverview(id));
  }),
);

/* ---- Categories ---- */
const catSchema = z.object({ name: z.string().trim().min(2, 'Enter a category name').max(120), description: optStr(500), status: z.enum(['active', 'hidden']).default('active') });

adminContentRouter.post('/products/:id/content/categories', requirePermission('products.manage'), ah(async (req, res) => {
  const id = Number(req.params['id']) || 0;
  const c = parse(catSchema, req.body);
  await productOr404(id);
  const max = await db('product_content_categories').where({ product_id: id }).max({ m: 'display_order' }).first();
  const [cid] = await db('product_content_categories').insert({ product_id: id, name: c.name, description: c.description, status: c.status, display_order: num(max?.m) + 1 });
  await audit(req, { action: 'content.category_created', subjectType: 'product', subjectId: id, meta: { categoryId: cid, name: c.name } });
  res.status(201).json(await adminOverview(id));
}));

async function categoryOr404(id: number) {
  const c = await db('product_content_categories').where({ id }).first();
  if (!c) throw notFound('Category not found.');
  return c;
}

adminContentRouter.put('/content/categories/:cid', requirePermission('products.manage'), ah(async (req, res) => {
  const cat = await categoryOr404(Number(req.params['cid']) || 0);
  const c = parse(catSchema, req.body);
  await db('product_content_categories').where({ id: cat.id }).update({ name: c.name, description: c.description, status: c.status, updated_at: new Date() });
  await audit(req, { action: 'content.category_updated', subjectType: 'product', subjectId: cat.product_id, before: { name: cat.name }, after: c });
  res.json(await adminOverview(cat.product_id));
}));

/** Delete a category. Its items are moved to another category, left uncategorised, or – only when explicitly chosen – deleted. */
adminContentRouter.post('/content/categories/:cid/delete', requirePermission('products.manage'), ah(async (req, res) => {
  const cat = await categoryOr404(Number(req.params['cid']) || 0);
  const input = parse(z.object({ items: z.enum(['move', 'uncategorise', 'delete']), targetCategoryId: z.number().int().nullable().optional(), confirm: z.literal(true, { message: 'Please confirm' }) }), req.body);
  const count = num((await db('product_content_items').where({ category_id: cat.id }).count({ n: '*' }).first())?.n);
  await db.transaction(async (trx) => {
    if (input.items === 'move') {
      const target = input.targetCategoryId ? await trx('product_content_categories').where({ id: input.targetCategoryId, product_id: cat.product_id }).first('id') : null;
      if (!target || target.id === cat.id) throw badRequest('Choose another category of this product to move the content to.');
      await trx('product_content_items').where({ category_id: cat.id }).update({ category_id: target.id, updated_at: new Date() });
    } else if (input.items === 'delete') {
      await trx('product_content_items').where({ category_id: cat.id }).del();
    } else {
      await trx('product_content_items').where({ category_id: cat.id }).update({ category_id: null, updated_at: new Date() });
    }
    await trx('product_content_categories').where({ id: cat.id }).del();
  });
  await audit(req, { action: 'content.category_deleted', subjectType: 'product', subjectId: cat.product_id, before: { name: cat.name, items: count }, meta: { items: input.items } });
  res.json(await adminOverview(cat.product_id));
}));

adminContentRouter.put('/products/:id/content/categories/order', requirePermission('products.manage'), ah(async (req, res) => {
  const id = Number(req.params['id']) || 0;
  const { ids } = parse(z.object({ ids: z.array(z.number().int()).max(500) }), req.body);
  const own = new Set((await db('product_content_categories').where({ product_id: id }).select('id')).map((c) => c.id));
  if (ids.some((x) => !own.has(x))) throw badRequest('One of the categories does not belong to this product.');
  await db.transaction(async (trx) => {
    for (const [i, cid] of ids.entries()) await trx('product_content_categories').where({ id: cid }).update({ display_order: i + 1 });
  });
  res.json(await adminOverview(id));
}));

/* ---- Items ---- */
const itemSchema = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(191),
  description: optStr(1000),
  contentType: z.enum(CONTENT_TYPES),
  categoryId: z.number().int().nullable().optional(),
  provider: z.enum(['youtube', 'vimeo', 'upload']),
  url: z.string().trim().max(500).optional(),
  videoMediaId: z.number().int().nullable().optional(),
  coverMediaId: z.number().int().nullable().optional(),
  durationSeconds: z.number().int().min(1).max(86400).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  status: z.enum(['draft', 'published']).optional(),
  accessLevel: z.enum(['inherit', ...LEVELS] as [string, ...string[]]).default('inherit'),
});

/** Validates the source and returns the columns to store, plus the link-test result. */
async function resolveSource(input: z.infer<typeof itemSchema>, previous?: Row) {
  const s = await contentSettings();
  if ((s.providers as Record<string, boolean>)[input.provider] === false) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { provider: 'This video source is switched off in Content settings.' } });
  if (input.provider === 'upload') {
    if (!input.videoMediaId) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { videoMediaId: 'Upload the video file (MP4 or WebM).' } });
    const m = await db('media').where({ id: input.videoMediaId }).first('id', 'kind', 'visibility');
    if (!m || m.kind !== 'video') throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { videoMediaId: 'Upload an MP4 or WebM video file.' } });
    if (m.visibility !== 'staff') await db('media').where({ id: m.id }).update({ visibility: 'staff' }); // never directly downloadable
    return { cols: { video_provider: 'upload', video_reference: null, video_media_id: m.id }, check: { ok: true, verified: true, message: 'Private video stored securely on the SCHLUSS server.', checkedAt: new Date().toISOString() } as Row };
  }
  const parsed = parseVideoLink(input.url ?? '');
  if (!parsed && parsePlaylistLink(input.url ?? '')) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: 'This is a YouTube playlist link. Use “Import YouTube playlist” to add all of its videos at once.' } });
  if (!parsed || parsed.provider !== input.provider) {
    throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: input.provider === 'youtube' ? 'Paste a YouTube video link, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/…' : 'Paste a Vimeo video link, e.g. https://vimeo.com/123456789 (private links: include the code after the number).' } });
  }
  const same = previous && previous.video_provider === parsed.provider && previous.video_reference === parsed.reference && previous.embed_check;
  const check = same ? (typeof previous.embed_check === 'string' ? JSON.parse(previous.embed_check) : previous.embed_check) : await checkLink(parsed);
  return { cols: { video_provider: parsed.provider, video_reference: parsed.reference, video_media_id: null }, check };
}

/**
 * No cover chosen for a YouTube/Vimeo video: use the video's own thumbnail (cropped to 16:9), so a video can be
 * published without first making a cover. The admin can replace it at any time.
 */
async function automaticCover(cols: { video_provider: string; video_reference: string | null }, check: Row, title: string, userId: number): Promise<number | null> {
  try {
    if (cols.video_provider === 'youtube' && cols.video_reference) {
      const buf = await thumbnailCover(cols.video_reference);
      return buf ? await storeCover(buf, title, userId) : null;
    }
    if (cols.video_provider === 'vimeo' && check?.thumbnail && /^https:\/\/i\.vimeocdn\.com\//.test(check.thumbnail)) {
      const r = await fetch(String(check.thumbnail).replace(/_\d+(x\d+)?(?=\.|$|\?)/, '_1280x720'), { signal: AbortSignal.timeout(10000) });
      return r.ok ? await storeCover(Buffer.from(await r.arrayBuffer()), title, userId) : null;
    }
  } catch {
    /* no automatic cover – the admin can upload one */
  }
  return null;
}

async function assertPublishable(item: { cover_media_id: number | null; embed_check: Row; title: string }) {
  const s = await contentSettings();
  const check = typeof item.embed_check === 'string' ? JSON.parse(item.embed_check) : item.embed_check;
  if (check && check.ok === false) throw badRequest(`“${item.title}” can’t be published: ${check.message}`);
  if (s.coverRequired && !item.cover_media_id) throw badRequest(`“${item.title}” needs a cover image before it can be published.`);
}

async function categoryForProduct(categoryId: number | null | undefined, productId: number) {
  if (!categoryId) return null;
  const c = await db('product_content_categories').where({ id: categoryId, product_id: productId }).first('id');
  if (!c) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { categoryId: 'Choose a category of this product.' } });
  return c.id;
}

async function coverOk(mediaId: number | null | undefined) {
  if (!mediaId) return null;
  const m = await db('media').where({ id: mediaId }).first('id', 'kind');
  if (!m || m.kind !== 'image') throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { coverMediaId: 'Upload a JPG, PNG or WebP cover image.' } });
  return m.id;
}

adminContentRouter.post('/products/:id/content/items', requirePermission('products.manage'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  await productOr404(productId);
  const input = parse(itemSchema, req.body);
  const s = await contentSettings();
  const { cols, check } = await resolveSource(input);
  const categoryId = await categoryForProduct(input.categoryId, productId);
  const max = await db('product_content_items').where({ product_id: productId, category_id: categoryId }).max({ m: 'display_order' }).first();
  const row = {
    product_id: productId, category_id: categoryId, title: input.title, description: input.description, content_type: input.contentType,
    cover_media_id: (await coverOk(input.coverMediaId)) ?? (await automaticCover(cols, check, input.title, req.auth!.user.id)), ...cols, duration_seconds: input.durationSeconds ?? check.duration ?? null, tags: JSON.stringify(input.tags),
    display_order: input.displayOrder ?? num(max?.m) + 1, access_level: input.accessLevel, embed_check: JSON.stringify(check),
    status: 'draft', created_by: req.auth!.user.id, updated_by: req.auth!.user.id,
  };
  let wantPublish = input.status ? input.status === 'published' : s.publishNewItems;
  // A new video that can't be published yet (no cover, or not embeddable) is kept as a draft with the reason,
  // instead of losing what was typed.
  let notPublished: string | null = null;
  if (wantPublish) {
    await assertPublishable({ cover_media_id: row.cover_media_id, embed_check: check, title: input.title }).catch((e: Error) => {
      notPublished = e.message;
      wantPublish = false;
    });
  }
  const [id] = await db('product_content_items').insert({ ...row, status: wantPublish ? 'published' : 'draft', published_at: wantPublish ? new Date() : null });
  await audit(req, { action: 'content.item_created', subjectType: 'product', subjectId: productId, meta: { itemId: id, title: input.title, provider: cols.video_provider } });
  res.status(201).json({ ...(await adminOverview(productId)), savedId: id, check, notPublished });
}));

adminContentRouter.put('/content/items/:iid', requirePermission('products.manage'), ah(async (req, res) => {
  const prev = await db('product_content_items').where({ id: Number(req.params['iid']) || 0 }).first();
  if (!prev) throw notFound('Content item not found.');
  const input = parse(itemSchema, req.body);
  const { cols, check } = await resolveSource(input, prev);
  const categoryId = await categoryForProduct(input.categoryId, prev.product_id);
  const status = input.status ?? prev.status;
  const row = {
    category_id: categoryId, title: input.title, description: input.description, content_type: input.contentType,
    cover_media_id: (await coverOk(input.coverMediaId)) ?? (!prev.cover_media_id && (input.status ?? prev.status) === 'published' ? await automaticCover(cols, check, input.title, req.auth!.user.id) : null), ...cols,
    duration_seconds: input.durationSeconds ?? check.duration ?? prev.duration_seconds ?? null, tags: JSON.stringify(input.tags), access_level: input.accessLevel,
    embed_check: JSON.stringify(check), status, updated_by: req.auth!.user.id, updated_at: new Date(),
    ...(input.displayOrder !== undefined ? { display_order: input.displayOrder } : {}),
    ...(status === 'published' && prev.status !== 'published' ? { published_at: new Date() } : {}),
  };
  if (status === 'published') await assertPublishable({ cover_media_id: row.cover_media_id, embed_check: check, title: input.title });
  await db('product_content_items').where({ id: prev.id }).update(row);
  await audit(req, { action: 'content.item_updated', subjectType: 'product', subjectId: prev.product_id, meta: { itemId: prev.id, title: input.title } });
  res.json({ ...(await adminOverview(prev.product_id)), savedId: prev.id, check });
}));

adminContentRouter.delete('/content/items/:iid', requirePermission('products.manage'), ah(async (req, res) => {
  const prev = await db('product_content_items').where({ id: Number(req.params['iid']) || 0 }).first('id', 'product_id', 'title');
  if (!prev) throw notFound('Content item not found.');
  await db('product_content_items').where({ id: prev.id }).del();
  await audit(req, { action: 'content.item_deleted', subjectType: 'product', subjectId: prev.product_id, before: { itemId: prev.id, title: prev.title } });
  res.json(await adminOverview(prev.product_id));
}));

/** Bulk: publish / unpublish / move to category, or set the order of items within one category. */
adminContentRouter.post('/products/:id/content/items/bulk', requirePermission('products.manage'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  const input = parse(z.object({ ids: z.array(z.number().int()).min(1).max(500), action: z.enum(['publish', 'unpublish', 'move', 'order']), categoryId: z.number().int().nullable().optional(), skipProblems: z.boolean().optional() }), req.body);
  const items = await db('product_content_items').whereIn('id', input.ids).select('id', 'product_id', 'title', 'cover_media_id', 'embed_check', 'video_provider', 'video_reference');
  let skipped: string[] = [];
  if (items.length !== input.ids.length || items.some((i) => i.product_id !== productId)) throw badRequest('Some of the selected items do not belong to this product.');
  if (input.action === 'publish') {
    // Video links without a cover get their video thumbnail as cover, so they can be published.
    for (const i of items) {
      if (i.cover_media_id || i.video_provider === 'upload') continue;
      const check = i.embed_check ? (typeof i.embed_check === 'string' ? JSON.parse(i.embed_check) : i.embed_check) : null;
      const cover = await automaticCover(i, check, i.title, req.auth!.user.id);
      if (cover) {
        await db('product_content_items').where({ id: i.id }).update({ cover_media_id: cover });
        i.cover_media_id = cover;
      }
    }
    const problems: string[] = [];
    const ok: number[] = [];
    for (const i of items) await assertPublishable(i).then(() => ok.push(i.id)).catch((e: Error) => problems.push(e.message));
    if (problems.length && !input.skipProblems) throw badRequest(problems.join(' '));
    skipped = problems;
    if (ok.length) await db('product_content_items').whereIn('id', ok).where('status', 'draft').update({ status: 'published', published_at: new Date(), updated_by: req.auth!.user.id, updated_at: new Date() });
  } else if (input.action === 'unpublish') {
    await db('product_content_items').whereIn('id', input.ids).update({ status: 'draft', updated_by: req.auth!.user.id, updated_at: new Date() });
  } else if (input.action === 'move') {
    const categoryId = await categoryForProduct(input.categoryId ?? null, productId);
    const max = await db('product_content_items').where({ product_id: productId, category_id: categoryId }).max({ m: 'display_order' }).first();
    await db.transaction(async (trx) => {
      for (const [n, id] of input.ids.entries()) await trx('product_content_items').where({ id }).update({ category_id: categoryId, display_order: num(max?.m) + n + 1, updated_at: new Date() });
    });
  } else {
    await db.transaction(async (trx) => {
      for (const [n, id] of input.ids.entries()) await trx('product_content_items').where({ id }).update({ display_order: n + 1 });
    });
  }
  await audit(req, { action: `content.bulk_${input.action}`, subjectType: 'product', subjectId: productId, meta: { ids: input.ids, categoryId: input.categoryId, skipped: skipped.length } });
  res.json({ ...(await adminOverview(productId)), skipped });
}));

/** Test a YouTube/Vimeo link before saving (embeddable? title, thumbnail, duration). */
adminContentRouter.post('/content/check-link', requirePermission('products.manage'), ah(async (req, res) => {
  const { url, accessLevel, productId } = parse(z.object({ url: z.string().trim().max(500), accessLevel: z.string().optional(), productId: z.number().int().optional() }), req.body);
  const parsed = parseVideoLink(url);
  if (!parsed && parsePlaylistLink(url)) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: 'This is a YouTube playlist link. Use “Import YouTube playlist” to add all of its videos at once.' } });
  if (!parsed) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: 'This isn’t a YouTube or Vimeo video link. Paste the link from the video’s Share button, or upload the video file instead.' } });
  const s = await contentSettings();
  if ((s.providers as Record<string, boolean>)[parsed.provider] === false) throw badRequest(`${parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} is switched off in Content settings.`);
  const product = productId ? await db('products').where({ id: productId }).first('content_access') : null;
  const level = (accessLevel && accessLevel !== 'inherit' ? accessLevel : product?.content_access ?? s.defaultAccess) as Level;
  const check = await checkLink(parsed);
  res.json({ ...check, provider: parsed.provider, embed: embedUrl(parsed.provider, parsed.reference), warning: providerWarning(parsed.provider, level) });
}));

/** Cover upload: JPG/PNG/WebP, optimised to fit 1600×900 WebP. Stored privately; served only through /api/content/covers. */
const coverUpload = multer({ dest: TMP_DIR, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
adminContentRouter.post(
  '/content/covers',
  requirePermission('products.manage'),
  (req, res, next) => coverUpload.single('file')(req, res, (err: unknown) => next(err ? badRequest((err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? 'Cover images can be up to 10 MB.' : 'Upload failed. Please try again.') : undefined)),
  ah(async (req, res) => {
    const f = req.file;
    if (!f) throw badRequest('Choose an image.');
    try {
      const checked = await inspectUpload(f.path, f.originalname, f.size);
      if ('error' in checked) throw badRequest(checked.error);
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(checked.ext)) throw badRequest('Cover images must be JPG, PNG or WebP.');
      const buf = await readFile(f.path);
      let out;
      try {
        out = await optimiseCover(buf);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      const ext = out.optimised ? out.ext : checked.ext === 'jpeg' ? 'jpg' : checked.ext;
      const mime = out.optimised ? out.mime : FILE_TYPES[checked.ext].mime;
      const stored = await saveFile(out.data, 'covers', ext);
      const original = f.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
      const [id] = await db('media').insert({ kind: 'image', title: `Cover: ${original.replace(/\.[^.]+$/, '')}`.slice(0, 191), disk: 'private', storage_key: stored.storageKey, original_name: original, mime, size_bytes: stored.size, sha256: stored.sha256, visibility: 'staff', meta: JSON.stringify({ width: out.width, height: out.height, purpose: 'content_cover', optimised: out.optimised }), uploaded_by: req.auth!.user.id });
      await audit(req, { action: 'content.cover_uploaded', subjectType: 'media', subjectId: id });
      res.status(201).json({ id, preview: mediaUrl(id, 'cover'), width: out.width, height: out.height, size: stored.size, optimised: out.optimised });
    } finally {
      await unlink(f.path).catch(() => undefined);
    }
  }),
);

/** Recreate missing cover files (from the videos' own thumbnails) for a product's YouTube/Vimeo items. */
adminContentRouter.post('/products/:id/content/covers/restore', requirePermission('products.manage'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  await productOr404(productId);
  const items = await db('product_content_items').where({ product_id: productId }).whereNot('video_provider', 'upload').whereNotNull('cover_media_id').select('id', 'cover_media_id', 'video_media_id');
  const gone = await missingFiles(items);
  const todo = items.filter((i: Row) => gone.has(i.cover_media_id));
  let restored = 0;
  for (let n = 0; n < todo.length; n += 6) {
    const done = await Promise.all(todo.slice(n, n + 6).map((i: Row) => restoreCover(i.id, true)));
    restored += done.filter(Boolean).length;
  }
  if (todo.length) await audit(req, { action: 'content.covers_restored', subjectType: 'product', subjectId: productId, meta: { missing: todo.length, restored } });
  res.json({ ...(await adminOverview(productId)), restore: { missing: todo.length, restored } });
}));

/* ---- YouTube playlists ("folder links") ---- */
async function readPlaylistOr422(url: string) {
  const id = parsePlaylistLink(url);
  if (!id) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: 'Paste a YouTube playlist link, e.g. https://www.youtube.com/playlist?list=PL…' } });
  const bad = unsupportedListReason(id);
  if (bad) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: bad } });
  const s = await contentSettings();
  if ((s.providers as Record<string, boolean>)['youtube'] === false) throw badRequest('YouTube is switched off in Content settings.');
  try {
    return await readPlaylist(id);
  } catch (e) {
    if (e instanceof PlaylistError) throw new HttpError(e.status, e.message, 'playlist_unavailable');
    throw e;
  }
}

async function existingRefs(productId: number) {
  const rows = await db('product_content_items').where({ product_id: productId, video_provider: 'youtube' }).select('id', 'video_reference', 'title');
  return new Map(rows.map((r: Row) => [r.video_reference as string, r]));
}

/** Read a playlist and show what would be imported (nothing is saved). */
adminContentRouter.post('/products/:id/content/playlist/preview', requirePermission('products.manage'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  await productOr404(productId);
  const { url } = parse(z.object({ url: z.string().trim().min(1, 'Paste a YouTube playlist link').max(500) }), req.body);
  const pl = await readPlaylistOr422(url);
  const have = await existingRefs(productId);
  const category = await db('product_content_categories').where({ product_id: productId, source_playlist: pl.id }).first('id', 'name');
  res.json({
    id: pl.id, title: pl.title, source: pl.source, complete: pl.complete, note: pl.note, existingCategory: category ?? null,
    videos: pl.videos.map((v) => ({ ...v, thumbnail: thumbnailUrl(v.videoId), existingId: have.get(v.videoId)?.id ?? null })),
  });
}));

async function storeCover(buf: Buffer, name: string, userId: number) {
  let out;
  try {
    out = await optimiseCover(buf);
  } catch {
    return null;
  }
  const stored = await saveFile(out.data, 'covers', out.optimised ? out.ext : 'jpg');
  const [id] = await db('media').insert({ kind: 'image', title: `Cover: ${name}`.slice(0, 191), disk: 'private', storage_key: stored.storageKey, original_name: `${name.replace(/[^\w.\- ]+/g, '_').slice(0, 180)}.${out.optimised ? out.ext : 'jpg'}`, mime: out.optimised ? out.mime : 'image/jpeg', size_bytes: stored.size, sha256: stored.sha256, visibility: 'staff', meta: JSON.stringify({ width: out.width, height: out.height, purpose: 'content_cover', optimised: out.optimised, source: 'youtube_thumbnail' }), uploaded_by: userId });
  return id as number;
}

/**
 * Import the chosen videos of a playlist, in the playlist's order, as content items.
 * The playlist is read again on the server (the browser's list is not trusted). Videos already in this
 * product's library are skipped; videos that can't be embedded are saved as drafts with the reason.
 */
adminContentRouter.post('/products/:id/content/playlist/import', requirePermission('products.manage'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  await productOr404(productId);
  const input = parse(z.object({
    url: z.string().trim().min(1).max(500),
    videoIds: z.array(z.string().regex(/^[\w-]{11}$/)).min(1, 'Choose at least one video').max(MAX_VIDEOS),
    target: z.enum(['new', 'existing', 'none']),
    categoryId: z.number().int().nullable().optional(),
    categoryName: z.string().trim().max(120).optional(),
    contentType: z.enum(CONTENT_TYPES).default('video'),
    accessLevel: z.enum(['inherit', ...LEVELS] as [string, ...string[]]).default('inherit'),
    covers: z.boolean().default(true),
    publish: z.boolean().default(false),
  }), req.body);
  const pl = await readPlaylistOr422(input.url);
  const wanted = new Set(input.videoIds);
  const chosen = pl.videos.filter((v) => wanted.has(v.videoId));
  if (!chosen.length) throw badRequest('None of the chosen videos are in this playlist any more. Load the playlist again.');
  const s = await contentSettings();
  const have = await existingRefs(productId);

  let categoryId: number | null = null;
  if (input.target === 'existing') categoryId = await categoryForProduct(input.categoryId ?? null, productId);
  else if (input.target === 'new') {
    const name = (input.categoryName || pl.title).slice(0, 120);
    if (name.length < 2) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { categoryName: 'Enter a category name' } });
    const max = await db('product_content_categories').where({ product_id: productId }).max({ m: 'display_order' }).first();
    [categoryId] = await db('product_content_categories').insert({ product_id: productId, name, status: 'active', display_order: num(max?.m) + 1, source_playlist: pl.id });
  }
  if (categoryId && input.target === 'existing') await db('product_content_categories').where({ id: categoryId }).whereNull('source_playlist').update({ source_playlist: pl.id });

  const max = await db('product_content_items').where({ product_id: productId, category_id: categoryId }).max({ m: 'display_order' }).first();
  let order = num(max?.m);
  const result = { imported: 0, published: 0, drafts: 0, skipped: 0, noCover: 0, problems: [] as string[] };
  const toCreate = chosen.filter((v) => {
    if (have.has(v.videoId)) {
      result.skipped++;
      return false;
    }
    return true;
  });
  // Covers: download a few at a time.
  const covers = new Map<string, number | null>();
  if (input.covers) {
    for (let i = 0; i < toCreate.length; i += 6) {
      await Promise.all(toCreate.slice(i, i + 6).map(async (v) => {
        const buf = await thumbnailCover(v.videoId);
        covers.set(v.videoId, buf ? await storeCover(buf, v.title || v.videoId, req.auth!.user.id) : null);
      }));
    }
  }
  for (const v of toCreate) {
    const coverId = covers.get(v.videoId) ?? null;
    if (input.covers && !coverId) result.noCover++;
    const check = v.embeddable === true
      ? { ok: true, verified: true, message: 'This video can be embedded on your website.', checkedAt: new Date().toISOString() }
      : v.embeddable === false
        ? { ok: false, verified: true, message: v.problem ?? 'This video can’t be embedded.', checkedAt: new Date().toISOString() }
        : { ok: null, verified: false, message: 'Couldn’t be tested from the server – open “Preview” to check it plays.', checkedAt: new Date().toISOString() };
    let publish = input.publish;
    if (publish && check.ok === false) {
      publish = false;
      result.problems.push(`“${v.title}”: ${check.message}`);
    } else if (publish && s.coverRequired && !coverId) {
      publish = false;
      result.problems.push(`“${v.title}”: no cover image could be made – add one, then publish it.`);
    }
    await db('product_content_items').insert({
      product_id: productId, category_id: categoryId, title: (v.title || `Video ${v.position + 1}`).slice(0, 191), description: v.description ? v.description.slice(0, 1000) : null,
      content_type: input.contentType, cover_media_id: coverId, video_provider: 'youtube', video_reference: v.videoId, video_media_id: null,
      duration_seconds: v.durationSeconds, tags: JSON.stringify([]), display_order: ++order, access_level: input.accessLevel, embed_check: JSON.stringify(check),
      status: publish ? 'published' : 'draft', published_at: publish ? new Date() : null, source_playlist: pl.id, created_by: req.auth!.user.id, updated_by: req.auth!.user.id,
    });
    result.imported++;
    if (publish) result.published++;
    else result.drafts++;
  }
  await audit(req, { action: 'content.playlist_imported', subjectType: 'product', subjectId: productId, meta: { playlist: pl.id, title: pl.title, categoryId, ...result, problems: result.problems.length } });
  res.status(201).json({ ...(await adminOverview(productId)), import: { ...result, categoryId, playlistTitle: pl.title } });
}));

/**
 * Save the whole running order in one go (drag and drop): the order of the categories, and for each category
 * (or "uncategorised") the items in the order they should appear. Items can move between categories.
 */
adminContentRouter.put('/products/:id/content/layout', requirePermission('products.manage'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  await productOr404(productId);
  const input = parse(z.object({
    categories: z.array(z.number().int()).max(500),
    groups: z.array(z.object({ categoryId: z.number().int().nullable(), ids: z.array(z.number().int()).max(2000) })).max(501),
  }), req.body);
  const cats = new Set((await db('product_content_categories').where({ product_id: productId }).select('id')).map((c) => c.id as number));
  const items = new Set((await db('product_content_items').where({ product_id: productId }).select('id')).map((i) => i.id as number));
  if (input.categories.length !== cats.size || input.categories.some((c) => !cats.has(c)) || new Set(input.categories).size !== cats.size) throw badRequest('The category list is out of date. Refresh the page and try again.');
  const all = input.groups.flatMap((g) => g.ids);
  if (all.length !== items.size || all.some((i) => !items.has(i)) || new Set(all).size !== items.size) throw badRequest('The content list is out of date. Refresh the page and try again.');
  if (input.groups.some((g) => g.categoryId !== null && !cats.has(g.categoryId))) throw badRequest('One of the categories does not belong to this product.');
  await db.transaction(async (trx) => {
    for (const [n, cid] of input.categories.entries()) await trx('product_content_categories').where({ id: cid }).update({ display_order: n + 1 });
    for (const g of input.groups) for (const [n, id] of g.ids.entries()) await trx('product_content_items').where({ id }).update({ category_id: g.categoryId, display_order: n + 1 });
  });
  await audit(req, { action: 'content.reordered', subjectType: 'product', subjectId: productId });
  res.json(await adminOverview(productId));
}));

/* ---- Analytics ---- */
adminContentRouter.get('/products/:id/content/analytics', requirePermission('products.view'), ah(async (req, res) => {
  const productId = Number(req.params['id']) || 0;
  const days = Math.min(365, Math.max(1, Number(req.query['days']) || 30));
  const since = db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [days]);
  const base = () => db('product_content_views').where({ product_id: productId }).where('viewed_at', '>=', since);
  const [totals, perItem, perCat, perDay] = await Promise.all([
    base().first(db.raw('COUNT(*) as views'), db.raw('COUNT(DISTINCT viewer_hash) as viewers'), db.raw('SUM(completed) as completions'), db.raw('AVG(percent) as avg_percent')),
    db('product_content_items as i').leftJoin('product_content_views as v', function () { this.on('v.content_id', 'i.id').andOn('v.viewed_at', '>=', since); }).where('i.product_id', productId).groupBy('i.id', 'i.title', 'i.status')
      .select('i.id', 'i.title', 'i.status', db.raw('COUNT(v.id) as views'), db.raw('COUNT(DISTINCT v.viewer_hash) as viewers'), db.raw('COALESCE(SUM(v.completed), 0) as completions'), db.raw('COALESCE(AVG(v.percent), 0) as avg_percent')),
    db('product_content_views as v').join('product_content_items as i', 'i.id', 'v.content_id').leftJoin('product_content_categories as c', 'c.id', 'i.category_id').where('v.product_id', productId).where('v.viewed_at', '>=', since)
      .groupBy('c.id', 'c.name').select(db.raw("COALESCE(c.name, 'Uncategorised') as name"), db.raw('COUNT(*) as views')).orderBy('views', 'desc'),
    base().groupByRaw('DATE(viewed_at)').select(db.raw('DATE(viewed_at) as day'), db.raw('COUNT(*) as views')).orderBy('day'),
  ]);
  const items = (perItem as Row[]).map((r) => ({ id: r.id, title: r.title, status: r.status, views: num(r.views), viewers: num(r.viewers), completions: num(r.completions), avgPercent: Math.round(num(r.avg_percent)) })).sort((a, b) => b.views - a.views);
  const published = items.filter((i) => i.status === 'published');
  res.json({
    days,
    views: num(totals?.views), uniqueViewers: num(totals?.viewers), completions: num(totals?.completions), avgPercent: Math.round(num(totals?.avg_percent)),
    mostViewed: published.slice(0, 5), leastViewed: [...published].reverse().slice(0, 5),
    items, categories: (perCat as Row[]).map((c) => ({ name: c.name, views: num(c.views) })),
    activity: (perDay as Row[]).map((d) => ({ day: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day).slice(0, 10), views: num(d.views) })),
  });
}));

/* ---- Settings & status ---- */
adminContentRouter.get('/content/settings', requirePermission('products.view'), ah(async (_req, res) => {
  const s = await contentSettings();
  const counts = await db('product_content_items').select('video_provider').count({ n: '*' }).groupBy('video_provider');
  res.json({
    settings: s,
    status: {
      imageOptimisation: !!(await imageTool()),
      storage: process.env['STORAGE_DIR'] || 'storage/ (inside the app folder, not public)',
      maxVideoMb: Math.min(Number(process.env['MAX_UPLOAD_MB'] || 1024), 1024),
      itemsByProvider: Object.fromEntries((counts as Row[]).map((c) => [c.video_provider, num(c.n)])),
      appUrl: config.appUrl,
      youtubeApiKey: !!youtubeApiKey(),
      playlistLimit: youtubeApiKey() ? MAX_VIDEOS : 15,
    },
  });
}));
adminContentRouter.put('/content/settings', requirePermission('settings.manage', 'products.publish'), ah(async (req, res) => {
  const input = parse(z.object({
    providers: z.object({ youtube: z.boolean(), vimeo: z.boolean(), upload: z.boolean() }),
    defaultAccess: z.enum(LEVELS as [string, ...string[]]),
    publishNewItems: z.boolean(),
    coverRequired: z.boolean(),
    streamTokenMinutes: z.number().int().min(5).max(120),
    viewWindowMinutes: z.number().int().min(1).max(1440),
  }), req.body);
  const before = await contentSettings();
  await setSetting('content.settings', input, req.auth!.user.id);
  await audit(req, { action: 'settings.content', before, after: input });
  res.json({ settings: input });
}));
/** Provider connectivity: can the server reach YouTube/Vimeo to test links? */
adminContentRouter.post('/content/settings/test', requirePermission('products.manage', 'settings.manage'), ah(async (_req, res) => {
  const probe = async (url: string) => {
    try {
      const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6000) });
      return { reachable: true, status: r.status };
    } catch {
      return { reachable: false, status: null };
    }
  };
  res.json({
    youtube: await probe('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daqz-KE-bpKQ'),
    vimeo: await probe('https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871'),
  });
}));

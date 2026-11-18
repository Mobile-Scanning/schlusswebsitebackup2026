import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Router } from 'express';
import type { Knex } from 'knex';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db';
import { ah, badRequest, conflict, HttpError, like, notFound, pageQuery, parse } from '../http';
import { can, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { mediaUrl, parseJson } from '../services/catalogue';
import { DEMO_STATUSES, DEMO_STATUS_LABEL, DemoStatus, demoConfig, demoStatusSql, fullAccess, runDemoChecks, runSupportChecks } from '../services/demos';
import { getSetting, inspectUpload, MAX_UPLOAD_MB, scanFile, setSetting, storeTempFile, TMP_DIR } from '../services/platform';
import { removeFile } from '../services/storage';

/**
 * Admin: product demos (files, settings, history), customers (CRM), packages, setup steps,
 * large uploads, content ordering and the business overview. All permission-checked.
 */
export const adminPlatformRouter = Router();

const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const soon = async () => (await getSetting('demos.notifications')).soonDays;
const num = (v: unknown) => Number(v ?? 0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
const rows = async (q: PromiseLike<unknown>) => (await q) as Row[];

/* ============================== Large uploads ============================== */
mkdirSync(TMP_DIR, { recursive: true });
const big = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: (_r, _f, cb) => cb(null, randomBytes(16).toString('hex') + '.part') }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 },
});

adminPlatformRouter.post(
  '/files/upload',
  requirePermission('products.manage', 'versions.manage', 'media.manage'),
  (req, res, next) =>
    big.single('file')(req, res, (err: unknown) => {
      if (err) return next((err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? badRequest(`That file is larger than ${MAX_UPLOAD_MB} MB.`) : badRequest('Upload failed. Please try again.'));
      next();
    }),
  ah(async (req, res) => {
    const f = req.file;
    if (!f) throw badRequest('Choose a file to upload.');
    try {
      const input = parse(z.object({ title: z.string().trim().max(191).optional(), purpose: z.enum(['demo', 'video', 'document', 'any']).default('any'), visibility: z.enum(['public', 'customer', 'partner', 'staff']).optional() }), req.body);
      const checked = await inspectUpload(f.path, f.originalname, f.size);
      if ('error' in checked) throw badRequest(checked.error);
      const kind = checked.type.kind;
      if (input.purpose === 'demo' && !['installer', 'archive'].includes(kind)) throw badRequest('Demo files must be installers or archives (EXE, MSI, APK, DMG, ZIP…).');
      if (input.purpose === 'video' && kind !== 'video') throw badRequest('Choose a video file (MP4, WebM or MOV).');
      if (input.purpose === 'document' && !['pdf', 'document'].includes(kind)) throw badRequest('Choose a PDF or Office document.');
      const scan = ['installer', 'archive', 'document', 'pdf'].includes(kind) ? await scanFile(f.path) : { status: 'not_needed' as const };
      if (scan.status === 'infected') {
        await audit(req, { action: 'media.upload_blocked', meta: { name: f.originalname, reason: scan.detail } });
        throw badRequest(`This file was blocked by the virus scanner (${scan.detail}).`);
      }
      if (scan.status !== 'clean' && scan.status !== 'not_needed' && process.env['MALWARE_SCAN'] === 'required') throw badRequest('The virus scanner is not available, and scanning is required on this server. Please try again later.');
      const stored = await storeTempFile(f.path, kind === 'installer' || kind === 'archive' ? 'installers' : kind === 'video' ? 'videos' : kind === 'image' ? 'images' : 'docs', checked.ext);
      const original = f.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
      // Demo installers stay staff-only: customers receive them only through signed, per-customer links.
      const visibility = input.purpose === 'demo' ? 'staff' : (input.visibility ?? (kind === 'installer' || kind === 'archive' ? 'customer' : 'public'));
      const [id] = await db('media').insert({ kind: kind === 'document' ? 'document' : kind, title: input.title || original.replace(/\.[^.]+$/, '') || 'Untitled', disk: 'private', storage_key: stored.storageKey, original_name: original, mime: checked.type.mime, size_bytes: stored.size, sha256: stored.sha256, visibility, meta: JSON.stringify({ scan: scan.status, scanDetail: 'detail' in scan ? scan.detail : null, scannedAt: new Date().toISOString() }), uploaded_by: req.auth!.user.id });
      await audit(req, { action: 'media.uploaded', subjectType: 'media', subjectId: id, meta: { name: original, size: stored.size, kind, purpose: input.purpose } });
      res.status(201).json({ id, kind, title: input.title || original, size: stored.size, sha256: stored.sha256, scan: scan.status, url: mediaUrl(id, original) });
    } finally {
      await unlink(f.path).catch(() => undefined);
    }
  }),
);

/* ============================== Product demo management ============================== */
async function productOr404(id: number) {
  const p = await db('products').where({ id }).first('id', 'name', 'slug', 'trial_days', 'demo_options', 'licence_rules', 'system_requirements', 'offering_type', 'features');
  if (!p) throw notFound('Product not found.');
  return p;
}

async function demoOverview(productId: number, channel: 'demo' | 'release' = 'demo') {
  const p = await productOr404(productId);
  const versions = await db('product_versions').where({ product_id: productId, channel }).orderBy([{ column: 'id', order: 'desc' }]).select('id', 'version', 'name', 'status', 'release_date', 'release_notes', 'min_requirements', 'install_instructions', 'is_latest', 'downloads_enabled', 'created_at');
  const ids = versions.map((v) => v.id);
  const files = ids.length
    ? await db('version_files as f').join('media as m', 'm.id', 'f.media_id').whereIn('f.version_id', ids).orderBy(['f.sort_order', 'f.id']).select('f.id', 'f.version_id', 'f.platform', 'f.architecture', 'f.label', 'f.is_active', 'f.created_at', 'm.id as media_id', 'm.original_name', 'm.size_bytes', 'm.mime', 'm.sha256', 'm.kind', 'm.meta')
    : [];
  const dl = ids.length ? await rows(db('downloads').whereIn('version_id', ids).groupBy('version_file_id').select('version_file_id').count({ n: '*' })) : [];
  const dlMap = new Map(dl.map((d) => [d['version_file_id'], num(d['n'])]));
  const s = await soon();
  const stats = await rows(db('licences as l').where({ 'l.product_id': productId, 'l.type': 'trial' }).select(db.raw(`${demoStatusSql(s)} as st`)).count({ n: '*' }).groupBy('st'));
  const cfg = demoConfig(p);
  const current = versions.find((v) => v.status === 'released' && v.downloads_enabled && files.some((f) => f.version_id === v.id && f.is_active));
  const access = fullAccess(p);
  return {
    channel,
    product: { id: p.id, name: p.name, slug: p.slug },
    settings: { available: cfg.available, days: cfg.days, startOn: cfg.startOn, maxDevices: cfg.maxDevices, offlineDays: cfg.offlineDays, fullAccess: access },
    live: channel === 'demo' ? !!(cfg.available && cfg.days && current) : !!(access !== 'off' && current),
    currentVersionId: current?.id ?? null,
    versions: versions.map((v) => ({
      ...v,
      is_latest: !!v.is_latest,
      downloads_enabled: !!v.downloads_enabled,
      files: files.filter((f) => f.version_id === v.id).map((f) => ({ ...f, scan: parseJson<Record<string, unknown>>(f.meta, {})['scan'] ?? 'not_recorded', meta: undefined, is_active: !!f.is_active, size_bytes: f.size_bytes === null ? null : Number(f.size_bytes), downloads: dlMap.get(f.id) ?? 0 })),
    })),
    stats: Object.fromEntries(stats.map((r) => [r['st'], num(r['n'])])),
  };
}

adminPlatformRouter.get(
  ['/products/:id/demo', '/products/:id/release'],
  requirePermission('products.view'),
  ah(async (req, res) => {
    res.json(await demoOverview(Number(req.params['id']), req.path.endsWith('/release') ? 'release' : 'demo'));
  }),
);

/** Who may download the FULL installer: nobody (off), customers with an active licence (default), or any verified customer. */
adminPlatformRouter.put(
  '/products/:id/release/settings',
  requirePermission('products.manage', 'versions.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { fullAccess: access } = parse(z.object({ fullAccess: z.enum(['off', 'licensed', 'registered']) }), req.body);
    const p = await productOr404(id);
    await db('products').where({ id }).update({ demo_options: JSON.stringify({ ...parseJson<Record<string, unknown>>(p.demo_options, {}), fullAccess: access }), updated_at: new Date() });
    await audit(req, { action: 'installer.access_changed', subjectType: 'product', subjectId: id, after: { access } });
    res.json(await demoOverview(id, 'release'));
  }),
);

adminPlatformRouter.put(
  '/products/:id/demo/settings',
  requirePermission('products.manage', 'versions.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(z.object({ available: z.boolean(), days: z.number().int().min(1, 'At least 1 day').max(365).nullable(), startOn: z.enum(['download', 'activation']), maxDevices: z.number().int().min(1).max(10000), offlineDays: z.number().int().min(0).max(90) }), req.body);
    if (input.available && !input.days) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { days: 'Set how many days the demo runs' } });
    const p = await productOr404(id);
    const opts = { ...parseJson<Record<string, unknown>>(p.demo_options, {}), downloadable: input.available, demoStartOn: input.startOn };
    const rules = { ...parseJson<Record<string, unknown>>(p.licence_rules, {}), maxDevices: input.maxDevices, offlineGraceDays: input.offlineDays };
    await db('products').where({ id }).update({ trial_days: input.days, demo_options: JSON.stringify(opts), licence_rules: JSON.stringify(rules), updated_at: new Date() });
    await audit(req, { action: 'product.demo_settings', subjectType: 'product', subjectId: id, before: demoConfig(p), after: input });
    res.json(await demoOverview(id));
  }),
);

const versionSchema = z.object({
  version: z.string().trim().min(1, 'Enter a version number').max(40),
  name: optStr(120),
  description: optStr(20000),
  requirements: optStr(5000),
  instructions: optStr(20000),
  status: z.enum(['draft', 'released', 'withdrawn']).default('draft'),
  releaseDate: dateStr.nullable().optional().or(z.literal('')),
});

async function markLatest(productId: number, trx: Knex | Knex.Transaction = db, channel: 'demo' | 'release' = 'demo') {
  const newest = await trx('product_versions').where({ product_id: productId, channel, status: 'released' }).orderBy([{ column: 'release_date', order: 'desc' }, { column: 'id', order: 'desc' }]).first('id');
  await trx('product_versions').where({ product_id: productId, channel }).update({ is_latest: false });
  if (newest) await trx('product_versions').where({ id: newest.id }).update({ is_latest: true });
}

adminPlatformRouter.post(
  ['/products/:id/demo/versions', '/products/:id/release/versions'],
  requirePermission('versions.manage', 'products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    await productOr404(id);
    const v = parse(versionSchema, req.body);
    const channel = req.path.includes('/release/') ? 'release' : 'demo';
    if (await db('product_versions').where({ product_id: id, channel, version: v.version }).first('id')) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { version: 'This version already exists' } });
    const [vid] = await db('product_versions').insert({ product_id: id, channel, version: v.version, name: v.name ?? null, release_notes: v.description ?? null, min_requirements: v.requirements ?? null, install_instructions: v.instructions ?? null, status: v.status, release_date: v.releaseDate || new Date().toISOString().slice(0, 10), downloads_enabled: true, created_by: req.auth!.user.id });
    await markLatest(id, db, channel);
    await audit(req, { action: `${channel === 'demo' ? 'demo' : 'installer'}.version_created`, subjectType: 'product', subjectId: id, after: { version: v.version, status: v.status } });
    res.status(201).json(await demoOverview(id, channel));
  }),
);

async function demoVersion(vid: number) {
  const v = await db('product_versions').where({ id: vid }).first();
  if (!v) throw notFound('Version not found.');
  return v;
}

adminPlatformRouter.patch(
  '/demo-versions/:vid',
  requirePermission('versions.manage', 'products.manage'),
  ah(async (req, res) => {
    const v = await demoVersion(Number(req.params['vid']));
    const input = parse(versionSchema.partial().extend({ downloadsEnabled: z.boolean().optional() }), req.body);
    if (input.version && input.version !== v.version && (await db('product_versions').where({ product_id: v.product_id, channel: v.channel, version: input.version }).first('id'))) {
      throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { version: 'This demo version already exists' } });
    }
    const row: Record<string, unknown> = { updated_at: new Date() };
    if (input.version) row['version'] = input.version;
    if (input.name !== undefined) row['name'] = input.name;
    if (input.description !== undefined) row['release_notes'] = input.description;
    if (input.requirements !== undefined) row['min_requirements'] = input.requirements;
    if (input.instructions !== undefined) row['install_instructions'] = input.instructions;
    if (input.status) row['status'] = input.status;
    if (input.releaseDate) row['release_date'] = input.releaseDate;
    if (input.downloadsEnabled !== undefined) row['downloads_enabled'] = input.downloadsEnabled;
    await db('product_versions').where({ id: v.id }).update(row);
    await markLatest(v.product_id, db, v.channel);
    await audit(req, { action: 'demo.version_updated', subjectType: 'product', subjectId: v.product_id, before: { version: v.version, status: v.status }, after: input });
    res.json(await demoOverview(v.product_id, v.channel));
  }),
);

adminPlatformRouter.delete(
  '/demo-versions/:vid',
  requirePermission('versions.manage', 'products.manage'),
  ah(async (req, res) => {
    const v = await demoVersion(Number(req.params['vid']));
    const used = await db('downloads').where({ version_id: v.id }).count({ n: '*' }).first();
    if (num(used?.n)) {
      // Downloaded versions are kept for the customers' history – withdraw instead.
      await db('product_versions').where({ id: v.id }).update({ status: 'withdrawn', downloads_enabled: false, updated_at: new Date() });
      await audit(req, { action: 'demo.version_withdrawn', subjectType: 'product', subjectId: v.product_id, meta: { version: v.version } });
    } else {
      const files = await db('version_files as f').join('media as m', 'm.id', 'f.media_id').where('f.version_id', v.id).select('f.id', 'm.id as media_id', 'm.storage_key');
      await db.transaction(async (trx) => {
        await trx('version_files').where({ version_id: v.id }).del();
        await trx('product_versions').where({ id: v.id }).del();
        for (const f of files) await trx('media').where({ id: f.media_id }).del();
      });
      for (const f of files) if (f.storage_key) await removeFile(f.storage_key);
      await audit(req, { action: 'demo.version_deleted', subjectType: 'product', subjectId: v.product_id, meta: { version: v.version } });
    }
    await markLatest(v.product_id, db, v.channel);
    res.json(await demoOverview(v.product_id, v.channel));
  }),
);

const fileSchema = z.object({ mediaId: z.number().int(), platform: z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'web', 'any']), architecture: optStr(16), label: optStr(120) });

async function checkInstaller(mediaId: number) {
  const m = await db('media').where({ id: mediaId }).first('id', 'kind');
  if (!m || !['installer', 'archive'].includes(m.kind)) throw badRequest('Upload the installer or archive first (EXE, MSI, APK, DMG, ZIP…).');
  await db('media').where({ id: mediaId }).update({ visibility: 'staff' }); // only signed customer links can fetch it
}

adminPlatformRouter.post(
  '/demo-versions/:vid/files',
  requirePermission('versions.manage', 'products.manage'),
  ah(async (req, res) => {
    const v = await demoVersion(Number(req.params['vid']));
    const input = parse(fileSchema, req.body);
    await checkInstaller(input.mediaId);
    const max = await db('version_files').where({ version_id: v.id }).max({ m: 'sort_order' }).first();
    await db('version_files').insert({ version_id: v.id, media_id: input.mediaId, platform: input.platform, architecture: input.architecture ?? null, label: input.label ?? null, sort_order: num(max?.m) + 1 });
    await audit(req, { action: 'demo.file_added', subjectType: 'product', subjectId: v.product_id, meta: { version: v.version, ...input } });
    res.status(201).json(await demoOverview(v.product_id, v.channel));
  }),
);

async function demoFile(fid: number) {
  const f = await db('version_files as f').join('product_versions as v', 'v.id', 'f.version_id').where({ 'f.id': fid }).first('f.*', 'v.product_id', 'v.version', 'v.channel');
  if (!f) throw notFound('Demo file not found.');
  return f;
}

/** Edit label/platform, switch on/off, or replace the file (the old one is kept for download history). */
adminPlatformRouter.patch(
  '/demo-files/:fid',
  requirePermission('versions.manage', 'products.manage'),
  ah(async (req, res) => {
    const f = await demoFile(Number(req.params['fid']));
    const input = parse(z.object({ platform: fileSchema.shape.platform.optional(), architecture: optStr(16), label: optStr(120), isActive: z.boolean().optional(), replaceWithMediaId: z.number().int().optional() }), req.body);
    if (input.replaceWithMediaId) {
      await checkInstaller(input.replaceWithMediaId);
      await db.transaction(async (trx) => {
        await trx('version_files').where({ id: f.id }).update({ is_active: false, updated_at: new Date() });
        await trx('version_files').insert({ version_id: f.version_id, media_id: input.replaceWithMediaId, platform: input.platform ?? f.platform, architecture: input.architecture ?? f.architecture, label: input.label ?? f.label, sort_order: f.sort_order });
      });
      await audit(req, { action: 'demo.file_replaced', subjectType: 'product', subjectId: f.product_id, meta: { version: f.version, old: f.media_id, new: input.replaceWithMediaId } });
    } else {
      const row: Record<string, unknown> = { updated_at: new Date() };
      if (input.platform) row['platform'] = input.platform;
      if (input.architecture !== undefined) row['architecture'] = input.architecture;
      if (input.label !== undefined) row['label'] = input.label;
      if (input.isActive !== undefined) row['is_active'] = input.isActive;
      await db('version_files').where({ id: f.id }).update(row);
      await audit(req, { action: 'demo.file_updated', subjectType: 'product', subjectId: f.product_id, meta: { version: f.version, fileId: f.id, ...input } });
    }
    res.json(await demoOverview(f.product_id, f.channel));
  }),
);

adminPlatformRouter.delete(
  '/demo-files/:fid',
  requirePermission('versions.manage', 'products.manage'),
  ah(async (req, res) => {
    const f = await demoFile(Number(req.params['fid']));
    const used = await db('downloads').where({ version_file_id: f.id }).count({ n: '*' }).first();
    if (num(used?.n)) {
      await db('version_files').where({ id: f.id }).update({ is_active: false, updated_at: new Date() });
    } else {
      const m = await db('media').where({ id: f.media_id }).first('storage_key');
      await db('version_files').where({ id: f.id }).del();
      const other = await db('version_files').where({ media_id: f.media_id }).first('id');
      if (!other) {
        await db('media').where({ id: f.media_id }).del();
        if (m?.storage_key) await removeFile(m.storage_key);
      }
    }
    await audit(req, { action: 'demo.file_removed', subjectType: 'product', subjectId: f.product_id, meta: { version: f.version, fileId: f.id, keptForHistory: num(used?.n) > 0 } });
    res.json(await demoOverview(f.product_id, f.channel));
  }),
);

/** Product › Downloads: every demo download for this product. */
adminPlatformRouter.get(
  '/products/:id/downloads',
  requirePermission('downloads.view', 'products.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const q = parse(pageQuery, req.query);
    const base = db('downloads as d').where('d.product_id', id);
    const [{ total }] = await base.clone().count({ total: '*' });
    const showPeople = can(req, 'customers.view');
    const rows = await base
      .clone()
      .join('customers as c', 'c.id', 'd.customer_id')
      .join('product_versions as v', 'v.id', 'd.version_id')
      .join('version_files as f', 'f.id', 'd.version_file_id')
      .join('media as m', 'm.id', 'f.media_id')
      .orderBy('d.id', 'desc')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('d.id', 'd.status', 'd.created_at', 'd.completed_at', 'd.licence_id', 'v.version', 'v.channel', 'f.platform', 'f.label', 'm.original_name', 'c.id as customer_id', 'c.full_name', 'c.company');
    res.json({ data: rows.map((r) => (showPeople ? r : { ...r, full_name: 'Customer #' + r.customer_id, company: null })), meta: { page: q.page, perPage: q.perPage, total: num(total) } });
  }),
);

/** Product › Enquiries: demo requests, conversations and quote requests for this product. */
adminPlatformRouter.get(
  '/products/:id/enquiries',
  requirePermission('products.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const [demos, convs, quotes] = await Promise.all([
      can(req, 'demos.view') ? db('demo_requests').where({ product_id: id }).orderBy('id', 'desc').limit(50).select('id', 'reference', 'name', 'company', 'status', 'preferred_type', 'created_at') : [],
      can(req, 'support.view') ? db('tickets').where({ product_id: id }).orderBy('last_message_at', 'desc').limit(50).select('id', 'reference', 'name', 'company', 'subject', 'status', 'channel', 'last_message_at') : [],
      can(req, 'quotes.manage') ? db('quote_requests').where({ product_id: id }).orderBy('id', 'desc').limit(50).select('id', 'reference', 'kind', 'status', 'created_at') : [],
    ]);
    res.json({ demoRequests: demos, conversations: convs, quotes });
  }),
);

/* ============================== Demos dashboard & records ============================== */
const demoQuery = pageQuery.extend({
  status: z.enum(DEMO_STATUSES).optional(),
  productId: z.coerce.number().int().optional(),
  partnerId: z.coerce.number().int().optional(),
  customerId: z.coerce.number().int().optional(),
  q: z.string().trim().max(100).optional(),
  dateField: z.enum(['download', 'activation', 'expiry', 'created']).default('created'),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
const DATE_COL = { download: 'l.first_downloaded_at', activation: 'l.activated_at', expiry: 'l.expires_at', created: 'l.created_at' } as const;

adminPlatformRouter.get(
  '/demos',
  requirePermission('licences.view', 'customers.view'),
  ah(async (req, res) => {
    const q = parse(demoQuery, req.query);
    const st = demoStatusSql(await soon());
    const base = db('licences as l').join('customers as c', 'c.id', 'l.customer_id').join('products as p', 'p.id', 'l.product_id').leftJoin('partners as pa', 'pa.id', db.raw('COALESCE(l.partner_id, c.assigned_partner_id)')).where('l.type', 'trial');
    if (q.status) base.whereRaw(`(${st}) = ?`, [q.status]);
    if (q.productId) base.where('l.product_id', q.productId);
    if (q.customerId) base.where('l.customer_id', q.customerId);
    if (q.partnerId) base.where((b) => b.where('l.partner_id', q.partnerId!).orWhere('c.assigned_partner_id', q.partnerId!));
    if (q.q) base.where((b) => b.where('c.full_name', 'like', like(q.q!)).orWhere('c.company', 'like', like(q.q!)).orWhere('c.email', 'like', like(q.q!)).orWhere('l.licence_key', 'like', like(q.q!)));
    const col = DATE_COL[q.dateField];
    if (q.from) base.where(col, '>=', q.from);
    if (q.to) base.where(col, '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [q.to]));
    const [{ total }] = await base.clone().count({ total: 'l.id' });
    const rows = await base
      .clone()
      .orderBy('l.id', 'desc')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('l.id', 'l.licence_key', 'l.created_at', 'l.first_downloaded_at', 'l.activated_at', 'l.expires_at', 'l.last_seen_at', 'l.start_on', 'l.duration_days', 'c.id as customer_id', 'c.full_name', 'c.company', 'c.email', 'c.cellphone', 'p.id as product_id', 'p.name as product', 'pa.business_name as partner', db.raw(`${st} as status`),
        db.raw('(SELECT v.version FROM downloads d JOIN product_versions v ON v.id = d.version_id WHERE d.licence_id = l.id ORDER BY d.id DESC LIMIT 1) as version'),
        db.raw('(SELECT COUNT(*) FROM downloads d WHERE d.licence_id = l.id) as downloads'));
    res.json({ data: rows.map((r) => ({ ...r, downloads: num(r.downloads), statusLabel: DEMO_STATUS_LABEL[r.status as DemoStatus] })), meta: { page: q.page, perPage: q.perPage, total: num(total) } });
  }),
);

adminPlatformRouter.get(
  '/demos/summary',
  requirePermission('licences.view', 'customers.view'),
  ah(async (_req, res) => {
    const st = demoStatusSql(await soon());
    const [byStatus, today, byProduct, recent, regs, conv, days] = await Promise.all([
      rows(db('licences as l').where('l.type', 'trial').select(db.raw(`${st} as st`)).count({ n: '*' }).groupBy('st')),
      db('licences as l').where('l.type', 'trial').whereNull('l.converted_at').whereIn('l.status', ['trial', 'expired']).whereRaw('DATE(CONVERT_TZ(l.expires_at, "+00:00", "+02:00")) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+02:00"))').count({ n: '*' }).first(),
      db('licences as l').join('products as p', 'p.id', 'l.product_id').where('l.type', 'trial').groupBy('p.id').orderBy('n', 'desc').select('p.id', 'p.name', db.raw('COUNT(*) as n'), db.raw('SUM(l.activated_at IS NOT NULL) as activated'), db.raw('SUM(l.converted_at IS NOT NULL) as converted'), db.raw('(SELECT COUNT(*) FROM downloads d WHERE d.product_id = p.id) as downloads')),
      db('downloads as d').join('customers as c', 'c.id', 'd.customer_id').join('products as p', 'p.id', 'd.product_id').join('product_versions as v', 'v.id', 'd.version_id').orderBy('d.id', 'desc').limit(8).select('d.id', 'd.created_at', 'd.status', 'd.licence_id', 'c.full_name', 'c.company', 'p.name as product', 'v.version'),
      db('customers').orderBy('id', 'desc').limit(8).select('id', 'full_name', 'company', 'country', 'created_at'),
      db('licences').where('type', 'trial').whereNotNull('converted_at').count({ n: '*' }).first(),
      rows(db('downloads').where('created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)')).select(db.raw('DATE(created_at) as day')).count({ n: '*' }).groupBy('day').orderBy('day')),
    ]);
    const s = Object.fromEntries(byStatus.map((r) => [r['st'], num(r['n'])])) as Record<string, number>;
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    const downloads = await db('downloads').count({ n: '*' }).first();
    res.json({
      kpis: {
        downloads: num(downloads?.n),
        demos: total,
        active: (s['active'] ?? 0) + (s['downloaded'] ?? 0) + (s['started'] ?? 0),
        awaiting: s['awaiting_activation'] ?? 0,
        expiringSoon: s['expiring_soon'] ?? 0,
        expiringToday: num(today?.n),
        expired: s['expired'] ?? 0,
        activated: num((await db('licences').where('type', 'trial').whereNotNull('activated_at').count({ n: '*' }).first())?.n),
        converted: num(conv?.n),
        suspended: (s['suspended'] ?? 0) + (s['revoked'] ?? 0),
      },
      byStatus: s,
      byProduct: byProduct.map((r) => ({ id: r.id, name: r.name, demos: num(r.n), activated: num(r.activated), converted: num(r.converted), downloads: num(r.downloads) })),
      recentDownloads: recent,
      recentCustomers: regs,
      downloadsByDay: days.map((d) => ({ day: d['day'], n: num(d['n']) })),
    });
  }),
);

adminPlatformRouter.get(
  '/demos/settings',
  requirePermission('licences.view', 'customers.view'),
  ah(async (_req, res) => {
    res.json(await getSetting('demos.notifications'));
  }),
);
adminPlatformRouter.put(
  '/demos/settings',
  requirePermission('licences.manage'),
  ah(async (req, res) => {
    const days = z.array(z.number().int().min(0).max(90)).max(10).transform((a) => [...new Set(a)].sort((x, y) => y - x));
    const input = parse(z.object({ adminDays: days, customerDays: days, notifyExpired: z.boolean(), emailAdmins: z.boolean(), emailCustomers: z.boolean(), soonDays: z.number().int().min(1).max(60) }), req.body);
    await setSetting('demos.notifications', input, req.auth!.user.id);
    await audit(req, { action: 'demos.notification_settings', after: input });
    res.json(input);
  }),
);
adminPlatformRouter.post(
  '/demos/run-checks',
  requirePermission('licences.manage'),
  ah(async (req, res) => {
    const r = await runDemoChecks();
    const late = await runSupportChecks();
    await audit(req, { action: 'demos.checks_run', meta: { ...r, supportReminders: late } });
    res.json({ ...r, supportReminders: late });
  }),
);

async function demoRecord(id: number) {
  const st = demoStatusSql(await soon());
  const l = await db('licences as l')
    .join('customers as c', 'c.id', 'l.customer_id')
    .join('products as p', 'p.id', 'l.product_id')
    .leftJoin('partners as pa', 'pa.id', db.raw('COALESCE(l.partner_id, c.assigned_partner_id)'))
    .where({ 'l.id': id, 'l.type': 'trial' })
    .first('l.*', 'p.name as product', 'p.slug as product_slug', 'c.full_name', 'c.company', 'c.email', 'c.cellphone', 'c.country', 'c.province', 'c.business_type', 'pa.business_name as partner', db.raw(`${st} as demo_status`));
  if (!l) throw notFound('Demo not found.');
  const [downloads, activations, events, notices, convs] = await Promise.all([
    db('downloads as d').join('product_versions as v', 'v.id', 'd.version_id').join('version_files as f', 'f.id', 'd.version_file_id').where('d.licence_id', id).orderBy('d.id', 'desc').select('d.id', 'd.status', 'd.created_at', 'd.completed_at', 'v.version', 'f.platform', 'f.label'),
    db('licence_activations').where('licence_id', id).orderBy('id', 'desc').select('id', 'device_name', 'platform', 'app_version', 'activated_at', 'last_validated_at', 'deactivated_at'),
    db('licence_events as e').leftJoin('users as u', 'u.id', 'e.actor_id').where('e.licence_id', id).orderBy('e.id', 'desc').limit(100).select('e.event', 'e.reason', 'e.after', 'e.created_at', 'u.name as actor'),
    db('demo_notices as n').leftJoin('email_logs as m', 'm.id', 'n.email_log_id').where('n.licence_id', id).orderBy('n.id', 'desc').select('n.audience', 'n.milestone', 'n.notified_users', 'n.created_at', 'm.status as email_status', 'm.error as email_error', 'm.sent_at'),
    db('tickets').where('customer_id', l.customer_id).orderBy('last_message_at', 'desc').limit(20).select('id', 'reference', 'subject', 'status', 'last_message_at'),
  ]);
  return {
    id: l.id,
    licenceKey: l.licence_key,
    status: l.demo_status,
    statusLabel: DEMO_STATUS_LABEL[l.demo_status as DemoStatus],
    licenceStatus: l.status,
    product: { id: l.product_id, name: l.product, slug: l.product_slug },
    customer: { id: l.customer_id, name: l.full_name, company: l.company, email: l.email, cellphone: l.cellphone, country: l.country, province: l.province, businessType: l.business_type, partner: l.partner },
    startOn: l.start_on,
    days: l.duration_days,
    createdAt: l.created_at,
    firstDownloadedAt: l.first_downloaded_at,
    activatedAt: l.activated_at,
    lastSeenAt: l.last_seen_at,
    expiresAt: l.expires_at,
    convertedAt: l.converted_at,
    maxDevices: l.max_devices,
    downloads,
    activations,
    events: events.map((e) => ({ ...e, after: parseJson(e.after, null) })),
    notices,
    conversations: convs,
  };
}

adminPlatformRouter.get(
  '/demos/:id',
  requirePermission('licences.view', 'customers.view'),
  ah(async (req, res) => {
    res.json(await demoRecord(Number(req.params['id']) || 0));
  }),
);

/** Extend, suspend, revoke or reinstate a demo. Every change is a licence event + audit entry. */
adminPlatformRouter.post(
  '/demos/:id/action',
  requirePermission('licences.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ action: z.enum(['extend', 'suspend', 'revoke', 'reinstate']), days: z.number().int().min(1).max(365).optional(), reason: z.string().trim().min(3, 'Give a short reason').max(500) }), req.body);
    const l = await db('licences').where({ id, type: 'trial' }).first();
    if (!l) throw notFound('Demo not found.');
    if (l.converted_at) throw conflict('This demo was converted to a package – manage the package licence instead.');
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.action === 'extend') {
      if (!input.days) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { days: 'How many extra days?' } });
      if (!l.expires_at) patch['duration_days'] = Number(l.duration_days ?? 0) + input.days; // not started yet – lengthen the period
      else patch['expires_at'] = db.raw('DATE_ADD(GREATEST(expires_at, UTC_TIMESTAMP()), INTERVAL ? DAY)', [input.days]);
      if (l.status === 'expired') patch['status'] = 'trial';
    } else if (input.action === 'suspend') patch['status'] = 'suspended';
    else if (input.action === 'revoke') patch['status'] = 'revoked';
    else patch['status'] = l.expires_at && new Date(l.expires_at) <= new Date() ? 'expired' : 'trial';
    await db.transaction(async (trx) => {
      await trx('licences').where({ id }).update(patch);
      await trx('licence_events').insert({ licence_id: id, event: input.action === 'extend' ? 'extended' : input.action === 'reinstate' ? 'reactivated' : input.action === 'suspend' ? 'suspended' : 'revoked', reason: input.reason, actor_id: req.auth!.user.id, before: JSON.stringify({ status: l.status, expires_at: l.expires_at }), after: JSON.stringify({ days: input.days ?? null }) });
      if (input.action === 'extend') await trx('demo_notices').where({ licence_id: id }).del(); // new end date → warnings start again
    });
    await audit(req, { action: `demo.${input.action}`, subjectType: 'licence', subjectId: id, meta: input });
    res.json(await demoRecord(id));
  }),
);

/* ============================== Customers (CRM) ============================== */
const customerQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  productId: z.coerce.number().int().optional(),
  demo: z.enum([...DEMO_STATUSES, 'any', 'none'] as [string, ...string[]]).optional(),
  package: z.enum(['any', 'none']).optional(),
  partnerId: z.coerce.number().int().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

adminPlatformRouter.get(
  '/customers',
  requirePermission('customers.view'),
  ah(async (req, res) => {
    const q = parse(customerQuery, req.query);
    const st = demoStatusSql(await soon());
    const base = db('customers as c').leftJoin('partners as pa', 'pa.id', 'c.assigned_partner_id').leftJoin('users as vu', 'vu.id', 'c.user_id');
    if (q.q) base.where((b) => b.where('c.full_name', 'like', like(q.q!)).orWhere('c.company', 'like', like(q.q!)).orWhere('c.email', 'like', like(q.q!)).orWhere('c.cellphone', 'like', like(q.q!)));
    if (q.partnerId) base.where('c.assigned_partner_id', q.partnerId);
    if (q.country) base.where('c.country', q.country);
    if (q.from) base.where('c.created_at', '>=', q.from);
    if (q.to) base.where('c.created_at', '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [q.to]));
    if (q.productId) base.where((b) => b.whereExists(db('customer_products as cp').whereRaw('cp.customer_id = c.id').where('cp.product_id', q.productId!)).orWhereExists(db('licences as l').whereRaw('l.customer_id = c.id').where('l.product_id', q.productId!)));
    if (q.demo === 'any') base.whereExists(db('licences as l').whereRaw('l.customer_id = c.id').where('l.type', 'trial'));
    else if (q.demo === 'none') base.whereNotExists(db('licences as l').whereRaw('l.customer_id = c.id').where('l.type', 'trial'));
    else if (q.demo) base.whereExists(db('licences as l').whereRaw('l.customer_id = c.id').where('l.type', 'trial').whereRaw(`(${st}) = ?`, [q.demo]).modify((b) => (q.productId ? b.where('l.product_id', q.productId) : b)));
    if (q.package === 'any') base.whereExists(db('licences as l').whereRaw('l.customer_id = c.id').whereNot('l.type', 'trial'));
    else if (q.package === 'none') base.whereNotExists(db('licences as l').whereRaw('l.customer_id = c.id').whereNot('l.type', 'trial'));
    const [{ total }] = await base.clone().count({ total: 'c.id' });
    const rows = await base
      .clone()
      .orderBy('c.id', 'desc')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('c.id', 'c.full_name', 'c.company', 'c.email', 'c.cellphone', 'c.country', 'c.province', 'c.business_type', 'c.created_at', 'c.last_activation_at', 'pa.business_name as partner', 'vu.email_verified_at', 'vu.status as login_status', 'c.user_id',
        db.raw("(SELECT COUNT(*) FROM licences l WHERE l.customer_id = c.id AND l.type = 'trial') as demos"),
        db.raw("(SELECT COUNT(*) FROM licences l WHERE l.customer_id = c.id AND l.type <> 'trial') as packages"),
        db.raw('(SELECT COUNT(*) FROM downloads d WHERE d.customer_id = c.id) as downloads'),
        db.raw("(SELECT COUNT(*) FROM tickets t WHERE t.customer_id = c.id AND t.status NOT IN ('resolved','closed')) as open_conversations"));
    res.json({ data: rows.map((r) => ({ ...r, demos: num(r.demos), packages: num(r.packages), downloads: num(r.downloads), open_conversations: num(r.open_conversations) })), meta: { page: q.page, perPage: q.perPage, total: num(total) } });
  }),
);

adminPlatformRouter.get(
  '/customers/:id',
  requirePermission('customers.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const st = demoStatusSql(await soon());
    const c = await db('customers as c').leftJoin('partners as pa', 'pa.id', 'c.assigned_partner_id').leftJoin('users as u', 'u.id', 'c.user_id').where('c.id', id).first('c.*', 'pa.business_name as partner', 'u.status as login_status', 'u.last_login_at', 'u.email_verified_at', db.raw('(SELECT name FROM businesses b WHERE b.id = c.business_id) as business'));
    if (!c) throw notFound('Customer not found.');
    const [interest, demos, packages, downloads, activations, convs, consents, emails, plans] = await Promise.all([
      db('customer_products as cp').join('products as p', 'p.id', 'cp.product_id').where('cp.customer_id', id).select('p.id', 'p.name', 'cp.created_at', 'cp.demo_preference', 'cp.intended_usage'),
      db('licences as l').join('products as p', 'p.id', 'l.product_id').where({ 'l.customer_id': id, 'l.type': 'trial' }).orderBy('l.id', 'desc').select('l.id', 'l.licence_key', 'p.id as product_id', 'p.name as product', 'l.created_at', 'l.first_downloaded_at', 'l.activated_at', 'l.expires_at', 'l.converted_at', 'l.start_on', 'l.duration_days', db.raw(`${st} as status`)),
      db('licences as l').join('products as p', 'p.id', 'l.product_id').leftJoin('product_plans as pl', 'pl.id', 'l.plan_id').where('l.customer_id', id).whereNot('l.type', 'trial').orderBy('l.id', 'desc').select('l.id', 'l.licence_key', 'p.name as product', 'l.type', 'l.status', 'l.starts_at', 'l.expires_at', 'l.max_devices', 'pl.name as plan', 'l.notes'),
      db('downloads as d').join('products as p', 'p.id', 'd.product_id').join('product_versions as v', 'v.id', 'd.version_id').join('version_files as f', 'f.id', 'd.version_file_id').where('d.customer_id', id).orderBy('d.id', 'desc').limit(100).select('d.id', 'd.created_at', 'd.status', 'p.name as product', 'v.version', 'v.channel', 'f.platform', 'f.label'),
      db('licence_activations as a').join('licences as l', 'l.id', 'a.licence_id').join('products as p', 'p.id', 'l.product_id').where('l.customer_id', id).orderBy('a.id', 'desc').select('a.id', 'p.name as product', 'l.type', 'a.device_name', 'a.platform', 'a.app_version', 'a.activated_at', 'a.last_validated_at', 'a.deactivated_at'),
      db('tickets as t').leftJoin('support_categories as sc', 'sc.id', 't.category_id').where('t.customer_id', id).orderBy('t.last_message_at', 'desc').select('t.id', 't.reference', 't.subject', 't.status', 't.channel', 't.priority', 'sc.name as category', 't.last_message_at'),
      db('consents').where('email', c.email).orderBy('id', 'desc').limit(50).select('purpose', 'document_version', 'granted', 'source', 'created_at'),
      db('email_logs').where('to_email', c.email).orderBy('id', 'desc').limit(30).select('template_key', 'subject', 'status', 'created_at', 'sent_at', 'error'),
      db('product_plans as pl').join('products as p', 'p.id', 'pl.product_id').where('pl.is_active', true).select('pl.id', 'pl.name', 'pl.model', 'p.id as product_id', 'p.name as product'),
    ]);
    const activity = await db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_id').where((b) => b.where({ 'a.subject_type': 'customer', 'a.subject_id': id }).orWhere((b2) => b2.where('a.subject_type', 'licence').whereIn('a.subject_id', [0, ...demos.map((d) => d.id), ...packages.map((p) => p.id)]))).orderBy('a.id', 'desc').limit(30).select('a.action', 'a.created_at', 'u.name as actor');
    delete c.user_id;
    res.json({
      customer: c,
      interest,
      demos: demos.map((d) => ({ ...d, statusLabel: DEMO_STATUS_LABEL[d.status as DemoStatus] })),
      packages,
      downloads,
      activations,
      conversations: convs,
      consents: consents.map((x) => ({ ...x, granted: !!x.granted })),
      emails,
      activity,
      plans,
    });
  }),
);

adminPlatformRouter.patch(
  '/customers/:id',
  requirePermission('customers.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ fullName: z.string().trim().min(2).max(191).optional(), company: optStr(191), cellphone: optStr(32), country: z.string().regex(/^[A-Z]{2}$/).optional(), province: optStr(80), businessType: optStr(100), assignedPartnerId: z.number().int().nullable().optional() }), req.body);
    const before = await db('customers').where({ id }).first();
    if (!before) throw notFound('Customer not found.');
    if (input.assignedPartnerId && !(await db('partners').where({ id: input.assignedPartnerId, status: 'approved' }).first('id'))) throw badRequest('Choose an approved partner.');
    const map: Record<string, string> = { fullName: 'full_name', company: 'company', cellphone: 'cellphone', country: 'country', province: 'province', businessType: 'business_type', assignedPartnerId: 'assigned_partner_id' };
    const row: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(map)) if ((input as Record<string, unknown>)[k] !== undefined) row[col] = (input as Record<string, unknown>)[k];
    if (Object.keys(row).length) await db('customers').where({ id }).update({ ...row, updated_at: new Date() });
    await audit(req, { action: 'customer.updated', subjectType: 'customer', subjectId: id, before: Object.fromEntries(Object.keys(row).map((k) => [k, before[k]])), after: row });
    res.json({ ok: true });
  }),
);

/** Assign a package (paid/free licence). Only an administrator's explicit action converts a demo. */
adminPlatformRouter.post(
  '/customers/:id/packages',
  requirePermission('licences.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(
      z.object({
        productId: z.number().int(),
        planId: z.number().int().nullable().optional(),
        type: z.enum(['subscription', 'perpetual', 'free']),
        startsAt: dateStr,
        expiresAt: dateStr.nullable().optional().or(z.literal('')),
        maxDevices: z.number().int().min(1).max(10000).default(1),
        notes: optStr(2000),
        convertDemo: z.boolean().default(false),
        confirmPayment: z.boolean().default(false),
      }),
      req.body,
    );
    if (input.type === 'subscription' && !input.expiresAt) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { expiresAt: 'Subscriptions need an end date' } });
    if (input.convertDemo && !input.confirmPayment && input.type !== 'free') throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { confirmPayment: 'Confirm that payment or an approved order is in place' } });
    const c = await db('customers').where({ id }).first('id', 'assigned_partner_id');
    if (!c) throw notFound('Customer not found.');
    const p = await db('products').where({ id: input.productId }).first('id', 'name', 'licence_rules');
    if (!p) throw badRequest('Product not found.');
    if (input.planId && !(await db('product_plans').where({ id: input.planId, product_id: p.id }).first('id'))) throw badRequest('That plan belongs to another product.');
    const rules = parseJson<Record<string, unknown>>(p.licence_rules, {});
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const chars = Array.from(randomBytes(16), (x) => A[x % A.length]).join('');
    const key = `SCH-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
    const licId = await db.transaction(async (trx) => {
      const [lid] = await trx('licences').insert({ licence_key: key, customer_id: id, product_id: p.id, plan_id: input.planId ?? null, partner_id: c.assigned_partner_id ?? null, type: input.type, status: 'active', starts_at: input.startsAt, expires_at: input.expiresAt || null, max_devices: input.maxDevices, offline_grace_days: Number(rules['offlineGraceDays'] ?? 7), notes: input.notes ?? null });
      await trx('licence_events').insert({ licence_id: lid, event: 'created', actor_id: req.auth!.user.id, after: JSON.stringify({ type: input.type, planId: input.planId ?? null, startsAt: input.startsAt, expiresAt: input.expiresAt || null }) });
      if (input.convertDemo) {
        const demo = await trx('licences').where({ customer_id: id, product_id: p.id, type: 'trial' }).first('id', 'converted_at');
        if (demo && !demo.converted_at) {
          await trx('licences').where({ id: demo.id }).update({ converted_at: new Date(), converted_licence_id: lid, updated_at: new Date() });
          await trx('licence_events').insert({ licence_id: demo.id, event: 'converted', actor_id: req.auth!.user.id, reason: input.notes ?? null, after: JSON.stringify({ packageLicence: key }) });
        }
      }
      await trx('customer_products').insert({ customer_id: id, product_id: p.id }).onConflict(['customer_id', 'product_id']).ignore();
      return lid;
    });
    await audit(req, { action: 'licence.package_assigned', subjectType: 'licence', subjectId: licId, meta: { customerId: id, product: p.name, type: input.type, convertDemo: input.convertDemo } });
    res.status(201).json({ id: licId, licenceKey: key });
  }),
);

adminPlatformRouter.post(
  '/licences/:id/status',
  requirePermission('licences.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ status: z.enum(['active', 'suspended', 'revoked', 'expired']), reason: z.string().trim().min(3, 'Give a short reason').max(500) }), req.body);
    const l = await db('licences').where({ id }).whereNot('type', 'trial').first();
    if (!l) throw notFound('Package licence not found.');
    await db.transaction(async (trx) => {
      await trx('licences').where({ id }).update({ status: input.status, updated_at: new Date() });
      await trx('licence_events').insert({ licence_id: id, event: input.status === 'active' ? 'reactivated' : input.status, reason: input.reason, actor_id: req.auth!.user.id, before: JSON.stringify({ status: l.status }) });
    });
    await audit(req, { action: `licence.${input.status}`, subjectType: 'licence', subjectId: id, meta: input });
    res.json({ ok: true });
  }),
);

adminPlatformRouter.get(
  '/partner-options',
  requirePermission('customers.view', 'licences.view'),
  ah(async (_req, res) => {
    res.json(await db('partners').where('status', 'approved').orderBy('business_name').select('id', 'business_name as name'));
  }),
);

/* ============================== Setup & learning steps ============================== */
const itemSchema = z
  .object({ kind: z.enum(['image', 'video', 'document', 'file', 'link', 'demo_download']), mediaId: z.number().int().nullable().optional(), url: z.string().trim().max(500).nullable().optional(), title: optStr(191) })
  .superRefine((i, ctx) => {
    if (i.kind === 'link' && !/^https:\/\/\S+$/.test(i.url ?? '')) ctx.addIssue({ code: 'custom', message: 'Links must start with https://', path: ['url'] });
    if (['image', 'video', 'document', 'file'].includes(i.kind) && !i.mediaId) ctx.addIssue({ code: 'custom', message: 'Choose a file', path: ['mediaId'] });
  });
const stepSchema = z.object({ title: z.string().trim().min(2, 'Give the step a title').max(191), summary: optStr(500), body: optStr(60000), isEnabled: z.boolean().default(true), items: z.array(itemSchema).max(40).default([]) });
const ITEM_KINDS: Record<string, string[]> = { image: ['image'], video: ['video', 'external_video'], document: ['pdf', 'document'], file: ['installer', 'archive', 'document', 'pdf', 'other'] };

async function checkItems(items: z.infer<typeof itemSchema>[]) {
  for (const [n, i] of items.entries()) {
    if (!i.mediaId || i.kind === 'link' || i.kind === 'demo_download') continue;
    const m = await db('media').where({ id: i.mediaId }).first('kind', 'visibility');
    if (!m || !ITEM_KINDS[i.kind].includes(m.kind)) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { [`items.${n}.mediaId`]: `That file isn't a valid ${i.kind}` } });
    // Demo installers are only ever delivered through the signed demo download – never as a plain step file.
    if (await db('version_files as f').join('product_versions as v', 'v.id', 'f.version_id').where({ 'f.media_id': i.mediaId, 'v.channel': 'demo' }).first('f.id')) {
      throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { [`items.${n}.mediaId`]: 'Use “Demo download button” for demo installers' } });
    }
    if (m.visibility === 'staff' || m.visibility === 'partner') await db('media').where({ id: i.mediaId }).update({ visibility: 'customer' });
  }
}

async function stepsFor(productId: number) {
  const steps = await db('product_setup_steps').where({ product_id: productId, is_archived: false }).orderBy(['sort_order', 'id']).select('id', 'title', 'summary', 'body', 'is_enabled', 'sort_order', 'updated_at');
  const ids = steps.map((s) => s.id);
  const items = ids.length ? await db('setup_step_items as i').leftJoin('media as m', 'm.id', 'i.media_id').whereIn('i.step_id', ids).orderBy(['i.sort_order', 'i.id']).select('i.id', 'i.step_id', 'i.kind', 'i.media_id', 'i.url', 'i.title', 'm.title as media_title', 'm.kind as media_kind', 'm.original_name', 'm.external_url') : [];
  const done = ids.length ? await rows(db('customer_step_progress').whereIn('step_id', ids).groupBy('step_id').select('step_id').count({ n: '*' })) : [];
  const dmap = new Map(done.map((d) => [d['step_id'], num(d['n'])]));
  return steps.map((s) => ({ ...s, is_enabled: !!s.is_enabled, completions: dmap.get(s.id) ?? 0, items: items.filter((i) => i.step_id === s.id).map((i) => ({ kind: i.kind, mediaId: i.media_id, url: i.url, title: i.title, mediaTitle: i.media_title ?? i.original_name, mediaKind: i.media_kind, preview: i.kind === 'link' ? i.url : i.external_url ?? mediaUrl(i.media_id, i.original_name || i.media_title || 'file') })) }));
}

async function saveItems(trx: Knex.Transaction, stepId: number, items: z.infer<typeof itemSchema>[]) {
  await trx('setup_step_items').where({ step_id: stepId }).del();
  if (items.length) await trx('setup_step_items').insert(items.map((i, n) => ({ step_id: stepId, kind: i.kind, media_id: ['link', 'demo_download'].includes(i.kind) ? null : i.mediaId ?? null, url: i.kind === 'link' ? i.url : null, title: i.title ?? null, sort_order: n })));
}

adminPlatformRouter.get(
  '/products/:id/steps',
  requirePermission('products.view'),
  ah(async (req, res) => {
    res.json(await stepsFor(Number(req.params['id'])));
  }),
);
adminPlatformRouter.post(
  '/products/:id/steps',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    await productOr404(id);
    const s = parse(stepSchema, req.body);
    await checkItems(s.items);
    const max = await db('product_setup_steps').where({ product_id: id }).max({ m: 'sort_order' }).first();
    const sid = await db.transaction(async (trx) => {
      const [sid] = await trx('product_setup_steps').insert({ product_id: id, title: s.title, summary: s.summary ?? null, body: s.body ?? null, is_enabled: s.isEnabled, sort_order: num(max?.m) + 1 });
      await saveItems(trx, sid, s.items);
      return sid;
    });
    await audit(req, { action: 'product.step_created', subjectType: 'product', subjectId: id, meta: { stepId: sid, title: s.title } });
    res.status(201).json(await stepsFor(id));
  }),
);
adminPlatformRouter.put(
  '/steps/:sid',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const sid = Number(req.params['sid']) || 0;
    const step = await db('product_setup_steps').where({ id: sid, is_archived: false }).first('id', 'product_id');
    if (!step) throw notFound('Step not found.');
    const s = parse(stepSchema, req.body);
    await checkItems(s.items);
    await db.transaction(async (trx) => {
      await trx('product_setup_steps').where({ id: sid }).update({ title: s.title, summary: s.summary ?? null, body: s.body ?? null, is_enabled: s.isEnabled, updated_at: new Date() });
      await saveItems(trx, sid, s.items);
    });
    await audit(req, { action: 'product.step_updated', subjectType: 'product', subjectId: step.product_id, meta: { stepId: sid } });
    res.json(await stepsFor(step.product_id));
  }),
);
adminPlatformRouter.delete(
  '/steps/:sid',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const sid = Number(req.params['sid']) || 0;
    const step = await db('product_setup_steps').where({ id: sid }).first('id', 'product_id');
    if (!step) throw notFound('Step not found.');
    const used = await db('customer_step_progress').where({ step_id: sid }).count({ n: '*' }).first();
    // Steps customers have completed are archived (hidden) so their history isn't lost.
    if (num(used?.n)) await db('product_setup_steps').where({ id: sid }).update({ is_archived: true, is_enabled: false, updated_at: new Date() });
    else await db('product_setup_steps').where({ id: sid }).del();
    await audit(req, { action: 'product.step_removed', subjectType: 'product', subjectId: step.product_id, meta: { stepId: sid, archived: num(used?.n) > 0 } });
    res.json(await stepsFor(step.product_id));
  }),
);

const orderSchema = z.object({ ids: z.array(z.number().int()).min(1).max(500) });
adminPlatformRouter.put(
  '/products/:id/steps-order',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { ids } = parse(orderSchema, req.body);
    await db.transaction(async (trx) => {
      for (const [i, sid] of ids.entries()) await trx('product_setup_steps').where({ id: sid, product_id: id }).update({ sort_order: i + 1 });
    });
    res.json(await stepsFor(id));
  }),
);

/* ============================== Content ordering ============================== */
adminPlatformRouter.put(
  '/products/:id/media-order',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { ids } = parse(orderSchema, req.body);
    await db.transaction(async (trx) => {
      for (const [i, lid] of ids.entries()) await trx('product_media').where({ id: lid, product_id: id }).update({ sort_order: i + 1 });
    });
    await audit(req, { action: 'product.media_reordered', subjectType: 'product', subjectId: id });
    res.json({ ok: true });
  }),
);
adminPlatformRouter.put(
  '/learning-order',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const { ids } = parse(orderSchema, req.body);
    await db.transaction(async (trx) => {
      for (const [i, lid] of ids.entries()) await trx('learning_resources').where({ id: lid }).update({ sort_order: i + 1 });
    });
    res.json({ ok: true });
  }),
);

/* ============================== Overview & navigation counts ============================== */
adminPlatformRouter.get(
  '/overview',
  requirePermission('dashboard.view'),
  ah(async (req, res) => {
    const out: Record<string, unknown> = {};
    const one = async (q: Knex.QueryBuilder) => num((await q.count({ n: '*' }).first())?.n);
    if (can(req, 'customers.view') || can(req, 'licences.view')) {
      const st = demoStatusSql(await soon());
      const s = Object.fromEntries((await rows(db('licences as l').where('l.type', 'trial').select(db.raw(`${st} as st`)).count({ n: '*' }).groupBy('st'))).map((r) => [r['st'], num(r['n'])]));
      Object.assign(out, {
        newCustomers7: await one(db('customers').where('created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)'))),
        downloads30: await one(db('downloads').where('created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)'))),
        activeDemos: (s['active'] ?? 0) + (s['downloaded'] ?? 0) + (s['started'] ?? 0) + (s['awaiting_activation'] ?? 0),
        expiringSoon: s['expiring_soon'] ?? 0,
        expired30: await one(db('licences').where('type', 'trial').whereNull('converted_at').where('expires_at', '<=', db.raw('UTC_TIMESTAMP()')).where('expires_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)'))),
        conversions30: await one(db('licences').where('type', 'trial').where('converted_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)'))),
        popularity: (await db('products as p').where('p.is_archived', false).select('p.id', 'p.name', db.raw('(SELECT COUNT(*) FROM downloads d WHERE d.product_id = p.id) as downloads'), db.raw("(SELECT COUNT(*) FROM licences l WHERE l.product_id = p.id AND l.type = 'trial') as demos"), db.raw('(SELECT COUNT(*) FROM customer_products cp WHERE cp.product_id = p.id) as interested'), 'p.view_count').orderBy('downloads', 'desc').limit(8)).map((r) => ({ id: r.id, name: r.name, downloads: num(r.downloads), demos: num(r.demos), interested: num(r.interested), views: num(r.view_count) })),
      });
    }
    if (can(req, 'support.view')) {
      Object.assign(out, {
        newConversations7: await one(db('tickets').where('created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)'))),
        unreadConversations: await one(db('tickets').where('admin_unread', '>', 0).whereNotIn('status', ['closed'])),
        openSupport: await one(db('tickets').whereIn('status', ['new', 'open', 'awaiting_admin', 'awaiting_customer', 'in_progress'])),
      });
    }
    // Activity by date (last 14 days): registrations, demo downloads, conversations.
    const series = async (table: string) =>
      Object.fromEntries((await rows(db(table).where('created_at', '>=', db.raw('DATE_SUB(UTC_DATE(), INTERVAL 13 DAY)')).select(db.raw('DATE(created_at) as d')).count({ n: '*' }).groupBy('d'))).map((r) => [new Date(r['d'] as string).toISOString().slice(0, 10), num(r['n'])]));
    const [regs, dls, convs] = await Promise.all([can(req, 'customers.view') ? series('customers') : {}, can(req, 'downloads.view') || can(req, 'customers.view') ? series('downloads') : {}, can(req, 'support.view') ? series('tickets') : {}]);
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86400_000).toISOString().slice(0, 10));
    out['activity'] = days.map((d) => ({ day: d, registrations: (regs as Record<string, number>)[d] ?? 0, downloads: (dls as Record<string, number>)[d] ?? 0, conversations: (convs as Record<string, number>)[d] ?? 0 }));
    res.json(out);
  }),
);

adminPlatformRouter.get(
  '/nav-counts',
  ah(async (req, res) => {
    if (req.auth?.user.type !== 'staff') {
      res.json({});
      return;
    }
    const out: Record<string, number> = {};
    out['notifications'] = num((await db('notifications').where({ user_id: req.auth.user.id }).whereNull('read_at').count({ n: '*' }).first())?.n);
    if (can(req, 'support.view')) out['support'] = num((await db('tickets').where('admin_unread', '>', 0).whereNot('status', 'closed').count({ n: '*' }).first())?.n);
    if (can(req, 'licences.view') || can(req, 'customers.view')) {
      const st = demoStatusSql(await soon());
      out['demos'] = num((await db('licences as l').where('l.type', 'trial').whereRaw(`(${st}) = 'expiring_soon'`).count({ n: '*' }).first())?.n);
    }
    if (can(req, 'leads.view')) out['leads'] = num((await db('leads').whereIn('status', ['new', 'contact_required', 'assistance_required']).count({ n: '*' }).first())?.n);
    if (can(req, 'sales.view')) out['sales'] = num((await db('quote_requests').whereIn('kind', ['purchase', 'quotation']).where('status', 'new').count({ n: '*' }).first())?.n);
    res.json(out);
  }),
);

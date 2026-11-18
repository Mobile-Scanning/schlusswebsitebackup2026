import type { Knex } from 'knex';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db';
import { ah, badRequest, conflict, HttpError, like, notFound, pageQuery, parse } from '../http';
import { ALLOWED, DEFAULTS, FEATURE_KEYS, featuresOf, OFFERING_TYPES, offeringTypeOf, OfferingType, TYPE_LABEL } from '../services/offerings';
import { requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import {
  embedUrl,
  LEARNING_SECTIONS,
  MEDIA_ROLES,
  mediaUrl,
  parseJson,
  PLAN_MODELS,
  pricingSummaries,
  PRODUCT_STATUSES,
  slugify,
  uniqueSlug,
} from '../services/catalogue';
import { getSiteContent, SITE_DEFAULTS, SITE_KEYS, SiteKey } from '../services/site-content';
import { imageSize, removeFile, saveFile, sniff } from '../services/storage';

/** Admin: categories, products (7-step editor), pricing, media library, learning material, website content. */
export const adminCatalogueRouter = Router();

const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));

/* =============================== Categories =============================== */
const categorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  description: optStr(500),
  icon: optStr(64),
  isActive: z.boolean().default(true),
});

adminCatalogueRouter.get(
  '/categories',
  requirePermission('products.view', 'categories.manage'),
  ah(async (_req, res) => {
    const rows = await db('product_categories as c')
      .leftJoin('products as p', function () {
        this.on('p.category_id', 'c.id').andOn('p.is_archived', db.raw('0'));
      })
      .groupBy('c.id')
      .orderBy([{ column: 'c.sort_order' }, { column: 'c.name' }])
      .select('c.id', 'c.name', 'c.slug', 'c.description', 'c.icon', 'c.sort_order', 'c.is_active')
      .count({ productCount: 'p.id' });
    res.json(rows.map((r: Record<string, unknown>) => ({ ...r, is_active: !!r['is_active'], productCount: Number(r['productCount']) })));
  }),
);

adminCatalogueRouter.post(
  '/categories',
  requirePermission('categories.manage'),
  ah(async (req, res) => {
    const input = parse(categorySchema, req.body);
    const slug = await uniqueSlug('product_categories', input.name);
    const max = await db('product_categories').max({ m: 'sort_order' }).first();
    const [id] = await db('product_categories').insert({ name: input.name, slug, description: input.description, icon: input.icon, is_active: input.isActive, sort_order: Number(max?.m ?? 0) + 10 });
    await audit(req, { action: 'category.created', subjectType: 'category', subjectId: id, after: input });
    res.status(201).json({ id, slug });
  }),
);

adminCatalogueRouter.put(
  '/categories/:id',
  requirePermission('categories.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(categorySchema, req.body);
    const before = await db('product_categories').where({ id }).first();
    if (!before) throw notFound('Category not found.');
    const slug = before.name === input.name ? before.slug : await uniqueSlug('product_categories', input.name, id);
    await db('product_categories').where({ id }).update({ name: input.name, slug, description: input.description, icon: input.icon, is_active: input.isActive, updated_at: new Date() });
    await audit(req, { action: 'category.updated', subjectType: 'category', subjectId: id, before, after: input });
    res.json({ ok: true, slug });
  }),
);

adminCatalogueRouter.put(
  '/categories-order',
  requirePermission('categories.manage'),
  ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int()).max(500) }), req.body);
    await db.transaction(async (trx) => {
      for (const [i, id] of ids.entries()) await trx('product_categories').where({ id }).update({ sort_order: (i + 1) * 10 });
    });
    await audit(req, { action: 'category.reordered', subjectType: 'category', after: ids });
    res.json({ ok: true });
  }),
);

adminCatalogueRouter.delete(
  '/categories/:id',
  requirePermission('categories.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const cat = await db('product_categories').where({ id }).first();
    if (!cat) throw notFound('Category not found.');
    const used = await db('products').where({ category_id: id }).count({ n: '*' }).first();
    if (Number(used?.n) > 0) throw conflict('This category still has products. Move them to another category first, or hide the category instead.');
    await db('product_categories').where({ id }).del();
    await audit(req, { action: 'category.deleted', subjectType: 'category', subjectId: id, before: cat });
    res.json({ ok: true });
  }),
);

/* =============================== Products =============================== */
const productList = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  category: z.coerce.number().int().optional(),
  state: z.enum(['published', 'draft', 'archived', 'all']).optional(),
  offering: z.enum(OFFERING_TYPES).optional(),
  has: z.enum(['installer', 'demo', 'nodemo', 'content']).optional(),
});

/* Facts per product used by the Products centre (installer / demo / content availability). */
const hasInstaller = "EXISTS (SELECT 1 FROM product_versions v JOIN version_files f ON f.version_id = v.id AND f.is_active = 1 WHERE v.product_id = p.id AND v.channel = 'release' AND v.status = 'released')";
const hasDemoFile = "EXISTS (SELECT 1 FROM product_versions v JOIN version_files f ON f.version_id = v.id AND f.is_active = 1 WHERE v.product_id = p.id AND v.channel = 'demo' AND v.status = 'released')";
const demoOn = `(JSON_EXTRACT(p.demo_options, '$.downloadable') = true AND ${hasDemoFile})`;
const contentCount = "(SELECT COUNT(*) FROM product_content_items i WHERE i.product_id = p.id)";
const contentPublished = "(SELECT COUNT(*) FROM product_content_items i WHERE i.product_id = p.id AND i.status = 'published')";

adminCatalogueRouter.get(
  '/products',
  requirePermission('products.view'),
  ah(async (req, res) => {
    const q = parse(productList, req.query);
    const base = db('products as p').leftJoin('product_categories as c', 'c.id', 'p.category_id');
    if (q.q) {
      const typeHits = OFFERING_TYPES.filter((t) => TYPE_LABEL[t].toLowerCase().includes(q.q!.toLowerCase()));
      base.andWhere((b) => {
        b.where('p.name', 'like', like(q.q!)).orWhere('p.slug', 'like', like(q.q!)).orWhere('p.short_description', 'like', like(q.q!)).orWhere('p.description', 'like', like(q.q!)).orWhere('p.product_type', 'like', like(q.q!)).orWhere('c.name', 'like', like(q.q!));
        if (typeHits.length) b.orWhereIn('p.offering_type', typeHits);
      });
    }
    if (q.status) base.andWhere('p.status', q.status);
    if (q.category) base.andWhere('p.category_id', q.category);
    if (q.offering) base.andWhere('p.offering_type', q.offering);
    if (q.has === 'installer') base.whereRaw(hasInstaller);
    if (q.has === 'demo') base.whereRaw(demoOn);
    if (q.has === 'nodemo') base.whereRaw(`NOT ${demoOn}`);
    if (q.has === 'content') base.whereRaw(`${contentCount} > 0`);
    if (q.state === 'published') base.andWhere({ 'p.is_published': true, 'p.is_archived': false });
    else if (q.state === 'draft') base.andWhere({ 'p.is_published': false, 'p.is_archived': false });
    else if (q.state === 'archived') base.andWhere('p.is_archived', true);
    else if (q.state !== 'all') base.andWhere('p.is_archived', false);
    const [{ total }] = await base.clone().count({ total: 'p.id' });
    const rows = await base
      .clone()
      .orderBy('p.updated_at', 'desc')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('p.id', 'p.name', 'p.slug', 'p.status', 'p.is_published', 'p.is_featured', 'p.is_archived', 'p.wizard_step', 'p.logo_media_id', 'p.hero_media_id', 'p.short_description', 'p.offering_type', 'p.features', 'p.trial_days', 'p.view_count', 'p.updated_at', 'c.name as category_name',
        db.raw(`${hasInstaller} as has_installer`), db.raw(`${demoOn} as has_demo`), db.raw(`${contentCount} as content_items`), db.raw(`${contentPublished} as content_published`));
    const pricing = await pricingSummaries(rows.map((r) => r.id));
    // Dashboard counters (all non-deleted offerings, independent of the current filter).
    const n = async (w: (b: Knex.QueryBuilder) => void) => Number((await db('products as p').where((b) => w(b)).count({ n: '*' }).first())?.n ?? 0);
    const live = (b: Knex.QueryBuilder) => b.where('p.is_archived', false);
    const stats = {
      total: await n(live),
      published: await n((b) => live(b).where('p.is_published', true)),
      draft: await n((b) => live(b).where('p.is_published', false)),
      archived: await n((b) => b.where('p.is_archived', true)),
      software: await n((b) => live(b).where('p.offering_type', 'software')),
      learning: await n((b) => live(b).where('p.offering_type', 'learning')),
      training: await n((b) => live(b).where('p.offering_type', 'training')),
      development: await n((b) => live(b).where('p.offering_type', 'development')),
      withDemo: await n((b) => live(b).whereRaw(demoOn)),
      withoutDemo: await n((b) => live(b).whereRaw(`NOT ${demoOn}`)),
    };
    res.json({
      data: rows.map((r) => {
        const feats = featuresOf(r);
        return {
          ...r, features: undefined, offering_features: feats, offering_type: offeringTypeOf(r), offering_label: TYPE_LABEL[offeringTypeOf(r)],
          is_published: !!r.is_published, is_featured: !!r.is_featured, is_archived: !!r.is_archived,
          has_installer: !!Number(r.has_installer) && feats.installer, has_demo: !!Number(r.has_demo) && feats.demo, trial: feats.trial && !!r.trial_days,
          content_items: Number(r.content_items), content_published: Number(r.content_published),
          logo: mediaUrl(r.logo_media_id, r.slug), image: mediaUrl(r.hero_media_id, r.slug) ?? mediaUrl(r.logo_media_id, r.slug), pricing: pricing.get(r.id),
        };
      }),
      stats,
      meta: { page: q.page, perPage: q.perPage, total: Number(total) },
    });
  }),
);

async function loadProduct(id: number) {
  const p = await db('products').where({ id }).first();
  if (!p) throw notFound('Product not found.');
  const [features, plans, media, learning, category] = await Promise.all([
    db('product_features').where({ product_id: id }).orderBy(['kind', 'sort_order', 'id']),
    db('product_plans').where({ product_id: id }).orderBy(['sort_order', 'id']),
    db('product_media as pm').join('media as m', 'm.id', 'pm.media_id').where('pm.product_id', id).orderBy(['pm.role', 'pm.sort_order']).select('pm.id as link_id', 'pm.role', 'pm.caption', 'pm.description', 'pm.duration_seconds', 'pm.thumbnail_media_id', 'pm.sort_order', 'm.id', 'm.kind', 'm.title', 'm.external_url', 'm.visibility', 'm.original_name', 'm.mime'),
    db('learning_resources as l').leftJoin('media as m', 'm.id', 'l.media_id').where('l.product_id', id).orderBy(['l.section', 'l.sort_order', 'l.id']).select('l.*', 'm.title as media_title', 'm.kind as media_kind', 'm.external_url'),
    p.category_id ? db('product_categories').where({ id: p.category_id }).first('id', 'name') : null,
  ]);
  const [rel, demoV, content, demos, dls] = await Promise.all([
    db('product_versions').where({ product_id: id, channel: 'release', status: 'released' }).orderBy([{ column: 'is_latest', order: 'desc' }, { column: 'id', order: 'desc' }]).first('version'),
    db('product_versions').where({ product_id: id, channel: 'demo', status: 'released' }).orderBy([{ column: 'is_latest', order: 'desc' }, { column: 'id', order: 'desc' }]).first('version'),
    db('product_content_items').where({ product_id: id }).select(db.raw('COUNT(*) as items'), db.raw("SUM(status = 'published') as published"), db.raw('(SELECT COUNT(*) FROM product_content_categories c WHERE c.product_id = ?) as categories', [id])).first(),
    db('licences').where({ product_id: id, type: 'trial' }).count({ n: '*' }).first(),
    db('downloads').where({ product_id: id }).count({ n: '*' }).first(),
  ]);
  return {
    ...p,
    offering_type: offeringTypeOf(p),
    offering_label: TYPE_LABEL[offeringTypeOf(p)],
    offering_features: featuresOf(p),
    allowed_features: ALLOWED[offeringTypeOf(p)],
    summary: { installerVersion: rel?.version ?? null, demoVersion: demoV?.version ?? null, contentItems: Number(content?.items ?? 0), contentPublished: Number(content?.published ?? 0), contentCategories: Number(content?.categories ?? 0), demos: Number(demos?.n ?? 0), downloads: Number(dls?.n ?? 0) },
    is_published: !!p.is_published,
    is_featured: !!p.is_featured,
    is_archived: !!p.is_archived,
    supported_platforms: parseJson<string[]>(p.supported_platforms, []),
    licence_rules: parseJson<Record<string, unknown>>(p.licence_rules, {}),
    demo_options: parseJson<Record<string, unknown>>(p.demo_options, {}),
    logo: mediaUrl(p.logo_media_id, p.slug),
    image: mediaUrl(p.hero_media_id, p.slug),
    previewImage: mediaUrl(p.preview_media_id, p.slug + '-preview'),
    about_show: !!p.about_show,
    about_puzzle: !!p.about_puzzle,
    aboutCover: mediaUrl(p.about_cover_media_id, p.slug + '-about'),
    aboutImage: mediaUrl(p.about_image_media_id, p.slug + '-about-image'),
    category,
    features,
    plans: plans.map((pl) => ({ ...pl, price_cents: pl.price_cents === null ? null : Number(pl.price_cents), inclusions: parseJson<string[]>(pl.inclusions, []), is_active: !!pl.is_active, is_highlighted: !!pl.is_highlighted, price_includes_vat: !!pl.price_includes_vat })),
    media: media.map((m) => ({ ...m, url: m.kind === 'external_video' ? m.external_url : mediaUrl(m.id, m.original_name || m.title), embed: embedUrl(m.external_url), thumbnail: mediaUrl(m.thumbnail_media_id, 'thumbnail') })),
    learning: learning.map((l) => ({ ...l, is_published: !!l.is_published, link_url: l.url, url: l.url ?? l.external_url ?? mediaUrl(l.media_id, l.media_title) })),
  };
}

adminCatalogueRouter.get(
  '/products/:id',
  requirePermission('products.view'),
  ah(async (req, res) => {
    res.json(await loadProduct(Number(req.params['id'])));
  }),
);

const productBase = z.object({
  name: z.string().trim().min(2, 'Enter the product name').max(160),
  slug: z.string().trim().max(180).optional(),
  tagline: optStr(255),
  shortDescription: optStr(500),
  description: optStr(60000),
  productType: optStr(64),
  categoryId: z.number().int().nullable().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  logoMediaId: z.number().int().nullable().optional(),
  heroMediaId: z.number().int().nullable().optional(),
  previewMediaId: z.number().int().nullable().optional(),
  supportedPlatforms: z.array(z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'web'])).max(6).optional(),
  systemRequirements: optStr(5000),
  trialDays: z.number().int().min(0).max(365).nullable().optional(),
  licenceRules: z.object({ maxDevices: z.number().int().min(1).max(10000), offlineGraceDays: z.number().int().min(0).max(90) }).partial().optional(),
  demoOptions: z
    .object({ requestForm: z.boolean(), scheduled: z.boolean(), video: z.boolean(), interactiveUrl: z.string().trim().url('Enter a full URL starting with https://').regex(/^https?:\/\//i, 'Use a link that starts with https://').max(500).or(z.literal('')), downloadable: z.boolean() })
    .partial()
    .optional(),
  expectedRelease: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  seoTitle: optStr(191),
  seoDescription: optStr(320),
  notice: optStr(1000),
  isFeatured: z.boolean().optional(),
  wizardStep: z.number().int().min(1).max(7).optional(),
  offeringType: z.enum(OFFERING_TYPES).optional(),
  features: z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof FEATURE_KEYS)[number], z.ZodBoolean>).partial().optional(),
});

function toRow(input: z.infer<typeof productBase>) {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    name: 'name',
    tagline: 'tagline',
    shortDescription: 'short_description',
    description: 'description',
    productType: 'product_type',
    categoryId: 'category_id',
    status: 'status',
    logoMediaId: 'logo_media_id',
    heroMediaId: 'hero_media_id',
    previewMediaId: 'preview_media_id',
    systemRequirements: 'system_requirements',
    trialDays: 'trial_days',
    seoTitle: 'seo_title',
    seoDescription: 'seo_description',
    notice: 'notice',
    isFeatured: 'is_featured',
    wizardStep: 'wizard_step',
  };
  for (const [k, col] of Object.entries(map)) if ((input as Record<string, unknown>)[k] !== undefined) row[col] = (input as Record<string, unknown>)[k];
  if (input.supportedPlatforms) row['supported_platforms'] = JSON.stringify(input.supportedPlatforms);
  if (input.offeringType) row['offering_type'] = input.offeringType;
  if (input.licenceRules) row['licence_rules'] = JSON.stringify(input.licenceRules);
  if (input.demoOptions) row['demo_options'] = JSON.stringify(input.demoOptions);
  if (input.expectedRelease !== undefined) row['expected_release'] = input.expectedRelease || null;
  if (row['trial_days'] === 0) row['trial_days'] = null;
  return row;
}

async function checkRefs(input: z.infer<typeof productBase>) {
  if (input.categoryId && !(await db('product_categories').where({ id: input.categoryId }).first('id'))) throw badRequest('Category not found.');
  for (const mid of [input.logoMediaId, input.heroMediaId, input.previewMediaId]) {
    if (mid) {
      const m = await db('media').where({ id: mid }).first('kind', 'visibility');
      if (!m || m.kind !== 'image') throw badRequest('Logo, product image and Coming soon image must be images from the media library.');
      if (m.visibility !== 'public') await db('media').where({ id: mid }).update({ visibility: 'public' }); // product images are public by nature
    }
  }
}

/* ---- About SCHLUSS page & puzzle settings (optional, per offering) ---- */
const aboutSchema = z.object({
  show: z.boolean(),
  puzzle: z.boolean(),
  order: z.number().int().min(0).max(9999),
  title: optStr(120),
  description: optStr(1500),
  problem: optStr(400),
  highlight: optStr(160),
  coverMediaId: z.number().int().nullable(),
  imageMediaId: z.number().int().nullable(),
});
adminCatalogueRouter.put(
  '/products/:id/about',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const p = await db('products').where({ id }).first('id', 'name', 'about_show', 'about_puzzle', 'about_order', 'about_title', 'about_description', 'about_problem', 'about_highlight', 'about_cover_media_id', 'about_image_media_id');
    if (!p) throw notFound('Product not found.');
    const input = parse(aboutSchema, req.body);
    for (const mid of [input.coverMediaId, input.imageMediaId]) {
      if (!mid) continue;
      const m = await db('media').where({ id: mid }).first('kind', 'visibility');
      if (!m || m.kind !== 'image') throw badRequest('The About SCHLUSS images must be images from the media library.');
      if (m.visibility !== 'public') await db('media').where({ id: mid }).update({ visibility: 'public' }); // shown on a public page
    }
    const row = {
      about_show: input.show, about_puzzle: input.puzzle, about_order: input.order,
      about_title: input.title || null, about_description: input.description || null, about_problem: input.problem || null, about_highlight: input.highlight || null,
      about_cover_media_id: input.coverMediaId, about_image_media_id: input.imageMediaId,
    };
    await db('products').where({ id }).update({ ...row, updated_at: new Date() });
    await audit(req, { action: 'product.about_updated', subjectType: 'product', subjectId: id, before: { ...p, id: undefined, name: undefined }, after: row });
    res.json(await loadProduct(id));
  }),
);

adminCatalogueRouter.post(
  '/products',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const input = parse(productBase, req.body);
    await checkRefs(input);
    const slug = await uniqueSlug('products', input.slug || input.name);
    const row = toRow(input);
    const type = (input.offeringType ?? 'software') as OfferingType;
    const features = { ...DEFAULTS[type], ...(input.features ?? {}) };
    const [id] = await db('products').insert({ ...row, slug, offering_type: type, features: JSON.stringify(features), status: input.status ?? (type === 'software' ? 'coming_soon' : type === 'development' ? 'coming_soon' : 'available'), is_published: false, created_by: req.auth!.user.id, wizard_step: input.wizardStep ?? 1 });
    await audit(req, { action: 'product.created', subjectType: 'product', subjectId: id, after: { name: input.name, slug } });
    res.status(201).json({ id, slug });
  }),
);

adminCatalogueRouter.patch(
  '/products/:id',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(productBase.partial(), req.body);
    const before = await db('products').where({ id }).first();
    if (!before) throw notFound('Product not found.');
    if (input.status && input.status !== before.status && !req.auth!.permissions.has('products.publish') && !req.auth!.roles.includes('super_admin')) {
      throw new HttpError(403, 'Changing the product status needs the publish permission.', 'forbidden');
    }
    await checkRefs(input as z.infer<typeof productBase>);
    const row = toRow(input as z.infer<typeof productBase>);
    if (input.offeringType || input.features) {
      // Changing the type or switching features off never deletes anything – it only changes what is offered.
      const nextType = (input.offeringType ?? offeringTypeOf(before)) as OfferingType;
      const prevFeatures = featuresOf(before);
      const merged = { ...prevFeatures, ...(input.features ?? {}) };
      const nextFeatures = featuresOf({ offering_type: nextType, features: merged });
      const warnings = await conversionWarnings(id, prevFeatures, nextFeatures);
      if (warnings.length && req.body?.confirm !== true) {
        throw new HttpError(409, 'Please confirm this change.', 'confirm_required', { warnings });
      }
      row['features'] = JSON.stringify(merged);
      if (input.offeringType && input.offeringType !== before.offering_type) {
        await audit(req, { action: 'product.offering_type_changed', subjectType: 'product', subjectId: id, before: { type: before.offering_type, features: prevFeatures }, after: { type: nextType, features: nextFeatures }, meta: { warnings } });
      }
    }
    // Option objects are merged, so editing one screen never wipes settings saved on another (e.g. demo start rule).
    if (input.demoOptions) row['demo_options'] = JSON.stringify({ ...parseJson<Record<string, unknown>>(before.demo_options, {}), ...input.demoOptions });
    if (input.licenceRules) row['licence_rules'] = JSON.stringify({ ...parseJson<Record<string, unknown>>(before.licence_rules, {}), ...input.licenceRules });
    if (input.slug !== undefined && input.slug !== before.slug) {
      const s = slugify(input.slug || input.name || before.name);
      if (!s) throw badRequest('Enter a valid web address.');
      if (await db('products').where({ slug: s }).whereNot({ id }).first('id')) {
        throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { slug: 'Another product already uses this web address' } });
      }
      row['slug'] = s;
    }
    if (input.wizardStep !== undefined) row['wizard_step'] = Math.max(before.wizard_step, input.wizardStep);
    if (Object.keys(row).length) await db('products').where({ id }).update({ ...row, updated_at: new Date() });
    await audit(req, { action: 'product.updated', subjectType: 'product', subjectId: id, after: Object.keys(row) });
    res.json(await loadProduct(id));
  }),
);

/** Publish / unpublish / archive / restore. Publishing validates that the page is complete enough. */
adminCatalogueRouter.post(
  '/products/:id/state',
  requirePermission('products.publish'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { action } = parse(z.object({ action: z.enum(['publish', 'unpublish', 'archive', 'restore']) }), req.body);
    const p = await db('products').where({ id }).first();
    if (!p) throw notFound('Product not found.');
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (action === 'publish') {
      const missing: string[] = [];
      const feats = featuresOf(p);
      if (!p.short_description) missing.push('a short description');
      if (!p.category_id && offeringTypeOf(p) === 'software') missing.push('a category');
      if (p.status !== 'coming_soon' && feats.pricing) {
        const plans = await db('product_plans').where({ product_id: id, is_active: true }).count({ n: '*' }).first();
        if (!Number(plans?.n)) missing.push('at least one active pricing option (use "Price on quotation" if prices are not public)');
      }
      if (missing.length) throw badRequest(`Before publishing, add ${missing.join(', ')}.`);
      Object.assign(patch, { is_published: true, is_archived: false, published_at: p.published_at ?? new Date(), wizard_step: 7 });
    } else if (action === 'unpublish') patch['is_published'] = false;
    else if (action === 'archive') Object.assign(patch, { is_published: false, is_archived: true });
    else patch['is_archived'] = false;
    await db('products').where({ id }).update(patch);
    await audit(req, { action: `product.${action}`, subjectType: 'product', subjectId: id, before: { is_published: !!p.is_published, is_archived: !!p.is_archived } });
    res.json(await loadProduct(id));
  }),
);

/** What switching features off would affect – shown to the admin before converting an offering. Nothing is deleted. */
async function conversionWarnings(id: number, prev: Record<string, boolean>, next: Record<string, boolean>) {
  const out: string[] = [];
  const count = async (q: Knex.QueryBuilder) => Number((await q.count({ n: '*' }).first())?.n ?? 0);
  if (prev['installer'] && !next['installer']) {
    const lic = await count(db('licences').where({ product_id: id }).whereNot('type', 'trial').whereIn('status', ['active', 'trial']));
    if (lic) out.push(`${lic} customer licence(s) exist. They stay valid, but the full installer will no longer be offered for download.`);
  }
  if (prev['demo'] && !next['demo']) {
    const d = await count(db('licences').where({ product_id: id, type: 'trial' }));
    if (d) out.push(`${d} customer demo(s) exist. Their records and expiry dates are kept; new demo downloads stop.`);
  }
  if (prev['trial'] && !next['trial']) {
    const t = await count(db('licences').where({ product_id: id, type: 'trial' }).whereIn('status', ['trial', 'active']));
    if (t) out.push(`${t} active trial(s) continue until they end; no new trials can be started.`);
  }
  if ((prev['pricing'] && !next['pricing']) || (prev['purchase'] && !next['purchase'])) {
    const q = await count(db('quote_requests').where({ product_id: id }).whereNotIn('status', ['won', 'lost', 'cancelled', 'fulfilled']));
    if (q) out.push(`${q} open sales enquiry(ies) stay in Sales enquiries; the price list / purchase form will be hidden.`);
  }
  if (prev['learning'] && !next['learning']) {
    const c = await count(db('product_content_items').where({ product_id: id }));
    if (c) out.push(`${c} content item(s) will be hidden from customers (not deleted). Switch “Learning content” on again to show them.`);
  }
  return out;
}

/** Duplicate an offering as a new draft: details, features, pricing, images, content library (same media files). Installers, customers and history are not copied. */
adminCatalogueRouter.post(
  '/products/:id/duplicate',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const p = await db('products').where({ id }).first();
    if (!p) throw notFound('Product not found.');
    // JSON columns come back parsed – store them as JSON text again.
    const plain = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v]));
    const newId = await db.transaction(async (trx) => {
      const name = `${p.name} (copy)`.slice(0, 160);
      const slug = await uniqueSlug('products', name);
      const { id: _id, slug: _s, created_at: _c, updated_at: _u, published_at: _p, view_count: _v, ...copy } = p;
      void _id; void _s; void _c; void _u; void _p; void _v;
      const [nid] = await trx('products').insert({ ...plain(copy), name, slug, is_published: false, is_archived: false, is_featured: false, view_count: 0, created_by: req.auth!.user.id });
      const clone = async (table: string, extra: Record<string, unknown> = {}) => {
        const rows = await trx(table).where({ product_id: id });
        for (const r of rows) {
          const { id: _x, created_at: _a, updated_at: _b, ...rest } = r;
          void _x; void _a; void _b;
          await trx(table).insert({ ...plain(rest), product_id: nid, ...extra });
        }
      };
      await clone('product_features');
      await clone('product_plans');
      await clone('product_media');
      const cats = await trx('product_content_categories').where({ product_id: id });
      const map = new Map<number, number>();
      for (const c of cats) {
        const [cid] = await trx('product_content_categories').insert({ product_id: nid, name: c.name, description: c.description, display_order: c.display_order, status: c.status });
        map.set(c.id, cid);
      }
      const items = await trx('product_content_items').where({ product_id: id });
      for (const i of items) {
        const { id: _x, created_at: _a, updated_at: _b, ...rest } = i;
        void _x; void _a; void _b;
        await trx('product_content_items').insert({ ...plain(rest), product_id: nid, category_id: i.category_id ? map.get(i.category_id) ?? null : null, status: 'draft', published_at: null, created_by: req.auth!.user.id, updated_by: req.auth!.user.id });
      }
      return nid;
    });
    await audit(req, { action: 'product.duplicated', subjectType: 'product', subjectId: newId, meta: { from: id } });
    res.status(201).json({ id: newId });
  }),
);

/* ---- Delete a product permanently ----
 * Allowed when no customer depends on it. Products that customers have licences, demos, downloads or sales
 * enquiries for can't be deleted (that would break their records and the licence checks of installed
 * software) – archive those instead, which removes them from the website and the active list.
 */
async function productUsage(id: number) {
  const n = async (q: ReturnType<typeof db>) => Number((await q.count({ n: '*' }).first())?.n ?? 0);
  return {
    demos: await n(db('licences').where({ product_id: id, type: 'trial' })),
    licences: await n(db('licences').where({ product_id: id }).whereNot('type', 'trial')),
    downloads: await n(db('downloads').where({ product_id: id })),
    salesEnquiries: await n(db('quote_requests').where({ product_id: id })),
  };
}

adminCatalogueRouter.get(
  '/products/:id/delete-check',
  requirePermission('products.publish'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    if (!(await db('products').where({ id }).first('id'))) throw notFound('Product not found.');
    const usage = await productUsage(id);
    res.json({ canDelete: Object.values(usage).every((v) => v === 0), usage });
  }),
);

adminCatalogueRouter.delete(
  '/products/:id',
  requirePermission('products.publish'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const p = await db('products').where({ id }).first('id', 'name', 'slug', 'is_published', 'is_archived');
    if (!p) throw notFound('Product not found.');
    const usage = await productUsage(id);
    if (Object.values(usage).some((v) => v > 0)) {
      const parts = [usage.demos && `${usage.demos} demo(s)`, usage.licences && `${usage.licences} licence(s)`, usage.downloads && `${usage.downloads} download(s)`, usage.salesEnquiries && `${usage.salesEnquiries} sales enquiry(ies)`].filter(Boolean).join(', ');
      throw new HttpError(409, `“${p.name}” can’t be deleted because customers have ${parts} for it. Archive it instead – it is then removed from the website and the active product list, and customer records stay intact.`, 'product_in_use', { usage });
    }
    await db.transaction(async (trx) => {
      const versionIds = (await trx('product_versions').where({ product_id: id }).select('id')).map((v) => v.id);
      if (versionIds.length) {
        await trx('learning_resources').whereIn('version_id', versionIds).update({ version_id: null });
        await trx('version_files').whereIn('version_id', versionIds).del();
        await trx('product_versions').whereIn('id', versionIds).del();
      }
      // Learning materials are kept (as general material, unpublished) rather than lost with the product.
      await trx('learning_resources').where({ product_id: id }).update({ product_id: null, is_published: false });
      await trx('customer_products').where({ product_id: id }).del();
      // Content library: items first, then categories (MariaDB can't combine both cascades from products).
      await trx('product_content_items').where({ product_id: id }).del();
      await trx('product_content_categories').where({ product_id: id }).del();
      await trx('products').where({ id }).del(); // features, plans, media links, setup steps follow automatically
    });
    await audit(req, { action: 'product.deleted', subjectType: 'product', subjectId: id, before: p });
    res.status(204).end();
  }),
);

/* ---- Features / benefits / FAQs (replace the whole list – simple and atomic) ---- */
adminCatalogueRouter.put(
  '/products/:id/features',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { items } = parse(
      z.object({ items: z.array(z.object({ kind: z.enum(['feature', 'benefit', 'faq']), title: z.string().trim().min(1, 'Required').max(255), body: optStr(5000), icon: optStr(64) })).max(200) }),
      req.body,
    );
    if (!(await db('products').where({ id }).first('id'))) throw notFound();
    await db.transaction(async (trx) => {
      await trx('product_features').where({ product_id: id }).del();
      if (items.length) await trx('product_features').insert(items.map((f, i) => ({ product_id: id, kind: f.kind, title: f.title, body: f.body ?? null, icon: f.icon ?? null, sort_order: i })));
      await trx('products').where({ id }).update({ updated_at: new Date() });
    });
    await audit(req, { action: 'product.features_updated', subjectType: 'product', subjectId: id, meta: { count: items.length } });
    res.json(await loadProduct(id));
  }),
);

/* ---- Pricing plans ---- */
const planSchema = z
  .object({
    id: z.number().int().optional(),
    name: z.string().trim().min(1, 'Name the option').max(120),
    model: z.enum(PLAN_MODELS),
    priceCents: z.number().int().min(0).max(100_000_000_00).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).default('ZAR'),
    billingPeriod: z.enum(['none', 'month', 'year']).default('none'),
    unit: z.enum(['licence', 'user', 'device']).default('licence'),
    priceIncludesVat: z.boolean().default(false),
    conditions: optStr(2000),
    inclusions: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
    maxDevices: z.number().int().min(1).max(10000).nullable().optional(),
    isActive: z.boolean().default(true),
    isHighlighted: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (!['free', 'quote', 'trial'].includes(p.model) && p.priceCents === null) ctx.addIssue({ code: 'custom', message: 'Enter a price', path: ['priceCents'] });
    if (p.model === 'monthly' && p.billingPeriod !== 'month') ctx.addIssue({ code: 'custom', message: 'Monthly plans bill per month', path: ['billingPeriod'] });
    if (p.model === 'annual' && p.billingPeriod !== 'year') ctx.addIssue({ code: 'custom', message: 'Annual plans bill per year', path: ['billingPeriod'] });
  });

adminCatalogueRouter.put(
  '/products/:id/plans',
  requirePermission('pricing.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { plans } = parse(z.object({ plans: z.array(planSchema).max(30) }), req.body);
    if (!(await db('products').where({ id }).first('id'))) throw notFound();
    const before = await db('product_plans').where({ product_id: id });
    await db.transaction(async (trx) => {
      const keep = plans.filter((p) => p.id).map((p) => p.id!);
      // Plans referenced by licences/quotes are deactivated rather than deleted (keeps history intact).
      const removed = before.filter((b) => !keep.includes(b.id)).map((b) => b.id);
      if (removed.length) {
        const used = await trx('licences').whereIn('plan_id', removed).pluck('plan_id');
        const usedQ = await trx('quote_requests').whereIn('plan_id', removed).pluck('plan_id');
        const inUse = new Set([...used, ...usedQ]);
        const del = removed.filter((r) => !inUse.has(r));
        if (del.length) await trx('product_plans').whereIn('id', del).del();
        if (inUse.size) await trx('product_plans').whereIn('id', [...inUse]).update({ is_active: false });
      }
      for (const [i, p] of plans.entries()) {
        const row = {
          product_id: id,
          name: p.name,
          model: p.model,
          price_cents: ['free', 'quote'].includes(p.model) ? null : p.priceCents,
          currency: p.currency,
          billing_period: p.model === 'monthly' ? 'month' : p.model === 'annual' ? 'year' : p.billingPeriod,
          unit: p.model === 'per_user' ? 'user' : p.model === 'per_device' ? 'device' : p.unit,
          price_includes_vat: p.priceIncludesVat,
          conditions: p.conditions ?? null,
          inclusions: JSON.stringify(p.inclusions),
          max_devices: p.maxDevices ?? null,
          sort_order: i,
          is_active: p.isActive,
          is_highlighted: p.isHighlighted,
          updated_at: new Date(),
        };
        if (p.id && before.some((b) => b.id === p.id)) await trx('product_plans').where({ id: p.id, product_id: id }).update(row);
        else await trx('product_plans').insert(row);
      }
      await trx('products').where({ id }).update({ updated_at: new Date() });
    });
    await audit(req, { action: 'product.pricing_updated', subjectType: 'product', subjectId: id, before: before.map((b) => ({ name: b.name, model: b.model, price_cents: b.price_cents })), after: plans.map((p) => ({ name: p.name, model: p.model, price_cents: p.priceCents })) });
    res.json(await loadProduct(id));
  }),
);

/* ---- Product media (screenshots + videos) ---- */
adminCatalogueRouter.post(
  '/products/:id/media',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(z.object({ mediaId: z.number().int(), role: z.enum(MEDIA_ROLES), caption: optStr(255) }), req.body);
    const m = await db('media').where({ id: input.mediaId }).first('kind');
    if (!m) throw badRequest('File not found in the media library.');
    const isVideo = !['screenshot', 'gallery', 'promo', 'feature_image'].includes(input.role);
    if (isVideo && !['video', 'external_video'].includes(m.kind)) throw badRequest('Choose a video for this slot.');
    if (!isVideo && m.kind !== 'image') throw badRequest('Choose an image for screenshots.');
    const max = await db('product_media').where({ product_id: id }).max({ m: 'sort_order' }).first();
    await db('product_media').insert({ product_id: id, media_id: input.mediaId, role: input.role, caption: input.caption ?? null, sort_order: Number(max?.m ?? 0) + 1 });
    // Media shown on a public product page must itself be public.
    await db('media').where({ id: input.mediaId }).update({ visibility: 'public' });
    await audit(req, { action: 'product.media_added', subjectType: 'product', subjectId: id, meta: input });
    res.json(await loadProduct(id));
  }),
);

/** Video/screenshot details: title shown on the tile, short description, duration and thumbnail. */
adminCatalogueRouter.patch(
  '/products/:id/media/:linkId',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const linkId = Number(req.params['linkId']);
    const input = parse(
      z.object({
        caption: optStr(255),
        description: optStr(500),
        durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
        thumbnailMediaId: z.number().int().nullable().optional(),
      }),
      req.body,
    );
    const link = await db('product_media').where({ id: linkId, product_id: id }).first('id');
    if (!link) throw notFound('That video or image is not linked to this product.');
    if (input.thumbnailMediaId) {
      const m = await db('media').where({ id: input.thumbnailMediaId }).first('kind');
      if (!m || m.kind !== 'image') throw badRequest('The thumbnail must be an image from the media library.');
      await db('media').where({ id: input.thumbnailMediaId }).update({ visibility: 'public' });
    }
    const row: Record<string, unknown> = {};
    if (input.caption !== undefined) row['caption'] = input.caption ?? null;
    if (input.description !== undefined) row['description'] = input.description ?? null;
    if (input.durationSeconds !== undefined) row['duration_seconds'] = input.durationSeconds || null;
    if (input.thumbnailMediaId !== undefined) row['thumbnail_media_id'] = input.thumbnailMediaId || null;
    if (Object.keys(row).length) await db('product_media').where({ id: linkId }).update(row);
    await audit(req, { action: 'product.media_updated', subjectType: 'product', subjectId: id, meta: { linkId, ...input } });
    res.json(await loadProduct(id));
  }),
);

adminCatalogueRouter.delete(
  '/products/:id/media/:linkId',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    await db('product_media').where({ id: Number(req.params['linkId']), product_id: id }).del();
    await audit(req, { action: 'product.media_removed', subjectType: 'product', subjectId: id });
    res.json(await loadProduct(id));
  }),
);

/* ---- Learning resources ---- */
const learningSchema = z
  .object({
    productId: z.number().int().nullable().optional(),
    section: z.enum(LEARNING_SECTIONS),
    audience: z.enum(['customer', 'partner', 'both']).default('both'),
    visibility: z.enum(['public', 'customer', 'partner', 'staff']).default('public'),
    kind: z.enum(['document', 'video', 'article', 'faq', 'template', 'link']),
    title: z.string().trim().min(2, 'Add a title').max(255),
    summary: optStr(1000),
    body: optStr(60000),
    mediaId: z.number().int().nullable().optional(),
    url: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
    isPublished: z.boolean().default(false),
  })
  .superRefine((l, ctx) => {
    if (l.kind === 'link') {
      if (!l.mediaId && !l.url) ctx.addIssue({ code: 'custom', message: 'Enter the web address', path: ['url'] });
      if (l.url && !/^https:\/\/\S+$/.test(l.url)) ctx.addIssue({ code: 'custom', message: 'Links must start with https://', path: ['url'] });
    } else if (['document', 'video', 'template'].includes(l.kind) && !l.mediaId) ctx.addIssue({ code: 'custom', message: 'Choose a file or video from the media library', path: ['mediaId'] });
    if (['article', 'faq'].includes(l.kind) && !l.body) ctx.addIssue({ code: 'custom', message: 'Write the content', path: ['body'] });
  });

async function syncMediaVisibility(mediaId: number | null | undefined, visibility: string) {
  if (!mediaId) return;
  // A file is never more open than the most restrictive rule needs: use the most public linked resource.
  const rank = { public: 0, customer: 1, partner: 2, staff: 3 } as Record<string, number>;
  const m = await db('media').where({ id: mediaId }).first('visibility');
  if (m && rank[visibility] < rank[m.visibility]) await db('media').where({ id: mediaId }).update({ visibility });
}

adminCatalogueRouter.get(
  '/learning',
  requirePermission('products.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ productId: z.coerce.number().int().optional(), general: z.enum(['1']).optional(), q: z.string().trim().max(100).optional() }), req.query);
    const base = db('learning_resources as l').leftJoin('products as p', 'p.id', 'l.product_id').leftJoin('media as m', 'm.id', 'l.media_id');
    if (q.productId) base.where('l.product_id', q.productId);
    if (q.general) base.whereNull('l.product_id');
    if (q.q) base.where('l.title', 'like', like(q.q));
    const [{ total }] = await base.clone().count({ total: 'l.id' });
    const data = await base.clone().orderBy(q.productId ? [{ column: 'l.sort_order' }, { column: 'l.id' }] : [{ column: 'l.updated_at', order: 'desc' }]).limit(q.perPage).offset((q.page - 1) * q.perPage).select('l.*', 'p.name as product_name', 'm.title as media_title', 'm.kind as media_kind', 'm.external_url');
    res.json({ data: data.map((l) => ({ ...l, is_published: !!l.is_published, link_url: l.url, url: l.url ?? l.external_url ?? mediaUrl(l.media_id, l.media_title) })), meta: { page: q.page, perPage: q.perPage, total: Number(total) } });
  }),
);

adminCatalogueRouter.post(
  '/learning',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const input = parse(learningSchema, req.body);
    const [id] = await db('learning_resources').insert({
      product_id: input.productId ?? null,
      section: input.section,
      audience: input.audience,
      visibility: input.visibility,
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      body: input.body ?? null,
      media_id: input.mediaId ?? null,
      url: input.url ?? null,
      is_published: input.isPublished,
    });
    await syncMediaVisibility(input.mediaId, input.visibility);
    await audit(req, { action: 'learning.created', subjectType: 'learning_resource', subjectId: id, after: { title: input.title, visibility: input.visibility } });
    res.status(201).json({ id });
  }),
);

adminCatalogueRouter.put(
  '/learning/:id',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(learningSchema, req.body);
    const before = await db('learning_resources').where({ id }).first();
    if (!before) throw notFound();
    await db('learning_resources').where({ id }).update({
      product_id: input.productId ?? null,
      section: input.section,
      audience: input.audience,
      visibility: input.visibility,
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      body: input.body ?? null,
      media_id: input.mediaId ?? null,
      url: input.url ?? null,
      is_published: input.isPublished,
      updated_at: new Date(),
    });
    await syncMediaVisibility(input.mediaId, input.visibility);
    await audit(req, { action: 'learning.updated', subjectType: 'learning_resource', subjectId: id, before: { title: before.title, visibility: before.visibility }, after: { title: input.title, visibility: input.visibility } });
    res.json({ ok: true });
  }),
);

adminCatalogueRouter.delete(
  '/learning/:id',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const before = await db('learning_resources').where({ id }).first();
    if (!before) throw notFound();
    await db('learning_resources').where({ id }).del();
    await audit(req, { action: 'learning.deleted', subjectType: 'learning_resource', subjectId: id, before: { title: before.title } });
    res.json({ ok: true });
  }),
);

/* =============================== Media library =============================== */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 } });
const MAX_IMAGE = 5 * 1024 * 1024;

adminCatalogueRouter.get(
  '/media',
  requirePermission('media.manage', 'products.manage'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ kind: z.enum(['image', 'video', 'pdf', 'document', 'installer', 'archive', 'external_video', 'other']).optional(), q: z.string().trim().max(100).optional() }), req.query);
    // Demo installers are managed under each product's Demo files and never offered from the library.
    const base = db('media').whereNotExists(db('version_files as vf').join('product_versions as pv', 'pv.id', 'vf.version_id').whereRaw('vf.media_id = media.id').where('pv.channel', 'demo'));
    if (q.kind) base.where('kind', q.kind);
    if (q.q) base.where((b) => b.where('title', 'like', like(q.q!)).orWhere('original_name', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: '*' });
    const data = await base.clone().orderBy('id', 'desc').limit(q.perPage).offset((q.page - 1) * q.perPage).select('id', 'kind', 'title', 'original_name', 'mime', 'size_bytes', 'visibility', 'external_url', 'meta', 'created_at');
    res.json({
      data: data.map((m) => ({ ...m, size_bytes: m.size_bytes === null ? null : Number(m.size_bytes), meta: parseJson(m.meta, {}), url: m.kind === 'external_video' ? m.external_url : mediaUrl(m.id, m.original_name || m.title), embed: embedUrl(m.external_url) })),
      meta: { page: q.page, perPage: q.perPage, total: Number(total) },
    });
  }),
);

adminCatalogueRouter.post(
  '/media/upload',
  requirePermission('media.manage', 'products.manage'),
  (req, res, next) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err) return next((err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? badRequest('That file is larger than 25 MB.') : badRequest('Upload failed. Please try again.'));
      next();
    }),
  ah(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Choose a file to upload.');
    const { title, visibility } = parse(z.object({ title: z.string().trim().max(191).optional(), visibility: z.enum(['public', 'customer', 'partner', 'staff']).default('public') }), req.body);
    const kind = sniff(file.buffer);
    if (!kind) throw badRequest('Only JPG, PNG, WebP, GIF images and PDF documents can be uploaded here.');
    if (kind.kind === 'image' && file.size > MAX_IMAGE) throw badRequest('Images must be 5 MB or smaller. Please compress the image and try again.');
    const stored = await saveFile(file.buffer, kind.kind === 'image' ? 'images' : 'docs', kind.ext);
    const dims = kind.kind === 'image' ? imageSize(file.buffer) : null;
    const original = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
    const [id] = await db('media').insert({
      kind: kind.kind,
      title: title || original.replace(/\.[^.]+$/, '') || 'Untitled',
      disk: 'private',
      storage_key: stored.storageKey,
      original_name: original,
      mime: kind.mime,
      size_bytes: stored.size,
      sha256: stored.sha256,
      visibility,
      meta: dims ? JSON.stringify(dims) : null,
      uploaded_by: req.auth!.user.id,
    });
    await audit(req, { action: 'media.uploaded', subjectType: 'media', subjectId: id, meta: { name: original, size: stored.size, mime: kind.mime } });
    res.status(201).json({ id, kind: kind.kind, url: mediaUrl(id, original) });
  }),
);

adminCatalogueRouter.post(
  '/media/external',
  requirePermission('media.manage', 'products.manage'),
  ah(async (req, res) => {
    const input = parse(z.object({ title: z.string().trim().min(2, 'Add a title').max(191), url: z.string().trim().url('Enter a full link starting with https://').regex(/^https?:\/\//i, 'Use a link that starts with https://').max(500), visibility: z.enum(['public', 'customer', 'partner', 'staff']).default('public') }), req.body);
    if (!embedUrl(input.url)) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { url: 'Use a YouTube or Vimeo video link' } });
    const [id] = await db('media').insert({ kind: 'external_video', title: input.title, disk: 'external', external_url: input.url, visibility: input.visibility, uploaded_by: req.auth!.user.id });
    await audit(req, { action: 'media.video_linked', subjectType: 'media', subjectId: id, meta: input });
    res.status(201).json({ id });
  }),
);

adminCatalogueRouter.patch(
  '/media/:id',
  requirePermission('media.manage', 'products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(z.object({ title: z.string().trim().min(1).max(191).optional(), visibility: z.enum(['public', 'customer', 'partner', 'staff']).optional() }), req.body);
    if (!(await db('media').where({ id }).first('id'))) throw notFound();
    await db('media').where({ id }).update({ ...input, updated_at: new Date() });
    await audit(req, { action: 'media.updated', subjectType: 'media', subjectId: id, after: input });
    res.json({ ok: true });
  }),
);

adminCatalogueRouter.delete(
  '/media/:id',
  requirePermission('media.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const m = await db('media').where({ id }).first();
    if (!m) throw notFound();
    const uses = await Promise.all([
      db('products').where('logo_media_id', id).orWhere('hero_media_id', id).orWhere('preview_media_id', id).orWhere('about_cover_media_id', id).orWhere('about_image_media_id', id).count({ n: '*' }).first(),
      db('product_media').where('media_id', id).orWhere('thumbnail_media_id', id).count({ n: '*' }).first(),
      db('learning_resources').where('media_id', id).count({ n: '*' }).first(),
      db('version_files').where('media_id', id).count({ n: '*' }).first(),
    ]);
    if (uses.some((u) => Number(u?.n) > 0)) throw conflict('This file is still used by a product or learning item. Remove it there first.');
    const story = (await getSiteContent(['story']))['story'] as { imageMediaId?: number | null };
    if (Number(story.imageMediaId) === id) throw conflict('This picture is used by the About SCHLUSS puzzle. Choose another picture there first.');
    await db('media').where({ id }).del();
    if (m.storage_key) await removeFile(m.storage_key);
    await audit(req, { action: 'media.deleted', subjectType: 'media', subjectId: id, before: { title: m.title, original_name: m.original_name } });
    res.json({ ok: true });
  }),
);

/* =============================== About SCHLUSS experience =============================== */
/** Every live (not archived) offering with its About SCHLUSS settings – one screen to choose and order the puzzle pieces. */
adminCatalogueRouter.get(
  '/about-experience/products',
  requirePermission('products.view'),
  ah(async (_req, res) => {
    const rows = await db('products as p')
      .leftJoin('product_categories as c', 'c.id', 'p.category_id')
      .where('p.is_archived', false)
      .orderBy([{ column: 'p.about_show', order: 'desc' }, { column: 'p.about_order' }, { column: 'p.name' }])
      .select('p.id', 'p.name', 'p.slug', 'p.status', 'p.is_published', 'p.offering_type', 'p.short_description', 'p.logo_media_id', 'p.hero_media_id', 'p.about_show', 'p.about_puzzle', 'p.about_order', 'p.about_description', 'p.about_highlight', 'p.about_cover_media_id', 'p.about_image_media_id', 'c.name as category');
    res.json(rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, status: r.status, is_published: !!r.is_published, offering: TYPE_LABEL[offeringTypeOf(r)], category: r.category,
      short_description: r.short_description, show: !!r.about_show && !!r.about_puzzle, order: r.about_order, description: r.about_description, tagline: r.about_highlight,
      image: mediaUrl(r.about_cover_media_id, r.slug + '-about') ?? mediaUrl(r.hero_media_id, r.slug), logo: mediaUrl(r.about_image_media_id, r.slug + '-about-image') ?? mediaUrl(r.logo_media_id, r.slug),
    })));
  }),
);
const aboutBulk = z.object({
  items: z.array(z.object({ id: z.number().int(), show: z.boolean(), order: z.number().int().min(0).max(9999), description: optStr(1500), tagline: optStr(160) })).max(500),
});
adminCatalogueRouter.put(
  '/about-experience/products',
  requirePermission('products.manage'),
  ah(async (req, res) => {
    const { items } = parse(aboutBulk, req.body);
    const known = new Set((await db('products').whereIn('id', items.map((i) => i.id)).select('id')).map((r) => r.id));
    const missing = items.filter((i) => !known.has(i.id));
    if (missing.length) throw notFound('One of the offerings no longer exists – reload the page.');
    await db.transaction(async (trx) => {
      for (const i of items) {
        await trx('products').where({ id: i.id }).update({ about_show: i.show, about_puzzle: true, about_order: i.order, about_description: i.description || null, about_highlight: i.tagline || null, updated_at: new Date() });
      }
    });
    await audit(req, { action: 'about.products_updated', subjectType: 'site_content', meta: { key: 'story', shown: items.filter((i) => i.show).map((i) => i.id) } });
    res.json({ ok: true });
  }),
);

/* =============================== Website content =============================== */
adminCatalogueRouter.get(
  '/site-content',
  requirePermission('content.manage'),
  ah(async (_req, res) => {
    res.json(await getSiteContent());
  }),
);

const text = (max: number) => z.string().trim().max(max);
const SITE_SCHEMAS: Record<SiteKey, z.ZodType> = {
  banner: z.object({ enabled: z.boolean(), text: text(200), link: text(300).refine((v) => !v || v.startsWith('/') || /^https:\/\//.test(v), 'Use a page path like /products or a full https:// link') }),
  home: z.object({
    heroEyebrow: text(80),
    heroTitle: text(120).min(3),
    heroSubtitle: text(300),
    introTitle: text(120),
    introBody: text(1200),
    conceptTitle: text(120),
    conceptBody: text(1200),
    why: z.array(z.object({ title: text(80).min(1), body: text(300) })).min(1).max(8),
    supportTitle: text(120),
    supportBody: text(600),
    ctaTitle: text(120),
    ctaBody: text(300),
  }),
  about: z.object({ title: text(120).min(2), intro: text(400), body: z.array(text(2000)).max(12) }),
  story: z.object({
    enabled: z.boolean(),
    imageMediaId: z.number().int().positive().nullable(),
    meaningTitle: text(80).min(2),
    meaningMessage: text(120),
    meaningText: text(400),
    moreTitle: text(80).min(2),
    moreText: text(400),
    moreHue: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour'),
    finalTitle: text(120),
    finalText: text(200),
    timing: z.object({
      approach: z.number().min(0.5).max(5),
      tileIn: z.number().min(0.2).max(3),
      view: z.number().min(2).max(30),
      tileOut: z.number().min(0.2).max(3),
      place: z.number().min(0.5).max(5),
    }),
  }),
  partners: z.object({ title: text(120).min(2), subtitle: text(400), benefits: z.array(z.object({ title: text(80).min(1), body: text(300) })).max(8), steps: z.array(text(120)).max(8) }),
  contact: z.object({ email: z.string().trim().max(191).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email'), phone: text(40), whatsapp: text(40), address: text(500), hours: text(200) }),
  footer: z.object({ tagline: text(300) }),
};

adminCatalogueRouter.put(
  '/site-content/:key',
  requirePermission('content.manage'),
  ah(async (req, res) => {
    const key = req.params['key'] as SiteKey;
    if (!SITE_KEYS.includes(key)) throw notFound('Unknown content section.');
    const value = parse(SITE_SCHEMAS[key], req.body);
    if (key === 'story') {
      const mid = (value as { imageMediaId: number | null }).imageMediaId;
      if (mid) {
        const m = await db('media').where({ id: mid }).first('kind', 'visibility');
        if (!m || m.kind !== 'image') throw badRequest('The About SCHLUSS picture must be an image from the media library.');
        if (m.visibility !== 'public') await db('media').where({ id: mid }).update({ visibility: 'public' }); // shown on a public page
      }
    }
    const before = (await getSiteContent([key]))[key];
    await db('site_content').insert({ key, value: JSON.stringify(value), updated_by: req.auth!.user.id, updated_at: new Date() }).onConflict('key').merge();
    await audit(req, { action: 'content.updated', subjectType: 'site_content', meta: { key }, before, after: value });
    res.json({ ok: true });
  }),
);

adminCatalogueRouter.delete(
  '/site-content/:key',
  requirePermission('content.manage'),
  ah(async (req, res) => {
    const key = req.params['key'] as SiteKey;
    if (!SITE_KEYS.includes(key)) throw notFound();
    await db('site_content').where({ key }).del();
    await audit(req, { action: 'content.reset', subjectType: 'site_content', meta: { key } });
    res.json(SITE_DEFAULTS[key]);
  }),
);

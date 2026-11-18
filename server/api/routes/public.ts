import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { currentDemoVersion, currentReleaseVersion, demoConfig, fullAccess } from '../services/demos';
import { featuresOf, offeringTypeOf, OFFERING_TYPES, TYPE_LABEL as OFFERING_LABEL } from '../services/offerings';
import { getSetting, inbox, inboxFor, notifyStaff } from '../services/platform';
import { config } from '../config';
import { db } from '../db';
import { ah, conflict, HttpError, like, notFound, parse } from '../http';
import { audit } from '../services/audit';
import {
  adminInboxes,
  embedUrl,
  mediaUrl,
  parseJson,
  pricingSummaries,
  PRODUCT_STATUSES,
} from '../services/catalogue';
import { ipHash, reference } from '../services/crypto';
import { queueEmail } from '../services/jobs';
import { getSiteContent } from '../services/site-content';

/** Public, read-only catalogue + public forms. No personal data is ever returned from here. */
export const publicRouter = Router();

// Each public form gets its own limiter so one form never blocks another.
const formLimiter = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many submissions. Please wait a few minutes and try again.' } },
});

const cachePublic = (seconds: number) => (_req: unknown, res: { set: (k: string, v: string) => void }, next: () => void) => {
  res.set('Cache-Control', `public, max-age=${seconds}`);
  next();
};

/* ------------------------------ Site content ------------------------------ */
publicRouter.get(
  '/site',
  cachePublic(60),
  ah(async (_req, res) => {
    res.json(await getSiteContent());
  }),
);

/* ------------------------------ About SCHLUSS story ------------------------------ */
/**
 * Everything the About SCHLUSS page needs: the fixed first ("what SCHLUSS means") and last ("and more to come")
 * pieces from Website content, and every published offering an admin has switched on for the page – in the admin's order.
 * Offerings with "Include in puzzle animation" off are listed on the page but get no puzzle piece.
 */
publicRouter.get(
  '/about-story',
  cachePublic(60),
  ah(async (_req, res) => {
    const { story } = (await getSiteContent(['story'])) as { story: Record<string, unknown> & { imageMediaId?: number | null } };
    const image = mediaUrl(story.imageMediaId, 'about-schluss');
    const rows = await publishedProducts()
      .andWhere('p.about_show', true)
      .orderBy([{ column: 'p.about_order' }, { column: 'p.name' }])
      .limit(200)
      .select('p.id', 'p.slug', 'p.name', 'p.tagline', 'p.short_description', 'p.offering_type', 'p.features', 'p.logo_media_id', 'p.hero_media_id', 'p.preview_media_id',
        'p.about_puzzle', 'p.about_title', 'p.about_description', 'p.about_problem', 'p.about_highlight', 'p.about_cover_media_id', 'p.about_image_media_id', 'c.name as category_name');
    const ids = rows.map((r) => r.id);
    const feats = ids.length ? await db('product_features').whereIn('product_id', ids).whereIn('kind', ['benefit', 'feature']).orderBy(['kind', 'sort_order', 'id']).select('product_id', 'kind', 'title') : [];
    const pieces = rows.map((r) => {
      const mine = feats.filter((f) => f.product_id === r.id);
      const benefits = (mine.some((f) => f.kind === 'benefit') ? mine.filter((f) => f.kind === 'benefit') : mine).slice(0, 4).map((f) => f.title);
      return {
        slug: r.slug,
        name: r.name,
        title: r.about_title || r.name,
        description: r.about_description || r.short_description || r.tagline || '',
        tagline: r.about_highlight || r.tagline || null,
        type: OFFERING_LABEL[offeringTypeOf(r)],
        problem: r.about_problem || null,
        highlight: r.about_highlight || null,
        category: r.category_name || OFFERING_LABEL[offeringTypeOf(r)],
        benefits,
        cover: mediaUrl(r.about_cover_media_id, r.slug + '-about') ?? mediaUrl(r.hero_media_id, r.slug) ?? mediaUrl(r.preview_media_id, r.slug + '-preview'),
        image: mediaUrl(r.about_image_media_id, r.slug + '-about-image') ?? mediaUrl(r.logo_media_id, r.slug),
        link: `/products/${r.slug}`,
        puzzle: !!r.about_puzzle,
      };
    });
    res.json({ story: { ...story, imageMediaId: undefined, image }, pieces: story['enabled'] === false ? [] : pieces });
  }),
);

/* ------------------------------ Categories ------------------------------ */
publicRouter.get(
  '/categories',
  cachePublic(60),
  ah(async (_req, res) => {
    const rows = await db('product_categories as c')
      .leftJoin('products as p', function () {
        this.on('p.category_id', 'c.id').andOn('p.is_published', db.raw('1')).andOn('p.is_archived', db.raw('0'));
      })
      .where('c.is_active', true)
      .groupBy('c.id')
      .orderBy([{ column: 'c.sort_order' }, { column: 'c.name' }])
      .select('c.id', 'c.name', 'c.slug', 'c.description', 'c.icon')
      .count({ productCount: 'p.id' });
    res.json(rows.map((r) => ({ ...r, productCount: Number(r.productCount) })));
  }),
);

/* ------------------------------ Products ------------------------------ */
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(140).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  type: z.string().trim().max(64).optional(),
  offering: z.enum(OFFERING_TYPES).optional(),
  price: z.enum(['free', 'trial', 'paid', 'quote']).optional(),
  featured: z.enum(['1', 'true']).optional(),
  sort: z.enum(['newest', 'name', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(48).default(12),
});

function publishedProducts() {
  return db('products as p').leftJoin('product_categories as c', 'c.id', 'p.category_id').where('p.is_published', true).andWhere('p.is_archived', false);
}

publicRouter.get(
  '/products',
  cachePublic(30),
  ah(async (req, res) => {
    const q = parse(listQuery, req.query);
    const base = publishedProducts();
    if (q.q) base.andWhere((b) => b.where('p.name', 'like', like(q.q!)).orWhere('p.short_description', 'like', like(q.q!)).orWhere('p.tagline', 'like', like(q.q!)));
    if (q.category) base.andWhere('c.slug', q.category);
    if (q.status) base.andWhere('p.status', q.status);
    if (q.type) base.andWhere('p.product_type', q.type);
    if (q.offering) base.andWhere('p.offering_type', q.offering);
    if (q.featured) base.andWhere('p.is_featured', true);
    if (q.price === 'trial') base.andWhere((b) => b.where('p.trial_days', '>', 0).orWhereExists(db('product_plans as pl').whereRaw('pl.product_id = p.id').andWhere({ 'pl.is_active': true, 'pl.model': 'trial' })));
    if (q.price === 'free') base.whereExists(db('product_plans as pl').whereRaw('pl.product_id = p.id').andWhere({ 'pl.is_active': true, 'pl.model': 'free' }));
    if (q.price === 'quote') base.whereExists(db('product_plans as pl').whereRaw('pl.product_id = p.id').andWhere({ 'pl.is_active': true, 'pl.model': 'quote' }));
    if (q.price === 'paid') base.whereExists(db('product_plans as pl').whereRaw('pl.product_id = p.id').andWhere('pl.is_active', true).whereNotNull('pl.price_cents').whereNotIn('pl.model', ['free', 'quote']));

    const [{ total }] = await base.clone().clearSelect().count({ total: 'p.id' });
    const order =
      q.sort === 'name' ? [{ column: 'p.name' }] : q.sort === 'popular' ? [{ column: 'p.view_count', order: 'desc' }, { column: 'p.name' }] : [{ column: 'p.published_at', order: 'desc' }, { column: 'p.id', order: 'desc' }];
    const rows = await base
      .clone()
      .orderBy(order as never)
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('p.id', 'p.slug', 'p.name', 'p.tagline', 'p.short_description', 'p.status', 'p.product_type', 'p.is_featured', 'p.trial_days', 'p.demo_options', 'p.logo_media_id', 'p.hero_media_id', 'p.preview_media_id', 'p.expected_release', 'p.published_at', 'p.offering_type', 'p.features', 'c.name as category_name', 'c.slug as category_slug');

    const ids = rows.map((r) => r.id);
    const pricing = await pricingSummaries(ids);
    const versions = ids.length
      ? await db('product_versions').whereIn('product_id', ids).andWhere('status', 'released').orderBy([{ column: 'is_latest', order: 'desc' }, { column: 'release_date', order: 'desc' }]).select('product_id', 'version')
      : [];

    res.json({
      data: rows.map((r) => {
        const demo = parseJson<Record<string, unknown>>(r.demo_options, {});
        return {
          slug: r.slug,
          name: r.name,
          tagline: r.tagline,
          shortDescription: r.short_description,
          status: r.status,
          productType: r.product_type,
          offeringType: offeringTypeOf(r),
          featured: !!r.is_featured,
          trialDays: featuresOf(r).trial ? r.trial_days : null,
          demoAvailable: featuresOf(r).demo && (r.status === 'demo_available' || Object.values(demo).some((v) => !!v)),
          logo: mediaUrl(r.logo_media_id, r.slug),
          image: mediaUrl(r.hero_media_id, r.slug),
          previewImage: mediaUrl(r.preview_media_id, r.slug + '-preview'),
          expectedRelease: r.expected_release,
          category: r.category_slug ? { name: r.category_name, slug: r.category_slug } : null,
          pricing: pricing.get(r.id),
          version: versions.find((v) => v.product_id === r.id)?.version ?? null,
        };
      }),
      meta: { page: q.page, perPage: q.perPage, total: Number(total) },
    });
  }),
);

publicRouter.get(
  '/product-types',
  cachePublic(60),
  ah(async (_req, res) => {
    const rows = await publishedProducts().whereNotNull('p.product_type').distinct('p.product_type as type').orderBy('type');
    res.json(rows.map((r) => r.type).filter(Boolean));
  }),
);

publicRouter.get(
  '/products/:slug',
  ah(async (req, res) => {
    const slug = String(req.params['slug']).slice(0, 180);
    const p = await publishedProducts().where('p.slug', slug).first('p.*', 'c.name as category_name', 'c.slug as category_slug');
    if (!p) throw notFound('Product not found.');
    await db('products').where({ id: p.id }).increment('view_count', 1);

    const [features, plans, media, versions, learning] = await Promise.all([
      db('product_features').where({ product_id: p.id }).orderBy(['kind', 'sort_order', 'id']).select('kind', 'title', 'body', 'icon'),
      db('product_plans').where({ product_id: p.id, is_active: true }).orderBy(['sort_order', 'id']).select('id', 'name', 'model', 'price_cents', 'currency', 'billing_period', 'unit', 'price_includes_vat', 'conditions', 'inclusions', 'max_devices', 'is_highlighted'),
      db('product_media as pm').join('media as m', 'm.id', 'pm.media_id').where('pm.product_id', p.id).andWhere('m.visibility', 'public').orderBy(['pm.role', 'pm.sort_order']).select('m.id', 'm.kind', 'm.title', 'm.external_url', 'm.original_name', 'm.meta', 'pm.role', 'pm.caption', 'pm.description', 'pm.duration_seconds', 'pm.thumbnail_media_id'),
      db('product_versions as v').where({ 'v.product_id': p.id, 'v.status': 'released', 'v.channel': 'release' }).orderBy([{ column: 'v.release_date', order: 'desc' }, { column: 'v.id', order: 'desc' }]).limit(10).select('v.id', 'v.version', 'v.name', 'v.release_date', 'v.release_notes', 'v.is_latest', 'v.is_recommended', 'v.min_requirements'),
      db('learning_resources as l').leftJoin('media as m', 'm.id', 'l.media_id').where({ 'l.product_id': p.id, 'l.is_published': true }).whereIn('l.audience', ['customer', 'both']).orderBy(['l.section', 'l.sort_order', 'l.id']).select('l.id', 'l.section', 'l.kind', 'l.title', 'l.summary', 'l.body', 'l.visibility', 'l.media_id', 'l.url as link_url', 'm.kind as media_kind', 'm.external_url', 'm.original_name'),
    ]);
    const demoCfg = demoConfig(p);
    const demoVersion = demoCfg.available ? await currentDemoVersion(p.id) : null;
    const feats = featuresOf(p);
    const access = fullAccess(p);
    const fullVersion = access !== 'off' ? await currentReleaseVersion(p.id) : null;
    const steps = await db('product_setup_steps').where({ product_id: p.id, is_enabled: true, is_archived: false }).count({ n: '*' }).first();
    const vIds = versions.map((v) => v.id);
    const files = vIds.length ? await db('version_files').whereIn('version_id', vIds).andWhere('is_active', true).select('version_id', 'platform', 'architecture') : [];

    res.json({
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      shortDescription: p.short_description,
      description: p.description,
      status: p.status,
      productType: p.product_type,
      offeringType: offeringTypeOf(p),
      offeringFeatures: feats,
      category: p.category_slug ? { name: p.category_name, slug: p.category_slug } : null,
      logo: mediaUrl(p.logo_media_id, p.slug),
      image: mediaUrl(p.hero_media_id, p.slug),
      previewImage: mediaUrl(p.preview_media_id, p.slug + '-preview'),
      platforms: parseJson<string[]>(p.supported_platforms, []),
      systemRequirements: p.system_requirements,
      trialDays: feats.trial ? p.trial_days : null,
      demoOptions: feats.demo || feats.trial ? parseJson<Record<string, unknown>>(p.demo_options, {}) : { requestForm: false },
      expectedRelease: p.expected_release,
      seo: { title: p.seo_title, description: p.seo_description },
      features: features.filter((f) => f.kind === 'feature'),
      benefits: features.filter((f) => f.kind === 'benefit'),
      faqs: features.filter((f) => f.kind === 'faq'),
      plans: (feats.pricing ? plans : []).map((pl) => ({ ...pl, price_cents: pl.price_cents === null ? null : Number(pl.price_cents), inclusions: parseJson<string[]>(pl.inclusions, []), price_includes_vat: !!pl.price_includes_vat, is_highlighted: !!pl.is_highlighted })),
      media: media.map((m) => ({
        role: m.role,
        kind: m.kind,
        title: m.title,
        caption: m.caption,
        url: m.kind === 'external_video' ? m.external_url : mediaUrl(m.id, m.original_name || m.title),
        embed: m.kind === 'external_video' ? embedUrl(m.external_url) : null,
        size: parseJson<{ width?: number; height?: number }>(m.meta, {}),
        description: m.description,
        duration: m.duration_seconds,
        thumbnail: mediaUrl(m.thumbnail_media_id, 'thumbnail'),
      })),
      versions: versions.map((v) => ({
        version: v.version,
        name: v.name,
        releaseDate: v.release_date,
        notes: v.release_notes,
        latest: !!v.is_latest,
        recommended: !!v.is_recommended,
        requirements: v.min_requirements,
        platforms: [...new Set(files.filter((f) => f.version_id === v.id).map((f) => f.platform))],
      })),
      learning: learning.map((l) => {
        const open = l.visibility === 'public';
        return {
          id: l.id,
          section: l.section,
          kind: l.kind,
          title: l.title,
          summary: l.summary,
          locked: !open,
          visibility: l.visibility,
          // Body text and file links are only included for public items.
          body: open ? l.body : null,
          url: open ? (l.link_url ?? l.external_url ?? mediaUrl(l.media_id, l.original_name || l.title)) : null,
          embed: open ? embedUrl(l.external_url) : null,
          mediaKind: l.media_kind,
        };
      }),
      notice: p.notice ?? null,
      // Downloadable demo: version and file list only – files themselves need a signed-in customer.
      demo:
        demoCfg.available && demoVersion?.files.length && demoCfg.days
          ? { days: demoCfg.days, startOn: demoCfg.startOn, version: demoVersion.version, requirements: demoVersion.min_requirements ?? p.system_requirements ?? null, files: demoVersion.files.map((f) => ({ id: f.id, platform: f.platform, label: f.label, size: f.size })) }
          : null,
      // Full installer: details only. The file itself needs a signed-in, authorised customer (/account/installers).
      installer: fullVersion?.files.length ? { version: fullVersion.version, releaseDate: fullVersion.release_date, notes: fullVersion.release_notes, access, files: fullVersion.files.map((f) => ({ id: f.id, platform: f.platform, label: f.label, size: f.size })) } : null,
      setupSteps: Number(steps?.n ?? 0),
    });
  }),
);

/* ------------------------------ Learning centre ------------------------------ */
publicRouter.get(
  '/learning',
  cachePublic(60),
  ah(async (req, res) => {
    const q = parse(z.object({ product: z.string().max(180).optional(), section: z.string().max(64).optional(), q: z.string().trim().max(100).optional() }), req.query);
    const base = db('learning_resources as l')
      .leftJoin('products as p', 'p.id', 'l.product_id')
      .leftJoin('media as m', 'm.id', 'l.media_id')
      .where('l.is_published', true)
      .whereIn('l.audience', ['customer', 'both'])
      .andWhere((b) => b.whereNull('l.product_id').orWhere((x) => x.where('p.is_published', true).andWhere('p.is_archived', false)));
    if (q.product) base.andWhere('p.slug', q.product);
    if (q.section) base.andWhere('l.section', q.section);
    if (q.q) base.andWhere((b) => b.where('l.title', 'like', like(q.q!)).orWhere('l.summary', 'like', like(q.q!)));
    const rows = await base.orderBy(['p.name', 'l.section', 'l.sort_order']).limit(200).select('l.id', 'l.section', 'l.kind', 'l.title', 'l.summary', 'l.visibility', 'l.media_id', 'l.url as link_url', 'm.external_url', 'm.original_name', 'p.name as product_name', 'p.slug as product_slug');
    res.json(
      rows.map((l) => {
        const open = l.visibility === 'public';
        return {
          id: l.id,
          section: l.section,
          kind: l.kind,
          title: l.title,
          summary: l.summary,
          locked: !open,
          visibility: l.visibility,
          url: open ? (l.link_url ?? l.external_url ?? mediaUrl(l.media_id, l.original_name || l.title)) : null,
          product: l.product_slug ? { name: l.product_name, slug: l.product_slug } : null,
        };
      }),
    );
  }),
);

publicRouter.get(
  '/learning/:id',
  ah(async (req, res) => {
    const l = await db('learning_resources as l')
      .leftJoin('products as p', 'p.id', 'l.product_id')
      .leftJoin('media as m', 'm.id', 'l.media_id')
      .where({ 'l.id': Number(req.params['id']) || 0, 'l.is_published': true })
      .first('l.*', 'p.name as product_name', 'p.slug as product_slug', 'p.is_published as p_pub', 'm.external_url', 'm.original_name');
    if (!l || (l.product_id && !l.p_pub)) throw notFound();
    const a = req.auth;
    const allowed =
      l.visibility === 'public' ||
      (a && a.user.type === 'staff') ||
      (l.visibility === 'customer' && a && ['customer', 'partner'].includes(a.user.type)) ||
      (l.visibility === 'partner' && a?.user.type === 'partner' && a.partnerStatus === 'approved');
    res.json({
      id: l.id,
      title: l.title,
      section: l.section,
      kind: l.kind,
      summary: l.summary,
      locked: !allowed,
      visibility: l.visibility,
      body: allowed ? l.body : null,
      url: allowed ? (l.url ?? l.external_url ?? mediaUrl(l.media_id, l.original_name || l.title)) : null,
      embed: allowed ? embedUrl(l.external_url) : null,
      product: l.product_slug ? { name: l.product_name, slug: l.product_slug } : null,
    });
  }),
);

/* ------------------------------ Public forms ------------------------------ */
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(191);
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid cellphone number');
const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Select a country');
const accept = z.literal(true, { error: 'Please accept the privacy policy' });
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => v || null);

async function recordConsent(trx: typeof db, addr: string, source: string, ip: string | undefined, marketing?: boolean) {
  const rows = [{ purpose: 'privacy_policy', document_version: config.legal.privacyVersion, granted: true }];
  if (marketing !== undefined) rows.push({ purpose: 'marketing', document_version: config.legal.privacyVersion, granted: marketing });
  await trx('consents').insert(rows.map((r) => ({ ...r, email: addr, source, ip_hash: ipHash(ip) })));
}

const demoSchema = z.object({
  product: z.string().max(180).optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Enter your name').max(191),
  email,
  cellphone: phone,
  company: optText(191),
  country,
  preferredType: z.enum(['live', 'video', 'interactive', 'onsite']).default('live'),
  preferredDate: z.string().trim().max(40).optional().or(z.literal('')),
  message: optText(2000),
  acceptPrivacy: accept,
  marketingOptIn: z.boolean().optional().default(false),
});

publicRouter.post(
  '/demo-requests',
  formLimiter(),
  ah(async (req, res) => {
    const input = parse(demoSchema, req.body);
    const product = input.product ? await publishedProducts().where('p.slug', input.product).first('p.id', 'p.name') : null;
    let preferred: Date | null = null;
    if (input.preferredDate) {
      const d = new Date(input.preferredDate);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() - 86400_000) preferred = d;
    }
    const ref = reference('DR');
    await db.transaction(async (trx) => {
      const customer = req.auth?.customerId ?? null;
      const [id] = await trx('demo_requests').insert({
        reference: ref,
        product_id: product?.id ?? null,
        customer_id: customer,
        name: input.name,
        email: input.email,
        cellphone: input.cellphone,
        company: input.company,
        country: input.country,
        preferred_type: input.preferredType,
        preferred_date: preferred,
        message: input.message,
      });
      await recordConsent(trx as unknown as typeof db, input.email, 'demo_request', req.ip, input.marketingOptIn);
      const vars = { name: input.name, reference: ref, product: product?.name ?? 'SCHLUSS products', email: input.email, cellphone: input.cellphone, company: input.company ?? '', type: input.preferredType, message: input.message ?? '' };
      await queueEmail(input.email, 'demo_request_ack', vars, trx);
      // Demo requests: support inbox (plus any extra ADMIN_NOTIFY_EMAIL addresses).
      for (const to of new Set([await inboxFor('support'), ...(process.env['ADMIN_NOTIFY_EMAIL'] ? adminInboxes() : [])])) await queueEmail(to, 'demo_request_admin', vars, trx);
      await audit(req, { action: 'demo.requested', subjectType: 'demo_request', subjectId: id, meta: { reference: ref } }, trx);
    });
    res.status(201).json({ reference: ref });
  }),
);

const partnerSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name').max(191),
  contactName: z.string().trim().min(2, 'Enter the contact person').max(191),
  email,
  cellphone: phone,
  address: optText(500),
  country,
  website: z
    .string()
    .trim()
    .max(255)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null)
    .refine((v) => !v || /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v), 'Enter a valid website'),
  businessType: optText(100),
  industry: optText(100),
  yearsExperience: z.coerce.number().int().min(0).max(100).optional().nullable(),
  servicesOffered: optText(2000),
  areasOfOperation: optText(1000),
  productsInterested: optText(1000),
  additionalInfo: optText(3000),
  acceptTerms: z.literal(true, { error: 'Please accept the partner terms and privacy policy' }),
  marketingOptIn: z.boolean().optional().default(false),
});

publicRouter.post(
  '/partner-applications',
  formLimiter(),
  ah(async (req, res) => {
    const input = parse(partnerSchema, req.body);
    const open = await db('partners').where({ email: input.email }).whereIn('status', ['pending', 'under_review', 'approved']).first('reference', 'status');
    if (open) throw conflict(`There is already an application for this email (reference ${open.reference}). We'll be in touch – or contact us if you need to update it.`);
    const ref = reference('SP');
    await db.transaction(async (trx) => {
      const [id] = await trx('partners').insert({
        reference: ref,
        business_name: input.businessName,
        contact_name: input.contactName,
        email: input.email,
        cellphone: input.cellphone,
        address: input.address,
        country: input.country,
        website: input.website,
        business_type: input.businessType,
        industry: input.industry,
        years_experience: input.yearsExperience ?? null,
        services_offered: input.servicesOffered,
        areas_of_operation: input.areasOfOperation,
        products_interested: input.productsInterested,
        additional_info: input.additionalInfo,
        status: 'pending',
      });
      await trx('consents').insert({ purpose: 'partner_terms', document_version: config.legal.termsVersion, granted: true, email: input.email, source: 'partner_application', ip_hash: ipHash(req.ip) });
      await recordConsent(trx as unknown as typeof db, input.email, 'partner_application', req.ip, input.marketingOptIn);
      const vars = { name: input.contactName, business: input.businessName, reference: ref, email: input.email, cellphone: input.cellphone };
      await queueEmail(input.email, 'partner_application_ack', vars, trx);
      // Business partner registrations: the inbox chosen in Admin › Email settings (sales by default).
      await queueEmail(await inboxFor('partner'), 'partner_application_admin', vars, trx);
      await audit(req, { action: 'partner.applied', subjectType: 'partner', subjectId: id, meta: { reference: ref } }, trx);
    });
    res.status(201).json({ reference: ref });
  }),
);

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(191),
  email,
  cellphone: z.string().trim().max(32).optional().or(z.literal('')).transform((v) => v || null),
  company: optText(191),
  product: z.string().max(180).optional().or(z.literal('')),
  // The customer chooses. Only an explicit "purchase" goes to sales; everything else (and anything unclear) goes to support.
  enquiryType: z.enum(['technical', 'general', 'purchase']).default('general'),
  quantity: z.coerce.number().int().min(1).max(100000).optional(),
  subject: z.string().trim().min(3, 'Add a subject').max(200),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(5000),
  acceptPrivacy: accept,
});

const TYPE_LABEL = { technical: 'Technical support', general: 'General assistance', purchase: 'Purchase' } as const;

/** Creates the conversation and routes it: purchase → sales enquiry + sales@, otherwise support@. */
async function routeEnquiry(req: import('express').Request, input: z.infer<typeof contactSchema>, source: 'contact' | 'product_page') {
  const product = input.product ? await publishedProducts().where('p.slug', input.product).first('p.id', 'p.name') : null;
  const sales = input.enquiryType === 'purchase';
  const ref = reference(sales ? 'SQ' : 'CT');
  const ack = (await getSetting('email.departments')).customerAck !== false;
  const result = await db.transaction(async (trx) => {
    const [id] = await trx('tickets').insert({
      reference: ref,
      requester_user_id: req.auth?.user.id ?? null,
      customer_id: req.auth?.customerId ?? null,
      product_id: product?.id ?? null,
      name: input.name,
      email: input.email,
      subject: input.subject,
      priority: 'normal',
      status: 'new',
      channel: 'form',
      department: sales ? 'sales' : 'support',
      enquiry_type: input.enquiryType,
      cellphone: input.cellphone || null,
      company: input.company || null,
      admin_unread: 1,
      last_message_at: new Date(),
      last_customer_message_at: new Date(),
    });
    const body = [input.message, input.cellphone ? `\nCellphone: ${input.cellphone}` : '', input.company ? `\nCompany: ${input.company}` : '', sales && input.quantity ? `\nLicences: ${input.quantity}` : ''].join('');
    await trx('ticket_messages').insert({ ticket_id: id, author_id: req.auth?.user.id ?? null, author_kind: req.auth ? 'customer' : 'visitor', body, source: 'website' });
    await recordConsent(trx as unknown as typeof db, input.email, 'contact_form', req.ip);
    const common = { name: input.name, company: input.company ? ` (${input.company})` : '', email: input.email, phone: input.cellphone ?? '—', product: product?.name ?? '—', message: input.message, reference: ref, source: source === 'product_page' ? 'Product page' : 'Contact form' };
    let salesId: number | null = null;
    if (sales) {
      [salesId] = await trx('quote_requests').insert({ reference: ref, customer_id: req.auth?.customerId ?? null, product_id: product?.id ?? null, kind: 'purchase', quantity: input.quantity ?? 1, message: input.message, status: 'new', name: input.name, email: input.email, cellphone: input.cellphone || null, company: input.company || null, source, ticket_id: id });
      await notifyStaff(['sales.view'], { type: 'sales.new', title: `Purchase enquiry from ${input.name}`, body: `${product?.name ?? 'SCHLUSS products'} – ${input.subject}`, link: `/admin/sales?open=${salesId}` }, trx);
      await queueEmail(await inboxFor('purchase'), 'sales_enquiry', { ...common, kind: 'Purchase', quantity: input.quantity ?? 1, link: `${config.appUrl}/admin/sales?open=${salesId}` }, trx);
      if (ack) await queueEmail(input.email, 'sales_ack', { name: input.name, product: product?.name ?? 'SCHLUSS products', reference: ref }, trx);
    } else {
      await notifyStaff(['support.view'], { type: 'support.new', title: `New website enquiry from ${input.name}`, body: input.subject, link: `/admin/support?open=${id}` }, trx);
      await queueEmail(await inbox('support'), 'support_enquiry', { ...common, type: TYPE_LABEL[input.enquiryType], subject: input.subject, link: `${config.appUrl}/admin/support?open=${id}` }, trx);
      if (ack) await queueEmail(input.email, 'contact_ack', { name: input.name, reference: ref, subject: input.subject, email: input.email, message: input.message }, trx);
    }
    return { id, salesId };
  });
  await audit(req, { action: sales ? 'sales.enquiry' : 'support.enquiry', subjectType: 'ticket', subjectId: result.id, meta: { source, type: input.enquiryType } });
  return { reference: ref, department: sales ? 'sales' : 'support' };
}

publicRouter.post(
  '/contact',
  formLimiter(),
  ah(async (req, res) => {
    res.status(201).json(await routeEnquiry(req, parse(contactSchema, req.body), 'contact'));
  }),
);

/** Product page "Buy / request a quotation" form → sales department only. */
publicRouter.post(
  '/purchase-enquiry',
  formLimiter(),
  ah(async (req, res) => {
    const input = parse(contactSchema.extend({ subject: z.string().trim().max(200).optional().transform((v) => v || 'Purchase enquiry'), message: z.string().trim().min(3, 'Tell us what you need').max(5000) }), { ...req.body, enquiryType: 'purchase' });
    if (!input.product) throw notFound('Choose a product.');
    const prod = await publishedProducts().where('p.slug', input.product).first('p.offering_type', 'p.features');
    if (!prod) throw notFound('Product not found.');
    if (!featuresOf(prod).purchase) throw new HttpError(409, 'This offering is not for sale online. Use the contact form or chat to ask us about it.', 'not_for_sale');
    res.status(201).json(await routeEnquiry(req, input as z.infer<typeof contactSchema>, 'product_page'));
  }),
);

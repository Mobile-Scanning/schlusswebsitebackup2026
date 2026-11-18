import type { Knex } from 'knex';
import { db } from '../db';

export const PRODUCT_STATUSES = ['available', 'coming_soon', 'beta', 'demo_available', 'unavailable', 'discontinued'] as const;
export const PLAN_MODELS = ['free', 'trial', 'once_off', 'monthly', 'annual', 'quote', 'per_user', 'per_device', 'tier'] as const;
export const LEARNING_SECTIONS = ['getting_started', 'installation', 'configuration', 'usage', 'advanced', 'troubleshooting', 'updates', 'training', 'sales', 'marketing'] as const;
export const MEDIA_ROLES = ['screenshot', 'intro_video', 'walkthrough', 'feature_video', 'install_tutorial', 'training_video', 'demo_video', 'gallery', 'promo', 'feature_image'] as const;

export const mediaUrl = (id: number | null | undefined, name = 'file') =>
  id ? `/api/media/${id}/${encodeURIComponent(name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'file')}` : null;

export const parseJson = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/** Convert a YouTube/Vimeo link into a privacy-friendly embed URL. Other hosts are not embedded. */
export function embedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host.endsWith('youtube.com')) id = u.searchParams.get('v') ?? (u.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/)?.[2] || null);
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const v = u.pathname.match(/(\d{6,12})/)?.[1];
      if (v) return `https://player.vimeo.com/video/${v}?dnt=1`;
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/** Short pricing summary for product cards. Prices are integer cents; currency defaults to ZAR. */
export async function pricingSummaries(productIds: number[], trx: Knex = db) {
  if (!productIds.length) return new Map<number, PricingSummary>();
  const plans = await trx('product_plans').whereIn('product_id', productIds).andWhere('is_active', true).select('product_id', 'model', 'price_cents', 'currency', 'billing_period', 'unit');
  const map = new Map<number, PricingSummary>();
  for (const id of productIds) {
    const ps = plans.filter((p) => p.product_id === id);
    const priced = ps.filter((p) => p.price_cents !== null && !['free', 'quote'].includes(p.model)).sort((a, b) => a.price_cents - b.price_cents);
    const from = priced[0];
    map.set(id, {
      hasFree: ps.some((p) => p.model === 'free'),
      quoteOnly: ps.length > 0 && ps.every((p) => p.model === 'quote'),
      hasQuote: ps.some((p) => p.model === 'quote'),
      fromCents: from ? Number(from.price_cents) : null,
      currency: from?.currency ?? 'ZAR',
      period: from?.billing_period ?? 'none',
      unit: from?.unit ?? 'licence',
      planCount: ps.length,
    });
  }
  return map;
}

export interface PricingSummary {
  hasFree: boolean;
  quoteOnly: boolean;
  hasQuote: boolean;
  fromCents: number | null;
  currency: string;
  period: string;
  unit: string;
  planCount: number;
}

export function slugify(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
}

export async function uniqueSlug(table: 'products' | 'product_categories', base: string, ignoreId?: number) {
  const root = slugify(base) || 'item';
  let slug = root;
  for (let i = 2; ; i++) {
    const q = db(table).where({ slug });
    if (ignoreId) q.whereNot({ id: ignoreId });
    if (!(await q.first('id'))) return slug;
    slug = `${root}-${i}`;
  }
}

/** Send a notification email to the SCHLUSS team inbox(es) configured in ADMIN_NOTIFY_EMAIL (comma-separated). */
export function adminInboxes(): string[] {
  // Legacy sync helper (partner applications, demo bookings). Department routing uses platform.inbox().
  return (process.env['ADMIN_NOTIFY_EMAIL'] || process.env['SUPPORT_EMAIL'] || 'support@schluss.co.za')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

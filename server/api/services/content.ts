import type { Request } from 'express';
import { config } from '../config';
import { db } from '../db';
import { can } from '../middleware/auth';
import { hmac } from './crypto';
import { getSetting } from './platform';

/**
 * Product content library – shared rules.
 *
 * Access levels (per product, optionally overridden per item):
 *   public      – anyone
 *   registered  – any signed-in customer (accounts are only active once the email is verified)
 *   authorised  – customers with an active (non-demo) licence for THIS product
 *   demo        – customers with an active demo of this product (licence holders included)
 * Staff with products.view can always preview (also unpublished items). Every check runs on the server,
 * on every library request, every playback start and while a private video streams.
 */
export type Level = 'public' | 'registered' | 'authorised' | 'demo';
export const LEVELS: Level[] = ['public', 'registered', 'authorised', 'demo'];
export const CONTENT_TYPES = ['video', 'tutorial', 'demonstration', 'training', 'installation', 'feature', 'other'] as const;
export const TYPE_LABEL: Record<string, string> = { video: 'Video', tutorial: 'Tutorial', demonstration: 'Product demonstration', training: 'Training video', installation: 'Installation guide', feature: 'Feature explanation', other: 'Video' };

export interface Viewer {
  staff: boolean;
  customerId: number | null;
  registered: boolean;
  authorised: boolean;
  demo: boolean;
}

export async function contentSettings() {
  return getSetting('content.settings');
}

/** What this request may see for one product. */
export async function viewerFor(req: Request, productId: number): Promise<Viewer> {
  const a = req.auth;
  const staff = !!a && a.user.type === 'staff' && can(req, 'products.view');
  const customerId = a?.user.type === 'customer' ? a.customerId : null;
  if (!customerId) return { staff, customerId: null, registered: false, authorised: false, demo: false };
  const now = db.raw('UTC_TIMESTAMP()');
  const notExpired = (w: ReturnType<typeof db>) => w.where((x) => x.whereNull('expires_at').orWhere('expires_at', '>', now));
  const licensed = await notExpired(
    db('licences').where({ customer_id: customerId, product_id: productId }).where((w) => w.whereNot('type', 'trial').orWhereNotNull('converted_at')).whereIn('status', ['active', 'trial']),
  ).first('id');
  const demo = licensed ? null : await notExpired(db('licences').where({ customer_id: customerId, product_id: productId, type: 'trial' }).whereIn('status', ['trial', 'active'])).first('id');
  return { staff, customerId, registered: true, authorised: !!licensed, demo: !!licensed || !!demo };
}

export function levelOf(item: { access_level: string }, product: { content_access: string | null }, defaultLevel: Level): Level {
  if (item.access_level && item.access_level !== 'inherit') return item.access_level as Level;
  return (product.content_access as Level) || defaultLevel;
}

export function allows(level: Level, v: Viewer) {
  if (v.staff) return true;
  if (level === 'public') return true;
  if (level === 'registered') return v.registered;
  if (level === 'authorised') return v.authorised;
  return v.demo; // 'demo' – active demo or licence
}

export function lockedReason(level: Level, v: Viewer, productName: string) {
  if (!v.registered) return { code: 'login', message: `Sign in with your SCHLUSS customer account to watch the ${productName} videos and tutorials.` };
  if (level === 'authorised') return { code: 'licence', message: `These videos are available to customers with an active ${productName} licence.` };
  if (level === 'demo') return { code: 'demo', message: `These videos are available while you have an active ${productName} demo or licence.` };
  return { code: 'denied', message: 'You do not have access to this content.' };
}

/** A hash that identifies the viewer for unique counts (customer, else a keyed hash of IP + browser). */
export function viewerKey(req: Request) {
  if (req.auth?.customerId) return 'c:' + req.auth.customerId;
  if (req.auth) return 'u:' + req.auth.user.id;
  return 'v:' + hmac(`viewer:${req.ip}:${req.get('user-agent') ?? ''}`).slice(0, 40);
}
/** Binds a playback token to this browser session so a copied link is useless elsewhere. */
export function playbackBinding(req: Request) {
  return hmac('play:' + (req.auth?.sessionId ?? `${req.ip}:${req.get('user-agent') ?? ''}`)).slice(0, 32);
}

/* ------------------------------------------------------------------ video links */
export interface ParsedLink { provider: 'youtube' | 'vimeo'; reference: string }

export function parseVideoLink(raw: string): ParsedLink | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') ?? u.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{6,})/)?.[2] ?? null;
    return id && /^[\w-]{11}$/.test(id) ? { provider: 'youtube', reference: id } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(?:\/video)?\/(\d{6,12})(?:\/([0-9a-f]{6,20}))?/i);
    if (!m) return null;
    const hash = m[2] ?? u.searchParams.get('h');
    return { provider: 'vimeo', reference: hash && /^[0-9a-f]{6,20}$/i.test(hash) ? `${m[1]}:${hash}` : m[1] };
  }
  return null;
}

/** Official embed player URLs with the privacy options each provider supports. */
export function embedUrl(provider: 'youtube' | 'vimeo', reference: string) {
  if (provider === 'youtube') {
    const q = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1', enablejsapi: '1', iv_load_policy: '3', origin: config.appUrl });
    return `https://www.youtube-nocookie.com/embed/${reference}?${q}`;
  }
  const [id, h] = reference.split(':');
  const q = new URLSearchParams({ ...(h ? { h } : {}), dnt: '1', title: '0', byline: '0', portrait: '0', pip: '0', api: '1' });
  return `https://player.vimeo.com/video/${id}?${q}`;
}

export function watchUrl(provider: 'youtube' | 'vimeo', reference: string) {
  if (provider === 'youtube') return `https://www.youtube.com/watch?v=${reference}`;
  const [id, h] = reference.split(':');
  return `https://vimeo.com/${id}${h ? '/' + h : ''}`;
}

export interface LinkCheck { ok: boolean | null; verified: boolean; message: string; title?: string; thumbnail?: string; duration?: number; checkedAt: string }

/**
 * Tests whether a YouTube/Vimeo video can be embedded, using the providers' public oEmbed endpoints
 * (no API key needed). ok=false → definitely not embeddable (publishing is blocked); ok=null → could not
 * be verified from the server (e.g. Vimeo domain-restricted videos, or no internet) – allowed with a warning.
 */
export async function checkLink(p: ParsedLink): Promise<LinkCheck> {
  const at = new Date().toISOString();
  const endpoint = p.provider === 'youtube' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(p.provider, p.reference))}` : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(watchUrl(p.provider, p.reference))}`;
  let res: Response;
  try {
    res = await fetch(endpoint, { signal: AbortSignal.timeout(8000), headers: { Referer: config.appUrl } });
  } catch {
    return { ok: null, verified: false, message: `Couldn't reach ${p.provider === 'youtube' ? 'YouTube' : 'Vimeo'} from the server to test this link. It was saved – open “Preview” to check it plays.`, checkedAt: at };
  }
  if (res.ok) {
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: true, verified: true, message: 'This video can be embedded on your website.', title: String(j['title'] ?? ''), thumbnail: j['thumbnail_url'] ? String(j['thumbnail_url']) : undefined, duration: Number(j['duration']) || undefined, checkedAt: at };
  }
  if (p.provider === 'youtube') {
    if (res.status === 401 || res.status === 403) return { ok: false, verified: true, message: 'The owner of this YouTube video has switched off embedding. Turn on “Allow embedding” in YouTube Studio, or upload the video file instead.', checkedAt: at };
    return { ok: false, verified: true, message: 'This YouTube video is private, deleted or the link is wrong. Use a Public or Unlisted video (Private videos can’t be embedded).', checkedAt: at };
  }
  if (res.status === 403) return { ok: null, verified: false, message: 'Vimeo hides the details of domain-restricted videos, so the server can’t test it. It will play on your website if your domain is in the video’s “Where can this video be embedded” list – open “Preview” to check.', checkedAt: at };
  return { ok: false, verified: true, message: 'This Vimeo video can’t be found. If it is a private (unlisted) link, paste the full share link including the code after the number (vimeo.com/123456789/abcdef1234).', checkedAt: at };
}

export function providerWarning(provider: string, level: Level) {
  if (provider === 'youtube' && level !== 'public') {
    return 'YouTube can’t limit playback to your website: anyone who finds the video on YouTube can watch it there. For customer-only content, use Vimeo (with domain-level privacy) or upload the video to SCHLUSS.';
  }
  return null;
}

/* ------------------------------------------------------------------ cover images */
type SharpFn = (input: Buffer | string) => { rotate(): ReturnType<SharpFn>; resize(o: object): ReturnType<SharpFn>; webp(o: object): ReturnType<SharpFn>; metadata(): Promise<{ width?: number; height?: number; format?: string }>; toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }> };
let sharpLib: SharpFn | null | undefined;
export async function imageTool(): Promise<SharpFn | null> {
  if (sharpLib !== undefined) return sharpLib;
  try {
    const mod = (await import('sharp')) as unknown as { default: SharpFn };
    sharpLib = mod.default;
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

/** Resize to fit 1600×900 (16:9 cards) and convert to WebP. Falls back to the original file when the image library isn't installed. */
export async function optimiseCover(buf: Buffer): Promise<{ data: Buffer; ext: string; mime: string; width: number | null; height: number | null; optimised: boolean }> {
  const sharp = await imageTool();
  if (!sharp) return { data: buf, ext: 'bin', mime: '', width: null, height: null, optimised: false };
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('This image could not be read.');
  if (meta.width < 480 || meta.height < 270) throw new Error(`This image is too small (${meta.width}×${meta.height}). Use at least 1280×720 pixels for a sharp cover.`);
  const out = await sharp(buf).rotate().resize({ width: 1600, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, ext: 'webp', mime: 'image/webp', width: out.info.width, height: out.info.height, optimised: true };
}

import { createHmac, randomBytes, randomInt } from 'node:crypto';
import type { Request } from 'express';
import { db } from '../db';
import { hmac, safeEqual } from './crypto';

/* =====================================================================================
 * Two-step verification (TOTP, RFC 6238) – works with Google Authenticator, Microsoft Authenticator, Authy…
 * No external service: the code is calculated from a secret that only this server and the person's phone know.
 * ===================================================================================== */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function b32decode(s: string) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totpAt(secret: string, step: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
export const totpStep = (t = Date.now()) => Math.floor(t / 30_000);
/** Returns the matching time-step (current ±1, to allow for clock drift) or null. Steps ≤ lastStep are refused (no replay). */
export function verifyTotp(secret: string, code: string, lastStep: number | null): number | null {
  const c = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpStep();
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (safeEqual(totpAt(secret, s), c)) return s;
  }
  return null;
}
export const otpauthUrl = (secret: string, account: string) => `otpauth://totp/${encodeURIComponent('SCHLUSS:' + account)}?secret=${secret}&issuer=SCHLUSS&algorithm=SHA1&digits=6&period=30`;

/** One-time recovery codes (shown once; only keyed hashes are stored). */
export function newRecoveryCodes(n = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const one = () => Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('').replace(/(.{5})/, '$1-');
  const codes = Array.from({ length: n }, one);
  return { codes, hashes: codes.map(recoveryHash) };
}
export const recoveryHash = (code: string) => hmac('mfa-recovery:' + String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''));

/* =====================================================================================
 * Security events – written to the audit log (never with passwords, tokens or request bodies) and,
 * when something looks like an attack, sent to the administrators as a notification.
 * ===================================================================================== */
const seen = new Map<string, number>();
function throttled(key: string, ms: number) {
  const now = Date.now();
  if (seen.size > 5000) for (const [k, t] of seen) if (now - t > 600_000) seen.delete(k);
  if ((seen.get(key) ?? 0) > now - ms) return true;
  seen.set(key, now);
  return false;
}
const hits = new Map<string, number[]>();
/** Counts events per key in a sliding window; true when the threshold is reached (once per window). */
function burst(key: string, threshold: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return list.length === threshold;
}

export function securityEvent(req: Request, action: string, meta: Record<string, unknown> = {}, opts: { throttleMs?: number; alert?: { title: string; body: string } | null } = {}) {
  const who = req.auth ? `u${req.auth.user.id}` : `ip${req.ip}`;
  if (opts.throttleMs && throttled(`${action}:${who}:${meta['path'] ?? ''}`, opts.throttleMs)) return;
  void (async () => {
    await db('audit_logs').insert({ actor_id: req.auth?.user.id ?? null, action, subject_type: 'security', subject_id: null, meta: JSON.stringify(meta), ip: req.ip ?? null });
    if (opts.alert) await alertAdmins(opts.alert.title, opts.alert.body);
  })().catch(() => undefined);
}

export async function alertAdmins(title: string, body: string) {
  const { notifyStaff } = await import('./platform');
  await notifyStaff(['audit.view', 'settings.manage'], { type: 'security.alert', title, body: body.slice(0, 500), link: '/admin/audit?security=1' });
}

/** A signed-in person asked for something they are not allowed to have (or an anonymous visitor probed the admin API). */
export function accessDenied(req: Request, kind: 'forbidden' | 'unauthenticated') {
  const path = req.originalUrl.split('?')[0].slice(0, 200);
  if (kind === 'unauthenticated' && !path.startsWith('/api/admin')) return; // ordinary "please sign in" cases are not security events
  const who = req.auth ? `${req.auth.user.name} (${req.auth.user.type})` : `an anonymous visitor at ${req.ip}`;
  const many = burst(`denied:${req.auth ? 'u' + req.auth.user.id : 'ip' + req.ip}`, 15, 10 * 60_000);
  securityEvent(req, kind === 'forbidden' ? 'security.forbidden' : 'security.unauthenticated', { method: req.method, path, userType: req.auth?.user.type ?? null }, {
    throttleMs: 60_000,
    alert: many ? { title: 'Repeated unauthorised access attempts', body: `${who} was refused 15 times in 10 minutes (last: ${req.method} ${path}). Review the audit log.` } : null,
  });
  if (many) seen.delete(`security.${kind === 'forbidden' ? 'forbidden' : 'unauthenticated'}:${req.auth ? 'u' + req.auth.user.id : 'ip' + req.ip}:${path}`);
}

/** Many failed sign-ins from one address (credential stuffing) – alert once per 15 minutes per address. */
export function failedLogin(req: Request) {
  if (burst(`login:${req.ip}`, 10, 15 * 60_000)) void alertAdmins('Many failed sign-in attempts', `10 failed sign-ins in 15 minutes from ${req.ip}. The address is being rate-limited automatically.`).catch(() => undefined);
}

/* ---- Security settings (cached briefly so every request doesn't read the database) ---- */
let cached: { at: number; requireStaffMfa: boolean } = { at: 0, requireStaffMfa: false };
export async function requireStaffMfa(): Promise<boolean> {
  if (Date.now() - cached.at < 20_000) return cached.requireStaffMfa;
  const { getSetting } = await import('./platform');
  const s = await getSetting('security.settings').catch(() => ({ requireStaffMfa: false }));
  cached = { at: Date.now(), requireStaffMfa: !!s.requireStaffMfa };
  return cached.requireStaffMfa;
}
export const clearSecurityCache = () => { cached.at = 0; };

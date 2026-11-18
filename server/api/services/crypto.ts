import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const hmac = (v: string) => createHmac('sha256', config.appSecret).update(v).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** One-way hash of an IP so we can rate/abuse-correlate without storing raw IPs (POPIA minimisation). */
export const ipHash = (ip?: string) => (ip ? hmac('ip:' + ip).slice(0, 43) : null);

/** Human-friendly reference, e.g. SP-2026-7KQ3XD (no ambiguous characters). */
export function reference(prefix: string): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${prefix}-${new Date().getUTCFullYear()}-${s}`;
}

import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { db } from '../db';
import { ah, forbidden, HttpError, unauthorised } from '../http';
import { hmac, randomToken, safeEqual, sha256 } from '../services/crypto';
import { accessDenied, requireStaffMfa } from '../services/security';

export type UserType = 'staff' | 'customer' | 'partner';

export interface AuthContext {
  user: { id: number; type: UserType; name: string; email: string; partner_id: number | null };
  sessionId: string;
  roles: string[];
  permissions: Set<string>;
  partnerStatus: string | null;
  customerId: number | null;
  /** Two-step verification is switched on for this account. */
  mfaEnabled: boolean;
  /** Staff must set up two-step verification before the admin API will answer (security setting). */
  mfaSetupRequired: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const cookieBase: CookieOptions = { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/' };

/* ---------------- Sessions ---------------- */

export async function createSession(req: Request, res: Response, userId: number) {
  const token = randomToken(32);
  const id = sha256(token); // only the hash is stored – a DB leak cannot hijack sessions
  const now = Date.now();
  await db('sessions').insert({
    id,
    user_id: userId,
    csrf_secret: randomToken(24),
    ip: req.ip ?? null,
    user_agent: (req.get('user-agent') || '').slice(0, 255),
    expires_at: new Date(now + config.session.ttlHours * 3600_000),
    created_at: new Date(now),
    last_seen_at: new Date(now),
  });
  res.cookie(config.session.cookie, token, { ...cookieBase, maxAge: config.session.maxDays * 86400_000 });
  issueCsrf(res); // rotate CSRF token on privilege change
  return id;
}

export async function destroySession(req: Request, res: Response) {
  if (req.auth) await db('sessions').where({ id: req.auth.sessionId }).del();
  res.clearCookie(config.session.cookie, cookieBase);
}

/** Loads the session (if any) and attaches req.auth. Never throws for anonymous requests. */
export const loadSession = ah(async (req, _res, next) => {
  const token = req.cookies?.[config.session.cookie];
  if (!token || typeof token !== 'string' || token.length > 100) return next();
  const id = sha256(token);
  const row = await db('sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where('s.id', id)
    .first('s.id as sid', 's.expires_at', 's.created_at as s_created', 's.last_seen_at', 'u.id', 'u.type', 'u.name', 'u.email', 'u.status', 'u.partner_id', 'u.email_verified_at', 'u.mfa_enabled_at');
  if (!row) return next();
  const now = Date.now();
  let absoluteEnd = new Date(row.s_created).getTime() + config.session.maxDays * 86400_000;
  // Admin portal sessions: shorter inactivity limit and total lifetime than customer sessions.
  if (row.type === 'staff') {
    absoluteEnd = Math.min(absoluteEnd, new Date(row.s_created).getTime() + config.session.staffMaxHours * 3600_000);
    if (now - new Date(row.last_seen_at).getTime() > config.session.staffIdleMinutes * 60_000) absoluteEnd = 0;
  }
  // Unverified customer accounts never get a working session (defence in depth – none is issued anyway).
  if (new Date(row.expires_at).getTime() < now || absoluteEnd < now || row.status !== 'active' || (row.type === 'customer' && !row.email_verified_at)) {
    await db('sessions').where({ id }).del();
    return next();
  }
  // Sliding expiry, written at most every 5 minutes to keep DB writes low.
  if (now - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await db('sessions').where({ id }).update({ last_seen_at: new Date(now), expires_at: new Date(now + config.session.ttlHours * 3600_000) });
  }

  let roles: string[] = [];
  const permissions = new Set<string>();
  if (row.type === 'staff') {
    const rows = await db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
      .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
      .where('ur.user_id', row.id)
      .select('r.key as role', 'p.key as perm');
    roles = [...new Set(rows.map((r) => r.role as string))];
    rows.forEach((r) => r.perm && permissions.add(r.perm));
  }
  let partnerStatus: string | null = null;
  if (row.type === 'partner' && row.partner_id) {
    partnerStatus = (await db('partners').where({ id: row.partner_id }).first('status'))?.status ?? null;
  }
  let customerId: number | null = null;
  if (row.type === 'customer') {
    customerId = (await db('customers').where({ user_id: row.id }).first('id'))?.id ?? null;
  }

  req.auth = {
    user: { id: row.id, type: row.type, name: row.name, email: row.email, partner_id: row.partner_id },
    sessionId: id,
    roles,
    permissions,
    partnerStatus,
    customerId,
    mfaEnabled: !!row.mfa_enabled_at,
    mfaSetupRequired: row.type === 'staff' && !row.mfa_enabled_at && (await requireStaffMfa()),
  };
  next();
});

/* ---------------- CSRF (signed double-submit cookie) ---------------- */

export function issueCsrf(res: Response) {
  const nonce = randomToken(18);
  const token = `${nonce}.${hmac('csrf:' + nonce)}`;
  // Readable by JS (Angular's HttpClient copies it into the X-XSRF-TOKEN header automatically).
  res.cookie(config.csrfCookie, token, { httpOnly: false, secure: config.isProd, sameSite: 'lax', path: '/' });
  return token;
}

function validCsrf(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const [nonce, sig] = token.split('.');
  return !!nonce && !!sig && safeEqual(sig, hmac('csrf:' + nonce));
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies?.[config.csrfCookie];
  const header = req.get(config.csrfHeader);
  if (!cookie || !header || !safeEqual(String(cookie), String(header)) || !validCsrf(header)) {
    res.status(403).json({ error: { code: 'csrf', message: 'Your session token expired. Please refresh the page and try again.' } });
    return;
  }
  next();
}

/* ---------------- Guards (enforced server-side on every protected route) ---------------- */

export function requireAuth(...types: UserType[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorised());
    if (types.length && !types.includes(req.auth.user.type)) {
      accessDenied(req, 'forbidden');
      return next(forbidden());
    }
    next();
  };
}

export function can(req: Request, permission: string): boolean {
  const a = req.auth;
  if (!a || a.user.type !== 'staff') return false;
  return a.roles.includes('super_admin') || a.permissions.has(permission);
}

/** Staff-only, permission-checked. Pass several permissions to require ANY of them. */
export function requirePermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      accessDenied(req, 'unauthenticated');
      return next(unauthorised());
    }
    if (req.auth.user.type !== 'staff' || !perms.some((p) => can(req, p))) {
      accessDenied(req, 'forbidden');
      return next(forbidden());
    }
    // Two-step verification is compulsory for staff (security setting) and this person hasn't set it up yet.
    if (req.auth.mfaSetupRequired) return next(new HttpError(403, 'Set up two-step verification first: open “My security” in the admin menu.', 'mfa_setup_required'));
    next();
  };
}

/** Partner users whose organisation is approved. Pending/suspended partners are blocked. */
export function requireApprovedPartner(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorised());
  if (req.auth.user.type !== 'partner' || !req.auth.user.partner_id) return next(forbidden());
  if (req.auth.partnerStatus !== 'approved') return next(forbidden('Your partner account is not active yet.'));
  next();
}

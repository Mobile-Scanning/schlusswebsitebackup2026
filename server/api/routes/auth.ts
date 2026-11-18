import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import type { Knex } from 'knex';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, conflict, HttpError, parse } from '../http';
import { createSession, destroySession, issueCsrf, requireAuth } from '../middleware/auth';
import { audit } from '../services/audit';
import { randomInt } from 'node:crypto';
import { hmac, ipHash, randomToken, safeEqual, sha256 } from '../services/crypto';
import { queueEmail } from '../services/jobs';
import { parseJson } from '../services/catalogue';
import { decryptSecret, encryptSecret, readToken, signToken } from '../services/platform';
import { alertAdmins, failedLogin, newRecoveryCodes, newTotpSecret, otpauthUrl, recoveryHash, requireStaffMfa, verifyTotp } from '../services/security';

export const authRouter = Router();

const limiter = (limit: number, minutes: number) =>
  rateLimit({
    windowMs: minutes * 60_000,
    limit: config.isTest ? 1000 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' } },
  });

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(191);
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .refine((p) => Buffer.byteLength(p) <= 72, 'Password is too long')
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), 'Use letters and at least one number');
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid cellphone number');
const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Select a country');

// Used to keep login timing identical whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-' + randomToken(8), config.auth.bcryptCost);

/** Public: get a CSRF token cookie (Angular calls this once on start-up). */
authRouter.get('/csrf', (_req, res) => {
  issueCsrf(res);
  res.status(204).end();
});

authRouter.get(
  '/me',
  ah(async (req, res) => {
    if (!req.auth) {
      res.json({ user: null });
      return;
    }
    const a = req.auth;
    res.json({
      user: { id: a.user.id, type: a.user.type, name: a.user.name, email: a.user.email },
      roles: a.roles,
      permissions: a.roles.includes('super_admin') ? ['*'] : [...a.permissions],
      partnerStatus: a.partnerStatus,
      mfa: { enabled: a.mfaEnabled, setupRequired: a.mfaSetupRequired },
    });
  }),
);

/* -------- Customer self-registration -------- */
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(191),
  email,
  cellphone: phone.optional().or(z.literal('')),
  company: z.string().trim().max(191).optional().or(z.literal('')),
  country: country.optional().default('ZA'),
  password,
  acceptPrivacy: z.literal(true, { error: 'You need to accept the privacy policy and terms' }),
  marketingOptIn: z.boolean().optional().default(false),
  confirmPassword: z.string().optional(),
}).refine((v) => v.confirmPassword === undefined || v.confirmPassword === v.password, { message: 'Passwords don’t match', path: ['confirmPassword'] });

/* -------- Email OTP --------
 * 6-digit code from a CSPRNG, stored only as an HMAC, valid for 5 minutes, single use, max 5 wrong tries.
 * A new code invalidates the previous one. Resend has a 60-second cooldown. The code only travels in the
 * email (the queued email payload is scrubbed after sending) – it is never logged or returned by the API.
 */
export const OTP = { minutes: 5, maxAttempts: 5, cooldownSeconds: 60 };
/** A customer is waiting on the screen for this email: send it straight away instead of at the next 15-second round. */
const sendNow = () => void import('../index').then((m) => m.runEmailSender()).catch(() => undefined);
const otpHash = (userId: number, code: string) => hmac(`otp:${userId}:${code}`);

async function issueOtp(user: { id: number; name: string; email: string }, ip: string | undefined, trx: Knex | Knex.Transaction = db) {
  await trx('email_otps').where({ user_id: user.id, purpose: 'verify_email' }).whereNull('used_at').whereNull('invalidated_at').update({ invalidated_at: new Date() });
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await trx('email_otps').insert({ user_id: user.id, purpose: 'verify_email', code_hash: otpHash(user.id, code), expires_at: new Date(Date.now() + OTP.minutes * 60_000), ip_hash: ipHash(ip) });
  await queueEmail(user.email, 'email_otp', { name: user.name, code, minutes: OTP.minutes }, trx);
}

/**
 * Someone who registers or signs in again with an address that is still waiting for verification lands on the
 * "enter your code" page – so make sure a current code is actually on its way (unless one was sent in the last minute).
 */
async function freshOtpIfDue(userId: number, req: Request) {
  const user = await db('users').where({ id: userId, type: 'customer', status: 'active' }).whereNull('email_verified_at').first('id', 'name', 'email');
  if (!user) return;
  const last = await db('email_otps').where({ user_id: user.id, purpose: 'verify_email' }).orderBy('id', 'desc').first('created_at');
  if (last && Date.now() - new Date(last.created_at).getTime() < OTP.cooldownSeconds * 1000) return;
  await db.transaction(async (trx) => {
    await issueOtp(user, req.ip, trx);
    await audit(req, { action: 'auth.otp_resent', subjectType: 'user', subjectId: user.id, meta: { reason: 'returned_unverified' } }, trx);
  });
  sendNow();
}

/* -------- Customer self-registration (account stays locked until the email is verified) -------- */
authRouter.post(
  '/register',
  limiter(10, 15),
  ah(async (req, res) => {
    const input = parse(registerSchema, req.body);
    const existing = await db('users').where({ email: input.email }).first('id', 'email_verified_at', 'type');
    if (existing) {
      if (existing.type === 'customer' && !existing.email_verified_at) {
        await freshOtpIfDue(existing.id, req);
        throw new HttpError(409, 'This email is registered but not verified yet. Enter the code we emailed you, or request a new one.', 'email_unverified', { email: input.email });
      }
      throw conflict('An account with this email already exists. Try signing in or resetting your password.');
    }
    const hash = await bcrypt.hash(input.password, config.auth.bcryptCost);
    await db.transaction(async (trx) => {
      const [uid] = await trx('users').insert({ type: 'customer', name: input.name, email: input.email, password_hash: hash, cellphone: input.cellphone || null, email_verified_at: null });
      let businessId: number | null = null;
      if (input.company) [businessId] = await trx('businesses').insert({ name: input.company, country: input.country, phone: input.cellphone || null });
      await trx('customers').insert({ user_id: uid, full_name: input.name, email: input.email, cellphone: input.cellphone || null, company: input.company || null, country: input.country, business_id: businessId });
      const ip = ipHash(req.ip);
      const consentRows = [
        { purpose: 'privacy_policy', document_version: config.legal.privacyVersion, granted: true },
        { purpose: 'terms', document_version: config.legal.termsVersion, granted: true },
        { purpose: 'marketing', document_version: config.legal.privacyVersion, granted: input.marketingOptIn },
      ].map((c) => ({ ...c, user_id: uid, email: input.email, source: 'register', ip_hash: ip }));
      await trx('consents').insert(consentRows);
      await issueOtp({ id: uid, name: input.name, email: input.email }, req.ip, trx);
      await audit(req, { action: 'auth.register', subjectType: 'user', subjectId: uid }, trx);
    });
    sendNow();
    // No session yet: the customer must prove they can receive email at this address first.
    res.status(201).json({ ok: true, verify: true, email: input.email, minutes: OTP.minutes });
  }),
);

const unverifiedCustomer = (addr: string) => db('users').where({ email: addr, type: 'customer' }).whereNull('email_verified_at').first('id', 'name', 'email', 'status');

authRouter.post(
  '/verify-email',
  limiter(15, 15),
  ah(async (req, res) => {
    const input = parse(z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
    const bad = new HttpError(400, 'That code is not valid. Check the latest email from SCHLUSS or request a new code.', 'invalid_code');
    const user = await unverifiedCustomer(input.email);
    if (!user || user.status !== 'active') throw bad;
    const otp = await db('email_otps').where({ user_id: user.id, purpose: 'verify_email' }).whereNull('used_at').orderBy('id', 'desc').first();
    if (!otp) throw bad;
    if (otp.attempts >= OTP.maxAttempts) throw new HttpError(429, 'Too many wrong codes. Request a new code.', 'too_many_attempts');
    if (otp.invalidated_at) throw bad; // replaced by a newer code
    if (new Date(otp.expires_at).getTime() < Date.now()) throw new HttpError(400, 'This code has expired. Request a new code.', 'code_expired');
    if (otp.attempts >= OTP.maxAttempts) throw new HttpError(429, 'Too many wrong codes. Request a new code.', 'too_many_attempts');
    if (!safeEqual(otp.code_hash, otpHash(user.id, input.code))) {
      const attempts = otp.attempts + 1;
      await db('email_otps').where({ id: otp.id }).update({ attempts, ...(attempts >= OTP.maxAttempts ? { invalidated_at: new Date() } : {}) });
      await audit(req, { action: 'auth.otp_failed', subjectType: 'user', subjectId: user.id, meta: { attempts } });
      if (attempts >= OTP.maxAttempts) throw new HttpError(429, 'Too many wrong codes. Request a new code.', 'too_many_attempts');
      throw bad;
    }
    // Single use: only the first request that marks it used wins.
    const won = await db('email_otps').where({ id: otp.id }).whereNull('used_at').update({ used_at: new Date() });
    if (!won) throw bad;
    await db.transaction(async (trx) => {
      await trx('users').where({ id: user.id }).update({ email_verified_at: new Date(), last_login_at: new Date(), updated_at: new Date() });
      await queueEmail(user.email, 'welcome_customer', { name: user.name }, trx);
      await audit(req, { action: 'auth.email_verified', subjectType: 'user', subjectId: user.id }, trx);
    });
    if (req.auth) await destroySession(req, res);
    await createSession(req, res, user.id);
    res.json({ ok: true, type: 'customer' });
  }),
);

authRouter.post(
  '/resend-otp',
  limiter(6, 15),
  ah(async (req, res) => {
    const { email: addr } = parse(z.object({ email }), req.body);
    const user = await unverifiedCustomer(addr);
    if (user && user.status === 'active') {
      const last = await db('email_otps').where({ user_id: user.id, purpose: 'verify_email' }).orderBy('id', 'desc').first('created_at');
      const wait = last ? Math.ceil(OTP.cooldownSeconds - (Date.now() - new Date(last.created_at).getTime()) / 1000) : 0;
      if (wait > 0) throw new HttpError(429, `Please wait ${wait} seconds before requesting another code.`, 'cooldown', { wait });
      await db.transaction(async (trx) => {
        await issueOtp(user, req.ip, trx);
        await audit(req, { action: 'auth.otp_resent', subjectType: 'user', subjectId: user.id }, trx);
      });
      sendNow();
    }
    // Same answer either way – doesn't reveal which emails have accounts.
    res.json({ ok: true, message: 'If this email has an account waiting for verification, a new code is on its way.', minutes: OTP.minutes, cooldown: OTP.cooldownSeconds });
  }),
);

/**
 * Has the latest verification email actually left? Lets the "enter your code" page say so honestly instead of
 * always claiming "we sent a code". Only answers for an address that is waiting for verification.
 */
authRouter.post(
  '/otp-status',
  limiter(120, 15),
  ah(async (req, res) => {
    const { email: addr } = parse(z.object({ email }), req.body);
    const user = await unverifiedCustomer(addr);
    let status: 'sending' | 'sent' | 'problem' = 'sending';
    if (user) {
      const log = await db('email_logs').where({ to_email: user.email, template_key: 'email_otp' }).orderBy('id', 'desc').first('status', 'error');
      if (log?.status === 'sent') status = 'sent';
      else if (log && (log.status === 'failed' || log.error)) status = 'problem';
    }
    res.json({ status });
  }),
);

/* -------- Login / logout -------- */
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password').max(200) });

authRouter.post(
  '/login',
  limiter(20, 15),
  ah(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await db('users').where({ email: input.email }).first();
    const generic = new HttpError(401, 'Incorrect email or password.', 'invalid_credentials');

    if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes or reset your password.', 'locked');
    }
    const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      if (user) {
        const fails = user.failed_logins + 1;
        const lock = fails >= config.auth.maxFailedLogins ? new Date(Date.now() + config.auth.lockMinutes * 60_000) : null;
        await db('users').where({ id: user.id }).update({ failed_logins: lock ? 0 : fails, locked_until: lock });
        await audit(req, { action: 'auth.login_failed', subjectType: 'user', subjectId: user.id, meta: { locked: !!lock } });
        if (lock) void alertAdmins('An account was locked after failed sign-ins', `${user.type === 'staff' ? 'Staff' : 'Customer'} account ${user.email} was locked for ${config.auth.lockMinutes} minutes after ${config.auth.maxFailedLogins} wrong passwords (from ${req.ip}).`).catch(() => undefined);
      }
      failedLogin(req);
      throw generic;
    }
    if (user.status !== 'active') throw generic;
    if (user.type === 'customer' && !user.email_verified_at) {
      await freshOtpIfDue(user.id, req);
      throw new HttpError(403, 'Please verify your email address first. Enter the code we emailed you, or request a new one.', 'email_unverified', { email: user.email });
    }

    // Two-step verification: the password alone does not open a session. A short-lived signed ticket lets the
    // browser send the 6-digit code next; it is useless without the code and expires after 5 minutes.
    if (user.mfa_enabled_at && user.mfa_secret) {
      res.json({ ok: true, mfa: true, ticket: signToken({ u: user.id, k: 'mfa' }, 300) });
      return;
    }

    // Session fixation defence: drop any session already on this browser before issuing a new one.
    if (req.auth) await destroySession(req, res);
    await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null, last_login_at: new Date() });
    await createSession(req, res, user.id);
    await db('audit_logs').insert({ actor_id: user.id, action: 'auth.login', subject_type: 'user', subject_id: user.id, ip: req.ip ?? null });
    res.json({ ok: true, type: user.type, mfaSetupRequired: user.type === 'staff' && (await requireStaffMfa()) });
  }),
);

/* -------- Two-step verification (TOTP) -------- */
const mfaCode = z.string().trim().min(6).max(20);

/** Second step of signing in: the ticket from /login plus the 6-digit code (or a one-time recovery code). */
authRouter.post(
  '/mfa/verify',
  limiter(15, 15),
  ah(async (req, res) => {
    const input = parse(z.object({ ticket: z.string().min(20).max(400), code: mfaCode }), req.body);
    const t = readToken<{ u: number; k: string }>(input.ticket);
    const expired = new HttpError(401, 'Your sign-in took too long. Please enter your email and password again.', 'mfa_expired');
    if (!t || t.k !== 'mfa') throw expired;
    const user = await db('users').where({ id: t.u }).first();
    if (!user || user.status !== 'active' || !user.mfa_enabled_at || !user.mfa_secret) throw expired;
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.', 'locked');

    const step = verifyTotp(decryptSecret(user.mfa_secret), input.code, user.mfa_last_step === null ? null : Number(user.mfa_last_step));
    let usedRecovery = false;
    let recovery: string[] = parseJson<string[]>(user.mfa_recovery, []);
    if (step === null) {
      const h = recoveryHash(input.code);
      if (recovery.includes(h)) {
        usedRecovery = true;
        recovery = recovery.filter((x) => x !== h);
      }
    }
    if (step === null && !usedRecovery) {
      const fails = user.failed_logins + 1;
      const lock = fails >= config.auth.maxFailedLogins ? new Date(Date.now() + config.auth.lockMinutes * 60_000) : null;
      await db('users').where({ id: user.id }).update({ failed_logins: lock ? 0 : fails, locked_until: lock });
      await db('audit_logs').insert({ actor_id: null, action: 'auth.mfa_failed', subject_type: 'user', subject_id: user.id, meta: JSON.stringify({ locked: !!lock }), ip: req.ip ?? null });
      if (lock) void alertAdmins('An account was locked after wrong verification codes', `${user.email} entered ${config.auth.maxFailedLogins} wrong two-step codes after a correct password (from ${req.ip}). If this wasn't them, their password is known to someone else – reset it.`).catch(() => undefined);
      failedLogin(req);
      throw new HttpError(401, 'That code is not correct. Check the newest code in your authenticator app.', 'invalid_code');
    }
    if (req.auth) await destroySession(req, res);
    await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null, last_login_at: new Date(), ...(step !== null ? { mfa_last_step: step } : { mfa_recovery: JSON.stringify(recovery) }) });
    await createSession(req, res, user.id);
    await db('audit_logs').insert({ actor_id: user.id, action: 'auth.login', subject_type: 'user', subject_id: user.id, meta: JSON.stringify({ mfa: usedRecovery ? 'recovery_code' : 'totp' }), ip: req.ip ?? null });
    if (usedRecovery) void alertAdmins('A recovery code was used to sign in', `${user.email} signed in with a one-time recovery code (${recovery.length} left).`).catch(() => undefined);
    res.json({ ok: true, type: user.type, recoveryCodesLeft: usedRecovery ? recovery.length : undefined });
  }),
);

authRouter.get(
  '/mfa',
  requireAuth(),
  ah(async (req, res) => {
    const u = await db('users').where({ id: req.auth!.user.id }).first('mfa_enabled_at', 'mfa_recovery');
    res.json({ enabled: !!u.mfa_enabled_at, enabledAt: u.mfa_enabled_at, recoveryCodesLeft: parseJson<string[]>(u.mfa_recovery, []).length, required: req.auth!.user.type === 'staff' && (await requireStaffMfa()), available: req.auth!.user.type === 'staff' });
  }),
);

/** Step 1 of switching it on: a new secret (kept pending until a code from the app proves the phone has it). */
authRouter.post(
  '/mfa/setup',
  requireAuth('staff'),
  limiter(10, 15),
  ah(async (req, res) => {
    const u = await db('users').where({ id: req.auth!.user.id }).first('email', 'mfa_enabled_at');
    if (u.mfa_enabled_at) throw new HttpError(400, 'Two-step verification is already on. Switch it off first to set it up again.', 'mfa_already_enabled');
    const secret = newTotpSecret();
    await db('users').where({ id: req.auth!.user.id }).update({ mfa_secret: encryptSecret(secret), mfa_last_step: null });
    const url = otpauthUrl(secret, u.email);
    // @ts-expect-error – qrcode ships no type declarations
    const QRCode = (await import('qrcode')).default as { toDataURL(text: string, opts: object): Promise<string> };
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 400 }); // a picture (data: URL) – the secret is never sent to any other service
    res.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr });
  }),
);

authRouter.post(
  '/mfa/enable',
  requireAuth('staff'),
  limiter(10, 15),
  ah(async (req, res) => {
    const { code } = parse(z.object({ code: mfaCode }), req.body);
    const u = await db('users').where({ id: req.auth!.user.id }).first('mfa_secret', 'mfa_enabled_at');
    if (u.mfa_enabled_at) throw new HttpError(400, 'Two-step verification is already on.', 'mfa_already_enabled');
    if (!u.mfa_secret) throw new HttpError(400, 'Start the setup again.', 'mfa_not_started');
    const step = verifyTotp(decryptSecret(u.mfa_secret), code, null);
    if (step === null) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { code: 'That code is not correct. Enter the newest 6-digit code from your authenticator app.' } });
    const { codes, hashes } = newRecoveryCodes();
    await db('users').where({ id: req.auth!.user.id }).update({ mfa_enabled_at: new Date(), mfa_last_step: step, mfa_recovery: JSON.stringify(hashes), updated_at: new Date() });
    await db('sessions').where({ user_id: req.auth!.user.id }).whereNot({ id: req.auth!.sessionId }).del(); // other devices must sign in again, now with a code
    await audit(req, { action: 'auth.mfa_enabled', subjectType: 'user', subjectId: req.auth!.user.id });
    res.json({ ok: true, recoveryCodes: codes });
  }),
);

/** Switching it off needs the password AND a current code (or recovery code) – a stolen session alone can't do it. */
authRouter.post(
  '/mfa/disable',
  requireAuth('staff'),
  limiter(10, 15),
  ah(async (req, res) => {
    const input = parse(z.object({ password: z.string().min(1).max(200), code: mfaCode }), req.body);
    const u = await db('users').where({ id: req.auth!.user.id }).first('password_hash', 'mfa_secret', 'mfa_enabled_at', 'mfa_recovery', 'mfa_last_step');
    if (!u.mfa_enabled_at) throw new HttpError(400, 'Two-step verification is not on.', 'mfa_not_enabled');
    const okPw = await bcrypt.compare(input.password, u.password_hash);
    const okCode = verifyTotp(decryptSecret(u.mfa_secret), input.code, u.mfa_last_step === null ? null : Number(u.mfa_last_step)) !== null || parseJson<string[]>(u.mfa_recovery, []).includes(recoveryHash(input.code));
    if (!okPw || !okCode) {
      await audit(req, { action: 'auth.mfa_disable_failed', subjectType: 'user', subjectId: req.auth!.user.id });
      throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { [okPw ? 'code' : 'password']: okPw ? 'That code is not correct.' : 'Password is incorrect' } });
    }
    await db('users').where({ id: req.auth!.user.id }).update({ mfa_secret: null, mfa_enabled_at: null, mfa_recovery: null, mfa_last_step: null, updated_at: new Date() });
    await audit(req, { action: 'auth.mfa_disabled', subjectType: 'user', subjectId: req.auth!.user.id });
    void alertAdmins('Two-step verification was switched off', `${req.auth!.user.email} switched off two-step verification for their account.`).catch(() => undefined);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    if (req.auth) await audit(req, { action: 'auth.logout', subjectType: 'user', subjectId: req.auth.user.id });
    await destroySession(req, res);
    issueCsrf(res);
    res.json({ ok: true });
  }),
);

/* -------- Password reset -------- */
authRouter.post(
  '/forgot-password',
  limiter(5, 15),
  ah(async (req, res) => {
    const { email: addr } = parse(z.object({ email }), req.body);
    const user = await db('users').where({ email: addr, status: 'active' }).whereNotNull('email_verified_at').first('id', 'name', 'email');
    if (user) {
      const token = randomToken(32);
      await db.transaction(async (trx) => {
        await trx('password_resets').where({ user_id: user.id }).whereNull('used_at').del();
        await trx('password_resets').insert({ user_id: user.id, token_hash: sha256(token), expires_at: new Date(Date.now() + config.auth.resetTokenMinutes * 60_000) });
        await queueEmail(user.email, 'password_reset', { name: user.name, resetUrl: `${config.appUrl}/reset-password?token=${token}`, minutes: config.auth.resetTokenMinutes }, trx);
        await audit(req, { action: 'auth.reset_requested', subjectType: 'user', subjectId: user.id }, trx);
      });
    }
    // Same response either way – doesn't reveal whether an account exists.
    res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
  }),
);

authRouter.post(
  '/reset-password',
  limiter(10, 15),
  ah(async (req, res) => {
    const input = parse(z.object({ token: z.string().min(20).max(100), password }), req.body);
    const row = await db('password_resets').where({ token_hash: sha256(input.token) }).whereNull('used_at').first();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.', 'invalid_token');
    }
    const hash = await bcrypt.hash(input.password, config.auth.bcryptCost);
    await db.transaction(async (trx) => {
      await trx('password_resets').where({ id: row.id }).update({ used_at: new Date() });
      await trx('users').where({ id: row.user_id }).update({ password_hash: hash, failed_logins: 0, locked_until: null, updated_at: new Date() });
      await trx('sessions').where({ user_id: row.user_id }).del(); // sign out everywhere
      await trx('audit_logs').insert({ actor_id: row.user_id, action: 'auth.password_reset', subject_type: 'user', subject_id: row.user_id, ip: req.ip ?? null });
    });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth(),
  limiter(10, 15),
  ah(async (req, res) => {
    const input = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
    const user = await db('users').where({ id: req.auth!.user.id }).first('password_hash');
    if (!(await bcrypt.compare(input.currentPassword, user.password_hash))) {
      throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { currentPassword: 'Current password is incorrect' } });
    }
    const hash = await bcrypt.hash(input.newPassword, config.auth.bcryptCost);
    await db('users').where({ id: req.auth!.user.id }).update({ password_hash: hash, updated_at: new Date() });
    await db('sessions').where({ user_id: req.auth!.user.id }).whereNot({ id: req.auth!.sessionId }).del();
    await audit(req, { action: 'auth.password_changed', subjectType: 'user', subjectId: req.auth!.user.id });
    res.json({ ok: true });
  }),
);

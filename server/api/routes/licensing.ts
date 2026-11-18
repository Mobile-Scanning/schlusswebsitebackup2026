import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { ah, HttpError, parse } from '../http';
import { requireAuth } from '../middleware/auth';
import { sha256 } from '../services/crypto';
import { licensingKeys, limit, signLicence } from '../services/platform';

/**
 * Central licensing API – used by installed SCHLUSS software (not by the website).
 *
 * The server is the only authority on demo and licence dates. The app sends its licence key and a
 * stable device id; the server answers with a token signed with the SCHLUSS private key (Ed25519).
 * The app verifies the signature with the public key (GET /api/licensing/public-key, embed it in the app)
 * and may keep working offline only until `validUntil` – the shorter of the licence end and the offline
 * grace period. If the device clock is earlier than `issuedAt`, the app must treat the token as invalid
 * (clock rolled back) and reconnect. Reinstalling or downloading again never changes the dates because
 * they live on the server, keyed to the customer and product.
 *
 * NOTE: this only protects software that calls this API. A downloaded file that does not check its
 * licence cannot be switched off remotely – the admin portal says so next to each demo.
 */
export const licensingRouter = Router();

const body = z.object({
  licenceKey: z.string().trim().toUpperCase().regex(/^SCH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid licence key'),
  product: z.string().trim().min(1).max(180),
  deviceId: z.string().trim().min(16, 'Device id too short').max(200),
  deviceName: z.string().trim().max(120).optional(),
  platform: z.string().trim().max(32).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

const fail = (status: number, code: string, message: string) => new HttpError(status, message, code);

async function load(input: z.infer<typeof body>) {
  const lic = await db('licences as l').join('products as p', 'p.id', 'l.product_id').where('l.licence_key', input.licenceKey).first('l.*', 'p.slug', 'p.name as product_name');
  // Same answer for unknown key and wrong product – no key probing.
  if (!lic || lic.slug !== input.product) throw fail(404, 'licence_not_found', 'This licence key is not valid for this product.');
  if (lic.status === 'revoked') throw fail(403, 'licence_revoked', 'This licence has been revoked. Please contact SCHLUSS.');
  if (lic.status === 'suspended') throw fail(403, 'licence_suspended', 'This licence is suspended. Please contact SCHLUSS.');
  if (lic.converted_at && lic.type === 'trial') throw fail(403, 'demo_converted', 'This demo has been replaced by your full licence. Please enter your new licence key.');
  return lic;
}

async function issue(licId: number, deviceHash: string) {
  const l = await db('licences as l').join('products as p', 'p.id', 'l.product_id').where('l.id', licId).first('l.licence_key', 'l.type', 'l.expires_at', 'l.offline_grace_days', 'p.slug');
  const nowMs = Date.now(); // server clock – never the device's
  const exp = l.expires_at ? new Date(l.expires_at).getTime() : null;
  const grace = nowMs + Number(l.offline_grace_days ?? 7) * 86400_000;
  const validUntil = exp ? Math.min(exp, grace) : grace;
  const payload = { v: 1, licenceKey: l.licence_key, product: l.slug, type: l.type === 'trial' ? 'demo' : l.type, device: deviceHash, issuedAt: new Date(nowMs).toISOString(), expiresAt: exp ? new Date(exp).toISOString() : null, validUntil: new Date(validUntil).toISOString() };
  return { ...payload, token: await signLicence(payload) };
}

licensingRouter.get(
  '/public-key',
  ah(async (_req, res) => {
    res.type('text/plain').send((await licensingKeys()).publicKey);
  }),
);

/** First run on a device. For "starts on activation" demos this is when the demo clock starts. */
licensingRouter.post(
  '/activate',
  limit(30, 15),
  ah(async (req, res) => {
    const input = parse(body, req.body);
    const lic = await load(input);
    const deviceHash = sha256(`${lic.product_id}:${input.deviceId}`);
    await db.transaction(async (trx) => {
      const l = await trx('licences').where({ id: lic.id }).forUpdate().first();
      if (l.expires_at && new Date(l.expires_at) <= new Date()) throw fail(403, 'licence_expired', l.type === 'trial' ? 'This demo has expired. Contact SCHLUSS to discuss a package.' : 'This licence has expired.');
      const known = await trx('licence_activations').where({ licence_id: l.id, device_hash: deviceHash }).first();
      if (!known || known.deactivated_at) {
        const used = await trx('licence_activations').where({ licence_id: l.id }).whereNull('deactivated_at').count({ n: '*' }).first();
        if (Number(used?.n ?? 0) >= Number(l.max_devices ?? 1)) throw fail(409, 'device_limit', `This licence is already active on ${l.max_devices} device(s). Deactivate one or contact SCHLUSS.`);
        if (known) await trx('licence_activations').where({ id: known.id }).update({ deactivated_at: null, activated_at: trx.raw('UTC_TIMESTAMP()'), last_validated_at: trx.raw('UTC_TIMESTAMP()') });
        else await trx('licence_activations').insert({ licence_id: l.id, device_hash: deviceHash, device_name: input.deviceName ?? null, platform: input.platform ?? null, app_version: input.appVersion ?? null, last_validated_at: trx.raw('UTC_TIMESTAMP()') });
        await trx('licence_events').insert({ licence_id: l.id, event: known ? 'device_reactivated' : 'activated', after: JSON.stringify({ device: input.deviceName ?? null, platform: input.platform ?? null, appVersion: input.appVersion ?? null }) });
      }
      const patch: Record<string, unknown> = { last_seen_at: trx.raw('UTC_TIMESTAMP()') };
      if (!l.activated_at) patch['activated_at'] = trx.raw('UTC_TIMESTAMP()');
      if (l.type === 'trial' && !l.expires_at) {
        patch['expires_at'] = trx.raw('DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)', [l.duration_days || 14]); // demo clock starts now
        await trx('licence_events').insert({ licence_id: l.id, event: 'demo_clock_started', after: JSON.stringify({ days: l.duration_days }) });
      }
      await trx('licences').where({ id: l.id }).update(patch);
      await trx('customers').where({ id: l.customer_id }).update({ last_activation_at: trx.raw('UTC_TIMESTAMP()') });
    });
    res.json(await issue(lic.id, deviceHash));
  }),
);

/** Regular check from an activated device. Returns a fresh signed token, or the reason it may not run. */
licensingRouter.post(
  '/validate',
  limit(120, 15),
  ah(async (req, res) => {
    const input = parse(body, req.body);
    const lic = await load(input);
    const deviceHash = sha256(`${lic.product_id}:${input.deviceId}`);
    const act = await db('licence_activations').where({ licence_id: lic.id, device_hash: deviceHash }).whereNull('deactivated_at').first('id');
    if (!act) throw fail(403, 'not_activated', 'This device is not activated. Please activate it first.');
    if (lic.expires_at && new Date(lic.expires_at) <= new Date()) throw fail(403, 'licence_expired', lic.type === 'trial' ? 'This demo has expired. Contact SCHLUSS to discuss a package.' : 'This licence has expired.');
    await db('licence_activations').where({ id: act.id }).update({ last_validated_at: db.raw('UTC_TIMESTAMP()'), app_version: input.appVersion ?? null });
    await db('licences').where({ id: lic.id }).update({ last_seen_at: db.raw('UTC_TIMESTAMP()') });
    res.json(await issue(lic.id, deviceHash));
  }),
);

/* ============================ Notifications (any signed-in user, own only) ============================ */
export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth(),
  ah(async (req, res) => {
    const q = parse(z.object({ unread: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
    const base = db('notifications').where({ user_id: req.auth!.user.id });
    const unread = Number((await base.clone().whereNull('read_at').count({ n: '*' }).first())?.n ?? 0);
    if (q.unread) base.whereNull('read_at');
    const data = await base.orderBy('id', 'desc').limit(q.limit).select('id', 'type', 'title', 'body', 'link', 'read_at', 'created_at');
    res.json({ unread, data });
  }),
);

notificationsRouter.post(
  '/read',
  requireAuth(),
  ah(async (req, res) => {
    const input = parse(z.object({ ids: z.array(z.number().int()).max(200).optional(), all: z.boolean().optional() }), req.body);
    const q = db('notifications').where({ user_id: req.auth!.user.id }).whereNull('read_at');
    if (!input.all) q.whereIn('id', input.ids ?? []);
    await q.update({ read_at: new Date() });
    res.json({ ok: true });
  }),
);

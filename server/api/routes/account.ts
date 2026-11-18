import { randomBytes } from 'node:crypto';
import { Request, Router } from 'express';
import { z } from 'zod';
import { featuresOf } from '../services/offerings';
import { audit } from '../services/audit';
import { config } from '../config';
import { db } from '../db';
import { ah, HttpError, notFound, parse } from '../http';
import { queueEmail } from '../services/jobs';
import { requireAuth } from '../middleware/auth';

/**
 * Customer self-service: free trials.
 *
 * A trial is a real licence record (type "trial") for the signed-in customer and product.
 * - Only published products that offer a trial (trial_days > 0) and are available can be trialled.
 * - One trial per customer per product, ever: enforced by the database unique index
 *   licences_one_trial_per_customer_product – reinstalling or re-registering can't restart it.
 * - Start and end dates come from the database clock.
 */
export const accountRouter = Router();

const TRIALABLE = ['available', 'demo_available', 'beta'];

function licenceKey() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(16);
  const chars = Array.from(b, (x) => A[x % A.length]).join('');
  return `SCH-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

function customerOnly(req: Request) {
  const a = req.auth;
  if (!a || a.user.type !== 'customer' || !a.customerId) {
    throw new HttpError(403, 'Free trials are for customer accounts. Sign in with (or create) a customer account to start a trial.', 'customer_only');
  }
  return a.customerId;
}

async function listTrials(customerId: number) {
  const rows = await db('licences as l')
    .join('products as p', 'p.id', 'l.product_id')
    .where({ 'l.customer_id': customerId, 'l.type': 'trial' })
    .orderBy('l.starts_at', 'desc')
    .select('l.licence_key', 'l.status', 'l.starts_at', 'l.expires_at', 'p.name', 'p.slug', db.raw('UTC_TIMESTAMP() > l.expires_at as ended'));
  return rows.map((r) => ({
    product: { name: r.name, slug: r.slug },
    licenceKey: r.licence_key,
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    status: r.status === 'trial' && Number(r.ended) ? 'expired' : r.status,
  }));
}

accountRouter.get(
  '/trials',
  requireAuth(),
  ah(async (req, res) => {
    res.json(await listTrials(customerOnly(req)));
  }),
);

accountRouter.post(
  '/trials',
  requireAuth(),
  ah(async (req, res) => {
    const customerId = customerOnly(req);
    const { product: slug } = parse(z.object({ product: z.string().trim().min(1).max(180) }), req.body);
    const p = await db('products').where({ slug, is_published: true, is_archived: false }).first('id', 'name', 'slug', 'status', 'trial_days', 'offering_type', 'features');
    if (!p) throw notFound('Product not found.');
    if (!TRIALABLE.includes(p.status) || !p.trial_days || !featuresOf(p).trial) {
      throw new HttpError(409, `${p.name} doesn't offer a free trial at the moment. You can request a demonstration instead.`, 'no_trial');
    }
    const key = licenceKey();
    try {
      await db.transaction(async (trx) => {
        await trx('licences').insert({
          licence_key: key,
          customer_id: customerId,
          product_id: p.id,
          type: 'trial',
          status: 'trial',
          starts_at: trx.raw('UTC_TIMESTAMP()'),
          expires_at: trx.raw('DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)', [p.trial_days]),
        });
        const lic = await trx('licences').where({ licence_key: key }).first('id', 'expires_at');
        await trx('licence_events').insert({ licence_id: lic.id, event: 'trial_started', actor_id: req.auth!.user.id, after: JSON.stringify({ days: p.trial_days }) });
        const cust = await trx('customers').where({ id: customerId }).first('full_name', 'email');
        const ends = new Date(lic.expires_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' });
        await queueEmail(cust.email, 'trial_started', { name: cust.full_name, product: p.name, days: p.trial_days, ends, licenceKey: key, productUrl: `${config.appUrl}/products/${p.slug}` }, trx);
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
        const existing = (await listTrials(customerId)).find((t) => t.product.slug === p.slug);
        throw new HttpError(409, `You've already used your free trial of ${p.name}${existing?.expiresAt ? ` (it ${existing.status === 'expired' ? 'ended' : 'runs until'} ${new Date(existing.expiresAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}. Each customer gets one trial per product.`, 'trial_used', { trial: existing });
      }
      throw e;
    }
    await audit(req, { action: 'trial.started', subjectType: 'product', subjectId: p.id, after: { licenceKey: key, days: p.trial_days } });
    const trial = (await listTrials(customerId)).find((t) => t.licenceKey === key);
    res.status(201).json(trial);
  }),
);

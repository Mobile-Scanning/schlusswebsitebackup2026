import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, badRequest, conflict, like, notFound, pageQuery, parse } from '../http';
import { requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { randomToken, sha256 } from '../services/crypto';
import { queueEmail } from '../services/jobs';

/** Admin: demo requests, partner applications/approval, website enquiries. */
export const adminSalesRouter = Router();

/* =============================== Demo requests =============================== */
const DEMO_STATUSES = ['new', 'contacted', 'scheduled', 'completed', 'cancelled', 'no_show'] as const;

adminSalesRouter.get(
  '/demo-requests',
  requirePermission('demos.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ status: z.enum(DEMO_STATUSES).optional(), q: z.string().trim().max(100).optional() }), req.query);
    const base = db('demo_requests as d').leftJoin('products as p', 'p.id', 'd.product_id').leftJoin('users as u', 'u.id', 'd.assigned_to');
    if (q.status) base.where('d.status', q.status);
    if (q.q) base.andWhere((b) => b.where('d.name', 'like', like(q.q!)).orWhere('d.email', 'like', like(q.q!)).orWhere('d.company', 'like', like(q.q!)).orWhere('d.reference', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: 'd.id' });
    const data = await base.clone().orderBy('d.id', 'desc').limit(q.perPage).offset((q.page - 1) * q.perPage).select('d.*', 'p.name as product_name', 'u.name as assigned_name');
    const counts = await db('demo_requests').groupBy('status').select('status').count({ n: '*' });
    res.json({ data: data.map((d) => ({ ...d, converted: !!d.converted })), meta: { page: q.page, perPage: q.perPage, total: Number(total) }, counts: Object.fromEntries(counts.map((c: Record<string, unknown>) => [c['status'], Number(c['n'])])) });
  }),
);

adminSalesRouter.patch(
  '/demo-requests/:id',
  requirePermission('demos.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(
      z.object({
        status: z.enum(DEMO_STATUSES).optional(),
        assignedTo: z.number().int().nullable().optional(),
        scheduledAt: z.string().max(40).nullable().optional(),
        followUpNotes: z.string().trim().max(5000).nullable().optional(),
        converted: z.boolean().optional(),
        notifyCustomer: z.boolean().optional(),
      }),
      req.body,
    );
    const before = await db('demo_requests').where({ id }).first();
    if (!before) throw notFound('Demo request not found.');
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.status) patch['status'] = input.status;
    if (input.assignedTo !== undefined) {
      if (input.assignedTo && !(await db('users').where({ id: input.assignedTo, type: 'staff', status: 'active' }).first('id'))) throw badRequest('Choose an active staff member.');
      patch['assigned_to'] = input.assignedTo;
    }
    if (input.scheduledAt !== undefined) {
      const d = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (d && isNaN(d.getTime())) throw badRequest('Invalid date.');
      patch['scheduled_at'] = d;
      if (d && !input.status && before.status === 'new') patch['status'] = 'scheduled';
    }
    if (input.followUpNotes !== undefined) patch['follow_up_notes'] = input.followUpNotes;
    if (input.converted !== undefined) patch['converted'] = input.converted;
    if ((patch['status'] ?? before.status) === 'completed' && !before.completed_at) patch['completed_at'] = new Date();
    await db.transaction(async (trx) => {
      await trx('demo_requests').where({ id }).update(patch);
      if (input.notifyCustomer && patch['scheduled_at']) {
        const product = before.product_id ? await trx('products').where({ id: before.product_id }).first('name') : null;
        const when = new Date(patch['scheduled_at'] as Date).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' });
        await queueEmail(before.email, 'demo_scheduled', { name: before.name, reference: before.reference, product: product?.name ?? 'SCHLUSS', when }, trx);
      }
      await audit(req, { action: 'demo.updated', subjectType: 'demo_request', subjectId: id, before: { status: before.status, assigned_to: before.assigned_to, scheduled_at: before.scheduled_at }, after: input }, trx);
    });
    res.json({ ok: true });
  }),
);

adminSalesRouter.get(
  '/staff-options',
  requirePermission('demos.manage', 'support.manage', 'partners.manage'),
  ah(async (_req, res) => {
    res.json(await db('users').where({ type: 'staff', status: 'active' }).orderBy('name').select('id', 'name'));
  }),
);

/* =============================== Partner applications =============================== */
const PARTNER_STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'suspended'] as const;

adminSalesRouter.get(
  '/partners',
  requirePermission('partners.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ status: z.enum(PARTNER_STATUSES).optional(), q: z.string().trim().max(100).optional() }), req.query);
    const base = db('partners');
    if (q.status) base.where('status', q.status);
    if (q.q) base.andWhere((b) => b.where('business_name', 'like', like(q.q!)).orWhere('email', 'like', like(q.q!)).orWhere('reference', 'like', like(q.q!)).orWhere('contact_name', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: '*' });
    const data = await base.clone().orderBy('id', 'desc').limit(q.perPage).offset((q.page - 1) * q.perPage).select('id', 'reference', 'business_name', 'contact_name', 'email', 'cellphone', 'country', 'status', 'created_at', 'approved_at');
    const counts = await db('partners').groupBy('status').select('status').count({ n: '*' });
    res.json({ data, meta: { page: q.page, perPage: q.perPage, total: Number(total) }, counts: Object.fromEntries(counts.map((c: Record<string, unknown>) => [c['status'], Number(c['n'])])) });
  }),
);

adminSalesRouter.get(
  '/partners/:id',
  requirePermission('partners.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const p = await db('partners as p').leftJoin('users as r', 'r.id', 'p.reviewed_by').where('p.id', id).first('p.*', 'r.name as reviewed_by_name');
    if (!p) throw notFound('Partner not found.');
    const [users, products, history] = await Promise.all([
      db('users').where({ partner_id: id }).select('id', 'name', 'email', 'status', 'last_login_at'),
      db('partner_products as pp').join('products as pr', 'pr.id', 'pp.product_id').where('pp.partner_id', id).select('pr.id', 'pr.name', 'pp.commission_percent', 'pp.discount_percent', 'pp.is_active'),
      db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_id').where({ 'a.subject_type': 'partner', 'a.subject_id': id }).orderBy('a.id', 'desc').limit(30).select('a.action', 'a.created_at', 'a.meta', 'u.name as actor'),
    ]);
    res.json({ ...p, discount_percent: Number(p.discount_percent), default_commission_percent: Number(p.default_commission_percent), users, products, history });
  }),
);

adminSalesRouter.post(
  '/partners/:id/status',
  requirePermission('partners.approve'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(z.object({ status: z.enum(['under_review', 'approved', 'rejected', 'suspended']), note: z.string().trim().max(2000).optional().or(z.literal('')) }), req.body);
    const p = await db('partners').where({ id }).first();
    if (!p) throw notFound('Partner not found.');
    if (p.status === input.status) throw badRequest('The partner already has this status.');
    let invited = false;
    await db.transaction(async (trx) => {
      const patch: Record<string, unknown> = { status: input.status, reviewed_by: req.auth!.user.id, reviewed_at: new Date(), updated_at: new Date() };
      if (input.note) patch['admin_notes'] = [p.admin_notes, `[${new Date().toISOString().slice(0, 10)} ${input.status}] ${input.note}`].filter(Boolean).join('\n');
      if (input.status === 'approved') {
        patch['approved_at'] = p.approved_at ?? new Date();
        // Create the partner's first login (if they don't have one yet) and email a set-password link.
        let user = await trx('users').where({ email: p.email }).first('id', 'type', 'partner_id', 'name');
        if (user && (user.type !== 'partner' || (user.partner_id && user.partner_id !== id))) {
          throw conflict('This email is already used by another account. Ask the partner for a different login email first.');
        }
        if (!user) {
          const unusable = await bcrypt.hash(randomToken(32), config.auth.bcryptCost);
          const [uid] = await trx('users').insert({ type: 'partner', name: p.contact_name, email: p.email, cellphone: p.cellphone, partner_id: id, password_hash: unusable });
          user = { id: uid, type: 'partner', partner_id: id, name: p.contact_name };
          const token = randomToken(32);
          await trx('password_resets').insert({ user_id: uid, token_hash: sha256(token), expires_at: new Date(Date.now() + 7 * 86400_000) });
          await queueEmail(p.email, 'partner_approved', { name: p.contact_name, business: p.business_name, reference: p.reference, setPasswordUrl: `${config.appUrl}/reset-password?token=${token}&welcome=1` }, trx);
          invited = true;
        } else {
          if (!user.partner_id) await trx('users').where({ id: user.id }).update({ partner_id: id });
          await queueEmail(p.email, 'partner_reactivated', { name: p.contact_name, business: p.business_name, loginUrl: `${config.appUrl}/login` }, trx);
        }
      } else if (input.status === 'rejected') {
        await queueEmail(p.email, 'partner_rejected', { name: p.contact_name, business: p.business_name, reference: p.reference }, trx);
      } else if (input.status === 'suspended') {
        await trx('sessions').whereIn('user_id', trx('users').where({ partner_id: id }).select('id')).del();
      }
      await trx('partners').where({ id }).update(patch);
      await audit(req, { action: `partner.${input.status}`, subjectType: 'partner', subjectId: id, before: { status: p.status }, after: { status: input.status }, meta: input.note ? { note: input.note } : undefined }, trx);
    });
    res.json({ ok: true, invited });
  }),
);

adminSalesRouter.patch(
  '/partners/:id',
  requirePermission('partners.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(
      z.object({
        discountPercent: z.number().min(0).max(100).optional(),
        defaultCommissionPercent: z.number().min(0).max(100).optional(),
        adminNotes: z.string().trim().max(10000).nullable().optional(),
        productIds: z.array(z.number().int()).max(500).optional(),
      }),
      req.body,
    );
    const p = await db('partners').where({ id }).first();
    if (!p) throw notFound();
    await db.transaction(async (trx) => {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (input.discountPercent !== undefined) patch['discount_percent'] = input.discountPercent;
      if (input.defaultCommissionPercent !== undefined) patch['default_commission_percent'] = input.defaultCommissionPercent;
      if (input.adminNotes !== undefined) patch['admin_notes'] = input.adminNotes;
      await trx('partners').where({ id }).update(patch);
      if (input.productIds) {
        const valid = await trx('products').whereIn('id', input.productIds).pluck('id');
        await trx('partner_products').where({ partner_id: id }).whereNotIn('product_id', valid).del();
        for (const pid of valid) await trx('partner_products').insert({ partner_id: id, product_id: pid }).onConflict(['partner_id', 'product_id']).merge({ is_active: true });
      }
      await audit(req, { action: 'partner.updated', subjectType: 'partner', subjectId: id, after: input }, trx);
    });
    res.json({ ok: true });
  }),
);

/* =============================== Website enquiries (contact form) =============================== */
const TICKET_STATUSES = ['new', 'open', 'awaiting_admin', 'awaiting_customer', 'in_progress', 'resolved', 'closed'] as const;

adminSalesRouter.get(
  '/enquiries',
  requirePermission('support.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ status: z.enum(TICKET_STATUSES).optional(), q: z.string().trim().max(100).optional() }), req.query);
    const base = db('tickets as t').leftJoin('products as p', 'p.id', 't.product_id').leftJoin('users as u', 'u.id', 't.assigned_to');
    if (q.status) base.where('t.status', q.status);
    if (q.q) base.andWhere((b) => b.where('t.subject', 'like', like(q.q!)).orWhere('t.email', 'like', like(q.q!)).orWhere('t.reference', 'like', like(q.q!)).orWhere('t.name', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: 't.id' });
    const data = await base.clone().orderBy('t.id', 'desc').limit(q.perPage).offset((q.page - 1) * q.perPage).select('t.*', 'p.name as product_name', 'u.name as assigned_name');
    const ids = data.map((t) => t.id);
    const first = ids.length ? await db('ticket_messages').whereIn('ticket_id', ids).orderBy('id').select('ticket_id', 'body') : [];
    res.json({
      data: data.map((t) => ({ ...t, message: first.find((m) => m.ticket_id === t.id)?.body ?? '' })),
      meta: { page: q.page, perPage: q.perPage, total: Number(total) },
    });
  }),
);

adminSalesRouter.patch(
  '/enquiries/:id',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(z.object({ status: z.enum(TICKET_STATUSES).optional(), assignedTo: z.number().int().nullable().optional(), note: z.string().trim().max(5000).optional() }), req.body);
    const t = await db('tickets').where({ id }).first();
    if (!t) throw notFound();
    await db.transaction(async (trx) => {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (input.status) patch['status'] = input.status;
      if (input.status === 'resolved' && !t.resolved_at) patch['resolved_at'] = new Date();
      if (input.assignedTo !== undefined) patch['assigned_to'] = input.assignedTo;
      await trx('tickets').where({ id }).update(patch);
      if (input.note) await trx('ticket_messages').insert({ ticket_id: id, author_id: req.auth!.user.id, body: input.note, is_internal: true });
      await audit(req, { action: 'enquiry.updated', subjectType: 'ticket', subjectId: id, before: { status: t.status }, after: input }, trx);
    });
    res.json({ ok: true });
  }),
);

/* =============================== Dashboard counts =============================== */
adminSalesRouter.get(
  '/dashboard',
  requirePermission('dashboard.view'),
  ah(async (_req, res) => {
    const one = async (q: ReturnType<typeof db>) => Number((await q.count({ n: '*' }).first())?.n ?? 0);
    const [products, published, comingSoon, customers, pendingDemos, pendingPartners, approvedPartners, openEnquiries] = await Promise.all([
      one(db('products').where('is_archived', false)),
      one(db('products').where({ is_published: true, is_archived: false })),
      one(db('products').where({ is_published: true, is_archived: false, status: 'coming_soon' })),
      one(db('customers')),
      one(db('demo_requests').whereIn('status', ['new', 'contacted', 'scheduled'])),
      one(db('partners').whereIn('status', ['pending', 'under_review'])),
      one(db('partners').where('status', 'approved')),
      one(db('tickets').whereIn('status', ['new', 'open', 'awaiting_admin', 'awaiting_customer', 'in_progress'])),
    ]);
    const recent = await db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_id').whereNot('a.action', 'like', 'auth.%').orderBy('a.id', 'desc').limit(8).select('a.action', 'a.subject_type', 'a.subject_id', 'a.created_at', 'u.name as actor');
    res.json({ products, published, comingSoon, customers, pendingDemos, pendingPartners, approvedPartners, openEnquiries, recent });
  }),
);

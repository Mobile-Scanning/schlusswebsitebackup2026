import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, badRequest, HttpError, like, notFound, pageQuery, parse } from '../http';
import { can, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { reference } from '../services/crypto';
import { DEMO_STATUS_LABEL, DemoStatus, demoStatusSql } from '../services/demos';
import { queueEmail } from '../services/jobs';
import { getSetting, inbox, inboxFor, mailAccounts, notifyStaff, scannerInfo, setSetting, setWaSecrets, waSecretStatus } from '../services/platform';
import { digits, handleWebhook, sendWa, testConnection, validSignature, waConfig } from '../services/whatsapp';

/**
 * Admin: potential leads, sales enquiries, businesses, customer accounts, email & WhatsApp settings,
 * reports, system status – plus the public WhatsApp webhook. Permissions are enforced here, server-side.
 */
export const adminOpsRouter = Router();
export const whatsappWebhookRouter = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const num = (v: unknown) => Number(v ?? 0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
const rows = async (q: PromiseLike<unknown>) => (await q) as Row[];

/* ======================================================================================
 * Potential leads (support department)
 * ====================================================================================== */
const LEAD_STATUSES = ['new', 'contact_required', 'contacted', 'interested', 'not_interested', 'assistance_required', 'converted', 'closed'] as const;

adminOpsRouter.get(
  '/leads',
  requirePermission('leads.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ status: z.enum(LEAD_STATUSES).optional(), open: z.enum(['1']).optional(), source: z.enum(['demo_expiry', 'chat', 'contact', 'manual']).optional(), productId: z.coerce.number().int().optional(), assignedTo: z.coerce.number().int().optional(), q: z.string().trim().max(100).optional(), from: dateStr.optional(), to: dateStr.optional() }), req.query);
    const base = db('leads as ld').leftJoin('customers as c', 'c.id', 'ld.customer_id').leftJoin('products as p', 'p.id', 'ld.product_id').leftJoin('users as u', 'u.id', 'ld.assigned_to');
    if (q.status) base.where('ld.status', q.status);
    if (q.open) base.whereNotIn('ld.status', ['converted', 'closed', 'not_interested']);
    if (q.source) base.where('ld.source', q.source);
    if (q.productId) base.where('ld.product_id', q.productId);
    if (q.assignedTo) base.where('ld.assigned_to', q.assignedTo);
    if (q.from) base.where('ld.created_at', '>=', q.from);
    if (q.to) base.where('ld.created_at', '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [q.to]));
    if (q.q) base.where((b) => b.where('c.full_name', 'like', like(q.q!)).orWhere('c.company', 'like', like(q.q!)).orWhere('c.email', 'like', like(q.q!)).orWhere('ld.reference', 'like', like(q.q!)));
    const counts = Object.fromEntries((await rows(db('leads').select('status').count({ n: '*' }).groupBy('status'))).map((r) => [r.status, num(r.n)]));
    const [{ total }] = await base.clone().count({ total: 'ld.id' });
    const data = await base.clone().orderByRaw("FIELD(ld.status, 'contact_required', 'new', 'assistance_required', 'interested', 'contacted') DESC").orderBy('ld.demo_expires_at').orderBy('ld.id', 'desc').limit(q.perPage).offset((q.page - 1) * q.perPage)
      .select('ld.id', 'ld.reference', 'ld.source', 'ld.status', 'ld.demo_expires_at', 'ld.days_remaining', 'ld.contact_attempts', 'ld.last_contact_at', 'ld.created_at', 'c.id as customer_id', 'c.full_name', 'c.company', 'c.email', 'c.cellphone', 'p.name as product', 'u.name as assignee');
    res.json({ data, counts, meta: { page: q.page, perPage: q.perPage, total: num(total) } });
  }),
);

async function leadDetail(id: number) {
  const st = demoStatusSql((await getSetting('demos.notifications')).soonDays);
  const l = await db('leads as ld').leftJoin('customers as c', 'c.id', 'ld.customer_id').leftJoin('products as p', 'p.id', 'ld.product_id').leftJoin('users as u', 'u.id', 'ld.assigned_to').leftJoin('businesses as b', 'b.id', 'c.business_id').where('ld.id', id)
    .first('ld.*', 'c.full_name', 'c.company', 'c.email', 'c.cellphone', 'c.country', 'c.province', 'c.user_id', 'b.name as business', 'p.name as product', 'p.slug as product_slug', 'u.name as assignee');
  if (!l) throw notFound('Lead not found.');
  const [activities, demo, convs, sales, waConsent] = await Promise.all([
    db('lead_activities as a').leftJoin('users as u', 'u.id', 'a.actor_id').where('a.lead_id', id).orderBy('a.id', 'desc').select('a.id', 'a.kind', 'a.outcome', 'a.body', 'a.created_at', 'u.name as actor'),
    l.licence_id ? db('licences as l').where('l.id', l.licence_id).first('l.id', 'l.licence_key', 'l.expires_at', 'l.activated_at', 'l.first_downloaded_at', db.raw(`${st} as status`)) : null,
    l.customer_id ? db('tickets').where('customer_id', l.customer_id).orderBy('last_message_at', 'desc').limit(10).select('id', 'reference', 'subject', 'status', 'department', 'last_message_at') : [],
    db('quote_requests').where('lead_id', id).select('id', 'reference', 'status', 'created_at'),
    l.email ? db('consents').where({ email: l.email, purpose: 'whatsapp', granted: true }).first('id') : null,
  ]);
  delete l.user_id;
  return { ...l, activities, demo: demo ? { ...demo, statusLabel: DEMO_STATUS_LABEL[demo.status as DemoStatus] } : null, conversations: convs, sales, whatsappConsent: !!waConsent };
}

adminOpsRouter.get('/leads/:id', requirePermission('leads.view'), ah(async (req, res) => res.json(await leadDetail(Number(req.params['id']) || 0))));

adminOpsRouter.post(
  '/leads',
  requirePermission('leads.manage'),
  ah(async (req, res) => {
    const input = parse(z.object({ customerId: z.number().int(), productId: z.number().int().nullable().optional(), note: optStr(2000) }), req.body);
    if (!(await db('customers').where({ id: input.customerId }).first('id'))) throw badRequest('Customer not found.');
    const [id] = await db('leads').insert({ reference: reference('LD'), source: 'manual', customer_id: input.customerId, product_id: input.productId ?? null, status: 'new', assigned_to: req.auth!.user.id });
    if (input.note) await db('lead_activities').insert({ lead_id: id, kind: 'note', body: input.note, actor_id: req.auth!.user.id });
    await audit(req, { action: 'lead.created', subjectType: 'lead', subjectId: id });
    res.status(201).json(await leadDetail(id));
  }),
);

adminOpsRouter.patch(
  '/leads/:id',
  requirePermission('leads.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ status: z.enum(LEAD_STATUSES).optional(), assignedTo: z.number().int().nullable().optional() }), req.body);
    const l = await db('leads').where({ id }).first();
    if (!l) throw notFound('Lead not found.');
    const row: Record<string, unknown> = { updated_at: new Date() };
    if (input.status) row['status'] = input.status;
    if (input.assignedTo !== undefined) row['assigned_to'] = input.assignedTo;
    await db('leads').where({ id }).update(row);
    if (input.status && input.status !== l.status) await db('lead_activities').insert({ lead_id: id, kind: 'status', outcome: input.status, body: `Status: ${l.status} → ${input.status}`, actor_id: req.auth!.user.id });
    await audit(req, { action: 'lead.updated', subjectType: 'lead', subjectId: id, before: { status: l.status, assigned_to: l.assigned_to }, after: input });
    res.json(await leadDetail(id));
  }),
);

/** Record a contact attempt, note or customer feedback. Contact attempts move "new" leads to "contacted". */
adminOpsRouter.post(
  '/leads/:id/activities',
  requirePermission('leads.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ kind: z.enum(['note', 'call', 'email', 'whatsapp', 'feedback']), outcome: optStr(120), body: z.string().trim().min(1, 'Write a short note').max(5000) }), req.body);
    const l = await db('leads').where({ id }).first();
    if (!l) throw notFound('Lead not found.');
    const contact = ['call', 'email', 'whatsapp'].includes(input.kind);
    await db.transaction(async (trx) => {
      await trx('lead_activities').insert({ lead_id: id, kind: input.kind, outcome: input.outcome ?? null, body: input.body, actor_id: req.auth!.user.id });
      if (contact) await trx('leads').where({ id }).update({ contact_attempts: trx.raw('contact_attempts + 1'), last_contact_at: new Date(), assigned_to: l.assigned_to ?? req.auth!.user.id, ...(['new', 'contact_required'].includes(l.status) ? { status: 'contacted' } : {}), updated_at: new Date() });
    });
    await audit(req, { action: 'lead.activity', subjectType: 'lead', subjectId: id, meta: { kind: input.kind, outcome: input.outcome } });
    res.status(201).json(await leadDetail(id));
  }),
);

/** The customer explicitly wants to buy → a separate sales enquiry, sent to sales@. */
adminOpsRouter.post(
  '/leads/:id/sales-enquiry',
  requirePermission('leads.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ quantity: z.number().int().min(1).max(100000).default(1), message: z.string().trim().min(3, 'Describe what the customer wants').max(5000), confirmed: z.literal(true, { message: 'Confirm the customer asked to purchase' }) }), req.body);
    const l = await db('leads as ld').leftJoin('customers as c', 'c.id', 'ld.customer_id').leftJoin('products as p', 'p.id', 'ld.product_id').where('ld.id', id).first('ld.*', 'c.full_name', 'c.email', 'c.cellphone', 'c.company', 'c.business_id', 'p.name as product');
    if (!l) throw notFound('Lead not found.');
    const ref = reference('SQ');
    const qid = await db.transaction(async (trx) => {
      const [qid] = await trx('quote_requests').insert({ reference: ref, customer_id: l.customer_id, product_id: l.product_id, kind: 'purchase', quantity: input.quantity, message: input.message, status: 'new', name: l.full_name, email: l.email, cellphone: l.cellphone, company: l.company, business_id: l.business_id, source: 'lead', lead_id: id, licence_id: l.licence_id });
      await trx('leads').where({ id }).update({ status: 'interested', updated_at: new Date() });
      await trx('lead_activities').insert({ lead_id: id, kind: 'status', outcome: 'interested', body: `Customer wants to purchase – sales enquiry ${ref} sent to sales.`, actor_id: req.auth!.user.id });
      await notifyStaff(['sales.view'], { type: 'sales.new', title: `Purchase enquiry from lead ${l.reference}: ${l.full_name}`, body: input.message.slice(0, 140), link: `/admin/sales?open=${qid}` }, trx);
      await queueEmail(await inboxFor('purchase'), 'sales_enquiry', { kind: 'Purchase (from support lead)', name: l.full_name, company: l.company ? ` (${l.company})` : '', email: l.email, phone: l.cellphone ?? '—', product: l.product ?? '—', quantity: input.quantity, message: input.message, reference: ref, source: 'Support lead', link: `${config.appUrl}/admin/sales?open=${qid}` }, trx);
      return qid;
    });
    await audit(req, { action: 'lead.sales_enquiry', subjectType: 'lead', subjectId: id, meta: { quoteRequestId: qid } });
    res.status(201).json(await leadDetail(id));
  }),
);

/* ======================================================================================
 * Sales enquiries (sales department only)
 * ====================================================================================== */
const SALES_STATUSES = ['new', 'contacted', 'quoted', 'processing', 'won', 'lost', 'cancelled'] as const;

adminOpsRouter.get(
  '/sales',
  requirePermission('sales.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ status: z.string().max(20).optional(), kind: z.enum(['purchase', 'quotation']).optional(), productId: z.coerce.number().int().optional(), source: z.string().max(20).optional(), q: z.string().trim().max(100).optional(), from: dateStr.optional(), to: dateStr.optional() }), req.query);
    const base = db('quote_requests as s').leftJoin('products as p', 'p.id', 's.product_id').leftJoin('customers as c', 'c.id', 's.customer_id').leftJoin('users as u', 'u.id', 's.assigned_to').whereIn('s.kind', ['purchase', 'quotation']);
    if (q.status === 'open') base.whereIn('s.status', ['new', 'contacted', 'quoted', 'processing']);
    else if (q.status === 'completed') base.whereIn('s.status', ['won', 'fulfilled', 'paid']);
    else if (q.status) base.where('s.status', q.status);
    if (q.kind) base.where('s.kind', q.kind);
    if (q.productId) base.where('s.product_id', q.productId);
    if (q.source) base.where('s.source', q.source);
    if (q.from) base.where('s.created_at', '>=', q.from);
    if (q.to) base.where('s.created_at', '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [q.to]));
    if (q.q) base.where((b) => b.where('s.name', 'like', like(q.q!)).orWhere('s.company', 'like', like(q.q!)).orWhere('s.email', 'like', like(q.q!)).orWhere('s.reference', 'like', like(q.q!)).orWhere('c.full_name', 'like', like(q.q!)));
    const counts = Object.fromEntries((await rows(db('quote_requests').whereIn('kind', ['purchase', 'quotation']).select('status', 'kind').count({ n: '*' }).groupBy('status', 'kind'))).reduce((m: [string, number][], r) => { m.push([r.status, num(r.n) + (m.find((x) => x[0] === r.status)?.[1] ?? 0)]); return m; }, []));
    counts['quotation'] = num((await db('quote_requests').where('kind', 'quotation').whereNotIn('status', ['won', 'lost', 'cancelled', 'fulfilled']).count({ n: '*' }).first())?.n);
    const [{ total }] = await base.clone().count({ total: 's.id' });
    const data = await base.clone().orderByRaw("s.status = 'new' DESC").orderBy('s.id', 'desc').limit(q.perPage).offset((q.page - 1) * q.perPage)
      .select('s.id', 's.reference', 's.kind', 's.status', 's.source', 's.quantity', 's.message', 's.created_at', 's.ticket_id', db.raw('COALESCE(s.name, c.full_name) as name'), db.raw('COALESCE(s.email, c.email) as email'), db.raw('COALESCE(s.cellphone, c.cellphone) as cellphone'), db.raw('COALESCE(s.company, c.company) as company'), 'p.name as product', 'u.name as assignee');
    res.json({ data, counts, meta: { page: q.page, perPage: q.perPage, total: num(total) } });
  }),
);

adminOpsRouter.get(
  '/sales/:id',
  requirePermission('sales.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const s = await db('quote_requests as s').leftJoin('products as p', 'p.id', 's.product_id').leftJoin('customers as c', 'c.id', 's.customer_id').leftJoin('users as u', 'u.id', 's.assigned_to').leftJoin('businesses as b', 'b.id', db.raw('COALESCE(s.business_id, c.business_id)')).where('s.id', id)
      .first('s.*', 'p.name as product', 'c.full_name as customer_name', 'c.email as customer_email', 'c.cellphone as customer_phone', 'b.name as business', 'u.name as assignee');
    if (!s) throw notFound('Sales enquiry not found.');
    const messages = s.ticket_id ? await db('ticket_messages as m').leftJoin('users as u', 'u.id', 'm.author_id').where('m.ticket_id', s.ticket_id).orderBy('m.id').select('m.id', 'm.body', 'm.author_kind', 'm.is_internal', 'm.created_at', 'u.name as author') : [];
    const ticket = s.ticket_id ? await db('tickets').where({ id: s.ticket_id }).first('id', 'reference', 'status') : null;
    res.json({ ...s, messages: messages.map((m) => ({ ...m, is_internal: !!m.is_internal })), ticket });
  }),
);

adminOpsRouter.patch(
  '/sales/:id',
  requirePermission('sales.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ status: z.enum(SALES_STATUSES).optional(), assignedTo: z.number().int().nullable().optional(), quantity: z.number().int().min(1).max(100000).optional(), note: optStr(2000) }), req.body);
    const s = await db('quote_requests').where({ id }).first();
    if (!s) throw notFound('Sales enquiry not found.');
    const row: Record<string, unknown> = { updated_at: new Date() };
    if (input.status) {
      row['status'] = input.status;
      row['closed_at'] = ['won', 'lost', 'cancelled'].includes(input.status) ? new Date() : null;
    }
    if (input.assignedTo !== undefined) row['assigned_to'] = input.assignedTo;
    if (input.quantity) row['quantity'] = input.quantity;
    if (input.note) row['staff_notes'] = `${s.staff_notes ? s.staff_notes + '\n' : ''}[${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${req.auth!.user.name}] ${input.note}`;
    await db('quote_requests').where({ id }).update(row);
    if (input.status === 'won' && s.lead_id) await db('leads').where({ id: s.lead_id }).update({ status: 'converted', updated_at: new Date() });
    await audit(req, { action: 'sales.updated', subjectType: 'quote_request', subjectId: id, before: { status: s.status }, after: { ...input, note: input.note ? '[note]' : undefined } });
    res.json({ ok: true });
  }),
);

/* ======================================================================================
 * Businesses
 * ====================================================================================== */
adminOpsRouter.get(
  '/businesses',
  requirePermission('customers.view'),
  ah(async (req, res) => {
    const q = parse(pageQuery.extend({ q: z.string().trim().max(100).optional() }), req.query);
    const base = db('businesses as b');
    if (q.q) base.where((w) => w.where('b.name', 'like', like(q.q!)).orWhere('b.registration_number', 'like', like(q.q!)).orWhere('b.email', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: 'b.id' });
    const data = await base.clone().orderBy('b.name').limit(q.perPage).offset((q.page - 1) * q.perPage).select('b.*',
      db.raw('(SELECT COUNT(*) FROM customers c WHERE c.business_id = b.id) as customers'),
      db.raw("(SELECT COUNT(*) FROM licences l JOIN customers c ON c.id = l.customer_id WHERE c.business_id = b.id AND l.type = 'trial') as demos"),
      db.raw("(SELECT COUNT(*) FROM licences l JOIN customers c ON c.id = l.customer_id WHERE c.business_id = b.id AND l.type <> 'trial') as packages"));
    res.json({ data: data.map((b) => ({ ...b, customers: num(b.customers), demos: num(b.demos), packages: num(b.packages) })), meta: { page: q.page, perPage: q.perPage, total: num(total) } });
  }),
);

const businessSchema = z.object({ name: z.string().trim().min(2, 'Enter the business name').max(191), registrationNumber: optStr(64), vatNumber: optStr(32), businessType: optStr(100), email: z.string().trim().toLowerCase().email().max(191).nullable().optional().or(z.literal('')), phone: optStr(32), website: optStr(255), country: z.string().regex(/^[A-Z]{2}$/).default('ZA'), province: optStr(80), notes: optStr(5000) });
const bizRow = (b: z.infer<typeof businessSchema>) => ({ name: b.name, registration_number: b.registrationNumber ?? null, vat_number: b.vatNumber ?? null, business_type: b.businessType ?? null, email: b.email || null, phone: b.phone ?? null, website: b.website ?? null, country: b.country, province: b.province ?? null, notes: b.notes ?? null });

adminOpsRouter.get(
  '/businesses/:id',
  requirePermission('customers.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const b = await db('businesses').where({ id }).first();
    if (!b) throw notFound('Business not found.');
    const st = demoStatusSql((await getSetting('demos.notifications')).soonDays);
    const [customers, demos, packages, sales] = await Promise.all([
      db('customers as c').leftJoin('users as u', 'u.id', 'c.user_id').where('c.business_id', id).select('c.id', 'c.full_name', 'c.email', 'c.cellphone', 'c.created_at', 'u.email_verified_at', 'u.status as login_status'),
      db('licences as l').join('customers as c', 'c.id', 'l.customer_id').join('products as p', 'p.id', 'l.product_id').where({ 'c.business_id': id, 'l.type': 'trial' }).select('l.id', 'p.name as product', 'c.full_name', 'l.expires_at', db.raw(`${st} as status`)),
      db('licences as l').join('customers as c', 'c.id', 'l.customer_id').join('products as p', 'p.id', 'l.product_id').where('c.business_id', id).whereNot('l.type', 'trial').select('l.id', 'p.name as product', 'l.type', 'l.status', 'l.expires_at'),
      db('quote_requests as s').leftJoin('products as p', 'p.id', 's.product_id').leftJoin('customers as c', 'c.id', 's.customer_id').where((w) => w.where('s.business_id', id).orWhere('c.business_id', id)).select('s.id', 's.reference', 's.status', 'p.name as product', 's.created_at'),
    ]);
    res.json({ ...b, customers, demos: demos.map((d) => ({ ...d, statusLabel: DEMO_STATUS_LABEL[d.status as DemoStatus] })), packages, sales });
  }),
);
adminOpsRouter.post('/businesses', requirePermission('businesses.manage', 'customers.manage'), ah(async (req, res) => {
  const b = parse(businessSchema, req.body);
  const [id] = await db('businesses').insert(bizRow(b));
  await audit(req, { action: 'business.created', subjectType: 'business', subjectId: id, after: { name: b.name } });
  res.status(201).json({ id });
}));
adminOpsRouter.put('/businesses/:id', requirePermission('businesses.manage', 'customers.manage'), ah(async (req, res) => {
  const id = Number(req.params['id']) || 0;
  const b = parse(businessSchema, req.body);
  const before = await db('businesses').where({ id }).first();
  if (!before) throw notFound('Business not found.');
  await db('businesses').where({ id }).update({ ...bizRow(b), updated_at: new Date() });
  await db('customers').where({ business_id: id }).update({ company: b.name }); // keep the display name in sync
  await audit(req, { action: 'business.updated', subjectType: 'business', subjectId: id, before: { name: before.name }, after: { name: b.name } });
  res.json({ ok: true });
}));
adminOpsRouter.post('/businesses/:id/customers', requirePermission('businesses.manage', 'customers.manage'), ah(async (req, res) => {
  const id = Number(req.params['id']) || 0;
  const { customerId, link } = parse(z.object({ customerId: z.number().int(), link: z.boolean().default(true) }), req.body);
  const b = await db('businesses').where({ id }).first('id', 'name');
  if (!b) throw notFound('Business not found.');
  await db('customers').where({ id: customerId }).update(link ? { business_id: id, company: b.name } : { business_id: null });
  await audit(req, { action: link ? 'business.customer_linked' : 'business.customer_unlinked', subjectType: 'business', subjectId: id, meta: { customerId } });
  res.json({ ok: true });
}));

/* ======================================================================================
 * Customer accounts: verification status, resend code, suspend / reactivate
 * ====================================================================================== */
adminOpsRouter.post(
  '/customers/:id/account',
  requirePermission('customers.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const { action } = parse(z.object({ action: z.enum(['suspend', 'reactivate', 'resend_otp']) }), req.body);
    const c = await db('customers as c').join('users as u', 'u.id', 'c.user_id').where('c.id', id).first('u.id as user_id', 'u.name', 'u.email', 'u.status', 'u.email_verified_at');
    if (!c) throw notFound('This customer has no login account.');
    if (action === 'resend_otp') {
      if (c.email_verified_at) throw badRequest('This email address is already verified.');
      const { randomInt } = await import('node:crypto');
      const { hmac, ipHash } = await import('../services/crypto');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await db.transaction(async (trx) => {
        await trx('email_otps').where({ user_id: c.user_id }).whereNull('used_at').whereNull('invalidated_at').update({ invalidated_at: new Date() });
        await trx('email_otps').insert({ user_id: c.user_id, purpose: 'verify_email', code_hash: hmac(`otp:${c.user_id}:${code}`), expires_at: new Date(Date.now() + 5 * 60_000), ip_hash: ipHash(req.ip) });
        await queueEmail(c.email, 'email_otp', { name: c.name, code, minutes: 5 }, trx);
      });
    } else {
      await db('users').where({ id: c.user_id }).update({ status: action === 'suspend' ? 'disabled' : 'active', updated_at: new Date() });
      if (action === 'suspend') await db('sessions').where({ user_id: c.user_id }).del();
    }
    await audit(req, { action: `customer.${action}`, subjectType: 'customer', subjectId: id });
    res.json({ ok: true });
  }),
);

/**
 * Delete a customer account. Only possible when nothing depends on it – customers with demos, packages
 * (licences), downloads, service records, sales enquiries, leads or support conversations are never deleted
 * (their history must be kept): suspend those instead. Consent records are kept as legal evidence.
 */
async function customerUsage(id: number) {
  const n = async (table: string) => num((await db(table).where({ customer_id: id }).count({ n: '*' }).first())?.n);
  const [licences, downloads, services, sales, leads, conversations] = await Promise.all([n('licences'), n('downloads'), n('service_records'), n('quote_requests'), n('leads'), n('tickets')]);
  return { licences, downloads, services, sales, leads, conversations, total: licences + downloads + services + sales + leads + conversations };
}
const usageText = (u: Awaited<ReturnType<typeof customerUsage>>) =>
  [[u.licences, 'demo or package licence'], [u.downloads, 'download'], [u.services, 'service record'], [u.sales, 'sales enquiry'], [u.leads, 'lead'], [u.conversations, 'support conversation']]
    .filter(([c]) => Number(c) > 0)
    .map(([c, label]) => `${c} ${label}${Number(c) === 1 ? '' : String(label).endsWith('y') ? '' : 's'}`.replace(/enquiry$/, Number(c) === 1 ? 'enquiry' : 'enquiries'))
    .join(', ');

adminOpsRouter.get('/customers/:id/delete-check', requirePermission('customers.manage'), ah(async (req, res) => {
  const id = Number(req.params['id']) || 0;
  if (!(await db('customers').where({ id }).first('id'))) throw notFound('Customer not found.');
  const usage = await customerUsage(id);
  res.json({ canDelete: usage.total === 0, usage, reason: usage.total ? usageText(usage) : null });
}));

adminOpsRouter.delete('/customers/:id', requirePermission('customers.manage'), ah(async (req, res) => {
  const id = Number(req.params['id']) || 0;
  const c = await db('customers').where({ id }).first('id', 'user_id', 'full_name', 'email');
  if (!c) throw notFound('Customer not found.');
  const usage = await customerUsage(id);
  if (usage.total) throw new HttpError(409, `This customer can’t be deleted because their history must be kept (${usageText(usage)}). Suspend the account instead – they will not be able to sign in.`, 'customer_in_use', { usage });
  if (c.user_id) {
    const u = await db('users').where({ id: c.user_id }).first('type');
    if (u && u.type !== 'customer') throw badRequest('This login is not a customer account.');
  }
  await db.transaction(async (trx) => {
    await trx('customers').where({ id }).del(); // interests / setup progress go with it
    if (c.user_id) await trx('users').where({ id: c.user_id, type: 'customer' }).del(); // sessions, codes, reset links go with it
    await audit(req, { action: 'customer.deleted', subjectType: 'customer', subjectId: id, before: { name: c.full_name, email: c.email } }, trx);
  });
  res.json({ ok: true });
}));

/* ======================================================================================
 * Email settings
 * ====================================================================================== */
adminOpsRouter.get(
  '/email-settings',
  requirePermission('email_settings.manage', 'settings.manage'),
  ah(async (_req, res) => {
    // Failed, plus emails that hit a problem and are still being retried – so a problem is visible straight away.
    const failed = await db('email_logs').where((w) => w.where('status', 'failed').orWhere((x) => x.where('status', 'queued').whereNotNull('error'))).orderBy('id', 'desc').limit(20).select('id', 'to_email', 'template_key', 'subject', 'error', 'status', 'created_at');
    const counts = Object.fromEntries((await rows(db('email_logs').where('created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)')).select('status').count({ n: '*' }).groupBy('status'))).map((r) => [r.status, num(r.n)]));
    res.json({
      departments: await getSetting('email.departments'),
      smtp: { configured: !!process.env['MAIL_HOST'], host: process.env['MAIL_HOST'] || null, port: Number(process.env['MAIL_PORT'] || 587), from: process.env['MAIL_FROM'] || 'SCHLUSS <no-reply@schluss.co.za>', user: process.env['MAIL_USER'] ? 'set' : null },
      accounts: mailAccounts(),
      // The queue and what the built-in sender last did, plus the latest emails of every status.
      queue: {
        waiting: num((await db('jobs').where({ type: 'email', status: 'pending' }).count({ n: '*' }).first())?.n),
        sending: num((await db('jobs').where({ type: 'email', status: 'running' }).count({ n: '*' }).first())?.n),
        sender: (await import('../index')).senderState,
      },
      recent: await db('email_logs').orderBy('id', 'desc').limit(15).select('id', 'to_email', 'template_key', 'status', 'error', 'created_at', 'sent_at'),
      last7days: counts,
      failed,
    });
  }),
);
adminOpsRouter.put(
  '/email-settings',
  requirePermission('email_settings.manage', 'settings.manage'),
  ah(async (req, res) => {
    const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(191);
    const dept = z.enum(['support', 'sales']);
    const input = parse(z.object({ support: email, sales: email, customerAck: z.boolean(), partnerInbox: dept.default('sales'), purchaseInbox: dept.default('support') }), req.body);
    const before = await getSetting('email.departments');
    await setSetting('email.departments', input, req.auth!.user.id);
    await audit(req, { action: 'settings.email_departments', before, after: input });
    res.json(input);
  }),
);
/**
 * Live check of the mail server: reach it, log in to each mailbox and (optionally) send one test email now.
 * Runs the same script as `npm run mail:check`; answers with the reason in plain words. Never returns passwords.
 */
adminOpsRouter.post(
  '/email-settings/check',
  requirePermission('email_settings.manage', 'settings.manage'),
  ah(async (req, res) => {
    const { sendTo } = parse(z.object({ sendTo: z.string().trim().toLowerCase().email('Enter a valid email address').max(191).optional().or(z.literal('')) }), req.body);
    const { execFile } = await import('node:child_process');
    const { join } = await import('node:path');
    const script = join(process.cwd(), 'server/cli/mail-check.cjs');
    const out = await new Promise<string>((resolve) => execFile(process.execPath, [script, '--json', ...(sendTo ? [sendTo] : [])], { cwd: process.cwd(), timeout: 90_000 }, (_e, stdout) => resolve(String(stdout || ''))));
    let result: unknown;
    try {
      result = JSON.parse(out.trim().split('\n').pop() || '');
    } catch {
      result = { ok: false, steps: [{ name: 'Mail check', ok: false, text: 'The mail check did not finish. Run “npm run mail:check” in the project folder to see why.' }], mailboxes: [], sent: null };
    }
    await audit(req, { action: 'settings.email_check', meta: { sendTo: sendTo ? 'yes' : 'no' } });
    res.json(result);
  }),
);
/** Send everything that is waiting right now and report what the sender did (including a crash). */
adminOpsRouter.post(
  '/email-settings/send-now',
  requirePermission('email_settings.manage', 'settings.manage'),
  ah(async (req, res) => {
    const { runEmailSender } = await import('../index');
    const state = await runEmailSender(true);
    await audit(req, { action: 'settings.email_send_now' });
    res.json({ sender: state, waiting: num((await db('jobs').where({ type: 'email', status: 'pending' }).count({ n: '*' }).first())?.n) });
  }),
);
adminOpsRouter.post(
  '/email-settings/test',
  requirePermission('email_settings.manage', 'settings.manage'),
  ah(async (req, res) => {
    const { department } = parse(z.object({ department: z.enum(['support', 'sales']) }), req.body);
    const to = await inbox(department);
    // Sent from that department's own mailbox, so each login is tested.
    const job = await queueEmail(to, 'email_test', { department: `${department} (${to})` }, db, department);
    const log = await db('email_logs').where({ job_id: job }).first('id', 'status');
    await audit(req, { action: 'settings.email_test', meta: { department } });
    res.json({ queued: true, to, logId: log?.id, message: process.env['MAIL_HOST'] ? 'Test email queued – it is sent by the background worker within a minute.' : 'Queued, but MAIL_HOST is not set in .env, so the worker will mark it failed ("mail not configured").' });
  }),
);
adminOpsRouter.get(
  '/email-logs/:id',
  requirePermission('email_settings.manage', 'settings.manage'),
  ah(async (req, res) => {
    const l = await db('email_logs').where({ id: Number(req.params['id']) || 0 }).first('id', 'to_email', 'template_key', 'status', 'error', 'sent_at', 'created_at');
    if (!l) throw notFound();
    res.json(l);
  }),
);

/* ======================================================================================
 * WhatsApp settings + webhook
 * ====================================================================================== */
adminOpsRouter.get(
  '/whatsapp',
  requirePermission('whatsapp.manage', 'support.view'),
  ah(async (req, res) => {
    const s = await getSetting('whatsapp.settings');
    const recent = await db('whatsapp_messages as w').leftJoin('tickets as t', 't.id', 'w.ticket_id').orderBy('w.id', 'desc').limit(30).select('w.id', 'w.direction', 'w.peer_phone', 'w.status', 'w.kind', 'w.error', 'w.created_at', 't.reference');
    const events = can(req, 'whatsapp.manage') ? await db('whatsapp_events').orderBy('id', 'desc').limit(10).select('id', 'kind', 'signature_valid', 'error', 'processed_at', 'created_at') : [];
    res.json({ settings: s, secrets: await waSecretStatus(), webhookUrl: `${config.appUrl}/api/whatsapp/webhook`, recent, events, canManage: can(req, 'whatsapp.manage') });
  }),
);
adminOpsRouter.put(
  '/whatsapp',
  requirePermission('whatsapp.manage'),
  ah(async (req, res) => {
    const input = parse(
      z.object({
        enabled: z.boolean(),
        phoneNumberId: z.string().trim().regex(/^\d{0,30}$/, 'Digits only (from Meta › WhatsApp › API setup)'),
        businessAccountId: z.string().trim().regex(/^\d{0,30}$/, 'Digits only'),
        displayNumber: z.string().trim().max(32),
        apiVersion: z.string().trim().regex(/^v\d{2}\.\d$/, 'e.g. v21.0').default('v21.0'),
        agents: z.array(z.object({ number: z.string().trim().min(8).max(32), name: z.string().trim().min(1).max(80), userId: z.number().int().nullable().optional() })).max(20),
        templateName: z.string().trim().regex(/^[a-z0-9_]{0,512}$/, 'Template names use lowercase letters, numbers and _').default(''),
        templateLanguage: z.string().trim().max(10).default('en'),
        accessToken: z.string().trim().max(1000).optional(),
        appSecret: z.string().trim().max(200).optional(),
        verifyToken: z.string().trim().max(200).optional(),
      }),
      req.body,
    );
    const { accessToken, appSecret, verifyToken, ...settings } = input;
    if (settings.enabled && !settings.phoneNumberId) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields: { phoneNumberId: 'Required to switch WhatsApp on' } });
    settings.agents = settings.agents.map((a) => ({ ...a, number: digits(a.number) }));
    await setSetting('whatsapp.settings', settings, req.auth!.user.id);
    await setWaSecrets({ accessToken, appSecret, verifyToken });
    await audit(req, { action: 'settings.whatsapp', after: { ...settings, secretsChanged: [accessToken && 'accessToken', appSecret && 'appSecret', verifyToken && 'verifyToken'].filter(Boolean) } });
    res.json({ settings, secrets: await waSecretStatus() });
  }),
);
adminOpsRouter.post('/whatsapp/test', requirePermission('whatsapp.manage'), ah(async (req, res) => {
  const r = await testConnection();
  await audit(req, { action: 'settings.whatsapp_test', meta: { ok: r.ok } });
  res.json(r);
}));
adminOpsRouter.post('/whatsapp/test-message', requirePermission('whatsapp.manage'), ah(async (req, res) => {
  const { to } = parse(z.object({ to: z.string().trim().min(8).max(32) }), req.body);
  const r = await sendWa({ to, text: 'SCHLUSS test message – your WhatsApp integration can send messages.', ticketId: null, templateParams: ['TEST', 'SCHLUSS', 'Test message'] });
  const row = await db('whatsapp_messages').where({ id: r.id }).first('status', 'error');
  res.json({ ok: r.ok, status: row?.status, error: row?.error ?? null, note: r.ok ? 'Accepted by WhatsApp. Delivery is confirmed separately by the status webhook.' : undefined });
}));

/** Meta webhook verification (GET) – echoes the challenge only when the verify token matches. */
whatsappWebhookRouter.get(
  '/webhook',
  ah(async (req, res) => {
    const { getWaSecret } = await import('../services/platform');
    const token = await getWaSecret('verifyToken');
    const ok = req.query['hub.mode'] === 'subscribe' && !!token && req.query['hub.verify_token'] === token;
    await db('whatsapp_events').insert({ kind: 'verify', payload: JSON.stringify({ mode: req.query['hub.mode'] }), signature_valid: ok, processed_at: new Date(), error: ok ? null : 'verify token mismatch' });
    if (!ok) {
      res.status(403).send('Forbidden');
      return;
    }
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }),
);

/** Incoming messages and delivery statuses (POST). Signature-checked; always answers 200 quickly once stored. */
whatsappWebhookRouter.post(
  '/webhook',
  ah(async (req, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    const valid = await validSignature(raw, req.get('x-hub-signature-256'));
    const kind = req.body?.entry?.[0]?.changes?.[0]?.value?.messages ? 'message' : req.body?.entry?.[0]?.changes?.[0]?.value?.statuses ? 'status' : 'unknown';
    if (!valid) {
      // Not from Meta (or the app secret is wrong). Nothing the sender wrote is stored – an attacker could
      // otherwise fill the database – only the fact that it happened, at most once a minute per address.
      const { securityEvent } = await import('../services/security');
      securityEvent(req, 'security.webhook_rejected', { path: '/api/whatsapp/webhook' }, { throttleMs: 60_000 });
      res.status(401).json({ error: 'invalid signature' });
      return;
    }
    const [eventId] = await db('whatsapp_events').insert({ kind, payload: JSON.stringify(req.body ?? {}), signature_valid: valid });
    try {
      await handleWebhook(req.body);
      await db('whatsapp_events').where({ id: eventId }).update({ processed_at: new Date() });
    } catch (e) {
      await db('whatsapp_events').where({ id: eventId }).update({ error: String((e as Error).message).slice(0, 2000) });
      res.status(500).json({ error: 'processing failed' }); // Meta retries later
      return;
    }
    res.json({ ok: true });
  }),
);

/* ======================================================================================
 * Reports + CSV export
 * ====================================================================================== */
adminOpsRouter.get(
  '/reports',
  requirePermission('reports.view'),
  ah(async (req, res) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
    const from = q.from ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const range = (b: Knex.QueryBuilder, col = 'created_at') => b.where(col, '>=', from).where(col, '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [to]));
    const n = async (b: Knex.QueryBuilder) => num((await b.count({ n: '*' }).first())?.n);
    const group = async (table: string, col: string, extra?: (b: Knex.QueryBuilder) => void) => {
      const b = range(db(table)).select(col).count({ n: '*' }).groupBy(col);
      extra?.(b);
      return Object.fromEntries((await rows(b)).map((r) => [r[col], num(r.n)]));
    };
    res.json({
      from, to,
      registrations: await n(range(db('users').where('type', 'customer'))),
      verified: await n(range(db('users').where('type', 'customer'), 'email_verified_at')),
      demosStarted: await n(range(db('licences').where('type', 'trial'))),
      demoDownloads: await n(range(db('downloads as d').join('product_versions as v', 'v.id', 'd.version_id').where('v.channel', 'demo'), 'd.created_at')),
      fullDownloads: await n(range(db('downloads as d').join('product_versions as v', 'v.id', 'd.version_id').where('v.channel', 'release'), 'd.created_at')),
      conversationsBySource: await group('tickets', 'channel'),
      conversationsByDepartment: await group('tickets', 'department'),
      salesByStatus: await group('quote_requests', 'status'),
      leadsByStatus: await group('leads', 'status'),
      conversions: await n(range(db('licences').where('type', 'trial').whereNotNull('converted_at'), 'converted_at')),
    });
  }),
);

const CSV: Record<string, { perm: string; query: () => Knex.QueryBuilder }> = {
  leads: { perm: 'leads.view', query: () => db('leads as ld').leftJoin('customers as c', 'c.id', 'ld.customer_id').leftJoin('products as p', 'p.id', 'ld.product_id').select('ld.reference', 'ld.source', 'ld.status', 'c.full_name as customer', 'c.company', 'c.email', 'c.cellphone', 'p.name as product', 'ld.demo_expires_at', 'ld.contact_attempts', 'ld.created_at') },
  sales: { perm: 'sales.view', query: () => db('quote_requests as s').leftJoin('products as p', 'p.id', 's.product_id').select('s.reference', 's.kind', 's.status', 's.source', 's.name', 's.company', 's.email', 's.cellphone', 'p.name as product', 's.quantity', 's.created_at') },
  conversations: { perm: 'support.view', query: () => db('tickets as t').leftJoin('products as p', 'p.id', 't.product_id').select('t.reference', 't.channel', 't.department', 't.status', 't.priority', 't.name', 't.company', 't.email', 'p.name as product', 't.created_at', 't.last_message_at', 't.resolved_at') },
  customers: { perm: 'customers.view', query: () => db('customers as c').leftJoin('users as u', 'u.id', 'c.user_id').select('c.full_name', 'c.company', 'c.email', 'c.cellphone', 'c.country', 'c.province', 'c.business_type', 'u.email_verified_at', 'u.status', 'c.created_at') },
};
adminOpsRouter.get(
  '/reports/export/:type',
  requirePermission('reports.export'),
  ah(async (req, res) => {
    const def = CSV[String(req.params['type'])];
    if (!def) throw notFound();
    if (!can(req, def.perm)) throw new HttpError(403, 'You do not have permission to export this data.', 'forbidden');
    const data = (await def.query().orderBy(1).limit(50_000)) as Row[];
    const cols = data.length ? Object.keys(data[0]) : [];
    // Formula-injection safe: cells starting with = + - @ are prefixed with an apostrophe.
    const cell = (v: unknown) => { let s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    await audit(req, { action: 'reports.export', meta: { type: req.params['type'], rows: data.length } });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="schluss-${req.params['type']}-${new Date().toISOString().slice(0, 10)}.csv"` });
    res.send('﻿' + [cols.join(','), ...data.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'));
  }),
);

/* ======================================================================================
 * System settings / status
 * ====================================================================================== */
adminOpsRouter.get(
  '/system',
  requirePermission('settings.manage', 'email_settings.manage', 'whatsapp.manage'),
  ah(async (_req, res) => {
    const wa = await waConfig();
    const jobs = Object.fromEntries((await rows(db('jobs').select('status').count({ n: '*' }).groupBy('status'))).map((r) => [r.status, num(r.n)]));
    const oldestPending = await db('jobs').where('status', 'pending').min({ at: 'created_at' }).first();
    res.json({
      environment: config.isProd ? 'production' : 'development',
      appUrl: config.appUrl,
      mail: { configured: !!process.env['MAIL_HOST'], departments: await getSetting('email.departments') },
      worker: { jobs, oldestPending: oldestPending?.at ?? null, note: 'Emails are sent by server/cli/worker.cjs – run it from cron every minute on the live server.' },
      whatsapp: { enabled: wa.enabled, ready: wa.ready, agents: wa.agents.length },
      scanner: await scannerInfo(),
      uploads: { maxMb: Number(process.env['MAX_UPLOAD_MB'] || 1024), storage: process.env['STORAGE_DIR'] || 'storage/ (inside the app folder)' },
      security: { otpMinutes: 5, otpMaxAttempts: 5, otpResendCooldownSeconds: 60, sessionHours: config.session.ttlHours },
      backups: await (async () => {
        const m = await import('../services/maintenance');
        const list = m.listBackups();
        return { automatic: m.backupsEnabled(), folder: m.backupDir(), keepDays: Number(process.env['BACKUP_KEEP_DAYS'] || 14), count: list.length, newest: list[0] ?? null, state: m.backupState, retention: m.RETENTION };
      })(),
    });
  }),
);

/** Make a backup now (database + uploaded files), verify it, and report the result. */
adminOpsRouter.post('/system/backup', requirePermission('settings.manage'), ah(async (req, res) => {
  const m = await import('../services/maintenance');
  await audit(req, { action: 'system.backup_requested' });
  const state = await m.runBackup();
  res.json({ state, newest: m.listBackups()[0] ?? null });
}));

/* ======================================================================================
 * Product downloads overview: per product, the current demo and full installer and download counts
 * ====================================================================================== */
adminOpsRouter.get(
  '/product-downloads',
  requirePermission('products.view', 'downloads.view'),
  ah(async (_req, res) => {
    const products = await db('products').where({ is_archived: false }).orderBy('name').select('id', 'name', 'slug', 'is_published', 'demo_options', 'trial_days', 'offering_type', 'features');
    const versions = await db('product_versions as v').whereIn('v.channel', ['demo', 'release']).where('v.status', 'released').where('v.is_latest', true)
      .select('v.id', 'v.product_id', 'v.channel', 'v.version', 'v.release_date', 'v.downloads_enabled',
        db.raw('(SELECT COUNT(*) FROM version_files f WHERE f.version_id = v.id AND f.is_active = 1) as files'),
        db.raw('(SELECT SUM(m.size_bytes) FROM version_files f JOIN media m ON m.id = f.media_id WHERE f.version_id = v.id AND f.is_active = 1) as bytes'));
    const counts = await db('downloads as d').join('product_versions as v', 'v.id', 'd.version_id').where('d.created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)')).groupBy('d.product_id', 'v.channel').select('d.product_id', 'v.channel').count({ n: '*' });
    const recent = await db('downloads as d').join('product_versions as v', 'v.id', 'd.version_id').join('products as p', 'p.id', 'd.product_id').leftJoin('customers as c', 'c.id', 'd.customer_id').orderBy('d.id', 'desc').limit(25)
      .select('d.id', 'd.status', 'd.created_at', 'v.channel', 'v.version', 'p.name as product', 'c.full_name', 'c.id as customer_id');
    const { fullAccess } = await import('../services/demos');
    res.json({
      products: products.map((p) => {
        const v = (ch: string) => versions.find((x) => x.product_id === p.id && x.channel === ch);
        const n = (ch: string) => num((counts as Row[]).find((x) => x.product_id === p.id && x.channel === ch)?.n);
        const out = (x: Row) => (x ? { version: x.version, releaseDate: x.release_date, files: num(x.files), bytes: x.bytes == null ? null : num(x.bytes), enabled: !!x.downloads_enabled } : null);
        return { id: p.id, name: p.name, slug: p.slug, published: !!p.is_published, fullAccess: fullAccess(p), demo: out(v('demo')), full: out(v('release')), demoDownloads30: n('demo'), fullDownloads30: n('release') };
      }),
      recent,
    });
  }),
);

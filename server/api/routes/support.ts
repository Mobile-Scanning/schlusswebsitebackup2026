import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, badRequest, conflict, forbidden, HttpError, like, notFound, pageQuery, parse } from '../http';
import { can, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { ipHash, randomToken, reference, sha256 } from '../services/crypto';
import { DEMO_STATUS_LABEL, DemoStatus, demoStatusSql } from '../services/demos';
import { queueEmail } from '../services/jobs';
import { getSetting, inboxFor, limit, notifyStaff, notifyUsers, setSetting } from '../services/platform';
import { ASSISTANT_FOOTER, assistantAnswer } from '../services/assistant';
import { publish, stream } from '../services/realtime';
import { forwardToAgents, recordStaffReply } from '../services/whatsapp';

/**
 * Support chat. Conversations are the existing `tickets`, messages are `ticket_messages`
 * (is_internal = staff-only notes – never returned by the customer endpoints).
 *
 *  - Signed-in users: conversations belong to their account (all devices, survives logout).
 *  - Visitors: name + email + consent; an httpOnly cookie holds a random token whose hash is stored
 *    on the conversation so they can continue it in the same browser. When they later sign in with
 *    the same email, the conversation moves into their account.
 *  - Nobody "replies" automatically: the panel shows the availability message instead.
 */
export const supportRouter = Router();
export const adminSupportRouter = Router();

const COOKIE = 'sch_chat';
const STATUS = ['new', 'open', 'awaiting_admin', 'awaiting_customer', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;
const OPEN = ['new', 'open', 'awaiting_admin', 'awaiting_customer', 'in_progress'];

const preview = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 140);
const clean = (s: string) => s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const messageBody = z.string().transform(clean).pipe(z.string().min(1, 'Write a message').max(4000, 'Keep messages under 4000 characters'));

function visitorHash(req: Request) {
  const t = req.cookies?.[COOKIE];
  return typeof t === 'string' && t.length >= 20 && t.length <= 80 ? sha256('chat:' + t) : null;
}

/** Restrict a tickets query to what the current user/visitor owns. */
function ownedBy(req: Request) {
  const a = req.auth;
  const vh = visitorHash(req);
  return (q: Knex.QueryBuilder) =>
    q.where((b) => {
      if (a) {
        b.where('t.requester_user_id', a.user.id);
        if (a.customerId) b.orWhere('t.customer_id', a.customerId);
      } else if (vh) b.where('t.visitor_token_hash', vh).whereNull('t.requester_user_id');
      else b.whereRaw('1 = 0');
    });
}

/** A visitor who signs in with the same email gets their earlier chats in their account. */
async function claimVisitorChats(req: Request) {
  const a = req.auth;
  const vh = visitorHash(req);
  if (!a || !vh) return;
  await db('tickets').where({ visitor_token_hash: vh }).whereNull('requester_user_id').where('email', a.user.email).update({ requester_user_id: a.user.id, customer_id: a.customerId ?? null });
}

/* =============================== Website / customer side =============================== */
supportRouter.get(
  '/info',
  ah(async (req, res) => {
    await claimVisitorChats(req);
    const s = await getSetting('support.settings');
    const cats = await db('support_categories').where({ is_active: true }).orderBy(['sort_order', 'name']).select('id', 'name');
    const unread = await ownedBy(req)(db('tickets as t')).sum({ n: 't.customer_unread' }).first();
    const has = await ownedBy(req)(db('tickets as t')).count({ n: '*' }).first();
    res.json({ availability: s.availabilityMessage, categories: cats, unread: Number(unread?.n ?? 0), conversations: Number(has?.n ?? 0), signedIn: !!req.auth, name: req.auth?.user.name ?? null });
  }),
);

/** Cheap poll for the chat button badge. */
supportRouter.get(
  '/unread',
  ah(async (req, res) => {
    const unread = await ownedBy(req)(db('tickets as t')).sum({ n: 't.customer_unread' }).first();
    res.json({ unread: Number(unread?.n ?? 0) });
  }),
);

supportRouter.get(
  '/conversations',
  ah(async (req, res) => {
    await claimVisitorChats(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await ownedBy(req)(db('tickets as t'))
      .leftJoin('support_categories as c', 'c.id', 't.category_id')
      .leftJoin('products as p', 'p.id', 't.product_id')
      .orderBy('t.last_message_at', 'desc')
      .limit(50)
      .select('t.reference', 't.subject', 't.status', 't.customer_unread', 't.last_message_at', 'c.name as category', 'p.name as product', 'p.slug as product_slug');
    res.json(rows.map((r) => ({ reference: r.reference, subject: r.subject, status: r.status, unread: Number(r.customer_unread), lastMessageAt: r.last_message_at, category: r.category, product: r.product ? { name: r.product, slug: r.product_slug } : null })));
  }),
);

async function ownedTicket(req: Request, ref: string) {
  const t = await ownedBy(req)(db('tickets as t')).where('t.reference', String(ref).slice(0, 20)).first('t.*');
  if (!t) throw notFound('Conversation not found.');
  return t;
}

supportRouter.get(
  '/conversations/:ref',
  ah(async (req, res) => {
    const t = await ownedTicket(req, String(req.params['ref']));
    const msgs = await db('ticket_messages as m')
      .leftJoin('users as u', 'u.id', 'm.author_id')
      .where({ 'm.ticket_id': t.id, 'm.is_internal': false }) // internal notes are NEVER sent to customers
      .orderBy('m.id')
      .select('m.id', 'm.body', 'm.author_kind', 'm.created_at', 'u.name as author');
    if (t.customer_unread) await db('tickets').where({ id: t.id }).update({ customer_unread: 0 });
    const agent = msgs.filter((m) => m.author_kind === 'staff').pop();
    const s = await getSetting('support.settings');
    const product = t.product_id ? await db('products').where({ id: t.product_id }).first('name', 'slug') : null;
    res.json({
      reference: t.reference,
      subject: t.subject,
      status: t.status,
      product,
      availability: s.availabilityMessage,
      department: t.department,
      humanJoined: !!t.human_at,
      agent: agent?.author ? agent.author.split(' ')[0] : null,
      messages: msgs.map((m) => ({ id: m.id, body: m.body, from: m.author_kind === 'staff' ? 'staff' : m.author_kind === 'bot' ? 'bot' : m.author_kind === 'system' ? 'system' : 'me', author: m.author_kind === 'staff' ? (m.author ? m.author.split(' ')[0] + ' · SCHLUSS' : 'SCHLUSS support') : m.author_kind === 'bot' ? 'SCHLUSS Assistant (automated)' : null, at: m.created_at })),
    });
  }),
);

/** Live updates for one conversation (Server-Sent Events) – the chat shows replies without refreshing. */
supportRouter.get(
  '/conversations/:ref/stream',
  ah(async (req, res) => {
    const t = await ownedTicket(req, String(req.params['ref']));
    stream(req, res, 'ticket:' + t.id);
  }),
);

/** Automated first answer (clearly labelled), at most 3 per conversation and only until a person joins. */
async function botReply(t: { id: number; human_at?: Date | null }, message: string, productName: string | null) {
  if (t.human_at) return;
  const used = await db('ticket_messages').where({ ticket_id: t.id, author_kind: 'bot' }).count({ n: '*' }).first();
  if (Number(used?.n) >= 3) return;
  const answer = await assistantAnswer(message, productName);
  const body = answer ? `${answer}\n\n${ASSISTANT_FOOTER}` : Number(used?.n) ? null : 'Thanks – your message is with the SCHLUSS support team and a person will reply here. You can keep adding details in the meantime.';
  if (!body) return;
  await db('ticket_messages').insert({ ticket_id: t.id, author_kind: 'bot', source: 'bot', body });
  publish({ ticketId: t.id, kind: 'message' });
}

const startSchema = z.object({
  message: messageBody,
  /** Customer's own choice. Only "purchase" goes to sales; anything else – or nothing – goes to support. */
  enquiryType: z.enum(['technical', 'general', 'purchase']).default('general'),
  quantity: z.number().int().min(1).max(100000).optional(),
  categoryId: z.number().int().nullable().optional(),
  product: z.string().trim().max(180).nullable().optional(),
  subject: z.string().trim().max(200).optional(),
  name: z.string().trim().max(191).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(191).optional(),
  cellphone: z.string().trim().max(32).optional(),
  company: z.string().trim().max(191).optional(),
  consent: z.boolean().optional(),
  website: z.string().max(0, 'Spam check failed').optional(), // honeypot – must stay empty
});

supportRouter.post(
  '/conversations',
  limit(5, 60, 'You have started several conversations recently. Please continue an existing one or wait a while.'),
  ah(async (req: Request, res: Response) => {
    const input = parse(startSchema, req.body);
    const a = req.auth;
    let name = input.name ?? '';
    let email = input.email ?? '';
    let cellphone = input.cellphone || null;
    let company = input.company || null;
    if (a) {
      name = a.user.name;
      email = a.user.email;
      if (a.customerId) {
        const c = await db('customers').where({ id: a.customerId }).first('cellphone', 'company');
        cellphone ??= c?.cellphone ?? null;
        company ??= c?.company ?? null;
      }
    } else {
      const fields: Record<string, string> = {};
      if (name.length < 2) fields['name'] = 'Enter your name';
      if (!email) fields['email'] = 'Enter your email address so we can reply';
      if (!input.consent) fields['consent'] = 'Please agree so we can store and answer your message';
      if (Object.keys(fields).length) throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields });
    }
    const cat = input.categoryId ? await db('support_categories').where({ id: input.categoryId, is_active: true }).first('id', 'name', 'priority') : null;
    if (input.categoryId && !cat) throw badRequest('Choose a topic from the list.');
    const product = input.product ? await db('products').where({ slug: input.product, is_published: true }).first('id', 'name') : null;
    const lic = product && a?.customerId ? await db('licences').where({ customer_id: a.customerId, product_id: product.id }).orderByRaw("type = 'trial' DESC").orderBy('id', 'desc').first('id') : null;
    const ref = reference('SC');
    let token: string | null = null;
    const priority = cat?.priority ?? (input.enquiryType === 'technical' ? 'normal' : 'normal');
    const department = input.enquiryType === 'purchase' ? 'sales' : 'support';
    const typeLabel = { technical: 'Technical support', general: 'General assistance', purchase: 'Purchase / sales' }[input.enquiryType];
    const subject = (input.subject || [input.enquiryType === 'purchase' ? 'Purchase enquiry' : cat?.name, product?.name].filter(Boolean).join(' · ') || preview(input.message).slice(0, 80)).slice(0, 255);
    let firstMessageId = 0;
    const id = await db.transaction(async (trx) => {
      if (!a) {
        token = req.cookies?.[COOKIE] && visitorHash(req) ? null : randomToken(24);
      }
      const [tid] = await trx('tickets').insert({
        reference: ref,
        requester_user_id: a?.user.id ?? null,
        customer_id: a?.customerId ?? null,
        product_id: product?.id ?? null,
        licence_id: lic?.id ?? null,
        category_id: cat?.id ?? null,
        channel: 'chat',
        department,
        enquiry_type: input.enquiryType,
        name,
        email,
        cellphone,
        company,
        subject,
        priority,
        status: 'new',
        admin_unread: 1,
        last_message_at: new Date(),
        last_customer_message_at: new Date(),
        visitor_token_hash: a ? null : (token ? sha256('chat:' + token) : visitorHash(req)),
      });
      [firstMessageId] = await trx('ticket_messages').insert({ ticket_id: tid, author_id: a?.user.id ?? null, author_kind: a ? 'customer' : 'visitor', source: 'website', body: input.message });
      await trx('consents').insert({ user_id: a?.user.id ?? null, email, purpose: 'support_chat', document_version: config.legal.privacyVersion, granted: true, source: 'chat', ip_hash: ipHash(req.ip) });
      const urgent = priority === 'high' || priority === 'urgent';
      const link = `${config.appUrl}/admin/${department === 'sales' ? 'sales' : 'support'}?open=${tid}`;
      const emails = await getSetting('email.departments');
      if (department === 'sales') {
        // Genuine purchase enquiry → Sales Enquiries + sales@ only.
        const [qid] = await trx('quote_requests').insert({ reference: reference('SQ'), customer_id: a?.customerId ?? null, product_id: product?.id ?? null, kind: 'purchase', quantity: input.quantity ?? 1, message: input.message, status: 'new', name, email, cellphone, company, source: 'chat', ticket_id: tid });
        await notifyStaff(['sales.view'], { type: 'sales.new', title: `New purchase enquiry from ${name}${company ? ` (${company})` : ''}`, body: preview(input.message), link: `/admin/sales?open=${qid}` }, trx);
        await queueEmail(await inboxFor('purchase'), 'sales_enquiry', { kind: 'Purchase', name, company: company ? ` (${company})` : '', email, phone: cellphone ?? '—', product: product?.name ?? 'Not specified', quantity: input.quantity ?? 1, message: input.message, reference: ref, source: 'Website chat', link: `${config.appUrl}/admin/sales?open=${qid}` }, trx);
        if (emails.customerAck) await queueEmail(email, 'sales_ack', { name, product: product?.name ?? 'SCHLUSS products', reference: ref }, trx);
      } else {
        await notifyStaff(['support.view'], { type: urgent ? 'support.urgent' : 'support.new', title: `${urgent ? 'High priority – ' : ''}New ${typeLabel.toLowerCase()} chat from ${name}${company ? ` (${company})` : ''}`, body: preview(input.message), link: `/admin/support?open=${tid}` }, trx);
        const s = await getSetting('support.settings');
        if (s.emailAdminsOnNew) await queueEmail(emails.support, 'support_enquiry', { type: typeLabel, name, company: company ? ` (${company})` : '', email, phone: cellphone ?? '—', product: product?.name ?? '—', subject, message: input.message, reference: ref, source: 'Website chat', link }, trx);
        if (emails.customerAck) await queueEmail(email, 'support_ack', { name, reference: ref, message: input.message, link: a ? `${config.appUrl}/account/support?c=${ref}` : `${config.appUrl}/?chat=${ref}` }, trx);
      }
      return tid;
    });
    if (token) res.cookie(COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', maxAge: 180 * 86400_000 });
    await audit(req, { action: 'support.conversation_started', subjectType: 'ticket', subjectId: id, meta: { reference: ref, channel: 'chat', department } });
    const t = await db('tickets').where({ id }).first();
    if (department === 'support') {
      await forwardToAgents({ ...t, product: product?.name ?? null }, firstMessageId, input.message, true).catch(() => undefined);
      await botReply(t, input.message, product?.name ?? null);
    }
    publish({ ticketId: id, kind: 'message' });
    res.status(201).json({ reference: ref, department });
  }),
);

supportRouter.post(
  '/conversations/:ref/messages',
  limit(30, 10, 'You are sending messages very quickly. Please wait a moment.'),
  ah(async (req, res) => {
    const { body } = parse(z.object({ body: messageBody, website: z.string().max(0).optional() }), req.body);
    const t = await ownedTicket(req, String(req.params['ref']));
    let msgId = 0;
    await db.transaction(async (trx) => {
      [msgId] = await trx('ticket_messages').insert({ ticket_id: t.id, author_id: req.auth?.user.id ?? null, author_kind: req.auth ? 'customer' : 'visitor', source: 'website', body });
      const status = t.status === 'new' ? 'new' : 'awaiting_admin'; // a reply reopens resolved/closed conversations
      await trx('tickets').where({ id: t.id }).update({ status, admin_unread: trx.raw('admin_unread + 1'), last_message_at: new Date(), last_customer_message_at: new Date(), resolved_at: null, updated_at: new Date() });
      if (!t.admin_unread) {
        // Only the first unread message triggers a notification – no repeats while it waits.
        const note = { type: 'support.reply', title: `${t.name} replied (${t.reference})`, body: preview(body), link: `/admin/support?open=${t.id}` };
        if (t.assigned_to) await notifyUsers([t.assigned_to], note, trx);
        else await notifyStaff([t.department === 'sales' ? 'sales.view' : 'support.view'], note, trx);
      }
    });
    if (t.department === 'support') {
      const product = t.product_id ? (await db('products').where({ id: t.product_id }).first('name'))?.name : null;
      await forwardToAgents({ ...t, product }, msgId, body, false).catch(() => undefined);
      if (!t.human_at) await botReply(t, body, product);
    }
    publish({ ticketId: t.id, kind: 'message' });
    res.status(201).json({ ok: true });
  }),
);

/* =============================== Admin: Support Inbox =============================== */
const listQuery = pageQuery.extend({
  view: z.enum(['all', 'open', 'closed', 'unread', 'mine', 'unassigned']).default('open'),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  categoryId: z.coerce.number().int().optional(),
  productId: z.coerce.number().int().optional(),
  assignedTo: z.coerce.number().int().optional(),
  customerId: z.coerce.number().int().optional(),
  channel: z.enum(['chat', 'form', 'whatsapp']).optional(),
  department: z.enum(['support', 'sales', 'all']).default('support'),
  has: z.enum(['demo', 'package']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
});

adminSupportRouter.get(
  '/support/conversations',
  requirePermission('support.view'),
  ah(async (req, res) => {
    const q = parse(listQuery, req.query);
    const me = req.auth!.user.id;
    const dept = (b: Knex.QueryBuilder) => (q.department === 'all' ? b : b.where('t.department', q.department));
    const base = dept(db('tickets as t').leftJoin('customers as cu', 'cu.id', 't.customer_id'));
    const views: Record<string, (b: Knex.QueryBuilder) => unknown> = {
      all: () => undefined,
      open: (b) => b.whereIn('t.status', OPEN),
      closed: (b) => b.whereIn('t.status', ['resolved', 'closed']),
      unread: (b) => b.where('t.admin_unread', '>', 0),
      mine: (b) => b.where('t.assigned_to', me).whereIn('t.status', OPEN),
      unassigned: (b) => b.whereNull('t.assigned_to').whereIn('t.status', OPEN),
    };
    const counts = Object.fromEntries(await Promise.all(Object.entries(views).map(async ([k, f]) => { const b = dept(db('tickets as t')); f(b); return [k, Number((await b.count({ n: '*' }).first())?.n ?? 0)]; })));
    views[q.view](base);
    if (q.status) base.where('t.status', q.status);
    if (q.priority) base.where('t.priority', q.priority);
    if (q.categoryId) base.where('t.category_id', q.categoryId);
    if (q.productId) base.where('t.product_id', q.productId);
    if (q.assignedTo) base.where('t.assigned_to', q.assignedTo);
    if (q.customerId) base.where('t.customer_id', q.customerId);
    if (q.channel) base.where('t.channel', q.channel);
    if (q.has === 'demo') base.whereExists(db('licences as l').whereRaw('l.customer_id = t.customer_id').where('l.type', 'trial'));
    if (q.has === 'package') base.whereExists(db('licences as l').whereRaw('l.customer_id = t.customer_id').whereNot('l.type', 'trial'));
    if (q.from) base.where('t.last_message_at', '>=', q.from);
    if (q.to) base.where('t.last_message_at', '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [q.to]));
    if (q.q) base.where((b) => b.where('t.name', 'like', like(q.q!)).orWhere('t.email', 'like', like(q.q!)).orWhere('t.reference', 'like', like(q.q!)).orWhere('t.company', 'like', like(q.q!)).orWhere('cu.company', 'like', like(q.q!)).orWhere('t.subject', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: 't.id' });
    const rows = await base
      .clone()
      .leftJoin('support_categories as c', 'c.id', 't.category_id')
      .leftJoin('products as p', 'p.id', 't.product_id')
      .leftJoin('users as a', 'a.id', 't.assigned_to')
      .orderByRaw('t.admin_unread > 0 DESC')
      .orderBy('t.last_message_at', 'desc')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select(
        't.id', 't.reference', 't.subject', 't.status', 't.priority', 't.channel', 't.name', 't.email', 't.cellphone', 't.last_message_at', 't.admin_unread', 't.assigned_to', 't.customer_id',
        db.raw('COALESCE(t.company, cu.company) as company'), 'c.name as category', 'p.name as product', 'a.name as assignee',
        db.raw('(SELECT LEFT(m.body, 140) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.is_internal = 0 ORDER BY m.id DESC LIMIT 1) as preview'),
        db.raw("(SELECT CONCAT(l.type, ':', l.licence_key) FROM licences l WHERE l.id = t.licence_id) as licence"),
        't.department', 't.enquiry_type', 't.created_at', 't.human_at',
        db.raw("(SELECT COUNT(*) FROM whatsapp_messages w WHERE w.ticket_id = t.id) as wa_count"),
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json({ data: (rows as any[]).map((r) => ({ ...r, admin_unread: Number(r.admin_unread), wa_count: Number(r['wa_count']) })), counts, meta: { page: q.page, perPage: q.perPage, total: Number(total) } });
  }),
);

async function customerContext(customerId: number | null, ticketId: number) {
  if (!customerId) return null;
  const s = await getSetting('demos.notifications');
  const [c, demos, packages, others] = await Promise.all([
    db('customers as c').leftJoin('partners as pa', 'pa.id', 'c.assigned_partner_id').where('c.id', customerId).first('c.id', 'c.full_name', 'c.email', 'c.cellphone', 'c.company', 'c.country', 'c.province', 'c.business_type', 'pa.business_name as partner'),
    db('licences as l').join('products as p', 'p.id', 'l.product_id').where({ 'l.customer_id': customerId, 'l.type': 'trial' }).select('l.id', 'p.name as product', 'l.expires_at', db.raw(`${demoStatusSql(s.soonDays)} as status`)),
    db('licences as l').join('products as p', 'p.id', 'l.product_id').where('l.customer_id', customerId).whereNot('l.type', 'trial').select('l.id', 'p.name as product', 'l.type', 'l.status', 'l.expires_at'),
    db('tickets').where('customer_id', customerId).whereNot('id', ticketId).orderBy('last_message_at', 'desc').limit(10).select('id', 'reference', 'subject', 'status', 'last_message_at'),
  ]);
  return { ...c, demos: demos.map((d) => ({ ...d, statusLabel: DEMO_STATUS_LABEL[d.status as DemoStatus] })), packages, others };
}

adminSupportRouter.get(
  '/support/conversations/:id',
  requirePermission('support.view', 'sales.view'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const t = await db('tickets as t')
      .leftJoin('support_categories as c', 'c.id', 't.category_id')
      .leftJoin('products as p', 'p.id', 't.product_id')
      .leftJoin('users as a', 'a.id', 't.assigned_to')
      .where('t.id', id)
      .first('t.*', 'c.name as category', 'p.name as product', 'p.slug as product_slug', 'a.name as assignee');
    if (!t) throw notFound('Conversation not found.');
    if (!can(req, t.department === 'sales' ? 'sales.view' : 'support.view')) throw forbidden();
    const msgs = await db('ticket_messages as m').leftJoin('users as u', 'u.id', 'm.author_id').where('m.ticket_id', id).orderBy('m.id').select('m.id', 'm.body', 'm.is_internal', 'm.author_kind', 'm.source', 'm.created_at', 'u.name as author');
    const wa = await db('whatsapp_messages').where({ ticket_id: id, direction: 'out' }).select('ticket_message_id', 'peer_phone', 'status', 'error', 'kind');
    const waBy = new Map<number, typeof wa>();
    for (const w of wa) if (w.ticket_message_id) waBy.set(w.ticket_message_id, [...(waBy.get(w.ticket_message_id) ?? []), w]);
    if (t.admin_unread && req.query['markRead'] !== '0') await db('tickets').where({ id }).update({ admin_unread: 0 });
    delete t.visitor_token_hash;
    res.json({ ...t, admin_unread: 0, messages: msgs.map((m) => ({ ...m, is_internal: !!m.is_internal, whatsapp: waBy.get(m.id) ?? [] })), customer: await customerContext(t.customer_id, id) });
  }),
);

adminSupportRouter.post(
  '/support/conversations/:id/messages',
  requirePermission('support.manage', 'sales.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ body: messageBody, internal: z.boolean().default(false) }), req.body);
    const t = await db('tickets').where({ id }).first();
    if (!t) throw notFound('Conversation not found.');
    if (!can(req, t.department === 'sales' ? 'sales.manage' : 'support.manage')) throw forbidden();
    if (input.internal) {
      await db('ticket_messages').insert({ ticket_id: id, author_id: req.auth!.user.id, author_kind: 'staff', source: 'admin', body: input.body, is_internal: true }); // never shown to customers
    } else {
      await recordStaffReply(t, input.body, req.auth!.user.id, 'admin', req.auth!.user.name);
    }
    await audit(req, { action: input.internal ? 'support.note_added' : 'support.replied', subjectType: 'ticket', subjectId: id });
    res.status(201).json({ ok: true });
  }),
);

adminSupportRouter.patch(
  '/support/conversations/:id',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(z.object({ status: z.enum(STATUS).optional(), priority: z.enum(PRIORITY).optional(), categoryId: z.number().int().nullable().optional(), assignedTo: z.number().int().nullable().optional(), unread: z.boolean().optional() }), req.body);
    const t = await db('tickets').where({ id }).first();
    if (!t) throw notFound('Conversation not found.');
    const row: Record<string, unknown> = { updated_at: new Date() };
    if (input.status) {
      row['status'] = input.status;
      row['resolved_at'] = ['resolved', 'closed'].includes(input.status) ? new Date() : null;
    }
    if (input.priority) row['priority'] = input.priority;
    if (input.categoryId !== undefined) {
      if (input.categoryId && !(await db('support_categories').where({ id: input.categoryId }).first('id'))) throw badRequest('Category not found.');
      row['category_id'] = input.categoryId;
    }
    if (input.assignedTo !== undefined) {
      if (input.assignedTo) {
        const u = await db('users').where({ id: input.assignedTo, type: 'staff', status: 'active' }).first('id');
        if (!u) throw badRequest('Choose an active staff member.');
      }
      row['assigned_to'] = input.assignedTo;
    }
    if (input.unread !== undefined) row['admin_unread'] = input.unread ? Math.max(1, Number(t.admin_unread)) : 0;
    await db('tickets').where({ id }).update(row);
    if (input.assignedTo && input.assignedTo !== t.assigned_to && input.assignedTo !== req.auth!.user.id) {
      await notifyUsers([input.assignedTo], { type: 'support.assigned', title: `${req.auth!.user.name} assigned you a conversation: ${t.subject} (${t.reference})`, link: `/admin/support?open=${id}` });
    }
    if ((input.priority === 'high' || input.priority === 'urgent') && t.priority !== input.priority) {
      await notifyStaff(['support.manage'], { type: 'support.urgent', title: `Marked ${input.priority}: ${t.name} (${t.reference})`, link: `/admin/support?open=${id}` });
    }
    publish({ ticketId: id, kind: 'status' });
    await audit(req, { action: 'support.updated', subjectType: 'ticket', subjectId: id, before: { status: t.status, priority: t.priority, category_id: t.category_id, assigned_to: t.assigned_to }, after: input });
    res.json({ ok: true });
  }),
);

/** Live inbox updates for staff. */
adminSupportRouter.get(
  '/support/stream',
  requirePermission('support.view', 'sales.view'),
  (req, res) => stream(req, res, 'tickets'),
);

/** Support dashboard numbers. */
adminSupportRouter.get(
  '/support/summary',
  requirePermission('support.view'),
  ah(async (_req, res) => {
    const n = async (q: Knex.QueryBuilder) => Number((await q.count({ n: '*' }).first())?.n ?? 0);
    const sup = () => db('tickets').where('department', 'support');
    res.json({
      total: await n(sup()),
      new: await n(sup().where('status', 'new')),
      open: await n(sup().whereIn('status', ['open', 'awaiting_admin', 'in_progress'])),
      awaitingCustomer: await n(sup().where('status', 'awaiting_customer')),
      unresolved: await n(sup().whereIn('status', OPEN)),
      resolved: await n(sup().whereIn('status', ['resolved', 'closed'])),
      whatsapp: await n(sup().where((b) => b.where('channel', 'whatsapp').orWhereExists(db('whatsapp_messages as w').whereRaw('w.ticket_id = tickets.id')))),
      website: await n(sup().where('channel', 'chat')),
      forms: await n(sup().where('channel', 'form')),
      leads: await n(db('leads').whereNotIn('status', ['converted', 'closed', 'not_interested'])),
      demoLeads: await n(db('leads').where('source', 'demo_expiry').whereNotIn('status', ['converted', 'closed', 'not_interested'])),
    });
  }),
);

/* ---- Categories ---- */
const catSchema = z.object({ name: z.string().trim().min(2, 'Enter a name').max(80), priority: z.enum(PRIORITY).default('normal'), isActive: z.boolean().default(true) });
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'category';

adminSupportRouter.get(
  '/support/categories',
  requirePermission('support.view'),
  ah(async (_req, res) => {
    const rows = (await db('support_categories as c').leftJoin('tickets as t', 't.category_id', 'c.id').groupBy('c.id').orderBy(['c.sort_order', 'c.name']).select('c.id', 'c.name', 'c.priority', 'c.is_active', 'c.sort_order').count({ uses: 't.id' })) as Record<string, unknown>[];
    res.json(rows.map((r) => ({ ...r, is_active: !!r['is_active'], uses: Number(r['uses']) })));
  }),
);
adminSupportRouter.post(
  '/support/categories',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const input = parse(catSchema, req.body);
    let slug = slugOf(input.name);
    if (await db('support_categories').where({ slug }).first('id')) slug = `${slug}-${Date.now().toString(36)}`;
    const max = await db('support_categories').max({ m: 'sort_order' }).first();
    const [id] = await db('support_categories').insert({ name: input.name, slug, priority: input.priority, is_active: input.isActive, sort_order: Number(max?.m ?? 0) + 10 });
    await audit(req, { action: 'support.category_created', subjectType: 'support_category', subjectId: id, after: input });
    res.status(201).json({ id });
  }),
);
adminSupportRouter.put(
  '/support/categories/:id',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const input = parse(catSchema, req.body);
    if (!(await db('support_categories').where({ id }).first('id'))) throw notFound();
    await db('support_categories').where({ id }).update({ name: input.name, priority: input.priority, is_active: input.isActive, updated_at: new Date() });
    await audit(req, { action: 'support.category_updated', subjectType: 'support_category', subjectId: id, after: input });
    res.json({ ok: true });
  }),
);
adminSupportRouter.delete(
  '/support/categories/:id',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']) || 0;
    const used = await db('tickets').where({ category_id: id }).count({ n: '*' }).first();
    if (Number(used?.n)) throw conflict('This topic is used by conversations – switch it off instead of deleting it.');
    await db('support_categories').where({ id }).del();
    await audit(req, { action: 'support.category_deleted', subjectType: 'support_category', subjectId: id });
    res.json({ ok: true });
  }),
);

/* ---- Settings ---- */
adminSupportRouter.get(
  '/support/settings',
  requirePermission('support.view'),
  ah(async (_req, res) => {
    res.json(await getSetting('support.settings'));
  }),
);
adminSupportRouter.put(
  '/support/settings',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const input = parse(z.object({ availabilityMessage: z.string().trim().min(10).max(500), overdueHours: z.number().int().min(1).max(168), emailCustomerOnReply: z.boolean(), emailAdminsOnNew: z.boolean() }), req.body);
    await setSetting('support.settings', input, req.auth!.user.id);
    await audit(req, { action: 'support.settings_updated', after: input });
    res.json(input);
  }),
);

/* ---- Staff list for assignment ---- */
adminSupportRouter.get(
  '/support/staff',
  requirePermission('support.view'),
  ah(async (req, res) => {
    if (!can(req, 'support.view')) throw forbidden();
    const rows = await db('users').where({ type: 'staff', status: 'active' }).orderBy('name').select('id', 'name');
    res.json(rows);
  }),
);

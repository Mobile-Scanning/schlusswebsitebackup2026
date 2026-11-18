import { createHmac } from 'node:crypto';
import { config } from '../config';
import { db } from '../db';
import { safeEqual } from './crypto';
import { queueEmail } from './jobs';
import { getSetting, getWaSecret, inbox, notifyStaff, notifyUsers } from './platform';
import { publish } from './realtime';

/**
 * WhatsApp Business Platform (Cloud API) – official integration only.
 *
 *   Website chat ──► Cloud API ──► support team's WhatsApp ("agents")
 *   Agent replies (swipe-reply to the forwarded message, or start with the reference) ──► webhook ──► same website chat
 *
 * Mapping: every forwarded message's WhatsApp id (wamid) is stored with its conversation. An agent's reply
 * carries `context.id` = that wamid, so it always lands in the right conversation, even with many chats at
 * once. Fallback: a reply starting with the reference (e.g. "SC-2026-7KQ3XD …").
 *
 * Customers who message the SCHLUSS WhatsApp number directly get a WhatsApp conversation in the Support Inbox;
 * admin replies go back to them through the API (inside WhatsApp's 24-hour customer-service window).
 *
 * Delivery is never assumed: a message is "sent" when Meta accepts it, and "delivered"/"read"/"failed" only
 * when the status webhook says so.
 */

const apiBase = () => (process.env['WHATSAPP_API_BASE'] || 'https://graph.facebook.com').replace(/\/$/, '');
export const digits = (n: string) => String(n || '').replace(/\D/g, '');
const WINDOW_MS = 24 * 3600_000;

export async function waConfig() {
  const s = await getSetting('whatsapp.settings');
  const token = await getWaSecret('accessToken');
  const ready = !!(s.enabled && s.phoneNumberId && token);
  return { ...s, token, ready, agents: (s.agents ?? []).map((a) => ({ ...a, number: digits(a.number) })).filter((a) => a.number.length >= 8) };
}

async function graph(path: string, token: string, body?: unknown) {
  const s = await getSetting('whatsapp.settings');
  const url = `${apiBase()}/${s.apiVersion || 'v21.0'}/${path}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) {
    const e = json?.['error'] ?? {};
    const err = new Error(`${e.message ?? 'WhatsApp API error'} (HTTP ${res.status}${e.code ? `, code ${e.code}` : ''})`) as Error & { status: number; transient: boolean };
    err.status = res.status;
    err.transient = res.status >= 500 || res.status === 429;
    throw err;
  }
  return json;
}

let lastAlert = 0;
async function alertFailure(detail: string) {
  if (Date.now() - lastAlert < 3600_000) return; // at most one alert per hour
  lastAlert = Date.now();
  await notifyStaff(['whatsapp.manage', 'support.manage'], { type: 'whatsapp.error', title: 'WhatsApp message could not be sent', body: detail.slice(0, 500), link: '/admin/whatsapp' });
  await queueEmail(await inbox('support'), 'system_alert', { title: 'WhatsApp delivery problem', detail: detail.slice(0, 1000), link: `${config.appUrl}/admin/whatsapp` });
}

/** Is `peer` inside WhatsApp's 24-hour customer-service window (they messaged us in the last 24 h)? */
async function inWindow(peer: string) {
  const last = await db('whatsapp_messages').where({ peer_phone: peer, direction: 'in' }).max({ at: 'created_at' }).first();
  return !!last?.at && Date.now() - new Date(last.at).getTime() < WINDOW_MS;
}

/** Send one message and record it. Outside the 24 h window an approved template is required. */
export async function sendWa(opts: { to: string; text: string; ticketId: number | null; ticketMessageId?: number | null; templateParams?: string[] }) {
  const c = await waConfig();
  const to = digits(opts.to);
  const [rowId] = await db('whatsapp_messages').insert({ ticket_id: opts.ticketId, ticket_message_id: opts.ticketMessageId ?? null, direction: 'out', peer_phone: to, status: 'queued', kind: 'text' });
  if (!c.ready) {
    await db('whatsapp_messages').where({ id: rowId }).update({ status: 'failed', error: 'WhatsApp integration is switched off or not configured.' });
    return { ok: false, id: rowId };
  }
  let body: Record<string, unknown>;
  let kind: 'text' | 'template' = 'text';
  if (await inWindow(to)) {
    body = { messaging_product: 'whatsapp', to, type: 'text', text: { body: opts.text.slice(0, 4000), preview_url: false } };
  } else if (c.templateName) {
    kind = 'template';
    const params = (opts.templateParams ?? [opts.text.slice(0, 900)]).map((t) => ({ type: 'text', text: t.replace(/\s+/g, ' ').slice(0, 900) }));
    body = { messaging_product: 'whatsapp', to, type: 'template', template: { name: c.templateName, language: { code: c.templateLanguage || 'en' }, components: [{ type: 'body', parameters: params }] } };
  } else {
    const err = 'Outside WhatsApp’s 24-hour window and no approved template is configured (Admin › WhatsApp settings).';
    await db('whatsapp_messages').where({ id: rowId }).update({ status: 'failed', error: err });
    await alertFailure(err);
    return { ok: false, id: rowId };
  }
  return attempt(rowId, c.phoneNumberId, c.token, body, kind);
}

async function attempt(rowId: number, phoneNumberId: string, token: string, body: Record<string, unknown>, kind: 'text' | 'template') {
  let wamid: string | null = null;
  try {
    const r = await graph(`${phoneNumberId}/messages`, token, body);
    wamid = r?.['messages']?.[0]?.id ?? null;
  } catch (e) {
    const err = e as Error & { transient?: boolean };
    await db('whatsapp_messages').where({ id: rowId }).update({ status: 'failed', kind, attempts: db.raw('attempts + 1'), error: (err.transient ? '[retry] ' : '') + err.message.slice(0, 1000), updated_at: new Date() });
    // Keep the request so the scheduler can retry transient failures (network, 5xx, rate limit).
    if (err.transient) retryQueue.set(rowId, { phoneNumberId, body, kind });
    await alertFailure(err.message);
    return { ok: false, id: rowId, error: err.message };
  }
  // Meta accepted the message ("sent"). Delivery/read is only recorded when the status webhook confirms it.
  await db('whatsapp_messages').where({ id: rowId }).update({ status: 'sent', kind, wa_message_id: wamid, attempts: db.raw('attempts + 1'), error: null, updated_at: new Date() });
  return { ok: true, id: rowId, wamid };
}

const retryQueue = new Map<number, { phoneNumberId: string; body: Record<string, unknown>; kind: 'text' | 'template' }>();
/** Called by the scheduler: retry transient failures (max 5 attempts). */
export async function retryWhatsApp() {
  const c = await waConfig();
  if (!c.ready) return 0;
  let n = 0;
  for (const [rowId, job] of retryQueue) {
    const row = await db('whatsapp_messages').where({ id: rowId }).first('status', 'attempts');
    retryQueue.delete(rowId);
    if (!row || row.status !== 'failed' || row.attempts >= 5) continue;
    await attempt(rowId, job.phoneNumberId, c.token, job.body, job.kind);
    n++;
  }
  return n;
}

/** Forward a website chat message to every configured agent number. */
export async function forwardToAgents(ticket: { id: number; reference: string; name: string; company?: string | null; product?: string | null; enquiry_type?: string | null }, messageId: number, text: string, first: boolean) {
  const c = await waConfig();
  if (!c.ready || !c.agents.length) return [];
  const type = ticket.enquiry_type === 'technical' ? 'Technical support' : ticket.enquiry_type === 'purchase' ? 'Purchase' : 'General';
  const head = first ? `New SCHLUSS chat ${ticket.reference}\n${ticket.name}${ticket.company ? ` (${ticket.company})` : ''}${ticket.product ? ` · ${ticket.product}` : ''} · ${type}` : `${ticket.reference} · ${ticket.name}`;
  const msg = `${head}\n\n${text}\n\n↩ Reply to this message to answer in the website chat. Send /resolve to close it.`;
  const out = [];
  for (const a of c.agents) out.push(await sendWa({ to: a.number, text: msg, ticketId: ticket.id, ticketMessageId: messageId, templateParams: [ticket.reference, ticket.name, text.slice(0, 500)] }));
  return out;
}

/** Webhook signature (X-Hub-Signature-256) – HMAC-SHA256 of the raw body with the Meta app secret. */
export async function validSignature(raw: Buffer | undefined, header: string | undefined) {
  const secret = await getWaSecret('appSecret');
  if (!secret || !raw || !header?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return safeEqual(expected, header);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Process one webhook delivery. Idempotent: a message id already stored is ignored (Meta may resend). */
export async function handleWebhook(payload: any) {
  const c = await waConfig();
  const agentByNumber = new Map(c.agents.map((a) => [a.number, a]));
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value ?? {};
      for (const st of v.statuses ?? []) {
        const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
        const status = map[st.status];
        if (!status || !st.id) continue;
        const err = st.errors?.[0] ? `${st.errors[0].title ?? 'Error'}${st.errors[0].code ? ` (code ${st.errors[0].code})` : ''}` : null;
        // never move backwards (e.g. "delivered" arriving after "read")
        const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
        const row = await db('whatsapp_messages').where({ wa_message_id: st.id }).first('id', 'status');
        if (row && rank[status] > rank[row.status]) await db('whatsapp_messages').where({ id: row.id }).update({ status, error: err, updated_at: new Date() });
        if (status === 'failed' && err) await alertFailure(`Message to ${st.recipient_id}: ${err}`);
      }
      const names = new Map((v.contacts ?? []).map((ct: any) => [digits(ct.wa_id), ct.profile?.name]));
      for (const m of v.messages ?? []) {
        const from = digits(m.from);
        const text = m.type === 'text' ? String(m.text?.body ?? '') : m.type === 'button' ? String(m.button?.text ?? '') : `[${m.type} message – please reply with text]`;
        // idempotency + 24-hour window bookkeeping
        try {
          await db('whatsapp_messages').insert({ direction: 'in', wa_message_id: m.id, peer_phone: from, status: 'received', kind: 'text' });
        } catch (e) {
          if ((e as { code?: string }).code === 'ER_DUP_ENTRY') continue;
          throw e;
        }
        const agent = agentByNumber.get(from);
        if (agent) await agentReply(agent, m, text);
        else await customerMessage(from, (names.get(from) as string) || '+' + from, m, text);
      }
    }
  }
}

async function findTicketForAgent(m: any, text: string) {
  if (m.context?.id) {
    const row = await db('whatsapp_messages').where({ wa_message_id: m.context.id }).whereNotNull('ticket_id').first('ticket_id');
    if (row) return { ticketId: row.ticket_id as number, body: text };
  }
  const ref = /^\s*#?(S[CT]-\d{4}-[2-9A-HJ-NP-Z]{6}|CT-\d{4}-[2-9A-HJ-NP-Z]{6})\b[\s:,-]*/i.exec(text);
  if (ref) {
    const t = await db('tickets').where({ reference: ref[1].toUpperCase() }).first('id');
    if (t) return { ticketId: t.id as number, body: text.slice(ref[0].length) };
  }
  return null;
}

async function agentReply(agent: { number: string; name: string; userId?: number | null }, m: any, text: string) {
  const found = await findTicketForAgent(m, text);
  if (!found) {
    await sendWa({ to: agent.number, text: 'I could not tell which chat this reply is for. Please swipe to reply to the forwarded chat message, or start your message with its reference (e.g. SC-2026-ABC234).', ticketId: null });
    return;
  }
  const t = await db('tickets').where({ id: found.ticketId }).first();
  if (!t) return;
  const body = found.body.trim();
  const cmd = body.toLowerCase();
  await db('whatsapp_messages').where({ wa_message_id: m.id }).update({ ticket_id: t.id });
  if (cmd === '/resolve' || cmd === '/close') {
    const status = cmd === '/close' ? 'closed' : 'resolved';
    await db('tickets').where({ id: t.id }).update({ status, resolved_at: new Date(), updated_at: new Date() });
    await db('ticket_messages').insert({ ticket_id: t.id, author_kind: 'system', source: 'system', body: `Marked ${status} by ${agent.name || 'SCHLUSS support'} (WhatsApp).`, is_internal: true });
    publish({ ticketId: t.id, kind: 'status' });
    await sendWa({ to: agent.number, text: `${t.reference} marked ${status}.`, ticketId: t.id });
    return;
  }
  if (!body) return;
  await recordStaffReply(t, body, agent.userId ?? null, 'whatsapp', agent.name);
}

/** Shared by the admin inbox and WhatsApp: store a staff reply, notify the customer, push it live. */
export async function recordStaffReply(t: any, body: string, userId: number | null, source: 'admin' | 'whatsapp', agentName?: string | null) {
  // The "joined" notice goes first, so the customer sees who is now answering before the reply itself.
  if (!t.human_at) await db('ticket_messages').insert({ ticket_id: t.id, author_kind: 'system', source: 'system', body: `${agentName ? agentName.split(' ')[0] + ' from SCHLUSS support' : 'A SCHLUSS support agent'} has joined the conversation.` });
  const [msgId] = await db('ticket_messages').insert({ ticket_id: t.id, author_id: userId, author_kind: 'staff', source, body });
  await db('tickets').where({ id: t.id }).update({ status: 'awaiting_customer', customer_unread: db.raw('customer_unread + 1'), admin_unread: 0, last_message_at: new Date(), human_at: t.human_at ?? new Date(), assigned_to: t.assigned_to ?? userId, updated_at: new Date() });
  if (!t.customer_unread) {
    if (t.requester_user_id) await notifyUsers([t.requester_user_id], { type: 'support.reply', title: `SCHLUSS replied to “${t.subject}”`, body: body.slice(0, 140), link: t.customer_id ? '/account/support?c=' + t.reference : null });
    const s = await getSetting('support.settings');
    if (s.emailCustomerOnReply && t.email) await queueEmail(t.email, 'support_reply', { name: t.name, reference: t.reference, preview: body.slice(0, 300), link: t.requester_user_id ? `${config.appUrl}/account/support?c=${t.reference}` : `${config.appUrl}/?chat=${t.reference}` });
  }
  // A conversation that started on WhatsApp is answered on WhatsApp.
  if (t.channel === 'whatsapp' && t.wa_customer_phone && source === 'admin') await sendWa({ to: t.wa_customer_phone, text: body, ticketId: t.id, ticketMessageId: msgId });
  publish({ ticketId: t.id, kind: 'message' });
  return msgId;
}

async function customerMessage(from: string, name: string, _m: any, text: string) {
  let t = await db('tickets').where({ channel: 'whatsapp', wa_customer_phone: from }).whereNotIn('status', ['closed']).where('last_message_at', '>', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)')).orderBy('id', 'desc').first();
  if (!t) {
    const { reference } = await import('./crypto');
    const ref = reference('SC');
    const [id] = await db('tickets').insert({ reference: ref, channel: 'whatsapp', department: 'support', enquiry_type: 'general', name, email: '', cellphone: '+' + from, subject: `WhatsApp: ${text.replace(/\s+/g, ' ').slice(0, 80)}`, priority: 'normal', status: 'new', admin_unread: 0, wa_customer_phone: from, last_message_at: new Date(), last_customer_message_at: new Date() });
    t = await db('tickets').where({ id }).first();
    await notifyStaff(['support.view'], { type: 'support.whatsapp', title: `New WhatsApp conversation from ${name}`, body: text.slice(0, 140), link: `/admin/support?open=${id}` });
    await queueEmail(await inbox('support'), 'support_enquiry', { type: 'WhatsApp', name, company: '', email: '—', phone: '+' + from, product: '—', subject: 'New WhatsApp conversation', message: text.slice(0, 2000), reference: ref, source: 'WhatsApp', link: `${config.appUrl}/admin/support?open=${id}` });
  }
  await db('ticket_messages').insert({ ticket_id: t.id, author_kind: 'customer', source: 'whatsapp', body: text });
  await db('tickets').where({ id: t.id }).update({ status: t.status === 'new' ? 'new' : 'awaiting_admin', admin_unread: db.raw('admin_unread + 1'), last_message_at: new Date(), last_customer_message_at: new Date(), wa_last_inbound_at: new Date(), resolved_at: null, updated_at: new Date() });
  publish({ ticketId: t.id, kind: 'message' });
}

/** Admin "Test connection": reads the phone number from Meta with the saved credentials. */
export async function testConnection() {
  const c = await waConfig();
  if (!c.phoneNumberId || !c.token) return { ok: false, message: 'Add the Phone number ID and access token first.' };
  try {
    const r = await graph(`${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, c.token);
    return { ok: true, message: `Connected to ${r['verified_name'] ?? 'WhatsApp Business'} (${r['display_phone_number'] ?? c.phoneNumberId}).`, details: r };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

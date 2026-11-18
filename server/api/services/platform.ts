import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Knex } from 'knex';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { db } from '../db';
import { hmac, randomToken, safeEqual } from './crypto';

/* =====================================================================================
 * Settings (the existing `settings` table): small JSON documents with safe defaults.
 * ===================================================================================== */
export const DEFAULT_SETTINGS = {
  'demos.notifications': {
    adminDays: [7, 3, 1, 0] as number[],
    customerDays: [7, 3, 1, 0] as number[],
    notifyExpired: true,
    emailAdmins: true,
    emailCustomers: true,
    soonDays: 7, // "Expiring soon" status window
  },
  'email.departments': {
    support: process.env['SUPPORT_EMAIL'] || 'support@schluss.co.za',
    sales: process.env['SALES_EMAIL'] || 'sales@schluss.co.za',
    customerAck: true, // confirmation email to the customer for every enquiry
    // Which department inbox receives what (Admin › Email settings):
    partnerInbox: 'sales' as 'support' | 'sales', // business partner registrations
    purchaseInbox: 'support' as 'support' | 'sales', // purchase / quotation enquiries
  },
  'security.settings': {
    requireStaffMfa: false, // when on, staff must set up two-step verification before using the admin
  },
  'whatsapp.settings': {
    enabled: false,
    phoneNumberId: '', // Meta "Phone number ID" of the SCHLUSS WhatsApp Business number
    businessAccountId: '', // WhatsApp Business Account (WABA) ID
    displayNumber: '', // the business number as customers see it, e.g. +27 12 345 6789
    apiVersion: 'v21.0',
    agents: [] as { number: string; name: string; userId?: number | null }[], // support team WhatsApp numbers that receive chats
    templateName: '', // approved template used when an agent is outside the 24-hour window
    templateLanguage: 'en',
  },
  'content.settings': {
    providers: { youtube: true, vimeo: true, upload: true } as Record<'youtube' | 'vimeo' | 'upload', boolean>,
    defaultAccess: 'registered' as 'public' | 'registered' | 'authorised' | 'demo', // used by products without their own setting
    publishNewItems: false, // new items start as drafts until published
    coverRequired: true, // a cover image is needed before an item can be published
    streamTokenMinutes: 15, // lifetime of a private-video playback link (renewed automatically while watching)
    viewWindowMinutes: 30, // repeat views by the same viewer within this window count once
  },
  'support.settings': {
    availabilityMessage: 'A SCHLUSS team member will reply here, usually within one business day (Mon–Fri, 08:00–17:00 SAST). We will also email you when we reply.',
    overdueHours: 4,
    emailCustomerOnReply: true,
    emailAdminsOnNew: true,
  },
};
export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const row = await db('settings').where({ key }).first('value');
  let v: unknown = row?.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return { ...DEFAULT_SETTINGS[key], ...((v as object) ?? {}) } as (typeof DEFAULT_SETTINGS)[K];
}

export async function setSetting(key: SettingKey | string, value: unknown, userId?: number | null) {
  const exists = await db('settings').where({ key }).first('key');
  void userId; // who changed it is recorded in the audit log
  const row = { value: JSON.stringify(value), updated_at: new Date() };
  if (exists) await db('settings').where({ key }).update(row);
  else await db('settings').insert({ key, ...row });
}

/* =====================================================================================
 * Notifications (the existing `notifications` table) – in-portal, per user.
 * ===================================================================================== */
export interface Note {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Active staff users who hold ANY of the permissions (super admins always included). */
export async function staffWith(perms: string[], trx: Knex | Knex.Transaction = db): Promise<{ id: number; email: string; name: string }[]> {
  return trx('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .join('roles as r', 'r.id', 'ur.role_id')
    .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
    .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
    .where({ 'u.type': 'staff', 'u.status': 'active' })
    .where((b) => b.where('r.key', 'super_admin').orWhereIn('p.key', perms))
    .distinct('u.id', 'u.email', 'u.name');
}

export async function notifyUsers(userIds: number[], n: Note, trx: Knex | Knex.Transaction = db) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return 0;
  await trx('notifications').insert(ids.map((user_id) => ({ user_id, type: n.type, title: n.title.slice(0, 255), body: n.body ?? null, link: n.link ?? null })));
  return ids.length;
}

export async function notifyStaff(perms: string[], n: Note, trx: Knex | Knex.Transaction = db) {
  return notifyUsers((await staffWith(perms, trx)).map((u) => u.id), n, trx);
}

/* =====================================================================================
 * Rate limiting (same library the public forms use).
 * ===================================================================================== */
export const limit = (max: number, minutes: number, message = 'Too many requests. Please wait a few minutes and try again.') =>
  rateLimit({
    windowMs: minutes * 60_000,
    limit: config.isTest ? 10_000 : max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message } },
  });

/* =====================================================================================
 * Large uploads (installers, archives, videos, office documents).
 * Files stream to a temp file (never fully into memory), the first/last bytes are checked
 * against the file type the extension claims, then the file is moved into private storage.
 * ===================================================================================== */
const ROOT = resolve(process.env['STORAGE_DIR'] || join(process.cwd(), 'storage'));
export const TMP_DIR = join(ROOT, 'tmp');

type Kind = 'installer' | 'archive' | 'video' | 'document' | 'pdf' | 'image';
interface FileType {
  kind: Kind;
  mime: string;
  check: (head: Buffer, tail: Buffer) => boolean;
}
const at = (b: Buffer, off: number, bytes: number[]) => bytes.every((x, i) => b[off + i] === x);
const ascii = (b: Buffer, off: number, s: string) => b.toString('latin1', off, off + s.length) === s;
const ZIP = (h: Buffer) => at(h, 0, [0x50, 0x4b, 0x03, 0x04]) || at(h, 0, [0x50, 0x4b, 0x05, 0x06]);
const OLE = (h: Buffer) => at(h, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MZ = (h: Buffer) => ascii(h, 0, 'MZ');

/** Allowed extensions → expected content. Anything else is rejected. (SVG/HTML/scripts are never accepted.) */
export const FILE_TYPES: Record<string, FileType> = {
  exe: { kind: 'installer', mime: 'application/vnd.microsoft.portable-executable', check: MZ },
  msi: { kind: 'installer', mime: 'application/x-msi', check: OLE },
  msix: { kind: 'installer', mime: 'application/msix', check: ZIP },
  appx: { kind: 'installer', mime: 'application/appx', check: ZIP },
  apk: { kind: 'installer', mime: 'application/vnd.android.package-archive', check: ZIP },
  aab: { kind: 'installer', mime: 'application/octet-stream', check: ZIP },
  ipa: { kind: 'installer', mime: 'application/octet-stream', check: ZIP },
  dmg: { kind: 'installer', mime: 'application/x-apple-diskimage', check: (_h, t) => t.length >= 512 && ascii(t, t.length - 512, 'koly') },
  pkg: { kind: 'installer', mime: 'application/octet-stream', check: (h) => ascii(h, 0, 'xar!') },
  deb: { kind: 'installer', mime: 'application/vnd.debian.binary-package', check: (h) => ascii(h, 0, '!<arch>') },
  rpm: { kind: 'installer', mime: 'application/x-rpm', check: (h) => at(h, 0, [0xed, 0xab, 0xee, 0xdb]) },
  appimage: { kind: 'installer', mime: 'application/octet-stream', check: (h) => at(h, 0, [0x7f, 0x45, 0x4c, 0x46]) },
  zip: { kind: 'archive', mime: 'application/zip', check: ZIP },
  '7z': { kind: 'archive', mime: 'application/x-7z-compressed', check: (h) => at(h, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  rar: { kind: 'archive', mime: 'application/vnd.rar', check: (h) => ascii(h, 0, 'Rar!') },
  gz: { kind: 'archive', mime: 'application/gzip', check: (h) => at(h, 0, [0x1f, 0x8b]) },
  tgz: { kind: 'archive', mime: 'application/gzip', check: (h) => at(h, 0, [0x1f, 0x8b]) },
  mp4: { kind: 'video', mime: 'video/mp4', check: (h) => ascii(h, 4, 'ftyp') },
  m4v: { kind: 'video', mime: 'video/mp4', check: (h) => ascii(h, 4, 'ftyp') },
  mov: { kind: 'video', mime: 'video/quicktime', check: (h) => ascii(h, 4, 'ftyp') || ascii(h, 4, 'moov') || ascii(h, 4, 'wide') },
  webm: { kind: 'video', mime: 'video/webm', check: (h) => at(h, 0, [0x1a, 0x45, 0xdf, 0xa3]) },
  pdf: { kind: 'pdf', mime: 'application/pdf', check: (h) => ascii(h, 0, '%PDF-') },
  docx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: ZIP },
  xlsx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: ZIP },
  pptx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: ZIP },
  doc: { kind: 'document', mime: 'application/msword', check: OLE },
  xls: { kind: 'document', mime: 'application/vnd.ms-excel', check: OLE },
  csv: { kind: 'document', mime: 'text/csv', check: (h) => !h.subarray(0, 512).some((b) => b === 0) && !/<\s*(script|html|svg)/i.test(h.toString('utf8', 0, 512)) },
  txt: { kind: 'document', mime: 'text/plain', check: (h) => !h.subarray(0, 512).some((b) => b === 0) && !/<\s*(script|html|svg)/i.test(h.toString('utf8', 0, 512)) },
  jpg: { kind: 'image', mime: 'image/jpeg', check: (h) => at(h, 0, [0xff, 0xd8, 0xff]) },
  jpeg: { kind: 'image', mime: 'image/jpeg', check: (h) => at(h, 0, [0xff, 0xd8, 0xff]) },
  png: { kind: 'image', mime: 'image/png', check: (h) => at(h, 0, [0x89, 0x50, 0x4e, 0x47]) },
  webp: { kind: 'image', mime: 'image/webp', check: (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'WEBP') },
  gif: { kind: 'image', mime: 'image/gif', check: (h) => ascii(h, 0, 'GIF8') },
};
export const MAX_UPLOAD_MB = Number(process.env['MAX_UPLOAD_MB'] || 1024);
const LIMITS_MB: Record<Kind, number> = { installer: MAX_UPLOAD_MB, archive: MAX_UPLOAD_MB, video: Math.min(MAX_UPLOAD_MB, 1024), document: 50, pdf: 50, image: 5 };

export function extOf(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith('.tar.gz')) return 'tgz';
  return (n.match(/\.([a-z0-9]{1,10})$/) ?? [])[1] ?? '';
}

/** Check a temp file. Returns its type or an error message for the admin. */
export async function inspectUpload(path: string, originalName: string, size: number): Promise<{ ext: string; type: FileType } | { error: string }> {
  const ext = extOf(originalName);
  const type = FILE_TYPES[ext];
  if (!type) return { error: `“.${ext || '?'}” files can't be uploaded. Allowed: ${Object.keys(FILE_TYPES).join(', ')}.` };
  if (size > LIMITS_MB[type.kind] * 1024 * 1024) return { error: `This ${type.kind} is larger than ${LIMITS_MB[type.kind]} MB.` };
  if (!size) return { error: 'The file is empty.' };
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(4096, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(4096, size);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    if (!type.check(head, tail)) return { error: `The file's contents don't match a .${ext} file. Please check you chose the right file.` };
  } finally {
    await fh.close();
  }
  return { ext, type };
}

/** Move a checked temp file into private storage. Same key format as services/storage.ts. */
export async function storeTempFile(tmp: string, folder: string, ext: string) {
  const d = new Date();
  const key = `${folder}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(18)}.${ext.replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
  const dest = join(ROOT, key);
  await mkdir(dirname(dest), { recursive: true });
  const hash = createHash('sha256');
  await new Promise<void>((ok, fail) => createReadStream(tmp).on('data', (c) => hash.update(c)).on('end', () => ok()).on('error', fail));
  try {
    await rename(tmp, dest);
  } catch {
    await copyFile(tmp, dest);
    await unlink(tmp).catch(() => undefined);
  }
  const st = await stat(dest);
  return { storageKey: key, size: st.size, sha256: hash.digest('hex') };
}

/* =====================================================================================
 * Signed, short-lived tokens (download links) – HMAC with APP_SECRET.
 * ===================================================================================== */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac('tok:' + body)}`;
}
export function readToken<T>(token: string): (T & { exp: number }) | null {
  const [body, sig] = String(token).split('.');
  if (!body || !sig || !safeEqual(sig, hmac('tok:' + body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

/* =====================================================================================
 * Licensing signatures (Ed25519). Installed apps verify offline tokens with the PUBLIC key only;
 * the private key never leaves the server and is stored encrypted with APP_SECRET.
 * ===================================================================================== */
const KEY_SETTING = 'licensing.keys';
const aesKey = () => createHash('sha256').update('licensing:' + config.appSecret).digest();
let cached: { publicKey: string; privateKey: string } | null = null;

export async function licensingKeys() {
  if (cached) return cached;
  const row = await db('settings').where({ key: KEY_SETTING }).first('value');
  let v = row?.value;
  if (typeof v === 'string') v = JSON.parse(v);
  if (v?.publicKey && v?.privateKeyEnc) {
    const [iv, tag, data] = String(v.privateKeyEnc).split('.').map((s: string) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', aesKey(), iv);
    d.setAuthTag(tag);
    cached = { publicKey: v.publicKey, privateKey: Buffer.concat([d.update(data), d.final()]).toString('utf8') };
    return cached;
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([c.update(privateKey, 'utf8'), c.final()]);
  const privateKeyEnc = [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
  await setSetting(KEY_SETTING, { publicKey, privateKeyEnc, createdAt: new Date().toISOString() });
  cached = { publicKey, privateKey };
  return cached;
}

export async function signLicence(payload: Record<string, unknown>) {
  const { privateKey } = await licensingKeys();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = edSign(null, Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${sig}`;
}


/* =====================================================================================
 * Secrets in settings (WhatsApp token etc.) – AES-256-GCM with a key derived from APP_SECRET.
 * Never returned to the browser; the admin UI only sees whether each one is set.
 * ===================================================================================== */
const secretKey = () => createHash('sha256').update('settings-secret:' + config.appSecret).digest();
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
export function decryptSecret(blob: string | null | undefined): string {
  if (!blob) return '';
  try {
    const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', secretKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}
const SECRETS_KEY = 'whatsapp.secrets';
export type WaSecret = 'accessToken' | 'appSecret' | 'verifyToken';
const ENV_SECRET: Record<WaSecret, string> = { accessToken: 'WHATSAPP_ACCESS_TOKEN', appSecret: 'WHATSAPP_APP_SECRET', verifyToken: 'WHATSAPP_VERIFY_TOKEN' };
export async function getWaSecret(name: WaSecret): Promise<string> {
  if (process.env[ENV_SECRET[name]]) return process.env[ENV_SECRET[name]]!;
  const row = await db('settings').where({ key: SECRETS_KEY }).first('value');
  let v = row?.value;
  if (typeof v === 'string') v = JSON.parse(v);
  return decryptSecret(v?.[name]);
}
export async function setWaSecrets(values: Partial<Record<WaSecret, string>>) {
  const row = await db('settings').where({ key: SECRETS_KEY }).first('value');
  let v = row?.value ?? {};
  if (typeof v === 'string') v = JSON.parse(v);
  for (const [k, val] of Object.entries(values)) if (val) v[k] = encryptSecret(val);
  await setSetting(SECRETS_KEY, v);
}
export async function waSecretStatus() {
  const out: Record<string, 'env' | 'set' | 'missing'> = {};
  for (const k of Object.keys(ENV_SECRET) as WaSecret[]) out[k] = process.env[ENV_SECRET[k]] ? 'env' : (await getWaSecret(k)) ? 'set' : 'missing';
  return out;
}

/** Department inbox: support or sales (Admin › Email settings). */
export async function inbox(dept: 'support' | 'sales') {
  const s = await getSetting('email.departments');
  return dept === 'sales' ? s.sales : s.support;
}

/**
 * Where a team notification goes. Business partner registrations and purchase/quotation enquiries are
 * routed by the choices in Admin › Email settings; everything else goes to the support inbox.
 */
export async function inboxFor(kind: 'partner' | 'purchase' | 'support') {
  const s = await getSetting('email.departments');
  const dept = kind === 'partner' ? s.partnerInbox : kind === 'purchase' ? s.purchaseInbox : 'support';
  return dept === 'sales' ? s.sales : s.support;
}

/** The two sending mailboxes (credentials only ever come from the server's .env). */
export function mailAccounts() {
  const host = process.env['MAIL_HOST'] || null;
  const port = Number(process.env['MAIL_PORT'] || 587);
  const supportFrom = process.env['MAIL_FROM'] || 'SCHLUSS <no-reply@schluss.co.za>';
  const salesUser = process.env['MAIL_SALES_USER'] || null;
  return {
    host, port, configured: !!host,
    support: { user: process.env['MAIL_USER'] || null, from: supportFrom, passwordSet: !!process.env['MAIL_PASSWORD'] },
    sales: { separate: !!(host && salesUser), user: salesUser, from: salesUser ? process.env['MAIL_SALES_FROM'] || `SCHLUSS Sales <${salesUser}>` : supportFrom, passwordSet: !!process.env['MAIL_SALES_PASSWORD'] },
  };
}


/* =====================================================================================
 * Malware scanning – uses ClamAV (clamdscan or clamscan) when it is installed on the server.
 * Without it, files are still type-checked, stored privately and marked "not scanned" in the admin.
 * ===================================================================================== */
import { execFile } from 'node:child_process';
let scanner: string | null | undefined;
async function findScanner() {
  if (scanner !== undefined) return scanner;
  for (const bin of [process.env['CLAMSCAN_PATH'], 'clamdscan', 'clamscan'].filter(Boolean) as string[]) {
    const ok = await new Promise<boolean>((r) => execFile(bin, ['--version'], { timeout: 5000 }, (e) => r(!e)));
    if (ok) return (scanner = bin);
  }
  return (scanner = null);
}
export async function scannerInfo() {
  return { available: !!(await findScanner()), command: scanner ?? null, required: process.env['MALWARE_SCAN'] === 'required' };
}
export async function scanFile(path: string): Promise<{ status: 'clean' | 'infected' | 'error' | 'not_available'; detail?: string }> {
  const bin = await findScanner();
  if (!bin) return { status: 'not_available' };
  return new Promise((resolve) =>
    execFile(bin, ['--no-summary', path], { timeout: 120_000 }, (err, stdout) => {
      const code = (err as { code?: number } | null)?.code ?? 0;
      if (!err) resolve({ status: 'clean' });
      else if (code === 1) resolve({ status: 'infected', detail: String(stdout).split(':').pop()?.trim().slice(0, 120) || 'threat found' });
      else resolve({ status: 'error', detail: String(err.message).slice(0, 200) });
    }),
  );
}

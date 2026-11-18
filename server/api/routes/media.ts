import { Router, type Request } from 'express';
import { db } from '../db';
import { ah, forbidden, notFound, unauthorised } from '../http';
import { can } from '../middleware/auth';
import { fileStat, readStream } from '../services/storage';

/**
 * Authorised file delivery. Storage paths are never exposed; every request is checked here.
 *   public   → anyone          customer → any signed-in customer/partner/staff
 *   partner  → approved partners and staff     staff → staff with products.view or media.manage
 */
export const mediaRouter = Router();

function allowed(req: Request, visibility: string): 'ok' | 'login' | 'deny' {
  const a = req.auth;
  if (visibility === 'public') return 'ok';
  if (!a) return 'login';
  if (a.user.type === 'staff') return can(req, 'products.view') || can(req, 'media.manage') ? 'ok' : 'deny';
  if (visibility === 'customer') return 'ok';
  if (visibility === 'partner') return a.user.type === 'partner' && a.partnerStatus === 'approved' ? 'ok' : 'deny';
  return 'deny';
}

mediaRouter.get(
  '/:id/:name',
  ah(async (req, res) => {
    const m = await db('media').where({ id: Number(req.params['id']) || 0 }).first();
    if (!m || !m.storage_key) throw notFound('File not found.');
    const verdict = allowed(req, m.visibility);
    if (verdict === 'login') throw unauthorised('Please sign in to open this file.');
    if (verdict === 'deny') throw forbidden('You do not have access to this file.');
    const st = await fileStat(m.storage_key);
    if (!st) throw notFound('File not found.');

    const etag = `"${m.sha256 ?? m.id}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const safeName = String(m.original_name || m.title || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const inline = /^image\//.test(m.mime) || m.mime === 'application/pdf';
    res.set({
      'Content-Type': m.mime || 'application/octet-stream',
      'Content-Length': String(st.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      ETag: etag,
      'Cache-Control': m.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store',
    });
    readStream(m.storage_key).pipe(res);
  }),
);

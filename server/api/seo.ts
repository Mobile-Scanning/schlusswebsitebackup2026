import { Router } from 'express';
import { config } from './config';
import { db } from './db';

/** robots.txt + sitemap.xml generated from live data, so new products are indexed automatically. */
export const seoRouter = Router();

const STATIC = ['/', '/products', '/coming-soon', '/partners', '/about', '/contact', '/privacy', '/terms'];

seoRouter.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600');
  res.send(
    [
      'User-agent: *',
      'Disallow: /api/',
      'Disallow: /account',
      'Disallow: /partner',
      'Disallow: /admin',
      'Disallow: /login',
      'Disallow: /register',
      'Disallow: /forgot-password',
      'Disallow: /reset-password',
      '',
      `Sitemap: ${config.appUrl}/sitemap.xml`,
      '',
    ].join('\n'),
  );
});

seoRouter.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const products = await db('products').where({ is_published: true, is_archived: false }).select('slug', 'updated_at');
    const cats = await db('product_categories').where('is_active', true).select('slug', 'updated_at');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const url = (loc: string, lastmod?: Date) => `<url><loc>${esc(config.appUrl + loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
    const body = [
      ...STATIC.map((p) => url(p)),
      ...cats.map((c) => url(`/products?category=${encodeURIComponent(c.slug)}`, c.updated_at)),
      ...products.map((p) => url(`/products/${encodeURIComponent(p.slug)}`, p.updated_at)),
    ].join('');
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
  } catch (e) {
    next(e);
  }
});

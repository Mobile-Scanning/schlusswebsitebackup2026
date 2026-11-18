import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createApi } from '../server/api';
import { checkDatabase } from '../server/api/db';
import { seoRouter } from '../server/api/seo';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// cPanel/Passenger (and most hosts) sit behind a reverse proxy – needed for correct client IPs & HTTPS detection.
app.set('trust proxy', 1);
app.disable('x-powered-by');
const isProd = process.env['NODE_ENV'] === 'production';

/** Production only: everything is served over HTTPS (the host's proxy tells us how the visitor connected). */
app.use((req, res, next) => {
  if (isProd && req.headers['x-forwarded-proto'] && !req.secure && process.env['FORCE_HTTPS'] !== 'off') {
    const host = String(req.headers['host'] || '').replace(/[^A-Za-z0-9.:-]/g, '');
    res.redirect(308, `https://${host}${req.originalUrl}`);
    return;
  }
  next();
});

/**
 * Security headers.
 * Content-Security-Policy: scripts, styles, fonts and connections only from this website; video players only from
 * YouTube (no-cookie) and Vimeo; pictures from this site plus the YouTube/Vimeo thumbnail servers; nobody may put
 * the site in a frame (clickjacking); forms only post back to this site.
 * (Angular's server-rendered pages carry small inline scripts/styles, which are allowed; nothing else is.)
 */
const csp: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://i.vimeocdn.com', ...(!isProd && process.env['YOUTUBE_THUMB_BASE'] ? [process.env['YOUTUBE_THUMB_BASE']] : [])],
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'", 'blob:'],
  'connect-src': ["'self'"],
  'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  ...(isProd ? { 'upgrade-insecure-requests': [] } : {}),
};
const cspOn = process.env['CSP'] !== 'off';
const cspReportOnly = process.env['CSP'] === 'report-only';
const cspHeader = (scriptHashes: string[] = []) =>
  Object.entries(csp)
    .map(([k, v]) => `${k} ${(k === 'script-src' ? [...v, ...scriptHashes] : v).join(' ')}`.trim())
    .join(';');
app.use(
  helmet({
    contentSecurityPolicy: cspOn ? { useDefaults: false, directives: csp, reportOnly: cspReportOnly } : false,
    crossOriginEmbedderPolicy: false,
    // Browsers remember for a year that this site is HTTPS-only (sent in production only – it must never be sent from a test machine).
    strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
  }),
);
app.use((_req, res, next) => {
  // The website never needs these device features; embedded video players may go fullscreen.
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=(), fullscreen=(self "https://www.youtube-nocookie.com" "https://player.vimeo.com")');
  next();
});

/** The one backend API – same process, same database. */
// Report database problems once, in plain words, when the first request arrives.
let dbChecked = false;
app.use((_req, _res, next) => {
  if (!dbChecked) {
    dbChecked = true;
    void checkDatabase();
  }
  next();
});
app.use('/api', createApi());
app.use(seoRouter);

/** Private areas must never be indexed by search engines. */
app.use(['/account', '/partner', '/admin', '/login', '/register', '/reset-password', '/forgot-password'], (_req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

/** Serve static files from /browser */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/** Handle all other requests by rendering the Angular application. */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(async (response) => {
      if (!response) return next();
      // Angular's rendered pages contain a few small inline scripts of its own (never visitor input). Instead of
      // allowing ALL inline scripts, each page's CSP lists the exact fingerprint (SHA-256) of the ones it contains –
      // so an injected script would not run.
      if (cspOn && (response.headers.get('content-type') || '').includes('text/html')) {
        const html = await response.text();
        const hashes = new Set<string>();
        for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
          if (/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1]) || !m[2]) continue; // data, not code
          hashes.add(`'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`);
        }
        res.setHeader(cspReportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', cspHeader([...hashes]));
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return writeResponseToNodeResponse(new Response(html, { status: response.status, statusText: response.statusText, headers }), res);
      }
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is run via PM2 / Passenger.
 */
if (isMainModule(import.meta.url) || process.env['pm_id'] || process.env['PASSENGER_APP_ENV']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }
    console.log(`SCHLUSS server listening on http://localhost:${port}`);
  });
}

/** Request handler used by the Angular CLI (for dev-server and during build). */
export const reqHandler = createNodeRequestHandler(app);

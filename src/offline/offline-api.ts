import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { delay, Observable, of, throwError } from 'rxjs';
import sample from './sample-data.json';

/**
 * Offline preview only (npm run build:offline).
 * Answers the website's API calls from a bundled snapshot so index.html can be
 * opened by double-clicking, with no server or database. Forms and sign-in are
 * not sent anywhere – they return a clear "preview mode" message instead.
 */
type Card = (typeof sample.products)[number];
const PREVIEW_MSG = 'This is the offline preview, so nothing was sent. Run the full app (npm start) to submit forms and sign in.';

const ok = <T>(body: T) => of(new HttpResponse({ status: 200, body })).pipe(delay(60));
const fail = (status: number, message: string, url: string): Observable<never> =>
  throwError(() => new HttpErrorResponse({ status, statusText: message, url, error: { error: { message } } }));

const site = {
  ...sample.site,
  banner: { enabled: true, text: 'Offline preview – browsing works; forms and sign-in need the full app (see START-HERE.md).', link: '' },
};

function planModels(slug: string): string[] {
  const d = (sample.details as Record<string, { plans?: { model: string; price_cents: number | null }[] }>)[slug];
  return (d?.plans ?? []).map((p) => (p.price_cents != null && !['free', 'quote'].includes(p.model) ? `paid:${p.model}` : p.model));
}

function listProducts(req: HttpRequest<unknown>) {
  const p = req.params;
  const q = (p.get('q') ?? '').toLowerCase().trim();
  const page = Math.max(1, Number(p.get('page') ?? 1));
  const perPage = Math.min(48, Math.max(1, Number(p.get('perPage') ?? 12)));
  let rows: Card[] = [...sample.products];
  if (q) rows = rows.filter((r) => [r.name, r.shortDescription, r.tagline].some((t) => (t ?? '').toLowerCase().includes(q)));
  if (p.get('category')) rows = rows.filter((r) => r.category?.slug === p.get('category'));
  if (p.get('status')) rows = rows.filter((r) => r.status === p.get('status'));
  if (p.get('type')) rows = rows.filter((r) => r.productType === p.get('type'));
  if (p.get('featured')) rows = rows.filter((r) => r.featured);
  const price = p.get('price');
  if (price) {
    rows = rows.filter((r) => {
      const m = planModels(r.slug);
      if (price === 'trial') return (r.trialDays ?? 0) > 0 || m.includes('trial');
      if (price === 'paid') return m.some((x) => x.startsWith('paid:'));
      return m.includes(price);
    });
  }
  const sort = p.get('sort');
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'popular') rows.sort((a, b) => sample.popular.indexOf(a.slug) - sample.popular.indexOf(b.slug));
  return { data: rows.slice((page - 1) * perPage, page * perPage), meta: { page, perPage, total: rows.length } };
}

function listLearning(req: HttpRequest<unknown>) {
  const p = req.params;
  const q = (p.get('q') ?? '').toLowerCase().trim();
  return sample.learning.filter(
    (l) =>
      (!p.get('product') || (l.product as { slug?: string } | null)?.slug === p.get('product')) &&
      (!p.get('section') || l.section === p.get('section')) &&
      (!q || [l.title, l.summary].some((t) => (t ?? '').toLowerCase().includes(q))),
  );
}

export const offlineApiInterceptor: HttpInterceptorFn = (req) => {
  const path = req.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (req.method === 'GET') {
    if (path === '/api/public/site') return ok(site);
    if (path === '/api/public/categories') return ok(sample.categories);
    if (path === '/api/public/product-types') return ok(sample.productTypes);
    if (path === '/api/public/products') return ok(listProducts(req));
    if (path.startsWith('/api/public/products/')) {
      const d = (sample.details as Record<string, unknown>)[decodeURIComponent(path.slice(21))];
      return d ? ok(d) : fail(404, 'Product not found', req.url);
    }
    if (path === '/api/public/learning') return ok(listLearning(req));
    if (path.startsWith('/api/public/learning/')) {
      const d = (sample.learningItems as Record<string, unknown>)[path.slice(21)];
      return d ? ok(d) : fail(404, 'Item not found', req.url);
    }
    if (path === '/api/auth/csrf') return ok({});
    if (path === '/api/auth/me') return fail(401, 'Not signed in', req.url);
    // Chat: show the panel, but sending needs the real server.
    if (path === '/api/support/unread') return ok({ unread: 0 });
    if (path === '/api/support/conversations') return ok([]);
    if (path === '/api/support/info') return ok({ availability: 'This is the offline preview – chat messages are sent when the website runs on its server.', categories: [], unread: 0, conversations: 0, signedIn: false, name: null });
  }
  return fail(503, PREVIEW_MSG, req.url);
};

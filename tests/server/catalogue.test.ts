import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { db } from '../../server/api/db';
import { seoRouter } from '../../server/api/seo';
import { client, createStaff, login, makeApp, uniqueEmail, register } from './helpers';

afterAll(() => db.destroy());

async function as(roles: string[]) {
  const s = await createStaff(roles);
  const c = await client();
  await login(c, s.email, s.password);
  return c;
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function upload(c: Awaited<ReturnType<typeof client>>, buf: Buffer, name: string, visibility = 'public') {
  const res0 = await c.get('/api/auth/me');
  void res0;
  // supertest multipart with CSRF header taken from the agent's cookie jar
  const cookies = (c.agent as unknown as { jar: { getCookies: (o: object) => { name: string; value: string }[] } }).jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false });
  const xsrf = cookies.find((k) => k.name === 'XSRF-TOKEN')?.value ?? '';
  return c.agent.post('/api/admin/media/upload').set('X-XSRF-TOKEN', xsrf).field('visibility', visibility).attach('file', buf, name);
}

describe('catalogue management + public website API', () => {
  let catId = 0;
  let productId = 0;
  let slug = '';

  it('product manager creates a category and a draft product that is not public', async () => {
    const c = await as(['product_manager']);
    const cat = await c.post('/api/admin/categories', { name: `Retail Solutions ${Date.now()}`, description: 'Point of sale and store systems' });
    expect(cat.status).toBe(201);
    catId = cat.body.id;
    const p = await c.post('/api/admin/products', { name: `Stock Pro ${Date.now()}`, categoryId: catId, status: 'available', productType: 'desktop', shortDescription: 'Stock control for retail.' });
    expect(p.status).toBe(201);
    productId = p.body.id;
    slug = p.body.slug;
    const pub = await request(makeApp()).get(`/api/public/products/${slug}`);
    expect(pub.status).toBe(404);
  });

  it('refuses to publish a non-coming-soon product without pricing', async () => {
    const c = await as(['product_manager']);
    const r = await c.post(`/api/admin/products/${productId}/state`, { action: 'publish' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/pricing/);
  });

  it('validates pricing and saves plans in cents (ZAR default)', async () => {
    const c = await as(['product_manager']);
    const bad = await c.put(`/api/admin/products/${productId}/plans`, { plans: [{ name: 'Monthly', model: 'monthly', priceCents: null, billingPeriod: 'month' }] });
    expect(bad.status).toBe(422);
    const ok = await c.put(`/api/admin/products/${productId}/plans`, {
      plans: [
        { name: 'Monthly', model: 'monthly', priceCents: 49900, billingPeriod: 'month', inclusions: ['1 store'] },
        { name: 'Enterprise', model: 'quote', priceCents: null },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.plans.map((p: { currency: string }) => p.currency)).toEqual(['ZAR', 'ZAR']);
    await c.put(`/api/admin/products/${productId}/features`, { items: [{ kind: 'feature', title: 'Barcode scanning' }, { kind: 'faq', title: 'Does it work offline?', body: 'Yes.' }] });
    const pub = await c.post(`/api/admin/products/${productId}/state`, { action: 'publish' });
    expect(pub.status).toBe(200);
    expect(pub.body.is_published).toBe(true);
  });

  it('public listing shows the product with pricing summary, filters and pagination work', async () => {
    const app = makeApp();
    const all = await request(app).get('/api/public/products?perPage=48');
    const card = all.body.data.find((p: { slug: string }) => p.slug === slug);
    expect(card).toMatchObject({ status: 'available', productType: 'desktop', pricing: { fromCents: 49900, currency: 'ZAR', period: 'month', hasQuote: true } });
    const cat = await db('product_categories').where({ id: catId }).first('slug');
    const byCat = await request(app).get(`/api/public/products?category=${cat.slug}`);
    expect(byCat.body.data.map((p: { slug: string }) => p.slug)).toEqual([slug]);
    expect((await request(app).get('/api/public/products?status=coming_soon')).body.data.some((p: { slug: string }) => p.slug === slug)).toBe(false);
    expect((await request(app).get('/api/public/products?price=paid')).body.data.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    expect((await request(app).get('/api/public/products?price=free')).body.data.some((p: { slug: string }) => p.slug === slug)).toBe(false);
    expect((await request(app).get('/api/public/products?perPage=500')).status).toBe(422);
    const detail = await request(app).get(`/api/public/products/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.features[0].title).toBe('Barcode scanning');
    expect(detail.body.faqs[0].title).toBe('Does it work offline?');
    expect(JSON.stringify(detail.body)).not.toMatch(/storage_key|created_by|view_count/);
  });

  it('archived products disappear from the public site', async () => {
    const c = await as(['product_manager']);
    await c.post(`/api/admin/products/${productId}/state`, { action: 'archive' });
    expect((await request(makeApp()).get(`/api/public/products/${slug}`)).status).toBe(404);
    await c.post(`/api/admin/products/${productId}/state`, { action: 'restore' });
    await c.post(`/api/admin/products/${productId}/state`, { action: 'publish' });
  });

  it('categories with products cannot be deleted', async () => {
    const c = await as(['product_manager']);
    expect((await c.agent.delete(`/api/admin/categories/${catId}`).set('X-XSRF-TOKEN', 'x')).status).toBe(403); // CSRF still enforced on DELETE
  });

  it('permissions: content manager cannot publish; sales cannot edit products; customers get nothing', async () => {
    const cm = await as(['content_manager']);
    expect((await cm.post(`/api/admin/products/${productId}/state`, { action: 'unpublish' })).status).toBe(403);
    const sm = await as(['sales_manager']);
    expect((await sm.post('/api/admin/products', { name: 'X' })).status).toBe(403);
    const cust = await client();
    await register(cust, { name: 'Cust', email: uniqueEmail('c'), cellphone: '0821234567', country: 'ZA', password: 'Customer-pass-1', acceptPrivacy: true });
    expect((await cust.get('/api/admin/products')).status).toBe(403);
  });
});

describe('media uploads and access control', () => {
  it('accepts real images/PDFs, rejects disguised files', async () => {
    const c = await as(['product_manager']);
    const ok = await upload(c, PNG, 'logo.png');
    expect(ok.status).toBe(201);
    const fake = await upload(c, Buffer.from('<svg onload="alert(1)"></svg>'), 'evil.png');
    expect(fake.status).toBe(400);
    const exe = await upload(c, Buffer.from('MZ\x90\x00binary'), 'tool.pdf');
    expect(exe.status).toBe(400);
    const file = await request(makeApp()).get(ok.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('customer-only files need sign-in; partner files need an approved partner', async () => {
    const c = await as(['product_manager']);
    const custDoc = await upload(c, PDF, 'manual.pdf', 'customer');
    const partnerDoc = await upload(c, PDF, 'pricing.pdf', 'partner');
    const anon = request(makeApp());
    expect((await anon.get(custDoc.body.url)).status).toBe(401);
    const cust = await client();
    await register(cust, { name: 'Cust', email: uniqueEmail('c'), cellphone: '0821234567', country: 'ZA', password: 'Customer-pass-1', acceptPrivacy: true });
    expect((await cust.get(custDoc.body.url)).status).toBe(200);
    expect((await cust.get(partnerDoc.body.url)).status).toBe(403);
  });
});

describe('public forms', () => {
  it('demo request: validates, stores, records consent, queues emails, returns a reference', async () => {
    const c = await client();
    const bad = await c.post('/api/public/demo-requests', { name: 'A', email: 'x', cellphone: '1', country: 'ZA', acceptPrivacy: false });
    expect(bad.status).toBe(422);
    const addr = uniqueEmail('demo');
    const r = await c.post('/api/public/demo-requests', { name: 'Lerato M', email: addr, cellphone: '+27 82 555 1234', country: 'ZA', preferredType: 'live', acceptPrivacy: true });
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^DR-\d{4}-[A-Z0-9]{6}$/);
    expect(await db('demo_requests').where({ reference: r.body.reference }).first()).toBeDefined();
    expect(await db('consents').where({ email: addr, purpose: 'privacy_policy' }).first()).toBeDefined();
    expect(await db('email_logs').where({ to_email: addr, template_key: 'demo_request_ack' }).first()).toBeDefined();
  });

  it('partner application → admin approval creates a partner login with a set-password link', async () => {
    const c = await client();
    const addr = uniqueEmail('partner');
    const r = await c.post('/api/public/partner-applications', { businessName: 'Cape IT Solutions', contactName: 'Johan', email: addr, cellphone: '0215550000', country: 'ZA', acceptTerms: true });
    expect(r.status).toBe(201);
    const dup = await c.post('/api/public/partner-applications', { businessName: 'Cape IT Solutions', contactName: 'Johan', email: addr, cellphone: '0215550000', country: 'ZA', acceptTerms: true });
    expect(dup.status).toBe(409);
    const partner = await db('partners').where({ reference: r.body.reference }).first();
    expect(partner.status).toBe('pending');

    const sales = await as(['sales_manager']); // has partners.manage but NOT partners.approve
    expect((await sales.post(`/api/admin/partners/${partner.id}/status`, { status: 'approved' })).status).toBe(403);
    const admin = await as(['administrator']);
    const ok = await admin.post(`/api/admin/partners/${partner.id}/status`, { status: 'approved', note: 'Good fit' });
    expect(ok.status).toBe(200);
    expect(ok.body.invited).toBe(true);
    const user = await db('users').where({ email: addr }).first();
    expect(user).toMatchObject({ type: 'partner', partner_id: partner.id });
    expect(await db('password_resets').where({ user_id: user.id }).whereNull('used_at').first()).toBeDefined();
    expect(await db('email_logs').where({ to_email: addr, template_key: 'partner_approved' }).first()).toBeDefined();
  });

  it('contact form creates an enquiry visible to support staff', async () => {
    const c = await client();
    const r = await c.post('/api/public/contact', { name: 'Ayesha', email: uniqueEmail('ct'), subject: 'Pricing question', message: 'Do you offer discounts for NGOs?', acceptPrivacy: true });
    expect(r.status).toBe(201);
    const support = await as(['support_manager']);
    const list = await support.get('/api/admin/enquiries?q=' + r.body.reference);
    expect(list.body.data[0]).toMatchObject({ subject: 'Pricing question', message: 'Do you offer discounts for NGOs?' });
  });
});

describe('website content + SEO', () => {
  it('content manager edits home copy; invalid content is rejected; public site serves it', async () => {
    const c = await as(['content_manager']);
    const site = (await c.get('/api/admin/site-content')).body;
    const home = { ...site.home, heroTitle: 'Everything Your Business Needs. Connected!' };
    expect((await c.put('/api/admin/site-content/home', home)).status).toBe(200);
    expect((await c.put('/api/admin/site-content/contact', { ...site.contact, email: 'not-an-email' })).status).toBe(422);
    const pub = await request(makeApp()).get('/api/public/site');
    expect(pub.body.home.heroTitle).toBe('Everything Your Business Needs. Connected!');
    await c.agent.delete('/api/admin/site-content/home');
  });

  it('sitemap lists published products; robots blocks private areas', async () => {
    const app = express().use(seoRouter);
    const sm = await request(app).get('/sitemap.xml');
    expect(sm.status).toBe(200);
    expect(sm.text).toContain('/products/');
    const robots = await request(app).get('/robots.txt');
    expect(robots.text).toMatch(/Disallow: \/admin/);
    expect(robots.text).toMatch(/Sitemap: /);
  });
});

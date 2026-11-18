import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createStaff, login, uniqueEmail } from './helpers';

const require = createRequire(import.meta.url);
type C = Awaited<ReturnType<typeof client>>;
let admin: C;
const lastTo = async (template: string) => (await db('email_logs').where({ template_key: template }).orderBy('id', 'desc').first())?.to_email;
const partner = () => ({ businessName: `Routing Partner ${Date.now()}`, contactName: 'Pat', email: uniqueEmail('route-partner'), cellphone: '0215550000', country: 'ZA', acceptTerms: true });

beforeAll(async () => {
  const a = await createStaff(['super_admin']);
  admin = await client();
  await login(admin, a.email, a.password);
  await db('settings').where({ key: 'email.departments' }).del(); // start from the defaults
});
afterAll(async () => {
  await db('settings').where({ key: 'email.departments' }).del();
  await db.destroy();
});

describe('who receives the team notification emails', () => {
  it('business partner registrations go to sales@; the applicant still gets a confirmation', async () => {
    const p = partner();
    const r = await (await client()).post('/api/public/partner-applications', p);
    expect(r.status).toBe(201);
    expect(await lastTo('partner_application_admin')).toBe('sales@schluss.co.za');
    expect(await db('email_logs').where({ to_email: p.email, template_key: 'partner_application_ack' }).first()).toBeDefined();
    // Exactly one team notification – nothing is copied to support.
    const logs = await db('email_logs').where({ template_key: 'partner_application_admin' }).orderBy('id', 'desc').limit(1);
    expect(logs).toHaveLength(1);
  });

  it('everything else goes to support@: purchase enquiries, contact messages, demo requests, chat', async () => {
    const c = await client();
    const prod = await db('products').where({ is_published: true }).first('slug');
    const e = await c.post('/api/public/purchase-enquiry', { name: 'Eve', email: uniqueEmail('route-buy'), product: prod.slug, quantity: 2, message: 'Quote please', acceptPrivacy: true });
    expect([201, 409]).toContain(e.status);
    const g = await c.post('/api/public/contact', { name: 'Gil', email: uniqueEmail('route-gen'), subject: 'Question', message: 'A general question about your products', enquiryType: 'general', acceptPrivacy: true });
    expect(g.status).toBe(201);
    expect(await lastTo('support_enquiry')).toBe('support@schluss.co.za');
    const b = await c.post('/api/public/contact', { name: 'Bea', email: uniqueEmail('route-pur'), subject: 'Buying', message: 'I would like to purchase ten licences please', enquiryType: 'purchase', acceptPrivacy: true });
    expect(b.status).toBe(201);
    expect(b.body.department).toBe('sales'); // still listed under Sales enquiries in the admin
    expect(await lastTo('sales_enquiry')).toBe('support@schluss.co.za');
    const chat = await c.post('/api/support/conversations', { message: 'Please send me a quote for 5 licences', name: 'Chad', email: uniqueEmail('route-chat'), enquiryType: 'purchase', consent: true });
    expect(chat.status).toBe(201);
    expect(await lastTo('sales_enquiry')).toBe('support@schluss.co.za');
    // No team notification of any kind other than partner registrations was addressed to sales@ in this test file.
    const toSales = await db('email_logs').where({ to_email: 'sales@schluss.co.za' }).whereNot({ template_key: 'partner_application_admin' }).whereIn('template_key', ['sales_enquiry', 'support_enquiry', 'demo_request_admin', 'lead_new'])
      .where('created_at', '>=', db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 SECOND)'));
    expect(toSales).toHaveLength(0);
  });

  it('the routing can be changed in Admin › Email settings', async () => {
    const cur = (await admin.get('/api/admin/email-settings')).body;
    expect(cur.departments).toMatchObject({ partnerInbox: 'sales', purchaseInbox: 'support' });
    expect(JSON.stringify(cur)).not.toMatch(/password"\s*:\s*"/i); // only "set / missing", never the password
    const saved = await admin.put('/api/admin/email-settings', { support: 'support@schluss.co.za', sales: 'sales@schluss.co.za', customerAck: true, partnerInbox: 'support', purchaseInbox: 'sales' });
    expect(saved.status).toBe(200);
    await (await client()).post('/api/public/partner-applications', partner());
    expect(await lastTo('partner_application_admin')).toBe('support@schluss.co.za');
    const b = await (await client()).post('/api/public/contact', { name: 'Bea', email: uniqueEmail('route-pur2'), subject: 'Buying', message: 'I would like to purchase ten licences please', enquiryType: 'purchase', acceptPrivacy: true });
    expect(b.status).toBe(201);
    expect(await lastTo('sales_enquiry')).toBe('sales@schluss.co.za');
    // Settings saved by an older version (without the new choices) fall back to the defaults.
    await db('settings').where({ key: 'email.departments' }).update({ value: JSON.stringify({ support: 'support@schluss.co.za', sales: 'sales@schluss.co.za', customerAck: true }) });
    await (await client()).post('/api/public/partner-applications', partner());
    expect(await lastTo('partner_application_admin')).toBe('sales@schluss.co.za');
  });
});

describe('which mailbox sends each email', () => {
  const worker = require('../../server/cli/worker.cjs');
  afterAll(() => worker.knex.destroy());
  it('partner emails use the sales mailbox, everything else the support mailbox', () => {
    for (const t of ['partner_application_ack', 'partner_application_admin', 'partner_approved', 'partner_rejected', 'partner_reactivated']) expect(worker.accountFor({ template: t })).toBe('sales');
    for (const t of ['email_otp', 'welcome_customer', 'password_reset', 'support_enquiry', 'sales_enquiry', 'sales_ack', 'demo_request_admin', 'contact_ack', 'trial_started', 'system_alert']) expect(worker.accountFor({ template: t })).toBe('support');
    expect(worker.accountFor({ template: 'email_test', account: 'sales' })).toBe('sales');
  });
  it('each mailbox logs in as itself and sends from its own address', () => {
    const keep = { ...process.env };
    Object.assign(process.env, { MAIL_HOST: 'smtp.example.test', MAIL_PORT: '465', MAIL_USER: 'support@schluss.co.za', MAIL_PASSWORD: 'a', MAIL_FROM: 'SCHLUSS <support@schluss.co.za>', MAIL_SALES_USER: 'sales@schluss.co.za', MAIL_SALES_PASSWORD: 'b' });
    delete process.env['MAIL_TRANSPORT'];
    delete process.env['MAIL_SALES_FROM'];
    const t = worker.transport();
    expect(t.support.mailer.options).toMatchObject({ host: 'smtp.example.test', port: 465, secure: true, auth: { user: 'support@schluss.co.za', pass: 'a' } });
    expect(t.sales.mailer.options).toMatchObject({ secure: true, auth: { user: 'sales@schluss.co.za', pass: 'b' } });
    expect(t.sales.from).toBe('SCHLUSS Sales <sales@schluss.co.za>');
    // Without a separate sales login, partner emails fall back to the support mailbox.
    delete process.env['MAIL_SALES_USER'];
    expect(worker.transport().sales.from).toBe('SCHLUSS <support@schluss.co.za>');
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  });
});

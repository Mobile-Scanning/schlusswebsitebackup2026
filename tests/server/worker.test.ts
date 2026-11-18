import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { db } from '../../server/api/db';
import { queueEmail } from '../../server/api/services/jobs';

const require = createRequire(import.meta.url);

describe('background email worker', () => {
  const worker = require('../../server/cli/worker.cjs');
  afterAll(async () => {
    await worker.knex.destroy();
    await db.destroy();
  });

  it('marks emails failed (not sent) when mail is not configured', async () => {
    delete process.env['MAIL_HOST'];
    delete process.env['MAIL_TRANSPORT'];
    await db('jobs').where({ status: 'pending' }).update({ status: 'done' });
    await queueEmail('nomail@test.schluss.co.za', 'welcome_customer', { name: 'X' });
    await worker.run();
    const log = await db('email_logs').where({ to_email: 'nomail@test.schluss.co.za' }).orderBy('id', 'desc').first();
    expect(log.status).toBe('failed');
    expect(log.error).toMatch(/not configured/);
  });

  it('renders the branded, escaped template and records delivery', async () => {
    process.env['MAIL_TRANSPORT'] = 'json';
    await queueEmail('sent@test.schluss.co.za', 'password_reset', { name: '<script>x</script>', resetUrl: 'https://schluss.co.za/reset-password?token=abc', minutes: 60 });
    expect(await worker.run()).toBeGreaterThanOrEqual(1);
    const log = await db('email_logs').where({ to_email: 'sent@test.schluss.co.za' }).orderBy('id', 'desc').first();
    expect(log.status).toBe('sent');
    expect(log.subject).toBe('Reset your SCHLUSS password');
    delete process.env['MAIL_TRANSPORT'];
  });

  it('escapes variables in templates', () => {
    const { render } = require('../../server/mail/layout.cjs');
    expect(render('Hi {{name}}', { name: '<b>x</b>' })).toBe('Hi &lt;b&gt;x&lt;/b&gt;');
  });
});

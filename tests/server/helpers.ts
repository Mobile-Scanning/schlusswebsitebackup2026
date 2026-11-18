import express from 'express';
import request from 'supertest';
import { createApi } from '../../server/api';
import { db } from '../../server/api/db';
import bcrypt from 'bcryptjs';

export function makeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api', createApi());
  return app;
}

/** A browser-like client: keeps cookies and sends the CSRF header like Angular does. */
export async function client(app = makeApp()) {
  const agent = request.agent(app);
  const res = await agent.get('/api/auth/csrf');
  let xsrf = /XSRF-TOKEN=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
  const capture = (r: request.Response) => {
    const m = /XSRF-TOKEN=([^;]+)/.exec(String(r.headers['set-cookie'] ?? ''));
    if (m) xsrf = m[1];
    return r;
  };
  return {
    agent,
    get: (url: string) => agent.get(url).then(capture),
    post: (url: string, body?: object) => agent.post(url).set('X-XSRF-TOKEN', xsrf).send(body ?? {}).then(capture),
    put: (url: string, body?: object) => agent.put(url).set('X-XSRF-TOKEN', xsrf).send(body ?? {}).then(capture),
    patch: (url: string, body?: object) => agent.patch(url).set('X-XSRF-TOKEN', xsrf).send(body ?? {}).then(capture),
    del: (url: string) => agent.delete(url).set('X-XSRF-TOKEN', xsrf).then(capture),
    upload: (url: string, fields: Record<string, string>, file: Buffer, name: string) => {
      const r = agent.post(url).set('X-XSRF-TOKEN', xsrf);
      for (const [k, v] of Object.entries(fields)) r.field(k, v);
      return r.attach('file', file, name).then(capture);
    },
  };
}

let n = 0;
export const uniqueEmail = (p = 'user') => `${p}.${Date.now()}.${++n}@test.schluss.co.za`;

export async function createStaff(roleKeys: string[], password = 'StaffPass12345') {
  const email = uniqueEmail('staff');
  const [id] = await db('users').insert({ type: 'staff', name: 'Staff ' + roleKeys.join('+'), email, password_hash: await bcrypt.hash(password, 4) });
  const roles = await db('roles').whereIn('key', roleKeys).select('id');
  if (roles.length) await db('user_roles').insert(roles.map((r) => ({ user_id: id, role_id: r.id })));
  return { id, email, password };
}

export async function createPartnerUser(status: string, password = 'PartnerPass123') {
  const [pid] = await db('partners').insert({ reference: 'SP-T-' + Date.now() + n++, business_name: 'Test Partner', contact_name: 'P', email: uniqueEmail('p'), cellphone: '0820000000', status });
  const email = uniqueEmail('partner');
  const [id] = await db('users').insert({ type: 'partner', name: 'Partner User', email, partner_id: pid, password_hash: await bcrypt.hash(password, 4) });
  return { id, email, password, partnerId: pid };
}

export async function login(c: Awaited<ReturnType<typeof client>>, email: string, password: string) {
  const r = await c.post('/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error('login failed: ' + r.status + ' ' + JSON.stringify(r.body));
  return r;
}

type Client = Awaited<ReturnType<typeof client>>;

/** The latest OTP emailed to an address (read from the queued job, before the worker scrubs it). */
export async function lastOtp(email: string): Promise<string> {
  const log = await db('email_logs').where({ to_email: email, template_key: 'email_otp' }).orderBy('id', 'desc').first('job_id');
  const job = await db('jobs').where({ id: log.job_id }).first('payload');
  const p = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  return p.vars.code;
}

/** Register a customer and complete email verification (which signs them in). Returns the register response. */
export async function register(c: Client, input: { email: string } & Record<string, unknown>) {
  const r = await c.post('/api/auth/register', input);
  if (r.status !== 201) return r;
  const v = await c.post('/api/auth/verify-email', { email: input.email, code: await lastOtp(input.email) });
  if (v.status !== 200) throw new Error('verify failed: ' + v.status + ' ' + JSON.stringify(v.body));
  return r;
}

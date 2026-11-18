import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../../server/api/db';
import { client, createPartnerUser, createStaff, login, uniqueEmail, register } from './helpers';

afterAll(() => db.destroy());

async function as(roleKeys: string[]) {
  const s = await createStaff(roleKeys);
  const c = await client();
  await login(c, s.email, s.password);
  return { c, s };
}

describe('role-based access control (enforced by the backend)', () => {
  it('anonymous users get 401 on admin endpoints', async () => {
    const c = await client();
    expect((await c.get('/api/admin/staff')).status).toBe(401);
    expect((await c.get('/api/admin/audit-logs')).status).toBe(401);
  });

  it('customers get 403 on admin endpoints', async () => {
    const c = await client();
    await register(c, { name: 'Cust', email: uniqueEmail('c'), cellphone: '0821234567', country: 'ZA', password: 'Customer-pass-1', acceptPrivacy: true });
    expect((await c.get('/api/admin/staff')).status).toBe(403);
    expect((await c.get('/api/admin/roles')).status).toBe(403);
  });

  it('partners (even approved) get 403 on admin endpoints', async () => {
    const p = await createPartnerUser('approved');
    const c = await client();
    await login(c, p.email, p.password);
    expect((await c.get('/api/admin/audit-logs')).status).toBe(403);
    const me = await c.get('/api/auth/me');
    expect(me.body.partnerStatus).toBe('approved');
  });

  it('pending partners can sign in but are reported as pending', async () => {
    const p = await createPartnerUser('pending');
    const c = await client();
    await login(c, p.email, p.password);
    expect((await c.get('/api/auth/me')).body.partnerStatus).toBe('pending');
  });

  it('staff only reach what their role permits', async () => {
    const { c: pm } = await as(['product_manager']);
    expect((await pm.get('/api/admin/staff')).status).toBe(403); // no users.manage
    expect((await pm.get('/api/admin/audit-logs')).status).toBe(403); // no audit.view
    const me = await pm.get('/api/auth/me');
    expect(me.body.permissions).toContain('products.manage');
    expect(me.body.permissions).not.toContain('users.manage');

    const { c: ro } = await as(['read_only']);
    expect((await ro.get('/api/admin/staff')).status).toBe(403);

    const { c: admin } = await as(['administrator']);
    expect((await admin.get('/api/admin/staff')).status).toBe(200);
    expect((await admin.get('/api/admin/audit-logs')).status).toBe(200);
    expect((await admin.put('/api/admin/roles/2/permissions', { permissions: [] })).status).toBe(403); // no roles.manage
  });

  it('permission changes take effect on the next request', async () => {
    const { c, s } = await as(['read_only']);
    expect((await c.get('/api/admin/audit-logs')).status).toBe(403);
    const role = await db('roles').where({ key: 'support_manager' }).first('id');
    await db('user_roles').insert({ user_id: s.id, role_id: role.id });
    const perm = await db('permissions').where({ key: 'audit.view' }).first('id');
    await db('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
    expect((await c.get('/api/admin/audit-logs')).status).toBe(200);
    await db('role_permissions').where({ role_id: role.id, permission_id: perm.id }).del();
  });
});

describe('staff management', () => {
  it('administrator can create staff but cannot grant super_admin', async () => {
    const { c } = await as(['administrator']);
    const bad = await c.post('/api/admin/staff', { name: 'New', email: uniqueEmail('n'), password: 'Long-enough-pass-1', roles: ['super_admin'] });
    expect(bad.status).toBe(403);
    const ok = await c.post('/api/admin/staff', { name: 'New Person', email: uniqueEmail('n'), password: 'Long-enough-pass-1', roles: ['support_manager'] });
    expect(ok.status).toBe(201);
    const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', ok.body.id).pluck('r.key');
    expect(roles).toEqual(['support_manager']);
  });

  it('super admin can grant super_admin, cannot disable self, and disabling kills sessions', async () => {
    const { c, s } = await as(['super_admin']);
    expect((await c.patch(`/api/admin/staff/${s.id}`, { status: 'disabled' })).status).toBe(400);

    const target = await createStaff(['read_only']);
    const tc = await client();
    await login(tc, target.email, target.password);
    expect((await c.patch(`/api/admin/staff/${target.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await tc.get('/api/auth/me')).body.user).toBeNull();
  });

  it('cannot edit super_admin role permissions', async () => {
    const { c } = await as(['super_admin']);
    const role = await db('roles').where({ key: 'super_admin' }).first('id');
    expect((await c.put(`/api/admin/roles/${role.id}/permissions`, { permissions: [] })).status).toBe(400);
  });
});

describe('audit log', () => {
  it('records sensitive actions with actor and before/after, without secrets', async () => {
    const { c, s } = await as(['super_admin']);
    const role = await db('roles').where({ key: 'read_only' }).first('id');
    await c.put(`/api/admin/roles/${role.id}/permissions`, { permissions: ['dashboard.view', 'reports.view'] });
    const r = await c.get('/api/admin/audit-logs?action=role.');
    expect(r.status).toBe(200);
    const entry = r.body.data[0];
    expect(entry).toMatchObject({ action: 'role.permissions_updated', subject_type: 'role', subject_id: role.id, actor_email: s.email });

    const logins = await db('audit_logs').where({ action: 'auth.login', actor_id: s.id });
    expect(logins.length).toBeGreaterThan(0);
    const all = JSON.stringify(await db('audit_logs').select('before', 'after', 'meta'));
    expect(all).not.toMatch(/password_hash|\$2[aby]\$/);
  });

  it('paginates server-side', async () => {
    const { c } = await as(['super_admin']);
    const r = await c.get('/api/admin/audit-logs?perPage=2&page=1');
    expect(r.body.data.length).toBeLessThanOrEqual(2);
    expect(r.body.meta.total).toBeGreaterThan(2);
    expect((await c.get('/api/admin/audit-logs?perPage=5000')).status).toBe(422);
  });
});

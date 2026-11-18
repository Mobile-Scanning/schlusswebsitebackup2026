import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { ah, badRequest, conflict, forbidden, notFound, pageQuery, parse } from '../http';
import { requirePermission } from '../middleware/auth';
import { escapeLike, like } from '../http';
import { audit } from '../services/audit';

/** Admin: staff accounts, roles & permissions, audit log. Every route is permission-checked here. */
export const adminSystemRouter = Router();

/* ---------- Roles & permissions ---------- */
adminSystemRouter.get(
  '/roles',
  requirePermission('roles.manage', 'users.manage'),
  ah(async (_req, res) => {
    const roles = await db('roles').orderBy('id').select('id', 'key', 'name', 'description', 'is_system');
    const links = await db('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').select('rp.role_id', 'p.key');
    const permissions = await db('permissions').orderBy(['group', 'key']).select('key', 'group', 'description');
    res.json({
      roles: roles.map((r) => ({ ...r, is_system: !!r.is_system, permissions: links.filter((l) => l.role_id === r.id).map((l) => l.key) })),
      permissions,
    });
  }),
);

adminSystemRouter.put(
  '/roles/:id/permissions',
  requirePermission('roles.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const { permissions } = parse(z.object({ permissions: z.array(z.string().max(100)).max(200) }), req.body);
    const role = await db('roles').where({ id }).first();
    if (!role) throw notFound('Role not found.');
    if (role.key === 'super_admin') throw badRequest('The Super Administrator role always has every permission.');
    const valid = await db('permissions').whereIn('key', permissions).select('id', 'key');
    const before = (await db('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').where('rp.role_id', id).pluck('p.key')) as string[];
    await db.transaction(async (trx) => {
      await trx('role_permissions').where({ role_id: id }).del();
      if (valid.length) await trx('role_permissions').insert(valid.map((p) => ({ role_id: id, permission_id: p.id })));
      await audit(req, { action: 'role.permissions_updated', subjectType: 'role', subjectId: id, before, after: valid.map((p) => p.key) }, trx);
    });
    res.json({ ok: true });
  }),
);

/* ---------- Staff accounts ---------- */
const staffList = pageQuery.extend({ q: z.string().trim().max(100).optional(), status: z.enum(['active', 'disabled']).optional() });

adminSystemRouter.get(
  '/staff',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const q = parse(staffList, req.query);
    const base = db('users').where({ type: 'staff' });
    if (q.status) base.andWhere({ status: q.status });
    if (q.q) base.andWhere((b) => b.where('name', 'like', like(q.q!)).orWhere('email', 'like', like(q.q!)));
    const [{ total }] = await base.clone().count({ total: '*' });
    const rows = await base
      .clone()
      .orderBy('name')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('id', 'name', 'email', 'status', 'last_login_at', 'created_at', db.raw('mfa_enabled_at IS NOT NULL as mfa'));
    const roleRows = rows.length
      ? await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').whereIn('ur.user_id', rows.map((r) => r.id)).select('ur.user_id', 'r.key')
      : [];
    res.json({
      data: rows.map((r) => ({ ...r, roles: roleRows.filter((x) => x.user_id === r.id).map((x) => x.key) })),
      meta: { page: q.page, perPage: q.perPage, total: Number(total) },
    });
  }),
);

const staffCreate = z.object({
  name: z.string().trim().min(2).max(191),
  email: z.string().trim().toLowerCase().email().max(191),
  password: z.string().min(12, 'Staff passwords need at least 12 characters').refine((p) => Buffer.byteLength(p) <= 72, 'Password is too long'),
  roles: z.array(z.string()).min(1, 'Choose at least one role'),
});

async function resolveRoles(req: Parameters<typeof audit>[0], keys: string[]) {
  const roles = await db('roles').whereIn('key', keys).select('id', 'key');
  if (roles.length !== new Set(keys).size) throw badRequest('Unknown role selected.');
  // Only a Super Administrator may grant Super Administrator.
  if (keys.includes('super_admin') && !req!.auth!.roles.includes('super_admin')) throw forbidden('Only a Super Administrator can grant that role.');
  return roles;
}

adminSystemRouter.post(
  '/staff',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const input = parse(staffCreate, req.body);
    if (await db('users').where({ email: input.email }).first('id')) throw conflict('An account with this email already exists.');
    const roles = await resolveRoles(req, input.roles);
    const hash = await bcrypt.hash(input.password, config.auth.bcryptCost);
    const id = await db.transaction(async (trx) => {
      const [uid] = await trx('users').insert({ type: 'staff', name: input.name, email: input.email, password_hash: hash });
      await trx('user_roles').insert(roles.map((r) => ({ user_id: uid, role_id: r.id })));
      await audit(req, { action: 'staff.created', subjectType: 'user', subjectId: uid, after: { name: input.name, email: input.email, roles: input.roles } }, trx);
      return uid;
    });
    res.status(201).json({ id });
  }),
);

const staffUpdate = z.object({
  name: z.string().trim().min(2).max(191).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  roles: z.array(z.string()).min(1).optional(),
  /** Remove this person's two-step verification (e.g. they lost their phone). They set it up again at next sign-in. */
  resetMfa: z.literal(true).optional(),
});

adminSystemRouter.patch(
  '/staff/:id',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const id = Number(req.params['id']);
    const input = parse(staffUpdate, req.body);
    const user = await db('users').where({ id, type: 'staff' }).first('id', 'name', 'status');
    if (!user) throw notFound('Staff member not found.');
    const currentRoles = (await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', id).pluck('r.key')) as string[];
    if (currentRoles.includes('super_admin') && !req.auth!.roles.includes('super_admin')) throw forbidden('Only a Super Administrator can change another Super Administrator.');
    if (id === req.auth!.user.id && (input.status === 'disabled' || (input.roles && !input.roles.includes('super_admin') && currentRoles.includes('super_admin')))) {
      throw badRequest('You cannot disable or demote your own account.');
    }
    const roles = input.roles ? await resolveRoles(req, input.roles) : null;
    await db.transaction(async (trx) => {
      const patch: Record<string, unknown> = {};
      if (input.name) patch['name'] = input.name;
      if (input.status) patch['status'] = input.status;
      if (Object.keys(patch).length) await trx('users').where({ id }).update({ ...patch, updated_at: new Date() });
      if (roles) {
        await trx('user_roles').where({ user_id: id }).del();
        await trx('user_roles').insert(roles.map((r) => ({ user_id: id, role_id: r.id })));
      }
      if (input.resetMfa) {
        await trx('users').where({ id }).update({ mfa_secret: null, mfa_enabled_at: null, mfa_recovery: null, mfa_last_step: null, updated_at: new Date() });
        await trx('sessions').where({ user_id: id }).del();
        await audit(req, { action: 'staff.mfa_reset', subjectType: 'user', subjectId: id }, trx);
      }
      if (input.status === 'disabled') await trx('sessions').where({ user_id: id }).del();
      await audit(req, { action: 'staff.updated', subjectType: 'user', subjectId: id, before: { ...user, roles: currentRoles }, after: input }, trx);
    });
    res.json({ ok: true });
  }),
);

/* ---------- Audit log ---------- */
const auditQuery = pageQuery.extend({
  action: z.string().max(100).optional(),
  subjectType: z.string().max(64).optional(),
  subjectId: z.coerce.number().int().optional(),
  actorId: z.coerce.number().int().optional(),
  /** Only security-relevant events: sign-ins, failures, lockouts, refused access, password / role / staff changes. */
  security: z.enum(['1']).optional(),
});

/* ---------- Security settings ---------- */
adminSystemRouter.get('/security-settings', requirePermission('settings.manage', 'users.manage'), ah(async (_req, res) => {
  const { getSetting } = await import('../services/platform');
  const staff = await db('users').where({ type: 'staff', status: 'active' }).select('mfa_enabled_at');
  const since = db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)');
  const count = async (action: string) => Number((await db('audit_logs').where('action', action).where('created_at', '>=', since).count({ n: '*' }).first())?.n ?? 0);
  res.json({
    settings: await getSetting('security.settings'),
    staff: { total: staff.length, withMfa: staff.filter((s) => s.mfa_enabled_at).length },
    last7days: { failedLogins: await count('auth.login_failed'), failedCodes: await count('auth.mfa_failed'), refused: (await count('security.forbidden')) + (await count('security.unauthenticated')), logins: await count('auth.login') },
    sessions: { staffIdleMinutes: config.session.staffIdleMinutes, staffMaxHours: config.session.staffMaxHours, customerIdleHours: config.session.ttlHours, customerMaxDays: config.session.maxDays },
  });
}));
adminSystemRouter.put('/security-settings', requirePermission('settings.manage'), ah(async (req, res) => {
  const input = parse(z.object({ requireStaffMfa: z.boolean() }), req.body);
  const { getSetting, setSetting } = await import('../services/platform');
  const { clearSecurityCache } = await import('../services/security');
  // Don't let an administrator lock everyone (including themselves) out of the admin by accident.
  if (input.requireStaffMfa && !req.auth!.mfaEnabled) throw badRequest('Switch on two-step verification for your own account first (My security), then make it compulsory for all staff.');
  const before = await getSetting('security.settings');
  await setSetting('security.settings', input, req.auth!.user.id);
  clearSecurityCache();
  await audit(req, { action: 'settings.security', before, after: input });
  res.json({ settings: input });
}));

adminSystemRouter.get(
  '/audit-logs',
  requirePermission('audit.view'),
  ah(async (req, res) => {
    const q = parse(auditQuery, req.query);
    const base = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_id');
    if (q.action) base.where('a.action', 'like', escapeLike(q.action) + '%');
    if (q.subjectType) base.where('a.subject_type', q.subjectType);
    if (q.subjectId) base.where('a.subject_id', q.subjectId);
    if (q.actorId) base.where('a.actor_id', q.actorId);
    if (q.security) base.where((w) => w.where('a.action', 'like', 'auth.%').orWhere('a.action', 'like', 'security.%').orWhere('a.action', 'like', 'staff.%').orWhere('a.action', 'like', 'role.%').orWhere('a.action', 'like', 'roles.%').orWhere('a.action', 'like', 'settings.security%').orWhere('a.action', 'in', ['customer.suspend', 'customer.reactivate', 'customer.deleted']));
    const [{ total }] = await base.clone().count({ total: '*' });
    const data = await base
      .clone()
      .orderBy('a.id', 'desc')
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage)
      .select('a.id', 'a.action', 'a.subject_type', 'a.subject_id', 'a.before', 'a.after', 'a.meta', 'a.ip', 'a.created_at', 'u.name as actor_name', 'u.email as actor_email');
    // MariaDB stores JSON as text – decode so clients always receive objects.
    const json = (v: unknown) => {
      if (typeof v !== 'string') return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    };
    res.json({
      data: data.map((r) => ({ ...r, before: json(r.before), after: json(r.after), meta: json(r.meta) })),
      meta: { page: q.page, perPage: q.perPage, total: Number(total) },
    });
  }),
);

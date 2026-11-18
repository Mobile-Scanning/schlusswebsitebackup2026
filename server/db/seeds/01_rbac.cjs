/**
 * Reference data only: roles and permissions. Idempotent – safe to run on every deploy.
 * No fake products, customers or partners are ever seeded.
 */
const rbac = require('../rbac.json');

function resolve(spec, all) {
  const include = spec.includes('*') ? [...all] : spec.filter((p) => !p.startsWith('!'));
  const exclude = new Set(spec.filter((p) => p.startsWith('!')).map((p) => p.slice(1)));
  return include.filter((p) => !exclude.has(p));
}

/** Permissions introduced by the v7 release – given to existing roles once, without touching other edits. */
const NEW_IN_RELEASE = new Set(['leads.view', 'leads.manage', 'sales.view', 'sales.manage', 'businesses.manage', 'whatsapp.manage', 'email_settings.manage']);
const ADD_TO_ROLE = {
  support_manager: ['leads.view', 'leads.manage'],
  sales_manager: ['sales.view', 'sales.manage', 'leads.view', 'businesses.manage'],
  read_only: ['leads.view', 'sales.view'],
};

exports.seed = async function (knex) {
  const all = Object.keys(rbac.permissions);
  for (const [key, [group, description]] of Object.entries(rbac.permissions)) {
    await knex('permissions').insert({ key, group, description }).onConflict('key').merge(['group', 'description']);
  }
  const permRows = await knex('permissions').select('id', 'key');
  const permId = Object.fromEntries(permRows.map((p) => [p.key, p.id]));

  for (const [key, role] of Object.entries(rbac.roles)) {
    await knex('roles').insert({ key, name: role.name, description: role.description, is_system: true }).onConflict('key').merge(['name', 'description', 'is_system']);
    const { id } = await knex('roles').where({ key }).first('id');
    // Only (re)apply default permissions to system roles on first creation or for super_admin;
    // later admin edits to other roles are preserved.
    const existing = await knex('role_permissions').where({ role_id: id }).count({ n: '*' }).first();
    if (key === 'super_admin' || Number(existing.n) === 0) {
      await knex('role_permissions').where({ role_id: id }).del();
      const rows = resolve(role.permissions, all).map((p) => ({ role_id: id, permission_id: permId[p] }));
      if (rows.length) await knex('role_permissions').insert(rows);
    } else if (role.permissions.includes('*')) {
      // "All permissions" roles automatically receive permissions added in later releases
      // (exclusions like "!roles.manage" still apply). Existing admin edits are kept.
      const known = new Set((await knex('role_permissions').where({ role_id: id }).pluck('permission_id')).map(Number));
      const add = resolve(role.permissions, all).filter((p) => NEW_IN_RELEASE.has(p)).map((p) => permId[p]).filter((pid) => !known.has(Number(pid)));
      if (add.length) await knex('role_permissions').insert(add.map((permission_id) => ({ role_id: id, permission_id })));
    } else if (ADD_TO_ROLE[key]) {
      const known = new Set((await knex('role_permissions').where({ role_id: id }).pluck('permission_id')).map(Number));
      const add = ADD_TO_ROLE[key].map((p) => permId[p]).filter((pid) => pid && !known.has(Number(pid)));
      if (add.length) await knex('role_permissions').insert(add.map((permission_id) => ({ role_id: id, permission_id })));
    }
  }
};

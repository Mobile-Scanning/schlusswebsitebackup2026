/**
 * v11 security hardening:
 *  - two-step verification (TOTP) for staff logins: secret (encrypted), enabled date, recovery codes (hashed),
 *    last used time-step (a code cannot be used twice)
 *  - an index so the audit log can be filtered by event type and date quickly
 * Nothing existing is changed.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.text('mfa_secret').nullable();
    t.datetime('mfa_enabled_at').nullable();
    t.json('mfa_recovery').nullable();
    t.bigInteger('mfa_last_step').nullable();
  });
  const idx = await knex.raw("SHOW INDEX FROM audit_logs WHERE Key_name = 'audit_action_created'");
  if (!idx[0].length) await knex.schema.alterTable('audit_logs', (t) => t.index(['action', 'created_at'], 'audit_action_created'));
};

exports.down = async function (knex) {
  await knex.schema.alterTable('audit_logs', (t) => t.dropIndex(['action', 'created_at'], 'audit_action_created'));
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('mfa_secret');
    t.dropColumn('mfa_enabled_at');
    t.dropColumn('mfa_recovery');
    t.dropColumn('mfa_last_step');
  });
};

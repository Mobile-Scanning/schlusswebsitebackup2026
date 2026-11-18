/**
 * Identity & access: users, sessions, roles/permissions (RBAC), password resets,
 * audit log, settings, job queue.
 * Partner organisations are created here (minimal) so users can reference them;
 * the rest of the partner domain lives in migration 004.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('partners', (t) => {
    t.bigIncrements('id');
    t.string('reference', 20).notNullable().unique(); // e.g. SP-2026-00042
    t.string('business_name', 191).notNullable();
    t.string('contact_name', 191).notNullable();
    t.string('email', 191).notNullable();
    t.string('cellphone', 32).notNullable();
    t.string('address', 500);
    t.string('country', 2).notNullable().defaultTo('ZA');
    t.string('website', 255);
    t.string('business_type', 100);
    t.string('industry', 100);
    t.smallint('years_experience').unsigned();
    t.text('services_offered');
    t.text('areas_of_operation');
    t.text('products_interested');
    t.text('additional_info');
    t.enu('status', ['pending', 'under_review', 'approved', 'rejected', 'suspended']).notNullable().defaultTo('pending');
    t.decimal('discount_percent', 5, 2).notNullable().defaultTo(0);
    t.decimal('default_commission_percent', 5, 2).notNullable().defaultTo(0);
    t.text('admin_notes');
    t.bigInteger('reviewed_by').unsigned();
    t.datetime('reviewed_at');
    t.datetime('approved_at');
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['email']);
  });

  await knex.schema.createTable('users', (t) => {
    t.bigIncrements('id');
    t.enu('type', ['staff', 'customer', 'partner']).notNullable();
    t.string('name', 191).notNullable();
    t.string('email', 191).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('cellphone', 32);
    t.enu('status', ['active', 'disabled']).notNullable().defaultTo('active');
    t.bigInteger('partner_id').unsigned().references('partners.id').onDelete('RESTRICT');
    t.datetime('email_verified_at');
    t.datetime('last_login_at');
    t.smallint('failed_logins').unsigned().notNullable().defaultTo(0);
    t.datetime('locked_until');
    t.timestamps(true, true);
    t.index(['type', 'status']);
  });

  await knex.schema.alterTable('partners', (t) => {
    t.foreign('reviewed_by').references('users.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('sessions', (t) => {
    t.string('id', 64).primary(); // sha256 of the cookie token – raw token never stored
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('csrf_secret', 64).notNullable();
    t.string('ip', 45);
    t.string('user_agent', 255);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('last_seen_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('expires_at').notNullable();
    t.index(['user_id']);
    t.index(['expires_at']);
  });

  await knex.schema.createTable('password_resets', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.datetime('expires_at').notNullable();
    t.datetime('used_at');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });

  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('key', 64).notNullable().unique();
    t.string('name', 100).notNullable();
    t.string('description', 255);
    t.boolean('is_system').notNullable().defaultTo(false); // system roles cannot be deleted
    t.timestamps(true, true);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('key', 100).notNullable().unique(); // e.g. products.manage
    t.string('group', 64).notNullable();
    t.string('description', 255);
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').unsigned().notNullable().references('roles.id').onDelete('CASCADE');
    t.integer('permission_id').unsigned().notNullable().references('permissions.id').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('user_roles', (t) => {
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('role_id').unsigned().notNullable().references('roles.id').onDelete('CASCADE');
    t.primary(['user_id', 'role_id']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.bigInteger('actor_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('action', 100).notNullable(); // e.g. auth.login, licence.suspend
    t.string('subject_type', 64);
    t.bigInteger('subject_id').unsigned();
    t.json('before');
    t.json('after');
    t.json('meta');
    t.string('ip', 45);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['subject_type', 'subject_id']);
    t.index(['actor_id']);
    t.index(['action']);
    t.index(['created_at']);
  });

  await knex.schema.createTable('settings', (t) => {
    t.string('key', 100).primary();
    t.json('value');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Database-backed job queue (shared hosting has no Redis / long-running workers).
  await knex.schema.createTable('jobs', (t) => {
    t.bigIncrements('id');
    t.string('type', 64).notNullable();
    t.json('payload').notNullable();
    t.enu('status', ['pending', 'running', 'done', 'failed']).notNullable().defaultTo('pending');
    t.smallint('attempts').unsigned().notNullable().defaultTo(0);
    t.text('last_error');
    t.datetime('run_after').notNullable().defaultTo(knex.fn.now());
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('finished_at');
    t.index(['status', 'run_after']);
  });
};

exports.down = async function (knex) {
  for (const t of ['jobs', 'settings', 'audit_logs', 'user_roles', 'role_permissions', 'permissions', 'roles', 'password_resets', 'sessions']) {
    await knex.schema.dropTableIfExists(t);
  }
  await knex.schema.alterTable('partners', (t) => t.dropForeign(['reviewed_by']));
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('partners');
};

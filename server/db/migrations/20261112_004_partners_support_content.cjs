/**
 * Partners (products, service records, commissions), support tickets, email templates/logs,
 * notifications, website content, announcements, POPIA consents and data requests.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('partner_products', (t) => {
    t.bigInteger('partner_id').unsigned().notNullable().references('partners.id').onDelete('CASCADE');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.decimal('commission_percent', 5, 2);
    t.bigInteger('commission_amount_cents').unsigned();
    t.decimal('discount_percent', 5, 2);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.datetime('assigned_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['partner_id', 'product_id']);
  });

  // Installations, maintenance visits and support work recorded by partners.
  await knex.schema.createTable('service_records', (t) => {
    t.bigIncrements('id');
    t.bigInteger('partner_id').unsigned().notNullable().references('partners.id').onDelete('RESTRICT');
    t.bigInteger('customer_id').unsigned().notNullable().references('customers.id').onDelete('RESTRICT');
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.bigInteger('licence_id').unsigned().references('licences.id').onDelete('SET NULL');
    t.enu('type', ['installation', 'maintenance', 'support', 'training']).notNullable();
    t.date('service_date').notNullable();
    t.string('version', 40);
    t.text('notes');
    t.enu('status', ['scheduled', 'completed', 'cancelled']).notNullable().defaultTo('completed');
    t.bigInteger('recorded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['partner_id', 'type', 'service_date']);
    t.index(['customer_id']);
  });

  // Commission ledger – amounts recorded, never auto-marked paid.
  await knex.schema.createTable('commissions', (t) => {
    t.bigIncrements('id');
    t.bigInteger('partner_id').unsigned().notNullable().references('partners.id').onDelete('RESTRICT');
    t.bigInteger('licence_id').unsigned().references('licences.id').onDelete('SET NULL');
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.bigInteger('sale_amount_cents').unsigned().notNullable();
    t.bigInteger('commission_cents').unsigned().notNullable();
    t.string('currency', 3).notNullable().defaultTo('ZAR');
    t.enu('status', ['pending', 'approved', 'paid', 'void']).notNullable().defaultTo('pending');
    t.datetime('approved_at');
    t.bigInteger('approved_by').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('paid_at');
    t.string('payment_reference', 100);
    t.text('notes');
    t.timestamps(true, true);
    t.index(['partner_id', 'status']);
  });

  await knex.schema.createTable('tickets', (t) => {
    t.bigIncrements('id');
    t.string('reference', 20).notNullable().unique();
    t.bigInteger('requester_user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.bigInteger('customer_id').unsigned().references('customers.id').onDelete('SET NULL');
    t.bigInteger('partner_id').unsigned().references('partners.id').onDelete('SET NULL'); // partner managing this ticket
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.bigInteger('licence_id').unsigned().references('licences.id').onDelete('SET NULL');
    t.string('name', 191).notNullable();
    t.string('email', 191).notNullable();
    t.string('subject', 255).notNullable();
    t.enu('priority', ['low', 'normal', 'high', 'urgent']).notNullable().defaultTo('normal');
    t.enu('status', ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).notNullable().defaultTo('open');
    t.bigInteger('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('resolved_at');
    t.timestamps(true, true);
    t.index(['status', 'priority']);
    t.index(['customer_id']);
    t.index(['partner_id']);
    t.index(['assigned_to']);
  });

  await knex.schema.createTable('ticket_messages', (t) => {
    t.bigIncrements('id');
    t.bigInteger('ticket_id').unsigned().notNullable().references('tickets.id').onDelete('CASCADE');
    t.bigInteger('author_id').unsigned().references('users.id').onDelete('SET NULL');
    t.text('body').notNullable();
    t.boolean('is_internal').notNullable().defaultTo(false); // staff-only notes
    t.json('attachment_media_ids');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['ticket_id', 'created_at']);
  });

  await knex.schema.createTable('email_templates', (t) => {
    t.increments('id');
    t.string('key', 64).notNullable().unique(); // password_reset, trial_expiring, …
    t.string('name', 120).notNullable();
    t.string('subject', 255).notNullable();
    t.text('body_html', 'mediumtext').notNullable();
    t.json('variables'); // documented placeholders
    t.boolean('is_editable').notNullable().defaultTo(true);
    t.bigInteger('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('email_logs', (t) => {
    t.bigIncrements('id');
    t.string('to_email', 191).notNullable();
    t.string('template_key', 64);
    t.string('subject', 255);
    t.enu('status', ['queued', 'sent', 'failed']).notNullable().defaultTo('queued');
    t.text('error');
    t.string('provider_message_id', 255);
    t.bigInteger('job_id').unsigned();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('sent_at');
    t.index(['status', 'created_at']);
    t.index(['to_email']);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('type', 64).notNullable();
    t.string('title', 255).notNullable();
    t.text('body');
    t.string('link', 500);
    t.datetime('read_at');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'read_at']);
  });

  await knex.schema.createTable('site_content', (t) => {
    t.string('key', 100).primary(); // home.hero, home.intro, footer, contact, partners.page, banner…
    t.json('value').notNullable();
    t.bigInteger('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('announcements', (t) => {
    t.bigIncrements('id');
    t.string('title', 255).notNullable();
    t.text('body');
    t.string('link', 500);
    t.enu('audience', ['public', 'customer', 'partner', 'all']).notNullable().defaultTo('public');
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.datetime('starts_at');
    t.datetime('ends_at');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['is_published', 'audience']);
  });

  // POPIA: separate consent records per purpose; marketing is never implied by terms acceptance.
  await knex.schema.createTable('consents', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('email', 191).notNullable();
    t.enu('purpose', ['privacy_policy', 'terms', 'marketing', 'partner_terms']).notNullable();
    t.string('document_version', 20).notNullable();
    t.boolean('granted').notNullable();
    t.string('source', 64); // register, download_form, partner_application…
    t.string('ip_hash', 64);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['email', 'purpose']);
  });

  await knex.schema.createTable('data_requests', (t) => {
    t.bigIncrements('id');
    t.string('reference', 20).notNullable().unique();
    t.bigInteger('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('name', 191).notNullable();
    t.string('email', 191).notNullable();
    t.enu('kind', ['access', 'correction', 'deletion', 'objection']).notNullable();
    t.text('details');
    t.enu('status', ['received', 'verifying', 'in_progress', 'completed', 'declined']).notNullable().defaultTo('received');
    t.text('response_notes');
    t.bigInteger('handled_by').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('completed_at');
    t.timestamps(true, true);
    t.index(['status']);
  });
};

exports.down = async function (knex) {
  for (const t of ['data_requests', 'consents', 'announcements', 'site_content', 'notifications', 'email_logs', 'email_templates', 'ticket_messages', 'tickets', 'commissions', 'service_records', 'partner_products']) {
    await knex.schema.dropTableIfExists(t);
  }
};

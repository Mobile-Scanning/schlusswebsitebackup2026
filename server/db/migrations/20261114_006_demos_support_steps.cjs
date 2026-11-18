/**
 * Demos, customer CRM fields, support chat, richer product content and setup steps.
 * Additive: existing tables are extended, nothing is dropped and existing rows keep their meaning.
 *
 *  - product_versions.channel   'release' | 'demo' – a demo is a version of the product with its own files
 *  - licences                   the demo record IS the existing trial licence (one per customer per product)
 *                               + start rule, activation and conversion dates
 *  - downloads.licence_id       which demo/licence a download belongs to
 *  - demo_notices               one row per expiry milestone & audience – stops duplicate warnings
 *  - tickets / ticket_messages  become chat conversations (categories, unread counts, visitor token)
 *  - product_setup_steps (+ items, + customer progress)
 */
exports.up = async function (knex) {
  /* ---------- Customers: the few extra business details the demo form asks for ---------- */
  await knex.schema.alterTable('customers', (t) => {
    t.string('province', 80);
    t.string('business_type', 100);
  });

  /* ---------- Demo versions & files ---------- */
  await knex.schema.alterTable('product_versions', (t) => {
    t.enu('channel', ['release', 'demo']).notNullable().defaultTo('release');
    t.text('install_instructions');
    t.index(['product_id', 'channel', 'status']);
  });
  // A demo and a full release may use the same version number.
  await knex.schema.alterTable('product_versions', (t) => t.unique(['product_id', 'channel', 'version'], { indexName: 'product_versions_product_channel_version_unique' }));
  await knex.schema.alterTable('product_versions', (t) => t.dropUnique(['product_id', 'version']));
  await knex.schema.alterTable('version_files', (t) => {
    t.integer('sort_order').notNullable().defaultTo(0);
  });

  /* ---------- Demo record = trial licence ---------- */
  await knex.schema.alterTable('licences', (t) => {
    t.enu('start_on', ['download', 'activation']); // demo clock rule copied from the product when the demo is created
    t.smallint('duration_days').unsigned();
    t.datetime('first_downloaded_at');
    t.datetime('activated_at'); // first successful activation (central licensing API)
    t.datetime('last_seen_at'); // last successful validation from the installed app
    t.datetime('converted_at'); // set only by an administrator assigning a package
    t.bigInteger('converted_licence_id').unsigned().references('licences.id').onDelete('SET NULL');
  });
  await knex.schema.alterTable('downloads', (t) => {
    t.bigInteger('licence_id').unsigned().references('licences.id').onDelete('SET NULL');
    t.datetime('completed_at');
    t.index(['licence_id']);
  });
  await knex.schema.createTable('demo_notices', (t) => {
    t.bigIncrements('id');
    t.bigInteger('licence_id').unsigned().notNullable().references('licences.id').onDelete('CASCADE');
    t.enu('audience', ['admin', 'customer']).notNullable();
    t.smallint('milestone').notNullable(); // days before expiry; 0 = expiry day, -1 = expired
    t.integer('notified_users').unsigned().notNullable().defaultTo(0);
    t.bigInteger('email_log_id').unsigned().references('email_logs.id').onDelete('SET NULL');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['licence_id', 'audience', 'milestone']);
  });

  /* ---------- POPIA: consent purposes for demos and chat ---------- */
  await knex.raw("ALTER TABLE consents MODIFY purpose ENUM('privacy_policy','terms','marketing','partner_terms','demo_terms','support_chat') NOT NULL");

  /* ---------- Support chat on top of tickets ---------- */
  await knex.schema.createTable('support_categories', (t) => {
    t.increments('id');
    t.string('name', 80).notNullable();
    t.string('slug', 100).notNullable().unique();
    t.enu('priority', ['low', 'normal', 'high', 'urgent']).notNullable().defaultTo('normal');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.raw("ALTER TABLE tickets MODIFY status ENUM('new','open','awaiting_admin','awaiting_customer','in_progress','waiting_customer','resolved','closed') NOT NULL DEFAULT 'new'");
  await knex('tickets').where({ status: 'waiting_customer' }).update({ status: 'awaiting_customer' });
  await knex.raw("ALTER TABLE tickets MODIFY status ENUM('new','open','awaiting_admin','awaiting_customer','in_progress','resolved','closed') NOT NULL DEFAULT 'new'");
  await knex.schema.alterTable('tickets', (t) => {
    t.integer('category_id').unsigned().references('support_categories.id').onDelete('SET NULL');
    t.enu('channel', ['form', 'chat']).notNullable().defaultTo('form');
    t.string('cellphone', 32);
    t.string('company', 191);
    t.datetime('last_message_at');
    t.datetime('last_customer_message_at');
    t.smallint('admin_unread').unsigned().notNullable().defaultTo(0);
    t.smallint('customer_unread').unsigned().notNullable().defaultTo(0);
    t.string('visitor_token_hash', 64); // anonymous visitors continue their chat in the same browser
    t.datetime('overdue_notified_at');
    t.index(['visitor_token_hash']);
    t.index(['last_message_at']);
    t.index(['category_id']);
  });
  await knex.raw('UPDATE tickets SET last_message_at = updated_at, last_customer_message_at = created_at WHERE last_message_at IS NULL');
  await knex.schema.alterTable('ticket_messages', (t) => {
    t.enu('author_kind', ['customer', 'visitor', 'staff', 'system']).notNullable().defaultTo('customer');
  });
  await knex.raw("UPDATE ticket_messages m JOIN users u ON u.id = m.author_id SET m.author_kind = 'staff' WHERE u.type = 'staff'");
  await knex.raw("UPDATE ticket_messages SET author_kind = 'visitor' WHERE author_id IS NULL");

  /* ---------- Product content ---------- */
  await knex.raw(
    "ALTER TABLE product_media MODIFY role ENUM('screenshot','intro_video','walkthrough','feature_video','install_tutorial','training_video','demo_video','gallery','promo','feature_image') NOT NULL",
  );
  await knex.schema.alterTable('learning_resources', (t) => {
    t.string('url', 500); // external links (web apps, training, support…)
  });
  await knex.schema.alterTable('products', (t) => {
    t.string('notice', 1000); // important notice shown on the product page
  });

  /* ---------- Setup & learning steps ---------- */
  await knex.schema.createTable('product_setup_steps', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('title', 191).notNullable();
    t.string('summary', 500);
    t.text('body', 'mediumtext');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.boolean('is_archived').notNullable().defaultTo(false); // removed steps are archived so customer history stays
    t.timestamps(true, true);
    t.index(['product_id', 'is_archived', 'sort_order']);
  });
  await knex.schema.createTable('setup_step_items', (t) => {
    t.bigIncrements('id');
    t.bigInteger('step_id').unsigned().notNullable().references('product_setup_steps.id').onDelete('CASCADE');
    t.enu('kind', ['image', 'video', 'document', 'file', 'link', 'demo_download']).notNullable();
    t.bigInteger('media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.string('url', 500);
    t.string('title', 191);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['step_id', 'sort_order']);
  });
  await knex.schema.createTable('customer_step_progress', (t) => {
    t.bigInteger('customer_id').unsigned().notNullable().references('customers.id').onDelete('CASCADE');
    t.bigInteger('step_id').unsigned().notNullable().references('product_setup_steps.id').onDelete('CASCADE');
    t.datetime('completed_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['customer_id', 'step_id']);
  });

};

exports.down = async function (knex) {
  for (const t of ['customer_step_progress', 'setup_step_items', 'product_setup_steps', 'demo_notices']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('products', (t) => t.dropColumn('notice'));
  await knex.schema.alterTable('learning_resources', (t) => t.dropColumn('url'));
  await knex('product_media').whereIn('role', ['promo', 'feature_image']).update({ role: 'gallery' });
  await knex.raw("ALTER TABLE product_media MODIFY role ENUM('screenshot','intro_video','walkthrough','feature_video','install_tutorial','training_video','demo_video','gallery') NOT NULL");
  await knex.schema.alterTable('ticket_messages', (t) => t.dropColumn('author_kind'));
  await knex.schema.alterTable('tickets', (t) => {
    t.dropForeign(['category_id']);
    t.dropIndex(['visitor_token_hash']);
    t.dropIndex(['last_message_at']);
    t.dropIndex(['category_id']);
    for (const c of ['category_id', 'channel', 'cellphone', 'company', 'last_message_at', 'last_customer_message_at', 'admin_unread', 'customer_unread', 'visitor_token_hash', 'overdue_notified_at']) t.dropColumn(c);
  });
  await knex.raw("ALTER TABLE tickets MODIFY status ENUM('new','open','awaiting_admin','awaiting_customer','in_progress','waiting_customer','resolved','closed') NOT NULL DEFAULT 'open'");
  await knex('tickets').whereIn('status', ['awaiting_customer']).update({ status: 'waiting_customer' });
  await knex('tickets').whereIn('status', ['new', 'awaiting_admin']).update({ status: 'open' });
  await knex.raw("ALTER TABLE tickets MODIFY status ENUM('open','in_progress','waiting_customer','resolved','closed') NOT NULL DEFAULT 'open'");
  await knex.schema.dropTableIfExists('support_categories');
  // Keep the consent history: map the new purposes onto the closest older ones.
  await knex('consents').where({ purpose: 'demo_terms' }).update({ purpose: 'terms' });
  await knex('consents').where({ purpose: 'support_chat' }).update({ purpose: 'privacy_policy' });
  await knex.raw("ALTER TABLE consents MODIFY purpose ENUM('privacy_policy','terms','marketing','partner_terms') NOT NULL");
  await knex.schema.alterTable('downloads', (t) => {
    t.dropForeign(['licence_id']);
    t.dropIndex(['licence_id']);
    t.dropColumn('licence_id');
    t.dropColumn('completed_at');
  });
  await knex.schema.alterTable('licences', (t) => {
    t.dropForeign(['converted_licence_id']);
    for (const c of ['start_on', 'duration_days', 'first_downloaded_at', 'activated_at', 'last_seen_at', 'converted_at', 'converted_licence_id']) t.dropColumn(c);
  });
  await knex.schema.alterTable('version_files', (t) => t.dropColumn('sort_order'));
  await knex('product_versions').where({ channel: 'demo' }).update({ version: knex.raw("CONCAT(version, '-demo')") }); // keep (product, version) unique
  await knex.schema.alterTable('product_versions', (t) => t.unique(['product_id', 'version']));
  await knex.schema.alterTable('product_versions', (t) => t.dropUnique(['product_id', 'channel', 'version'], 'product_versions_product_channel_version_unique'));
  await knex.schema.alterTable('product_versions', (t) => {
    t.dropIndex(['product_id', 'channel', 'status']);
    t.dropColumn('channel');
    t.dropColumn('install_instructions');
  });
  await knex.schema.alterTable('customers', (t) => {
    t.dropColumn('province');
    t.dropColumn('business_type');
  });
};

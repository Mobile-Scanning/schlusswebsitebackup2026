/**
 * Customers, downloads, licences (incl. trials), activations, licence event history,
 * demo requests and quote requests.
 * Downloads and activations are deliberately separate: a download is never treated as an install.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('customers', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().unique().references('users.id').onDelete('SET NULL'); // null when a partner registered them without a login
    t.string('full_name', 191).notNullable();
    t.string('email', 191).notNullable();
    t.string('cellphone', 32);
    t.string('company', 191);
    t.string('country', 2).notNullable().defaultTo('ZA');
    t.bigInteger('assigned_partner_id').unsigned().references('partners.id').onDelete('SET NULL');
    t.bigInteger('registered_by_partner_id').unsigned().references('partners.id').onDelete('SET NULL');
    t.datetime('last_activation_at');
    t.timestamps(true, true);
    t.index(['email']);
    t.index(['assigned_partner_id']);
    t.index(['country']);
  });

  // Product registration – why/how a customer signed up for a product (download form).
  await knex.schema.createTable('customer_products', (t) => {
    t.bigIncrements('id');
    t.bigInteger('customer_id').unsigned().notNullable().references('customers.id').onDelete('CASCADE');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('RESTRICT');
    t.string('intended_usage', 500);
    t.enu('demo_preference', ['none', 'video', 'live', 'interactive']).notNullable().defaultTo('none');
    t.timestamps(true, true);
    t.unique(['customer_id', 'product_id']);
  });

  await knex.schema.createTable('licences', (t) => {
    t.bigIncrements('id');
    t.string('licence_key', 40).notNullable().unique(); // human-readable key, e.g. SCH-XXXX-XXXX-XXXX-XXXX
    t.bigInteger('customer_id').unsigned().notNullable().references('customers.id').onDelete('RESTRICT');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('RESTRICT');
    t.bigInteger('plan_id').unsigned().references('product_plans.id').onDelete('SET NULL');
    t.bigInteger('partner_id').unsigned().references('partners.id').onDelete('SET NULL'); // service provider
    t.enu('type', ['trial', 'perpetual', 'subscription', 'free']).notNullable();
    t.enu('status', ['trial', 'active', 'expired', 'suspended', 'revoked']).notNullable();
    t.datetime('starts_at').notNullable();
    t.datetime('expires_at'); // null = never (perpetual/free)
    t.smallint('max_devices').unsigned().notNullable().defaultTo(1);
    t.smallint('offline_grace_days').unsigned().notNullable().defaultTo(7);
    t.text('notes');
    t.timestamps(true, true);
    t.index(['customer_id']);
    t.index(['product_id', 'status']);
    t.index(['status', 'expires_at']);
    t.index(['partner_id']);
  });

  // A customer may have only ONE trial per product, ever – enforced at DB level so reinstalling
  // or re-registering can never restart a trial. (Generated column: 1 for trials, NULL otherwise.)
  await knex.raw("ALTER TABLE licences ADD COLUMN trial_marker TINYINT GENERATED ALWAYS AS (IF(type = 'trial', 1, NULL)) STORED");
  await knex.raw('CREATE UNIQUE INDEX licences_one_trial_per_customer_product ON licences (customer_id, product_id, trial_marker)');

  await knex.schema.createTable('licence_activations', (t) => {
    t.bigIncrements('id');
    t.bigInteger('licence_id').unsigned().notNullable().references('licences.id').onDelete('CASCADE');
    t.string('device_hash', 64).notNullable(); // sha256 of device fingerprint – raw fingerprint not stored
    t.string('device_name', 120);
    t.string('platform', 32);
    t.string('app_version', 40);
    t.datetime('activated_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('last_validated_at');
    t.datetime('deactivated_at');
    t.unique(['licence_id', 'device_hash']);
    t.index(['device_hash']);
  });

  // Trial history + licence audit trail in one place.
  await knex.schema.createTable('licence_events', (t) => {
    t.bigIncrements('id');
    t.bigInteger('licence_id').unsigned().notNullable().references('licences.id').onDelete('CASCADE');
    t.string('event', 40).notNullable(); // created, trial_started, extended, activated, suspended, revoked, reactivated, expired, device_added, device_removed, reactivation_requested
    t.json('before');
    t.json('after');
    t.text('reason');
    t.bigInteger('actor_id').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['licence_id', 'created_at']);
  });

  await knex.schema.createTable('downloads', (t) => {
    t.bigIncrements('id');
    t.bigInteger('customer_id').unsigned().notNullable().references('customers.id').onDelete('CASCADE');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('RESTRICT');
    t.bigInteger('version_id').unsigned().notNullable().references('product_versions.id').onDelete('RESTRICT');
    t.bigInteger('version_file_id').unsigned().notNullable().references('version_files.id').onDelete('RESTRICT');
    t.enu('status', ['authorised', 'started', 'completed', 'failed']).notNullable().defaultTo('authorised');
    t.string('ip_hash', 64);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['customer_id']);
    t.index(['product_id', 'created_at']);
    t.index(['version_id']);
  });

  await knex.schema.createTable('demo_requests', (t) => {
    t.bigIncrements('id');
    t.string('reference', 20).notNullable().unique();
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.bigInteger('customer_id').unsigned().references('customers.id').onDelete('SET NULL');
    t.string('name', 191).notNullable();
    t.string('email', 191).notNullable();
    t.string('cellphone', 32);
    t.string('company', 191);
    t.string('country', 2);
    t.enu('preferred_type', ['live', 'video', 'interactive', 'onsite']).notNullable().defaultTo('live');
    t.datetime('preferred_date');
    t.text('message');
    t.enu('status', ['new', 'contacted', 'scheduled', 'completed', 'cancelled', 'no_show']).notNullable().defaultTo('new');
    t.bigInteger('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.datetime('scheduled_at');
    t.datetime('completed_at');
    t.text('follow_up_notes');
    t.boolean('converted').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['product_id']);
  });

  // No payment gateway in v1: customers request a quote / licence, staff activate after payment.
  await knex.schema.createTable('quote_requests', (t) => {
    t.bigIncrements('id');
    t.string('reference', 20).notNullable().unique();
    t.bigInteger('customer_id').unsigned().references('customers.id').onDelete('SET NULL');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('RESTRICT');
    t.bigInteger('plan_id').unsigned().references('product_plans.id').onDelete('SET NULL');
    t.bigInteger('licence_id').unsigned().references('licences.id').onDelete('SET NULL'); // set for reactivation requests
    t.enu('kind', ['purchase', 'reactivation', 'upgrade']).notNullable().defaultTo('purchase');
    t.integer('quantity').unsigned().notNullable().defaultTo(1);
    t.text('message');
    t.enu('status', ['new', 'quoted', 'invoiced', 'paid', 'fulfilled', 'declined', 'cancelled']).notNullable().defaultTo('new');
    t.bigInteger('assigned_to').unsigned().references('users.id').onDelete('SET NULL');
    t.text('staff_notes');
    t.timestamps(true, true);
    t.index(['status']);
  });
};

exports.down = async function (knex) {
  for (const t of ['quote_requests', 'demo_requests', 'downloads', 'licence_events', 'licence_activations', 'licences', 'customer_products', 'customers']) {
    await knex.schema.dropTableIfExists(t);
  }
};

/**
 * Catalogue: media library, categories, products, features, plans (pricing),
 * versions + per-platform installer files, learning resources.
 * Large files are NOT stored in MySQL – `media` holds metadata + private storage key.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('media', (t) => {
    t.bigIncrements('id');
    t.enu('kind', ['image', 'video', 'pdf', 'document', 'installer', 'archive', 'external_video', 'other']).notNullable();
    t.string('title', 191).notNullable();
    t.string('disk', 32).notNullable().defaultTo('private'); // private | public | s3
    t.string('storage_key', 500); // path/key inside the disk – never exposed to clients
    t.string('external_url', 500); // YouTube/Vimeo etc. for external_video
    t.string('original_name', 255);
    t.string('mime', 127);
    t.bigInteger('size_bytes').unsigned();
    t.string('sha256', 64);
    t.enu('visibility', ['public', 'customer', 'partner', 'staff']).notNullable().defaultTo('staff');
    t.json('meta'); // width/height/duration/etc.
    t.bigInteger('uploaded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['kind']);
    t.index(['visibility']);
  });

  await knex.schema.createTable('product_categories', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('slug', 140).notNullable().unique();
    t.string('description', 500);
    t.string('icon', 64);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['is_active', 'sort_order']);
  });

  await knex.schema.createTable('products', (t) => {
    t.bigIncrements('id');
    t.integer('category_id').unsigned().references('product_categories.id').onDelete('SET NULL');
    t.string('name', 160).notNullable();
    t.string('slug', 180).notNullable().unique();
    t.string('tagline', 255);
    t.string('short_description', 500);
    t.text('description', 'mediumtext');
    t.string('product_type', 64); // desktop, web, mobile, service…
    t.enu('status', ['available', 'coming_soon', 'beta', 'demo_available', 'unavailable', 'discontinued']).notNullable().defaultTo('coming_soon');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.boolean('is_archived').notNullable().defaultTo(false);
    t.bigInteger('logo_media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.bigInteger('hero_media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.json('supported_platforms'); // ["windows","android",…]
    t.text('system_requirements');
    t.smallint('trial_days').unsigned(); // null = no trial
    t.json('licence_rules'); // { max_devices, offline_grace_days, … }
    t.json('demo_options'); // { request_form, video, interactive_url, downloadable, scheduled }
    t.date('expected_release'); // for coming soon
    t.string('seo_title', 191);
    t.string('seo_description', 320);
    t.integer('view_count').unsigned().notNullable().defaultTo(0);
    t.smallint('wizard_step').unsigned().notNullable().defaultTo(1); // draft progress in 7-step editor
    t.datetime('published_at');
    t.bigInteger('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['is_published', 'is_archived', 'status']);
    t.index(['category_id']);
    t.index(['is_featured']);
  });

  await knex.schema.createTable('product_features', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.enu('kind', ['feature', 'benefit', 'faq']).notNullable().defaultTo('feature');
    t.string('title', 255).notNullable();
    t.text('body');
    t.string('icon', 64);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['product_id', 'kind', 'sort_order']);
  });

  await knex.schema.createTable('product_media', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.bigInteger('media_id').unsigned().notNullable().references('media.id').onDelete('CASCADE');
    t.enu('role', ['screenshot', 'intro_video', 'walkthrough', 'feature_video', 'install_tutorial', 'training_video', 'demo_video', 'gallery']).notNullable();
    t.string('caption', 255);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['product_id', 'role']);
  });

  await knex.schema.createTable('product_plans', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.enu('model', ['free', 'trial', 'once_off', 'monthly', 'annual', 'quote', 'per_user', 'per_device', 'tier']).notNullable();
    t.bigInteger('price_cents').unsigned(); // null for free / quote
    t.string('currency', 3).notNullable().defaultTo('ZAR');
    t.enu('billing_period', ['none', 'month', 'year']).notNullable().defaultTo('none');
    t.enu('unit', ['licence', 'user', 'device']).notNullable().defaultTo('licence');
    t.boolean('price_includes_vat').notNullable().defaultTo(false);
    t.text('conditions');
    t.json('inclusions');
    t.smallint('max_devices').unsigned();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_highlighted').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['product_id', 'is_active']);
  });

  await knex.schema.createTable('product_versions', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('version', 40).notNullable();
    t.string('name', 120);
    t.date('release_date');
    t.text('release_notes', 'mediumtext');
    t.text('min_requirements');
    t.enu('status', ['draft', 'testing', 'released', 'deprecated', 'withdrawn']).notNullable().defaultTo('draft');
    t.boolean('is_latest').notNullable().defaultTo(false);
    t.boolean('is_recommended').notNullable().defaultTo(false);
    t.boolean('is_mandatory').notNullable().defaultTo(false);
    t.boolean('downloads_enabled').notNullable().defaultTo(true);
    t.bigInteger('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.unique(['product_id', 'version']);
    t.index(['product_id', 'status']);
  });

  // One version can ship several installers (Windows x64, Android APK…). Files are never overwritten.
  await knex.schema.createTable('version_files', (t) => {
    t.bigIncrements('id');
    t.bigInteger('version_id').unsigned().notNullable().references('product_versions.id').onDelete('RESTRICT');
    t.bigInteger('media_id').unsigned().notNullable().references('media.id').onDelete('RESTRICT');
    t.string('platform', 32).notNullable(); // windows, macos, linux, android, ios, web, any
    t.string('architecture', 16); // x64, arm64…
    t.string('label', 120);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['version_id', 'platform']);
  });

  await knex.schema.createTable('learning_resources', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().references('products.id').onDelete('CASCADE'); // null = general
    t.bigInteger('version_id').unsigned().references('product_versions.id').onDelete('SET NULL');
    t.string('section', 64).notNullable(); // getting_started, installation, configuration, usage, advanced, troubleshooting, updates, sales, marketing
    t.enu('audience', ['customer', 'partner', 'both']).notNullable().defaultTo('both');
    t.enu('visibility', ['public', 'customer', 'partner', 'staff']).notNullable().defaultTo('public');
    t.enu('kind', ['document', 'video', 'article', 'faq', 'template', 'link']).notNullable();
    t.string('title', 255).notNullable();
    t.text('summary');
    t.text('body', 'mediumtext'); // article / FAQ answer (sanitised HTML)
    t.bigInteger('media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_published').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['product_id', 'section', 'is_published']);
    t.index(['audience', 'visibility']);
  });
};

exports.down = async function (knex) {
  for (const t of ['learning_resources', 'version_files', 'product_versions', 'product_plans', 'product_media', 'product_features', 'products', 'product_categories', 'media']) {
    await knex.schema.dropTableIfExists(t);
  }
};

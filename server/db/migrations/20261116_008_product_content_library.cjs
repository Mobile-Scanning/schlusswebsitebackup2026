/**
 * Product content library (v8): many content items (videos, tutorials, demonstrations…) per product,
 * grouped in per-product categories, each with its own cover image, plus privacy-light view analytics.
 * Covers and private video files reuse the existing `media` table and private storage.
 */
exports.up = async function (knex) {
  // Who may watch a product's content (null = the default in Admin › Content settings).
  await knex.schema.alterTable('products', (t) => {
    t.enu('content_access', ['public', 'registered', 'authorised', 'demo']).nullable();
  });

  await knex.schema.createTable('product_content_categories', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('description', 500);
    t.integer('display_order').notNullable().defaultTo(0);
    t.enu('status', ['active', 'hidden']).notNullable().defaultTo('active');
    t.timestamps(true, true);
    t.index(['product_id', 'display_order']);
  });

  await knex.schema.createTable('product_content_items', (t) => {
    t.bigIncrements('id');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.bigInteger('category_id').unsigned().references('product_content_categories.id').onDelete('SET NULL');
    t.string('title', 191).notNullable();
    t.string('description', 1000);
    t.enu('content_type', ['video', 'tutorial', 'demonstration', 'training', 'installation', 'feature', 'other']).notNullable().defaultTo('video');
    t.bigInteger('cover_media_id').unsigned().references('media.id').onDelete('SET NULL');
    t.enu('video_provider', ['youtube', 'vimeo', 'upload']).notNullable();
    t.string('video_reference', 255); // YouTube id, or Vimeo id[:privacy hash]; null for uploads
    t.bigInteger('video_media_id').unsigned().references('media.id').onDelete('SET NULL'); // private uploaded file
    t.integer('duration_seconds').unsigned();
    t.json('tags');
    t.integer('display_order').notNullable().defaultTo(0);
    t.enu('status', ['draft', 'published']).notNullable().defaultTo('draft');
    t.enu('access_level', ['inherit', 'public', 'registered', 'authorised', 'demo']).notNullable().defaultTo('inherit');
    t.json('embed_check'); // last link test: { ok, verified, message, checkedAt }
    t.datetime('published_at');
    t.bigInteger('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.bigInteger('updated_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['product_id', 'category_id', 'display_order']);
    t.index(['product_id', 'status']);
  });

  await knex.schema.createTable('product_content_views', (t) => {
    t.bigIncrements('id');
    t.bigInteger('content_id').unsigned().notNullable().references('product_content_items.id').onDelete('CASCADE');
    t.bigInteger('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.bigInteger('customer_id').unsigned().references('customers.id').onDelete('SET NULL');
    t.string('viewer_hash', 64).notNullable(); // customer id or a keyed hash of the visitor – never the raw IP
    t.datetime('viewed_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('last_progress_at');
    t.integer('progress_seconds').unsigned().notNullable().defaultTo(0);
    t.integer('duration_seconds').unsigned();
    t.tinyint('percent').unsigned().notNullable().defaultTo(0);
    t.boolean('completed').notNullable().defaultTo(false);
    t.index(['content_id', 'viewer_hash', 'viewed_at']);
    t.index(['product_id', 'viewed_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('product_content_views');
  await knex.schema.dropTableIfExists('product_content_items');
  await knex.schema.dropTableIfExists('product_content_categories');
  await knex.schema.alterTable('products', (t) => t.dropColumn('content_access'));
};

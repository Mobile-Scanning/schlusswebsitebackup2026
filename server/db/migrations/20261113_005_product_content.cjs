/**
 * Product content upgrade – additive only, no data is changed:
 *  - products.preview_media_id: a dedicated "Coming soon" / preview image per product
 *  - product_media.thumbnail_media_id, duration_seconds, description: richer video tiles
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('products', (t) => {
    t.bigInteger('preview_media_id').unsigned().nullable().references('media.id').onDelete('SET NULL');
  });
  await knex.schema.alterTable('product_media', (t) => {
    t.bigInteger('thumbnail_media_id').unsigned().nullable().references('media.id').onDelete('SET NULL');
    t.integer('duration_seconds').unsigned().nullable();
    t.string('description', 500).nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('product_media', (t) => {
    t.dropForeign(['thumbnail_media_id']);
    t.dropColumn('thumbnail_media_id');
    t.dropColumn('duration_seconds');
    t.dropColumn('description');
  });
  await knex.schema.alterTable('products', (t) => {
    t.dropForeign(['preview_media_id']);
    t.dropColumn('preview_media_id');
  });
};

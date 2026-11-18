/**
 * v10: YouTube playlist ("folder") imports.
 * Remembers which playlist an item / category came from, so a playlist can be checked again later
 * for new videos without importing duplicates. Nothing existing is changed.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('product_content_items', (t) => {
    t.string('source_playlist', 64).nullable();
    t.index(['product_id', 'video_provider', 'video_reference'], 'pci_product_provider_ref');
  });
  await knex.schema.alterTable('product_content_categories', (t) => {
    t.string('source_playlist', 64).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('product_content_items', (t) => {
    t.dropIndex(['product_id', 'video_provider', 'video_reference'], 'pci_product_provider_ref');
    t.dropColumn('source_playlist');
  });
  await knex.schema.alterTable('product_content_categories', (t) => {
    t.dropColumn('source_playlist');
  });
};

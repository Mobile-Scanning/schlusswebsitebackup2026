/**
 * v12: About SCHLUSS puzzle story.
 * Optional per-offering settings that decide whether (and how) an offering appears on the About SCHLUSS page
 * and in its puzzle animation. Everything defaults to "not shown", so nothing changes until an admin opts in.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.boolean('about_show').notNullable().defaultTo(false);
    t.boolean('about_puzzle').notNullable().defaultTo(true);
    t.integer('about_order').notNullable().defaultTo(0);
    t.string('about_title', 120).nullable();
    t.text('about_description').nullable();
    t.string('about_problem', 400).nullable();
    t.string('about_highlight', 160).nullable();
    t.bigInteger('about_cover_media_id').unsigned().nullable().references('id').inTable('media').onDelete('SET NULL');
    t.bigInteger('about_image_media_id').unsigned().nullable().references('id').inTable('media').onDelete('SET NULL');
    t.index(['about_show', 'about_order'], 'products_about_idx');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropIndex(['about_show', 'about_order'], 'products_about_idx');
    t.dropForeign(['about_cover_media_id']);
    t.dropForeign(['about_image_media_id']);
    t.dropColumn('about_show');
    t.dropColumn('about_puzzle');
    t.dropColumn('about_order');
    t.dropColumn('about_title');
    t.dropColumn('about_description');
    t.dropColumn('about_problem');
    t.dropColumn('about_highlight');
    t.dropColumn('about_cover_media_id');
    t.dropColumn('about_image_media_id');
  });
};

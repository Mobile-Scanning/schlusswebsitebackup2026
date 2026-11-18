/**
 * Offering types (v9): every product row can be a software product, learning content, a training course,
 * a product under development or "other", with optional features switched on per offering.
 * Same table, same id – an offering can change type later without losing anything.
 * Existing products are migrated without changing what customers see today.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.enu('offering_type', ['software', 'learning', 'training', 'development', 'other']).notNullable().defaultTo('software');
    t.json('features'); // { installer, demo, trial, pricing, purchase, learning } – missing keys use the type's defaults
    t.index(['offering_type']);
  });
  const rows = await knex('products').select('id', 'status', 'trial_days', 'demo_options');
  for (const p of rows) {
    let opts = {};
    try {
      opts = typeof p.demo_options === 'string' ? JSON.parse(p.demo_options || '{}') : p.demo_options || {};
    } catch {
      opts = {};
    }
    const type = p.status === 'coming_soon' ? 'development' : 'software';
    // Keep everything that works today switched on.
    const features = { installer: true, demo: !!opts.downloadable || type === 'software', trial: !!p.trial_days, pricing: true, purchase: true, learning: true };
    await knex('products').where({ id: p.id }).update({ offering_type: type, features: JSON.stringify(features) });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropIndex(['offering_type']);
    t.dropColumn('features');
    t.dropColumn('offering_type');
  });
};

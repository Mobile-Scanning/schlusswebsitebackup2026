// Sample catalogue for local development and demos: 5 categories, 6 products,
// features, plans and Learning Centre articles. Runs only while the catalogue is
// empty, so it never touches real data. Remove or edit the products in the
// admin portal before going live.
const data = require('./sample-catalogue.json');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const clean = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && ISO.test(v) ? new Date(v) : v,
    ]),
  );

exports.seed = async (knex) => {
  const [{ n }] = await knex('products').count({ n: '*' });
  if (Number(n) > 0) return;
  await knex.transaction(async (trx) => {
    for (const table of ['product_categories', 'products', 'product_features', 'product_plans', 'learning_resources']) {
      const rows = (data[table] || []).map(clean);
      if (rows.length) await trx(table).insert(rows);
    }
  });
};

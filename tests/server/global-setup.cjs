// Fresh schema for every test run: roll back everything, migrate, seed reference data.
const path = require('node:path');
process.env.NODE_ENV = 'test';
module.exports = async function () {
  const cfg = require(path.join(__dirname, '../../server/db/knexfile.cjs')).test;
  const knex = require('knex')(cfg);
  await knex.migrate.rollback(undefined, true);
  await knex.migrate.latest();
  await knex.seed.run();
  await knex.destroy();
};

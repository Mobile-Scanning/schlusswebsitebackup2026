// Knex configuration – used by the migration CLI and by the API at runtime.
// All connection details come from environment variables (never commit .env).
require('dotenv').config({ path: require('node:path').join(__dirname, '../../.env'), quiet: true });

function connection(dbName) {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
    charset: 'utf8mb4',
    timezone: 'Z', // store and read all DATETIMEs as UTC
    dateStrings: false,
  };
}

const base = {
  client: 'mysql2',
  pool: {
    min: 0,
    max: Number(process.env.DB_POOL_MAX || 5),
    // Every connection runs in UTC so NOW() and JS Dates always agree.
    afterCreate: (conn, done) => conn.query("SET time_zone = '+00:00'", (err) => done(err, conn)),
  },
  migrations: { directory: __dirname + '/migrations', tableName: 'knex_migrations', loadExtensions: ['.cjs'] },
  seeds: { directory: __dirname + '/seeds', loadExtensions: ['.cjs'] },
};

module.exports = {
  development: { ...base, connection: connection(process.env.DB_NAME || 'schluss') },
  test: { ...base, connection: connection(process.env.DB_NAME_TEST || 'schluss_test') },
  production: { ...base, connection: connection(process.env.DB_NAME) },
};

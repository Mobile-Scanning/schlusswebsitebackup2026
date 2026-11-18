import knexFactory, { Knex } from 'knex';
import { config } from './config';
import { explainDbError } from '../db/explain-error.cjs';

let lastReport = 0;

/** Single shared connection pool to the one central MySQL database. */
export const db: Knex = knexFactory({
  client: 'mysql2',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    timezone: 'Z',
  },
  // Connection failures are reported once a minute in plain words (see checkDatabase) instead of
  // a stack trace on every request.
  log: {
    warn(message: string) {
      if (typeof message === 'string' && message.startsWith('Acquire connection error')) {
        if (Date.now() - lastReport > 60_000) void checkDatabase();
        return;
      }
      console.warn(message);
    },
  },
  pool: {
    min: 0,
    max: config.db.poolMax,
    // Every connection runs in UTC so NOW() and JS Dates always agree.
    afterCreate: (conn: { query: (sql: string, cb: (err: Error | null) => void) => void }, done: (err: Error | null, conn: unknown) => void) =>
      conn.query("SET time_zone = '+00:00'", (err) => done(err, conn)),
  },
});

/** Current time according to the database server – authoritative for trials and expiries. */
export async function dbNow(): Promise<Date> {
  const [rows] = await db.raw('SELECT UTC_TIMESTAMP(3) AS now');
  return new Date(rows[0].now);
}

/**
 * Start-up check: one quick query so a missing database or wrong login is reported
 * once, in plain words, instead of as a stack trace on the first page request.
 */
export async function checkDatabase(throttled = false): Promise<boolean> {
  if (throttled && Date.now() - lastReport < 60_000) return false;
  try {
    await db('roles').first('id');
    return true;
  } catch (e) {
    lastReport = Date.now();
    console.error('\n✖ SCHLUSS cannot use the database.\n  ' + explainDbError(e).replace(/\n/g, '\n  ') + '\n');
    return false;
  }
}

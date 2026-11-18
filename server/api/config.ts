import 'dotenv/config';

/** Central runtime configuration. Everything sensitive comes from environment variables. */
const env = process.env;
const isProd = env['NODE_ENV'] === 'production';
const isTest = env['NODE_ENV'] === 'test';

function required(name: string, fallbackForDev?: string): string {
  const v = env[name];
  if (v) return v;
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

const appSecret = required('APP_SECRET', 'dev-only-insecure-secret-change-me-0123456789');
if (isProd && appSecret.length < 32) throw new Error('APP_SECRET must be at least 32 characters');

export const config = {
  isProd,
  isTest,
  appUrl: required('APP_URL', 'http://localhost:4200').replace(/\/$/, ''),
  appSecret,
  db: {
    host: env['DB_HOST'] || '127.0.0.1',
    port: Number(env['DB_PORT'] || 3306),
    user: required('DB_USER', 'schluss'),
    password: env['DB_PASSWORD'] || '',
    database: isTest ? env['DB_NAME_TEST'] || 'schluss_test' : required('DB_NAME', 'schluss'),
    poolMax: Number(env['DB_POOL_MAX'] || 5),
  },
  session: {
    cookie: isProd ? '__Host-sch_sid' : 'sch_sid', // __Host- prefix: secure, path=/, no domain
    ttlHours: Number(env['SESSION_TTL_HOURS'] || 12), // sliding idle timeout
    maxDays: Number(env['SESSION_MAX_DAYS'] || 14), // absolute lifetime
    // Staff (admin portal) sessions are shorter: signed out after this much inactivity, and at most this long in total.
    staffIdleMinutes: Number(env['SESSION_STAFF_IDLE_MINUTES'] || 120),
    staffMaxHours: Number(env['SESSION_STAFF_MAX_HOURS'] || 24),
  },
  csrfCookie: 'XSRF-TOKEN',
  csrfHeader: 'x-xsrf-token',
  auth: {
    bcryptCost: isTest ? 4 : 12,
    maxFailedLogins: 5,
    lockMinutes: 15,
    resetTokenMinutes: 60,
  },
  legal: {
    privacyVersion: env['PRIVACY_POLICY_VERSION'] || '2026-11',
    termsVersion: env['TERMS_VERSION'] || '2026-11',
  },
};

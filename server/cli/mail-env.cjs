/**
 * Loads .env for the mail scripts. The mail settings (MAIL_*) are always taken fresh from the .env file, even
 * when the website that started this script was launched before .env was edited – so a corrected password or
 * mail server works without waiting for a restart. Other settings keep the normal rule (the environment wins).
 */
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const file = path.join(__dirname, '../../.env');
dotenv.config({ path: file, quiet: true });
if (process.env.NODE_ENV !== 'test' && !process.env.MAIL_ENV_LOCKED && fs.existsSync(file)) {
  const parsed = dotenv.parse(fs.readFileSync(file));
  for (const [k, v] of Object.entries(parsed)) if (k.startsWith('MAIL_')) process.env[k] = v;
}

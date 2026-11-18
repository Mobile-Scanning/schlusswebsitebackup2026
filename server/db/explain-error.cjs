// Turns MySQL/MariaDB connection and setup errors into plain-language advice.
// Used by npm run setup, npm run admin:create and the server's start-up check.

function explainDbError(e, env = process.env) {
  const where = `${env.DB_HOST || '127.0.0.1'}:${env.DB_PORT || 3306}`;
  const code = e && (e.code || (e.original && e.original.code));
  const raw = (e && (e.sqlMessage || e.message)) || String(e);
  const tips = {
    ECONNREFUSED: `MySQL is not running at ${where}. Start MySQL (XAMPP Control Panel → Start next to MySQL), then try again.`,
    ETIMEDOUT: `MySQL at ${where} did not answer. Check DB_HOST and DB_PORT in .env and that MySQL is running.`,
    ENOTFOUND: `The database host "${env.DB_HOST}" could not be found. For your own computer use DB_HOST=127.0.0.1 in .env.`,
    ER_ACCESS_DENIED_ERROR: `MySQL refused the login "${env.DB_USER}". Put your MySQL user name and password in DB_USER and DB_PASSWORD in .env (XAMPP default: user root, empty password), save, and try again.`,
    ER_ACCESS_DENIED_NO_PASSWORD_ERROR: `MySQL needs a password for the user "${env.DB_USER}". Open .env, type it after DB_PASSWORD= (for example DB_PASSWORD=MyPassword), save, and try again.`,
    ER_DBACCESS_DENIED_ERROR: `The MySQL user "${env.DB_USER}" is not allowed to use the database "${env.DB_NAME}". Use an account with full rights (for example root) in .env.`,
    ER_BAD_DB_ERROR: `The database "${env.DB_NAME}" doesn't exist yet. Run: npm run setup`,
    ER_NO_SUCH_TABLE: `The database tables are missing. Run: npm run setup`,
    ER_TABLE_EXISTS_ERROR: `An earlier setup stopped halfway, so some tables already exist. Run: npm run db:fresh  (wipes the local "${env.DB_NAME}" database and sets it up again), or send this message to your developer.`,
    ER_DUP_KEYNAME: `An earlier setup stopped halfway. Run: npm run db:fresh  (wipes the local "${env.DB_NAME}" database and sets it up again).`,
    ER_NOT_SUPPORTED_AUTH_MODE: `Your MySQL server uses a login method this app can't use. In MySQL run: ALTER USER '${env.DB_USER}'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'your-password';`,
    ER_HOST_NOT_PRIVILEGED: `MySQL doesn't allow connections from this computer for user "${env.DB_USER}". Use DB_HOST=127.0.0.1 or localhost in .env.`,
  };
  const tip = tips[code] || 'Send the message above to your developer.';
  return `${code ? code + ': ' : ''}${raw}\n→ ${tip}`;
}

module.exports = { explainDbError };

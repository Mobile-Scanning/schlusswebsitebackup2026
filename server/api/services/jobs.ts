import type { Knex } from 'knex';
import { db } from '../db';

/**
 * Queue an email. Delivery happens in the background worker (server/cli/worker.cjs, run by cron),
 * so a slow mail server never blocks a web request. Every email gets an email_logs row.
 */
export async function queueEmail(
  to: string,
  template: string,
  vars: Record<string, unknown>,
  trx: Knex | Knex.Transaction = db,
  /** Which mailbox sends it. Default: partner emails from the sales mailbox, everything else from support. */
  account?: 'support' | 'sales',
) {
  const [logId] = await trx('email_logs').insert({ to_email: to, template_key: template, status: 'queued' });
  const [jobId] = await trx('jobs').insert({
    type: 'email',
    payload: JSON.stringify({ to, template, vars, logId, ...(account ? { account } : {}) }),
  });
  await trx('email_logs').where({ id: logId }).update({ job_id: jobId });
  return jobId;
}

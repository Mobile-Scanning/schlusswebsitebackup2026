import type { Request } from 'express';
import type { Knex } from 'knex';
import { db } from '../db';

export interface AuditEntry {
  action: string;
  subjectType?: string;
  subjectId?: number | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

const REDACT = new Set(['password', 'password_hash', 'token', 'token_hash', 'csrf_secret']);
function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return JSON.stringify(v, (k, val) => (REDACT.has(k) ? '[redacted]' : val));
}

/** Write an audit record. Pass a transaction to make the audit atomic with the change. */
export async function audit(req: Request | null, entry: AuditEntry, trx: Knex | Knex.Transaction = db) {
  await trx('audit_logs').insert({
    actor_id: req?.auth?.user.id ?? null,
    action: entry.action,
    subject_type: entry.subjectType ?? null,
    subject_id: entry.subjectId ?? null,
    before: clean(entry.before),
    after: clean(entry.after),
    meta: clean(entry.meta),
    ip: req?.ip ?? null,
  });
}

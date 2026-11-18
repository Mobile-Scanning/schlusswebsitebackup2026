import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config';
import { db } from '../db';
import { alertAdmins } from './security';

/**
 * Housekeeping that protects the business without anyone having to remember it:
 *  - an automatic daily backup (database + uploaded files), verified after it is made, old ones removed
 *  - data retention: short-lived technical records that contain personal details are deleted after a set time
 *
 * Automatic backups are ON on the live server and OFF on a development computer (BACKUP_DAILY=on / off overrides).
 */
const DAY = 86400_000;
export const backupDir = () => resolve(process.env['BACKUP_DIR'] || join(process.cwd(), 'backups'));
const keep = () => Math.max(3, Number(process.env['BACKUP_KEEP_DAYS'] || 14));
export const backupsEnabled = () => (process.env['BACKUP_DAILY'] ? process.env['BACKUP_DAILY'] !== 'off' : config.isProd);
const NAME = /^schluss-backup-(\d{8})-(\d{4})$/;

export const backupState: { running: boolean; lastRunAt: string | null; lastOk: boolean | null; lastMessage: string | null } = { running: false, lastRunAt: null, lastOk: null, lastMessage: null };

export function listBackups() {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => NAME.test(n) && existsSync(join(dir, n, 'manifest.json')))
    .sort()
    .reverse()
    .map((n) => ({ name: n, at: statSync(join(dir, n, 'manifest.json')).mtime.toISOString() }));
}

const run = (script: string, args: string[]) =>
  new Promise<{ ok: boolean; out: string }>((done) => execFile(process.execPath, [join(process.cwd(), 'server/cli', script), ...args], { cwd: process.cwd(), timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => done({ ok: !err, out: `${stdout}\n${stderr}`.trim().slice(-800) })));

/** Make a backup now, verify it can be read back completely, then remove backups older than the retention period. */
export async function runBackup(): Promise<typeof backupState> {
  if (backupState.running) return backupState;
  backupState.running = true;
  try {
    const dir = backupDir();
    const before = new Set(listBackups().map((b) => b.name));
    const made = await run('backup.cjs', [dir, '--mirror']);
    const created = listBackups().find((b) => !before.has(b.name));
    let ok = made.ok && !!created;
    let message = ok ? `Backup ${created!.name} made` : `The backup failed: ${made.out}`;
    if (ok) {
      const verified = await run('restore.cjs', [join(dir, created!.name), '--verify']);
      ok = verified.ok;
      message = ok ? `${created!.name} – verified (${verified.out.split('\n').pop()})` : `Backup ${created!.name} was made but did not pass verification: ${verified.out}`;
    }
    if (ok) {
      // Retention: keep the newest N; never remove the only good one.
      for (const old of listBackups().slice(keep())) rmSync(join(dir, old.name), { recursive: true, force: true });
    }
    Object.assign(backupState, { lastRunAt: new Date().toISOString(), lastOk: ok, lastMessage: message });
    await db('audit_logs').insert({ actor_id: null, action: ok ? 'system.backup' : 'system.backup_failed', subject_type: 'system', meta: JSON.stringify({ message: message.slice(0, 500) }) });
    if (!ok) await alertAdmins('The automatic backup failed', message);
  } catch (e) {
    Object.assign(backupState, { lastRunAt: new Date().toISOString(), lastOk: false, lastMessage: String((e as Error).message) });
  } finally {
    backupState.running = false;
  }
  return backupState;
}

/**
 * Data retention (POPIA: don't keep personal information longer than needed). Only short-lived TECHNICAL records are
 * removed – never customers, licences, enquiries, conversations or the audit log.
 */
export const RETENTION = {
  otpDays: Number(process.env['RETENTION_OTP_DAYS'] || 7), // used / expired email verification codes
  jobDays: Number(process.env['RETENTION_JOB_DAYS'] || 30), // finished email jobs (their payload repeats the email's details)
  webhookDays: Number(process.env['RETENTION_WEBHOOK_DAYS'] || 90), // raw WhatsApp webhook payloads (the messages themselves stay in the conversation)
};
export async function runRetention() {
  const older = (days: number) => db.raw('DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [days]);
  const out = {
    otps: await db('email_otps').where('created_at', '<', older(RETENTION.otpDays)).del(),
    jobs: await db('jobs').whereIn('status', ['done', 'failed']).where('created_at', '<', older(RETENTION.jobDays)).del(),
    webhooks: await db('whatsapp_events').where('created_at', '<', older(RETENTION.webhookDays)).del().catch(() => 0),
    resets: await db('password_resets').where('expires_at', '<', older(1)).del(),
    sessions: await db('sessions').where('expires_at', '<', db.fn.now()).del(),
  };
  return out;
}

let timer: NodeJS.Timeout | null = null;
export function startMaintenance() {
  if (timer || config.isTest || process.env['NO_SCHEDULER']) return;
  const tick = async () => {
    try {
      await runRetention();
      if (backupsEnabled()) {
        const newest = listBackups()[0];
        if (!newest || Date.now() - new Date(newest.at).getTime() > DAY - 3600_000) await runBackup();
      }
    } catch {
      /* tried again at the next round */
    }
  };
  timer = setInterval(() => void tick(), 3600_000);
  timer.unref();
  setTimeout(() => void tick(), 90_000).unref(); // shortly after start-up, not during it
}

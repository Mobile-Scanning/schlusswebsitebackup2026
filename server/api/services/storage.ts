import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomToken } from './crypto';

/**
 * Private file storage on the server's disk, OUTSIDE the public web root.
 * Files are only ever served through the API after an access check. Storage keys are random –
 * the original filename is kept as metadata only, so paths can never be guessed or traversed.
 * (An S3-compatible driver can replace this module later without changing callers.)
 */
const ROOT = resolve(process.env['STORAGE_DIR'] || join(process.cwd(), 'storage'));

export interface StoredFile {
  storageKey: string;
  size: number;
  sha256: string;
}

function safePath(key: string) {
  if (!/^[a-z]+\/\d{4}\/\d{2}\/[A-Za-z0-9_-]{20,}\.[a-z0-9]{1,8}$/.test(key)) throw new Error('Invalid storage key');
  return join(ROOT, key);
}

export async function saveFile(buf: Buffer, folder: string, ext: string): Promise<StoredFile> {
  const d = new Date();
  const key = `${folder}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(18)}.${ext}`;
  const path = safePath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf, { flag: 'wx' }); // never overwrite an existing file
  return { storageKey: key, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

export async function fileStat(key: string) {
  const p = safePath(key);
  return existsSync(p) ? stat(p) : null;
}

export function readStream(key: string, range?: { start: number; end: number }) {
  return createReadStream(safePath(key), range);
}

export async function removeFile(key: string) {
  try {
    await unlink(safePath(key));
  } catch {
    /* already gone */
  }
}

/* ---------- Content sniffing: trust the bytes, not the filename or browser-supplied type ---------- */
export interface Sniffed {
  mime: string;
  ext: string;
  kind: 'image' | 'pdf';
}

export function sniff(buf: Buffer): Sniffed | null {
  const h = buf.subarray(0, 12);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (h.toString('ascii', 0, 6) === 'GIF87a' || h.toString('ascii', 0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (h.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
  // SVG is deliberately NOT accepted: it can carry scripts.
  return null;
}

/** Image dimensions for PNG/JPEG/WebP/GIF without native dependencies (used for layout hints). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf[0] === 0x89) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (buf[0] === 0xff) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

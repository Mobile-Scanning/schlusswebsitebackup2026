import { checkLink, imageTool } from './content';

/**
 * YouTube playlist ("folder link") reading, for importing a whole playlist into a product's content library.
 *
 * Two ways to read a playlist – both server-side, nothing is exposed to the browser:
 *  - With YOUTUBE_API_KEY (YouTube Data API v3, free key): the whole playlist (up to MAX_VIDEOS), with each
 *    video's duration and whether its owner allows embedding.
 *  - Without a key: YouTube's public playlist feed, which only ever contains 15 videos. Embedding is then
 *    tested per video with the same oEmbed check used for single links.
 * Private playlists can't be read either way (YouTube doesn't share them); public and unlisted ones can.
 */

export const MAX_VIDEOS = 500;
const API = () => (process.env['YOUTUBE_API_BASE'] || 'https://www.googleapis.com').replace(/\/$/, '');
const FEED = () => (process.env['YOUTUBE_FEED_BASE'] || 'https://www.youtube.com').replace(/\/$/, '');
const THUMBS = () => (process.env['YOUTUBE_THUMB_BASE'] || 'https://i.ytimg.com').replace(/\/$/, '');
/** Small thumbnail for the admin import list (shown in the admin's browser only). */
export const thumbnailUrl = (videoId: string) => `${THUMBS()}/vi/${videoId}/mqdefault.jpg`;
export const youtubeApiKey = () => (process.env['YOUTUBE_API_KEY'] || '').trim() || null;

export interface PlaylistVideo {
  videoId: string;
  title: string;
  description: string;
  position: number;
  durationSeconds: number | null;
  /** true: can be embedded · false: can't (private, deleted or embedding off) · null: couldn't be tested */
  embeddable: boolean | null;
  problem: string | null;
}
export interface Playlist { id: string; title: string; videos: PlaylistVideo[]; source: 'api' | 'feed'; complete: boolean; note: string | null }

export class PlaylistError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

/** Extracts the playlist id from a playlist link (also a video link that is playing inside a playlist). */
export function parsePlaylistLink(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (!(host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com')) return null;
  const list = u.searchParams.get('list');
  return list && /^[\w-]{2,64}$/.test(list) ? list : null;
}

/** Mixes, Watch later, Liked videos etc. are personal/generated lists that YouTube never shares. */
export function unsupportedListReason(id: string): string | null {
  if (/^(WL|LL|LM)$/.test(id)) return 'This is a personal list (Watch later / Liked videos), which YouTube keeps private. Copy the videos into a normal playlist and use that link.';
  if (/^RD/.test(id)) return 'This is an automatic YouTube “Mix”, not a playlist. Open your own playlist and use its link instead.';
  return null;
}

const iso = (d: string | undefined) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? '');
  if (!m) return null;
  const s = (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0);
  return s > 0 ? s : null;
};

async function getJson(url: string) {
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  } catch {
    throw new PlaylistError('The server couldn’t reach YouTube to read this playlist. Check the server’s internet connection and try again.', 502);
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!r.ok) {
    const reason = j?.['error']?.errors?.[0]?.reason as string | undefined;
    if (r.status === 404 || reason === 'playlistNotFound') throw new PlaylistError('This playlist can’t be found. It may be private or deleted – set it to Public or Unlisted on YouTube.');
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new PlaylistError('The daily YouTube API allowance for this key has been used up. Try again tomorrow.', 429);
    if (r.status === 400 || r.status === 403) throw new PlaylistError('YouTube refused the API key (YOUTUBE_API_KEY). Check the key and that “YouTube Data API v3” is enabled for it in Google Cloud.', 502);
    throw new PlaylistError(`YouTube returned an error (${r.status}). Please try again.`, 502);
  }
  return j;
}

async function viaApi(id: string, key: string): Promise<Playlist> {
  const k = encodeURIComponent(key);
  const meta = await getJson(`${API()}/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(id)}&key=${k}`);
  if (!meta['items']?.length) throw new PlaylistError('This playlist can’t be found. It may be private or deleted – set it to Public or Unlisted on YouTube.');
  const title = String(meta['items'][0].snippet?.title ?? 'YouTube playlist');
  const rows: { videoId: string; title: string; description: string; position: number; privacy: string }[] = [];
  let page = '';
  let total = 0;
  do {
    const j = await getJson(`${API()}/youtube/v3/playlistItems?part=snippet,status&maxResults=50&playlistId=${encodeURIComponent(id)}&key=${k}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    total = Number(j['pageInfo']?.totalResults ?? 0);
    for (const it of j['items'] ?? []) {
      const vid = it.snippet?.resourceId?.videoId;
      if (vid && /^[\w-]{11}$/.test(vid)) rows.push({ videoId: vid, title: String(it.snippet?.title ?? ''), description: String(it.snippet?.description ?? ''), position: Number(it.snippet?.position ?? rows.length), privacy: String(it.status?.privacyStatus ?? '') });
    }
    page = j['nextPageToken'] ?? '';
  } while (page && rows.length < MAX_VIDEOS);
  const details = new Map<string, { duration: number | null; embeddable: boolean; privacy: string }>();
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r) => r.videoId).join(',');
    const j = await getJson(`${API()}/youtube/v3/videos?part=contentDetails,status&id=${ids}&key=${k}`);
    for (const v of j['items'] ?? []) details.set(v.id, { duration: iso(v.contentDetails?.duration), embeddable: v.status?.embeddable !== false, privacy: String(v.status?.privacyStatus ?? '') });
  }
  const videos = rows.slice(0, MAX_VIDEOS).map((r, n) => {
    const d = details.get(r.videoId);
    const problem = !d || r.privacy === 'private' || d.privacy === 'private' ? 'This video is private or deleted, so it can’t be shown on your website.' : !d.embeddable ? 'The owner has switched off embedding for this video (YouTube Studio › “Allow embedding”).' : null;
    return { videoId: r.videoId, title: r.title, description: r.description, position: n, durationSeconds: d?.duration ?? null, embeddable: problem ? false : true, problem };
  });
  const complete = rows.length >= total || total <= MAX_VIDEOS;
  return { id, title, videos, source: 'api', complete, note: total > MAX_VIDEOS ? `This playlist has ${total} videos; the first ${MAX_VIDEOS} were read.` : null };
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unxml(m[1]) : '';
};

async function viaFeed(id: string): Promise<Playlist> {
  let r: Response;
  try {
    r = await fetch(`${FEED()}/feeds/videos.xml?playlist_id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000) });
  } catch {
    throw new PlaylistError('The server couldn’t reach YouTube to read this playlist. Check the server’s internet connection and try again.', 502);
  }
  if (r.status === 404 || r.status === 400) throw new PlaylistError('This playlist can’t be found. It may be private or deleted – set it to Public or Unlisted on YouTube.');
  if (!r.ok) throw new PlaylistError(`YouTube returned an error (${r.status}). Please try again.`, 502);
  const xml = await r.text();
  const head = xml.split('<entry')[0];
  const title = tag(head, 'title') || 'YouTube playlist';
  const entries = xml.split('<entry').slice(1);
  const base = entries
    .map((e, n) => ({ videoId: tag(e, 'yt:videoId'), title: tag(e, 'title'), description: tag(e, 'media:description'), position: n }))
    .filter((v) => /^[\w-]{11}$/.test(v.videoId));
  // Test each video the same way single links are tested (oEmbed), a few at a time.
  const videos: PlaylistVideo[] = [];
  for (let i = 0; i < base.length; i += 5) {
    const checks = await Promise.all(base.slice(i, i + 5).map((v) => checkLink({ provider: 'youtube', reference: v.videoId })));
    checks.forEach((c, n) => {
      const v = base[i + n];
      videos.push({ ...v, durationSeconds: c.duration ?? null, embeddable: c.ok, problem: c.ok === false ? c.message : null });
    });
  }
  return {
    id, title, videos, source: 'feed', complete: base.length < 15,
    note: base.length >= 15 ? 'Without a YouTube API key, YouTube only shares 15 videos of a playlist. If this playlist has more, add YOUTUBE_API_KEY to the server’s .env file to import all of them.' : null,
  };
}

export async function readPlaylist(id: string): Promise<Playlist> {
  const bad = unsupportedListReason(id);
  if (bad) throw new PlaylistError(bad);
  const key = youtubeApiKey();
  return key ? viaApi(id, key) : viaFeed(id);
}

/**
 * The video's YouTube thumbnail as a 16:9 cover image (largest available). Lower-resolution YouTube thumbnails
 * are 4:3 with black bars, so the middle 16:9 part is cut out. Returns null if none can be downloaded.
 */
export async function thumbnailCover(videoId: string): Promise<Buffer | null> {
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    let buf: Buffer;
    try {
      const r = await fetch(`${THUMBS()}/vi/${videoId}/${name}.jpg`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      buf = Buffer.from(await r.arrayBuffer());
    } catch {
      continue;
    }
    const sharp = await imageTool();
    if (!sharp) {
      if (buf.length > 1500) return buf;
      continue;
    }
    const m = await sharp(buf).metadata().catch(() => ({} as { width?: number; height?: number }));
    if (!m.width || !m.height || m.width < 320) continue; // YouTube's small "no thumbnail" placeholder
    if (Math.abs(m.width / m.height - 4 / 3) < 0.05) {
      const h = Math.round((m.width * 9) / 16);
      const s = sharp(buf) as unknown as { extract(o: object): { toBuffer(): Promise<Buffer> } };
      return s.extract({ left: 0, top: Math.round((m.height - h) / 2), width: m.width, height: h }).toBuffer();
    }
    return buf;
  }
  return null;
}

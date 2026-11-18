import { HttpClient } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, toApiError } from '../core/auth.service';
import { SeoService } from '../core/seo.service';
import { fmtDuration } from './content-library';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

/**
 * In-site content viewer: /products/:slug/content/:id
 * Plays the video inside SCHLUSS (official YouTube/Vimeo embed players, or a protected stream for privately
 * hosted videos – no download button, no file link, short-lived session-bound playback link that renews
 * itself). Previous / next stay inside the same product and category.
 */
@Component({
  selector: 'sch-content-viewer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap viewer">
      <a class="back" [routerLink]="['/products', slug()]" fragment="library">← {{ d()?.product?.name ?? 'Product' }} videos & tutorials</a>
      @if (d(); as d) {
        @if (d.preview) { <div class="alert" role="note"><strong>Preview</strong> – this is how customers will see it.@if (d.status === 'draft') { This item is a draft and is not visible to customers yet. }</div> }
        <div class="stage">
          <div class="player" [class.ready]="!!src() || !!stream()">
            @if (embed(); as e) {
              <iframe [src]="e" [title]="d.title" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen (load)="hookEmbed()" #frame></iframe>
            } @else if (stream(); as s) {
              <video #video [src]="s" controls playsinline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback
                (contextmenu)="$event.preventDefault()" (timeupdate)="tick()" (pause)="report()" (ended)="report(true)" (error)="renew()" (loadedmetadata)="resume()"></video>
            } @else if (playErr()) {
              <div class="msg"><strong>{{ playErr() }}</strong>
                @if (needLogin()) { <a class="btn btn-primary btn-sm" routerLink="/login" [queryParams]="{ next: here() }">Sign in</a> }
              </div>
            } @else {
              <button type="button" class="start" (click)="start()" [attr.aria-label]="'Play ' + d.title">
                @if (d.cover) { <img [src]="d.cover" alt="" /> }
                <span class="big-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg></span>
              </button>
            }
          </div>
          <div class="info">
            <span class="eyebrow">{{ d.category ?? 'Videos & tutorials' }} · {{ d.typeLabel }}</span>
            <h1>{{ d.title }}</h1>
            <p class="meta muted">{{ d.product.name }}@if (dur(d.duration); as t) { · {{ t }} }@if (d.position.of > 1) { · {{ d.position.index }} of {{ d.position.of }} }</p>
            @if (d.description) { <p class="desc">{{ d.description }}</p> }
            @if (d.tags?.length) { <p class="tags">@for (t of d.tags; track t) { <span>{{ t }}</span> }</p> }
          </div>
        </div>
        <nav class="pn" aria-label="More in this category">
          @if (d.previous; as p) {
            <a class="pv" [routerLink]="['/products', slug(), 'content', p.id]" [queryParams]="d.preview ? { preview: 1 } : {}"><span class="dir">← Previous</span>@if (p.cover) { <img [src]="p.cover" alt="" /> }<strong>{{ p.title }}</strong></a>
          } @else { <span></span> }
          @if (d.next; as n) {
            <a class="pv nx" [routerLink]="['/products', slug(), 'content', n.id]" [queryParams]="d.preview ? { preview: 1 } : {}"><span class="dir">Next →</span>@if (n.cover) { <img [src]="n.cover" alt="" /> }<strong>{{ n.title }}</strong></a>
          }
        </nav>
        <a class="btn btn-ghost" [routerLink]="['/products', slug()]" fragment="library">Back to the {{ d.product.name }} content library</a>
      } @else if (err()) {
        <div class="msg page">
          <strong>{{ err() }}</strong>
          <div class="row">
            @if (needLogin()) { <a class="btn btn-primary" routerLink="/login" [queryParams]="{ next: here() }">Sign in</a> }
            <a class="btn btn-ghost" [routerLink]="['/products', slug()]" fragment="library">Back to the product</a>
          </div>
        </div>
      } @else { <div class="player sk"></div> }
    </div>
  `,
  styles: `
    :host { display: block; }
    .viewer { padding-top: clamp(20px, 3vw, 36px); padding-bottom: clamp(40px, 6vw, 72px); display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
    .back { font-size: 14px; color: var(--muted); justify-self: start; }
    .back:hover { color: var(--accent-glow); }
    .stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; min-width: 0; }
    .player { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: var(--r-lg, 16px); overflow: hidden; background: #05070f; box-shadow: 0 30px 70px -30px rgba(0,0,0,.7); border: 1px solid var(--line); }
    .player iframe, .player video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
    .player.sk { background: var(--surface-2); }
    .start { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; cursor: pointer; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
    .start img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .big-play { position: absolute; left: 50%; top: 50%; width: 86px; height: 86px; margin: -43px 0 0 -43px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.94); box-shadow: 0 14px 40px rgba(0,0,0,.45); transition: scale .3s cubic-bezier(.3,1.4,.45,1); }
    .big-play svg { width: 38px; height: 38px; margin-left: 5px; fill: var(--accent-2, #1b4fd1); }
    .start:hover .big-play, .start:focus-visible .big-play { scale: 1.1; }
    .msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 14px; padding: 24px; text-align: center; color: #fff; }
    .msg.page { position: static; color: inherit; padding: 60px 16px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    .info h1 { font-size: clamp(26px, 3.4vw, 40px); margin: 6px 0 4px; }
    .meta { margin: 0; font-size: 14px; }
    .desc { max-width: 75ch; margin: 14px 0 0; white-space: pre-line; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0 0; } .tags span { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
    .pn { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
    .pv { display: grid; grid-template-columns: 120px 1fr; grid-template-rows: auto 1fr; gap: 4px 12px; align-items: center; padding: 10px; border-radius: var(--r-lg, 14px); border: 1px solid var(--line); background: var(--surface); color: inherit; text-decoration: none; transition: border-color .2s, translate .2s; }
    .pv:hover { border-color: var(--accent); translate: 0 -2px; text-decoration: none; }
    .pv img { grid-row: 1 / span 2; width: 120px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; }
    .pv .dir { font-size: 12px; color: var(--muted); } .pv strong { color: var(--heading); font-size: 15px; }
    .pv:not(:has(img)) { grid-template-columns: 1fr; }
    .nx { text-align: right; }
    @media (max-width: 640px) { .pn { grid-template-columns: minmax(0, 1fr); } .pv { grid-template-columns: 96px 1fr; } .pv img { width: 96px; } .nx { text-align: left; } }
  `,
})
export class ContentViewerPage {
  readonly slug = input.required<string>();
  readonly id = input.required<string>();
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
  private seo = inject(SeoService);
  private route = inject(ActivatedRoute);
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  protected d = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected playErr = signal<string | null>(null);
  protected needLogin = signal(false);
  protected embed = signal<SafeResourceUrl | null>(null);
  protected stream = signal<string | null>(null);
  protected src = signal<string | null>(null);
  protected dur = fmtDuration;
  protected here = () => `/products/${this.slug()}/content/${this.id()}`;
  private provider: string | null = null;
  private progressToken: string | null = null;
  private lastReport = 0;
  private resumeAt = 0;
  private renewing = false;
  private renewals = 0;
  private browser = false;
  private seconds = 0;
  private duration = 0;
  private onMessage = (e: MessageEvent) => this.message(e);

  constructor() {
    afterNextRender(() => {
      this.browser = true;
      window.addEventListener('message', this.onMessage);
      void this.load();
    });
    inject(DestroyRef).onDestroy(() => {
      if (!this.browser) return;
      window.removeEventListener('message', this.onMessage);
      this.report();
    });
    // Moving to previous/next reuses this component: reload when the id changes.
    effect(() => {
      this.id();
      if (untracked(() => this.browser)) void untracked(() => this.load());
    });
  }

  private get preview() {
    return this.route.snapshot.queryParamMap.get('preview') === '1';
  }

  async load() {
    this.report();
    this.d.set(null);
    this.err.set(null);
    this.playErr.set(null);
    this.embed.set(null);
    this.stream.set(null);
    this.src.set(null);
    this.progressToken = null;
    this.seconds = this.duration = this.resumeAt = this.renewals = 0;
    await this.auth.init();
    try {
      const d = await firstValueFrom(this.http.get<Row>(`/api/content/products/${encodeURIComponent(this.slug())}/items/${encodeURIComponent(this.id())}`, { params: this.preview ? { preview: '1' } : {} }));
      this.d.set(d);
      this.seo.set({ title: `${d.title} – ${d.product.name}`, description: (d.description || `${d.typeLabel} for ${d.product.name}`).slice(0, 300), path: this.here(), noindex: true });
    } catch (e) {
      const a = toApiError(e);
      this.needLogin.set(a.status === 401);
      this.err.set(a.message);
    }
  }

  async start() {
    const d = this.d();
    if (!d) return;
    this.playErr.set(null);
    try {
      const r = await firstValueFrom(this.http.post<Row>(`/api/content/items/${d.id}/play`, { preview: !!d.preview }));
      this.progressToken = r.progressToken;
      this.provider = r.kind === 'stream' ? 'stream' : r.provider;
      if (r.kind === 'stream') {
        this.stream.set(r.src);
        setTimeout(() => void this.video()?.nativeElement.play().catch(() => undefined));
      } else {
        const url = r.src + (r.src.includes('?') ? '&' : '?') + 'autoplay=1';
        // Only the official players are allowed (URLs come from the server's embed builder).
        if (!/^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(url)) throw new Error('Unsupported player');
        this.src.set(url);
        this.embed.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      }
    } catch (e) {
      const a = toApiError(e);
      this.needLogin.set(a.status === 401);
      this.playErr.set(a.message);
    }
  }

  /* ---------- private stream: renew the short-lived link transparently ---------- */
  async renew() {
    const v = this.video()?.nativeElement;
    const d = this.d();
    if (!v || !d || this.renewing) return;
    if (++this.renewals > 3) {
      this.stream.set(null);
      this.playErr.set('This video can’t be played right now. Please refresh the page or try again later.');
      return;
    }
    this.renewing = true;
    this.resumeAt = v.currentTime;
    try {
      const r = await firstValueFrom(this.http.post<Row>(`/api/content/items/${d.id}/play`, { preview: !!d.preview }));
      this.stream.set(r.src);
    } catch (e) {
      this.stream.set(null);
      this.playErr.set(toApiError(e).message);
    } finally {
      setTimeout(() => (this.renewing = false), 3000);
    }
  }
  resume() {
    const v = this.video()?.nativeElement;
    if (v && this.resumeAt) {
      v.currentTime = this.resumeAt;
      this.resumeAt = 0;
      void v.play().catch(() => undefined);
    }
  }
  tick() {
    const v = this.video()?.nativeElement;
    if (!v) return;
    if (v.currentTime > 5) this.renewals = 0;
    this.seconds = v.currentTime;
    this.duration = v.duration || 0;
    if (Date.now() - this.lastReport > 15_000) this.report();
  }

  /* ---------- YouTube / Vimeo progress via their official postMessage APIs ---------- */
  hookEmbed() {
    const w = this.frame()?.nativeElement.contentWindow;
    if (!w) return;
    if (this.provider === 'youtube') w.postMessage(JSON.stringify({ event: 'listening', id: 'sch', channel: 'widget' }), 'https://www.youtube-nocookie.com');
    if (this.provider === 'vimeo') this.vimeoSubscribe();
  }
  private vimeoSubscribe() {
    const w = this.frame()?.nativeElement.contentWindow;
    for (const ev of ['timeupdate', 'ended']) w?.postMessage(JSON.stringify({ method: 'addEventListener', value: ev }), 'https://player.vimeo.com');
  }
  private message(e: MessageEvent) {
    if (!['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com'].includes(e.origin)) return;
    let m: Row;
    try {
      m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (e.origin === 'https://player.vimeo.com') {
      if (m?.event === 'ready') this.vimeoSubscribe();
      if (m?.event === 'timeupdate' && m.data) { this.seconds = m.data.seconds; this.duration = m.data.duration; if (Date.now() - this.lastReport > 15_000) this.report(); }
      if (m?.event === 'ended') this.report(true);
      return;
    }
    const info = m?.info;
    if (m?.event === 'infoDelivery' && info) {
      if (typeof info.currentTime === 'number') this.seconds = info.currentTime;
      if (typeof info.duration === 'number' && info.duration > 0) this.duration = info.duration;
      if (info.playerState === 0) this.report(true);
      else if (info.playerState === 2) this.report();
      else if (Date.now() - this.lastReport > 15_000 && this.seconds > 0) this.report();
    }
  }

  report(completed = false) {
    if (!this.progressToken || (!this.seconds && !completed)) return;
    this.lastReport = Date.now();
    const body = { seconds: Math.round(this.seconds), duration: this.duration ? Math.round(this.duration) : null, completed };
    // keepalive so the last position is saved even when leaving the page
    void fetch(`/api/content/views/${this.progressToken}/progress`, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': this.xsrf() }, body: JSON.stringify(body) }).catch(() => undefined);
  }
  private xsrf() {
    return decodeURIComponent(/(?:^|; )XSRF-TOKEN=([^;]+)/.exec(document.cookie)?.[1] ?? '');
  }
}

import { HttpClient } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

export const fmtDuration = (s: number | null | undefined) => (s ? `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}` : null);

/**
 * Product videos & tutorials: the product's content library as cover cards, grouped by category.
 * Loaded in the browser (what is listed depends on who is signed in – the server decides).
 * Every card opens the in-site viewer; nothing links to YouTube/Vimeo or to a file.
 */
@Component({
  selector: 'sch-content-library',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lib(); as l) {
      @if (l.progress; as pr) {
        @if (pr.total > 1) {
          <div class="progress" role="group" aria-label="Your progress">
            <div class="ptxt"><strong>{{ course() ? 'Your course progress' : 'Your progress' }}</strong><span>{{ pr.completed }} of {{ pr.total }} {{ course() ? 'lessons' : 'videos' }} completed</span></div>
            <div class="pbar" role="progressbar" [attr.aria-valuenow]="pct(pr)" aria-valuemin="0" aria-valuemax="100"><i [style.width.%]="pct(pr)"></i></div>
          </div>
        }
      }
      @if (l.staffNotice) { <div class="alert staff" role="note">{{ l.staffNotice }}</div> }
      @if (l.preview) { <div class="alert" role="note"><strong>Preview:</strong> drafts are shown with a “Draft” badge. Customers only see published content they have access to.</div> }
      @for (g of l.categories; track g.id ?? 'none') {
        <div class="group">
          <div class="gh"><h3>{{ g.name }}</h3><span class="muted cnt">{{ g.items.length }} {{ g.items.length === 1 ? 'item' : 'items' }}</span></div>
          @if (g.description) { <p class="muted gd">{{ g.description }}</p> }
          <div class="cards">
            @for (c of g.items; track c.id) {
              <a class="cc" [routerLink]="['/products', slug(), 'content', c.id]" [queryParams]="l.preview ? { preview: 1 } : {}" [attr.aria-label]="'Watch ' + c.title">
                <span class="cover">
                  @if (c.cover) { <img [src]="c.cover" alt="" loading="lazy" decoding="async" (error)="$any($event.target).style.display = 'none'" /> } @else { <span class="nocover" aria-hidden="true"></span> }
                  <span class="shade" aria-hidden="true"></span>
                  <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg></span>
                  @if (dur(c.duration); as d) { <span class="dur">{{ d }}</span> }
                  <span class="type">{{ c.typeLabel }}</span>
                  @if (c.status === 'draft') { <span class="draft">Draft</span> }
                  @if (c.watched) { <span class="done" title="Watched">✓ Watched</span> } @else if (c.percent > 4) { <span class="part" [style.width.%]="c.percent" aria-hidden="true"></span> }
                </span>
                <span class="body"><strong>{{ c.title }}</strong>@if (c.description) { <span class="desc">{{ c.description }}</span> }</span>
              </a>
            }
          </div>
        </div>
      }
      @if (l.locked; as lk) {
        <div class="locked">
          <span class="lock" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" /></svg></span>
          <div>
            <strong>{{ lk.count }} more {{ lk.count === 1 ? 'video' : 'videos' }} available</strong>
            <p class="muted">{{ lk.message }}</p>
            <div class="row">
              @if (lk.code === 'login') {
                <a class="btn btn-primary btn-sm" routerLink="/login" [queryParams]="{ next: back() }">Sign in</a>
                <a class="btn btn-ghost btn-sm" routerLink="/register" [queryParams]="{ next: back() }">Create an account</a>
              } @else if (lk.code === 'licence') {
                <a class="btn btn-primary btn-sm" [routerLink]="['/products', slug()]" fragment="buy">Buy / get a quote</a>
              } @else if (lk.code === 'demo') {
                <a class="btn btn-primary btn-sm" [routerLink]="['/products', slug()]" fragment="download">Get the demo</a>
              }
            </div>
          </div>
        </div>
      }
    } @else if (failed()) { <p class="muted">The videos couldn’t be loaded. Please refresh the page.</p> }
    @else { <div class="cards" aria-busy="true">@for (n of [1, 2, 3]; track n) { <span class="cc sk"><span class="cover"></span><span class="body"><span class="ln"></span><span class="ln s"></span></span></span> }</div> }
  `,
  styles: `
    :host { display: block; }
    .group + .group { margin-top: 34px; }
    .gh { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
    .gh h3 { font-size: 19px; margin: 0; }
    .cnt { font-size: 13px; }
    .gd { margin: 0 0 12px; font-size: 15px; max-width: 70ch; }
    .cards { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); margin-top: 12px; }
    .cc { display: grid; grid-template-rows: auto 1fr; border-radius: var(--r-lg, 16px); overflow: hidden; background: var(--surface); border: 1px solid var(--line); color: inherit; text-decoration: none; transition: translate .3s var(--ease, ease), border-color .3s, box-shadow .3s; }
    .cc:hover, .cc:focus-visible { translate: 0 -4px; border-color: var(--accent); box-shadow: 0 18px 36px -20px var(--accent); text-decoration: none; }
    .cc:focus-visible { outline: 3px solid var(--accent-glow); outline-offset: 2px; }
    .cover { position: relative; display: block; aspect-ratio: 16 / 9; background: linear-gradient(135deg, var(--accent), var(--accent-2)); overflow: hidden; }
    .cover img { width: 100%; height: 100%; object-fit: cover; display: block; transition: scale .5s var(--ease, ease); }
    .cc:hover .cover img { scale: 1.04; }
    .nocover { position: absolute; inset: 0; background: radial-gradient(60% 80% at 30% 20%, rgba(255,255,255,.25), transparent 60%); }
    .shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 45%, rgba(5,8,20,.65)); }
    .play { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.92); box-shadow: 0 10px 30px rgba(0,0,0,.35); transition: scale .3s cubic-bezier(.3,1.4,.45,1); }
    .play svg { width: 26px; height: 26px; margin-left: 3px; fill: var(--accent-2, #1b4fd1); }
    .cc:hover .play { scale: 1.12; }
    .dur, .type, .draft { position: absolute; bottom: 10px; padding: 3px 8px; border-radius: 6px; font: 600 12px/1.4 var(--f-mono, monospace); color: #fff; background: rgba(5,8,20,.72); }
    .dur { right: 10px; } .type { left: 10px; font-family: inherit; }
    .draft { top: 10px; bottom: auto; left: 10px; background: #b26b00; }
    .done { position: absolute; top: 10px; right: 10px; padding: 3px 8px; border-radius: 6px; font: 600 12px/1.4 inherit; color: #fff; background: #11734b; }
    .part { position: absolute; left: 0; bottom: 0; height: 4px; background: #14c2b0; }
    .progress { display: grid; gap: 8px; margin: 0 0 22px; padding: 14px 16px; border-radius: var(--r-lg, 14px); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--line)); }
    .ptxt { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 14px; } .ptxt span { color: var(--muted); }
    .pbar { height: 8px; border-radius: 6px; background: var(--surface-2, #e6ebf2); overflow: hidden; } .pbar i { display: block; height: 100%; background: linear-gradient(90deg, #14c2b0, var(--accent)); border-radius: 6px; }
    .body { display: grid; gap: 4px; padding: 14px 16px 16px; align-content: start; }
    .body strong { font-size: 16px; color: var(--heading); line-height: 1.3; }
    .desc { font-size: 14px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .locked { display: flex; gap: 16px; align-items: flex-start; margin-top: 28px; padding: 18px 20px; border-radius: var(--r-lg, 16px); border: 1px dashed color-mix(in srgb, var(--accent) 50%, var(--line)); background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
    .locked p { margin: 4px 0 10px; }
    .lock { width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0; display: grid; place-items: center; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
    .lock svg { width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2; stroke-linejoin: round; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .staff { margin: 0 0 18px; padding: 12px 14px; border-radius: 12px; background: #fff5df; border: 1px solid #f0d49a; font-size: 14px; }
    .sk .cover { background: var(--surface-2, #eef1f5); } .sk .ln { display: block; height: 12px; border-radius: 6px; background: var(--surface-2, #eef1f5); } .sk .ln.s { width: 60%; }
    @media (prefers-reduced-motion: reduce) { .cc, .cover img, .play { transition: none; } }
  `,
})
export class ContentLibrary {
  readonly slug = input.required<string>();
  /** Training courses: progress is shown as course progress. */
  readonly course = input(false);
  protected pct = (p: { completed: number; total: number }) => Math.round((p.completed / Math.max(1, p.total)) * 100);
  /** Emits how many items are shown (0 = hide the section) so the page can show/hide its tab. */
  readonly loaded = output<{ total: number; locked: number; notice?: boolean }>();
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  protected lib = signal<Row | null>(null);
  protected failed = signal(false);
  protected dur = fmtDuration;
  protected back = () => `/products/${this.slug()}#library`;

  constructor() {
    afterNextRender(async () => {
      await this.auth.init();
      const preview = this.route.snapshot.queryParamMap.get('contentPreview') === '1';
      try {
        const l = await firstValueFrom(this.http.get<Row>(`/api/content/products/${encodeURIComponent(this.slug())}/library`, { params: preview ? { preview: '1' } : {} }));
        this.lib.set(l);
        this.loaded.emit({ total: l.total, locked: l.locked?.count ?? 0, notice: !!l.staffNotice });
      } catch {
        this.failed.set(true);
        this.loaded.emit({ total: 0, locked: 0 });
      }
    });
  }
}

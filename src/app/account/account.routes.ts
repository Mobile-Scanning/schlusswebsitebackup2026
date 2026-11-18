import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink, Routes } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AnyRow, CustomerApi, DEMO_STATUS_TEXT } from '../core/account-api';
import { AuthService, toApiError } from '../core/auth.service';
import { DemoDownload } from '../public/demo-download';
import { InstallerPanel } from '../public/installer-panel';
import { ChangePassword } from '../shared/change-password';
import { SchChat } from '../shared/chat-widget';
import { COUNTRIES } from '../shared/countries';
import { NavItem, PortalShell } from '../shared/portal-shell';

const NAV: NavItem[] = [
  { label: 'Dashboard', link: '/account', exact: true },
  { label: 'My demos', link: '/account/demos' },
  { label: 'My support', link: '/account/support', badge: 'support' },
  { label: 'Business profile', link: '/account/profile' },
  { label: 'Security', link: '/account/security' },
];

@Component({
  selector: 'sch-account-layout',
  imports: [PortalShell, SchChat],
  template: `<sch-portal-shell area="My account" [nav]="nav" [badges]="badges()" /><sch-chat />`,
})
export class AccountLayout {
  protected nav = NAV;
  protected badges = signal<Record<string, number>>({});
  constructor() {
    const http = inject(HttpClient);
    if (typeof window === 'undefined') return;
    const load = () => http.get<{ unread: number }>('/api/support/unread').subscribe({ next: (r) => this.badges.set({ support: r.unread }), error: () => undefined });
    load();
    const t = setInterval(() => !document.hidden && load(), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }
}

const STATUS_CLS: Record<string, string> = { started: 'badge-muted', downloaded: 'badge-info', awaiting_activation: 'badge-info', active: 'badge-ok', expiring_soon: 'badge-warn', expired: 'badge-danger', converted: 'badge-ok', suspended: 'badge-danger', revoked: 'badge-danger' };
const CHAT_TEXT: Record<string, string> = { new: 'Sent', open: 'Open', awaiting_admin: 'Waiting for SCHLUSS', awaiting_customer: 'SCHLUSS replied', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const STYLES = `
  h1 { font-size: 28px; } h2 { font-size: 19px; margin: 0 0 10px; } h3 { margin: 0; }
  .muted { color: var(--muted); } .small { font-size: 13px; } .tiny { font-size: 12px; }
  .card + .card, .card + section, section + .card { margin-top: 16px; }
  .lst { list-style: none; padding: 0; margin: 0; } .lst li { padding: 10px 0; border-top: 1px solid var(--line); } .lst li:first-child { border-top: 0; }
  code { font-family: var(--f-mono); font-size: 13px; padding: 2px 6px; border-radius: 4px; background: var(--surface-2, #eef1f5); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
`;

/* ======================================================================== Overview / dashboard */
@Component({
  selector: 'sch-account-overview',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Welcome, {{ auth.user()?.name }}</h1>
    <p class="muted">Your SCHLUSS products, demos, setup guides and conversations.</p>
    @if (d(); as d) {
      @if (unreadNotes().length) {
        <section class="card notes" aria-label="Notifications">
          <div class="nh"><h2>Updates</h2><button type="button" class="btn btn-ghost btn-sm" (click)="readAll()">Mark all as read</button></div>
          <ul class="lst">@for (n of unreadNotes(); track n.id) { <li><a [routerLink]="n.link || '/account'" (click)="read(n.id)"><strong>{{ n.title }}</strong></a>@if (n.body) { <br /><span class="small muted">{{ n.body }}</span> } <span class="tiny muted"> · {{ n.created_at | date: 'd MMM, HH:mm' }}</span></li> }</ul>
        </section>
      }
      <h2 class="mt">My products</h2>
      <div class="prods">
        @for (p of d.products; track p.product.slug) {
          <article class="card prod">
            <header>
              @if (p.product.image) { <img [src]="p.product.image" alt="" /> } @else { <span class="ph" aria-hidden="true"></span> }
              <div><h3>{{ p.product.name }}</h3>@if (p.product.summary) { <p class="small muted">{{ p.product.summary }}</p> }</div>
            </header>
            @if (p.demo; as dm) {
              <div class="state">
                <span class="badge" [class]="'badge ' + cls[dm.status]">Demo: {{ statusText[dm.status] }}</span>
                @if (dm.expiresAt) { <span class="small">{{ ['expired', 'revoked'].includes(dm.status) ? 'Ended' : 'Ends' }} {{ dm.expiresAt | date: 'd MMM y' }}</span> }
                @else if (dm.status === 'awaiting_activation') { <span class="small">{{ dm.days }} days from activation</span> }
              </div>
            }
            @for (k of p.packages; track k.licenceKey) { <div class="state"><span class="badge badge-ok">Package{{ k.plan ? ': ' + k.plan : '' }}</span><span class="small">{{ k.status }}@if (k.expiresAt) { · until {{ k.expiresAt | date: 'd MMM y' }} }</span></div> }
            @if (p.steps.total) {
              <div class="prog" [attr.aria-label]="p.steps.done + ' of ' + p.steps.total + ' setup steps done'"><span [style.width.%]="(p.steps.done / p.steps.total) * 100"></span></div>
              <span class="tiny muted">Setup: {{ p.steps.done }} of {{ p.steps.total }} steps done</span>
            }
            <div class="row">
              <a class="btn btn-primary btn-sm" [routerLink]="['/account/products', p.product.slug]">{{ p.steps.total ? 'Open setup guide' : 'Open product area' }}</a>
              <a class="btn btn-ghost btn-sm" [routerLink]="['/products', p.product.slug]">Product page</a>
              @if (p.unread) { <a class="btn btn-ghost btn-sm" routerLink="/account/support">{{ p.unread }} new repl{{ p.unread === 1 ? 'y' : 'ies' }}</a> }
            </div>
          </article>
        } @empty {
          <div class="card empty"><p>You haven’t downloaded a demo yet. Open any product and choose <strong>Download the demo</strong> or <strong>Free trial</strong>.</p><a class="btn btn-primary btn-sm" routerLink="/products">Browse products</a></div>
        }
      </div>
      <div class="cols">
        <section class="card"><h2>Conversations</h2>
          <ul class="lst">@for (c of d.conversations; track c.reference) { <li><a routerLink="/account/support" [queryParams]="{ c: c.reference }"><strong>{{ c.subject }}</strong></a>@if (c.unread) { <span class="badge badge-info">{{ c.unread }} new</span> }<br /><span class="tiny muted">{{ c.reference }} · {{ chatText[c.status] }} · {{ c.lastMessageAt | date: 'd MMM, HH:mm' }}</span></li> } @empty { <li class="muted small">No conversations yet – use the chat button to ask us anything.</li> }</ul>
        </section>
        <section class="card"><h2>Your details</h2>
          <dl><dt>Name</dt><dd>{{ d.profile.name }}</dd><dt>Email</dt><dd>{{ d.profile.email }}</dd><dt>Company</dt><dd>{{ d.profile.company || '—' }}</dd><dt>Contact number</dt><dd>{{ d.profile.cellphone || '—' }}</dd></dl>
          <a class="btn btn-ghost btn-sm" routerLink="/account/profile" style="margin-top: 10px">Edit business profile</a>
        </section>
      </div>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES + `
    .mt { margin-top: 22px; }
    .nh { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .notes { border-left: 4px solid var(--sch-blue); }
    .prods { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
    .prod { display: grid; gap: 10px; align-content: start; }
    .prod header { display: flex; gap: 12px; align-items: flex-start; }
    .prod img, .ph { width: 64px; height: 48px; border-radius: 10px; object-fit: cover; flex-shrink: 0; background: linear-gradient(135deg, #3282f6, #7b5cff); }
    .prod p { margin: 4px 0 0; }
    .state { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .prog { height: 8px; border-radius: 6px; background: var(--surface-2, #eef1f5); overflow: hidden; } .prog span { display: block; height: 100%; background: linear-gradient(90deg, #14c2b0, #3282f6); }
    .cols { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); margin-top: 16px; }
    .cols .card + .card { margin-top: 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
    .empty p { margin: 0 0 10px; }
  `,
})
export class AccountOverview implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(CustomerApi);
  protected d = signal<AnyRow | null>(null);
  protected err = signal<string | null>(null);
  protected statusText = DEMO_STATUS_TEXT;
  protected cls = STATUS_CLS;
  protected chatText = CHAT_TEXT;
  protected unreadNotes = computed(() => ((this.d()?.notifications ?? []) as AnyRow[]).filter((n) => !n.read_at));
  ngOnInit() {
    this.api.dashboard().then((d) => this.d.set(d)).catch((e) => this.err.set(toApiError(e).message));
  }
  read(id: number) {
    void this.api.readNotifications({ ids: [id] });
  }
  async readAll() {
    await this.api.readNotifications({ all: true });
    this.d.update((d) => ({ ...d, notifications: d.notifications.map((n: AnyRow) => ({ ...n, read_at: new Date().toISOString() })) }));
  }
}

/* ======================================================================== Product setup area */
@Component({
  selector: 'sch-account-product',
  imports: [RouterLink, DatePipe, DemoDownload, InstallerPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/account" class="back">← My account</a>
    @if (d(); as d) {
      <div class="head">
        @if (d.product.image) { <img [src]="d.product.image" alt="" /> }
        <div><h1>{{ d.product.name }}</h1><p class="muted">{{ d.product.summary }}</p></div>
      </div>
      <div class="cards">
        <section class="card">
          <h2>Your demo</h2>
          @if (d.demo; as dm) {
            <p><span class="badge" [class]="'badge ' + cls[dm.status]">{{ statusText[dm.status] }}</span></p>
            <dl>
              <dt>Demo length</dt><dd>{{ dm.days }} days, from {{ dm.startOn === 'activation' ? 'first activation' : 'first download' }}</dd>
              <dt>Downloaded</dt><dd>{{ (dm.firstDownloadedAt | date: 'd MMM y') ?? 'Not yet' }}@if (dm.downloads > 1) { ({{ dm.downloads }}×) }</dd>
              <dt>Activated</dt><dd>{{ (dm.activatedAt | date: 'd MMM y') ?? 'Not yet' }}</dd>
              <dt>Expires</dt><dd><strong>{{ (dm.expiresAt | date: 'd MMMM y') ?? 'Starts when you activate it' }}</strong></dd>
              <dt>Demo licence</dt><dd><code>{{ dm.licenceKey }}</code></dd>
            </dl>
            @if (['expired', 'expiring_soon'].includes(dm.status)) { <p class="small">Want to keep using {{ d.product.name }}? <a routerLink="/contact" [queryParams]="{ type: 'purchase', product: d.product.slug, subject: 'Package enquiry: ' + d.product.name }">Talk to us about packages</a> or use the chat.</p> }
          } @else { <p class="muted small">No demo yet.</p> }
          @for (k of d.packages; track k.licence_key) { <p class="small"><span class="badge badge-ok">Package{{ k.plan ? ': ' + k.plan : '' }}</span> {{ k.status }}@if (k.expires_at) { · until {{ k.expires_at | date: 'd MMM y' }} } · <code>{{ k.licence_key }}</code></p> }
        </section>
        @if (d.product.requirements) { <section class="card"><h2>System requirements</h2><p class="keep-lines small">{{ d.product.requirements }}</p></section> }
      </div>

      @if (d.installer) {
        <section class="card" id="installer"><h2>Full version</h2>
          <sch-installer-panel [slug]="d.product.slug" [installer]="d.installer" />
        </section>
      }

      @if (d.demoOffer) {
        <section class="card" id="download"><h2>Demo download</h2>
          <sch-demo-download [slug]="d.product.slug" [name]="d.product.name" [demo]="d.demoOffer" />
        </section>
      }

      @if (d.steps.length) {
        <section class="card">
          <div class="sh"><h2>Setup & learning steps</h2><span class="muted small">{{ doneCount() }} of {{ d.steps.length }} done – saved to your account</span></div>
          <div class="prog"><span [style.width.%]="(doneCount() / d.steps.length) * 100"></span></div>
          <ol class="steps">
            @for (s of d.steps; track s.id; let i = $index) {
              <li [class.done]="!!s.completedAt" [class.cur]="i === firstOpen()">
                <details [open]="i === firstOpen()">
                  <summary><span class="n" aria-hidden="true">{{ s.completedAt ? '✓' : i + 1 }}</span><span class="t"><strong>{{ s.title }}</strong>@if (s.summary) { <span class="small muted">{{ s.summary }}</span> }</span></summary>
                  <div class="sb">
                    @if (s.body) { <p class="keep-lines">{{ s.body }}</p> }
                    @for (it of s.items; track $index) {
                      @switch (it.kind) {
                        @case ('image') { <figure><img [src]="it.url" [alt]="it.title" loading="lazy" />@if (it.title) {<figcaption class="small muted">{{ it.title }}</figcaption>}</figure> }
                        @case ('video') {
                          @if (it.embed) { <div class="vid"><iframe [src]="safe(it.embed)" [title]="it.title" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" loading="lazy"></iframe></div> }
                          @else { <video [src]="it.url" controls preload="metadata" [attr.aria-label]="it.title"></video> }
                        }
                        @case ('document') { <a class="res" [href]="it.url" target="_blank" rel="noopener"><span class="ri">PDF</span>{{ it.title }}</a> }
                        @case ('file') { <a class="res" [href]="it.url" download><span class="ri">⬇</span>{{ it.title }}</a> }
                        @case ('link') { <a class="res" [href]="it.url" target="_blank" rel="noopener"><span class="ri">↗</span>{{ it.title }}</a> }
                        @case ('demo_download') { <a class="res" href="#download" (click)="$event.preventDefault(); goDownload()"><span class="ri">⬇</span>{{ it.title }}</a> }
                      }
                    }
                    <label class="check done-box"><input type="checkbox" [checked]="!!s.completedAt" (change)="toggle(s, $any($event.target).checked)" /><span>I’ve completed this step</span></label>
                  </div>
                </details>
              </li>
            }
          </ol>
        </section>
      }

      @if (d.videos.length) {
        <section class="card"><h2>Videos</h2>
          <div class="vgrid">@for (v of d.videos; track $index) {
            <div class="vt">@if (v.embed) { <div class="vid"><iframe [src]="safe(v.embed)" [title]="v.title" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" loading="lazy"></iframe></div> } @else { <video [src]="v.url" controls preload="metadata"></video> }<strong>{{ v.title }}</strong>@if (v.description) { <span class="small muted">{{ v.description }}</span> }</div>
          }</div>
        </section>
      }
      <div class="cards">
        @if (d.documents.length) {
          <section class="card"><h2>Documents & learning materials</h2>
            <ul class="lst">@for (x of d.documents; track x.id) { <li><a [href]="x.url" target="_blank" rel="noopener"><strong>{{ x.title }}</strong></a>@if (x.summary) { <br /><span class="small muted">{{ x.summary }}</span> }</li> }</ul>
          </section>
        }
        @if (d.links.length) {
          <section class="card"><h2>Useful links</h2>
            <ul class="lst">@for (x of d.links; track x.id) { <li><a [href]="x.url" target="_blank" rel="noopener"><strong>{{ x.title }}</strong> ↗</a>@if (x.summary) { <br /><span class="small muted">{{ x.summary }}</span> }</li> }</ul>
          </section>
        }
        <section class="card"><h2>Support</h2>
          <ul class="lst">@for (c of d.conversations; track c.reference) { <li><a routerLink="/account/support" [queryParams]="{ c: c.reference }">{{ c.subject }}</a>@if (c.unread) { <span class="badge badge-info">{{ c.unread }} new</span> } <span class="tiny muted">· {{ chatText[c.status] }}</span></li> } @empty { <li class="small muted">Questions about {{ d.product.name }}? Use the chat button (bottom right) – we’ll reply here and by email.</li> }</ul>
        </section>
      </div>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES + `
    .head { display: flex; gap: 16px; align-items: center; margin: 8px 0 16px; } .head img { width: 96px; height: 72px; object-fit: cover; border-radius: 14px; } .head h1 { margin: 0; } .head p { margin: 4px 0 0; }
    .cards { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); margin: 16px 0; }
    .cards .card + .card { margin-top: 0; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
    .keep-lines { white-space: pre-line; }
    .sh { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .prog { height: 8px; border-radius: 6px; background: var(--surface-2, #eef1f5); overflow: hidden; margin: 4px 0 14px; } .prog span { display: block; height: 100%; background: linear-gradient(90deg, #14c2b0, #3282f6); transition: width .4s ease; }
    .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .steps li { border: 1px solid var(--line); border-radius: 14px; background: #fff; }
    .steps li.cur { border-color: var(--sch-blue); }
    .steps li.done { background: #f3fbf7; }
    summary { display: flex; gap: 12px; align-items: center; padding: 12px 14px; cursor: pointer; list-style: none; } summary::-webkit-details-marker { display: none; }
    .n { flex: 0 0 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; color: #fff; background: linear-gradient(135deg, #3282f6, #7b5cff); }
    .done .n { background: linear-gradient(135deg, #14c2b0, #2bb673); }
    .t { display: grid; gap: 2px; }
    .sb { padding: 0 14px 14px 58px; display: grid; gap: 10px; justify-items: start; }
    figure { margin: 0; } figure img { max-width: 100%; border-radius: 10px; border: 1px solid var(--line); }
    .vid { position: relative; width: 100%; max-width: 640px; aspect-ratio: 16/9; } .vid iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 10px; }
    video { width: 100%; max-width: 640px; border-radius: 10px; background: #000; }
    .res { display: inline-flex; gap: 10px; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; text-decoration: none !important; font-weight: 600; }
    .ri { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--surface-2, #eef1f5); font-size: 11px; }
    .done-box { margin-top: 4px; }
    .vgrid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); } .vt { display: grid; gap: 6px; }
    @media (max-width: 600px) { .sb { padding-left: 14px; } }
  `,
})
export class AccountProductPage implements OnInit {
  readonly slug = input.required<string>();
  private api = inject(CustomerApi);
  private sanitizer = inject(DomSanitizer);
  protected d = signal<AnyRow | null>(null);
  protected err = signal<string | null>(null);
  protected statusText = DEMO_STATUS_TEXT;
  protected cls = STATUS_CLS;
  protected chatText = CHAT_TEXT;
  private safeCache = new Map<string, SafeResourceUrl>();
  protected doneCount = computed(() => ((this.d()?.steps ?? []) as AnyRow[]).filter((s) => s.completedAt).length);
  protected firstOpen = computed(() => ((this.d()?.steps ?? []) as AnyRow[]).findIndex((s) => !s.completedAt));
  /** Only YouTube/Vimeo embed URLs produced by the server reach here. */
  protected safe(url: string) {
    if (!/^https:\/\/(www\.youtube-nocookie\.com|www\.youtube\.com|player\.vimeo\.com)\//.test(url)) return null;
    if (!this.safeCache.has(url)) this.safeCache.set(url, this.sanitizer.bypassSecurityTrustResourceUrl(url));
    return this.safeCache.get(url)!;
  }
  ngOnInit() {
    this.api.product(this.slug()).then((d) => this.d.set(d)).catch((e) => this.err.set(toApiError(e).message));
  }
  goDownload() {
    document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
  }
  async toggle(s: AnyRow, done: boolean) {
    const prev = s.completedAt;
    this.d.update((d) => ({ ...d, steps: d.steps.map((x: AnyRow) => (x.id === s.id ? { ...x, completedAt: done ? new Date().toISOString() : null } : x)) }));
    try {
      await this.api.progress(s.id, done);
    } catch (e) {
      this.err.set(toApiError(e).message);
      this.d.update((d) => ({ ...d, steps: d.steps.map((x: AnyRow) => (x.id === s.id ? { ...x, completedAt: prev } : x)) }));
    }
  }
}

/* ======================================================================== Support conversations */
@Component({
  selector: 'sch-account-support',
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Support</h1>
    <p class="muted">Your conversations with SCHLUSS. Start a new one with the chat button (bottom right).</p>
    <div class="wrap2">
      <ul class="convs">
        @for (c of list(); track c.reference) {
          <li><button type="button" [class.on]="cur()?.reference === c.reference" [class.unread]="c.unread" (click)="open(c.reference)"><strong>{{ c.subject }}</strong><span class="tiny muted">{{ c.reference }} · {{ chatText[c.status] }} · {{ c.lastMessageAt | date: 'd MMM, HH:mm' }}@if (c.unread) { · <b>{{ c.unread }} new</b> }</span></button></li>
        } @empty { <li class="muted">No conversations yet.</li> }
      </ul>
      <section class="card th">
        @if (cur(); as t) {
          <h2>{{ t.subject }}</h2>
          <ol class="msgs">@for (m of t.messages; track m.id) { <li [class]="m.from"><span class="tiny muted">{{ m.from === 'staff' ? m.author : 'You' }} · {{ m.at | date: 'd MMM, HH:mm' }}</span><p>{{ m.body }}</p></li> }</ol>
          @if (!hasStaffReply()) { <p class="avail small">{{ t.availability }}</p> }
          @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
          <form (ngSubmit)="send()" class="composer"><textarea class="textarea" rows="3" name="b" [(ngModel)]="body" maxlength="4000" aria-label="Your message" placeholder="Write a message"></textarea><button class="btn btn-primary btn-sm" type="submit" [disabled]="!body.trim() || busy()">Send</button></form>
        } @else { <p class="muted">Choose a conversation.</p> }
      </section>
    </div>
  `,
  styles: STYLES + `
    .wrap2 { display: grid; grid-template-columns: minmax(240px, 320px) 1fr; gap: 14px; align-items: start; margin-top: 14px; }
    .convs { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
    .convs button { width: 100%; text-align: left; display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: #fff; cursor: pointer; font: inherit; color: var(--fg); }
    .convs button.on { border-color: var(--sch-blue); } .convs button.unread { background: #f5f9ff; }
    .msgs { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 8px; }
    .msgs li { max-width: 85%; padding: 8px 12px; border-radius: 14px; } .msgs li p { margin: 2px 0 0; white-space: pre-line; overflow-wrap: anywhere; }
    .msgs .me { margin-left: auto; background: #e8f1ff; } .msgs .staff { background: var(--surface-2, #eef1f5); }
    .avail { padding: 10px 12px; border-radius: 12px; background: #f1f5ff; }
    .composer { display: grid; gap: 8px; justify-items: start; } .composer .textarea { width: 100%; }
    @media (max-width: 760px) { .wrap2 { grid-template-columns: 1fr; } }
  `,
})
export class AccountSupportPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected list = signal<AnyRow[]>([]);
  protected cur = signal<AnyRow | null>(null);
  protected err = signal<string | null>(null);
  protected busy = signal(false);
  protected chatText = CHAT_TEXT;
  protected body = '';
  protected hasStaffReply = () => (this.cur()?.messages ?? []).some((m: AnyRow) => m.from === 'staff');
  constructor() {
    const t = setInterval(() => { if (!document.hidden && this.cur()) void this.open(this.cur()!.reference, true); }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }
  async ngOnInit() {
    this.list.set(await firstValueFrom(this.http.get<AnyRow[]>('/api/support/conversations')));
    const ref = this.route.snapshot.queryParamMap.get('c') ?? this.list()[0]?.reference;
    if (ref) await this.open(ref);
  }
  async open(ref: string, quiet = false) {
    try {
      this.cur.set(await firstValueFrom(this.http.get<AnyRow>(`/api/support/conversations/${encodeURIComponent(ref)}`)));
      this.list.update((l) => l.map((c) => (c.reference === ref ? { ...c, unread: 0 } : c)));
      if (!quiet) void this.router.navigate([], { queryParams: { c: ref }, replaceUrl: true });
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async send() {
    const t = this.cur();
    if (!t || !this.body.trim()) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      await firstValueFrom(this.http.post(`/api/support/conversations/${encodeURIComponent(t.reference)}/messages`, { body: this.body }));
      this.body = '';
      await this.open(t.reference, true);
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

/* ======================================================================== Business profile */
@Component({
  selector: 'sch-account-profile',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Business profile</h1>
    <p class="muted">Used for demos, support and packages. We only ask for what we need (POPIA).</p>
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
    <form class="card" (ngSubmit)="save()">
      <div class="form-row">
        <div class="field"><label for="pf-co">Business / company name</label><input id="pf-co" class="input" name="co" [(ngModel)]="f.company" /></div>
        <div class="field"><label for="pf-ph">Contact number</label><input id="pf-ph" class="input" name="ph" [(ngModel)]="f.cellphone" inputmode="tel" /></div>
        <div class="field"><label for="pf-cn">Country</label><select id="pf-cn" class="select" name="cn" [(ngModel)]="f.country">@for (c of countries; track c[0]) {<option [value]="c[0]">{{ c[1] }}</option>}</select></div>
        <div class="field"><label for="pf-pr">Province / region</label><input id="pf-pr" class="input" name="pr" [(ngModel)]="f.province" /></div>
        <div class="field"><label for="pf-bt">Type of business</label><input id="pf-bt" class="input" name="bt" [(ngModel)]="f.businessType" /></div>
      </div>
      <button class="btn btn-primary" type="submit">Save</button>
    </form>
  `,
  styles: STYLES + `form { max-width: 760px; margin-top: 14px; }`,
})
export class AccountProfilePage implements OnInit {
  private api = inject(CustomerApi);
  protected countries = COUNTRIES;
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected f = { company: '', cellphone: '', country: 'ZA', province: '', businessType: '' };
  async ngOnInit() {
    const p = await this.api.profile();
    this.f = { company: p.company ?? '', cellphone: p.cellphone ?? '', country: p.country ?? 'ZA', province: p.province ?? '', businessType: p.businessType ?? '' };
  }
  async save() {
    this.msg.set(null);
    this.err.set(null);
    try {
      await this.api.saveProfile({ ...this.f, cellphone: this.f.cellphone || '' });
      this.msg.set('Profile saved.');
    } catch (e) {
      const a = toApiError(e);
      this.err.set(Object.values(a.fields)[0] ?? a.message);
    }
  }
}

@Component({
  selector: 'sch-account-security',
  imports: [ChangePassword],
  template: `<h1>Security</h1><sch-change-password />`,
  styles: `h1 { font-size: 28px; } sch-change-password { display: block; max-width: 720px; }`,
})
export class AccountSecurity {}

/* ======================================================================== My demos */
@Component({
  selector: 'sch-account-demos',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>My demos</h1>
    <p class="muted">Demo periods are kept by SCHLUSS’s servers. We remind you before a demo ends.</p>
    @if (rows(); as rows) {
      @if (rows.length) {
        <div class="card tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Product</th><th>Status</th><th>Started</th><th>Expires</th><th>Remaining</th><th></th></tr></thead>
            <tbody>
              @for (r of rows; track r.licenceKey) {
                <tr>
                  <td><strong>{{ r.product.name }}</strong><br /><code class="tiny">{{ r.licenceKey }}</code></td>
                  <td><span [class]="'badge ' + (simple(r.status).cls)">{{ simple(r.status).label }}</span></td>
                  <td>{{ (r.startedAt | date: 'd MMM y') ?? '—' }}</td>
                  <td>{{ r.expiresAt ? (r.expiresAt | date: 'd MMM y') : (r.startOn === 'activation' ? 'Starts on activation' : '—') }}</td>
                  <td>{{ r.daysRemaining == null ? (r.days ? r.days + ' days' : '—') : r.daysRemaining === 0 ? 'Ended' : r.daysRemaining + ' day' + (r.daysRemaining === 1 ? '' : 's') }}</td>
                  <td class="acts">
                    <a class="btn btn-ghost btn-sm" [routerLink]="['/account/products', r.product.slug]">Setup & downloads</a>
                    @if (['expired', 'expiring_soon'].includes(r.status)) { <a class="btn btn-primary btn-sm" [routerLink]="['/products', r.product.slug]" fragment="buy">Buy</a> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="card"><p>No demos yet. Open any product and choose <strong>Download the demo</strong>.</p><a class="btn btn-primary btn-sm" routerLink="/products">Browse products</a></div>
      }
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES + `
    .tbl-wrap { overflow-x: auto; padding: 0; }
    .tbl { width: 100%; border-collapse: collapse; min-width: 640px; }
    .tbl th, .tbl td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
    .tbl th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  `,
})
export class AccountDemosPage implements OnInit {
  private http = inject(HttpClient);
  protected rows = signal<AnyRow[] | null>(null);
  protected err = signal<string | null>(null);
  /** The three customer-facing states asked for: Active, Expiring soon, Expired (plus not-started / converted). */
  protected simple(s: string) {
    if (s === 'expiring_soon') return { label: 'Expiring soon', cls: 'badge-warn' };
    if (s === 'expired' || s === 'revoked' || s === 'suspended') return { label: s === 'expired' ? 'Expired' : s === 'revoked' ? 'Revoked' : 'Suspended', cls: 'badge-danger' };
    if (s === 'converted') return { label: 'Converted to full licence', cls: 'badge-ok' };
    if (s === 'awaiting_activation' || s === 'started' || s === 'downloaded') return { label: 'Not activated yet', cls: 'badge-info' };
    return { label: 'Active', cls: 'badge-ok' };
  }
  ngOnInit() {
    firstValueFrom(this.http.get<AnyRow[]>('/api/account/my-demos')).then((r) => this.rows.set(r)).catch((e) => this.err.set(toApiError(e).message));
  }
}

export const ACCOUNT_ROUTES: Routes = [
  {
    path: '',
    component: AccountLayout,
    children: [
      { path: '', component: AccountOverview, title: 'My account – SCHLUSS' },
      { path: 'products/:slug', component: AccountProductPage, title: 'My product – SCHLUSS' },
      { path: 'demos', component: AccountDemosPage, title: 'My demos – SCHLUSS' },
      { path: 'support', component: AccountSupportPage, title: 'Support – SCHLUSS' },
      { path: 'profile', component: AccountProfilePage, title: 'Business profile – SCHLUSS' },
      { path: 'security', component: AccountSecurity, title: 'Security – SCHLUSS' },
    ],
  },
];

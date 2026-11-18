import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { toApiError } from '../core/auth.service';
import { TILE_PIECES } from './palette';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

/**
 * Website chat with the SCHLUSS team.
 *  - The customer chooses Technical support / General assistance / Purchase. Only "Purchase" goes to sales;
 *    the widget may suggest a type from the message, but never changes the customer's choice.
 *  - The SCHLUSS Assistant (clearly labelled as automated) may answer common questions until a person joins.
 *  - Replies (from the inbox or from WhatsApp) arrive live over Server-Sent Events, with polling as a fallback.
 *  - Signed-in customers: conversations belong to their account (any device).
 *  - Visitors: name + email + consent; they can continue in the same browser.
 *  - Replies come only from real staff in the admin Support Inbox. While nobody has answered, the panel
 *    shows the team's availability message – it never pretends someone replied.
 *  - Unread replies show as a badge; checked every minute (every 10 s while a conversation is open).
 */
@Component({
  selector: 'sch-chat',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="launch" [class.open]="open()" (click)="toggle()" [attr.aria-expanded]="open()" aria-controls="sch-chat-panel" [attr.aria-label]="open() ? 'Close chat' : unread() ? 'Chat with SCHLUSS – ' + unread() + ' new repl' + (unread() === 1 ? 'y' : 'ies') : 'Chat with SCHLUSS'">
      <svg viewBox="84 84 132 132" aria-hidden="true"><defs><linearGradient id="chat-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8BBEFF" /><stop offset=".55" stop-color="#3282F6" /><stop offset="1" stop-color="#7B5CFF" /></linearGradient></defs><path [attr.d]="piece" fill="url(#chat-g)" /></svg>
      <span class="ico" aria-hidden="true">@if (open()) { <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg> } @else { <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></svg> }</span>
      @if (unread() && !open()) { <span class="badge-n">{{ unread() }}</span> }
    </button>

    @if (open()) {
      <section id="sch-chat-panel" class="panel" role="dialog" aria-label="Chat with SCHLUSS" (keydown.escape)="toggle()">
        <header>
          @if (view() !== 'list' && conversations().length) { <button type="button" class="back" (click)="showList()" aria-label="All conversations">←</button> }
          <div><strong>Chat with SCHLUSS</strong><span>@if (view() === 'thread' && thread(); as t) { {{ t.reference }}@if (t.department === 'sales') { · Sales }@if (t.humanJoined) { · {{ t.agent ? t.agent + ' is helping you' : 'A support agent is helping you' }} } } @else { We usually reply within one business day }</span></div>
          <button type="button" class="x" (click)="toggle()" aria-label="Close chat">✕</button>
        </header>

        <div class="body" #body>
          @if (view() === 'list') {
            <button type="button" class="btn btn-primary btn-sm new" (click)="startNew()">Start a new conversation</button>
            <ul class="convs">
              @for (c of conversations(); track c.reference) {
                <li><button type="button" (click)="openThread(c.reference)" [class.unread]="c.unread">
                  <strong>{{ c.subject }}</strong>
                  <span>{{ c.lastMessageAt | date: 'd MMM, HH:mm' }} · {{ statusText[c.status] ?? c.status }}@if (c.unread) { · <b>{{ c.unread }} new</b> }</span>
                </button></li>
              }
            </ul>
          } @else if (view() === 'new') {
            @if (info()?.availability) { <p class="avail">{{ info()?.availability }}</p> }
            @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
            <form (ngSubmit)="send()" novalidate>
              @if (!info()?.signedIn) {
                <div class="two">
                  <label>Your name<input class="input" name="n" [(ngModel)]="f.name" autocomplete="name" /></label>
                  <label>Email<input class="input" type="email" name="e" [(ngModel)]="f.email" autocomplete="email" /></label>
                  <label>Phone <em>(optional)</em><input class="input" name="p" [(ngModel)]="f.cellphone" autocomplete="tel" /></label>
                  <label>Company <em>(optional)</em><input class="input" name="c" [(ngModel)]="f.company" autocomplete="organization" /></label>
                </div>
                @if (fe('name') || fe('email')) { <span class="error">{{ fe('name') || fe('email') }}</span> }
              }
              <fieldset class="types">
                <legend>What do you need?</legend>
                @for (o of types; track o.key) {
                  <label class="type" [class.on]="f.enquiryType === o.key"><input type="radio" name="et" [value]="o.key" [(ngModel)]="f.enquiryType" /><span><b>{{ o.label }}</b><small>{{ o.hint }}</small></span></label>
                }
              </fieldset>
              @if (suggested() && suggested() !== f.enquiryType) { <p class="tiny suggest">Tip: this sounds like <button type="button" class="linkish" (click)="f.enquiryType = suggested()!">{{ typeLabel(suggested()!) }}</button>. You decide.</p> }
              @if (f.enquiryType === 'purchase') { <label>Number of licences <em>(optional)</em><input class="input" type="number" min="1" max="100000" name="q" [(ngModel)]="f.quantity" /></label> }
              <label>Topic<select class="select" name="t" [(ngModel)]="f.categoryId"><option [ngValue]="null">Choose a topic…</option>@for (c of info()?.categories ?? []; track c.id) {<option [ngValue]="c.id">{{ c.name }}</option>}</select></label>
              @if (productName()) { <label class="check"><input type="checkbox" name="ip" [(ngModel)]="f.includeProduct" /><span>About {{ productName() }}</span></label> }
              <label>Message<textarea class="textarea" rows="4" name="m" [(ngModel)]="f.message" (ngModelChange)="suggest($event)" maxlength="4000" placeholder="How can we help?"></textarea></label>
              @if (fe('message')) { <span class="error">{{ fe('message') }}</span> }
              <input class="hp" name="website" [(ngModel)]="f.website" tabindex="-1" autocomplete="off" aria-hidden="true" />
              @if (!info()?.signedIn) {
                <label class="check"><input type="checkbox" name="cs" [(ngModel)]="f.consent" /><span>SCHLUSS may store my details and messages to answer me (<a routerLink="/privacy">privacy policy</a>).</span></label>
                @if (fe('consent')) { <span class="error">{{ fe('consent') }}</span> }
                <p class="tiny">Already a customer? <a routerLink="/login" [queryParams]="{ next: currentUrl() }">Sign in</a> to keep chats in your account.</p>
              }
              <button class="btn btn-primary btn-sm" type="submit" [disabled]="busy() || !f.message.trim()">Send message</button>
            </form>
          } @else if (thread(); as t) {
            <ol class="msgs" aria-live="polite">
              @for (m of t.messages; track m.id) {
                @if (m.from === 'system') { <li class="system"><p>{{ m.body }}</p></li> }
                @else { <li [class]="m.from"><span class="who">{{ m.from === 'me' ? 'You' : m.author }} · {{ m.at | date: 'd MMM, HH:mm' }}</span><p>{{ m.body }}</p></li> }
              }
            </ol>
            @if (waiting()) { <p class="avail"><span class="dot" aria-hidden="true"></span>{{ t.department === 'sales' ? 'Our sales team has your enquiry and will reply here and by email.' : t.availability }}</p> }
            @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
          } @else { <p class="muted">Loading…</p> }
        </div>

        @if (view() === 'thread' && thread()) {
          <form class="composer" (ngSubmit)="reply()">
            <textarea class="textarea" rows="2" name="r" [(ngModel)]="replyText" maxlength="4000" placeholder="Write a message" aria-label="Your message" (keydown.enter)="enterKey($any($event))"></textarea>
            <button class="btn btn-primary btn-sm" type="submit" [disabled]="busy() || !replyText.trim()">Send</button>
          </form>
        }
      </section>
    }
  `,
  styles: `
    :host { position: fixed; right: 18px; bottom: 18px; z-index: 1500; font-size: 15px; }
    .launch { position: relative; width: 62px; height: 62px; border: 0; padding: 0; background: none; cursor: pointer; filter: drop-shadow(0 10px 18px rgba(20,30,70,.35)); transition: transform .25s cubic-bezier(.3,1.3,.45,1); }
    .launch:hover { transform: rotate(-6deg) scale(1.05); } .launch.open { transform: rotate(90deg); }
    .launch svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .launch .ico { position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; margin: -10px 0 0 -10px; }
    .launch .ico svg { position: static; width: 24px; height: 24px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round; }
    .launch.open .ico { transform: rotate(-90deg); display: inline-block; }
    .badge-n { position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #ff5a6e; color: #fff; font: 700 12px/22px var(--f-text, sans-serif); border: 2px solid #fff; }
    .panel { position: absolute; right: 0; bottom: 76px; width: min(380px, calc(100vw - 24px)); max-height: min(620px, calc(100dvh - 110px)); display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: #fff; color: #172033; box-shadow: 0 30px 70px -20px rgba(10,20,50,.45), 0 0 0 1px rgba(20,30,60,.08); animation: pop .22s ease-out; }
    @keyframes pop { from { opacity: 0; transform: translateY(10px) scale(.98); } }
    header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; color: #fff; background: linear-gradient(120deg, #1b3a8a, #3282f6 55%, #7b5cff); }
    header div { flex: 1; display: grid; } header span { font-size: 12px; opacity: .85; }
    header button { background: rgba(255,255,255,.16); border: 0; color: #fff; width: 32px; height: 32px; border-radius: 10px; cursor: pointer; font-size: 16px; }
    .body { padding: 14px; overflow-y: auto; flex: 1; display: grid; gap: 10px; align-content: start; }
    form { display: grid; gap: 10px; }
    label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; color: #36415a; } label em { font-weight: 400; font-style: normal; color: #7a8399; }
    .two { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
    .check { display: flex; gap: 8px; align-items: flex-start; font-weight: 400; } .check input { margin-top: 3px; }
    .input, .select, .textarea { width: 100%; font-size: 15px; background: #fff; color: #172033; border: 1px solid #cfd6e2; border-radius: 10px; min-height: 40px; padding: 8px 10px; color-scheme: light; }
    .input:focus, .select:focus, .textarea:focus { outline: 2px solid #3282f6; outline-offset: 1px; border-color: #3282f6; }
    .input::placeholder, .textarea::placeholder { color: #8a93a6; }
    .check input { accent-color: #3282f6; width: 16px; height: 16px; }
    .panel a { color: #1f5fd6; }
    .avail { margin: 0; padding: 10px 12px; border-radius: 12px; background: #f1f5ff; font-size: 13px; color: #36415a; }
    .hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
    .tiny { font-size: 12px; margin: 0; color: #5b6475; }
    .error { color: #c62f3f; font-size: 13px; }
    .new { justify-self: start; }
    .convs { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
    .convs button { width: 100%; text-align: left; display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; border: 1px solid #e3e8f0; background: #fff; cursor: pointer; font: inherit; color: inherit; }
    .convs button.unread { border-color: #3282f6; background: #f5f9ff; }
    .convs span { font-size: 12px; color: #5b6475; }
    .msgs { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .msgs li { max-width: 85%; padding: 8px 12px; border-radius: 14px; }
    .msgs li p { margin: 2px 0 0; white-space: pre-line; overflow-wrap: anywhere; }
    .msgs .me { margin-left: auto; background: #3282f6; color: #fff; border-bottom-right-radius: 4px; } .msgs .me .who { color: rgba(255,255,255,.8); }
    .msgs .staff { background: #f0f2f7; border-bottom-left-radius: 4px; }
    .msgs .system { margin: 0 auto; background: #eefaf5; color: #11624f; font-size: 12px; text-align: center; border-radius: 999px; padding: 4px 12px; }
    .msgs .bot { background: #f4f0ff; border: 1px dashed #b7a6ff; border-bottom-left-radius: 4px; }
    .types { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; }
    .types legend { font-size: 13px; font-weight: 600; color: #36415a; margin-bottom: 4px; }
    .type { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border: 1px solid #dfe4ee; border-radius: 10px; cursor: pointer; font-weight: 400; }
    .type.on { border-color: #3282f6; background: #f5f9ff; }
    .type input { margin-top: 3px; accent-color: #3282f6; }
    .type span { display: grid; } .type small { color: #5b6475; font-size: 12px; }
    .suggest { margin-top: -4px; }
    .linkish { background: none; border: 0; padding: 0; color: #1f5fd6; text-decoration: underline; cursor: pointer; font: inherit; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #14c2b0; margin-right: 6px; animation: blink 1.6s ease-in-out infinite; }
    @keyframes blink { 50% { opacity: .3; } }
    .who { font-size: 11px; color: #5b6475; }
    .composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e3e8f0; align-items: flex-end; }
    .composer .textarea { flex: 1; min-height: 44px; resize: none; }
    @media (max-width: 520px) {
      :host { right: 12px; bottom: 12px; }
      .panel { position: fixed; left: 8px; right: 8px; bottom: 84px; width: auto; max-height: calc(100dvh - 100px); }
      .two { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } .launch { transition: none; } }
    :host-context(html.reduce-motion) .panel { animation: none; }
    :host-context(html.reduce-motion) .launch { transition: none; }
  `,
})
export class SchChat {
  private http = inject(HttpClient);
  private router = inject(Router);
  private bodyEl = viewChild<ElementRef<HTMLElement>>('body');
  protected piece = TILE_PIECES[3];
  protected open = signal(false);
  protected view = signal<'list' | 'new' | 'thread'>('new');
  protected info = signal<Row | null>(null);
  protected conversations = signal<Row[]>([]);
  protected thread = signal<Row | null>(null);
  protected unread = signal(0);
  protected busy = signal(false);
  protected err = signal<string | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected productName = signal<string | null>(null);
  protected currentUrl = signal('/');
  protected f = { name: '', email: '', cellphone: '', company: '', categoryId: null as number | null, message: '', consent: false, website: '', includeProduct: true, enquiryType: 'general' as 'technical' | 'general' | 'purchase', quantity: null as number | null };
  protected types = [
    { key: 'technical' as const, label: 'Technical support', hint: 'Installation, errors, activation, downloads' },
    { key: 'general' as const, label: 'General assistance', hint: 'Account, demos, product questions' },
    { key: 'purchase' as const, label: 'Purchase / sales enquiry', hint: 'Buy licences or request a quotation' },
  ];
  protected suggested = signal<'technical' | 'general' | 'purchase' | null>(null);
  protected typeLabel = (k: string) => this.types.find((t) => t.key === k)?.label ?? k;
  private es: EventSource | null = null;
  protected replyText = '';
  protected statusText: Record<string, string> = { new: 'Sent', open: 'Open', awaiting_admin: 'Waiting for SCHLUSS', awaiting_customer: 'SCHLUSS replied', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
  private slug: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected waiting = () => {
    const t = this.thread();
    return !!t && !t.messages.some((m: Row) => m.from === 'staff');
  };

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const track = () => {
        const url = this.router.url;
        this.currentUrl.set(url);
        const m = /^\/products\/([^/?#]+)/.exec(url);
        this.slug = m ? decodeURIComponent(m[1]) : null;
        this.productName.set(this.slug ? (document.querySelector('h1')?.textContent?.trim() || this.slug) : null);
        const ref = new URLSearchParams(url.split('?')[1] ?? '').get('chat');
        if (ref && !this.open()) void this.toggle().then(() => this.openThread(ref));
      };
      const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => setTimeout(track, 400));
      track();
      void this.pollUnread();
      this.schedule();
      destroy.onDestroy(() => { sub.unsubscribe(); if (this.timer) clearInterval(this.timer); this.es?.close(); });
    });
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    const fast = this.open() && this.view() === 'thread';
    this.timer = setInterval(() => {
      if (document.hidden) return;
      if (fast && this.thread()) void this.refreshThread();
      else void this.pollUnread();
    }, fast ? (this.es ? 30_000 : 10_000) : 60_000);
  }
  private async pollUnread() {
    try {
      this.unread.set((await firstValueFrom(this.http.get<{ unread: number }>('/api/support/unread'))).unread);
    } catch {
      /* offline – try later */
    }
  }
  async toggle() {
    this.open.set(!this.open());
    this.err.set(null);
    if (!this.open()) this.listen(null);
    if (this.open()) {
      try {
        const [info, convs] = await Promise.all([firstValueFrom(this.http.get<Row>('/api/support/info')), firstValueFrom(this.http.get<Row[]>('/api/support/conversations'))]);
        this.info.set(info);
        this.conversations.set(convs);
        this.unread.set(info.unread);
        if (this.view() !== 'thread') this.view.set(convs.length ? 'list' : 'new');
      } catch (e) {
        this.info.set({ availability: '', categories: [], signedIn: !!this.info()?.signedIn });
        this.view.set('new');
        this.err.set(toApiError(e).message);
      }
    }
    this.schedule();
  }
  showList() {
    this.listen(null);
    this.thread.set(null);
    this.view.set('list');
    void firstValueFrom(this.http.get<Row[]>('/api/support/conversations')).then((c) => this.conversations.set(c));
    this.schedule();
  }
  startNew() {
    this.err.set(null);
    this.fields.set({});
    this.view.set('new');
  }
  async openThread(ref: string) {
    this.err.set(null);
    this.view.set('thread');
    try {
      this.thread.set(await firstValueFrom(this.http.get<Row>(`/api/support/conversations/${encodeURIComponent(ref)}`)));
      this.scrollDown();
      this.listen(ref);
      void this.pollUnread();
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
    this.schedule();
  }
  private async refreshThread() {
    const t = this.thread();
    if (!t) return;
    const n = await firstValueFrom(this.http.get<Row>(`/api/support/conversations/${encodeURIComponent(t.reference)}`));
    if (n.messages.length !== t.messages.length || n.humanJoined !== t.humanJoined || n.status !== t.status) {
      this.thread.set(n);
      this.scrollDown();
    }
  }
  /** Suggest (never force) a type from the wording. Purchase is only suggested on clear buying words. */
  suggest(text: string) {
    const t = text.toLowerCase();
    const tech = /\b(error|install|crash|activat|licen[cs]e key|not working|fails?|download|setup|update)\b/.test(t);
    const buy = /\b(quote|quotation|buy|purchase|pricing|price|invoice|order)\b/.test(t);
    this.suggested.set(tech ? 'technical' : buy ? 'purchase' : null);
  }
  /** Live updates for the open conversation; falls back to polling if the stream isn't available. */
  private listen(ref: string | null) {
    this.es?.close();
    this.es = null;
    if (!ref || typeof EventSource === 'undefined') return;
    this.es = new EventSource(`/api/support/conversations/${encodeURIComponent(ref)}/stream`, { withCredentials: true });
    this.es.addEventListener('update', () => void this.refreshThread());
  }
  private scrollDown() {
    setTimeout(() => { const el = this.bodyEl()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; });
  }
  async send() {
    this.busy.set(true);
    this.err.set(null);
    this.fields.set({});
    const body: Row = { message: this.f.message, categoryId: this.f.categoryId, product: this.f.includeProduct ? this.slug : null, website: this.f.website, enquiryType: this.f.enquiryType, ...(this.f.enquiryType === 'purchase' && this.f.quantity ? { quantity: Number(this.f.quantity) } : {}) };
    if (!this.info()?.signedIn) Object.assign(body, { name: this.f.name, email: this.f.email, cellphone: this.f.cellphone || undefined, company: this.f.company || undefined, consent: this.f.consent });
    try {
      const r = await firstValueFrom(this.http.post<{ reference: string }>('/api/support/conversations', body));
      this.f.message = '';
      this.suggested.set(null);
      await this.openThread(r.reference);
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(Object.keys(a.fields).length ? 'Please check the highlighted fields.' : a.message);
    } finally {
      this.busy.set(false);
    }
  }
  enterKey(e: KeyboardEvent) {
    if (e.shiftKey) return; // Shift+Enter = new line
    e.preventDefault();
    void this.reply();
  }
  async reply() {
    const t = this.thread();
    if (!t || !this.replyText.trim() || this.busy()) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      await firstValueFrom(this.http.post(`/api/support/conversations/${encodeURIComponent(t.reference)}/messages`, { body: this.replyText }));
      this.replyText = '';
      await this.refreshThread();
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

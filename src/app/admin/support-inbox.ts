import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, toApiError } from '../core/auth.service';
import { CatalogueApi, ProductRow } from './catalogue-api';
import { CHAT_STATUS, DEMO_STATUS, PlatformApi, PRIORITY, Row } from './platform-api';

const VIEWS: [string, string][] = [['open', 'Open'], ['unread', 'Unread'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['closed', 'Resolved & closed'], ['all', 'All']];

/**
 * Admin › Support Inbox – every website chat and contact-form enquiry in one place.
 * Replies appear in the customer's website chat; internal notes never do.
 */
@Component({
  selector: 'sch-support-inbox',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      <div><h1>Support Inbox</h1><p class="muted">Website chat, WhatsApp and contact-form conversations. Replies appear in the customer’s chat (and on WhatsApp for WhatsApp conversations); internal notes stay private.</p></div>
      <div class="row-actions">
        <span class="live" [class.on]="live()" [title]="live() ? 'Live updates on' : 'Refreshing every 20 seconds'">{{ live() ? '● Live' : '○ Auto-refresh' }}</span>
        @if (auth.can('support.manage')) { <button class="btn btn-ghost btn-sm" type="button" (click)="openSetup()">Topics & settings</button> }
      </div>
    </div>
    @if (sum(); as s) {
      <div class="sum">
        @for (k of sumKeys; track k[0]) { <button type="button" class="sk" [style.--c]="k[2]" (click)="quick(k[0])"><b>{{ s[k[0]] ?? 0 }}</b><span>{{ k[1] }}</span></button> }
      </div>
    }
    <div class="status-tabs">
      @for (v of views; track v[0]) { <button type="button" [attr.aria-pressed]="view === v[0]" (click)="view = v[0]; load(1)">{{ v[1] }}@if (counts()[v[0]]) { <span class="cnt">{{ counts()[v[0]] }}</span> }</button> }
    </div>
    <details class="filters" [open]="filtersOpen">
      <summary>Filters & search</summary>
      <div class="adm-filters">
        <input class="input" [(ngModel)]="f.q" (keyup.enter)="load(1)" placeholder="Name, company, email or reference" aria-label="Search" />
        <select class="select" [(ngModel)]="f.status" (change)="load(1)" aria-label="Status"><option value="">Any status</option>@for (s of statusKeys; track s) {<option [value]="s">{{ statuses[s][0] }}</option>}</select>
        <select class="select" [(ngModel)]="f.categoryId" (change)="load(1)" aria-label="Topic"><option [ngValue]="null">Any topic</option>@for (c of cats(); track c['id']) {<option [ngValue]="c['id']">{{ c['name'] }}</option>}</select>
        <select class="select" [(ngModel)]="f.priority" (change)="load(1)" aria-label="Priority"><option value="">Any priority</option>@for (p of prioKeys; track p) {<option [value]="p">{{ prio[p][0] }}</option>}</select>
        <select class="select" [(ngModel)]="f.productId" (change)="load(1)" aria-label="Product"><option [ngValue]="null">Any product</option>@for (p of products(); track p.id) {<option [ngValue]="p.id">{{ p.name }}</option>}</select>
        <select class="select" [(ngModel)]="f.assignedTo" (change)="load(1)" aria-label="Assigned to"><option [ngValue]="null">Anyone</option>@for (s of staff(); track s['id']) {<option [ngValue]="s['id']">{{ s['name'] }}</option>}</select>
        <select class="select" [(ngModel)]="f.has" (change)="load(1)" aria-label="Customer has"><option value="">Demo or package</option><option value="demo">Customer has a demo</option><option value="package">Customer has a package</option></select>
        <select class="select" [(ngModel)]="f.channel" (change)="load(1)" aria-label="Source"><option value="">All sources</option><option value="chat">Website chat</option><option value="whatsapp">WhatsApp</option><option value="form">Contact form</option></select>
        @if (auth.can('sales.view')) { <select class="select" [(ngModel)]="f.department" (change)="load(1)" aria-label="Department"><option value="support">Support department</option><option value="sales">Sales department</option><option value="all">Both departments</option></select> }
        <input class="input" type="date" [(ngModel)]="f.from" (change)="load(1)" aria-label="Last message from" />
        <input class="input" type="date" [(ngModel)]="f.to" (change)="load(1)" aria-label="Last message to" />
        <button class="btn btn-ghost btn-sm" type="button" (click)="clear()">Clear</button>
      </div>
    </details>

    <div class="inbox" [class.has-open]="!!cur()">
      <ul class="convs" aria-label="Conversations">
        @for (t of list(); track t['id']) {
          <li><button type="button" class="conv" [class.on]="cur()?.['id'] === t['id']" [class.unread]="t['admin_unread'] > 0" (click)="open(t['id'])">
            <span class="top"><strong>{{ t['name'] }}</strong>@if (t['company']) {<span class="muted"> · {{ t['company'] }}</span>}<span class="when">{{ t['last_message_at'] | date: 'd MMM, HH:mm' }}</span></span>
            <span class="subj">{{ t['subject'] }}</span>
            <span class="prev">{{ t['preview'] }}</span>
            <span class="meta">
              <span class="badge" [class]="'badge ' + statuses[t['status']][1]">{{ statuses[t['status']][0] }}</span>
              @if (t['priority'] === 'high' || t['priority'] === 'urgent') { <span class="badge" [class]="'badge ' + prio[t['priority']][1]">{{ prio[t['priority']][0] }}</span> }
              @if (t['category']) { <span class="tag">{{ t['category'] }}</span> }
              @if (t['product']) { <span class="tag">{{ t['product'] }}</span> }
              <span class="tag" [class.wa]="t['channel'] === 'whatsapp' || t['wa_count'] > 0">{{ src(t) }} · {{ t['reference'] }}</span>
              @if (t['department'] === 'sales') { <span class="tag sales">Sales</span> }
              @if (t['enquiry_type'] === 'technical') { <span class="tag">Technical</span> }
              @if (t['assignee']) { <span class="tag">→ {{ t['assignee'] }}</span> }
              @if (t['admin_unread'] > 0) { <span class="dot" aria-label="Unread">{{ t['admin_unread'] }}</span> }
            </span>
          </button></li>
        } @empty { <li class="muted empty">No conversations here.</li> }
        @if (meta(); as m) { @if (m['page'] * m['perPage'] < m['total']) { <li><button class="btn btn-ghost btn-sm" type="button" (click)="load(m['page'] + 1, true)">Load more</button></li> } }
      </ul>

      <section class="thread" aria-live="polite">
        @if (cur(); as t) {
          <header class="th-h">
            <button class="btn btn-ghost btn-sm back" type="button" (click)="close()">← All conversations</button>
            <div><h2>{{ t['subject'] }}</h2><p class="muted small">{{ t['reference'] }} · {{ t['channel'] === 'chat' ? 'Website chat' : t['channel'] === 'whatsapp' ? 'WhatsApp (+' + t['wa_customer_phone'] + ')' : 'Contact form' }} · {{ t['department'] === 'sales' ? 'Sales' : 'Support' }} department · started {{ t['created_at'] | date: 'd MMM y, HH:mm' }}@if (t['human_at']) { · agent joined {{ t['human_at'] | date: 'HH:mm' }} }</p></div>
          </header>
          @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
          <div class="body-grid">
            <div class="msgs-col">
              <ol class="msgs" #msgs>
                @for (m of t['messages']; track m['id']) {
                  @if (m['author_kind'] === 'system' && !m['is_internal']) { <li class="sys"><p>{{ m['body'] }}</p></li> }
                  @else {
                  <li [class]="m['is_internal'] ? 'note' : m['author_kind'] === 'staff' ? 'staff' : m['author_kind'] === 'bot' ? 'bot' : 'cust'">
                    <span class="who">{{ m['is_internal'] ? 'Internal note · ' + (m['author'] ?? 'Staff') : m['author_kind'] === 'staff' ? (m['author'] ?? 'SCHLUSS') : m['author_kind'] === 'bot' ? 'SCHLUSS Assistant (automated)' : t['name'] }}<span class="muted"> · {{ m['created_at'] | date: 'd MMM, HH:mm' }}@if (m['source'] === 'whatsapp') { · via WhatsApp }</span></span>
                    <p>{{ m['body'] }}</p>
                    @if (m['whatsapp']?.length) { <span class="wa-st">@for (w of m['whatsapp']; track $index) { <span [class]="'badge ' + waCls(w['status'])" [title]="w['error'] ?? ''">WhatsApp +{{ w['peer_phone'] }}: {{ waLabel[w['status']] ?? w['status'] }}</span> }</span> }
                  </li>
                  }
                }
              </ol>
              @if (auth.can('support.manage')) {
                <form class="reply" [class.internal]="internal" (ngSubmit)="send()">
                  <div class="mode" role="radiogroup" aria-label="Message type">
                    <label><input type="radio" name="mode" [value]="false" [(ngModel)]="internal" /> Reply to customer</label>
                    <label><input type="radio" name="mode" [value]="true" [(ngModel)]="internal" /> Internal note (staff only)</label>
                  </div>
                  <textarea class="textarea" rows="4" name="body" [(ngModel)]="reply" [placeholder]="internal ? 'Only staff will see this note' : 'Write your reply – it appears in the customer’s website chat'" aria-label="Message" maxlength="4000"></textarea>
                  <div class="row-actions"><button class="btn btn-primary btn-sm" type="submit" [disabled]="!reply.trim() || busy()">{{ internal ? 'Add note' : 'Send reply' }}</button>
                    @if (!internal) { <span class="muted tiny">{{ t['requester_user_id'] ? 'The customer is notified in their account' : 'The visitor sees it in their chat' }}{{ settings()['emailCustomerOnReply'] ? ' and by email.' : '.' }}</span> }</div>
                </form>
              }
            </div>
            <aside class="side">
              <div class="box">
                <h3>Conversation</h3>
                <label>Status<select class="select sm" [ngModel]="t['status']" (ngModelChange)="update({ status: $event })" [disabled]="!auth.can('support.manage')">@for (s of statusKeys; track s) {<option [value]="s">{{ statuses[s][0] }}</option>}</select></label>
                <label>Priority<select class="select sm" [ngModel]="t['priority']" (ngModelChange)="update({ priority: $event })" [disabled]="!auth.can('support.manage')">@for (p of prioKeys; track p) {<option [value]="p">{{ prio[p][0] }}</option>}</select></label>
                <label>Topic<select class="select sm" [ngModel]="t['category_id']" (ngModelChange)="update({ categoryId: $event })" [disabled]="!auth.can('support.manage')"><option [ngValue]="null">None</option>@for (c of cats(); track c['id']) {<option [ngValue]="c['id']">{{ c['name'] }}</option>}</select></label>
                <label>Assigned to<select class="select sm" [ngModel]="t['assigned_to']" (ngModelChange)="update({ assignedTo: $event })" [disabled]="!auth.can('support.manage')"><option [ngValue]="null">Unassigned</option>@for (s of staff(); track s['id']) {<option [ngValue]="s['id']">{{ s['name'] }}</option>}</select></label>
                <div class="row-actions">
                  @if (auth.can('support.manage')) {
                    @if (t['status'] === 'closed' || t['status'] === 'resolved') { <button class="btn btn-ghost btn-sm" type="button" (click)="update({ status: 'open' })">Reopen</button> }
                    @else { <button class="btn btn-ghost btn-sm" type="button" (click)="update({ status: 'resolved' })">Resolve</button><button class="btn btn-ghost btn-sm" type="button" (click)="update({ status: 'closed' })">Close</button> }
                    <button class="btn btn-ghost btn-sm" type="button" (click)="update({ unread: true }); close()">Mark unread</button>
                  }
                </div>
              </div>
              <div class="box">
                <h3>Contact</h3>
                <p class="small"><strong>{{ t['name'] }}</strong>@if (t['company'] || t['customer']?.['company']) {<br />{{ t['company'] || t['customer']?.['company'] }}}<br /><a [href]="'mailto:' + t['email']">{{ t['email'] }}</a>@if (t['cellphone']) {<br />{{ t['cellphone'] }}}</p>
                @if (t['product']) { <p class="small">Product: <strong>{{ t['product'] }}</strong></p> }
                @if (t['customer']; as c) {
                  <p class="small"><a [routerLink]="['/admin/customers', c['id']]">Open customer profile →</a></p>
                  @if (c['partner']) { <p class="small">Partner: {{ c['partner'] }}</p> }
                  @if (c['demos'].length) { <h4>Demos</h4><ul class="mini">@for (d of c['demos']; track d['id']) { <li><a [routerLink]="['/admin/demos', d['id']]">{{ d['product'] }}</a> <span class="badge" [class]="'badge ' + demo[d['status']][1]">{{ demo[d['status']][0] }}</span></li> }</ul> }
                  @if (c['packages'].length) { <h4>Packages</h4><ul class="mini">@for (p of c['packages']; track p['id']) { <li>{{ p['product'] }} · {{ p['type'] }} · {{ p['status'] }}</li> }</ul> }
                  @if (c['others'].length) { <h4>Previous conversations</h4><ul class="mini">@for (o of c['others']; track o['id']) { <li><button type="button" class="linkish" (click)="open(o['id'])">{{ o['subject'] }}</button> <span class="muted tiny">{{ statuses[o['status']]?.[0] }}</span></li> }</ul> }
                } @else { <p class="muted tiny">Website visitor – not signed in to a customer account.</p> }
              </div>
            </aside>
          </div>
        } @else { <div class="empty-th muted">Choose a conversation.</div> }
      </section>
    </div>

    <dialog #setup class="dlg wide">
      <h2>Topics & chat settings</h2>
      @if (setupErr()) { <div class="alert alert-error">{{ setupErr() }}</div> }
      <h3>Chat topics</h3>
      <ul class="cats">
        @for (c of cats(); track c['id']) {
          <li>
            <input class="input sm" [(ngModel)]="c['name']" [attr.aria-label]="'Topic name ' + c['name']" />
            <select class="select sm" [(ngModel)]="c['priority']" aria-label="Default priority">@for (p of prioKeys; track p) {<option [value]="p">{{ prio[p][0] }}</option>}</select>
            <label class="check"><input type="checkbox" [(ngModel)]="c['is_active']" /><span>Shown</span></label>
            <button class="btn btn-ghost btn-sm" type="button" (click)="saveCat(c)">Save</button>
            @if (!c['uses']) { <button class="btn btn-danger btn-sm" type="button" (click)="deleteCat(c)">Delete</button> }
          </li>
        }
      </ul>
      <div class="row-actions"><input class="input sm" [(ngModel)]="newCat" placeholder="New topic" aria-label="New topic" /><button class="btn btn-ghost btn-sm" type="button" (click)="addCat()">Add topic</button></div>
      <h3>Chat settings</h3>
      <div class="field"><label for="av">Message shown in the chat (availability)</label><textarea id="av" class="textarea" rows="3" [(ngModel)]="sf['availabilityMessage']"></textarea></div>
      <div class="field"><label for="oh">Remind staff when a conversation waits longer than (hours)</label><input id="oh" class="input" type="number" min="1" max="168" [(ngModel)]="sf['overdueHours']" /></div>
      <label class="check"><input type="checkbox" [(ngModel)]="sf['emailCustomerOnReply']" /><span>Email the customer when we reply (first unread reply only)</span></label>
      <label class="check"><input type="checkbox" [(ngModel)]="sf['emailAdminsOnNew']" /><span>Email the admin address when a new conversation starts</span></label>
      <div class="actions"><button class="btn btn-ghost" type="button" (click)="setupDlg().nativeElement.close()">Close</button><button class="btn btn-primary" type="button" (click)="saveSettings()">Save settings</button></div>
    </dialog>
  `,
  styles: `
    h1 { font-size: 28px; }
    .status-tabs .cnt { margin-left: 6px; padding: 0 7px; border-radius: 10px; background: var(--sch-blue); color: #fff; font-size: 12px; }
    .filters { margin: 10px 0; } .filters summary { cursor: pointer; font-weight: 600; font-size: 14px; margin-bottom: 8px; }
    .inbox { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; gap: 14px; align-items: start; }
    .convs { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; max-height: 76vh; overflow: auto; }
    .conv { width: 100%; text-align: left; display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r); background: #fff; cursor: pointer; font: inherit; color: var(--fg); }
    .conv.on { border-color: var(--sch-blue); box-shadow: 0 0 0 1px var(--sch-blue); }
    .conv.unread { background: #f5f9ff; } .conv.unread .subj { font-weight: 700; }
    .top { display: flex; gap: 4px; align-items: baseline; font-size: 14px; } .when { margin-left: auto; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .subj { font-size: 14px; } .prev { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .tag { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: var(--surface-2, #eef1f5); color: var(--muted); }
    .dot { margin-left: auto; min-width: 20px; height: 20px; border-radius: 10px; padding: 0 6px; display: grid; place-items: center; background: var(--sch-blue); color: #fff; font-size: 12px; font-weight: 700; }
    .thread { border: 1px solid var(--line); border-radius: var(--r-lg, 14px); background: #fff; padding: 16px; min-height: 420px; }
    .empty-th { display: grid; place-items: center; min-height: 380px; }
    .th-h h2 { margin: 0; font-size: 20px; } .th-h .back { display: none; margin-bottom: 8px; }
    .body-grid { display: grid; grid-template-columns: 1fr 260px; gap: 16px; margin-top: 12px; }
    .msgs { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; max-height: 52vh; overflow: auto; }
    .msgs li { padding: 10px 12px; border-radius: 12px; max-width: 86%; }
    .msgs li p { margin: 4px 0 0; white-space: pre-line; overflow-wrap: anywhere; }
    .msgs .cust { background: var(--surface-2, #eef1f5); }
    .msgs .staff { background: #e8f1ff; margin-left: auto; }
    .msgs .note { background: #fff7e0; border: 1px dashed #e6b84a; margin-left: auto; }
    .msgs .bot { background: #f4f0ff; border: 1px dashed #b7a6ff; }
    .msgs .sys { max-width: none; text-align: center; background: none; padding: 0; font-size: 12px; color: var(--muted); }
    .wa-st { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; } .wa-st .badge { font-size: 11px; }
    .tag.wa { background: #e3f8ec; color: #11734b; } .tag.sales { background: #fff1d6; color: #8a5a00; }
    .sum { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); margin: 12px 0; }
    .sk { display: grid; gap: 0; padding: 8px 10px; border: 1px solid var(--line); border-top: 3px solid var(--c); border-radius: 10px; background: #fff; text-align: left; cursor: pointer; font: inherit; color: var(--fg); }
    .sk b { font: 700 22px var(--f-head); color: var(--heading); } .sk span { font-size: 12px; color: var(--muted); }
    .live { font-size: 12px; color: var(--muted); } .live.on { color: #11734b; }
    .who { font-size: 12px; font-weight: 600; }
    .reply { margin-top: 12px; display: grid; gap: 8px; } .reply.internal textarea { background: #fffaf0; border-color: #e6b84a; }
    .mode { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; }
    .side .box { border: 1px solid var(--line); border-radius: var(--r); padding: 12px; margin-bottom: 10px; display: grid; gap: 8px; }
    .side h3 { margin: 0; font-size: 15px; } .side h4 { margin: 6px 0 0; font-size: 13px; }
    .side label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
    .mini { list-style: none; padding: 0; margin: 0; font-size: 13px; display: grid; gap: 4px; }
    .small { font-size: 13px; margin: 0; } .tiny { font-size: 12px; }
    .sm { min-height: 34px; padding: 2px 8px; font-size: 14px; }
    .linkish { background: none; border: 0; padding: 0; color: var(--sch-blue); text-decoration: underline; cursor: pointer; font: inherit; text-align: left; }
    .cats { list-style: none; padding: 0; margin: 0 0 10px; display: grid; gap: 6px; } .cats li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .cats .input { flex: 1 1 180px; }
    .empty { padding: 20px; text-align: center; }
    @media (max-width: 1100px) { .body-grid { grid-template-columns: 1fr; } }
    @media (max-width: 860px) {
      .inbox { grid-template-columns: 1fr; }
      .inbox.has-open .convs { display: none; } .inbox:not(.has-open) .thread { display: none; }
      .th-h .back { display: inline-flex; }
    }
  `,
})
export class SupportInboxPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  private cat = inject(CatalogueApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private msgsEl = viewChild<ElementRef<HTMLElement>>('msgs');
  protected setupDlg = viewChild.required<ElementRef<HTMLDialogElement>>('setup');
  protected views = VIEWS;
  protected statuses = CHAT_STATUS;
  protected statusKeys = Object.keys(CHAT_STATUS);
  protected prio = PRIORITY;
  protected prioKeys = Object.keys(PRIORITY);
  protected demo = DEMO_STATUS;
  protected list = signal<Row[]>([]);
  protected counts = signal<Record<string, number>>({});
  protected meta = signal<Row | null>(null);
  protected cur = signal<Row | null>(null);
  protected cats = signal<Row[]>([]);
  protected staff = signal<Row[]>([]);
  protected products = signal<ProductRow[]>([]);
  protected settings = signal<Row>({});
  protected err = signal<string | null>(null);
  protected setupErr = signal<string | null>(null);
  protected busy = signal(false);
  protected view = 'open';
  protected filtersOpen = false;
  protected f: Row = { q: '', status: '', categoryId: null, priority: '', productId: null, assignedTo: null, has: '', channel: '', from: '', to: '', department: 'support' };
  protected sum = signal<Row | null>(null);
  protected live = signal(false);
  protected sumKeys: [string, string, string][] = [['total', 'Total', '#3282F6'], ['new', 'New', '#3282F6'], ['open', 'Open', '#F5A524'], ['awaitingCustomer', 'Awaiting customer', '#7B5CFF'], ['unresolved', 'Unresolved', '#E7458C'], ['resolved', 'Resolved', '#22a06b'], ['whatsapp', 'WhatsApp', '#25D366'], ['website', 'Website chat', '#14C2B0'], ['leads', 'Open leads', '#F5A524'], ['demoLeads', 'Demo-expiry leads', '#E7458C']];
  protected waLabel: Record<string, string> = { queued: 'queued', sent: 'sent (awaiting delivery)', delivered: 'delivered', read: 'read', failed: 'failed' };
  protected waCls = (s: string) => (s === 'failed' ? 'badge-danger' : s === 'delivered' || s === 'read' ? 'badge-ok' : 'badge-muted');
  protected src = (t: Row) => (t['channel'] === 'whatsapp' ? 'WhatsApp' : t['channel'] === 'chat' ? (t['wa_count'] > 0 ? 'Chat ↔ WhatsApp' : 'Chat') : 'Form');
  protected reply = '';
  protected internal = false;
  protected newCat = '';
  protected sf: Row = {};

  constructor() {
    // Near-real-time: refresh the list and the open conversation every 20 s while the page is open.
    const t = setInterval(() => {
      if (document.hidden) return;
      void this.load(1, false, true);
      const c = this.cur();
      if (c) void this.api.get(`/support/conversations/${c['id']}`).then((x) => { if (this.cur()?.['id'] === x['id'] && x['messages'].length !== c['messages'].length) { this.cur.set(x); this.scroll(); } });
    }, 20_000);
    // Live: the server pushes an event when any conversation changes (new message, WhatsApp reply, status).
    let es: EventSource | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    if (typeof EventSource !== 'undefined') {
      es = new EventSource('/api/admin/support/stream', { withCredentials: true });
      es.onopen = () => this.live.set(true);
      es.onerror = () => this.live.set(false);
      es.addEventListener('update', (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as { ticketId: number };
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          void this.load(1, false, true);
          void this.loadSummary();
          const c = this.cur();
          if (c && c['id'] === e.ticketId) void this.api.get(`/support/conversations/${c['id']}`).then((x) => { if (this.cur()?.['id'] === x['id']) { this.cur.set(x); this.scroll(); } });
        }, 300);
      });
    }
    inject(DestroyRef).onDestroy(() => { clearInterval(t); es?.close(); if (pending) clearTimeout(pending); });
  }
  async loadSummary() {
    try { this.sum.set(await this.api.get('/support/summary')); } catch { /* optional */ }
  }
  quick(k: string) {
    if (k === 'leads' || k === 'demoLeads') { void this.router.navigate(['/admin/leads'], k === 'demoLeads' ? { queryParams: { source: 'demo_expiry' } } : {}); return; }
    const map: Record<string, Row> = { total: { view: 'all' }, new: { view: 'all', status: 'new' }, open: { view: 'open' }, awaitingCustomer: { view: 'all', status: 'awaiting_customer' }, unresolved: { view: 'open' }, resolved: { view: 'closed' }, whatsapp: { view: 'all', channel: 'whatsapp' }, website: { view: 'all', channel: 'chat' } };
    const m = map[k] ?? { view: 'all' };
    this.view = m['view'];
    this.f = { ...this.f, status: m['status'] ?? '', channel: m['channel'] ?? '' };
    this.filtersOpen = !!(m['status'] || m['channel']);
    void this.load(1);
  }

  ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('view')) this.view = qp.get('view')!;
    if (qp.get('productId')) { this.f['productId'] = Number(qp.get('productId')); this.filtersOpen = true; }
    void this.api.get<Row[]>('/support/categories').then((c) => this.cats.set(c));
    void this.api.get<Row[]>('/support/staff').then((s) => this.staff.set(s));
    void this.api.get('/support/settings').then((s) => this.settings.set(s));
    void this.cat.products({ perPage: 100 }).then((r) => this.products.set(r.data)).catch(() => undefined);
    if (qp.get('department')) this.f['department'] = qp.get('department');
    void this.load(1);
    void this.loadSummary();
    const open = Number(qp.get('open'));
    if (open) void this.open(open);
  }
  async load(page: number, append = false, quiet = false) {
    const r = await this.api.page('/support/conversations', { page, perPage: 30, view: this.view, ...this.f });
    void quiet;
    this.list.set(append ? [...this.list(), ...r.data] : r.data);
    this.counts.set(r.counts ?? {});
    this.meta.set(r.meta);
  }
  clear() {
    this.f = { q: '', status: '', categoryId: null, priority: '', productId: null, assignedTo: null, has: '', channel: '', from: '', to: '', department: 'support' };
    void this.load(1);
  }
  async open(id: number) {
    this.err.set(null);
    try {
      this.cur.set(await this.api.get(`/support/conversations/${id}`));
      this.list.update((l) => l.map((x) => (x['id'] === id ? { ...x, admin_unread: 0 } : x)));
      void this.router.navigate([], { queryParams: { open: id }, queryParamsHandling: 'merge', replaceUrl: true });
      this.scroll();
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  close() {
    this.cur.set(null);
    void this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  private scroll() {
    setTimeout(() => { const el = this.msgsEl()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; });
  }
  async send() {
    const t = this.cur();
    if (!t || !this.reply.trim()) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      await this.api.post(`/support/conversations/${t['id']}/messages`, { body: this.reply, internal: this.internal });
      this.reply = '';
      this.internal = false;
      this.cur.set(await this.api.get(`/support/conversations/${t['id']}`));
      this.scroll();
      void this.load(1, false, true);
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
  async update(patch: Row) {
    const t = this.cur();
    if (!t) return;
    try {
      await this.api.patch(`/support/conversations/${t['id']}`, patch);
      if (!('unread' in patch)) this.cur.set(await this.api.get(`/support/conversations/${t['id']}`));
      void this.load(1, false, true);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async openSetup() {
    this.sf = { ...(await this.api.get('/support/settings')) };
    this.setupErr.set(null);
    this.setupDlg().nativeElement.showModal();
  }
  private async cats$() {
    this.cats.set(await this.api.get<Row[]>('/support/categories'));
  }
  async saveCat(c: Row) {
    try { await this.api.put(`/support/categories/${c['id']}`, { name: c['name'], priority: c['priority'], isActive: c['is_active'] }); await this.cats$(); } catch (e) { this.setupErr.set(toApiError(e).message); }
  }
  async addCat() {
    if (!this.newCat.trim()) return;
    try { await this.api.post('/support/categories', { name: this.newCat.trim() }); this.newCat = ''; await this.cats$(); } catch (e) { this.setupErr.set(toApiError(e).message); }
  }
  async deleteCat(c: Row) {
    if (!confirm(`Delete topic “${c['name']}”?`)) return;
    try { await this.api.del(`/support/categories/${c['id']}`); await this.cats$(); } catch (e) { this.setupErr.set(toApiError(e).message); }
  }
  async saveSettings() {
    try {
      this.settings.set(await this.api.put('/support/settings', { ...this.sf, overdueHours: Number(this.sf['overdueHours']) }));
      this.setupDlg().nativeElement.close();
    } catch (e) {
      this.setupErr.set(toApiError(e).message);
    }
  }
}

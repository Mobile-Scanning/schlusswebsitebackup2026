import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, toApiError } from '../core/auth.service';
import { fileSize, PlatformApi, Row } from './platform-api';

/**
 * v7 admin sections: Potential leads (support), Sales enquiries (sales), Businesses, WhatsApp settings,
 * Email settings, Reports, System settings and Product downloads. Every action is permission-checked on the
 * server; the UI only hides what a role can't use.
 */

const STYLES = `
  h1 { font-size: 28px; } h2 { font-size: 18px; margin: 0 0 10px; } h3 { font-size: 15px; margin: 0 0 6px; }
  .kpis { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); margin: 16px 0; }
  .kpi { display: grid; gap: 2px; padding: 14px; border-radius: var(--r); border: 1px solid var(--line); background: #fff; color: var(--fg); border-top: 3px solid var(--c, var(--sch-blue)); cursor: pointer; text-align: left; font: inherit; }
  .kpi[aria-pressed='true'] { box-shadow: 0 0 0 2px var(--c, var(--sch-blue)); }
  .kpi .v { font: 700 28px var(--f-head); color: var(--heading); font-variant-numeric: tabular-nums; }
  .kpi .l { font-size: 13px; color: var(--muted); }
  .tiny { font-size: 12px; } .small { font-size: 13px; }
  .grid2 { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  .card + .card, .grid2 + .card, .card + .grid2 { margin-top: 14px; }
  .lst { list-style: none; padding: 0; margin: 0; } .lst li { padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; } .lst li:first-child { border-top: 0; }
  .timeline { list-style: none; padding: 0; margin: 0; font-size: 13px; } .timeline li { padding: 6px 0 8px 14px; border-left: 2px solid var(--line); position: relative; }
  .timeline li::before { content: ''; position: absolute; left: -5px; top: 11px; width: 8px; height: 8px; border-radius: 50%; background: var(--sch-blue); }
  .keep-lines { white-space: pre-line; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .note { padding: 10px 14px; border-radius: 10px; background: var(--surface-2, #f2f5fa); font-size: 14px; }
  .note.ok { background: #e9f8ef; } .note.warn { background: #fff5df; }
  .msgs { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; } .msgs li { padding: 8px 12px; border-radius: 10px; background: #f3f5f9; font-size: 14px; } .msgs li.staff { background: #eaf2ff; } .msgs li.internal { background: #fff5df; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .secret { display: grid; gap: 4px; }
  .cv { font-family: var(--f-mono); font-size: 13px; overflow-wrap: anywhere; text-transform: none; letter-spacing: 0; }
`;

const LEAD_STATUS: Record<string, [string, string]> = {
  new: ['New lead', 'badge-info'],
  contact_required: ['Contact required', 'badge-warn'],
  contacted: ['Contacted', 'badge-muted'],
  interested: ['Interested', 'badge-ok'],
  not_interested: ['Not interested', 'badge-muted'],
  assistance_required: ['Assistance required', 'badge-warn'],
  converted: ['Converted to customer', 'badge-ok'],
  closed: ['Closed', 'badge-muted'],
};
const LEAD_SOURCE: Record<string, string> = { demo_expiry: 'Demo expiry', chat: 'Chat', contact: 'Contact form', manual: 'Added by staff' };
const ACTIVITY: Record<string, string> = { note: 'Note', call: 'Phone call', email: 'Email', whatsapp: 'WhatsApp', feedback: 'Customer feedback', status: 'Status change', system: 'System' };
const SALES_STATUS: Record<string, [string, string]> = {
  new: ['New', 'badge-info'], contacted: ['Contacted', 'badge-muted'], quoted: ['Quoted', 'badge-warn'], processing: ['Processing', 'badge-warn'],
  won: ['Won', 'badge-ok'], lost: ['Lost', 'badge-muted'], cancelled: ['Cancelled', 'badge-muted'],
  invoiced: ['Invoiced', 'badge-warn'], paid: ['Paid', 'badge-ok'], fulfilled: ['Fulfilled', 'badge-ok'], declined: ['Declined', 'badge-muted'],
};
const SALES_SOURCE: Record<string, string> = { product_page: 'Product page', chat: 'Chat', contact: 'Contact form', lead: 'Support lead', admin: 'Admin' };

/** Small helper: run an API call, show the error or message. */
function runner(err: ReturnType<typeof signal<string | null>>, msg: ReturnType<typeof signal<string | null>>, fields?: ReturnType<typeof signal<Record<string, string>>>) {
  return async <T>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    err.set(null);
    msg.set(null);
    fields?.set({});
    try {
      const r = await fn();
      if (ok) msg.set(ok);
      return r;
    } catch (e) {
      const a = toApiError(e);
      fields?.set(a.fields);
      err.set(Object.values(a.fields)[0] ?? a.message);
      return null;
    }
  };
}

/* =========================================================================================
 * Potential leads (support department)
 * ========================================================================================= */
@Component({
  selector: 'sch-leads-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      <div><h1>Potential leads</h1><p class="muted">Customers whose demo is ending, and others support should follow up. Leads belong to the support team – they reach sales only when the customer explicitly wants to buy.</p></div>
    </div>
    @if (counts(); as c) {
      <div class="kpis">
        @for (k of kpis; track k.key) {
          <button type="button" class="kpi" [style.--c]="k.c" [attr.aria-pressed]="f.status === k.key" (click)="f.status = f.status === k.key ? '' : k.key; load(1)"><span class="v">{{ c[k.key] ?? 0 }}</span><span class="l">{{ k.label }}</span></button>
        }
      </div>
    }
    <div class="adm-filters">
      <input class="input" [(ngModel)]="f.q" (keyup.enter)="load(1)" placeholder="Customer, business, email or reference" aria-label="Search" />
      <select class="select" [(ngModel)]="f.status" (change)="load(1)" aria-label="Status"><option value="">All statuses</option>@for (s of statusKeys; track s) {<option [value]="s">{{ statuses[s][0] }}</option>}</select>
      <select class="select" [(ngModel)]="f.source" (change)="load(1)" aria-label="Source"><option value="">All sources</option>@for (s of sourceKeys; track s) {<option [value]="s">{{ sources[s] }}</option>}</select>
      <label class="check"><input type="checkbox" [(ngModel)]="f.open" (change)="load(1)" /><span>Open only</span></label>
    </div>
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Customer</th><th>Product</th><th>Demo expires</th><th>Status</th><th>Attempts</th><th>Assigned</th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td data-label="Customer"><a [routerLink]="['/admin/leads', r.id]"><strong>{{ r.full_name || '—' }}</strong></a><br /><span class="muted tiny">{{ r.company || '—' }} · {{ r.email }} · {{ r.reference }}</span></td>
              <td data-label="Product">{{ r.product || '—' }}<br /><span class="muted tiny">{{ sources[r.source] }}</span></td>
              <td data-label="Demo expires">@if (r.demo_expires_at) { {{ r.demo_expires_at | date: 'd MMM y' }}<br /><span class="muted tiny">{{ r.days_remaining > 0 ? r.days_remaining + ' day(s) left' : 'Expired' }}</span> } @else { — }</td>
              <td data-label="Status"><span [class]="'badge ' + statuses[r.status][1]">{{ statuses[r.status][0] }}</span></td>
              <td data-label="Attempts">{{ r.contact_attempts }}@if (r.last_contact_at) { <br /><span class="muted tiny">last {{ r.last_contact_at | date: 'd MMM' }}</span> }</td>
              <td data-label="Assigned">{{ r.assignee || '—' }}</td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No leads match.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (meta(); as m) { <div class="pager"><span class="muted">{{ m.total }} lead(s)</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="m.page <= 1" (click)="load(m.page - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="m.page * m.perPage >= m.total" (click)="load(m.page + 1)">Next</button></span></div> }
  `,
  styles: STYLES,
})
export class LeadsAdminPage implements OnInit {
  private api = inject(PlatformApi);
  protected rows = signal<Row[]>([]);
  protected meta = signal<Row | null>(null);
  protected counts = signal<Record<string, number> | null>(null);
  protected statuses = LEAD_STATUS;
  protected statusKeys = Object.keys(LEAD_STATUS);
  protected sources = LEAD_SOURCE;
  protected sourceKeys = Object.keys(LEAD_SOURCE);
  private qp = inject(ActivatedRoute).snapshot.queryParamMap;
  protected f = { q: '', status: this.qp.get('status') ?? '', source: this.qp.get('source') ?? '', open: false };
  protected kpis = [
    { key: 'new', label: 'New leads', c: '#3282F6' },
    { key: 'contact_required', label: 'Contact required', c: '#F5A524' },
    { key: 'contacted', label: 'Contacted', c: '#7B5CFF' },
    { key: 'interested', label: 'Interested', c: '#14C2B0' },
    { key: 'assistance_required', label: 'Need assistance', c: '#E7458C' },
    { key: 'converted', label: 'Converted', c: '#22a06b' },
  ];
  ngOnInit() {
    void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page('/leads', { page, perPage: 25, q: this.f.q, status: this.f.status, source: this.f.source, open: this.f.open ? 1 : '' });
    this.rows.set(r.data);
    this.meta.set(r.meta);
    this.counts.set(r.counts ?? {});
  }
}

@Component({
  selector: 'sch-lead-detail',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/admin/leads" class="back">← Potential leads</a>
    @if (l(); as l) {
      <div class="adm-head">
        <div><h1>{{ l.full_name || 'Lead' }}</h1><p class="muted">{{ l.reference }} · {{ sources[l.source] }}@if (l.product) { · {{ l.product }} } · created {{ l.created_at | date: 'd MMM y' }}</p></div>
        <span [class]="'badge ' + statuses[l.status][1]">{{ statuses[l.status][0] }}</span>
      </div>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      <div class="grid2">
        <section class="card">
          <h2>Contact</h2>
          <dl>
            <dt>Business</dt><dd>{{ l.business || l.company || '—' }}</dd>
            <dt>Email</dt><dd>@if (l.email) { <a [href]="'mailto:' + l.email">{{ l.email }}</a> } @else { — }</dd>
            <dt>Phone</dt><dd>@if (l.cellphone) { <a [href]="'tel:' + l.cellphone">{{ l.cellphone }}</a> } @else { — }</dd>
            <dt>WhatsApp</dt><dd>@if (l.cellphone && l.whatsappConsent) { <a [href]="'https://wa.me/' + digits(l.cellphone)" target="_blank" rel="noopener">Open WhatsApp</a> } @else { <span class="muted">No WhatsApp consent recorded – call or email instead.</span> }</dd>
            <dt>Region</dt><dd>{{ l.province || '—' }}, {{ l.country || '—' }}</dd>
            <dt>Customer</dt><dd>@if (l.customer_id) { <a [routerLink]="['/admin/customers', l.customer_id]">Open customer record</a> } @else { — }</dd>
          </dl>
        </section>
        <section class="card">
          <h2>Demo</h2>
          @if (l.demo; as d) {
            <dl>
              <dt>Status</dt><dd>{{ d.statusLabel }}</dd>
              <dt>Expires</dt><dd><strong>{{ (d.expires_at | date: 'd MMMM y') ?? 'Starts at activation' }}</strong>@if (l.days_remaining !== null) { ({{ l.days_remaining > 0 ? l.days_remaining + ' day(s) left' : 'expired' }}) }</dd>
              <dt>Activated</dt><dd>{{ (d.activated_at | date: 'd MMM y') ?? 'Not yet' }}</dd>
              <dt>Licence</dt><dd class="cv">{{ d.licence_key }}</dd>
            </dl>
            <a class="btn btn-ghost btn-sm" [routerLink]="['/admin/demos', d.id]" style="margin-top: 10px">Open demo record</a>
          } @else { <p class="muted small">No demo linked.</p> }
        </section>
        <section class="card">
          <h2>Manage</h2>
          <fieldset [disabled]="!auth.can('leads.manage')">
            <div class="field"><label for="ls">Status</label><select id="ls" class="select" [(ngModel)]="status">@for (s of statusKeys; track s) {<option [value]="s">{{ statuses[s][0] }}</option>}</select></div>
            <div class="row"><button class="btn btn-primary btn-sm" type="button" (click)="save()">Save status</button><button class="btn btn-ghost btn-sm" type="button" (click)="assignMe()">Assign to me</button></div>
            <p class="muted tiny">Assigned: {{ l.assignee || 'nobody' }} · {{ l.contact_attempts }} contact attempt(s)@if (l.last_contact_at) {, last {{ l.last_contact_at | date: 'd MMM, HH:mm' }} }</p>
          </fieldset>
        </section>
      </div>

      @if (auth.can('leads.manage')) {
        <section class="card">
          <h2>Record contact or feedback</h2>
          <div class="form-row">
            <div class="field"><label for="ak">Type</label><select id="ak" class="select" [(ngModel)]="a.kind"><option value="call">Phone call</option><option value="email">Email</option><option value="whatsapp" [disabled]="!l.whatsappConsent">WhatsApp</option><option value="feedback">Customer feedback</option><option value="note">Internal note</option></select></div>
            <div class="field"><label for="ao">Outcome <span class="muted">(optional)</span></label><input id="ao" class="input" [(ngModel)]="a.outcome" list="outcomes" placeholder="e.g. No answer, Call back Friday" /><datalist id="outcomes"><option value="No answer"></option><option value="Left message"></option><option value="Spoke to customer"></option><option value="Call back later"></option><option value="Needs help installing"></option></datalist></div>
          </div>
          <div class="field"><label for="ab">Notes</label><textarea id="ab" class="textarea" rows="3" [(ngModel)]="a.body"></textarea></div>
          <div class="row"><button class="btn btn-primary btn-sm" type="button" (click)="addActivity()" [disabled]="!a.body.trim()">Save</button><button class="btn btn-ghost btn-sm" type="button" (click)="sdlg.showModal()">Customer wants to buy…</button></div>
        </section>
      }

      <div class="grid2">
        <section class="card"><h2>History</h2>
          <ul class="timeline">@for (x of l.activities; track x.id) { <li><strong>{{ activity[x.kind] }}</strong>@if (x.outcome) { · {{ x.outcome }} } <span class="muted tiny">{{ x.created_at | date: 'd MMM y, HH:mm' }}@if (x.actor) { · {{ x.actor }} }</span>@if (x.body) { <br /><span class="keep-lines">{{ x.body }}</span> }</li> } @empty { <li class="muted">Nothing yet.</li> }</ul>
        </section>
        <section class="card"><h2>Conversations & sales</h2>
          <ul class="lst">
            @for (c of l.conversations; track c.id) { <li><a routerLink="/admin/support" [queryParams]="{ open: c.id }">{{ c.subject }}</a> <span class="muted tiny">{{ c.reference }} · {{ c.department === 'sales' ? 'Sales' : 'Support' }} · {{ c.status }}</span></li> }
            @for (s of l.sales; track s.id) { <li>Sales enquiry {{ s.reference }} <span class="muted tiny">· {{ s.status }} · {{ s.created_at | date: 'd MMM y' }}</span></li> }
            @if (!l.conversations.length && !l.sales.length) { <li class="muted">None yet.</li> }
          </ul>
        </section>
      </div>

      <dialog #sdlg class="dlg">
        <form (ngSubmit)="toSales()">
          <h2>Send a purchase enquiry to sales</h2>
          <p class="muted small">Only when the customer has said they want to buy or want a quotation. This creates a separate sales enquiry and emails the sales team; the lead stays with support.</p>
          <div class="field"><label for="sq">Number of licences</label><input id="sq" class="input" type="number" min="1" name="q" [(ngModel)]="sale.quantity" /></div>
          <div class="field"><label for="sm">What the customer wants</label><textarea id="sm" class="textarea" rows="4" name="m" [(ngModel)]="sale.message"></textarea></div>
          <label class="check"><input type="checkbox" name="c" [(ngModel)]="sale.confirmed" /><span>The customer asked to purchase or for a quotation</span></label>
          <div class="actions"><button class="btn btn-ghost" type="button" (click)="sdlg.close()">Cancel</button><button class="btn btn-primary" type="submit" [disabled]="!sale.confirmed || !sale.message.trim()">Send to sales</button></div>
        </form>
      </dialog>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES,
})
export class LeadDetailPage implements OnInit {
  readonly id = input.required<string>();
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  private sdlg = viewChild<ElementRef<HTMLDialogElement>>('sdlg');
  protected l = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  private run = runner(this.err, this.msg);
  protected statuses = LEAD_STATUS;
  protected statusKeys = Object.keys(LEAD_STATUS);
  protected sources = LEAD_SOURCE;
  protected activity = ACTIVITY;
  protected status = 'new';
  protected a = { kind: 'call', outcome: '', body: '' };
  protected sale = { quantity: 1, message: '', confirmed: false };
  protected digits = (s: string) => String(s).replace(/\D/g, '');
  ngOnInit() {
    void this.run(() => this.api.get(`/leads/${this.id()}`)).then((l) => this.set(l));
  }
  private set(l: Row | null) {
    if (!l) return;
    this.l.set(l);
    this.status = l.status;
  }
  async save() {
    this.set(await this.run(() => this.api.patch(`/leads/${this.id()}`, { status: this.status }), 'Status saved.'));
  }
  async assignMe() {
    this.set(await this.run(() => this.api.patch(`/leads/${this.id()}`, { assignedTo: this.auth.user()!.id }), 'Assigned to you.'));
  }
  async addActivity() {
    const r = await this.run(() => this.api.post(`/leads/${this.id()}/activities`, { kind: this.a.kind, outcome: this.a.outcome || null, body: this.a.body }), 'Saved to the lead history.');
    if (r) {
      this.set(r);
      this.a = { kind: 'call', outcome: '', body: '' };
    }
  }
  async toSales() {
    const r = await this.run(() => this.api.post(`/leads/${this.id()}/sales-enquiry`, { quantity: Number(this.sale.quantity) || 1, message: this.sale.message, confirmed: this.sale.confirmed }), 'Sales enquiry created and emailed to the sales team.');
    if (r) {
      this.set(r);
      this.sdlg()?.nativeElement.close();
    }
  }
}

/* =========================================================================================
 * Sales enquiries (sales department)
 * ========================================================================================= */
@Component({
  selector: 'sch-sales-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Sales enquiries</h1><p class="muted">Genuine purchase and quotation requests only. Support questions stay in the Support Inbox.</p></div></div>
    @if (counts(); as c) {
      <div class="kpis">
        <button type="button" class="kpi" style="--c: #3282F6" [attr.aria-pressed]="f.status === 'new'" (click)="setStatus('new')"><span class="v">{{ c['new'] ?? 0 }}</span><span class="l">New</span></button>
        <button type="button" class="kpi" style="--c: #F5A524" [attr.aria-pressed]="f.status === 'open'" (click)="setStatus('open')"><span class="v">{{ (c['new'] ?? 0) + (c['contacted'] ?? 0) + (c['quoted'] ?? 0) + (c['processing'] ?? 0) }}</span><span class="l">Open</span></button>
        <button type="button" class="kpi" style="--c: #7B5CFF" [attr.aria-pressed]="f.status === 'quoted'" (click)="setStatus('quoted')"><span class="v">{{ c['quoted'] ?? 0 }}</span><span class="l">Quoted</span></button>
        <button type="button" class="kpi" style="--c: #14C2B0" [attr.aria-pressed]="f.status === 'completed'" (click)="setStatus('completed')"><span class="v">{{ (c['won'] ?? 0) + (c['paid'] ?? 0) + (c['fulfilled'] ?? 0) }}</span><span class="l">Won / completed</span></button>
      </div>
    }
    <div class="adm-filters">
      <input class="input" [(ngModel)]="f.q" (keyup.enter)="load(1)" placeholder="Name, business, email or reference" aria-label="Search" />
      <select class="select" [(ngModel)]="f.status" (change)="load(1)" aria-label="Status"><option value="">All statuses</option><option value="open">Open</option>@for (s of statusKeys; track s) {<option [value]="s">{{ statuses[s][0] }}</option>}</select>
      <select class="select" [(ngModel)]="f.source" (change)="load(1)" aria-label="Source"><option value="">All sources</option>@for (s of sourceKeys; track s) {<option [value]="s">{{ sources[s] }}</option>}</select>
      <input class="input" type="date" [(ngModel)]="f.from" (change)="load(1)" aria-label="From" /><input class="input" type="date" [(ngModel)]="f.to" (change)="load(1)" aria-label="To" />
    </div>
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Customer</th><th>Product</th><th>Licences</th><th>Received</th><th>Status</th><th>Assigned</th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td data-label="Customer"><button type="button" class="linkbtn" (click)="open(r.id)"><strong>{{ r.name || '—' }}</strong></button><br /><span class="muted tiny">{{ r.company || '—' }} · {{ r.email }} · {{ r.reference }}</span></td>
              <td data-label="Product">{{ r.product || '—' }}<br /><span class="muted tiny">{{ r.kind === 'quotation' ? 'Quotation' : 'Purchase' }} · {{ sources[r.source] ?? r.source }}</span></td>
              <td data-label="Licences">{{ r.quantity }}</td>
              <td data-label="Received">{{ r.created_at | date: 'd MMM y, HH:mm' }}</td>
              <td data-label="Status"><span [class]="'badge ' + (statuses[r.status]?.[1] ?? 'badge-muted')">{{ statuses[r.status]?.[0] ?? r.status }}</span></td>
              <td data-label="Assigned">{{ r.assignee || '—' }}</td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No sales enquiries match.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (meta(); as m) { <div class="pager"><span class="muted">{{ m.total }} enquiry(ies)</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="m.page <= 1" (click)="load(m.page - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="m.page * m.perPage >= m.total" (click)="load(m.page + 1)">Next</button></span></div> }

    <dialog #dlg class="dlg wide">
      @if (s(); as s) {
        <h2>{{ s.reference }} – {{ s.name || s.customer_name }}</h2>
        @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
        @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
        <div class="grid2">
          <dl>
            <dt>Business</dt><dd>{{ s.company || s.business || '—' }}</dd>
            <dt>Email</dt><dd><a [href]="'mailto:' + (s.email || s.customer_email)">{{ s.email || s.customer_email }}</a></dd>
            <dt>Phone</dt><dd>{{ s.cellphone || s.customer_phone || '—' }}</dd>
            <dt>Product</dt><dd>{{ s.product || '—' }}</dd>
            <dt>Licences</dt><dd>{{ s.quantity }}</dd>
            <dt>Source</dt><dd>{{ sources[s.source] || s.source || '—' }}</dd>
            <dt>Received</dt><dd>{{ s.created_at | date: 'd MMM y, HH:mm' }}</dd>
          </dl>
          <fieldset [disabled]="!auth.can('sales.manage')">
            <div class="field"><label for="ss">Status</label><select id="ss" class="select" [(ngModel)]="edit.status">@for (k of mainStatuses; track k) {<option [value]="k">{{ statuses[k][0] }}</option>}</select></div>
            <div class="field"><label for="sn">Add a note</label><textarea id="sn" class="textarea" rows="3" [(ngModel)]="edit.note"></textarea></div>
            <div class="row"><button class="btn btn-primary btn-sm" type="button" (click)="save()">Save</button><button class="btn btn-ghost btn-sm" type="button" (click)="assignMe()">Assign to me</button></div>
          </fieldset>
        </div>
        <h3 style="margin-top: 14px">Description</h3><p class="keep-lines small">{{ s.message }}</p>
        @if (s.staff_notes) { <h3>Notes</h3><p class="keep-lines small">{{ s.staff_notes }}</p> }
        @if (s.messages?.length) {
          <h3>Conversation @if (s.ticket) { <a class="tiny" routerLink="/admin/support" [queryParams]="{ open: s.ticket.id, department: 'sales' }">({{ s.ticket.reference }})</a> }</h3>
          <ul class="msgs">@for (m of s.messages; track m.id) { <li [class.staff]="m.author_kind === 'staff'" [class.internal]="m.is_internal"><span class="muted tiny">{{ m.author || (m.author_kind === 'staff' ? 'SCHLUSS' : 'Customer') }} · {{ m.created_at | date: 'd MMM, HH:mm' }}@if (m.is_internal) { · internal }</span><br />{{ m.body }}</li> }</ul>
        }
        @if (s.ticket && auth.can('sales.manage')) {
          <div class="field" style="margin-top: 12px"><label for="sr">Reply to the customer (appears in their chat and is emailed)</label><textarea id="sr" class="textarea" rows="3" [(ngModel)]="replyText"></textarea></div>
          <button class="btn btn-ghost btn-sm" type="button" (click)="reply()" [disabled]="!replyText.trim()">Send reply</button>
        }
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="close()">Close</button></div>
      }
    </dialog>
  `,
  styles: STYLES + `.linkbtn { background: none; border: 0; padding: 0; color: var(--link, var(--sch-blue)); cursor: pointer; font: inherit; text-align: left; }`,
})
export class SalesAdminPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected rows = signal<Row[]>([]);
  protected meta = signal<Row | null>(null);
  protected counts = signal<Record<string, number> | null>(null);
  protected s = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  private run = runner(this.err, this.msg);
  protected statuses = SALES_STATUS;
  protected mainStatuses = ['new', 'contacted', 'quoted', 'processing', 'won', 'lost', 'cancelled'];
  protected statusKeys = this.mainStatuses;
  protected sources = SALES_SOURCE;
  protected sourceKeys = Object.keys(SALES_SOURCE);
  protected f = { q: '', status: '', source: '', from: '', to: '' };
  protected edit = { status: 'new', note: '' };
  ngOnInit() {
    void this.load(1);
    const open = Number(this.route.snapshot.queryParamMap.get('open'));
    if (open) void this.open(open);
  }
  setStatus(s: string) {
    this.f.status = this.f.status === s ? '' : s;
    void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page('/sales', { page, perPage: 25, ...this.f });
    this.rows.set(r.data);
    this.meta.set(r.meta);
    this.counts.set(r.counts ?? {});
  }
  async open(id: number) {
    this.err.set(null);
    this.msg.set(null);
    const s = await this.run(() => this.api.get(`/sales/${id}`));
    if (!s) return;
    this.s.set(s);
    this.edit = { status: this.mainStatuses.includes(s.status) ? s.status : 'processing', note: '' };
    this.dlg().nativeElement.showModal();
  }
  close() {
    this.dlg().nativeElement.close();
    void this.router.navigate([], { queryParams: {} });
  }
  async save() {
    const s = this.s();
    if (!s) return;
    if (await this.run(() => this.api.patch(`/sales/${s.id}`, { status: this.edit.status, note: this.edit.note || null }), 'Saved.')) {
      await this.open(s.id);
      this.msg.set('Saved.');
      void this.load(this.meta()?.page ?? 1);
    }
  }
  protected replyText = '';
  async reply() {
    const s = this.s();
    if (!s?.ticket) return;
    if (await this.run(() => this.api.post(`/support/conversations/${s.ticket.id}/messages`, { body: this.replyText }), 'Reply sent.')) {
      this.replyText = '';
      await this.open(s.id);
      this.msg.set('Reply sent.');
    }
  }
  async assignMe() {
    const s = this.s();
    if (s && (await this.run(() => this.api.patch(`/sales/${s.id}`, { assignedTo: this.auth.user()!.id }), 'Assigned to you.'))) void this.load(this.meta()?.page ?? 1);
  }
}

/* =========================================================================================
 * Businesses
 * ========================================================================================= */
@Component({
  selector: 'sch-businesses-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      <div><h1>Businesses</h1><p class="muted">Companies and the customer accounts, demos, packages and sales linked to them.</p></div>
      @if (canEdit()) { <button class="btn btn-primary btn-sm" type="button" (click)="edit(null)">+ Add business</button> }
    </div>
    <div class="adm-filters"><input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Name, registration number or email" aria-label="Search" /></div>
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Business</th><th>Contact</th><th>Customers</th><th>Demos</th><th>Packages</th></tr></thead>
        <tbody>
          @for (b of rows(); track b.id) {
            <tr>
              <td data-label="Business"><button type="button" class="linkbtn" (click)="open(b.id)"><strong>{{ b.name }}</strong></button><br /><span class="muted tiny">{{ b.business_type || '—' }}@if (b.registration_number) { · Reg {{ b.registration_number }} }</span></td>
              <td data-label="Contact">{{ b.email || '—' }}<br /><span class="muted tiny">{{ b.phone || '' }}</span></td>
              <td data-label="Customers">{{ b.customers }}</td><td data-label="Demos">{{ b.demos }}</td><td data-label="Packages">{{ b.packages }}</td>
            </tr>
          } @empty { <tr><td colspan="5" class="empty">No businesses yet.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (meta(); as m) { <div class="pager"><span class="muted">{{ m.total }} business(es)</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="m.page <= 1" (click)="load(m.page - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="m.page * m.perPage >= m.total" (click)="load(m.page + 1)">Next</button></span></div> }

    <dialog #view class="dlg wide">
      @if (b(); as b) {
        <h2>{{ b.name }}</h2>
        <div class="grid2">
          <dl>
            <dt>Registration</dt><dd>{{ b.registration_number || '—' }}</dd><dt>VAT</dt><dd>{{ b.vat_number || '—' }}</dd>
            <dt>Type</dt><dd>{{ b.business_type || '—' }}</dd><dt>Email</dt><dd>{{ b.email || '—' }}</dd><dt>Phone</dt><dd>{{ b.phone || '—' }}</dd>
            <dt>Website</dt><dd>{{ b.website || '—' }}</dd><dt>Region</dt><dd>{{ b.province || '—' }}, {{ b.country }}</dd>
          </dl>
          <div>
            <h3>Customers</h3>
            <ul class="lst">@for (c of b.customers; track c.id) { <li><a [routerLink]="['/admin/customers', c.id]" (click)="viewDlg().nativeElement.close()">{{ c.full_name }}</a> <span class="muted tiny">{{ c.email }} · {{ c.email_verified_at ? 'verified' : 'not verified' }}</span></li> } @empty { <li class="muted">None linked.</li> }</ul>
          </div>
        </div>
        <div class="grid2" style="margin-top: 12px">
          <div><h3>Demos</h3><ul class="lst">@for (d of b.demos; track d.id) { <li>{{ d.product }} – {{ d.full_name }} <span class="muted tiny">{{ d.statusLabel }}@if (d.expires_at) { · {{ d.expires_at | date: 'd MMM y' }} }</span></li> } @empty { <li class="muted">None.</li> }</ul></div>
          <div><h3>Packages & sales</h3><ul class="lst">@for (p of b.packages; track p.id) { <li>{{ p.product }} <span class="muted tiny">{{ p.type }} · {{ p.status }}</span></li> }@for (s of b.sales; track s.id) { <li>Sales enquiry {{ s.reference }} <span class="muted tiny">{{ s.product || '' }} · {{ s.status }}</span></li> }@if (!b.packages.length && !b.sales.length) { <li class="muted">None.</li> }</ul></div>
        </div>
        @if (b.notes) { <h3>Notes</h3><p class="keep-lines small">{{ b.notes }}</p> }
        <div class="actions">@if (canEdit()) { <button class="btn btn-ghost" type="button" (click)="edit(b)">Edit</button> }<button class="btn btn-primary" type="button" (click)="viewDlg().nativeElement.close()">Close</button></div>
      }
    </dialog>

    <dialog #form class="dlg wide">
      <form (ngSubmit)="save()">
        <h2>{{ e.id ? 'Edit business' : 'Add business' }}</h2>
        @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
        <div class="form-row">
          <div class="field"><label for="bn">Business name</label><input id="bn" class="input" name="n" [(ngModel)]="e.name" />@if (fe('name')) {<span class="error">{{ fe('name') }}</span>}</div>
          <div class="field"><label for="br">Registration number</label><input id="br" class="input" name="r" [(ngModel)]="e.registrationNumber" /></div>
          <div class="field"><label for="bv">VAT number</label><input id="bv" class="input" name="v" [(ngModel)]="e.vatNumber" /></div>
          <div class="field"><label for="bt">Business type</label><input id="bt" class="input" name="t" [(ngModel)]="e.businessType" /></div>
          <div class="field"><label for="be">Email</label><input id="be" class="input" type="email" name="e" [(ngModel)]="e.email" />@if (fe('email')) {<span class="error">{{ fe('email') }}</span>}</div>
          <div class="field"><label for="bp">Phone</label><input id="bp" class="input" name="p" [(ngModel)]="e.phone" /></div>
          <div class="field"><label for="bw">Website</label><input id="bw" class="input" name="w" [(ngModel)]="e.website" /></div>
          <div class="field"><label for="bpr">Province</label><input id="bpr" class="input" name="pr" [(ngModel)]="e.province" /></div>
        </div>
        <div class="field"><label for="bno">Notes</label><textarea id="bno" class="textarea" rows="3" name="no" [(ngModel)]="e.notes"></textarea></div>
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="formDlg().nativeElement.close()">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
      </form>
    </dialog>
  `,
  styles: STYLES + `.linkbtn { background: none; border: 0; padding: 0; color: var(--link, var(--sch-blue)); cursor: pointer; font: inherit; text-align: left; }`,
})
export class BusinessesAdminPage implements OnInit {
  private auth = inject(AuthService);
  private api = inject(PlatformApi);
  protected viewDlg = viewChild.required<ElementRef<HTMLDialogElement>>('view');
  protected formDlg = viewChild.required<ElementRef<HTMLDialogElement>>('form');
  protected rows = signal<Row[]>([]);
  protected meta = signal<Row | null>(null);
  protected b = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  private fields = signal<Record<string, string>>({});
  private run = runner(this.err, this.msg, this.fields);
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected canEdit = () => this.auth.can('businesses.manage') || this.auth.can('customers.manage');
  protected q = '';
  protected e: Row = {};
  ngOnInit() {
    void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page('/businesses', { page, perPage: 25, q: this.q });
    this.rows.set(r.data);
    this.meta.set(r.meta);
  }
  async open(id: number) {
    const b = await this.run(() => this.api.get(`/businesses/${id}`));
    if (b) {
      this.b.set(b);
      this.viewDlg().nativeElement.showModal();
    }
  }
  edit(b: Row | null) {
    this.viewDlg().nativeElement.close();
    this.err.set(null);
    this.e = b ? { id: b.id, name: b.name, registrationNumber: b.registration_number ?? '', vatNumber: b.vat_number ?? '', businessType: b.business_type ?? '', email: b.email ?? '', phone: b.phone ?? '', website: b.website ?? '', province: b.province ?? '', notes: b.notes ?? '', country: b.country ?? 'ZA' } : { name: '', country: 'ZA' };
    this.formDlg().nativeElement.showModal();
  }
  async save() {
    const { id, ...body } = this.e;
    const ok = await this.run(() => (id ? this.api.put(`/businesses/${id}`, body) : this.api.post('/businesses', body)), 'Saved.');
    if (ok) {
      this.formDlg().nativeElement.close();
      void this.load(this.meta()?.page ?? 1);
    }
  }
}

/* =========================================================================================
 * WhatsApp support settings
 * ========================================================================================= */
@Component({
  selector: 'sch-whatsapp-settings',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>WhatsApp support settings</h1><p class="muted">Official WhatsApp Business Platform (Cloud API). Website chats are forwarded to your support WhatsApp; replies there appear in the same website chat.</p></div></div>
    @if (d(); as d) {
      <div class="note" [class.ok]="ready()" [class.warn]="!ready()">
        @if (ready()) { <strong>Switched on.</strong> Messages are sent through Meta. Delivery is shown only when Meta confirms it. }
        @else if (!d.settings.enabled) { <strong>Switched off.</strong> The website chat works normally; nothing is sent to WhatsApp. }
        @else { <strong>Not ready.</strong> Add the Phone number ID and access token, then test the connection. }
      </div>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      <form class="card" (ngSubmit)="save()">
        <fieldset [disabled]="!d.canManage">
          <label class="check"><input type="checkbox" name="en" [(ngModel)]="s.enabled" /><span><strong>Enable WhatsApp support</strong></span></label>
          <div class="form-row">
            <div class="field"><label for="wn">Business WhatsApp number (display)</label><input id="wn" class="input" name="dn" [(ngModel)]="s.displayNumber" placeholder="+27 …" /></div>
            <div class="field"><label for="wp">Phone number ID</label><input id="wp" class="input" name="pn" [(ngModel)]="s.phoneNumberId" inputmode="numeric" />@if (fe('phoneNumberId')) {<span class="error">{{ fe('phoneNumberId') }}</span>}<span class="hint">Meta › WhatsApp › API setup</span></div>
            <div class="field"><label for="wb">WhatsApp Business Account ID</label><input id="wb" class="input" name="ba" [(ngModel)]="s.businessAccountId" inputmode="numeric" /></div>
            <div class="field"><label for="wv">Graph API version</label><input id="wv" class="input" name="av" [(ngModel)]="s.apiVersion" /></div>
          </div>
          <h3>Credentials <span class="muted small">(stored encrypted; never shown again)</span></h3>
          <div class="form-row">
            <div class="field secret"><label for="wt">Access token (System User, permanent)</label><input id="wt" class="input" type="password" name="at" [(ngModel)]="secrets.accessToken" autocomplete="off" [placeholder]="ph(d.secrets.accessToken)" /></div>
            <div class="field secret"><label for="was">App secret (webhook signatures)</label><input id="was" class="input" type="password" name="as" [(ngModel)]="secrets.appSecret" autocomplete="off" [placeholder]="ph(d.secrets.appSecret)" /></div>
            <div class="field secret"><label for="wvt">Webhook verify token</label><input id="wvt" class="input" type="password" name="vt" [(ngModel)]="secrets.verifyToken" autocomplete="off" [placeholder]="ph(d.secrets.verifyToken)" /><span class="hint">Any long random text – enter the same value in Meta.</span></div>
          </div>
          <h3>Support agents' WhatsApp numbers</h3>
          <p class="muted small">New website chats are forwarded to these numbers. Agents reply by swiping to reply on the forwarded message (or by starting with the chat reference). Send <code>/resolve</code> to resolve a chat.</p>
          @for (a of s.agents; track $index) {
            <div class="row"><input class="input" [name]="'an' + $index" [(ngModel)]="a.name" placeholder="Agent name" [attr.aria-label]="'Agent ' + ($index + 1) + ' name'" style="max-width: 200px" /><input class="input" [name]="'aw' + $index" [(ngModel)]="a.number" placeholder="+27 82 …" [attr.aria-label]="'Agent ' + ($index + 1) + ' WhatsApp number'" style="max-width: 200px" /><button type="button" class="btn btn-ghost btn-sm" (click)="s.agents.splice($index, 1)">Remove</button></div>
          }
          <button type="button" class="btn btn-ghost btn-sm" (click)="s.agents.push({ name: '', number: '' })">+ Add agent number</button>
          <h3 style="margin-top: 14px">Message template (outside the 24-hour window)</h3>
          <p class="muted small">WhatsApp only allows free text within 24 hours of the recipient's last message. Otherwise an approved template is used, with 3 body parameters: reference, customer name, message.</p>
          <div class="form-row">
            <div class="field"><label for="tn">Approved template name</label><input id="tn" class="input" name="tn" [(ngModel)]="s.templateName" placeholder="e.g. support_chat_forward" /></div>
            <div class="field"><label for="tl">Template language</label><input id="tl" class="input" name="tl" [(ngModel)]="s.templateLanguage" placeholder="en" /></div>
          </div>
          <div class="actions"><button class="btn btn-primary" type="submit">Save settings</button></div>
        </fieldset>
      </form>
      <div class="grid2">
        <section class="card">
          <h2>Webhook</h2>
          <p class="small">In Meta › WhatsApp › Configuration, set the callback URL and verify token, then subscribe to <strong>messages</strong>.</p>
          <dl><dt>Callback URL</dt><dd class="cv">{{ d.webhookUrl }}</dd></dl>
          @if (d.canManage) {
            <div class="row" style="margin-top: 12px">
              <button class="btn btn-ghost btn-sm" type="button" (click)="test()">Test connection</button>
              <input class="input" [(ngModel)]="testTo" placeholder="Send a test message to +27…" style="max-width: 220px" aria-label="Test number" />
              <button class="btn btn-ghost btn-sm" type="button" (click)="testMessage()" [disabled]="!testTo">Send test</button>
            </div>
          }
          @if (d.events.length) {
            <h3 style="margin-top: 12px">Recent webhook calls</h3>
            <ul class="lst">@for (e of d.events; track e.id) { <li class="small">{{ e.created_at | date: 'd MMM, HH:mm:ss' }} · {{ e.kind }} · {{ e.signature_valid ? 'signature OK' : 'rejected' }}@if (e.error) { · <span class="error">{{ e.error }}</span> }</li> }</ul>
          }
        </section>
        <section class="card">
          <h2>Recent WhatsApp messages</h2>
          <ul class="lst">@for (m of d.recent; track m.id) { <li class="small">{{ m.direction === 'out' ? '→' : '←' }} +{{ m.peer_phone }} @if (m.reference) { · {{ m.reference }} } · <span [class]="'badge ' + stCls(m.status)">{{ m.status }}</span> <span class="muted tiny">{{ m.created_at | date: 'd MMM, HH:mm' }}</span>@if (m.error) { <br /><span class="error tiny">{{ m.error }}</span> }</li> } @empty { <li class="muted">None yet.</li> }</ul>
        </section>
      </div>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES + `h3 { margin-top: 14px; } .card fieldset > .row { margin-bottom: 8px; }`,
})
export class WhatsAppSettingsPage implements OnInit {
  private api = inject(PlatformApi);
  protected d = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  private fields = signal<Record<string, string>>({});
  private run = runner(this.err, this.msg, this.fields);
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected s: Row = { agents: [] };
  protected secrets = { accessToken: '', appSecret: '', verifyToken: '' };
  protected testTo = '';
  protected ph = (st: string) => (st === 'env' ? 'Set in .env (server)' : st === 'set' ? '•••••••• saved – type to replace' : 'Not set');
  protected ready = () => !!(this.d()?.settings.enabled && this.d()?.settings.phoneNumberId && this.d()?.secrets.accessToken !== 'missing');
  protected stCls = (s: string) => (s === 'failed' ? 'badge-danger' : s === 'read' || s === 'delivered' || s === 'received' ? 'badge-ok' : 'badge-muted');
  ngOnInit() {
    void this.load();
  }
  async load() {
    const d = await this.run(() => this.api.get('/whatsapp'));
    if (d) {
      this.d.set(d);
      this.s = structuredClone(d.settings);
      this.s.agents ??= [];
    }
  }
  async save() {
    const body = { ...this.s, agents: this.s.agents.filter((a: Row) => a.number?.trim()), ...Object.fromEntries(Object.entries(this.secrets).filter(([, v]) => v)) };
    if (await this.run(() => this.api.put('/whatsapp', body), 'WhatsApp settings saved.')) {
      this.secrets = { accessToken: '', appSecret: '', verifyToken: '' };
      const m = this.msg();
      await this.load();
      this.msg.set(m);
    }
  }
  async test() {
    const r = await this.run(() => this.api.post('/whatsapp/test'));
    if (r) (r.ok ? this.msg : this.err).set(r.message);
  }
  async testMessage() {
    const r = await this.run(() => this.api.post('/whatsapp/test-message', { to: this.testTo }));
    if (r) {
      if (r.ok) this.msg.set(r.note);
      else this.err.set(r.error ?? 'Not sent.');
      void this.load();
    }
  }
}

/* =========================================================================================
 * Email settings
 * ========================================================================================= */
@Component({
  selector: 'sch-email-settings',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Email settings</h1><p class="muted">Where the team’s notification emails are sent. Support receives technical, general, chatbot, installation and demo questions plus potential leads. Choose below which department receives business partner registrations and purchase / quotation enquiries.</p></div></div>
    @if (d(); as d) {
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      <div class="grid2">
        <form class="card" (ngSubmit)="save()">
          <h2>Department addresses</h2>
          <div class="field"><label for="es">Support department</label><input id="es" class="input" type="email" name="s" [(ngModel)]="f.support" />@if (fe('support')) {<span class="error">{{ fe('support') }}</span>}</div>
          <div class="field"><label for="esa">Sales department</label><input id="esa" class="input" type="email" name="sa" [(ngModel)]="f.sales" />@if (fe('sales')) {<span class="error">{{ fe('sales') }}</span>}</div>
          <div class="field"><label for="epi">Business partner registrations go to</label><select id="epi" class="select" name="pi" [(ngModel)]="f.partnerInbox"><option value="sales">Sales department</option><option value="support">Support department</option></select></div>
          <div class="field"><label for="epu">Purchase and quotation enquiries go to</label><select id="epu" class="select" name="pu" [(ngModel)]="f.purchaseInbox"><option value="support">Support department</option><option value="sales">Sales department</option></select></div>
          <p class="muted tiny">Everything else (support and contact messages, demo requests, potential leads, system alerts) always goes to the support department.</p>
          <label class="check"><input type="checkbox" name="ack" [(ngModel)]="f.customerAck" /><span>Send customers a “we received your enquiry” email</span></label>
          <div class="row" style="margin-top: 12px"><button class="btn btn-primary btn-sm" type="submit">Save</button><button class="btn btn-ghost btn-sm" type="button" (click)="test('support')">Send test to support</button><button class="btn btn-ghost btn-sm" type="button" (click)="test('sales')">Send test to sales</button></div>
        </form>
        <section class="card">
          <h2>Mail server</h2>
          <div class="note" [class.ok]="d.smtp.configured" [class.warn]="!d.smtp.configured">{{ d.smtp.configured ? 'SMTP is configured on the server.' : 'MAIL_HOST is empty in the server .env – emails are queued but cannot be sent until it is set.' }}</div>
          <dl style="margin-top: 10px">
            <dt>Host</dt><dd>{{ d.smtp.host || '—' }}:{{ d.smtp.port }}</dd>
            <dt>Support mailbox</dt><dd>{{ d.accounts.support.user || '—' }} · password {{ d.accounts.support.passwordSet ? 'set' : 'missing' }}<br /><span class="muted tiny">Sends as {{ d.accounts.support.from }} – verification codes, customer emails, enquiries, alerts</span></dd>
            <dt>Sales mailbox</dt><dd>@if (d.accounts.sales.separate) { {{ d.accounts.sales.user }} · password {{ d.accounts.sales.passwordSet ? 'set' : 'missing' }} } @else { Not set separately – partner emails use the support mailbox }<br /><span class="muted tiny">Sends as {{ d.accounts.sales.from }} – business partner emails</span></dd>
            <dt>Last 7 days</dt><dd>{{ d.last7days['sent'] ?? 0 }} sent · {{ d.last7days['queued'] ?? 0 }} queued · {{ d.last7days['failed'] ?? 0 }} failed</dd>
          </dl>
          <p class="muted tiny">SMTP credentials are only read from the server’s .env file – they are never stored in the database or shown here.</p>
          <h3 style="margin: 14px 0 6px; font-size: 15px">Check the mail server now</h3>
          <p class="muted tiny" style="margin: 0 0 8px">Connects and logs in to each mailbox straight away and tells you exactly what is wrong, if anything. Add an address to also send one test email immediately.</p>
          <div class="row"><input class="input" style="flex: 1 1 200px" type="email" name="ct" [(ngModel)]="checkTo" placeholder="Send a test to (optional)" aria-label="Send a test email to" /><button class="btn btn-primary btn-sm" type="button" (click)="check()" [disabled]="checking()">{{ checking() ? 'Checking… (up to a minute)' : 'Check mail server now' }}</button></div>
          @if (res(); as r) {
            <div class="note" [class.ok]="r.ok" [class.warn]="!r.ok" style="margin-top: 10px" role="status">
              <strong>{{ r.ok ? 'Everything works – the website can send email.' : 'There is a problem – see the ✗ line below.' }}</strong>
              <ul style="margin: 6px 0 0; padding-left: 18px">
                @for (s of r.steps; track s.name) { @if (!s.ok || r.ok) { <li>{{ s.ok ? '✓' : '✗' }} {{ s.name }}: {{ s.text }}</li> } }
                @for (b of r.mailboxes; track b.key) { <li>{{ b.ok ? '✓' : '✗' }} {{ b.label }} ({{ b.user || 'not set' }}): {{ b.text }}</li> }
                @if (r.sent; as t) { <li>{{ t.ok ? '✓' : '✗' }} Test email: {{ t.text }}</li> }
              </ul>
            </div>
          }
        </section>
      </div>
      <section class="card">
        <h2>Latest emails</h2>
        <p class="muted tiny" style="margin-top: -4px">Every email the website has queued, newest first. “Sent” means the mail server accepted it – if the person can’t find it, it is in their Spam/Junk or Promotions folder.</p>
        <div class="row" style="margin: 8px 0 10px; align-items: center">
          <span class="small"><strong>{{ d.queue.waiting }}</strong> waiting · <strong>{{ d.queue.sending }}</strong> being sent</span>
          <span class="small muted">Automatic sender: @if (!d.queue.sender.enabled) { switched off (AUTO_SEND_EMAIL=off) } @else if (d.queue.sender.lastRunAt) { last ran {{ d.queue.sender.lastRunAt | date: 'd MMM, HH:mm:ss' }} – {{ d.queue.sender.lastOk ? 'OK' : 'failed' }} } @else { on – nothing has needed sending since the website started }</span>
          <button class="btn btn-ghost btn-sm" type="button" (click)="sendNow()" [disabled]="sending()">{{ sending() ? 'Sending…' : 'Send waiting emails now' }}</button>
          <button class="btn btn-ghost btn-sm" type="button" (click)="load()">Refresh</button>
        </div>
        @if (d.queue.sender.lastOk === false && d.queue.sender.lastOutput) { <div class="note warn" role="alert" style="margin-bottom: 10px; white-space: pre-wrap"><strong>The automatic email sender stopped with an error:</strong><br />{{ d.queue.sender.lastOutput }}</div> }
        <div class="table-wrap"><table class="table stack">
          <thead><tr><th>Queued</th><th>To</th><th>Email</th><th>Status</th></tr></thead>
          <tbody>@for (l of d.recent; track l.id) { <tr><td data-label="Queued">{{ l.created_at | date: 'd MMM, HH:mm:ss' }}</td><td data-label="To">{{ l.to_email }}</td><td data-label="Email">{{ l.template_key }}</td><td data-label="Status">@if (l.status === 'sent') { <span class="badge badge-ok">Sent {{ l.sent_at | date: 'HH:mm:ss' }}</span> } @else if (l.status === 'failed') { <span class="badge badge-danger">Failed</span> } @else if (l.error) { <span class="badge badge-warn">Retrying</span> } @else { <span class="badge badge-muted">Waiting</span> }</td></tr> } @empty { <tr><td colspan="4" class="empty">No emails yet.</td></tr> }</tbody>
        </table></div>
      </section>
      <section class="card">
        <h2>Emails with problems</h2>
        <div class="table-wrap"><table class="table stack">
          <thead><tr><th>When</th><th>To</th><th>Email</th><th>Error</th></tr></thead>
          <tbody>@for (l of d.failed; track l.id) { <tr><td data-label="When">{{ l.created_at | date: 'd MMM, HH:mm' }}</td><td data-label="To">{{ l.to_email }}</td><td data-label="Email">{{ l.template_key }}</td><td data-label="Error" class="small">@if (l.status === 'queued') { <strong>Will be tried again.</strong> } {{ l.error }}</td></tr> } @empty { <tr><td colspan="4" class="empty">No failed emails.</td></tr> }</tbody>
        </table></div>
      </section>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES,
})
export class EmailSettingsPage implements OnInit {
  private api = inject(PlatformApi);
  protected d = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  private fields = signal<Record<string, string>>({});
  private run = runner(this.err, this.msg, this.fields);
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected f = { support: '', sales: '', customerAck: true, partnerInbox: 'sales', purchaseInbox: 'support' };
  protected sending = signal(false);
  async sendNow() {
    this.sending.set(true);
    const r = await this.run(() => this.api.post('/email-settings/send-now', {}));
    this.sending.set(false);
    await this.load();
    if (r) this.msg.set(r.sender.lastOk === false ? 'The email sender reported an error – see “Latest emails” below.' : r.waiting ? `${r.waiting} email(s) are still waiting (they will be retried).` : 'All waiting emails have been handled – see “Latest emails” below.');
  }
  protected checkTo = '';
  protected checking = signal(false);
  protected res = signal<Row | null>(null);
  async check() {
    this.checking.set(true);
    this.res.set(null);
    const r = await this.run(() => this.api.post('/email-settings/check', { sendTo: this.checkTo.trim() }));
    this.checking.set(false);
    if (r) this.res.set(r);
    void this.load();
  }
  ngOnInit() {
    void this.load();
  }
  async load() {
    const d = await this.run(() => this.api.get('/email-settings'));
    if (d) {
      this.d.set(d);
      this.f = { ...d.departments };
    }
  }
  async save() {
    if (await this.run(() => this.api.put('/email-settings', this.f), 'Email settings saved.')) await this.load().then(() => this.msg.set('Email settings saved.'));
  }
  async test(department: 'support' | 'sales') {
    const r = await this.run(() => this.api.post('/email-settings/test', { department }));
    if (r) this.msg.set(`${r.message} (to ${r.to})`);
  }
}

/* =========================================================================================
 * Reports
 * ========================================================================================= */
@Component({
  selector: 'sch-reports',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Reports</h1><p class="muted">Registrations, demos, downloads, conversations, leads and sales for a date range.</p></div></div>
    <div class="adm-filters"><input class="input" type="date" [(ngModel)]="from" aria-label="From" /><input class="input" type="date" [(ngModel)]="to" aria-label="To" /><button class="btn btn-primary btn-sm" type="button" (click)="load()">Update</button></div>
    @if (r(); as r) {
      <div class="kpis">
        @for (k of kpis; track k[0]) { <div class="kpi" [style.--c]="k[2]"><span class="v">{{ r[k[0]] }}</span><span class="l">{{ k[1] }}</span></div> }
      </div>
      <div class="grid2">
        @for (g of groups; track g[0]) {
          <section class="card"><h2>{{ g[1] }}</h2><dl>@for (e of entries(r[g[0]]); track e[0]) { <dt>{{ label(e[0]) }}</dt><dd>{{ e[1] }}</dd> } @empty { <dt class="muted">No data</dt><dd></dd> }</dl></section>
        }
      </div>
    }
    @if (auth.can('reports.export')) {
      <section class="card" style="margin-top: 14px"><h2>Export (CSV)</h2><div class="row">
        @for (x of exports; track x[0]) { @if (auth.can(x[2])) { <a class="btn btn-ghost btn-sm" [href]="'/api/admin/reports/export/' + x[0]" download>{{ x[1] }}</a> } }
      </div></section>
    }
  `,
  styles: STYLES + `.kpi { cursor: default; }`,
})
export class ReportsPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  protected r = signal<Row | null>(null);
  protected from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  protected to = new Date().toISOString().slice(0, 10);
  protected kpis = [['registrations', 'Registrations', '#3282F6'], ['verified', 'Emails verified', '#14C2B0'], ['demosStarted', 'Demos started', '#7B5CFF'], ['demoDownloads', 'Demo downloads', '#F5A524'], ['fullDownloads', 'Full installer downloads', '#E7458C'], ['conversions', 'Demo → licence', '#22a06b']];
  protected groups = [['conversationsBySource', 'Conversations by source'], ['conversationsByDepartment', 'Conversations by department'], ['leadsByStatus', 'Leads by status'], ['salesByStatus', 'Sales enquiries by status']];
  protected exports = [['leads', 'Potential leads', 'leads.view'], ['sales', 'Sales enquiries', 'sales.view'], ['conversations', 'Conversations', 'support.view'], ['customers', 'Customers', 'customers.view']];
  private LABELS: Record<string, string> = { chat: 'Website chat', form: 'Contact form', whatsapp: 'WhatsApp', support: 'Support', sales: 'Sales', ...Object.fromEntries(Object.entries(LEAD_STATUS).map(([k, v]) => [k, v[0]])), ...Object.fromEntries(Object.entries(SALES_STATUS).map(([k, v]) => [k, v[0]])) };
  protected label = (k: string) => this.LABELS[k] ?? k;
  protected entries = (o: Record<string, number> | undefined) => Object.entries(o ?? {});
  ngOnInit() {
    void this.load();
  }
  async load() {
    this.r.set(await this.api.get('/reports', { from: this.from, to: this.to }));
  }
}

/* =========================================================================================
 * System settings (status)
 * ========================================================================================= */
@Component({
  selector: 'sch-system',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>System settings</h1><p class="muted">Status of the services the website depends on. Secrets live in the server’s .env file.</p></div></div>
    @if (d(); as d) {
      <div class="grid2">
        <section class="card"><h2>Email</h2>
          <div class="note" [class.ok]="d.mail.configured" [class.warn]="!d.mail.configured">{{ d.mail.configured ? 'Mail server configured.' : 'MAIL_HOST not set – emails cannot be sent.' }}</div>
          <dl style="margin-top: 10px"><dt>Support</dt><dd>{{ d.mail.departments.support }}</dd><dt>Sales</dt><dd>{{ d.mail.departments.sales }}</dd></dl>
          <a routerLink="/admin/email-settings" class="btn btn-ghost btn-sm" style="margin-top: 10px">Email settings</a>
        </section>
        <section class="card"><h2>Backups</h2>
          <div class="note" [class.ok]="d.backups.newest && d.backups.state.lastOk !== false" [class.warn]="!d.backups.newest || d.backups.state.lastOk === false">{{ d.backups.newest ? 'Latest backup: ' + (d.backups.newest.at | date: 'd MMM y, HH:mm') : 'No backup has been made yet.' }}@if (d.backups.state.lastOk === false) { – the last attempt failed }</div>
          <dl style="margin-top: 10px">
            <dt>Automatic daily backup</dt><dd>{{ d.backups.automatic ? 'On – every day, verified, kept ' + d.backups.keepDays + ' days' : 'Off on this computer (it is on automatically on the live server)' }}</dd>
            <dt>Backups kept</dt><dd>{{ d.backups.count }}</dd>
            <dt>Folder</dt><dd class="small">{{ d.backups.folder }}</dd>
            @if (d.backups.state.lastMessage) { <dt>Last run</dt><dd class="small">{{ d.backups.state.lastMessage }}</dd> }
          </dl>
          <button class="btn btn-ghost btn-sm" type="button" style="margin-top: 10px" (click)="backupNow()" [disabled]="backingUp()">{{ backingUp() ? 'Backing up…' : 'Back up now' }}</button>
          <p class="muted tiny">A backup on the same server does not protect against losing the server. Copy the backup folder somewhere else regularly (or use your host’s backup service).</p>
        </section>
        <section class="card"><h2>Background worker</h2>
          <dl><dt>Pending jobs</dt><dd>{{ d.worker.jobs['pending'] ?? 0 }}@if (d.worker.oldestPending) { (oldest {{ d.worker.oldestPending | date: 'd MMM, HH:mm' }}) }</dd><dt>Failed jobs</dt><dd>{{ d.worker.jobs['failed'] ?? 0 }}</dd><dt>Done</dt><dd>{{ d.worker.jobs['done'] ?? 0 }}</dd></dl>
          <p class="muted tiny">{{ d.worker.note }}</p>
        </section>
        <section class="card"><h2>WhatsApp</h2>
          <div class="note" [class.ok]="d.whatsapp.ready" [class.warn]="d.whatsapp.enabled && !d.whatsapp.ready">{{ d.whatsapp.ready ? 'Connected settings present.' : d.whatsapp.enabled ? 'Enabled but not fully configured.' : 'Switched off.' }}</div>
          <dl style="margin-top: 10px"><dt>Agent numbers</dt><dd>{{ d.whatsapp.agents }}</dd></dl>
          <a routerLink="/admin/whatsapp" class="btn btn-ghost btn-sm" style="margin-top: 10px">WhatsApp settings</a>
        </section>
        <section class="card"><h2>Uploads & malware scanning</h2>
          <dl><dt>Scanner</dt><dd>{{ d.scanner.available ? d.scanner.command : 'Not installed (ClamAV recommended)' }}</dd><dt>Scanning required</dt><dd>{{ d.scanner.required ? 'Yes – uploads rejected without a scan' : 'No' }}</dd><dt>Max upload</dt><dd>{{ d.uploads.maxMb }} MB</dd><dt>Storage</dt><dd class="cv">{{ d.uploads.storage }}</dd></dl>
        </section>
        <section class="card"><h2>Security</h2>
          <dl><dt>Verification code</dt><dd>{{ d.security.otpMinutes }} min, {{ d.security.otpMaxAttempts }} attempts, resend every {{ d.security.otpResendCooldownSeconds }} s</dd><dt>Session length</dt><dd>{{ d.security.sessionHours }} h</dd><dt>Environment</dt><dd>{{ d.environment }} · {{ d.appUrl }}</dd></dl>
        </section>
      </div>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES,
})
export class SystemPage implements OnInit {
  private api = inject(PlatformApi);
  protected d = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected backingUp = signal(false);
  ngOnInit() {
    this.api.get('/system').then((d) => this.d.set(d)).catch((e) => this.err.set(toApiError(e).message));
  }
  async backupNow() {
    this.backingUp.set(true);
    try {
      await this.api.post('/system/backup', {});
      this.d.set(await this.api.get('/system'));
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.backingUp.set(false);
    }
  }
}

/* =========================================================================================
 * Product downloads overview
 * ========================================================================================= */
@Component({
  selector: 'sch-product-downloads',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Product downloads</h1><p class="muted">Each product’s full installer and separate demo installer. Upload files in the product editor (tabs “Full installer” and “Demo files”).</p></div></div>
    @if (d(); as d) {
      <div class="table-wrap"><table class="table stack">
        <thead><tr><th>Product</th><th>Full installer</th><th>Demo installer</th><th>Downloads (30 days)</th><th></th></tr></thead>
        <tbody>
          @for (p of d.products; track p.id) {
            <tr>
              <td data-label="Product"><strong>{{ p.name }}</strong>@if (!p.published) { <span class="badge badge-muted">Unpublished</span> }</td>
              <td data-label="Full installer">@if (p.full; as f) { v{{ f.version }} · {{ f.files }} file(s)@if (f.bytes) { · {{ size(f.bytes) }} }<br /><span class="muted tiny">{{ f.releaseDate | date: 'd MMM y' }} · {{ access[p.fullAccess] }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
              <td data-label="Demo installer">@if (p.demo; as f) { v{{ f.version }} · {{ f.files }} file(s)@if (f.bytes) { · {{ size(f.bytes) }} }<br /><span class="muted tiny">{{ f.releaseDate | date: 'd MMM y' }}</span> } @else { <span class="muted">Not uploaded</span> }</td>
              <td data-label="Downloads">{{ p.fullDownloads30 }} full · {{ p.demoDownloads30 }} demo</td>
              <td data-label=""><a class="btn btn-ghost btn-sm" [routerLink]="['/admin/products', p.id]">Manage files</a></td>
            </tr>
          }
        </tbody>
      </table></div>
      <section class="card" style="margin-top: 14px"><h2>Recent downloads</h2>
        <ul class="lst">@for (r of d.recent; track r.id) { <li class="small">{{ r.created_at | date: 'd MMM, HH:mm' }} · {{ r.product }} {{ r.channel === 'release' ? 'full' : 'demo' }} v{{ r.version }} · @if (r.customer_id) { <a [routerLink]="['/admin/customers', r.customer_id]">{{ r.full_name }}</a> } @else { — } <span class="muted">({{ r.status }})</span></li> } @empty { <li class="muted">No downloads yet.</li> }</ul>
      </section>
    } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES,
})
export class ProductDownloadsPage implements OnInit {
  private api = inject(PlatformApi);
  protected d = signal<Row | null>(null);
  protected size = fileSize;
  protected access: Record<string, string> = { licensed: 'licensed customers', registered: 'any verified customer', off: 'not offered online' };
  ngOnInit() {
    void this.api.get('/product-downloads').then((d) => this.d.set(d));
  }
}

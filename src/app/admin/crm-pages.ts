import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, toApiError } from '../core/auth.service';
import { CatalogueApi, ProductRow } from './catalogue-api';
import { CHAT_STATUS, DEMO_STATUS, PlatformApi, Row } from './platform-api';

const STYLES = `
  h1 { font-size: 28px; } h2 { font-size: 18px; margin: 0 0 10px; }
  .kpis { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); margin: 16px 0; }
  .kpi { display: grid; gap: 2px; padding: 14px; border-radius: var(--r); border: 1px solid var(--line); background: #fff; text-decoration: none !important; color: var(--fg); border-top: 3px solid var(--c, var(--sch-blue)); cursor: pointer; text-align: left; font: inherit; }
  .kpi:hover { box-shadow: 0 10px 22px -16px var(--c, var(--sch-blue)); }
  .kpi .v { font: 700 28px var(--f-head); color: var(--heading); font-variant-numeric: tabular-nums; }
  .kpi .l { font-size: 13px; color: var(--muted); }
  .cols { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin: 14px 0; }
  .bars { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .bars li { display: grid; grid-template-columns: minmax(90px, 150px) 1fr; gap: 4px 10px; align-items: center; font-size: 13px; }
  .bars .num { grid-column: 2; font-size: 12px; }
  .bars .track { height: 10px; border-radius: 6px; background: var(--surface-2, #eef1f5); overflow: hidden; }
  .bars .fill { display: block; height: 100%; border-radius: 6px; background: var(--sch-blue); }
  .bars .num { font-variant-numeric: tabular-nums; color: var(--muted); }
  .tiny { font-size: 12px; } .small { font-size: 13px; }
  .lst { list-style: none; padding: 0; margin: 0; } .lst li { padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; } .lst li:first-child { border-top: 0; }
  .grid2 { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  .card + .card { margin-top: 14px; }
  .timeline { list-style: none; padding: 0; margin: 0; font-size: 13px; } .timeline li { padding: 6px 0 6px 14px; border-left: 2px solid var(--line); position: relative; }
  .timeline li::before { content: ''; position: absolute; left: -5px; top: 11px; width: 8px; height: 8px; border-radius: 50%; background: var(--sch-blue); }
`;

/* =========================================================================================
 * Demos dashboard (+ list with filters, notification settings)
 * ========================================================================================= */
@Component({
  selector: 'sch-demos-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      <div><h1>Demos</h1><p class="muted">Every customer demo, from download to activation, expiry and conversion. Dates are controlled centrally by the server.</p></div>
      @if (auth.can('licences.manage')) { <div class="row-actions"><button class="btn btn-ghost btn-sm" type="button" (click)="runChecks()">Check expiries now</button><button class="btn btn-ghost btn-sm" type="button" (click)="openSettings()">Notification settings</button></div> }
    </div>
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    @if (sum(); as s) {
      <div class="kpis">
        @for (k of kpis; track k.key) {
          <button type="button" class="kpi" [style.--c]="k.c" (click)="filter(k.status)"><span class="v">{{ s['kpis'][k.key] ?? 0 }}</span><span class="l">{{ k.label }}</span></button>
        }
      </div>
      <div class="cols">
        <section class="card"><h2>Demos by product</h2>
          <ul class="bars">@for (p of s['byProduct']; track p['id']) {
            <li><a [routerLink]="[]" [queryParams]="{ productId: p['id'] }" (click)="productId = p['id']; load(1)">{{ p['name'] }}</a><span class="track"><span class="fill" [style.width.%]="pct(p['demos'], maxProduct())"></span></span><span class="num">{{ p['demos'] }} · {{ p['activated'] }} activated · {{ p['converted'] }} converted</span></li>
          } @empty { <li class="muted">No demos yet.</li> }</ul>
        </section>
        <section class="card"><h2>Recent demo downloads</h2>
          <ul class="lst">@for (d of s['recentDownloads']; track d['id']) { <li>@if (d['licence_id']) {<a [routerLink]="['/admin/demos', d['licence_id']]">{{ d['full_name'] }}</a>} @else {{{ d['full_name'] }}}@if (d['company']) {<span class="muted"> · {{ d['company'] }}</span>} <span class="muted tiny">– {{ d['product'] }} {{ d['version'] }} · {{ d['created_at'] | date: 'd MMM, HH:mm' }}</span></li> } @empty { <li class="muted">None yet.</li> }</ul>
        </section>
        <section class="card"><h2>Recent customer registrations</h2>
          <ul class="lst">@for (c of s['recentCustomers']; track c['id']) { <li><a [routerLink]="['/admin/customers', c['id']]">{{ c['full_name'] }}</a>@if (c['company']) {<span class="muted"> · {{ c['company'] }}</span>} <span class="muted tiny">– {{ c['created_at'] | date: 'd MMM y' }}</span></li> } @empty { <li class="muted">None yet.</li> }</ul>
        </section>
      </div>
    }

    <h2 id="list">Demo records</h2>
    <div class="adm-filters">
      <input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Customer, company, email or licence key" aria-label="Search" />
      <select class="select" [(ngModel)]="status" (change)="load(1)" aria-label="Status"><option value="">All statuses</option>@for (k of statusKeys; track k) {<option [value]="k">{{ labels[k][0] }}</option>}</select>
      <select class="select" [(ngModel)]="productId" (change)="load(1)" aria-label="Product"><option [ngValue]="null">All products</option>@for (p of products(); track p.id) {<option [ngValue]="p.id">{{ p.name }}</option>}</select>
      <select class="select" [(ngModel)]="partnerId" (change)="load(1)" aria-label="Partner"><option [ngValue]="null">Any partner</option>@for (p of partners(); track p['id']) {<option [ngValue]="p['id']">{{ p['name'] }}</option>}</select>
      <select class="select" [(ngModel)]="dateField" aria-label="Date to filter"><option value="created">Created</option><option value="download">Download date</option><option value="activation">Activation date</option><option value="expiry">Expiry date</option></select>
      <input class="input" type="date" [(ngModel)]="from" (change)="load(1)" aria-label="From" />
      <input class="input" type="date" [(ngModel)]="to" (change)="load(1)" aria-label="To" />
      <button class="btn btn-ghost btn-sm" type="button" (click)="reset()">Clear</button>
    </div>
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Customer</th><th>Product</th><th>Status</th><th>Downloaded</th><th>Activated</th><th>Expires</th><th>Partner</th></tr></thead>
        <tbody>
          @for (r of rows(); track r['id']) {
            <tr>
              <td data-label="Customer"><a [routerLink]="['/admin/demos', r['id']]"><strong>{{ r['full_name'] }}</strong></a><br /><span class="muted tiny">{{ r['company'] || '—' }} · {{ r['email'] }}</span></td>
              <td data-label="Product">{{ r['product'] }}@if (r['version']) { <span class="muted tiny">v{{ r['version'] }}</span> }</td>
              <td data-label="Status"><span class="badge" [class]="'badge ' + labels[r['status']][1]">{{ labels[r['status']][0] }}</span></td>
              <td data-label="Downloaded">{{ (r['first_downloaded_at'] | date: 'd MMM y') ?? '–' }}</td>
              <td data-label="Activated">{{ (r['activated_at'] | date: 'd MMM y') ?? '–' }}</td>
              <td data-label="Expires">{{ (r['expires_at'] | date: 'd MMM y') ?? (r['start_on'] === 'activation' ? 'At activation +' + r['duration_days'] + 'd' : '–') }}</td>
              <td data-label="Partner">{{ r['partner'] ?? '–' }}</td>
            </tr>
          } @empty { <tr><td colspan="7" class="empty">No demos match.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (meta(); as m) { <div class="pager"><span class="muted">{{ m['total'] }} demo(s)</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="m['page'] <= 1" (click)="load(m['page'] - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="m['page'] * m['perPage'] >= m['total']" (click)="load(m['page'] + 1)">Next</button></span></div> }

    <dialog #sdlg class="dlg">
      <form (ngSubmit)="saveSettings()">
        <h2>Demo expiry notifications</h2>
        @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
        <div class="field"><label for="ad">Notify administrators (days before expiry)</label><input id="ad" class="input" name="ad" [(ngModel)]="ns.admin" placeholder="7, 3, 1, 0" /><span class="hint">Comma-separated. 0 = on the expiry date. Each milestone is sent once per demo.</span></div>
        <div class="field"><label for="cd">Notify customers (days before expiry)</label><input id="cd" class="input" name="cd" [(ngModel)]="ns.customer" placeholder="7, 3, 1, 0" /></div>
        <div class="field"><label for="sd">“Expiring soon” status starts (days before)</label><input id="sd" class="input" type="number" min="1" max="60" name="sd" [(ngModel)]="ns.soonDays" /></div>
        <label class="check"><input type="checkbox" name="ne" [(ngModel)]="ns.notifyExpired" /><span>Also notify when a demo has expired</span></label>
        <label class="check"><input type="checkbox" name="ea" [(ngModel)]="ns.emailAdmins" /><span>Email administrators too (to the admin notification address)</span></label>
        <label class="check"><input type="checkbox" name="ec" [(ngModel)]="ns.emailCustomers" /><span>Email customers too</span></label>
        <p class="muted small">Notifications always appear in the admin portal (Notifications). Checks run automatically every 10 minutes.</p>
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="sdlg.close()">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
      </form>
    </dialog>
  `,
  styles: STYLES,
})
export class DemosAdminPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  private cat = inject(CatalogueApi);
  private route = inject(ActivatedRoute);
  private sdlg = viewChild.required<ElementRef<HTMLDialogElement>>('sdlg');
  protected sum = signal<Row | null>(null);
  protected rows = signal<Row[]>([]);
  protected meta = signal<Row | null>(null);
  protected products = signal<ProductRow[]>([]);
  protected partners = signal<Row[]>([]);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected labels = DEMO_STATUS;
  protected statusKeys = Object.keys(DEMO_STATUS);
  protected q = '';
  protected status = '';
  protected productId: number | null = null;
  protected partnerId: number | null = null;
  protected dateField = 'created';
  protected from = '';
  protected to = '';
  protected ns = { admin: '', customer: '', soonDays: 7, notifyExpired: true, emailAdmins: true, emailCustomers: true };
  protected kpis = [
    { key: 'downloads', label: 'Total demo downloads', status: '', c: '#3282F6' },
    { key: 'active', label: 'Active demos', status: 'active', c: '#14C2B0' },
    { key: 'awaiting', label: 'Awaiting activation', status: 'awaiting_activation', c: '#7B5CFF' },
    { key: 'expiringSoon', label: 'Expiring soon', status: 'expiring_soon', c: '#FFB020' },
    { key: 'expiringToday', label: 'Expiring today', status: 'expiring_soon', c: '#FF7A2F' },
    { key: 'expired', label: 'Expired', status: 'expired', c: '#E5484D' },
    { key: 'activated', label: 'Ever activated', status: '', c: '#2BB673' },
    { key: 'converted', label: 'Converted to packages', status: 'converted', c: '#0A7C8E' },
  ];
  protected maxProduct = computed(() => Math.max(1, ...((this.sum()?.['byProduct'] ?? []) as Row[]).map((p) => p['demos'])));
  protected pct = (v: number, max: number) => Math.round((v / max) * 100);

  ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    this.status = qp.get('status') ?? '';
    this.productId = qp.get('productId') ? Number(qp.get('productId')) : null;
    void this.api.get('/demos/summary').then((s) => this.sum.set(s));
    void this.cat.products({ perPage: 100 }).then((r) => this.products.set(r.data));
    void this.api.get<Row[]>('/partner-options').then((p) => this.partners.set(p)).catch(() => undefined);
    void this.load(1);
  }
  filter(status: string) {
    this.status = status;
    void this.load(1);
    document.getElementById('list')?.scrollIntoView({ behavior: 'smooth' });
  }
  reset() {
    this.q = this.status = this.from = this.to = '';
    this.productId = this.partnerId = null;
    void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page('/demos', { page, q: this.q, status: this.status, productId: this.productId, partnerId: this.partnerId, dateField: this.dateField, from: this.from, to: this.to });
    this.rows.set(r.data);
    this.meta.set(r.meta);
  }
  async runChecks() {
    const r = await this.api.post('/demos/run-checks');
    this.msg.set(`Checked ${r['checked']} demo(s): ${r['notices']} new notification(s), ${r['supportReminders']} support reminder(s).`);
    void this.load(1);
  }
  async openSettings() {
    const s = await this.api.get('/demos/settings');
    this.ns = { admin: s['adminDays'].join(', '), customer: s['customerDays'].join(', '), soonDays: s['soonDays'], notifyExpired: s['notifyExpired'], emailAdmins: s['emailAdmins'], emailCustomers: s['emailCustomers'] };
    this.err.set(null);
    this.sdlg().nativeElement.showModal();
  }
  async saveSettings() {
    const days = (v: string) => v.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
    try {
      await this.api.put('/demos/settings', { adminDays: days(this.ns.admin), customerDays: days(this.ns.customer), soonDays: Number(this.ns.soonDays), notifyExpired: this.ns.notifyExpired, emailAdmins: this.ns.emailAdmins, emailCustomers: this.ns.emailCustomers });
      this.sdlg().nativeElement.close();
      this.msg.set('Notification settings saved.');
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
}

/* =========================================================================================
 * One demo record
 * ========================================================================================= */
const EVENT: Record<string, string> = { demo_created: 'Demo created', downloaded: 'Downloaded', activated: 'Activated on a device', device_reactivated: 'Device re-activated', demo_clock_started: 'Demo period started', extended: 'Extended', suspended: 'Suspended', revoked: 'Revoked', reactivated: 'Reinstated', expired: 'Expired', converted: 'Converted to package', trial_started: 'Trial started' };

@Component({
  selector: 'sch-demo-record',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/admin/demos" class="back">← Demos</a>
    @if (d(); as d) {
      <div class="adm-head"><div><h1>{{ d['customer'].name }} · {{ d['product'].name }}</h1>
        <p class="muted"><span class="badge" [class]="'badge ' + labels[d['status']][1]">{{ labels[d['status']][0] }}</span> · Demo licence {{ d['licenceKey'] }}</p></div></div>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      <div class="grid2">
        <section class="card"><h2>Customer</h2>
          <dl>
            <dt>Name</dt><dd><a [routerLink]="['/admin/customers', d['customer'].id]">{{ d['customer'].name }}</a></dd>
            <dt>Company</dt><dd>{{ d['customer'].company || '—' }}</dd>
            <dt>Email</dt><dd><a [href]="'mailto:' + d['customer'].email">{{ d['customer'].email }}</a></dd>
            <dt>Contact number</dt><dd>{{ d['customer'].cellphone || '—' }}</dd>
            <dt>Country / region</dt><dd>{{ d['customer'].country }}@if (d['customer'].province) { · {{ d['customer'].province }} }</dd>
            <dt>Business type</dt><dd>{{ d['customer'].businessType || '—' }}</dd>
            <dt>Partner</dt><dd>{{ d['customer'].partner || '—' }}</dd>
          </dl>
        </section>
        <section class="card"><h2>Demo</h2>
          <dl>
            <dt>Length</dt><dd>{{ d['days'] ?? '—' }} days, starts at {{ d['startOn'] === 'activation' ? 'first activation' : 'first download' }}</dd>
            <dt>Created</dt><dd>{{ d['createdAt'] | date: 'd MMM y, HH:mm' }}</dd>
            <dt>First download</dt><dd>{{ (d['firstDownloadedAt'] | date: 'd MMM y, HH:mm') ?? 'Not downloaded' }}</dd>
            <dt>Activated</dt><dd>{{ (d['activatedAt'] | date: 'd MMM y, HH:mm') ?? 'Not activated yet' }}</dd>
            <dt>Last used</dt><dd>{{ (d['lastSeenAt'] | date: 'd MMM y, HH:mm') ?? '—' }}</dd>
            <dt>Expires</dt><dd><strong>{{ (d['expiresAt'] | date: 'd MMM y, HH:mm') ?? 'Starts when activated' }}</strong></dd>
            @if (d['convertedAt']) { <dt>Converted</dt><dd>{{ d['convertedAt'] | date: 'd MMM y' }}</dd> }
          </dl>
          @if (auth.can('licences.manage') && !d['convertedAt']) {
            <div class="act">
              <input class="input sm" [(ngModel)]="reason" placeholder="Reason (required)" aria-label="Reason" />
              <input class="input sm" type="number" min="1" max="365" [(ngModel)]="days" aria-label="Days to extend" style="width: 90px" />
              <button class="btn btn-ghost btn-sm" type="button" (click)="act('extend')">Extend</button>
              @if (d['licenceStatus'] === 'suspended' || d['licenceStatus'] === 'revoked') { <button class="btn btn-ghost btn-sm" type="button" (click)="act('reinstate')">Reinstate</button> }
              @else { <button class="btn btn-ghost btn-sm" type="button" (click)="act('suspend')">Suspend</button><button class="btn btn-danger btn-sm" type="button" (click)="act('revoke')">Revoke</button> }
            </div>
            <p class="muted tiny">Suspending or revoking stops the software at its next licence check. A plain installer that never checks in cannot be switched off remotely.</p>
          }
        </section>
      </div>
      <div class="grid2" style="margin-top: 14px">
        <section class="card"><h2>Downloads</h2>
          <ul class="lst">@for (x of d['downloads']; track x['id']) { <li>{{ x['created_at'] | date: 'd MMM y, HH:mm' }} · v{{ x['version'] }} · {{ x['label'] || x['platform'] }} <span class="muted tiny">({{ x['status'] }})</span></li> } @empty { <li class="muted">No downloads.</li> }</ul>
        </section>
        <section class="card"><h2>Activations (devices)</h2>
          <ul class="lst">@for (a of d['activations']; track a['id']) { <li><strong>{{ a['device_name'] || 'Device' }}</strong> <span class="muted tiny">{{ a['platform'] }} · app {{ a['app_version'] || '?' }}</span><br /><span class="tiny">Activated {{ a['activated_at'] | date: 'd MMM y, HH:mm' }} · last check {{ (a['last_validated_at'] | date: 'd MMM y, HH:mm') ?? '—' }}@if (a['deactivated_at']) { · deactivated }</span></li> } @empty { <li class="muted">Not activated on any device yet. (A download does not mean the software was installed.)</li> }</ul>
        </section>
        <section class="card"><h2>Expiry notifications</h2>
          <ul class="lst">@for (n of d['notices']; track $index) { <li>{{ n['audience'] === 'admin' ? 'Administrators' : 'Customer' }} · {{ n['milestone'] < 0 ? 'Expired' : n['milestone'] === 0 ? 'Expiry day' : n['milestone'] + ' days before' }} <span class="muted tiny">{{ n['created_at'] | date: 'd MMM y, HH:mm' }} · {{ n['notified_users'] }} portal notice(s) · email {{ n['email_status'] ?? 'not sent' }}@if (n['email_error']) { ({{ n['email_error'] }}) }</span></li> } @empty { <li class="muted">None sent yet.</li> }</ul>
        </section>
        <section class="card"><h2>Conversations</h2>
          <ul class="lst">@for (t of d['conversations']; track t['id']) { <li><a routerLink="/admin/support" [queryParams]="{ open: t['id'] }">{{ t['subject'] }}</a> <span class="muted tiny">{{ t['reference'] }} · {{ chat[t['status']]?.[0] ?? t['status'] }}</span></li> } @empty { <li class="muted">No conversations.</li> }</ul>
        </section>
      </div>
      <section class="card" style="margin-top: 14px"><h2>History</h2>
        <ul class="timeline">@for (e of d['events']; track $index) { <li><strong>{{ eventLabel[e['event']] ?? e['event'] }}</strong> <span class="muted tiny">{{ e['created_at'] | date: 'd MMM y, HH:mm' }}@if (e['actor']) { · {{ e['actor'] }} }</span>@if (e['reason']) { <br /><span class="small">{{ e['reason'] }}</span> }</li> }</ul>
      </section>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES + `.act { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; } .act .input { flex: 1 1 160px; } .sm { min-height: 36px; padding: 4px 8px; font-size: 14px; }`,
})
export class DemoRecordPage implements OnInit {
  readonly id = input.required<string>();
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  protected d = signal<Row | null>(null);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected labels = DEMO_STATUS;
  protected chat = CHAT_STATUS;
  protected eventLabel = EVENT;
  protected reason = '';
  protected days = 7;
  ngOnInit() {
    this.api.get(`/demos/${this.id()}`).then((d) => this.d.set(d)).catch((e) => this.err.set(toApiError(e).message));
  }
  async act(action: string) {
    this.err.set(null);
    try {
      this.d.set(await this.api.post(`/demos/${this.id()}/action`, { action, reason: this.reason, days: action === 'extend' ? Number(this.days) : undefined }));
      this.msg.set('Saved.');
      this.reason = '';
    } catch (e) {
      const a = toApiError(e);
      this.err.set(Object.values(a.fields)[0] ?? a.message);
    }
  }
}

/* =========================================================================================
 * Customers (CRM)
 * ========================================================================================= */
@Component({
  selector: 'sch-customers-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Customers</h1><p class="muted">Registered customers with their products, demos, packages and conversations.</p></div></div>
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
    <div class="adm-filters">
      <input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Name, company, email or number" aria-label="Search" />
      <select class="select" [(ngModel)]="productId" (change)="load(1)" aria-label="Product"><option [ngValue]="null">Any product</option>@for (p of products(); track p.id) {<option [ngValue]="p.id">{{ p.name }}</option>}</select>
      <select class="select" [(ngModel)]="demo" (change)="load(1)" aria-label="Demo"><option value="">Any demo status</option><option value="any">Has a demo</option><option value="none">No demo</option>@for (k of statusKeys; track k) {<option [value]="k">Demo: {{ labels[k][0] }}</option>}</select>
      <select class="select" [(ngModel)]="pkg" (change)="load(1)" aria-label="Package"><option value="">Any package</option><option value="any">Has a package</option><option value="none">No package</option></select>
      <select class="select" [(ngModel)]="partnerId" (change)="load(1)" aria-label="Partner"><option [ngValue]="null">Any partner</option>@for (p of partners(); track p['id']) {<option [ngValue]="p['id']">{{ p['name'] }}</option>}</select>
      <input class="input" type="date" [(ngModel)]="from" (change)="load(1)" aria-label="Registered from" />
      <input class="input" type="date" [(ngModel)]="to" (change)="load(1)" aria-label="Registered to" />
    </div>
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Customer</th><th>Contact</th><th>Region</th><th>Demos</th><th>Packages</th><th>Open chats</th><th>Registered</th>@if (auth.can('customers.manage')) { <th><span class="sr-only">Actions</span></th> }</tr></thead>
        <tbody>
          @for (c of rows(); track c['id']) {
            <tr>
              <td data-label="Customer"><a [routerLink]="['/admin/customers', c['id']]"><strong>{{ c['full_name'] }}</strong></a> @if (c['user_id']) { @if (c['login_status'] === 'disabled') { <span class="badge badge-danger">Suspended</span> } @else if (!c['email_verified_at']) { <span class="badge badge-warn">Pending verification</span> } @else { <span class="badge badge-ok">Verified</span> } }<br /><span class="muted tiny">{{ c['company'] || '—' }}@if (c['business_type']) { · {{ c['business_type'] }} }</span></td>
              <td data-label="Contact"><span class="small">{{ c['email'] }}</span><br /><span class="muted tiny">{{ c['cellphone'] || '' }}</span></td>
              <td data-label="Region">{{ c['country'] }}@if (c['province']) { · {{ c['province'] }} }</td>
              <td data-label="Demos">{{ c['demos'] }}@if (c['downloads']) { <span class="muted tiny">({{ c['downloads'] }} downloads)</span> }</td>
              <td data-label="Packages">{{ c['packages'] }}</td>
              <td data-label="Open chats">{{ c['open_conversations'] }}</td>
              <td data-label="Registered">{{ c['created_at'] | date: 'd MMM y' }}</td>
              @if (auth.can('customers.manage')) {
                <td data-label=""><div class="row-actions" style="flex-wrap: nowrap; justify-content: flex-end">
                  @if (c['user_id']) {
                    @if (c['login_status'] === 'disabled') { <button class="btn btn-ghost btn-sm" type="button" (click)="account(c, 'reactivate')">Reactivate</button> }
                    @else { <button class="btn btn-ghost btn-sm" type="button" (click)="account(c, 'suspend')">Suspend</button> }
                  }
                  <button class="btn btn-danger btn-sm" type="button" (click)="remove(c)">Delete</button>
                </div></td>
              }
            </tr>
          } @empty { <tr><td colspan="8" class="empty">No customers match.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (meta(); as m) { <div class="pager"><span class="muted">{{ m['total'] }} customer(s)</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="m['page'] <= 1" (click)="load(m['page'] - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="m['page'] * m['perPage'] >= m['total']" (click)="load(m['page'] + 1)">Next</button></span></div> }
  `,
  styles: STYLES,
})
export class CustomersAdminPage implements OnInit {
  protected auth = inject(AuthService);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  async account(c: Row, action: 'suspend' | 'reactivate') {
    if (action === 'suspend' && !confirm(`Suspend ${c['full_name']}? They are signed out and cannot sign in until you reactivate the account. Nothing is deleted.`)) return;
    this.msg.set(null);
    this.err.set(null);
    try {
      await this.api.post(`/customers/${c['id']}/account`, { action });
      this.msg.set(action === 'suspend' ? `${c['full_name']} is suspended and can no longer sign in.` : `${c['full_name']} is reactivated.`);
      await this.load(this.meta()?.['page'] ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async remove(c: Row) {
    this.msg.set(null);
    this.err.set(null);
    try {
      const chk = await this.api.get<Row>(`/customers/${c['id']}/delete-check`);
      if (!chk['canDelete']) {
        this.err.set(`${c['full_name']} can’t be deleted because their history must be kept (${chk['reason']}). Use Suspend instead – they will not be able to sign in.`);
        return;
      }
      if (!confirm(`Delete ${c['full_name']} (${c['email']}) permanently? Their login and profile are removed and this cannot be undone.`)) return;
      await this.api.del(`/customers/${c['id']}`);
      this.msg.set(`${c['full_name']} was deleted.`);
      await this.load(this.meta()?.['page'] ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  private api = inject(PlatformApi);
  private cat = inject(CatalogueApi);
  private route = inject(ActivatedRoute);
  protected rows = signal<Row[]>([]);
  protected meta = signal<Row | null>(null);
  protected products = signal<ProductRow[]>([]);
  protected partners = signal<Row[]>([]);
  protected labels = DEMO_STATUS;
  protected statusKeys = Object.keys(DEMO_STATUS);
  protected q = '';
  protected demo = '';
  protected pkg = '';
  protected productId: number | null = null;
  protected partnerId: number | null = null;
  protected from = '';
  protected to = '';
  ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    this.from = qp.get('from') ?? '';
    this.demo = qp.get('demo') ?? '';
    void this.cat.products({ perPage: 100 }).then((r) => this.products.set(r.data));
    void this.api.get<Row[]>('/partner-options').then((p) => this.partners.set(p)).catch(() => undefined);
    void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page('/customers', { page, q: this.q, demo: this.demo, package: this.pkg, productId: this.productId, partnerId: this.partnerId, from: this.from, to: this.to });
    this.rows.set(r.data);
    this.meta.set(r.meta);
  }
}

@Component({
  selector: 'sch-customer-detail',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/admin/customers" class="back">← Customers</a>
    @if (d(); as d) {
      @let c = d['customer'];
      <div class="adm-head"><div><h1>{{ c['full_name'] }}</h1><p class="muted">{{ c['company'] || 'No company' }} · customer since {{ c['created_at'] | date: 'd MMM y' }}</p></div>
        @if (auth.can('licences.manage')) { <button class="btn btn-primary btn-sm" type="button" (click)="openPackage()">Assign package</button> }</div>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      <div class="grid2">
        <section class="card"><h2>Business & contact</h2>
          @if (editing()) {
            <div class="form-row">
              <div class="field"><label for="cn">Name</label><input id="cn" class="input" [(ngModel)]="f.fullName" /></div>
              <div class="field"><label for="cc">Company</label><input id="cc" class="input" [(ngModel)]="f.company" /></div>
              <div class="field"><label for="cp">Contact number</label><input id="cp" class="input" [(ngModel)]="f.cellphone" /></div>
              <div class="field"><label for="cpr">Province / region</label><input id="cpr" class="input" [(ngModel)]="f.province" /></div>
              <div class="field"><label for="cb">Business type</label><input id="cb" class="input" [(ngModel)]="f.businessType" /></div>
              <div class="field"><label for="cpa">Assigned partner</label><select id="cpa" class="select" [(ngModel)]="f.assignedPartnerId"><option [ngValue]="null">None</option>@for (p of partners(); track p['id']) {<option [ngValue]="p['id']">{{ p['name'] }}</option>}</select></div>
            </div>
            <div class="row-actions"><button class="btn btn-primary btn-sm" type="button" (click)="save()">Save</button><button class="btn btn-ghost btn-sm" type="button" (click)="editing.set(false)">Cancel</button></div>
          } @else {
            <dl>
              <dt>Email</dt><dd><a [href]="'mailto:' + c['email']">{{ c['email'] }}</a></dd>
              <dt>Contact number</dt><dd>{{ c['cellphone'] || '—' }}</dd>
              <dt>Country / region</dt><dd>{{ c['country'] }}@if (c['province']) { · {{ c['province'] }} }</dd>
              <dt>Business type</dt><dd>{{ c['business_type'] || '—' }}</dd>
              <dt>Partner</dt><dd>{{ c['partner'] || '—' }}</dd>
              <dt>Last activation</dt><dd>{{ (c['last_activation_at'] | date: 'd MMM y') ?? '—' }}</dd>
              <dt>Last sign-in</dt><dd>{{ (c['last_login_at'] | date: 'd MMM y, HH:mm') ?? '—' }}</dd>
              <dt>Business</dt><dd>{{ c['business'] || '—' }}</dd>
              <dt>Account</dt><dd>@if (!c['user_id']) { No login account } @else if (c['login_status'] === 'disabled') { <span class="badge badge-danger">Suspended</span> } @else if (!c['email_verified_at']) { <span class="badge badge-warn">Pending verification</span> } @else { <span class="badge badge-ok">Verified</span> <span class="muted tiny">{{ c['email_verified_at'] | date: 'd MMM y' }}</span> }</dd>
            </dl>
            @if (auth.can('customers.manage') && c['user_id']) {
              <div class="row-actions" style="margin-top: 10px">
                @if (!c['email_verified_at'] && c['login_status'] !== 'disabled') { <button class="btn btn-ghost btn-sm" type="button" (click)="account('resend_otp')">Resend verification code</button> }
                @if (c['login_status'] === 'disabled') { <button class="btn btn-ghost btn-sm" type="button" (click)="account('reactivate')">Reactivate account</button> }
                @else { <button class="btn btn-danger btn-sm" type="button" (click)="account('suspend')">Suspend account</button> }
              </div>
            }
            @if (auth.can('customers.manage')) { <div class="row-actions" style="margin-top: 10px"><button class="btn btn-ghost btn-sm" type="button" (click)="edit()">Edit details</button><button class="btn btn-danger btn-sm" type="button" (click)="remove()">Delete customer</button></div> }
          }
        </section>
        <section class="card"><h2>Products of interest</h2>
          <ul class="lst">@for (p of d['interest']; track p['id']) { <li>{{ p['name'] }} <span class="muted tiny">since {{ p['created_at'] | date: 'd MMM y' }}</span></li> } @empty { <li class="muted">None recorded.</li> }</ul>
        </section>
      </div>
      <section class="card"><h2>Demos</h2>
        <div class="table-wrap"><table class="table stack">
          <thead><tr><th>Product</th><th>Status</th><th>Downloaded</th><th>Activated</th><th>Expires</th></tr></thead>
          <tbody>@for (x of d['demos']; track x['id']) { <tr>
            <td data-label="Product"><a [routerLink]="['/admin/demos', x['id']]">{{ x['product'] }}</a></td>
            <td data-label="Status"><span class="badge" [class]="'badge ' + labels[x['status']][1]">{{ labels[x['status']][0] }}</span></td>
            <td data-label="Downloaded">{{ (x['first_downloaded_at'] | date: 'd MMM y') ?? '–' }}</td>
            <td data-label="Activated">{{ (x['activated_at'] | date: 'd MMM y') ?? '–' }}</td>
            <td data-label="Expires">{{ (x['expires_at'] | date: 'd MMM y') ?? '–' }}</td>
          </tr> } @empty { <tr><td colspan="5" class="empty">No demos.</td></tr> }</tbody>
        </table></div>
      </section>
      <section class="card"><h2>Packages</h2>
        <div class="table-wrap"><table class="table stack">
          <thead><tr><th>Product</th><th>Package</th><th>Status</th><th>Start</th><th>Expiry</th><th>Licence</th>@if (auth.can('licences.manage')) {<th></th>}</tr></thead>
          <tbody>@for (x of d['packages']; track x['id']) { <tr>
            <td data-label="Product">{{ x['product'] }}</td><td data-label="Package">{{ x['plan'] || typeLabel[x['type']] }}</td>
            <td data-label="Status"><span class="badge" [class.badge-ok]="x['status'] === 'active'" [class.badge-danger]="x['status'] !== 'active'">{{ x['status'] }}</span></td>
            <td data-label="Start">{{ x['starts_at'] | date: 'd MMM y' }}</td><td data-label="Expiry">{{ (x['expires_at'] | date: 'd MMM y') ?? 'No expiry' }}</td>
            <td data-label="Licence"><code class="tiny">{{ x['licence_key'] }}</code></td>
            @if (auth.can('licences.manage')) { <td data-label=""><select class="select sm" [ngModel]="x['status']" (ngModelChange)="setPackage(x, $event)" aria-label="Package status"><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select></td> }
          </tr> } @empty { <tr><td colspan="7" class="empty">No packages. Packages are only created by an administrator after payment or approval.</td></tr> }</tbody>
        </table></div>
      </section>
      <div class="grid2" style="margin-top: 14px">
        <section class="card"><h2>Download history</h2><ul class="lst">@for (x of d['downloads']; track x['id']) { <li>{{ x['created_at'] | date: 'd MMM y, HH:mm' }} · {{ x['product'] }} v{{ x['version'] }} <span class="muted tiny">{{ x['label'] || x['platform'] }} · {{ x['status'] }}</span></li> } @empty { <li class="muted">No downloads.</li> }</ul></section>
        <section class="card"><h2>Activation history</h2><ul class="lst">@for (x of d['activations']; track x['id']) { <li>{{ x['product'] }} · {{ x['device_name'] || 'Device' }} <span class="muted tiny">{{ x['activated_at'] | date: 'd MMM y' }} · last check {{ (x['last_validated_at'] | date: 'd MMM y') ?? '—' }}</span></li> } @empty { <li class="muted">No activations.</li> }</ul></section>
        <section class="card"><h2>Support conversations</h2><ul class="lst">@for (t of d['conversations']; track t['id']) { <li><a routerLink="/admin/support" [queryParams]="{ open: t['id'] }">{{ t['subject'] }}</a> <span class="muted tiny">{{ t['category'] || '' }} · {{ chat[t['status']]?.[0] }} · {{ t['last_message_at'] | date: 'd MMM y' }}</span></li> } @empty { <li class="muted">No conversations.</li> }</ul></section>
        <section class="card"><h2>Emails sent</h2><ul class="lst">@for (m of d['emails']; track $index) { <li>{{ m['subject'] || m['template_key'] }} <span class="muted tiny">{{ m['created_at'] | date: 'd MMM y' }} · {{ m['status'] }}</span></li> } @empty { <li class="muted">None.</li> }</ul></section>
        <section class="card"><h2>Consents (POPIA)</h2><ul class="lst">@for (x of d['consents']; track $index) { <li>{{ x['purpose'] }} v{{ x['document_version'] }} – {{ x['granted'] ? 'granted' : 'declined' }} <span class="muted tiny">{{ x['source'] }} · {{ x['created_at'] | date: 'd MMM y' }}</span></li> } @empty { <li class="muted">None.</li> }</ul></section>
        <section class="card"><h2>Activity</h2><ul class="lst">@for (x of d['activity']; track $index) { <li>{{ x['action'] }} <span class="muted tiny">{{ x['actor'] ?? 'Customer / system' }} · {{ x['created_at'] | date: 'd MMM y, HH:mm' }}</span></li> } @empty { <li class="muted">None.</li> }</ul></section>
      </div>

      <dialog #pdlg class="dlg">
        <form (ngSubmit)="assign()">
          <h2>Assign a package</h2>
          @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
          <div class="field"><label for="pp">Product</label><select id="pp" class="select" name="pp" [(ngModel)]="pk.productId"><option [ngValue]="null">Choose…</option>@for (p of productOptions(); track p['id']) {<option [ngValue]="p['id']">{{ p['name'] }}</option>}</select></div>
          <div class="field"><label for="ppl">Plan</label><select id="ppl" class="select" name="ppl" [(ngModel)]="pk.planId"><option [ngValue]="null">No specific plan</option>@for (pl of plansFor(); track pl['id']) {<option [ngValue]="pl['id']">{{ pl['name'] }}</option>}</select></div>
          <div class="form-row">
            <div class="field"><label for="pt">Type</label><select id="pt" class="select" name="pt" [(ngModel)]="pk.type"><option value="subscription">Subscription (with end date)</option><option value="perpetual">Perpetual licence</option><option value="free">Free</option></select></div>
            <div class="field"><label for="pd">Devices</label><input id="pd" class="input" type="number" min="1" name="pd" [(ngModel)]="pk.maxDevices" /></div>
            <div class="field"><label for="ps">Start date</label><input id="ps" class="input" type="date" name="ps" [(ngModel)]="pk.startsAt" /></div>
            <div class="field"><label for="pe">End date</label><input id="pe" class="input" type="date" name="pe" [(ngModel)]="pk.expiresAt" />@if (fe('expiresAt')) {<span class="error">{{ fe('expiresAt') }}</span>}</div>
          </div>
          <div class="field"><label for="pn">Notes / order reference</label><input id="pn" class="input" name="pn" [(ngModel)]="pk.notes" /></div>
          <label class="check"><input type="checkbox" name="cd" [(ngModel)]="pk.convertDemo" /><span>Mark this customer’s demo of the product as converted</span></label>
          @if (pk.convertDemo && pk.type !== 'free') { <label class="check"><input type="checkbox" name="cp" [(ngModel)]="pk.confirmPayment" /><span>I confirm payment or an approved order is in place</span></label>@if (fe('confirmPayment')) {<span class="error">{{ fe('confirmPayment') }}</span>} }
          <div class="actions"><button class="btn btn-ghost" type="button" (click)="pdlg.close()">Cancel</button><button class="btn btn-primary" type="submit">Assign package</button></div>
        </form>
      </dialog>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES + `.sm { min-height: 34px; padding: 2px 6px; font-size: 13px; width: auto; }`,
})
export class CustomerDetailPage implements OnInit {
  readonly id = input.required<string>();
  protected auth = inject(AuthService);
  private api = inject(PlatformApi);
  private pdlg = viewChild<ElementRef<HTMLDialogElement>>('pdlg');
  protected d = signal<Row | null>(null);
  protected partners = signal<Row[]>([]);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected editing = signal(false);
  protected labels = DEMO_STATUS;
  protected chat = CHAT_STATUS;
  protected typeLabel: Record<string, string> = { subscription: 'Subscription', perpetual: 'Perpetual', free: 'Free' };
  protected f: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  protected pk: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected productOptions = computed(() => {
    const seen = new Map<number, string>();
    for (const p of (this.d()?.['plans'] ?? []) as Row[]) seen.set(p['product_id'], p['product']);
    for (const p of (this.d()?.['demos'] ?? []) as Row[]) seen.set(p['product_id'], p['product']);
    for (const p of (this.d()?.['interest'] ?? []) as Row[]) seen.set(p['id'], p['name']);
    return [...seen].map(([id, name]) => ({ id, name }));
  });
  protected plansFor = () => ((this.d()?.['plans'] ?? []) as Row[]).filter((p) => p['product_id'] === this.pk['productId']);
  ngOnInit() {
    void this.load();
    void this.api.get<Row[]>('/partner-options').then((p) => this.partners.set(p)).catch(() => undefined);
  }
  private router = inject(Router);
  async remove() {
    const c = this.d()?.['customer'] as Row;
    this.err.set(null);
    try {
      const chk = await this.api.get<Row>(`/customers/${this.id()}/delete-check`);
      if (!chk['canDelete']) {
        this.err.set(`This customer can’t be deleted because their history must be kept (${chk['reason']}). Use “Suspend account” instead – they will not be able to sign in.`);
        return;
      }
      if (!confirm(`Delete ${c['full_name']} (${c['email']}) permanently? Their login and profile are removed and this cannot be undone.`)) return;
      await this.api.del(`/customers/${this.id()}`);
      await this.router.navigateByUrl('/admin/customers');
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async account(action: 'suspend' | 'reactivate' | 'resend_otp') {
    if (action === 'suspend' && !confirm('Suspend this customer? They are signed out and cannot sign in until reactivated.')) return;
    try {
      await this.api.post(`/customers/${this.id()}/account`, { action });
      this.msg.set(action === 'resend_otp' ? 'A new verification code was emailed.' : action === 'suspend' ? 'Account suspended.' : 'Account reactivated.');
      await this.load();
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async load() {
    try {
      this.d.set(await this.api.get(`/customers/${this.id()}`));
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  edit() {
    const c = this.d()!['customer'];
    this.f = { fullName: c['full_name'], company: c['company'] ?? '', cellphone: c['cellphone'] ?? '', province: c['province'] ?? '', businessType: c['business_type'] ?? '', assignedPartnerId: c['assigned_partner_id'] ?? null };
    this.editing.set(true);
  }
  async save() {
    try {
      await this.api.patch(`/customers/${this.id()}`, this.f);
      this.editing.set(false);
      this.msg.set('Customer details saved.');
      await this.load();
    } catch (e) {
      this.msg.set(toApiError(e).message);
    }
  }
  openPackage() {
    this.pk = { productId: null, planId: null, type: 'subscription', maxDevices: 1, startsAt: new Date().toISOString().slice(0, 10), expiresAt: '', notes: '', convertDemo: true, confirmPayment: false };
    this.err.set(null);
    this.fields.set({});
    this.pdlg()?.nativeElement.showModal();
  }
  async assign() {
    this.err.set(null);
    this.fields.set({});
    try {
      const r = await this.api.post(`/customers/${this.id()}/packages`, { ...this.pk, maxDevices: Number(this.pk['maxDevices']) || 1, expiresAt: this.pk['expiresAt'] || null });
      this.pdlg()?.nativeElement.close();
      this.msg.set(`Package assigned – licence ${r['licenceKey']}.`);
      await this.load();
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(Object.values(a.fields)[0] ?? a.message);
    }
  }
  async setPackage(x: Row, status: string) {
    const reason = prompt(`Reason for changing this package to “${status}”:`);
    if (!reason) return void this.load();
    try {
      await this.api.post(`/licences/${x['id']}/status`, { status, reason });
      this.msg.set('Package updated.');
    } catch (e) {
      this.msg.set(toApiError(e).message);
    }
    await this.load();
  }
}

/* =========================================================================================
 * Notifications (staff)
 * ========================================================================================= */
@Component({
  selector: 'sch-admin-notifications',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Notifications</h1><p class="muted">Demo expiries, new and waiting support conversations, assignments.</p></div>
      <button class="btn btn-ghost btn-sm" type="button" (click)="readAll()" [disabled]="!unread()">Mark all as read</button></div>
    <ul class="notes">
      @for (n of items(); track n['id']) {
        <li [class.unread]="!n['read_at']"><button type="button" (click)="open(n)">
          <strong>{{ n['title'] }}</strong>@if (n['body']) { <span class="small">{{ n['body'] }}</span> }<span class="muted tiny">{{ n['created_at'] | date: 'd MMM y, HH:mm' }}</span>
        </button></li>
      } @empty { <li class="muted">No notifications.</li> }
    </ul>
  `,
  styles: STYLES + `
    .notes { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 8px; }
    .notes button { width: 100%; text-align: left; display: grid; gap: 3px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r); background: #fff; cursor: pointer; font: inherit; color: var(--fg); }
    .notes li.unread button { border-left: 4px solid var(--sch-blue); background: #f5f9ff; }
  `,
})
export class AdminNotificationsPage implements OnInit {
  private api = inject(PlatformApi);
  private router = inject(Router);
  protected items = signal<Row[]>([]);
  protected unread = signal(0);
  ngOnInit() {
    void this.load();
  }
  async load() {
    const r = await this.api.notifications();
    this.items.set(r.data);
    this.unread.set(r.unread);
  }
  async open(n: Row) {
    if (!n['read_at']) await this.api.readNotifications({ ids: [n['id']] });
    if (n['link']) await this.router.navigateByUrl(n['link']);
    else void this.load();
  }
  async readAll() {
    await this.api.readNotifications({ all: true });
    void this.load();
  }
}

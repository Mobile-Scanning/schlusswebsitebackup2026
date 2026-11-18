/* eslint-disable @typescript-eslint/no-explicit-any */
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, toApiError } from '../core/auth.service';
import { CatalogueApi, ProductRow } from './catalogue-api';
import type { Page } from './admin-api';

const DEMO_STATUS: Record<string, [string, string]> = {
  new: ['New', 'badge-info'],
  contacted: ['Contacted', 'badge-warn'],
  scheduled: ['Scheduled', 'badge-warn'],
  completed: ['Completed', 'badge-ok'],
  cancelled: ['Cancelled', 'badge-muted'],
  no_show: ['No show', 'badge-muted'],
};
const DEMO_TYPE: Record<string, string> = { live: 'Live online', onsite: 'On-site', video: 'Video walkthrough', interactive: 'Interactive access' };

/** Admin › Demo requests */
@Component({
  selector: 'sch-demo-requests',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Demo requests</h1><p class="muted">Requests from the website. Assign them, schedule a time and record the outcome.</p></div></div>
    <div class="status-tabs">
      <button type="button" [attr.aria-pressed]="!status" (click)="status = ''; load(1)">All</button>
      @for (s of statusKeys; track s) { <button type="button" [attr.aria-pressed]="status === s" (click)="status = s; load(1)">{{ statusLabel[s][0] }} ({{ page()?.counts?.[s] ?? 0 }})</button> }
    </div>
    <div class="adm-filters"><input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Search name, email, company or reference" aria-label="Search" /></div>
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Requested</th><th>Contact</th><th>Product</th><th>Preference</th><th>Status</th><th>Assigned</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (d of page()?.data ?? []; track d['id']) {
            <tr>
              <td data-label="Requested">{{ d['created_at'] | date: 'd MMM y' }}<br /><span class="muted small">{{ d['reference'] }}</span></td>
              <td data-label="Contact"><strong>{{ d['name'] }}</strong>@if (d['company']) { · {{ d['company'] }} }<br /><a [href]="'mailto:' + d['email']">{{ d['email'] }}</a> · {{ d['cellphone'] }}</td>
              <td data-label="Product">{{ d['product_name'] ?? 'General' }}</td>
              <td data-label="Preference">{{ types[d['preferred_type']] }}@if (d['preferred_date']) {<br /><span class="muted small">{{ d['preferred_date'] | date: 'd MMM y' }}</span>}</td>
              <td data-label="Status"><span class="badge" [class]="'badge ' + statusLabel[d['status']][1]">{{ statusLabel[d['status']][0] }}</span>@if (d['scheduled_at']) {<br /><span class="small">{{ d['scheduled_at'] | date: 'd MMM, HH:mm' }}</span>}</td>
              <td data-label="Assigned">{{ d['assigned_name'] ?? '—' }}</td>
              <td data-label="">@if (auth.can('demos.manage')) {<button class="btn btn-ghost btn-sm" type="button" (click)="openEdit(d)">Update</button>}</td>
            </tr>
          } @empty { <tr><td colspan="7" class="empty">No demo requests.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (page(); as p) { <div class="pager"><span class="muted">{{ p.meta.total }} requests</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page <= 1" (click)="load(p.meta.page - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page * p.meta.perPage >= p.meta.total" (click)="load(p.meta.page + 1)">Next</button></span></div> }

    <dialog #dlg class="dlg">
      @if (editing(); as d) {
        <form (ngSubmit)="save()">
          <h2>{{ d['name'] }} · {{ d['reference'] }}</h2>
          @if (d['message']) { <p class="muted msgbox">“{{ d['message'] }}”</p> }
          @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
          <div class="form-row">
            <div class="field"><label for="dm-s">Status</label><select id="dm-s" class="select" name="s" [(ngModel)]="form.status">@for (s of statusKeys; track s) {<option [value]="s">{{ statusLabel[s][0] }}</option>}</select></div>
            <div class="field"><label for="dm-a">Assigned to</label><select id="dm-a" class="select" name="a" [(ngModel)]="form.assignedTo"><option [ngValue]="null">Nobody</option>@for (u of staff(); track u.id) {<option [ngValue]="u.id">{{ u.name }}</option>}</select></div>
            <div class="field"><label for="dm-d">Scheduled for</label><input id="dm-d" class="input" type="datetime-local" name="d" [(ngModel)]="form.scheduledAt" /></div>
          </div>
          @if (form.scheduledAt) { <label class="check"><input type="checkbox" name="n" [(ngModel)]="form.notifyCustomer" /><span>Email the booking time to {{ d['email'] }}</span></label> }
          <label class="check"><input type="checkbox" name="c" [(ngModel)]="form.converted" /><span>Converted to a sale / licence</span></label>
          <div class="field"><label for="dm-f">Follow-up notes</label><textarea id="dm-f" class="textarea" rows="4" name="f" [(ngModel)]="form.followUpNotes"></textarea></div>
          <div class="actions"><button class="btn btn-ghost" type="button" (click)="dlg.close()">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
        </form>
      }
    </dialog>
  `,
  styles: `.small { font-size: 12px; } .msgbox { border-left: 3px solid var(--sch-blue); padding-left: 10px; }`,
})
export class DemoRequestsPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(CatalogueApi);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected page = signal<(Page<Record<string, any>> & { counts: Record<string, number> }) | null>(null);
  protected staff = signal<{ id: number; name: string }[]>([]);
  protected editing = signal<Record<string, any> | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  protected status = '';
  protected q = '';
  protected statusLabel = DEMO_STATUS;
  protected statusKeys = Object.keys(DEMO_STATUS);
  protected types = DEMO_TYPE;
  protected form: { status: string; assignedTo: number | null; scheduledAt: string; followUpNotes: string; converted: boolean; notifyCustomer: boolean } = { status: 'new', assignedTo: null, scheduledAt: '', followUpNotes: '', converted: false, notifyCustomer: false };

  ngOnInit() {
    void this.load(1);
    if (this.auth.can('demos.manage')) void this.api.staffOptions().then((s) => this.staff.set(s));
  }
  async load(page: number) {
    this.page.set(await this.api.demos({ page, status: this.status, q: this.q }));
  }
  openEdit(d: Record<string, any>) {
    const local = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
    this.form = { status: d['status'], assignedTo: d['assigned_to'], scheduledAt: local(d['scheduled_at']), followUpNotes: d['follow_up_notes'] ?? '', converted: !!d['converted'], notifyCustomer: false };
    this.err.set(null);
    this.editing.set(d);
    this.dlg().nativeElement.showModal();
  }
  async save() {
    const d = this.editing()!;
    try {
      await this.api.updateDemo(d['id'], { ...this.form, scheduledAt: this.form.scheduledAt ? new Date(this.form.scheduledAt).toISOString() : null });
      this.dlg().nativeElement.close();
      this.msg.set(`Updated ${d['reference']}.${this.form.notifyCustomer ? ' The customer will receive the booking email.' : ''}`);
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
}

/* ======================================================================== */
const PARTNER_STATUS: Record<string, [string, string]> = {
  pending: ['Pending', 'badge-warn'],
  under_review: ['Under review', 'badge-info'],
  approved: ['Approved', 'badge-ok'],
  rejected: ['Rejected', 'badge-danger'],
  suspended: ['Suspended', 'badge-danger'],
};

/** Admin › Business partners & applications */
@Component({
  selector: 'sch-partners-admin',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Business partners</h1><p class="muted">Review applications, approve or reject partners, and assign the products they may sell.</p></div></div>
    <div class="status-tabs">
      <button type="button" [attr.aria-pressed]="!status" (click)="status = ''; load(1)">All</button>
      @for (s of statusKeys; track s) { <button type="button" [attr.aria-pressed]="status === s" (click)="status = s; load(1)">{{ labels[s][0] }} ({{ page()?.counts?.[s] ?? 0 }})</button> }
    </div>
    <div class="adm-filters"><input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Search business, contact, email or reference" aria-label="Search" /></div>
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Business</th><th>Contact</th><th>Applied</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (p of page()?.data ?? []; track p['id']) {
            <tr>
              <td data-label="Business"><strong>{{ p['business_name'] }}</strong><br /><span class="muted small">{{ p['reference'] }} · {{ p['country'] }}</span></td>
              <td data-label="Contact">{{ p['contact_name'] }}<br /><a [href]="'mailto:' + p['email']">{{ p['email'] }}</a></td>
              <td data-label="Applied">{{ p['created_at'] | date: 'd MMM y' }}</td>
              <td data-label="Status"><span class="badge" [class]="'badge ' + labels[p['status']][1]">{{ labels[p['status']][0] }}</span></td>
              <td data-label=""><button class="btn btn-ghost btn-sm" type="button" (click)="open(p['id'])">Review</button></td>
            </tr>
          } @empty { <tr><td colspan="5" class="empty">No partners or applications yet.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (page(); as pg) { <div class="pager"><span class="muted">{{ pg.meta.total }}</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="pg.meta.page <= 1" (click)="load(pg.meta.page - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="pg.meta.page * pg.meta.perPage >= pg.meta.total" (click)="load(pg.meta.page + 1)">Next</button></span></div> }

    <dialog #dlg class="dlg wide">
      @if (detail(); as d) {
        <div class="dh"><h2>{{ d['business_name'] }}</h2><span class="badge" [class]="'badge ' + labels[d['status']][1]">{{ labels[d['status']][0] }}</span></div>
        @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
        <div class="cols">
          <dl class="kv">
            <dt>Reference</dt><dd>{{ d['reference'] }}</dd>
            <dt>Contact</dt><dd>{{ d['contact_name'] }}</dd>
            <dt>Email</dt><dd><a [href]="'mailto:' + d['email']">{{ d['email'] }}</a></dd>
            <dt>Cellphone</dt><dd>{{ d['cellphone'] }}</dd>
            <dt>Address</dt><dd>{{ d['address'] || '—' }}</dd>
            <dt>Country</dt><dd>{{ d['country'] }}</dd>
            <dt>Website</dt><dd>{{ d['website'] || '—' }}</dd>
            <dt>Business type</dt><dd>{{ d['business_type'] || '—' }}</dd>
            <dt>Industry</dt><dd>{{ d['industry'] || '—' }}</dd>
            <dt>Experience</dt><dd>{{ d['years_experience'] ?? '—' }} years</dd>
            <dt>Services</dt><dd>{{ d['services_offered'] || '—' }}</dd>
            <dt>Areas</dt><dd>{{ d['areas_of_operation'] || '—' }}</dd>
            <dt>Interested in</dt><dd>{{ d['products_interested'] || '—' }}</dd>
            <dt>Other info</dt><dd>{{ d['additional_info'] || '—' }}</dd>
            <dt>Applied</dt><dd>{{ d['created_at'] | date: 'd MMM y, HH:mm' }}</dd>
            @if (d['reviewed_by_name']) { <dt>Last review</dt><dd>{{ d['reviewed_by_name'] }}, {{ d['reviewed_at'] | date: 'd MMM y' }}</dd> }
          </dl>
          <div class="side">
            @if (auth.can('partners.approve')) {
              <h3>Decision</h3>
              <div class="field"><label for="pn">Note <span class="muted">(kept on record)</span></label><textarea id="pn" class="textarea" rows="2" [(ngModel)]="note"></textarea></div>
              <div class="row-actions">
                @if (d['status'] === 'pending') { <button class="btn btn-ghost btn-sm" type="button" (click)="decide('under_review')">Mark under review</button> }
                @if (d['status'] !== 'approved') { <button class="btn btn-primary btn-sm" type="button" (click)="decide('approved')">Approve</button> }
                @if (['pending', 'under_review'].includes(d['status'])) { <button class="btn btn-danger btn-sm" type="button" (click)="decide('rejected')">Reject</button> }
                @if (d['status'] === 'approved') { <button class="btn btn-danger btn-sm" type="button" (click)="decide('suspended')">Suspend</button> }
              </div>
              <p class="muted small">Approving creates the partner's login and emails a link to set a password. Rejecting sends a polite notice.</p>
            }
            @if (auth.can('partners.manage') && d['status'] === 'approved') {
              <h3>Products they may sell</h3>
              <div class="prods">
                @for (pr of products(); track pr.id) {
                  <label class="check"><input type="checkbox" [checked]="assigned().includes(pr.id)" (change)="toggleProduct(pr.id)" /><span>{{ pr.name }}</span></label>
                } @empty { <p class="muted small">No products yet.</p> }
              </div>
              <div class="form-row">
                <div class="field"><label for="pd">Partner discount %</label><input id="pd" class="input" type="number" min="0" max="100" step="0.5" [(ngModel)]="discount" /></div>
                <div class="field"><label for="pc">Default commission %</label><input id="pc" class="input" type="number" min="0" max="100" step="0.5" [(ngModel)]="commission" /></div>
              </div>
              <button class="btn btn-primary btn-sm" type="button" (click)="saveTerms()">Save partner terms</button>
            }
            @if (d['users']?.length) {
              <h3>Logins</h3>
              @for (u of d['users']; track u.id) { <p class="small">{{ u.name }} · {{ u.email }}<br /><span class="muted">Last sign-in: {{ u.last_login_at ? (u.last_login_at | date: 'd MMM y') : 'never' }}</span></p> }
            }
            @if (d['admin_notes']) { <h3>Notes</h3><p class="small notes">{{ d['admin_notes'] }}</p> }
          </div>
        </div>
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="dlg.close()">Close</button></div>
      }
    </dialog>
  `,
  styles: `
    .small { font-size: 12px; }
    .dh { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; } .dh h2 { margin: 0; }
    .cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; }
    @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
    .side h3 { font-size: 15px; margin: 16px 0 8px; } .side h3:first-child { margin-top: 0; }
    .prods { max-height: 180px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 8px 10px 0; margin-bottom: 10px; }
    .notes { white-space: pre-line; }
  `,
})
export class PartnersAdminPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(CatalogueApi);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected page = signal<(Page<Record<string, any>> & { counts: Record<string, number> }) | null>(null);
  protected detail = signal<Record<string, any> | null>(null);
  protected products = signal<ProductRow[]>([]);
  protected assigned = signal<number[]>([]);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  protected labels = PARTNER_STATUS;
  protected statusKeys = Object.keys(PARTNER_STATUS);
  protected status = '';
  protected q = '';
  protected note = '';
  protected discount = 0;
  protected commission = 0;

  ngOnInit() {
    void this.load(1);
    if (this.auth.can('partners.manage')) void this.api.products({ perPage: 100, state: 'published' }).then((r) => this.products.set(r.data));
  }
  async load(page: number) {
    this.page.set(await this.api.partners({ page, status: this.status, q: this.q }));
  }
  async open(id: number) {
    this.err.set(null);
    this.note = '';
    const d = await this.api.partner(id);
    this.detail.set(d);
    this.assigned.set((d['products'] ?? []).filter((p: any) => p.is_active).map((p: any) => p.id));
    this.discount = d['discount_percent'];
    this.commission = d['default_commission_percent'];
    if (!this.dlg().nativeElement.open) this.dlg().nativeElement.showModal();
  }
  toggleProduct(id: number) {
    this.assigned.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
  async decide(status: string) {
    const d = this.detail()!;
    const verb: Record<string, string> = { approved: 'approve', rejected: 'reject', suspended: 'suspend', under_review: 'mark as under review' };
    if (status !== 'under_review' && !confirm(`${verb[status][0].toUpperCase() + verb[status].slice(1)} ${d['business_name']}?`)) return;
    try {
      const r = await this.api.partnerStatus(d['id'], status, this.note);
      this.msg.set(`${d['business_name']}: ${PARTNER_STATUS[status][0]}.${r.invited ? ' A set-password email has been queued.' : ''}`);
      await this.open(d['id']);
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async saveTerms() {
    const d = this.detail()!;
    try {
      await this.api.updatePartner(d['id'], { productIds: this.assigned(), discountPercent: Number(this.discount) || 0, defaultCommissionPercent: Number(this.commission) || 0 });
      this.msg.set(`Partner terms saved for ${d['business_name']}.`);
      await this.open(d['id']);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
}

/* ======================================================================== */
const TICKET: Record<string, [string, string]> = {
  open: ['Open', 'badge-info'],
  in_progress: ['In progress', 'badge-warn'],
  new: ['New', 'badge-info'],
  awaiting_admin: ['Awaiting reply', 'badge-warn'],
  awaiting_customer: ['Awaiting customer', 'badge-muted'],
  resolved: ['Resolved', 'badge-ok'],
  closed: ['Closed', 'badge-muted'],
};

/** Admin › Website enquiries (contact form). Full support ticketing builds on this. */
@Component({
  selector: 'sch-enquiries',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Enquiries</h1><p class="muted">Messages sent through the website contact form.</p></div></div>
    <div class="status-tabs">
      <button type="button" [attr.aria-pressed]="!status" (click)="status = ''; load(1)">All</button>
      @for (s of keys; track s) { <button type="button" [attr.aria-pressed]="status === s" (click)="status = s; load(1)">{{ labels[s][0] }}</button> }
    </div>
    <div class="adm-filters"><input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Search subject, name, email or reference" aria-label="Search" /></div>
    @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
    <div class="list">
      @for (t of page()?.data ?? []; track t['id']) {
        <article class="card enq">
          <header>
            <div><strong>{{ t['subject'] }}</strong><br /><span class="muted small">{{ t['reference'] }} · {{ t['created_at'] | date: 'd MMM y, HH:mm' }}@if (t['product_name']) { · {{ t['product_name'] }} }</span></div>
            <span class="badge" [class]="'badge ' + labels[t['status']][1]">{{ labels[t['status']][0] }}</span>
          </header>
          <p class="from">{{ t['name'] }} · <a [href]="'mailto:' + t['email'] + '?subject=Re: ' + t['subject'] + ' (' + t['reference'] + ')'">{{ t['email'] }}</a></p>
          <p class="body">{{ t['message'] }}</p>
          @if (auth.can('support.manage')) {
            <div class="row-actions">
              <select class="select sm" [ngModel]="t['status']" (ngModelChange)="setStatus(t, $event)" aria-label="Status">@for (s of keys; track s) {<option [value]="s">{{ labels[s][0] }}</option>}</select>
              <a class="btn btn-ghost btn-sm" [href]="'mailto:' + t['email'] + '?subject=Re: ' + t['subject'] + ' (' + t['reference'] + ')'">Reply by email</a>
            </div>
          }
        </article>
      } @empty { <div class="card empty">No enquiries.</div> }
    </div>
    @if (page(); as p) { <div class="pager"><span class="muted">{{ p.meta.total }}</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page <= 1" (click)="load(p.meta.page - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page * p.meta.perPage >= p.meta.total" (click)="load(p.meta.page + 1)">Next</button></span></div> }
  `,
  styles: `
    .list { display: grid; gap: 12px; }
    .enq header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .small { font-size: 12px; } .from { margin: 10px 0 4px; font-size: 14px; }
    .body { white-space: pre-line; margin: 0 0 12px; }
    .sm { min-height: 36px; padding: 4px 8px; font-size: 14px; width: auto; }
  `,
})
export class EnquiriesPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(CatalogueApi);
  protected page = signal<Page<Record<string, any>> | null>(null);
  protected err = signal<string | null>(null);
  protected labels = TICKET;
  protected keys = Object.keys(TICKET);
  protected status = '';
  protected q = '';
  ngOnInit() {
    void this.load(1);
  }
  async load(page: number) {
    this.page.set(await this.api.enquiries({ page, status: this.status, q: this.q }));
  }
  async setStatus(t: Record<string, any>, status: string) {
    try {
      await this.api.updateEnquiry(t['id'], { status });
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
}

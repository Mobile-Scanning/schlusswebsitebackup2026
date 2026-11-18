import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, toApiError } from '../core/auth.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;
const PLATFORM: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', web: 'Web', any: 'All platforms' };
const size = (b: number | null) => (b == null ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

/**
 * Full installer download for one product. Only shown as a real download to customers the server authorises
 * (active licence, or "any verified customer" if the admin chose that). Everyone else sees why, plus the demo
 * and a purchase enquiry. The demo file is never offered here, and this never offers another product's file.
 */
@Component({
  selector: 'sch-installer-panel',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let u = auth.user();
    <ul class="facts">
      <li><strong>Full version {{ installer().version }}</strong>@if (installer().releaseDate) { · released {{ installer().releaseDate | date: 'd MMM y' }} }</li>
      @for (f of installer().files; track f.id) { <li>{{ platform(f.platform) }} · {{ f.label }} @if (f.size) { · {{ sz(f.size) }} }</li> }
    </ul>
    @if (!u) {
      <p>Sign in with your customer account to download the full installer.{{ installer().access === 'licensed' ? ' It is available once your licence is active.' : '' }}</p>
      <div class="row"><a class="btn btn-primary" routerLink="/login" [queryParams]="{ next: back() }">Sign in</a><a class="btn btn-ghost" routerLink="/register" [queryParams]="{ next: back() }">Create an account</a></div>
    } @else if (u.type !== 'customer') {
      <div class="alert" role="note">Staff and partners download installers from the admin or partner portal.</div>
    } @else if (info(); as i) {
      @if (i.allowed) {
        @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
        @if (started()) { <div class="alert alert-ok" role="status">Your download has started. If not, <a [href]="started()">click here</a> (the link works for 10 minutes).</div> }
        <div class="row">
          @for (f of i.version.files; track f.id) {
            <button type="button" class="btn btn-primary" (click)="download(f.id)" [disabled]="busy()">Download {{ f.label }} @if (f.size) { ({{ sz(f.size) }}) }</button>
          }
        </div>
        @if (i.version.instructions) { <details class="inst"><summary>Installation instructions</summary><p class="keep-lines">{{ i.version.instructions }}</p></details> }
      } @else {
        <div class="alert" role="note">{{ i.reason }}</div>
      }
    } @else { <p class="muted">Checking your access…</p> }
  `,
  styles: `
    .facts { margin: 0 0 14px; padding-left: 18px; display: grid; gap: 4px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
    .inst { margin-top: 10px; } .inst summary { cursor: pointer; font-weight: 600; }
  `,
})
export class InstallerPanel {
  readonly slug = input.required<string>();
  readonly installer = input.required<{ version: string; releaseDate: string | null; access: string; files: { id: number; platform: string; label: string; size: number | null }[] }>();
  protected auth = inject(AuthService);
  private http = inject(HttpClient);
  protected info = signal<Row | null>(null);
  protected busy = signal(false);
  protected err = signal<string | null>(null);
  protected started = signal<string | null>(null);
  protected platform = (p: string) => PLATFORM[p] ?? p;
  protected sz = size;
  protected back = () => `/products/${this.slug()}#installer`;

  constructor() {
    effect(() => {
      const u = this.auth.user();
      const s = this.slug();
      this.info.set(null);
      if (u?.type === 'customer') void firstValueFrom(this.http.get<Row>(`/api/account/installers/${encodeURIComponent(s)}`)).then((r) => this.info.set(r)).catch((e) => this.info.set({ allowed: false, reason: toApiError(e).message }));
    });
  }

  async download(fileId: number) {
    this.busy.set(true);
    this.err.set(null);
    try {
      const r = await firstValueFrom(this.http.post<{ url: string }>(`/api/account/installers/${encodeURIComponent(this.slug())}/download`, { fileId }));
      this.started.set(r.url);
      window.location.assign(r.url);
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** "Buy / request a quotation" – goes to the SCHLUSS sales department only. */
@Component({
  selector: 'sch-purchase-form',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (done(); as ref) {
      <div class="alert alert-ok" role="status"><strong>Thank you – your enquiry {{ ref }} is with our sales team.</strong> They will contact you with pricing and next steps. A confirmation is on its way to your email.</div>
    } @else {
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      <form (ngSubmit)="send()" novalidate>
        <div class="form-row">
          <div class="field"><label for="pf-n">Your name</label><input id="pf-n" class="input" name="n" [(ngModel)]="f.name" autocomplete="name" />@if (fe('name')) {<span class="error">{{ fe('name') }}</span>}</div>
          <div class="field"><label for="pf-b">Business name <span class="muted">(optional)</span></label><input id="pf-b" class="input" name="b" [(ngModel)]="f.company" autocomplete="organization" /></div>
          <div class="field"><label for="pf-e">Email</label><input id="pf-e" class="input" type="email" name="e" [(ngModel)]="f.email" autocomplete="email" />@if (fe('email')) {<span class="error">{{ fe('email') }}</span>}</div>
          <div class="field"><label for="pf-p">Phone</label><input id="pf-p" class="input" type="tel" name="p" [(ngModel)]="f.cellphone" autocomplete="tel" />@if (fe('cellphone')) {<span class="error">{{ fe('cellphone') }}</span>}</div>
          <div class="field"><label for="pf-q">Number of licences</label><input id="pf-q" class="input" type="number" min="1" name="q" [(ngModel)]="f.quantity" />@if (fe('quantity')) {<span class="error">{{ fe('quantity') }}</span>}</div>
          <div class="field"><label for="pf-k">I would like to</label><select id="pf-k" class="select" name="k" [(ngModel)]="f.subject"><option value="Purchase">Purchase</option><option value="Quotation request">Receive a quotation</option></select></div>
        </div>
        <div class="field"><label for="pf-m">Description of your requirements</label><textarea id="pf-m" class="textarea" rows="4" name="m" [(ngModel)]="f.message" maxlength="5000" placeholder="e.g. number of branches, devices, start date"></textarea>@if (fe('message')) {<span class="error">{{ fe('message') }}</span>}</div>
        <input class="hp" name="website" [(ngModel)]="f.website" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <label class="check"><input type="checkbox" name="a" [(ngModel)]="f.acceptPrivacy" /><span>SCHLUSS may use these details to answer my enquiry (<a routerLink="/privacy">privacy policy</a>).</span></label>
        @if (fe('acceptPrivacy')) {<span class="error">{{ fe('acceptPrivacy') }}</span>}
        <p class="muted small">Need help installing or using {{ name() }} instead? Use the chat and choose “Technical support” – this form goes to our sales team.</p>
        <button class="btn btn-primary" type="submit" [disabled]="busy()">Send purchase enquiry</button>
      </form>
    }
  `,
  styles: `form { display: grid; gap: 12px; } .hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; } .small { font-size: 13px; margin: 0; }`,
})
export class PurchaseForm {
  readonly slug = input.required<string>();
  readonly name = input.required<string>();
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  protected f = { name: this.auth.user()?.name ?? '', email: this.auth.user()?.email ?? '', cellphone: '', company: '', quantity: 1, subject: 'Purchase', message: '', acceptPrivacy: false, website: '' };
  protected busy = signal(false);
  protected err = signal<string | null>(null);
  protected done = signal<string | null>(null);
  private fields = signal<Record<string, string>>({});
  protected fe = (k: string) => this.fields()[k] ?? null;

  async send() {
    this.busy.set(true);
    this.err.set(null);
    this.fields.set({});
    try {
      const r = await firstValueFrom(this.http.post<{ reference: string }>('/api/public/purchase-enquiry', { ...this.f, quantity: Number(this.f.quantity) || 1, product: this.slug(), subject: `${this.f.subject}: ${this.name()}` }));
      this.done.set(r.reference);
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(Object.keys(a.fields).length ? 'Please check the highlighted fields.' : a.message);
    } finally {
      this.busy.set(false);
    }
  }
}

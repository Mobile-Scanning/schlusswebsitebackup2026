import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnyRow, CustomerApi, DEMO_STATUS_TEXT } from '../core/account-api';
import { AuthService, toApiError } from '../core/auth.service';
import { COUNTRIES } from '../shared/countries';
import { HueKey } from '../shared/palette';
import { SchPuzzleComplete } from '../shared/puzzle-complete';

const PLATFORM: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', web: 'Web', any: 'All platforms' };
const size = (b: number | null) => (b == null ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

/**
 * Demo download for one product.
 *  1. signed out → register / sign in, then straight back here
 *  2. business details – only what's missing from the customer's profile (saved once, never asked again)
 *  3. confirm product, version, demo length and start rule; accept demo terms (POPIA notice)
 *  4. download through a personal, short-lived link; the demo record and download are saved on the server
 *  5. installation steps + link to the customer's setup area
 */
@Component({
  selector: 'sch-demo-download',
  imports: [FormsModule, RouterLink, DatePipe, SchPuzzleComplete],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let u = auth.user();
    <div class="dd">
      <ul class="facts">
        <li><strong>{{ demo().days }}-day demo</strong> · counted {{ demo().startOn === 'activation' ? 'from first activation in the software' : 'from your first download' }}</li>
        <li>Version {{ demo().version }} · {{ platforms() }}</li>
        <li>Dates are kept by SCHLUSS – one demo per customer per product.</li>
      </ul>

      @if (!u) {
        <p>Create a free SCHLUSS account (or sign in) to download the {{ name() }} demo. You’ll come straight back here.</p>
        <div class="row">
          <a class="btn btn-primary" routerLink="/register" [queryParams]="{ next: back() }">Create a free account</a>
          <a class="btn btn-ghost" routerLink="/login" [queryParams]="{ next: back() }">Sign in</a>
        </div>
      } @else if (u.type !== 'customer') {
        <div class="alert" role="note">Demo downloads are for customer accounts. You’re signed in as a {{ u.type === 'staff' ? 'SCHLUSS staff member' : 'business partner' }}.</div>
      } @else if (done(); as r) {
        <sch-puzzle-complete [hue]="hue()" label="Demo download started" />
        <div class="alert alert-ok" role="status">
          <strong>Your download has started.</strong> If it doesn’t, <a [href]="r.url">click here</a> (the link works for 10 minutes).
          Demo licence: <code>{{ r.demo.licenceKey }}</code> – you may need it when activating.
        </div>
        <div class="next">
          <h3>Next: install and activate</h3>
          @if (r.instructions) { <p class="keep-lines">{{ r.instructions }}</p> }
          <p class="muted">{{ r.demo.startOn === 'activation' ? 'Your ' + demo().days + '-day demo starts when you activate it in the software.' : 'Your demo runs until ' + ((r.demo.expiresAt | date: 'd MMMM y') ?? '') + '.' }}</p>
          <div class="row"><a class="btn btn-primary" [routerLink]="r.setupUrl">Open my step-by-step setup guide</a><a class="btn btn-ghost" routerLink="/account">My account</a></div>
        </div>
      } @else {
        @if (prep(); as pr) {
          @if (pr.existing; as ex) {
            <div class="alert" [class.alert-ok]="!ended(ex.status)" role="status">
              <strong>Your demo: {{ statusText[ex.status] }}.</strong>
              @if (ex.expiresAt) { {{ ended(ex.status) ? 'It ended on' : 'It runs until' }} {{ ex.expiresAt | date: 'd MMMM y' }}. }
              @else if (ex.status === 'awaiting_activation') { The {{ ex.days }}-day period starts when you activate it. }
              Licence <code>{{ ex.licenceKey }}</code>.
              @if (ended(ex.status)) { <br />Want to keep using {{ name() }}? <a routerLink="/contact" [queryParams]="{ type: 'purchase', product: slug(), subject: 'Package enquiry: ' + name() }">Talk to us about packages</a>. }
            </div>
          }
          @if (pr.existing && !ended(pr.existing.status) && !showForm()) {
            <div class="row"><button class="btn btn-primary" type="button" (click)="showForm.set(true)">Download again</button><a class="btn btn-ghost" [routerLink]="['/account/products', slug()]">My setup guide</a></div>
          } @else if (!pr.existing || !ended(pr.existing.status)) {
            @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
            <form class="steps" (ngSubmit)="download()" novalidate>
              <fieldset>
                <legend><span class="n">1</span> Your business details</legend>
                <p class="muted small">Signed in as {{ pr.profile.name }} ({{ pr.profile.email }}). We save these details to your account so you won’t be asked again.</p>
                <div class="form-row">
                  <div class="field"><label for="dd-co">Business / company name</label><input id="dd-co" class="input" name="co" [(ngModel)]="f.company" autocomplete="organization" />@if (fe('profile.company')) {<span class="error">{{ fe('profile.company') }}</span>}</div>
                  <div class="field"><label for="dd-ph">Contact number</label><input id="dd-ph" class="input" name="ph" [(ngModel)]="f.cellphone" autocomplete="tel" inputmode="tel" />@if (fe('profile.cellphone')) {<span class="error">{{ fe('profile.cellphone') }}</span>}</div>
                  <div class="field"><label for="dd-cn">Country</label><select id="dd-cn" class="select" name="cn" [(ngModel)]="f.country">@for (c of countries; track c[0]) {<option [value]="c[0]">{{ c[1] }}</option>}</select></div>
                  <div class="field"><label for="dd-pr">Province / region <span class="muted">(optional)</span></label><input id="dd-pr" class="input" name="pr" [(ngModel)]="f.province" /></div>
                  <div class="field"><label for="dd-bt">Type of business <span class="muted">(optional)</span></label><input id="dd-bt" class="input" name="bt" [(ngModel)]="f.businessType" list="dd-types" placeholder="e.g. Retail, Wholesale, Logistics" /><datalist id="dd-types"><option value="Retail"></option><option value="Wholesale"></option><option value="Hospitality"></option><option value="Logistics"></option><option value="Manufacturing"></option><option value="Professional services"></option><option value="Other"></option></datalist></div>
                </div>
              </fieldset>
              <fieldset>
                <legend><span class="n">2</span> Choose your download</legend>
                <div class="files">
                  @for (fl of pr.demo.files; track fl.id) {
                    <label class="file" [class.on]="fileId === fl.id"><input type="radio" name="file" [value]="fl.id" [(ngModel)]="fileId" /><span><strong>{{ fl.label }}</strong><span class="muted small">{{ platform[fl.platform] ?? fl.platform }} · {{ sz(fl.size) }}</span></span></label>
                  }
                </div>
                @if (pr.demo.requirements) { <details><summary>System requirements</summary><p class="keep-lines small">{{ pr.demo.requirements }}</p></details> }
              </fieldset>
              <fieldset>
                <legend><span class="n">3</span> Confirm</legend>
                <div class="confirm">
                  <p><strong>{{ name() }} demo {{ pr.demo.version }}</strong> – {{ pr.demo.days }} days, {{ pr.demo.startRule }}.</p>
                  <ul class="small">
                    <li>The demo is for evaluating {{ name() }} in your business; one demo per customer per product.</li>
                    <li>The demo period is controlled by SCHLUSS’s servers – reinstalling or downloading again doesn’t restart it.</li>
                    <li>We use your details to provide the demo, help you set it up and contact you about it. See our <a routerLink="/privacy" target="_blank">privacy policy</a> (POPIA).</li>
                  </ul>
                  <label class="check"><input type="checkbox" name="terms" [(ngModel)]="accept" /><span>I accept the demo terms and the use of my information as described.</span></label>
                </div>
              </fieldset>
              <button class="btn btn-primary" type="submit" [disabled]="busy() || !accept || !fileId">@if (busy()) { <span class="spinner" aria-hidden="true"></span> } Download the {{ name() }} demo</button>
            </form>
          }
        } @else if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> } @else { <p class="muted">Loading your details…</p> }
      }
    </div>
  `,
  styles: `
    .dd { display: grid; gap: 16px; }
    .facts { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 15px; }
    .facts li::before { content: '◆'; color: var(--accent); margin-right: 8px; font-size: 11px; }
    p { margin: 0; max-width: 64ch; } .small { font-size: 13px; } .keep-lines { white-space: pre-line; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; }
    .steps { display: grid; gap: 16px; }
    fieldset { border: 1px solid var(--line); border-radius: var(--r-lg, 16px); padding: 16px; margin: 0; min-width: 0; background: color-mix(in srgb, var(--accent) 4%, transparent); }
    legend { display: flex; align-items: center; gap: 10px; font-weight: 700; color: var(--heading); padding: 0 6px; }
    .n { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--accent); color: #fff; font-size: 13px; }
    .files { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .file { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border-radius: var(--r); border: 1px solid var(--line); cursor: pointer; }
    .file.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .file span { display: grid; gap: 2px; }
    .confirm ul { margin: 8px 0 12px; padding-left: 18px; display: grid; gap: 4px; }
    details summary { cursor: pointer; font-size: 14px; margin-top: 10px; }
    code { font-family: var(--f-mono); font-size: 13px; padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--heading); }
    .next { display: grid; gap: 10px; }
    .next h3 { margin: 0; }
    .alert { margin: 0; }
  `,
})
export class DemoDownload {
  readonly slug = input.required<string>();
  readonly name = input.required<string>();
  readonly demo = input.required<{ days: number; startOn: string; version: string; files: { id: number; platform: string; label: string; size: number | null }[] }>();
  readonly hue = input<HueKey>('blue');
  protected auth = inject(AuthService);
  private api = inject(CustomerApi);
  protected prep = signal<AnyRow | null>(null);
  protected done = signal<AnyRow | null>(null);
  protected busy = signal(false);
  protected showForm = signal(false);
  protected err = signal<string | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected platform = PLATFORM;
  protected statusText = DEMO_STATUS_TEXT;
  protected countries = COUNTRIES;
  protected sz = size;
  protected f = { company: '', cellphone: '', country: 'ZA', province: '', businessType: '' };
  protected fileId: number | null = null;
  protected accept = false;
  protected platforms = computed(() => [...new Set(this.demo().files.map((f) => PLATFORM[f.platform] ?? f.platform))].join(', '));
  protected back = computed(() => `/products/${this.slug()}#download`);
  protected ended = (s: string) => ['expired', 'revoked', 'suspended'].includes(s);
  protected fe = (k: string) => this.fields()[k] ?? null;

  constructor() {
    effect(() => {
      const u = this.auth.user();
      const slug = this.slug();
      if (u?.type !== 'customer' || typeof window === 'undefined') return;
      this.api
        .prepareDemo(slug)
        .then((p) => {
          this.prep.set(p);
          const pr = p.profile ?? {};
          this.f = { company: pr.company ?? '', cellphone: pr.cellphone ?? '', country: pr.country ?? 'ZA', province: pr.province ?? '', businessType: pr.businessType ?? '' };
          this.fileId = p.demo?.files?.length === 1 ? p.demo.files[0].id : this.pickFile(p.demo?.files ?? []);
        })
        .catch((e) => this.err.set(toApiError(e).message));
    });
  }

  /** Suggest the file for the visitor's operating system. */
  private pickFile(files: { id: number; platform: string }[]) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const os = /Android/i.test(ua) ? 'android' : /iPhone|iPad/i.test(ua) ? 'ios' : /Mac/i.test(ua) ? 'macos' : /Win/i.test(ua) ? 'windows' : /Linux/i.test(ua) ? 'linux' : '';
    return (files.find((f) => f.platform === os) ?? files[0])?.id ?? null;
  }

  async download() {
    if (!this.fileId || !this.accept) return;
    this.busy.set(true);
    this.err.set(null);
    this.fields.set({});
    try {
      const r = await this.api.downloadDemo(this.slug(), { fileId: this.fileId, acceptTerms: true, profile: { ...this.f, cellphone: this.f.cellphone || undefined } });
      this.done.set(r);
      // The file is served as an attachment, so the page stays here while the browser downloads it.
      window.location.assign(r.url);
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(a.message);
    } finally {
      this.busy.set(false);
    }
  }
}

import { SchPuzzleComplete } from '../shared/puzzle-complete';
import { HueKey } from '../shared/palette';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ApiError, AuthService, toApiError } from '../core/auth.service';
import { PublicApi } from '../core/public-api';
import { COUNTRIES } from '../shared/countries';

/** Demo request form – used on product pages and the Request a demo page. */
@Component({
  selector: 'sch-demo-form',
  imports: [ReactiveFormsModule, RouterLink, SchPuzzleComplete],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ref()) {
      <sch-puzzle-complete [hue]="hue()" label="Demo request sent" />
      <div class="alert alert-ok done" role="status">
        <strong>Thank you – your demo request has been sent.</strong><br />
        Your reference is <strong>{{ ref() }}</strong>. We've emailed you a copy and will contact you to arrange a time.
      </div>
    } @else {
      @if (err() && !hasFieldErrors()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        @if (!fixedProduct()) {
          <div class="field">
            <label for="d-product">Product</label>
            <select id="d-product" class="select" formControlName="product">
              <option value="">Not sure yet / general demo</option>
              @for (p of products(); track p.slug) { <option [value]="p.slug">{{ p.name }}</option> }
            </select>
          </div>
        }
        <div class="form-row">
          <div class="field"><label for="d-name">Full name</label><input id="d-name" class="input" autocomplete="name" formControlName="name" />@if (e('name')) {<span class="error">{{ e('name') }}</span>}</div>
          <div class="field"><label for="d-email">Email</label><input id="d-email" class="input" type="email" autocomplete="email" formControlName="email" />@if (e('email')) {<span class="error">{{ e('email') }}</span>}</div>
          <div class="field"><label for="d-cell">Cellphone</label><input id="d-cell" class="input" type="tel" autocomplete="tel" formControlName="cellphone" />@if (e('cellphone')) {<span class="error">{{ e('cellphone') }}</span>}</div>
          <div class="field"><label for="d-company">Company <span class="muted">(optional)</span></label><input id="d-company" class="input" autocomplete="organization" formControlName="company" /></div>
          <div class="field"><label for="d-country">Country</label>
            <select id="d-country" class="select" formControlName="country">@for (c of countries; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select>
          </div>
          <div class="field"><label for="d-type">How would you like the demo?</label>
            <select id="d-type" class="select" formControlName="preferredType">
              <option value="live">Live online session</option>
              <option value="onsite">At my business</option>
              <option value="video">Send me a video walkthrough</option>
              <option value="interactive">Interactive demo access</option>
            </select>
          </div>
          <div class="field"><label for="d-date">Preferred date <span class="muted">(optional)</span></label><input id="d-date" class="input" type="date" [min]="today" formControlName="preferredDate" /></div>
        </div>
        <div class="field"><label for="d-msg">What would you like to see? <span class="muted">(optional)</span></label><textarea id="d-msg" class="textarea" rows="3" formControlName="message"></textarea></div>
        <label class="check"><input type="checkbox" formControlName="acceptPrivacy" /><span>I agree that SCHLUSS may use these details to arrange my demo, as described in the <a routerLink="/privacy" target="_blank">privacy policy</a>.</span></label>
        @if (e('acceptPrivacy')) { <p class="error ml">{{ e('acceptPrivacy') }}</p> }
        <label class="check"><input type="checkbox" formControlName="marketingOptIn" /><span>Also send me occasional product news. <span class="muted">(Optional)</span></span></label>
        <button class="btn btn-primary" type="submit" [disabled]="busy()">@if (busy()) {<span class="spinner" aria-hidden="true"></span>} Request demo</button>
      </form>
    }
  `,
  styles: `.ml { margin: -6px 0 12px 30px; font-size: 13px; color: var(--danger); } .done { font-size: 15px; line-height: 1.6; }`,
})
export class DemoForm {
  readonly fixedProduct = input<string | null>(null);
  readonly initialProduct = input<string | null>(null);
  /** Colour of the success puzzle (matches the page or product). */
  readonly hue = input<HueKey>('blue');
  private api = inject(PublicApi);
  private auth = inject(AuthService);
  protected countries = COUNTRIES;
  protected today = new Date().toISOString().slice(0, 10);
  protected products = toSignal(this.api.products({ perPage: 48, sort: 'name' }).pipe(map((r) => r.data)), { initialValue: [] });
  protected form = inject(FormBuilder).nonNullable.group({
    product: [''],
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    cellphone: ['', [Validators.required, Validators.pattern(/^\+?[0-9 ()-]{7,20}$/)]],
    company: [''],
    country: ['ZA'],
    preferredType: ['live'],
    preferredDate: [''],
    message: [''],
    acceptPrivacy: [false, Validators.requiredTrue],
    marketingOptIn: [false],
  });
  protected busy = signal(false);
  protected ref = signal<string | null>(null);
  protected err = signal<ApiError | null>(null);
  private submitted = signal(false);
  private msgs: Record<string, string> = { name: 'Enter your name', email: 'Enter a valid email address', cellphone: 'Enter a valid cellphone number', acceptPrivacy: 'Please accept so we can contact you' };
  protected hasFieldErrors = () => Object.keys(this.err()?.fields ?? {}).length > 0;

  ngOnInit() {
    const u = this.auth.user();
    this.form.patchValue({ product: this.fixedProduct() ?? this.initialProduct() ?? '', name: u?.name ?? '', email: u?.email ?? '' });
  }

  protected e(name: keyof typeof this.form.controls) {
    const server = this.err()?.fields[name];
    if (server) return server;
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted()) ? this.msgs[name] ?? 'Required' : null;
  }

  async submit() {
    this.submitted.set(true);
    this.err.set(null);
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      const r = await this.api.submit('demo-requests', { ...v, product: this.fixedProduct() ?? v.product });
      this.ref.set(r.reference);
    } catch (e) {
      this.err.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

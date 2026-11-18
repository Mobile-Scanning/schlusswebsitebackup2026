import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ApiError, AuthService, toApiError } from '../core/auth.service';
import { PublicApi } from '../core/public-api';
import { ORG_LD, SeoService } from '../core/seo.service';
import { PIECES } from '../shared/brand';
import { SchPuzzle3d } from '../shared/puzzle3d';
import { SchPuzzleField } from '../shared/puzzle-field';
import { SchPuzzleComplete } from '../shared/puzzle-complete';
import { HUES, hueStyle } from '../shared/palette';
import { COUNTRIES } from '../shared/countries';
import { Reveal } from '../shared/reveal';
import { SchIcon } from '../shared/icons';
import { DemoForm } from './demo-form';

/* ================================ Contact ================================ */
@Component({
  selector: 'sch-contact',
  imports: [ReactiveFormsModule, RouterLink, SchPuzzleField, SchPuzzleComplete],
  host: { style: '--accent: #E7458C; --accent-2: #A42AC9; --accent-glow: #FFA3CB' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-hero zone zone-sunset"><sch-puzzle-field [hues]="['magenta', 'orange', 'amber']" calm="left" /><div class="wrap"><span class="eyebrow">Contact</span><h1>Let's find your missing piece.</h1><p class="lead">Questions about a product, pricing, licensing or support? Send us a message and we'll get back to you.</p></div></header>
    <div class="wrap section grid">
      <div class="card form-card corners"><span class="fc c0" aria-hidden="true"></span><span class="fc c1" aria-hidden="true"></span><span class="fc c2" aria-hidden="true"></span><span class="fc c3" aria-hidden="true"></span>
        @if (ref()) {
          <sch-puzzle-complete hue="magenta" label="Message sent" />
          <div class="alert alert-ok" role="status"><strong>Message sent.</strong><br />Your reference is <strong>{{ ref() }}</strong>. {{ dept() === 'sales' ? 'Our sales team' : 'Our support team' }} will reply as soon as we can, and we've emailed you a copy.</div>
          <button class="btn btn-ghost" type="button" (click)="reset()">Send another message</button>
        } @else {
          @if (err() && !hasFieldErrors()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="form-row">
              <div class="field"><label for="c-name">Full name</label><input id="c-name" class="input" autocomplete="name" formControlName="name" />@if (e('name')) {<span class="error">{{ e('name') }}</span>}</div>
              <div class="field"><label for="c-email">Email</label><input id="c-email" class="input" type="email" autocomplete="email" formControlName="email" />@if (e('email')) {<span class="error">{{ e('email') }}</span>}</div>
              <div class="field"><label for="c-cell">Cellphone <span class="muted">(optional)</span></label><input id="c-cell" class="input" type="tel" autocomplete="tel" formControlName="cellphone" /></div>
              <div class="field"><label for="c-company">Company <span class="muted">(optional)</span></label><input id="c-company" class="input" autocomplete="organization" formControlName="company" /></div>
            </div>
            <div class="field"><label for="c-type">What do you need?</label>
              <select id="c-type" class="select" formControlName="enquiryType">
                <option value="technical">Technical support – installation, errors, activation</option>
                <option value="general">General assistance – account, demos, questions</option>
                <option value="purchase">Purchase / sales enquiry – buy or get a quotation</option>
              </select>
              <span class="hint">{{ form.controls.enquiryType.value === 'purchase' ? 'This goes to our sales team.' : 'This goes to our support team.' }}</span>
            </div>
            <div class="field"><label for="c-product">Product <span class="muted">(optional)</span></label>
              <select id="c-product" class="select" formControlName="product"><option value="">General enquiry</option>@for (p of products(); track p.slug) {<option [value]="p.slug">{{ p.name }}</option>}</select>
            </div>
            <div class="field"><label for="c-subject">Subject</label><input id="c-subject" class="input" formControlName="subject" />@if (e('subject')) {<span class="error">{{ e('subject') }}</span>}</div>
            <div class="field"><label for="c-msg">Message</label><textarea id="c-msg" class="textarea" rows="6" formControlName="message"></textarea>@if (e('message')) {<span class="error">{{ e('message') }}</span>}</div>
            <label class="check"><input type="checkbox" formControlName="acceptPrivacy" /><span>I agree that SCHLUSS may use these details to respond to me, as described in the <a routerLink="/privacy" target="_blank">privacy policy</a>.</span></label>
            @if (e('acceptPrivacy')) { <p class="error ml">{{ e('acceptPrivacy') }}</p> }
            <button class="btn btn-primary" type="submit" [disabled]="busy()">@if (busy()) {<span class="spinner" aria-hidden="true"></span>} Send message</button>
          </form>
        }
      </div>
      <aside class="side">
        @if (contact(); as c) {
          @if (c.email || c.phone || c.whatsapp || c.address || c.hours) {
            <div class="card">
              <h2>Contact details</h2>
              <dl>
                @if (c.email) { <dt>Email</dt><dd><a [href]="'mailto:' + c.email">{{ c.email }}</a></dd> }
                @if (c.phone) { <dt>Phone</dt><dd><a [href]="'tel:' + c.phone.split(' ').join('')">{{ c.phone }}</a></dd> }
                @if (c.whatsapp) { <dt>WhatsApp</dt><dd><a [href]="'https://wa.me/' + c.whatsapp.replace(nonDigits, '')" target="_blank" rel="noopener">{{ c.whatsapp }}</a></dd> }
                @if (c.address) { <dt>Address</dt><dd class="prose">{{ c.address }}</dd> }
                @if (c.hours) { <dt>Hours</dt><dd>{{ c.hours }}</dd> }
              </dl>
            </div>
          }
        }
        <div class="card"><h2>Want to see it working?</h2><p class="muted">Book a live demonstration of any SCHLUSS product.</p><a class="btn btn-ghost" routerLink="/request-demo">Request a demo</a></div>
        <div class="card"><h2>Existing customer?</h2><p class="muted">Sign in to see your products, licences and learning material.</p><a class="btn btn-ghost" routerLink="/login">Sign in</a></div>
      </aside>
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 24px; align-items: start; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .form-card { padding: clamp(20px, 4vw, 36px); }
    .side { display: grid; gap: 16px; }
    .side h2 { font-size: 18px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; }
    dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
    .ml { margin: -6px 0 12px 30px; font-size: 13px; color: var(--danger); }
  `,
})
export class ContactPage {
  private api = inject(PublicApi);
  private auth = inject(AuthService);
  protected nonDigits = /\D/g;
  protected contact = toSignal(this.api.site().pipe(map((s) => s.contact)));
  protected products = toSignal(this.api.products({ perPage: 48, sort: 'name' }).pipe(map((r) => r.data)), { initialValue: [] });
  private qp = inject(ActivatedRoute).snapshot.queryParamMap;
  protected form = inject(FormBuilder).nonNullable.group({
    name: [this.auth.user()?.name ?? '', [Validators.required, Validators.minLength(2)]],
    email: [this.auth.user()?.email ?? '', [Validators.required, Validators.email]],
    cellphone: [''],
    company: [''],
    product: [this.qp.get('product') ?? ''],
    enquiryType: [(['technical', 'general', 'purchase'].includes(this.qp.get('type') ?? '') ? this.qp.get('type')! : 'general') as 'technical' | 'general' | 'purchase'],
    subject: [(this.qp.get('subject') ?? '').slice(0, 200), [Validators.required, Validators.minLength(3)]],
    message: ['', [Validators.required, Validators.minLength(10)]],
    acceptPrivacy: [false, Validators.requiredTrue],
  });
  protected busy = signal(false);
  protected ref = signal<string | null>(null);
  protected dept = signal('support');
  protected err = signal<ApiError | null>(null);
  private submitted = signal(false);
  private msgs: Record<string, string> = { name: 'Enter your name', email: 'Enter a valid email address', subject: 'Add a subject', message: 'Tell us a little more (at least 10 characters)', acceptPrivacy: 'Please accept so we can reply' };
  protected hasFieldErrors = () => Object.keys(this.err()?.fields ?? {}).length > 0;

  constructor() {
    inject(SeoService).set({ title: 'Contact', description: 'Contact SCHLUSS about products, pricing, licensing, partnerships or support.', path: '/contact' });
  }
  protected e(name: keyof typeof this.form.controls) {
    const s = this.err()?.fields[name];
    if (s) return s;
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted()) ? this.msgs[name] ?? 'Required' : null;
  }
  async submit() {
    this.submitted.set(true);
    this.err.set(null);
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const r = (await this.api.submit('contact', this.form.getRawValue())) as { reference: string; department?: string };
      this.dept.set(r.department ?? 'support');
      this.ref.set(r.reference);
    } catch (e) {
      this.err.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  reset() {
    this.ref.set(null);
    this.submitted.set(false);
    this.form.patchValue({ subject: '', message: '', acceptPrivacy: false });
  }
}

/* ================================ Request a demo ================================ */
@Component({
  selector: 'sch-request-demo',
  imports: [DemoForm, SchPuzzleField],
  host: { style: '--accent: #FF7A2F; --accent-2: #E7458C; --accent-glow: #FFB58A' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-hero zone zone-sunset"><sch-puzzle-field [hues]="['orange', 'magenta', 'amber', 'violet']" calm="left" /><div class="wrap"><span class="eyebrow">Demonstrations</span><h1>See SCHLUSS in action.</h1><p class="lead">Choose a product and how you'd like to see it – live online, at your business, or as a recorded walkthrough.</p></div></header>
    <div class="wrap section"><div class="card box glass corners"><span class="fc c0" aria-hidden="true"></span><span class="fc c1" aria-hidden="true"></span><span class="fc c2" aria-hidden="true"></span><span class="fc c3" aria-hidden="true"></span><sch-demo-form [initialProduct]="product" hue="orange" /></div></div>
  `,
  styles: `.box { max-width: 860px; padding: clamp(20px, 4vw, 36px); }`,
})
export class RequestDemoPage {
  protected product = inject(ActivatedRoute).snapshot.queryParamMap.get('product');
  constructor() {
    inject(SeoService).set({ title: 'Request a demo', description: 'Book a live or recorded demonstration of SCHLUSS software for your business.', path: '/request-demo' });
  }
}

/* ================================ Partners ================================ */
@Component({
  selector: 'sch-partners',
  imports: [ReactiveFormsModule, RouterLink, Reveal, SchIcon, SchPuzzleField, SchPuzzleComplete],
  host: { style: '--accent: #FFB020; --accent-2: #FF7A2F; --accent-glow: #FFD68A' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let pc = content();
    <header class="page-hero ph zone zone-ember"><sch-puzzle-field [hues]="['amber', 'orange', 'violet']" calm="left" /><div class="wrap"><span class="eyebrow">Business partners</span><h1>{{ pc?.title }}</h1><p class="lead">{{ pc?.subtitle }}</p><div class="ctas"><a class="btn btn-primary" routerLink="." fragment="apply">Apply to become a partner</a><a class="btn btn-ghost" routerLink="/login">Partner sign in</a></div></div></header>

    <section class="wrap section">
      <div class="benefits">
        @for (b of pc?.benefits ?? []; track $index) {
          <div class="b tab" [schReveal]="$index" [style]="bStyle($index)" [style.--i]="$index">
            <span class="icon-box"><sch-icon [name]="benefitIcons[$index % benefitIcons.length]" /></span>
            <h3>{{ b.title }}</h3><p class="muted">{{ b.body }}</p>
          </div>
        }
      </div>
      @if (pc?.steps?.length) {
        <ol class="steps" schReveal>
          @for (s of pc!.steps; track $index) { <li><span>{{ $index + 1 }}</span>{{ s }}</li> }
        </ol>
      }
    </section>

    <section id="apply" class="wrap apply">
      <div class="card form-card">
        <h2>Partner application</h2>
        <p class="muted">Tell us about your business. Applications are reviewed by the SCHLUSS team – you'll receive a reference number and we'll email you the outcome.</p>
        @if (ref()) {
          <sch-puzzle-complete hue="amber" label="Application received" />
          <div class="alert alert-ok" role="status"><strong>Application received – thank you!</strong><br />Your reference is <strong>{{ ref() }}</strong>. We've emailed you a confirmation. Status: Pending review.</div>
        } @else {
          @if (err() && !hasFieldErrors()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <fieldset><legend>Business</legend>
              <div class="form-row">
                <div class="field"><label for="p-bn">Business name</label><input id="p-bn" class="input" autocomplete="organization" formControlName="businessName" />@if (e('businessName')) {<span class="error">{{ e('businessName') }}</span>}</div>
                <div class="field"><label for="p-bt">Business type</label>
                  <select id="p-bt" class="select" formControlName="businessType"><option value="">Select…</option>@for (t of businessTypes; track t) {<option [value]="t">{{ t }}</option>}</select>
                </div>
                <div class="field"><label for="p-ind">Industry</label><input id="p-ind" class="input" formControlName="industry" placeholder="e.g. Retail, IT services" /></div>
                <div class="field"><label for="p-yrs">Years of experience</label><input id="p-yrs" class="input" type="number" min="0" max="100" inputmode="numeric" formControlName="yearsExperience" /></div>
                <div class="field"><label for="p-web">Website <span class="muted">(optional)</span></label><input id="p-web" class="input" type="url" formControlName="website" placeholder="https://" />@if (e('website')) {<span class="error">{{ e('website') }}</span>}</div>
                <div class="field"><label for="p-country">Country</label><select id="p-country" class="select" formControlName="country">@for (c of countries; track c[0]) {<option [value]="c[0]">{{ c[1] }}</option>}</select></div>
              </div>
              <div class="field"><label for="p-addr">Business address</label><textarea id="p-addr" class="textarea" rows="2" autocomplete="street-address" formControlName="address"></textarea></div>
            </fieldset>
            <fieldset><legend>Contact person</legend>
              <div class="form-row">
                <div class="field"><label for="p-cn">Full name</label><input id="p-cn" class="input" autocomplete="name" formControlName="contactName" />@if (e('contactName')) {<span class="error">{{ e('contactName') }}</span>}</div>
                <div class="field"><label for="p-em">Email</label><input id="p-em" class="input" type="email" autocomplete="email" formControlName="email" />@if (e('email')) {<span class="error">{{ e('email') }}</span>}</div>
                <div class="field"><label for="p-cell">Cellphone</label><input id="p-cell" class="input" type="tel" autocomplete="tel" formControlName="cellphone" />@if (e('cellphone')) {<span class="error">{{ e('cellphone') }}</span>}</div>
              </div>
            </fieldset>
            <fieldset><legend>Your services</legend>
              <div class="field"><label for="p-svc">Services you offer</label><textarea id="p-svc" class="textarea" rows="3" formControlName="servicesOffered" placeholder="e.g. POS installation, network support, training"></textarea></div>
              <div class="field"><label for="p-area">Areas of operation</label><input id="p-area" class="input" formControlName="areasOfOperation" placeholder="e.g. Gauteng, Western Cape" /></div>
              <div class="field"><label for="p-prod">Products you'd like to sell</label><input id="p-prod" class="input" formControlName="productsInterested" /></div>
              <div class="field"><label for="p-info">Anything else? <span class="muted">(optional)</span></label><textarea id="p-info" class="textarea" rows="3" formControlName="additionalInfo"></textarea></div>
            </fieldset>
            <label class="check"><input type="checkbox" formControlName="acceptTerms" /><span>I confirm the details are correct and accept the <a routerLink="/terms" target="_blank">terms</a> and <a routerLink="/privacy" target="_blank">privacy policy</a>. SCHLUSS may use these details to assess and manage this application.</span></label>
            @if (e('acceptTerms')) { <p class="error ml">{{ e('acceptTerms') }}</p> }
            <label class="check"><input type="checkbox" formControlName="marketingOptIn" /><span>Send me partner news and product updates. <span class="muted">(Optional)</span></span></label>
            <button class="btn btn-primary" type="submit" [disabled]="busy()">@if (busy()) {<span class="spinner" aria-hidden="true"></span>} Submit application</button>
          </form>
        }
      </div>
    </section>
  `,
  styles: `
    .ph h1 { max-width: 16ch; }
    .ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
    .benefits { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
    .b { padding: 26px; margin-top: 12px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line)); border-radius: var(--r-lg); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface) 60%); transition: translate .3s var(--ease); }
    .b:hover { translate: 0 -4px; }
    .b.tab::before { animation: join .7s ease both; animation-delay: calc(var(--i, 0) * 140ms + .25s); }
    @keyframes join { 40% { background: var(--accent); border-color: var(--accent); transform: translateY(-4px); } }
    @media (prefers-reduced-motion: reduce) { .b.tab::before { animation: none; } }
    :host-context(html.reduce-motion) .b.tab::before { animation: none; }
    .b .icon-box { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; border-radius: 12px; }
    .b h3 { margin-top: 16px; }
    .b h3 { font-size: 18px; margin: 14px 0 6px; } .b p { margin: 0; }
    .steps { list-style: none; padding: 0; margin: 40px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; counter-reset: s; }
    .steps li { display: flex; gap: 12px; align-items: center; padding: 18px; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--surface); font-weight: 600; color: var(--heading); }
    .steps span { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #111; font-weight: 700; flex-shrink: 0; }
    .steps li { background: linear-gradient(110deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface) 70%) !important; }
    .apply { padding-bottom: 40px; scroll-margin-top: 90px; }
    .form-card { max-width: 900px; margin: 0 auto; padding: clamp(20px, 4vw, 40px); }
    .form-card h2 { font-size: 26px; }
    fieldset { border: 0; padding: 0; margin: 22px 0 6px; }
    legend { font-weight: 600; font-size: 16px; color: var(--heading); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); width: 100%; }
    .ml { margin: -6px 0 12px 30px; font-size: 13px; color: var(--danger); }
  `,
})
export class PartnersPage {
  private api = inject(PublicApi);
  protected pieces = PIECES;
  protected benefitIcons = ['grid', 'book', 'briefcase', 'chart', 'users', 'shield'];
  private bHues = [HUES.amber, HUES.orange, HUES.violet, HUES.magenta, HUES.teal, HUES.blue];
  protected bStyle = (i: number) => hueStyle(this.bHues[i % this.bHues.length]);
  protected countries = COUNTRIES;
  protected businessTypes = ['IT services / reseller', 'Retail systems installer', 'Consultant', 'Software developer', 'Accounting / business services', 'Other'];
  protected content = toSignal(this.api.site().pipe(map((s) => s.partners)));
  protected form = inject(FormBuilder).nonNullable.group({
    businessName: ['', [Validators.required, Validators.minLength(2)]],
    contactName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    cellphone: ['', [Validators.required, Validators.pattern(/^\+?[0-9 ()-]{7,20}$/)]],
    address: [''],
    country: ['ZA'],
    website: [''],
    businessType: [''],
    industry: [''],
    yearsExperience: [null as number | null],
    servicesOffered: [''],
    areasOfOperation: [''],
    productsInterested: [''],
    additionalInfo: [''],
    acceptTerms: [false, Validators.requiredTrue],
    marketingOptIn: [false],
  });
  protected busy = signal(false);
  protected ref = signal<string | null>(null);
  protected dept = signal('support');
  protected err = signal<ApiError | null>(null);
  private submitted = signal(false);
  private msgs: Record<string, string> = { businessName: 'Enter your business name', contactName: 'Enter the contact person', email: 'Enter a valid email address', cellphone: 'Enter a valid cellphone number', acceptTerms: 'Please accept the terms and privacy policy' };
  protected hasFieldErrors = () => Object.keys(this.err()?.fields ?? {}).length > 0;
  protected hasSteps = computed(() => (this.content()?.steps.length ?? 0) > 0);

  constructor() {
    inject(SeoService).set({ title: 'Become a Business Partner', description: 'Grow with SCHLUSS: sell, implement and support connected business software. Apply to join the SCHLUSS partner network.', path: '/partners' });
  }
  protected e(name: keyof typeof this.form.controls) {
    const s = this.err()?.fields[name];
    if (s) return s;
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted()) ? this.msgs[name] ?? 'Required' : null;
  }
  async submit() {
    this.submitted.set(true);
    this.err.set(null);
    if (this.form.invalid) {
      document.querySelector<HTMLElement>('#apply .invalid, #apply input.ng-invalid')?.focus();
      return;
    }
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      this.ref.set((await this.api.submit('partner-applications', { ...v, yearsExperience: v.yearsExperience === null || (v.yearsExperience as unknown) === '' ? null : Number(v.yearsExperience) })).reference);
    } catch (e) {
      this.err.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

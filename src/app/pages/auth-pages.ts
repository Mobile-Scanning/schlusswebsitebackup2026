import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError, AuthService, toApiError } from '../core/auth.service';
import { SchLogo } from '../shared/brand';
import { TILE_PIECES } from '../shared/palette';
import { SchPuzzle3d } from '../shared/puzzle3d';
import { SchPuzzleField } from '../shared/puzzle-field';
import { COUNTRIES } from '../shared/countries';

/**
 * Shared frame for sign-in style pages: an aurora side with the SCHLUSS puzzle assembling,
 * and the form card, whose corner pieces lock into place as it appears.
 * The forms inside are unchanged – only their surroundings are animated.
 */
@Component({
  selector: 'sch-auth-frame',
  imports: [SchLogo, RouterLink, SchPuzzle3d, SchPuzzleField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="aw">
      <aside class="side zone zone-aurora" aria-hidden="true">
        <sch-puzzle-field [density]="1.2" [maxSize]="54" />
        <div class="side-in">
          <sch-puzzle3d [size]="200" />
          <p class="slogan">The last piece.<br /><span class="grad-text">The complete picture.</span></p>
        </div>
      </aside>
      <div class="main">
        <a routerLink="/" class="home" aria-label="SCHLUSS home"><sch-logo [size]="32" ink="#E9EDF2" gap="#0a0c14" /></a>
        <main class="card glass" id="main">
          <span class="corner c0" aria-hidden="true"><svg viewBox="0 0 200 200"><path [attr.d]="pieces[0]" /></svg></span>
          <span class="corner c1" aria-hidden="true"><svg viewBox="0 0 200 200"><path [attr.d]="pieces[1]" /></svg></span>
          <span class="corner c2" aria-hidden="true"><svg viewBox="0 0 200 200"><path [attr.d]="pieces[2]" /></svg></span>
          <span class="corner c3" aria-hidden="true"><svg viewBox="0 0 200 200"><path [attr.d]="pieces[3]" /></svg></span>
          <h1>{{ heading() }}</h1>
          @if (sub()) { <p class="muted sub">{{ sub() }}</p> }
          <ng-content />
        </main>
        <a routerLink="/" class="back">← Back to the website</a>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .aw { overflow-x: clip; min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); background: var(--bg); }
    .side { display: grid; place-items: center; border-right: 1px solid var(--line); }
    .side-in { display: grid; justify-items: center; gap: 8px; padding: 40px; }
    .slogan { margin: 0; text-align: center; font: 700 clamp(24px, 2.6vw, 36px)/1.1 var(--f-head); text-transform: uppercase; letter-spacing: -.02em; color: var(--heading); }
    .main { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 40px var(--gutter); position: relative;
      background: radial-gradient(60% 50% at 70% 20%, rgba(123,92,255,.14), transparent 70%), radial-gradient(50% 50% at 20% 90%, rgba(20,194,176,.1), transparent 70%); }
    .home { text-decoration: none; }
    .card { position: relative; width: 100%; max-width: 460px; padding: clamp(26px, 5vw, 40px); box-shadow: var(--shadow-lg); }
    :host(.wide) .card { max-width: 700px; }
    h1 { font-size: 28px; }
    .sub { margin: -4px 0 22px; }
    .back { font-size: 14px; color: var(--muted); }
    /* corner pieces fly in and lock onto the card */
    .corner { position: absolute; width: 44px; height: 44px; pointer-events: none; }
    .corner svg { width: 88px; height: 88px; overflow: visible; filter: drop-shadow(0 6px 10px rgba(0,0,0,.4)); }
    .corner path { stroke: rgba(255,255,255,.5); stroke-width: 3; }
    .c0 { left: -16px; top: -16px; } .c0 svg { margin: 0; } .c0 path { fill: var(--c-teal); }
    .c1 { right: -16px; top: -16px; } .c1 svg { margin-left: -44px; } .c1 path { fill: var(--c-violet); }
    .c2 { left: -16px; bottom: -16px; } .c2 svg { margin-top: -44px; } .c2 path { fill: var(--c-amber); }
    .c3 { right: -16px; bottom: -16px; } .c3 svg { margin: -44px 0 0 -44px; } .c3 path { fill: var(--c-blue); }
    .c0 { animation: k0 .4s cubic-bezier(.3,1.3,.45,1) both; }
    .c1 { animation: k1 .4s cubic-bezier(.3,1.3,.45,1) .05s both; }
    .c2 { animation: k2 .4s cubic-bezier(.3,1.3,.45,1) .1s both; }
    .c3 { animation: k3 .5s cubic-bezier(.3,1.4,.45,1) .18s both; }
    @keyframes k0 { from { transform: translate(-80px, -60px) rotate(-60deg); opacity: 0; } }
    @keyframes k1 { from { transform: translate(80px, -60px) rotate(60deg); opacity: 0; } }
    @keyframes k2 { from { transform: translate(-80px, 60px) rotate(50deg); opacity: 0; } }
    @keyframes k3 { from { transform: translate(110px, 90px) rotate(90deg); opacity: 0; } }
    @keyframes card-in { from { opacity: 0; transform: translateY(14px) scale(.98); } }
    @media (max-width: 900px) {
      .aw { grid-template-columns: 1fr; }
      .side { border-right: 0; border-bottom: 1px solid var(--line); }
      .side-in { grid-template-columns: auto 1fr; align-items: center; padding: 18px var(--gutter); gap: 0 12px; }
      .side sch-puzzle-field { display: none; }
      .side-in { grid-template-columns: 96px 1fr; }
      .side-in sch-puzzle3d { transform: scale(.42); transform-origin: center; margin: -78px -96px; }
      .slogan { text-align: left; font-size: 18px; }
    }
    @media (prefers-reduced-motion: reduce) { .corner, .card { animation: none; } }
    :host-context(html.reduce-motion) .corner, :host-context(html.reduce-motion) .card { animation: none; }
  `,
  host: { '[class.wide]': 'wide()', class: 'theme-site' },
})
export class AuthFrame {
  protected pieces = TILE_PIECES;
  readonly heading = input.required<string>();
  readonly sub = input('');
  readonly wide = input(false);
}

/* ---------------- Sign in ---------------- */
@Component({
  selector: 'sch-login',
  imports: [AuthFrame, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sch-auth-frame heading="Sign in" sub="Customers, partners and SCHLUSS staff all sign in here.">
      @if (err()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
      @if (ticket()) {
        <form (submit)="$event.preventDefault(); submitCode(mfa.value)" novalidate>
          <div class="field">
            <label for="mfa">Verification code</label>
            <input id="mfa" #mfa class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="12" autofocus placeholder="6-digit code" />
            <span class="hint">Open your authenticator app and enter the code for SCHLUSS. Lost your phone? Enter one of your recovery codes instead.</span>
          </div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">@if (busy()) { <span class="spinner" aria-hidden="true"></span> } Verify and sign in</button>
        </form>
        <p class="links"><button type="button" class="link" (click)="ticket.set(null); err.set(null)">← Use a different account</button></p>
      } @else {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="input" type="email" autocomplete="email" formControlName="email" [class.invalid]="bad('email')" />
          @if (bad('email')) { <span class="error">Enter a valid email address</span> }
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" class="input" type="password" autocomplete="current-password" formControlName="password" [class.invalid]="bad('password')" />
          @if (bad('password')) { <span class="error">Enter your password</span> }
        </div>
        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          @if (busy()) { <span class="spinner" aria-hidden="true"></span> } Sign in
        </button>
      </form>
      <p class="links">
        <a routerLink="/forgot-password">Forgot your password?</a>
        <span>New customer? <a routerLink="/register" [queryParams]="nextParams">Create an account</a></span>
      </p>
      }
    </sch-auth-frame>
  `,
  styles: `.links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; margin: 20px 0 0; font-size: 14px; }`,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected nextParams: Record<string, string> = (() => { const n = this.route.snapshot.queryParamMap.get('next'); const o: Record<string, string> = {}; if (n) o['next'] = n; return o; })();
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected busy = signal(false);
  protected err = signal<ApiError | null>(null);
  private submitted = signal(false);

  /** Set after a correct password when the account has two-step verification. */
  protected ticket = signal<string | null>(null);
  private async go(mfaSetupRequired?: boolean) {
    const next = this.route.snapshot.queryParamMap.get('next');
    // Only allow internal redirects ("/\\host" and "//host" would leave the site in some browsers).
    const safe = !!next && /^\/(?![\/\\])/.test(next);
    await this.router.navigateByUrl(mfaSetupRequired ? '/admin/security' : safe ? next! : this.auth.homeFor(this.auth.user()?.type));
  }
  async submitCode(code: string) {
    if (!code.trim() || this.busy()) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      await this.auth.mfaVerify(this.ticket()!, code.trim());
      await this.go();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'mfa_expired') this.ticket.set(null);
      this.err.set(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected bad(name: 'email' | 'password') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  async submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      const v = this.form.getRawValue();
      const r = await this.auth.login(v.email, v.password);
      if (r.mfa && r.ticket) {
        this.ticket.set(r.ticket); // second step: the code from the authenticator app
        return;
      }
      await this.go(r.mfaSetupRequired);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'email_unverified') {
        const next = this.route.snapshot.queryParamMap.get('next');
        await this.router.navigate(['/verify-email'], { queryParams: { email: this.form.getRawValue().email, ...(next ? { next } : {}) } });
        return;
      }
      this.err.set(err);
    } finally {
      this.busy.set(false);
    }
  }
}

/* ---------------- Customer registration ---------------- */
@Component({
  selector: 'sch-register',
  imports: [AuthFrame, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sch-auth-frame heading="Create your account" sub="Register to download products, manage trials and licences, and get support." [wide]="true">
      @if (err()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="form-row">
          <div class="field">
            <label for="name">Full name</label>
            <input id="name" class="input" autocomplete="name" formControlName="name" [class.invalid]="msg('name')" />
            @if (msg('name')) { <span class="error">{{ msg('name') }}</span> }
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" class="input" type="email" autocomplete="email" formControlName="email" [class.invalid]="msg('email')" />
            @if (msg('email')) { <span class="error">{{ msg('email') }}</span> }
          </div>
          <div class="field">
            <label for="cellphone">Cellphone <span class="muted">(optional)</span></label>
            <input id="cellphone" class="input" type="tel" autocomplete="tel" formControlName="cellphone" placeholder="+27 82 000 0000" [class.invalid]="msg('cellphone')" />
            @if (msg('cellphone')) { <span class="error">{{ msg('cellphone') }}</span> }
          </div>
          <div class="field">
            <label for="company">Business name <span class="muted">(optional)</span></label>
            <input id="company" class="input" autocomplete="organization" formControlName="company" />
          </div>
          <div class="field">
            <label for="country">Country</label>
            <select id="country" class="select" formControlName="country" autocomplete="country">
              @for (c of countries; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" class="input" type="password" autocomplete="new-password" formControlName="password" [class.invalid]="msg('password')" />
            <span class="hint">At least 10 characters, with letters and a number.</span>
            @if (msg('password')) { <span class="error">{{ msg('password') }}</span> }
          </div>
          <div class="field">
            <label for="confirmPassword">Confirm password</label>
            <input id="confirmPassword" class="input" type="password" autocomplete="new-password" formControlName="confirmPassword" [class.invalid]="msg('confirmPassword')" />
            @if (msg('confirmPassword')) { <span class="error">{{ msg('confirmPassword') }}</span> }
          </div>
        </div>
        <p class="hint otp-note">We’ll email you a 6-digit code to confirm your address before your account opens.</p>
        <label class="check">
          <input type="checkbox" formControlName="acceptPrivacy" />
          <span>I have read the <a routerLink="/privacy" target="_blank">privacy policy</a> and accept the <a routerLink="/terms" target="_blank">terms of use</a>. <span class="muted">(Required)</span></span>
        </label>
        @if (msg('acceptPrivacy')) { <p class="error-line">{{ msg('acceptPrivacy') }}</p> }
        <label class="check">
          <input type="checkbox" formControlName="marketingOptIn" />
          <span>Send me product news and offers. <span class="muted">(Optional – you can unsubscribe at any time.)</span></span>
        </label>
        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          @if (busy()) { <span class="spinner" aria-hidden="true"></span> } Create account
        </button>
      </form>
      <p class="links">Already registered? <a routerLink="/login" [queryParams]="loginParams">Sign in</a></p>
    </sch-auth-frame>
  `,
  styles: `.links { margin: 20px 0 0; font-size: 14px; } .otp-note { margin: 0 0 14px; } .error-line { color: var(--danger); font-size: 13px; margin: -6px 0 12px 30px; }`,
})
export class Register {
  private auth = inject(AuthService);
  private router = inject(Router);
  /** Where to continue after registering (e.g. /products/x#trial). */
  protected next = inject(ActivatedRoute).snapshot.queryParamMap.get('next');
  protected loginParams: Record<string, string> = this.next ? { next: this.next } : {};
  protected countries = COUNTRIES;
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    cellphone: ['', [Validators.pattern(/^\+?[0-9 ()-]{7,20}$/)]],
    company: [''],
    country: ['ZA', Validators.required],
    password: ['', [Validators.required, Validators.minLength(10)]],
    confirmPassword: ['', Validators.required],
    acceptPrivacy: [false, Validators.requiredTrue],
    marketingOptIn: [false],
  });
  protected busy = signal(false);
  protected err = signal<ApiError | null>(null);
  private submitted = signal(false);

  private readonly local: Record<string, string> = {
    name: 'Enter your full name',
    email: 'Enter a valid email address',
    cellphone: 'Enter a valid cellphone number',
    password: 'Use at least 10 characters',
    confirmPassword: 'Passwords don’t match',
    acceptPrivacy: 'You need to accept the privacy policy and terms',
  };

  protected msg(name: keyof typeof this.form.controls): string | null {
    const server = this.err()?.fields[name];
    if (server) return server;
    const c = this.form.controls[name];
    if (name === 'confirmPassword' && (c.touched || this.submitted()) && c.value !== this.form.controls.password.value) return this.local['confirmPassword'];
    return c.invalid && (c.touched || this.submitted()) ? (this.local[name] ?? 'Required') : null;
  }

  async submit() {
    this.submitted.set(true);
    this.err.set(null);
    const v = this.form.getRawValue();
    if (this.form.invalid || v.password !== v.confirmPassword) return;
    this.busy.set(true);
    try {
      const r = await this.auth.register(v);
      // Next: enter the emailed code. "next" (e.g. /products/x#demo) is kept for after verification.
      await this.router.navigate(['/verify-email'], { queryParams: { email: r.email, ...(this.next ? { next: this.next } : {}) } });
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'email_unverified') {
        await this.router.navigate(['/verify-email'], { queryParams: { email: v.email, ...(this.next ? { next: this.next } : {}) } });
        return;
      }
      this.err.set(err);
    } finally {
      this.busy.set(false);
    }
  }
}

/* ---------------- Forgot password ---------------- */
@Component({
  selector: 'sch-forgot',
  imports: [AuthFrame, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sch-auth-frame heading="Forgot your password?" sub="Enter your email and we'll send you a link to choose a new one.">
      @if (done()) {
        <div class="alert alert-ok" role="status">{{ done() }}</div>
        <a routerLink="/login" class="btn btn-ghost btn-block">Back to sign in</a>
      } @else {
        @if (err()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" class="input" type="email" autocomplete="email" formControlName="email" />
            @if (form.controls.email.invalid && form.controls.email.touched) { <span class="error">Enter a valid email address</span> }
          </div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">Send reset link</button>
        </form>
        <p style="margin: 20px 0 0; font-size: 14px"><a routerLink="/login">Back to sign in</a></p>
      }
    </sch-auth-frame>
  `,
})
export class Forgot {
  private auth = inject(AuthService);
  protected form = inject(FormBuilder).nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  protected busy = signal(false);
  protected done = signal<string | null>(null);
  protected err = signal<ApiError | null>(null);

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const r = await this.auth.forgot(this.form.getRawValue().email);
      this.done.set(r.message);
    } catch (e) {
      this.err.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/* ---------------- Reset password ---------------- */
@Component({
  selector: 'sch-reset',
  imports: [AuthFrame, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sch-auth-frame [heading]="welcome ? 'Welcome – set your password' : 'Choose a new password'" [sub]="welcome ? 'Choose a password to open your SCHLUSS partner portal.' : ''">
      @if (done()) {
        <div class="alert alert-ok" role="status">{{ welcome ? 'Your password is set. Sign in to open your portal.' : 'Your password has been changed. You\'ve been signed out on all devices.' }}</div>
        <a routerLink="/login" class="btn btn-primary btn-block">Sign in</a>
      } @else if (!token) {
        <div class="alert alert-error">This reset link is incomplete. Please request a new one.</div>
        <a routerLink="/forgot-password" class="btn btn-ghost btn-block">Request a new link</a>
      } @else {
        @if (err()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="password">New password</label>
            <input id="password" class="input" type="password" autocomplete="new-password" formControlName="password" />
            <span class="hint">At least 10 characters, with letters and a number.</span>
            @if (err()?.fields?.['password']) { <span class="error">{{ err()!.fields['password'] }}</span> }
          </div>
          <div class="field">
            <label for="confirm">Confirm new password</label>
            <input id="confirm" class="input" type="password" autocomplete="new-password" formControlName="confirm" />
            @if (mismatch()) { <span class="error">Passwords don't match</span> }
          </div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">Save new password</button>
        </form>
      }
    </sch-auth-frame>
  `,
})
export class Reset {
  private auth = inject(AuthService);
  protected token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  protected welcome = inject(ActivatedRoute).snapshot.queryParamMap.get('welcome') === '1';
  protected form = inject(FormBuilder).nonNullable.group({ password: ['', [Validators.required, Validators.minLength(10)]], confirm: [''] });
  protected busy = signal(false);
  protected done = signal(false);
  protected mismatch = signal(false);
  protected err = signal<ApiError | null>(null);

  async submit() {
    const v = this.form.getRawValue();
    this.mismatch.set(v.password !== v.confirm);
    if (this.form.invalid || this.mismatch() || !this.token) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      await this.auth.reset(this.token, v.password);
      this.done.set(true);
    } catch (e) {
      this.err.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/* ---------------- Email verification (6-digit code) ---------------- */
@Component({
  selector: 'sch-verify-email',
  imports: [AuthFrame, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sch-auth-frame heading="Check your email" [sub]="email ? (delivery() === 'problem' ? 'We could not email the code to ' + email + ' yet.' : delivery() === 'sent' ? 'We sent a 6-digit code to ' + email + '. It expires after 5 minutes.' : 'We are sending a 6-digit code to ' + email + '. It expires after 5 minutes.') : 'Enter the 6-digit code we emailed you.'">
      @if (!email) {
        <div class="alert alert-error">The email address is missing. Please register or sign in again.</div>
        <a routerLink="/login" class="btn btn-ghost btn-block">Sign in</a>
      } @else {
        @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
        @if (info()) { <div class="alert alert-ok" role="status">{{ info() }}</div> }
        @if (delivery() === 'problem' && !devInbox()) { <div class="alert alert-error" role="alert">Sorry – the email with your code could not be sent just now. Please wait a minute and choose “Send a new code”. If it keeps happening, contact us and we will help you finish signing up.</div> }
        <form (submit)="$event.preventDefault(); submit()" novalidate>
          <div class="field">
            <label for="code">Verification code</label>
            <div class="otp" (click)="focus()">
              <input id="code" #codeEl class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"
                [value]="code()" (input)="onInput(codeEl.value); codeEl.value = code()" aria-describedby="code-hint" />
              @for (i of slots; track i) { <span class="slot" [class.filled]="code().length > i" [class.active]="code().length === i" aria-hidden="true">{{ code()[i] ?? '' }}</span> }
            </div>
            <span class="hint" id="code-hint">Can’t find it? Check your spam or junk folder.</span>
          </div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="busy() || code().length !== 6">
            @if (busy()) { <span class="spinner" aria-hidden="true"></span> } Verify and continue
          </button>
        </form>
        @if (devInbox()) {
          <div class="alert" role="note"><strong>Testing on your computer?</strong> No mail server is set in <code>.env</code>, so the email isn't sent. <a href="/api/dev/mail" target="_blank" rel="noopener">Open the development inbox</a> to see the code (it appears within about 15 seconds).</div>
        }
        <p class="links">
          <button type="button" class="link" (click)="resend()" [disabled]="wait() > 0 || sending()">
            {{ wait() > 0 ? 'Send a new code in ' + wait() + 's' : 'Send a new code' }}
          </button>
          <a routerLink="/login">Use a different account</a>
        </p>
      }
    </sch-auth-frame>
  `,
  styles: `
    .otp { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; cursor: text; }
    .otp-input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; font-size: 16px; }
    .slot { display: grid; place-items: center; height: 56px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface, rgba(255,255,255,.04)); font: 700 24px var(--f-head); color: var(--heading); }
    .slot.active { border-color: var(--c-blue); box-shadow: 0 0 0 3px rgba(50,130,246,.25); }
    .slot.filled { border-color: var(--c-teal); }
    .links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; margin: 20px 0 0; font-size: 14px; }
    .link { background: none; border: 0; padding: 0; color: var(--link, var(--c-blue)); cursor: pointer; font: inherit; }
    .link:disabled { color: var(--muted); cursor: default; }
  `,
})
export class VerifyEmail {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected email = this.route.snapshot.queryParamMap.get('email') ?? '';
  private next = this.route.snapshot.queryParamMap.get('next');
  protected slots = [0, 1, 2, 3, 4, 5];
  protected code = signal('');
  protected busy = signal(false);
  protected sending = signal(false);
  protected err = signal<string | null>(null);
  protected info = signal<string | null>(null);
  protected wait = signal(60);
  private timer?: ReturnType<typeof setInterval>;

  protected devInbox = signal(false);
  /** Whether the latest code email really left the mail server (checked for a short while after each send). */
  protected delivery = signal<'sending' | 'sent' | 'problem'>('sending');
  private poll?: ReturnType<typeof setInterval>;
  private watchDelivery() {
    if (typeof window === 'undefined' || !this.email) return;
    clearInterval(this.poll);
    this.delivery.set('sending');
    let tries = 0;
    const check = async () => {
      tries++;
      try {
        const r = await this.auth.otpStatus(this.email);
        this.delivery.set(r.status);
        if (r.status !== 'sending' || tries >= 15) clearInterval(this.poll);
      } catch {
        clearInterval(this.poll);
      }
    };
    this.poll = setInterval(() => void check(), 4000);
    setTimeout(() => void check(), 1500);
  }
  constructor() {
    this.watchDelivery();
    this.countdown(60);
    if (typeof window !== 'undefined') fetch('/api/dev/mail-status').then((r) => (r.ok ? r.json() : null)).then((r) => this.devInbox.set(!!r?.devInbox)).catch(() => undefined);
  }

  private countdown(s: number) {
    this.wait.set(s);
    if (typeof window === 'undefined') return;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.wait.update((w) => Math.max(0, w - 1));
      if (this.wait() === 0) clearInterval(this.timer);
    }, 1000);
  }

  protected focus() {
    (document.getElementById('code') as HTMLInputElement | null)?.focus();
  }

  protected onInput(v: string) {
    this.code.set(v.replace(/\D/g, '').slice(0, 6));
    this.err.set(null);
    if (this.code().length === 6) void this.submit();
  }

  async submit() {
    if (this.code().length !== 6 || this.busy()) return;
    this.busy.set(true);
    this.err.set(null);
    this.info.set(null);
    try {
      await this.auth.verifyEmail(this.email, this.code());
      clearInterval(this.timer);
      const n = this.next;
      await this.router.navigateByUrl(n && /^\/(?![\/\\])/.test(n) ? n : '/account');
    } catch (e) {
      const err = toApiError(e);
      this.err.set(err.message);
      this.code.set('');
    } finally {
      this.busy.set(false);
    }
  }

  async resend() {
    this.sending.set(true);
    this.err.set(null);
    try {
      const r = await this.auth.resendOtp(this.email);
      this.info.set('A new code is on its way. Earlier codes no longer work.');
      this.watchDelivery();
      this.code.set('');
      this.countdown(r.cooldown ?? 60);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'cooldown' && typeof err.details?.['wait'] === 'number') this.countdown(err.details['wait'] as number);
      this.err.set(err.message);
    } finally {
      this.sending.set(false);
    }
  }
}

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountApi, Trial } from '../core/account-api';
import { AuthService, toApiError } from '../core/auth.service';
import { HueKey } from '../shared/palette';
import { SchPuzzleComplete } from '../shared/puzzle-complete';

/**
 * Free trial for one product. Uses the real trial API:
 * - signed out → create an account or sign in, then return here
 * - customer → start the trial (server sets dates; one trial per product, ever)
 * - already trialled → shows that trial's status instead of a button
 * - staff / partner accounts → explains trials are for customer accounts
 * Success is only shown after the server confirms it.
 */
@Component({
  selector: 'sch-trial-panel',
  imports: [RouterLink, DatePipe, SchPuzzleComplete],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let u = auth.user();
    <div class="tp">
      @if (trial(); as t) {
        @if (justStarted()) { <sch-puzzle-complete [hue]="hue()" label="Free trial started" /> }
        <div class="alert" [class.alert-ok]="t.status === 'trial'" role="status">
          @if (t.status === 'trial') {
            <strong>{{ justStarted() ? 'Your free trial has started.' : 'Your free trial is active.' }}</strong>
            It runs until <strong>{{ t.expiresAt | date: 'd MMMM y' }}</strong>. Trial licence <code>{{ t.licenceKey }}</code>.
          } @else {
            <strong>You've used your free trial of {{ name() }}.</strong> It ended on {{ t.expiresAt | date: 'd MMMM y' }}. To keep using it, choose a plan below or ask us for a quote.
          }
        </div>
        <div class="row">
          <a class="btn btn-ghost" routerLink="/account">Open my account</a>
          <a class="btn btn-ghost" routerLink="." fragment="learning">Getting-started guides</a>
        </div>
      } @else if (!u) {
        <p>Create a free SCHLUSS account (or sign in) to start your <strong>{{ days() }}-day</strong> trial. You'll come straight back here.</p>
        <div class="row">
          <a class="btn btn-primary" routerLink="/register" [queryParams]="{ next: back() }">Create a free account</a>
          <a class="btn btn-ghost" routerLink="/login" [queryParams]="{ next: back() }">Sign in</a>
        </div>
      } @else if (u.type !== 'customer') {
        <div class="alert" role="note">Free trials are for customer accounts. You're signed in as a {{ u.type === 'staff' ? 'SCHLUSS staff member' : 'business partner' }}.</div>
      } @else {
        @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
        <p>Start using {{ name() }} free for <strong>{{ days() }} days</strong>. No payment details needed. Your trial dates are set by our server, and each customer can trial a product once.</p>
        <button class="btn btn-primary" type="button" (click)="start()" [disabled]="busy() || checking()">
          @if (busy()) { <span class="spinner" aria-hidden="true"></span> } Start my {{ days() }}-day free trial
        </button>
      }
    </div>
  `,
  styles: `
    .tp { display: grid; gap: 14px; justify-items: start; }
    p { margin: 0; max-width: 60ch; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; }
    .alert { margin: 0; max-width: 640px; }
    code { font-family: var(--f-mono); font-size: 13px; padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--heading); }
  `,
})
export class TrialPanel {
  readonly slug = input.required<string>();
  readonly name = input.required<string>();
  readonly days = input.required<number>();
  readonly hue = input<HueKey>('blue');
  protected auth = inject(AuthService);
  private api = inject(AccountApi);
  protected trial = signal<Trial | null>(null);
  protected busy = signal(false);
  protected checking = signal(false);
  protected justStarted = signal(false);
  protected err = signal<string | null>(null);
  protected back = computed(() => `/products/${this.slug()}#trial`);

  constructor() {
    // A signed-in customer sees the status of an existing trial instead of the button.
    effect(() => {
      const u = this.auth.user();
      const slug = this.slug();
      if (u?.type !== 'customer' || typeof window === 'undefined') return;
      this.checking.set(true);
      this.api
        .trials()
        .then((list) => this.trial.set(list.find((t) => t.product.slug === slug) ?? null))
        .catch(() => undefined)
        .finally(() => this.checking.set(false));
    });
  }

  async start() {
    this.busy.set(true);
    this.err.set(null);
    try {
      this.trial.set(await this.api.startTrial(this.slug()));
      this.justStarted.set(true);
    } catch (e) {
      const a = toApiError(e);
      this.err.set(a.message);
      const existing = (e as { error?: { error?: { details?: { trial?: Trial } } } }).error?.error?.details?.trial;
      if (existing) this.trial.set(existing);
    } finally {
      this.busy.set(false);
    }
  }
}

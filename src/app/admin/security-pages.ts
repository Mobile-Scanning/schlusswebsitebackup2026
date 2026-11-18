import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, toApiError } from '../core/auth.service';

type Row = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const STYLES = `
  :host { display: block; max-width: 720px; margin-top: 18px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: var(--r-lg, 14px); padding: 20px 22px; }
  h2 { font-size: 18px; margin: 0 0 6px; }
  .qr { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
  .qr img { width: 200px; height: 200px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  code.key { font: 600 15px var(--f-mono, monospace); letter-spacing: 1px; background: var(--surface-2, #f3f6fa); padding: 6px 10px; border-radius: 8px; display: inline-block; }
  .codes { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin: 10px 0; padding: 0; list-style: none; }
  .codes li { font: 600 15px var(--f-mono, monospace); background: var(--surface-2, #f3f6fa); padding: 8px 10px; border-radius: 8px; text-align: center; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
  .small { font-size: 13px; } .tiny { font-size: 12px; }
  ol { padding-left: 20px; margin: 8px 0; } li { margin: 4px 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 10px 0 0; font-size: 14px; } dt { color: var(--muted); } dd { margin: 0; }
  .input.code { max-width: 180px; font: 600 18px var(--f-mono, monospace); letter-spacing: 3px; }
`;

/** Two-step verification for the signed-in staff member (authenticator app). */
@Component({
  selector: 'sch-mfa-settings',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h2>Two-step verification</h2>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      @if (s(); as st) {
        @if (codes(); as c) {
          <div class="alert" role="note"><strong>Save these recovery codes now.</strong> Each one works once if you ever lose your phone. They are shown only this one time.</div>
          <ul class="codes">@for (x of c; track x) { <li>{{ x }}</li> }</ul>
          <button class="btn btn-primary btn-sm" type="button" (click)="codes.set(null)">I have saved them</button>
        } @else if (st.enabled) {
          <p><span class="badge badge-ok">On</span> since {{ st.enabledAt | date: 'd MMM y' }} · {{ st.recoveryCodesLeft }} recovery code(s) left.</p>
          <p class="muted small">When you sign in you enter your password and then the 6-digit code from your authenticator app.</p>
          @if (!off()) { <button class="btn btn-ghost btn-sm" type="button" (click)="off.set(true)">Switch off…</button> }
          @else {
            <form (ngSubmit)="disable()" class="small">
              <p>To switch it off, confirm your password and a current code.@if (st.required) { <strong> It is compulsory for staff, so you will be asked to set it up again.</strong> }</p>
              <div class="field"><label for="mp">Password</label><input id="mp" class="input" type="password" name="p" [(ngModel)]="password" autocomplete="current-password" />@if (fe('password')) {<span class="error">{{ fe('password') }}</span>}</div>
              <div class="field"><label for="mc">Code from the app (or a recovery code)</label><input id="mc" class="input code" name="c" [(ngModel)]="code" autocomplete="one-time-code" inputmode="numeric" />@if (fe('code')) {<span class="error">{{ fe('code') }}</span>}</div>
              <div class="row"><button class="btn btn-danger btn-sm" type="submit" [disabled]="busy()">Switch off</button><button class="btn btn-ghost btn-sm" type="button" (click)="off.set(false)">Cancel</button></div>
            </form>
          }
        } @else if (setup(); as su) {
          <ol class="small">
            <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or Authy).</li>
            <li>In the app choose “add account” and scan this picture – or type the key underneath.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div class="qr"><img [src]="su.qr" alt="QR code for your authenticator app" /><div><span class="muted tiny">Key (if you can’t scan):</span><br /><code class="key">{{ su.secret }}</code></div></div>
          <form (ngSubmit)="enable()">
            <div class="field"><label for="me">6-digit code</label><input id="me" class="input code" name="c" [(ngModel)]="code" autocomplete="one-time-code" inputmode="numeric" maxlength="7" />@if (fe('code')) {<span class="error">{{ fe('code') }}</span>}</div>
            <div class="row"><button class="btn btn-primary btn-sm" type="submit" [disabled]="busy() || code.length < 6">Switch on</button><button class="btn btn-ghost btn-sm" type="button" (click)="setup.set(null)">Cancel</button></div>
          </form>
        } @else {
          @if (st.required) { <div class="alert alert-error" role="alert"><strong>Required.</strong> Two-step verification is compulsory for staff. Set it up now to use the admin.</div> }
          <p><span class="badge badge-muted">Off</span> A password alone protects your account.</p>
          <p class="muted small">With two-step verification, someone who learns your password still can’t sign in without your phone. Strongly recommended for everyone who can use this admin.</p>
          <button class="btn btn-primary btn-sm" type="button" (click)="start()" [disabled]="busy()">Set up two-step verification</button>
        }
      } @else { <p class="muted">Loading…</p> }
    </section>
  `,
  styles: STYLES,
})
export class MfaSettings implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  protected s = signal<Row | null>(null);
  protected setup = signal<Row | null>(null);
  protected codes = signal<string[] | null>(null);
  protected off = signal(false);
  protected busy = signal(false);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  private fields = signal<Record<string, string>>({});
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected code = '';
  protected password = '';
  ngOnInit() {
    void this.load();
  }
  async load() {
    this.s.set(await firstValueFrom(this.http.get<Row>('/api/auth/mfa')));
  }
  private async run<T>(fn: () => Promise<T>): Promise<T | null> {
    this.busy.set(true);
    this.err.set(null);
    this.msg.set(null);
    this.fields.set({});
    try {
      return await fn();
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      if (!Object.keys(a.fields).length) this.err.set(a.message);
      return null;
    } finally {
      this.busy.set(false);
    }
  }
  async start() {
    const r = await this.run(() => firstValueFrom(this.http.post<Row>('/api/auth/mfa/setup', {})));
    if (r) {
      this.code = '';
      this.setup.set(r);
    }
  }
  async enable() {
    const r = await this.run(() => firstValueFrom(this.http.post<Row>('/api/auth/mfa/enable', { code: this.code })));
    if (r) {
      this.setup.set(null);
      this.code = '';
      this.codes.set(r['recoveryCodes']);
      this.msg.set('Two-step verification is on.');
      await this.load();
      await this.auth.refresh();
    }
  }
  async disable() {
    const r = await this.run(() => firstValueFrom(this.http.post<Row>('/api/auth/mfa/disable', { password: this.password, code: this.code })));
    if (r) {
      this.off.set(false);
      this.password = this.code = '';
      this.msg.set('Two-step verification is switched off.');
      await this.load();
      await this.auth.refresh();
    }
  }
}

/** Security for the whole admin: compulsory two-step verification, who has it, and what happened lately. */
@Component({
  selector: 'sch-security-overview',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (d(); as d) {
      <section class="card">
        <h2>Security for all staff</h2>
        @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
        @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
        <dl>
          <dt>Two-step verification</dt><dd>{{ d.staff.withMfa }} of {{ d.staff.total }} active staff have it switched on</dd>
          <dt>Admin sessions</dt><dd>Signed out after {{ d.sessions.staffIdleMinutes }} minutes without activity, and at most {{ d.sessions.staffMaxHours }} hours in total</dd>
          <dt>Customer sessions</dt><dd>Signed out after {{ d.sessions.customerIdleHours }} hours without activity, at most {{ d.sessions.customerMaxDays }} days</dd>
          <dt>Last 7 days</dt><dd>{{ d.last7days.logins }} sign-ins · {{ d.last7days.failedLogins }} wrong passwords · {{ d.last7days.failedCodes }} wrong codes · {{ d.last7days.refused }} refused requests</dd>
        </dl>
        @if (canManage()) {
          <label class="check" style="margin-top: 14px"><input type="checkbox" name="r" [(ngModel)]="require" /><span><strong>Make two-step verification compulsory for all staff</strong><br /><span class="muted small">Staff without it can sign in but must set it up before they can use anything in the admin.</span></span></label>
          <div class="row"><button class="btn btn-primary btn-sm" type="button" (click)="save()" [disabled]="require === d.settings.requireStaffMfa">Save</button><a class="btn btn-ghost btn-sm" routerLink="/admin/audit-logs" [queryParams]="{ security: 1 }">View security events</a></div>
        }
      </section>
    }
  `,
  styles: STYLES,
})
export class SecurityOverview implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  protected d = signal<Row | null>(null);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected require = false;
  protected canManage = () => this.auth.can('settings.manage');
  ngOnInit() {
    void this.load();
  }
  async load() {
    try {
      const d = await firstValueFrom(this.http.get<Row>('/api/admin/security-settings'));
      this.d.set(d);
      this.require = !!d['settings'].requireStaffMfa;
    } catch {
      /* not permitted to see the overview – the page just shows their own settings */
    }
  }
  async save() {
    this.msg.set(null);
    this.err.set(null);
    try {
      await firstValueFrom(this.http.put('/api/admin/security-settings', { requireStaffMfa: this.require }));
      this.msg.set(this.require ? 'Two-step verification is now compulsory for all staff.' : 'Two-step verification is now optional for staff.');
      await this.load();
    } catch (e) {
      this.err.set(toApiError(e).message);
      this.require = !!this.d()?.['settings'].requireStaffMfa;
    }
  }
}

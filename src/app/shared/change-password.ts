import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, AuthService, toApiError } from '../core/auth.service';

/** Change password card – used in every portal. Signs out the user's other sessions. */
@Component({
  selector: 'sch-change-password',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h2>Change password</h2>
      <p class="muted">Changing your password signs you out on your other devices.</p>
      @if (ok()) { <div class="alert alert-ok" role="status">Password changed.</div> }
      @if (err() && !hasFieldErr()) { <div class="alert alert-error" role="alert">{{ err()!.message }}</div> }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="form">
        <div class="field">
          <label for="cur">Current password</label>
          <input id="cur" class="input" type="password" autocomplete="current-password" formControlName="currentPassword" />
          @if (err()?.fields?.['currentPassword']) { <span class="error">{{ err()!.fields['currentPassword'] }}</span> }
        </div>
        <div class="field">
          <label for="new">New password</label>
          <input id="new" class="input" type="password" autocomplete="new-password" formControlName="newPassword" />
          <span class="hint">At least 10 characters, with letters and a number.</span>
          @if (err()?.fields?.['newPassword']) { <span class="error">{{ err()!.fields['newPassword'] }}</span> }
        </div>
        <button class="btn btn-primary" type="submit" [disabled]="busy() || form.invalid">Update password</button>
      </form>
    </section>
  `,
  styles: `.form { max-width: 420px; margin-top: 16px; } h2 { font-size: 19px; }`,
})
export class ChangePassword {
  private auth = inject(AuthService);
  protected form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(10)]],
  });
  protected busy = signal(false);
  protected ok = signal(false);
  protected err = signal<ApiError | null>(null);
  protected hasFieldErr = () => Object.keys(this.err()?.fields ?? {}).length > 0;

  async submit() {
    this.busy.set(true);
    this.ok.set(false);
    this.err.set(null);
    try {
      const v = this.form.getRawValue();
      await this.auth.changePassword(v.currentPassword, v.newPassword);
      this.ok.set(true);
      this.form.reset();
    } catch (e) {
      this.err.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

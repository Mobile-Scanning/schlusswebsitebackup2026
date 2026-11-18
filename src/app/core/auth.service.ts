import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

export type UserType = 'staff' | 'customer' | 'partner';

export interface Me {
  user: { id: number; type: UserType; name: string; email: string } | null;
  roles?: string[];
  permissions?: string[];
  partnerStatus?: string | null;
}

/** Holds the signed-in user. The server is always the authority – this only drives the UI. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly me = signal<Me>({ user: null });
  readonly loaded = signal(false);
  readonly user = computed(() => this.me().user);
  private loading?: Promise<void>;

  /** Load CSRF token + current session once (browser only). Guards await this. */
  init(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    this.loading ??= (async () => {
      try {
        await firstValueFrom(this.http.get('/api/auth/csrf'));
        await this.refresh();
      } catch {
        this.me.set({ user: null });
      } finally {
        this.loaded.set(true);
      }
    })();
    return this.loading;
  }

  async refresh() {
    this.me.set(await firstValueFrom(this.http.get<Me>('/api/auth/me')));
  }

  can(permission: string): boolean {
    const p = this.me().permissions ?? [];
    return p.includes('*') || p.includes(permission);
  }

  /** Where a user lands after signing in. */
  homeFor(type?: UserType): string {
    return type === 'staff' ? '/admin' : type === 'partner' ? '/partner' : '/account';
  }

  /** Returns a ticket when the account has two-step verification: the code is then sent with mfaVerify(). */
  async login(email: string, password: string): Promise<{ mfa?: boolean; ticket?: string; mfaSetupRequired?: boolean }> {
    const r = await firstValueFrom(this.http.post<{ mfa?: boolean; ticket?: string; mfaSetupRequired?: boolean }>('/api/auth/login', { email, password }));
    if (!r.mfa) await this.refresh();
    return r;
  }
  async mfaVerify(ticket: string, code: string) {
    const r = await firstValueFrom(this.http.post<{ recoveryCodesLeft?: number }>('/api/auth/mfa/verify', { ticket, code }));
    await this.refresh();
    return r;
  }

  /** Creates an unverified account; the customer is signed in only after entering the emailed code. */
  register(body: Record<string, unknown>) {
    return firstValueFrom(this.http.post<{ ok: true; verify: true; email: string; minutes: number }>('/api/auth/register', body));
  }

  async verifyEmail(email: string, code: string) {
    await firstValueFrom(this.http.post('/api/auth/verify-email', { email, code }));
    await this.refresh();
  }

  otpStatus(email: string) {
    return firstValueFrom(this.http.post<{ status: 'sending' | 'sent' | 'problem' }>('/api/auth/otp-status', { email }));
  }
  resendOtp(email: string) {
    return firstValueFrom(this.http.post<{ message: string; minutes: number; cooldown: number }>('/api/auth/resend-otp', { email }));
  }

  async logout() {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } finally {
      this.me.set({ user: null });
    }
  }

  forgot(email: string) {
    return firstValueFrom(this.http.post<{ message: string }>('/api/auth/forgot-password', { email }));
  }

  reset(token: string, password: string) {
    return firstValueFrom(this.http.post('/api/auth/reset-password', { token, password }));
  }

  changePassword(currentPassword: string, newPassword: string) {
    return firstValueFrom(this.http.post('/api/auth/change-password', { currentPassword, newPassword }));
  }
}

/** Normalised API error for forms: a message plus optional per-field messages. */
export interface ApiError {
  message: string;
  fields: Record<string, string>;
  status: number;
  code?: string;
  details?: Record<string, unknown>;
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof HttpErrorResponse) {
    const body = e.error?.error;
    if (e.status === 0) return { message: 'Cannot reach the server. Check your connection and try again.', fields: {}, status: 0 };
    return { message: body?.message ?? 'Something went wrong. Please try again.', fields: body?.details?.fields ?? {}, status: e.status, code: body?.code, details: body?.details ?? {} };
  }
  return { message: 'Something went wrong. Please try again.', fields: {}, status: -1 };
}

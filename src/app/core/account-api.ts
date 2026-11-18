import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Trial {
  product: { name: string; slug: string };
  licenceKey: string;
  startsAt: string;
  expiresAt: string;
  status: 'trial' | 'active' | 'expired' | 'suspended' | 'revoked';
}

/** Customer self-service (free trials). Server enforces one trial per customer per product. */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private http = inject(HttpClient);
  trials() {
    return firstValueFrom(this.http.get<Trial[]>('/api/account/trials'));
  }
  startTrial(product: string) {
    return firstValueFrom(this.http.post<Trial>('/api/account/trials', { product }));
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyRow = any;

export const DEMO_STATUS_TEXT: Record<string, string> = {
  started: 'Not downloaded yet',
  downloaded: 'Downloaded',
  awaiting_activation: 'Awaiting activation',
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  converted: 'Upgraded to a package',
  suspended: 'Suspended',
  revoked: 'Revoked',
};

/** Customer platform: demo downloads, dashboard, product setup area, progress, profile, notifications. */
@Injectable({ providedIn: 'root' })
export class CustomerApi {
  private http = inject(HttpClient);
  prepareDemo(slug: string) {
    return firstValueFrom(this.http.get<AnyRow>(`/api/account/demos/${encodeURIComponent(slug)}`));
  }
  downloadDemo(slug: string, body: object) {
    return firstValueFrom(this.http.post<AnyRow>(`/api/account/demos/${encodeURIComponent(slug)}/download`, body));
  }
  dashboard() {
    return firstValueFrom(this.http.get<AnyRow>('/api/account/dashboard'));
  }
  product(slug: string) {
    return firstValueFrom(this.http.get<AnyRow>(`/api/account/products/${encodeURIComponent(slug)}`));
  }
  progress(stepId: number, done: boolean) {
    return firstValueFrom(this.http.post<AnyRow>(`/api/account/steps/${stepId}/progress`, { done }));
  }
  profile() {
    return firstValueFrom(this.http.get<AnyRow>('/api/account/profile'));
  }
  saveProfile(body: object) {
    return firstValueFrom(this.http.patch<AnyRow>('/api/account/profile', body));
  }
  notifications() {
    return firstValueFrom(this.http.get<{ unread: number; data: AnyRow[] }>('/api/notifications'));
  }
  readNotifications(body: object) {
    return firstValueFrom(this.http.post('/api/notifications/read', body));
  }
}

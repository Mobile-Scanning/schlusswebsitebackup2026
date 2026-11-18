import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, lastValueFrom, tap } from 'rxjs';
import type { Page } from './admin-api';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = any;

export const DEMO_STATUS: Record<string, [string, string]> = {
  started: ['Started – not downloaded', 'badge-muted'],
  downloaded: ['Downloaded', 'badge-info'],
  awaiting_activation: ['Awaiting activation', 'badge-info'],
  active: ['Active', 'badge-ok'],
  expiring_soon: ['Expiring soon', 'badge-warn'],
  expired: ['Expired', 'badge-danger'],
  converted: ['Converted to package', 'badge-ok'],
  suspended: ['Suspended', 'badge-danger'],
  revoked: ['Revoked', 'badge-danger'],
};
export const CHAT_STATUS: Record<string, [string, string]> = {
  new: ['New', 'badge-info'],
  open: ['Open', 'badge-info'],
  awaiting_admin: ['Awaiting support', 'badge-warn'],
  awaiting_customer: ['Awaiting customer', 'badge-muted'],
  in_progress: ['In progress', 'badge-warn'],
  resolved: ['Resolved', 'badge-ok'],
  closed: ['Closed', 'badge-muted'],
};
export const PRIORITY: Record<string, [string, string]> = { low: ['Low', 'badge-muted'], normal: ['Normal', 'badge-muted'], high: ['High', 'badge-warn'], urgent: ['Urgent', 'badge-danger'] };
export const PLATFORMS: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', web: 'Web', any: 'Any platform' };

const params = (q: Row = {}) => {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
};

/** Admin API for demos, customers, support inbox, setup steps, uploads and overview. */
@Injectable({ providedIn: 'root' })
export class PlatformApi {
  private http = inject(HttpClient);
  get<T = Row>(url: string, q?: Row) {
    return firstValueFrom(this.http.get<T>('/api/admin' + url, { params: params(q) }));
  }
  post<T = Row>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>('/api/admin' + url, body));
  }
  put<T = Row>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.put<T>('/api/admin' + url, body));
  }
  patch<T = Row>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.patch<T>('/api/admin' + url, body));
  }
  del<T = Row>(url: string) {
    return firstValueFrom(this.http.delete<T>('/api/admin' + url));
  }
  page(url: string, q?: Row) {
    return this.get<Page<Row> & { counts?: Record<string, number> }>(url, q);
  }

  /** Streams a large file (installer, video, document) with progress 0–100. */
  upload(file: File, fields: Row, progress?: (pct: number) => void) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
    fd.append('file', file);
    let result: Row | null = null;
    return lastValueFrom(
      this.http.post<Row>('/api/admin/files/upload', fd, { reportProgress: true, observe: 'events' }).pipe(
        tap((e) => {
          if (e.type === HttpEventType.UploadProgress && e.total) progress?.(Math.round((e.loaded / e.total) * 100));
          if (e.type === HttpEventType.Response) result = e.body;
        }),
      ),
    ).then(() => result as Row);
  }

  notifications(unread = false) {
    return firstValueFrom(this.http.get<{ unread: number; data: Row[] }>('/api/notifications', { params: params({ unread: unread ? 1 : undefined, limit: 50 }) }));
  }
  readNotifications(body: { ids?: number[]; all?: boolean }) {
    return firstValueFrom(this.http.post('/api/notifications/read', body));
  }
}

export const fileSize = (b: number | null | undefined) => (b == null ? '' : b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

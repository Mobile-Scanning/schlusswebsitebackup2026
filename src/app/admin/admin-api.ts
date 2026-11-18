import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Page<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number };
}
export interface StaffRow {
  id: number;
  name: string;
  email: string;
  status: 'active' | 'disabled';
  mfa?: boolean | number;
  last_login_at: string | null;
  created_at: string;
  roles: string[];
}
export interface RoleRow {
  id: number;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
}
export interface PermissionRow {
  key: string;
  group: string;
  description: string;
}
export interface AuditRow {
  id: number;
  action: string;
  subject_type: string | null;
  subject_id: number | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}

function params(q: Record<string, unknown>) {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private http = inject(HttpClient);

  staff(q: { page: number; q?: string; status?: string }) {
    return firstValueFrom(this.http.get<Page<StaffRow>>('/api/admin/staff', { params: params(q) }));
  }
  createStaff(body: { name: string; email: string; password: string; roles: string[] }) {
    return firstValueFrom(this.http.post<{ id: number }>('/api/admin/staff', body));
  }
  updateStaff(id: number, body: { name?: string; status?: string; roles?: string[]; resetMfa?: true }) {
    return firstValueFrom(this.http.patch(`/api/admin/staff/${id}`, body));
  }
  roles() {
    return firstValueFrom(this.http.get<{ roles: RoleRow[]; permissions: PermissionRow[] }>('/api/admin/roles'));
  }
  setRolePermissions(id: number, permissions: string[]) {
    return firstValueFrom(this.http.put(`/api/admin/roles/${id}/permissions`, { permissions }));
  }
  audit(q: { page: number; action?: string; subjectType?: string; security?: string }) {
    return firstValueFrom(this.http.get<Page<AuditRow>>('/api/admin/audit-logs', { params: params(q) }));
  }
}

export const ROLE_NAMES: Record<string, string> = {
  super_admin: 'Super Administrator',
  administrator: 'Administrator',
  product_manager: 'Product Manager',
  sales_manager: 'Sales Manager',
  support_manager: 'Support Manager',
  content_manager: 'Content Manager',
  read_only: 'Read-only Staff',
};

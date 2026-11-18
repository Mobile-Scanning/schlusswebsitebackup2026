import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toApiError } from '../core/auth.service';
import { AdminApi, AuditRow, Page } from './admin-api';

@Component({
  selector: 'sch-audit-logs',
  imports: [FormsModule, DatePipe, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Audit log</h1>
    <p class="muted">A permanent record of sign-ins and important changes. Newest first.</p>
    <form class="filters" (ngSubmit)="load(1)">
      <select class="select" name="action" [(ngModel)]="action" (change)="load(1)" aria-label="Filter by type">
        <option value="">All activity</option>
        <option value="__security">Security events (sign-ins, failures, refused access, staff & role changes)</option>
        <option value="auth.">Sign-ins & passwords</option>
        <option value="staff.">Staff changes</option>
        <option value="role.">Role changes</option>
        <option value="security.">Refused access & rate limits</option>
      </select>
    </form>
    @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Subject</th><th>Details</th></tr></thead>
        <tbody>
          @for (r of page()?.data ?? []; track r.id) {
            <tr>
              <td data-label="When">{{ r.created_at | date: 'd MMM y, HH:mm:ss' }}</td>
              <td data-label="Who">{{ r.actor_name ?? 'System' }}@if (r.actor_email) {<br /><span class="muted">{{ r.actor_email }}</span>}</td>
              <td data-label="Action"><code>{{ r.action }}</code></td>
              <td data-label="Subject">{{ r.subject_type ? r.subject_type + ' #' + r.subject_id : '—' }}</td>
              <td data-label="Details">
                @if (r.before || r.after || r.meta) {
                  <details><summary>View</summary>
                    @if (r.before) { <p class="k">Before</p><pre>{{ r.before | json }}</pre> }
                    @if (r.after) { <p class="k">After</p><pre>{{ r.after | json }}</pre> }
                    @if (r.meta) { <p class="k">Details</p><pre>{{ r.meta | json }}</pre> }
                  </details>
                } @else { — }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">@if (loading()) { <span class="spinner"></span> } @else { No activity recorded yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (page(); as p) {
      <div class="pager">
        <span class="muted">Page {{ p.meta.page }} of {{ pages(p) }} · {{ p.meta.total }} entries</span>
        <span>
          <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page <= 1" (click)="load(p.meta.page - 1)">Previous</button>
          <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page >= pages(p)" (click)="load(p.meta.page + 1)">Next</button>
        </span>
      </div>
    }
  `,
  styles: `
    h1 { font-size: 28px; }
    .filters { max-width: 520px; margin: 16px 0; }
    code { font-size: 13px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--surface-2); padding: 8px; border-radius: var(--r-sm); margin: 4px 0 8px; max-width: 420px; }
    .k { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
    summary { cursor: pointer; color: var(--sch-blue); }
  `,
})
export class AuditLogs implements OnInit {
  private api = inject(AdminApi);
  protected page = signal<Page<AuditRow> | null>(null);
  protected loading = signal(false);
  protected err = signal<string | null>(null);
  protected action = '';
  protected pages = (p: Page<AuditRow>) => Math.max(1, Math.ceil(p.meta.total / p.meta.perPage));

  private route = inject(ActivatedRoute);
  ngOnInit() {
    if (this.route.snapshot.queryParamMap.get('security')) this.action = '__security';
    return this.load(1);
  }

  async load(page: number) {
    this.loading.set(true);
    this.err.set(null);
    try {
      this.page.set(await this.api.audit(this.action === '__security' ? { page, security: '1' } : { page, action: this.action }));
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }
}

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, AuthService, toApiError } from '../core/auth.service';
import { AdminApi, Page, RoleRow, ROLE_NAMES, StaffRow } from './admin-api';

@Component({
  selector: 'sch-staff',
  imports: [ReactiveFormsModule, FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div>
        <h1>Staff</h1>
        <p class="muted">People who can sign in to this administration portal.</p>
      </div>
      <button class="btn btn-primary" type="button" (click)="openCreate()">Add staff member</button>
    </div>

    <form class="filters" (ngSubmit)="load(1)">
      <input class="input" type="search" name="q" [(ngModel)]="q" placeholder="Search name or email" aria-label="Search staff" />
      <select class="select" name="status" [(ngModel)]="status" (change)="load(1)" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
      <button class="btn btn-ghost" type="submit">Search</button>
    </form>

    @if (loadErr()) { <div class="alert alert-error" role="alert">{{ loadErr() }}</div> }

    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>Two-step</th><th>Last sign-in</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (s of page()?.data ?? []; track s.id) {
            <tr>
              <td data-label="Name"><strong>{{ s.name }}</strong></td>
              <td data-label="Email">{{ s.email }}</td>
              <td data-label="Roles">{{ roleNames(s.roles) }}</td>
              <td data-label="Status"><span class="badge" [class.badge-ok]="s.status === 'active'" [class.badge-muted]="s.status !== 'active'">{{ s.status === 'active' ? 'Active' : 'Disabled' }}</span></td>
              <td data-label="Two-step"><span class="badge" [class.badge-ok]="s.mfa" [class.badge-muted]="!s.mfa">{{ s.mfa ? 'On' : 'Off' }}</span></td>
              <td data-label="Last sign-in">{{ s.last_login_at ? (s.last_login_at | date: 'd MMM y, HH:mm') : 'Never' }}</td>
              <td data-label=""><button class="btn btn-ghost btn-sm" type="button" (click)="openEdit(s)">Edit</button>@if (s.mfa) { <button class="btn btn-ghost btn-sm" type="button" (click)="resetMfa(s)">Reset two-step</button> }</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">@if (loading()) { <span class="spinner"></span> } @else { No staff found. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (page(); as p) {
      <div class="pager">
        <span class="muted">{{ p.meta.total }} staff member{{ p.meta.total === 1 ? '' : 's' }}</span>
        <span>
          <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page <= 1" (click)="load(p.meta.page - 1)">Previous</button>
          <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page * p.meta.perPage >= p.meta.total" (click)="load(p.meta.page + 1)">Next</button>
        </span>
      </div>
    }

    <dialog #dlg class="dlg" (close)="editing.set(null)">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h2>{{ editing() ? 'Edit staff member' : 'Add staff member' }}</h2>
        @if (formErr() && !hasFieldErr()) { <div class="alert alert-error" role="alert">{{ formErr()!.message }}</div> }
        <div class="field">
          <label for="s-name">Full name</label>
          <input id="s-name" class="input" formControlName="name" />
          @if (fe('name')) { <span class="error">{{ fe('name') }}</span> }
        </div>
        @if (!editing()) {
          <div class="field">
            <label for="s-email">Email</label>
            <input id="s-email" class="input" type="email" formControlName="email" />
            @if (fe('email')) { <span class="error">{{ fe('email') }}</span> }
          </div>
          <div class="field">
            <label for="s-pass">Temporary password</label>
            <input id="s-pass" class="input" type="text" autocomplete="off" formControlName="password" />
            <span class="hint">At least 12 characters. Share it securely; they can change it under My security.</span>
            @if (fe('password')) { <span class="error">{{ fe('password') }}</span> }
          </div>
        } @else {
          <div class="field">
            <label for="s-status">Status</label>
            <select id="s-status" class="select" formControlName="status">
              <option value="active">Active</option>
              <option value="disabled">Disabled (signs them out immediately)</option>
            </select>
          </div>
        }
        <fieldset class="roles">
          <legend class="label">Roles</legend>
          @for (r of roles(); track r.key) {
            @if (r.key !== 'super_admin' || isSuper()) {
              <label class="check">
                <input type="checkbox" [checked]="selected().includes(r.key)" (change)="toggleRole(r.key)" />
                <span><strong>{{ r.name }}</strong><br /><span class="muted">{{ r.description }}</span></span>
              </label>
            }
          }
          @if (fe('roles')) { <span class="error">{{ fe('roles') }}</span> }
        </fieldset>
        <div class="actions">
          <button class="btn btn-ghost" type="button" (click)="dlg.close()">Cancel</button>
          <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ editing() ? 'Save changes' : 'Add staff member' }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    .filters { display: grid; grid-template-columns: 1fr 180px auto; gap: 10px; margin-bottom: 16px; }
    @media (max-width: 640px) { .filters { grid-template-columns: 1fr; } }
    .dlg { width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 24px; background: var(--surface); color: var(--fg); box-shadow: var(--shadow); }
    .dlg::backdrop { background: rgba(10, 13, 19, .55); }
    .dlg h2 { font-size: 20px; }
    .roles { border: 0; padding: 0; margin: 4px 0 8px; }
    .roles legend { margin-bottom: 10px; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  `,
})
export class StaffPage implements OnInit {
  private api = inject(AdminApi);
  private auth = inject(AuthService);
  private fb = inject(FormBuilder).nonNullable;
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  protected page = signal<Page<StaffRow> | null>(null);
  protected roles = signal<RoleRow[]>([]);
  protected loading = signal(false);
  protected loadErr = signal<string | null>(null);
  protected editing = signal<StaffRow | null>(null);
  protected selected = signal<string[]>([]);
  protected saving = signal(false);
  protected formErr = signal<ApiError | null>(null);
  protected q = '';
  protected status = '';
  protected form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    status: ['active'],
  });

  protected isSuper = () => (this.auth.me().roles ?? []).includes('super_admin');
  protected roleNames = (keys: string[]) => keys.map((k) => ROLE_NAMES[k] ?? k).join(', ') || '—';
  protected fe = (f: string) => this.formErr()?.fields[f] ?? null;
  protected hasFieldErr = () => Object.keys(this.formErr()?.fields ?? {}).length > 0;

  async ngOnInit() {
    await this.load(1);
    try {
      this.roles.set((await this.api.roles()).roles);
    } catch {
      /* roles list needs users.manage, which this page already requires */
    }
  }

  async resetMfa(s: StaffRow) {
    if (!confirm(`Remove two-step verification for ${s.name}? Use this when they have lost their phone. They are signed out and set it up again.`)) return;
    try {
      await this.api.updateStaff(s.id, { resetMfa: true });
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.loadErr.set(toApiError(e).message);
    }
  }

  async load(page: number) {
    this.loading.set(true);
    this.loadErr.set(null);
    try {
      this.page.set(await this.api.staff({ page, q: this.q, status: this.status }));
    } catch (e) {
      this.loadErr.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.editing.set(null);
    this.formErr.set(null);
    this.form.reset({ name: '', email: '', password: '', status: 'active' });
    this.form.controls.email.enable();
    this.form.controls.password.enable();
    this.selected.set([]);
    this.dlg().nativeElement.showModal();
  }

  openEdit(s: StaffRow) {
    this.editing.set(s);
    this.formErr.set(null);
    this.form.reset({ name: s.name, email: s.email, password: '', status: s.status });
    this.form.controls.email.disable();
    this.form.controls.password.disable();
    this.selected.set([...s.roles]);
    this.dlg().nativeElement.showModal();
  }

  toggleRole(key: string) {
    this.selected.update((r) => (r.includes(key) ? r.filter((x) => x !== key) : [...r, key]));
  }

  async save() {
    this.formErr.set(null);
    if (!this.selected().length) {
      this.formErr.set({ message: 'Choose at least one role.', fields: { roles: 'Choose at least one role' }, status: 422 });
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const ed = this.editing();
      if (ed) await this.api.updateStaff(ed.id, { name: v.name, status: v.status, roles: this.selected() });
      else await this.api.createStaff({ name: v.name, email: v.email, password: v.password, roles: this.selected() });
      this.dlg().nativeElement.close();
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.formErr.set(toApiError(e));
    } finally {
      this.saving.set(false);
    }
  }
}

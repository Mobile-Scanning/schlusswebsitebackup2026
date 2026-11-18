import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { toApiError } from '../core/auth.service';
import { AdminApi, PermissionRow, RoleRow } from './admin-api';

@Component({
  selector: 'sch-roles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Roles & permissions</h1>
    <p class="muted">Choose a role to see and change what it can do. Changes apply on the user's next action.</p>
    @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
    @if (saved()) { <div class="alert alert-ok" role="status">Permissions saved for {{ saved() }}.</div> }

    <div class="layout">
      <nav class="role-list" aria-label="Roles">
        @for (r of roles(); track r.id) {
          <button type="button" [class.active]="r.id === activeId()" (click)="select(r)">
            <strong>{{ r.name }}</strong>
            <span class="muted">{{ r.key === 'super_admin' ? 'All permissions' : r.permissions.length + ' permissions' }}</span>
          </button>
        }
      </nav>

      @if (active(); as r) {
        <section class="card">
          <h2>{{ r.name }}</h2>
          <p class="muted">{{ r.description }}</p>
          @if (r.key === 'super_admin') {
            <div class="alert">The Super Administrator role always has every permission and cannot be changed.</div>
          }
          @for (g of groups(); track g.name) {
            <fieldset>
              <legend>{{ g.name }}</legend>
              @for (p of g.items; track p.key) {
                <label class="check">
                  <input type="checkbox" [disabled]="r.key === 'super_admin'" [checked]="r.key === 'super_admin' || draft().has(p.key)" (change)="toggle(p.key)" />
                  <span>{{ p.description }} <code>{{ p.key }}</code></span>
                </label>
              }
            </fieldset>
          }
          @if (r.key !== 'super_admin') {
            <div class="actions">
              <button class="btn btn-ghost" type="button" (click)="select(r)" [disabled]="!dirty()">Undo changes</button>
              <button class="btn btn-primary" type="button" (click)="save()" [disabled]="!dirty() || busy()">Save permissions</button>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    h1 { font-size: 28px; }
    .layout { display: grid; grid-template-columns: 260px 1fr; gap: 18px; align-items: start; margin-top: 18px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
    .role-list { display: grid; gap: 6px; }
    .role-list button { text-align: left; display: grid; gap: 2px; padding: 12px 14px; border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--surface); color: var(--fg); font: inherit; cursor: pointer; min-height: 44px; }
    .role-list button.active { border-color: var(--sch-blue); box-shadow: inset 3px 0 0 var(--sch-blue); }
    .role-list .muted { font-size: 13px; }
    fieldset { border: 0; border-top: 1px solid var(--line); padding: 14px 0 4px; margin: 0; }
    legend { font: 600 12px var(--f-din); letter-spacing: .18em; text-transform: uppercase; color: var(--sch-blue); padding-right: 8px; }
    code { font-size: 12px; color: var(--muted); }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
  `,
})
export class RolesPage implements OnInit {
  private api = inject(AdminApi);
  protected roles = signal<RoleRow[]>([]);
  protected permissions = signal<PermissionRow[]>([]);
  protected activeId = signal<number | null>(null);
  protected draft = signal(new Set<string>());
  protected busy = signal(false);
  protected err = signal<string | null>(null);
  protected saved = signal<string | null>(null);

  protected active = computed(() => this.roles().find((r) => r.id === this.activeId()) ?? null);
  protected groups = computed(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const p of this.permissions()) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  });
  protected dirty = computed(() => {
    const r = this.active();
    if (!r) return false;
    const d = this.draft();
    return d.size !== r.permissions.length || r.permissions.some((p) => !d.has(p));
  });

  async ngOnInit() {
    try {
      const res = await this.api.roles();
      this.roles.set(res.roles);
      this.permissions.set(res.permissions);
      if (res.roles[0]) this.select(res.roles[0]);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }

  select(r: RoleRow) {
    this.activeId.set(r.id);
    this.draft.set(new Set(r.permissions));
    this.saved.set(null);
  }

  toggle(key: string) {
    const next = new Set(this.draft());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.draft.set(next);
  }

  async save() {
    const r = this.active();
    if (!r) return;
    this.busy.set(true);
    this.err.set(null);
    try {
      const perms = [...this.draft()];
      await this.api.setRolePermissions(r.id, perms);
      this.roles.update((list) => list.map((x) => (x.id === r.id ? { ...x, permissions: perms } : x)));
      this.saved.set(r.name);
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

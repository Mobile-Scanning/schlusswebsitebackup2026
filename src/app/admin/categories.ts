import { ChangeDetectionStrategy, Component, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService, toApiError } from '../core/auth.service';
import { AdminCategory, CatalogueApi } from './catalogue-api';

/** Admin › Categories: create, edit, hide, reorder, delete (only when empty). */
@Component({
  selector: 'sch-admin-categories',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      <div><h1>Categories</h1><p class="muted">Group products on the website. The order here is the order visitors see.</p></div>
      @if (canEdit()) { <button class="btn btn-primary" type="button" (click)="openEdit(null)">Add category</button> }
    </div>
    @if (msg()) { <div class="alert" [class.alert-error]="msgErr()" [class.alert-ok]="!msgErr()" role="status">{{ msg() }}</div> }
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Order</th><th>Name</th><th>Products</th><th>Shown on website</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (c of cats(); track c.id; let i = $index; let last = $last) {
            <tr>
              <td data-label="Order">
                @if (canEdit()) {
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" type="button" [disabled]="i === 0" (click)="move(i, -1)" [attr.aria-label]="'Move ' + c.name + ' up'">↑</button>
                    <button class="btn btn-ghost btn-sm" type="button" [disabled]="last" (click)="move(i, 1)" [attr.aria-label]="'Move ' + c.name + ' down'">↓</button>
                  </div>
                } @else { {{ i + 1 }} }
              </td>
              <td data-label="Name"><strong>{{ c.name }}</strong>@if (c.description) {<br /><span class="muted small">{{ c.description }}</span>}</td>
              <td data-label="Products">{{ c.productCount }}</td>
              <td data-label="Shown"><span class="badge" [class.badge-ok]="c.is_active" [class.badge-muted]="!c.is_active">{{ c.is_active ? 'Visible' : 'Hidden' }}</span></td>
              <td data-label="">
                @if (canEdit()) {
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" type="button" (click)="openEdit(c)">Edit</button>
                    <button class="btn btn-danger btn-sm" type="button" (click)="remove(c)" [disabled]="c.productCount > 0" [title]="c.productCount ? 'Move its products first' : ''">Delete</button>
                  </div>
                }
              </td>
            </tr>
          } @empty { <tr><td colspan="5" class="empty">No categories yet. Add your first one – for example “Retail Solutions”.</td></tr> }
        </tbody>
      </table>
    </div>

    <dialog #dlg class="dlg">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h2>{{ editing() ? 'Edit category' : 'Add category' }}</h2>
        @if (formErr()) { <div class="alert alert-error">{{ formErr() }}</div> }
        <div class="field"><label for="c-name">Name</label><input id="c-name" class="input" formControlName="name" />
          @if (form.controls.name.invalid && form.controls.name.touched) { <span class="error">Enter a name</span> }</div>
        <div class="field"><label for="c-desc">Short description <span class="muted">(optional)</span></label><textarea id="c-desc" class="textarea" rows="2" formControlName="description"></textarea></div>
        <label class="check"><input type="checkbox" formControlName="isActive" /><span>Show this category on the website</span></label>
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="dlg.close()">Cancel</button><button class="btn btn-primary" type="submit" [disabled]="busy()">Save</button></div>
      </form>
    </dialog>
  `,
  styles: `.small { font-size: 13px; }`,
})
export class CategoriesPage implements OnInit {
  private api = inject(CatalogueApi);
  private auth = inject(AuthService);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected cats = signal<AdminCategory[]>([]);
  protected editing = signal<AdminCategory | null>(null);
  protected busy = signal(false);
  protected formErr = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  protected msgErr = signal(false);
  protected canEdit = () => this.auth.can('categories.manage');
  protected form = inject(FormBuilder).nonNullable.group({ name: ['', [Validators.required, Validators.minLength(2)]], description: [''], isActive: [true] });

  ngOnInit() {
    void this.load();
  }
  async load() {
    this.cats.set(await this.api.categories());
  }
  openEdit(c: AdminCategory | null) {
    this.editing.set(c);
    this.formErr.set(null);
    this.form.reset({ name: c?.name ?? '', description: c?.description ?? '', isActive: c?.is_active ?? true });
    this.dlg().nativeElement.showModal();
  }
  async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      const e = this.editing();
      if (e) await this.api.updateCategory(e.id, v);
      else await this.api.createCategory(v);
      this.dlg().nativeElement.close();
      this.note(`Category “${v.name}” saved.`);
      await this.load();
    } catch (err) {
      this.formErr.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
  async move(i: number, dir: number) {
    const list = [...this.cats()];
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    this.cats.set(list);
    try {
      await this.api.reorderCategories(list.map((c) => c.id));
    } catch (e) {
      this.note(toApiError(e).message, true);
      await this.load();
    }
  }
  async remove(c: AdminCategory) {
    if (!confirm(`Delete the category “${c.name}”?`)) return;
    try {
      await this.api.deleteCategory(c.id);
      this.note(`Category “${c.name}” deleted.`);
      await this.load();
    } catch (e) {
      this.note(toApiError(e).message, true);
    }
  }
  private note(m: string, err = false) {
    this.msg.set(m);
    this.msgErr.set(err);
  }
}

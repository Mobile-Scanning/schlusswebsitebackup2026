import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../core/auth.service';
import { SECTION_LABEL } from '../shared/format';
import { AdminLearning, CatalogueApi, MediaItem, ProductRow } from './catalogue-api';
import { MediaPicker } from './media';
import { PlatformApi } from './platform-api';

const VIS: Record<string, string> = { public: 'Everyone', customer: 'Signed-in customers', partner: 'Approved partners', staff: 'Staff only' };

/** Learning material list + editor. With productId it manages one product's learning centre. */
@Component({
  selector: 'sch-learning-admin',
  imports: [ReactiveFormsModule, FormsModule, MediaPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      @if (!productId()) { <div><h1>Learning materials</h1><p class="muted">Guides, manuals, videos, FAQs, training and sales material. Control who can open each item.</p></div> }
      @else { <p class="muted">{{ intro() }}</p> }
      <button class="btn btn-primary" type="button" (click)="openEdit(null)">{{ addLabel() }}</button>
    </div>
    @if (!productId()) {
      <div class="adm-filters">
        <input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Search titles" aria-label="Search" />
        <select class="select" [(ngModel)]="filterProduct" (change)="load(1)" aria-label="Product">
          <option value="">All products</option><option value="general">General (no product)</option>
          @for (p of products(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
        </select>
      </div>
    }
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>Title</th>@if (!productId()) {<th>Product</th>}<th>Section</th><th>Who can open</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (l of items(); track l.id) {
            <tr>
              <td data-label="Title"><strong>{{ l.title }}</strong><br /><span class="muted small">{{ kinds[l.kind] }}</span></td>
              @if (!productId()) { <td data-label="Product">{{ l.product_name ?? 'General' }}</td> }
              <td data-label="Section">{{ sections[l.section] ?? l.section }}</td>
              <td data-label="Who can open">{{ vis[l.visibility] }}</td>
              <td data-label="Status"><span class="badge" [class.badge-ok]="l.is_published" [class.badge-muted]="!l.is_published">{{ l.is_published ? 'Published' : 'Draft' }}</span></td>
              <td data-label=""><div class="row-actions">
                @if (productId()) {
                  <button class="btn btn-ghost btn-sm" type="button" (click)="move($index, -1)" [disabled]="$first" aria-label="Move up">↑</button>
                  <button class="btn btn-ghost btn-sm" type="button" (click)="move($index, 1)" [disabled]="$last" aria-label="Move down">↓</button>
                }
                @if (l.url) { <a class="btn btn-ghost btn-sm" [href]="l.url" target="_blank" rel="noopener">Open</a> }
                <button class="btn btn-ghost btn-sm" type="button" (click)="openEdit(l)">Edit</button>
                <button class="btn btn-danger btn-sm" type="button" (click)="remove(l)">Delete</button>
              </div></td>
            </tr>
          } @empty { <tr><td [attr.colspan]="productId() ? 5 : 6" class="empty">No learning material yet.</td></tr> }
        </tbody>
      </table>
    </div>

    <dialog #dlg class="dlg wide">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h2>{{ editing() ? 'Edit learning item' : 'Add learning item' }}</h2>
        @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
        <div class="form-row">
          <div class="field"><label for="l-title">Title</label><input id="l-title" class="input" formControlName="title" />@if (fe('title')) {<span class="error">{{ fe('title') }}</span>}</div>
          <div class="field"><label for="l-kind">Type</label>
            <select id="l-kind" class="select" formControlName="kind">@for (k of allowedKinds(); track k) {<option [value]="k">{{ kinds[k] }}</option>}</select></div>
          <div class="field"><label for="l-section">Section</label>
            <select id="l-section" class="select" formControlName="section">@for (s of sectionKeys; track s) {<option [value]="s">{{ sections[s] }}</option>}</select></div>
          @if (!productId()) {
            <div class="field"><label for="l-product">Product</label>
              <select id="l-product" class="select" formControlName="productId"><option [ngValue]="null">General (all products)</option>@for (p of products(); track p.id) {<option [ngValue]="p.id">{{ p.name }}</option>}</select></div>
          }
          <div class="field"><label for="l-vis">Who can open it?</label>
            <select id="l-vis" class="select" formControlName="visibility">@for (v of visKeys; track v) {<option [value]="v">{{ vis[v] }}</option>}</select></div>
          <div class="field"><label for="l-aud">Shown in</label>
            <select id="l-aud" class="select" formControlName="audience"><option value="both">Customer & partner areas</option><option value="customer">Customer areas only</option><option value="partner">Partner portal only</option></select></div>
        </div>
        <div class="field"><label for="l-sum">Summary <span class="muted">(optional)</span></label><input id="l-sum" class="input" formControlName="summary" /></div>
        @if (form.value.kind === 'link') {
          <div class="field"><label for="l-url">Web address</label><input id="l-url" class="input" type="url" formControlName="url" placeholder="https://" />@if (fe('url')) {<span class="error">{{ fe('url') }}</span>}<span class="hint">Product web apps, demonstration links, training or support pages.</span></div>
        } @else if (needsBody()) {
          <div class="field"><label for="l-body">{{ form.value.kind === 'faq' ? 'Answer' : 'Content' }}</label><textarea id="l-body" class="textarea" rows="8" formControlName="body"></textarea>@if (fe('body')) {<span class="error">{{ fe('body') }}</span>}</div>
        } @else {
          <div class="field">
            <span class="label">File or video</span>
            <div class="row-actions"><button class="btn btn-ghost btn-sm" type="button" (click)="picker.open()">{{ mediaTitle() ? 'Change' : 'Choose from media library' }}</button>@if (mediaTitle()) {<span class="muted">{{ mediaTitle() }}</span>}</div>
            @if (fe('mediaId')) {<span class="error">{{ fe('mediaId') }}</span>}
          </div>
        }
        <label class="check"><input type="checkbox" formControlName="isPublished" /><span>Published (visible according to “Who can open it?”)</span></label>
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="dlg.close()">Cancel</button><button class="btn btn-primary" type="submit" [disabled]="busy()">Save</button></div>
      </form>
    </dialog>
    <sch-media-picker #picker [kind]="form.value.kind === 'video' ? 'video' : 'any'" [defaultVisibility]="form.value.visibility ?? 'public'" (picked)="pickMedia($event)" />
  `,
  styles: `.small { font-size: 12px; }`,
})
export class LearningAdmin implements OnInit {
  readonly productId = input<number | null>(null);
  /** Limit the list (and new items) to some types – used by the product editor's Documents and Links tabs. */
  readonly only = input<string[] | null>(null);
  readonly intro = input('Add guides, manuals, videos and FAQs for this product. Choose who can open each one.');
  readonly addLabel = input('Add learning item');
  private api = inject(CatalogueApi);
  private platform = inject(PlatformApi);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected items = signal<AdminLearning[]>([]);
  protected products = signal<ProductRow[]>([]);
  protected editing = signal<AdminLearning | null>(null);
  protected mediaTitle = signal<string | null>(null);
  protected busy = signal(false);
  protected err = signal<string | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected msg = signal<string | null>(null);
  protected q = '';
  protected filterProduct = '';
  protected sections = SECTION_LABEL;
  protected sectionKeys = Object.keys(SECTION_LABEL);
  protected vis = VIS;
  protected visKeys = Object.keys(VIS);
  protected kinds: Record<string, string> = { document: 'Document (PDF / Office)', video: 'Video', article: 'Written guide', faq: 'FAQ', template: 'Downloadable file / template', link: 'External link (URL)' };
  protected kindKeys = Object.keys(this.kinds);
  protected allowedKinds = () => this.only() ?? this.kindKeys;
  protected form = inject(FormBuilder).group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    kind: ['document'],
    section: ['getting_started'],
    productId: [null as number | null],
    visibility: ['public'],
    audience: ['both'],
    summary: [''],
    body: [''],
    mediaId: [null as number | null],
    url: [''],
    isPublished: [true],
  });
  protected needsBody = () => ['article', 'faq'].includes(this.form.value.kind ?? '');
  protected fe = (f: string) => this.fields()[f] ?? null;

  ngOnInit() {
    void this.load(1);
    if (!this.productId()) void this.api.products({ perPage: 100 }).then((r) => this.products.set(r.data));
  }
  async load(page: number) {
    const fp = this.filterProduct;
    const r = await this.api.learning({ page, perPage: 100, productId: this.productId() ?? (fp && fp !== 'general' ? fp : undefined), general: fp === 'general' ? 1 : undefined, q: this.q });
    const only = this.only();
    this.items.set(only ? r.data.filter((l) => only.includes(l.kind)) : r.data);
  }
  /** Reorder within this product (saved immediately). */
  async move(i: number, d: number) {
    const list = [...this.items()];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.items.set(list);
    await this.platform.put('/learning-order', { ids: list.map((l) => l.id) });
  }
  openEdit(l: AdminLearning | null) {
    this.editing.set(l);
    this.err.set(null);
    this.fields.set({});
    this.mediaTitle.set(l?.media_title ?? null);
    this.form.reset({
      title: l?.title ?? '',
      kind: l?.kind ?? this.allowedKinds()[0],
      section: l?.section ?? 'getting_started',
      productId: l?.product_id ?? this.productId(),
      visibility: l?.visibility ?? 'public',
      audience: l?.audience ?? 'both',
      summary: l?.summary ?? '',
      body: l?.body ?? '',
      mediaId: l?.media_id ?? null,
      url: (l as { link_url?: string | null } | null)?.link_url ?? '',
      isPublished: l?.is_published ?? true,
    });
    this.dlg().nativeElement.showModal();
  }
  pickMedia(m: MediaItem) {
    this.form.patchValue({ mediaId: m.id });
    this.mediaTitle.set(m.title);
  }
  async save() {
    this.busy.set(true);
    this.err.set(null);
    this.fields.set({});
    try {
      const v = this.form.getRawValue();
      const isLink = v.kind === 'link';
      const body = { ...v, productId: this.productId() ?? v.productId, mediaId: this.needsBody() || (isLink && v.url) ? null : v.mediaId, body: this.needsBody() ? v.body : null, url: isLink ? v.url || null : null };
      const e = this.editing();
      if (e) await this.api.updateLearning(e.id, body);
      else await this.api.createLearning(body);
      this.dlg().nativeElement.close();
      this.msg.set(`“${v.title}” saved.`);
      await this.load(1);
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(a.message);
    } finally {
      this.busy.set(false);
    }
  }
  async remove(l: AdminLearning) {
    if (!confirm(`Delete “${l.title}”?`)) return;
    await this.api.deleteLearning(l.id);
    this.msg.set(`“${l.title}” deleted.`);
    await this.load(1);
  }
}

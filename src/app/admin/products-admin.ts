import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, toApiError } from '../core/auth.service';
import { CatalogueApi, OFFERING_LABEL, ProductRow, ProductStats } from './catalogue-api';
import type { Page } from './admin-api';

type Filter = { key: string; label: string; q: Record<string, string> };
const FILTERS: Filter[] = [
  { key: 'all', label: 'All offerings', q: {} },
  { key: 'software', label: 'Software', q: { offering: 'software' } },
  { key: 'learning', label: 'Learning content', q: { offering: 'learning' } },
  { key: 'training', label: 'Training / courses', q: { offering: 'training' } },
  { key: 'development', label: 'Under development', q: { offering: 'development' } },
  { key: 'published', label: 'Published', q: { state: 'published' } },
  { key: 'draft', label: 'Draft / unpublished', q: { state: 'draft' } },
  { key: 'archived', label: 'Archived', q: { state: 'archived' } },
  { key: 'installer', label: 'Has installer', q: { has: 'installer' } },
  { key: 'demo', label: 'Has demo', q: { has: 'demo' } },
  { key: 'nodemo', label: 'No demo', q: { has: 'nodemo' } },
  { key: 'content', label: 'Has learning content', q: { has: 'content' } },
];

/**
 * Admin › Products – the Products Management Centre.
 * All software products, learning content and training courses in one list, with counters, search, filters
 * and quick actions. Everything about one offering is edited on one page (Edit).
 */
@Component({
  selector: 'sch-admin-products',
  imports: [FormsModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head">
      <div><h1>Products</h1><p class="muted">Software products, learning content and training courses – created, edited and published from here.</p></div>
      <div class="head-actions">
        @if (auth.can('content.manage')) { <a class="btn btn-ghost" routerLink="/admin/content" [queryParams]="{ tab: 'story' }">About SCHLUSS experience</a> }
        @if (auth.can('products.manage')) { <button class="btn btn-primary" type="button" (click)="create()">+ Add new offering</button> }
      </div>
    </div>
    @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
    @if (notice()) { <div class="alert alert-ok" role="status">{{ notice() }}</div> }

    @if (stats(); as s) {
      <div class="stats">
        @for (k of statKeys; track k[0]) {
          <button type="button" class="st" [style.--c]="k[3]" [class.on]="filter === k[2]" (click)="setFilter(k[2])"><b>{{ s[k[0]] }}</b><span>{{ k[1] }}</span></button>
        }
      </div>
    }

    <div class="tools">
      <input class="input search" type="search" [(ngModel)]="q" (keyup.enter)="load(1)" (search)="load(1)" placeholder="Search name, description, type or category" aria-label="Search offerings" />
      <div class="chips" role="group" aria-label="Filter">
        @for (f of filters; track f.key) { <button type="button" class="chip" [attr.aria-pressed]="filter === f.key" (click)="setFilter(f.key)">{{ f.label }}</button> }
      </div>
    </div>

    <div class="table-wrap">
      <table class="table stack offerings">
        <thead><tr><th>Offering</th><th>Type</th><th>Status</th><th>Includes</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (p of page()?.data ?? []; track p.id) {
            <tr [class.arch]="p.is_archived">
              <td data-label="Offering">
                <div class="prod">
                  @if (p.image) { <img class="thumb" [src]="p.image" alt="" loading="lazy" /> } @else { <span class="thumb" aria-hidden="true"></span> }
                  <span class="pinfo"><a [routerLink]="['/admin/products', p.id]"><strong>{{ p.name }}</strong></a>@if (p.is_featured) {<span class="badge badge-info ft">Featured</span>}
                    @if (p.short_description) { <span class="desc">{{ p.short_description }}</span> }</span>
                </div>
              </td>
              <td data-label="Type"><span class="type" [class]="'type t-' + p.offering_type">{{ typeLabel[p.offering_type] }}</span></td>
              <td data-label="Status">
                @if (p.is_archived) { <span class="badge badge-muted">Archived</span> }
                @else if (p.is_published) { <span class="badge badge-ok">Published</span> }
                @else { <span class="badge badge-warn">Draft</span> }
              </td>
              <td data-label="Includes">
                <span class="inc">
                  @if (p.offering_features.installer) { <span [class.yes]="p.has_installer" [title]="p.has_installer ? 'Full installer uploaded' : 'Installer switched on, not uploaded yet'">Installer {{ p.has_installer ? '✓' : '–' }}</span> }
                  @if (p.offering_features.demo) { <span [class.yes]="p.has_demo" [title]="p.has_demo ? 'Demo download live' : 'Demo switched on, not live yet'">Demo {{ p.has_demo ? '✓' : '–' }}</span> }
                  @if (p.trial) { <span class="yes">Trial ✓</span> }
                  @if (p.offering_features.learning) { <span [class.yes]="p.content_published > 0" [title]="p.content_items + ' content item(s), ' + p.content_published + ' published'">Videos {{ p.content_published }}/{{ p.content_items }}</span> }
                </span>
              </td>
              <td data-label="Updated">{{ p.updated_at | date: 'd MMM y' }}</td>
              <td data-label="">
                <div class="row-actions">
                  <a class="btn btn-primary btn-sm" [routerLink]="['/admin/products', p.id]">{{ auth.can('products.manage') ? 'Edit' : 'View' }}</a>
                  <a class="btn btn-ghost btn-sm" [href]="'/products/' + p.slug + (p.is_published ? '' : '?contentPreview=1')" target="_blank" rel="noopener" [title]="p.is_published ? 'Open the live page' : 'Preview (drafts are visible to staff only)'">View</a>
                  @if (auth.can('products.manage')) {
                    <details class="more">
                      <summary class="btn btn-ghost btn-sm" aria-label="More actions">⋯</summary>
                      <div class="menu" role="menu">
                        <button type="button" role="menuitem" (click)="duplicate(p)">Duplicate</button>
                        @if (auth.can('products.publish')) {
                          @if (!p.is_archived) {
                            <button type="button" role="menuitem" (click)="state(p, p.is_published ? 'unpublish' : 'publish')">{{ p.is_published ? 'Unpublish' : 'Publish' }}</button>
                            <button type="button" role="menuitem" (click)="state(p, 'archive')">Archive</button>
                          } @else { <button type="button" role="menuitem" (click)="state(p, 'restore')">Restore as draft</button> }
                          <button type="button" role="menuitem" class="danger" (click)="remove(p)">Delete…</button>
                        }
                      </div>
                    </details>
                  }
                </div>
              </td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No offerings match. @if (auth.can('products.manage')) { <button class="linkish" type="button" (click)="create()">Add one</button> }</td></tr> }
        </tbody>
      </table>
    </div>
    @if (page(); as pg) {
      <div class="pager"><span class="muted">{{ pg.meta.total }} offering(s)</span>
        <span><button class="btn btn-ghost btn-sm" type="button" [disabled]="pg.meta.page <= 1" (click)="load(pg.meta.page - 1)">Previous</button>
        <button class="btn btn-ghost btn-sm" type="button" [disabled]="pg.meta.page * pg.meta.perPage >= pg.meta.total" (click)="load(pg.meta.page + 1)">Next</button></span></div>
    }
  `,
  styles: `
    .head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .stats { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); margin: 4px 0 16px; }
    .st { display: grid; gap: 2px; text-align: left; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); border-top: 3px solid var(--c); background: #fff; cursor: pointer; font: inherit; color: var(--fg); }
    .st.on { box-shadow: 0 0 0 2px var(--c); }
    .st b { font: 700 24px var(--f-head); color: var(--heading); } .st span { font-size: 12px; color: var(--muted); }
    .tools { display: grid; gap: 10px; margin-bottom: 14px; }
    .search { max-width: 520px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .offerings td { vertical-align: middle; }
    .prod { display: flex; gap: 12px; align-items: center; min-width: 240px; }
    .thumb { width: 72px; height: 48px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: linear-gradient(135deg, #3282f6, #7b5cff); display: block; }
    .pinfo { display: grid; gap: 2px; min-width: 0; }
    .desc { font-size: 12px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 46ch; }
    .ft { margin-left: 8px; }
    .type { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; background: #eef2f7; color: #36415a; }
    .t-software { background: #e8f1ff; color: #1b4fd1; } .t-learning { background: #e3f8ef; color: #11734b; } .t-training { background: #f1ecff; color: #5b3fd6; } .t-development { background: #fff3dc; color: #8a5a00; }
    .inc { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px; }
    .inc span { padding: 2px 8px; border-radius: 6px; background: #f2f4f8; color: var(--muted); white-space: nowrap; } .inc span.yes { background: #e9f8ef; color: #11734b; }
    tr.arch { opacity: .6; }
    .offerings .row-actions { flex-wrap: nowrap; justify-content: flex-end; }
    .more { position: relative; } .more summary { list-style: none; } .more summary::-webkit-details-marker { display: none; }
    .menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 170px; display: grid; padding: 6px; border-radius: 10px; background: #fff; border: 1px solid var(--line); box-shadow: 0 12px 30px -12px rgba(20,30,60,.35); }
    .menu button { text-align: left; background: none; border: 0; padding: 8px 10px; border-radius: 6px; font: inherit; font-size: 14px; cursor: pointer; color: var(--fg); }
    .menu button:hover { background: #f3f6fa; } .menu .danger { color: var(--danger, #c62f3f); }
    .linkish { background: none; border: 0; padding: 0; color: var(--sch-blue); text-decoration: underline; cursor: pointer; font: inherit; }
  `,
})
export class ProductsAdminPage implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(CatalogueApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected page = signal<Page<ProductRow> | null>(null);
  protected stats = signal<ProductStats | null>(null);
  protected err = signal<string | null>(null);
  protected notice = signal<string | null>(null);
  protected filters = FILTERS;
  protected typeLabel = OFFERING_LABEL;
  protected filter = 'all';
  protected q = '';
  protected statKeys: [keyof ProductStats, string, string, string][] = [
    ['total', 'Total offerings', 'all', '#3282F6'], ['published', 'Published', 'published', '#22a06b'], ['draft', 'Drafts', 'draft', '#F5A524'],
    ['software', 'Software products', 'software', '#1b4fd1'], ['learning', 'Learning content', 'learning', '#14C2B0'], ['training', 'Training / courses', 'training', '#7B5CFF'],
    ['withDemo', 'With demos', 'demo', '#E7458C'], ['withoutDemo', 'Without demos', 'nodemo', '#8a93a6'], ['development', 'Under development', 'development', '#b26b00'],
  ];

  ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    const legacy = qp.get('state') ?? (qp.get('status') === 'coming_soon' ? 'development' : null);
    if (legacy && FILTERS.some((f) => f.key === legacy)) this.filter = legacy;
    if (qp.get('filter') && FILTERS.some((f) => f.key === qp.get('filter'))) this.filter = qp.get('filter')!;
    if (qp.get('deleted')) this.notice.set(`“${qp.get('deleted')}” was deleted.`);
    void this.load(1);
  }
  setFilter(key: string) {
    this.filter = key;
    void this.router.navigate([], { queryParams: { filter: key === 'all' ? null : key }, replaceUrl: true });
    void this.load(1);
  }
  async load(page: number) {
    const f = FILTERS.find((x) => x.key === this.filter) ?? FILTERS[0];
    try {
      const r = await this.api.products({ page, perPage: 25, q: this.q, ...f.q });
      this.page.set(r);
      this.stats.set(r.stats);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  create() {
    void this.router.navigate(['/admin/products', 'new']);
  }
  private closeMenus() {
    document.querySelectorAll('details.more[open]').forEach((d) => d.removeAttribute('open'));
  }
  async duplicate(p: ProductRow) {
    this.closeMenus();
    try {
      const r = await this.api.duplicateProduct(p.id);
      await this.router.navigate(['/admin/products', r.id], { queryParams: { duplicated: 1 } });
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  async state(p: ProductRow, action: 'publish' | 'unpublish' | 'archive' | 'restore') {
    this.closeMenus();
    if (action === 'archive' && !confirm(`Archive “${p.name}”? It is removed from the website and the active list. Nothing is deleted.`)) return;
    this.err.set(null);
    try {
      await this.api.productState(p.id, action);
      this.notice.set(`“${p.name}” ${action === 'publish' ? 'is now live on the website' : action === 'unpublish' ? 'was unpublished' : action === 'archive' ? 'was archived' : 'was restored as a draft'}.`);
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  /** Delete permanently when no customer depends on the offering; otherwise offer to archive it. */
  async remove(p: ProductRow) {
    this.closeMenus();
    this.err.set(null);
    this.notice.set(null);
    try {
      const chk = await this.api.productDeleteCheck(p.id);
      if (!chk.canDelete) {
        const u = chk.usage;
        const parts = [u.demos && `${u.demos} demo(s)`, u.licences && `${u.licences} licence(s)`, u.downloads && `${u.downloads} download(s)`, u.salesEnquiries && `${u.salesEnquiries} sales enquiry(ies)`].filter(Boolean).join(', ');
        if (p.is_archived) { this.err.set(`“${p.name}” can't be deleted because customers have ${parts} for it. It is already archived (hidden from the website).`); return; }
        if (confirm(`“${p.name}” can't be deleted because customers have ${parts} for it.\n\nArchive it instead? It will be removed from the website and the active list, and customer records stay intact.`)) {
          await this.api.productState(p.id, 'archive');
          this.notice.set(`“${p.name}” was archived.`);
          await this.load(this.page()?.meta.page ?? 1);
        }
        return;
      }
      if (!confirm(`Permanently delete “${p.name}”?\n\nThis removes the page, pricing, versions, videos and setup steps. It cannot be undone.`)) return;
      await this.api.deleteProduct(p.id);
      this.notice.set(`“${p.name}” was deleted.`);
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
}

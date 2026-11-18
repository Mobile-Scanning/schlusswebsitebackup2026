import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService, toApiError } from '../core/auth.service';
import { fileSize, PlatformApi, Row } from './platform-api';

export const CONTENT_TYPES: [string, string][] = [['video', 'Video'], ['tutorial', 'Tutorial'], ['demonstration', 'Product demonstration'], ['training', 'Training video'], ['installation', 'Installation guide'], ['feature', 'Feature explanation'], ['other', 'Other']];
export const ACCESS: [string, string][] = [['public', 'Public – anyone'], ['registered', 'Registered customers (signed in, verified)'], ['authorised', 'Authorised customers only (active licence for this product)'], ['demo', 'Active demo customers (and licence holders)']];
const typeLabel = Object.fromEntries(CONTENT_TYPES);
const accessShort: Record<string, string> = { public: 'Public', registered: 'Registered', authorised: 'Authorised', demo: 'Demo', inherit: 'Product default' };
const providerLabel: Record<string, string> = { youtube: 'YouTube', vimeo: 'Vimeo', upload: 'Secure upload' };
const dur = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const parseDur = (v: string) => {
  const p = String(v || '').trim().split(':').map(Number);
  if (!p.length || p.some((n) => Number.isNaN(n))) return null;
  const s = p.reduce((t, n) => t * 60 + n, 0);
  return s > 0 ? s : null;
};

const STYLES = `
  :host { display: block; }
  .kpis { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); margin: 0 0 14px; }
  .kpi { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: #fff; border-top: 3px solid var(--c, var(--sch-blue)); }
  .kpi b { display: block; font: 700 24px var(--f-head); color: var(--heading); } .kpi b.small { font-size: 15px; line-height: 1.5; } .kpi span { font-size: 12px; color: var(--muted); }
  .vis { padding: 12px 14px; border-radius: 12px; background: #fff5df; border: 1px solid #f0d49a; margin: 0 0 14px; font-size: 14px; }
  .vis ul { margin: 6px 0 10px; padding-left: 18px; } .vis li { margin: 3px 0; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0 16px; }
  .bar .grow { flex: 1; }
  .access { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 12px; border-radius: 10px; background: var(--surface-2, #f3f6fa); font-size: 14px; margin-bottom: 12px; }
  .access .select { width: auto; min-width: 260px; }
  .cat { border: 1px solid var(--line); border-radius: 14px; margin-bottom: 14px; background: #fff; overflow: hidden; }
  .cat > header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 14px; background: var(--surface-2, #f6f8fb); border-bottom: 1px solid var(--line); }
  .cat > header h3 { margin: 0; font-size: 16px; } .cat > header .grow { flex: 1; }
  .items { list-style: none; margin: 0; padding: 0; }
  .it { display: grid; grid-template-columns: 16px 22px 112px 1fr auto; gap: 12px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line); }
  .it:first-child { border-top: 0; } .it.sel { background: #f3f8ff; }
  .thumb { width: 112px; aspect-ratio: 16 / 9; border-radius: 8px; object-fit: cover; background: linear-gradient(135deg, #3282f6, #7b5cff); display: block; }
  .t strong { display: block; } .t .muted { font-size: 12px; }
  .warn { color: #8a5a00; font-size: 12px; display: block; } .bad { color: var(--danger, #c62f3f); font-size: 12px; display: block; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
  .ic { min-width: 32px; padding: 0 8px; }
  .empty { padding: 14px; color: var(--muted); font-size: 14px; }
  .bulk { position: sticky; top: 8px; z-index: 5; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 14px; border-radius: 12px; background: #1b3a8a; color: #fff; margin-bottom: 12px; }
  .bulk .select { width: auto; }
  .src { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .src label { display: flex; gap: 6px; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; font-size: 14px; }
  .src label.on { border-color: var(--sch-blue); background: #f3f8ff; }
  .check-res { margin-top: 8px; padding: 10px 12px; border-radius: 10px; font-size: 13px; display: flex; gap: 10px; align-items: center; }
  .check-res.ok { background: #e9f8ef; } .check-res.no { background: #fdecee; } .check-res.maybe { background: #fff5df; }
  .check-res img { width: 96px; border-radius: 6px; }
  .cover-ed { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  .cover-ed img, .cover-ed .ph { width: 240px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); background: repeating-linear-gradient(45deg, #f2f4f8, #f2f4f8 10px, #e8ecf2 10px, #e8ecf2 20px); display: grid; place-items: center; color: var(--muted); font-size: 13px; }
  .prog { height: 6px; border-radius: 4px; background: #e6ebf2; overflow: hidden; margin-top: 6px; } .prog i { display: block; height: 100%; background: var(--sch-blue); }
  .an { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .an ol { margin: 0; padding-left: 18px; font-size: 14px; } .an li { margin: 3px 0; }
  .act { display: flex; gap: 2px; align-items: flex-end; height: 70px; } .act i { flex: 1; min-height: 2px; background: #3282f6; border-radius: 2px 2px 0 0; }
  .sec { margin-top: 22px; } .sec h3 { font-size: 16px; }
  .small { font-size: 13px; } .tiny { font-size: 12px; }
  .grip { cursor: grab; color: var(--muted); font-size: 16px; line-height: 1; user-select: none; touch-action: none; padding: 4px 0; text-align: center; }
  .grip:active { cursor: grabbing; }
  .it.dragging, .cat.dragging { opacity: .45; }
  .it.drop-before { box-shadow: inset 0 3px 0 var(--sch-blue, #3282f6); }
  .items.drop-end { box-shadow: inset 0 -3px 0 var(--sch-blue, #3282f6); }
  .cat.drop-before { box-shadow: 0 -4px 0 var(--sch-blue, #3282f6); }
  .order-hint { font-size: 12px; color: var(--muted); margin: -6px 0 12px; }
  .pl-list { list-style: none; margin: 8px 0; padding: 0; max-height: 46vh; overflow: auto; border: 1px solid var(--line); border-radius: 10px; }
  .pl-list li { display: grid; grid-template-columns: 22px 28px 96px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px 10px; border-top: 1px solid var(--line); font-size: 14px; }
  .pl-list li:first-child { border-top: 0; }
  .pl-list li.off { opacity: .6; }
  .pl-list img { width: 96px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; background: #e8ecf2; }
  .pl-list .n { color: var(--muted); font: 600 12px var(--f-mono, monospace); text-align: right; }
  .pl-list .st { display: block; font-size: 12px; }
  .pl-head .row-actions { align-items: center; }
  .pl-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; margin-top: 10px; }
  .pl-opts { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 12px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-bottom: 10px; }
  .seg button { border: 0; background: #fff; padding: 8px 14px; font: inherit; font-size: 14px; cursor: pointer; }
  .seg button.on { background: #1b3a8a; color: #fff; }
  .pl-hint { margin-top: 8px; padding: 8px 12px; border-radius: 10px; background: #eef4ff; font-size: 13px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  @media (max-width: 760px) { .it { grid-template-columns: 16px 22px 80px 1fr; } .pl-list li { grid-template-columns: 22px 72px minmax(0, 1fr); } .pl-list .n { display: none; } .pl-list img { width: 72px; } .it .acts { grid-column: 1 / -1; justify-content: flex-start; } .thumb { width: 80px; } }
`;

/**
 * Admin › Products › (product) › Content library.
 * Many content items per product, in categories; covers, video links / secure uploads, ordering, bulk
 * actions, preview and analytics. All rules (ownership, publish checks, permissions) are enforced on the server.
 */
@Component({
  selector: 'sch-pe-content',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (d(); as d) {
      <div class="kpis">
        <div class="kpi" style="--c: #3282F6"><b>{{ d.stats.total }}</b><span>Content items</span></div>
        <div class="kpi" style="--c: #22a06b"><b>{{ d.stats.published }}</b><span>Published</span></div>
        <div class="kpi" style="--c: #F5A524"><b>{{ d.stats.unpublished }}</b><span>Unpublished (drafts)</span></div>
        <div class="kpi" style="--c: #7B5CFF"><b>{{ d.stats.categories }}</b><span>Categories</span></div>
        <div class="kpi" style="--c: #14C2B0"><b class="small">{{ (d.stats.lastUpdated | date: 'd MMM y, HH:mm') ?? '—' }}</b><span>Last updated</span></div>
      </div>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (d.visibility; as v) {
        @if (v.coversMissing || v.videosMissing) {
          <div class="vis" role="status">
            <strong>Some files are missing from the server’s storage folder</strong>
            <ul>
              @if (v.coversMissing) { <li>{{ v.coversMissing }} cover {{ v.coversMissing === 1 ? 'image is' : 'images are' }} missing@if (v.coversRestorable.length) { – {{ restoring() ? 'restoring them from the video thumbnails now…' : v.coversRestorable.length + ' can be restored from the video thumbnails' }} }@if (v.coversMissing > v.coversRestorable.length) { ; covers of uploaded videos must be uploaded again (Edit › Replace image) }.</li> }
              @if (v.videosMissing) { <li><b>{{ v.videosMissing }} uploaded video {{ v.videosMissing === 1 ? 'file is' : 'files are' }} missing</b> – copy the old <code>storage</code> folder into this project folder, or upload the {{ v.videosMissing === 1 ? 'video' : 'videos' }} again.</li> }
            </ul>
            <span class="muted tiny">This happens when the website files are replaced or moved without the <code>storage</code> folder (uploaded files live there, not in the database).</span>
            @if (canEdit() && v.coversRestorable.length && !restoring()) { <div style="margin-top: 8px"><button class="btn btn-primary btn-sm" type="button" (click)="restoreCovers()">Restore {{ v.coversRestorable.length }} cover {{ v.coversRestorable.length === 1 ? 'image' : 'images' }}</button></div> }
          </div>
        }
        @if (!v.productPublished || !v.learningOn || v.drafts || v.inHiddenCategories || v.sourceOff) {
          <div class="vis" role="status">
            <strong>Not everything here is on the website yet</strong>
            <ul>
              @if (!v.productPublished) { <li>This offering isn’t published, so customers can’t open it at all. Publish it in “Publish, visibility & delete”.</li> }
              @if (!v.learningOn) { <li>The “Videos / lessons” feature is switched off for this offering – switch it on in “Offering type & features”.</li> }
              @if (v.drafts) {
                <li><b>{{ v.drafts }} {{ v.drafts === 1 ? 'video is a draft' : 'videos are drafts' }}</b> – drafts are never shown to customers.
                  @if (v.draftsNeedingCover) { {{ v.draftsNeedingCover }} uploaded {{ v.draftsNeedingCover === 1 ? 'video needs' : 'videos need' }} a cover image first. }
                  @if (v.draftsNotEmbeddable) { {{ v.draftsNotEmbeddable }} can’t be embedded (see the warning on the video). }
                </li>
              }
              @if (v.inHiddenCategories) { <li>{{ v.inHiddenCategories }} published {{ v.inHiddenCategories === 1 ? 'video is' : 'videos are' }} in a hidden category (use Rename › untick “Hide this category”).</li> }
              @if (v.sourceOff) { <li>{{ v.sourceOff }} {{ v.sourceOff === 1 ? 'video uses' : 'videos use' }} a video source that is switched off in Video & content settings.</li> }
            </ul>
            @if (canEdit() && v.readyDraftIds.length) {
              <button class="btn btn-primary btn-sm" type="button" (click)="publishReady()" [disabled]="busy()">{{ busy() ? 'Publishing…' : 'Publish ' + v.readyDraftIds.length + ' ready ' + (v.readyDraftIds.length === 1 ? 'video' : 'videos') + ' now' }}</button>
            }
          </div>
        }
      }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }

      @if (showAccess()) {
      <div class="access">
        <strong>Who can watch {{ d.product.name }} content?</strong>
        <select class="select sm" [(ngModel)]="access" [disabled]="!canEdit()" aria-label="Who can watch">
          <option value="default">Default ({{ accessShort[d.settings.defaultAccess] }})</option>
          @for (a of accessOpts; track a[0]) { <option [value]="a[0]">{{ a[1] }}</option> }
        </select>
        @if (canEdit()) { <button class="btn btn-ghost btn-sm" type="button" (click)="saveAccess()">Save</button> }
        <span class="muted tiny">Individual items can override this.</span>
      </div>
      }

      <div class="bar">
        @if (canEdit()) {
          <button class="btn btn-primary btn-sm" type="button" (click)="openItem(null)">+ Add a video</button>
          @if (providers().includes('youtube')) { <button class="btn btn-primary btn-sm" type="button" (click)="openPlaylist()">+ Import YouTube playlist</button> }
          <button class="btn btn-ghost btn-sm" type="button" (click)="openCat(null)">+ Category</button>
        }
        <span class="grow"></span>
        <a class="btn btn-ghost btn-sm" [href]="'/products/' + d.product.slug + '?contentPreview=1#library'" target="_blank" rel="noopener">Preview product page ↗</a>
        <button class="btn btn-ghost btn-sm" type="button" (click)="toggleStats()">{{ showStats() ? 'Hide' : 'Show' }} analytics</button>
      </div>

      @if (canEdit() && d.items.length > 1) { <p class="order-hint">Drag <span aria-hidden="true">⠿</span> to change the order videos and categories appear in on the website (or use ↑ ↓). Videos can be dragged into another category.</p> }

      @if (selected().size && canEdit()) {
        <div class="bulk" role="region" aria-label="Bulk actions">
          <strong>{{ selected().size }} selected</strong>
          <button class="btn btn-ghost btn-sm" type="button" (click)="bulk('publish')">Publish</button>
          <button class="btn btn-ghost btn-sm" type="button" (click)="bulk('unpublish')">Unpublish</button>
          <select class="select sm" [(ngModel)]="moveTo" aria-label="Move to category"><option [ngValue]="undefined">Move to…</option><option [ngValue]="null">Uncategorised</option>@for (c of d.categories; track c.id) {<option [ngValue]="c.id">{{ c.name }}</option>}</select>
          <button class="btn btn-ghost btn-sm" type="button" [disabled]="moveTo === undefined" (click)="bulk('move')">Move</button>
          <button class="btn btn-ghost btn-sm" type="button" (click)="clearSel()">Clear</button>
        </div>
      }

      @if (showStats()) {
        <section class="cat sec" style="padding: 14px">
          <h3 style="margin-top: 0">Content analytics – last 30 days</h3>
          @if (an(); as a) {
            <div class="kpis">
              <div class="kpi"><b>{{ a.views }}</b><span>Views</span></div>
              <div class="kpi"><b>{{ a.uniqueViewers }}</b><span>Unique viewers</span></div>
              <div class="kpi"><b>{{ a.completions }}</b><span>Watched to the end</span></div>
              <div class="kpi"><b>{{ a.avgPercent }}%</b><span>Average watched</span></div>
            </div>
            <div class="an">
              <div><strong class="small">Most viewed</strong><ol>@for (i of a.mostViewed; track i.id) { <li>{{ i.title }} <span class="muted tiny">{{ i.views }} {{ i.views === 1 ? 'view' : 'views' }} · {{ i.viewers }} {{ i.viewers === 1 ? 'viewer' : 'viewers' }}</span></li> } @empty { <li class="muted">No views yet</li> }</ol></div>
              <div><strong class="small">Least viewed</strong><ol>@for (i of a.leastViewed; track i.id) { <li>{{ i.title }} <span class="muted tiny">{{ i.views }} {{ i.views === 1 ? 'view' : 'views' }}</span></li> } @empty { <li class="muted">—</li> }</ol></div>
              <div><strong class="small">Popular categories</strong><ol>@for (c of a.categories; track c.name) { <li>{{ c.name }} <span class="muted tiny">{{ c.views }} {{ c.views === 1 ? 'view' : 'views' }}</span></li> } @empty { <li class="muted">—</li> }</ol></div>
              <div><strong class="small">Viewing activity</strong><div class="act" role="img" [attr.aria-label]="a.views + ' views in the last 30 days'">@for (x of a.activity; track x.day) { <i [style.height.%]="(x.views / maxAct()) * 100" [title]="x.day + ': ' + x.views"></i> }</div></div>
            </div>
          } @else { <p class="muted">Loading…</p> }
        </section>
      }

      @for (g of groups(); track g.id ?? 'none'; let gi = $index) {
        <section class="cat" [class.dragging]="drag()?.kind === 'cat' && drag()?.id === g.id" [class.drop-before]="catDrop() === gi && !!g.id"
          (dragover)="overCat($event, g, gi)" (drop)="drop($event)">
          <header>
            @if (canEdit() && g.id) { <span class="grip" draggable="true" (dragstart)="startCat($event, g)" (dragend)="endDrag()" title="Drag to reorder categories" aria-hidden="true">⠿</span> }
            @if (canEdit()) { <input type="checkbox" [checked]="allSel(g.items)" (change)="selAll(g.items, $any($event.target).checked)" [attr.aria-label]="'Select all in ' + g.name" /> }
            <h3>{{ g.name }}</h3>
            @if (g.status === 'hidden') { <span class="badge badge-muted">Hidden</span> }
            <span class="muted tiny">{{ g.items.length }} item(s)</span>
            <span class="grow"></span>
            @if (canEdit() && g.id) {
              <button class="btn btn-ghost btn-sm ic" type="button" (click)="moveCat(gi, -1)" [disabled]="gi === 0" aria-label="Move category up">↑</button>
              <button class="btn btn-ghost btn-sm ic" type="button" (click)="moveCat(gi, 1)" [disabled]="gi >= d.categories.length - 1" aria-label="Move category down">↓</button>
              @if (g.cat?.source_playlist) { <button class="btn btn-ghost btn-sm" type="button" (click)="openPlaylist(g.cat)" title="Import videos added to the YouTube playlist since the last import">↻ New videos from playlist</button> }
              <button class="btn btn-ghost btn-sm" type="button" (click)="openCat(g.cat)">Rename</button>
              <button class="btn btn-danger btn-sm" type="button" (click)="openDelCat(g.cat)">Delete</button>
            }
          </header>
          <ul class="items" [class.drop-end]="itemDrop()?.group === g.id && itemDrop()?.index === g.items.length" (dragover)="overList($event, g)">
            @for (i of g.items; track i.id; let ii = $index) {
              <li class="it" [class.sel]="selected().has(i.id)" [class.dragging]="drag()?.kind === 'item' && drag()?.id === i.id" [class.drop-before]="itemDrop()?.group === g.id && itemDrop()?.index === ii"
                (dragover)="overItem($event, g, ii)">
                @if (canEdit()) { <span class="grip" draggable="true" (dragstart)="startItem($event, i)" (dragend)="endDrag()" title="Drag to reorder" aria-hidden="true">⠿</span> } @else { <span></span> }
                @if (canEdit()) { <input type="checkbox" [checked]="selected().has(i.id)" (change)="toggleSel(i.id)" [attr.aria-label]="'Select ' + i.title" /> } @else { <span></span> }
                @if (i.coverPreview) { <img class="thumb" [src]="i.coverPreview" alt="" loading="lazy" (error)="$any($event.target).removeAttribute('src')" /> } @else { <span class="thumb" title="No cover yet"></span> }
                <div class="t">
                  <strong>{{ i.title }}</strong>
                  <span class="muted">{{ typeLabel[i.content_type] }} · {{ providerLabel[i.video_provider] }}@if (i.duration_seconds) { · {{ dur(i.duration_seconds) }} } · {{ accessShort[i.access_level] }} · {{ i.views }} view(s)</span>
                  <span><span class="badge" [class]="'badge ' + (i.status === 'published' ? 'badge-ok' : 'badge-muted')">{{ i.status === 'published' ? 'Published' : 'Draft' }}</span></span>
                  @if (i.embed_check?.ok === false) { <span class="bad">⚠ {{ i.embed_check.message }}</span> }
                  @else if (i.embed_check?.ok === null) { <span class="warn">Not verified: {{ i.embed_check.message }}</span> }
                  @if (i.warning) { <span class="warn">{{ i.warning }}</span> }
                  @if (!i.cover_media_id) { <span class="warn">No cover image yet.</span> }
                  @if (i.coverMissing) { <span class="warn">The cover image file is missing from the storage folder.</span> }
                  @if (i.videoMissing) { <span class="bad">⚠ The uploaded video file is missing from the storage folder – upload it again.</span> }
                </div>
                <div class="acts">
                  @if (canEdit()) {
                    <button class="btn btn-ghost btn-sm ic" type="button" (click)="moveItem(g.items, ii, -1)" [disabled]="ii === 0" aria-label="Move up">↑</button>
                    <button class="btn btn-ghost btn-sm ic" type="button" (click)="moveItem(g.items, ii, 1)" [disabled]="ii >= g.items.length - 1" aria-label="Move down">↓</button>
                  }
                  <a class="btn btn-ghost btn-sm" [href]="'/products/' + d.product.slug + '/content/' + i.id + '?preview=1'" target="_blank" rel="noopener">Preview</a>
                  @if (canEdit()) {
                    <button class="btn btn-ghost btn-sm" type="button" (click)="openItem(i)">Edit</button>
                    <button class="btn btn-ghost btn-sm" type="button" (click)="quick(i)">{{ i.status === 'published' ? 'Unpublish' : 'Publish' }}</button>
                    <button class="btn btn-danger btn-sm" type="button" (click)="removeItem(i)">Delete</button>
                  }
                </div>
              </li>
            } @empty { <li class="empty">No content in this category yet.</li> }
          </ul>
        </section>
      } @empty { <p class="muted">No content yet. Add a category (e.g. “Getting Started”), then add videos, tutorials and demonstrations to it.</p> }

      <!-- Item editor -->
      <dialog #itemDlg class="dlg wide">
        <form (ngSubmit)="saveItem()">
          <h2>{{ f.id ? 'Edit content' : 'Add content' }} – {{ d.product.name }}</h2>
          @if (dlgErr()) { <div class="alert alert-error" role="alert">{{ dlgErr() }}</div> }
          <div class="form-row">
            <div class="field"><label for="ct">Title</label><input id="ct" class="input" name="t" [(ngModel)]="f.title" maxlength="191" />@if (fe('title')) {<span class="error">{{ fe('title') }}</span>}</div>
            <div class="field"><label for="cty">Content type</label><select id="cty" class="select" name="ty" [(ngModel)]="f.contentType">@for (t of types; track t[0]) {<option [value]="t[0]">{{ t[1] }}</option>}</select></div>
            <div class="field"><label for="cca">Category</label><select id="cca" class="select" name="ca" [(ngModel)]="f.categoryId"><option [ngValue]="null">Uncategorised</option>@for (c of d.categories; track c.id) {<option [ngValue]="c.id">{{ c.name }}</option>}</select>@if (fe('categoryId')) {<span class="error">{{ fe('categoryId') }}</span>}</div>
          </div>
          <div class="field"><label for="cde">Short description</label><textarea id="cde" class="textarea" rows="2" name="de" [(ngModel)]="f.description" maxlength="1000"></textarea></div>

          <div class="field"><span class="label">Video source</span>
            <div class="src">
              @for (p of providers(); track p) { <label [class.on]="f.provider === p"><input type="radio" name="pr" [value]="p" [(ngModel)]="f.provider" (change)="check.set(null)" />{{ providerLabel[p] }}</label> }
            </div>
            @if (f.provider === 'upload') {
              <div class="row-actions">
                <label class="btn btn-ghost btn-sm">{{ f.videoMediaId ? 'Replace video file' : 'Upload video file' }}<input type="file" hidden accept=".mp4,.m4v,.webm,video/mp4,video/webm" (change)="uploadVideo($event)" /></label>
                @if (f.videoName) { <span class="small">{{ f.videoName }}</span> }
              </div>
              @if (vPct() !== null) { <div class="prog" role="progressbar" [attr.aria-valuenow]="vPct()"><i [style.width.%]="vPct()"></i></div> }
              <span class="hint">MP4 (H.264) or WebM. Stored privately and streamed through short-lived, session-bound links – customers get no download button and no file link.</span>
              @if (fe('videoMediaId')) {<span class="error">{{ fe('videoMediaId') }}</span>}
            } @else {
              <div class="row-actions">
                <input class="input" style="flex: 1 1 320px" name="u" [(ngModel)]="f.url" [placeholder]="f.provider === 'youtube' ? 'https://www.youtube.com/watch?v=… or https://youtu.be/…' : 'https://vimeo.com/123456789 (private: …/123456789/abcdef1234)'" />
                <button class="btn btn-ghost btn-sm" type="button" (click)="testLink()" [disabled]="!f.url">Test link</button>
              </div>
              @if (fe('url')) {<span class="error">{{ fe('url') }}</span>}
              @if (f.provider === 'youtube' && isPlaylistUrl(f.url)) {
                <div class="pl-hint" role="note">
                  <span>{{ isSingleInPlaylist(f.url) ? 'This video is part of a YouTube playlist (folder).' : 'This is a YouTube playlist (folder) link.' }}</span>
                  <button class="btn btn-ghost btn-sm" type="button" (click)="playlistFromItem()">Import the whole playlist instead</button>
                </div>
              }
              @if (check(); as c) {
                <div class="check-res" [class.ok]="c.ok === true" [class.no]="c.ok === false" [class.maybe]="c.ok === null">
                  @if (c.thumbnail) { <img [src]="c.thumbnail" alt="" /> }
                  <div><strong>{{ c.ok === true ? 'Embeddable' : c.ok === false ? 'Can’t be embedded' : 'Not verified' }}</strong>@if (c.title) { – {{ c.title }} }<br />{{ c.message }}@if (c.warning) { <br /><span class="warn">{{ c.warning }}</span> }</div>
                </div>
              }
            }
          </div>

          <div class="field"><span class="label">Cover image</span>
            <div class="cover-ed">
              @if (f.coverPreview) { <img [src]="f.coverPreview" alt="Cover preview" /> } @else { <span class="ph">No cover yet</span> }
              <div class="row-actions">
                <label class="btn btn-ghost btn-sm">{{ f.coverMediaId ? 'Replace image' : 'Upload image' }}<input type="file" hidden accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" (change)="uploadCover($event)" /></label>
                @if (f.coverMediaId) { <button class="btn btn-ghost btn-sm" type="button" (click)="f.coverMediaId = null; f.coverPreview = null">Remove</button> }
              </div>
            </div>
            <span class="hint">JPG, PNG or WebP, ideally 1280×720 or larger (16:9). It is resized and optimised automatically.@if (coverBusy()) { Uploading… }</span>
            @if (fe('coverMediaId')) {<span class="error">{{ fe('coverMediaId') }}</span>}
          </div>

          <div class="form-row">
            <div class="field"><label for="cdu">Duration <span class="muted">(optional, m:ss)</span></label><input id="cdu" class="input" name="du" [(ngModel)]="f.duration" placeholder="e.g. 4:30" /></div>
            <div class="field"><label for="ctg">Tags <span class="muted">(optional, comma-separated)</span></label><input id="ctg" class="input" name="tg" [(ngModel)]="f.tags" placeholder="e.g. setup, scanning" /></div>
            <div class="field"><label for="cor">Display order</label><input id="cor" class="input" type="number" min="0" name="or" [(ngModel)]="f.displayOrder" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="cac">Who can watch</label><select id="cac" class="select" name="ac" [(ngModel)]="f.accessLevel"><option value="inherit">Same as the product ({{ accessShort[d.product.effectiveAccess] }})</option>@for (a of accessOpts; track a[0]) {<option [value]="a[0]">{{ a[1] }}</option>}</select></div>
            <div class="field"><label for="cst">Status</label><select id="cst" class="select" name="st" [(ngModel)]="f.status"><option value="draft">Draft – not visible to customers</option><option value="published">Published</option></select></div>
          </div>
          <div class="actions"><button class="btn btn-ghost" type="button" (click)="itemDlg.close()">Cancel</button><button class="btn btn-primary" type="submit" [disabled]="busy() || coverBusy() || vPct() !== null">{{ busy() ? 'Saving…' : 'Save' }}</button></div>
        </form>
      </dialog>

      <!-- YouTube playlist import -->
      <dialog #plDlg class="dlg wide">
        <form (ngSubmit)="pl() ? importPlaylist() : loadPlaylist()">
          <h2>Import a YouTube playlist – {{ d.product.name }}</h2>
          <p class="small muted" style="margin-top: 0">Add every video of a YouTube playlist (folder) in one go, in the playlist’s order. Single videos can still be added with “+ Add a video”.</p>
          @if (dlgErr()) { <div class="alert alert-error" role="alert">{{ dlgErr() }}</div> }
          <div class="field">
            <label for="plu">Playlist link</label>
            <div class="row-actions">
              <input id="plu" class="input" style="flex: 1 1 320px" name="plu" [(ngModel)]="p.url" placeholder="https://www.youtube.com/playlist?list=PL…" (ngModelChange)="pl.set(null)" />
              <button class="btn btn-ghost btn-sm" type="button" (click)="loadPlaylist()" [disabled]="!p.url || plBusy()">{{ plBusy() && !pl() ? 'Reading…' : 'Load playlist' }}</button>
            </div>
            @if (fe('url')) {<span class="error">{{ fe('url') }}</span>}
            <span class="hint">On YouTube, open the playlist and copy the link from the address bar or Share. The playlist must be Public or Unlisted.</span>
          </div>

          @if (pl(); as l) {
            <div class="pl-head">
              <strong>{{ l.title }} · {{ l.videos.length }} {{ l.videos.length === 1 ? 'video' : 'videos' }}</strong>
              <span class="row-actions">
                <button class="btn btn-ghost btn-sm" type="button" (click)="plSelect('new')">Select new</button>
                <button class="btn btn-ghost btn-sm" type="button" (click)="plSelect('none')">Select none</button>
                <span class="small">{{ plChosen().length }} selected</span>
              </span>
            </div>
            @if (l.note) { <div class="alert" role="note" style="margin-top: 8px">{{ l.note }}</div> }
            <ul class="pl-list">
              @for (v of l.videos; track v.videoId; let n = $index) {
                <li [class.off]="!!v.existingId">
                  <input type="checkbox" [checked]="plSel().has(v.videoId)" [disabled]="!!v.existingId" (change)="plToggle(v.videoId)" [attr.aria-label]="'Import ' + v.title" />
                  <span class="n">{{ n + 1 }}</span>
                  <img [src]="v.thumbnail" alt="" loading="lazy" />
                  <span>
                    <strong>{{ v.title || 'Untitled video' }}</strong>@if (v.durationSeconds) { <span class="muted tiny"> · {{ dur(v.durationSeconds) }}</span> }
                    @if (v.existingId) { <span class="st muted">Already in this product’s library – skipped</span> }
                    @else if (v.embeddable === false) { <span class="st bad">⚠ {{ v.problem }} (imported as a draft)</span> }
                    @else if (v.embeddable === null) { <span class="st warn">Couldn’t be tested from the server</span> }
                  </span>
                </li>
              }
            </ul>

            <div class="seg" role="group" aria-label="Where to put the videos">
              <button type="button" [class.on]="p.target === 'new'" (click)="p.target = 'new'">New category</button>
              @if (d.categories.length) { <button type="button" [class.on]="p.target === 'existing'" (click)="p.target = 'existing'">Existing category</button> }
              <button type="button" [class.on]="p.target === 'none'" (click)="p.target = 'none'">Uncategorised</button>
            </div>
            @if (p.target === 'new') {
              <div class="field"><label for="pln">Category name</label><input id="pln" class="input" name="pln" [(ngModel)]="p.categoryName" maxlength="120" />@if (fe('categoryName')) {<span class="error">{{ fe('categoryName') }}</span>}</div>
            } @else if (p.target === 'existing') {
              <div class="field"><label for="plc">Category</label><select id="plc" class="select" name="plc" [(ngModel)]="p.categoryId">@for (c of d.categories; track c.id) {<option [ngValue]="c.id">{{ c.name }}</option>}</select></div>
            }
            <div class="pl-opts">
              <div class="field"><label for="plt">Content type</label><select id="plt" class="select" name="plt" [(ngModel)]="p.contentType">@for (t of types; track t[0]) {<option [value]="t[0]">{{ t[1] }}</option>}</select></div>
              <div class="field"><label for="pla">Who can watch</label><select id="pla" class="select" name="pla" [(ngModel)]="p.accessLevel"><option value="inherit">Same as the product ({{ accessShort[d.product.effectiveAccess] }})</option>@for (a of accessOpts; track a[0]) {<option [value]="a[0]">{{ a[1] }}</option>}</select></div>
            </div>
            <label class="check"><input type="checkbox" name="plcv" [(ngModel)]="p.covers" /><span>Use each video’s YouTube thumbnail as its cover image (you can replace any cover later)</span></label>
            <label class="check"><input type="checkbox" name="plp" [(ngModel)]="p.publish" /><span>Publish straight away (otherwise they are saved as drafts for you to check first)</span></label>
            @if (accessWarn()) { <p class="warn">{{ accessWarn() }}</p> }
          }
          <div class="actions">
            <button class="btn btn-ghost" type="button" (click)="plDlg.close()">Cancel</button>
            @if (pl()) { <button class="btn btn-primary" type="submit" [disabled]="plBusy() || !plChosen().length">{{ plBusy() ? 'Importing…' : 'Import ' + plChosen().length + ' ' + (plChosen().length === 1 ? 'video' : 'videos') }}</button> }
            @else { <button class="btn btn-primary" type="submit" [disabled]="!p.url || plBusy()">{{ plBusy() ? 'Reading…' : 'Load playlist' }}</button> }
          </div>
        </form>
      </dialog>

      <!-- Category editor -->
      <dialog #catDlg class="dlg">
        <form (ngSubmit)="saveCat()">
          <h2>{{ cf.id ? 'Rename category' : 'New category' }}</h2>
          @if (dlgErr()) { <div class="alert alert-error">{{ dlgErr() }}</div> }
          <div class="field"><label for="cn">Name</label><input id="cn" class="input" name="n" [(ngModel)]="cf.name" placeholder="e.g. Getting Started" /></div>
          <div class="field"><label for="cd">Description <span class="muted">(optional)</span></label><textarea id="cd" class="textarea" rows="2" name="d" [(ngModel)]="cf.description"></textarea></div>
          <label class="check"><input type="checkbox" name="h" [(ngModel)]="cf.hidden" /><span>Hide this category from customers</span></label>
          <div class="actions"><button class="btn btn-ghost" type="button" (click)="catDlg.close()">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
        </form>
      </dialog>

      <!-- Delete category -->
      <dialog #delDlg class="dlg">
        @if (delCat(); as c) {
          <form (ngSubmit)="confirmDelCat()">
            <h2>Delete “{{ c.name }}”?</h2>
            @if (c.items) {
              <p class="small">This category contains {{ c.items }} content item(s). What should happen to them?</p>
              <label class="check"><input type="radio" name="m" value="move" [(ngModel)]="del.items" /><span>Move them to another category</span></label>
              @if (del.items === 'move') { <select class="select sm" name="t" [(ngModel)]="del.target" style="margin: 0 0 8px 28px; width: auto">@for (o of d.categories; track o.id) { @if (o.id !== c.id) {<option [ngValue]="o.id">{{ o.name }}</option>} }</select> }
              <label class="check"><input type="radio" name="m" value="uncategorise" [(ngModel)]="del.items" /><span>Keep them as uncategorised content</span></label>
              <label class="check"><input type="radio" name="m" value="delete" [(ngModel)]="del.items" /><span><strong>Delete them too</strong> (cannot be undone)</span></label>
            } @else { <p class="small">The category is empty.</p> }
            @if (dlgErr()) { <div class="alert alert-error">{{ dlgErr() }}</div> }
            <div class="actions"><button class="btn btn-ghost" type="button" (click)="delDlg.close()">Cancel</button><button class="btn btn-danger" type="submit">Delete category</button></div>
          </form>
        }
      </dialog>
    } @else if (err()) { <div class="alert alert-error">{{ err() }}</div> } @else { <p class="muted">Loading…</p> }
  `,
  styles: STYLES,
})
export class ProductContentTab implements OnInit {
  readonly productId = input.required<number>();
  /** The unified product editor has its own “Customer access” section, so it hides this line. */
  readonly showAccess = input(true);
  /** Emits the counts whenever the library changes, so the editor's section summary stays current. */
  readonly changed = output<{ total: number; published: number; categories: number }>();
  private api = inject(PlatformApi);
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  protected itemDlg = viewChild.required<ElementRef<HTMLDialogElement>>('itemDlg');
  protected catDlg = viewChild.required<ElementRef<HTMLDialogElement>>('catDlg');
  protected delDlg = viewChild.required<ElementRef<HTMLDialogElement>>('delDlg');
  protected plDlg = viewChild.required<ElementRef<HTMLDialogElement>>('plDlg');
  /* playlist import */
  protected p: Row = {};
  protected pl = signal<Row | null>(null);
  protected plSel = signal(new Set<string>());
  protected plBusy = signal(false);
  protected plChosen = computed(() => (this.pl()?.videos ?? []).filter((v: Row) => !v.existingId && this.plSel().has(v.videoId)));
  /* drag and drop */
  protected drag = signal<{ kind: 'item' | 'cat'; id: number | null } | null>(null);
  protected itemDrop = signal<{ group: number | null; index: number } | null>(null);
  protected catDrop = signal<number | null>(null);
  protected d = signal<Row | null>(null);
  protected an = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  protected dlgErr = signal<string | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected busy = signal(false);
  protected coverBusy = signal(false);
  protected vPct = signal<number | null>(null);
  protected check = signal<Row | null>(null);
  protected showStats = signal(false);
  protected selected = signal(new Set<number>());
  protected delCat = signal<Row | null>(null);
  protected types = CONTENT_TYPES;
  protected accessOpts = ACCESS;
  protected typeLabel = typeLabel;
  protected accessShort = accessShort;
  protected providerLabel = providerLabel;
  protected dur = dur;
  protected Set = Set;
  protected access = 'default';
  protected moveTo: number | null | undefined = undefined;
  protected f: Row = {};
  protected cf: Row = {};
  protected del: Row = { items: 'move', target: null };
  protected canEdit = () => this.auth.can('products.manage');
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected providers = computed(() => (['youtube', 'vimeo', 'upload'] as const).filter((p) => this.d()?.settings.providers[p] !== false));
  protected maxAct = computed(() => Math.max(1, ...((this.an()?.activity ?? []) as Row[]).map((x) => x.views)));
  protected groups = computed(() => {
    const d = this.d();
    if (!d) return [];
    const byOrder = (a: Row, b: Row) => a.display_order - b.display_order || a.id - b.id;
    const g = d.categories.map((c: Row) => ({ id: c.id, name: c.name, status: c.status, cat: c, items: d.items.filter((i: Row) => i.category_id === c.id).sort(byOrder) }));
    const none = d.items.filter((i: Row) => !i.category_id).sort(byOrder);
    if (none.length) g.push({ id: null, name: 'Uncategorised', status: 'active', cat: null, items: none });
    return g;
  });

  ngOnInit() {
    void this.load();
  }
  private apply(d: Row) {
    this.d.set(d);
    this.changed.emit({ total: d.stats.total, published: d.stats.published, categories: d.stats.categories });
    this.access = d.product.contentAccess ?? 'default';
    const ids = new Set<number>(d.items.map((i: Row) => i.id));
    this.selected.set(new Set([...this.selected()].filter((x) => ids.has(x))));
    if (this.showStats()) void this.loadStats();
    if (!this.triedRestore && this.canEdit() && d.visibility?.coversRestorable?.length) {
      this.triedRestore = true;
      void this.restoreCovers();
    }
  }
  async load() {
    try {
      this.apply(await this.api.get(`/products/${this.productId()}/content`));
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  toggleStats() {
    this.showStats.set(!this.showStats());
    if (this.showStats()) void this.loadStats();
  }
  async loadStats() {
    this.an.set(await this.api.get(`/products/${this.productId()}/content/analytics`, { days: 30 }));
  }
  private async run(fn: () => Promise<Row>, ok?: string) {
    this.err.set(null);
    this.msg.set(null);
    try {
      const r = await fn();
      if (r?.items) this.apply(r);
      if (ok) this.msg.set(ok);
      return r;
    } catch (e) {
      this.err.set(toApiError(e).message);
      return null;
    }
  }

  saveAccess() {
    void this.run(() => this.api.put(`/products/${this.productId()}/content/access`, { access: this.access }), 'Access setting saved.');
  }

  /* ---------- selection & bulk ---------- */
  clearSel() {
    this.selected.set(new Set());
  }
  toggleSel(id: number) {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.selected.set(s);
  }
  allSel = (items: Row[]) => items.length > 0 && items.every((i) => this.selected().has(i.id));
  selAll(items: Row[], on: boolean) {
    const s = new Set(this.selected());
    for (const i of items) {
      if (on) s.add(i.id);
      else s.delete(i.id);
    }
    this.selected.set(s);
  }
  async bulk(action: 'publish' | 'unpublish' | 'move') {
    const ids = [...this.selected()];
    const ok = await this.run(() => this.api.post(`/products/${this.productId()}/content/items/bulk`, { ids, action, categoryId: action === 'move' ? this.moveTo : undefined }), action === 'publish' ? `${ids.length} item(s) published.` : action === 'unpublish' ? `${ids.length} item(s) unpublished.` : `${ids.length} item(s) moved.`);
    if (ok) {
      this.selected.set(new Set());
      this.moveTo = undefined;
    }
  }
  quick(i: Row) {
    void this.run(() => this.api.post(`/products/${this.productId()}/content/items/bulk`, { ids: [i.id], action: i.status === 'published' ? 'unpublish' : 'publish' }), i.status === 'published' ? 'Unpublished.' : 'Published – customers can now see it.');
  }

  /* ---------- ordering ---------- */
  moveItem(items: Row[], index: number, dir: -1 | 1) {
    const ids = items.map((i) => i.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    void this.run(() => this.api.post(`/products/${this.productId()}/content/items/bulk`, { ids, action: 'order' }));
  }
  moveCat(index: number, dir: -1 | 1) {
    const ids = this.d()!.categories.map((c: Row) => c.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    void this.run(() => this.api.put(`/products/${this.productId()}/content/categories/order`, { ids }));
  }


  protected restoring = signal(false);
  private triedRestore = false;
  /** Missing cover files of link videos are recreated from the video thumbnails (automatically, once per visit). */
  async restoreCovers() {
    if (this.restoring()) return;
    this.restoring.set(true);
    const r = await this.run(() => this.api.post(`/products/${this.productId()}/content/covers/restore`, {}));
    this.restoring.set(false);
    if (r?.restore) this.msg.set(r.restore.restored ? `${r.restore.restored} cover ${r.restore.restored === 1 ? 'image was' : 'images were'} restored from the video thumbnails.` + (r.restore.restored < r.restore.missing ? ` ${r.restore.missing - r.restore.restored} could not be restored (the thumbnail could not be downloaded) – use Edit › Replace image.` : '') : 'The cover images could not be restored – the server could not download the video thumbnails. Check its internet connection and try again.');
  }

  async publishReady() {
    const ids = this.d()?.visibility?.readyDraftIds ?? [];
    if (!ids.length) return;
    this.busy.set(true);
    const r = await this.run(() => this.api.post(`/products/${this.productId()}/content/items/bulk`, { ids, action: 'publish', skipProblems: true }));
    this.busy.set(false);
    if (r) {
      const done = ids.length - (r.skipped?.length ?? 0);
      this.msg.set(`${done} ${done === 1 ? 'video is' : 'videos are'} now on the website.` + (r.skipped?.length ? ` Not published: ${r.skipped.slice(0, 3).join(' ')}` : ''));
    }
  }

  /* ---------- YouTube playlists (folder links) ---------- */
  protected isPlaylistUrl = (u: string) => /[?&]list=[\w-]{2,}/.test(u ?? '') && /youtu/.test(u ?? '');
  protected isSingleInPlaylist = (u: string) => this.isPlaylistUrl(u) && /[?&]v=|youtu\.be\//.test(u ?? '');
  protected accessWarn = () => {
    const d = this.d();
    if (!d) return null;
    const level = this.p.accessLevel === 'inherit' ? d.product.effectiveAccess : this.p.accessLevel;
    return level !== 'public' ? 'YouTube can’t limit playback to your website: anyone who finds these videos on YouTube can watch them there. Use Unlisted videos, or Vimeo / secure uploads for customer-only content.' : null;
  };
  openPlaylist(cat: Row | null = null, url = '') {
    this.dlgErr.set(null);
    this.fields.set({});
    this.pl.set(null);
    this.plSel.set(new Set());
    const d = this.d()!;
    this.p = {
      url: cat?.source_playlist ? `https://www.youtube.com/playlist?list=${cat.source_playlist}` : url,
      target: cat ? 'existing' : 'new', categoryId: cat?.id ?? d.categories[0]?.id ?? null, categoryName: '',
      contentType: 'video', accessLevel: 'inherit', covers: true, publish: true,
    };
    this.plDlg().nativeElement.showModal();
    if (this.p.url) void this.loadPlaylist();
  }
  playlistFromItem() {
    const url = this.f.url;
    this.itemDlg().nativeElement.close();
    this.openPlaylist(null, url);
  }
  async loadPlaylist() {
    if (!this.p.url || this.plBusy()) return;
    this.dlgErr.set(null);
    this.fields.set({});
    this.plBusy.set(true);
    try {
      const l = await this.api.post(`/products/${this.productId()}/content/playlist/preview`, { url: this.p.url });
      this.pl.set(l);
      this.plSel.set(new Set(l.videos.filter((v: Row) => !v.existingId).map((v: Row) => v.videoId)));
      if (!this.p.categoryName) this.p.categoryName = l.title;
      if (l.existingCategory) {
        this.p.target = 'existing';
        this.p.categoryId = l.existingCategory.id;
      }
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      if (!Object.keys(a.fields).length) this.dlgErr.set(a.message);
    } finally {
      this.plBusy.set(false);
    }
  }
  plToggle(id: string) {
    const s = new Set(this.plSel());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.plSel.set(s);
  }
  plSelect(which: 'new' | 'none') {
    this.plSel.set(which === 'none' ? new Set() : new Set((this.pl()?.videos ?? []).filter((v: Row) => !v.existingId).map((v: Row) => v.videoId)));
  }
  async importPlaylist() {
    if (this.plBusy() || !this.plChosen().length) return;
    this.dlgErr.set(null);
    this.fields.set({});
    this.plBusy.set(true);
    try {
      const r = await this.api.post(`/products/${this.productId()}/content/playlist/import`, {
        url: this.p.url, videoIds: this.plChosen().map((v: Row) => v.videoId), target: this.p.target,
        categoryId: this.p.target === 'existing' ? this.p.categoryId : null, categoryName: this.p.target === 'new' ? this.p.categoryName : undefined,
        contentType: this.p.contentType, accessLevel: this.p.accessLevel, covers: !!this.p.covers, publish: !!this.p.publish,
      });
      this.apply(r);
      this.plDlg().nativeElement.close();
      const x = r.import;
      const parts = [`Imported ${x.imported} ${x.imported === 1 ? 'video' : 'videos'} from “${x.playlistTitle}”`];
      if (x.published) parts.push(`${x.published} published`);
      if (x.drafts) parts.push(`${x.drafts} saved as ${x.drafts === 1 ? 'a draft' : 'drafts'}`);
      if (x.skipped) parts.push(`${x.skipped} already in the library (skipped)`);
      if (x.noCover) parts.push(`${x.noCover} without a cover image – add one before publishing`);
      this.msg.set(parts.join(' · ') + '.' + (x.problems.length ? ` Not published: ${x.problems.slice(0, 3).join(' ')}${x.problems.length > 3 ? ` (+${x.problems.length - 3} more)` : ''}` : ''));
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.dlgErr.set(Object.values(a.fields)[0] ?? a.message);
    } finally {
      this.plBusy.set(false);
    }
  }

  /* ---------- drag and drop running order ---------- */
  startItem(e: DragEvent, i: Row) {
    this.drag.set({ kind: 'item', id: i.id });
    e.dataTransfer?.setData('text/plain', `item:${i.id}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    const row = (e.target as HTMLElement).closest('li');
    if (row && e.dataTransfer?.setDragImage) e.dataTransfer.setDragImage(row, 20, 20);
  }
  startCat(e: DragEvent, g: Row) {
    this.drag.set({ kind: 'cat', id: g.id });
    e.dataTransfer?.setData('text/plain', `cat:${g.id}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    const sec = (e.target as HTMLElement).closest('section');
    if (sec && e.dataTransfer?.setDragImage) e.dataTransfer.setDragImage(sec, 20, 20);
  }
  endDrag() {
    this.drag.set(null);
    this.itemDrop.set(null);
    this.catDrop.set(null);
  }
  overItem(e: DragEvent, g: Row, index: number) {
    if (this.drag()?.kind !== 'item') return;
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.itemDrop.set({ group: g.id, index: e.clientY > r.top + r.height / 2 ? index + 1 : index });
  }
  overList(e: DragEvent, g: Row) {
    if (this.drag()?.kind !== 'item') return;
    e.preventDefault();
    if (!g.items.length || !this.itemDrop() || this.itemDrop()!.group !== g.id) this.itemDrop.set({ group: g.id, index: g.items.length });
  }
  overCat(e: DragEvent, g: Row, index: number) {
    const dr = this.drag();
    if (!dr) return;
    e.preventDefault();
    if (dr.kind === 'cat' && g.id) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.catDrop.set(e.clientY > r.top + r.height / 2 ? index + 1 : index);
    } else if (dr.kind === 'item' && (!this.itemDrop() || this.itemDrop()!.group !== g.id)) this.itemDrop.set({ group: g.id, index: g.items.length });
  }
  drop(e: DragEvent) {
    e.preventDefault();
    const dr = this.drag();
    const groups: { categoryId: number | null; ids: number[] }[] = this.groups().map((g: Row) => ({ categoryId: g.id as number | null, ids: g.items.map((i: Row) => i.id as number) }));
    let cats: number[] = this.d()!.categories.map((c: Row) => c.id as number);
    if (dr?.kind === 'item' && this.itemDrop()) {
      const t = this.itemDrop()!;
      const from = groups.find((g) => g.ids.includes(dr.id!));
      let to = groups.find((g) => g.categoryId === t.group);
      if (!to) groups.push((to = { categoryId: t.group, ids: [] }));
      if (!from) return this.endDrag();
      const fromIdx = from.ids.indexOf(dr.id!);
      let idx = t.index;
      if (from === to && fromIdx < idx) idx--;
      from.ids.splice(fromIdx, 1);
      to.ids.splice(idx, 0, dr.id!);
      if (from === to && fromIdx === idx) return this.endDrag();
    } else if (dr?.kind === 'cat' && this.catDrop() !== null) {
      const fromIdx = cats.indexOf(dr.id!);
      let idx = this.catDrop()!;
      if (fromIdx < idx) idx--;
      if (fromIdx === idx || fromIdx < 0) return this.endDrag();
      cats = [...cats];
      cats.splice(fromIdx, 1);
      cats.splice(idx, 0, dr.id!);
    } else return this.endDrag();
    this.endDrag();
    this.saveLayout(cats, groups);
  }
  private saveLayout(categories: number[], groups: { categoryId: number | null; ids: number[] }[]) {
    // Show the new order immediately; the server's answer replaces it.
    const d = this.d()!;
    const pos = new Map<number, { c: number | null; o: number }>();
    for (const g of groups) g.ids.forEach((id, n) => pos.set(id, { c: g.categoryId, o: n + 1 }));
    this.d.set({
      ...d,
      categories: categories.map((id, n) => ({ ...d.categories.find((c: Row) => c.id === id), display_order: n + 1 })),
      items: d.items.map((i: Row) => (pos.has(i.id) ? { ...i, category_id: pos.get(i.id)!.c, display_order: pos.get(i.id)!.o } : i)),
    });
    void this.run(() => this.api.put(`/products/${this.productId()}/content/layout`, { categories, groups }), 'New order saved – the website shows it straight away.').then((r) => {
      if (!r) void this.load();
    });
  }

  /* ---------- categories ---------- */
  openCat(c: Row | null) {
    this.dlgErr.set(null);
    this.cf = c ? { id: c.id, name: c.name, description: c.description ?? '', hidden: c.status === 'hidden' } : { name: '', description: '', hidden: false };
    this.catDlg().nativeElement.showModal();
  }
  async saveCat() {
    this.dlgErr.set(null);
    const body = { name: this.cf.name, description: this.cf.description || null, status: this.cf.hidden ? 'hidden' : 'active' };
    try {
      this.apply(this.cf.id ? await this.api.put(`/content/categories/${this.cf.id}`, body) : await this.api.post(`/products/${this.productId()}/content/categories`, body));
      this.catDlg().nativeElement.close();
      this.msg.set('Category saved.');
    } catch (e) {
      const a = toApiError(e);
      this.dlgErr.set(Object.values(a.fields)[0] ?? a.message);
    }
  }
  openDelCat(c: Row) {
    this.dlgErr.set(null);
    this.delCat.set(c);
    const other = this.d()!.categories.find((o: Row) => o.id !== c.id);
    this.del = { items: other ? 'move' : 'uncategorise', target: other?.id ?? null };
    this.delDlg().nativeElement.showModal();
  }
  async confirmDelCat() {
    const c = this.delCat()!;
    if (c.items && this.del.items === 'delete' && !confirm(`Delete “${c.name}” AND its ${c.items} content item(s)? This cannot be undone.`)) return;
    try {
      this.apply(await this.api.post(`/content/categories/${c.id}/delete`, { items: c.items ? this.del.items : 'uncategorise', targetCategoryId: this.del.target, confirm: true }));
      this.delDlg().nativeElement.close();
      this.msg.set('Category deleted.');
    } catch (e) {
      this.dlgErr.set(toApiError(e).message);
    }
  }

  /* ---------- items ---------- */
  openItem(i: Row | null) {
    this.dlgErr.set(null);
    this.fields.set({});
    this.check.set(i?.embed_check ? { ...i.embed_check, warning: i.warning } : null);
    this.vPct.set(null);
    const firstProvider = this.providers()[0] ?? 'youtube';
    this.f = i
      ? { id: i.id, title: i.title, description: i.description ?? '', contentType: i.content_type, categoryId: i.category_id, provider: i.video_provider, url: i.link ?? '', videoMediaId: i.video_media_id, videoName: i.video_name ? `${i.video_name} (${fileSize(i.video_size)})` : null, coverMediaId: i.cover_media_id, coverPreview: i.coverPreview, duration: dur(i.duration_seconds), tags: (i.tags ?? []).join(', '), displayOrder: i.display_order, accessLevel: i.access_level, status: i.status }
      : { title: '', description: '', contentType: 'video', categoryId: this.d()!.categories[0]?.id ?? null, provider: firstProvider, url: '', videoMediaId: null, videoName: null, coverMediaId: null, coverPreview: null, duration: '', tags: '', displayOrder: null, accessLevel: 'inherit', status: 'published' };
    this.itemDlg().nativeElement.showModal();
  }
  async testLink() {
    this.fields.set({});
    try {
      const r = await this.api.post('/content/check-link', { url: this.f.url, accessLevel: this.f.accessLevel, productId: this.productId() });
      this.check.set(r);
      if (r.provider && r.provider !== this.f.provider) this.f.provider = r.provider;
      if (r.duration && !this.f.duration) this.f.duration = dur(r.duration);
      if (r.title && !this.f.title) this.f.title = r.title;
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.check.set(null);
      if (!Object.keys(a.fields).length) this.dlgErr.set(a.message);
    }
  }
  async uploadCover(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      this.fields.set({ coverMediaId: 'Choose a JPG, PNG or WebP image.' });
      return;
    }
    this.coverBusy.set(true);
    this.fields.set({});
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await firstValueFrom(this.http.post<Row>('/api/admin/content/covers', fd));
      this.f.coverMediaId = r.id;
      this.f.coverPreview = r.preview;
    } catch (e) {
      this.fields.set({ coverMediaId: toApiError(e).message });
    } finally {
      this.coverBusy.set(false);
    }
  }
  async uploadVideo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.vPct.set(0);
    this.fields.set({});
    try {
      const r = await this.api.upload(file, { purpose: 'video', visibility: 'staff', title: file.name }, (p) => this.vPct.set(p));
      this.f.videoMediaId = r.id;
      this.f.videoName = `${file.name} (${fileSize(file.size)})`;
    } catch (e) {
      this.fields.set({ videoMediaId: toApiError(e).message });
    } finally {
      this.vPct.set(null);
    }
  }
  async saveItem() {
    this.busy.set(true);
    this.dlgErr.set(null);
    this.fields.set({});
    const f = this.f;
    const body = {
      title: f.title, description: f.description || null, contentType: f.contentType, categoryId: f.categoryId, provider: f.provider,
      url: f.provider === 'upload' ? undefined : f.url, videoMediaId: f.provider === 'upload' ? f.videoMediaId : null, coverMediaId: f.coverMediaId,
      durationSeconds: parseDur(f.duration), tags: String(f.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
      displayOrder: f.displayOrder === null || f.displayOrder === '' ? undefined : Number(f.displayOrder), accessLevel: f.accessLevel, status: f.status,
    };
    try {
      const r = f.id ? await this.api.put(`/content/items/${f.id}`, body) : await this.api.post(`/products/${this.productId()}/content/items`, body);
      this.apply(r);
      this.itemDlg().nativeElement.close();
      const saved = r.items?.find((x: Row) => x.id === r.savedId);
      const draftNote = r.notPublished ? ` Saved as a draft because it can’t be published yet: ${r.notPublished}` : saved?.status === 'draft' ? ' It is a draft, so customers can’t see it yet – choose “Published” or use Publish to show it on the website.' : ' It is now on the website.';
      this.msg.set((r.check?.ok === null ? `Saved. ${r.check.message}` : 'Saved.') + draftNote);
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.dlgErr.set(Object.keys(a.fields).length ? 'Please check the highlighted fields.' : a.message);
    } finally {
      this.busy.set(false);
    }
  }
  removeItem(i: Row) {
    if (!confirm(`Delete “${i.title}”? It will be removed from the product page. This cannot be undone.`)) return;
    void this.run(() => this.api.del(`/content/items/${i.id}`), 'Content deleted.');
  }
}

/** Admin › Content settings – providers, default access, publishing rules, protected streaming. */
@Component({
  selector: 'sch-content-settings',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Video & content settings</h1><p class="muted">Settings for every product’s content library (videos, tutorials and demonstrations).</p></div></div>
    @if (d(); as d) {
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
      <div class="grid2">
        <form class="card" (ngSubmit)="save()">
          <h2>Video sources</h2>
          <label class="check"><input type="checkbox" name="y" [(ngModel)]="s.providers.youtube" /><span><strong>YouTube</strong> – free; good for public videos. Can’t limit playback to your website.</span></label>
          <label class="check"><input type="checkbox" name="v" [(ngModel)]="s.providers.vimeo" /><span><strong>Vimeo</strong> – paid plans allow “embed only on schluss.co.za” and hiding from Vimeo; recommended for customer-only videos.</span></label>
          <label class="check"><input type="checkbox" name="u" [(ngModel)]="s.providers.upload" /><span><strong>Secure upload</strong> – the video is stored privately on your server and streamed through short-lived, session-bound links.</span></label>
          <h2 style="margin-top: 16px">Access & publishing</h2>
          <div class="field"><label for="da">Default “who can watch” for products</label><select id="da" class="select" name="da" [(ngModel)]="s.defaultAccess">@for (a of access; track a[0]) {<option [value]="a[0]">{{ a[1] }}</option>}</select></div>
          <label class="check"><input type="checkbox" name="p" [(ngModel)]="s.publishNewItems" /><span>Publish new content immediately (otherwise new items start as drafts)</span></label>
          <label class="check"><input type="checkbox" name="c" [(ngModel)]="s.coverRequired" /><span>Require a cover image before content can be published</span></label>
          <h2 style="margin-top: 16px">Protected streaming</h2>
          <div class="form-row">
            <div class="field"><label for="tm">Playback link lifetime (minutes)</label><input id="tm" class="input" type="number" min="5" max="120" name="tm" [(ngModel)]="s.streamTokenMinutes" /><span class="hint">Links renew automatically while someone is watching.</span></div>
            <div class="field"><label for="vw">Count a repeat view after (minutes)</label><input id="vw" class="input" type="number" min="1" max="1440" name="vw" [(ngModel)]="s.viewWindowMinutes" /><span class="hint">Stops refreshes inflating view counts.</span></div>
          </div>
          <div class="actions"><button class="btn btn-primary" type="submit">Save settings</button></div>
        </form>
        <section class="card">
          <h2>Status</h2>
          <dl>
            <dt>Cover optimisation</dt><dd>{{ d.status.imageOptimisation ? 'On (images resized to 1600×900 WebP)' : 'Off – install the “sharp” package (npm install) to resize covers' }}</dd>
            <dt>Video storage</dt><dd>{{ d.status.storage }}</dd>
            <dt>Largest video upload</dt><dd>{{ d.status.maxVideoMb }} MB</dd>
            <dt>YouTube playlist imports</dt><dd>{{ d.status.youtubeApiKey ? 'Whole playlists (YouTube API key set, up to ' + d.status.playlistLimit + ' videos per import)' : 'Up to 15 videos per playlist – add YOUTUBE_API_KEY to the server’s .env file to import whole playlists' }}</dd>
            <dt>Items by source</dt><dd>YouTube {{ d.status.itemsByProvider.youtube ?? 0 }} · Vimeo {{ d.status.itemsByProvider.vimeo ?? 0 }} · Secure upload {{ d.status.itemsByProvider.upload ?? 0 }}</dd>
          </dl>
          <div class="row-actions" style="margin-top: 12px"><button class="btn btn-ghost btn-sm" type="button" (click)="test()">Test YouTube & Vimeo connection</button></div>
          @if (conn(); as c) { <p class="small">YouTube: {{ c.youtube.reachable ? 'reachable' : 'not reachable from this server' }} · Vimeo: {{ c.vimeo.reachable ? 'reachable' : 'not reachable from this server' }}</p> }
          <p class="muted tiny">No API keys are needed: links are tested with the providers’ public oEmbed service. Secrets, if you later add a paid streaming service, belong in the server’s .env file.</p>
        </section>
      </div>
    } @else { <p class="muted">Loading…</p> }
  `,
  styles: `h1 { font-size: 28px; } h2 { font-size: 17px; } .grid2 { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); } dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 14px; margin: 0; } dt { color: var(--muted); } dd { margin: 0; } .small { font-size: 13px; } .tiny { font-size: 12px; }`,
})
export class ContentSettingsPage implements OnInit {
  private api = inject(PlatformApi);
  protected d = signal<Row | null>(null);
  protected conn = signal<Row | null>(null);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected access = ACCESS;
  protected s: Row = { providers: {} };
  ngOnInit() {
    void this.api.get('/content/settings').then((d) => {
      this.d.set(d);
      this.s = structuredClone(d.settings);
    });
  }
  async save() {
    this.err.set(null);
    this.msg.set(null);
    try {
      await this.api.put('/content/settings', { ...this.s, streamTokenMinutes: Number(this.s.streamTokenMinutes), viewWindowMinutes: Number(this.s.viewWindowMinutes) });
      this.msg.set('Settings saved.');
    } catch (e) {
      const a = toApiError(e);
      this.err.set(Object.values(a.fields)[0] ?? a.message);
    }
  }
  async test() {
    this.conn.set(await this.api.post('/content/settings/test'));
  }
}

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, toApiError } from '../core/auth.service';
import { PlatformApi } from './platform-api';
import { CatalogueApi, fmtSize, MediaItem } from './catalogue-api';
import type { Page } from './admin-api';

const VIS_LABEL: Record<string, string> = { public: 'Public', customer: 'Customers', partner: 'Partners', staff: 'Staff only' };

/** Upload box + video-link form. Emits the new media id. */
@Component({
  selector: 'sch-media-upload',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="up">
      <div class="drop" [class.over]="over()" (dragover)="$event.preventDefault(); over.set(true)" (dragleave)="over.set(false)" (drop)="drop($event)">
        <p><strong>Upload a file</strong> – images (max 5 MB), PDF and Office documents, MP4/WebM videos, or installers and archives (EXE, MSI, APK, DMG, ZIP…)</p>
        <div class="up-row">
          <select class="select" [(ngModel)]="visibility" aria-label="Who can see this file">
            <option value="public">Public</option><option value="customer">Signed-in customers</option><option value="partner">Approved partners</option><option value="staff">Staff only</option>
          </select>
          <label class="btn btn-ghost">Choose file<input type="file" [attr.accept]="accept()" (change)="pick($event)" hidden /></label>
        </div>
        @if (busy()) { <p class="muted"><span class="spinner"></span> Uploading… @if (pct() !== null) { {{ pct() }}% }</p> }
      </div>
      @if (allowVideo()) {
        <form class="vid" (ngSubmit)="addVideo()">
          <p><strong>Or link a video</strong> – YouTube or Vimeo</p>
          <div class="up-row">
            <input class="input" name="vt" [(ngModel)]="videoTitle" placeholder="Video title" aria-label="Video title" />
            <input class="input" name="vu" [(ngModel)]="videoUrl" placeholder="https://www.youtube.com/watch?v=…" aria-label="Video link" />
            <button class="btn btn-ghost" type="submit" [disabled]="busy()">Add video</button>
          </div>
        </form>
      }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }
    </div>
  `,
  styles: `
    .up { display: grid; gap: 12px; }
    .drop, .vid { border: 1px dashed var(--line-strong); border-radius: var(--r); padding: 14px; }
    .drop.over { border-color: var(--sch-blue); background: var(--sch-blue-soft); }
    p { margin: 0 0 10px; font-size: 14px; }
    .up-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .up-row .input { flex: 1 1 200px; }
    .up-row .select { flex: 0 1 200px; }
  `,
})
export class MediaUpload {
  readonly allowVideo = input(true);
  readonly defaultVisibility = input<string>('public');
  /** File chooser filter; the server checks every file's real contents regardless. */
  readonly accept = input('image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt,video/mp4,video/webm,.mov,.exe,.msi,.msix,.apk,.aab,.dmg,.pkg,.deb,.rpm,.appimage,.zip,.7z,.rar,.gz,.tgz');
  readonly uploaded = output<number>();
  private api = inject(CatalogueApi);
  private platform = inject(PlatformApi);
  protected pct = signal<number | null>(null);
  protected visibility = 'public';
  protected videoTitle = '';
  protected videoUrl = '';
  protected busy = signal(false);
  protected over = signal(false);
  protected err = signal<string | null>(null);

  ngOnInit() {
    this.visibility = this.defaultVisibility();
  }
  pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void this.send(f);
    (e.target as HTMLInputElement).value = '';
  }
  drop(e: DragEvent) {
    e.preventDefault();
    this.over.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void this.send(f);
  }
  async send(f: File) {
    this.err.set(null);
    this.busy.set(true);
    this.pct.set(null);
    try {
      // Images and small PDFs use the media library upload; everything else streams to the large-file endpoint.
      const simple = /^image\//.test(f.type) || (f.type === 'application/pdf' && f.size <= 25 * 1024 * 1024);
      const r = simple ? await this.api.upload(f, this.visibility) : await this.platform.upload(f, { purpose: 'any', visibility: this.visibility }, (p) => this.pct.set(p));
      this.uploaded.emit(r.id);
    } catch (e) {
      this.err.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
      this.pct.set(null);
    }
  }
  async addVideo() {
    this.err.set(null);
    this.busy.set(true);
    try {
      const r = await this.api.linkVideo({ title: this.videoTitle, url: this.videoUrl, visibility: this.visibility });
      this.videoTitle = this.videoUrl = '';
      this.uploaded.emit(r.id);
    } catch (e) {
      const a = toApiError(e);
      this.err.set(Object.values(a.fields)[0] ?? a.message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Modal picker: choose an existing file or upload a new one. */
@Component({
  selector: 'sch-media-picker',
  imports: [MediaUpload, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dlg wide" (close)="closed()">
      <h2>{{ heading() }}</h2>
      <sch-media-upload [allowVideo]="kind() !== 'image'" [defaultVisibility]="defaultVisibility()" (uploaded)="uploadedNow($event)" />
      <div class="adm-filters top">
        <input class="input" [(ngModel)]="q" (keyup.enter)="load()" placeholder="Search the library" aria-label="Search the library" />
        <button class="btn btn-ghost btn-sm" type="button" (click)="load()">Search</button>
      </div>
      <div class="grid">
        @for (m of items()?.data ?? []; track m.id) {
          <button type="button" class="tile" (click)="choose(m)">
            @if (m.kind === 'image') { <img [src]="m.url" alt="" loading="lazy" /> }
            @else { <span class="ico">{{ m.kind === 'pdf' ? 'PDF' : m.kind === 'external_video' ? '▶' : m.kind }}</span> }
            <span class="t">{{ m.title }}</span>
          </button>
        } @empty { <p class="muted">No matching files yet – upload one above.</p> }
      </div>
      <div class="actions"><button class="btn btn-ghost" type="button" (click)="dlg.close()">Cancel</button></div>
    </dialog>
  `,
  styles: `
    .top { margin-top: 16px; }
    .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); max-height: 46vh; overflow-y: auto; padding: 2px; }
    .tile { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); cursor: pointer; text-align: left; color: var(--fg); font: inherit; }
    .tile:hover, .tile:focus-visible { border-color: var(--sch-blue); }
    .tile img, .ico { width: 100%; aspect-ratio: 4/3; object-fit: contain; border-radius: 4px; background: var(--surface); display: grid; place-items: center; font-weight: 700; color: var(--sch-blue); text-transform: uppercase; font-size: 13px; }
    .t { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class MediaPicker {
  readonly heading = input('Choose a file');
  readonly kind = input<'image' | 'video' | 'document' | 'any'>('any');
  readonly defaultVisibility = input('public');
  readonly picked = output<MediaItem>();
  private api = inject(CatalogueApi);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected items = signal<Page<MediaItem> | null>(null);
  protected q = '';

  open() {
    this.dlg().nativeElement.showModal();
    void this.load();
  }
  closed() {}
  async load() {
    const kind = this.kind() === 'image' ? 'image' : undefined;
    const r = await this.api.media({ kind, q: this.q, perPage: 60 });
    if (this.kind() === 'video') r.data = r.data.filter((m) => m.kind === 'external_video' || m.kind === 'video');
    if (this.kind() === 'document') r.data = r.data.filter((m) => m.kind === 'pdf' || m.kind === 'document');
    this.items.set(r);
  }
  async uploadedNow(id: number) {
    await this.load();
    const m = this.items()?.data.find((x) => x.id === id);
    if (m) this.choose(m);
  }
  choose(m: MediaItem) {
    this.picked.emit(m);
    this.dlg().nativeElement.close();
  }
}

/** Admin › Media library */
@Component({
  selector: 'sch-media-library',
  imports: [MediaUpload, FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Media library</h1><p class="muted">Images, PDF documents and video links used across the website, products and learning material.</p></div></div>
    <section class="card"><sch-media-upload (uploaded)="load(1)" /></section>
    <div class="adm-filters" style="margin-top: 18px">
      <input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Search by title or file name" aria-label="Search" />
      <select class="select" [(ngModel)]="kind" (change)="load(1)" aria-label="Type">
        <option value="">All types</option><option value="image">Images</option><option value="pdf">PDF documents</option><option value="external_video">Video links</option>
      </select>
    </div>
    @if (msg()) { <div class="alert" [class.alert-error]="msgErr()" [class.alert-ok]="!msgErr()" role="status">{{ msg() }}</div> }
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>File</th><th>Type</th><th>Visible to</th><th>Size</th><th>Added</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          @for (m of page()?.data ?? []; track m.id) {
            <tr>
              <td data-label="File">
                <div class="file">
                  @if (m.kind === 'image') { <img class="thumb" [src]="m.url" alt="" loading="lazy" /> } @else { <span class="thumb ico">{{ m.kind === 'pdf' ? 'PDF' : m.kind === 'video' || m.kind === 'external_video' ? '▶' : m.kind === 'document' ? 'DOC' : '⬇' }}</span> }
                  <span><strong>{{ m.title }}</strong><br /><span class="muted small">{{ m.original_name || m.external_url }}</span></span>
                </div>
              </td>
              <td data-label="Type">{{ kindLabel[m.kind] ?? m.kind }}</td>
              <td data-label="Visible to">
                <select class="select sm" [ngModel]="m.visibility" (ngModelChange)="setVisibility(m, $event)" [attr.aria-label]="'Visibility of ' + m.title">
                  @for (v of visKeys; track v) { <option [value]="v">{{ visLabel[v] }}</option> }
                </select>
              </td>
              <td data-label="Size">{{ size(m.size_bytes) || '—' }}</td>
              <td data-label="Added">{{ m.created_at | date: 'd MMM y' }}</td>
              <td data-label="">
                <div class="row-actions">
                  @if (m.url) { <a class="btn btn-ghost btn-sm" [href]="m.url" target="_blank" rel="noopener">Open</a> }
                  @if (canDelete()) { <button class="btn btn-danger btn-sm" type="button" (click)="remove(m)">Delete</button> }
                </div>
              </td>
            </tr>
          } @empty { <tr><td colspan="6" class="empty">No files yet.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (page(); as p) {
      <div class="pager"><span class="muted">{{ p.meta.total }} files</span>
        <span><button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page <= 1" (click)="load(p.meta.page - 1)">Previous</button>
        <button class="btn btn-ghost btn-sm" type="button" [disabled]="p.meta.page * p.meta.perPage >= p.meta.total" (click)="load(p.meta.page + 1)">Next</button></span></div>
    }
  `,
  styles: `.file { display: flex; gap: 10px; align-items: center; } .small { font-size: 12px; } .ico { display: grid; place-items: center; font-size: 11px; font-weight: 700; color: var(--sch-blue); } .sm { min-height: 36px; padding: 4px 8px; font-size: 14px; }`,
})
export class MediaLibraryPage implements OnInit {
  private api = inject(CatalogueApi);
  private auth = inject(AuthService);
  protected page = signal<Page<MediaItem> | null>(null);
  protected q = '';
  protected kind = '';
  protected msg = signal<string | null>(null);
  protected msgErr = signal(false);
  protected visLabel = VIS_LABEL;
  protected visKeys = Object.keys(VIS_LABEL);
  protected kindLabel: Record<string, string> = { image: 'Image', pdf: 'PDF', external_video: 'Video link', video: 'Video file', document: 'Document', installer: 'Installer', archive: 'Archive', other: 'File' };
  protected size = fmtSize;
  protected canDelete = () => this.auth.can('media.manage');

  ngOnInit() {
    void this.load(1);
  }
  async load(page: number) {
    this.page.set(await this.api.media({ page, q: this.q, kind: this.kind, perPage: 25 }));
  }
  private note(m: string, err = false) {
    this.msg.set(m);
    this.msgErr.set(err);
  }
  async setVisibility(m: MediaItem, v: string) {
    try {
      await this.api.updateMedia(m.id, { visibility: v });
      this.note(`“${m.title}” is now visible to: ${VIS_LABEL[v]}.`);
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.note(toApiError(e).message, true);
    }
  }
  async remove(m: MediaItem) {
    if (!confirm(`Delete “${m.title}”? This cannot be undone.`)) return;
    try {
      await this.api.deleteMedia(m.id);
      this.note(`Deleted “${m.title}”.`);
      await this.load(this.page()?.meta.page ?? 1);
    } catch (e) {
      this.note(toApiError(e).message, true);
    }
  }
}

import { DatePipe, SlicePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, toApiError } from '../core/auth.service';
import { AdminProduct, CatalogueApi, MediaItem } from './catalogue-api';
import { MediaPicker } from './media';
import { DEMO_STATUS, fileSize, PLATFORMS, PlatformApi, Row } from './platform-api';

const SHARED = `
  .sec { margin-top: 22px; } .sec:first-child { margin-top: 0; }
  .sec-h { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .sec-h h3 { margin: 0; font-size: 17px; }
  .small { font-size: 13px; } .tiny { font-size: 12px; }
  .grid2 { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .box { border: 1px solid var(--line); border-radius: var(--r); padding: 14px; background: #fff; }
  .note { padding: 12px 14px; border-radius: var(--r); background: var(--sch-blue-soft, #eef4ff); font-size: 14px; }
  .sm { min-height: 36px; padding: 4px 8px; font-size: 14px; width: auto; }
  .prog { height: 6px; border-radius: 4px; background: var(--line); overflow: hidden; margin-top: 6px; } .prog i { display: block; height: 100%; background: var(--sch-blue); transition: width .2s ease; }
`;

/* =========================================================================================
 * Images: screenshots, gallery, promotional and feature images (any number, ordered)
 * ========================================================================================= */
const IMAGE_ROLES: Record<string, string> = { screenshot: 'Screenshots', gallery: 'Gallery images', promo: 'Promotional images', feature_image: 'Feature images' };

@Component({
  selector: 'sch-pe-images',
  imports: [FormsModule, MediaPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">The logo, product tile image and Coming soon image are set under <strong>General information</strong>. Add as many other images as you need here – they appear on the product page in this order.</p>
    @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
    @for (r of roles; track r) {
      <section class="sec">
        <div class="sec-h"><h3>{{ labels[r] }}</h3><button class="btn btn-ghost btn-sm" type="button" (click)="add(r, picker)">+ Add image</button></div>
        <div class="shots">
          @for (m of of(r); track m.link_id; let first = $first; let last = $last; let i = $index) {
            <figure>
              <img [src]="m.url" [alt]="m.caption || m.title" />
              <figcaption>
                <input class="input sm" [ngModel]="m.caption ?? ''" (change)="caption(m.link_id, $any($event.target).value)" placeholder="Caption (optional)" aria-label="Caption" />
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm" type="button" [disabled]="first" (click)="move(r, i, -1)" aria-label="Move earlier">←</button>
                  <button class="btn btn-ghost btn-sm" type="button" [disabled]="last" (click)="move(r, i, 1)" aria-label="Move later">→</button>
                  <button class="btn btn-ghost btn-sm" type="button" (click)="remove(m.link_id)">Remove</button>
                </div>
              </figcaption>
            </figure>
          } @empty { <p class="muted small">None yet.</p> }
        </div>
      </section>
    }
    <sch-media-picker #picker kind="image" heading="Choose an image" (picked)="picked($event)" />
  `,
  styles: SHARED + `
    .shots { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    figure { margin: 0; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: #fff; }
    img { width: 100%; aspect-ratio: 16/10; object-fit: cover; display: block; background: #f3f5f8; }
    figcaption { padding: 8px; display: grid; gap: 6px; }
  `,
})
export class ProductImagesTab {
  readonly product = input.required<AdminProduct>();
  readonly changed = output<AdminProduct>();
  private api = inject(CatalogueApi);
  private platform = inject(PlatformApi);
  protected roles = Object.keys(IMAGE_ROLES);
  protected labels = IMAGE_ROLES;
  protected err = signal<string | null>(null);
  private target = 'screenshot';
  protected of = (role: string) => this.product().media.filter((m) => m.role === role);
  add(role: string, picker: MediaPicker) {
    this.target = role;
    picker.open();
  }
  private async run(fn: () => Promise<AdminProduct | void>) {
    this.err.set(null);
    try {
      const p = await fn();
      this.changed.emit(p ?? (await this.api.product(this.product().id)));
    } catch (e) {
      this.err.set(toApiError(e).message);
    }
  }
  picked(m: MediaItem) {
    void this.run(() => this.api.addProductMedia(this.product().id, { mediaId: m.id, role: this.target }));
  }
  caption(linkId: number, caption: string) {
    void this.run(() => this.api.updateProductMedia(this.product().id, linkId, { caption: caption || null }));
  }
  remove(linkId: number) {
    void this.run(() => this.api.removeProductMedia(this.product().id, linkId));
  }
  move(role: string, i: number, d: number) {
    const list = this.of(role).map((m) => m.link_id);
    [list[i], list[i + d]] = [list[i + d], list[i]];
    const others = this.product().media.filter((m) => m.role !== role).map((m) => m.link_id);
    void this.run(async () => void (await this.platform.put(`/products/${this.product().id}/media-order`, { ids: [...list, ...others] })));
  }
}

/* =========================================================================================
 * Demo files & Demo settings (one component, two modes)
 * ========================================================================================= */
@Component({
  selector: 'sch-pe-demo',
  imports: [FormsModule, DatePipe, SlicePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (d(); as d) {
      <div class="note" [class.live]="d.live">
        @if (full()) {
          @if (d.live) { <strong>Full installer is live.</strong> {{ d.settings.fullAccess === 'registered' ? 'Every verified customer' : 'Customers with an active licence' }} can download version {{ current()?.version }}. It is never offered as the demo. }
          @else { <strong>No full installer is offered yet.</strong> {{ d.settings.fullAccess === 'off' ? 'Customer downloads are switched off below.' : 'Release a version with at least one active installer file.' }} }
        } @else {
          @if (d.live) { <strong>Demo download is live.</strong> Signed-in customers can download version {{ current()?.version }} from the product page. }
          @else { <strong>No demo download is offered yet.</strong> {{ notLiveReason() }} }
        }
      </div>
      @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
      @if (err()) { <div class="alert alert-error" role="alert">{{ err() }}</div> }

      @if (full() && canEdit()) {
        <section class="sec">
          <div class="sec-h"><h3>Who may download the full installer?</h3></div>
          <label class="radio"><input type="radio" name="fa" value="licensed" [(ngModel)]="fa" /><span><strong>Customers with an active licence for this product</strong> (recommended)</span></label>
          <label class="radio"><input type="radio" name="fa" value="registered" [(ngModel)]="fa" /><span><strong>Any verified customer</strong> – e.g. when the software itself needs a paid licence key to run</span></label>
          <label class="radio"><input type="radio" name="fa" value="off" [(ngModel)]="fa" /><span><strong>Nobody online</strong> – SCHLUSS supplies the installer directly</span></label>
          <div class="actions"><button class="btn btn-primary btn-sm" type="button" (click)="saveAccess()">Save access rule</button></div>
        </section>
      }
      @if (mode() === 'settings' && !full()) {
        <section class="sec">
          <div class="sec-h"><h3>Demo settings</h3></div>
          <fieldset [disabled]="!canEdit()">
            <label class="check"><input type="checkbox" [(ngModel)]="s.available" /><span>Offer a downloadable demo on the product page</span></label>
            <div class="form-row">
              <div class="field"><label [for]="uid + 'dd'">Demo length (days)</label>
                <div class="row-actions">@for (n of [7, 14, 30]; track n) { <button type="button" class="chip" [attr.aria-pressed]="s.days === n" (click)="s.days = n">{{ n }} days</button> }
                <input [id]="uid + 'dd'" class="input sm" type="number" min="1" max="365" [(ngModel)]="s.days" aria-label="Custom number of days" style="width: 100px" /></div>
                @if (fe('days')) { <span class="error">{{ fe('days') }}</span> }</div>
              <div class="field"><label [for]="uid + 'dv'">Devices per demo</label><input [id]="uid + 'dv'" class="input" type="number" min="1" [(ngModel)]="s.maxDevices" /></div>
              <div class="field"><label [for]="uid + 'do'">Offline period (days)</label><input [id]="uid + 'do'" class="input" type="number" min="0" max="90" [(ngModel)]="s.offlineDays" /><span class="hint">How long the installed software may run without checking in.</span></div>
            </div>
            <div class="field"><span class="label">When does the demo period start?</span>
              <label class="radio"><input type="radio" name="so" value="activation" [(ngModel)]="s.startOn" /><span><strong>When the customer first activates it</strong> (recommended) – the software calls the SCHLUSS licensing service on first run; the demo clock starts then.</span></label>
              <label class="radio"><input type="radio" name="so" value="download" [(ngModel)]="s.startOn" /><span><strong>When the customer first downloads it</strong> – use this if the software can't activate online.</span></label>
            </div>
            <div class="box current"><strong>Selected rule:</strong> {{ s.days || '–' }}-day demo, starting {{ s.startOn === 'activation' ? 'at first activation' : 'at first download' }}, {{ s.maxDevices }} device(s), {{ s.offlineDays }} day(s) offline.</div>
            <div class="note small"><strong>Important:</strong> dates are kept on the SCHLUSS server and one demo is allowed per customer per product, so downloading again or reinstalling never restarts it. Only software that checks its licence with SCHLUSS (activate/validate API) can stop working when a demo ends – a plain installer cannot be switched off remotely.</div>
            <div class="actions"><button class="btn btn-primary" type="button" (click)="saveSettings()">Save demo settings</button></div>
          </fieldset>
        </section>
      } @else {
        <section class="sec">
          <div class="sec-h"><h3>{{ full() ? 'Full installer versions & files' : 'Demo versions & files' }}</h3>@if (canEdit()) { <button class="btn btn-primary btn-sm" type="button" (click)="openVersion(null)">+ New {{ kind() }} version</button> }</div>
          @for (v of d.versions; track v.id) {
            <article class="box ver" [class.cur]="v.id === d.currentVersionId">
              <header>
                <div>
                  <strong>Version {{ v.version }}</strong>@if (v.name) { · {{ v.name }} }
                  <span class="badge" [class]="'badge ' + (v.status === 'released' ? 'badge-ok' : v.status === 'withdrawn' ? 'badge-danger' : 'badge-muted')">{{ v.status === 'released' ? 'Released' : v.status === 'withdrawn' ? 'Withdrawn' : 'Draft' }}</span>
                  @if (v.id === d.currentVersionId) { <span class="badge badge-info">Current download</span> }
                  @if (!v.downloads_enabled) { <span class="badge badge-muted">Downloads off</span> }
                  <br /><span class="muted tiny">Released {{ v.release_date | date: 'd MMM y' }}</span>
                </div>
                @if (canEdit()) {
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" type="button" (click)="openVersion(v)">Edit</button>
                    <button class="btn btn-ghost btn-sm" type="button" (click)="toggleDownloads(v)">{{ v.downloads_enabled ? 'Pause downloads' : 'Allow downloads' }}</button>
                    <button class="btn btn-danger btn-sm" type="button" (click)="removeVersion(v)">{{ hasDownloads(v) ? 'Withdraw' : 'Delete' }}</button>
                  </div>
                }
              </header>
              @if (v.release_notes) { <p class="small keep-lines">{{ v.release_notes }}</p> }
              <div class="table-wrap">
                <table class="table stack">
                  <thead><tr><th>File</th><th>Platform</th><th>Size</th><th>Downloads</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    @for (f of v.files; track f.id) {
                      <tr [class.off]="!f.is_active">
                        <td data-label="File"><strong>{{ f.label || f.original_name }}</strong><br /><span class="muted tiny">{{ f.original_name }} · SHA-256 {{ f.sha256 | slice: 0 : 12 }}…</span></td>
                        <td data-label="Platform">{{ platforms[f.platform] ?? f.platform }}@if (f.architecture) { ({{ f.architecture }}) }</td>
                        <td data-label="Size">{{ size(f.size_bytes) }}</td>
                        <td data-label="Downloads">{{ f.downloads }}</td>
                        <td data-label="Status"><span class="badge" [class]="'badge ' + (f.is_active ? 'badge-ok' : 'badge-muted')">{{ f.is_active ? 'Active' : 'Inactive' }}</span></td>
                        <td data-label="">@if (canEdit()) {<div class="row-actions">
                          <button class="btn btn-ghost btn-sm" type="button" (click)="toggleFile(f)">{{ f.is_active ? 'Deactivate' : 'Activate' }}</button>
                          <label class="btn btn-ghost btn-sm">Replace<input type="file" hidden (change)="replace(f, $event)" [attr.accept]="accept" /></label>
                          <button class="btn btn-danger btn-sm" type="button" (click)="removeFile(f)">Remove</button>
                        </div>}</td>
                      </tr>
                    } @empty { <tr><td colspan="6" class="empty">No files yet – add the installer below.</td></tr> }
                  </tbody>
                </table>
              </div>
              @if (canEdit()) {
                <div class="add">
                  <select class="select sm" [(ngModel)]="newFile.platform" aria-label="Platform">@for (p of platformKeys; track p) {<option [value]="p">{{ platforms[p] }}</option>}</select>
                  <input class="input sm" [(ngModel)]="newFile.label" placeholder="Label, e.g. Windows installer (64-bit)" aria-label="File label" />
                  <label class="btn btn-ghost btn-sm">{{ uploadingFor() === v.id ? 'Uploading…' : '+ Upload file' }}<input type="file" hidden (change)="addFile(v, $event)" [attr.accept]="accept" [disabled]="uploadingFor() !== null" /></label>
                </div>
                @if (uploadingFor() === v.id) { <div class="prog" role="progressbar" [attr.aria-valuenow]="pct()"><i [style.width.%]="pct()"></i></div> }
                <p class="muted tiny">EXE, MSI, MSIX, APK, AAB, DMG, PKG, DEB, RPM, AppImage, ZIP, 7Z… Each file is checked by its contents, stored privately and only reaches customers through a personal, 10-minute download link.</p>
              }
              <details class="instr"><summary>Installation instructions & requirements</summary>
                <p class="small keep-lines"><strong>Requirements:</strong> {{ v.min_requirements || 'Uses the product’s system requirements' }}</p>
                <p class="small keep-lines"><strong>Instructions:</strong> {{ v.install_instructions || 'None yet' }}</p>
              </details>
            </article>
          } @empty { <p class="muted">No {{ kind() }} versions yet. Create one, then upload its installer(s).</p> }
        </section>

        <dialog #vdlg class="dlg wide">
          <form (ngSubmit)="saveVersion()">
            <h2>{{ editing() ? 'Edit ' + kind() + ' version' : 'New ' + kind() + ' version' }}</h2>
            @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
            <div class="form-row">
              <div class="field"><label [for]="uid + 'vv'">Version number</label><input [id]="uid + 'vv'" class="input" name="v" [(ngModel)]="vf.version" placeholder="e.g. 2.4.1" />@if (fe('version')) {<span class="error">{{ fe('version') }}</span>}</div>
              <div class="field"><label [for]="uid + 'vn'">Name <span class="muted">(optional)</span></label><input [id]="uid + 'vn'" class="input" name="n" [(ngModel)]="vf.name" /></div>
              <div class="field"><label [for]="uid + 'vs'">Status</label><select [id]="uid + 'vs'" class="select" name="s" [(ngModel)]="vf.status"><option value="draft">Draft (not offered)</option><option value="released">Released (offered to customers)</option><option value="withdrawn">Withdrawn</option></select></div>
            </div>
            <div class="field"><label [for]="uid + 'vdsc'">Description</label><textarea [id]="uid + 'vdsc'" class="textarea" rows="3" name="d" [(ngModel)]="vf.description" placeholder="What this demo includes and any limits"></textarea></div>
            <div class="field"><label [for]="uid + 'vreq'">System requirements</label><textarea [id]="uid + 'vreq'" class="textarea" rows="3" name="r" [(ngModel)]="vf.requirements"></textarea></div>
            <div class="field"><label [for]="uid + 'vins'">Installation instructions</label><textarea [id]="uid + 'vins'" class="textarea" rows="6" name="i" [(ngModel)]="vf.instructions" placeholder="1. Run the installer…&#10;2. Enter your demo licence key when asked…"></textarea><span class="hint">Shown to the customer right after the download, and in their setup area.</span></div>
            <div class="actions"><button class="btn btn-ghost" type="button" (click)="vdlg.close()">Cancel</button><button class="btn btn-primary" type="submit">Save version</button></div>
          </form>
        </dialog>
      }
    } @else { <p class="muted">Loading…</p> }
  `,
  styles: SHARED + `
    .note.live { background: #e9f8ef; }
    .ver { margin-bottom: 14px; } .ver.cur { border-color: var(--sch-blue); box-shadow: 0 0 0 1px var(--sch-blue); }
    .ver header { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .ver .badge { margin-left: 6px; }
    .keep-lines { white-space: pre-line; }
    tr.off { opacity: .55; }
    .add { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; } .add .input { flex: 1 1 220px; }
    .instr { margin-top: 10px; } .instr summary { cursor: pointer; font-weight: 600; font-size: 14px; }
    .radio { display: flex; gap: 10px; align-items: flex-start; margin: 8px 0; font-size: 14px; } .radio input { margin-top: 4px; }
    .current { margin: 12px 0; font-size: 14px; }
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  `,
})
export class ProductDemoTab implements OnInit {
  readonly productId = input.required<number>();
  readonly mode = input<'files' | 'settings'>('files');
  /** 'demo' = demo installers; 'release' = the full installers (kept completely separate). */
  readonly channel = input<'demo' | 'release'>('demo');
  protected full = computed(() => this.channel() === 'release');
  /** Unique element ids – the installer and demo editors can be open on the same page. */
  protected uid = 'pd' + Math.random().toString(36).slice(2, 7) + '-';
  protected kind = computed(() => (this.full() ? 'full installer' : 'demo'));
  private base = () => `/products/${this.productId()}/${this.full() ? 'release' : 'demo'}`;
  protected fa = 'licensed';
  private api = inject(PlatformApi);
  private auth = inject(AuthService);
  private vdlg = viewChild<ElementRef<HTMLDialogElement>>('vdlg');
  protected d = signal<Row | null>(null);
  protected msg = signal<string | null>(null);
  protected err = signal<string | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected editing = signal<Row | null>(null);
  protected uploadingFor = signal<number | null>(null);
  protected pct = signal(0);
  protected platforms = PLATFORMS;
  protected platformKeys = Object.keys(PLATFORMS);
  protected size = fileSize;
  protected accept = '.exe,.msi,.msix,.appx,.apk,.aab,.ipa,.dmg,.pkg,.deb,.rpm,.appimage,.zip,.7z,.rar,.gz,.tgz';
  protected s = { available: false, days: 14 as number | null, startOn: 'activation', maxDevices: 1, offlineDays: 7 };
  protected vf = { version: '', name: '', description: '', requirements: '', instructions: '', status: 'released' };
  protected newFile = { platform: 'windows', label: '' };
  protected canEdit = () => this.auth.can('products.manage') || this.auth.can('versions.manage');
  protected fe = (k: string) => this.fields()[k] ?? null;
  protected current = computed(() => this.d()?.['versions'].find((v: Row) => v['id'] === this.d()?.['currentVersionId']));
  protected hasDownloads = (v: Row) => v['files'].some((f: Row) => f['downloads'] > 0);
  protected notLiveReason = computed(() => {
    const d = this.d();
    if (!d) return '';
    if (!d['settings'].available) return 'Switch on “Offer a downloadable demo” under Demo settings.';
    if (!d['settings'].days) return 'Set the demo length under Demo settings.';
    return 'Release a demo version that has at least one active file.';
  });

  ngOnInit() {
    void this.load();
  }
  private apply(d: Row) {
    this.d.set(d);
    this.s = { ...d['settings'], days: d['settings'].days ?? 14 };
    this.fa = d['settings'].fullAccess ?? 'licensed';
  }
  async load() {
    this.apply(await this.api.get(this.base()));
  }
  private async run(fn: () => Promise<Row>, ok: string) {
    this.err.set(null);
    this.msg.set(null);
    this.fields.set({});
    try {
      this.apply(await fn());
      this.msg.set(ok);
      return true;
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(Object.values(a.fields)[0] ?? a.message);
      return false;
    }
  }
  saveAccess() {
    void this.run(() => this.api.put(`/products/${this.productId()}/release/settings`, { fullAccess: this.fa }), 'Access rule saved.');
  }
  saveSettings() {
    void this.run(() => this.api.put(`/products/${this.productId()}/demo/settings`, { ...this.s, days: this.s.days ? Number(this.s.days) : null, maxDevices: Number(this.s.maxDevices), offlineDays: Number(this.s.offlineDays) }), 'Demo settings saved.');
  }
  openVersion(v: Row | null) {
    this.editing.set(v);
    this.err.set(null);
    this.fields.set({});
    this.vf = { version: v?.['version'] ?? '', name: v?.['name'] ?? '', description: v?.['release_notes'] ?? '', requirements: v?.['min_requirements'] ?? '', instructions: v?.['install_instructions'] ?? '', status: v?.['status'] ?? 'released' };
    this.vdlg()?.nativeElement.showModal();
  }
  async saveVersion() {
    const v = this.editing();
    const ok = await this.run(() => (v ? this.api.patch(`/demo-versions/${v['id']}`, this.vf) : this.api.post(`${this.base()}/versions`, this.vf)), v ? 'Version saved.' : 'Version created – now upload its installer.');
    if (ok) this.vdlg()?.nativeElement.close();
  }
  toggleDownloads(v: Row) {
    void this.run(() => this.api.patch(`/demo-versions/${v['id']}`, { downloadsEnabled: !v['downloads_enabled'] }), 'Saved.');
  }
  removeVersion(v: Row) {
    const msg = this.hasDownloads(v) ? `Withdraw demo version ${v['version']}? Customers who downloaded it keep their history.` : `Delete demo version ${v['version']} and its files?`;
    if (confirm(msg)) void this.run(() => this.api.del(`/demo-versions/${v['id']}`), this.hasDownloads(v) ? 'Version withdrawn.' : 'Version deleted.');
  }
  private async uploadDemo(file: File, v: Row) {
    this.uploadingFor.set(v['id']);
    this.pct.set(0);
    try {
      return await this.api.upload(file, { purpose: 'demo', title: `${file.name}` }, (p) => this.pct.set(p));
    } finally {
      this.uploadingFor.set(null);
    }
  }
  async addFile(v: Row, e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    this.err.set(null);
    try {
      const m = await this.uploadDemo(f, v);
      await this.run(() => this.api.post(`/demo-versions/${v['id']}/files`, { mediaId: m['id'], platform: this.newFile.platform, label: this.newFile.label || null }), `${f.name} added to version ${v['version']}.`);
      this.newFile.label = '';
    } catch (er) {
      this.err.set(toApiError(er).message);
    }
  }
  async replace(fRow: Row, e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    const v = this.d()!['versions'].find((x: Row) => x['files'].some((y: Row) => y['id'] === fRow['id']));
    try {
      const m = await this.uploadDemo(f, v);
      await this.run(() => this.api.patch(`/demo-files/${fRow['id']}`, { replaceWithMediaId: m['id'] }), 'File replaced. The previous file is kept (inactive) for the download history.');
    } catch (er) {
      this.err.set(toApiError(er).message);
    }
  }
  toggleFile(f: Row) {
    void this.run(() => this.api.patch(`/demo-files/${f['id']}`, { isActive: !f['is_active'] }), 'Saved.');
  }
  removeFile(f: Row) {
    if (confirm(f['downloads'] ? 'This file has been downloaded – it will be deactivated (kept for history). Continue?' : 'Remove this file?')) void this.run(() => this.api.del(`/demo-files/${f['id']}`), 'File removed.');
  }
}

/* =========================================================================================
 * Demo history (per product)
 * ========================================================================================= */
@Component({
  selector: 'sch-pe-demo-history',
  imports: [FormsModule, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!can()) { <p class="muted">Viewing demo customers needs the customers or licences permission.</p> }
    @else {
      <div class="adm-filters">
        <select class="select" [(ngModel)]="status" (change)="load(1)" aria-label="Status"><option value="">All statuses</option>@for (k of keys; track k) {<option [value]="k">{{ labels[k][0] }}</option>}</select>
        <input class="input" [(ngModel)]="q" (keyup.enter)="load(1)" placeholder="Search customer, company, email or licence" aria-label="Search" />
        <a class="btn btn-ghost btn-sm" routerLink="/admin/demos" [queryParams]="{ productId: productId() }">Open in Demos dashboard</a>
      </div>
      <div class="table-wrap">
        <table class="table stack">
          <thead><tr><th>Customer</th><th>Status</th><th>Version</th><th>Downloaded</th><th>Activated</th><th>Expires</th></tr></thead>
          <tbody>
            @for (r of rows(); track r['id']) {
              <tr>
                <td data-label="Customer"><a [routerLink]="['/admin/demos', r['id']]"><strong>{{ r['full_name'] }}</strong></a><br /><span class="muted tiny">{{ r['company'] }} · {{ r['email'] }}</span></td>
                <td data-label="Status"><span class="badge" [class]="'badge ' + labels[r['status']][1]">{{ labels[r['status']][0] }}</span></td>
                <td data-label="Version">{{ r['version'] ?? '–' }}</td>
                <td data-label="Downloaded">{{ (r['first_downloaded_at'] | date: 'd MMM y') ?? '–' }}@if (r['downloads'] > 1) { <span class="muted tiny"> ({{ r['downloads'] }}×)</span> }</td>
                <td data-label="Activated">{{ (r['activated_at'] | date: 'd MMM y') ?? '–' }}</td>
                <td data-label="Expires">{{ (r['expires_at'] | date: 'd MMM y') ?? (r['start_on'] === 'activation' ? 'Starts at activation' : '–') }}</td>
              </tr>
            } @empty { <tr><td colspan="6" class="empty">No demos yet.</td></tr> }
          </tbody>
        </table>
      </div>
      @if (total() > rows().length) { <p class="muted small">Showing {{ rows().length }} of {{ total() }} – open the Demos dashboard for more.</p> }
    }
  `,
  styles: SHARED,
})
export class DemoHistoryTab implements OnInit {
  readonly productId = input.required<number>();
  private api = inject(PlatformApi);
  private auth = inject(AuthService);
  protected can = () => this.auth.can('customers.view') || this.auth.can('licences.view');
  protected rows = signal<Row[]>([]);
  protected total = signal(0);
  protected labels = DEMO_STATUS;
  protected keys = Object.keys(DEMO_STATUS);
  protected status = '';
  protected q = '';
  ngOnInit() {
    if (this.can()) void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page('/demos', { productId: this.productId(), status: this.status, q: this.q, page, perPage: 50 });
    this.rows.set(r.data);
    this.total.set(r.meta.total);
  }
}

/* =========================================================================================
 * Setup & learning steps
 * ========================================================================================= */
const ITEM_KIND: Record<string, string> = { image: 'Image', video: 'Video', document: 'Document (PDF/Office)', file: 'Downloadable file', link: 'Web link', demo_download: 'Demo download button' };

@Component({
  selector: 'sch-pe-steps',
  imports: [FormsModule, MediaPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sec-h">
      <p class="muted">The customer’s step-by-step guide for this product – downloading, installing, activating, setting up and learning. Each step can mix text, images, videos, documents, files and links. Customers tick steps off; their progress is saved to their account.</p>
      @if (canEdit()) { <button class="btn btn-primary btn-sm" type="button" (click)="open(null)">+ Add step</button> }
    </div>
    @if (msg()) { <div class="alert alert-ok" role="status">{{ msg() }}</div> }
    <ol class="steps">
      @for (s of steps(); track s['id']; let i = $index; let first = $first; let last = $last) {
        <li class="box" [class.off]="!s['is_enabled']">
          <div class="st-h">
            <span class="n">{{ i + 1 }}</span>
            <div class="st-t"><strong>{{ s['title'] }}</strong>@if (!s['is_enabled']) { <span class="badge badge-muted">Hidden</span> }<br />
              <span class="muted tiny">{{ s['items'].length }} item(s) · completed by {{ s['completions'] }} customer(s)</span></div>
            @if (canEdit()) {
              <div class="row-actions">
                <button class="btn btn-ghost btn-sm" type="button" [disabled]="first" (click)="move(i, -1)" aria-label="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" type="button" [disabled]="last" (click)="move(i, 1)" aria-label="Move down">↓</button>
                <button class="btn btn-ghost btn-sm" type="button" (click)="toggle(s)">{{ s['is_enabled'] ? 'Hide' : 'Show' }}</button>
                <button class="btn btn-ghost btn-sm" type="button" (click)="open(s)">Edit</button>
                <button class="btn btn-danger btn-sm" type="button" (click)="remove(s)">Delete</button>
              </div>
            }
          </div>
          @if (s['summary']) { <p class="small">{{ s['summary'] }}</p> }
          @if (s['items'].length) { <ul class="chips-l">@for (it of s['items']; track $index) { <li><span class="badge badge-info">{{ kinds[it.kind] }}</span> {{ it.title || it.mediaTitle || it.url || '' }}</li> }</ul> }
        </li>
      } @empty { <li class="muted">No steps yet. Typical steps: Download · Install · Activate · Initial setup · Learn the product · Get support.</li> }
    </ol>

    <dialog #dlg class="dlg wide">
      <form (ngSubmit)="save()">
        <h2>{{ editing() ? 'Edit step' : 'Add step' }}</h2>
        @if (err()) { <div class="alert alert-error">{{ err() }}</div> }
        <div class="field"><label for="st-t">Step title</label><input id="st-t" class="input" name="t" [(ngModel)]="f.title" placeholder="e.g. Install the product" />@if (fe('title')) {<span class="error">{{ fe('title') }}</span>}</div>
        <div class="field"><label for="st-s">Short description <span class="muted">(optional)</span></label><input id="st-s" class="input" name="s" [(ngModel)]="f.summary" maxlength="500" /></div>
        <div class="field"><label for="st-b">Detailed instructions</label><textarea id="st-b" class="textarea" rows="7" name="b" [(ngModel)]="f.body" placeholder="Plain text. Leave a blank line between paragraphs."></textarea></div>
        <label class="check"><input type="checkbox" name="e" [(ngModel)]="f.isEnabled" /><span>Show this step to customers</span></label>
        <div class="sec">
          <div class="sec-h"><h3>Media & resources</h3>
            <div class="row-actions">
              <select class="select sm" name="k" [(ngModel)]="newKind" aria-label="Type to add">@for (k of kindKeys; track k) {<option [value]="k">{{ kinds[k] }}</option>}</select>
              <button class="btn btn-ghost btn-sm" type="button" (click)="addItem(picker)">+ Add</button>
            </div></div>
          @for (it of f.items; track $index; let i = $index; let first = $first; let last = $last) {
            <div class="item">
              <span class="badge badge-info">{{ kinds[it.kind] }}</span>
              @if (it.kind === 'link') {
                <input class="input sm" [name]="'u' + i" [(ngModel)]="it.url" placeholder="https://" aria-label="Link address" />
              } @else if (it.kind === 'demo_download') {
                <span class="muted small">Shows the product’s current demo download with the customer’s status.</span>
              } @else { <span class="small">{{ it.mediaTitle }}</span> }
              <input class="input sm" [name]="'t' + i" [(ngModel)]="it.title" placeholder="Label (optional)" aria-label="Label" />
              @if (fe('items.' + i + '.url') || fe('items.' + i + '.mediaId')) { <span class="error">{{ fe('items.' + i + '.url') || fe('items.' + i + '.mediaId') }}</span> }
              <span class="row-actions">
                <button class="btn btn-ghost btn-sm" type="button" [disabled]="first" (click)="moveItem(i, -1)" aria-label="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" type="button" [disabled]="last" (click)="moveItem(i, 1)" aria-label="Move down">↓</button>
                <button class="btn btn-ghost btn-sm" type="button" (click)="f.items.splice(i, 1)" aria-label="Remove">✕</button>
              </span>
            </div>
          } @empty { <p class="muted small">Text only. Add images, videos, PDFs, files, links or the demo download button.</p> }
        </div>
        <div class="actions"><button class="btn btn-ghost" type="button" (click)="dlg.close()">Cancel</button><button class="btn btn-primary" type="submit" [disabled]="busy()">Save step</button></div>
      </form>
    </dialog>
    <sch-media-picker #picker [kind]="pickerKind()" [defaultVisibility]="'customer'" heading="Choose a file" (picked)="picked($event)" />
  `,
  styles: SHARED + `
    .steps { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 10px; }
    .steps li.off { opacity: .6; }
    .st-h { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .st-t { flex: 1 1 200px; }
    .n { flex: 0 0 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; color: #fff; background: linear-gradient(135deg, var(--sch-blue), #7b5cff); }
    .chips-l { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 4px; font-size: 13px; }
    .item { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--line); }
    .item .input { flex: 1 1 180px; }
  `,
})
export class SetupStepsTab implements OnInit {
  readonly productId = input.required<number>();
  private api = inject(PlatformApi);
  private auth = inject(AuthService);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected steps = signal<Row[]>([]);
  protected editing = signal<Row | null>(null);
  protected err = signal<string | null>(null);
  protected msg = signal<string | null>(null);
  protected busy = signal(false);
  protected fields = signal<Record<string, string>>({});
  protected kinds = ITEM_KIND;
  protected kindKeys = Object.keys(ITEM_KIND);
  protected newKind = 'video';
  protected pickerKind = signal<'image' | 'video' | 'document' | 'any'>('any');
  protected f: { title: string; summary: string; body: string; isEnabled: boolean; items: { kind: string; mediaId?: number | null; mediaTitle?: string; url?: string | null; title?: string | null }[] } = { title: '', summary: '', body: '', isEnabled: true, items: [] };
  private pendingKind = 'video';
  protected canEdit = () => this.auth.can('products.manage');
  protected fe = (k: string) => this.fields()[k] ?? null;

  ngOnInit() {
    void this.load();
  }
  async load() {
    this.steps.set(await this.api.get<Row[]>(`/products/${this.productId()}/steps`));
  }
  open(s: Row | null) {
    this.editing.set(s);
    this.err.set(null);
    this.fields.set({});
    this.f = { title: s?.['title'] ?? '', summary: s?.['summary'] ?? '', body: s?.['body'] ?? '', isEnabled: s?.['is_enabled'] ?? true, items: (s?.['items'] ?? []).map((i: Row) => ({ ...i })) };
    this.dlg().nativeElement.showModal();
  }
  addItem(picker: MediaPicker) {
    const k = this.newKind;
    if (k === 'link') this.f.items.push({ kind: 'link', url: 'https://', title: '' });
    else if (k === 'demo_download') this.f.items.push({ kind: 'demo_download', title: '' });
    else {
      this.pendingKind = k;
      this.pickerKind.set(k === 'image' ? 'image' : k === 'video' ? 'video' : k === 'document' ? 'document' : 'any');
      setTimeout(() => picker.open());
    }
  }
  picked(m: MediaItem) {
    this.f.items.push({ kind: this.pendingKind, mediaId: m.id, mediaTitle: m.title, title: '' });
  }
  moveItem(i: number, d: number) {
    const a = this.f.items;
    [a[i], a[i + d]] = [a[i + d], a[i]];
  }
  async save() {
    this.busy.set(true);
    this.err.set(null);
    this.fields.set({});
    const body = { title: this.f.title, summary: this.f.summary || null, body: this.f.body || null, isEnabled: this.f.isEnabled, items: this.f.items.map((i) => ({ kind: i.kind, mediaId: i.mediaId ?? null, url: i.url ?? null, title: i.title || null })) };
    try {
      const s = this.editing();
      this.steps.set(await (s ? this.api.put<Row[]>(`/steps/${s['id']}`, body) : this.api.post<Row[]>(`/products/${this.productId()}/steps`, body)));
      this.dlg().nativeElement.close();
      this.msg.set(`Step “${this.f.title}” saved.`);
    } catch (e) {
      const a = toApiError(e);
      this.fields.set(a.fields);
      this.err.set(a.message);
    } finally {
      this.busy.set(false);
    }
  }
  async toggle(s: Row) {
    this.steps.set(await this.api.put<Row[]>(`/steps/${s['id']}`, { title: s['title'], summary: s['summary'], body: s['body'], isEnabled: !s['is_enabled'], items: s['items'].map((i: Row) => ({ kind: i['kind'], mediaId: i['mediaId'], url: i['url'], title: i['title'] })) }));
  }
  async move(i: number, d: number) {
    const ids = this.steps().map((s) => s['id']);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    this.steps.set(await this.api.put<Row[]>(`/products/${this.productId()}/steps-order`, { ids }));
  }
  async remove(s: Row) {
    if (!confirm(s['completions'] ? `Remove “${s['title']}”? ${s['completions']} customer(s) completed it – it will be archived so their history is kept.` : `Delete “${s['title']}”?`)) return;
    this.steps.set(await this.api.del<Row[]>(`/steps/${s['id']}`));
    this.msg.set('Step removed.');
  }
}

/* =========================================================================================
 * Downloads (per product) and Enquiries (per product)
 * ========================================================================================= */
@Component({
  selector: 'sch-pe-downloads',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">Every demo download of this product. A download is not an installation – activations are shown on each demo record.</p>
    <div class="table-wrap">
      <table class="table stack">
        <thead><tr><th>When</th><th>Customer</th><th>Version</th><th>File</th><th>Result</th></tr></thead>
        <tbody>
          @for (r of rows(); track r['id']) {
            <tr>
              <td data-label="When">{{ r['created_at'] | date: 'd MMM y, HH:mm' }}</td>
              <td data-label="Customer">@if (r['licence_id']) {<a [routerLink]="['/admin/demos', r['licence_id']]">{{ r['full_name'] }}</a>} @else {{{ r['full_name'] }}}@if (r['company']) {<span class="muted tiny"> · {{ r['company'] }}</span>}</td>
              <td data-label="Version">{{ r['version'] }} <span class="muted tiny">{{ r['channel'] === 'demo' ? 'demo' : 'release' }}</span></td>
              <td data-label="File">{{ r['label'] || r['original_name'] }} <span class="muted tiny">{{ r['platform'] }}</span></td>
              <td data-label="Result"><span class="badge" [class]="'badge ' + (r['status'] === 'completed' ? 'badge-ok' : r['status'] === 'failed' ? 'badge-danger' : 'badge-muted')">{{ statusText[r['status']] ?? r['status'] }}</span></td>
            </tr>
          } @empty { <tr><td colspan="5" class="empty">No downloads yet.</td></tr> }
        </tbody>
      </table>
    </div>
    @if (meta(); as m) { <div class="pager"><span class="muted">{{ m['total'] }} download(s)</span><span><button class="btn btn-ghost btn-sm" type="button" [disabled]="m['page'] <= 1" (click)="load(m['page'] - 1)">Previous</button> <button class="btn btn-ghost btn-sm" type="button" [disabled]="m['page'] * m['perPage'] >= m['total']" (click)="load(m['page'] + 1)">Next</button></span></div> }
  `,
  styles: SHARED,
})
export class ProductDownloadsTab implements OnInit {
  readonly productId = input.required<number>();
  private api = inject(PlatformApi);
  protected rows = signal<Row[]>([]);
  protected meta = signal<Row | null>(null);
  protected statusText: Record<string, string> = { authorised: 'Link issued', started: 'Started', completed: 'Completed', failed: 'Interrupted' };
  ngOnInit() {
    void this.load(1);
  }
  async load(page: number) {
    const r = await this.api.page(`/products/${this.productId()}/downloads`, { page, perPage: 25 });
    this.rows.set(r.data);
    this.meta.set(r.meta);
  }
}

@Component({
  selector: 'sch-pe-enquiries',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (e(); as e) {
      <section class="sec"><div class="sec-h"><h3>Support conversations & website enquiries</h3><a class="btn btn-ghost btn-sm" routerLink="/admin/support" [queryParams]="{ productId: productId(), view: 'all' }">Open in Support Inbox</a></div>
        <ul class="lst">@for (t of e['conversations']; track t['id']) { <li><a routerLink="/admin/support" [queryParams]="{ open: t['id'] }"><strong>{{ t['subject'] }}</strong></a> <span class="muted tiny">{{ t['reference'] }} · {{ t['name'] }}@if (t['company']) { ({{ t['company'] }}) } · {{ t['last_message_at'] | date: 'd MMM y' }} · {{ t['status'] }}</span></li> } @empty { <li class="muted">None.</li> }</ul></section>
      <section class="sec"><div class="sec-h"><h3>Demo requests (live demonstrations)</h3><a class="btn btn-ghost btn-sm" routerLink="/admin/demo-requests">Open demo requests</a></div>
        <ul class="lst">@for (d of e['demoRequests']; track d['id']) { <li><strong>{{ d['name'] }}</strong>@if (d['company']) { · {{ d['company'] }} } <span class="muted tiny">{{ d['reference'] }} · {{ d['preferred_type'] }} · {{ d['created_at'] | date: 'd MMM y' }} · {{ d['status'] }}</span></li> } @empty { <li class="muted">None.</li> }</ul></section>
      <section class="sec"><div class="sec-h"><h3>Quote & package requests</h3></div>
        <ul class="lst">@for (q of e['quotes']; track q['id']) { <li>{{ q['reference'] }} <span class="muted tiny">{{ q['kind'] }} · {{ q['status'] }} · {{ q['created_at'] | date: 'd MMM y' }}</span></li> } @empty { <li class="muted">None.</li> }</ul></section>
    } @else { <p class="muted">Loading…</p> }
  `,
  styles: SHARED + `.lst { list-style: none; padding: 0; margin: 0; } .lst li { padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; }`,
})
export class ProductEnquiriesTab implements OnInit {
  readonly productId = input.required<number>();
  private api = inject(PlatformApi);
  protected e = signal<Row | null>(null);
  ngOnInit() {
    void this.api.get(`/products/${this.productId()}/enquiries`).then((r) => this.e.set(r));
  }
}

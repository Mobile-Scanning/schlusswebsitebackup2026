import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../core/auth.service';
import type { StoryContent } from '../core/public-api';
import { SchStoryCard, shortText, StoryPiece } from '../shared/story-card';
import { CatalogueApi, MediaItem } from './catalogue-api';
import { MediaPicker } from './media';

interface Row { id: number; name: string; slug: string; status: string; is_published: boolean; offering: string; category: string | null; short_description: string | null; show: boolean; order: number; description: string | null; tagline: string | null; image: string | null; logo: string | null }
const HUES = [['#ffb020', 'Gold'], ['#3282f6', 'SCHLUSS blue'], ['#22d3a6', 'Teal'], ['#e879f9', 'Violet'], ['#ff5d8f', 'Pink'], ['#84cc16', 'Lime']];
const DEFAULT_PICTURE = '/brand/about-puzzle-1280.webp';

/**
 * Admin › Website content › About SCHLUSS experience.
 * Everything about the About SCHLUSS puzzle in one place: on/off, the picture, the first and last pieces,
 * the closing statement, the animation timing, and which published products appear (in which order, with
 * which short description). Uses the existing Products and media library – no separate product list.
 */
@Component({
  selector: 'sch-about-experience',
  imports: [FormsModule, RouterLink, MediaPicker, SchStoryCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (s(); as s) {
      <form class="card" (ngSubmit)="saveAll()">
        <div class="head">
          <label class="switch"><input type="checkbox" name="en" [(ngModel)]="s.enabled" (ngModelChange)="bump()" /><span><strong>Play the puzzle animation on About SCHLUSS</strong><br /><span class="muted small">Off: the page shows the finished picture and the closing statement only.</span></span></label>
          <button class="btn btn-ghost" type="button" (click)="openPreview()">▶ Preview the animation ↗</button>
        </div>

        <h2>The picture</h2>
        <div class="pic">
          <img [src]="pictureUrl() || defaultPicture" alt="" />
          <div class="pic-a">
            <p class="muted small">{{ pictureUrl() ? 'Your own picture is used.' : 'The SCHLUSS town picture (built in) is used.' }} Use a wide 16:9 image, at least 1920 × 1080.</p>
            <div class="row"><button class="btn btn-ghost btn-sm" type="button" (click)="picker.open()">Choose / upload picture…</button>@if (s.imageMediaId) { <button class="btn btn-ghost btn-sm" type="button" (click)="usePicture(null, null)">Use the SCHLUSS picture</button> }</div>
          </div>
        </div>

        <div class="two">
          <section>
            <h2>First piece – what SCHLUSS means</h2>
            <p class="muted small">Always first. Products can never replace it.</p>
            <div class="field"><label for="ae-mt">Title</label><input id="ae-mt" class="input" name="mt" maxlength="80" [(ngModel)]="s.meaningTitle" (ngModelChange)="bump()" /></div>
            <div class="field"><label for="ae-mm">Main message</label><input id="ae-mm" class="input" name="mm" maxlength="120" [(ngModel)]="s.meaningMessage" (ngModelChange)="bump()" /></div>
            <div class="field"><label for="ae-mx">Short description</label><textarea id="ae-mx" class="textarea" rows="3" name="mx" maxlength="400" [(ngModel)]="s.meaningText" (ngModelChange)="bump()"></textarea></div>
            <h2>Last piece – and more to come</h2>
            <p class="muted small">Always last, after every product.</p>
            <div class="field"><label for="ae-ot">Title</label><input id="ae-ot" class="input" name="ot" maxlength="80" [(ngModel)]="s.moreTitle" (ngModelChange)="bump()" /></div>
            <div class="field"><label for="ae-ox">Message</label><textarea id="ae-ox" class="textarea" rows="2" name="ox" maxlength="400" [(ngModel)]="s.moreText" (ngModelChange)="bump()"></textarea></div>
            <div class="field"><span class="lbl">Colour of this piece</span>
              <div class="hues">@for (h of hues; track h[0]) { <button type="button" class="hue" [class.on]="s.moreHue === h[0]" [style.background]="h[0]" [attr.aria-label]="h[1]" [attr.aria-pressed]="s.moreHue === h[0]" (click)="s.moreHue = h[0]; bump()"></button> }</div></div>
            <h2>Closing statement</h2>
            <p class="muted small">Shown under the finished picture.</p>
            <div class="field"><label for="ae-ft">Statement</label><input id="ae-ft" class="input" name="ft" maxlength="120" [(ngModel)]="s.finalTitle" /></div>
            <div class="field"><label for="ae-fx">Line underneath</label><input id="ae-fx" class="input" name="fx" maxlength="200" [(ngModel)]="s.finalText" /></div>
          </section>
          <aside class="pv">
            <span class="pv-h">Tile preview</span>
            <div class="pv-tabs" role="tablist">
              <button type="button" role="tab" [attr.aria-selected]="pv() === 'first'" (click)="pv.set('first')">First piece</button>
              <button type="button" role="tab" [attr.aria-selected]="pv() === 'last'" (click)="pv.set('last')">Last piece</button>
            </div>
            <sch-story-card [piece]="pv() === 'first' ? firstPiece() : lastPiece()" [still]="true" [compact]="true" [showLink]="false" />
          </aside>
        </div>

        <h2>Animation timing <span class="muted small">(seconds)</span></h2>
        <div class="timing">
          @for (t of timingFields; track t.key) {
            <div class="field"><label [for]="'ae-t-' + t.key">{{ t.label }}</label><input [id]="'ae-t-' + t.key" class="input" type="number" [name]="'t' + t.key" [min]="t.min" [max]="t.max" step="0.1" [(ngModel)]="s.timing[t.key]" /><span class="hint">{{ t.min }}–{{ t.max }} s</span></div>
          }
        </div>
        <p class="muted small">Visitors can also pause, skip to the next piece, or skip the animation. Reading time stops while the mouse is over a tile.</p>

        <h2>Products in the puzzle</h2>
        <p class="muted small">Only <strong>published</strong> products can appear. Ticked products appear in this order between the first and last piece. Images come from each product (cover / logo) – change them in the product's “About SCHLUSS display settings”.</p>
        <div class="prods">
          @for (r of rows(); track r.id; let i = $index; let first = $first; let last = $last) {
            <div class="prod" [class.off]="!r.show" [class.unpub]="!r.is_published">
              <label class="pick"><input type="checkbox" [name]="'ps' + r.id" [(ngModel)]="r.show" [disabled]="!r.is_published" (ngModelChange)="renumber()" [attr.aria-label]="'Show ' + r.name + ' in About SCHLUSS'" /><span class="yn">{{ r.show ? 'Yes' : 'No' }}</span></label>
              <div class="thumb">@if (r.image) { <img [src]="r.image" alt="" loading="lazy" /> } @else if (r.logo) { <img [src]="r.logo" alt="" loading="lazy" class="logo" /> }</div>
              <div class="info">
                <strong>{{ r.name }}</strong>
                <span class="muted small">{{ r.category || r.offering }} · {{ r.is_published ? 'Published' : 'Not published – publish it first' }}</span>
                @if (r.show) {
                  <textarea class="textarea" rows="2" [name]="'pd' + r.id" maxlength="300" [(ngModel)]="r.description" [placeholder]="r.short_description || 'Short animation description'" [attr.aria-label]="'Animation description for ' + r.name"></textarea>
                  <input class="input" [name]="'pt' + r.id" maxlength="160" [(ngModel)]="r.tagline" placeholder="Small tagline (optional)" [attr.aria-label]="'Tagline for ' + r.name" />
                }
              </div>
              <div class="ord">
                @if (r.show) {
                  <button class="btn btn-ghost btn-sm" type="button" (click)="move(i, -1)" [disabled]="!canMove(i, -1)" [attr.aria-label]="'Move ' + r.name + ' up'">↑</button>
                  <button class="btn btn-ghost btn-sm" type="button" (click)="move(i, 1)" [disabled]="!canMove(i, 1)" [attr.aria-label]="'Move ' + r.name + ' down'">↓</button>
                }
                <a class="btn btn-ghost btn-sm" [routerLink]="['/admin/products', r.id]">Edit</a>
              </div>
            </div>
          } @empty { <p class="muted">No products yet.</p> }
        </div>

        @if (msg(); as m) { <div class="alert" [class.alert-error]="m.err" [class.alert-ok]="!m.err" role="status">{{ m.text }}</div> }
        <div class="actions">
          <button class="btn btn-ghost" type="button" (click)="restore()">Restore default text & timing</button>
          <button class="btn btn-ghost" type="button" (click)="saveAll(true)" [disabled]="busy()">Save & preview</button>
          <button class="btn btn-primary" type="submit" [disabled]="busy()">Save About SCHLUSS experience</button>
        </div>
      </form>
    } @else { <p class="muted">Loading…</p> }

    <sch-media-picker #picker kind="image" heading="Choose the About SCHLUSS picture" (picked)="picked($event)" />
  `,
  styles: `
    h2 { font-size: 17px; margin: 24px 0 8px; color: var(--sch-blue); }
    .head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .switch { display: flex; gap: 10px; align-items: flex-start; }
    .switch input { margin-top: 4px; width: 18px; height: 18px; }
    .pic { display: grid; grid-template-columns: minmax(0, 320px) 1fr; gap: 16px; align-items: center; }
    .pic img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    @media (max-width: 700px) { .pic { grid-template-columns: 1fr; } }
    .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 400px); gap: 28px; align-items: start; }
    @media (max-width: 1100px) { .two { grid-template-columns: 1fr; } }
    .field label, .lbl { display: block; margin-bottom: 6px; font-weight: 500; }
    .hues { display: flex; gap: 8px; }
    .hue { width: 30px; height: 30px; border-radius: 9px; border: 2px solid transparent; cursor: pointer; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .5); }
    .hue.on { border-color: var(--heading); transform: scale(1.12); }
    .pv { position: sticky; top: 90px; border-radius: 18px; padding: 16px; background: radial-gradient(120% 80% at 50% 0%, #3a2aa8, #120d45 70%); }
    .pv-h { display: block; color: #cfd6ff; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
    .pv-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
    .pv-tabs button { flex: 1; padding: 7px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, .25); background: transparent; color: #dfe5ff; cursor: pointer; font: inherit; font-size: 13px; }
    .pv-tabs button[aria-selected='true'] { background: rgba(255, 255, 255, .16); color: #fff; }
    .timing { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .prods { display: grid; gap: 8px; }
    .prod { display: grid; grid-template-columns: 70px 90px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .prod.off { opacity: .75; }
    .prod.unpub { opacity: .55; }
    .pick { display: flex; gap: 6px; align-items: center; font-weight: 600; padding-top: 6px; }
    .pick input { width: 18px; height: 18px; }
    .thumb { width: 90px; aspect-ratio: 16/10; border-radius: 8px; overflow: hidden; background: var(--surface-2); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .thumb img.logo { object-fit: contain; background: #fff; }
    .info { display: grid; gap: 6px; }
    .ord { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    @media (max-width: 760px) { .prod { grid-template-columns: 60px minmax(0, 1fr); } .thumb { display: none; } .ord { grid-column: 1 / -1; justify-content: flex-start; } }
    .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 18px; }
  `,
})
export class AboutExperience implements OnInit {
  private api = inject(CatalogueApi);
  protected readonly hues = HUES;
  protected readonly defaultPicture = DEFAULT_PICTURE;
  protected readonly timingFields = [
    { key: 'approach', label: 'Piece comes forward', min: 0.5, max: 5 },
    { key: 'tileIn', label: 'Tile appears', min: 0.2, max: 3 },
    { key: 'view', label: 'Reading time', min: 2, max: 30 },
    { key: 'tileOut', label: 'Tile closes', min: 0.2, max: 3 },
    { key: 'place', label: 'Piece moves into place', min: 0.5, max: 5 },
  ] as const;
  protected s = signal<StoryContent | null>(null);
  protected rows = signal<Row[]>([]);
  protected pictureUrl = signal<string | null>(null);
  protected busy = signal(false);
  protected msg = signal<{ text: string; err: boolean } | null>(null);
  protected pv = signal<'first' | 'last'>('first');
  private v = signal(0);

  protected firstPiece = computed<StoryPiece>(() => {
    this.v();
    const s = this.s()!;
    return { kind: 'meaning', title: s.meaningTitle, message: s.meaningMessage, text: shortText(s.meaningText, 260), hue: '#3282f6' };
  });
  protected lastPiece = computed<StoryPiece>(() => {
    this.v();
    const s = this.s()!;
    return { kind: 'more', title: s.moreTitle, text: shortText(s.moreText, 260), hue: s.moreHue };
  });

  async ngOnInit() {
    await this.load();
  }
  private async load() {
    const [all, story, rows] = await Promise.all([this.api.siteContent(), this.api.aboutStoryPublic(), this.api.aboutProducts()]);
    this.s.set(structuredClone(all.story));
    this.pictureUrl.set(story.story.image ?? null);
    this.rows.set(this.sorted(rows as Row[]));
  }
  private sorted(rows: Row[]) {
    return [...rows].sort((a, b) => Number(b.show) - Number(a.show) || (a.show ? a.order - b.order : 0) || a.name.localeCompare(b.name));
  }
  protected bump() {
    this.v.update((x) => x + 1);
  }
  protected renumber() {
    const r = this.sorted(this.rows().map((x, i) => ({ ...x, order: x.show ? (x.order || 1000 + i) : 0 })));
    let n = 1;
    for (const x of r) if (x.show) x.order = n++ * 10;
    this.rows.set(r);
  }
  protected canMove(i: number, d: number) {
    const j = i + d;
    const r = this.rows();
    return j >= 0 && j < r.length && r[j].show && r[i].show;
  }
  protected move(i: number, d: number) {
    const r = [...this.rows()];
    [r[i], r[i + d]] = [r[i + d], r[i]];
    let n = 1;
    for (const x of r) if (x.show) x.order = n++ * 10;
    this.rows.set(r);
  }
  protected picked(m: MediaItem) {
    this.usePicture(m.id, m.url);
  }
  protected usePicture(id: number | null, url: string | null) {
    const s = this.s()!;
    s.imageMediaId = id;
    this.pictureUrl.set(url);
    this.s.set({ ...s });
  }

  async saveAll(preview = false) {
    const s = this.s()!;
    this.busy.set(true);
    this.msg.set(null);
    try {
      const timing = Object.fromEntries(Object.entries(s.timing).map(([k, v]) => [k, Number(v)])) as unknown as StoryContent['timing'];
      const { image: _img, ...story } = { ...s, timing } as StoryContent & { image?: unknown };
      await this.api.saveSiteContent('story', { ...story, imageMediaId: s.imageMediaId ?? null });
      await this.api.saveAboutProducts(this.rows().map((r) => ({ id: r.id, show: r.show && r.is_published, order: r.show ? r.order : 0, description: r.description?.trim() || null, tagline: r.tagline?.trim() || null })));
      const shown = this.rows().filter((r) => r.show).length;
      this.msg.set({ text: `Saved – ${shown} product${shown === 1 ? '' : 's'} in the puzzle (plus the first and last piece).`, err: false });
      if (preview) this.openPreview();
    } catch (e) {
      const a = toApiError(e);
      this.msg.set({ text: Object.values(a.fields)[0] ? `Please check: ${Object.values(a.fields)[0]}` : a.message, err: true });
    } finally {
      this.busy.set(false);
    }
  }
  async restore() {
    if (!confirm('Restore the default first and last piece text, statement and timing? Your picture choice and product selection are kept.')) return;
    const keepImage = this.s()?.imageMediaId ?? null;
    const d = (await this.api.resetSiteContent('story')) as StoryContent;
    this.s.set({ ...structuredClone(d), imageMediaId: keepImage });
    if (keepImage) await this.api.saveSiteContent('story', { ...d, imageMediaId: keepImage });
    this.bump();
    this.msg.set({ text: 'Default text and timing restored.', err: false });
  }
  protected openPreview() {
    // A new tab with the live page (the site may not be shown inside frames – clickjacking protection).
    window.open(`/about?preview=${Date.now()}`, '_blank', 'noopener');
  }
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toApiError } from '../core/auth.service';
import { RouterLink } from '@angular/router';
import { SchStoryCard, shortText, StoryPiece } from '../shared/story-card';
import { AdminProduct, CatalogueApi, MediaItem } from './catalogue-api';
import { MediaPicker } from './media';

type Draft = { show: boolean; puzzle: boolean; order: number; title: string; description: string; problem: string; highlight: string; coverMediaId: number | null; imageMediaId: number | null; cover: string | null; image: string | null };

/**
 * Products Management Centre › offering › "About SCHLUSS display settings".
 * Decides whether this offering appears on the About SCHLUSS page and as a piece of its puzzle animation,
 * with optional puzzle-only text and images. The fixed first and last pieces live in Website content.
 */
@Component({
  selector: 'sch-pe-about',
  imports: [FormsModule, RouterLink, MediaPicker, SchStoryCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = draft();
    @if (!product().is_published) { <p class="note">This offering is not published yet. It appears on the About SCHLUSS page as soon as it is published and switched on here.</p> }
    <form (ngSubmit)="save()" class="grid">
      <div class="fields">
        <label class="check"><input type="checkbox" name="show" [(ngModel)]="d.show" (ngModelChange)="touch()" /><span><strong>Show in About SCHLUSS: {{ d.show ? 'Yes' : 'No' }}</strong><br /><span class="muted small">Gets its own puzzle piece and floating tile in the About SCHLUSS animation. Switch off to leave it out – nothing is deleted.</span></span></label>
        <div class="field"><label for="ab-o">Puzzle display order</label><input id="ab-o" class="input narrow" type="number" min="0" max="9999" name="order" [(ngModel)]="d.order" (ngModelChange)="touch()" />
          <span class="hint">Lower numbers come first. “What SCHLUSS means” is always first and “And more to come…” is always last.</span></div>
        <div class="field"><label for="ab-t">Puzzle card title <span class="muted">(optional)</span></label><input id="ab-t" class="input" name="title" maxlength="120" [(ngModel)]="d.title" (ngModelChange)="touch()" [placeholder]="product().name" /></div>
        <div class="field"><label for="ab-d">Short animation description <span class="muted">(optional)</span></label><textarea id="ab-d" class="textarea" rows="3" name="description" maxlength="300" [(ngModel)]="d.description" (ngModelChange)="touch()" [placeholder]="product().short_description ?? 'Uses the short description'"></textarea>
          <span class="hint">One or two sentences. Leave empty to use the offering's short description.</span></div>
        <div class="field"><label for="ab-h">Small tagline <span class="muted">(optional)</span></label><input id="ab-h" class="input" name="highlight" maxlength="160" [(ngModel)]="d.highlight" (ngModelChange)="touch()" placeholder="e.g. New · Most popular · Built for retail" /></div>
        <div class="imgs">
          <div class="img">
            <span class="lbl">Puzzle cover image</span>
            @if (d.cover) { <img [src]="d.cover" alt="" /> } @else { <span class="empty">Uses the product image</span> }
            <div class="row"><button class="btn btn-ghost btn-sm" type="button" (click)="pick('cover')">Choose…</button>@if (d.coverMediaId) { <button class="btn btn-ghost btn-sm" type="button" (click)="clear('cover')">Remove</button> }</div>
          </div>
          <div class="img">
            <span class="lbl">Puzzle product image / logo</span>
            @if (d.image) { <img [src]="d.image" alt="" class="logo" /> } @else { <span class="empty">Uses the logo</span> }
            <div class="row"><button class="btn btn-ghost btn-sm" type="button" (click)="pick('image')">Choose…</button>@if (d.imageMediaId) { <button class="btn btn-ghost btn-sm" type="button" (click)="clear('image')">Remove</button> }</div>
          </div>
        </div>
        @if (msg(); as m) { <div class="alert" [class.alert-error]="m.err" [class.alert-ok]="!m.err" role="status">{{ m.text }}</div> }
        <div class="actions">
          <a class="btn btn-ghost" routerLink="/admin/content" [queryParams]="{ tab: 'story' }">Choose & order all pieces</a>
          <a class="btn btn-ghost" href="/about?preview=1" target="_blank" rel="noopener">Preview About SCHLUSS ↗</a>
          <button class="btn btn-primary" type="submit" [disabled]="busy() || !canEdit()">Save About SCHLUSS settings</button>
        </div>
      </div>
      <div class="preview" aria-label="Preview of the puzzle tile">
        <span class="pv-h">Preview – how visitors see this piece</span>
        @if (d.show) {
          <div class="stage">
            <svg class="piece" viewBox="-12 -12 136 136" aria-hidden="true"><path [attr.d]="pieceD" fill="#3282f6" stroke="#fff" stroke-width="3" /></svg>
            <sch-story-card [piece]="preview()" step="Piece 2" [compact]="true" [showLink]="false" [still]="true" />
          </div>
        } @else { <p class="muted">Not shown in About SCHLUSS.</p> }
      </div>
    </form>
    <sch-media-picker #picker kind="image" [heading]="target() === 'cover' ? 'Choose the puzzle cover image' : 'Choose the puzzle product image'" (picked)="picked($event)" />
  `,
  styles: `
    .note { padding: 10px 14px; border-radius: var(--r); background: var(--surface-2); border: 1px solid var(--line); margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 28px; align-items: start; }
    @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
    .fields { display: grid; gap: 12px; }
    .check { display: flex; gap: 10px; align-items: flex-start; }
    .check input { margin-top: 4px; }
    .narrow { max-width: 140px; }
    .field label { display: block; margin-bottom: 6px; }
    .imgs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .img { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r); }
    .img img { width: 100%; aspect-ratio: 16/7; object-fit: cover; border-radius: 6px; }
    .img img.logo { object-fit: contain; background: #fff; }
    .lbl { font-weight: 600; }
    .empty { display: grid; place-items: center; aspect-ratio: 16/7; border-radius: 6px; background: var(--surface-2); color: var(--muted); font-size: 13px; }
    .row, .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions { justify-content: flex-end; }
    .preview { position: sticky; top: 90px; border-radius: 18px; padding: 16px; background: radial-gradient(120% 80% at 50% 0%, #3a2aa8, #120d45 70%); }
    .pv-h { display: block; color: #cfd6ff; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 12px; }
    .preview .muted { color: #cfd6ff; }
    .stage { position: relative; padding-top: 34px; }
    .piece { position: absolute; width: 74px; height: 74px; top: -4px; left: 18px; z-index: 2; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, .45)); animation: bob 3.2s ease-in-out infinite; }
    @keyframes bob { 50% { transform: translateY(-6px) rotate(-4deg); } }
    @media (prefers-reduced-motion: reduce) { .piece { animation: none; } }
  `,
})
export class AboutSettings {
  readonly product = input.required<AdminProduct>();
  readonly canEdit = input(true);
  readonly saved = output<AdminProduct>();
  private api = inject(CatalogueApi);
  protected readonly pieceD = 'M0 0 L41 0 L41 8 A15 15 0 1 0 59 8 L59 0 L100 0 L100 41 L108 41 A15 15 0 1 1 108 59 L100 59 L100 100 L59 100 L59 108 A15 15 0 1 1 41 108 L41 100 L0 100 L0 59 L8 59 A15 15 0 1 0 8 41 L0 41 Z';
  protected draft = signal<Draft>(this.fromProduct(null));
  private version = signal(0);
  protected busy = signal(false);
  protected msg = signal<{ text: string; err: boolean } | null>(null);
  protected target = signal<'cover' | 'image'>('cover');
  private picker = viewChild.required(MediaPicker);

  constructor() {
    effect(() => {
      const p = this.product();
      untracked(() => this.draft.set(this.fromProduct(p)));
    });
  }

  private fromProduct(p: AdminProduct | null): Draft {
    return {
      show: !!p?.about_show, puzzle: p ? !!p.about_puzzle : true, order: p?.about_order ?? 0,
      title: p?.about_title ?? '', description: p?.about_description ?? '', problem: p?.about_problem ?? '', highlight: p?.about_highlight ?? '',
      coverMediaId: p?.about_cover_media_id ?? null, imageMediaId: p?.about_image_media_id ?? null, cover: p?.aboutCover ?? null, image: p?.aboutImage ?? null,
    };
  }
  /** Template-driven edits mutate the draft object; bump a counter so the preview recomputes. */
  protected touch() {
    this.version.update((v) => v + 1);
  }

  protected preview = computed<StoryPiece>(() => {
    this.version();
    const d = this.draft();
    const p = this.product();
    const text = d.description.trim() || p.short_description || p.tagline || '';
    return {
      kind: 'product',
      title: d.title.trim() || p.name,
      text: shortText(text),
      tagline: d.highlight.trim() || p.tagline || null,
      category: p.category?.name ?? p.offering_label,
      cover: d.cover ?? p.image ?? p.previewImage,
      image: d.image ?? p.logo,
      link: null,
      hue: '#3282f6',
    };
  });

  pick(t: 'cover' | 'image') {
    this.target.set(t);
    this.picker().open();
  }
  picked(m: MediaItem) {
    const d = { ...this.draft() };
    if (this.target() === 'cover') { d.coverMediaId = m.id; d.cover = m.url; }
    else { d.imageMediaId = m.id; d.image = m.url; }
    this.draft.set(d);
  }
  clear(t: 'cover' | 'image') {
    const d = { ...this.draft() };
    if (t === 'cover') { d.coverMediaId = null; d.cover = null; } else { d.imageMediaId = null; d.image = null; }
    this.draft.set(d);
  }

  async save() {
    const d = this.draft();
    this.busy.set(true);
    this.msg.set(null);
    try {
      const r = await this.api.saveAbout(this.product().id, {
        show: d.show, puzzle: true, order: Math.max(0, Math.min(9999, Math.round(Number(d.order) || 0))),
        title: d.title.trim() || null, description: d.description.trim() || null, problem: null, highlight: d.highlight.trim() || null,
        coverMediaId: d.coverMediaId, imageMediaId: d.imageMediaId,
      });
      this.saved.emit(r);
      this.msg.set({ text: d.show ? (this.product().is_published ? 'Saved – this offering is a piece of the About SCHLUSS puzzle.' : 'Saved – it joins the puzzle once it is published.') : 'Saved – not shown in About SCHLUSS.', err: false });
    } catch (e) {
      const a = toApiError(e);
      this.msg.set({ text: Object.values(a.fields)[0] ?? a.message, err: true });
    } finally {
      this.busy.set(false);
    }
  }
}

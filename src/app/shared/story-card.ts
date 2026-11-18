import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SchMark } from './brand';

/** One piece of the About SCHLUSS story, as shown on its floating information tile. */
export interface StoryPiece {
  kind: 'meaning' | 'product' | 'more';
  title: string;
  /** Big headline line (first and last piece). */
  message?: string | null;
  /** One short description – never a block of text. */
  text: string;
  category?: string | null;
  tagline?: string | null;
  cover?: string | null;
  image?: string | null;
  link?: string | null;
  /** Colour of the puzzle piece this tile belongs to. */
  hue: string;
}

/** Keeps a description short: whole words, at most ~200 characters. */
export function shortText(t: string, max = 200): string {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:–-]\s*$/, '') + '…';
}

/**
 * The floating information tile of the About SCHLUSS puzzle (also the admin preview).
 * Image, headline and text animate in one after another; the duration comes from the admin's timing (--tin).
 */
@Component({
  selector: 'sch-story-card',
  imports: [RouterLink, SchMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--hue]': 'piece().hue', '[class.compact]': 'compact()', '[class.still]': 'still()' },
  template: `
    @let p = piece();
    <article class="card" [class.special]="p.kind !== 'product'" [class.more]="p.kind === 'more'">
      @if (p.kind === 'product' && p.cover && !coverFailed()) {
        <div class="cover a1"><img [src]="p.cover" alt="" decoding="async" (error)="coverFailed.set(true)" /></div>
      }
      <div class="body">
        <div class="top a2">
          <span class="emblem" aria-hidden="true">
            @if (p.kind === 'meaning') { <sch-mark [size]="34" ink="#eef1f6" gap="#151a4f" /> }
            @else if (p.kind === 'more') { <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" fill="currentColor" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" fill="currentColor" opacity=".7" /></svg> }
            @else if (p.image && !imageFailed()) { <img [src]="p.image" alt="" decoding="async" (error)="imageFailed.set(true)" /> }
            @else { <span class="initial">{{ p.title.charAt(0) }}</span> }
          </span>
          <div class="meta">
            @if (step()) { <span class="step">{{ step() }}</span> }
            @if (p.category) { <span class="tag">{{ p.category }}</span> }
          </div>
        </div>
        <h3 class="a3">{{ p.title }}</h3>
        @if (p.message) { <p class="message a3">{{ p.message }}</p> }
        @if (p.tagline) { <p class="tagline a4">{{ p.tagline }}</p> }
        @if (p.text) { <p class="text a4">{{ p.text }}</p> }
        @if (p.link && showLink()) { <a class="go a5" [routerLink]="p.link">Discover {{ p.title }} <span aria-hidden="true">→</span></a> }
      </div>
    </article>
  `,
  styles: `
    :host { display: block; --hue: #3282f6; --tin: 700ms; }
    .card { position: relative; overflow: hidden; border-radius: 22px; color: #eef1fb; background: linear-gradient(160deg, rgba(36, 42, 120, .92), rgba(16, 15, 62, .94));
      border: 1px solid rgba(255, 255, 255, .24); box-shadow: 0 30px 70px rgba(5, 6, 40, .55), 0 0 40px color-mix(in srgb, var(--hue) 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, .2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2); }
    .card::before { content: ''; position: absolute; inset: 0 0 auto; height: 5px; background: linear-gradient(90deg, var(--hue), #ffb020, #22d3a6, #4c8dff, #e879f9); z-index: 2; }
    .card::after { content: ''; position: absolute; width: 280px; height: 280px; right: -100px; top: -120px; border-radius: 50%; background: var(--hue); opacity: .3; filter: blur(60px); pointer-events: none; }
    .card.more { background: linear-gradient(150deg, color-mix(in srgb, var(--hue) 40%, #241a6e), #120d45 70%); }
    .cover { aspect-ratio: 16 / 7.5; overflow: hidden; background: rgba(255, 255, 255, .06); }
    .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .body { position: relative; z-index: 1; padding: 22px 26px 24px; display: grid; gap: 9px; }
    .top { display: flex; align-items: center; gap: 14px; }
    .emblem { width: 54px; height: 54px; flex: none; border-radius: 16px; display: grid; place-items: center; overflow: hidden; color: #fff;
      background: color-mix(in srgb, var(--hue) 70%, #10123f); box-shadow: 0 8px 22px color-mix(in srgb, var(--hue) 45%, transparent), inset 0 1px 0 rgba(255, 255, 255, .35); }
    .emblem img { width: 100%; height: 100%; object-fit: contain; background: #fff; padding: 6px; box-sizing: border-box; }
    .initial { font: 800 26px/1 var(--f-head); }
    .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .step { font: 700 12px/1 var(--f-text); letter-spacing: .14em; text-transform: uppercase; color: #b9c4ff; margin-right: 4px; }
    .tag { font: 600 12px/1 var(--f-text); padding: 6px 10px; border-radius: 999px; background: rgba(255, 255, 255, .1); border: 1px solid rgba(255, 255, 255, .2); color: #eef1fb; }
    h3 { margin: 4px 0 0; font: 800 clamp(22px, 2.1vw, 30px)/1.15 var(--f-head); color: #fff; letter-spacing: -.01em; }
    .special h3 { text-transform: uppercase; letter-spacing: .05em; font-size: clamp(18px, 1.6vw, 22px); color: #c9d2ff; }
    .message { margin: 0; font: 800 clamp(26px, 2.8vw, 40px)/1.08 var(--f-head); text-transform: uppercase; letter-spacing: .01em;
      background: linear-gradient(90deg, #fff, #c9dcff 40%, color-mix(in srgb, var(--hue) 60%, #fff)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .tagline { margin: 0; font-weight: 700; color: color-mix(in srgb, var(--hue) 55%, #fff); font-size: 15.5px; letter-spacing: .02em; }
    .text { margin: 0; font-size: 17px; line-height: 1.55; color: #dfe5ff; }
    .go { justify-self: start; margin-top: 4px; color: #fff; font-weight: 700; text-decoration: none; padding: 9px 15px; border-radius: 999px; background: rgba(255, 255, 255, .12); border: 1px solid rgba(255, 255, 255, .25); font-size: 14.5px; }
    .go:hover, .go:focus-visible { background: var(--hue); }
    :host(.compact) .body { padding: 18px 18px 20px; gap: 8px; }
    :host(.compact) .emblem { width: 46px; height: 46px; border-radius: 13px; }
    :host(.compact) h3 { font-size: 21px; }
    :host(.compact) .special h3 { font-size: 17px; }
    :host(.compact) .message { font-size: 26px; }
    :host(.compact) .text { font-size: 16px; }
    /* parts arrive one after another, as the tile emerges from its puzzle piece */
    .a1, .a2, .a3, .a4, .a5 { animation: part calc(var(--tin) * .9) cubic-bezier(.2, .8, .2, 1) both; }
    .a1 { animation-name: img; animation-delay: calc(var(--tin) * .25); }
    .a2 { animation-delay: calc(var(--tin) * .45); }
    .a3 { animation-delay: calc(var(--tin) * .6); }
    .a4 { animation-delay: calc(var(--tin) * .8); }
    .a5 { animation-delay: calc(var(--tin) * 1); }
    @keyframes part { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } }
    @keyframes img { from { opacity: 0; transform: scale(1.12); filter: blur(8px) saturate(1.6); } }
    :host(.still) .a1, :host(.still) .a2, :host(.still) .a3, :host(.still) .a4, :host(.still) .a5 { animation: none; }
  `,
})
export class SchStoryCard {
  readonly piece = input.required<StoryPiece>();
  readonly step = input<string>('');
  readonly compact = input(false);
  readonly showLink = input(true);
  /** No entrance animation (admin preview, reduced motion). */
  readonly still = input(false);
  protected coverFailed = signal(false);
  protected imageFailed = signal(false);
}

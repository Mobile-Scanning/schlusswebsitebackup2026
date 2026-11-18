import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductCard } from '../core/public-api';
import { Tilt } from '../shared/interact';
import { hueStyle, productHue, TILE_PIECES } from '../shared/palette';

/**
 * Coming-soon product: an unfinished puzzle. Three pieces are in place; the last piece
 * floats outside its glowing slot and moves in as you explore the card.
 * Labels come only from real product data (status, expected release, demo availability).
 */
@Component({
  selector: 'sch-soon-card',
  imports: [RouterLink, DatePipe, Tilt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = product();
    <article class="sc" data-launch schTilt="9" [style]="style()">
      <div class="stage" data-fly [class.has-img]="!!img()" aria-hidden="true">
        @if (img()) {
          <img class="pv" [src]="img()" alt="" loading="lazy" />
          <span class="pv-tag mono">Preview</span>
        }
        <svg viewBox="-60 -40 330 300">
          <defs>
            <linearGradient [attr.id]="gid()" x1="0" y1="0" x2="1" y2="1"><stop offset="0" [attr.stop-color]="hue().glow" /><stop offset=".5" [attr.stop-color]="hue().c1" /><stop offset="1" [attr.stop-color]="hue().c2" /></linearGradient>
          </defs>
          <path class="slot" [attr.d]="pieces[3]" />
          @for (i of [0, 1, 2]; track i) { <path class="set" [attr.d]="pieces[i]" [style.--i]="i" /> }
          <g class="last"><path [attr.d]="pieces[3]" [attr.fill]="'url(#' + gid() + ')'" /></g>
        </svg>
      </div>
      <div class="info">
        <div class="labels">
          <span class="chip-status st-coming_soon">Coming soon</span>
          @if (p.expectedRelease) { <span class="chip-status launch">Launching {{ p.expectedRelease | date: 'MMM y' }}</span> }
          @if (p.demoAvailable) { <span class="chip-status st-demo_available">Early demo</span> }
        </div>
        @if (p.category) { <p class="cat mono">{{ p.category.name }}</p> }
        <h3><a [routerLink]="['/products', p.slug]" class="stretch">{{ p.name }}</a></h3>
        <p class="desc">{{ p.shortDescription || p.tagline }}</p>
        <span class="more" aria-hidden="true">Preview the product →</span>
      </div>
    </article>
  `,
  styles: `
    :host { display: block; perspective: 1000px; }
    /* entrance: previews come into focus as if being revealed */
    :host(.pre) { filter: blur(10px) saturate(.3); }
    :host(.in) { transition: opacity .6s ease, transform .6s var(--ease), filter .7s ease; transition-delay: var(--stagger, 0s); }
    .sc {
      position: relative; height: 100%; display: grid; grid-template-rows: auto 1fr; border-radius: var(--r-xl); overflow: hidden;
      background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, rgba(20,14,40,.85)), rgba(12,8,26,.92));
      border: 1px solid color-mix(in srgb, var(--accent-glow) 30%, transparent);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 50px -24px color-mix(in srgb, var(--accent) 80%, transparent);
      transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .35s var(--ease), box-shadow .3s ease;
    }
    .sc:hover, .sc:focus-within { box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 28px 60px -20px color-mix(in srgb, var(--accent) 95%, transparent); }
    .stage { height: 200px; display: grid; place-items: center; overflow: hidden; background: radial-gradient(60% 70% at 50% 55%, color-mix(in srgb, var(--accent) 35%, transparent), transparent 70%); }
    svg { height: 180px; width: auto; max-width: 100%; overflow: visible; position: relative; }
    /* With a preview image: the image gets the Coming-soon duotone and the unfinished puzzle sits in the corner */
    .stage { position: relative; }
    .pv { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: grayscale(1) contrast(1.1) brightness(.85); opacity: .9; }
    .has-img::before { content: ''; position: absolute; inset: 0; z-index: 1; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 70%, transparent), color-mix(in srgb, #2a0d4a 80%, transparent)); mix-blend-mode: color; }
    .has-img::after { content: ''; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, transparent 40%, rgba(12,8,26,.85)); }
    .has-img svg { position: absolute; z-index: 2; right: 8px; bottom: 6px; height: 104px; }
    .pv-tag { position: absolute; z-index: 2; left: 14px; top: 12px; padding: 4px 8px; border-radius: 6px; background: rgba(12,8,26,.6); color: #fff; border: 1px solid var(--accent-glow); font-size: 10px; }
    .sc:hover .pv { filter: grayscale(.2) contrast(1.05) brightness(.95); transition: filter .6s ease; }
    .set { fill: rgba(255,255,255,.1); stroke: color-mix(in srgb, var(--accent-glow) 80%, white); stroke-width: 2.5; transition: fill .4s ease; }
    .sc:hover .set { fill: rgba(255,255,255,.2); }
    .slot { fill: none; stroke: var(--accent-glow); stroke-width: 3; stroke-dasharray: 8 7; opacity: .8; }
    .sc:hover .slot { animation: dash 1.6s linear infinite; }
    .last { transform: translate(46px, 40px) rotate(24deg); transform-box: fill-box; transform-origin: center; transition: transform .9s cubic-bezier(.3,1.25,.45,1); filter: drop-shadow(0 0 14px var(--accent)); }
    .last path { stroke: rgba(255,255,255,.7); stroke-width: 2; }
    .sc:hover .last, .sc:focus-within .last { transform: translate(10px, 8px) rotate(6deg); }
    @keyframes breathe { 50% { fill: rgba(255,255,255,.18); } }
    @keyframes dash { to { stroke-dashoffset: -30; } }
    @keyframes hover { 50% { translate: 0 -6px; } }
    .info { padding: 4px 22px 22px; display: flex; flex-direction: column; gap: 6px; }
    .labels { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .chip-status { color: #fff; }
    .launch { --st: var(--accent-glow); }
    .cat { margin: 4px 0 0; color: var(--accent-glow); }
    h3 { font-size: 21px; margin: 0; }
    .stretch { color: #fff; text-decoration: none !important; }
    .stretch::after { content: ''; position: absolute; inset: 0; z-index: 2; }
    .stretch:focus-visible { outline: none; }
    .stretch:focus-visible::after { outline: 2px solid var(--accent-glow); outline-offset: -3px; border-radius: var(--r-xl); }
    .desc { margin: 0; color: rgba(230,224,255,.75); font-size: 15px; }
    .more { margin-top: auto; padding-top: 12px; font-weight: 700; color: var(--accent-glow); }
    .sc.launching .last { transform: none; transition-duration: .4s; }
    @media (prefers-reduced-motion: reduce) { .set, .slot, .last { animation: none; transition: none; } }
    :host-context(html.reduce-motion) .set, :host-context(html.reduce-motion) .slot, :host-context(html.reduce-motion) .last { animation: none; transition: none; }
  `,
})
export class SoonCard {
  readonly product = input.required<ProductCard>();
  protected pieces = TILE_PIECES;
  protected hue = computed(() => productHue(this.product()));
  protected style = computed(() => hueStyle(this.hue()));
  /** Its own Coming-soon image, else its own main image – never another product's. */
  protected img = computed(() => this.product().previewImage || this.product().image || null);
  protected gid = computed(() => 'sg-' + this.product().slug.replace(/[^a-z0-9]/gi, ''));
}

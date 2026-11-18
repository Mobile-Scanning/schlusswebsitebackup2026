import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductCard as Card, OFFERING_NAME } from '../core/public-api';
import { pricingLine, STATUS_LABEL } from '../shared/format';
import { Tilt } from '../shared/interact';
import { hueStyle, productHue, seeded, TILE_PIECES } from '../shared/palette';

/** Puzzle artwork for a product, generated from its slug so it is unique and stable. */
export function productArt(slug: string) {
  const rnd = seeded(slug);
  const n = 4 + Math.floor(rnd() * 3);
  return Array.from({ length: n }, (_, i) => ({
    d: TILE_PIECES[Math.floor(rnd() * 4)],
    x: -40 + rnd() * 300,
    y: -60 + rnd() * 170,
    r: Math.round(rnd() * 80 - 40),
    s: 0.45 + rnd() * 0.55,
    o: i === 0 ? 1 : 0.35 + rnd() * 0.45,
    hero: i === 0,
    dx: Math.round(rnd() * 24 - 12),
    dy: Math.round(rnd() * 20 - 10),
  }));
}

@Component({
  selector: 'sch-product-card',
  imports: [RouterLink, DatePipe, Tilt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = product();
    <article class="pc tab" data-launch schTilt="6" [style]="style()">
      <div class="art" data-fly [class.has-img]="!!p.image">
        @if (p.image) {
          <img class="shot" [src]="p.image" [alt]="p.name" loading="lazy" />
        } @else {
          <svg viewBox="0 0 320 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            @for (a of art(); track $index) {
              <g class="piece" [class.hero]="a.hero" [style.--dx.px]="a.dx" [style.--dy.px]="a.dy"
                 [attr.transform]="'translate(' + a.x + ' ' + a.y + ') rotate(' + a.r + ' 100 100) scale(' + a.s + ')'">
                <path [attr.d]="a.d" [attr.opacity]="a.o" />
              </g>
            }
          </svg>
          <span class="need mono">Product image to be added</span>
        }
        <div class="logo">
          @if (p.logo) { <img [src]="p.logo" [alt]="''" width="44" height="44" loading="lazy" /> }
          @else { <span>{{ initials() }}</span> }
        </div>
        <span class="chip-status" [class]="'chip-status st-' + p.status">{{ p.offeringType && p.offeringType !== 'software' && p.offeringType !== 'development' ? offeringName[p.offeringType] : statusLabel() }}</span>
      </div>
      <div class="body">
        @if (p.category) { <p class="cat mono">{{ p.category.name }}</p> }
        <h3><a [routerLink]="['/products', p.slug]" class="stretch">{{ p.name }}</a></h3>
        <p class="desc">{{ p.shortDescription || p.tagline }}</p>
        <ul class="offers" aria-label="What you can do">
          <li [class.off]="!p.demoAvailable">{{ p.demoAvailable ? 'Demo available' : 'No demo yet' }}</li>
          <li [class.off]="!trial()">{{ trial() ? p.trialDays + '-day free trial' : 'No free trial' }}</li>
        </ul>
        <dl class="facts">
          @if (p.status === 'coming_soon') {
            <div><dt>Expected</dt><dd>{{ p.expectedRelease ? (p.expectedRelease | date: 'MMMM y') : 'To be announced' }}</dd></div>
          } @else {
            <div><dt>Pricing</dt><dd>{{ price() }}</dd></div>
          }
          @if (p.version) { <div><dt>Version</dt><dd>{{ p.version }}</dd></div> }
        </dl>
        <div class="acts">
          @if (p.demoAvailable) { <a class="act" [routerLink]="['/products', p.slug]" fragment="demo">Demo</a> }
          @if (trial()) { <a class="act" [routerLink]="['/products', p.slug]" fragment="trial">Free trial</a> }
          <a class="act go" [routerLink]="['/products', p.slug]" [attr.aria-label]="'Explore ' + p.name">Explore <span class="arr" aria-hidden="true">→</span></a>
        </div>
      </div>
    </article>
  `,
  styles: `
    :host { display: block; perspective: 900px; }
    .pc {
      position: relative; margin-top: 12px; height: calc(100% - 12px); display: flex; flex-direction: column;
      border-radius: var(--r-lg); background: var(--surface); border: 1px solid var(--line);
      transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transform-style: preserve-3d;
      transition: transform .35s var(--ease), border-color .25s ease, box-shadow .3s ease, translate .3s var(--ease);
    }
    .pc:hover, .pc:focus-within { translate: 0 -5px; border-color: color-mix(in srgb, var(--accent) 60%, transparent); box-shadow: 0 22px 44px -16px color-mix(in srgb, var(--accent) 55%, transparent); }
    .art {
      position: relative; height: 170px; overflow: hidden; border-radius: var(--r-lg) var(--r-lg) 0 0;
      background:
        radial-gradient(120% 140% at var(--mx, 70%) var(--my, 20%), color-mix(in srgb, var(--accent-glow) 55%, transparent), transparent 55%),
        linear-gradient(135deg, var(--accent), var(--accent-2));
    }
    .art svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
    .piece path { fill: rgba(255,255,255,.22); stroke: rgba(255,255,255,.55); stroke-width: 2; }
    .piece.hero path { fill: rgba(255,255,255,.9); stroke: rgba(255,255,255,1); }
    .piece { transition: translate .6s cubic-bezier(.3,1.3,.45,1); }
    .pc:hover .piece { translate: var(--dx) var(--dy); }
    .pc:hover .piece.hero { translate: 0 -6px; }
    .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--r-lg) var(--r-lg) 0 0; transition: transform .6s var(--ease); }
    .pc:hover .shot { transform: scale(1.05); }
    .has-img::after { content: ''; position: absolute; inset: 0; border-radius: var(--r-lg) var(--r-lg) 0 0; background: linear-gradient(180deg, transparent 45%, color-mix(in srgb, var(--accent-2) 55%, transparent)); pointer-events: none; }
    .need { position: absolute; left: 50%; top: 46%; translate: -50% -50%; padding: 6px 10px; border-radius: 6px; background: rgba(10,12,20,.55); color: #fff; font-size: 10px; border: 1px dashed rgba(255,255,255,.6); white-space: nowrap; }
    .logo {
      position: absolute; left: 18px; bottom: -22px; width: 56px; height: 56px; border-radius: 14px;
      display: grid; place-items: center; overflow: hidden; background: var(--surface); border: 3px solid var(--surface);
      box-shadow: 0 8px 18px rgba(0,0,0,.25); font: 700 18px var(--f-head); color: var(--accent); z-index: 1;
    }
    .art { overflow: visible; }
    .art svg { border-radius: var(--r-lg) var(--r-lg) 0 0; overflow: hidden; }
    .logo img { width: 100%; height: 100%; object-fit: cover; }
    .chip-status { position: absolute; right: 14px; top: 14px; background: rgba(10,12,20,.45); color: #fff; backdrop-filter: blur(6px); }
    .body { display: flex; flex-direction: column; gap: 6px; padding: 34px 22px 22px; flex: 1; }
    .cat { margin: 0; color: var(--accent); }
    :host-context(.theme-site:not(.zone-porcelain)) .cat { color: var(--accent-glow); }
    h3 { font-size: 20px; margin: 0; }
    .stretch { color: var(--heading); text-decoration: none !important; }
    .stretch::after { content: ''; position: absolute; inset: 0; z-index: 2; }
    .stretch:focus-visible { outline: none; }
    .stretch:focus-visible::after { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-lg); }
    .desc { margin: 2px 0 4px; color: var(--muted); font-size: 15px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .extra { margin: 0; font-size: 14px; color: var(--fg); max-height: 0; opacity: 0; overflow: hidden; transition: max-height .35s var(--ease), opacity .3s ease; }
    .pc:hover .extra, .pc:focus-within .extra { max-height: 60px; opacity: 1; }
    .offers { list-style: none; padding: 0; margin: 4px 0 6px; display: flex; flex-wrap: wrap; gap: 6px; }
    .offers li { font: 500 11px var(--f-mono); letter-spacing: .05em; text-transform: uppercase; padding: 4px 8px; border-radius: 6px; color: var(--heading); background: color-mix(in srgb, var(--accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
    .offers li::before { content: '✓ '; color: var(--accent); }
    .offers li.off { opacity: .55; background: transparent; border-style: dashed; }
    .offers li.off::before { content: '– '; }
    .facts { margin: auto 0 0; display: grid; gap: 6px; font-size: 14px; border-top: 1px solid var(--line); padding-top: 14px; }
    .facts div { display: flex; justify-content: space-between; gap: 12px; }
    dt { color: var(--muted); } dd { margin: 0; text-align: right; font-weight: 600; color: var(--heading); font-variant-numeric: tabular-nums; }
    .acts { position: relative; z-index: 3; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .act { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 9px; font-weight: 700; font-size: 14px; color: var(--heading); text-decoration: none !important; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); background: color-mix(in srgb, var(--accent) 10%, transparent); transition: background .2s, transform .25s cubic-bezier(.3,1.3,.45,1); }
    .act:hover { background: color-mix(in srgb, var(--accent) 26%, transparent); transform: translateY(-2px); }
    .act.go { margin-left: auto; background: linear-gradient(110deg, var(--accent), var(--accent-2)); color: #fff; border-color: transparent; }
    .arr { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-size: 14px; transition: transform .3s cubic-bezier(.3,1.3,.45,1); }
    .act.go .arr { background: rgba(255,255,255,.25); width: 20px; height: 20px; }
    .pc:hover .arr { transform: translateX(4px); }
    /* launched (clicked): the tile lifts and turns as the puzzle transition begins */
    .pc.launching { animation: launch .6s cubic-bezier(.3,1.2,.45,1); }
    @keyframes launch { 40% { transform: translateY(-14px) rotateZ(-2deg) scale(1.03); } }
    @media (prefers-reduced-motion: reduce) { .pc, .piece, .extra { transition: none; } .pc.launching { animation: none; } }
    :host-context(html.reduce-motion) .pc, :host-context(html.reduce-motion) .piece { transition: none; animation: none; }
  `,
})
export class ProductCardComponent {
  readonly product = input.required<Card>();
  /** Kept for template compatibility (older callers pass an index). */
  readonly accent = input(0);
  protected hue = computed(() => productHue(this.product()));
  protected style = computed(() => hueStyle(this.hue()));
  protected art = computed(() => productArt(this.product().slug));
  protected statusLabel = computed(() => STATUS_LABEL[this.product().status]);
  protected offeringName = OFFERING_NAME;
  protected price = computed(() => pricingLine(this.product().pricing));
  /** A free trial is offered when the product has trial days and can be trialled now. */
  protected trial = computed(() => !!this.product().trialDays && ['available', 'demo_available', 'beta'].includes(this.product().status));
  protected initials = computed(() =>
    this.product()
      .name.replace(/^sample\s+/i, '')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase(),
  );
}

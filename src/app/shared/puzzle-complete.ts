import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HUES, HueKey, TILE_PIECES } from './palette';

/**
 * Success state: four pieces glide in and lock into a complete puzzle with a check mark.
 * Only ever shown after the server has confirmed the action (a reference number exists),
 * so it never celebrates something that didn't happen.
 */
@Component({
  selector: 'sch-puzzle-complete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pc" [style.--h1]="h().c1" [style.--h2]="h().c2" [style.--hg]="h().glow" role="img" [attr.aria-label]="label()">
      <svg viewBox="-10 -10 220 220" aria-hidden="true">
        <defs>
          <linearGradient id="pcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" [attr.stop-color]="h().glow" /><stop offset=".5" [attr.stop-color]="h().c1" /><stop offset="1" [attr.stop-color]="h().c2" /></linearGradient>
          <linearGradient id="pcs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F6FA" /><stop offset="1" stop-color="#A9B1BF" /></linearGradient>
        </defs>
        @for (d of pieces; track $index) {
          <path [attr.d]="d" [class]="'p p' + $index" [attr.fill]="$index === 3 ? 'url(#pcg)' : 'url(#pcs)'" />
        }
        <path class="tick" d="M62 104 L90 132 L142 76" />
      </svg>
    </div>
  `,
  styles: `
    :host { display: inline-block; }
    .pc { width: var(--size, 76px); height: var(--size, 76px); filter: drop-shadow(0 10px 18px color-mix(in srgb, var(--h1) 45%, transparent)); }
    svg { width: 100%; height: 100%; overflow: visible; }
    .p { stroke: rgba(10,12,20,.6); stroke-width: 3; transform-box: fill-box; transform-origin: center; }
    .p0 { animation: a0 .6s cubic-bezier(.3,1.3,.45,1) both; }
    .p1 { animation: a1 .6s cubic-bezier(.3,1.3,.45,1) .08s both; }
    .p2 { animation: a2 .6s cubic-bezier(.3,1.3,.45,1) .16s both; }
    .p3 { animation: a3 .8s cubic-bezier(.3,1.4,.45,1) .32s both; }
    .tick { fill: none; stroke: #fff; stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 140; stroke-dashoffset: 140; animation: tick .4s ease-out .9s forwards; }
    @keyframes a0 { from { transform: translate(-40px,-30px) rotate(-30deg); opacity: 0; } }
    @keyframes a1 { from { transform: translate(40px,-34px) rotate(26deg); opacity: 0; } }
    @keyframes a2 { from { transform: translate(-36px,40px) rotate(20deg); opacity: 0; } }
    @keyframes a3 { from { transform: translate(60px,56px) rotate(45deg) scale(.6); opacity: 0; } }
    @keyframes tick { to { stroke-dashoffset: 0; } }
    @media (prefers-reduced-motion: reduce) { .p, .tick { animation: none !important; stroke-dashoffset: 0; } }
    :host-context(html.reduce-motion) .p, :host-context(html.reduce-motion) .tick { animation: none !important; stroke-dashoffset: 0; }
  `,
})
export class SchPuzzleComplete {
  readonly hue = input<HueKey>('blue');
  readonly label = input('Completed');
  protected pieces = TILE_PIECES;
  protected h = () => HUES[this.hue()];
}

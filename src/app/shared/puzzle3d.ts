import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { PIECES } from './brand';

/** Depth layers per piece: stacked copies of the logo shape give each piece a real extruded edge. */
const DEPTH = Array.from({ length: 13 }, (_, i) => i);

/** Side colour, top fill and top edge for each piece – silver, graphite, frosted glass, SCHLUSS blue. */
const MATERIALS = {
  brand: [
    { side: '#6F7887', top: 'url(#sch-gA)', edge: '#F7F9FC' },
    { side: '#0C0F14', top: 'url(#sch-gB)', edge: '#4A5466' },
    { side: '#3A4A64', top: 'url(#sch-gC)', edge: '#DCE8FD' },
    { side: '#153E8A', top: 'url(#sch-gD)', edge: '#DCE8FD' },
  ],
  /** Colourful set: teal glass, violet metal, amber, and SCHLUSS Blue as the last piece. */
  spectrum: [
    { side: '#08707A', top: 'url(#sch-sA)', edge: '#BFFBF3' },
    { side: '#3A2394', top: 'url(#sch-sB)', edge: '#DCD3FF' },
    { side: '#B5531A', top: 'url(#sch-sC)', edge: '#FFE7B8' },
    { side: '#153E8A', top: 'url(#sch-gD)', edge: '#DCE8FD' },
  ],
};

/**
 * The SCHLUSS signature visual: the four pieces of the official mark, made dimensional.
 * Pure CSS 3D + SVG (no 3D library). Renders on the server; the assembly animation
 * plays once in the browser and is skipped for reduced motion.
 */
@Component({
  selector: 'sch-puzzle3d',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage" [style.--P.px]="size()" [class.small]="size() < 200">
      <div class="glow" aria-hidden="true"></div>
      <div class="world" [class.go]="play()" [class.idle]="idle()" aria-hidden="true">
        <svg width="0" height="0" class="defs" focusable="false">
          <defs>
            <linearGradient id="sch-gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2F5F9" /><stop offset="1" stop-color="#9AA3B2" /></linearGradient>
            <linearGradient id="sch-gB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A4352" /><stop offset="1" stop-color="#151A22" /></linearGradient>
            <linearGradient id="sch-gC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B8C6DC" stop-opacity=".95" /><stop offset="1" stop-color="#46587A" stop-opacity=".95" /></linearGradient>
            <linearGradient id="sch-gD" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8BBEFF" /><stop offset=".55" stop-color="#3282F6" /><stop offset="1" stop-color="#153E8A" /></linearGradient>
            <linearGradient id="sch-sA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9FF7EC" stop-opacity=".95" /><stop offset=".5" stop-color="#14C2B0" stop-opacity=".95" /><stop offset="1" stop-color="#0A7C8E" /></linearGradient>
            <linearGradient id="sch-sB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C9BCFF" /><stop offset=".5" stop-color="#7B5CFF" /><stop offset="1" stop-color="#3B22A8" /></linearGradient>
            <linearGradient id="sch-sC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE29A" /><stop offset=".5" stop-color="#FFB020" /><stop offset="1" stop-color="#FF7A2F" /></linearGradient>
          </defs>
        </svg>
        @for (d of pieces; track $index; let k = $index) {
          <div class="piece" [class]="'piece p' + k">
            @for (i of depth; track i) {
              <div class="lyr" [style.--i]="i">
                <svg viewBox="-4 -4 208 208" focusable="false">
                  <path [attr.d]="d" [attr.fill]="$last ? mat()[k].top : mat()[k].side" [attr.stroke]="$last ? mat()[k].edge : '#07090D'"
                        [attr.stroke-width]="$last ? 1.2 : 3" [attr.stroke-opacity]="$last ? 0.7 : 1" stroke-linejoin="round" />
                </svg>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .stage { position: relative; width: calc(var(--P) * 1.45); height: calc(var(--P) * 1.3); max-width: 100%; margin-inline: auto; perspective: 1400px; display: grid; place-items: center; }
    .glow { position: absolute; width: calc(var(--P) * 1.3); height: calc(var(--P) * 1.3); border-radius: 50%; background: radial-gradient(circle, rgba(50,130,246,.32), transparent 62%); filter: blur(8px); }
    .defs { position: absolute; }
    .world { position: relative; width: var(--P); height: var(--P); transform-style: preserve-3d; transform: rotateX(54deg) rotateZ(-32deg); }
    .world.idle { animation: sway 9s ease-in-out 3.4s infinite alternate; }
    .piece { position: absolute; inset: 0; transform-style: preserve-3d; }
    .lyr { position: absolute; inset: 0; transform: translateZ(calc(var(--i) * var(--P) / 170)); }
    .lyr svg { width: 100%; height: 100%; overflow: visible; display: block; }
    .p0 { --dl: .05s; } .p1 { --dl: .15s; } .p2 { --dl: .25s; } .p3 { --dl: .5s; }
    .go .p0 { animation: inA .6s var(--ease) var(--dl) both; }
    .go .p1 { animation: inB .6s var(--ease) var(--dl) both; }
    .go .p2 { animation: inC .6s var(--ease) var(--dl) both; }
    .go .p3 { animation: seat .8s var(--seat) var(--dl) both; }
    /* Opacity lives on the leaf layers: opacity on a preserve-3d parent would flatten the piece. */
    .go .lyr { animation: fade .3s linear var(--dl) both; }
    .stage:has(.go) .glow { animation: lit .6s var(--ease) 1.1s both; }
    @keyframes fade { from { opacity: 0; } }
    @keyframes lit { from { opacity: 0; } }
    @keyframes inA { from { transform: translate3d(-35%, -30%, 90px) rotateZ(-18deg); } }
    @keyframes inB { from { transform: translate3d(38%, -34%, 120px) rotateZ(16deg); } }
    @keyframes inC { from { transform: translate3d(-38%, 34%, 110px) rotateZ(14deg); } }
    @keyframes seat { 0% { transform: translate3d(55%, 52%, 220px) rotateZ(38deg) rotateY(-30deg); } 70% { transform: translate3d(0, 0, 26px) rotateZ(-2deg); } 100% { transform: none; } }
    @keyframes sway { from { transform: rotateX(54deg) rotateZ(-32deg); } to { transform: rotateX(48deg) rotateZ(-14deg); } }
    @media (prefers-reduced-motion: reduce) { .world, .piece, .lyr, .glow { animation: none !important; } }
    :host-context(html.reduce-motion) .world, :host-context(html.reduce-motion) .piece, :host-context(html.reduce-motion) .lyr, :host-context(html.reduce-motion) .glow { animation: none !important; }
  `,
})
export class SchPuzzle3d {
  /** Edge length of the assembled puzzle in px. */
  readonly size = input(260);
  /** Play the assembly once (hero). Without it the puzzle shows complete. */
  readonly assemble = input(false);
  /** Play the assembly only the first time per visit (e.g. 'home' – the logo introduction). */
  readonly introKey = input('');
  /** Slow sway after assembly. */
  readonly idle = input(false);
  protected readonly pieces = PIECES;
  /** 'spectrum' = colourful pieces (website), 'brand' = silver/graphite/glass (formal). */
  readonly look = input<'spectrum' | 'brand'>('spectrum');
  protected readonly mat = () => MATERIALS[this.look()];
  protected readonly depth = DEPTH;
  protected play = signal(false);

  constructor() {
    // Start the assembly only in the browser, so server-rendered HTML shows the finished puzzle.
    if (typeof window !== 'undefined')
      queueMicrotask(() => {
        if (!this.assemble()) return;
        const key = this.introKey() ? 'sch-intro-' + this.introKey() : '';
        try {
          if (key && sessionStorage.getItem(key)) return; // already seen in this visit – show it complete
          if (key) sessionStorage.setItem(key, '1');
        } catch {
          /* storage blocked – just play */
        }
        this.play.set(true);
      });
  }
}

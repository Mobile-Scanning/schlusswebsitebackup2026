import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, input, ElementRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { MotionService } from '../core/motion.service';
import { PIECES } from './brand';

/* Home page welcome (v12.8) – professional two-column hero on the living SCHLUSS puzzle grid.
 * Left (projected): headline, introduction, buttons. Right: the "hub" – the four logo pieces fly together (blue SCHLUSS
 * piece last), orbit rings turn, and when it locks a soft wave runs across the grid and the industry pieces light up
 * around it, each connected to the centre. A brand-colour spotlight follows the mouse over the grid.
 * Plain CSS animation in the server HTML, so it starts on first paint. Click the logo to replay.
 * Reduced motion: everything shown finished and still. */

const TILE = 'M0 0 L41 0 L41 8 A15 15 0 1 0 59 8 L59 0 L100 0 L100 41 L108 41 A15 15 0 1 1 108 59 L100 59 L100 100 L59 100 L59 108 A15 15 0 1 1 41 108 L41 100 L0 100 L0 59 L8 59 A15 15 0 1 0 8 41 L0 41 Z';
const GRID = 'M0 0 L0 41 L8 41 A15 15 0 1 1 8 59 L0 59 L0 100 M0 0 L41 0 L41 8 A15 15 0 1 0 59 8 L59 0 L100 0';
const COLOURS = ['#3282f6', '#3282f6', '#7b5cff', '#14c2b0', '#38bdf8', '#ffb020'];
const CELL = 100;
const PAD = 48;
const NS = 'http://www.w3.org/2000/svg';
/** The first visit's animation started on first paint (server HTML); later visits start when the page is created. */
let firstView = true;

@Component({
  selector: 'sch-home-lockup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.play]': 'playing()', '[class.snapped]': 'snapped()', '[class.still]': 'motion.reduced()' },
  template: `
    <div class="glow" aria-hidden="true"><i class="g1"></i><i class="g2"></i><i class="g3"></i></div>
    <div class="bgfx" #bg aria-hidden="true">
      <svg class="layer base">
        <defs><pattern id="hl-grid" width="100" height="100" patternUnits="userSpaceOnUse"><path [attr.d]="grid" fill="none" stroke-width="1.2" stroke-linejoin="round" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#hl-grid)" />
      </svg>
      <div class="tiles" #tiles></div>
      <div class="layer hi"></div>
      <div class="layer wave"></div>
    </div>
    <div class="vignette" aria-hidden="true"></div>

    <div class="wrap-in">
      <div class="copy"><ng-content /></div>

      <div class="visual">
        <div class="hub">
          <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            @for (c of placed(); track c.k) { <line x1="50" y1="50" [attr.x2]="c.x" [attr.y2]="c.y" [style.--c]="c.c" [style.--k]="c.k" /> }
          </svg>
          <span class="orbit o1" aria-hidden="true"></span><span class="orbit o2" aria-hidden="true"></span>
          <span class="halo" aria-hidden="true"></span>
          <button type="button" class="mark-btn" #mark (click)="replay()" aria-label="Replay the SCHLUSS logo animation" title="Play again">
            <svg class="mark" viewBox="-4 -4 208 208" aria-hidden="true">
              @for (d of pieces; track $index) { <path [attr.d]="d" [class]="'p p' + ($index + 1)" /> }
            </svg>
            <span class="ring"></span>
          </button>
          <ul class="hchips" aria-label="Industries SCHLUSS connects">
            @for (c of placed(); track c.k) {
              <li class="hchip" [class.side-r]="c.x > 80" [class.side-l]="c.x < 20" [style.left.%]="c.x" [style.top.%]="c.y" [style.--c]="c.c" [style.--k]="c.k">
                <span class="bob"><svg viewBox="-14 -14 136 136" aria-hidden="true"><path [attr.d]="tile" /></svg>{{ c.name }}</span>
              </li>
            }
          </ul>
        </div>
        <p class="caption"><strong>SCHLUSS</strong> · The final piece that brings it all together.</p>
      </div>
    </div>
  `,
  styles: `
    @property --r { syntax: '<length>'; inherits: false; initial-value: 0px; }
    :host {
      --gridmask: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%3E%3Cpath%20d%3D%22M0%200%20L0%2041%20L8%2041%20A15%2015%200%201%201%208%2059%20L0%2059%20L0%20100%20M0%200%20L41%200%20L41%208%20A15%2015%200%201%200%2059%208%20L59%200%20L100%200%22%20fill%3D%22none%22%20stroke%3D%22%23000%22%20stroke-width%3D%221.6%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E"); --bg: #080b16;
      position: relative; isolation: isolate; overflow: hidden; display: grid; background: var(--bg); color: #e9eef7;
      min-height: max(600px, calc(100svh - var(--header-h, 72px)));
    }
    .glow { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
    .glow i { position: absolute; border-radius: 50%; filter: blur(80px); animation: float 24s ease-in-out infinite alternate; }
    .g1 { width: 48vmax; height: 48vmax; background: #3282f6; right: -8vmax; top: -14vmax; opacity: .26; }
    .g2 { width: 40vmax; height: 40vmax; background: #7b5cff; left: -16vmax; bottom: -22vmax; opacity: .22; animation-delay: -8s !important; }
    .g3 { width: 26vmax; height: 26vmax; background: #14c2b0; right: 18%; bottom: -14vmax; opacity: .14; animation-delay: -15s !important; }
    @keyframes float { to { transform: translate(5vmax, 3vmax) scale(1.1); } }

    .bgfx { position: absolute; inset: -48px; z-index: 0; pointer-events: none; transform: translate3d(var(--px, 0px), var(--py, 0px), 0); transition: transform .6s cubic-bezier(.2,.7,.2,1); }
    .layer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .base path { stroke: rgba(160, 180, 230, .07); }
    .hi, .wave {
      background: linear-gradient(120deg, #3282f6, #7b5cff 45%, #14c2b0 80%, #3282f6);
      background-size: 200% 200%; animation: hue 16s ease-in-out infinite alternate;
      -webkit-mask-composite: source-in; mask-composite: intersect; -webkit-mask-repeat: no-repeat, repeat; mask-repeat: no-repeat, repeat;
      -webkit-mask-size: 100% 100%, 100px 100px; mask-size: 100% 100%, 100px 100px;
    }
    .hi {
      opacity: .75;
      -webkit-mask-image: radial-gradient(circle 300px at var(--mx, 70%) var(--my, 45%), #000 0%, rgba(0,0,0,.45) 42%, transparent 72%), var(--gridmask);
              mask-image: radial-gradient(circle 300px at var(--mx, 70%) var(--my, 45%), #000 0%, rgba(0,0,0,.45) 42%, transparent 72%), var(--gridmask);
    }
    .wave {
      opacity: 0;
      -webkit-mask-image: radial-gradient(circle at var(--cx, 70%) var(--cy, 45%), transparent calc(var(--r) - 170px), #000 calc(var(--r) - 24px), transparent var(--r)), var(--gridmask);
              mask-image: radial-gradient(circle at var(--cx, 70%) var(--cy, 45%), transparent calc(var(--r) - 170px), #000 calc(var(--r) - 24px), transparent var(--r)), var(--gridmask);
    }
    @keyframes hue { to { background-position: 100% 100%; } }
    .tiles { position: absolute; inset: 0; }
    :host ::ng-deep .hl-tile { position: absolute; width: 136px; height: 136px; overflow: visible; opacity: 0; animation: hl-tile 2.8s ease forwards; }
    :host ::ng-deep .hl-tile path { fill: var(--c); }
    @keyframes hl-tile { 0% { opacity: 0; transform: translate(14px, 14px) scale(.9); } 22% { opacity: .22; transform: none; } 34% { opacity: .26; } 100% { opacity: 0; transform: none; } }
    .vignette { position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background: linear-gradient(90deg, color-mix(in srgb, var(--bg) 70%, transparent), transparent 55%), radial-gradient(ellipse 80% 75% at 60% 45%, transparent 45%, color-mix(in srgb, var(--bg) 85%, transparent) 100%); }

    /* Layout */
    .wrap-in { position: relative; z-index: 1; width: 100%; max-width: 1280px; margin: 0 auto; box-sizing: border-box; padding: clamp(40px, 7vh, 88px) var(--gutter, 20px);
      display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); align-items: center; gap: clamp(28px, 4vw, 64px); }
    .copy { min-width: 0; }
    .visual { min-width: 0; display: grid; justify-items: center; gap: 18px; }
    @media (max-width: 900px) {
      .wrap-in { grid-template-columns: minmax(0, 1fr); text-align: center; padding-top: 36px; }
      .visual { order: -1; }
    }

    /* The hub */
    .hub { position: relative; width: min(100%, 540px); aspect-ratio: 1; }
    .links { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .links line { stroke: var(--c); stroke-width: .35; stroke-dasharray: 1.2 1.6; opacity: .55; vector-effect: none; }
    .orbit { position: absolute; border-radius: 50%; pointer-events: none; }
    .o1 { inset: 17%; border: 1px dashed rgba(150, 175, 255, .28); animation: turn 60s linear infinite; }
    .o2 { inset: 4%; border: 1px solid rgba(150, 175, 255, .12); }
    .o1::after { content: ''; position: absolute; top: -4px; left: 50%; width: 8px; height: 8px; border-radius: 50%; background: #3282f6; box-shadow: 0 0 12px #3282f6; }
    @keyframes turn { to { rotate: 360deg; } }
    .halo { position: absolute; inset: 30%; border-radius: 50%; background: radial-gradient(circle, rgba(50, 130, 246, .55), rgba(123, 92, 255, .18) 55%, transparent 72%); filter: blur(10px); }
    .mark-btn { appearance: none; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; position: absolute; left: 32%; top: 32%; width: 36%; height: 36%; border-radius: 18%; color: inherit; }
    .mark-btn:focus-visible { outline: 2px solid #3282f6; outline-offset: 10px; }
    .mark { width: 100%; height: 100%; display: block; overflow: visible; filter: drop-shadow(0 18px 40px rgba(8, 11, 22, .6)); }
    .p { transform-box: fill-box; transform-origin: center; stroke: var(--bg); stroke-width: 6; stroke-linejoin: round; }
    .p1 { fill: #eef1f6; } .p2 { fill: #c9d6f2; } .p3 { fill: #dbe3f4; } .p4 { fill: #3282f6; }
    .ring { position: absolute; inset: -6%; border-radius: 22%; border: 2px solid #3282f6; opacity: 0; pointer-events: none; box-shadow: 0 0 24px #3282f6; }

    .hchips { list-style: none; margin: 0; padding: 0; }
    .hchip { position: absolute; translate: -50% -50%; z-index: 2; }
    .hchip.side-r { translate: calc(-100% + 34px) -50%; }
    .hchip.side-l { translate: -34px -50%; }
    .bob { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px 8px 10px; border-radius: 999px; white-space: nowrap;
      font: 600 clamp(12px, 1.05vw, 14px)/1 var(--f-text); color: #eef1f6; letter-spacing: .01em;
      background: rgba(14, 19, 38, .72); border: 1px solid color-mix(in srgb, var(--c) 45%, rgba(255,255,255,.08));
      box-shadow: 0 10px 30px -12px color-mix(in srgb, var(--c) 70%, transparent), inset 0 1px 0 rgba(255,255,255,.06);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); transition: transform .3s cubic-bezier(.3,1.3,.45,1), border-color .3s; }
    .hchip:hover .bob { transform: translateY(-3px) scale(1.04); border-color: var(--c); }
    .bob svg { width: 16px; height: 16px; overflow: visible; flex-shrink: 0; }
    .bob path { fill: var(--c); }

    .caption { margin: 0; font: 500 13px/1.4 var(--f-head); letter-spacing: .14em; text-transform: uppercase; color: #8e97b8; text-align: center; }
    .caption strong { color: #e9eef7; font-weight: 700; }
    @media (max-width: 560px) { .hub { width: min(100%, 360px); } .bob { padding: 6px 10px 6px 8px; font-size: 11.5px; } .caption { font-size: 11.5px; letter-spacing: .1em; } }

    @media (prefers-reduced-motion: no-preference) {
      :host(.play:not(.still)) .copy { animation: fade .8s cubic-bezier(.2,.8,.2,1) .05s both; }
      :host(.play:not(.still)) .orbit, :host(.play:not(.still)) .halo { animation: zoom 1.2s cubic-bezier(.2,.8,.2,1) both; }
      :host(.play:not(.still)) .o1 { animation: zoom 1.2s cubic-bezier(.2,.8,.2,1) both, turn 60s linear infinite; }
      :host(.play:not(.still)) .p1 { animation: in1 .9s cubic-bezier(.2,.8,.2,1) .15s both; }
      :host(.play:not(.still)) .p2 { animation: in2 .9s cubic-bezier(.2,.8,.2,1) .3s both; }
      :host(.play:not(.still)) .p3 { animation: in3 .9s cubic-bezier(.2,.8,.2,1) .45s both; }
      :host(.play:not(.still)) .p4 { animation: in4 1.3s cubic-bezier(.3,.7,.2,1) .65s both; }
      :host(.play:not(.still)) .links line { animation: draw .7s ease calc(1.95s + var(--k) * .1s) both; }
      :host(.play:not(.still)) .hchip { animation: pop .6s cubic-bezier(.2,1.4,.4,1) calc(2s + var(--k) * .1s) both; }
      :host(.play:not(.still)) .caption { animation: fade .8s ease 2.4s both; }
      :host(:not(.still)) .bob { animation: bob 6s ease-in-out calc(var(--k) * -1s) infinite; }
      :host(:not(.still)) .links line { stroke-dashoffset: 0; }
      :host(.snapped:not(.still)) .mark { animation: click .42s ease; }
      :host(.snapped:not(.still)) .ring { animation: ring 1.15s cubic-bezier(.2,.7,.2,1); }
      :host(.snapped:not(.still)) .wave { animation: wave 2s cubic-bezier(.25,.7,.25,1) forwards, hue 16s ease-in-out infinite alternate; }
    }
    :host(.still) .glow i, :host(.still) .hi, :host(.still) .bgfx, :host(.still) .o1 { animation: none; transition: none; }
    @keyframes fade { 0% { opacity: 0; transform: translateY(14px); } 100% { opacity: 1; transform: none; } }
    @keyframes zoom { 0% { opacity: 0; transform: scale(.7); } 100% { opacity: 1; transform: none; } }
    @keyframes draw { 0% { opacity: 0; } 100% { opacity: .55; } }
    @keyframes pop { 0% { opacity: 0; scale: .5; } 100% { opacity: 1; scale: 1; } }
    @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    @keyframes in1 { 0% { transform: translate(-90px, -70px) rotate(-28deg) scale(.7); opacity: 0; } 55% { opacity: 1; } 100% { transform: none; opacity: 1; } }
    @keyframes in2 { 0% { transform: translate(95px, -85px) rotate(24deg) scale(.7); opacity: 0; } 55% { opacity: 1; } 100% { transform: none; opacity: 1; } }
    @keyframes in3 { 0% { transform: translate(-85px, 95px) rotate(20deg) scale(.7); opacity: 0; } 55% { opacity: 1; } 100% { transform: none; opacity: 1; } }
    @keyframes in4 { 0% { transform: translate(170px, 140px) rotate(38deg) scale(.6); opacity: 0; } 50% { transform: translate(30px, 26px) rotate(-4deg) scale(1); opacity: 1; } 78% { transform: translate(30px, 26px) rotate(0deg); opacity: 1; } 91% { transform: translate(-3px, -3px); } 100% { transform: none; opacity: 1; } }
    @keyframes click { 0% { transform: scale(1); } 35% { transform: scale(.95); } 70% { transform: scale(1.035); } 100% { transform: scale(1); } }
    @keyframes ring { 0% { opacity: .9; transform: scale(.9); } 100% { opacity: 0; transform: scale(1.9); } }
    @keyframes wave { 0% { --r: 0px; opacity: .8; } 75% { opacity: .6; } 100% { --r: 170vmax; opacity: 0; } }
  `,
})
export class SchHomeLockup {
  protected readonly motion = inject(MotionService);
  protected readonly pieces = PIECES;
  protected readonly tile = TILE;
  /** Industries shown around the hub (up to six). */
  readonly chips = input<{ name: string; c: string }[]>([]);
  protected readonly placed = computed(() => this.chips().slice(0, 6).map((c, k, all) => {
    const a = (-90 + (k * 360) / all.length + (all.length % 2 ? 0 : 30)) * (Math.PI / 180);
    return { k, name: c.name.split(' & ')[0], c: c.c, x: Math.round(50 + 42 * Math.cos(a)), y: Math.round(50 + 45 * Math.sin(a)) };
  }));
  protected readonly grid = GRID;
  protected readonly playing = signal(true);
  protected readonly snapped = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly bg = viewChild.required<ElementRef<HTMLElement>>('bg');
  private readonly tiles = viewChild.required<ElementRef<HTMLElement>>('tiles');
  private readonly mark = viewChild.required<ElementRef<HTMLElement>>('mark');
  private snapTimer?: ReturnType<typeof setTimeout>;
  private visible = true;

  constructor() {
    const destroyRef = inject(DestroyRef);
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => {
      const host = this.host.nativeElement as HTMLElement;
      const reduced = () => this.motion.reduced();
      const delay = firstView ? Math.max(150, 1850 - performance.now()) : 1850;
      firstView = false;
      if (!reduced()) this.snapTimer = setTimeout(() => this.snap(), delay);

      // spotlight + gentle parallax that follow the pointer; drift slowly by themselves when the pointer is still
      let lastMove = 0;
      let raf = 0;
      const aim = (x: number, y: number) => {
        const r = host.getBoundingClientRect();
        const bg = this.bg().nativeElement;
        bg.style.setProperty('--mx', x + PAD + 'px');
        bg.style.setProperty('--my', y + PAD + 'px');
        if (!reduced()) {
          bg.style.setProperty('--px', (x / r.width - 0.5) * -20 + 'px');
          bg.style.setProperty('--py', (y / r.height - 0.5) * -20 + 'px');
        }
      };
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        lastMove = performance.now();
        aim(e.clientX - r.left, e.clientY - r.top);
      };
      host.addEventListener('pointermove', onMove, { passive: true });
      const drift = (t: number) => {
        raf = 0;
        if (!this.visible || document.hidden || reduced()) return;
        if (performance.now() - lastMove > 2500) {
          const r = host.getBoundingClientRect();
          aim(r.width * (0.5 + 0.32 * Math.sin(t / 4200)), r.height * (0.45 + 0.28 * Math.sin(t / 3100 + 1)));
        }
        raf = requestAnimationFrame(drift);
      };
      const startDrift = () => { if (!raf && this.visible && !reduced()) raf = requestAnimationFrame(drift); };
      if (reduced()) { const r = host.getBoundingClientRect(); aim(r.width / 2, r.height * 0.42); }
      startDrift();

      // only animate while the welcome is on screen
      const io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; startDrift(); });
      io.observe(host);
      const onVis = () => startDrift();
      document.addEventListener('visibilitychange', onVis);

      // coloured pieces quietly clicking into place across the grid
      const ambient = setInterval(() => {
        if (!this.visible || document.hidden || reduced() || this.tiles().nativeElement.childElementCount > 6) return;
        const r = host.getBoundingClientRect();
        const cols = Math.ceil((r.width + PAD * 2) / CELL);
        const rows = Math.ceil((r.height + PAD * 2) / CELL);
        this.spawn(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows), 0);
      }, 1100);

      destroyRef.onDestroy(() => {
        host.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVis);
        io.disconnect();
        clearInterval(ambient);
        clearTimeout(this.snapTimer);
        if (raf) cancelAnimationFrame(raf);
      });
    });
  }

  /** Click the logo: play it all again (no page reload). */
  protected replay(): void {
    if (this.motion.reduced()) return;
    const host = this.host.nativeElement as HTMLElement;
    this.playing.set(false);
    this.snapped.set(false);
    host.classList.remove('play', 'snapped');
    void host.offsetWidth; // restart the CSS animations
    host.classList.add('play');
    this.playing.set(true);
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snap(), 1850);
  }

  /** The last piece locks in: ring, colour shockwave across the grid and a burst of coloured pieces. */
  private snap(): void {
    const host = this.host.nativeElement as HTMLElement;
    const bg = this.bg().nativeElement;
    const m = this.mark().nativeElement.getBoundingClientRect();
    const b = bg.getBoundingClientRect();
    const cx = m.left + m.width / 2 - b.left;
    const cy = m.top + m.height / 2 - b.top;
    bg.style.setProperty('--cx', cx + 'px');
    bg.style.setProperty('--cy', cy + 'px');
    host.classList.remove('snapped');
    void host.offsetWidth;
    host.classList.add('snapped');
    this.snapped.set(true);
    const c0 = Math.floor(cx / CELL);
    const r0 = Math.floor(cy / CELL);
    for (let n = 0; n < 11; n++) {
      const dc = Math.round((Math.random() - 0.5) * 9);
      const dr = Math.round((Math.random() - 0.5) * 5);
      this.spawn(c0 + dc, r0 + dr, 120 + Math.sqrt(dc * dc + dr * dr) * 140);
    }
  }

  private spawn(col: number, row: number, delay: number): void {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 136 136');
    s.setAttribute('class', 'hl-tile');
    s.style.left = col * CELL + 'px';
    s.style.top = row * CELL + 'px';
    s.style.animationDelay = delay + 'ms';
    s.style.setProperty('--c', COLOURS[Math.floor(Math.random() * COLOURS.length)]);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', TILE);
    s.appendChild(p);
    this.tiles().nativeElement.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }
}

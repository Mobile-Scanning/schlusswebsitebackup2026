import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, PLATFORM_ID, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MotionService } from '../core/motion.service';
import { AboutStory, PublicApi, StoryContent } from '../core/public-api';
import { ORG_LD, SeoService } from '../core/seo.service';
import { SchStoryCard, shortText, StoryPiece } from '../shared/story-card';
import { CREW_LOOKS, SchCrewPerson } from '../shared/crew-person';
import { PIECES, WORDMARK } from '../shared/brand';

/* =====================================================================================================
 * About SCHLUSS – the puzzle experience (v13: the crew).
 * The SCHLUSS retail-journey picture (replaceable in the admin portal) is cut into a calculated jigsaw grid. It
 * starts blurred, with pieces missing and one puzzle-piece shaped hole in the exact centre that is reserved for the
 * SCHLUSS logo. The missing pieces float around. A crew of animated people (the same cartoon people as in the
 * picture) works together: one walks to a floating piece, reaches up and grabs it, carries it to the front and holds
 * it up while a helper joins – the piece opens into an information tile. Afterwards the tile folds back into the
 * piece and it is carried to its place (sometimes by two people, sometimes with someone guiding), lifted, turned and
 * locked in; that part turns sharp. Meanwhile the next person already walks to the next piece.
 * Order: what SCHLUSS means -> the selected products (admin order) -> And more to come -> everybody looks at the
 * empty centre, the SCHLUSS logo appears, the crew carries it together into the centre, the whole picture lights up
 * and turns sharp, everyone celebrates, then the 3D burst and the closing statement.
 * Timing comes from the admin settings. No animation library: Web Animations API + CSS + SVG.
 * ===================================================================================================== */

const VW = 1600;
const VH = 900;
const IMG_SMALL = '/brand/about-puzzle-1280.webp';
const IMG_LARGE = '/brand/about-puzzle-2400.webp';
const PALETTE = ['#ff5d8f', '#ffb020', '#22d3a6', '#4c8dff', '#ff7a3d', '#14b8a6', '#8b7bff', '#38bdf8', '#e879f9', '#84cc16'];
const GRIDS_WIDE: [number, number][] = [[6, 4], [8, 5], [10, 6], [12, 7], [14, 8]];
const GRIDS_NARROW: [number, number][] = [[4, 3], [6, 4], [8, 5], [10, 6], [12, 7]];
const MAX_PRODUCT_PIECES = 60;
const MAX_FLOATING = 12;
/** The centre piece reserved for the SCHLUSS logo: a square body with a knob on every side (100 units). */
const LOGO_BODY = 'M0 0 L41 0 L41 -8 A15 15 0 1 1 59 -8 L59 0 L100 0 L100 41 L108 41 A15 15 0 1 1 108 59 L100 59 L100 100 L59 100 L59 108 A15 15 0 1 1 41 108 L41 100 L0 100 L0 59 L-8 59 A15 15 0 1 1 -8 41 L0 41 Z';
const POSES = ['walk', 'carry', 'hold', 'reach', 'point', 'cheer', 'look', 'idle'];
const REST_WIDE: [number, number][] = [[140, 820], [420, 880], [1180, 880], [1460, 820], [640, 892]];
const REST_NARROW: [number, number][] = [[230, 875], [800, 890], [1370, 875]];
interface Member { k: number; x: number; y: number; face: 1 | -1; busy: boolean; task: Promise<void> }
const DEFAULT_TIMING = { approach: 1.5, tileIn: 0.7, view: 5, tileOut: 0.6, place: 1.5 };

interface Cell { i: number; r: number; c: number; d: string; bx: number; by: number; bw: number; bh: number; cx: number; cy: number }
interface Slot { n: number; cell: Cell; piece: StoryPiece; fx: number; fy: number; fr: number; fs: number; dur: number; delay: number; dx: number; dy: number; dr: number }
type Phase = 'idle' | 'playing' | 'finale' | 'done';
type Mode = 'wide' | 'narrow';

const r1 = (n: number) => Math.round(n * 10) / 10;
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One jigsaw edge from A to B; t = +1 tab outwards, −1 socket, 0 flat. Symmetric, so neighbours share it exactly. */
function edge(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, t: number, size: number) {
  if (!t) return `L${r1(bx)} ${r1(by)} `;
  const p = (u: number, v: number) => `${r1(ax + (bx - ax) * u + nx * v * size * t)} ${r1(ay + (by - ay) * u + ny * v * size * t)}`;
  return (
    `L${p(0.36, 0)} C${p(0.4, 0)} ${p(0.42, 0.04)} ${p(0.4, 0.09)} C${p(0.36, 0.18)} ${p(0.42, 0.25)} ${p(0.5, 0.25)} ` +
    `C${p(0.58, 0.25)} ${p(0.64, 0.18)} ${p(0.6, 0.09)} C${p(0.58, 0.04)} ${p(0.6, 0)} ${p(0.64, 0)} L${r1(bx)} ${r1(by)} `
  );
}

function buildCells(cols: number, rows: number): Cell[] {
  const cw = VW / cols;
  const ch = VH / rows;
  const size = Math.min(cw, ch);
  const rand = rng(cols * 97 + rows * 13 + 7);
  const hv = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => (rand() < 0.5 ? 1 : -1)));
  const vv = Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, () => (rand() < 0.5 ? 1 : -1)));
  const pad = size * 0.27;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cw, y0 = r * ch, x1 = x0 + cw, y1 = y0 + ch;
      const top = r === 0 ? 0 : -hv[r - 1][c];
      const right = c === cols - 1 ? 0 : vv[r][c];
      const bottom = r === rows - 1 ? 0 : hv[r][c];
      const left = c === 0 ? 0 : -vv[r][c - 1];
      const d = `M${r1(x0)} ${r1(y0)} ` + edge(x0, y0, x1, y0, 0, -1, top, size) + edge(x1, y0, x1, y1, 1, 0, right, size) + edge(x1, y1, x0, y1, 0, 1, bottom, size) + edge(x0, y1, x0, y0, -1, 0, left, size) + 'Z';
      cells.push({ i: cells.length, r, c, d, bx: r1(x0 - pad), by: r1(y0 - pad), bw: r1(cw + 2 * pad), bh: r1(ch + 2 * pad), cx: x0 + cw / 2, cy: y0 + ch / 2 });
    }
  }
  return cells;
}

function preload(...urls: (string | null | undefined)[]) {
  for (const u of urls) if (u) { const i = new Image(); i.decoding = 'async'; i.src = u; }
}

@Component({
  selector: 'sch-about-story',
  imports: [SchStoryCard, RouterLink, SchCrewPerson],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about-story.html',
  styleUrl: './about-story.scss',
  host: { style: '--accent: #3282f6; --accent-2: #7b5cff; --accent-glow: #8fbcff' },
})
export class AboutPage {
  private api = inject(PublicApi);
  private motion = inject(MotionService);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroyRef = inject(DestroyRef);

  protected readonly vw = VW;
  protected readonly vh = VH;
  /** ?preview=… (admin preview) always loads the latest saved settings, never a cached copy. */
  protected data = toSignal<AboutStory | null>(this.api.aboutStory(this.browser && location.search.includes('preview=')), { initialValue: null });
  protected story = computed<StoryContent | null>(() => this.data()?.story ?? null);
  /** Short "About us" text under the puzzle (Admin › Website content › About us). */
  protected about = toSignal(this.api.site().pipe(map((x) => x.about)));
  protected enabled = computed(() => this.story()?.enabled !== false);
  /** The admin's picture, or the built-in SCHLUSS picture (two sizes). */
  protected picture = computed(() => {
    const own = this.story()?.image;
    return own ? { src: own, srcset: null as string | null } : { src: IMG_LARGE, srcset: `${IMG_SMALL} 1280w, ${IMG_LARGE} 2400w` };
  });
  private timing = computed(() => {
    const t = { ...DEFAULT_TIMING, ...(this.story()?.timing ?? {}) };
    return { approach: t.approach * 1000, tileIn: t.tileIn * 1000, view: t.view * 1000, tileOut: t.tileOut * 1000, place: t.place * 1000 };
  });
  protected tileIn = computed(() => this.timing().tileIn);

  /* ---------------- pieces: meaning → selected products (admin order) → and more to come ---------------- */
  private sequence = computed<StoryPiece[]>(() => {
    const s = this.story();
    if (!s) return [];
    const meaning: StoryPiece = { kind: 'meaning', title: s.meaningTitle, message: s.meaningMessage, text: shortText(s.meaningText, 260), hue: '#3282f6' };
    const more: StoryPiece = { kind: 'more', title: s.moreTitle, text: shortText(s.moreText, 260), hue: s.moreHue || '#ffb020' };
    const products = (this.data()?.pieces ?? [])
      .filter((p) => p.puzzle)
      .slice(0, MAX_PRODUCT_PIECES)
      .map((p, k): StoryPiece => ({ kind: 'product', title: p.title, text: shortText(p.description), tagline: p.tagline, category: p.category || p.type, cover: p.cover, image: p.image, link: p.link, hue: PALETTE[k % PALETTE.length] }));
    return [meaning, ...products, more];
  });

  /* ---------------- layout ---------------- */
  protected mode = signal<Mode>('wide');
  private gridMode = signal<Mode>('wide');
  /** Free space beside the puzzle, in puzzle units (floating pieces may use it). */
  private sideRoom = signal(0);
  protected grid = computed(() => {
    const n = Math.max(3, this.sequence().length);
    const list = this.gridMode() === 'narrow' ? GRIDS_NARROW : GRIDS_WIDE;
    const g = list.find(([c, r]) => c * r * 0.6 >= n) ?? list[list.length - 1];
    return { cols: g[0], rows: g[1] };
  });
  protected cells = computed(() => buildCells(this.grid().cols, this.grid().rows));
  protected slots = computed<Slot[]>(() => {
    const seq = this.sequence();
    const cells = this.cells();
    if (!seq.length) return [];
    const { cols, rows } = this.grid();
    const at = (fx: number, fy: number) => Math.min(rows - 1, Math.floor(fy * rows)) * cols + Math.min(cols - 1, Math.floor(fx * cols));
    // the centre belongs to the SCHLUSS logo – no product piece may ever use it
    const L = this.logoSide();
    const free = (c: Cell) => !(Math.abs(c.cx - VW / 2) < L * 0.95 && Math.abs(c.cy - VH / 2) < L * 0.95);
    const near = (fx: number, fy: number) => {
      let best = at(fx, fy);
      if (!free(cells[best])) best = cells.filter(free).sort((a, b) => Math.hypot(a.cx - fx * VW, a.cy - fy * VH) - Math.hypot(b.cx - fx * VW, b.cy - fy * VH))[0]?.i ?? best;
      return best;
    };
    const first = near(0.14, 0.22);
    let last = near(0.78, 0.3);
    if (last === first) last = near(0.85, 0.75);
    const chosen = [first, last];
    const dist = (a: Cell, b: Cell) => Math.hypot((a.cx - b.cx) / VW, (a.cy - b.cy) / VH);
    const middle: number[] = [];
    while (middle.length < seq.length - 2) {
      let best = -1;
      let bestD = -1;
      for (const c of cells) {
        if (chosen.includes(c.i) || !free(c)) continue;
        const d = Math.min(...chosen.map((k) => dist(c, cells[k])));
        if (d > bestD + 1e-9) { bestD = d; best = c.i; }
      }
      if (best < 0) break;
      chosen.push(best);
      middle.push(best);
    }
    const order = [first, ...middle, last];
    const room = this.sideRoom();
    const rand = rng(order.length * 31 + 5);
    const shown = Math.min(MAX_FLOATING, order.length);
    return seq.slice(0, order.length).map((piece, n) => {
      const cell = cells[order[n]];
      // Floating home: spread around the puzzle (beside it when there is room, otherwise along its edges).
      const k = n % shown;
      const a = (-Math.PI / 2) + ((k + 0.5) / shown) * Math.PI * 2 + (rand() - 0.5) * 0.25;
      const rx = VW / 2 + Math.min(room * 0.55, 150) - 40;
      const ry = VH / 2 + 10;
      let fx = VW / 2 + Math.cos(a) * rx;
      let fy = VH / 2 + Math.sin(a) * ry;
      fx = Math.max(-room + 60, Math.min(VW + room - 60, fx));
      fy = Math.max(30, Math.min(VH - 30, fy));
      const fs = (this.gridMode() === 'narrow' ? 120 : 112) / Math.max(cell.bw, cell.bh);
      return {
        n, cell, piece, fx, fy, fs, fr: (rand() - 0.5) * 40,
        dur: 6 + rand() * 6, delay: -rand() * 8, dx: 8 + rand() * 18, dy: 8 + rand() * 16, dr: 4 + rand() * 10,
      };
    });
  });

  /* ---------------- state ---------------- */
  protected phase = signal<Phase>('idle');
  protected placed = signal<ReadonlySet<number>>(new Set());
  protected current = signal(-1);
  protected lit = signal(-1);
  protected flash = signal(-1);
  protected cardOn = signal(false);
  protected paused = signal(false);
  protected hoverPause = signal(false);
  protected sharpAll = signal(false);
  protected glow = signal(false);
  protected bursting = signal(false);
  protected outlinesOff = signal(false);
  /** The SCHLUSS logo: visible (floating / carried) and locked into the centre. */
  protected logoOn = signal(false);
  protected logoPlaced = signal(false);
  protected logoCall = signal(false);
  protected logoFlash = signal(false);
  /** Glowing threads between the crew's hands and the opened piece. */
  protected beams = signal<{ x1: number; y1: number; x2: number; y2: number; c: string }[]>([]);
  protected readonly logoPath = LOGO_BODY;
  protected readonly markPieces = PIECES;
  protected readonly wordmark = WORDMARK;
  /** Size of the centre piece body (puzzle units). */
  protected logoSide = computed(() => (this.gridMode() === 'narrow' ? 215 : 168));
  protected logoBox = computed(() => {
    const L = this.logoSide();
    return { x: VW / 2 - L * 0.8, y: VH / 2 - L * 0.8, w: L * 1.6, h: L * 1.6, t: `translate(${VW / 2 - L / 2} ${VH / 2 - L / 2}) scale(${L / 100})` };
  });
  /* ---------------- the crew ---------------- */
  /** Person scale (1 = a 70-unit tall box). Bigger on phones so they stay visible. */
  protected crewScale = computed(() => (this.gridMode() === 'narrow' ? 3.4 : 2.5));
  protected crew = computed(() => {
    const rest = this.gridMode() === 'narrow' ? REST_NARROW : REST_WIDE;
    const k = this.crewScale();
    return rest.map(([x, y], i) => ({ k: i, look: CREW_LOOKS[i], x, y, w: ((52 * k) / VW) * 100, h: ((70 * k) / VH) * 100 }));
  });
  protected unit = signal(1);
  protected imgSrc = signal(IMG_LARGE);
  protected reduced = computed(() => this.motion.reduced());
  protected slot = computed(() => this.slots()[this.current()] ?? null);
  protected missing = computed(() => (this.phase() === 'done' ? [] : this.slots().filter((s) => !this.placed().has(s.n))));
  protected placedSlots = computed(() => (this.phase() === 'done' ? this.slots() : this.slots().filter((s) => this.placed().has(s.n))));
  /** Pieces still floating: the next few waiting their turn (the active one has come forward). */
  protected floating = computed(() => {
    const cur = this.current();
    const waiting = this.missing().filter((s) => s.n !== cur);
    return new Set(waiting.slice(0, MAX_FLOATING).map((s) => s.n));
  });
  /** The picture gets clearer with every piece that locks in. */
  protected blur = computed(() => {
    if (this.sharpAll() || !this.enabled()) return 0;
    const total = this.slots().length || 1;
    return Math.round((1.6 + 6.4 * (this.missing().length / total)) * 10) / 10;
  });
  protected stepLabel = computed(() => (this.slot() ? `Piece ${this.slot()!.n + 1} of ${this.slots().length}` : ''));
  protected particles = Array.from({ length: 36 }, (_, k) => {
    const r = rng(k * 7 + 3);
    return { k, x: r() * 100, y: r() * 100, s: 2 + r() * 4, d: 14 + r() * 22, dl: -r() * 30, c: PALETTE[k % PALETTE.length], o: 0.25 + r() * 0.5 };
  });
  protected fragments = Array.from({ length: 7 }, (_, k) => {
    const r = rng(k * 13 + 11);
    return { k, x: 3 + r() * 94, y: 6 + r() * 88, s: 16 + r() * 26, d: 16 + r() * 18, dl: -r() * 20, c: PALETTE[(k * 3) % PALETTE.length], depth: r() };
  });
  protected sparks = Array.from({ length: 64 }, (_, k) => {
    const a = (k / 64) * Math.PI * 2 + (k % 3) * 0.17;
    const d = 0.35 + ((k * 37) % 23) / 34;
    return { k, x: Math.cos(a) * d, y: Math.sin(a) * d, s: 5 + ((k * 13) % 10), c: PALETTE[k % PALETTE.length], piece: k % 4 === 0 };
  });

  private stage = viewChild<ElementRef<HTMLElement>>('stage');
  private tileEl = viewChild<ElementRef<HTMLElement>>('tile');
  private runId = 0;
  private live: Animation[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private wakeUps: (() => void)[] = [];
  private skipWait: (() => void) | null = null;
  private skipPending = false;
  private visible = signal(false);
  private started = false;

  constructor() {
    inject(SeoService).set({
      title: 'About SCHLUSS – the final piece of the puzzle',
      description: 'SCHLUSS means the final piece of the puzzle. We build the software and systems that bring every part of a business together.',
      path: '/about',
      jsonLd: ORG_LD,
    });
    afterNextRender(() => this.setup());
    // the story data may arrive after the page is shown – start the moment it does
    effect(() => { if (this.slots().length) untracked(() => this.maybeAutoStart()); });
    this.destroyRef.onDestroy(() => { this.cancel(); clearTimeout(this.imgTimer); });
  }

  /* ---------------- browser setup ---------------- */
  private setup() {
    if (!this.browser) return;
    const el = this.stage()?.nativeElement;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      const m: Mode = w >= 860 ? 'wide' : 'narrow';
      this.mode.set(m);
      this.unit.set(w / VW);
      this.sideRoom.set(Math.max(0, (document.documentElement.clientWidth - w) / 2) / (w / VW));
      if (this.phase() === 'idle' || this.phase() === 'done') this.gridMode.set(m);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      this.visible.set(e.intersectionRatio >= 0.15);
      this.wake();
      if (this.visible()) this.maybeAutoStart();
    }, { threshold: [0, 0.15, 0.4] });
    io.observe(el);
    const vis = () => this.wake();
    document.addEventListener('visibilitychange', vis);
    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    });
  }

  protected imageLoaded(e: Event) {
    const img = e.target as HTMLImageElement;
    if (img.currentSrc) this.imgSrc.set(img.currentSrc);
    this.maybeAutoStart();
  }

  /** Starts by itself as soon as the page is open, the picture has loaded and the puzzle is on screen. */
  private maybeAutoStart() {
    if (this.started || !this.visible() || !this.slots().length) return;
    if (!this.enabled()) return this.finishInstantly();
    const img = this.stage()?.nativeElement.querySelector<HTMLImageElement>('img.base');
    if (!img) return;
    if (!img.complete && !this.imgWaitOver) {
      // Don't keep visitors waiting for the picture: start within 0.6 s whatever happens.
      if (!this.imgTimer) this.imgTimer = setTimeout(() => { this.imgWaitOver = true; this.maybeAutoStart(); }, 600);
      return;
    }
    clearTimeout(this.imgTimer);
    this.imgSrc.set(img.currentSrc || img.src);
    this.started = true;
    void this.run();
  }
  private imgTimer: ReturnType<typeof setTimeout> | undefined;
  private imgWaitOver = false;

  /* ---------------- controls ---------------- */
  protected replay() {
    this.cancel();
    this.reset();
    this.gridMode.set(this.mode());
    this.started = true;
    queueMicrotask(() => void this.run());
  }
  protected skip() {
    this.cancel();
    this.finishInstantly();
  }
  protected togglePause() {
    this.paused.update((p) => !p);
    this.syncPlayState();
    this.wake();
  }
  protected hover(on: boolean) {
    this.hoverPause.set(on);
    this.syncPlayState();
    this.wake();
  }
  protected next() {
    if (this.skipWait) this.skipWait();
    else if (this.cardOn()) this.skipPending = true;
  }
  private syncPlayState() {
    const hold = this.paused() || this.hoverPause();
    for (const a of this.live) if (a.playState === 'running' || a.playState === 'paused') hold ? a.pause() : a.play();
  }

  private reset() {
    this.skipPending = false;
    this.placed.set(new Set());
    this.current.set(-1);
    this.lit.set(-1);
    this.flash.set(-1);
    this.cardOn.set(false);
    this.sharpAll.set(false);
    this.glow.set(false);
    this.bursting.set(false);
    this.outlinesOff.set(false);
    this.logoOn.set(false);
    this.logoPlaced.set(false);
    this.logoCall.set(false);
    this.logoFlash.set(false);
    this.beams.set([]);
    this.placing = Promise.resolve();
    this.prepared = null;
    this.resetCrew();
    this.paused.set(false);
    this.hoverPause.set(false);
    this.phase.set('idle');
  }
  private finishInstantly() {
    this.reset();
    this.placed.set(new Set(this.slots().map((s) => s.n)));
    this.sharpAll.set(true);
    this.outlinesOff.set(true);
    this.logoOn.set(true);
    this.logoPlaced.set(true);
    this.phase.set('done');
    this.started = true;
  }
  private cancel() {
    this.runId++;
    for (const a of this.live) a.cancel();
    this.live = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.skipWait?.();
    this.skipWait = null;
    this.wake();
  }

  /* ---------------- timing helpers (pausable, cancellable) ---------------- */
  private get halted() {
    return this.paused() || this.hoverPause() || !this.visible() || document.hidden;
  }
  private wake() {
    const w = this.wakeUps;
    this.wakeUps = [];
    w.forEach((f) => f());
  }
  private whileHalted(id: number) {
    return new Promise<void>((res) => {
      const check = () => (id !== this.runId || !this.halted ? res() : this.wakeUps.push(check));
      check();
    });
  }
  /** Waits ms of *running* time: the clock stops while paused, hovered, hidden or scrolled away. `next()` ends it early. */
  private async wait(ms: number, id: number, skippable = false) {
    let left = ms;
    if (skippable && this.skipPending) left = 0;
    this.skipPending = false;
    while (left > 0 && id === this.runId) {
      await this.whileHalted(id);
      if (id !== this.runId) return;
      const t0 = performance.now();
      await new Promise<void>((res) => {
        const t = setTimeout(() => { this.timers.delete(t); res(); }, Math.min(left, 250));
        this.timers.add(t);
        if (skippable) this.skipWait = () => { left = 0; clearTimeout(t); this.timers.delete(t); res(); };
      });
      left -= performance.now() - t0;
    }
    if (skippable) this.skipWait = null;
  }
  private frames(n = 2) {
    return new Promise<void>((res) => {
      const step = () => (--n <= 0 ? res() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
  }
  private async animate(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions, id: number) {
    if (id !== this.runId) return;
    await this.whileHalted(id);
    const a = el.animate(frames, { fill: 'forwards', ...opts });
    this.live.push(a);
    if (this.paused() || this.hoverPause()) a.pause();
    try {
      await a.finished;
    } catch {
      /* cancelled */
    }
    this.live = this.live.filter((x) => x !== a);
  }

  /** Transform of a floating piece at its home (relative to its place in the puzzle), in px. */
  protected homePose(s: Slot, u = this.unit()) {
    const ox = (s.fx - (s.cell.bx + s.cell.bw / 2)) * u;
    const oy = (s.fy - (s.cell.by + s.cell.bh / 2)) * u;
    return `translate(${r1(ox)}px, ${r1(oy)}px) scale(${r1(s.fs * 100) / 100}) rotate(${r1(s.fr)}deg)`;
  }
  /** Where a presented piece rests in front of the puzzle (stage units) and the tile beside / below it. */
  private showPose(s: Slot) {
    if (this.mode() === 'narrow') {
      const scale = Math.min(2.4, (VH * 0.7) / s.cell.bh);
      return { x: VW / 2, y: VH / 2, scale };
    }
    const scale = Math.min(1.6, 300 / s.cell.bh);
    const pw = s.cell.bw * scale;
    const tileW = Math.min(VW * 0.44, 560 / this.unit());
    const group = pw * 0.86 + tileW;
    const left = (VW - group) / 2;
    return { x: left + pw / 2, y: VH / 2, scale, tileLeft: left + pw * 0.86, tileW };
  }
  protected tileBox = signal<{ left: number; width: number } | null>(null);

  private pieceEl(n: number) {
    return this.stage()?.nativeElement.querySelector<HTMLElement>(`.fp[data-n="${n}"]`) ?? null;
  }

  /* ---------------- the crew: positions, poses and walking ---------------- */
  private members: Member[] = [];
  private placing: Promise<void> = Promise.resolve();
  private prepared: { n: number; k: number } | null = null;

  private get u() {
    return (this.stage()?.nativeElement.getBoundingClientRect().width ?? VW) / VW;
  }
  /** Height of the raised hands above the feet, and how big a carried piece is (puzzle units). */
  private get handH() { return 49 * this.crewScale(); }
  private get carrySize() { return this.gridMode() === 'narrow' ? 150 : 82; }
  private walkerEl(k: number) {
    return this.stage()?.nativeElement.querySelector<HTMLElement>(`.walker[data-k="${k}"]`) ?? null;
  }
  private resetCrew() {
    this.members = this.crew().map((c) => ({ k: c.k, x: c.x, y: c.y, face: (c.x < VW / 2 ? 1 : -1) as 1 | -1, busy: false, task: Promise.resolve() }));
    for (const m of this.members) {
      const el = this.walkerEl(m.k);
      if (!el) continue;
      el.getAnimations().forEach((a) => a.cancel());
      this.putWalker(m, m.x, m.y);
      this.face(m, m.face);
      this.pose(m);
    }
    this.stage()?.nativeElement.querySelectorAll<HTMLElement>('.fp').forEach((el) => {
      el.getAnimations().forEach((a) => a.cancel());
      el.classList.remove('carried');
      const s = this.slots()[Number(el.dataset['n'])];
      if (s) el.style.transform = this.homePose(s);
    });
    const logo = this.stage()?.nativeElement.querySelector<HTMLElement>('.logo-piece');
    if (logo) { logo.getAnimations().forEach((a) => a.cancel()); logo.style.transform = ''; }
  }
  private putWalker(m: Member, x: number, y: number) {
    m.x = x;
    m.y = y;
    const el = this.walkerEl(m.k);
    if (!el) return;
    el.style.left = (x / VW) * 100 + '%';
    el.style.top = (y / VH) * 100 + '%';
    el.style.zIndex = String(Math.round(y));
  }
  private pose(m: Member, ...p: string[]) {
    const el = this.walkerEl(m.k);
    if (!el) return;
    el.classList.remove(...POSES);
    el.classList.add(...(p.length ? p : ['idle']));
  }
  private face(m: Member, dir: 1 | -1) {
    m.face = dir;
    this.walkerEl(m.k)?.classList.toggle('flip', dir < 0);
  }
  private faceTo(m: Member, x: number) {
    if (Math.abs(x - m.x) > 4) this.face(m, x > m.x ? 1 : -1);
  }
  private walkDur(m: Member, x: number, y: number) {
    const speed = 360 * (1500 / Math.max(500, this.timing().approach)); // puzzle units per second
    return Math.max(380, (Math.hypot(x - m.x, y - m.y) / speed) * 1000);
  }
  private feetY(y: number) {
    return Math.max(this.handH + 40, Math.min(VH - 6, y));
  }
  private readonly walkEase = 'cubic-bezier(.4,.1,.6,.9)';
  /** Walks a person to (x, y); `carry` keeps the arms up. Resolves on arrival. */
  private async walk(m: Member, x: number, y: number, id: number, carry = false, dur = this.walkDur(m, x, y)) {
    const el = this.walkerEl(m.k);
    if (!el || id !== this.runId) return;
    if (Math.hypot(x - m.x, y - m.y) < 3) return;
    this.faceTo(m, x);
    this.pose(m, ...(carry ? ['walk', 'carry'] : ['walk']));
    el.style.zIndex = String(Math.round(Math.max(y, m.y)));
    const from = { left: (m.x / VW) * 100 + '%', top: (m.y / VH) * 100 + '%' };
    const to = { left: (x / VW) * 100 + '%', top: (y / VH) * 100 + '%' };
    await this.commit(el, [from, to], { duration: dur, easing: this.walkEase }, id);
    if (id !== this.runId) return;
    this.putWalker(m, x, y);
    this.pose(m, ...(carry ? ['carry'] : []));
  }
  /** Web animation that leaves its end state in the element's style (no piling up of filled animations). */
  private async commit(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions, id: number) {
    await this.animate(el, frames, opts, id);
    if (id !== this.runId) return;
    const last = frames[frames.length - 1];
    for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') (el.style as unknown as Record<string, string>)[k] = String(v);
    el.getAnimations().forEach((a) => { if (a.playState === 'finished') a.cancel(); });
  }
  /** Transform of a piece (relative to its place in the puzzle) when its centre is at (x, y). */
  private at(s: Slot, x: number, y: number, scale: number, rot: number, u = this.u) {
    return `translate(${r1((x - (s.cell.bx + s.cell.bw / 2)) * u)}px, ${r1((y - (s.cell.by + s.cell.bh / 2)) * u)}px) scale(${Math.round(scale * 1000) / 1000}) rotate(${r1(rot)}deg)`;
  }
  private carryScale(s: Slot) { return this.carrySize / Math.max(s.cell.bw, s.cell.bh) * 1.35; }
  /** Centre of a piece held above the head of someone standing at (x, y). */
  private handsAt(x: number, y: number) { return { x, y: y - this.handH - this.carrySize * 0.42 }; }
  /** The free person nearest to (x, y), or null. */
  private pick(x: number, y: number, exclude: Member[] = []) {
    const free = this.members.filter((m) => !m.busy && !exclude.includes(m));
    free.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const m = free[0] ?? null;
    if (m) m.busy = true;
    return m;
  }
  /** Somewhere to stand and wait along the lower edge, away from (x, y). */
  private restSpot(m: Member) {
    const base = (this.gridMode() === 'narrow' ? REST_NARROW : REST_WIDE)[m.k] ?? [VW / 2, VH - 20];
    return { x: base[0] + ((m.k * 37 + this.placed().size * 53) % 120) - 60, y: base[1] - ((m.k * 29 + this.placed().size * 17) % 50) };
  }
  private release(m: Member | null, id: number) {
    if (!m) return;
    const r = this.restSpot(m);
    m.task = this.walk(m, r.x, r.y, id).then(() => { if (id === this.runId) { this.pose(m); m.busy = false; } });
  }
  /** Where to stand below a floating piece to reach it. */
  private grabSpot(s: Slot) {
    const x = Math.max(50, Math.min(VW - 50, s.fx));
    return { x, y: this.feetY(s.fy + this.handH + 34) };
  }

  /* ---------------- the story ---------------- */
  private async run() {
    const id = ++this.runId;
    this.reset();
    this.phase.set('playing');
    await this.frames();
    this.resetCrew();
    await this.wait(250, id); // start straight away – just long enough to see the incomplete puzzle
    const slots = this.slots();
    preload(slots[0]?.piece.cover, slots[0]?.piece.image, slots[1]?.piece.cover, slots[1]?.piece.image);
    for (const s of slots) {
      if (id !== this.runId) return;
      if (this.reduced()) await this.presentSimple(s, id);
      else await this.present(s, id);
    }
    if (id !== this.runId) return;
    await this.placing;
    if (id !== this.runId) return;
    await this.logoFinale(id);
    if (id !== this.runId) return;
    await this.finale(id);
  }

  /** One piece, the crew way: collect → carry → open (tile) → close → carry → place. */
  private async present(s: Slot, id: number) {
    const T = this.timing();
    const next = this.slots()[s.n + 1];
    preload(next?.piece.cover, next?.piece.image); // ready before its turn
    this.current.set(s.n);
    this.lit.set(s.n);
    await this.frames();
    const fp = this.pieceEl(s.n);
    if (!fp || id !== this.runId) return;
    let u = this.u;

    // 1. COLLECT – someone (often already on the way) walks to the floating piece
    let c: Member | null = null;
    if (this.prepared?.n === s.n) c = this.members[this.prepared.k];
    this.prepared = null;
    if (!c) c = this.pick(s.fx, s.fy);
    if (!c) { await this.placing; await Promise.all(this.members.map((m) => m.task)); c = this.pick(s.fx, s.fy) ?? this.members[0]; }
    c.busy = true;
    await c.task;
    const g = this.grabSpot(s);
    await this.walk(c, g.x, g.y, id);
    if (id !== this.runId) return;
    // looks up, reaches – the piece wobbles when touched and drops into the hands
    this.faceTo(c, s.fx);
    this.pose(c, 'reach');
    const home = this.homePose(s, u);
    await this.commit(fp, [{ transform: home }, { transform: home.replace(/rotate\(([-\d.]+)deg\)/, (_, v) => `rotate(${Number(v) + 14}deg)`), offset: 0.35 }, { transform: home.replace(/rotate\(([-\d.]+)deg\)/, (_, v) => `rotate(${Number(v) - 8}deg)`), offset: 0.7 }, { transform: home }], { duration: 420, easing: 'ease-in-out' }, id);
    fp.classList.add('carried');
    let hp = this.handsAt(c.x, c.y);
    await this.commit(fp, [{ transform: home }, { transform: this.at(s, hp.x, hp.y, this.carryScale(s), -6, u) }], { duration: 480, easing: 'cubic-bezier(.3,.6,.3,1)' }, id);
    this.pose(c, 'carry');
    if (id !== this.runId) return;

    // 2. CARRY to the front, where a helper joins
    const narrow = this.mode() === 'narrow';
    const show = this.showPose(s);
    if (!narrow) show.y = VH * 0.42; // a little higher, so the people holding it stay visible
    else { show.scale = Math.min(show.scale, (VH * 0.48) / s.cell.bh); show.y = VH * 0.34; }
    const half = (s.cell.bh * show.scale) / 2;
    const pw = s.cell.bw * show.scale * 0.6; // visible width of the opened piece
    const cx = narrow ? show.x - pw * 0.28 : show.x - pw * 0.12;
    const feet = { x: cx, y: this.feetY(show.y + half * 0.5 + this.handH) };
    const h = this.pick(feet.x, feet.y, [c]);
    const hSpot = { x: narrow ? show.x + pw * 0.34 : show.x - pw * 0.62, y: this.feetY(feet.y + 14) };
    if (h) h.task = h.task.then(() => this.walk(h, hSpot.x, hSpot.y, id));
    await this.placing; // the previous piece is in its place before the next one opens
    if (id !== this.runId) return;
    u = this.u;
    const d1 = this.walkDur(c, feet.x, feet.y);
    hp = this.handsAt(feet.x, feet.y);
    await Promise.all([
      this.walk(c, feet.x, feet.y, id, true, d1),
      this.commit(fp, [{ transform: fp.style.transform }, { transform: this.at(s, hp.x, hp.y, this.carryScale(s), -6, u) }], { duration: d1, easing: this.walkEase }, id),
    ]);
    if (h) await h.task;
    if (id !== this.runId) return;

    // 3. OPEN – held up in front, the piece unfolds into the information tile
    if (show.tileLeft !== undefined) this.tileBox.set({ left: show.tileLeft, width: show.tileW! });
    else this.tileBox.set(null);
    this.face(c, 1);
    this.pose(c, 'hold');
    if (h) { this.faceTo(h, show.x); this.pose(h, 'hold'); }
    const front = this.at(s, show.x, show.y, show.scale, -3, u);
    await this.commit(fp, [{ transform: fp.style.transform }, { transform: this.at(s, show.x, show.y + 20, show.scale * 0.8, 6, u), offset: 0.6 }, { transform: front }], { duration: 650, easing: 'cubic-bezier(.3,.7,.2,1)' }, id);
    if (id !== this.runId) return;
    const bottom = show.y + half * 0.85;
    const beams = [{ x1: c.x + 8 * this.crewScale() * c.face, y1: c.y - this.handH * 0.92, x2: show.x - 10, y2: bottom, c: s.piece.hue }];
    if (h) beams.push({ x1: h.x + 8 * this.crewScale() * h.face, y1: h.y - this.handH * 0.92, x2: show.x + (h.x < show.x ? -1 : 1) * (s.cell.bw * show.scale) * 0.3, y2: show.y + half * 0.4, c: s.piece.hue });
    this.beams.set(beams);
    this.cardOn.set(true);
    await this.frames();
    const tile = this.tileEl()?.nativeElement;
    if (tile) {
      await this.animate(tile, narrow
        ? [{ opacity: 0, transform: 'perspective(900px) translateY(-40px) rotateX(24deg) scale(.6)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0, transform: 'perspective(1100px) translateX(-60px) rotateY(-32deg) scale(.35)' }, { opacity: 1, transform: 'none' }],
      { duration: T.tileIn, easing: 'cubic-bezier(.2,.8,.2,1)' }, id);
    }
    // meanwhile somebody else already goes to the next piece (teamwork)
    if (next) {
      const p = this.pick(next.fx, next.fy, [c, ...(h ? [h] : [])]);
      if (p) {
        this.prepared = { n: next.n, k: p.k };
        const gs = this.grabSpot(next);
        p.task = p.task.then(() => this.walk(p, gs.x, gs.y, id)).then(() => { if (id === this.runId) { this.faceTo(p, next.fx); this.pose(p, 'look'); } });
      }
    }
    const bob = fp.animate([{ transform: front }, { transform: this.at(s, show.x, show.y - 7, show.scale, 1, u) }], { duration: 2300, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    this.live.push(bob);

    // 4. reading time (pauses on hover / Pause / hidden tab)
    await this.wait(T.view, id, true);
    bob.cancel();
    this.live = this.live.filter((x) => x !== bob);
    if (id !== this.runId) return;

    // 5. CLOSE – the tile folds back into the piece, which goes back into the hands
    if (tile) {
      await this.animate(tile, narrow
        ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'perspective(900px) translateY(-30px) rotateX(20deg) scale(.7)' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'perspective(1100px) translateX(-50px) rotateY(-28deg) scale(.4)' }],
      { duration: T.tileOut, easing: 'cubic-bezier(.5,0,.75,0)' }, id);
    }
    this.cardOn.set(false);
    this.hoverPause.set(false);
    this.beams.set([]);
    u = this.u;
    hp = this.handsAt(c.x, c.y);
    this.pose(c, 'carry');
    await this.commit(fp, [{ transform: front }, { transform: this.at(s, hp.x, hp.y, this.carryScale(s), -6, u) }], { duration: 480, easing: 'cubic-bezier(.4,0,.2,1)' }, id);
    if (id !== this.runId) return;
    this.current.set(-1);

    // 6. PLACE – carried to the hole (two people every third piece, otherwise with someone guiding) while the
    //    story moves on to the next piece
    const together = !!h && s.n % 3 === 2;
    this.placing = this.place(s, fp, c, h, together, id);
  }

  private async place(s: Slot, fp: HTMLElement, c: Member, h: Member | null, together: boolean, id: number) {
    const T = this.timing();
    const u = this.u;
    const tx = s.cell.cx;
    const feetY = this.feetY(s.cell.cy + this.carrySize * 0.42 + this.handH);
    const runs: Promise<void>[] = [];
    let d = this.walkDur(c, tx - (together ? 34 : 0), feetY);
    if (together && h) {
      // the helper comes over, both take the piece and carry it between them
      await this.walk(h, c.x + 40, c.y, id);
      this.faceTo(h, c.x);
      this.pose(h, 'carry');
      d = Math.max(d, this.walkDur(h, tx + 34, feetY));
      runs.push(this.walk(h, tx + 34, feetY, id, true, d));
    } else if (h) {
      // the helper walks ahead and guides the piece in
      const side = tx > VW / 2 ? -1 : 1;
      runs.push(this.walk(h, tx + side * 105, this.feetY(feetY + 8), id).then(() => { if (id === this.runId) { this.faceTo(h, tx); this.pose(h, 'point'); } }));
    }
    const hp = this.handsAt(tx, feetY);
    runs.push(this.walk(c, tx - (together ? 34 : 0), feetY, id, true, d));
    runs.push(this.commit(fp, [{ transform: fp.style.transform }, { transform: this.at(s, hp.x, hp.y, this.carryScale(s), -6, u) }], { duration: d, easing: this.walkEase }, id));
    await Promise.all(runs);
    if (id !== this.runId) return;
    // lift into position, turn, align, lock in
    this.pose(c, 'reach');
    if (together && h) this.pose(h, 'reach');
    const cx = s.cell.bx + s.cell.bw / 2, cy = s.cell.by + s.cell.bh / 2;
    await this.commit(fp, [
      { transform: fp.style.transform },
      { transform: this.at(s, cx, cy - 34, 1.12, 34, u), offset: 0.45, easing: 'cubic-bezier(.3,.6,.4,1)' },
      { transform: this.at(s, cx, cy - 6, 1.04, -7, u), offset: 0.8 },
      { transform: 'translate(0px, 0px) scale(1) rotate(0deg)' },
    ], { duration: Math.max(800, T.place * 0.75), easing: 'ease-out' }, id);
    if (id !== this.runId) return;
    this.placed.update((p) => new Set(p).add(s.n));
    this.flash.set(s.n);
    this.pose(c, 'cheer');
    if (h) this.pose(h, 'cheer');
    await this.wait(650, id);
    this.release(c, id);
    this.release(h, id);
  }

  /** Reduced motion: no walking or flying – the piece fades in front, its tile shows, then it fades into place. */
  private async presentSimple(s: Slot, id: number) {
    const T = this.timing();
    this.current.set(s.n);
    this.lit.set(s.n);
    await this.frames();
    const fp = this.pieceEl(s.n);
    if (!fp || id !== this.runId) return;
    const show = this.showPose(s);
    if (show.tileLeft !== undefined) this.tileBox.set({ left: show.tileLeft, width: show.tileW! });
    else this.tileBox.set(null);
    const front = this.at(s, show.x, show.y, show.scale, 0);
    await this.commit(fp, [{ transform: front, opacity: 0 }, { transform: front, opacity: 1 }], { duration: 350 }, id);
    this.cardOn.set(true);
    await this.frames();
    const tile = this.tileEl()?.nativeElement;
    if (tile) await this.animate(tile, [{ opacity: 0 }, { opacity: 1 }], { duration: T.tileIn }, id);
    await this.wait(T.view, id, true);
    if (id !== this.runId) return;
    if (tile) await this.animate(tile, [{ opacity: 1 }, { opacity: 0 }], { duration: T.tileOut }, id);
    this.cardOn.set(false);
    this.hoverPause.set(false);
    await this.commit(fp, [{ transform: front, opacity: 1 }, { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 }], { duration: 400 }, id);
    this.placed.update((p) => new Set(p).add(s.n));
    this.flash.set(s.n);
    this.lit.set(-1);
    this.current.set(-1);
    await this.wait(400, id);
  }

  /** The SCHLUSS logo – always the final centre piece, placed by the whole team. */
  private async logoFinale(id: number) {
    this.flash.set(-1);
    await Promise.all(this.members.map((m) => m.task));
    if (id !== this.runId) return;
    const simple = this.reduced();
    // everybody stops and looks at the empty centre
    this.logoCall.set(true);
    if (!simple) {
      for (const m of this.members) { this.faceTo(m, VW / 2); this.pose(m, 'look'); }
      await this.wait(1300, id);
    }
    // the final piece appears
    this.logoOn.set(true);
    await this.frames();
    const logo = this.stage()?.nativeElement.querySelector<HTMLElement>('.logo-piece');
    if (!logo || id !== this.runId) return;
    const u = this.u;
    const L = this.logoSide();
    const lp = (x: number, y: number, sc: number, rot: number) => `translate(${r1((x - VW / 2) * u)}px, ${r1((y - VH / 2) * u)}px) scale(${sc}) rotate(${rot}deg)`;
    if (simple) {
      await this.commit(logo, [{ transform: lp(VW / 2, VH / 2, 1, 0), opacity: 0 }, { transform: lp(VW / 2, VH / 2, 1, 0), opacity: 1 }], { duration: 600 }, id);
      this.logoPlaced.set(true);
      this.sharpAll.set(true);
      this.logoCall.set(false);
      return;
    }
    const spot = { x: VW / 2, y: Math.max(L * 0.55 + 20, 150) };
    await this.commit(logo, [
      { transform: lp(spot.x, spot.y - 60, 0.2, -40), opacity: 0 },
      { transform: lp(spot.x, spot.y + 8, 0.72, 8), opacity: 1, offset: 0.7 },
      { transform: lp(spot.x, spot.y, 0.66, 0), opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1.2)' }, id);
    if (id !== this.runId) return;
    // they notice it…
    for (const m of this.members) { this.faceTo(m, VW / 2); this.pose(m, 'reach'); }
    const hover = logo.animate([{ transform: lp(spot.x, spot.y, 0.66, 0) }, { transform: lp(spot.x, spot.y - 10, 0.66, 3) }], { duration: 1100, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    this.live.push(hover);
    await this.wait(700, id);
    // …two of them go to collect it, the others come together around the centre
    const carrySc = this.gridMode() === 'narrow' ? 0.5 : 0.48;
    const carryHalf = L * 1.6 * carrySc * 0.32;
    const byX = [...this.members].sort((a, b) => Math.abs(a.x - VW / 2) - Math.abs(b.x - VW / 2));
    const [a, b] = byX;
    const others = byX.slice(2);
    const gap = 44 * this.crewScale() / 1.65;
    const under = this.feetY(spot.y + carryHalf + this.handH);
    await Promise.all([this.walk(a, spot.x - gap, under, id), b ? this.walk(b, spot.x + gap, under, id) : Promise.resolve()]);
    if (id !== this.runId) return;
    hover.cancel();
    this.live = this.live.filter((x) => x !== hover);
    this.faceTo(a, spot.x);
    if (b) this.faceTo(b, spot.x);
    this.pose(a, 'reach');
    if (b) this.pose(b, 'reach');
    const hy = under - this.handH - carryHalf;
    await this.commit(logo, [{ transform: lp(spot.x, spot.y, 0.66, 0) }, { transform: lp(spot.x, hy, carrySc, -4) }], { duration: 520, easing: 'cubic-bezier(.3,.6,.3,1)' }, id);
    this.pose(a, 'carry');
    if (b) this.pose(b, 'carry');
    // carried together to the centre; the others gather round and guide
    const feet = this.feetY(VH / 2 + carryHalf + this.handH);
    const d = Math.max(this.walkDur(a, VW / 2 - gap, feet), b ? this.walkDur(b, VW / 2 + gap, feet) : 0, 900);
    const ring = others.map((m, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const x = VW / 2 + side * (L * 0.95 + 60 + Math.floor(i / 2) * 90);
      const y = this.feetY(VH / 2 + L * 0.45 + 40 + Math.floor(i / 2) * 40);
      return this.walk(m, x, y, id).then(() => { if (id === this.runId) { this.faceTo(m, VW / 2); this.pose(m, 'point'); } });
    });
    await Promise.all([
      this.walk(a, VW / 2 - gap, feet, id, true, d),
      b ? this.walk(b, VW / 2 + gap, feet, id, true, d) : Promise.resolve(),
      this.commit(logo, [{ transform: lp(spot.x, hy, carrySc, -4) }, { transform: lp(VW / 2, feet - this.handH - carryHalf, carrySc, -4) }], { duration: d, easing: this.walkEase }, id),
      ...ring,
    ]);
    if (id !== this.runId) return;
    // lift, align, lock
    this.pose(a, 'reach');
    if (b) this.pose(b, 'reach');
    await this.commit(logo, [
      { transform: lp(VW / 2, feet - this.handH - carryHalf, carrySc, -4) },
      { transform: lp(VW / 2, VH / 2 - 40, 1.14, 22), offset: 0.5, easing: 'cubic-bezier(.3,.6,.4,1)' },
      { transform: lp(VW / 2, VH / 2 - 6, 1.04, -6), offset: 0.82 },
      { transform: lp(VW / 2, VH / 2, 1, 0) },
    ], { duration: 1300, easing: 'ease-out' }, id);
    if (id !== this.runId) return;
    // the spectacular moment: everything lights up and turns sharp, the team celebrates
    this.logoPlaced.set(true);
    this.logoCall.set(false);
    this.logoFlash.set(true);
    this.sharpAll.set(true);
    this.glow.set(true);
    // the two carriers step back so the logo stands free, then everyone celebrates
    const back = this.feetY(VH / 2 + L * 0.55 + 70);
    await Promise.all([this.walk(a, VW / 2 - L * 0.95 - 30, back, id), b ? this.walk(b, VW / 2 + L * 0.95 + 30, back, id) : Promise.resolve()]);
    for (const m of this.members) { this.faceTo(m, VW / 2); this.pose(m, 'cheer'); }
    await this.wait(2200, id);
    this.logoFlash.set(false);
  }

  private async finale(id: number) {
    this.flash.set(-1);
    this.phase.set('finale');
    this.sharpAll.set(true);
    this.glow.set(true);
    await this.wait(this.reduced() ? 400 : 500, id);
    this.glow.set(false);
    if (!this.reduced()) {
      this.bursting.set(true);
      await this.frames();
      const el = this.stage()?.nativeElement;
      if (el && id === this.runId) {
        const rect = el.getBoundingClientRect();
        const u = rect.width / VW;
        const blurOk = this.cells().length <= 40; // motion blur only where it stays cheap
        const runs: Promise<void>[] = [];
        const flashEl = el.querySelector('.flash-burst');
        if (flashEl) runs.push(this.animate(flashEl, [{ transform: 'translate(-50%,-50%) scale(.1)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 1, offset: 0.22 }, { transform: 'translate(-50%,-50%) scale(3.4)', opacity: 0 }], { duration: 1600, easing: 'cubic-bezier(.2,.7,.2,1)' }, id));
        el.querySelectorAll<HTMLElement>('.bp').forEach((p) => {
          const k = Number(p.dataset['k']);
          let vx = Number(p.dataset['cx']) - VW / 2;
          let vy = Number(p.dataset['cy']) - VH / 2;
          const len = Math.hypot(vx, vy) || 1;
          vx /= len;
          vy /= len;
          const dist = (130 + ((k * 53) % 130)) * u;
          const z = 60 + ((k * 29) % 170);
          const rx = vy * -34 + ((k * 7) % 12) - 6;
          const ry = vx * 40 + ((k * 11) % 16) - 8;
          const rz = ((k * 37) % 44) - 22;
          const out = `translate3d(${vx * dist}px, ${vy * dist}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(1.08)`;
          const mid: Keyframe = { transform: `translate3d(${vx * dist * 0.55}px, ${vy * dist * 0.55}px, ${z * 0.6}px) rotateX(${rx * 0.6}deg) rotateY(${ry * 0.6}deg) rotateZ(${rz * 0.6}deg) scale(1.05)` };
          if (blurOk) mid['filter'] = 'blur(1.5px)';
          // Keyframe-level easing: burst out fast, hang in the air, then settle back softly.
          runs.push(this.animate(p, [
            { transform: 'none', filter: 'blur(0px)', easing: 'cubic-bezier(.2,.7,.3,1)' },
            { ...mid, offset: 0.12, easing: 'cubic-bezier(.1,.6,.3,1)' },
            { transform: out, offset: 0.36, filter: 'blur(0px)', easing: 'ease-in-out' },
            { transform: out.replace('scale(1.08)', 'scale(1.1)'), offset: 0.5, easing: 'cubic-bezier(.55,0,.25,1)' },
            { transform: `translate3d(${-vx * 4 * u}px, ${-vy * 4 * u}px, 0) rotateX(${-rx * 0.05}deg) rotateY(${-ry * 0.05}deg) rotateZ(${-rz * 0.05}deg) scale(.99)`, offset: 0.86, easing: 'ease-out' },
            { transform: 'none', filter: 'blur(0px)' },
          ], { duration: 2600, delay: (k % 9) * 16, easing: 'linear' }, id));
        });
        el.querySelectorAll<HTMLElement>('.spark').forEach((p) => {
          const x = Number(p.dataset['x']) * rect.width * 0.62;
          const y = Number(p.dataset['y']) * rect.height * 0.9;
          runs.push(this.animate(p, [
            { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0, filter: 'blur(2px)' },
            { opacity: 1, offset: 0.12, filter: 'blur(1px)' },
            { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1) rotate(${Number(p.dataset['k']) * 23}deg)`, opacity: 0, filter: 'blur(0px)' },
          ], { duration: 1600 + (Number(p.dataset['k']) % 5) * 140, easing: 'cubic-bezier(.1,.7,.2,1)' }, id));
        });
        await Promise.all(runs);
      }
      this.bursting.set(false);
    }
    if (id !== this.runId) return;
    this.outlinesOff.set(true);
    for (const m of this.members) this.pose(m);
    this.phase.set('done');
  }
}

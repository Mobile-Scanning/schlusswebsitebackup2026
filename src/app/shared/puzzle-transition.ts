import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injectable, PLATFORM_ID, viewChild } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { PIECES, WORDMARK } from './brand';
import { Hue, HUES, routeHues, TILE_CELL, TILE_PIECES } from './palette';

type Origin = { x: number; y: number; hue: Hue | null };
type Variant = 'home' | 'products' | 'soon' | 'product' | 'learning' | 'partners' | 'contact' | 'about' | 'page';
type Pt = [number, number];
type Seg = { c1?: Pt; c2?: Pt; p: Pt };
type Edge = { a: Pt; segs: Seg[] };
interface Cell { r: number; c: number; cx: number; cy: number; d: string }

/**
 * How each destination is assembled.
 *  order – which pieces lock first
 *  from  – where a piece glides in from (unit vector × distance, px), may depend on the piece
 *  turn  – small rotation on approach (deg)
 *  seed  – shapes of the tabs (every page gets its own cut)
 */
interface Arrangement {
  seed: number;
  order: (cells: Cell[], ctx: { focus: Pt; W: number; H: number }) => Cell[];
  from: (cell: Cell, ctx: { focus: Pt; W: number; H: number }) => Pt;
  turn?: number;
  slots?: boolean; // show the empty, dashed outline of every piece first (anticipation)
  stagger?: number;
}
const dist = (c: Cell, p: Pt) => Math.hypot(c.cx - p[0], c.cy - p[1]);
const unit = (x: number, y: number, len: number): Pt => { const l = Math.hypot(x, y) || 1; return [(x / l) * len, (y / l) * len]; };
const ARR: Record<Variant, Arrangement> = {
  // the homepage closes in on its centre – outer pieces first, gliding inward
  home: { seed: 7, order: (cs, { W, H }) => [...cs].sort((a, b) => dist(b, [W / 2, H / 2]) - dist(a, [W / 2, H / 2])), from: (c, { W, H }) => unit(c.cx - W / 2, c.cy - H / 2, 56) },
  // shelves of tiles: row by row, each piece rising into its slot
  products: { seed: 3, order: (cs) => [...cs].sort((a, b) => a.r - b.r || a.c - b.c), from: () => [0, 44] },
  // the product grows out of its own image
  product: { seed: 11, order: (cs, { focus }) => [...cs].sort((a, b) => dist(a, focus) - dist(b, focus)), from: (c, { focus }) => unit(focus[0] - c.cx, focus[1] - c.cy, 40) },
  // still taking shape: empty slots first, pieces arrive in no fixed order with a slight turn
  soon: { seed: 5, order: (cs) => [...cs].sort((a, b) => ((a.r * 7 + a.c * 13) % 11) - ((b.r * 7 + b.c * 13) % 11)), from: (c) => [(c.c % 2 ? 1 : -1) * 30, -36], turn: 5, slots: true, stagger: 42 },
  // pages of a guide: column by column from the left
  learning: { seed: 9, order: (cs) => [...cs].sort((a, b) => a.c - b.c || a.r - b.r), from: () => [-48, 0] },
  // two sides meeting: left half from the left, right half from the right, joining in the middle
  partners: { seed: 13, order: (cs, { W }) => [...cs].sort((a, b) => Math.abs(b.cx - W / 2) - Math.abs(a.cx - W / 2)), from: (c, { W }) => [c.cx < W / 2 ? -60 : 60, 0] },
  // the form first, then the page around it
  contact: { seed: 17, order: (cs, { focus }) => [...cs].sort((a, b) => dist(a, focus) - dist(b, focus)), from: () => [44, 0] },
  // a diagonal sweep
  about: { seed: 19, order: (cs) => [...cs].sort((a, b) => a.r + a.c - (b.r + b.c)), from: () => [0, 40] },
  page: { seed: 23, order: (cs) => [...cs].sort((a, b) => a.r + a.c - (b.r + b.c)), from: () => [-30, -30] },
};

/* ---------- jigsaw cut: a grid of interlocking pieces that tessellate exactly ---------- */
function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** An edge from a to b with a knob on the side of normal n (sign ±1). */
function knobEdge(a: Pt, b: Pt, s: number, m: number, jitter: number): Edge {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Pt = [-d[1] * s, d[0] * s];
  const mid = L / 2 + jitter * m;
  const P = (u: number, v: number): Pt => [a[0] + d[0] * (mid + u * m) + n[0] * v * m, a[1] + d[1] * (mid + u * m) + n[1] * v * m];
  return {
    a,
    segs: [
      { p: P(-0.13, 0) },
      { c1: P(-0.08, 0), c2: P(-0.05, 0.05), p: P(-0.085, 0.09) },
      { c1: P(-0.13, 0.15), c2: P(-0.1, 0.235), p: P(0, 0.235) },
      { c1: P(0.1, 0.235), c2: P(0.13, 0.15), p: P(0.085, 0.09) },
      { c1: P(0.05, 0.05), c2: P(0.08, 0), p: P(0.13, 0) },
      { p: b },
    ],
  };
}
const straight = (a: Pt, b: Pt): Edge => ({ a, segs: [{ p: b }] });
function reverse(e: Edge): Edge {
  const ends = [e.a, ...e.segs.map((s) => s.p)];
  const segs: Seg[] = [];
  for (let i = e.segs.length - 1; i >= 0; i--) {
    const s = e.segs[i];
    segs.push(s.c1 ? { c1: s.c2, c2: s.c1, p: ends[i] } : { p: ends[i] });
  }
  return { a: e.segs[e.segs.length - 1].p, segs };
}
const f = (n: number) => n.toFixed(1);
const segStr = (e: Edge) => e.segs.map((s) => (s.c1 ? `C${f(s.c1[0])} ${f(s.c1[1])} ${f(s.c2![0])} ${f(s.c2![1])} ${f(s.p[0])} ${f(s.p[1])}` : `L${f(s.p[0])} ${f(s.p[1])}`)).join('');

function cut(W: number, H: number, C: number, R: number, seed: number): Cell[] {
  const rand = rng(seed);
  const cw = W / C, ch = H / R, m = Math.min(cw, ch);
  const X = (c: number) => c * cw, Y = (r: number) => r * ch;
  const hE: Edge[][] = [], vE: Edge[][] = [];
  for (let r = 1; r < R; r++) { hE[r] = []; for (let c = 0; c < C; c++) hE[r][c] = knobEdge([X(c), Y(r)], [X(c + 1), Y(r)], rand() < 0.5 ? 1 : -1, m, (rand() - 0.5) * 0.12); }
  for (let r = 0; r < R; r++) { vE[r] = []; for (let c = 1; c < C; c++) vE[r][c] = knobEdge([X(c), Y(r)], [X(c), Y(r + 1)], rand() < 0.5 ? 1 : -1, m, (rand() - 0.5) * 0.12); }
  const cells: Cell[] = [];
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const tl: Pt = [X(c), Y(r)], tr: Pt = [X(c + 1), Y(r)], br: Pt = [X(c + 1), Y(r + 1)], bl: Pt = [X(c), Y(r + 1)];
      const top = r === 0 ? straight(tl, tr) : hE[r][c];
      const right = c === C - 1 ? straight(tr, br) : vE[r][c + 1];
      const bottom = r === R - 1 ? straight(br, bl) : reverse(hE[r + 1][c]);
      const left = c === 0 ? straight(bl, tl) : reverse(vE[r][c]);
      cells.push({ r, c, cx: X(c) + cw / 2, cy: Y(r) + ch / 2, d: `M${f(tl[0])} ${f(tl[1])}${segStr(top)}${segStr(right)}${segStr(bottom)}${segStr(left)}Z` });
    }
  return cells;
}

/**
 * SCHLUSS page transitions – the destination page is assembled from glass puzzle pieces.
 *
 *  1. On navigation a sheet of frosted glass, tinted in the destination's colours, settles over
 *     the content area (header stays sharp). The real destination page renders underneath it.
 *  2. Clear glass pieces – cut from that sheet like a jigsaw – glide into place in an order that
 *     suits the page. As each one locks, its part of the real page turns crystal clear.
 *  3. The centre stays open for the last piece: the SCHLUSS mark and wordmark, on smoked glass,
 *     settle into it. The connection completes, the logo holds briefly, then fades away.
 *  4. The finished page remains – it was the real, live page all along.
 *
 * Nothing is copied or screenshotted: the overlay only blurs/tints what is underneath and has
 * "holes" where pieces have locked. It never takes pointer events, so the page can be used at
 * once. Desktop ≈1.5 s, phones ≈1.1 s (fewer pieces, no blur). Not used for filters, anchors,
 * sign-in pages or portals. Reduced motion: a short fade only. Any failure: the overlay is removed.
 */
@Injectable({ providedIn: 'root' })
export class PuzzleTransitions {
  private doc = inject(DOCUMENT);
  private router = inject(Router);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));
  private stage: HTMLElement | null = null;
  private last: Origin | null = null;
  private accent = '';
  private navStartedAt = 0;
  private run = 0;
  private active = false;
  private veil: HTMLElement | null = null;
  private timers: number[] = [];

  attach(stage: HTMLElement) {
    if (!this.browser || this.stage) return;
    this.stage = stage;
    this.doc.addEventListener(
      'click',
      (e) => {
        const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('a, button, [role="button"]');
        if (!t) return;
        const accent = getComputedStyle(t).getPropertyValue('--accent').trim();
        const hue = accent ? Object.values(HUES).find((h) => h.c1.toLowerCase() === accent.toLowerCase()) ?? null : null;
        this.last = { x: e.clientX || innerWidth / 2, y: e.clientY || innerHeight / 2, hue };
        const tile = t.closest<HTMLElement>('[data-launch]');
        this.accent = '';
        if (tile && !this.reduced()) {
          tile.classList.add('launching');
          setTimeout(() => tile.classList.remove('launching'), 500);
          this.accent = getComputedStyle(tile).getPropertyValue('--accent').trim();
        }
        if (t.matches('button.btn-primary') && !this.reduced()) {
          const o = this.last;
          setTimeout(() => { if (performance.now() - this.navStartedAt > 120) this.burst(o); }, 0);
        }
      },
      true,
    );

    let currentPath = this.path(this.router.url);
    let pending: { variant: Variant; back: boolean; to: string } | null = null;
    this.router.events.subscribe((ev) => {
      try {
        if (ev instanceof NavigationStart) {
          const to = this.path(ev.url);
          pending = null;
          if (ev.id === 1 || to === currentPath || this.skip(currentPath, to)) return;
          this.navStartedAt = performance.now();
          pending = { variant: this.variant(to), back: ev.navigationTrigger === 'popstate', to };
          if (!this.reduced()) this.frost(this.colours(pending.variant, to));
        } else if (ev instanceof NavigationEnd) {
          currentPath = this.path(ev.urlAfterRedirects);
          if (!pending) return;
          const p = pending;
          pending = null;
          if (this.reduced()) return this.fadeIn();
          const run = this.run;
          this.whenReady(p.variant, run, () => this.assemble(p.variant, p.back, run));
        } else if ((ev instanceof NavigationCancel || ev instanceof NavigationError) && pending) {
          pending = null;
          this.dissolve(); // reveal the page that's still there – nothing else
        }
      } catch {
        this.clear();
      }
    });
  }

  private reduced() {
    return this.doc.documentElement.classList.contains('reduce-motion');
  }
  private phone() {
    return innerWidth < 700 || matchMedia('(pointer: coarse)').matches;
  }
  private path(url: string) {
    return url.split(/[?#]/)[0] || '/';
  }
  /** No page transition inside portals, into/out of sign-in pages (they have their own entrance). */
  private skip(from: string, to: string) {
    const top = (p: string) => p.split('/')[1] ?? '';
    const quiet = (p: string) => ['admin', 'partner', 'account'].includes(top(p)) || /^\/(login|register|forgot-password|reset-password)/.test(p);
    return quiet(to) || (quiet(from) && top(from) === top(to));
  }
  private variant(path: string): Variant {
    if (path === '/') return 'home';
    if (path === '/products') return 'products';
    if (path.startsWith('/coming-soon')) return 'soon';
    if (path.startsWith('/products/')) return 'product';
    if (path.startsWith('/learning')) return 'learning';
    if (path.startsWith('/partners')) return 'partners';
    if (path.startsWith('/contact') || path.startsWith('/request-demo')) return 'contact';
    if (path.startsWith('/about')) return 'about';
    return 'page';
  }
  /** The destination's own colours: a product's accent when a product tile was opened, else the page's palette. */
  private colours(variant: Variant, to: string): [string, string] {
    if (variant === 'product' && this.accent) return [this.accent, this.accent];
    const h = routeHues(to);
    return [h[0].c1, (h[1] ?? h[0]).c2];
  }
  /** Content area below the sticky site header. */
  private area() {
    const hdr = this.doc.querySelector('header.hdr')?.getBoundingClientRect();
    const top = hdr ? Math.max(0, Math.round(hdr.bottom)) : 0;
    return { top, W: innerWidth, H: innerHeight - top };
  }
  private later(fn: () => void, ms: number) {
    const run = this.run;
    this.timers.push(window.setTimeout(() => { if (run === this.run) { try { fn(); } catch { this.clear(); } } }, ms));
  }
  private clear() {
    this.run++;
    this.active = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.veil = null;
    this.stage?.querySelectorAll('.pz-veil, .pz-glass').forEach((n) => n.remove());
  }

  /** Stage 1 – the frosted sheet settles over the content area in the destination's colours. */
  private frost([c1, c2]: [string, string]) {
    this.clear();
    this.active = true;
    const { top, W, H } = this.area();
    const v = this.doc.createElement('div');
    v.className = 'pz-veil' + (this.phone() ? ' lite' : '');
    v.style.cssText = `top:${top}px;width:${W}px;height:${H}px;--c1:${c1};--c2:${c2}`;
    v.innerHTML = '<i class="wash"></i>';
    this.stage!.appendChild(v);
    v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out', fill: 'both' });
    this.veil = v;
    this.later(() => this.clear(), 6000); // safety net – the overlay can never get stuck
  }

  /** Wait (briefly) for the destination to have real content to reveal. */
  private whenReady(variant: Variant, run: number, go: () => void) {
    const t0 = performance.now();
    const check = () => {
      if (run !== this.run) return;
      const main = this.doc.querySelector<HTMLElement>('#main');
      const ok = variant === 'product' ? !!this.doc.querySelector('[data-land]') : (main?.getBoundingClientRect().height ?? 0) > innerHeight * 0.6;
      if (ok || performance.now() - t0 > 350) requestAnimationFrame(() => run === this.run && go());
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  /** Stages 2–4. */
  private assemble(variant: Variant, back: boolean, run: number) {
    if (!this.veil || !this.stage || run !== this.run) return;
    const veil = this.veil;
    const phone = this.phone();
    const { top, W, H } = this.area();
    const C = phone ? 3 : 5, R = 3;
    const arr = ARR[variant];
    const cells = cut(W, H, C, R, arr.seed + (phone ? 1 : 0));
    const centre = cells.find((c) => c.r === 1 && c.c === Math.floor(C / 2))!;
    const focusEl = variant === 'product' ? this.doc.querySelector('[data-land]') : variant === 'contact' ? this.doc.querySelector('.form-card, form') : null;
    const fr = focusEl?.getBoundingClientRect();
    const ctx = { W, H, focus: (fr && fr.width ? [fr.left + fr.width / 2, fr.top + fr.height / 2 - top] : [W / 2, H / 3]) as Pt };
    const order = arr.order(cells.filter((c) => c !== centre), ctx);
    const stagger = (arr.stagger ?? 36) * (phone ? 1.2 : 1);
    const dur = phone ? 300 : 360;
    const sign = back ? -1 : 1;

    // the page underneath is now the destination – its colour wash lifts so the page shows through the frost
    veil.querySelector('.wash')?.animate([{ opacity: 1 }, { opacity: 0.35 }], { duration: 300, fill: 'forwards' });

    // glass pieces + logo piece, drawn in one SVG over the content area
    const m = Math.min(W / C, H / R);
    const logoW = m * 0.62, markS = logoW * 0.42, wmW = logoW, wmH = (wmW / 6162) * 1433;
    const lx = centre.cx - logoW / 2, ly = centre.cy - (markS + 12 + wmH) / 2;
    const svg = `
      <svg class="pz-glass${phone ? ' lite' : ''}" style="top:${top}px" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="pz-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".45" stop-color="#fff" stop-opacity=".06"/><stop offset=".55" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>
          <linearGradient id="pz-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#C9D3E2" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity=".8"/></linearGradient>
          <linearGradient id="pz-smoke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E2636" stop-opacity=".86"/><stop offset="1" stop-color="#0A0D13" stop-opacity=".92"/></linearGradient>
        </defs>
        ${arr.slots ? cells.map((c) => `<path class="slot" d="${c.d}"/>`).join('') : ''}
        ${order.map((c) => `<g class="pc" style="transform-origin:${f(c.cx)}px ${f(c.cy)}px"><path class="body" d="${c.d}"/><path class="rim" d="${c.d}"/></g>`).join('')}
        <g class="pc logo" style="transform-origin:${f(centre.cx)}px ${f(centre.cy)}px">
          <path class="smoke" d="${centre.d}"/><path class="rim" d="${centre.d}"/>
          <g transform="translate(${f(centre.cx - markS / 2)} ${f(ly)}) scale(${(markS / 200).toFixed(4)})">
            ${PIECES.map((d, i) => `<path class="${i === 3 ? 'mk last' : 'mk'}" d="${d}" fill="${i === 3 ? '#3282F6' : '#F4F6FA'}" stroke="#0E121A" stroke-width="7" stroke-linejoin="round"/>`).join('')}
          </g>
          <g transform="translate(${f(lx)} ${f(ly + markS + 12 + wmH * (1399 / 1433))}) scale(${(wmW / 6162).toFixed(5)})">
            ${WORDMARK.map((d, i, a) => `<path d="${d}" fill="${i === a.length - 1 ? '#3282F6' : '#F4F6FA'}"/>`).join('')}
          </g>
        </g>
      </svg>`;
    this.stage.insertAdjacentHTML('beforeend', svg);
    const glass = this.stage.lastElementChild as SVGSVGElement;
    const groups = Array.from(glass.querySelectorAll<SVGGElement>('g.pc'));

    // holes in the frost where pieces have locked (pieces tessellate exactly, so even-odd is a clean union)
    const open: string[] = [];
    const punch = (d: string) => { open.push(d); veil.style.clipPath = `path(evenodd, "M0 0H${W}V${H}H0Z${open.join('')}")`; };

    order.forEach((c, k) => {
      const g = groups[k];
      const [dx, dy] = arr.from(c, ctx);
      const rot = arr.turn ? (k % 2 ? 1 : -1) * arr.turn : 0;
      const at = k * stagger;
      g.animate(
        [
          { transform: `translate(${dx * sign}px, ${dy * sign}px) rotate(${rot}deg) scale(1.05)`, opacity: 0 },
          { opacity: 1, offset: 0.45 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: dur, delay: at, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' },
      );
      // lock: that part of the page turns clear, the glass keeps only a fine rim
      this.later(() => {
        punch(c.d);
        g.querySelector('.body')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
        g.querySelector('.rim')?.animate([{ strokeOpacity: 1, strokeWidth: 1.6 }, { strokeOpacity: 0.32, strokeWidth: 1 }], { duration: 420, fill: 'forwards' });
      }, at + dur);
    });

    // the SCHLUSS logo – the final piece – settles into the centre
    const lastLock = (order.length - 1) * stagger + dur;
    const logo = groups[groups.length - 1];
    const logoAt = Math.max(0, lastLock - (phone ? 220 : 300));
    const logoDur = phone ? 320 : 380;
    logo.animate(
      [
        { transform: 'translateY(-18px) scale(1.08)', opacity: 0 },
        { opacity: 1, offset: 0.5 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: logoDur, delay: logoAt, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' },
    );
    logo.querySelector('.mk.last')?.animate(
      [{ transform: 'translate(26px, 22px) rotate(10deg)' }, { transform: 'translate(26px, 22px) rotate(10deg)', offset: 0.55 }, { transform: 'none' }],
      { duration: logoDur + 100, delay: logoAt, easing: 'cubic-bezier(.3,1.25,.45,1)', fill: 'both' },
    );
    const lock = logoAt + logoDur + 100;
    this.later(() => {
      punch(centre.d); // the page is complete under the logo
      logo.querySelector('.rim')?.animate([{ strokeOpacity: 0.5 }, { strokeOpacity: 1, offset: 0.3 }, { strokeOpacity: 0.6 }], { duration: 420, fill: 'forwards' });
      glass.classList.add('done');
    }, lock);

    // logo holds, then everything fades: only the finished page remains
    const hold = phone ? 200 : 240, out = phone ? 220 : 260;
    this.later(() => {
      glass.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, easing: 'ease-in', fill: 'forwards' });
      veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, easing: 'ease-in', fill: 'forwards' });
    }, lock + hold);
    this.later(() => this.clear(), lock + hold + out + 40);
  }

  /** Failed/cancelled navigation: lift the frost off the page that is still there. */
  private dissolve() {
    const v = this.veil;
    if (!v) return;
    v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    this.later(() => this.clear(), 180);
  }

  /** The reduced-motion alternative: a short fade of the content. */
  private fadeIn() {
    this.doc.querySelector<HTMLElement>('#main')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
  }

  /** Small interaction: four glass pieces snap together at the pointer – for buttons that act in place. */
  burst(o: Origin) {
    if (!this.stage || this.active) return;
    const h = o.hue ?? HUES.blue;
    const S = 22;
    const NS = 'http://www.w3.org/2000/svg';
    const wrap = this.doc.createElement('div');
    wrap.className = 'pz-burst';
    wrap.style.cssText = `left:${o.x - S}px;top:${o.y - S}px;width:${S * 2}px;height:${S * 2}px`;
    TILE_PIECES.forEach((d, k) => {
      const svg = this.doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      svg.innerHTML = `<path d="${d}" fill="${k === 3 ? h.c1 : 'rgba(255,255,255,.55)'}" stroke="rgba(255,255,255,.9)" stroke-width="5"/>`;
      wrap.appendChild(svg);
      const dx = TILE_CELL[k][0] ? 1 : -1, dy = TILE_CELL[k][1] ? 1 : -1;
      svg.animate(
        [
          { transform: `translate(${dx * 14}px, ${dy * 14}px)`, opacity: 0 },
          { transform: 'none', opacity: 1, offset: 0.55 },
          { transform: 'scale(1.04)', opacity: 0 },
        ],
        { duration: 420, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' },
      );
    });
    this.stage.appendChild(wrap);
    setTimeout(() => wrap.remove(), 460);
  }
}

/** The overlay layer. Placed once, in the root component. */
@Component({
  selector: 'sch-puzzle-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="stage" #stage aria-hidden="true"></div>`,
  styles: `
    :host { position: fixed; inset: 0; z-index: 2000; pointer-events: none; }
    .stage { position: absolute; inset: 0; overflow: hidden; }
    /* frosted sheet: the real page, blurred and tinted with the destination's colours */
    .stage ::ng-deep .pz-veil { position: absolute; left: 0; -webkit-backdrop-filter: blur(16px) saturate(1.25) brightness(1.04); backdrop-filter: blur(16px) saturate(1.25) brightness(1.04);
      background: linear-gradient(135deg, color-mix(in srgb, var(--c1) 14%, transparent), color-mix(in srgb, var(--c2) 10%, transparent)); }
    .stage ::ng-deep .pz-veil .wash { position: absolute; inset: 0; background: radial-gradient(120% 90% at 30% 20%, color-mix(in srgb, var(--c1) 48%, rgba(10,12,18,.55)), color-mix(in srgb, var(--c2) 40%, rgba(10,12,18,.7))); }
    .stage ::ng-deep .pz-veil.lite { -webkit-backdrop-filter: none; backdrop-filter: none; background: color-mix(in srgb, var(--c1) 30%, rgba(14,17,24,.82)); }
    /* glass pieces: clear, with a soft sheen, a fine light rim and a gentle shadow */
    .stage ::ng-deep .pz-glass { position: absolute; left: 0; overflow: visible; }
    .stage ::ng-deep .pz-glass .pc { transform-box: view-box; will-change: transform, opacity; }
    .stage ::ng-deep .pz-glass .body { fill: url(#pz-sheen); }
    .stage ::ng-deep .pz-glass .rim { fill: none; stroke: url(#pz-rim); stroke-width: 1.4; stroke-linejoin: round; }
    .stage ::ng-deep .pz-glass:not(.lite) .pc:not(.logo) { filter: drop-shadow(0 10px 18px rgba(6,10,20,.22)); }
    .stage ::ng-deep .pz-glass.done .pc:not(.logo) { filter: none; }
    .stage ::ng-deep .pz-glass .slot { fill: none; stroke: rgba(255,255,255,.4); stroke-width: 1; stroke-dasharray: 5 6; }
    .stage ::ng-deep .pz-glass .smoke { fill: url(#pz-smoke); }
    .stage ::ng-deep .pz-glass .logo { filter: drop-shadow(0 18px 30px rgba(0,0,0,.35)); }
    .stage ::ng-deep .pz-glass .mk { transform-box: fill-box; transform-origin: center; }
    .stage ::ng-deep .pz-burst { position: absolute; }
    .stage ::ng-deep .pz-burst svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 3px 6px rgba(0,0,0,.25)); }
  `,
})
export class SchPuzzleOverlay {
  private stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  constructor() {
    const svc = inject(PuzzleTransitions);
    afterNextRender(() => svc.attach(this.stage().nativeElement));
  }
}

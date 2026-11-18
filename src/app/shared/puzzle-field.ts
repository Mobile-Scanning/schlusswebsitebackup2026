import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, viewChild } from '@angular/core';
import { HUES, HueKey, TILE_PIECES } from './palette';

interface Piece {
  type: number; // 0..3 – which logo piece
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // rotation (rad)
  vr: number;
  s: number; // size of the piece's 100-unit cell in px
  z: number; // depth 0.4..1 (parallax + opacity)
  c1: string;
  c2: string;
  partner: Piece | null; // when connecting
  lead: boolean;
  t: number; // connection timer
}

/** Offset (in cell units) where piece b sits relative to piece a when they lock together. */
const MATES: Record<string, [number, number]> = { '0-1': [1, 0], '1-0': [-1, 0], '2-3': [1, 0], '3-2': [-1, 0], '0-2': [0, 1], '2-0': [0, -1], '1-3': [0, 1], '3-1': [0, -1] };

/**
 * Floating puzzle pieces drawn on a canvas behind a section.
 * Pieces drift, turn, and now and then two matching pieces glide together and lock
 * (the logo's own tab-and-socket), hold, and drift apart again.
 * - pointer-events: none, aria-hidden – never blocks clicks, forms or reading
 * - pauses when off screen or the tab is hidden; capped pixel ratio; fewer pieces on phones
 * - reduced motion: one still frame
 */
@Component({
  selector: 'sch-puzzle-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #c aria-hidden="true" [class]="'calm-' + calm()"></canvas>`,
  styles: `
    :host { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
    canvas { width: 100%; height: 100%; display: block; }
    .calm-left { -webkit-mask-image: linear-gradient(90deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.18) 48%, #000 72%); mask-image: linear-gradient(90deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.18) 48%, #000 72%); }
    .calm-center { -webkit-mask-image: radial-gradient(60% 55% at 50% 50%, rgba(0,0,0,.15), #000 85%); mask-image: radial-gradient(60% 55% at 50% 50%, rgba(0,0,0,.15), #000 85%); }
    @media (max-width: 900px) { .calm-left, .calm-center { -webkit-mask-image: none; mask-image: none; opacity: .28; } }
  `,
})
export class SchPuzzleField {
  /** Colour families for the pieces. */
  readonly hues = input<HueKey[]>(['blue', 'violet', 'teal', 'amber', 'magenta']);
  /** Pieces per 100 000 px² (capped). */
  readonly density = input(1.4);
  /** Size range of a piece's cell in px. */
  readonly minSize = input(26);
  readonly maxSize = input(70);
  /** Overall opacity of the field. */
  readonly strength = input(0.9);
  /** Keep pieces faint over text: 'left' fades the left side (text column), 'center' the middle. */
  readonly calm = input<'none' | 'left' | 'center'>('none');

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');

  constructor() {
    const host = inject(ElementRef).nativeElement as HTMLElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const cv = this.canvas().nativeElement;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const paths = TILE_PIECES.map((d) => new Path2D(d));
      const reduced = () => document.documentElement.classList.contains('reduce-motion');
      let W = 0, H = 0, dpr = 1, pieces: Piece[] = [], raf = 0, visible = true, last = 0;
      let mx = 0, my = 0; // pointer parallax (-1..1)

      const make = (i: number): Piece => {
        const hk = this.hues()[i % this.hues().length];
        const h = HUES[hk];
        const z = 0.45 + Math.random() * 0.55;
        return {
          type: i % 4, x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 7,
          r: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.16,
          s: this.minSize() + (this.maxSize() - this.minSize()) * z, z,
          c1: h.c1, c2: h.c2, partner: null, lead: false, t: 0,
        };
      };

      const resize = () => {
        const r = host.getBoundingClientRect();
        W = Math.max(1, r.width);
        H = Math.max(1, r.height);
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        const phone = W < 640;
        const n = Math.round(Math.min(phone ? 6 : 14, Math.max(4, ((W * H) / 100000) * this.density() * (phone ? 0.5 : 0.8))));
        while (pieces.length < n) pieces.push(make(pieces.length));
        pieces.length = n;
      };

      const drawPiece = (p: Piece, ox: number, oy: number) => {
        const sc = p.s / 100;
        ctx.save();
        ctx.translate(p.x + ox, p.y + oy);
        ctx.rotate(p.r);
        ctx.scale(sc, sc);
        // centre the piece's cell on its position
        const cx = p.type % 2 ? -150 : -50;
        const cy = p.type > 1 ? -150 : -50;
        ctx.translate(cx, cy);
        ctx.globalAlpha = this.strength() * (0.35 + p.z * 0.6) * (p.partner ? 1 : 0.92);
        // extruded edge (depth)
        ctx.save();
        ctx.translate(5, 7);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fill(paths[p.type]);
        ctx.restore();
        const g = ctx.createLinearGradient(p.type % 2 ? 100 : 0, p.type > 1 ? 100 : 0, p.type % 2 ? 200 : 100, p.type > 1 ? 200 : 100);
        g.addColorStop(0, p.c1);
        g.addColorStop(1, p.c2);
        ctx.fillStyle = g;
        ctx.fill(paths[p.type]);
        ctx.lineWidth = 2.2 / sc;
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.stroke(paths[p.type]);
        ctx.restore();
      };

      const tryConnect = () => {
        const free = pieces.filter((p) => !p.partner);
        if (free.length < 2) return;
        const a = free[Math.floor(Math.random() * free.length)];
        const b = free.filter((q) => q !== a && MATES[`${a.type}-${q.type}`]).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
        if (!b) return;
        a.partner = b; b.partner = a; a.lead = true; b.lead = false; a.t = b.t = 0;
      };

      const step = (dt: number) => {
        for (const p of pieces) {
          if (p.partner && !p.lead) continue;
          p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          const m = 80;
          if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
          if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
        }
        for (const a of pieces) {
          if (!a.partner || !a.lead) continue;
          const b = a.partner;
          a.t += dt;
          const off = MATES[`${a.type}-${b.type}`];
          // target: b locks onto a (same rotation & size), then they hold, then release
          const s = a.s;
          const tx = a.x + (off[0] * Math.cos(a.r) - off[1] * Math.sin(a.r)) * s;
          const ty = a.y + (off[0] * Math.sin(a.r) + off[1] * Math.cos(a.r)) * s;
          if (a.t < 6) {
            const k = Math.min(1, dt * 1.6);
            b.x += (tx - b.x) * k; b.y += (ty - b.y) * k;
            b.r += (a.r - b.r) * k; b.s += (a.s - b.s) * k; b.z += (a.z - b.z) * k;
            b.vx = a.vx; b.vy = a.vy;
          } else {
            b.vx = (Math.random() - 0.5) * 12; b.vy = (Math.random() - 0.5) * 10; b.vr = (Math.random() - 0.5) * 0.2;
            a.partner = null; b.partner = null; a.lead = false;
          }
        }
      };

      const draw = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        for (const p of [...pieces].sort((a, b) => a.z - b.z)) drawPiece(p, mx * 18 * p.z, my * 14 * p.z);
      };

      let nextConnect = 1.2;
      // Pieces drift and connect for a few seconds after the section appears, then settle and stay
      // still (no continuous background motion). Phones get a still frame.
      let alive = matchMedia('(pointer: fine)').matches && innerWidth >= 700 ? 6 : 0;
      const loop = (t: number) => {
        raf = 0;
        if (!visible || reduced() || alive <= 0) { draw(); return; }
        const dt = Math.min(0.05, (t - (last || t)) / 1000);
        last = t;
        alive -= dt;
        step(dt);
        nextConnect -= dt;
        if (nextConnect <= 0) { tryConnect(); nextConnect = 2.5 + Math.random() * 3; }
        draw();
        raf = requestAnimationFrame(loop);
      };
      const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } };

      resize();
      draw();
      start();
      const ro = new ResizeObserver(() => { resize(); draw(); });
      ro.observe(host);
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible) start(); });
      io.observe(host);
      const onVis = () => { visible = !document.hidden; if (visible) start(); };
      document.addEventListener('visibilitychange', onVis);
      // after settling, the pointer still nudges the pieces slightly (one redraw per frame, only while moving)
      let moveRaf = 0;
      const onMove = (e: PointerEvent) => {
        mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5;
        if (alive <= 0 && visible && !moveRaf && !reduced()) moveRaf = requestAnimationFrame(() => { moveRaf = 0; draw(); });
      };
      if (matchMedia('(pointer: fine)').matches) window.addEventListener('pointermove', onMove, { passive: true });
      destroy.onDestroy(() => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointermove', onMove);
      });
    });
  }
}

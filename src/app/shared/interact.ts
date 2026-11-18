import { afterNextRender, DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

const fine = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;
const reduced = () => document.documentElement.classList.contains('reduce-motion');

/**
 * 3D tilt toward the pointer (product tiles, cards). Sets --rx/--ry/--mx/--my so the
 * element's own CSS decides how strongly to react; the light spot follows the pointer.
 * Mouse/trackpad only – touch devices keep a simple lift.
 */
@Directive({ selector: '[schTilt]' })
export class Tilt {
  readonly schTilt = input<number | string>(8);
  constructor() {
    const el = inject(ElementRef).nativeElement as HTMLElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (!fine()) return;
      let raf = 0;
      const move = (e: PointerEvent) => {
        if (reduced()) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
          const max = Number(this.schTilt()) || 8;
          el.style.setProperty('--ry', `${(x - 0.5) * max}deg`);
          el.style.setProperty('--rx', `${(0.5 - y) * max}deg`);
          el.style.setProperty('--mx', `${x * 100}%`);
          el.style.setProperty('--my', `${y * 100}%`);
        });
      };
      const leave = () => {
        cancelAnimationFrame(raf);
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
      destroy.onDestroy(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); });
    });
  }
}

/** Magnetic hover: the element leans a few pixels toward the pointer (hero buttons). */
@Directive({ selector: '[schMagnetic]' })
export class Magnetic {
  constructor() {
    const el = inject(ElementRef).nativeElement as HTMLElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (!fine()) return;
      el.style.transition = 'transform .25s cubic-bezier(.3,1.3,.45,1)';
      const move = (e: PointerEvent) => {
        if (reduced()) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.28}px)`;
      };
      const leave = () => (el.style.transform = '');
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
      destroy.onDestroy(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); });
    });
  }
}

/**
 * Scroll progress of an element through the viewport (0 → 1), written to --p.
 * Drives scroll-linked puzzle assembly with CSS only. Reduced motion: --p is 1 (complete).
 */
@Directive({ selector: '[schScrollProgress]' })
export class ScrollProgress {
  constructor() {
    const el = inject(ElementRef).nativeElement as HTMLElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      let raf = 0;
      const update = () => {
        raf = 0;
        if (reduced()) { el.style.setProperty('--p', '1'); return; }
        const r = el.getBoundingClientRect();
        const vh = innerHeight;
        // 0 when the top enters the bottom of the screen, 1 when the element's middle reaches 40% height
        const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.6 + r.height * 0.5)));
        el.style.setProperty('--p', p.toFixed(3));
      };
      const on = () => { if (!raf) raf = requestAnimationFrame(update); };
      update();
      addEventListener('scroll', on, { passive: true });
      addEventListener('resize', on, { passive: true });
      destroy.onDestroy(() => { removeEventListener('scroll', on); removeEventListener('resize', on); cancelAnimationFrame(raf); });
    });
  }
}

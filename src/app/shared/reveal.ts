import { afterNextRender, DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Fades/slides an element in when it scrolls into view. Content is fully visible in the
 * server-rendered HTML and for reduced-motion users; the effect only applies to elements
 * that start below the fold in a browser.
 */
@Directive({ selector: '[schReveal]' })
export class Reveal {
  /** Optional index – staggers siblings by 80ms each. */
  readonly schReveal = input<number | string>('');
  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const i = this.schReveal();
      if (i !== '' && !isNaN(Number(i))) el.style.setProperty('--stagger', `${Math.min(Number(i), 8) * 80}ms`);
      if (document.documentElement.classList.contains('reduce-motion') || !('IntersectionObserver' in window)) {
        el.classList.add('in');
        return;
      }
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.classList.add('in');
        return;
      }
      el.classList.add('pre');
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              el.classList.add('in');
              el.classList.remove('pre');
              io.disconnect();
            }
          }
        },
        { rootMargin: '0px 0px -8% 0px' },
      );
      io.observe(el);
      destroy.onDestroy(() => io.disconnect());
    });
  }
}

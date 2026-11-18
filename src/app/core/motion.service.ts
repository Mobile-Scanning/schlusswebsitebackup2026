import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

/**
 * Reduced-motion preference: follows the OS setting, and visitors can also switch
 * animations off with the toggle in the footer (remembered in this browser only).
 */
@Injectable({ providedIn: 'root' })
export class MotionService {
  private doc = inject(DOCUMENT);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly reduced = signal(false);

  init() {
    if (!this.browser) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('sch-reduce-motion');
    } catch {
      /* storage blocked – fall back to OS setting */
    }
    const os = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.apply(stored === null ? os : stored === '1');
  }

  toggle() {
    const next = !this.reduced();
    this.apply(next);
    try {
      localStorage.setItem('sch-reduce-motion', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  private apply(v: boolean) {
    this.reduced.set(v);
    this.doc.documentElement.classList.toggle('reduce-motion', v);
  }
}

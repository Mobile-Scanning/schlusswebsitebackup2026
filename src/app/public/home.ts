import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { PublicApi } from '../core/public-api';
import { ORG_LD, SeoService } from '../core/seo.service';
import { Category } from '../core/public-api';
import { Magnetic, ScrollProgress, Tilt } from '../shared/interact';
import { HUES, hueFor, hueStyle, TILE_PIECES } from '../shared/palette';
import { SchPuzzle3d } from '../shared/puzzle3d';
import { SchPuzzleField } from '../shared/puzzle-field';
import { SchHomeLockup } from '../shared/home-lockup';
import { MotionService } from '../core/motion.service';
import { SoonCard } from './soon-card';
import { SchIcon } from '../shared/icons';
import { Reveal } from '../shared/reveal';
import { ProductCardComponent } from './product-card';

const FUN = ['#ff5d8f', '#ffb020', '#22d3a6', '#4c8dff', '#ff7a3d', '#14b8a6', '#8b7bff', '#38bdf8', '#e879f9', '#84cc16'];
const INDUSTRIES = ['Retail & supermarkets', 'Warehousing & logistics', 'Finance & accounting', 'Software & cloud', 'Manufacturing', 'Healthcare', 'Education & training', 'Transport & delivery', 'Business management', 'E-commerce'];

const WHY_ICONS = ['link', 'users', 'play', 'refresh', 'shield', 'headset', 'chart', 'key'];

const STEPS = [
  { icon: 'search', title: 'Explore', body: 'Browse the product range and compare features and pricing.', ...HUES.teal },
  { icon: 'play', title: 'Try or see a demo', body: 'Start a free trial or book a demonstration with our team.', ...HUES.violet },
  { icon: 'key', title: 'License', body: 'Choose the plan that fits – we activate your licence.', ...HUES.amber },
  { icon: 'headset', title: 'Get support', body: 'Learning material, updates and help from SCHLUSS or a local partner.', ...HUES.blue },
];
const WHY_HUES = [HUES.blue, HUES.teal, HUES.violet, HUES.amber, HUES.magenta, HUES.lime, HUES.orange, HUES.blue];

@Component({
  selector: 'sch-home',
  imports: [RouterLink, Reveal, ProductCardComponent, SchIcon, SchPuzzle3d, SchPuzzleField, SoonCard, Tilt, Magnetic, ScrollProgress, SchHomeLockup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  private api = inject(PublicApi);
  protected steps = STEPS;
  protected whyIcons = WHY_ICONS;
  protected pieces = TILE_PIECES;
  protected catStyle = (c: Category) => hueStyle(hueFor(c.slug + ' ' + c.name));
  protected whyStyle = (i: number) => hueStyle(WHY_HUES[i % WHY_HUES.length]);
  private site = toSignal(this.api.site());
  protected home = computed(() => this.site()?.home);
  protected partners = computed(() => this.site()?.partners);
  protected categories = toSignal(this.api.categories().pipe(map((c) => c.filter((x) => x.productCount > 0))), { initialValue: [] });
  private featuredRaw = toSignal(this.api.products({ featured: 1, perPage: 6 }).pipe(map((r) => r.data)), { initialValue: [] });
  private latest = toSignal(this.api.products({ perPage: 6 }).pipe(map((r) => r.data.filter((p) => p.status !== 'coming_soon'))), { initialValue: [] });
  protected featured = computed(() => (this.featuredRaw().length ? this.featuredRaw() : this.latest()).filter((p) => p.status !== 'coming_soon').slice(0, 3));
  protected soon = toSignal(this.api.products({ status: 'coming_soon', perPage: 3 }).pipe(map((r) => r.data)), { initialValue: [] });
  /** Industries for the marquee and the "Built for …" ticker: the live categories, or a sensible default list. */
  protected industries = computed(() => {
    const names = this.categories().map((c) => c.name);
    return (names.length >= 4 ? names : INDUSTRIES).map((name, i) => ({ name, c: FUN[i % FUN.length] }));
  });
  private tick = signal(0);
  protected tickerWord = computed(() => {
    const list = this.industries();
    const n = this.tick();
    const m = list[n % list.length];
    return { n, text: m.name, c: m.c };
  });
  /** Hero title from site content; a ' / ' splits it into the solid and outlined lines. */
  protected title = computed(() => (this.home()?.heroTitle ?? 'The last piece. / The complete picture.').split(' / '));

  constructor() {
    // "Built for …" ticker: a new industry every 2.2 s (browser only; still when motion is reduced).
    if (isPlatformBrowser(inject(PLATFORM_ID)) && !inject(MotionService).reduced()) {
      const t = setInterval(() => this.tick.update((n) => n + 1), 2200);
      inject(DestroyRef).onDestroy(() => clearInterval(t));
    }
    inject(SeoService).set({
      title: 'SCHLUSS – The last piece. The complete picture.',
      description: 'SCHLUSS software for retail, stock management, logistics, business management and IT – connected solutions with free trials, demonstrations and local partner support.',
      path: '/',
      jsonLd: [ORG_LD, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'SCHLUSS', url: 'https://schluss.co.za' }],
    });
  }
}

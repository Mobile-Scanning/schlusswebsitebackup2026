import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { Category, Page, ProductCard, PublicApi } from '../core/public-api';
import { SeoService } from '../core/seo.service';
import { STATUS_LABEL } from '../shared/format';
import { ProductCardComponent } from './product-card';
import { SoonCard } from './soon-card';
import { Reveal } from '../shared/reveal';
import { SchPuzzleField } from '../shared/puzzle-field';
import { hueFor, hueStyle, TILE_PIECES } from '../shared/palette';

type Filters = { q: string; category: string; status: string; type: string; price: string; sort: string; page: number; offering: string };

/** The SCHLUSS marketplace. All filters live in the URL so results are shareable and indexable. */
@Component({
  selector: 'sch-products',
  imports: [ProductCardComponent, SoonCard, RouterLink, Reveal, SchPuzzleField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-hero zone ph" [class.zone-nebula]="comingSoon()" [class.zone-aurora]="!comingSoon()">
      <sch-puzzle-field [hues]="comingSoon() ? ['violet', 'magenta', 'blue'] : ['blue', 'teal', 'amber', 'violet', 'magenta', 'lime']" [density]="1.1" calm="left" />
      <div class="wrap">
        <span class="eyebrow">{{ comingSoon() ? 'Coming soon' : 'Products' }}</span>
        <h1>
          @if (comingSoon()) { The next pieces <span class="grad-text">are taking shape.</span> }
          @else { Software for every <span class="grad-text">part of your business.</span> }
        </h1>
        <p class="lead">
          {{ comingSoon() ? 'Products in development at SCHLUSS. Explore each one, ask for an early demonstration, and see when it launches.' : 'Browse the SCHLUSS range by area – retail, stock, logistics, business management, IT and more – with clear pricing, free trials and demonstrations.' }}
        </p>
      </div>
    </header>

    <div class="body" [class.soon-body]="comingSoon()" [class.zone]="comingSoon()" [class.zone-nebula]="comingSoon()">
      <div class="wrap">
        @if (!comingSoon()) {
          <div class="kinds" role="group" aria-label="What are you looking for?">
            @for (k of kinds; track k[0]) { <button type="button" class="kind" [attr.aria-pressed]="f().offering === k[0]" (click)="set({ offering: k[0] })">{{ k[1] }}</button> }
          </div>
          <div class="cats" role="group" aria-label="Categories">
            <button class="ptile" type="button" [attr.aria-pressed]="!f().category" (click)="set({ category: '' })" style="--accent: #c9d1e2; --accent-2: #8d99b3; --i: 0">All</button>
            @for (c of categories(); track c.id) {
              <button class="ptile" type="button" [attr.aria-pressed]="f().category === c.slug" (click)="set({ category: c.slug })" [style]="catStyle(c)" [style.--i]="$index + 1">
                <svg viewBox="-8 -8 216 216" aria-hidden="true"><path [attr.d]="pieces[$index % 4]" /></svg>{{ c.name }}
              </button>
            }
          </div>
        }

        <form class="bar" role="search" (submit)="$event.preventDefault(); set({ q: search.value })">
          <label class="sr-only" for="q">Search products</label>
          <input #search id="q" class="input" type="search" placeholder="Search products" [value]="f().q" (search)="set({ q: search.value })" />
          <button class="btn btn-ghost btn-sm filt-btn" type="button" (click)="showFilters.set(!showFilters())" [attr.aria-expanded]="showFilters()">Filters{{ activeCount() ? ' (' + activeCount() + ')' : '' }}</button>
          <div class="filters" [class.open]="showFilters()">
            @if (!comingSoon()) {
              <label><span>Availability</span>
                <select class="select" [value]="f().status" (change)="set({ status: sel($event) })">
                  <option value="">Any</option>
                  @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
                </select>
              </label>
              <label><span>Price</span>
                <select class="select" [value]="f().price" (change)="set({ price: sel($event) })">
                  <option value="">Any</option>
                  <option value="free">Free</option>
                  <option value="trial">Free trial</option>
                  <option value="paid">Paid licence / subscription</option>
                  <option value="quote">On quotation</option>
                </select>
              </label>
            }
            @if (types().length > 1) {
              <label><span>Type</span>
                <select class="select" [value]="f().type" (change)="set({ type: sel($event) })">
                  <option value="">Any</option>
                  @for (t of types(); track t) { <option [value]="t">{{ t }}</option> }
                </select>
              </label>
            }
            <label><span>Sort</span>
              <select class="select" [value]="f().sort" (change)="set({ sort: sel($event) })">
                <option value="newest">Newest</option>
                <option value="name">A–Z</option>
                <option value="popular">Most popular</option>
              </select>
            </label>
          </div>
          <button class="sr-only" type="submit">Search</button>
        </form>

        <p class="count mono" aria-live="polite">
          @if (result(); as r) {
            {{ r.meta.total }} product{{ r.meta.total === 1 ? '' : 's' }}
            @if (activeCount()) { · <button class="link" type="button" (click)="clear()">Clear filters</button> }
          } @else { Loading products… }
        </p>
      </div>

      @if (failed()) {
        <div class="wrap"><div class="alert alert-error">We couldn't load products right now. Please refresh the page.</div></div>
      } @else if (result(); as r) {
        @if (r.data.length) {
          @if (groups(); as gs) {
            <!-- Browse by category: each category is its own coloured band -->
            @for (g of gs; track g.slug; let gi = $index) {
              <section class="band zone zone-accent" [style]="g.style" [attr.aria-labelledby]="'band-' + g.slug">
                <div class="wrap">
                  <div class="band-head" schReveal>
                    <span class="band-piece" aria-hidden="true"><svg viewBox="-8 -8 216 216"><path [attr.d]="pieces[gi % 4]" /></svg></span>
                    <div class="band-t">
                      <span class="mono">{{ g.items.length }} product{{ g.items.length === 1 ? '' : 's' }}</span>
                      <h2 [id]="'band-' + g.slug">{{ g.name }}</h2>
                      @if (g.description) { <p>{{ g.description }}</p> }
                    </div>
                    @if (g.slug !== '_none') { <button class="btn btn-ghost btn-sm" type="button" (click)="set({ category: g.slug })">Only {{ g.name }}</button> }
                  </div>
                  <div class="grid-cards">
                    @for (p of g.items; track p.slug; let i = $index) {
                      @if (p.status === 'coming_soon') { <sch-soon-card [product]="p" [schReveal]="i" /> } @else { <sch-product-card [product]="p" [schReveal]="i" /> }
                    }
                  </div>
                </div>
              </section>
            }
          } @else {
            <div class="wrap">
              <div class="grid-cards">
                @for (p of r.data; track p.slug; let i = $index) {
                  @if (comingSoon()) { <sch-soon-card [product]="p" [schReveal]="i" /> } @else { <sch-product-card [product]="p" [schReveal]="i" /> }
                }
              </div>
              @if (pages() > 1) {
                <nav class="pager" aria-label="Pages">
                  <a class="btn btn-ghost btn-sm" [class.disabled]="r.meta.page <= 1" [routerLink]="[]" [queryParams]="{ page: r.meta.page - 1 }" queryParamsHandling="merge" [attr.aria-disabled]="r.meta.page <= 1">Previous</a>
                  <span class="muted">Page {{ r.meta.page }} of {{ pages() }}</span>
                  <a class="btn btn-ghost btn-sm" [class.disabled]="r.meta.page >= pages()" [routerLink]="[]" [queryParams]="{ page: r.meta.page + 1 }" queryParamsHandling="merge" [attr.aria-disabled]="r.meta.page >= pages()">Next</a>
                </nav>
              }
            </div>
          }
        } @else {
          <div class="wrap">
            <div class="empty card">
              @if (activeCount()) {
                <h2>No products match those filters</h2>
                <p>Try a different search or <button class="link" type="button" (click)="clear()">clear the filters</button>.</p>
              } @else if (comingSoon()) {
                <h2>Nothing announced just yet</h2>
                <p>New products will appear here before release. <a routerLink="/contact">Tell us what you need</a>.</p>
              } @else {
                <h2>Our product range is being prepared</h2>
                <p>Products will appear here as they are published. <a routerLink="/request-demo">Request a demo</a> or <a routerLink="/contact">contact us</a> in the meantime.</p>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .ph h1 { font-size: clamp(34px, 5vw, 64px); max-width: 18ch; letter-spacing: -.03em; line-height: 1.04; }
    .ph h1 .grad-text { display: inline; }
    .ph { padding: clamp(48px, 7vw, 96px) 0 clamp(40px, 5vw, 64px); }
    .body { padding: 30px 0 72px; }
    .soon-body { padding-top: 30px; }
    .cats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
    .ptile {
      display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 16px 0 12px; border-radius: 10px; cursor: pointer;
      font: 600 14px var(--f-text); color: var(--heading);
      background: color-mix(in srgb, var(--accent) 10%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
      transition: background .25s ease, border-color .25s ease, transform .3s cubic-bezier(.3,1.3,.45,1), box-shadow .3s ease;
    }
    /* entrance: category pieces snap into the row one after another */
    .ptile { animation: snap .38s cubic-bezier(.3,1.3,.45,1) both; animation-delay: calc(var(--i, 0) * 45ms); }
    @keyframes snap { from { opacity: 0; transform: translateY(-14px) rotate(-6deg) scale(.9); } }
    .band-piece { animation: snap .45s cubic-bezier(.3,1.3,.45,1) .1s both; }
    /* selecting a category connects its marker */
    .ptile[aria-pressed='true'] svg { animation: connect .35s cubic-bezier(.3,1.4,.45,1); }
    @keyframes connect { from { transform: translateX(-8px) rotate(-45deg); } }
    @media (prefers-reduced-motion: reduce) { .ptile, .band-piece, .ptile svg { animation: none !important; } }
    :host-context(html.reduce-motion) .ptile, :host-context(html.reduce-motion) .band-piece, :host-context(html.reduce-motion) .ptile svg { animation: none !important; }
    .ptile svg { width: 20px; height: 20px; overflow: visible; transition: transform .45s cubic-bezier(.3,1.3,.45,1); }
    .ptile path { fill: var(--accent); }
    .ptile:hover { transform: translateY(-2px); border-color: var(--accent); }
    .ptile:hover svg { transform: rotate(90deg); }
    .ptile[aria-pressed='true'] { background: linear-gradient(110deg, var(--accent), var(--accent-2)); border-color: transparent; color: #fff; box-shadow: 0 10px 24px -10px var(--accent); position: relative; }
    .ptile[aria-pressed='true'] path { fill: #fff; }
    /* the selected tile "connects" to the results below with a knob */
    .ptile[aria-pressed='true']::after { content: ''; position: absolute; left: 50%; bottom: -9px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; background: var(--accent-2); clip-path: inset(50% 0 0 0); }
    .bar { display: grid; grid-template-columns: minmax(200px, 1fr) auto; gap: 12px; align-items: end; }
    .kinds { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
    .kind { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); font: 500 14px var(--f-text, inherit); cursor: pointer; }
    .kind:hover { color: var(--heading); border-color: var(--accent, #3282f6); }
    .kind[aria-pressed='true'] { background: linear-gradient(110deg, #3282f6, #7b5cff); color: #fff; border-color: transparent; }
    .filters { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .filters label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
    .filt-btn { display: none; }
    @media (max-width: 720px) { .filt-btn { display: inline-flex; } .filters { display: none; } .filters.open { display: grid; } }
    @media (min-width: 721px) { .bar { grid-template-columns: 1fr; } }
    .count { margin: 18px 0 8px; }
    .link { background: none; border: 0; padding: 0; color: var(--link); font: inherit; cursor: pointer; text-decoration: underline; }
    .band { padding: clamp(40px, 5vw, 64px) 0; border-top: 1px solid var(--line); }
    .band-head { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 26px; }
    .band-piece { width: 64px; height: 64px; flex-shrink: 0; }
    .band-piece svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 10px 16px color-mix(in srgb, var(--accent) 55%, transparent)); }
    .band-piece path { fill: var(--accent); stroke: var(--accent-glow); stroke-width: 6; }
    .band-t { flex: 1; min-width: 220px; }
    .band-t .mono { color: var(--accent-glow); }
    .band-t h2 { font-size: clamp(24px, 3vw, 34px); margin: 4px 0 4px; }
    .band-t p { margin: 0; color: var(--fg); max-width: 60ch; }
    .soon-body .grid-cards { gap: 24px; }
    .pager { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 28px; }
    .disabled { pointer-events: none; opacity: .45; }
    .empty { text-align: center; padding: 48px 20px; }
    .empty h2 { font-size: 22px; }
    .empty p { color: var(--muted); margin: 0; }
  `,
})
export class ProductsPage {
  /** Set via route data for /coming-soon. */
  readonly comingSoon = input(false);
  private api = inject(PublicApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected showFilters = signal(false);
  protected kinds: [string, string][] = [['', 'Everything'], ['software', 'Software products'], ['learning', 'Learning content'], ['training', 'Training & courses']];
  protected statuses = Object.entries(STATUS_LABEL).filter(([k]) => k !== 'coming_soon' && k !== 'discontinued');
  protected categories = toSignal(this.api.categories().pipe(map((c) => c.filter((x) => x.productCount > 0))), { initialValue: [] });
  protected types = toSignal(this.api.productTypes().pipe(catchError(() => of([] as string[]))), { initialValue: [] as string[] });

  private qp = toSignal(this.route.queryParamMap, { requireSync: true });
  protected f = computed<Filters>(() => {
    const q = this.qp();
    return {
      q: q.get('q') ?? '',
      category: q.get('category') ?? '',
      status: q.get('status') ?? '',
      type: q.get('type') ?? '',
      price: q.get('price') ?? '',
      offering: q.get('offering') ?? '',
      sort: q.get('sort') ?? 'newest',
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });
  protected activeCount = computed(() => ['q', 'category', 'status', 'type', 'price', 'offering'].filter((k) => this.f()[k as keyof Filters]).length);

  private load$ = combineLatest([toObservable(this.f), toObservable(this.comingSoon)]).pipe(
    switchMap(([f, soon]) =>
      this.api.products({ ...f, status: soon ? 'coming_soon' : f.status, perPage: this.browseMode(f, soon) ? 48 : 12 }).pipe(
        map((r) => ({ ok: true as const, r })),
        catchError(() => of({ ok: false as const, r: null })),
        startWith(null),
      ),
    ),
  );
  private state = toSignal(this.load$, { initialValue: null });
  protected result = computed<Page<ProductCard> | null>(() => this.state()?.r ?? null);
  protected failed = computed(() => this.state()?.ok === false);
  protected pieces = TILE_PIECES;
  protected catStyle = (c: Category) => hueStyle(hueFor(c.slug + ' ' + c.name));
  /** Browse mode: no filters, first page → products grouped into category bands. */
  private browseMode(f: Filters, soon: boolean) {
    return !soon && !f.q && !f.category && !f.status && !f.type && !f.price && !f.offering && f.page === 1;
  }
  protected groups = computed(() => {
    const r = this.result();
    if (!r || !this.browseMode(this.f(), this.comingSoon()) || r.meta.total > r.data.length) return null;
    const cats = this.categories();
    const order = new Map(cats.map((c, i) => [c.slug, i]));
    const map = new Map<string, { slug: string; name: string; description: string | null; items: ProductCard[]; style: Record<string, string> }>();
    for (const p of r.data) {
      const slug = p.category?.slug ?? '_none';
      if (!map.has(slug)) {
        const c = cats.find((x) => x.slug === slug);
        map.set(slug, { slug, name: p.category?.name ?? 'Other products', description: c?.description ?? null, items: [], style: hueStyle(hueFor(p.category ? p.category.slug + ' ' + p.category.name : 'other')) });
      }
      map.get(slug)!.items.push(p);
    }
    return [...map.values()].sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
  });
  protected pages = computed(() => {
    const r = this.result();
    return r ? Math.max(1, Math.ceil(r.meta.total / r.meta.perPage)) : 1;
  });

  constructor() {
    const soon = this.route.snapshot.data['comingSoon'] === true;
    inject(SeoService).set(
      soon
        ? { title: 'Coming soon', description: 'Upcoming SCHLUSS software products – see what is in development and request an early demonstration.', path: '/coming-soon' }
        : { title: 'Products', description: 'Browse SCHLUSS software: retail, stock management, logistics, business management, finance and IT solutions with clear pricing, trials and demos.', path: '/products' },
    );
  }

  protected sel(e: Event) {
    return (e.target as HTMLSelectElement).value;
  }

  set(patch: Partial<Filters>) {
    const next: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(patch)) next[k] = v === '' || v === 'newest' ? null : (v as string);
    next['page'] = null; // any filter change returns to page 1
    void this.router.navigate([], { queryParams: next, queryParamsHandling: 'merge', replaceUrl: true });
  }

  clear() {
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }
}

import { SchPuzzleField } from '../shared/puzzle-field';
import { Reveal } from '../shared/reveal';
import { HUES, hueStyle } from '../shared/palette';
import { ChangeDetectionStrategy, Component, RESPONSE_INIT, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { PublicApi } from '../core/public-api';
import { SeoService } from '../core/seo.service';
import { SECTION_LABEL, SECTION_ORDER } from '../shared/format';
import { NotFound } from '../pages/legal';

/** Learning Centre: guides, manuals, videos and FAQs across all products. */
@Component({
  selector: 'sch-learning',
  imports: [RouterLink, SchPuzzleField, Reveal],
  host: { style: '--accent: #8FD94B; --accent-2: #2BB673; --accent-glow: #CFF7A6' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-hero zone zone-meadow">
      <sch-puzzle-field [hues]="['lime', 'teal', 'blue']" calm="left" />
      <div class="wrap">
        <span class="eyebrow">Learning Centre</span>
        <h1>Learn every piece.</h1>
        <p class="lead">Step-by-step guides, manuals, videos and answers for SCHLUSS products. Some material is for registered customers or partners – sign in to open it.</p>
      </div>
    </header>
    <div class="wrap body">
      <form class="bar" role="search" (submit)="$event.preventDefault(); set({ q: q.value })">
        <label class="sr-only" for="lq">Search learning material</label>
        <input #q id="lq" class="input" type="search" placeholder="Search guides and videos" [value]="qp().get('q') ?? ''" (search)="set({ q: q.value })" />
        <select class="select" aria-label="Product" [value]="qp().get('product') ?? ''" (change)="set({ product: val($event) })">
          <option value="">All products</option>
          @for (p of products(); track p.slug) { <option [value]="p.slug">{{ p.name }}</option> }
        </select>
        <select class="select" aria-label="Topic" [value]="qp().get('section') ?? ''" (change)="set({ section: val($event) })">
          <option value="">All topics</option>
          @for (s of sections; track s) { <option [value]="s">{{ label[s] }}</option> }
        </select>
      </form>
      @if (items(); as list) {
        @if (list.length) {
          <!-- The learning path: topics in the order you'd learn them, joined like puzzle pieces -->
          <nav class="path" aria-label="Topics">
            @for (g of groups(); track g.section; let gi = $index) {
              <a class="step" routerLink="." [fragment]="'t-' + g.section" queryParamsHandling="preserve" [style]="topicStyle(gi)" [style.--i]="gi">
                <span class="n mono">{{ gi + 1 }}</span>{{ label[g.section] ?? g.section }}<span class="c mono">{{ g.items.length }}</span>
              </a>
            }
          </nav>
          @for (g of groups(); track g.section; let gi = $index) {
            <section class="grp" [id]="'t-' + g.section" [style]="topicStyle(gi)">
              <div class="grp-h" schReveal><span class="mono">Topic {{ gi + 1 }} of {{ groups().length }}</span><h2>{{ label[g.section] ?? g.section }}</h2></div>
              <div class="grid-cards">
                @for (l of g.items; track l.id; let i = $index) {
                  <a class="item tab" data-launch [routerLink]="['/learning', l.id]" [schReveal]="i">
                    <span class="kind">{{ kindLabel[l.kind] ?? l.kind }}@if (l.locked) { · {{ l.visibility === 'partner' ? 'Partners only' : 'Sign in to open' }} }</span>
                    <h3>{{ l.title }}</h3>
                    @if (l.summary) { <p class="muted">{{ l.summary }}</p> }
                    @if (l.product) { <span class="prod">{{ l.product.name }}</span> }
                  </a>
                }
              </div>
            </section>
          }
        } @else {
          <div class="card empty">
            <h2>No learning material found</h2>
            <p class="muted">@if (filtered()) { Try another search or topic. } @else { Guides and videos will appear here as products are released. Need help now? <a routerLink="/contact">Contact us</a>. }</p>
          </div>
        }
      } @else {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
  styles: `
    .body { padding-top: 32px; }
    .bar { background: var(--surface); padding: 0; border: 0; display: grid; grid-template-columns: 1fr 220px 220px; gap: 12px; margin-bottom: 28px; }
    @media (max-width: 760px) { .bar { grid-template-columns: 1fr; } }
    .path { display: flex; flex-wrap: wrap; gap: 0; margin: 0 0 36px; }
    .step { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px 10px 10px; margin: 0 6px 8px 0; border-radius: 10px; font-weight: 600; font-size: 14px; color: var(--heading); text-decoration: none !important;
      background: color-mix(in srgb, var(--accent) 14%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); position: relative; transition: translate .3s var(--ease), background .3s; }
    .step { animation: join .4s cubic-bezier(.3,1.3,.45,1) both; animation-delay: calc(var(--i, 0) * 70ms); }
    @keyframes join { from { opacity: 0; transform: translateX(-16px); } }
    @media (prefers-reduced-motion: reduce) { .step { animation: none; } }
    :host-context(html.reduce-motion) .step { animation: none; }
    .step:hover { translate: 0 -2px; background: color-mix(in srgb, var(--accent) 26%, var(--surface)); }
    .step:not(:last-child)::after { content: ''; position: absolute; right: -10px; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%; background: var(--accent); clip-path: inset(0 0 0 50%); z-index: 1; }
    .n { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #0a0c14; font-weight: 700; }
    .c { color: var(--muted); }
    .grp { margin-bottom: 48px; scroll-margin-top: calc(var(--header-h) + 20px); }
    .grp-h { margin-bottom: 8px; }
    .grp-h .mono { color: var(--accent); }
    .grp h2 { font-size: 24px; margin-top: 4px; }
    .item { display: grid; gap: 6px; align-content: start; margin-top: 12px; padding: 22px; border-radius: var(--r-lg); border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line)); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 9%, var(--surface)), var(--surface) 60%); color: var(--fg); text-decoration: none !important; transition: border-color .2s ease, box-shadow .3s ease, translate .3s var(--ease); }
    .item:hover { border-color: var(--accent); box-shadow: 0 18px 36px -18px var(--accent); translate: 0 -3px; }
    .item h3 { color: var(--heading); }
    .item h3 { font-size: 17px; margin: 0; }
    .item p { margin: 0; font-size: 14px; }
    .kind { font: 500 11px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
    .prod { font-size: 13px; color: var(--muted); }
    .empty { text-align: center; padding: 40px 20px; } .empty h2 { font-size: 22px; }
  `,
})
export class LearningPage {
  private api = inject(PublicApi);
  private router = inject(Router);
  protected label = SECTION_LABEL;
  protected sections = SECTION_ORDER.filter((s) => !['sales', 'marketing'].includes(s));
  protected kindLabel: Record<string, string> = { document: 'Document', video: 'Video', article: 'Guide', faq: 'FAQ', template: 'Template', link: 'Link' };
  protected qp = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  protected products = toSignal(this.api.products({ perPage: 48, sort: 'name' }).pipe(map((r) => r.data), catchError(() => of([]))), { initialValue: [] });
  protected items = toSignal(
    toObservable(this.qp).pipe(
      switchMap((q) => this.api.learning({ q: q.get('q'), product: q.get('product'), section: q.get('section') }).pipe(catchError(() => of([])), startWith(null))),
    ),
    { initialValue: null },
  );
  protected filtered = computed(() => ['q', 'product', 'section'].some((k) => this.qp().get(k)));
  private topicHues = [HUES.lime, HUES.teal, HUES.blue, HUES.violet, HUES.amber, HUES.magenta, HUES.orange];
  protected topicStyle = (i: number) => hueStyle(this.topicHues[i % this.topicHues.length]);
  protected groups = computed(() => SECTION_ORDER.map((s) => ({ section: s, items: (this.items() ?? []).filter((i) => i.section === s) })).filter((g) => g.items.length));

  constructor() {
    inject(SeoService).set({ title: 'Learning Centre', description: 'Guides, installation manuals, training videos and FAQs for SCHLUSS software products.', path: '/learning' });
  }
  protected val(e: Event) {
    return (e.target as HTMLSelectElement).value;
  }
  set(patch: Record<string, string>) {
    const qp: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(patch)) qp[k] = v || null;
    void this.router.navigate([], { queryParams: qp, queryParamsHandling: 'merge', replaceUrl: true });
  }
}

/** A single learning item – article text, embedded video or file link. Locked items prompt sign-in. */
@Component({
  selector: 'sch-learning-item',
  imports: [RouterLink, NotFound],
  host: { style: '--accent: #8FD94B; --accent-2: #2BB673; --accent-glow: #CFF7A6' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state(); as s) {
      @if (s.missing) { <sch-not-found /> }
      @else if (s.item; as l) {
        <header class="page-hero zone zone-meadow">
          <div class="wrap">
            <nav class="crumbs"><a routerLink="/products">Products</a>@if (l.product) { <span>/</span><a [routerLink]="['/products', l.product.slug]" fragment="learning">{{ l.product.name }}</a> }</nav>
            <span class="eyebrow">{{ label[l.section] ?? l.section }}</span>
            <h1>{{ l.title }}</h1>
            @if (l.summary) { <p class="lead">{{ l.summary }}</p> }
          </div>
        </header>
        <article class="wrap doc">
          @if (l.locked) {
            <div class="card lock">
              @if (l.visibility === 'partner') {
                <h2>For SCHLUSS partners</h2>
                <p class="muted">This material is available to approved business partners.</p>
                <div class="ctas">
                  @if (!auth.user()) { <a class="btn btn-primary" routerLink="/login" [queryParams]="{ next: url }">Partner sign in</a> }
                  <a class="btn btn-ghost" routerLink="/partners">Become a partner</a>
                </div>
              } @else {
                <h2>Sign in to open this</h2>
                <p class="muted">This material is available to registered SCHLUSS customers. It's free to register.</p>
                <div class="ctas"><a class="btn btn-primary" routerLink="/login" [queryParams]="{ next: url }">Sign in</a><a class="btn btn-ghost" routerLink="/register">Create an account</a></div>
              }
            </div>
          } @else {
            @if (embed()) { <div class="frame"><iframe [src]="embed()" [title]="l.title" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div> }
            @if (l.body) { <div class="prose body">{{ l.body }}</div> }
            @if (l.url && !l.embed) { <p><a class="btn btn-primary" [href]="l.url" target="_blank" rel="noopener">{{ l.kind === 'link' ? 'Open link' : 'Open document' }}</a></p> }
          }
        </article>
      }
    } @else { <header class="page-hero"><div class="wrap"><p>Loading…</p></div></header> }
  `,
  styles: `
    .doc { max-width: 860px; padding-top: 32px; padding-bottom: 48px; }
    .crumbs { display: flex; gap: 8px; font-size: 14px; color: var(--muted); margin-bottom: 14px; flex-wrap: wrap; }
    .crumbs a { color: var(--muted); }
    .lock { margin-top: 0; } .lock h2 { font-size: 20px; }
    .ctas { display: flex; gap: 10px; flex-wrap: wrap; }
    .frame { position: relative; aspect-ratio: 16/9; margin: 24px 0; border-radius: var(--r); overflow: hidden; border: 1px solid var(--line); background: #000; }
    .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .body { margin-top: 24px; font-size: 17px; }
  `,
})
export class LearningItemPage {
  readonly id = input.required<string>();
  protected auth = inject(AuthService);
  private api = inject(PublicApi);
  private sanitizer = inject(DomSanitizer);
  private seo = inject(SeoService);
  protected label = SECTION_LABEL;
  protected url = inject(Router).url;
  protected state = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        this.api.learningItem(Number(id)).pipe(
          map((item) => {
            this.seo.set({ title: item.title, description: item.summary || `${item.title} – SCHLUSS`, path: `/learning/${item.id}`, noindex: item.locked });
            return { item, missing: false };
          }),
          catchError(() => {
            this.notFound();
            return of({ item: null, missing: true });
          }),
        ),
      ),
    ),
  );
  private response = inject(RESPONSE_INIT, { optional: true });
  private notFound() {
    if (this.response) this.response.status = 404;
    this.seo.set({ title: 'Not found', description: 'This learning item does not exist.', path: '/learning', noindex: true });
  }
  protected embed = computed(() => {
    const e = this.state()?.item?.embed;
    return e && /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(e) ? this.sanitizer.bypassSecurityTrustResourceUrl(e) : null;
  });
}

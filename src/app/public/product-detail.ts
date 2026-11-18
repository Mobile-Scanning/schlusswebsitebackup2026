import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, RESPONSE_INIT, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { OFFERING_NAME, ProductDetail, ProductMedia, PublicApi } from '../core/public-api';
import { SeoService } from '../core/seo.service';
import { SchMark } from '../shared/brand';
import { pricingLine, money, PLATFORM_LABEL, planPrice, SECTION_LABEL, SECTION_ORDER, STATUS_CLASS, STATUS_LABEL } from '../shared/format';
import { Reveal } from '../shared/reveal';
import { NotFound } from '../pages/legal';
import { productArt } from './product-card';
import { HUES, HueKey, hueStyle, productHue } from '../shared/palette';
import { SchPuzzleField } from '../shared/puzzle-field';
import { DemoForm } from './demo-form';
import { TrialPanel } from './trial-panel';
import { DemoDownload } from './demo-download';
import { InstallerPanel, PurchaseForm } from './installer-panel';
import { ContentLibrary } from './content-library';
import { SchIcon } from '../shared/icons';

const VIDEO_ROLE: Record<string, string> = {
  intro_video: 'Introduction',
  walkthrough: 'Product walkthrough',
  feature_video: 'Feature demonstration',
  install_tutorial: 'Installation tutorial',
  training_video: 'Training',
  demo_video: 'Demo',
};

@Component({
  selector: 'sch-product-detail',
  imports: [RouterLink, SchMark, DatePipe, DemoForm, Reveal, NotFound, SchIcon, SchPuzzleField, TrialPanel, DemoDownload, InstallerPanel, PurchaseForm, ContentLibrary, NgTemplateOutlet],
  host: { '[style]': 'hostStyle()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
})
export class ProductDetailPage {
  readonly slug = input.required<string>();
  private api = inject(PublicApi);
  private seo = inject(SeoService);
  private sanitizer = inject(DomSanitizer);
  protected platformLabel = PLATFORM_LABEL;
  protected sectionLabel = SECTION_LABEL;
  protected planPrice = planPrice;
  protected videoRole = VIDEO_ROLE;
  private lightbox = viewChild<ElementRef<HTMLDialogElement>>('lightbox');
  protected shown = signal<{ url: string; title: string } | null>(null);
  /** The content library section shows once the browser knows there is content for this visitor. */
  protected libraryShown = signal(false);
  protected libraryCount = signal(0);
  protected offeringName = OFFERING_NAME;
  /** Learning content and training courses: lessons first, no software sections. */
  protected isLearning = computed(() => ['learning', 'training'].includes(this.p()?.offeringType ?? ''));

  private state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((s) =>
        this.api.product(s).pipe(
          tap((p) => this.setSeo(p)),
          map((p) => ({ p, missing: false })),
          catchError(() => {
            this.notFound();
            return of({ p: null, missing: true });
          }),
        ),
      ),
    ),
  );
  protected p = computed(() => this.state()?.p ?? null);
  /** The product's colour identity (from its category) and its puzzle artwork. */
  protected hue = computed(() => { const p = this.p(); return p ? productHue(p) : HUES.blue; });
  protected hostStyle = computed(() => hueStyle(this.hue()));
  protected art = computed(() => { const p = this.p(); return p ? productArt(p.slug) : []; });
  protected hueKey = computed(() => this.hue().key as HueKey);
  protected fieldHues = computed(() => [this.hueKey(), "blue" as HueKey]);
  protected missing = computed(() => this.state()?.missing ?? false);
  protected loading = computed(() => !this.state());
  protected statusLabel = computed(() => (this.p() ? STATUS_LABEL[this.p()!.status] : ''));
  protected statusClass = computed(() => (this.p() ? STATUS_CLASS[this.p()!.status] : ''));
  protected screenshots = computed(() => this.p()?.media.filter((m) => ['screenshot', 'gallery', 'promo', 'feature_image'].includes(m.role)) ?? []);
  protected videos = computed(() => (this.p()?.media.filter((m) => m.embed || m.kind === 'video') ?? []).map((v) => this.videoTile(v)));
  protected demoVideos = computed(() => this.videos().filter((v) => v.role === 'demo_video'));
  protected otherVideos = computed(() => this.videos().filter((v) => v.role !== 'demo_video'));
  /** Demo section shows when anything demo-related is configured for this product. */
  protected hasDemo = computed(() => this.demoEnabled() || this.demoVideos().length > 0 || !!this.p()?.demoOptions.interactiveUrl);
  /** Free trial: the product offers trial days and can be trialled now (not coming soon / discontinued). */
  protected trialOn = computed(() => { const p = this.p(); return !!p?.trialDays && ['available', 'demo_available', 'beta'].includes(p.status); });
  /** Learning materials for this product, split by type so videos and documents look different. */
  protected learningTypes = computed(() => {
    const items = [...(this.p()?.learning ?? [])].sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
    const type = (l: (typeof items)[number]) => (l.kind === 'video' || l.mediaKind === 'video' || l.mediaKind === 'external_video' ? 'video' : l.kind === 'document' || l.kind === 'template' || l.mediaKind === 'pdf' || l.mediaKind === 'document' ? 'docs' : 'guides');
    return [
      { key: 'guides', label: 'Guides & tutorials', items: items.filter((l) => type(l) === 'guides') },
      { key: 'docs', label: 'Manuals, PDFs & documents', items: items.filter((l) => type(l) === 'docs') },
      { key: 'video', label: 'Video lessons', items: items.filter((l) => type(l) === 'video') },
    ].filter((g) => g.items.length);
  });
  /* ---- Tab indicator: a small puzzle marker that slides to the section you're reading ---- */
  protected active = signal('');
  private tabsEl = viewChild<ElementRef<HTMLElement>>('tabs');
  protected ind = computed(() => {
    const id = this.active();
    this.nav();
    const a = this.tabsEl()?.nativeElement.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    return a ? { x: a.offsetLeft, w: a.offsetWidth } : { x: 0, w: 0 };
  });
  private watchSections = afterRenderEffect(() => {
    if (!this.p() || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) this.active.set(seen.target.id);
      },
      { rootMargin: '-35% 0px -55% 0px' },
    );
    document.querySelectorAll('.content .block[id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
  protected playing = signal<ReturnType<ProductDetailPage['videoTile']> | null>(null);
  private player = viewChild<ElementRef<HTMLDialogElement>>('player');
  protected play(v: ReturnType<ProductDetailPage['videoTile']>) {
    this.playing.set(v);
    this.player()?.nativeElement.showModal();
  }
  private videoTile(v: ProductMedia) {
    const yt = v.embed?.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/)?.[1];
    const d = v.duration ?? null;
    return {
      ...v,
      safe: v.embed ? this.trust(v.embed) : null,
      label: v.caption || v.title,
      thumb: v.thumbnail || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null),
      duration: d ? `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}` : null,
    };
  }
  protected latest = computed(() => this.p()?.versions.find((v) => v.latest) ?? this.p()?.versions[0] ?? null);
  protected soon = computed(() => this.p()?.status === 'coming_soon');
  protected learningGroups = computed(() => {
    const items = this.p()?.learning ?? [];
    return SECTION_ORDER.map((s) => ({ section: s, items: items.filter((i) => i.section === s) })).filter((g) => g.items.length);
  });
  protected demoEnabled = computed(() => {
    const d = this.p()?.demoOptions ?? {};
    // The request form is on unless the admin switched it off explicitly.
    return d.requestForm !== false && this.p()?.status !== 'discontinued';
  });
  protected nav = computed(() => {
    const p = this.p();
    if (!p) return [];
    return [
      ['overview', 'Overview'],
      this.screenshots().length ? ['images', 'Images'] : null,
      p.features.length || p.benefits.length ? ['features', 'Features'] : null,
      this.hasDemo() ? ['demo', 'Demo'] : null,
      this.p()?.demo ? ['download', 'Demo download'] : this.trialOn() ? ['trial', 'Free trial'] : null,
      this.libraryShown() ? ['library', this.isLearning() ? 'Lessons' : 'Videos & tutorials'] : null,
      this.otherVideos().length ? ['videos', 'Videos'] : null,
      p.learning.length ? ['learning', 'Learning'] : null,
      p.installer ? ['installer', 'Full version'] : null,
      p.plans.length ? ['pricing', 'Pricing'] : null,
      !this.soon() && p.status !== 'discontinued' && p.offeringFeatures?.purchase ? ['buy', 'Buy'] : null,
      p.versions.length ? ['versions', 'Versions'] : null,
      p.faqs.length ? ['faq', 'FAQ'] : null,
    ].filter(Boolean) as string[][];
  });

  private response = inject(RESPONSE_INIT, { optional: true });
  private notFound() {
    if (this.response) this.response.status = 404; // real 404 for search engines
    this.seo.set({ title: 'Product not found', description: 'This product does not exist or is no longer available.', path: '/products', noindex: true });
  }

  private trust(url: string): SafeResourceUrl {
    // Only youtube-nocookie.com / player.vimeo.com URLs are produced by the API's embed builder.
    return /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(url) ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : '';
  }

  protected open(url: string | null, title: string) {
    if (!url) return;
    this.shown.set({ url, title });
    this.lightbox()?.nativeElement.showModal();
  }

  private setSeo(p: ProductDetail) {
    const desc = p.seo.description || p.shortDescription || p.tagline || `${p.name} by SCHLUSS.`;
    const priced = p.plans.filter((pl) => pl.price_cents !== null);
    this.seo.set({
      title: p.seo.title || `${p.name}${p.tagline ? ' – ' + p.tagline : ''}`,
      description: desc.slice(0, 300),
      path: `/products/${p.slug}`,
      image: p.image || p.logo,
      type: 'product',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: p.name,
        description: desc,
        applicationCategory: 'BusinessApplication',
        operatingSystem: p.platforms.map((x) => PLATFORM_LABEL[x] ?? x).join(', ') || undefined,
        softwareVersion: p.versions[0]?.version,
        image: p.image || p.logo ? 'https://schluss.co.za' + (p.image || p.logo) : undefined,
        brand: { '@type': 'Brand', name: 'SCHLUSS' },
        offers: priced.length
          ? priced.map((pl) => ({ '@type': 'Offer', name: pl.name, price: (pl.price_cents! / 100).toFixed(2), priceCurrency: pl.currency, url: `https://schluss.co.za/products/${p.slug}` }))
          : undefined,
      },
    });
  }

  protected priceSummary = computed(() => {
    const plans = this.p()?.plans ?? [];
    const priced = plans.filter((x) => x.price_cents !== null && !['free', 'quote'].includes(x.model)).sort((a, b) => a.price_cents! - b.price_cents!);
    const from = priced[0];
    return pricingLine({
      hasFree: plans.some((x) => x.model === 'free'),
      quoteOnly: plans.length > 0 && plans.every((x) => x.model === 'quote'),
      hasQuote: plans.some((x) => x.model === 'quote'),
      fromCents: from ? from.price_cents : null,
      currency: from?.currency ?? 'ZAR',
      period: from?.billing_period ?? 'none',
      unit: from?.unit ?? 'licence',
      planCount: plans.length,
    });
  });
  protected money = money;
}

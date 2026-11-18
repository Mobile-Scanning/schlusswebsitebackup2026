import { HttpClient, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { inject, Injectable, REQUEST } from '@angular/core';
import { firstValueFrom, Observable, shareReplay } from 'rxjs';

/**
 * During server-side rendering there is no browser origin, so relative "/api/..." URLs are
 * resolved against the incoming request's origin. Responses are transferred to the browser
 * by Angular's hydration cache, so the browser doesn't fetch the same data twice.
 */
export const apiOriginInterceptor: HttpInterceptorFn = (req, next) => {
  const incoming = inject(REQUEST, { optional: true });
  if (incoming && req.url.startsWith('/')) {
    const origin = process.env['INTERNAL_API_ORIGIN'] || new URL(incoming.url).origin;
    return next(req.clone({ url: origin + req.url }));
  }
  return next(req);
};

/* ----------------------------- Types ----------------------------- */
export interface Pricing {
  hasFree: boolean;
  quoteOnly: boolean;
  hasQuote: boolean;
  fromCents: number | null;
  currency: string;
  period: string;
  unit: string;
  planCount: number;
}
export interface ProductCard {
  slug: string;
  name: string;
  tagline: string | null;
  shortDescription: string | null;
  status: ProductStatus;
  productType: string | null;
  offeringType?: OfferingType;
  featured: boolean;
  trialDays: number | null;
  demoAvailable: boolean;
  logo: string | null;
  image: string | null;
  /** Dedicated "Coming soon" / preview image (admin: product step 1). */
  previewImage?: string | null;
  expectedRelease: string | null;
  category: { name: string; slug: string } | null;
  pricing?: Pricing;
  version: string | null;
}
export type ProductStatus = 'available' | 'coming_soon' | 'beta' | 'demo_available' | 'unavailable' | 'discontinued';
export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  productCount: number;
}
export interface Plan {
  id: number;
  name: string;
  model: string;
  price_cents: number | null;
  currency: string;
  billing_period: 'none' | 'month' | 'year';
  unit: 'licence' | 'user' | 'device';
  price_includes_vat: boolean;
  conditions: string | null;
  inclusions: string[];
  max_devices: number | null;
  is_highlighted: boolean;
}
export interface LearningItem {
  id: number;
  section: string;
  kind: string;
  title: string;
  summary: string | null;
  locked: boolean;
  visibility: string;
  body?: string | null;
  url: string | null;
  embed?: string | null;
  mediaKind?: string | null;
  product?: { name: string; slug: string } | null;
}
export type OfferingType = 'software' | 'learning' | 'training' | 'development' | 'other';
export const OFFERING_NAME: Record<OfferingType, string> = { software: 'Software', learning: 'Learning content', training: 'Training course', development: 'In development', other: 'Offering' };
export interface ProductDetail {
  offeringType: OfferingType;
  offeringFeatures: { installer: boolean; demo: boolean; trial: boolean; pricing: boolean; purchase: boolean; learning: boolean };
  slug: string;
  name: string;
  tagline: string | null;
  shortDescription: string | null;
  description: string | null;
  status: ProductStatus;
  productType: string | null;
  category: { name: string; slug: string } | null;
  logo: string | null;
  image: string | null;
  previewImage?: string | null;
  platforms: string[];
  systemRequirements: string | null;
  trialDays: number | null;
  demoOptions: { requestForm?: boolean; scheduled?: boolean; video?: boolean; interactiveUrl?: string; downloadable?: boolean };
  expectedRelease: string | null;
  seo: { title: string | null; description: string | null };
  features: { title: string; body: string | null; icon: string | null }[];
  benefits: { title: string; body: string | null; icon: string | null }[];
  faqs: { title: string; body: string | null }[];
  plans: Plan[];
  media: ProductMedia[];
  versions: { version: string; name: string | null; releaseDate: string | null; notes: string | null; latest: boolean; recommended: boolean; requirements: string | null; platforms: string[] }[];
  learning: LearningItem[];
  notice?: string | null;
  installer?: { version: string; releaseDate: string | null; notes: string | null; access: 'licensed' | 'registered'; files: { id: number; platform: string; label: string; size: number | null }[] } | null;
  demo?: { days: number; startOn: 'download' | 'activation'; version: string; requirements: string | null; files: { id: number; platform: string; label: string; size: number | null }[] } | null;
  setupSteps?: number;
}
export interface ProductMedia {
  role: string;
  kind: string;
  title: string;
  caption: string | null;
  url: string | null;
  embed: string | null;
  size: { width?: number; height?: number };
  description?: string | null;
  /** seconds */
  duration?: number | null;
  thumbnail?: string | null;
}
export interface Page<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number };
}
export interface StoryTiming { approach: number; tileIn: number; view: number; tileOut: number; place: number }
export interface StoryContent {
  enabled: boolean;
  imageMediaId?: number | null;
  /** Public URL of the admin's picture (null = the built-in SCHLUSS picture). */
  image?: string | null;
  meaningTitle: string;
  meaningMessage: string;
  meaningText: string;
  moreTitle: string;
  moreText: string;
  moreHue: string;
  finalTitle: string;
  finalText: string;
  timing: StoryTiming;
}
export interface AboutStoryPiece { slug: string; name: string; title: string; description: string; tagline: string | null; type: string; problem: string | null; highlight: string | null; category: string; benefits: string[]; cover: string | null; image: string | null; link: string; puzzle: boolean }
export interface AboutStory { story: StoryContent; pieces: AboutStoryPiece[] }
export interface SiteContent {
  story: StoryContent;
  banner: { enabled: boolean; text: string; link: string };
  home: {
    heroEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    introTitle: string;
    introBody: string;
    conceptTitle: string;
    conceptBody: string;
    why: { title: string; body: string }[];
    supportTitle: string;
    supportBody: string;
    ctaTitle: string;
    ctaBody: string;
  };
  about: { title: string; intro: string; body: string[] };
  partners: { title: string; subtitle: string; benefits: { title: string; body: string }[]; steps: string[] };
  contact: { email: string; phone: string; whatsapp: string; address: string; hours: string };
  footer: { tagline: string };
}

function params(q: Record<string, unknown>) {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

@Injectable({ providedIn: 'root' })
export class PublicApi {
  private http = inject(HttpClient);
  private site$?: Observable<SiteContent>;
  private cats$?: Observable<Category[]>;

  aboutStory(fresh = false) {
    return this.http.get<AboutStory>('/api/public/about-story' + (fresh ? `?t=${Date.now()}` : ''));
  }
  site() {
    this.site$ ??= this.http.get<SiteContent>('/api/public/site').pipe(shareReplay(1));
    return this.site$;
  }
  categories() {
    this.cats$ ??= this.http.get<Category[]>('/api/public/categories').pipe(shareReplay(1));
    return this.cats$;
  }
  productTypes() {
    return this.http.get<string[]>('/api/public/product-types');
  }
  products(q: Record<string, unknown>) {
    return this.http.get<Page<ProductCard>>('/api/public/products', { params: params(q) });
  }
  product(slug: string) {
    return this.http.get<ProductDetail>(`/api/public/products/${encodeURIComponent(slug)}`);
  }
  learning(q: Record<string, unknown>) {
    return this.http.get<LearningItem[]>('/api/public/learning', { params: params(q) });
  }
  learningItem(id: number) {
    return this.http.get<LearningItem>(`/api/public/learning/${id}`);
  }
  submit(form: 'demo-requests' | 'partner-applications' | 'contact', body: unknown) {
    return firstValueFrom(this.http.post<{ reference: string }>(`/api/public/${form}`, body));
  }
}

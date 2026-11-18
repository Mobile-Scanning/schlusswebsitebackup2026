import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AboutStory, SiteContent } from '../core/public-api';
import type { Page } from './admin-api';

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  productCount: number;
}
export interface MediaItem {
  id: number;
  kind: string;
  title: string;
  original_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  visibility: 'public' | 'customer' | 'partner' | 'staff';
  external_url: string | null;
  url: string | null;
  embed: string | null;
  created_at: string;
}
export interface AdminPlan {
  id?: number;
  name: string;
  model: string;
  price_cents: number | null;
  currency: string;
  billing_period: string;
  unit: string;
  price_includes_vat: boolean;
  conditions: string | null;
  inclusions: string[];
  max_devices: number | null;
  is_active: boolean;
  is_highlighted: boolean;
}
export interface AdminLearning {
  id: number;
  product_id: number | null;
  product_name?: string | null;
  section: string;
  audience: string;
  visibility: string;
  kind: string;
  title: string;
  summary: string | null;
  body: string | null;
  media_id: number | null;
  media_title?: string | null;
  is_published: boolean;
  url: string | null;
}
export interface AdminProduct {
  id: number;
  name: string;
  slug: string;
  tagline: string | null;
  short_description: string | null;
  description: string | null;
  product_type: string | null;
  category_id: number | null;
  status: string;
  is_published: boolean;
  is_featured: boolean;
  is_archived: boolean;
  logo_media_id: number | null;
  hero_media_id: number | null;
  logo: string | null;
  image: string | null;
  previewImage: string | null;
  supported_platforms: string[];
  system_requirements: string | null;
  trial_days: number | null;
  licence_rules: { maxDevices?: number; offlineGraceDays?: number };
  demo_options: { requestForm?: boolean; scheduled?: boolean; video?: boolean; interactiveUrl?: string; downloadable?: boolean };
  expected_release: string | null;
  seo_title: string | null;
  seo_description: string | null;
  wizard_step: number;
  published_at: string | null;
  features: { kind: string; title: string; body: string | null; icon: string | null }[];
  plans: AdminPlan[];
  media: { link_id: number; role: string; caption: string | null; description: string | null; duration_seconds: number | null; thumbnail: string | null; id: number; kind: string; title: string; url: string | null; embed: string | null }[];
  learning: AdminLearning[];
  offering_type: OfferingType;
  offering_label: string;
  offering_features: OfferingFeatures;
  allowed_features: OfferingFeatures;
  content_access: string | null;
  category: { id: number; name: string } | null;
  summary: { installerVersion: string | null; demoVersion: string | null; contentItems: number; contentPublished: number; contentCategories: number; demos: number; downloads: number };
  about_show: boolean;
  about_puzzle: boolean;
  about_order: number;
  about_title: string | null;
  about_description: string | null;
  about_problem: string | null;
  about_highlight: string | null;
  about_cover_media_id: number | null;
  about_image_media_id: number | null;
  aboutCover: string | null;
  aboutImage: string | null;
}
export type OfferingType = 'software' | 'learning' | 'training' | 'development' | 'other';
export type FeatureKey = 'installer' | 'demo' | 'trial' | 'pricing' | 'purchase' | 'learning';
export type OfferingFeatures = Record<FeatureKey, boolean>;
export const OFFERING_TYPES: { key: OfferingType; label: string; hint: string }[] = [
  { key: 'software', label: 'Software product', hint: 'Installable software – full installer, optional demo, trial, pricing and tutorials.' },
  { key: 'learning', label: 'Learning content', hint: 'A cover page and video lessons – no installer, demo or trial needed.' },
  { key: 'training', label: 'Training / course', hint: 'A course with categories and lessons, access control and progress.' },
  { key: 'development', label: 'Product under development', hint: 'Show what is coming – add videos and a demo later.' },
  { key: 'other', label: 'Other', hint: 'Anything else – switch on only the features you need.' },
];
export const OFFERING_LABEL: Record<OfferingType, string> = Object.fromEntries(OFFERING_TYPES.map((t) => [t.key, t.label])) as Record<OfferingType, string>;
export const FEATURE_INFO: { key: FeatureKey; label: string; hint: string }[] = [
  { key: 'installer', label: 'Full installer (.exe)', hint: 'Licensed customers download the full software.' },
  { key: 'demo', label: 'Demo download', hint: 'A separate demo installer with a time limit.' },
  { key: 'trial', label: 'Free trial', hint: 'Customers start a time-limited trial online.' },
  { key: 'pricing', label: 'Pricing', hint: 'Show prices / packages on the page.' },
  { key: 'purchase', label: 'Purchase / quotation', hint: 'Show the “Buy / get a quote” form (goes to Sales).' },
  { key: 'learning', label: 'Videos & learning content', hint: 'Content library with categories, lessons and cover cards.' },
];
export const TYPE_DEFAULTS: Record<OfferingType, OfferingFeatures> = {
  software: { installer: true, demo: false, trial: false, pricing: true, purchase: true, learning: true },
  learning: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
  training: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
  development: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
  other: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
};
export interface ProductRow {
  id: number;
  name: string;
  slug: string;
  status: string;
  is_published: boolean;
  is_featured: boolean;
  is_archived: boolean;
  wizard_step: number;
  logo: string | null;
  category_name: string | null;
  view_count: number;
  updated_at: string;
  image: string | null;
  short_description: string | null;
  offering_type: OfferingType;
  offering_label: string;
  offering_features: OfferingFeatures;
  has_installer: boolean;
  has_demo: boolean;
  trial: boolean;
  content_items: number;
  content_published: number;
}
export interface ProductStats { total: number; published: number; draft: number; archived: number; software: number; learning: number; training: number; development: number; withDemo: number; withoutDemo: number }

function params(q: Record<string, unknown>) {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

/** Thin typed wrapper over the admin catalogue/content/sales API. */
@Injectable({ providedIn: 'root' })
export class CatalogueApi {
  private http = inject(HttpClient);
  private get = <T>(url: string, q: Record<string, unknown> = {}) => firstValueFrom(this.http.get<T>(url, { params: params(q) }));
  private post = <T>(url: string, body: unknown) => firstValueFrom(this.http.post<T>(url, body));
  private put = <T>(url: string, body: unknown) => firstValueFrom(this.http.put<T>(url, body));
  private patch = <T>(url: string, body: unknown) => firstValueFrom(this.http.patch<T>(url, body));
  private del = <T>(url: string) => firstValueFrom(this.http.delete<T>(url));

  dashboard = () => this.get<Record<string, number> & { recent: { action: string; subject_type: string; subject_id: number; created_at: string; actor: string }[] }>('/api/admin/dashboard');

  categories = () => this.get<AdminCategory[]>('/api/admin/categories');
  createCategory = (b: object) => this.post<{ id: number }>('/api/admin/categories', b);
  updateCategory = (id: number, b: object) => this.put(`/api/admin/categories/${id}`, b);
  reorderCategories = (ids: number[]) => this.put('/api/admin/categories-order', { ids });
  deleteCategory = (id: number) => this.del(`/api/admin/categories/${id}`);
  productDeleteCheck = (id: number) => firstValueFrom(this.http.get<{ canDelete: boolean; usage: { demos: number; licences: number; downloads: number; salesEnquiries: number } }>(`/api/admin/products/${id}/delete-check`));
  deleteProduct = (id: number) => this.del(`/api/admin/products/${id}`);

  products = (q: Record<string, unknown>) => this.get<Page<ProductRow> & { stats: ProductStats }>('/api/admin/products', q);
  duplicateProduct = (id: number) => this.post<{ id: number }>(`/api/admin/products/${id}/duplicate`, {});
  product = (id: number) => this.get<AdminProduct>(`/api/admin/products/${id}`);
  createProduct = (b: object) => this.post<{ id: number; slug: string }>('/api/admin/products', b);
  updateProduct = (id: number, b: object) => this.patch<AdminProduct>(`/api/admin/products/${id}`, b);
  saveAbout = (id: number, b: object) => this.put<AdminProduct>(`/api/admin/products/${id}/about`, b);
  productState = (id: number, action: string) => this.post<AdminProduct>(`/api/admin/products/${id}/state`, { action });
  saveFeatures = (id: number, items: object[]) => this.put<AdminProduct>(`/api/admin/products/${id}/features`, { items });
  savePlans = (id: number, plans: object[]) => this.put<AdminProduct>(`/api/admin/products/${id}/plans`, { plans });
  addProductMedia = (id: number, b: object) => this.post<AdminProduct>(`/api/admin/products/${id}/media`, b);
  updateProductMedia = (id: number, linkId: number, b: object) => this.patch<AdminProduct>(`/api/admin/products/${id}/media/${linkId}`, b);
  removeProductMedia = (id: number, linkId: number) => this.del<AdminProduct>(`/api/admin/products/${id}/media/${linkId}`);

  learning = (q: Record<string, unknown>) => this.get<Page<AdminLearning>>('/api/admin/learning', q);
  createLearning = (b: object) => this.post('/api/admin/learning', b);
  updateLearning = (id: number, b: object) => this.put(`/api/admin/learning/${id}`, b);
  deleteLearning = (id: number) => this.del(`/api/admin/learning/${id}`);

  media = (q: Record<string, unknown>) => this.get<Page<MediaItem>>('/api/admin/media', q);
  upload = (file: File, visibility: string, title?: string) => {
    const fd = new FormData();
    fd.append('visibility', visibility);
    if (title) fd.append('title', title);
    fd.append('file', file);
    return this.post<{ id: number; kind: string; url: string }>('/api/admin/media/upload', fd);
  };
  linkVideo = (b: object) => this.post<{ id: number }>('/api/admin/media/external', b);
  updateMedia = (id: number, b: object) => this.patch(`/api/admin/media/${id}`, b);
  deleteMedia = (id: number) => this.del(`/api/admin/media/${id}`);

  siteContent = () => this.get<SiteContent>('/api/admin/site-content');
  aboutStoryPublic = () => this.get<AboutStory>('/api/public/about-story', { t: Date.now() });
  aboutProducts = () => this.get<never[]>('/api/admin/about-experience/products');
  saveAboutProducts = (items: object[]) => this.put('/api/admin/about-experience/products', { items });
  saveSiteContent = (key: string, value: unknown) => this.put(`/api/admin/site-content/${key}`, value);
  resetSiteContent = (key: string) => this.del(`/api/admin/site-content/${key}`);

  demos = (q: Record<string, unknown>) => this.get<Page<Record<string, any>> & { counts: Record<string, number> }>('/api/admin/demo-requests', q); // eslint-disable-line @typescript-eslint/no-explicit-any
  updateDemo = (id: number, b: object) => this.patch(`/api/admin/demo-requests/${id}`, b);
  staffOptions = () => this.get<{ id: number; name: string }[]>('/api/admin/staff-options');

  partners = (q: Record<string, unknown>) => this.get<Page<Record<string, any>> & { counts: Record<string, number> }>('/api/admin/partners', q); // eslint-disable-line @typescript-eslint/no-explicit-any
  partner = (id: number) => this.get<Record<string, any>>(`/api/admin/partners/${id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  partnerStatus = (id: number, status: string, note: string) => this.post<{ ok: boolean; invited: boolean }>(`/api/admin/partners/${id}/status`, { status, note });
  updatePartner = (id: number, b: object) => this.patch(`/api/admin/partners/${id}`, b);

  enquiries = (q: Record<string, unknown>) => this.get<Page<Record<string, any>>>('/api/admin/enquiries', q); // eslint-disable-line @typescript-eslint/no-explicit-any
  updateEnquiry = (id: number, b: object) => this.patch(`/api/admin/enquiries/${id}`, b);
}

export const fmtSize = (b: number | null) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

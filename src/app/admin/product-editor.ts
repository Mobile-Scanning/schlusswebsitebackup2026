import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, toApiError } from '../core/auth.service';
import { PLATFORM_LABEL, STATUS_LABEL } from '../shared/format';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminCategory, AdminPlan, AdminProduct, CatalogueApi, FEATURE_INFO, FeatureKey, MediaItem, OFFERING_LABEL, OFFERING_TYPES, OfferingFeatures, OfferingType, TYPE_DEFAULTS } from './catalogue-api';
import { LearningAdmin } from './learning-admin';
import { MediaPicker } from './media';
import { ProductContentTab } from './content-admin';
import { AboutSettings } from './about-settings';
import { DemoHistoryTab, ProductDemoTab, ProductDownloadsTab, ProductEnquiriesTab, ProductImagesTab, SetupStepsTab } from './product-tabs';

type Feature = { kind: 'feature' | 'benefit' | 'faq'; title: string; body: string };
type PlanDraft = Omit<AdminPlan, 'price_cents'> & { price: string };

export const STEPS = ['Basic information', 'Category & features', 'Pricing & trial', 'Videos & demos', 'Learning materials', 'Downloads & versions', 'Preview & publish'];
/** Tabs in display order. Ids 1–7 are the original publishing steps; 8+ are content & demo sections. */
export const TABS: { id: number; label: string }[] = [
  { id: 1, label: 'General information' },
  { id: 2, label: 'Category & features' },
  { id: 8, label: 'Product images' },
  { id: 3, label: 'Pricing & packages' },
  { id: 4, label: 'Videos' },
  { id: 5, label: 'Learning materials' },
  { id: 9, label: 'Documents' },
  { id: 10, label: 'External URLs' },
  { id: 17, label: 'Content library' },
  { id: 16, label: 'Full installer' },
  { id: 11, label: 'Demo files' },
  { id: 12, label: 'Demo settings' },
  { id: 13, label: 'Demo history' },
  { id: 14, label: 'Setup steps' },
  { id: 6, label: 'Downloads' },
  { id: 15, label: 'Enquiries' },
  { id: 7, label: 'Status & publish' },
];
const MODELS: Record<string, string> = {
  free: 'Free',
  trial: 'Free trial only',
  once_off: 'Once-off licence',
  monthly: 'Monthly subscription',
  annual: 'Annual subscription',
  per_user: 'Per user',
  per_device: 'Per device',
  tier: 'Package / tier',
  quote: 'Price on quotation',
};
const VIDEO_ROLES: Record<string, string> = { intro_video: 'Introduction', walkthrough: 'Walkthrough', feature_video: 'Feature demo', install_tutorial: 'Installation tutorial', training_video: 'Training', demo_video: 'Demo video' };

/** Which optional features each offering type may use (mirrors the server rules). */
const ALLOWED: Record<OfferingType, OfferingFeatures> = {
  software: { installer: true, demo: true, trial: true, pricing: true, purchase: true, learning: true },
  learning: { installer: false, demo: false, trial: false, pricing: true, purchase: true, learning: true },
  training: { installer: false, demo: false, trial: true, pricing: true, purchase: true, learning: true },
  development: { installer: true, demo: true, trial: true, pricing: true, purchase: true, learning: true },
  other: { installer: true, demo: true, trial: true, pricing: true, purchase: true, learning: true },
};
type Section = 'type' | 'basic' | 'details' | 'images' | 'access' | 'installer' | 'demo' | 'content' | 'pricing' | 'about' | 'publish';
/** Old step numbers (used by the save handlers) → the section that follows. */
const STEP_SECTION: Record<number, Section> = { 1: 'basic', 2: 'details', 3: 'pricing', 4: 'demo', 5: 'content', 6: 'installer', 7: 'publish' };

/**
 * Admin › Products › (offering) – ONE page for everything about an offering.
 * Collapsible sections instead of separate tabs/pages; only the sections the offering type and its features
 * need are shown. Every section reuses the existing, tested forms and APIs.
 */
@Component({
  selector: 'sch-product-editor',
  imports: [ReactiveFormsModule, FormsModule, RouterLink, MediaPicker, LearningAdmin, DecimalPipe, ProductImagesTab, ProductDemoTab, DemoHistoryTab, SetupStepsTab, ProductDownloadsTab, ProductEnquiriesTab, ProductContentTab, AboutSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-editor.html',
  styleUrl: './product-editor.scss',
})
export class ProductEditorPage implements OnInit {
  readonly id = input.required<string>();
  protected auth = inject(AuthService);
  private api = inject(CatalogueApi);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  protected opened = signal(new Set<Section>(['basic']));
  protected offeringTypes = OFFERING_TYPES;
  protected featureInfo = FEATURE_INFO;
  protected newType = signal<OfferingType>('software');
  protected of: { type: OfferingType; features: OfferingFeatures } = { type: 'software', features: { ...TYPE_DEFAULTS.software } };
  protected access = 'default';
  protected trialDays: number | null = null;
  protected feats = computed(() => this.p()?.offering_features ?? TYPE_DEFAULTS[this.newType()]);
  protected allowed = (k: FeatureKey) => ALLOWED[this.of.type][k];
  protected typeName = (t: OfferingType) => OFFERING_LABEL[t];
  protected enabledList = computed(() => {
    const f = this.feats();
    const on = FEATURE_INFO.filter((x) => f[x.key]).map((x) => x.label.replace(/ \(.*\)$/, ''));
    return on.length ? on.join(', ') : 'No optional features';
  });
  protected accessLabel = (a: string | null) => ({ public: 'public', registered: 'registered customers', authorised: 'authorised customers', demo: 'demo customers' } as Record<string, string>)[a ?? ''] ?? 'default setting';
  protected activePlans = computed(() => this.p()?.plans.filter((x) => x.is_active).length ?? 0);
  protected p = signal<AdminProduct | null>(null);
  protected contentChanged(c: { total: number; published: number; categories: number }) {
    const p = this.p();
    if (p && (p.summary.contentItems !== c.total || p.summary.contentPublished !== c.published || p.summary.contentCategories !== c.categories)) {
      this.p.set({ ...p, summary: { ...p.summary, contentItems: c.total, contentPublished: c.published, contentCategories: c.categories } });
    }
  }
  protected cats = signal<AdminCategory[]>([]);
  protected busy = signal(false);
  protected msg = signal<{ text: string; err: boolean } | null>(null);
  protected fieldErr = signal<Record<string, string>>({});
  protected features = signal<Feature[]>([]);
  protected plans = signal<PlanDraft[]>([]);
  protected models = MODELS;
  protected modelKeys = Object.keys(MODELS);
  protected videoRoles = VIDEO_ROLES;
  protected videoRoleKeys = Object.keys(VIDEO_ROLES);
  protected statusLabel = STATUS_LABEL as Record<string, string>;
  protected statuses = Object.entries(STATUS_LABEL);
  protected platforms = Object.entries(PLATFORM_LABEL);
  protected pickerTarget = signal<'logo' | 'hero' | 'preview' | 'screenshot' | 'video' | 'thumb'>('logo');
  /** Video whose details are being edited (and whose thumbnail the picker sets). */
  protected editing = signal<number | null>(null);
  protected vForm = { caption: '', description: '', minutes: '', seconds: '' };
  protected videoRole = 'intro_video';
  protected isNew = computed(() => this.id() === 'new');
  protected canEdit = computed(() => this.auth.can('products.manage'));
  protected canPublish = computed(() => this.auth.can('products.publish'));
  protected canPrice = computed(() => this.auth.can('pricing.manage'));

  protected basic = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    slug: [''],
    tagline: [''],
    shortDescription: ['', Validators.maxLength(500)],
    description: [''],
    productType: [''],
    notice: ['', Validators.maxLength(1000)],
  });
  protected settings = this.fb.group({
    categoryId: [null as number | null],
    status: ['coming_soon'],
    expectedRelease: [''],
    systemRequirements: [''],
    trialDays: [null as number | null],
    maxDevices: [1],
    offlineGraceDays: [7],
    requestForm: [true],
    scheduled: [true],
    video: [false],
    interactiveUrl: [''],
    downloadable: [false],
    seoTitle: [''],
    seoDescription: [''],
    isFeatured: [false],
  });
  protected selectedPlatforms = signal<string[]>([]);

  protected checklist = computed(() => {
    const p = this.p();
    if (!p) return [];
    return [
      { ok: !!p.short_description, label: 'Short description (Basic information)' },
      ...(p.offering_type === 'software' ? [{ ok: !!p.category_id, label: 'Website category (Category & availability)' }] : []),
      ...(p.offering_features.pricing && p.status !== 'coming_soon' ? [{ ok: p.plans.some((x) => x.is_active), label: 'At least one active pricing option (Pricing & sales) – use “Price on quotation” if prices are private' }] : []),
      { ok: !!p.hero_media_id, label: 'Main cover image – recommended', optional: true },
      ...(p.offering_features.learning ? [{ ok: p.summary.contentPublished > 0, label: 'At least one published video or lesson – recommended', optional: true }] : []),
      ...(p.offering_features.installer ? [{ ok: !!p.summary.installerVersion, label: 'Full installer uploaded – recommended', optional: true }] : []),
    ];
  });
  protected ready = computed(() => this.checklist().every((c) => c.ok || c.optional));

  ngOnInit() {
    void this.api.categories().then((c) => this.cats.set(c));
    if (!this.isNew()) void this.reload(true);
  }

  protected async reload(jump = false) {
    const p = await this.api.product(Number(this.id()));
    this.apply(p);
    if (jump && this.route.snapshot.queryParamMap.get('duplicated')) this.msg.set({ text: 'Copy created as a draft – content items were copied as drafts. Installers, customers and history are not copied.', err: false });
  }

  protected apply(p: AdminProduct) {
    this.p.set(p);
    this.of = { type: p.offering_type, features: { ...p.offering_features } };
    this.access = p.content_access ?? 'default';
    this.trialDays = p.trial_days;
    this.basic.reset({ name: p.name, slug: p.slug, tagline: p.tagline ?? '', shortDescription: p.short_description ?? '', description: p.description ?? '', productType: p.product_type ?? '', notice: (p as AdminProduct & { notice?: string | null }).notice ?? '' });
    this.settings.reset({
      categoryId: p.category_id,
      status: p.status,
      expectedRelease: p.expected_release ? String(p.expected_release).slice(0, 10) : '',
      systemRequirements: p.system_requirements ?? '',
      trialDays: p.trial_days,
      maxDevices: p.licence_rules.maxDevices ?? 1,
      offlineGraceDays: p.licence_rules.offlineGraceDays ?? 7,
      requestForm: p.demo_options.requestForm !== false,
      scheduled: p.demo_options.scheduled !== false,
      video: !!p.demo_options.video,
      interactiveUrl: p.demo_options.interactiveUrl ?? '',
      downloadable: !!p.demo_options.downloadable,
      seoTitle: p.seo_title ?? '',
      seoDescription: p.seo_description ?? '',
      isFeatured: p.is_featured,
    });
    this.selectedPlatforms.set([...p.supported_platforms]);
    this.features.set(p.features.map((f) => ({ kind: f.kind as Feature['kind'], title: f.title, body: f.body ?? '' })));
    this.plans.set(p.plans.map((pl) => ({ ...pl, price: pl.price_cents === null ? '' : (pl.price_cents / 100).toFixed(2) })));
  }

  protected isOpen = (k: Section) => this.opened().has(k);
  protected toggle(k: Section) {
    const o = new Set(this.opened());
    if (o.has(k)) o.delete(k);
    else o.add(k);
    this.opened.set(o);
  }
  /** Open a section (by key or old step number) and scroll to it. */
  protected go(n: number | Section) {
    const k = typeof n === 'number' ? STEP_SECTION[n] : n;
    if (!k || this.isNew()) return;
    this.opened.set(new Set([...this.opened(), k]));
    setTimeout(() => document.getElementById('sec-' + k)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  private async run(fn: () => Promise<unknown>, okText: string, next?: number) {
    this.busy.set(true);
    this.msg.set(null);
    this.fieldErr.set({});
    try {
      await fn();
      this.msg.set({ text: okText, err: false });
      if (next) this.go(next);
    } catch (e) {
      const a = toApiError(e);
      this.fieldErr.set(a.fields);
      this.msg.set({ text: Object.keys(a.fields).length ? 'Please check the highlighted fields.' : a.message, err: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected fe = (k: string) => this.fieldErr()[k] ?? null;

  /* ---- Step 1 ---- */
  async saveBasic(next: boolean) {
    this.basic.markAllAsTouched();
    if (this.basic.invalid) return;
    const v = this.basic.getRawValue();
    const body = { name: v.name, tagline: v.tagline, shortDescription: v.shortDescription, description: v.description, productType: v.productType, notice: v.notice, wizardStep: 2 } as Record<string, unknown>;
    if (this.isNew()) {
      await this.run(async () => {
        const r = await this.api.createProduct({ ...body, offeringType: this.newType(), features: TYPE_DEFAULTS[this.newType()] });
        await this.router.navigate(['/admin/products', r.id], { replaceUrl: true });
        const p = await this.api.product(r.id);
        this.apply(p);
        this.opened.set(new Set<Section>([this.newType() === 'software' || this.newType() === 'development' ? 'details' : 'content']));
      }, 'Draft created. Fill in the sections below – each one saves on its own.');
      return;
    }
    if (v.slug && v.slug !== this.p()!.slug) body['slug'] = v.slug;
    await this.run(async () => this.apply(await this.api.updateProduct(this.p()!.id, body)), 'Basic information saved.', next ? 2 : undefined);
  }

  /* ---- Media pickers ---- */
  openPicker(target: 'logo' | 'hero' | 'preview' | 'screenshot' | 'video' | 'thumb', picker: MediaPicker) {
    this.pickerTarget.set(target);
    picker.open();
  }
  async picked(m: MediaItem) {
    const p = this.p()!;
    const t = this.pickerTarget();
    if (t === 'logo' || t === 'hero' || t === 'preview') {
      const body = t === 'logo' ? { logoMediaId: m.id } : t === 'hero' ? { heroMediaId: m.id } : { previewMediaId: m.id };
      await this.run(async () => this.apply(await this.api.updateProduct(p.id, body)), t === 'logo' ? 'Logo updated.' : t === 'hero' ? 'Product image updated.' : 'Coming soon image updated.');
    } else if (t === 'thumb') {
      const link = this.editing();
      if (link) await this.run(async () => this.apply(await this.api.updateProductMedia(p.id, link, { thumbnailMediaId: m.id })), 'Thumbnail updated.');
    } else {
      await this.run(async () => this.apply(await this.api.addProductMedia(p.id, { mediaId: m.id, role: t === 'screenshot' ? 'screenshot' : this.videoRole })), t === 'screenshot' ? 'Screenshot added.' : 'Video added.');
    }
  }
  async clearImage(which: 'logo' | 'hero' | 'preview') {
    const body = which === 'logo' ? { logoMediaId: null } : which === 'hero' ? { heroMediaId: null } : { previewMediaId: null };
    await this.run(async () => this.apply(await this.api.updateProduct(this.p()!.id, body)), 'Image removed.');
  }
  /* ---- Video details (title on tile, description, duration, thumbnail) ---- */
  editVideo(v: AdminProduct['media'][number]) {
    this.editing.set(v.link_id);
    const d = v.duration_seconds ?? 0;
    this.vForm = { caption: v.caption ?? '', description: v.description ?? '', minutes: d ? String(Math.floor(d / 60)) : '', seconds: d ? String(d % 60) : '' };
  }
  async saveVideo() {
    const link = this.editing();
    if (!link) return;
    const secs = (Number(this.vForm.minutes) || 0) * 60 + (Number(this.vForm.seconds) || 0);
    await this.run(async () => this.apply(await this.api.updateProductMedia(this.p()!.id, link, { caption: this.vForm.caption || null, description: this.vForm.description || null, durationSeconds: secs || null })), 'Video details saved.');
    this.editing.set(null);
  }
  async clearThumb(linkId: number) {
    await this.run(async () => this.apply(await this.api.updateProductMedia(this.p()!.id, linkId, { thumbnailMediaId: null })), 'Thumbnail removed.');
  }
  async removeMedia(linkId: number) {
    await this.run(async () => this.apply(await this.api.removeProductMedia(this.p()!.id, linkId)), 'Removed.');
  }
  protected screenshots = computed(() => this.p()?.media.filter((m) => m.role === 'screenshot' || m.role === 'gallery') ?? []);
  protected videos = computed(() => this.p()?.media.filter((m) => m.role !== 'screenshot' && m.role !== 'gallery') ?? []);

  /* ---- Step 2 ---- */
  togglePlatform(k: string) {
    this.selectedPlatforms.update((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  }
  addFeature(kind: Feature['kind']) {
    this.features.update((l) => [...l, { kind, title: '', body: '' }]);
  }
  removeFeature(i: number) {
    this.features.update((l) => l.filter((_, x) => x !== i));
  }
  moveFeature(i: number, d: number) {
    this.features.update((l) => {
      const c = [...l];
      const j = i + d;
      if (j < 0 || j >= c.length) return c;
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }
  protected featuresOf = (kind: string) => this.features().map((f, i) => ({ f, i })).filter((x) => x.f.kind === kind);

  async saveStep2(next: boolean) {
    const id = this.p()!.id;
    const s = this.settings.getRawValue();
    const items = this.features().filter((f) => f.title.trim());
    await this.run(
      async () => {
        const body: Record<string, unknown> = { categoryId: s.categoryId, supportedPlatforms: this.selectedPlatforms(), systemRequirements: s.systemRequirements, expectedRelease: s.expectedRelease || null, wizardStep: 3 };
        if (this.canPublish()) body['status'] = s.status;
        await this.api.updateProduct(id, body);
        this.apply(await this.api.saveFeatures(id, items.map((f) => ({ kind: f.kind, title: f.title.trim(), body: f.body.trim() || null }))));
      },
      'Category and features saved.',
      next ? 3 : undefined,
    );
  }

  /* ---- Step 3 ---- */
  addPlan() {
    this.plans.update((l) => [...l, { name: '', model: 'monthly', price: '', currency: 'ZAR', billing_period: 'month', unit: 'licence', price_includes_vat: false, conditions: '', inclusions: [], max_devices: null, is_active: true, is_highlighted: false }]);
  }
  removePlan(i: number) {
    this.plans.update((l) => l.filter((_, x) => x !== i));
  }
  modelChanged(pl: PlanDraft) {
    pl.billing_period = pl.model === 'monthly' ? 'month' : pl.model === 'annual' ? 'year' : pl.billing_period === 'none' || ['monthly', 'annual'].includes(pl.model) ? pl.billing_period : 'none';
    if (['free', 'quote'].includes(pl.model)) pl.price = '';
  }
  protected needsPrice = (pl: PlanDraft) => !['free', 'quote', 'trial'].includes(pl.model);
  protected inclusionsText = (pl: PlanDraft) => pl.inclusions.join('\n');
  protected setInclusions(pl: PlanDraft, v: string) {
    pl.inclusions = v.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async saveStep3(next: boolean) {
    const id = this.p()!.id;
    const s = this.settings.getRawValue();
    const bad = this.plans().findIndex((pl) => this.needsPrice(pl) && !/^\d+(\.\d{1,2})?$/.test(pl.price.trim()));
    if (bad > -1) {
      this.msg.set({ text: `Enter a valid price for option ${bad + 1} (numbers only, e.g. 499 or 499.99).`, err: true });
      return;
    }
    await this.run(
      async () => {
        await this.api.updateProduct(id, { wizardStep: 4 }); // trial/demo length and devices live under Demo settings
        if (this.canPrice()) {
          const plans = this.plans().map((pl) => ({
            id: pl.id,
            name: pl.name.trim(),
            model: pl.model,
            priceCents: this.needsPrice(pl) || (pl.model === 'trial' && pl.price) ? Math.round(Number(pl.price) * 100) : null,
            currency: pl.currency || 'ZAR',
            billingPeriod: pl.billing_period,
            unit: pl.unit,
            priceIncludesVat: pl.price_includes_vat,
            conditions: pl.conditions || null,
            inclusions: pl.inclusions,
            maxDevices: pl.max_devices ? Number(pl.max_devices) : null,
            isActive: pl.is_active,
            isHighlighted: pl.is_highlighted,
          }));
          this.apply(await this.api.savePlans(id, plans));
        } else await this.reload();
      },
      'Pricing and trial saved.',
      next ? 4 : undefined,
    );
  }

  /* ---- Step 4 ---- */
  async saveStep4(next: boolean) {
    const s = this.settings.getRawValue();
    await this.run(
      async () => this.apply(await this.api.updateProduct(this.p()!.id, { demoOptions: { requestForm: !!s.requestForm, scheduled: !!s.scheduled, video: !!s.video, interactiveUrl: s.interactiveUrl ?? '' }, wizardStep: 5 })),
      'Demo settings saved.',
      next ? 5 : undefined,
    );
  }

  async nextFrom(step: number) {
    await this.run(async () => this.apply(await this.api.updateProduct(this.p()!.id, { wizardStep: step + 1 })), 'Saved.', step + 1);
  }

  /* ---- Offering type & features ---- */
  pickType(t: OfferingType) {
    this.newType.set(t);
  }
  /** Switching type keeps everything; features the new type can't use are switched off, its usual ones on. */
  changeType(t: OfferingType) {
    const cur = this.of.features;
    const f = { ...TYPE_DEFAULTS[t] };
    for (const k of Object.keys(f) as FeatureKey[]) f[k] = ALLOWED[t][k] && (TYPE_DEFAULTS[t][k] || cur[k]);
    this.of = { type: t, features: f };
  }
  async saveOffering() {
    const p = this.p()!;
    const body = { offeringType: this.of.type, features: this.of.features };
    this.busy.set(true);
    this.msg.set(null);
    try {
      try {
        this.apply(await this.api.updateProduct(p.id, body));
      } catch (e) {
        const a = toApiError(e);
        if (a.code !== 'confirm_required') throw e;
        const warnings = (a.details?.['warnings'] as string[]) ?? [];
        if (!confirm(`Please confirm:\n\n• ${warnings.join('\n• ')}\n\nNothing is deleted – customer records, content and history are kept.`)) return;
        this.apply(await this.api.updateProduct(p.id, { ...body, confirm: true }));
      }
      this.msg.set({ text: `Saved – ${p.name} is now a ${OFFERING_LABEL[this.of.type].toLowerCase()}. Everything it had before is kept.`, err: false });
    } catch (e) {
      this.msg.set({ text: toApiError(e).message, err: true });
    } finally {
      this.busy.set(false);
    }
  }
  async saveAccess() {
    const p = this.p()!;
    await this.run(async () => {
      await firstValueFrom(this.http.put(`/api/admin/products/${p.id}/content/access`, { access: this.access }));
      this.apply(await this.api.product(p.id));
    }, 'Access saved.');
  }
  async saveTrial() {
    await this.run(async () => this.apply(await this.api.updateProduct(this.p()!.id, { trialDays: this.trialDays ? Number(this.trialDays) : null })), this.trialDays ? `Free trial set to ${this.trialDays} days.` : 'New trials switched off.');
  }
  async publishNow() {
    if (!this.ready()) {
      this.go('publish');
      this.msg.set({ text: 'A few things are needed before publishing – see “Publish, visibility & delete”.', err: true });
      return;
    }
    await this.state('publish');
  }

  /* ---- Step 7 ---- */
  async saveSeo() {
    const s = this.settings.getRawValue();
    const body: Record<string, unknown> = { seoTitle: s.seoTitle, seoDescription: s.seoDescription, wizardStep: 7 };
    if (this.canPublish()) body['isFeatured'] = !!s.isFeatured;
    await this.run(async () => this.apply(await this.api.updateProduct(this.p()!.id, body)), 'Search & display settings saved.');
  }
  async state(action: 'publish' | 'unpublish' | 'archive' | 'restore') {
    const labels = { publish: 'Product published – it is now live on the website.', unpublish: 'Product unpublished – it is hidden from the website.', archive: 'Product archived.', restore: 'Product restored as a draft.' };
    if (action === 'archive' && !confirm('Archive this product? It will be removed from the website and from the active product list.')) return;
    await this.run(async () => this.apply(await this.api.productState(this.p()!.id, action)), labels[action]);
  }
  async deleteProduct() {
    const p = this.p()!;
    this.msg.set(null);
    try {
      const chk = await this.api.productDeleteCheck(p.id);
      if (!chk.canDelete) {
        const u = chk.usage;
        const parts = [u.demos && `${u.demos} demo(s)`, u.licences && `${u.licences} licence(s)`, u.downloads && `${u.downloads} download(s)`, u.salesEnquiries && `${u.salesEnquiries} sales enquiry(ies)`].filter(Boolean).join(', ');
        if (confirm(`“${p.name}” can't be deleted because customers have ${parts} for it.\n\nArchive it instead? It will be removed from the website and the active product list, and customer records stay intact.`)) {
          this.apply(await this.api.productState(p.id, 'archive'));
          this.msg.set({ text: 'Product archived.', err: false });
        }
        return;
      }
      if (!confirm(`Permanently delete “${p.name}”?\n\nThis removes the product page, pricing, versions and setup steps. It cannot be undone.`)) return;
      await this.api.deleteProduct(p.id);
      await this.router.navigate(['/admin/products'], { queryParams: { deleted: p.name } });
    } catch (e) {
      this.msg.set({ text: toApiError(e).message, err: true });
    }
  }
}

import { HUES, hueStyle } from '../shared/palette';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DestroyRef } from '@angular/core';
import { NavigationEnd, Router, RouterLink, Routes } from '@angular/router';
import { filter } from 'rxjs';
import { AdminNotificationsPage, CustomerDetailPage, CustomersAdminPage, DemoRecordPage, DemosAdminPage } from './crm-pages';
import { SupportInboxPage } from './support-inbox';
import { ProductsCentreLayout } from './products-nav';
import { ContentSettingsPage } from './content-admin';
import { BusinessesAdminPage, EmailSettingsPage, LeadDetailPage, LeadsAdminPage, ProductDownloadsPage, ReportsPage, SalesAdminPage, SystemPage, WhatsAppSettingsPage } from './ops-pages';
import { AuthService } from '../core/auth.service';
import { requirePermission } from '../core/guards';
import { ChangePassword } from '../shared/change-password';
import { NavItem, PortalShell } from '../shared/portal-shell';
import { ROLE_NAMES } from './admin-api';
import { AuditLogs } from './audit-logs';
import { MfaSettings, SecurityOverview } from './security-pages';
import { CatalogueApi } from './catalogue-api';
import { CategoriesPage } from './categories';
import { LearningAdmin } from './learning-admin';
import { MediaLibraryPage } from './media';
import { ProductEditorPage } from './product-editor';
import { ProductsAdminPage } from './products-admin';
import { RolesPage } from './roles';
import { DemoRequestsPage, PartnersAdminPage } from './sales-pages';
import { SiteContentPage } from './site-content';
import { StaffPage } from './staff';

/** Admin navigation – only working sections are listed; each is hidden without its permission. */
const NAV: NavItem[] = [
  { label: 'Dashboard', link: '/admin', exact: true, permission: 'dashboard.view' },
  { label: 'Businesses', link: '/admin/businesses', permission: 'customers.view' },
  { label: 'Customers / users', link: '/admin/customers', permission: 'customers.view' },
  // One central Products section: offerings, installers, demos, trials, videos, learning content, categories, settings.
  { label: 'Products', link: '/admin/products', anyOf: ['products.view', 'licences.view'], badge: 'demos', match: ['/admin/products', '/admin/demos', '/admin/downloads', '/admin/categories', '/admin/learning', '/admin/content-settings'] },
  { label: 'Support Inbox', link: '/admin/support', permission: 'support.view', badge: 'support' },
  { label: 'Potential leads', link: '/admin/leads', permission: 'leads.view', badge: 'leads' },
  { label: 'Sales enquiries', link: '/admin/sales', permission: 'sales.view', badge: 'sales' },
  { label: 'WhatsApp settings', link: '/admin/whatsapp', permission: 'whatsapp.manage' },
  { label: 'Email settings', link: '/admin/email-settings', anyOf: ['email_settings.manage', 'settings.manage'] },
  { label: 'Notifications', link: '/admin/notifications', badge: 'notifications' },
  { label: 'Reports', link: '/admin/reports', permission: 'reports.view' },
  { label: 'System settings', link: '/admin/system', anyOf: ['settings.manage', 'email_settings.manage', 'whatsapp.manage'] },
  // Existing sections (kept, not duplicated)
  { label: 'Media library', link: '/admin/media', permission: 'products.manage' },
  { label: 'Demo requests', link: '/admin/demo-requests', permission: 'demos.view' },
  { label: 'Business partners', link: '/admin/partners', permission: 'partners.view' },
  { label: 'Website content', link: '/admin/content', permission: 'content.manage' },
  { label: 'Staff', link: '/admin/staff', permission: 'users.manage' },
  { label: 'Roles & permissions', link: '/admin/roles', permission: 'roles.manage' },
  { label: 'Audit log', link: '/admin/audit-logs', permission: 'audit.view' },
  { label: 'My security', link: '/admin/security' },
];

@Component({
  selector: 'sch-admin-layout',
  imports: [PortalShell],
  template: `<sch-portal-shell area="Administration" [nav]="nav" [badges]="counts()" />`,
})
export class AdminLayout {
  protected nav = NAV;
  protected counts = signal<Record<string, number>>({});
  constructor() {
    const http = inject(HttpClient);
    const router = inject(Router);
    const refresh = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      http.get<Record<string, number>>('/api/admin/nav-counts').subscribe({ next: (c) => this.counts.set(c), error: () => undefined });
    };
    if (typeof window !== 'undefined') {
      refresh();
      const t = setInterval(refresh, 30_000);
      const sub = router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => refresh());
      inject(DestroyRef).onDestroy(() => { clearInterval(t); sub.unsubscribe(); });
    }
  }
}

const ACTION_LABEL: Record<string, string> = {
  'product.created': 'created a product',
  'product.updated': 'edited a product',
  'product.publish': 'published a product',
  'product.unpublish': 'unpublished a product',
  'product.archive': 'archived a product',
  'product.pricing_updated': 'updated pricing',
  'product.features_updated': 'updated features',
  'category.created': 'added a category',
  'content.updated': 'edited website content',
  'content.reset': 'restored default website text',
  'media.uploaded': 'uploaded a file',
  'demo.requested': 'requested a demo (website)',
  'demo.updated': 'updated a demo request',
  'partner.applied': 'applied to become a partner (website)',
  'partner.approved': 'approved a partner',
  'partner.rejected': 'rejected a partner',
  'staff.created': 'added a staff member',
};

@Component({
  selector: 'sch-admin-dashboard',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Dashboard</h1>
    <p class="muted">Signed in as {{ roles() }}.</p>
    @if (d(); as d) {
      <div class="kpis">
        @for (k of kpis(); track k.label) {
          @if (k.link) {
            <a class="card kpi" [routerLink]="k.link" [queryParams]="k.q" [style]="kpiStyle($index)">
              <span class="v">{{ d[k.key] ?? 0 }}</span><span class="l">{{ k.label }}</span>
              @if (k.attention && d[k.key]) { <span class="dot" aria-label="Needs attention"></span> }
            </a>
          } @else {
            <div class="card kpi" [style]="kpiStyle($index)"><span class="v">{{ d[k.key] ?? 0 }}</span><span class="l">{{ k.label }}</span></div>
          }
        }
      </div>
      @if (o(); as o) {
        <h2 class="sh">Customers, demos & support</h2>
        <div class="kpis">
          @for (k of okpis(); track k.key) {
            <a class="card kpi" [routerLink]="k.link" [queryParams]="k.q" [style]="kpiStyle($index + 3)">
              <span class="v">{{ o[k.key] ?? 0 }}</span><span class="l">{{ k.label }}</span>
              @if (k.attention && o[k.key]) { <span class="dot" aria-label="Needs attention"></span> }
            </a>
          }
        </div>
        <div class="charts">
          <section class="card">
            <h2>Activity – last 14 days</h2>
            <div class="legend"><span><i class="sw a"></i>Registrations</span><span><i class="sw b"></i>Demo downloads</span><span><i class="sw c"></i>Conversations</span></div>
            <div class="act" role="img" [attr.aria-label]="activityLabel()">
              @for (d of o['activity']; track d.day) {
                <div class="col" [title]="d.day + ': ' + d.registrations + ' registrations, ' + d.downloads + ' downloads, ' + d.conversations + ' conversations'">
                  <div class="bars3"><i class="a" [style.height.%]="h(d.registrations)"></i><i class="b" [style.height.%]="h(d.downloads)"></i><i class="c" [style.height.%]="h(d.conversations)"></i></div>
                  <span class="dl">{{ d.day.slice(8) }}</span>
                </div>
              }
            </div>
          </section>
          @if (o['popularity']?.length) {
            <section class="card">
              <h2>Product popularity</h2>
              <ul class="pop">@for (p of o['popularity']; track p.id) {
                <li><a [routerLink]="['/admin/products', p.id]">{{ p.name }}</a><span class="track"><span class="fill" [style.width.%]="pw(p.downloads)"></span></span><span class="num">{{ p.downloads }} downloads · {{ p.demos }} demos · {{ p.views }} views</span></li>
              }</ul>
            </section>
          }
        </div>
      }
      <section class="card recent">
        <h2>Recent activity</h2>
        <ul>
          @for (r of d.recent; track $index) {
            <li><span class="muted when">{{ r.created_at | date: 'd MMM, HH:mm' }}</span> <strong>{{ r.actor ?? 'Website visitor' }}</strong> {{ actionLabel[r.action] ?? r.action }}</li>
          } @empty { <li class="muted">No activity yet.</li> }
        </ul>
      </section>
    } @else if (!auth.can('dashboard.view')) {
      <p>Use the menu to open the sections available to you.</p>
    } @else { <p class="muted">Loading…</p> }
  `,
  styles: `
    h1 { font-size: 28px; }
    .kpis { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); margin: 18px 0; }
    .kpi { position: relative; display: grid; gap: 4px; color: var(--fg); text-decoration: none !important; overflow: hidden; border-top: 3px solid var(--accent); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, #fff), #fff 60%); transition: border-color .15s ease, translate .25s var(--ease), box-shadow .25s ease; }
    a.kpi:hover { translate: 0 -3px; box-shadow: 0 14px 28px -16px var(--accent); }
    .kpi::after { content: ''; position: absolute; right: -14px; bottom: -14px; width: 56px; height: 56px; border-radius: 14px; background: var(--accent); opacity: .12; transform: rotate(18deg); }
    .v { font-size: 34px; font-weight: 700; letter-spacing: -.02em; color: var(--heading); font-family: var(--f-head); font-variant-numeric: tabular-nums; }
    .l { font-size: 13px; color: var(--muted); }
    .dot { position: absolute; top: 14px; right: 14px; width: 10px; height: 10px; border-radius: 50%; background: var(--warn); }
    .recent h2, .charts h2 { font-size: 18px; }
    .sh { font-size: 18px; margin: 24px 0 0; }
    .charts { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 18px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
    .a { background: #7B5CFF; } .b { background: #3282F6; } .c { background: #14C2B0; }
    .act { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; align-items: end; height: 150px; }
    .col { display: grid; grid-template-rows: 1fr auto; height: 100%; gap: 4px; }
    .bars3 { display: flex; gap: 1px; align-items: flex-end; height: 100%; }
    .bars3 i { flex: 1; min-height: 2px; border-radius: 2px 2px 0 0; }
    .dl { font-size: 10px; color: var(--muted); text-align: center; font-variant-numeric: tabular-nums; }
    .pop { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .pop li { display: grid; grid-template-columns: minmax(90px, 150px) 1fr; gap: 4px 10px; align-items: center; font-size: 13px; }
    .pop .num { grid-column: 2; color: var(--muted); font-size: 12px; }
    .track { height: 10px; border-radius: 6px; background: var(--surface-2, #eef1f5); overflow: hidden; }
    .fill { display: block; height: 100%; background: #3282F6; border-radius: 6px; }
    .recent ul { list-style: none; padding: 0; margin: 0; }
    .recent li { padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; }
    .when { display: inline-block; min-width: 110px; }
  `,
})
export class AdminDashboard implements OnInit {
  protected auth = inject(AuthService);
  private api = inject(CatalogueApi);
  protected d = signal<(Record<string, number> & { recent: { action: string; created_at: string; actor: string | null }[] }) | null>(null);
  protected actionLabel = ACTION_LABEL;
  private kHues = [HUES.blue, HUES.amber, HUES.violet, HUES.teal, HUES.magenta, HUES.lime, HUES.orange, HUES.blue];
  protected kpiStyle = (i: number) => hueStyle(this.kHues[i % this.kHues.length]);
  protected roles = computed(() => (this.auth.me().roles ?? []).map((r) => ROLE_NAMES[r] ?? r).join(', ') || 'staff');
  protected kpis = computed(() =>
    [
      { key: 'products', label: 'Products (active)', link: '/admin/products', perm: 'products.view' },
      { key: 'published', label: 'Published', link: '/admin/products', q: { state: 'published' }, perm: 'products.view' },
      { key: 'comingSoon', label: 'Coming soon (live)', link: '/admin/products', q: { status: 'coming_soon' }, perm: 'products.view' },
      { key: 'pendingDemos', label: 'Open demo requests', link: '/admin/demo-requests', perm: 'demos.view', attention: true },
      { key: 'pendingPartners', label: 'Partner applications to review', link: '/admin/partners', perm: 'partners.view', attention: true },
      { key: 'approvedPartners', label: 'Approved partners', link: '/admin/partners', perm: 'partners.view' },
      { key: 'openEnquiries', label: 'Open support requests', link: '/admin/support', perm: 'support.view', attention: true },
      { key: 'customers', label: 'Registered customers', link: '/admin/customers', perm: 'customers.view' },
    ].filter((k) => this.auth.can(k.perm)) as { key: string; label: string; link: string; q?: object; attention?: boolean }[],
  );
  protected o = signal<Record<string, any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  protected okpis = computed(() => {
    const week = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    return [
      { key: 'newCustomers7', label: 'New customers (7 days)', link: '/admin/customers', q: { from: week }, perm: 'customers.view' },
      { key: 'downloads30', label: 'Demo downloads (30 days)', link: '/admin/demos', perm: 'customers.view' },
      { key: 'activeDemos', label: 'Active demos', link: '/admin/demos', q: { status: 'active' }, perm: 'customers.view' },
      { key: 'expiringSoon', label: 'Demos expiring soon', link: '/admin/demos', q: { status: 'expiring_soon' }, perm: 'customers.view', attention: true },
      { key: 'expired30', label: 'Recently expired demos', link: '/admin/demos', q: { status: 'expired' }, perm: 'customers.view' },
      { key: 'conversions30', label: 'Demo → package (30 days)', link: '/admin/demos', q: { status: 'converted' }, perm: 'customers.view' },
      { key: 'newConversations7', label: 'New conversations (7 days)', link: '/admin/support', q: { view: 'all' }, perm: 'support.view' },
      { key: 'unreadConversations', label: 'Unread customer messages', link: '/admin/support', q: { view: 'unread' }, perm: 'support.view', attention: true },
      { key: 'openSupport', label: 'Open support requests', link: '/admin/support', q: { view: 'open' }, perm: 'support.view' },
    ].filter((k) => this.auth.can(k.perm) || (k.perm === 'customers.view' && this.auth.can('licences.view'))) as { key: string; label: string; link: string; q?: object; attention?: boolean }[];
  });
  private maxAct = computed(() => Math.max(1, ...((this.o()?.['activity'] ?? []) as { registrations: number; downloads: number; conversations: number }[]).flatMap((d) => [d.registrations, d.downloads, d.conversations])));
  protected h = (v: number) => Math.round((v / this.maxAct()) * 100);
  protected pw = (v: number) => Math.round((v / Math.max(1, ...((this.o()?.['popularity'] ?? []) as { downloads: number }[]).map((p) => p.downloads))) * 100);
  protected activityLabel = computed(() => {
    const a = (this.o()?.['activity'] ?? []) as { registrations: number; downloads: number; conversations: number }[];
    const sum = (k: 'registrations' | 'downloads' | 'conversations') => a.reduce((t, d) => t + d[k], 0);
    return `Last 14 days: ${sum('registrations')} registrations, ${sum('downloads')} demo downloads, ${sum('conversations')} conversations`;
  });
  ngOnInit() {
    if (this.auth.can('dashboard.view')) {
      void this.api.dashboard().then((d) => this.d.set(d as never));
      void this.http.get<Record<string, unknown>>('/api/admin/overview').subscribe({ next: (o) => this.o.set(o), error: () => undefined });
    }
  }
  private http = inject(HttpClient);
}

@Component({
  selector: 'sch-admin-security',
  imports: [ChangePassword, MfaSettings, SecurityOverview],
  template: `<h1>My security</h1><sch-change-password /><sch-mfa-settings />@if (auth.can('settings.manage') || auth.can('users.manage')) { <sch-security-overview /> }`,
  styles: `h1 { font-size: 28px; } sch-change-password { display: block; max-width: 720px; }`,
})
export class AdminSecurity {
  protected auth = inject(AuthService);
}

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      { path: '', pathMatch: 'full', component: AdminDashboard, title: 'Admin – SCHLUSS' },
      {
        path: '',
        component: ProductsCentreLayout,
        children: [
        { path: 'products', component: ProductsAdminPage, canActivate: [requirePermission('products.view')], title: 'Products – SCHLUSS Admin' },
        { path: 'categories', component: CategoriesPage, canActivate: [requirePermission('products.view', 'categories.manage')], title: 'Categories – SCHLUSS Admin' },
        { path: 'learning', component: LearningAdmin, canActivate: [requirePermission('products.manage')], title: 'Learning materials – SCHLUSS Admin' },
        { path: 'demos', component: DemosAdminPage, canActivate: [requirePermission('licences.view', 'customers.view')], title: 'Demos – SCHLUSS Admin' },
        { path: 'downloads', component: ProductDownloadsPage, canActivate: [requirePermission('products.view', 'downloads.view')], title: 'Product downloads – SCHLUSS Admin' },
        { path: 'content-settings', component: ContentSettingsPage, canActivate: [requirePermission('products.view')], title: 'Video & content settings – SCHLUSS Admin' },
        ],
      },
      { path: 'products/:id', component: ProductEditorPage, canActivate: [requirePermission('products.view')], title: 'Product – SCHLUSS Admin' },
      { path: 'media', component: MediaLibraryPage, canActivate: [requirePermission('media.manage', 'products.manage')], title: 'Media library – SCHLUSS Admin' },
      { path: 'demo-requests', component: DemoRequestsPage, canActivate: [requirePermission('demos.view')], title: 'Demo requests – SCHLUSS Admin' },
      { path: 'partners', component: PartnersAdminPage, canActivate: [requirePermission('partners.view')], title: 'Partners – SCHLUSS Admin' },
      { path: 'enquiries', redirectTo: 'support' },
      { path: 'support', component: SupportInboxPage, canActivate: [requirePermission('support.view')], title: 'Support Inbox – SCHLUSS Admin' },
      { path: 'customers', component: CustomersAdminPage, canActivate: [requirePermission('customers.view')], title: 'Customers – SCHLUSS Admin' },
      { path: 'customers/:id', component: CustomerDetailPage, canActivate: [requirePermission('customers.view')], title: 'Customer – SCHLUSS Admin' },
      { path: 'demos/:id', component: DemoRecordPage, canActivate: [requirePermission('licences.view', 'customers.view')], title: 'Demo – SCHLUSS Admin' },
      { path: 'leads', component: LeadsAdminPage, canActivate: [requirePermission('leads.view')], title: 'Potential leads – SCHLUSS Admin' },
      { path: 'leads/:id', component: LeadDetailPage, canActivate: [requirePermission('leads.view')], title: 'Lead – SCHLUSS Admin' },
      { path: 'sales', component: SalesAdminPage, canActivate: [requirePermission('sales.view')], title: 'Sales enquiries – SCHLUSS Admin' },
      { path: 'businesses', component: BusinessesAdminPage, canActivate: [requirePermission('customers.view')], title: 'Businesses – SCHLUSS Admin' },
      { path: 'whatsapp', component: WhatsAppSettingsPage, canActivate: [requirePermission('whatsapp.manage', 'support.view')], title: 'WhatsApp settings – SCHLUSS Admin' },
      { path: 'email-settings', component: EmailSettingsPage, canActivate: [requirePermission('email_settings.manage', 'settings.manage')], title: 'Email settings – SCHLUSS Admin' },
      { path: 'reports', component: ReportsPage, canActivate: [requirePermission('reports.view')], title: 'Reports – SCHLUSS Admin' },
      { path: 'system', component: SystemPage, canActivate: [requirePermission('settings.manage', 'email_settings.manage', 'whatsapp.manage')], title: 'System settings – SCHLUSS Admin' },
      { path: 'notifications', component: AdminNotificationsPage, title: 'Notifications – SCHLUSS Admin' },
      { path: 'content', component: SiteContentPage, canActivate: [requirePermission('content.manage')], title: 'Website content – SCHLUSS Admin' },
      { path: 'staff', component: StaffPage, canActivate: [requirePermission('users.manage')], title: 'Staff – SCHLUSS Admin' },
      { path: 'roles', component: RolesPage, canActivate: [requirePermission('roles.manage')], title: 'Roles – SCHLUSS Admin' },
      { path: 'audit-logs', component: AuditLogs, canActivate: [requirePermission('audit.view')], title: 'Audit log – SCHLUSS Admin' },
      { path: 'security', component: AdminSecurity, title: 'My security – SCHLUSS Admin' },
    ],
  },
];

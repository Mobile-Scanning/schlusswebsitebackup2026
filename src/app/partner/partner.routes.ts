import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Routes } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ChangePassword } from '../shared/change-password';
import { NavItem, PortalShell } from '../shared/portal-shell';

const NAV: NavItem[] = [
  { label: 'Dashboard', link: '/partner', exact: true },
  { label: 'Profile & security', link: '/partner/security' },
  // Customers, Products, Installations, Maintenance, Support, Training, Sales Resources, Commissions: Phase 5.
];

@Component({
  selector: 'sch-partner-layout',
  imports: [PortalShell],
  template: `<sch-portal-shell area="Partner portal" [nav]="nav" />`,
})
export class PartnerLayout {
  protected nav = NAV;
}

const STATUS: Record<string, { label: string; cls: string; text: string }> = {
  pending: { label: 'Pending', cls: 'badge-warn', text: 'Your application has been received and is waiting for review. We will email you when it changes.' },
  under_review: { label: 'Under review', cls: 'badge-info', text: 'Our team is reviewing your application. We may contact you for more information.' },
  approved: { label: 'Approved', cls: 'badge-ok', text: 'Your partner account is active.' },
  rejected: { label: 'Not approved', cls: 'badge-danger', text: 'Your application was not approved. Contact SCHLUSS if you would like to discuss this.' },
  suspended: { label: 'Suspended', cls: 'badge-danger', text: 'Your partner account is suspended. Partner tools are unavailable until SCHLUSS reactivates it.' },
};

@Component({
  selector: 'sch-partner-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Partner dashboard</h1>
    <section class="card">
      <h2>Partnership status <span class="badge" [class]="'badge ' + status().cls">{{ status().label }}</span></h2>
      <p>{{ status().text }}</p>
    </section>
  `,
  styles: `h1 { font-size: 28px; } h2 { font-size: 18px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; } .card { max-width: 720px; }`,
})
export class PartnerDashboard {
  private auth = inject(AuthService);
  protected status = computed(() => STATUS[this.auth.me().partnerStatus ?? 'pending'] ?? STATUS['pending']);
}

@Component({
  selector: 'sch-partner-security',
  imports: [ChangePassword],
  template: `<h1>Profile & security</h1><sch-change-password />`,
  styles: `h1 { font-size: 28px; } sch-change-password { display: block; max-width: 720px; }`,
})
export class PartnerSecurity {}

export const PARTNER_ROUTES: Routes = [
  {
    path: '',
    component: PartnerLayout,
    children: [
      { path: '', component: PartnerDashboard, title: 'Partner portal – SCHLUSS' },
      { path: 'security', component: PartnerSecurity, title: 'Profile & security – SCHLUSS' },
    ],
  },
];

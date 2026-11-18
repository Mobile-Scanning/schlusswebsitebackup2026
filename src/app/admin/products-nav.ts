import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

/**
 * The Products Management Centre: one place for everything product-related.
 * Offerings (and the unified editor) plus the product-wide views that used to be separate menu items –
 * same pages and URLs, now reached from inside Products.
 */
const VIEWS = [
  { label: 'Offerings', link: '/admin/products', perm: ['products.view'] },
  { label: 'Customer demos', link: '/admin/demos', perm: ['licences.view', 'customers.view'] },
  { label: 'Downloads', link: '/admin/downloads', perm: ['products.view', 'downloads.view'] },
  { label: 'Website categories', link: '/admin/categories', perm: ['products.view', 'categories.manage'] },
  { label: 'Learning material', link: '/admin/learning', perm: ['products.manage'] },
  { label: 'Video & content settings', link: '/admin/content-settings', perm: ['products.view'] },
];

@Component({
  selector: 'sch-products-centre',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pc-nav" aria-label="Products sections">
      @for (v of views(); track v.link) {
        <a [routerLink]="v.link" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: v.link === '/admin/products' }">{{ v.label }}</a>
      }
    </nav>
    <router-outlet />
  `,
  styles: `
    :host { display: block; }
    .pc-nav { display: flex; gap: 4px; flex-wrap: wrap; margin: -4px 0 18px; padding: 4px; border-radius: 12px; background: var(--surface-2, #eef2f7); width: fit-content; max-width: 100%; }
    .pc-nav a { padding: 7px 14px; border-radius: 9px; font-size: 14px; font-weight: 500; color: var(--muted); text-decoration: none; white-space: nowrap; }
    .pc-nav a:hover { color: var(--heading); }
    .pc-nav a.on { background: #fff; color: var(--heading); box-shadow: 0 1px 3px rgba(20, 30, 60, .12); }
  `,
})
export class ProductsCentreLayout {
  private auth = inject(AuthService);
  protected views = computed(() => {
    this.auth.me();
    return VIEWS.filter((v) => v.perm.some((p) => this.auth.can(p)));
  });
}

import { Routes } from '@angular/router';
import { guestOnly, requireUser } from './core/guards';
import { NotFound } from './pages/legal';
import { HomePage } from './public/home';
import { SiteLayout } from './public/site-layout';

const auth = () => import('./pages/auth-pages');
const info = () => import('./public/info-pages');
const learning = () => import('./public/learning');

export const routes: Routes = [
  // ---------- Public website (server-rendered) ----------
  {
    path: '',
    component: SiteLayout,
    children: [
      { path: '', component: HomePage },
      { path: 'products', loadComponent: () => import('./public/products').then((m) => m.ProductsPage) },
      { path: 'products/:slug/content/:id', loadComponent: () => import('./public/content-viewer').then((m) => m.ContentViewerPage) },
      { path: 'products/:slug', loadComponent: () => import('./public/product-detail').then((m) => m.ProductDetailPage) },
      { path: 'coming-soon', loadComponent: () => import('./public/products').then((m) => m.ProductsPage), data: { comingSoon: true } },
      // The Learning Centre tab was removed (v13.1): learning material lives on each product's own page.
      { path: 'learning', redirectTo: 'products', pathMatch: 'full' },
      { path: 'learning/:id', loadComponent: () => learning().then((m) => m.LearningItemPage) },
      { path: 'partners', loadComponent: () => info().then((m) => m.PartnersPage) },
      { path: 'about', loadComponent: () => import('./public/about-story').then((m) => m.AboutPage) },
      { path: 'contact', loadComponent: () => info().then((m) => m.ContactPage) },
      { path: 'request-demo', loadComponent: () => info().then((m) => m.RequestDemoPage) },
      { path: 'privacy', loadComponent: () => import('./pages/legal').then((m) => m.Legal), data: { kind: 'privacy' } },
      { path: 'terms', loadComponent: () => import('./pages/legal').then((m) => m.Legal), data: { kind: 'terms' } },
    ],
  },

  // ---------- Sign-in pages ----------
  { path: 'login', loadComponent: () => auth().then((m) => m.Login), canActivate: [guestOnly], title: 'Sign in – SCHLUSS' },
  { path: 'register', loadComponent: () => auth().then((m) => m.Register), canActivate: [guestOnly], title: 'Create account – SCHLUSS' },
  { path: 'verify-email', loadComponent: () => auth().then((m) => m.VerifyEmail), title: 'Verify your email – SCHLUSS' },
  { path: 'forgot-password', loadComponent: () => auth().then((m) => m.Forgot), title: 'Forgot password – SCHLUSS' },
  { path: 'reset-password', loadComponent: () => auth().then((m) => m.Reset), title: 'Set password – SCHLUSS' },

  // ---------- Portals (browser-only, lazy-loaded) ----------
  { path: 'account', canActivate: [requireUser('customer')], loadChildren: () => import('./account/account.routes').then((m) => m.ACCOUNT_ROUTES) },
  { path: 'partner', canActivate: [requireUser('partner')], loadChildren: () => import('./partner/partner.routes').then((m) => m.PARTNER_ROUTES) },
  { path: 'admin', canActivate: [requireUser('staff')], loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },

  { path: '**', component: NotFound, title: 'Page not found – SCHLUSS' },
];

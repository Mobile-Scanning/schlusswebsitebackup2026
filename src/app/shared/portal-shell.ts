import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { SchLogo } from './brand';
import { hueFor, hueStyle, TILE_PIECES } from './palette';

const PORTAL_HUE: Record<string, string> = {
  Dashboard: 'violet business', Products: 'retail', Categories: 'stock', 'Media library': 'it', 'Learning Centre': 'finance', 'Website content': 'logistics',
  'Demo requests': 'logistics', 'Support Inbox': 'retail', Customers: 'finance', Demos: 'stock', Notifications: 'violet business', 'Business partners': 'logistics', Partners: 'logistics', Enquiries: 'it', Staff: 'business', Roles: 'it', 'Audit log': 'stock',
};

export interface NavItem {
  label: string;
  link: string;
  permission?: string;
  /** Show the item when the user has ANY of these permissions. */
  anyOf?: string[];
  exact?: boolean;
  /** Key in the `badges` input – shows an unread/attention count. */
  badge?: string;
  /** Extra URL prefixes that also highlight this item (sections that live inside it). */
  match?: string[];
}

/**
 * Shared layout for the Customer, Partner and Admin portals:
 * dark brand sidebar + light working area. Collapses to a slide-out menu on phones.
 * Nav items the user lacks permission for are hidden (the API enforces access regardless).
 */
@Component({
  selector: 'sch-portal-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, SchLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main" (click)="$event.preventDefault(); mainEl.focus(); mainEl.scrollIntoView()">Skip to content</a>
    <aside class="side theme-site" [class.open]="menuOpen()">
      <div class="brand">
        <a routerLink="/" aria-label="SCHLUSS public website"><sch-logo [size]="26" ink="#E9EDF2" gap="#0e1220" /></a>
        <span class="area">{{ area() }}</span>
      </div>
      <nav aria-label="{{ area() }} navigation">
        @for (item of visibleNav(); track item.link) {
          <a [routerLink]="item.link" [routerLinkActive]="item.match ? [] : 'active'" [routerLinkActiveOptions]="{ exact: !!item.exact }" [class.active]="matches(item)" [style]="navStyle(item.label)">
            <svg class="pm" viewBox="-8 -8 216 216" aria-hidden="true"><path [attr.d]="pieces[$index % 4]" /></svg>{{ item.label }}@if (item.badge && badges()[item.badge]) { <span class="nb" [attr.aria-label]="badges()[item.badge] + ' new'">{{ badges()[item.badge] }}</span> }
          </a>
        }
      </nav>
      <div class="who">
        <div class="name">{{ auth.user()?.name }}</div>
        <div class="email">{{ auth.user()?.email }}</div>
        <button type="button" class="btn btn-ghost btn-sm btn-block" (click)="logout()">Sign out</button>
      </div>
    </aside>
    @if (menuOpen()) { <button class="scrim" type="button" aria-label="Close menu" (click)="menuOpen.set(false)"></button> }
    <div class="main theme-light">
      <div class="ribbon" aria-hidden="true"></div>
      <header class="topbar">
        <button class="menu btn btn-ghost btn-sm" type="button" (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()" aria-label="Open menu">Menu</button>
        <span class="area-m">{{ area() }}</span>
      </header>
      <main id="main" class="content" tabindex="-1" #mainEl><router-outlet /></main>
    </div>
  `,
  styles: `
    :host { display: grid; grid-template-columns: 248px 1fr; min-height: 100dvh; }
    .side { background: radial-gradient(80% 40% at 0% 0%, rgba(123,92,255,.22), transparent 70%), radial-gradient(70% 40% at 100% 100%, rgba(20,194,176,.16), transparent 70%), #0e1220; border-right: 1px solid var(--line); display: flex; flex-direction: column; position: sticky; top: 0; height: 100dvh; padding: 18px 14px; gap: 18px; }
    .brand { display: grid; gap: 8px; padding: 4px 8px 14px; border-bottom: 1px solid var(--line); }
    .brand a { text-decoration: none; }
    .area { font: 500 11px var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: #bba9ff; }
    nav { display: grid; gap: 2px; overflow-y: auto; }
    nav a { position: relative; display: flex; align-items: center; gap: 10px; color: var(--fg); padding: 9px 12px; border-radius: 10px; font-weight: 500; font-size: 15px; text-decoration: none !important; transition: background .2s ease, color .2s ease; }
    nav a:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--heading); }
    nav a.active { color: #fff; background: linear-gradient(110deg, color-mix(in srgb, var(--accent) 55%, transparent), color-mix(in srgb, var(--accent) 18%, transparent)); font-weight: 600; }
    nav a.active::after { content: ''; position: absolute; right: -15px; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%; background: var(--surface-2-light, #f5f7fa); clip-path: inset(0 50% 0 0); }
    .nb { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; display: grid; place-items: center; background: #ff5a6e; color: #fff; font-size: 11px; font-weight: 700; }
    .pm { width: 16px; height: 16px; flex-shrink: 0; overflow: visible; transition: transform .4s cubic-bezier(.3,1.3,.45,1); }
    .pm path { fill: var(--accent); }
    nav a:hover .pm, nav a.active .pm { transform: rotate(90deg); }
    nav a.active .pm path { fill: #fff; }
    .who { margin-top: auto; padding: 14px 8px 0; border-top: 1px solid var(--line); font-size: 13px; color: var(--fg); }
    .name { color: var(--heading); }
    .name { font-weight: 600; }
    .email { color: var(--muted); margin-bottom: 10px; overflow-wrap: anywhere; }
    .main { position: relative; background: radial-gradient(50% 30% at 100% 0%, rgba(123,92,255,.07), transparent 70%), var(--surface-2); color: var(--fg); min-width: 0; }
    .ribbon { height: 4px; background: linear-gradient(90deg, var(--c-teal), var(--c-blue), var(--c-violet), var(--c-magenta), var(--c-amber)); }
    .topbar { display: none; }
    .content { padding: clamp(18px, 3vw, 32px); max-width: 1280px; }
    .scrim { display: none; }
    @media (max-width: 900px) {
      :host { grid-template-columns: 1fr; }
      .side { position: fixed; z-index: 30; left: 0; top: 0; width: min(280px, 85vw); transform: translateX(-100%); transition: transform .25s var(--ease); }
      .side.open { transform: none; box-shadow: var(--shadow); }
      .scrim { display: block; position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.45); border: 0; }
      .topbar { display: flex; align-items: center; gap: 12px; padding: 10px var(--gutter); background: #0e1220; color: #fff; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 10; }
      .topbar .btn { background: transparent; border-color: rgba(255,255,255,.25); }
      .topbar .btn { color: #fff; }
      .area-m { font: 500 11px var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: #bba9ff; }
    }
  `,
})
export class PortalShell {
  protected auth = inject(AuthService);
  private router = inject(Router);
  readonly area = input.required<string>();
  readonly nav = input.required<NavItem[]>();
  /** Counts shown next to nav items (e.g. unread conversations). */
  readonly badges = input<Record<string, number>>({});
  protected menuOpen = signal(false);
  protected pieces = TILE_PIECES;
  /** Each portal area keeps the same colour everywhere (e.g. Products blue, Partners amber). */
  protected navStyle = (label: string) => hueStyle(hueFor(PORTAL_HUE[label] ?? label));
  protected visibleNav = computed(() => {
    this.auth.me(); // re-evaluate when permissions change
    return this.nav().filter((i) => (!i.permission || this.auth.can(i.permission)) && (!i.anyOf || i.anyOf.some((p) => this.auth.can(p))));
  });

  private url = signal(this.router.url);
  protected matches = (item: NavItem) => !!item.match?.some((m) => this.url() === m || this.url().startsWith(m + '/') || this.url().startsWith(m + '?'));

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      this.menuOpen.set(false);
      this.url.set(this.router.url);
    });
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}

import { SchChat } from '../shared/chat-widget';
import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { MotionService } from '../core/motion.service';
import { PublicApi } from '../core/public-api';
import { SchLogo } from '../shared/brand';

/** Public website frame – v4 obsidian header and footer with puzzle details. */
@Component({
  selector: 'sch-site-layout',
  host: { class: 'theme-site' },
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SchLogo, AsyncPipe, SchChat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main" (click)="$event.preventDefault(); mainEl.focus(); mainEl.scrollIntoView()">Skip to content</a>
    @if (site$ | async; as site) {
      @if (site.banner.enabled && site.banner.text) {
        <div class="banner">
          @if (site.banner.link) {
            @if (site.banner.link.startsWith('/')) { <a [routerLink]="site.banner.link">{{ site.banner.text }}</a> }
            @else { <a [href]="site.banner.link" rel="noopener" target="_blank">{{ site.banner.text }}</a> }
          } @else { <span>{{ site.banner.text }}</span> }
        </div>
      }
    }
    <header class="hdr" [class.open]="open()">
      <div class="bar wrap">
        <a routerLink="/" class="logo" aria-label="SCHLUSS home"><sch-logo [size]="28" ink="#E9EDF2" gap="#07090D" /></a>
        <nav class="nav" aria-label="Main">
          @for (l of links; track l.path) {
            <a [routerLink]="l.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: l.exact ?? false }">{{ l.label }}</a>
          }
        </nav>
        <div class="actions">
          @if (auth.user(); as u) {
            <a class="signin" [routerLink]="auth.homeFor(u.type)">My portal</a>
          } @else {
            <a class="signin" routerLink="/login">Sign in</a>
          }
          <a class="btn btn-primary btn-sm cta" routerLink="/request-demo">Request a demo</a>
          <button class="burger" type="button" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-controls="mnav" aria-label="Menu">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
      <nav id="mnav" class="mnav" aria-label="Mobile">
        @for (l of links; track l.path) {
          <a [routerLink]="l.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: l.exact ?? false }">{{ l.label }}</a>
        }
        @if (auth.user(); as u) { <a [routerLink]="auth.homeFor(u.type)">My portal</a> } @else { <a routerLink="/login">Customer & partner sign in</a> }
        <a class="btn btn-primary" routerLink="/request-demo">Request a demo</a>
      </nav>
    </header>

    <div class="page" id="main" tabindex="-1" #mainEl><router-outlet /></div>


    <footer class="ftr">
      <div class="wrap">
        <div class="cols">
          <div class="brand">
            <sch-logo [size]="28" ink="#E9EDF2" gap="#07090D" />
            @if (site$ | async; as site) { <p>{{ site.footer.tagline }}</p> }
            <p class="slogan mono">The last piece. The complete picture.</p>
          </div>
          <div>
            <h3>Products</h3>
            <a routerLink="/products">All products</a>
            <a routerLink="/coming-soon">Coming soon</a>
            <a routerLink="/request-demo">Request a demo</a>
          </div>
          <div>
            <h3>Resources</h3>
            <a routerLink="/contact">Support</a>
            <a routerLink="/login">Customer sign in</a>
          </div>
          <div>
            <h3>Company</h3>
            <a routerLink="/about">About SCHLUSS</a>
            <a routerLink="/partners">Business partners</a>
            <a routerLink="/contact">Contact us</a>
          </div>
          <div>
            <h3>Contact</h3>
            @if (site$ | async; as site) {
              @if (site.contact.email) { <a [href]="'mailto:' + site.contact.email">{{ site.contact.email }}</a> }
              @if (site.contact.phone) { <a [href]="'tel:' + site.contact.phone.split(' ').join('')">{{ site.contact.phone }}</a> }
              @if (site.contact.address) { <span class="addr">{{ site.contact.address }}</span> }
            }
            <a routerLink="/contact">Send a message</a>
          </div>
        </div>
        <div class="legal">
          <span>© {{ year }} SCHLUSS. All rights reserved.</span>
          <span class="links">
            <a routerLink="/privacy">Privacy policy</a>
            <a routerLink="/terms">Terms of use</a>
            <button type="button" class="linkish" (click)="motion.toggle()" [attr.aria-pressed]="motion.reduced()">{{ motion.reduced() ? 'Animations off' : 'Reduce motion' }}</button>
          </span>
        </div>
      </div>
    </footer>
    @defer (on idle) { <sch-chat /> }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100dvh; }
    :host { background: var(--bg); }
    .banner { background: var(--sch-blue); color: #fff; text-align: center; font-size: 14px; padding: 8px var(--gutter); }
    .banner a { color: #fff; font-weight: 600; text-decoration: underline; }
    .hdr { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 40; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .bar { display: flex; align-items: center; gap: 28px; height: var(--header-h); }
    .logo { text-decoration: none !important; flex-shrink: 0; }
    .nav { display: flex; gap: 4px; height: 100%; }
    .nav a { display: flex; align-items: center; height: 100%; padding: 0 12px; color: var(--fg); font-weight: 500; font-size: 14px; text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s ease, border-color .15s ease; }
    .nav a:hover { color: var(--heading); }
    .nav a.active { color: var(--heading); border-bottom-color: transparent; background: linear-gradient(90deg, var(--c-blue), var(--c-violet), var(--c-magenta)) bottom / 100% 2px no-repeat; }
    .nav a { position: relative; }
    .nav a::before { content: ''; position: absolute; left: 50%; bottom: -1px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: var(--c-violet); clip-path: inset(50% 0 0 0); transform: scale(0); transition: transform .3s cubic-bezier(.3,1.3,.45,1); }
    .nav a.active::before { transform: scale(1); }
    .actions { display: flex; gap: 16px; align-items: center; margin: 0 0 0 auto; }
    .signin { color: var(--fg); font-weight: 500; font-size: 15px; }
    .burger { display: none; width: 44px; height: 44px; border: 1px solid var(--line-strong); background: var(--surface); border-radius: var(--r-sm); cursor: pointer; flex-direction: column; justify-content: center; align-items: center; gap: 4px; }
    .burger span { width: 18px; height: 2px; background: var(--heading); transition: transform .2s ease, opacity .2s ease; }
    .open .burger span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
    .open .burger span:nth-child(2) { opacity: 0; }
    .open .burger span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }
    .mnav { display: none; }
    @media (max-width: 1040px) {
      .nav, .cta { display: none; }
      .burger { display: inline-flex; }
      .open .mnav { display: grid; padding: 4px var(--gutter) 20px; border-top: 1px solid var(--line); max-height: calc(100dvh - var(--header-h)); overflow-y: auto; background: var(--bg); }
      .mnav a:not(.btn) { color: var(--fg); padding: 14px 4px; border-bottom: 1px solid var(--line); text-decoration: none; font-weight: 500; }
      .mnav a.active { color: var(--link); }
      .mnav .btn { margin-top: 16px; }
    }
    @media (max-width: 420px) { .signin { display: none; } }
    .page { flex: 1; overflow-x: clip; }
    .ftr { background: radial-gradient(50% 80% at 100% 0%, rgba(123,92,255,.12), transparent 60%), radial-gradient(40% 70% at 0% 100%, rgba(20,194,176,.1), transparent 60%), #0b0e18; border-top: 1px solid; border-image: linear-gradient(90deg, var(--c-teal), var(--c-blue), var(--c-violet), var(--c-magenta), var(--c-amber)) 1; }
    .cols { display: grid; gap: 32px; grid-template-columns: 1.6fr repeat(4, 1fr); padding: 56px 0 40px; }
    @media (max-width: 960px) { .cols { grid-template-columns: repeat(2, 1fr); } .brand { grid-column: 1 / -1; } }
    @media (max-width: 480px) { .cols { grid-template-columns: 1fr; } }
    .brand p { max-width: 34ch; margin-top: 14px; font-size: 14px; color: var(--muted); }
    .brand .slogan { color: var(--link); font-size: 11px; }
    h3 { font: 500 11px var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 4px 0 14px; }
    .cols a, .addr { display: block; color: var(--fg); font-size: 14px; padding: 4px 0; text-decoration: none; overflow-wrap: anywhere; }
    .addr { white-space: pre-line; }
    .cols a:hover { color: var(--heading); }
    .legal { padding: 20px 0 28px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
    .links { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
    .links a { color: var(--muted); }
    .linkish { background: none; border: 0; padding: 0; color: var(--muted); font: inherit; cursor: pointer; }
    .linkish:hover { color: var(--heading); }
  `,
})
export class SiteLayout {
  protected auth = inject(AuthService);
  protected motion = inject(MotionService);
  protected site$ = inject(PublicApi).site();
  protected open = signal(false);
  protected year = new Date().getFullYear();
  protected links = [
    { label: 'Home', path: '/', exact: true },
    { label: 'Products', path: '/products' },
    { label: 'Coming soon', path: '/coming-soon' },
    { label: 'Partners', path: '/partners' },
    { label: 'About SCHLUSS', path: '/about' },
    { label: 'Contact', path: '/contact' },
  ];

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.open.set(false));
  }
}

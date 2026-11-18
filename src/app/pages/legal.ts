import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SchPuzzle3d } from '../shared/puzzle3d';
import { SchPuzzleField } from '../shared/puzzle-field';
import { TILE_PIECES } from '../shared/palette';

/**
 * Privacy policy and terms of use – DRAFT wording written with POPIA in mind.
 * Must be reviewed by a legal adviser and the bracketed details completed before launch.
 * (Phase 7 moves this text into the admin-editable website content.)
 */
@Component({
  selector: 'sch-legal',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-hero zone zone-accent">
      <div class="wrap"><span class="eyebrow">Legal</span><h1>{{ kind === 'privacy' ? 'Privacy policy' : 'Terms of use' }}</h1>
        <p>{{ kind === 'privacy' ? 'Version 2026-11 · Protection of Personal Information Act, 4 of 2013 (POPIA)' : 'Version 2026-11' }}</p></div>
    </header>
    <main class="doc" id="main">
      <div class="alert" role="note"><strong>Draft for legal review.</strong> Bracketed details are still to be confirmed by SCHLUSS.</div>
      @if (kind === 'privacy') {
        <h2>Who we are</h2>
        <p>SCHLUSS ("we") is the responsible party for personal information collected through schluss.co.za and our software products. Information Officer: [name], [email], [phone]. [Registered company name and number].</p>
        <h2>What we collect and why</h2>
        <ul>
          <li><strong>Account details</strong> – name, email, cellphone, company and country – to create and secure your account and provide the products you register for.</li>
          <li><strong>Product and licence records</strong> – products registered, downloads, trial dates, licence status and device activations – to deliver software, enforce licence terms and support you.</li>
          <li><strong>Support and demo requests</strong> – what you send us – to respond to you.</li>
          <li><strong>Partner applications</strong> – business and contact details – to assess and manage partnerships.</li>
          <li><strong>Security logs</strong> – sign-in events and a one-way hash of IP addresses – to protect accounts and investigate abuse.</li>
        </ul>
        <p>We only collect what is needed for these purposes.</p>
        <h2>Marketing</h2>
        <p>We send marketing only if you opt in separately. Accepting this policy or our terms is not consent to marketing. You can withdraw marketing consent at any time. Service messages (for example password resets, trial expiry and licence notices) are part of providing the service.</p>
        <h2>Sharing</h2>
        <p>If you are assigned to a SCHLUSS business partner (your service provider), that partner can see the customer and licence records needed to install, support and maintain your products. We use service providers for hosting and email delivery under written agreements. We do not sell personal information. [List any cross-border processors and safeguards.]</p>
        <h2>Security</h2>
        <p>Passwords are stored as one-way hashes, access is limited by role, sensitive actions are audit-logged and data is transmitted over HTTPS.</p>
        <h2>Retention</h2>
        <p>We keep account and licence records while your account is active and for [period] afterwards for legal, tax and licence-verification purposes, then delete or de-identify them.</p>
        <h2>Your rights</h2>
        <p>You may request access to, correction of, or deletion of your personal information, and object to processing, by contacting the Information Officer. You may lodge a complaint with the Information Regulator (South Africa) at inforegulator.org.za.</p>
        <h2>Cookies</h2>
        <p>We use strictly necessary cookies only: a session cookie that keeps you signed in and a security token that protects forms. A remembered "reduce motion" preference is kept in your browser. We do not use advertising cookies.</p>
      } @else {
        <h2>Accounts</h2>
        <p>Keep your sign-in details confidential. You are responsible for activity on your account. Give accurate registration details.</p>
        <h2>Software and licences</h2>
        <p>Products are licensed, not sold. Trials run for the period shown on the product page, measured by our server clock, and cannot be restarted by reinstalling. Each product's licence terms apply on download or activation. [Full end-user licence terms per product.]</p>
        <h2>Acceptable use</h2>
        <p>Do not attempt to bypass licensing, access other people's data, or disrupt the platform.</p>
        <h2>Liability</h2>
        <p>[Limitation of liability and warranty wording – legal adviser to complete, consistent with the Consumer Protection Act where applicable.]</p>
        <h2>Governing law</h2>
        <p>These terms are governed by the laws of the Republic of South Africa.</p>
      }
      <p class="back"><a routerLink="/">← Back to SCHLUSS</a></p>
    </main>
  `,
  styles: `
    .doc { max-width: 760px; margin: 0 auto; padding: 8px var(--gutter) 64px; }
    h1 { font-size: clamp(28px, 4vw, 38px); }
    h2 { font-size: 19px; margin-top: 28px; }
    li { margin-bottom: 8px; }
    .back { margin-top: 40px; }
  `,
})
export class Legal {
  protected kind = inject(ActivatedRoute).snapshot.data['kind'] as 'privacy' | 'terms';
  constructor() {
    inject(Title).setTitle(this.kind === 'privacy' ? 'Privacy policy – SCHLUSS' : 'Terms of use – SCHLUSS');
    inject(Meta).updateTag({ name: 'description', content: 'How SCHLUSS handles personal information and the terms for using our platform.' });
  }
}

@Component({
  selector: 'sch-not-found',
  host: { class: 'theme-site', style: 'display:block' },
  imports: [RouterLink, SchPuzzle3d, SchPuzzleField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="nf zone zone-aurora" id="main">
      <sch-puzzle-field [density]="1.2" calm="center" />
      <div class="lost" aria-hidden="true"><svg viewBox="-10 -10 220 220"><path [attr.d]="piece" /></svg></div>
      <sch-puzzle3d [size]="140" />
      <h1>This piece doesn't fit</h1>
      <p class="muted">The page you're looking for doesn't exist or has moved.</p>
      <a routerLink="/" class="btn btn-primary">Go to the home page</a>
    </main>
  `,
  styles: `.nf { min-height: 70dvh; display: grid; place-content: center; justify-items: center; gap: 12px; text-align: center; padding: 64px var(--gutter); min-height: 80dvh; } h1 { margin-top: 18px; font-size: clamp(30px, 4.4vw, 52px); } p { margin: 0 0 12px; } .lost { position: absolute; right: 12%; top: 16%; width: 90px; animation: wobble 3s ease-in-out infinite; } .lost svg { overflow: visible; } .lost path { fill: var(--c-magenta); stroke: #fff; stroke-width: 4; } @keyframes wobble { 50% { transform: rotate(18deg) translateY(-10px); } } @media (max-width: 600px) { .lost { right: 6%; top: 8%; width: 60px; } } @media (prefers-reduced-motion: reduce) { .lost { animation: none; } }`,
})
export class NotFound {
  protected piece = TILE_PIECES[3];
}

import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toApiError } from '../core/auth.service';
import type { SiteContent } from '../core/public-api';
import { CatalogueApi } from './catalogue-api';
import { AboutExperience } from './about-experience';

type Key = keyof SiteContent;
const TABS: [Key, string][] = [
  ['home', 'Home page'],
  ['story', 'About SCHLUSS experience'],
  ['about', 'About us (under the puzzle)'],
  ['partners', 'Partner page'],
  ['contact', 'Contact details'],
  ['footer', 'Footer'],
  ['banner', 'Announcement banner'],
];

/** Admin › Website content – edit public copy without touching code. Plain text only (safe by design). */
@Component({
  selector: 'sch-site-content',
  imports: [FormsModule, AboutExperience],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-head"><div><h1>Website content</h1><p class="muted">Edit the text on the public website. Changes are live as soon as you save.</p></div></div>
    <div class="status-tabs" role="tablist">
      @for (t of tabs; track t[0]) { <button type="button" role="tab" [attr.aria-pressed]="tab() === t[0]" (click)="tab.set(t[0]); msg.set(null)">{{ t[1] }}</button> }
    </div>
    @if (msg(); as m) { <div class="alert" [class.alert-error]="m.err" [class.alert-ok]="!m.err" role="status">{{ m.text }}</div> }
    @if (tab() === 'story') {
      <sch-about-experience />
    } @else if (c(); as c) {
      <form class="card" (ngSubmit)="save()">
        @switch (tab()) {
          @case ('home') {
            <h2>Hero</h2>
            <div class="field"><label>Small heading<input class="input" name="he" [(ngModel)]="c.home.heroEyebrow" maxlength="80" /></label></div>
            <div class="field"><label>Main headline<input class="input" name="ht" [(ngModel)]="c.home.heroTitle" maxlength="120" /></label><span class="hint">Use " / " to split it into two lines – the second line shows in outline.</span></div>
            <div class="field"><label>Supporting text<textarea class="textarea" rows="3" name="hs" [(ngModel)]="c.home.heroSubtitle" maxlength="300"></textarea></label></div>
            <h2>Introduction</h2>
            <div class="field"><label>Title<input class="input" name="it" [(ngModel)]="c.home.introTitle" /></label></div>
            <div class="field"><label>Text<textarea class="textarea" rows="4" name="ib" [(ngModel)]="c.home.introBody"></textarea></label></div>
            <h2>The last piece of the puzzle</h2>
            <div class="field"><label>Title<input class="input" name="ct" [(ngModel)]="c.home.conceptTitle" /></label></div>
            <div class="field"><label>Text<textarea class="textarea" rows="4" name="cb" [(ngModel)]="c.home.conceptBody"></textarea></label></div>
            <h2>Why choose SCHLUSS?</h2>
            @for (w of c.home.why; track $index; let i = $index) {
              <div class="pair"><input class="input" [name]="'wt' + i" [(ngModel)]="w.title" [attr.aria-label]="'Reason ' + (i + 1) + ' title'" /><textarea class="textarea" rows="2" [name]="'wb' + i" [(ngModel)]="w.body" [attr.aria-label]="'Reason ' + (i + 1) + ' text'"></textarea>
                <button class="btn btn-ghost btn-sm" type="button" (click)="c.home.why.splice(i, 1)" [disabled]="c.home.why.length <= 1">Remove</button></div>
            }
            @if (c.home.why.length < 8) { <button class="btn btn-ghost btn-sm" type="button" (click)="c.home.why.push({ title: '', body: '' })">+ Add reason</button> }
            <h2>Support & learning</h2>
            <div class="field"><label>Title<input class="input" name="st" [(ngModel)]="c.home.supportTitle" /></label></div>
            <div class="field"><label>Text<textarea class="textarea" rows="3" name="sb" [(ngModel)]="c.home.supportBody"></textarea></label></div>
            <h2>Closing call to action</h2>
            <div class="field"><label>Title<input class="input" name="ctt" [(ngModel)]="c.home.ctaTitle" /></label></div>
            <div class="field"><label>Text<textarea class="textarea" rows="2" name="ctb" [(ngModel)]="c.home.ctaBody"></textarea></label></div>
          }
          @case ('about') {
            <p class="muted">A short “About us” text shown under the puzzle on the About SCHLUSS page. Keep it brief.</p>
            <div class="field"><label>Heading<input class="input" name="at" [(ngModel)]="c.about.title" maxlength="120" /></label></div>
            <div class="field"><label>Introduction<textarea class="textarea" rows="3" name="ai" [(ngModel)]="c.about.intro" maxlength="400"></textarea></label></div>
            @for (p of c.about.body; track $index; let i = $index) {
              <div class="field"><label>Paragraph {{ i + 1 }}<textarea class="textarea" rows="3" [name]="'ab' + i" [(ngModel)]="c.about.body[i]" maxlength="2000"></textarea></label>
                <button class="btn btn-ghost btn-sm" type="button" (click)="c.about.body.splice(i, 1)">Remove paragraph</button></div>
            }
            @if (c.about.body.length < 12) { <button class="btn btn-ghost btn-sm" type="button" (click)="c.about.body.push('')">+ Add paragraph</button> }
          }
          @case ('partners') {
            <div class="field"><label>Heading<input class="input" name="pt" [(ngModel)]="c.partners.title" /></label></div>
            <div class="field"><label>Supporting message<textarea class="textarea" rows="3" name="ps" [(ngModel)]="c.partners.subtitle"></textarea></label></div>
            <h2>Benefits</h2>
            @for (b of c.partners.benefits; track $index; let i = $index) {
              <div class="pair"><input class="input" [name]="'pbt' + i" [(ngModel)]="b.title" aria-label="Benefit title" /><textarea class="textarea" rows="2" [name]="'pbb' + i" [(ngModel)]="b.body" aria-label="Benefit text"></textarea>
                <button class="btn btn-ghost btn-sm" type="button" (click)="c.partners.benefits.splice(i, 1)">Remove</button></div>
            }
            @if (c.partners.benefits.length < 8) { <button class="btn btn-ghost btn-sm" type="button" (click)="c.partners.benefits.push({ title: '', body: '' })">+ Add benefit</button> }
            <h2>How it works (steps)</h2>
            @for (s of c.partners.steps; track $index; let i = $index) {
              <div class="pair one"><input class="input" [name]="'pst' + i" [(ngModel)]="c.partners.steps[i]" [attr.aria-label]="'Step ' + (i + 1)" /><button class="btn btn-ghost btn-sm" type="button" (click)="c.partners.steps.splice(i, 1)">Remove</button></div>
            }
            @if (c.partners.steps.length < 8) { <button class="btn btn-ghost btn-sm" type="button" (click)="c.partners.steps.push('')">+ Add step</button> }
          }
          @case ('contact') {
            <p class="muted">Only filled-in details are shown on the website.</p>
            <div class="form-row">
              <div class="field"><label>Email<input class="input" type="email" name="ce" [(ngModel)]="c.contact.email" /></label>@if (fe('email')) {<span class="error">{{ fe('email') }}</span>}</div>
              <div class="field"><label>Phone<input class="input" name="cp" [(ngModel)]="c.contact.phone" /></label></div>
              <div class="field"><label>WhatsApp number<input class="input" name="cw" [(ngModel)]="c.contact.whatsapp" placeholder="+27 …" /></label></div>
              <div class="field"><label>Business hours<input class="input" name="ch" [(ngModel)]="c.contact.hours" placeholder="Mon–Fri 08:00–17:00" /></label></div>
            </div>
            <div class="field"><label>Address<textarea class="textarea" rows="3" name="ca" [(ngModel)]="c.contact.address"></textarea></label></div>
          }
          @case ('footer') {
            <div class="field"><label>Footer tagline<textarea class="textarea" rows="2" name="ft" [(ngModel)]="c.footer.tagline" maxlength="300"></textarea></label></div>
          }
          @case ('banner') {
            <label class="check"><input type="checkbox" name="be" [(ngModel)]="c.banner.enabled" /><span>Show an announcement banner at the top of every public page</span></label>
            <div class="field"><label>Banner text<input class="input" name="bt" [(ngModel)]="c.banner.text" maxlength="200" /></label></div>
            <div class="field"><label>Link <span class="muted">(optional – a page like /products or a full https:// link)</span><input class="input" name="bl" [(ngModel)]="c.banner.link" /></label>@if (fe('link')) {<span class="error">{{ fe('link') }}</span>}</div>
          }
        }
        <div class="actions">
          <button class="btn btn-ghost" type="button" (click)="reset()">Restore default text</button>
          <button class="btn btn-primary" type="submit" [disabled]="busy()">Save {{ tabLabel() }}</button>
        </div>
      </form>
    }
  `,
  styles: `
    h2 { font-size: 17px; margin: 22px 0 10px; color: var(--sch-blue); }
    h2:first-child { margin-top: 0; }
    .field label { display: grid; gap: 6px; }
    .pair { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; margin-bottom: 8px; align-items: start; }
    .pair.one { grid-template-columns: 1fr auto; }
    @media (max-width: 700px) { .pair { grid-template-columns: 1fr; } }
  `,
})
export class SiteContentPage implements OnInit {
  private api = inject(CatalogueApi);
  protected tabs = TABS;
  protected tab = signal<Key>('home');
  protected c = signal<SiteContent | null>(null);
  protected busy = signal(false);
  protected msg = signal<{ text: string; err: boolean } | null>(null);
  protected fields = signal<Record<string, string>>({});
  protected tabLabel = () => TABS.find((t) => t[0] === this.tab())![1].toLowerCase();
  protected fe = (k: string) => this.fields()[k] ?? null;

  private route = inject(ActivatedRoute);
  async ngOnInit() {
    const t = this.route.snapshot.queryParamMap.get('tab') as Key | null;
    if (t && TABS.some((x) => x[0] === t)) this.tab.set(t);
    this.c.set(await this.api.siteContent());
  }
  async save() {
    const key = this.tab();
    this.busy.set(true);
    this.fields.set({});
    try {
      await this.api.saveSiteContent(key, this.c()![key]);
      this.msg.set({ text: `Saved – the ${this.tabLabel()} is updated on the website.`, err: false });
    } catch (e) {
      const a = toApiError(e);
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(a.fields)) f[k.split('.').pop()!] = v;
      this.fields.set(f);
      this.msg.set({ text: Object.keys(f).length ? 'Please check the highlighted fields (headlines can’t be empty).' : a.message, err: true });
    } finally {
      this.busy.set(false);
    }
  }
  async reset() {
    const key = this.tab();
    if (!confirm(`Restore the original ${this.tabLabel()} text? Your edits for this section will be replaced.`)) return;
    const def = await this.api.resetSiteContent(key);
    this.c.update((c) => ({ ...c!, [key]: def }));
    this.msg.set({ text: 'Default text restored.', err: false });
  }
}

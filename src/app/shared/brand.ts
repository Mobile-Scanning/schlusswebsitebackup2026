import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Path data from the official SCHLUSS mark and wordmark (taken from the original landing page). */
export const PIECES = [
  'M0 24 Q0 0 24 0 L100 0 L100 41 L108 41 A15 15 0 1 1 108 59 L100 59 L100 100 L59 100 L59 108 A15 15 0 1 1 41 108 L41 100 L0 100 Z',
  'M100 0 L176 0 Q200 0 200 24 L200 100 L159 100 L159 92 A15 15 0 1 0 141 92 L141 100 L100 100 L100 59 L108 59 A15 15 0 1 0 108 41 L100 41 Z',
  'M0 100 L41 100 L41 108 A15 15 0 1 0 59 108 L59 100 L100 100 L100 141 L92 141 A15 15 0 1 0 92 159 L100 159 L100 200 L24 200 Q0 200 0 176 Z',
  'M100 100 L141 100 L141 92 A15 15 0 1 1 159 92 L159 100 L200 100 L200 176 Q200 200 176 200 L100 200 L100 159 L92 159 A15 15 0 1 1 92 141 L100 141 Z',
];

export const WORDMARK = [
  'M778 -1371V-982Q734 -997 710 -997Q664 -997 631.0 -963.0Q598 -929 598 -881Q598 -840 634 -777L665 -723Q749 -577 749 -441Q749 -242 607.5 -104.0Q466 34 262 34Q164 34 68 -11V-406Q126 -369 171 -369Q224 -369 259.5 -399.5Q295 -430 295 -476Q295 -506 238 -607Q147 -767 147 -927Q147 -1120 284.5 -1259.5Q422 -1399 613 -1399Q697 -1399 778 -1371Z',
  'M1548 -459 1919 -473Q1903 -257 1758.0 -118.0Q1613 21 1405 21Q1185 21 1033.5 -132.0Q882 -285 882 -507Q882 -718 1035.0 -868.0Q1188 -1018 1402 -1018Q1589 -1018 1732.0 -900.0Q1875 -782 1910 -599L1531 -585Q1482 -649 1407 -649Q1343 -649 1302.0 -607.0Q1261 -565 1261 -501Q1261 -436 1304.5 -392.0Q1348 -348 1413 -348Q1508 -348 1548 -459Z',
  'M2436 -1365V-948Q2531 -1017 2626 -1017Q2770 -1017 2854.5 -913.0Q2939 -809 2939 -632V0H2565V-527Q2565 -591 2551.5 -613.0Q2538 -635 2499 -635Q2436 -635 2436 -542V0H2062V-1365Z',
  'M3511 -1365V0H3137V-1365Z',
  'M3710 -983H4084V-420Q4084 -335 4155 -335Q4225 -335 4225 -420V-983H4599V-427Q4599 -233 4470.0 -99.5Q4341 34 4154 34Q3941 34 3811 -121Q3710 -242 3710 -457Z',
  'M5422 -983V-589Q5343 -589 5313.5 -559.5Q5284 -530 5276 -443Q5250 -154 5052 -35Q4947 27 4754 27H4702V-369H4719Q4809 -369 4847.5 -406.5Q4886 -444 4892 -538Q4900 -691 4920.5 -753.0Q4941 -815 5004 -876Q5114 -983 5309 -983Z',
  'M6149 -983V-589Q6070 -589 6040.5 -559.5Q6011 -530 6003 -443Q5977 -154 5779 -35Q5674 27 5481 27H5429V-369H5446Q5536 -369 5574.5 -406.5Q5613 -444 5619 -538Q5627 -691 5647.5 -753.0Q5668 -815 5731 -876Q5841 -983 6036 -983Z',
];

/** The four-piece mark. The last piece is always SCHLUSS blue. */
@Component({
  selector: 'sch-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="-4 -4 208 208" [attr.width]="size()" [attr.height]="size()" aria-hidden="true" [class.play]="animate()">
    @for (d of pieces; track $index) {
      <path [attr.d]="d" [class]="'p p' + ($index + 1)" [attr.fill]="$index === 3 ? 'var(--sch-blue)' : ink()" [attr.stroke]="gap()" stroke-width="7" stroke-linejoin="round" />
    }
  </svg>`,
  styles: `
    :host { display: inline-flex; line-height: 0; }
    svg { overflow: visible; }
    .p { transform-box: fill-box; transform-origin: center; }
    .play .p1 { animation: in1 .9s var(--ease) .1s both; }
    .play .p2 { animation: in2 .9s var(--ease) .25s both; }
    .play .p3 { animation: in3 .9s var(--ease) .4s both; }
    .play .p4 { animation: in4 1.3s cubic-bezier(.3,.7,.2,1) .65s both; }
    @keyframes in1 { from { transform: translate(-60px,-50px) rotate(-24deg) scale(.7); opacity: 0; } }
    @keyframes in2 { from { transform: translate(60px,-55px) rotate(20deg) scale(.7); opacity: 0; } }
    @keyframes in3 { from { transform: translate(-55px,60px) rotate(18deg) scale(.7); opacity: 0; } }
    @keyframes in4 { 0% { transform: translate(110px,90px) rotate(34deg) scale(.6); opacity: 0; } 60% { transform: translate(18px,16px) rotate(-3deg); opacity: 1; } 85% { transform: translate(-2px,-2px); } 100% { transform: none; } }
  `,
})
export class SchMark {
  readonly size = input<number | string>(32);
  readonly ink = input('var(--sch-paper)');
  readonly gap = input('var(--sch-ink)');
  readonly animate = input(false);
  protected readonly pieces = PIECES;
}

/** The SCHLUSS wordmark – final "s" in blue. */
@Component({
  selector: 'sch-wordmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 -1399 6162 1433" [attr.height]="height()" role="img" aria-label="SCHLUSS">
    @for (d of letters; track $index) {
      <path [attr.d]="d" [attr.fill]="$last ? 'var(--sch-blue)' : ink()" />
    }
  </svg>`,
  styles: `:host { display: inline-flex; line-height: 0; } svg { width: auto; overflow: visible; }`,
})
export class SchWordmark {
  readonly height = input<number | string>(22);
  readonly ink = input('var(--sch-paper)');
  protected readonly letters = WORDMARK;
}

/** Mark + wordmark lockup used in headers. */
@Component({
  selector: 'sch-logo',
  imports: [SchMark, SchWordmark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sch-mark [size]="size()" [ink]="ink()" [gap]="gap()" /><sch-wordmark [height]="size() * 0.6" [ink]="ink()" />`,
  styles: `:host { display: inline-flex; align-items: center; gap: 10px; }`,
})
export class SchLogo {
  readonly size = input(30);
  readonly ink = input('var(--sch-paper)');
  readonly gap = input('var(--sch-ink)');
}

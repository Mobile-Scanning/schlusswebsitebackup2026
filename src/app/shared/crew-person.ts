import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Looks of one crew member – the same cartoon people as in the SCHLUSS retail-journey picture. */
export interface CrewLook { shirt: string; pants: string; skin: string; hair: string; cap?: string | null; vest?: boolean }

export const CREW_LOOKS: CrewLook[] = [
  { shirt: '#ff7a3d', pants: '#283a6b', skin: '#f6c7a1', hair: '#2b1d16', cap: '#ffb020', vest: true },
  { shirt: '#3282f6', pants: '#1e2a50', skin: '#a86b45', hair: '#1a1a2a' },
  { shirt: '#22d3a6', pants: '#283a6b', skin: '#d99a6c', hair: '#5a3a22' },
  { shirt: '#a78bfa', pants: '#283a6b', skin: '#7a4a2e', hair: '#1a1a2a' },
  { shirt: '#ff5d8f', pants: '#283a6b', skin: '#f1d0b5', hair: '#e0b25b' },
  { shirt: '#ffb020', pants: '#283a6b', skin: '#d99a6c', hair: '#8a3b2b' },
];

function shade(c: string, f: number) {
  const n = parseInt(c.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * One animated crew member. Feet at the bottom centre of the box. The pose is set by classes on a parent
 * `.walker` element (walk, carry, hold, reach, point, cheer, look) – legs, arms, body and head are separate
 * parts that rotate around hips and shoulders, so the walking, reaching and carrying is real character movement.
 */
@Component({
  selector: 'sch-crew-person',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let l = look();
    <svg viewBox="-26 -66 52 70" aria-hidden="true">
      <ellipse class="shadow" cx="0" cy="1" rx="12" ry="3.6" />
      <g class="fig">
        <g class="leg back"><rect x="0.5" y="-18" width="5" height="18" rx="2.5" [attr.fill]="dark(l.pants)" /><rect x="0" y="-2.2" width="8" height="3.6" rx="1.8" fill="#1b1b2b" /></g>
        <g class="leg front"><rect x="-5.5" y="-18" width="5" height="18" rx="2.5" [attr.fill]="l.pants" /><rect x="-6" y="-2.2" width="8" height="3.6" rx="1.8" fill="#1b1b2b" /></g>
        <g class="upper">
          <g class="arm back"><rect x="-11.2" y="-33" width="4.6" height="15" rx="2.3" [attr.fill]="dark(l.shirt)" /><circle cx="-8.9" cy="-17.6" r="2.5" [attr.fill]="l.skin" /></g>
          <rect x="-8.5" y="-36" width="17" height="21" rx="7" [attr.fill]="l.shirt" />
          <rect x="-8.5" y="-36" width="17" height="21" rx="7" fill="url(#crew-gloss)" opacity=".6" />
          @if (l.vest) { <rect x="-8.5" y="-29" width="17" height="3" fill="#ffe14d" /><rect x="-8.5" y="-23" width="17" height="3" fill="#ffe14d" /> }
          <g class="head">
            <circle cx="0" cy="-45" r="9" [attr.fill]="l.skin" />
            <circle cx="4" cy="-45.5" r="1.3" fill="#1b1b2b" /><circle cx="-1" cy="-45.5" r="1.3" fill="#1b1b2b" />
            <path class="mouth" d="M0 -41.2 q2.6 2 5 0" stroke="#1b1b2b" stroke-width="1.1" fill="none" stroke-linecap="round" />
            @if (l.cap) { <path d="M-9.5 -47 a9.5 9.5 0 0 1 19 0 Z" [attr.fill]="l.cap" /><rect x="5" y="-48.5" width="9" height="3" rx="1.5" [attr.fill]="l.cap" /> }
            @else { <path d="M-9.5 -46 a9.5 10 0 0 1 19 -1 q-6 -3 -12 1 q-4 2 -7 0 Z" [attr.fill]="l.hair" /> }
          </g>
          <g class="arm front"><rect x="6.6" y="-33" width="4.6" height="15" rx="2.3" [attr.fill]="dark(l.shirt, .1)" /><circle cx="8.9" cy="-17.6" r="2.5" [attr.fill]="l.skin" /></g>
        </g>
      </g>
      <defs><linearGradient id="crew-gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45" /><stop offset=".6" stop-color="#fff" stop-opacity="0" /></linearGradient></defs>
    </svg>
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }
    .shadow { fill: #05031f; opacity: .38; }
    .fig, .leg, .arm, .upper, .head { transform-box: view-box; }
    .leg { transform-origin: 0 -17px; transition: transform .25s ease; }
    .arm.back { transform-origin: -8.9px -31px; }
    .arm.front { transform-origin: 8.9px -31px; }
    .arm { transition: transform .3s cubic-bezier(.3,.7,.3,1); }
    .head { transform-origin: 0 -38px; transition: transform .3s ease; }
    .fig { transform-origin: 0 0; }

    /* walking: legs and arms swing, the body bobs */
    :host-context(.walk) .leg.front { animation: legA .5s ease-in-out infinite; }
    :host-context(.walk) .leg.back { animation: legB .5s ease-in-out infinite; }
    :host-context(.walk) .fig { animation: bob .25s ease-in-out infinite alternate; }
    :host-context(.walk:not(.carry)) .arm.front { animation: legB .5s ease-in-out infinite; }
    :host-context(.walk:not(.carry)) .arm.back { animation: legA .5s ease-in-out infinite; }
    @keyframes legA { 0%, 100% { transform: rotate(26deg); } 50% { transform: rotate(-26deg); } }
    @keyframes legB { 0%, 100% { transform: rotate(-26deg); } 50% { transform: rotate(26deg); } }
    @keyframes bob { from { transform: translateY(0); } to { transform: translateY(-2px); } }

    /* carrying a piece above the head (both hands up) */
    :host-context(.carry) .arm.front { transform: rotate(-168deg); }
    :host-context(.carry) .arm.back { transform: rotate(168deg); }
    /* holding the opened piece up in front */
    :host-context(.hold) .arm.front { transform: rotate(-145deg); }
    :host-context(.hold) .arm.back { transform: rotate(-150deg); }
    :host-context(.hold) .head { transform: rotate(-8deg); }
    /* reaching for a piece */
    :host-context(.reach) .arm.front { transform: rotate(-160deg); }
    :host-context(.reach) .head { transform: rotate(-12deg); }
    /* guiding: pointing at the right place */
    :host-context(.point) .arm.front { transform: rotate(-115deg); }
    :host-context(.point) .head { transform: rotate(-6deg); }
    /* looking up at the empty centre */
    :host-context(.look) .head { transform: rotate(-14deg); }
    /* celebrating: arms up, little jumps */
    :host-context(.cheer) .arm.front { animation: wave .45s ease-in-out infinite alternate; transform: rotate(-160deg); }
    :host-context(.cheer) .arm.back { animation: waveB .45s ease-in-out infinite alternate; transform: rotate(160deg); }
    :host-context(.cheer) .fig { animation: jump .5s cubic-bezier(.3,.7,.4,1) infinite alternate; }
    @keyframes wave { from { transform: rotate(-150deg); } to { transform: rotate(-178deg); } }
    @keyframes waveB { from { transform: rotate(150deg); } to { transform: rotate(178deg); } }
    @keyframes jump { from { transform: translateY(0); } to { transform: translateY(-7px); } }
    /* idle breathing */
    :host-context(.idle) .upper { animation: breathe 2.6s ease-in-out infinite; transform-origin: 0 -16px; }
    @keyframes breathe { 50% { transform: scaleY(1.02) translateY(-.3px); } }

    :host-context(.halted) * { animation-play-state: paused !important; }
    :host-context(.reduced) * { animation: none !important; transition: none !important; }
  `,
})
export class SchCrewPerson {
  readonly look = input.required<CrewLook>();
  protected dark = (c: string, f = 0.18) => shade(c, -f);
}

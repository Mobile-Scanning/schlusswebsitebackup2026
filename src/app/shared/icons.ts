import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Simple outline icon set (24×24, stroke-based) used across the corporate design. */
const PATHS: Record<string, string> = {
  store: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v1a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0V9M5 13v7h14v-7M10 20v-4h4v4',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z',
  truck: 'M2 6h12v10H2zM14 9h4l4 4v3h-8M6 19a2 2 0 100-4 2 2 0 000 4zM18 19a2 2 0 100-4 2 2 0 000 4z',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 15V9a3 3 0 013-3h7M18 9v6a3 3 0 01-3 3H8',
  briefcase: 'M3 7h18v13H3zM8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7M22 21v-1a6 6 0 00-4-5.7',
  book: 'M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z',
  headset: 'M4 14v-2a8 8 0 0116 0v2M4 14h3v6H5a1 1 0 01-1-1zM20 14h-3v6h2a1 1 0 001-1zM17 20a3 3 0 01-3 2h-2',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  play: 'M12 22a10 10 0 100-20 10 10 0 000 20zM10 8l6 4-6 4z',
  key: 'M15 7a4 4 0 11-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0115 7zM16 9h.01',
  refresh: 'M21 12a9 9 0 01-15.5 6.2L3 16M3 12a9 9 0 0115.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  link: 'M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  check: 'M20 6L9 17l-5-5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  doc: 'M14 3H6v18h12V7l-4-4zM14 3v4h4M9 13h6M9 17h6',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  pin: 'M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12zM12 12a2 2 0 100-4 2 2 0 000 4z',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  handshake: 'M2 12l4-4 4 2 3-3 4 1 5 4-4 4M6 8v6l4 4M10 18l2 2M13 15l2 2M16 12l2 2',
};

/** Best-matching icon for a category/area name. */
export function iconFor(name: string): string {
  const n = name.toLowerCase();
  if (/reconcil|audit/.test(n)) return 'scale';
  if (/stock|inventor|warehouse/.test(n)) return 'box';
  if (/deliver|route|fleet/.test(n)) return 'route';
  if (/logist|transport|freight/.test(n)) return 'truck';
  if (/retail|store|shop|pos/.test(n)) return 'store';
  if (/financ|account|pay/.test(n)) return 'chart';
  if (/business|admin|crm|manage/.test(n)) return 'briefcase';
  if (/\bit\b|computer|network|hardware/.test(n)) return 'monitor';
  if (/automat/.test(n)) return 'cog';
  return 'grid';
}

@Component({
  selector: 'sch-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
  styles: `:host { display: inline-flex; line-height: 0; } svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }`,
})
export class SchIcon {
  readonly name = input.required<string>();
  readonly size = input<number | string>(24);
  protected d = computed(() => PATHS[this.name()] ?? PATHS['grid']);
}

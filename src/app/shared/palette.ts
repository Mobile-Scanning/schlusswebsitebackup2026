/**
 * SCHLUSS v5 colour system – "every piece has its colour".
 * SCHLUSS Blue stays the brand anchor; six supporting hues give each product
 * category and each website section its own identity.
 */
export interface Hue {
  key: string;
  name: string;
  /** main colour */
  c1: string;
  /** gradient partner */
  c2: string;
  /** light tint for text/glow on dark */
  glow: string;
}

export const HUES = {
  blue: { key: 'blue', name: 'SCHLUSS Blue', c1: '#3282F6', c2: '#1B4FD1', glow: '#8FBCFF' },
  violet: { key: 'violet', name: 'Violet', c1: '#7B5CFF', c2: '#4B2FD6', glow: '#BBA9FF' },
  teal: { key: 'teal', name: 'Teal', c1: '#14C2B0', c2: '#0A8C9E', glow: '#7FF0E2' },
  amber: { key: 'amber', name: 'Amber', c1: '#FFB020', c2: '#FF7A2F', glow: '#FFD68A' },
  magenta: { key: 'magenta', name: 'Magenta', c1: '#E7458C', c2: '#A42AC9', glow: '#FFA3CB' },
  lime: { key: 'lime', name: 'Lime', c1: '#8FD94B', c2: '#2BB673', glow: '#CFF7A6' },
  orange: { key: 'orange', name: 'Orange', c1: '#FF7A2F', c2: '#E7458C', glow: '#FFB58A' },
} satisfies Record<string, Hue>;

export type HueKey = keyof typeof HUES;
const ORDER: HueKey[] = ['blue', 'teal', 'amber', 'violet', 'magenta', 'lime', 'orange'];

/** Words in a category or product name that pick a fitting hue. */
const KEYWORDS: [RegExp, HueKey][] = [
  [/retail|pos|point of sale|shop|store/i, 'blue'],
  [/stock|inventory|warehouse|reorder|reconcil/i, 'teal'],
  [/logistic|delivery|transport|fleet|courier/i, 'amber'],
  [/business|management|desk|crm|hr|admin/i, 'violet'],
  [/it\b|computer|network|monitor|security|device/i, 'magenta'],
  [/finance|account|payroll|invoice|money|pay/i, 'lime'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable hue for a category (by slug/name keywords, otherwise by hash). */
export function hueFor(key: string | null | undefined): Hue {
  if (!key) return HUES.blue;
  for (const [re, k] of KEYWORDS) if (re.test(key)) return HUES[k];
  return HUES[ORDER[hash(key) % ORDER.length]];
}

/** Hue for a product: its category's hue, otherwise derived from its own name. */
export function productHue(p: { category?: { name: string; slug: string } | null; slug: string; name?: string }): Hue {
  return p.category ? hueFor(p.category.slug + ' ' + p.category.name) : hueFor(p.name ?? p.slug);
}

/** CSS custom properties for a hue – bind with [style]="hueStyle(h)". */
export function hueStyle(h: Hue): Record<string, string> {
  return { '--accent': h.c1, '--accent-2': h.c2, '--accent-glow': h.glow };
}

/** Destination colours for page transitions (puzzle pieces take the colour of where you're going). */
export function routeHues(path: string): Hue[] {
  if (path.startsWith('/coming-soon')) return [HUES.violet, HUES.magenta, HUES.blue];
  if (path.startsWith('/products')) return [HUES.blue, HUES.teal, HUES.violet, HUES.amber];
  if (path.startsWith('/about')) return [HUES.teal, HUES.blue, HUES.lime];
  if (path.startsWith('/partners')) return [HUES.amber, HUES.orange, HUES.violet];
  if (path.startsWith('/learning')) return [HUES.lime, HUES.teal, HUES.blue];
  if (path.startsWith('/contact') || path.startsWith('/request-demo')) return [HUES.magenta, HUES.orange, HUES.amber];
  if (/^\/(login|register|forgot|reset)/.test(path)) return [HUES.blue, HUES.violet, HUES.teal];
  if (/^\/(admin|partner|account)/.test(path)) return [HUES.blue, HUES.violet];
  return [HUES.blue, HUES.violet, HUES.teal, HUES.amber, HUES.magenta];
}

/** Deterministic pseudo-random generator (same product → same artwork every time). */
export function seeded(seed: string) {
  let s = hash(seed) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * The four logo pieces with square outer corners – four of them tile a 200×200 block,
 * so blocks tessellate seamlessly (used by page transitions and artwork).
 */
export const TILE_PIECES = [
  'M0 0 L100 0 L100 41 L108 41 A15 15 0 1 1 108 59 L100 59 L100 100 L59 100 L59 108 A15 15 0 1 1 41 108 L41 100 L0 100 Z',
  'M100 0 L200 0 L200 100 L159 100 L159 92 A15 15 0 1 0 141 92 L141 100 L100 100 L100 59 L108 59 A15 15 0 1 0 108 41 L100 41 Z',
  'M0 100 L41 100 L41 108 A15 15 0 1 0 59 108 L59 100 L100 100 L100 141 L92 141 A15 15 0 1 0 92 159 L100 159 L100 200 L0 200 Z',
  'M100 100 L141 100 L141 92 A15 15 0 1 1 159 92 L159 100 L200 100 L200 200 L100 200 L100 159 L92 159 A15 15 0 1 1 92 141 L100 141 Z',
];
/** Top-left of each piece's 100×100 cell inside the 200×200 block. */
export const TILE_CELL: [number, number][] = [
  [0, 0],
  [100, 0],
  [0, 100],
  [100, 100],
];

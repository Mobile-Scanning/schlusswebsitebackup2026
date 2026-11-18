import type { Plan, Pricing, ProductStatus } from '../core/public-api';

export const STATUS_LABEL: Record<ProductStatus, string> = {
  available: 'Available',
  coming_soon: 'Coming soon',
  beta: 'Beta testing',
  demo_available: 'Demo available',
  unavailable: 'Temporarily unavailable',
  discontinued: 'Discontinued',
};
export const STATUS_CLASS: Record<ProductStatus, string> = {
  available: 'badge-ok',
  coming_soon: 'badge-info',
  beta: 'badge-warn',
  demo_available: 'badge-info',
  unavailable: 'badge-muted',
  discontinued: 'badge-muted',
};

export const SECTION_LABEL: Record<string, string> = {
  getting_started: 'Getting started',
  installation: 'Installation',
  configuration: 'Configuration',
  usage: 'Using the software',
  advanced: 'Advanced features',
  troubleshooting: 'Troubleshooting',
  updates: 'Updates',
  training: 'Training',
  sales: 'Sales material',
  marketing: 'Marketing material',
};
export const SECTION_ORDER = Object.keys(SECTION_LABEL);

export const PLATFORM_LABEL: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iPhone & iPad', web: 'Web browser' };

/** "R 1 499.00" style – South African formatting, currency defaults to ZAR. */
export function money(cents: number, currency = 'ZAR'): string {
  const v = cents / 100;
  const opts: Intl.NumberFormatOptions = { style: 'currency', currency, minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat('en-ZA', opts).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

const PERIOD: Record<string, string> = { month: '/month', year: '/year', none: '' };
const UNIT: Record<string, string> = { user: ' per user', device: ' per device', licence: '' };

export function pricingLine(p?: Pricing | null): string {
  if (!p || !p.planCount) return 'Pricing on request';
  if (p.fromCents !== null) return `From ${money(p.fromCents, p.currency)}${PERIOD[p.period] ?? ''}${UNIT[p.unit] ?? ''}`;
  if (p.hasFree) return 'Free';
  if (p.quoteOnly || p.hasQuote) return 'Price on quotation';
  return 'Pricing on request';
}

export function planPrice(pl: Plan): { amount: string; suffix: string } {
  if (pl.model === 'free') return { amount: 'Free', suffix: '' };
  if (pl.model === 'quote' || pl.price_cents === null) return { amount: 'On quotation', suffix: '' };
  const suffix = [pl.model === 'once_off' ? 'once-off' : '', PERIOD[pl.billing_period]?.replace('/', 'per ') ?? '', UNIT[pl.unit]?.trim() ?? ''].filter(Boolean).join(' · ');
  return { amount: money(pl.price_cents, pl.currency), suffix: [suffix, pl.price_includes_vat ? 'incl. VAT' : 'excl. VAT'].filter(Boolean).join(' · ') };
}

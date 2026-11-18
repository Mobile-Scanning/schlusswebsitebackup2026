import { parseJson } from './catalogue';

/**
 * Offering types and their optional features.
 * One `products` row per offering, whatever its type – so a learning offering can become a software
 * product later (and back) keeping its id, URL, content, customers and history.
 */
export const OFFERING_TYPES = ['software', 'learning', 'training', 'development', 'other'] as const;
export type OfferingType = (typeof OFFERING_TYPES)[number];
export const FEATURE_KEYS = ['installer', 'demo', 'trial', 'pricing', 'purchase', 'learning'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

export const TYPE_LABEL: Record<OfferingType, string> = { software: 'Software product', learning: 'Learning content', training: 'Training / course', development: 'Product under development', other: 'Other' };

/** Which features each type may use at all (learning offerings never get installers, demos or trials). */
export const ALLOWED: Record<OfferingType, Features> = {
  software: { installer: true, demo: true, trial: true, pricing: true, purchase: true, learning: true },
  learning: { installer: false, demo: false, trial: false, pricing: true, purchase: true, learning: true },
  training: { installer: false, demo: false, trial: true, pricing: true, purchase: true, learning: true },
  development: { installer: true, demo: true, trial: true, pricing: true, purchase: true, learning: true },
  other: { installer: true, demo: true, trial: true, pricing: true, purchase: true, learning: true },
};

/** Sensible starting point for a new offering of each type (everything optional stays off). */
export const DEFAULTS: Record<OfferingType, Features> = {
  software: { installer: true, demo: false, trial: false, pricing: true, purchase: true, learning: true },
  learning: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
  training: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
  development: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
  other: { installer: false, demo: false, trial: false, pricing: false, purchase: false, learning: true },
};

/**
 * The effective features of an offering: the stored choices, limited to what the type allows.
 * Keys that were never stored (offerings from before v9) fall back to "allowed", so existing products keep
 * working exactly as before – their demo/trial/pricing sections still only appear when actually configured.
 * New offerings store their type's DEFAULTS explicitly when created.
 */
export function featuresOf(p: { offering_type?: string | null; features?: unknown }): Features {
  // Rows selected without these columns (older call sites) behave as before: everything allowed.
  if (p.offering_type === undefined) return { ...ALLOWED.software };
  const type = (OFFERING_TYPES as readonly string[]).includes(p.offering_type ?? '') ? (p.offering_type as OfferingType) : 'software';
  const stored = parseJson<Partial<Features>>(p.features, {});
  const out = {} as Features;
  for (const k of FEATURE_KEYS) out[k] = ALLOWED[type][k] && (stored[k] ?? ALLOWED[type][k]);
  return out;
}

export function offeringTypeOf(p: { offering_type?: string | null }): OfferingType {
  return (OFFERING_TYPES as readonly string[]).includes(p.offering_type ?? '') ? (p.offering_type as OfferingType) : 'software';
}

/**
 * The portal features an admin can switch on or off per client. A feature with
 * no row is ON: flags only ever record a deliberate change.
 */
export const FEATURE_KEYS = [
  'fix-plan',
  'reports',
  'performance',
  'technical',
  'organic-search',
  'ai-visibility',
  'social',
  'competitors',
  'backlinks',
  'keywords',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

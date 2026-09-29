import { apiFetch } from '@/lib/api-cache';

/**
 * The portal features an admin can switch per client. Keys match the backend's
 * `FEATURE_KEYS`; a feature with no stored switch is on.
 */
export const FEATURES = [
  { key: 'fix-plan', label: 'Fix Plan', note: 'The list of fixes, with steps and progress.', segment: 'plan' },
  { key: 'reports', label: 'Reports', note: 'Day-1 and monthly reports.', segment: 'reports' },
  { key: 'performance', label: 'Performance overview', note: 'The scores summary page.', segment: 'performance' },
  { key: 'technical', label: 'Technical health', note: 'Site health checks.', segment: 'performance/technical' },
  { key: 'organic-search', label: 'Google search', note: 'Search Console and Analytics data.', segment: 'performance/visibility/organic' },
  { key: 'ai-visibility', label: 'AI visibility', note: 'How AI answers mention the brand.', segment: 'performance/visibility/ai' },
  { key: 'social', label: 'Social channels', note: 'Posting activity on social profiles.', segment: 'performance/social' },
  { key: 'competitors', label: 'Competitors', note: 'The tracked competitor list and comparison.', segment: 'competitors' },
  { key: 'backlinks', label: 'Backlinks', note: 'Backlink and referring-domain data.', segment: 'competitors/backlinks' },
  { key: 'keywords', label: 'Keywords', note: 'Keyword rankings and ideas.', segment: 'keywords' },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];
export type FeatureMap = Record<FeatureKey, boolean>;

export const ALL_ON: FeatureMap = Object.fromEntries(FEATURES.map((f) => [f.key, true])) as FeatureMap;

/**
 * Which feature owns a path under a project (`/plan/abc`, `/performance/technical`…),
 * or null for pages that are always available. The longest matching segment wins,
 * so `/competitors/backlinks` belongs to Backlinks, not Competitors.
 */
export function featureForPath(rest: string): FeatureKey | null {
  const path = rest.replace(/^\/+|\/+$/g, '');
  if (path === '') return null;
  let best: { key: FeatureKey; length: number } | null = null;
  for (const f of FEATURES) {
    if (path === f.segment || path.startsWith(`${f.segment}/`)) {
      if (!best || f.segment.length > best.length) best = { key: f.key, length: f.segment.length };
    }
  }
  return best?.key ?? null;
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : 'Something went wrong',
    );
  }
  return data as T;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function getFeatures(accessToken: string, clientId: string): Promise<FeatureMap> {
  const response = await apiFetch(`/api/proxy/clients/${clientId}/features`, { headers: authHeaders(accessToken) });
  return { ...ALL_ON, ...(await parseOrThrow<Partial<FeatureMap>>(response)) };
}

export async function setFeature(accessToken: string, clientId: string, key: FeatureKey, enabled: boolean): Promise<FeatureMap> {
  const response = await apiFetch(`/api/proxy/clients/${clientId}/features/${key}`, {
    method: 'PUT',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return { ...ALL_ON, ...(await parseOrThrow<Partial<FeatureMap>>(response)) };
}

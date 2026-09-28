'use client';

import { Stat, StatRow } from '@/components/portal/blocks';

export interface DomainOverview {
  rank: number | null;
  rankedKeywords: number | null;
  trafficEstimate: number | null;
  refDomains: number | null;
}

/** Your site's reach in search at a glance. Renders nothing until the first check lands. */
export function DomainStrip({ domain }: { domain: DomainOverview | null }) {
  if (!domain) return null;
  return (
    <StatRow cols={4}>
      <Stat
        index={1}
        label="Site authority rank"
        value={domain.rank !== null ? `#${domain.rank.toLocaleString()}` : null}
        caption="Lower is stronger"
        hint="Where your site sits among all websites for overall search strength. A smaller number means a stronger site."
      />
      <Stat index={2} label="Searches you appear for" value={domain.rankedKeywords} caption="In Google's top 100 results" />
      <Stat
        index={3}
        label="Visits from Google"
        value={domain.trafficEstimate}
        caption="Estimated per month"
        hint="An outside estimate based on your positions and how often people search. Your own analytics are the exact figure."
      />
      <Stat index={4} label="Linking websites" value={domain.refDomains} caption="Different sites that link to you" />
    </StatRow>
  );
}

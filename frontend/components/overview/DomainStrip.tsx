'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Num } from '@/components/portal/motion';

export interface DomainOverview {
  rank: number | null;
  rankedKeywords: number | null;
  trafficEstimate: number | null;
  refDomains: number | null;
}

function fmt(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

/** Domain authority at a glance. Empty state when no domain-overview snapshot exists. */
export function DomainStrip({
  domain,
  pulledAt,
}: {
  domain: DomainOverview | null;
  pulledAt: string | null;
}) {
  if (!domain) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Domain overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No domain overview yet — it appears here once the first data pull completes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stats = [
    { label: 'Domain rank', value: domain.rank !== null ? `#${domain.rank.toLocaleString()}` : '—' },
    { label: 'Ranked keywords', value: fmt(domain.rankedKeywords) },
    { label: 'Est. monthly traffic', value: fmt(domain.trafficEstimate) },
    { label: 'Referring domains', value: fmt(domain.refDomains) },
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 pt-5 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
            <p className="text-3xl font-semibold"><Num value={stat.value} /></p>
          </div>
        ))}
        {pulledAt ? (
          <p className="col-span-2 text-xs text-muted-foreground lg:col-span-4">
            Pulled {new Date(pulledAt).toLocaleDateString()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

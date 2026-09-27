'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

/** Onward links to the deeper Technical / Organic / AI tabs. */
export function ExploreLinks({ projectId }: { projectId: string }) {
  const base = `/client/projects/${projectId}`;
  const links = [
    {
      href: `${base}/performance/technical`,
      label: 'Technical',
      note: 'Site score, Core Web Vitals, and page issues.',
    },
    {
      href: `${base}/performance/visibility/organic`,
      label: 'Organic',
      note: 'Search Console clicks, queries, and index coverage.',
    },
    {
      href: `${base}/performance/visibility/ai`,
      label: 'AI visibility',
      note: 'How often AI answers mention you vs rivals.',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {links.map((link) => (
        <Link key={link.label} href={link.href} className="block">
          <Card className="h-full transition-colors hover:bg-muted/30">
            <CardContent className="flex flex-col gap-1 pt-5">
              <p className="text-sm font-medium">
                {link.label} <span className="text-muted-foreground">→</span>
              </p>
              <p className="text-xs text-muted-foreground">{link.note}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

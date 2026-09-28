'use client';

import { Gauge } from '@/components/animate-ui/icons/gauge';
import { Search } from '@/components/animate-ui/icons/search';
import { Sparkles } from '@/components/animate-ui/icons/sparkles';
import { Tile, TileHeader } from '@/components/portal/layout';

/** Onward links to the deeper Technical / Organic / AI pages. */
export function ExploreLinks({ projectId, index = 0 }: { projectId: string; index?: number }) {
  const base = `/client/projects/${projectId}`;
  const links = [
    {
      href: `${base}/performance/technical`,
      icon: Gauge,
      label: 'Technical health',
      note: 'Whether search engines and AI tools can reach and read your site.',
    },
    {
      href: `${base}/performance/visibility/organic`,
      icon: Search,
      label: 'Google search',
      note: 'Clicks, searches and pages from your own Google Search Console.',
    },
    {
      href: `${base}/performance/visibility/ai`,
      icon: Sparkles,
      label: 'AI visibility',
      note: 'How often ChatGPT, Perplexity and Gemini name you when buyers ask.',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {links.map((link, i) => (
        <Tile key={link.label} href={link.href} index={index + i} ariaLabel={link.label}>
          <TileHeader icon={link.icon} eyebrow={link.label} linkHint />
          <p className="text-sm text-muted-foreground">{link.note}</p>
        </Tile>
      ))}
    </div>
  );
}

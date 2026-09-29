import { FileText, ListChecks, Share2, Wrench } from 'lucide-react';
import { Gauge } from '@/components/animate-ui/icons/gauge';
import { Key } from '@/components/animate-ui/icons/key';
import { LayoutDashboard } from '@/components/animate-ui/icons/layout-dashboard';
import { Link as LinkIcon } from '@/components/animate-ui/icons/link';
import { Search } from '@/components/animate-ui/icons/search';
import { Settings } from '@/components/animate-ui/icons/settings';
import { Sparkles } from '@/components/animate-ui/icons/sparkles';
import { Users } from '@/components/animate-ui/icons/users';
import type { FeatureKey } from '@/lib/features-api';

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  indent?: boolean;
  /** Prefix match instead of exact (covers future sub-routes). */
  prefix?: boolean;
  /** Count of things waiting on the client (shown as a pill). */
  badge?: number;
  /** The switchable feature this page belongs to. Absent means always on. */
  feature?: FeatureKey;
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
  /** Renders the label as a collapsible bar hiding its items until expanded. */
  collapsible?: boolean;
}

/**
 * The project menu, shared by the client portal and the admin preview so the
 * two can never drift apart. `base` is where the project's pages live.
 */
export function projectNav(base: string, fixBadge = 0): NavSection[] {
  return [
    {
      label: 'Workspace',
      items: [
        { label: 'Dashboard', href: base, icon: LayoutDashboard },
        { label: 'Fix Plan', href: `${base}/plan`, icon: ListChecks, prefix: true, badge: fixBadge, feature: 'fix-plan' },
        { label: 'Reports', href: `${base}/reports`, icon: FileText, feature: 'reports' },
      ],
    },
    {
      label: 'Performance',
      collapsible: true,
      items: [
        { label: 'Overview', href: `${base}/performance`, icon: Gauge, feature: 'performance' },
        { label: 'Technical health', href: `${base}/performance/technical`, icon: Wrench, feature: 'technical' },
        { label: 'Google search', href: `${base}/performance/visibility/organic`, icon: Search, feature: 'organic-search' },
        { label: 'AI visibility', href: `${base}/performance/visibility/ai`, icon: Sparkles, feature: 'ai-visibility' },
        { label: 'Social channels', href: `${base}/performance/social`, icon: Share2, feature: 'social' },
      ],
    },
    {
      label: 'Compare',
      items: [
        { label: 'Competitors', href: `${base}/competitors`, icon: Users, feature: 'competitors' },
        { label: 'Backlinks', href: `${base}/competitors/backlinks`, icon: LinkIcon, indent: true, feature: 'backlinks' },
        { label: 'Keywords', href: `${base}/keywords`, icon: Key, feature: 'keywords' },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Settings', href: `${base}/settings`, icon: Settings },
        { label: 'Team management', href: `${base}/team`, icon: Users },
      ],
    },
  ];
}

/** Drops the pages a client has switched off, and any section left empty. */
export function visibleNav(sections: NavSection[], enabled: (feature: FeatureKey) => boolean): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.feature || enabled(item.feature)) }))
    .filter((section) => section.items.length > 0);
}

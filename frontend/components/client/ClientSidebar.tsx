'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Search,
  Settings,
  Share2,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { cn } from 'cn';
import { useClientProject } from '@/components/client/use-client-project';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  indent?: boolean;
  /** Prefix match instead of exact (covers future sub-routes). */
  prefix?: boolean;
}

interface NavSection {
  label: string | null;
  items: NavItem[];
  /** Renders the label as a collapsible bar hiding its items until expanded. */
  collapsible?: boolean;
}

function projectNav(projectId: string): NavSection[] {
  const base = `/client/projects/${projectId}`;
  return [
    {
      label: null,
      items: [
        { label: 'Dashboard', href: base, icon: LayoutDashboard },
        { label: 'Reports', href: `${base}/reports`, icon: FileText, prefix: true },
      ],
    },
    {
      label: 'Performance',
      collapsible: true,
      items: [
        { label: 'Overview', href: `${base}/performance`, icon: Gauge },
        { label: 'Technical', href: `${base}/performance/technical`, icon: Wrench },
        { label: 'Organic', href: `${base}/performance/visibility/organic`, icon: Search, indent: true },
        { label: 'AI', href: `${base}/performance/visibility/ai`, icon: Sparkles, indent: true },
        { label: 'Social', href: `${base}/performance/social`, icon: Share2 },
      ],
    },
    {
      label: null,
      items: [
        { label: 'Competitors', href: `${base}/competitors`, icon: Users, prefix: true },
        { label: 'Backlinks', href: `${base}/competitors/backlinks`, icon: Link2, indent: true },
        { label: 'Keywords', href: `${base}/keywords`, icon: KeyRound },
      ],
    },
    {
      label: null,
      items: [
        { label: 'Settings', href: `${base}/settings`, icon: Settings },
        { label: 'Team management', href: '/team', icon: Users },
      ],
    },
  ];
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  // Dashboard must not stay active under every sub-route.
  return pathname === item.href;
}

function readStoredPerformanceOpen(projectId: string | undefined): boolean | null {
  if (!projectId) return null;
  try {
    const stored = localStorage.getItem(`cailyx:nav:performance:${projectId}`);
    return stored === null ? null : stored === '1';
  } catch {
    return null;
  }
}

export function ClientSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  const match = pathname.match(/^\/client\/projects\/([^/]+)/);
  const projectId = match?.[1];

  // Collapsible Performance group: open on performance routes, otherwise
  // remembers the user's last choice per project. The project switch is
  // handled during render (not in an effect) so a stale choice never leaks
  // across projects.
  const [projectKey, setProjectKey] = useState(projectId);
  const [manualOpen, setManualOpen] = useState<boolean | null>(() => readStoredPerformanceOpen(projectId));

  if (projectKey !== projectId) {
    setProjectKey(projectId);
    setManualOpen(readStoredPerformanceOpen(projectId));
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  function renderSection(section: NavSection, index: number, perfBase: string) {
    if (!section.collapsible || !section.label) {
      return (
        <div key={index} className="flex flex-col gap-0.5">
          {section.label ? (
            <p className="g-eyebrow px-2 pb-1">{section.label}</p>
          ) : null}
          {section.items.map((item) => (
            <NavLink key={item.href + item.label} pathname={pathname} item={item} />
          ))}
        </div>
      );
    }

    const inSection = pathname === perfBase || pathname.startsWith(`${perfBase}/`);
    const open = manualOpen ?? inSection;

    return (
      <div key={index} className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setManualOpen(next);
            if (projectId) localStorage.setItem(`cailyx:nav:performance:${projectId}`, next ? '1' : '0');
          }}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Gauge className="size-4 shrink-0" />
          <span className="flex-1 text-left">{section.label}</span>
          {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        </button>
        {open ? (
          <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
            {section.items.map((item) => (
              <NavLink key={item.href + item.label} pathname={pathname} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="flex w-full flex-col gap-4 border-b border-border bg-sidebar p-4 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
      <Link href="/client" className="flex items-center gap-2 px-1" aria-label="Cailyx home">
        <BrandMark />
        <span className="flex flex-col leading-none">
          <span className="text-base font-bold tracking-tight">Cailyx</span>
          <span className="mt-0.5 text-[0.65rem] text-muted-foreground">by Rothenhall</span>
        </span>
      </Link>

      {projectId ? <ProjectBadge projectId={projectId} /> : null}

      <nav className="flex flex-col gap-4">
        {projectId ? (
          projectNav(projectId).map((section, i) =>
            renderSection(section, i, `/client/projects/${projectId}/performance`),
          )
        ) : (
          <p className="px-2 text-sm text-muted-foreground">Select a project to see its sections.</p>
        )}
      </nav>

      <div className="flex flex-col gap-2 border-t border-border pt-3 md:mt-auto">
        {user ? <p className="truncate px-1 text-xs text-muted-foreground">{user.email}</p> : null}
        <Button variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="size-4" />
          Log out
        </Button>
      </div>
    </aside>
  );
}

function NavLink({ pathname, item }: { pathname: string; item: NavItem }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150',
        item.indent && 'pl-2',
        isActive(pathname, item)
          ? 'bg-accent font-medium text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-[3px] before:rounded-full before:bg-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

/** Small orbit mark: a body in an answer's orbit, the Cailyx idea in one glyph. */
function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <ellipse cx="16" cy="16" rx="10" ry="5.5" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="1.2" transform="rotate(-24 16 16)" />
      <circle cx="16" cy="16" r="3.4" fill="white" />
      <circle cx="24.4" cy="12.2" r="1.6" fill="white" fillOpacity="0.8" />
    </svg>
  );
}

/** The open project: monogram, name and domain, linking back to the project list. */
function ProjectBadge({ projectId }: { projectId: string }) {
  const { user, accessToken } = useAuth();
  const project = useClientProject(accessToken, user?.clientId ?? '', projectId);
  if (!project) return <div className="g-skeleton h-12 rounded-xl" aria-hidden />;
  const initials = project.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <Link
      href="/client"
      className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 p-2 transition-colors duration-150 hover:bg-muted"
      title="Switch project"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-xs font-semibold shadow-sm ring-1 ring-border">
        {initials}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{project.name}</span>
        <span className="truncate text-xs text-muted-foreground">{project.domain}</span>
      </span>
    </Link>
  );
}

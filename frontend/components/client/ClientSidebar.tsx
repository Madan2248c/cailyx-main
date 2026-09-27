'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { cn } from 'cn';

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
      ],
    },
    {
      label: null,
      items: [{ label: 'Competitors', href: `${base}/competitors`, icon: Users, prefix: true }],
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
            <p className="px-2 text-xs font-medium text-muted-foreground">{section.label}</p>
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
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
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
    <aside className="flex w-full flex-col gap-4 border-b border-border bg-background p-4 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
      <Link href="/client" className="px-1 text-base font-semibold tracking-tight">
        Cailyx
      </Link>

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
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted',
        item.indent && 'pl-2',
        isActive(pathname, item) ? 'bg-muted font-medium' : 'text-muted-foreground',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

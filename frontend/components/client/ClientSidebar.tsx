'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderKanban, LoaderCircle } from 'lucide-react';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Gauge } from '@/components/animate-ui/icons/gauge';
import { LogOut } from '@/components/animate-ui/icons/log-out';
import { Highlight, HighlightItem } from '@/components/animate-ui/primitives/effects/highlight';
import { CailyxLockup, RothenhallCredit } from '@/components/brand/brand';
import { Button } from '@/components/portal/button';
import { useAuth } from '@/contexts/auth-context';
import { cn } from 'cn';
import { useClientProject } from '@/components/client/use-client-project';
import { useFixSummary } from '@/components/remediation/use-fix-summary';
import { projectNav, visibleNav, type NavItem, type NavSection } from '@/components/client/nav';
import { useFeatures } from '@/components/portal/use-features';

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
  const { user, accessToken, logout } = useAuth();
  const router = useRouter();

  const match = pathname.match(/^\/client\/projects\/([^/]+)/);
  const projectId = match?.[1];
  const fixSummary = useFixSummary(accessToken, user?.clientId ?? '', projectId);
  const fixBadge = fixSummary ? fixSummary.awaitingDecision + fixSummary.regressed : 0;
  const { enabled } = useFeatures(accessToken, user?.clientId ?? null);

  // Collapsible Performance group: open on performance routes, otherwise
  // remembers the user's last choice per project. The project switch is
  // handled during render (not in an effect) so a stale choice never leaks
  // across projects.
  const [projectKey, setProjectKey] = useState(projectId);
  const [manualOpen, setManualOpen] = useState<boolean | null>(() => readStoredPerformanceOpen(projectId));
  const [mobileOpen, setMobileOpen] = useState(false);

  if (projectKey !== projectId) {
    setProjectKey(projectId);
    setManualOpen(readStoredPerformanceOpen(projectId));
  }

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  }

  function renderSection(section: NavSection, index: number, perfBase: string) {
    if (!section.collapsible || !section.label) {
      return (
        <div key={index} className="flex flex-col gap-0.5">
          {section.label ? (
            <p className="g-eyebrow px-2 pb-1">{section.label}</p>
          ) : null}
          {groupIndented(section.items).map(({ item, children }) => (
            <div key={item.href + item.label} className="flex flex-col gap-0.5">
              <NavLink pathname={pathname} item={item} />
              {children.length > 0 ? (
                <SubNav>
                  {children.map((child) => (
                    <NavLink key={child.href + child.label} pathname={pathname} item={child} />
                  ))}
                </SubNav>
              ) : null}
            </div>
          ))}
        </div>
      );
    }

    const inSection = pathname === perfBase || pathname.startsWith(`${perfBase}/`);
    const open = inSection || manualOpen === true;

    return (
      <div key={index} className="flex flex-col gap-0.5">
        <AnimateIcon animateOnHover asChild>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setManualOpen(next);
            if (projectId) localStorage.setItem(`cailyx:nav:performance:${projectId}`, next ? '1' : '0');
          }}
          className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Gauge size={16} className="size-4 shrink-0" />
          <span className="flex-1 text-left">{section.label}</span>
          {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        </button>
        </AnimateIcon>
        {open ? (
          <SubNav>
            {section.items.map((item) => (
              <NavLink key={item.href + item.label} pathname={pathname} item={item} />
            ))}
          </SubNav>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="flex w-full flex-col gap-4 border-b border-border bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-2 pt-3 pb-4 md:pt-4 md:pb-5">
        <Link
          href="/client"
          aria-label="Cailyx home"
          className="flex items-center gap-2 rounded px-2 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <CailyxLockup />
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="client-nav"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? 'Close menu' : 'Menu'}
        </Button>
      </div>

      {projectId ? <ProjectBadge projectId={projectId} /> : null}

      <nav
        id="client-nav"
        aria-label="Project"
        className={mobileOpen ? 'flex flex-col gap-4' : 'hidden flex-col gap-4 md:flex'}
      >
        {projectId ? (
          <Highlight
            controlledItems
            hover
            click={false}
            mode="children"
            className="inset-0 rounded-lg bg-muted"
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          >
            <div className="flex flex-col gap-4">
              {visibleNav(projectNav(`/client/projects/${projectId}`, fixBadge), enabled).map((section, i) =>
                renderSection(section, i, `/client/projects/${projectId}/performance`),
              )}
            </div>
          </Highlight>
        ) : (
          <div className="flex flex-col gap-3">
            <Highlight
              controlledItems
              hover
              click={false}
              mode="children"
              className="inset-0 rounded-lg bg-muted"
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            >
              <NavLink pathname={pathname} item={{ label: 'Projects', href: '/client', icon: FolderKanban }} />
            </Highlight>
            <p className="px-2 text-xs leading-relaxed text-muted-foreground">
              Open a project to see its dashboard, Fix Plan, reports and more.
            </p>
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-3 border-t border-border pt-3 md:mt-auto">
        {user ? (
          <div className="flex items-center gap-2.5 px-1">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
            >
              {user.email.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={user.email}>
              {user.email}
            </span>
          </div>
        ) : null}
        <AnimateIcon animateOnHover asChild>
          <Button variant="outline" size="sm" onClick={handleLogout} disabled={isLoggingOut} aria-busy={isLoggingOut}>
            {isLoggingOut ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <LogOut size={16} className="size-4" />}
            {isLoggingOut ? 'Logging out…' : 'Log out'}
          </Button>
        </AnimateIcon>
        <RothenhallCredit />
      </div>
    </aside>
  );
}

function NavLink({ pathname, item }: { pathname: string; item: NavItem }) {
  const active = isActive(pathname, item);
  return (
    <HighlightItem value={item.href}>
    <AnimateIcon animateOnHover asChild>
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
        active
          ? 'bg-accent font-medium text-foreground before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[3px] before:rounded-full before:bg-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <item.icon aria-hidden="true" size={16} className="size-4 shrink-0" />
      {item.label}
      {item.badge ? (
        <span
          className="g-num ml-auto rounded-full px-1.5 py-px text-xs font-semibold text-warning"
          style={{ background: 'var(--warning-soft)' }}
          aria-label={`${item.badge} waiting on you`}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
    </AnimateIcon>
    </HighlightItem>
  );
}

/**
 * One nesting style for every child list in the sidebar. The guide line sits
 * under the centre of the parent's icon (8px padding + half of a 16px icon),
 * so parent and children read as one column.
 */
function SubNav({ children }: { children: React.ReactNode }) {
  return <div className="ml-[15px] flex flex-col gap-0.5 border-l border-border pl-2">{children}</div>;
}

/** Folds each run of `indent` items under the item before it. */
function groupIndented(items: NavItem[]): Array<{ item: NavItem; children: NavItem[] }> {
  const groups: Array<{ item: NavItem; children: NavItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.indent && last) last.children.push(item);
    else groups.push({ item, children: [] });
  }
  return groups;
}

/** The open project: monogram, name and domain, linking back to the project list. */
function ProjectBadge({ projectId }: { projectId: string }) {
  const { user, accessToken } = useAuth();
  const project = useClientProject(accessToken, user?.clientId ?? '', projectId);
  if (!project) return <div className="g-skeleton h-12 rounded-xl" aria-hidden="true" />;
  const initials = project.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <Link
      href="/client"
      className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 p-2 transition-colors duration-150 outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

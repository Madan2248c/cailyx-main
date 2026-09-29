'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Eye, LoaderCircle } from 'lucide-react';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Clock } from '@/components/animate-ui/icons/clock';
import { LayoutDashboard } from '@/components/animate-ui/icons/layout-dashboard';
import { LogOut } from '@/components/animate-ui/icons/log-out';
import { Users } from '@/components/animate-ui/icons/users';
import { Highlight, HighlightItem } from '@/components/animate-ui/primitives/effects/highlight';
import { AdminGate } from '@/components/admin/admin-ui';
import { CailyxLockup, RothenhallCredit } from '@/components/brand/brand';
import { PortalMotion } from '@/components/portal/motion';
import { Button } from '@/components/portal/button';
import { PageTransition } from '@/components/portal/reveal';
import { useAuth } from '@/contexts/auth-context';
import { cn } from 'cn';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  exact: boolean;
}

const NAV: NavItem[] = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard, exact: true },
  { label: 'Clients', href: '/admin/clients', icon: Users, exact: false },
  { label: 'Schedules', href: '/admin/schedules', icon: Clock, exact: false },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The client preview replaces the whole admin chrome with the client's own
  // portal (plus the yellow preview bar), so it renders bare.
  const preview = pathname.startsWith('/admin/preview');

  return (
    <PortalMotion>
      <div className={cn('theme-graphite flex min-h-screen flex-col', !preview && 'md:flex-row')}>
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <AdminGate>
          {preview ? (
            children
          ) : (
            <>
              <AdminSidebar />
              <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col bg-canvas outline-none">
                <PageTransition>{children}</PageTransition>
              </main>
            </>
          )}
        </AdminGate>
      </div>
    </PortalMotion>
  );
}

function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  // The menu is open for the page it was opened on, so choosing a destination on a phone closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const mobileOpen = openOn === pathname;
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

  return (
    <aside className="flex w-full flex-col gap-4 border-b border-border bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-center justify-between gap-2 pt-3 pb-1 md:pt-4">
        <Link
          href="/admin"
          aria-label="Cailyx admin home"
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
          aria-controls="admin-nav"
          onClick={() => setOpenOn(mobileOpen ? null : pathname)}
        >
          {mobileOpen ? 'Close menu' : 'Menu'}
        </Button>
      </div>

      <p className="g-eyebrow -mt-2 px-2 pb-1">Admin console</p>

      <div id="admin-nav" className={cn('flex-col gap-4 md:flex md:flex-1', mobileOpen ? 'flex' : 'hidden')}>
        <nav aria-label="Admin">
          <Highlight
            controlledItems
            hover
            click={false}
            mode="children"
            className="inset-0 rounded-lg bg-muted"
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          >
            <div className="flex flex-col gap-0.5">
              {NAV.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <HighlightItem key={item.href} value={item.href}>
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
                      </Link>
                    </AnimateIcon>
                  </HighlightItem>
                );
              })}
            </div>
          </Highlight>
        </nav>

        <Link
          href="/admin/clients"
          className="group flex flex-col gap-1 rounded-xl border border-border bg-muted/50 p-3 outline-none transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Eye className="size-3.5" aria-hidden />
            Preview as client
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Open a client, then choose Preview as client for a read-only view of their portal.
          </span>
        </Link>

        <div className="flex flex-col gap-3 border-t border-border pt-3 md:mt-auto">
          {user ? (
            <div className="flex items-center gap-2.5 px-1">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
              >
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-foreground" title={user.email}>
                  {user.email}
                </span>
                <span className="text-xs text-muted-foreground">Administrator</span>
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
      </div>
    </aside>
  );
}

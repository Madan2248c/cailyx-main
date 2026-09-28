'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarClock, Eye, LayoutDashboard, LogOut, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { cn } from 'cn';

const NAV = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard, exact: true },
  { label: 'Clients', href: '/admin/clients', icon: Users, exact: false },
  { label: 'Schedules', href: '/admin/schedules', icon: CalendarClock, exact: false },
];

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="flex w-full flex-col gap-4 border-b border-border bg-background p-4 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 md:sticky md:top-0">
        <Link href="/admin" className="px-1 text-base font-semibold tracking-tight">
          Cailyx <span className="font-normal text-muted-foreground">· Admin</span>
        </Link>

        <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-muted',
                isActive(pathname, item.href, item.exact)
                  ? 'bg-muted font-medium'
                  : 'text-muted-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden rounded-lg border border-border p-3 md:block">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Eye className="size-3.5" />
            Preview as client
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Open a client, then Projects → Preview as client for a read-only view of their portal.
          </p>
          <Link
            href="/admin/clients"
            className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
          >
            Go to Clients →
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-medium">Admin console</p>
          <div className="flex min-w-0 items-center gap-3">
            {user ? (
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            ) : null}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" />
              Log out
            </Button>
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

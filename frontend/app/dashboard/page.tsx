'use client';

import { Building2, ChevronRight, LayoutDashboard, LoaderCircle, LogOut, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CailyxLockup, RothenhallCredit } from '@/components/brand/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import type { Role } from '@/types/auth';

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  CLIENT_POC: 'Client POC',
  CLIENT_MEMBER: 'Client Member',
};

interface Destination {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  roles: Role[];
}

const DESTINATIONS: Destination[] = [
  {
    href: '/admin/clients',
    label: 'Manage clients',
    description: 'Clients, projects and schedules',
    icon: Building2,
    roles: ['ADMIN'],
  },
  {
    href: '/client',
    label: 'Open workspace',
    description: 'Your projects, reports and Fix Plan',
    icon: LayoutDashboard,
    roles: ['CLIENT_POC', 'CLIENT_MEMBER'],
  },
  {
    href: '/team',
    label: 'Manage team',
    description: 'Invite and manage teammates',
    icon: Users,
    roles: ['CLIENT_POC'],
  },
  {
    href: '/onboarding',
    label: 'Review company details',
    description: 'Keep your company profile up to date',
    icon: Building2,
    roles: ['CLIENT_POC', 'CLIENT_MEMBER'],
  },
];

export default function DashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="theme-graphite flex flex-1 items-center justify-center gap-2 bg-canvas">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  }

  const destinations = DESTINATIONS.filter((d) => d.roles.includes(user.role));
  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div className="theme-graphite flex flex-1 flex-col items-center justify-center gap-8 bg-canvas px-4 py-10">
      <CailyxLockup size="lg" />
      <Card className="w-full max-w-md gap-6 py-8 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground"
            >
              {initial}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl leading-none font-semibold">Welcome back</h1>
              <p className="truncate text-sm text-muted-foreground" title={user.email}>
                {user.email}
              </p>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-foreground/10">
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>

          <nav aria-label="Where to next" className="flex flex-col gap-2">
            {destinations.map(({ href, label, description, icon: Icon }, index) => (
              <Link
                key={href}
                href={href}
                className={
                  'group/row flex items-center gap-3 rounded-lg px-3.5 py-3 outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none ' +
                  (index === 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'ring-1 ring-foreground/10 hover:bg-muted')
                }
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{label}</span>
                  <span className={'text-xs ' + (index === 0 ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                    {description}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="ml-auto size-4 shrink-0 opacity-60 transition-transform duration-150 group-hover/row:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            ))}
          </nav>

          <Button
            variant="ghost"
            onClick={handleLogout}
            disabled={isLoggingOut}
            aria-busy={isLoggingOut}
            className="h-10 w-full text-muted-foreground"
          >
            {isLoggingOut ? (
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <LogOut aria-hidden />
            )}
            {isLoggingOut ? 'Logging out…' : 'Log out'}
          </Button>
        </CardContent>
      </Card>
      <RothenhallCredit align="center" />
    </div>
  );
}

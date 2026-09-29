import type { ReactNode } from 'react';
import { CailyxLockup, RothenhallCredit } from '@/components/brand/brand';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The frame for every sign-in screen (login, forgot/reset password, accept
 * invite). It wears the client portal's Graphite theme and brand, so a client
 * sees the same type, colours and marks before and after signing in.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="theme-graphite flex flex-1 flex-col items-center justify-center gap-8 bg-canvas px-4 py-10">
      <CailyxLockup size="lg" />
      <Card className="w-full max-w-md gap-6 py-8 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
        <CardHeader className="gap-1.5 text-center">
          <CardTitle className="text-xl font-semibold">{title}</CardTitle>
          {subtitle ? <CardDescription className="text-sm/relaxed">{subtitle}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      <RothenhallCredit align="center" />
    </div>
  );
}

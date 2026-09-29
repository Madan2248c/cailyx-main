'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/portal/button';
import { PortalPage, Tile } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { useFeatures } from '@/components/portal/use-features';
import { useAuth } from '@/contexts/auth-context';
import { featureForPath } from '@/lib/features-api';

/**
 * Keeps a client out of a section their account manager has switched off,
 * including when they type the address. Pages that belong to no switchable
 * feature (the dashboard, settings) pass straight through.
 */
export function FeatureGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, accessToken } = useAuth();
  const match = pathname.match(/^\/client\/projects\/([^/]+)(\/.*)?$/);
  const feature = match ? featureForPath(match[2] ?? '') : null;
  const { features, error } = useFeatures(feature ? accessToken : null, user?.clientId ?? null);

  if (!feature || !match) return <>{children}</>;
  // If the switches can't be read, show the page rather than lock the client out over a hiccup.
  if (error) return <>{children}</>;
  if (features === null) return <PortalLoading />;
  if (features[feature]) return <>{children}</>;

  return (
    <PortalPage>
      <Tile>
        <EmptyState
          title="This section isn't switched on for your account"
          body="Your Rothenhall lead controls which sections are available. If you expected to see this one, ask them to turn it on."
        />
        <div className="mb-6 flex justify-center">
          <Button variant="outline" nativeButton={false} render={<Link href={`/client/projects/${match[1]}`}>Back to your dashboard</Link>} />
        </div>
      </Tile>
    </PortalPage>
  );
}

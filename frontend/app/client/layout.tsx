'use client';

import type { ReactNode } from 'react';
import { ClientGate } from '@/components/client/ClientGate';
import { ClientSidebar } from '@/components/client/ClientSidebar';
import { PortalMotion } from '@/components/portal/motion';
import { PageTransition } from '@/components/portal/reveal';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <ClientGate>
      <PortalMotion>
      <div className="theme-graphite flex min-h-screen flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
        <ClientSidebar />
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col bg-canvas outline-none">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      </PortalMotion>
    </ClientGate>
  );
}

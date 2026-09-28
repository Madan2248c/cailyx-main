'use client';

import type { ReactNode } from 'react';
import { ClientGate } from '@/components/client/ClientGate';
import { ClientSidebar } from '@/components/client/ClientSidebar';
import { PortalMotion } from '@/components/portal/motion';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <ClientGate>
      <PortalMotion>
      <div className="theme-graphite flex min-h-screen flex-col md:flex-row">
        <ClientSidebar />
        <main className="flex flex-1 flex-col bg-canvas">{children}</main>
      </div>
      </PortalMotion>
    </ClientGate>
  );
}

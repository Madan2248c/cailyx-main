'use client';

import type { ReactNode } from 'react';
import { ClientGate } from '@/components/client/ClientGate';
import { ClientSidebar } from '@/components/client/ClientSidebar';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <ClientGate>
      <div className="flex min-h-screen flex-col md:flex-row">
        <ClientSidebar />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </ClientGate>
  );
}

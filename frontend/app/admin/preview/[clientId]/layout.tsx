'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminPreviewProvider } from '@/components/admin/preview/preview-context';
import { PreviewBar } from '@/components/admin/preview/preview-bar';

/**
 * The preview replaces the admin console entirely: the client's own portal,
 * under a yellow bar that says whose it is and how to leave.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  const { clientId } = useParams<{ clientId: string }>();
  return (
    <AdminPreviewProvider clientId={clientId}>
      <PreviewBar />
      <div className="flex flex-1 flex-col">{children}</div>
    </AdminPreviewProvider>
  );
}

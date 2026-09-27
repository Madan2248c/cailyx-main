'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function SettingsSettingsPage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="Settings" description="Project basics will live here." />;
}

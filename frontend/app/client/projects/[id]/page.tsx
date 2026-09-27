'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function ProjectDashboardPage() {
  const params = useParams<{ id: string }>();
  return (
    <ProjectTabPage
      projectId={params.id}
      title="Dashboard"
      description="Your scores, open actions, and latest report will live here."
    />
  );
}

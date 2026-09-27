'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function PerformanceOverviewPerformancePage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="Performance overview" description="Your technical, organic, and AI visibility scores will live here." />;
}

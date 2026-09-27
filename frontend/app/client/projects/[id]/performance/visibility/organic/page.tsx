'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function OrganicVisibilityPerformanceVisibilityOrganicPage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="Organic visibility" description="Where you're findable in search will live here." />;
}

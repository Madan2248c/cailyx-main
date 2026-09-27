'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function AIVisibilityPerformanceVisibilityAiPage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="AI visibility" description="How answer engines talk about you will live here." />;
}

'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function TechnicalPerformanceTechnicalPage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="Technical" description="Site health findings will live here." />;
}

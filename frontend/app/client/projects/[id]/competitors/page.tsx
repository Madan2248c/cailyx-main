'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function CompetitorsCompetitorsPage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="Competitors" description="Your tracked rivals and the comparison will live here." />;
}

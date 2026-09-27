'use client';

import { useParams } from 'next/navigation';
import { ProjectTabPage } from '@/components/client/ProjectTabPage';

export default function ReportsReportsPage() {
  const params = useParams<{ id: string }>();
  return <ProjectTabPage projectId={params.id} title="Reports" description="All released reports for this project will live here." />;
}

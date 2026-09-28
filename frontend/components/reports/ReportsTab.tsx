'use client';

import { useEffect, useState } from 'react';
import { ReportDetail } from '@/components/reports/ReportDetail';
import { ReportsList } from '@/components/reports/ReportsList';
import { EmptyPage } from '@/components/portal/blocks';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { listReports } from '@/lib/report-api';
import type { ReportListItem } from '@/types/report';

export function ReportsTab({
  accessToken,
  clientId,
  projectId,
  projectName,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
}) {
  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listReports(accessToken, clientId, projectId)
      .then((reportList) => {
        if (!cancelled) setReports(reportList);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load reports');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (error) return <ErrorState title="We couldn't load your reports" message={error} />;
  if (!reports) return <PortalLoading label="Loading reports" />;

  if (selectedId) {
    return (
      <ReportDetail
        accessToken={accessToken}
        clientId={clientId}
        reportId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  if (reports.length === 0) {
    return (
      <EmptyPage
        eyebrow="Reports"
        title="Your reports"
        projectName={projectName}
        emptyTitle="Your first report is being prepared"
        body="Reports sum up where you stand, what changed and what to do next, in plain language."
        steps={[
          'We run your first checks on your site, AI answers and social channels.',
          'Your Rothenhall lead reviews the findings and releases your starting-point report.',
          'After that, a new report arrives every month so you can see progress.',
        ]}
      />
    );
  }

  return <ReportsList reports={reports} projectName={projectName} onOpen={setSelectedId} />;
}

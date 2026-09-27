'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ReportDetail } from '@/components/reports/ReportDetail';
import { ReportsList } from '@/components/reports/ReportsList';
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

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!reports) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      </div>
    );
  }

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
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No reports yet. Your Day-1 report appears here once the pipeline releases it, and a
              fresh monthly report follows each cycle.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ReportsList reports={reports} projectName={projectName} onOpen={setSelectedId} />
  );
}

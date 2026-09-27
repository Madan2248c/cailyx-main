'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportListItem, ReportStatus } from '@/types/report';

function statusVariant(status: ReportStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'RELEASED':
      return 'default';
    case 'IN_REVIEW':
      return 'outline';
    case 'WITHDRAWN':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function statusLabel(status: ReportStatus): string {
  switch (status) {
    case 'RELEASED':
      return 'Released';
    case 'IN_REVIEW':
      return 'In review';
    case 'WITHDRAWN':
      return 'Withdrawn';
    default:
      return 'Draft';
  }
}

function formatDate(value: string | null): string {
  if (!value) return 'Date unknown';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function excerpt(text: string, length = 180): string {
  if (text.length <= length) return text;
  return `${text.slice(0, length).trimEnd()}…`;
}

export function ReportsList({
  reports,
  projectName,
  onOpen,
}: {
  reports: ReportListItem[];
  projectName: string;
  onOpen: (reportId: string) => void;
}) {
  const ordered = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {projectName} · {ordered.length} {ordered.length === 1 ? 'report' : 'reports'}
        </p>
      </div>

      {ordered.map((report) => (
        <Card key={report.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={report.kind === 'MONTHLY' ? 'default' : 'secondary'}>{report.kind}</Badge>
              <Badge variant={statusVariant(report.status)}>{statusLabel(report.status)}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(report.releasedAt ?? report.createdAt)}
              </span>
            </div>
            <CardTitle className="text-base">{report.title}</CardTitle>
            <CardDescription>{excerpt(report.executiveSummary)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={() => onOpen(report.id)}>
              Open report
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

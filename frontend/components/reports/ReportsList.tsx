'use client';

import { FileText } from 'lucide-react';
import { ArrowRight } from '@/components/animate-ui/icons/arrow-right';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { PageHeader, MetaDot, PortalPage, StatusChip, Tile } from '@/components/portal/layout';
import { formatDate, plural, relativeDate, type Tone } from '@/components/portal/tone';
import type { ReportKind, ReportListItem, ReportStatus } from '@/types/report';
import { ReportAdminRow } from '@/components/admin/preview/report-admin';

export const REPORT_KIND_WORD: Record<ReportKind, string> = {
  DAY1: 'Starting-point report',
  MONTHLY: 'Monthly report',
};

export const REPORT_STATUS: Record<ReportStatus, { word: string; tone: Tone }> = {
  RELEASED: { word: 'Ready to read', tone: 'good' },
  IN_REVIEW: { word: 'Being reviewed', tone: 'watch' },
  DRAFT: { word: 'Draft', tone: 'neutral' },
  WITHDRAWN: { word: 'Withdrawn', tone: 'bad' },
};

function excerpt(text: string, length = 220): string {
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
  const ordered = [...reports].sort((a, b) => (b.releasedAt ?? b.createdAt).localeCompare(a.releasedAt ?? a.createdAt));
  const [latest, ...older] = ordered;

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Reports"
        title="Your reports"
        meta={
          <>
            <span>{projectName}</span>
            <MetaDot />
            <span>{plural(ordered.length, 'report')}</span>
          </>
        }
        summary="Each report sums up what changed, what it means and what to do next. The newest one is at the top."
      />

      {/* The newest report gets the most room: it's the one people come here for. */}
      <div className="flex flex-col gap-2">
        <ReportCard report={latest} featured index={1} onOpen={onOpen} />
        <ReportAdminRow report={latest} />
      </div>

      {older.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="g-eyebrow">Earlier reports</p>
          <div className="grid gap-4 md:grid-cols-2">
            {older.map((report, i) => (
              <div key={report.id} className="flex flex-col gap-2">
                <ReportCard report={report} index={i + 2} onOpen={onOpen} />
                <ReportAdminRow report={report} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </PortalPage>
  );
}

function ReportCard({
  report,
  featured = false,
  index,
  onOpen,
}: {
  report: ReportListItem;
  featured?: boolean;
  index: number;
  onOpen: (reportId: string) => void;
}) {
  const status = REPORT_STATUS[report.status];
  const when = report.releasedAt ?? report.createdAt;
  return (
    <Tile index={index} className="p-0">
      <AnimateIcon animateOnHover asChild>
      <button
        type="button"
        onClick={() => onOpen(report.id)}
        className="g-row-link flex h-full w-full flex-col gap-3 rounded-[inherit] p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3.5" aria-hidden />
          <span className="font-medium text-foreground">{REPORT_KIND_WORD[report.kind]}</span>
          <MetaDot />
          <span title={formatDate(when)}>{relativeDate(when)}</span>
          {report.status !== 'RELEASED' ? <StatusChip tone={status.tone}>{status.word}</StatusChip> : null}
        </div>
        <h2 className={featured ? 'text-xl font-semibold leading-snug' : 'text-base font-semibold leading-snug'}>{report.title}</h2>
        {report.executiveSummary ? (
          <p className={featured ? 'max-w-3xl text-sm leading-relaxed text-muted-foreground' : 'line-clamp-3 text-sm text-muted-foreground'}>
            {excerpt(report.executiveSummary, featured ? 320 : 180)}
          </p>
        ) : null}
        <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium">
          Read the report <ArrowRight className="g-row-arrow size-4" aria-hidden />
        </span>
      </button>
      </AnimateIcon>
    </Tile>
  );
}

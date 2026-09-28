'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/portal/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { downloadReportPdf, getReport } from '@/lib/report-api';
import { Download } from '@/components/animate-ui/icons/download';
import { MagneticAction } from '@/components/portal/magnetic-action';
import type {
  AeoAuditSection,
  CompetitorsSection,
  GapAnalysisSection,
  ReportDelta,
  ReportDetail as ReportDetailData,
  SocialActivitySection,
  TechnicalAuditSection,
} from '@/types/report';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { MetaDot, PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { REPORT_KIND_WORD, REPORT_STATUS } from '@/components/reports/ReportsList';
import { checkResult, humanize, impactWord, platformName } from '@/components/portal/words';
import { CHECK_LABEL, type AuditCheckType } from '@/types/technical';
import { PATTERN_LABEL, type ActivityPattern } from '@/types/social';
import { ScrollProgress, ScrollProgressProvider } from '@/components/animate-ui/primitives/animate/scroll-progress';

function formatDate(value: string | null): string {
  if (!value) return 'Date unknown';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const DELTA_LABEL: Record<string, string> = {
  score: 'Technical score',
  totalPostsInWindow: 'Social posts in window',
  overallMentionRate: 'AI mention rate',
  overallCitationRate: 'AI citation rate',
};

function isRate(metric: string): boolean {
  return metric === 'overallMentionRate' || metric === 'overallCitationRate';
}

function formatDeltaValue(metric: string, value: number | string | null): string {
  if (value === null) return 'n/a';
  if (typeof value === 'string') return value;
  if (isRate(metric)) return `${Math.round(value * 100)}%`;
  return String(Math.round(value * 100) / 100);
}

function deltaDirection(delta: ReportDelta): 'improved' | 'regressed' | 'unchanged' | 'unknown' {
  if (typeof delta.previous !== 'number' || typeof delta.current !== 'number') return 'unknown';
  if (delta.current === delta.previous) return 'unchanged';
  // Every metric the backend diffs (score, post volume, mention/citation
  // rates) is higher-is-better.
  return delta.current > delta.previous ? 'improved' : 'regressed';
}

function deltaChangeText(delta: ReportDelta): string | null {
  if (typeof delta.previous !== 'number' || typeof delta.current !== 'number') return null;
  const change = delta.current - delta.previous;
  if (change === 0) return null;
  const formatted = isRate(delta.metric)
    ? `${change > 0 ? '+' : ''}${Math.round(change * 100)} pts`
    : `${change > 0 ? '+' : ''}${Math.round(change * 100) / 100}`;
  return formatted;
}

function DeltasCard({ deltas }: { deltas: ReportDelta[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What changed</CardTitle>
        <CardDescription>Movement since the previous released report</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {deltas.map((d, i) => {
          const direction = deltaDirection(d);
          const change = deltaChangeText(d);
          return (
            <div
              key={`${d.module}:${d.metric}`}
              className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <p>{DELTA_LABEL[d.metric] ?? d.metric}</p>
              <p className="flex shrink-0 items-baseline gap-1.5">
                <span className="text-muted-foreground">
                  {formatDeltaValue(d.metric, d.previous)} → {formatDeltaValue(d.metric, d.current)}
                </span>
                {change ? (
                  <span
                    className={
                      direction === 'improved'
                        ? 'font-medium text-success'
                        : direction === 'regressed'
                          ? 'font-medium text-danger'
                          : 'text-muted-foreground'
                    }
                  >
                    {direction === 'improved' ? '▲' : direction === 'regressed' ? '▼' : '●'} {change}
                  </span>
                ) : (
                  <span className="text-muted-foreground">● no change</span>
                )}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const GROWTH_SUBJECT: Record<string, string> = {
  score: "Your site's technical health",
  totalPostsInWindow: 'Your posting volume',
  overallMentionRate: 'How often AI answers mention you',
  overallCitationRate: 'How often AI answers cite you',
};

function growthSentence(delta: ReportDelta): string {
  const subject = GROWTH_SUBJECT[delta.metric] ?? (DELTA_LABEL[delta.metric] ?? delta.metric);
  const prev = formatDeltaValue(delta.metric, delta.previous);
  const cur = formatDeltaValue(delta.metric, delta.current);
  const direction = deltaDirection(delta);
  if (direction === 'unknown') return `${subject}: ${prev} → ${cur}.`;
  if (direction === 'unchanged') return `${subject} held steady at ${cur} since last month.`;
  const verdict = direction === 'improved' ? "That's growth." : 'A dip to watch.';
  return `${subject} went from ${prev} last month to ${cur} now. ${verdict}`;
}

function GrowthBand({ deltas }: { deltas: ReportDelta[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How you&apos;ve grown</CardTitle>
        <CardDescription>Last month compared with now, for everything we measure</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {deltas.map((d, i) => {
          const direction = deltaDirection(d);
          const change = deltaChangeText(d);
          return (
            <div
              key={`${d.module}:${d.metric}`}
              className={`flex flex-col gap-1 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p>{DELTA_LABEL[d.metric] ?? d.metric}</p>
                <p className="flex shrink-0 items-baseline gap-1.5">
                  <span className="text-muted-foreground">
                    {formatDeltaValue(d.metric, d.previous)} → {formatDeltaValue(d.metric, d.current)}
                  </span>
                  {change ? (
                    <span
                      className={
                        direction === 'improved'
                          ? 'font-medium text-success'
                          : direction === 'regressed'
                            ? 'font-medium text-danger'
                            : 'text-muted-foreground'
                      }
                    >
                      {direction === 'improved' ? '▲' : direction === 'regressed' ? '▼' : '●'} {change}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">● no change</span>
                  )}
                </p>
              </div>
              <p className="text-muted-foreground">{growthSentence(d)}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ActionsCard({ gapAnalysis }: { gapAnalysis: GapAnalysisSection }) {
  const top = [...gapAnalysis.recommendations].sort((a, b) => a.rank - b.rank).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What needs doing</CardTitle>
        <CardDescription>The three most important actions from this report</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {top.map((rec) => (
          <div key={rec.rank} className="flex items-start gap-3 text-sm">
            <Badge variant="secondary" className="mt-0.5 shrink-0">
              {rec.rank}
            </Badge>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-medium">{rec.title}</p>
              <p className="text-muted-foreground">{rec.description}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TechnicalSection({ section }: { section: TechnicalAuditSection }) {
  const failing = section.findings.filter((f) => f.status === 'fail' || f.status === 'error');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Technical health</CardTitle>
        <CardDescription>
          {section.score !== null ? `Site score ${section.score}/100` : 'No site score this time'}
          {failing.length > 0 ? ` · ${failing.length} failing ${failing.length === 1 ? 'check' : 'checks'}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {section.narrative ? <p className="text-sm text-muted-foreground">{section.narrative}</p> : null}
        {section.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No findings recorded.</p>
        ) : (
          section.findings.map((finding) => (
            <div
              key={finding.type}
              className="flex flex-col gap-1 rounded-lg border border-border p-2.5 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{CHECK_LABEL[finding.type as AuditCheckType] ?? humanize(finding.type)}</p>
                <StatusChip tone={checkResult(finding.status).tone}>{checkResult(finding.status).word}</StatusChip>
                <span className="text-xs text-muted-foreground">{impactWord(finding.severity)}</span>
              </div>
              <p className="text-muted-foreground">{finding.recommendedFix}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SocialSection({ section }: { section: SocialActivitySection }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Social activity</CardTitle>
        <CardDescription>Posting patterns and findings per platform</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {section.platforms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No platform data in this report.</p>
        ) : (
          section.platforms.map((platform) => (
            <div
              key={platform.platform}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-border p-2.5 text-sm"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-medium">{platformName(platform.platform)}</p>
                <p className="text-xs text-muted-foreground">
                  Posts {(PATTERN_LABEL[platform.pattern as ActivityPattern] ?? humanize(platform.pattern)).toLowerCase()}
                </p>
              </div>
              <p className="shrink-0 text-muted-foreground">
                {platform.postsInWindow} {platform.postsInWindow === 1 ? 'post' : 'posts'}
                {platform.followerCount !== null ? ` · ${platform.followerCount.toLocaleString()} followers` : ''}
              </p>
            </div>
          ))
        )}
        {section.findings.map((finding) => (
          <div
            key={`${finding.type}:${finding.platform}`}
            className="flex flex-col gap-1 rounded-lg border border-border p-2.5 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{platformName(finding.platform)}: {humanize(finding.type).toLowerCase()}</p>
              <StatusChip tone={checkResult(finding.status).tone}>{checkResult(finding.status).word}</StatusChip>
              <span className="text-xs text-muted-foreground">{impactWord(finding.severity)}</span>
            </div>
            <p className="text-muted-foreground">{finding.detail}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AeoSection({ section }: { section: AeoAuditSection }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI visibility</CardTitle>
        <CardDescription>
          Mentioned in {Math.round(section.overallMentionRate * 100)}% of answers · cited in{' '}
          {Math.round(section.overallCitationRate * 100)}%
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {(section.narrative ?? []).map((line) => (
          <p key={line.slice(0, 48)} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
        {section.headlines.map((headline) => (
          <p key={headline.slice(0, 48)} className="text-sm">
            {headline}
          </p>
        ))}
        {section.competitorStanding.length > 0 ? (
          <div className="flex flex-col border-t border-border pt-2.5">
            {section.competitorStanding.slice(0, 8).map((row, i) => (
              <div
                key={row.name}
                className={`flex items-center gap-3 py-2 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <p className="min-w-0 flex-1 truncate font-medium">{row.name}</p>
                <p className="shrink-0 text-muted-foreground">
                  Ahead <span className="font-medium text-success">{row.timesAhead}×</span> · behind{' '}
                  <span className="font-medium text-danger">{row.timesBehind}×</span>
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CompetitorsSection({ section }: { section: CompetitorsSection }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Competitors</CardTitle>
        <CardDescription>Homepage SEO score out of 100, and who AI answers prefer</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {[{ ...section.own, reviewRating: null, aeoStanding: null }, ...section.rows].map((row, i) => (
          <div
            key={`${row.name}:${row.domain ?? 'none'}`}
            className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate font-medium">
                {row.name}
                {i === 0 ? <span className="font-normal text-muted-foreground"> · you</span> : null}
              </p>
              {row.reviewRating ? (
                <p className="text-xs text-muted-foreground">
                  {row.reviewRating.source}: {row.reviewRating.rating}
                  {row.reviewRating.count !== null ? ` (${row.reviewRating.count} reviews)` : ''}
                </p>
              ) : null}
              {row.aeoStanding ? (
                <p className="text-xs text-muted-foreground">
                  In AI answers: ahead {row.aeoStanding.timesAhead}×, behind {row.aeoStanding.timesBehind}×
                </p>
              ) : null}
            </div>
            <p className="shrink-0 font-medium">
              {row.seoScore !== null ? `${row.seoScore}/100` : 'Not scored'}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GapSection({ section }: { section: GapAnalysisSection }) {
  const ordered = [...section.recommendations].sort((a, b) => a.rank - b.rank);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recommendations</CardTitle>
        <CardDescription>
          {ordered.length === 0
            ? 'No recommendations in this report.'
            : `${ordered.length} ${ordered.length === 1 ? 'recommendation' : 'recommendations'}, most important first`}
        </CardDescription>
      </CardHeader>
      {ordered.length > 0 ? (
        <CardContent className="flex flex-col gap-2.5">
          {ordered.map((rec) => (
            <div key={rec.rank} className="flex items-start gap-3 text-sm">
              <Badge variant="secondary" className="mt-0.5 shrink-0">
                {rec.rank}
              </Badge>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{rec.title}</p>
                  {rec.status === 'DONE' ? <StatusChip tone="good">Done</StatusChip> : rec.status === 'DISMISSED' ? <StatusChip tone="neutral">Not needed</StatusChip> : null}
                </div>
                <p className="text-muted-foreground">{rec.description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function ReportDetail({
  accessToken,
  clientId,
  reportId,
  onBack,
}: {
  accessToken: string;
  clientId: string;
  reportId: string;
  onBack: () => void;
}) {
  const [report, setReport] = useState<ReportDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function download(slug: string) {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadReportPdf(accessToken, clientId, reportId, `${slug}.pdf`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Could not prepare the report PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    getReport(accessToken, clientId, reportId)
      .then((detail) => {
        if (!cancelled) setReport(detail);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the report');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, reportId]);

  if (error) return <ErrorState title="We couldn't open this report" message={error} />;

  if (!report) {
    return <PortalLoading label="Loading report" />;
  }

  const { content } = report;
  const deltas = content.deltas ?? [];

  return (
    <>
      {/* Reading progress for long reports (Animate UI Scroll Progress). */}
      <ScrollProgressProvider global>
        <ScrollProgress
          mode="scaleX"
          aria-hidden
          className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-foreground/70"
        />
      </ScrollProgressProvider>
    <PortalPage>
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
          ← All reports
        </Button>
        <PageHeader
          eyebrow={REPORT_KIND_WORD[report.kind]}
          title={report.title}
          meta={
            <>
              <span>{content.meta.domain}</span>
              <MetaDot />
              <span>{formatDate(report.releasedAt ?? report.createdAt)}</span>
              {report.status !== 'RELEASED' ? (
                <StatusChip tone={REPORT_STATUS[report.status].tone}>{REPORT_STATUS[report.status].word}</StatusChip>
              ) : null}
            </>
          }
          actions={
            <div className="flex flex-col items-end gap-1.5">
              <MagneticAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void download(report.slug)}
                  disabled={downloading}
                  title="The full report as a PDF, ready to share"
                >
                  <Download className="size-4" aria-hidden />
                  {downloading ? 'Preparing…' : 'Download report'}
                </Button>
              </MagneticAction>
              {downloadError ? (
                <p role="alert" className="text-xs text-destructive">
                  {downloadError}
                </p>
              ) : null}
            </div>
          }
        />
      </div>

      {report.kind === 'MONTHLY' && deltas.length > 0 ? <GrowthBand deltas={deltas} /> : null}
      {deltas.length > 0 ? <DeltasCard deltas={deltas} /> : null}
      {content.gapAnalysis ? <ActionsCard gapAnalysis={content.gapAnalysis} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executive summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {paragraphs(content.executiveSummary).map((paragraph, i) => (
            // Paragraphs come from the backend narrative as plain text.
            <p key={`${i}:${paragraph.slice(0, 32)}`} className="text-sm">
              {paragraph}
            </p>
          ))}
        </CardContent>
      </Card>

      {content.sectionOrder
        .filter((key) => key !== 'deltas')
        .map((key) => {
          if (key === 'technicalAudit' && content.technicalAudit) {
            return <TechnicalSection key={key} section={content.technicalAudit} />;
          }
          if (key === 'socialActivity' && content.socialActivity) {
            return <SocialSection key={key} section={content.socialActivity} />;
          }
          if (key === 'aeoAudit' && content.aeoAudit) {
            return <AeoSection key={key} section={content.aeoAudit} />;
          }
          if (key === 'competitors' && content.competitors) {
            return <CompetitorsSection key={key} section={content.competitors} />;
          }
          if (key === 'gapAnalysis' && content.gapAnalysis) {
            return <GapSection key={key} section={content.gapAnalysis} />;
          }
          return null;
        })}
    </PortalPage>
    </>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, ListChecks, Scale, TriangleAlert } from 'lucide-react';
import { Download } from '@/components/animate-ui/icons/download';
import { MagneticAction } from '@/components/portal/magnetic-action';
import { Tabs, TabsContent, TabsContents, TabsList, TabsTrigger } from '@/components/animate-ui/components/animate/tabs';
import { Highlight, HighlightItem } from '@/components/animate-ui/primitives/effects/highlight';
import { ScoreRing, StackedBar, type Segment } from '@/components/portal/charts';
import { Button } from '@/components/portal/button';
import { DeltaChip, MetaDot, PageHeader, PortalPage, StatusChip, Tile, TileHeader } from '@/components/portal/layout';
import { Marker } from '@/components/portal/marker';
import { CountUp } from '@/components/portal/motion';
import { EmptyState, ErrorState, PortalLoading } from '@/components/portal/states';
import { plural, relativeDate } from '@/components/portal/tone';
import { downloadFixPack, getFixSummary, listFixes } from '@/lib/remediation-api';
import type { FixSpec, FixStatus, FixSummary } from '@/types/remediation';
import { groupLabel } from '@/types/remediation';
import { ApprovalCard } from './ApprovalCard';
import { FixRow } from './FixRow';
import { PLAN_TABS } from './fix-meta';

const GROUP_PREVIEW = 6;

const STATUS_SEGMENT: Array<{ status: FixStatus; label: string; color: string }> = [
  { status: 'VERIFIED', label: 'Verified', color: 'var(--success)' },
  { status: 'APPLIED', label: 'Applied, checking', color: 'color-mix(in oklab, var(--success) 45%, white)' },
  { status: 'IN_PROGRESS', label: 'In progress', color: 'var(--g-ink-muted)' },
  { status: 'OPEN', label: 'To do', color: 'var(--g-line-strong)' },
  { status: 'AWAITING_DECISION', label: 'Needs your decision', color: 'var(--warning)' },
  { status: 'REGRESSED', label: 'Came back', color: 'var(--danger)' },
];

export function FixPlanTab({
  accessToken,
  clientId,
  projectId,
  projectName,
  projectDomain,
  canDecide,
  focusGroup,
  readOnly = false,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
  projectDomain: string;
  /** Account owner (POC) or staff. */
  canDecide: boolean;
  /** Open the plan on this group (e.g. from a failing Technical check). */
  focusGroup?: string | null;
  /** Admin preview: no actions, rows don't navigate. */
  readOnly?: boolean;
}) {
  const [fixes, setFixes] = useState<FixSpec[] | null>(null);
  const [summary, setSummary] = useState<FixSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFixes(accessToken, clientId, projectId), getFixSummary(accessToken, clientId, projectId)])
      .then(([f, s]) => {
        if (cancelled) return;
        setFixes(f);
        setSummary(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the Fix Plan');
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  const byTab = useMemo(() => {
    const map: Record<string, FixSpec[]> = {};
    for (const tab of PLAN_TABS) map[tab.key] = (fixes ?? []).filter((f) => tab.statuses.includes(f.status));
    return map;
  }, [fixes]);

  if (error) return <ErrorState message={error} />;
  if (!fixes || !summary) return <PortalLoading label="Loading your Fix Plan" />;

  const base = `/client/projects/${projectId}/plan`;
  const decisions = fixes.filter((f) => f.status === 'AWAITING_DECISION');
  const active = fixes.filter((f) => f.status !== 'DISMISSED');
  const verified = active.filter((f) => f.status === 'VERIFIED').length;
  const lastChecked = fixes.map((f) => f.lastVerifiedAt ?? f.lastReportedAt).sort().at(-1);
  const focusTab = focusGroup ? PLAN_TABS.find((t) => byTab[t.key].some((f) => f.groupKey === focusGroup))?.key : undefined;
  const defaultTab = focusTab ?? PLAN_TABS.find((t) => byTab[t.key].length > 0)?.key ?? 'todo';

  function replace(updated: FixSpec) {
    setFixes((prev) => (prev ? prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)) : prev));
    getFixSummary(accessToken, clientId, projectId).then(setSummary).catch(() => {});
  }

  async function download() {
    setDownloading(true);
    try {
      await downloadFixPack(accessToken, clientId, projectId, `fix-plan-${projectDomain}.md`);
    } finally {
      setDownloading(false);
    }
  }

  if (fixes.length === 0) {
    return (
      <PortalPage>
        <PageHeader eyebrow="Workspace" title="Fix Plan" meta={<span>{projectName}</span>} />
        <Tile index={1}>
          <EmptyState
            title="Your Fix Plan is on its way"
            body="It appears after your first audit: every problem we find becomes a clear fix, with a ready-made file where we can build one, and we check your site to confirm each fix worked."
          />
        </Tile>
      </PortalPage>
    );
  }

  const segments: Segment[] = STATUS_SEGMENT.map((s) => ({ key: s.status, label: s.label, value: summary.byStatus[s.status] ?? 0, color: s.color })).filter(
    (s) => s.value > 0,
  );

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Workspace"
        title="Fix Plan"
        meta={
          <>
            <span>{projectDomain}</span>
            <MetaDot />
            <span>{plural(active.length, 'fix', 'fixes')}</span>
            {lastChecked ? (
              <>
                <MetaDot />
                <span>Updated {relativeDate(lastChecked)}</span>
              </>
            ) : null}
          </>
        }
        summary={
          <>
            <Marker text={`${verified} of ${active.length}`} /> fixes are verified on your live site.
            {decisions.length > 0 ? ` ${plural(decisions.length, 'needs', 'need')} your decision.` : ' Nothing is waiting on you.'}
          </>
        }
        actions={
          <MagneticAction>
            <Button variant="outline" size="sm" onClick={download} disabled={downloading}>
              <Download className="size-4" aria-hidden />
              {downloading ? 'Preparing…' : 'Download for your developer'}
            </Button>
          </MagneticAction>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Tile ink shine index={0} className="md:col-span-2 gap-5 p-6">
          <TileHeader
            icon={CircleCheck}
            eyebrow="Progress"
            hint="A fix counts as verified only when we re-check your live site (or the next audit) and the problem is gone. Marking something as applied is not enough on its own."
          />
          <div className="flex flex-wrap items-center gap-6">
            <ScoreRing
              value={active.length ? Math.round((verified / active.length) * 100) : 0}
              tone="neutral"
              onInk
              size={132}
              stroke={11}
              label={`${verified} of ${active.length} fixes verified`}
            >
              <span className="text-3xl font-semibold text-white">
                <CountUp value={verified} />
                <span className="text-lg text-white/60">/{active.length}</span>
              </span>
              <span className="text-xs text-white/60">verified</span>
            </ScoreRing>
            <div className="flex flex-col gap-2">
              {summary.verifiedSinceBaseline > 0 ? (
                <DeltaChip change={summary.verifiedSinceBaseline} suffix="verified since you started" onInk />
              ) : (
                <span className="text-sm text-white/65">Verified fixes will count up here.</span>
              )}
              {summary.regressed > 0 ? (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/85">
                  <TriangleAlert className="size-3.5 text-[#f2a19a]" aria-hidden /> {plural(summary.regressed, 'fix', 'fixes')} came back
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-auto rounded-xl bg-white/[0.06] p-3 [&_.text-muted-foreground]:text-white/60">
            <StackedBar segments={segments} height={10} label="Fixes by status" />
          </div>
        </Tile>

        <Tile index={1} className="md:col-span-2">
          <TileHeader
            icon={Scale}
            eyebrow="Needs your decision"
            hint="Some fixes change what search engines index or which AI crawlers may read your site. Those are your call, so we wait for you."
            right={decisions.length > 0 ? <StatusChip tone="watch">{decisions.length} waiting</StatusChip> : null}
          />
          {decisions.length === 0 ? (
            <div className="flex flex-1 flex-col items-start justify-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-6 text-success" aria-hidden />
              Nothing needs your decision right now.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {decisions.slice(0, 3).map((fix) =>
                readOnly ? (
                  <div key={fix.id} className="rounded-xl border border-border p-4 text-sm">
                    <p className="font-semibold">{fix.title}</p>
                    <p className="text-muted-foreground">{fix.steps[0]}</p>
                  </div>
                ) : (
                  <ApprovalCard
                    key={fix.id}
                    fix={fix}
                    accessToken={accessToken}
                    clientId={clientId}
                    canDecide={canDecide}
                    detailHref={`${base}/${fix.id}`}
                    onDecided={replace}
                  />
                ),
              )}
              {decisions.length > 3 ? <p className="text-xs text-muted-foreground">+{decisions.length - 3} more in the list below.</p> : null}
            </div>
          )}
        </Tile>

        <Tile index={2} className="md:col-span-4 p-0">
          <div className="px-5 pt-5">
            <TileHeader icon={ListChecks} eyebrow="All fixes" />
          </div>
          <Tabs defaultValue={defaultTab} className="gap-0">
            <div className="px-5 pb-3">
              <TabsList className="w-full sm:w-fit">
                {PLAN_TABS.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className="px-3">
                    {tab.label}
                    <span className="g-num text-xs text-muted-foreground">{byTab[tab.key].length}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContents>
              {PLAN_TABS.map((tab) => (
                <TabsContent key={tab.key} value={tab.key}>
                  <FixGroups
                    fixes={byTab[tab.key]}
                    base={base}
                    readOnly={readOnly}
                    focusGroup={focusGroup ?? undefined}
                    empty={
                      tab.key === 'verified'
                        ? 'Verified fixes appear here once we confirm them on your live site.'
                        : tab.key === 'dismissed'
                          ? 'Nothing has been set aside.'
                          : 'Nothing here right now.'
                    }
                  />
                </TabsContent>
              ))}
            </TabsContents>
          </Tabs>
        </Tile>
      </div>
    </PortalPage>
  );
}

function FixGroups({
  fixes,
  base,
  readOnly,
  focusGroup,
  empty,
}: {
  fixes: FixSpec[];
  base: string;
  readOnly: boolean;
  focusGroup?: string;
  empty: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (fixes.length === 0) return <p className="px-5 pb-5 text-sm text-muted-foreground">{empty}</p>;

  const groups = new Map<string, FixSpec[]>();
  for (const f of fixes) groups.set(f.groupKey, [...(groups.get(f.groupKey) ?? []), f]);
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === focusGroup ? -1 : b === focusGroup ? 1 : 0));

  return (
    <div className="flex flex-col pb-2">
      {ordered.map(([key, items]) => {
        const open = expanded.has(key);
        const shown = open ? items : items.slice(0, GROUP_PREVIEW);
        return (
          <section key={key} className={`border-t border-border ${key === focusGroup ? 'bg-muted/40' : ''}`} aria-label={groupLabel(key)}>
            <div className="flex items-center justify-between px-5 pt-3 pb-1">
              <p className="g-eyebrow">{groupLabel(key)}</p>
              <span className="g-num text-xs text-muted-foreground">{items.length}</span>
            </div>
            {readOnly ? (
              <ul>
                {shown.map((fix) => (
                  <li key={fix.id} className="px-5 py-2 text-sm">
                    {fix.title}
                  </li>
                ))}
              </ul>
            ) : (
              <Highlight
                controlledItems
                hover
                click={false}
                mode="children"
                className="inset-x-2 inset-y-0 rounded-xl bg-muted"
                transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              >
                <ul>
                  {shown.map((fix) => (
                    <HighlightItem key={fix.id} as="li" value={fix.id}>
                      <FixRow fix={fix} href={`${base}/${fix.id}`} />
                    </HighlightItem>
                  ))}
                </ul>
              </Highlight>
            )}
            {items.length > GROUP_PREVIEW ? (
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                className="mx-5 mb-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
              >
                {open ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

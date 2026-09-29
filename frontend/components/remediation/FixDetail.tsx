'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, CircleCheck, CircleX, ClipboardList, Download, FileCode, Clock, Lightbulb, Target, Wrench } from 'lucide-react';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { ShimmeringText } from '@/components/animate-ui/primitives/texts/shimmering';
import { Button } from '@/components/portal/button';
import { MetaDot, PageHeader, PortalPage, StatusChip, Tile, TileHeader } from '@/components/portal/layout';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { formatDate, relativeDate } from '@/components/portal/tone';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getFix, markFixApplied, verifyFix } from '@/lib/remediation-api';
import type { FixEvent, FixSpec } from '@/types/remediation';
import { describeAcceptance, groupLabel, STATUS_WORD } from '@/types/remediation';
import { ApprovalCard } from './ApprovalCard';
import { BadgeCheck } from '@/components/animate-ui/icons/badge-check';
import { MagneticAction } from '@/components/portal/magnetic-action';
import {
  canCheckNow,
  canMarkApplied,
  EFFORT_WORD,
  evidenceFacts,
  evidencePages,
  ownerLabel,
  SEVERITY_WORD,
  STATUS_TONE,
  targetLabel,
} from './fix-meta';

export function FixDetail({
  accessToken,
  clientId,
  projectId,
  fixId,
  canDecide,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  fixId: string;
  canDecide: boolean;
}) {
  const [fix, setFix] = useState<FixSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFix(accessToken, clientId, fixId)
      .then((f) => {
        if (!cancelled) setFix(f);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this fix');
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, fixId]);

  if (error) return <ErrorState message={error} />;
  if (!fix) return <PortalLoading label="Loading fix" />;

  const planHref = `/client/projects/${projectId}/plan`;
  const facts = evidenceFacts(fix.evidence);
  const pages = evidencePages(fix.evidence);

  return (
    <PortalPage>
      <Link href={planHref} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Fix Plan
      </Link>
      <PageHeader
        eyebrow={groupLabel(fix.groupKey)}
        title={fix.title}
        meta={
          <>
            <StatusChip tone={STATUS_TONE[fix.status]}>{STATUS_WORD[fix.status]}</StatusChip>
            <span>{targetLabel(fix.target)}</span>
            <MetaDot />
            <span>{SEVERITY_WORD[fix.severity]}</span>
            <MetaDot />
            <span>{EFFORT_WORD[fix.effort]}</span>
            <MetaDot />
            <span>Who: {ownerLabel(fix.fixClass)}</span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {fix.status === 'AWAITING_DECISION' ? (
          <Tile index={0} className="md:col-span-4">
            <TileHeader icon={Lightbulb} eyebrow="Your decision" />
            <ApprovalCard fix={fix} accessToken={accessToken} clientId={clientId} canDecide={canDecide} onDecided={setFix} />
          </Tile>
        ) : null}

        {canMarkApplied(fix) && fix.status !== 'AWAITING_DECISION' ? (
          <Tile index={0} className="md:col-span-4 gap-3">
            <TileHeader icon={ClipboardList} eyebrow="What to do" />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-2xl text-sm">
                Follow the <span className="font-semibold">steps</span> below (or hand this page to your developer). When the change is live, press{' '}
                <span className="font-semibold">&ldquo;We&rsquo;ve applied this&rdquo;</span> and we will re-check your site and mark it Verified.
              </p>
              <a
                href="#mark-applied"
                className="inline-flex min-h-9 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background outline-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                I&rsquo;ve done this
              </a>
            </div>
          </Tile>
        ) : null}

        <Tile index={1} className="md:col-span-2">
          <TileHeader icon={Lightbulb} eyebrow="Why this matters" />
          {fix.steps[0] ? <p className="text-sm">{fix.steps[0]}</p> : null}
          {facts.length > 0 ? (
            <dl className="mt-3 flex flex-col divide-y divide-border rounded-xl border border-border text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                  <dt className="shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 text-right break-words">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {pages.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Affected pages ({pages.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {pages.map((p) => (
                  <li key={p} className="truncate">
                    <a href={p} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      {targetLabel(p)}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Tile>

        <DoneWhen fix={fix} accessToken={accessToken} clientId={clientId} onChecked={setFix} />

        {fix.artifact ? (
          <Tile index={3} className="md:col-span-4">
            <TileHeader
              icon={FileCode}
              eyebrow="Ready-made fix"
              title={fix.artifact.path ?? undefined}
              hint="Built from your audit and confirmed company details. Nothing is guessed: if something we needed was missing, we say so below instead."
              right={
                <div className="flex items-center gap-2">
                  <CopyButton content={fix.artifact.content} variant="outline" size="sm" aria-label="Copy the fix" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadText(fix.artifact!.content, fix.artifact!.path?.split('/').pop() || `fix-${fix.id}.txt`)}
                  >
                    <Download className="size-4" aria-hidden /> Download
                  </Button>
                </div>
              }
            />
            {fix.artifact.placement ? <p className="mb-2 text-sm text-muted-foreground">Where it goes: {fix.artifact.placement}</p> : null}
            <pre className="max-h-96 overflow-auto rounded-xl bg-[#26282b] p-4 text-xs leading-relaxed text-[#e9e9ea]">
              <code>{fix.artifact.content}</code>
            </pre>
            {fix.artifactError ? <p className="mt-2 text-sm text-muted-foreground">Note: {fix.artifactError}</p> : null}
          </Tile>
        ) : fix.artifactError ? (
          <Tile index={3} className="md:col-span-4">
            <TileHeader icon={FileCode} eyebrow="Ready-made fix" />
            <p className="text-sm text-muted-foreground">{fix.artifactError}</p>
          </Tile>
        ) : null}

        {fix.llmDraft ? (
          <Tile index={4} className="md:col-span-4">
            <TileHeader icon={Wrench} eyebrow="Suggested copy" hint="A draft your Rothenhall lead reviewed and shared. Edit it to your voice before publishing." />
            <DraftView draft={fix.llmDraft} />
          </Tile>
        ) : null}

        <Tile index={5} className="md:col-span-2">
          <TileHeader icon={ClipboardList} eyebrow="Steps" />
          <ol className="flex flex-col gap-2.5">
            {fix.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="g-num flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </Tile>

        <Tile index={6} className="md:col-span-2">
          <TileHeader icon={Clock} eyebrow="History" />
          <ol className="flex flex-col gap-3 border-l border-border pl-4">
            {(fix.events ?? [])
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-foreground/60" aria-hidden />
                  <p>{describeEvent(e)}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.actor} · {formatDate(e.createdAt)}
                  </p>
                </li>
              ))}
          </ol>
        </Tile>

        {canMarkApplied(fix) ? (
          <div id="mark-applied" className="scroll-mt-6 md:col-span-4">
            <AppliedForm fix={fix} accessToken={accessToken} clientId={clientId} onDone={setFix} />
          </div>
        ) : null}
      </div>
    </PortalPage>
  );
}

function DoneWhen({
  fix,
  accessToken,
  clientId,
  onChecked,
}: {
  fix: FixSpec;
  accessToken: string;
  clientId: string;
  onChecked: (f: FixSpec) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = fix.lastVerifyResult;

  async function check() {
    setChecking(true);
    setError(null);
    try {
      onChecked(await verifyFix(accessToken, clientId, fix.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check right now.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <Tile index={2} className="md:col-span-2">
      <TileHeader icon={Target} eyebrow="Done when" />
      <p className="text-base font-medium">{describeAcceptance(fix.acceptance)}</p>
      {fix.status === 'VERIFIED' ? (
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-success">
          <CircleCheck className="size-4" aria-hidden /> Verified {fix.lastVerifiedAt ? relativeDate(fix.lastVerifiedAt) : ''}
        </p>
      ) : last ? (
        <div className="mt-3 flex items-start gap-2 text-sm">
          {last.passed ? <CircleCheck className="mt-0.5 size-4 text-success" aria-hidden /> : <CircleX className="mt-0.5 size-4 text-danger" aria-hidden />}
          <span>
            <span className="font-medium">{last.passed ? 'Last check passed' : 'Not yet'}</span>
            <span className="text-muted-foreground">
              {' '}
              · {last.observed} · {relativeDate(last.checkedAt)}
            </span>
          </span>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
        {canCheckNow(fix) ? (
          <Button size="sm" variant="outline" onClick={check} disabled={checking}>
            Check my site now
          </Button>
        ) : fix.acceptance.kind === 'finding-absent' && fix.status !== 'VERIFIED' ? (
          <p className="text-xs text-muted-foreground">We confirm this one on the next audit, automatically.</p>
        ) : null}
        {checking ? <ShimmeringText text="Checking your live site…" className="text-sm" color="var(--g-ink-muted)" shimmeringColor="var(--g-ink)" /> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Tile>
  );
}

function AppliedForm({ fix, accessToken, clientId, onDone }: { fix: FixSpec; accessToken: string; clientId: string; onDone: (f: FixSpec) => void }) {
  const [note, setNote] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onDone(await markFixApplied(accessToken, clientId, fix.id, { note, prUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Tile index={7} className="md:col-span-4">
      <TileHeader
        icon={CircleCheck}
        eyebrow="Done on your side?"
        hint="Tell us when your developer has shipped this. We check your live site straight away where we can, otherwise on the next audit."
      />
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">Note (optional)</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="e.g. deployed Tuesday" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">Link to the change (optional)</span>
          <Input value={prUrl} onChange={(e) => setPrUrl(e.target.value)} placeholder="https://github.com/…/pull/42" type="url" />
        </label>
        <MagneticAction>
          <Button type="submit" disabled={saving}>
            <BadgeCheck className="size-4" aria-hidden />
            {saving ? 'Saving…' : "We've applied this"}
          </Button>
        </MagneticAction>
      </form>
      {saving ? (
        <div className="mt-3">
          <ShimmeringText text="Saving and checking your site…" className="text-sm" color="var(--g-ink-muted)" shimmeringColor="var(--g-ink)" />
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    </Tile>
  );
}

function DraftView({ draft }: { draft: NonNullable<FixSpec['llmDraft']> }) {
  const c = draft.content as Record<string, unknown>;
  if (typeof c.title === 'string') return <DraftLine label="Title" value={c.title} />;
  if (typeof c.metaDescription === 'string') return <DraftLine label="Meta description" value={c.metaDescription} />;
  const outline = Array.isArray(c.outline) ? (c.outline as string[]) : [];
  const faq = Array.isArray(c.faq) ? (c.faq as Array<{ question: string; answer: string }>) : [];
  return (
    <div className="flex flex-col gap-3 text-sm">
      {typeof c.pageTitle === 'string' ? <DraftLine label="Page title" value={c.pageTitle} /> : null}
      {typeof c.answerParagraph === 'string' ? <DraftLine label="Opening answer" value={c.answerParagraph} /> : null}
      {outline.length ? (
        <div>
          <p className="g-eyebrow mb-1">Sections</p>
          <ul className="list-disc pl-5">
            {outline.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {faq.length ? (
        <div className="flex flex-col gap-2">
          <p className="g-eyebrow">FAQ</p>
          {faq.map((f) => (
            <div key={f.question}>
              <p className="font-medium">{f.question}</p>
              <p className="text-muted-foreground">{f.answer}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DraftLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="g-eyebrow">{label}</p>
        <CopyButton content={value} variant="ghost" size="xs" aria-label={`Copy ${label.toLowerCase()}`} />
      </div>
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">{value}</p>
    </div>
  );
}

export function describeEvent(e: FixEvent): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case 'sync':
      return d.created ? 'Found by an audit' : e.toStatus === 'REGRESSED' ? 'Came back in a newer audit' : 'Updated from a newer audit';
    case 'decision':
      return d.decision === 'APPROVED' ? 'Approved' : 'Declined';
    case 'verify':
      return d.passed ? `Check passed: ${String(d.observed ?? '')}` : `Checked, not fixed yet: ${String(d.observed ?? '')}`;
    case 'draft':
      return d.shared === true ? 'Shared a suggested draft' : d.shared === false ? 'Withdrew the suggested draft' : 'Drafted suggested copy';
    case 'status':
      if (e.toStatus === 'APPLIED') return `Marked as applied${d.prUrl ? ' (with a link to the change)' : ''}${d.note ? `: ${String(d.note)}` : ''}`;
      if (e.toStatus === 'IN_PROGRESS') return 'Started work';
      if (e.toStatus === 'DISMISSED') return `Set aside${d.reason ? `: ${String(d.reason)}` : ''}`;
      if (e.toStatus === 'OPEN') return 'Reopened';
      return `Moved to ${e.toStatus ? STATUS_WORD[e.toStatus].toLowerCase() : 'a new status'}`;
  }
}

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

'use client';

import { useCallback, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from 'cn';
import { ConfirmDialog, Notice } from '@/components/admin/admin-ui';
import { AdminAction, AdminPanel } from '@/components/admin/preview/admin-panel';
import { ManualFixDialog } from '@/components/admin/preview/fix-admin';
import { useAdminControls } from '@/components/admin/preview/preview-context';
import { useLoad } from '@/components/admin/use-load';
import { Button as PortalButton } from '@/components/portal/button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { collectDataforseoNow, retryDay1Pipeline } from '@/lib/admin-api';
import {
  activateQuerySet,
  addPrompt,
  AI_SURFACES,
  discoverCompetitors,
  forkQuerySet,
  generateReport,
  getQuerySet,
  listQuerySets,
  removePrompt,
  runAeoAudit,
  runGapAnalysis,
  runSocialActivity,
  runTechnicalAudit,
  syncFixPlanNow,
} from '@/lib/admin-actions-api';
import { FEATURES } from '@/lib/features-api';
import type { Project } from '@/types/project';

const SPEND = 'This costs real money and starts as soon as you confirm.';

function syncMessage(out: { created: number; updated: number; verified: number; regressed: number }): string {
  const parts = [out.created && `${out.created} new`, out.updated && `${out.updated} updated`, out.verified && `${out.verified} verified`, out.regressed && `${out.regressed} came back`].filter(Boolean);
  return parts.length ? `Fix Plan rebuilt: ${parts.join(', ')}.` : 'Fix Plan is already up to date.';
}

/** A row in a panel that isn't a one-click action (a dialog trigger, an editor). */
function PanelRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-[#e8c84a]/40 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {description ? <p className="text-xs leading-relaxed text-[#3a2f00]/75">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export function DashboardPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="Dashboard" description="Kick off the first audit again, or rebuild what the client is told to fix.">
      <AdminAction
        label="Run the Day-1 audit again"
        description="Re-runs the stages that did not finish. An audit that is running or already complete is refused."
        buttonLabel="Re-run Day-1"
        pendingLabel="Queuing…"
        confirm={{ title: `Re-run the Day-1 audit for ${project.name}?`, body: `${SPEND} Stages that already finished are not run again.`, confirmLabel: 'Run Day-1 audit' }}
        run={async () => {
          await retryDay1Pipeline(accessToken, clientId, project.id);
          return 'Day-1 audit queued. Its status updates as stages finish.';
        }}
      />
      <AdminAction
        label="Rebuild the Fix Plan"
        description="Reads the latest audits and adds, updates or verifies fixes. Fixes you added by hand are left alone."
        buttonLabel="Rebuild"
        pendingLabel="Rebuilding…"
        run={async () => syncMessage(await syncFixPlanNow(accessToken, clientId, project.id))}
      />
    </AdminPanel>
  );
}

// ─── Fix Plan ─────────────────────────────────────────────────────────────

export function FixPlanPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="Fix Plan" description="Add your own fixes, or rebuild the plan from the latest audits. Open any fix to change its status or remove it.">
      <PanelRow label="Add a fix by hand" description="Appears in the client's plan at once. Audits never change or close it.">
        <ManualFixDialog projectId={project.id} projectDomain={project.domain} />
      </PanelRow>
      <AdminAction
        label="Rebuild from the latest audits"
        description="Adds new problems, updates changed ones and verifies fixed ones."
        buttonLabel="Rebuild"
        pendingLabel="Rebuilding…"
        run={async () => syncMessage(await syncFixPlanNow(accessToken, clientId, project.id))}
      />
    </AdminPanel>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────

export function ReportsPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="Reports" description="Write a new report from the latest data, then edit and publish it below.">
      <AdminAction
        label="Generate a monthly report"
        description="Built as a draft from the latest audits and compared with the last published report. The client cannot see it until you publish."
        buttonLabel="Generate monthly"
        pendingLabel="Writing…"
        confirm={{ title: 'Generate a monthly report?', body: 'It reads the latest audits and asks the AI to write the summary. It stays a draft until you publish it.', confirmLabel: 'Generate' }}
        run={async () => {
          await generateReport(accessToken, clientId, project.id, 'MONTHLY');
          return 'Monthly draft created. Publish it from the list below when it reads right.';
        }}
      />
      <AdminAction
        label="Generate a new Day-1 report"
        description="A fresh starting-point report. Unlike a monthly one, it goes live to the client immediately."
        buttonLabel="Generate Day-1"
        pendingLabel="Writing…"
        confirm={{ title: 'Generate a Day-1 report?', body: 'It goes live for the client the moment it is made. You can withdraw or edit it afterwards.', confirmLabel: 'Generate and publish' }}
        run={async () => {
          await generateReport(accessToken, clientId, project.id, 'DAY1');
          return 'Day-1 report generated and live for the client.';
        }}
      />
    </AdminPanel>
  );
}

// ─── Technical / Social ───────────────────────────────────────────────────

export function TechnicalPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="Technical health" description="Run the site checks now instead of waiting for the schedule.">
      <AdminAction
        label="Run a technical audit now"
        description="Crawls the site and re-checks speed, links and markup. Results appear here when the run finishes."
        buttonLabel="Run audit"
        pendingLabel="Queuing…"
        run={async () => {
          await runTechnicalAudit(accessToken, clientId, project.id);
          return 'Audit queued. Refresh in a minute or two to see the new results.';
        }}
      />
    </AdminPanel>
  );
}

export function SocialPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="Social channels" description="Pull the latest posting activity now.">
      <AdminAction
        label="Pull social activity now"
        description="Reads recent posts on the client's social profiles."
        buttonLabel="Pull now"
        pendingLabel="Queuing…"
        confirm={{ title: 'Pull social activity now?', body: `${SPEND} The scrapers bill per run.`, confirmLabel: 'Pull now' }}
        run={async () => {
          await runSocialActivity(accessToken, clientId, project.id);
          return 'Social pull queued. Results appear when it finishes.';
        }}
      />
    </AdminPanel>
  );
}

// ─── AI visibility ────────────────────────────────────────────────────────

export function AiPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="AI visibility" description="Choose the questions the AI engines are asked, and run the audit.">
      <PanelRow label="Run an AI visibility audit" description="Asks each AI engine every prompt in the active set and scores the answers.">
        <AuditRunner project={project} />
      </PanelRow>
      <PromptEditor project={project} />
      <AdminAction
        label="Run gap analysis"
        description="Pulls the latest audits into a ranked list of recommendations."
        buttonLabel="Run gap analysis"
        pendingLabel="Analysing…"
        confirm={{ title: 'Run gap analysis?', body: 'It uses one AI call over the latest audit results.', confirmLabel: 'Run' }}
        run={async () => {
          await runGapAnalysis(accessToken, clientId, project.id);
          return 'Gap analysis finished.';
        }}
      />
    </AdminPanel>
  );
}

function AuditRunner({ project }: { project: Project }) {
  const admin = useAdminControls();
  const [open, setOpen] = useState(false);
  const [surfaces, setSurfaces] = useState<string[]>(['cloro_chatgpt', 'cloro_perplexity', 'cloro_gemini']);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => listQuerySets(admin?.accessToken ?? '', admin?.clientId ?? '', project.id), [admin?.accessToken, admin?.clientId, project.id]);
  const sets = useLoad(admin && open ? load : null, 'Could not load the prompt sets');
  if (!admin) return null;
  const active = sets.data?.find((s) => s.status === 'active') ?? null;

  async function run() {
    if (!active || surfaces.length === 0) return;
    setPending(true);
    setError(null);
    try {
      await runAeoAudit(admin!.accessToken, admin!.clientId, project.id, active.id, surfaces);
      admin!.notify('ok', 'AI audit finished. The new numbers are on this page.');
      admin!.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PortalButton size="sm" variant="outline" className="border-[#3a2f00]/30 bg-white/70" onClick={() => setOpen(true)}>
        Run audit…
      </PortalButton>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="theme-graphite sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Run an AI visibility audit</DialogTitle>
            <DialogDescription>{SPEND} Each engine answers every prompt in the active set several times.</DialogDescription>
          </DialogHeader>
          {sets.loading ? <p className="text-sm text-muted-foreground">Loading prompt sets…</p> : null}
          {sets.error ? <Notice tone="error">{sets.error}</Notice> : null}
          {sets.data && !active ? <Notice tone="error">There is no active prompt set yet. Activate one in “Prompts the audit asks” first.</Notice> : null}
          {active ? (
            <p className="text-sm">
              Using <span className="font-semibold">{active.label ?? `version ${active.version}`}</span>.
            </p>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Ask these engines</legend>
            {AI_SURFACES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={surfaces.includes(s.key)}
                  onChange={(e) => setSurfaces((prev) => (e.target.checked ? [...prev, s.key] : prev.filter((k) => k !== s.key)))}
                />
                {s.label}
              </label>
            ))}
          </fieldset>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="button" disabled={pending || !active || surfaces.length === 0} aria-busy={pending} onClick={() => void run()}>
              {pending ? 'Running…' : 'Run audit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The questions the AI engines are asked. A live prompt set is frozen so
 * before-and-after comparisons stay honest: to change it you make an editable
 * copy, change that, then activate it. This walks through exactly that.
 */
function PromptEditor({ project }: { project: Project }) {
  const admin = useAdminControls();
  const [draftPrompt, setDraftPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmActivate, setConfirmActivate] = useState(false);

  const token = admin?.accessToken ?? '';
  const clientId = admin?.clientId ?? '';
  const loadSets = useCallback(() => listQuerySets(token, clientId, project.id), [token, clientId, project.id]);
  const sets = useLoad(admin ? loadSets : null, 'Could not load the prompt sets');
  const editable = [...(sets.data ?? [])].filter((s) => s.status === 'draft').sort((a, b) => b.version - a.version)[0] ?? null;
  const live = (sets.data ?? []).find((s) => s.status === 'active') ?? null;
  const current = editable ?? live;

  const currentId = current?.id ?? null;
  const loadItems = useCallback(() => getQuerySet(token, clientId, currentId ?? ''), [token, clientId, currentId]);
  const items = useLoad(admin && currentId ? loadItems : null, 'Could not load the prompts');
  if (!admin) return null;

  async function act(key: string, work: () => Promise<unknown>, done?: string) {
    setPending(key);
    setError(null);
    try {
      await work();
      await Promise.all([sets.reload(), currentId ? items.reload() : Promise.resolve()]);
      if (done) admin!.notify('ok', done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[#e8c84a]/40 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Prompts the audit asks</p>
          <p className="text-xs text-[#3a2f00]/75">
            {sets.loading && !sets.data
              ? 'Loading…'
              : current
                ? editable
                  ? `Editing a draft copy (version ${editable.version}). The client still sees the live set until you activate it.`
                  : `Live set, version ${current.version}. It is locked so results stay comparable over time.`
                : 'No prompt set yet. Discovery creates the first one.'}
          </p>
        </div>
        {current && !editable ? (
          <PortalButton size="sm" variant="outline" className="border-[#3a2f00]/30 bg-white/70" disabled={pending !== null} onClick={() => void act('fork', () => forkQuerySet(token, clientId, current.id), 'Editable copy made.')}>
            {pending === 'fork' ? 'Copying…' : 'Make an editable copy'}
          </PortalButton>
        ) : null}
        {editable ? (
          <PortalButton size="sm" className="bg-[#3a2f00] text-[#fdd34d] hover:bg-[#3a2f00]" disabled={pending !== null} onClick={() => setConfirmActivate(true)}>
            Activate this version
          </PortalButton>
        ) : null}
      </div>

      {sets.error || items.error ? <Notice tone="error">{sets.error ?? items.error}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {current ? (
        <>
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg bg-white/60 p-2 text-sm">
            {(items.data?.items ?? []).map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-white">
                <span className="min-w-0 flex-1">{item.prompt}</span>
                {editable ? (
                  <button
                    type="button"
                    aria-label={`Remove prompt “${item.prompt}”`}
                    disabled={pending !== null}
                    onClick={() => void act(`rm-${item.id}`, () => removePrompt(token, clientId, editable.id, item.id))}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-[#3a2f00]/60 outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-[#3a2f00]/40"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
            {items.data && (items.data.items ?? []).length === 0 ? <li className="px-1.5 py-1 text-[#3a2f00]/70">No prompts in this set yet.</li> : null}
          </ul>
          {editable ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draftPrompt.trim();
                if (!text) return;
                void act('add', () => addPrompt(token, clientId, editable.id, text), 'Prompt added.').then(() => setDraftPrompt(''));
              }}
            >
              <Input aria-label="New prompt" value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} placeholder="What is the best … for …?" className="bg-white" />
              <Button type="submit" disabled={pending !== null || draftPrompt.trim() === ''}>
                <Plus aria-hidden className="size-4" /> Add
              </Button>
            </form>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmActivate}
        onOpenChange={setConfirmActivate}
        title="Make this the live prompt set?"
        description="The next AI audit asks these prompts. The old set is kept as history, so earlier results still make sense."
        confirmLabel="Activate"
        pendingLabel="Activating…"
        onConfirm={async () => {
          if (!editable) return;
          await activateQuerySet(token, clientId, editable.id);
          await sets.reload();
          admin.notify('ok', 'Prompt set activated.');
        }}
      />
    </div>
  );
}

// ─── Competitors / data ───────────────────────────────────────────────────

export function CompetitorsPanel({ project }: { project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  return (
    <AdminPanel title="Competitors" description="Tick or untick rivals and add your own in the list below. It changes what the client sees straight away.">
      <AdminAction
        label="Find competitors automatically"
        description="Searches Google for who ranks against this site, adds them as candidates, then profiles every tracked rival."
        buttonLabel="Discover"
        pendingLabel="Searching…"
        confirm={{ title: 'Find competitors?', body: `${SPEND} It uses a small search-data credit.`, confirmLabel: 'Discover' }}
        run={async () => {
          await discoverCompetitors(accessToken, clientId, project.id);
          return 'Discovery finished. New candidates are in the list.';
        }}
      />
      <AdminAction
        label="Run gap analysis"
        description="Refreshes the ranked recommendations that compare this site with its rivals."
        buttonLabel="Run gap analysis"
        pendingLabel="Analysing…"
        confirm={{ title: 'Run gap analysis?', body: 'It uses one AI call over the latest audit results.', confirmLabel: 'Run' }}
        run={async () => {
          await runGapAnalysis(accessToken, clientId, project.id);
          return 'Gap analysis finished.';
        }}
      />
    </AdminPanel>
  );
}

const DATASETS = {
  backlinks: { title: 'Backlinks', datasets: ['backlinks-summary', 'backlink-rows', 'referring-domains', 'top-pages'], what: 'backlink and referring-domain data' },
  keywords: { title: 'Keywords', datasets: ['serp-ranks', 'keyword-overview', 'keyword-ideas', 'serp-snapshot', 'domain-overview'], what: 'keyword rankings and ideas' },
} as const;

/** Fetches fresh third-party data for a page. The numbers come from DataForSEO, so they can be refreshed but not typed in. */
export function DataPanel({ kind, project }: { kind: keyof typeof DATASETS; project: Project }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const { accessToken, clientId } = admin;
  const spec = DATASETS[kind];
  return (
    <AdminPanel title={spec.title} description="This data comes from a third-party provider, so you refresh it rather than edit it.">
      <AdminAction
        label={`Refresh ${spec.what}`}
        description={`Collects ${spec.datasets.length} datasets now: ${spec.datasets.join(', ')}.`}
        buttonLabel="Refresh data"
        pendingLabel="Collecting…"
        confirm={{ title: `Refresh ${spec.title.toLowerCase()} data?`, body: `${SPEND} The cost is shown when it finishes.`, confirmLabel: 'Collect now' }}
        run={async () => {
          const out = await collectDataforseoNow(accessToken, clientId, project.id, [...spec.datasets]);
          const skipped = out.skipped.length ? ` Skipped: ${out.skipped.join(', ')}.` : '';
          return `Collected ${out.snapshots.length} dataset${out.snapshots.length === 1 ? '' : 's'} for $${out.totalCostUsd.toFixed(2)}.${skipped}`;
        }}
      />
    </AdminPanel>
  );
}

// ─── Settings: feature switches ───────────────────────────────────────────

export function FeatureSwitchesPanel() {
  const admin = useAdminControls();
  if (!admin) return null;
  const { features, setFeatureEnabled, client } = admin;
  return (
    <AdminPanel title="What this client can see" description={`Turn any section on or off for ${client?.name ?? 'this client'}. It disappears from their menu and from direct links.`}>
      <ul className="flex flex-col">
        {FEATURES.map((f) => {
          const on = features?.[f.key] ?? true;
          return (
            <li key={f.key} className="flex items-center justify-between gap-4 border-t border-[#e8c84a]/40 py-2.5 first:border-t-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{f.label}</p>
                <p className="text-xs text-[#3a2f00]/75">{f.note}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${f.label}: ${on ? 'on' : 'off'} for the client`}
                disabled={features === null}
                onClick={() => void setFeatureEnabled(f.key, !on)}
                className="flex h-7 w-12 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#3a2f00]/50 disabled:opacity-40"
              >
                <span aria-hidden className={cn('relative h-5 w-9 rounded-full transition-colors duration-150 motion-reduce:transition-none', on ? 'bg-[#3a2f00]' : 'bg-[#3a2f00]/25')}>
                  <span className={cn('absolute top-0.5 left-0.5 size-4 rounded-full bg-[#fdd34d] transition-transform duration-150 motion-reduce:transition-none', on && 'translate-x-4')} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </AdminPanel>
  );
}

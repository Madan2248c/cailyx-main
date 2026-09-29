'use client';

import { useState, type FormEvent } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { ConfirmDialog, Field, Notice } from '@/components/admin/admin-ui';
import { useAdminControls } from '@/components/admin/preview/preview-context';
import { Button as PortalButton } from '@/components/portal/button';
import { Tile } from '@/components/portal/layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createManualFix,
  deleteManualFix,
  draftFix,
  setDraftShared,
  setFixStatus,
  type ManualFixInput,
  type SettableFixStatus,
} from '@/lib/admin-actions-api';
import { verifyFix } from '@/lib/remediation-api';
import type { FixSpec, FixStatus } from '@/types/remediation';
import { STATUS_WORD } from '@/types/remediation';

const MANUAL_KEY = 'manual.custom';
export const isManual = (fix: Pick<FixSpec, 'problemKey'>) => fix.problemKey === MANUAL_KEY;

/** Where an admin can move a fix from where it stands. Mirrors the backend's rules. */
const MOVES: Record<FixStatus, SettableFixStatus[]> = {
  OPEN: ['IN_PROGRESS', 'APPLIED', 'DISMISSED'],
  AWAITING_DECISION: ['DISMISSED'],
  IN_PROGRESS: ['OPEN', 'APPLIED', 'DISMISSED'],
  APPLIED: ['OPEN', 'IN_PROGRESS', 'DISMISSED'],
  VERIFIED: [],
  REGRESSED: ['IN_PROGRESS', 'APPLIED', 'DISMISSED'],
  DISMISSED: ['OPEN'],
};

function movesFor(fix: FixSpec): SettableFixStatus[] {
  const moves = [...MOVES[fix.status]];
  // A hand-added fix has no automatic check, so the admin's word confirms it.
  if (isManual(fix)) {
    if (fix.status === 'VERIFIED') moves.push('OPEN');
    else moves.push('VERIFIED');
  }
  return moves;
}

const MOVE_WORD: Record<SettableFixStatus, string> = {
  OPEN: 'Reopen (to do)',
  IN_PROGRESS: 'In progress',
  APPLIED: 'Applied, awaiting check',
  DISMISSED: 'Remove from the plan (dismiss)',
  VERIFIED: 'Confirmed done (verified)',
};

const selectClass =
  'min-h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none transition-colors focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-[var(--g-primary-soft)]';

/** The admin's controls on one fix: move it, remove it, draft it, share the draft. */
export function FixAdminBar({ fix, onChanged }: { fix: FixSpec; onChanged: (fix: FixSpec | null) => void }) {
  const admin = useAdminControls();
  const moves = movesFor(fix);
  const [target, setTarget] = useState<SettableFixStatus | ''>('');
  const [reason, setReason] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!admin) return null;
  const { accessToken, clientId } = admin;

  async function run<T>(key: string, work: () => Promise<T>, done: (out: T) => string) {
    setPending(key);
    setError(null);
    try {
      const out = await work();
      admin!.notify('ok', done(out));
      return out;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return undefined;
    } finally {
      setPending(null);
    }
  }

  async function move(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    if (target === 'DISMISSED' && reason.trim() === '') {
      setError('Say why you are removing this fix. It is kept in its history.');
      return;
    }
    const out = await run(
      'move',
      () => setFixStatus(accessToken, clientId, fix.id, { status: target, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(prUrl.trim() ? { prUrl: prUrl.trim() } : {}) }),
      () => `Moved to “${STATUS_WORD[target as FixStatus]}”.`,
    );
    if (out) {
      setTarget('');
      setReason('');
      setPrUrl('');
      onChanged({ ...fix, ...out });
    }
  }

  return (
    <Tile className="gap-3 bg-[#fff8dc] ring-1 ring-[#e8c84a]/70" ariaLabel="Admin controls for this fix">
      <div className="flex items-center gap-2 text-[#3a2f00]">
        <ShieldCheck className="size-4" aria-hidden />
        <p className="text-xs font-semibold tracking-[0.08em] uppercase">Super admin · this fix</p>
        {isManual(fix) ? <span className="rounded-full bg-[#3a2f00]/10 px-2 py-0.5 text-xs font-medium">Added by hand</span> : null}
      </div>

      <form onSubmit={move} noValidate className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-48 flex-1">
          <Field id="fix-move" label="Change its status">
            <select id="fix-move" className={selectClass} value={target} disabled={moves.length === 0} onChange={(e) => setTarget(e.target.value as SettableFixStatus | '')}>
              <option value="">{moves.length === 0 ? 'No moves from here' : 'Choose…'}</option>
              {moves.map((m) => (
                <option key={m} value={m}>
                  {MOVE_WORD[m]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {target === 'DISMISSED' || target === 'VERIFIED' ? (
          <div className="min-w-56 flex-[2]">
            <Field id="fix-reason" label={target === 'DISMISSED' ? 'Why' : 'Note (optional)'}>
              <Input id="fix-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={target === 'DISMISSED' ? 'Not relevant for this site' : 'Checked live'} />
            </Field>
          </div>
        ) : null}
        {target === 'APPLIED' ? (
          <div className="min-w-56 flex-[2]">
            <Field id="fix-pr" label="Link to the change (optional)">
              <Input id="fix-pr" value={prUrl} onChange={(e) => setPrUrl(e.target.value)} placeholder="https://github.com/…/pull/12" inputMode="url" />
            </Field>
          </div>
        ) : null}
        <Button type="submit" disabled={!target || pending !== null} aria-busy={pending === 'move'}>
          {pending === 'move' ? 'Saving…' : 'Apply'}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {!isManual(fix) && ['OPEN', 'IN_PROGRESS', 'APPLIED', 'REGRESSED'].includes(fix.status) ? (
          <PortalButton
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() =>
              void run('verify', () => verifyFix(accessToken, clientId, fix.id), (out) => (out.status === 'VERIFIED' ? 'Checked the live site: verified.' : 'Checked the live site: not fixed yet.')).then(
                (out) => out && onChanged(out),
              )
            }
          >
            {pending === 'verify' ? 'Checking…' : 'Check live site now'}
          </PortalButton>
        ) : null}
        <PortalButton
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void run('draft', () => draftFix(accessToken, clientId, fix.id), () => 'Drafted. It stays hidden from the client until you share it.').then((out) => out && onChanged(out))}
        >
          {pending === 'draft' ? 'Drafting…' : fix.llmDraft ? 'Redraft with AI' : 'Draft copy with AI'}
        </PortalButton>
        {fix.llmDraft ? (
          <PortalButton
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() =>
              void run('share', () => setDraftShared(accessToken, clientId, fix.id, !fix.draftShared), () => (fix.draftShared ? 'Draft hidden from the client.' : 'Draft now visible to the client.')).then(
                (out) => out && onChanged({ ...fix, ...out }),
              )
            }
          >
            {fix.draftShared ? 'Hide draft from client' : 'Show draft to client'}
          </PortalButton>
        ) : null}
        {isManual(fix) ? (
          <PortalButton size="sm" variant="outline" className="ml-auto text-destructive" disabled={pending !== null} onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden className="size-3.5" /> Delete fix
          </PortalButton>
        ) : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title="Delete this fix?"
        description="It disappears for good, along with its history. To keep a record, remove it from the plan (dismiss) instead."
        confirmLabel="Delete fix"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          await deleteManualFix(accessToken, clientId, fix.id);
          admin.notify('ok', 'Fix deleted.');
          admin.refresh();
          onChanged(null);
        }}
      />
    </Tile>
  );
}

/** The small "remove" beside a fix in the plan list. Hand-added fixes are deleted; audit-found ones are dismissed with a reason. */
export function FixRowRemove({ fix }: { fix: FixSpec }) {
  const admin = useAdminControls();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!admin || fix.status === 'DISMISSED') return null;
  const manual = isManual(fix);

  async function confirm() {
    if (!manual && reason.trim() === '') throw new Error('Say why you are removing it, so the history makes sense.');
    if (manual) await deleteManualFix(admin!.accessToken, admin!.clientId, fix.id);
    else await setFixStatus(admin!.accessToken, admin!.clientId, fix.id, { status: 'DISMISSED', reason: reason.trim() });
    admin!.notify('ok', manual ? 'Fix deleted.' : 'Fix removed from the plan.');
    admin!.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove “${fix.title}” from the plan`}
        title={manual ? 'Delete this fix' : 'Remove from the plan'}
        className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setReason('');
        }}
        destructive
        title={manual ? 'Delete this fix?' : 'Remove this fix from the plan?'}
        description={
          <span className="flex flex-col gap-3">
            <span>
              {manual
                ? `“${fix.title}” will be deleted for good.`
                : `“${fix.title}” is hidden from the client's active plan and kept in Set aside. The next audit will not bring it back.`}
            </span>
            {!manual ? (
              <span className="flex flex-col gap-1.5">
                <label htmlFor="row-remove-reason" className="text-sm font-medium text-foreground">
                  Why
                </label>
                <Input id="row-remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not relevant for this site" />
              </span>
            ) : null}
          </span>
        }
        confirmLabel={manual ? 'Delete fix' : 'Remove from plan'}
        pendingLabel="Removing…"
        onConfirm={confirm}
      />
    </>
  );
}

const LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const CLASSES: Array<{ value: ManualFixInput['fixClass']; label: string }> = [
  { value: 'CONTENT', label: 'Content change' },
  { value: 'CODE', label: 'Code change' },
  { value: 'CONFIG', label: 'Settings change' },
  { value: 'OFF_SITE', label: 'Off the website' },
  { value: 'INVESTIGATE', label: 'Needs investigating' },
];

/** Add a fix to a project's plan by hand. It is never touched by an automatic re-sync. */
export function ManualFixDialog({ projectId, projectDomain }: { projectId: string; projectDomain: string }) {
  const admin = useAdminControls();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState(`https://${projectDomain}`);
  const [fixClass, setFixClass] = useState<ManualFixInput['fixClass']>('CONTENT');
  const [severity, setSeverity] = useState<ManualFixInput['severity']>('MEDIUM');
  const [effort, setEffort] = useState<ManualFixInput['effort']>('MEDIUM');
  const [steps, setSteps] = useState('');
  const [note, setNote] = useState('');
  const [needsDecision, setNeedsDecision] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; target?: string; steps?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!admin) return null;

  function reset() {
    setTitle('');
    setTarget(`https://${projectDomain}`);
    setFixClass('CONTENT');
    setSeverity('MEDIUM');
    setEffort('MEDIUM');
    setSteps('');
    setNote('');
    setNeedsDecision(false);
    setErrors({});
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const lines = steps.split('\n').map((s) => s.trim()).filter(Boolean);
    const next: typeof errors = {};
    if (title.trim().length < 3) next.title = 'Give the fix a short title.';
    if (target.trim() === '') next.target = 'Say which page or site this is about.';
    if (lines.length === 0) next.steps = 'Add at least one step, one per line.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    setError(null);
    try {
      await createManualFix(admin!.accessToken, admin!.clientId, projectId, {
        title: title.trim(),
        target: target.trim(),
        fixClass,
        severity,
        effort,
        steps: lines,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(needsDecision ? { needsClientDecision: true } : {}),
      });
      admin!.notify('ok', needsDecision ? 'Fix added. It is waiting for the client to approve.' : 'Fix added to the plan.');
      admin!.refresh();
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setErrors({});
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" className="border-[#3a2f00]/30">Add a fix by hand</Button>} />
      <DialogContent className="theme-graphite max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Add a fix to the plan</DialogTitle>
          <DialogDescription>It appears in the client&apos;s Fix Plan straight away. Automatic audits never change or close it. You confirm when it is done.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field id="mf-title" label="What needs doing" error={errors.title}>
            <Input id="mf-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a returns policy page" aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? 'mf-title-error' : undefined} />
          </Field>
          <Field id="mf-target" label="Where" hint="A page address, or the site address for something site-wide." error={errors.target}>
            <Input id="mf-target" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={errors.target ? true : undefined} aria-describedby={errors.target ? 'mf-target-error' : 'mf-target-hint'} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="mf-class" label="Kind of work">
              <select id="mf-class" className={selectClass} value={fixClass} onChange={(e) => setFixClass(e.target.value as ManualFixInput['fixClass'])}>
                {CLASSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="mf-sev" label="Impact">
              <select id="mf-sev" className={selectClass} value={severity} onChange={(e) => setSeverity(e.target.value as ManualFixInput['severity'])}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l.charAt(0) + l.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="mf-eff" label="Effort">
              <select id="mf-eff" className={selectClass} value={effort} onChange={(e) => setEffort(e.target.value as ManualFixInput['effort'])}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l.charAt(0) + l.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="mf-steps" label="Steps" hint="One per line, in order. The first line is shown as the reason it matters." error={errors.steps}>
            <Textarea id="mf-steps" rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} aria-invalid={errors.steps ? true : undefined} aria-describedby={errors.steps ? 'mf-steps-error' : 'mf-steps-hint'} />
          </Field>
          <Field id="mf-note" label="Extra context (optional)">
            <Textarea id="mf-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-muted/60 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={needsDecision} onChange={(e) => setNeedsDecision(e.target.checked)} />
            <span>
              <span className="font-medium">Ask the client to approve it first.</span> <span className="text-muted-foreground">It waits in their &ldquo;Needs your decision&rdquo; list.</span>
            </span>
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? 'Adding…' : 'Add to the plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

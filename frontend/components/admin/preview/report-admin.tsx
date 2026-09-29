'use client';

import { useState, type FormEvent } from 'react';
import { EyeOff, Globe, Pencil } from 'lucide-react';
import { ConfirmDialog, Field, Notice } from '@/components/admin/admin-ui';
import { useAdminControls } from '@/components/admin/preview/preview-context';
import { Button as PortalButton } from '@/components/portal/button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { editReport, publishReport, withdrawReport } from '@/lib/admin-actions-api';
import type { ReportListItem } from '@/types/report';

/**
 * Under each report in the list: whether the client can see it, and the
 * controls to change that or change what it says. Edits become a new revision,
 * so nothing that was published is silently rewritten.
 */
export function ReportAdminRow({ report }: { report: ReportListItem }) {
  const admin = useAdminControls();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | null>(null);
  if (!admin) return null;
  const live = report.status === 'RELEASED';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#fff8dc] px-3 py-2 ring-1 ring-[#e8c84a]/70">
      <span className="mr-auto flex items-center gap-1.5 text-xs font-medium text-[#3a2f00]">
        {live ? <Globe className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
        {live ? 'Live: the client can read it' : 'Not visible to the client'}
      </span>
      <PortalButton size="sm" variant="outline" className="border-[#3a2f00]/30 bg-white/70" onClick={() => setEditing(true)}>
        <Pencil className="size-3.5" aria-hidden /> Edit text
      </PortalButton>
      {live ? (
        <PortalButton size="sm" variant="outline" className="border-[#3a2f00]/30 bg-white/70" onClick={() => setConfirm('withdraw')}>
          Withdraw
        </PortalButton>
      ) : (
        <PortalButton size="sm" className="bg-[#3a2f00] text-[#fdd34d] hover:bg-[#3a2f00]" onClick={() => setConfirm('publish')}>
          Publish to client
        </PortalButton>
      )}

      <EditReportDialog report={report} open={editing} onOpenChange={setEditing} />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        destructive={confirm === 'withdraw'}
        title={confirm === 'withdraw' ? 'Withdraw this report?' : 'Publish this report to the client?'}
        description={
          confirm === 'withdraw'
            ? 'The client can no longer open it. You can publish it again later.'
            : 'The client can read the newest version straight away, without the review step.'
        }
        confirmLabel={confirm === 'withdraw' ? 'Withdraw' : 'Publish'}
        pendingLabel={confirm === 'withdraw' ? 'Withdrawing…' : 'Publishing…'}
        onConfirm={async () => {
          if (confirm === 'withdraw') await withdrawReport(admin.accessToken, admin.clientId, report.id);
          else await publishReport(admin.accessToken, admin.clientId, report.id);
          admin.notify('ok', confirm === 'withdraw' ? 'Report withdrawn.' : 'Report published to the client.');
          admin.refresh();
        }}
      />
    </div>
  );
}

function EditReportDialog({ report, open, onOpenChange }: { report: ReportListItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const admin = useAdminControls();
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.executiveSummary ?? '');
  const [errors, setErrors] = useState<{ title?: string; summary?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!admin) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (title.trim() === '') next.title = 'A report needs a title.';
    if (summary.trim() === '') next.summary = 'The summary can’t be empty.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const patch: { title?: string; executiveSummary?: string } = {};
    if (title.trim() !== report.title) patch.title = title.trim();
    if (summary.trim() !== (report.executiveSummary ?? '').trim()) patch.executiveSummary = summary.trim();
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await editReport(admin!.accessToken, admin!.clientId, report.id, patch);
      admin!.notify('ok', report.status === 'RELEASED' ? 'Saved. The client sees the new text now.' : 'Saved as a new version.');
      admin!.refresh();
      onOpenChange(false);
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
        if (next) {
          setTitle(report.title);
          setSummary(report.executiveSummary ?? '');
          setErrors({});
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="theme-graphite sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Edit the report text</DialogTitle>
          <DialogDescription>
            {report.status === 'RELEASED'
              ? 'This report is live. Your change replaces what the client reads, as a new saved version.'
              : 'Saved as a new version. The client will not see it until you publish.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field id="rep-title" label="Title" error={errors.title}>
            <Input id="rep-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? 'rep-title-error' : undefined} />
          </Field>
          <Field id="rep-summary" label="Executive summary" hint="Blank lines start a new paragraph." error={errors.summary}>
            <Textarea id="rep-summary" rows={9} value={summary} onChange={(e) => setSummary(e.target.value)} aria-invalid={errors.summary ? true : undefined} aria-describedby={errors.summary ? 'rep-summary-error' : 'rep-summary-hint'} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

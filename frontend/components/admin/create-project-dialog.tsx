'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createProject } from '@/lib/projects-api';

export function CreateProjectDialog({
  accessToken,
  clientId,
  onCreated,
}: {
  accessToken: string;
  clientId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [spendConsent, setSpendConsent] = useState(false);
  const [spendCeiling, setSpendCeiling] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!spendConsent) {
      setError('Confirm the Day-1 spend to create the project.');
      return;
    }
    setIsSubmitting(true);
    try {
      const ceiling = spendCeiling.trim() === '' ? undefined : Number(spendCeiling);
      await createProject(accessToken, clientId, name, domain, {
        day1SpendConsent: true,
        ...(ceiling !== undefined && Number.isFinite(ceiling) ? { day1SpendCeilingUsd: ceiling } : {}),
      });
      setName('');
      setDomain('');
      setSpendConsent(false);
      setSpendCeiling('');
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>New project</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new project</DialogTitle>
          <DialogDescription>
            Just a name and domain — everything else is inferred later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="projectName">Project name</Label>
            <Input
              id="projectName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'create-project-error' : undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="projectDomain">Domain</Label>
            <Input
              id="projectDomain"
              placeholder="acme.com"
              required
              autoComplete="off"
              inputMode="url"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-describedby="projectDomain-hint"
            />
            <p id="projectDomain-hint" className="text-sm text-muted-foreground">
              Just the domain, e.g. acme.com without https://.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spendCeiling">Day-1 spend ceiling in USD (optional)</Label>
            <Input
              id="spendCeiling"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              placeholder="No cap"
              value={spendCeiling}
              onChange={(e) => setSpendCeiling(e.target.value)}
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              id="spendConsent"
              className="mt-1 size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              checked={spendConsent}
              onChange={(e) => setSpendConsent(e.target.checked)}
              aria-describedby={error ? 'create-project-error' : undefined}
            />
            <span>
              Creating this project starts the automatic Day-1 audit run, which spends on
              crawls and AI answer engines. I authorize that spend
              {spendCeiling.trim() === '' ? '' : ` up to $${spendCeiling}`} for this project.
            </span>
          </label>
          <FieldError id="create-project-error" message={error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />} />
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

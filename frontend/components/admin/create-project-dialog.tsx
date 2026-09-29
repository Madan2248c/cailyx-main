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
import { Input } from '@/components/ui/input';
import { Field, Notice } from '@/components/admin/admin-ui';
import { createProject } from '@/lib/projects-api';

/** Longest the dialog waits before it stops saying "Creating…" and lets you act. */
const CREATE_TIMEOUT_MS = 20_000;

class SlowResponse extends Error {}

interface FieldErrors {
  name?: string;
  domain?: string;
  ceiling?: string;
  consent?: string;
}

/** A plain hostname such as `acme.com` or `shop.acme.co.uk`. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Mirrors the server's rule (lowercase, strip protocol and www, keep the host) so a pasted URL just works. */
function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.split(/[/?#]/)[0] ?? '';
  return domain.replace(/[./]+$/, '');
}

function validate(name: string, domain: string, ceiling: string, consent: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (name.trim() === '') errors.name = 'Enter a project name.';
  if (!HOSTNAME.test(normalizeDomain(domain))) errors.domain = 'Enter a domain like acme.com.';
  if (ceiling.trim() !== '') {
    const value = Number(ceiling);
    if (!Number.isFinite(value) || value < 0) errors.ceiling = 'Enter a dollar amount of 0 or more, or leave it blank for no cap.';
  }
  if (!consent) errors.consent = 'Confirm the Day-1 spend to create the project.';
  return errors;
}

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setName('');
    setDomain('');
    setSpendConsent(false);
    setSpendCeiling('');
    setFieldErrors({});
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors = validate(name, domain, spendCeiling, spendConsent);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const ceiling = spendCeiling.trim() === '' ? undefined : Number(spendCeiling);
      const created = createProject(accessToken, clientId, name.trim(), normalizeDomain(domain), {
        day1SpendConsent: true,
        ...(ceiling !== undefined ? { day1SpendCeilingUsd: ceiling } : {}),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tooSlow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SlowResponse()), CREATE_TIMEOUT_MS);
      });
      try {
        await Promise.race([created, tooSlow]);
      } finally {
        clearTimeout(timer);
      }
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      if (err instanceof SlowResponse) {
        // The project may well exist: refresh the list so it isn't created twice by a second try.
        setError('The server took too long to answer. The project may have been created, so check the list before trying again.');
        onCreated();
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        if (next) {
          setFieldErrors({});
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button>New project</Button>} />
      <DialogContent className="theme-graphite">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Create a new project</DialogTitle>
          <DialogDescription>Just a name and a domain. Everything else is worked out by the Day-1 audit.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Field id="projectName" label="Project name" error={fieldErrors.name}>
            <Input
              id="projectName"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? 'projectName-error' : undefined}
            />
          </Field>
          <Field id="projectDomain" label="Domain" hint="Like acme.com. Pasting a full web address works too." error={fieldErrors.domain}>
            <Input
              id="projectDomain"
              placeholder="acme.com"
              required
              autoComplete="off"
              inputMode="url"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-invalid={fieldErrors.domain ? true : undefined}
              aria-describedby={fieldErrors.domain ? 'projectDomain-error' : 'projectDomain-hint'}
            />
          </Field>
          <Field
            id="spendCeiling"
            label="Day-1 spend ceiling in USD (optional)"
            hint="The audit stops spending at this amount. Blank means no cap."
            error={fieldErrors.ceiling}
          >
            <Input
              id="spendCeiling"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              placeholder="No cap"
              value={spendCeiling}
              onChange={(e) => setSpendCeiling(e.target.value)}
              aria-invalid={fieldErrors.ceiling ? true : undefined}
              aria-describedby={fieldErrors.ceiling ? 'spendCeiling-error' : 'spendCeiling-hint'}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-muted/60 p-3 text-sm">
              <input
                type="checkbox"
                id="spendConsent"
                className="mt-0.5 size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                checked={spendConsent}
                onChange={(e) => setSpendConsent(e.target.checked)}
                aria-invalid={fieldErrors.consent ? true : undefined}
                aria-describedby={fieldErrors.consent ? 'spendConsent-error' : undefined}
              />
              <span>
                Creating this project starts the automatic Day-1 audit, which spends on crawls and AI answer engines. I
                authorize that spend
                {spendCeiling.trim() !== '' && Number.isFinite(Number(spendCeiling)) ? ` up to $${spendCeiling}` : ''} for
                this project.
              </span>
            </label>
            {fieldErrors.consent ? (
              <p id="spendConsent-error" role="alert" className="text-xs text-danger">
                {fieldErrors.consent}
              </p>
            ) : null}
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancel</DialogClose>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

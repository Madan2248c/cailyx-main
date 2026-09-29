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
import { createClient } from '@/lib/team-api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  name?: string;
  pocEmail?: string;
  seatLimit?: string;
}

function validate(name: string, pocEmail: string, seatLimit: string): FieldErrors {
  const errors: FieldErrors = {};
  if (name.trim() === '') errors.name = "Enter the client's name.";
  if (!EMAIL.test(pocEmail.trim())) errors.pocEmail = 'Enter a valid email address.';
  const seats = Number(seatLimit);
  if (!Number.isInteger(seats) || seats < 1) errors.seatLimit = 'Seats must be a whole number, at least 1.';
  return errors;
}

export function CreateClientDialog({
  accessToken,
  onCreated,
}: {
  accessToken: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pocEmail, setPocEmail] = useState('');
  const [seatLimit, setSeatLimit] = useState('1');
  const [deferInvite, setDeferInvite] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setName('');
    setPocEmail('');
    setSeatLimit('1');
    setDeferInvite(false);
    setFieldErrors({});
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors = validate(name, pocEmail, seatLimit);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      await createClient(accessToken, name.trim(), pocEmail.trim(), Number(seatLimit), deferInvite || undefined);
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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
      <DialogTrigger render={<Button>New client</Button>} />
      <DialogContent className="theme-graphite">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Create a new client</DialogTitle>
          <DialogDescription>
            Their point of contact gets an invite link to set a password and start onboarding, either now or with the
            Day-1 audit if you hold it below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Field id="clientName" label="Client name" error={fieldErrors.name}>
            <Input
              id="clientName"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? 'clientName-error' : undefined}
            />
          </Field>
          <Field id="pocEmail" label="Point of contact email" error={fieldErrors.pocEmail}>
            <Input
              id="pocEmail"
              type="email"
              autoComplete="off"
              required
              value={pocEmail}
              onChange={(e) => setPocEmail(e.target.value)}
              aria-invalid={fieldErrors.pocEmail ? true : undefined}
              aria-describedby={fieldErrors.pocEmail ? 'pocEmail-error' : undefined}
            />
          </Field>
          <Field id="seatLimit" label="Seats" hint="Includes the point of contact." error={fieldErrors.seatLimit}>
            <Input
              id="seatLimit"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              required
              value={seatLimit}
              onChange={(e) => setSeatLimit(e.target.value)}
              aria-invalid={fieldErrors.seatLimit ? true : undefined}
              aria-describedby={fieldErrors.seatLimit ? 'seatLimit-error' : 'seatLimit-hint'}
            />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-muted/60 p-3 text-sm">
            <input
              type="checkbox"
              id="deferInvite"
              className="mt-0.5 size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              checked={deferInvite}
              onChange={(e) => setDeferInvite(e.target.checked)}
            />
            <span>
              <span className="font-medium">Hold the invite until the Day-1 audit is ready.</span>{' '}
              <span className="text-muted-foreground">
                They get one email with the report instead of an invite now and a report later.
              </span>
            </span>
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancel</DialogClose>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

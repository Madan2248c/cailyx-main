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
import { updateSeatLimit } from '@/lib/team-api';
import type { ClientSummary } from '@/types/team';

export function EditSeatsDialog({
  accessToken,
  client,
  onUpdated,
}: {
  accessToken: string;
  client: ClientSummary;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [seatLimit, setSeatLimit] = useState(String(client.seatLimit));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const seats = Number(seatLimit);
    if (!Number.isInteger(seats) || seats < 1) {
      setFieldError('Seats must be a whole number, at least 1.');
      return;
    }
    setFieldError(null);
    setIsSubmitting(true);
    try {
      await updateSeatLimit(accessToken, client.id, seats);
      setOpen(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  const entered = Number(seatLimit);
  const belowUse = Number.isInteger(entered) && entered >= 1 && entered < client.seatsUsed;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        setOpen(next);
        if (next) {
          setSeatLimit(String(client.seatLimit));
          setFieldError(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline">Edit seats</Button>} />
      <DialogContent className="theme-graphite">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Seats for {client.name}</DialogTitle>
          <DialogDescription>
            Using {client.seatsUsed} of {client.seatLimit} now. Lowering the limit below what&apos;s in use won&apos;t
            remove anyone already onboarded.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Field id="editSeatLimit" label="Seat limit" error={fieldError}>
            <Input
              id="editSeatLimit"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              required
              autoFocus
              value={seatLimit}
              onChange={(e) => setSeatLimit(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'editSeatLimit-error' : undefined}
            />
          </Field>
          {belowUse ? (
            <p className="text-xs text-warning" role="status">
              That&apos;s below the {client.seatsUsed} seats in use. Existing users stay, but no new invites can go out
              until seats free up.
            </p>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>Cancel</DialogClose>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

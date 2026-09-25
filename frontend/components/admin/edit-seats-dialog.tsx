'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateSeatLimit(accessToken, client.id, Number(seatLimit));
      setOpen(false);
      onUpdated();
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
        setOpen(next);
        if (next) setSeatLimit(String(client.seatLimit));
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline">Edit seats</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Seats for {client.name}</DialogTitle>
          <DialogDescription>
            Currently using {client.seatsUsed} of {client.seatLimit}. Lowering the limit below
            what&apos;s in use won&apos;t remove anyone already onboarded.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editSeatLimit">Seat limit</Label>
            <Input
              id="editSeatLimit"
              type="number"
              min={1}
              required
              value={seatLimit}
              onChange={(e) => setSeatLimit(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

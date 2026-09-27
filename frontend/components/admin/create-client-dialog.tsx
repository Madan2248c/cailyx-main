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
import { createClient } from '@/lib/team-api';

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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createClient(accessToken, name, pocEmail, Number(seatLimit), deferInvite || undefined);
      setName('');
      setPocEmail('');
      setSeatLimit('1');
      setDeferInvite(false);
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
      <DialogTrigger render={<Button>New client</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new client</DialogTitle>
          <DialogDescription>
            Their POC will get an invite link to set up their password and onboard — now,
            or with the Day-1 audit if held below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="clientName">Client name</Label>
            <Input id="clientName" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pocEmail">POC email</Label>
            <Input
              id="pocEmail"
              type="email"
              required
              value={pocEmail}
              onChange={(e) => setPocEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="seatLimit">Seats (includes the POC)</Label>
            <Input
              id="seatLimit"
              type="number"
              min={1}
              required
              value={seatLimit}
              onChange={(e) => setSeatLimit(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={deferInvite}
              onChange={(e) => setDeferInvite(e.target.checked)}
            />
            <span>
              Hold the invite until the Day-1 audit is ready — the POC gets one email
              with the report, instead of an invite now and a report later.
            </span>
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

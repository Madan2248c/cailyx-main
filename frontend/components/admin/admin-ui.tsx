'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Search, X } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PortalLoading } from '@/components/portal/states';
import { StatusChip } from '@/components/portal/layout';
import type { Tone } from '@/components/portal/tone';
import { useAuth } from '@/contexts/auth-context';
import type { Day1Status } from '@/lib/settings-api';
import type { ScheduleCadence } from '@/lib/schedules-api';

/**
 * Gates the admin console. Non-admins are sent away before any admin chrome
 * or data renders, so a client account never sees the console flash by.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const allowed = !!user && user.role === 'ADMIN';

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'ADMIN') router.replace('/dashboard');
  }, [isLoading, user, router]);

  if (isLoading || !allowed) return <PortalLoading label="Loading the admin console" />;
  return <>{children}</>;
}

/** Two-letter monogram tile, the same one the client sidebar uses for a project. */
export function Monogram({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-foreground ring-1 ring-border',
        className,
      )}
    >
      {initials || '·'}
    </span>
  );
}

/** Inline banner for the result of an action. Errors are announced; successes are polite. */
export function Notice({
  tone,
  children,
  onDismiss,
  className,
}: {
  tone: 'ok' | 'error';
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const ok = tone === 'ok';
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm',
        ok ? 'text-success' : 'text-danger',
        className,
      )}
      style={{ background: ok ? 'var(--success-soft)' : 'var(--danger-soft)' }}
    >
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <p className="min-w-0 flex-1 break-words text-foreground">{children}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-0.5 -mr-1 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** A labelled form field with an optional hint and an error line. The caller wires `aria-describedby` on the control. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Search field with an icon, for filtering a list on the page. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-9 w-full rounded-lg border border-input bg-background py-2 pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-[var(--g-primary-soft)]"
      />
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A radio group drawn as a pill toggle. Arrow keys move the selection, so it
 * behaves like the native radios it replaces (and the old <select>).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex w-fit rounded-lg bg-muted p-0.5 ring-1 ring-border', disabled && 'opacity-60')}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed motion-reduce:transition-none',
              selected ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const CADENCE_OPTIONS: SegmentOption<ScheduleCadence>[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'MANUAL_ONLY', label: 'Manual' },
];

export function cadenceLabel(cadence: ScheduleCadence): string {
  return CADENCE_OPTIONS.find((o) => o.value === cadence)?.label ?? cadence;
}

/** The chip for a project's schedule: what it is set to, in a word. */
export function ScheduleChip({ schedule }: { schedule: { cadence: ScheduleCadence; active: boolean } | null }) {
  if (!schedule) return <StatusChip tone="neutral">Not set</StatusChip>;
  if (!schedule.active) return <StatusChip tone="neutral">{cadenceLabel(schedule.cadence)} · paused</StatusChip>;
  return <StatusChip tone="good">{cadenceLabel(schedule.cadence)}</StatusChip>;
}

const DAY1: Record<Day1Status['status'], { tone: Tone; word: string }> = {
  QUEUED: { tone: 'watch', word: 'Queued' },
  RUNNING: { tone: 'watch', word: 'Running' },
  COMPLETE: { tone: 'good', word: 'Complete' },
  FAILED: { tone: 'bad', word: 'Failed' },
};

/** Day-1 audit state as a chip. `null` means the backend has no run for the project. */
export function Day1Chip({ status }: { status: Day1Status['status'] | null | undefined }) {
  if (!status) return <StatusChip tone="neutral">No Day-1 run</StatusChip>;
  const { tone, word } = DAY1[status];
  return <StatusChip tone={tone}>Day-1 {word.toLowerCase()}</StatusChip>;
}

/**
 * A confirmation for actions that are costly or hard to undo. The confirm
 * handler may throw: the message is shown in the dialog and it stays open.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = 'Working…',
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
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
        if (next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="theme-graphite sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            aria-busy={pending}
            onClick={confirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

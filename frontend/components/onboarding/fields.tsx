'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ScalarRow({
  id,
  label,
  hint,
  value,
  onChange,
  multiline,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea id={id} value={value} rows={3} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ListEditor({
  id,
  label,
  hint,
  values,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {values.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {disabled ? 'Nothing found.' : 'Nothing here yet — add the first one below.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {values.map((value, index) => (
            <li
              key={`${value}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            >
              <span className="flex-1">{value}</span>
              {!disabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove ${value}`}
                  onClick={() => removeAt(index)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!disabled ? (
        <div className="flex gap-2">
          <Input
            id={id}
            value={draft}
            placeholder="Add another…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={add} disabled={draft.trim() === ''}>
            Add
          </Button>
        </div>
      ) : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

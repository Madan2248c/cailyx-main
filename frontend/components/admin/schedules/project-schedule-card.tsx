'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  setSocialActivitySchedule,
  setTechnicalAuditSchedule,
  type ScheduleCadence,
  type SocialActivitySchedule,
  type TechnicalAuditSchedule,
} from '@/lib/schedules-api';
import type { Project } from '@/types/project';

const CADENCES: ScheduleCadence[] = ['WEEKLY', 'MONTHLY', 'MANUAL_ONLY'];

function cadenceVariant(cadence: ScheduleCadence | null): 'default' | 'secondary' | 'outline' {
  if (cadence === 'WEEKLY') return 'default';
  if (cadence === 'MONTHLY') return 'secondary';
  return 'outline';
}

function CadenceSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: ScheduleCadence;
  disabled: boolean;
  onChange: (cadence: ScheduleCadence) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ScheduleCadence)}
      >
        {CADENCES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProjectScheduleCard({
  accessToken,
  clientId,
  project,
  technical,
  social,
  onChanged,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'technical' | 'social' | null>(null);

  async function handleTechnical(cadence: ScheduleCadence) {
    setPending('technical');
    setError(null);
    try {
      await setTechnicalAuditSchedule(accessToken, clientId, project.id, cadence);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update technical audit schedule');
    } finally {
      setPending(null);
    }
  }

  async function handleSocial(cadence: ScheduleCadence) {
    setPending('social');
    setError(null);
    try {
      await setSocialActivitySchedule(accessToken, clientId, project.id, cadence);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update social activity schedule');
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {project.name} <span className="font-normal text-muted-foreground">· {project.domain}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">Technical audit</span>
            {technical ? (
              <>
                <Badge variant={cadenceVariant(technical.cadence)}>{technical.cadence}</Badge>
                <Badge variant={technical.active ? 'default' : 'outline'}>
                  {technical.active ? 'active' : 'inactive'}
                </Badge>
              </>
            ) : (
              <Badge variant="outline">not scheduled yet</Badge>
            )}
          </div>
          <CadenceSelect
            label="Set cadence"
            value={technical?.cadence ?? 'MANUAL_ONLY'}
            disabled={pending !== null}
            onChange={handleTechnical}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">Social activity</span>
            {social ? (
              <>
                <Badge variant={cadenceVariant(social.cadence)}>{social.cadence}</Badge>
                <Badge variant={social.active ? 'default' : 'outline'}>
                  {social.active ? 'active' : 'inactive'}
                </Badge>
                {!social.spendOptIn ? (
                  <span className="text-xs text-muted-foreground">scheduled ticks skipped — no spend opt-in</span>
                ) : null}
              </>
            ) : (
              <Badge variant="outline">not scheduled yet</Badge>
            )}
          </div>
          <CadenceSelect
            label="Set cadence"
            value={social?.cadence ?? 'MANUAL_ONLY'}
            disabled={pending !== null}
            onChange={handleSocial}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">Reporting (monthly)</span>
            <Badge variant="outline">not scheduled yet</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Gap: no reporting schedule endpoint on the backend — reports are generated on demand.
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">AEO audit</span>
            <Badge variant="outline">not scheduled yet</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Gap: no AEO schedule endpoint on the backend — audits are created and run on demand.
          </span>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError } from '@/components/ui/error-state';
import {
  addCompetitor,
  patchCompanyContext,
  patchCompetitor,
  patchSocialProfile,
} from '@/lib/onboarding-api';
import type {
  CompanyProfile,
  Competitor,
  ProfileFieldUpdates,
  SocialProfile,
} from '@/types/onboarding';
import { arrayOf, scalarOf } from '@/types/onboarding';
import type { Project } from '@/types/project';
import { CompetitorsStep, ProfileFieldsStep, SocialsStep, STEP_FIELDS } from './steps';

type StepKey = 'welcome' | 'basics' | 'offerings' | 'customers' | 'presence' | 'competitors' | 'review';

const STEPS: Array<{ key: StepKey; title: string; description: string }> = [
  { key: 'welcome', title: 'Welcome', description: 'What we found about your business' },
  { key: 'basics', title: 'Company basics', description: 'Name, description, and where you are' },
  { key: 'offerings', title: 'Offerings', description: 'What you sell and why it wins' },
  { key: 'customers', title: 'Customers', description: 'Who you serve' },
  { key: 'presence', title: 'Presence', description: 'Contact details and social profiles' },
  { key: 'competitors', title: 'Competitors', description: 'Who you are up against' },
  { key: 'review', title: 'Review', description: 'Confirm everything looks right' },
];

function initialFields(profile: CompanyProfile): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  for (const defs of Object.values(STEP_FIELDS)) {
    for (const def of defs) {
      const [section, field] = def.path.split('.');
      fields[def.path] = def.list ? arrayOf(profile, section, field) : scalarOf(profile, section, field);
    }
  }
  return fields;
}

export function OnboardingWizard({
  accessToken,
  clientId,
  project,
  profile,
  socials: initialSocials,
  competitors: initialCompetitors,
  canEdit,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  profile: CompanyProfile;
  socials: SocialProfile[];
  competitors: Competitor[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [fields, setFields] = useState<Record<string, string | string[]>>(() => initialFields(profile));
  const [savedFields, setSavedFields] = useState<Record<string, string | string[]>>(() => initialFields(profile));
  const [socials, setSocials] = useState<SocialProfile[]>(initialSocials);
  const [socialUrls, setSocialUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialSocials.map((s) => [s.id, s.url])),
  );
  const [competitorRows, setCompetitorRows] = useState<Competitor[]>(initialCompetitors);
  const [competitorEdits, setCompetitorEdits] = useState<
    Record<string, { name: string; domain: string; tracked: boolean }>
  >(() =>
    Object.fromEntries(
      initialCompetitors.map((c) => [
        c.id,
        { name: c.name, domain: c.domain ?? '', tracked: c.status === 'tracked' },
      ]),
  ),
  );
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const step = STEPS[stepIndex];

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);
  const get = (path: string): string | string[] => fields[path] ?? '';
  const set = (path: string, value: string | string[] | null) => {
    setFields((prev) => ({ ...prev, [path]: value ?? '' }));
  };

  function patchEdit(id: string, partial: Partial<{ name: string; domain: string; tracked: boolean }>) {
    setCompetitorEdits((prev) => {
      const current = prev[id] ?? { name: '', domain: '', tracked: false };
      return { ...prev, [id]: { ...current, ...partial } };
    });
  }

  const changedProfilePaths = useMemo(
    () =>
      Object.keys(fields).filter((path) => {
        const current = fields[path];
        const saved = savedFields[path];
        return JSON.stringify(current) !== JSON.stringify(saved);
      }),
    [fields, savedFields],
  );

  async function saveProfilePaths(paths: string[]): Promise<void> {
    const updates: ProfileFieldUpdates = {};
    for (const path of paths) {
      const value = fields[path];
      // An emptied scalar clears the field server-side; emptied lists clear too.
      updates[path] = typeof value === 'string' && value === '' ? null : (value as string | string[]);
    }
    if (Object.keys(updates).length === 0) return;
    await patchCompanyContext(accessToken, clientId, project.id, updates);
    setSavedFields((prev) => ({ ...prev, ...fields }));
  }

  async function saveSocials(): Promise<void> {
    const changed = socials.filter((s) => (socialUrls[s.id] ?? s.url).trim() !== s.url);
    for (const social of changed) {
      const updated = await patchSocialProfile(accessToken, clientId, project.id, social.id, socialUrls[social.id].trim());
      setSocials((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    }
  }

  async function saveCompetitors(): Promise<void> {
    for (const row of competitorRows) {
      const edit = competitorEdits[row.id];
      if (!edit) continue;
      const patch: { name?: string; domain?: string | null; status?: 'tracked' | 'candidate' } = {};
      if (edit.name.trim() !== '' && edit.name.trim() !== row.name) patch.name = edit.name.trim();
      const domain = edit.domain.trim();
      if (domain !== (row.domain ?? '') && !(domain === '' && row.domain === null)) {
        patch.domain = domain === '' ? null : domain;
      }
      const status = edit.tracked ? 'tracked' : 'candidate';
      if (status !== row.status) patch.status = status;
      if (Object.keys(patch).length === 0) continue;
      const updated = await patchCompetitor(accessToken, clientId, project.id, row.id, patch);
      setCompetitorRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    }
  }

  async function addNewCompetitor(): Promise<void> {
    const name = newName.trim();
    if (name === '') return;
    const created = await addCompetitor(accessToken, clientId, project.id, {
      name,
      ...(newDomain.trim() === '' ? {} : { domain: newDomain.trim() }),
    });
    setCompetitorRows((prev) => [...prev, created]);
    setCompetitorEdits((prev) => ({
      ...prev,
      [created.id]: { name: created.name, domain: created.domain ?? '', tracked: true },
    }));
    setNewName('');
    setNewDomain('');
  }

  async function handleContinue() {
    if (!canEdit) {
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      if (step.key === 'presence') {
        const paths = STEP_FIELDS.presence
          .map((d) => d.path)
          .filter((p) => changedProfilePaths.includes(p));
        await saveProfilePaths(paths);
        await saveSocials();
      } else if (step.key === 'competitors') {
        await saveCompetitors();
      } else if (step.key in STEP_FIELDS) {
        const paths = STEP_FIELDS[step.key as keyof typeof STEP_FIELDS]
          .map((d) => d.path)
          .filter((p) => changedProfilePaths.includes(p));
        await saveProfilePaths(paths);
      }
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSaving(false);
    }
  }

  function handleBack() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <nav aria-label="Onboarding progress">
        <p className="sr-only">
          Step {stepIndex + 1} of {STEPS.length}: {step.title}
        </p>
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === stepIndex ? 'step' : undefined}
              className="flex flex-1 items-center gap-2 last:flex-none"
            >
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  i < stepIndex
                    ? 'bg-primary text-primary-foreground'
                    : i === stepIndex
                      ? 'border border-primary text-primary'
                      : 'border border-border text-muted-foreground'
                }`}
              >
                {i + 1}
              </span>
              {i < STEPS.length - 1 ? (
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      <Card>
        <CardHeader>
          <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
            {step.key === 'welcome' ? `Welcome to Cailyx, ${project.name}` : step.title}
          </CardTitle>
          <CardDescription>
            {step.key === 'welcome'
              ? `We researched ${project.domain} and prefilled everything below from what we found. Walk through each step, fix anything we got wrong, and confirm at the end.`
              : step.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!canEdit ? (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              You&apos;re viewing as a team member — only your account&apos;s POC can save changes.
            </p>
          ) : null}

          {step.key === 'welcome' ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">Project:</span> {project.name} ({project.domain})
              </p>
              <p>
                <span className="text-muted-foreground">Social profiles found:</span> {socials.length}
              </p>
              <p>
                <span className="text-muted-foreground">Competitors on file:</span> {competitorRows.length}
              </p>
            </div>
          ) : null}

          {step.key === 'basics' || step.key === 'offerings' || step.key === 'customers' ? (
            <ProfileFieldsStep
              defs={STEP_FIELDS[step.key]}
              get={get}
              set={set}
              disabled={!canEdit}
            />
          ) : null}

          {step.key === 'presence' ? (
            <>
              <ProfileFieldsStep
                defs={STEP_FIELDS.presence}
                get={get}
                set={set}
                disabled={!canEdit}
              />
              <SocialsStep
                socials={socials}
                getUrl={(id) => socialUrls[id] ?? ''}
                setUrl={(id, url) => setSocialUrls((prev) => ({ ...prev, [id]: url }))}
                disabled={!canEdit}
              />
            </>
          ) : null}

          {step.key === 'competitors' ? (
            <CompetitorsStep
              competitors={competitorRows}
              getName={(id) => competitorEdits[id]?.name ?? ''}
              getDomain={(id) => competitorEdits[id]?.domain ?? ''}
              isTracked={(id) => competitorEdits[id]?.tracked ?? false}
              setName={(id, name) => patchEdit(id, { name })}
              setDomain={(id, domain) => patchEdit(id, { domain })}
              setTracked={(id, tracked) => patchEdit(id, { tracked })}
              newName={newName}
              newDomain={newDomain}
              setNewName={setNewName}
              setNewDomain={setNewDomain}
              addNew={() => {
                setError(null);
                addNewCompetitor().catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong'));
              }}
              disabled={!canEdit}
            />
          ) : null}

          {step.key === 'review' ? (
            <ReviewSummary
              fields={fields}
              socialUrls={socialUrls}
              socials={socials}
              competitorRows={competitorRows}
              competitorEdits={competitorEdits}
            />
          ) : null}

          <FieldError id="onboarding-error" message={error} />

          <div className="flex flex-wrap justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={isFirst || isSaving}
              aria-busy={isSaving}
            >
              Back
            </Button>
            {isLast ? (
              <Button
                type="button"
                onClick={() => router.push('/dashboard')}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                Finish — go to dashboard
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleContinue}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                {isSaving ? 'Saving…' : step.key === 'welcome' ? 'Start' : 'Save & continue'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewSummary({
  fields,
  socialUrls,
  socials,
  competitorRows,
  competitorEdits,
}: {
  fields: Record<string, string | string[]>;
  socialUrls: Record<string, string>;
  socials: SocialProfile[];
  competitorRows: Competitor[];
  competitorEdits: Record<string, { name: string; domain: string; tracked: boolean }>;
}) {
  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: 'Company basics',
      rows: STEP_FIELDS.basics.map((d) => [d.label, renderValue(fields[d.path])]),
    },
    {
      title: 'Offerings',
      rows: STEP_FIELDS.offerings.map((d) => [d.label, renderValue(fields[d.path])]),
    },
    {
      title: 'Customers',
      rows: STEP_FIELDS.customers.map((d) => [d.label, renderValue(fields[d.path])]),
    },
    {
      title: 'Presence',
      rows: [
        ...STEP_FIELDS.presence.map((d) => [d.label, renderValue(fields[d.path])] as [string, string]),
        ...socials.map(
          (s) => [`${s.platform} profile`, socialUrls[s.id] ?? s.url] as [string, string],
        ),
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.title}>
          <h3 className="mb-1 text-sm font-medium">{group.title}</h3>
          <dl className="flex flex-col gap-1 text-sm">
            {group.rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="text-right break-words">{value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <div>
        <h3 className="mb-1 text-sm font-medium">Competitors</h3>
        {competitorRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">None on file.</p>
        ) : (
          <dl className="flex flex-col gap-1 text-sm">
            {competitorRows.map((row) => {
              const edit = competitorEdits[row.id];
              return (
                <div key={row.id} className="flex justify-between gap-4">
                  <dt className="break-words">
                    {edit?.name ?? row.name}
                    {edit?.domain ?? row.domain ? ` (${edit?.domain ?? row.domain})` : ''}
                  </dt>
                  <dd className="shrink-0 text-muted-foreground">
                    {(edit?.tracked ?? row.status === 'tracked') ? 'Tracked' : 'Untracked'}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Everything above is saved. Finishing takes you to your dashboard.
      </p>
    </div>
  );
}

function renderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

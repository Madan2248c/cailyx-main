'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/portal/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Competitor, SocialProfile } from '@/types/onboarding';
import { ListEditor, ScalarRow } from './fields';

export interface ProfileFieldDef {
  path: string;
  label: string;
  hint?: string;
  multiline?: boolean;
  list?: boolean;
}

/** `section.field` paths shown on each profile step, in order. */
export const STEP_FIELDS: Record<'basics' | 'offerings' | 'customers' | 'presence', ProfileFieldDef[]> = {
  basics: [
    { path: 'identity.business_name', label: 'Business name' },
    { path: 'identity.legal_name', label: 'Legal name' },
    { path: 'identity.founded_year', label: 'Founded year' },
    { path: 'identity.primary_domain', label: 'Primary domain' },
    { path: 'geography.headquarters', label: 'Headquarters' },
    { path: 'descriptions.one_line', label: 'One-line description', multiline: true },
    { path: 'descriptions.short', label: 'Short description', multiline: true },
  ],
  offerings: [
    { path: 'offerings.services', label: 'Services', list: true },
    { path: 'offerings.products', label: 'Products', list: true },
    { path: 'offerings.solutions', label: 'Solutions', list: true },
    { path: 'positioning.value_propositions', label: 'Value propositions', list: true },
    { path: 'positioning.differentiators', label: 'Differentiators', list: true },
  ],
  customers: [
    { path: 'customers.icp_summary', label: 'Ideal customer profile', multiline: true },
    { path: 'customers.industries', label: 'Industries', list: true },
    { path: 'customers.buyer_roles', label: 'Buyer roles', list: true },
    { path: 'customers.use_cases', label: 'Use cases', list: true },
    { path: 'customers.named_customers', label: 'Named customers', list: true },
  ],
  presence: [
    { path: 'organization.contact_details', label: 'Contact details', list: true },
    { path: 'geography.service_areas', label: 'Service areas', list: true },
    { path: 'geography.countries', label: 'Countries', list: true },
  ],
};

export interface ProfileStepProps {
  defs: ProfileFieldDef[];
  get: (path: string) => string | string[];
  set: (path: string, value: string | string[] | null) => void;
  disabled: boolean;
}

export function ProfileFieldsStep({ defs, get, set, disabled }: ProfileStepProps) {
  return (
    <div className="flex flex-col gap-4">
      {defs.map((def) => {
        const raw = get(def.path);
        return def.list ? (
          <ListEditor
            key={def.path}
            id={def.path}
            label={def.label}
            hint={def.hint}
            values={Array.isArray(raw) ? raw : []}
            onChange={(values) => set(def.path, values)}
            disabled={disabled}
          />
        ) : (
          <ScalarRow
            key={def.path}
            id={def.path}
            label={def.label}
            hint={def.hint}
            multiline={def.multiline}
            value={typeof raw === 'string' ? raw : ''}
            onChange={(value) => set(def.path, value)}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
}

const STATUS_LABEL: Record<SocialProfile['verificationStatus'], string> = {
  VERIFIED: 'Verified',
  PROBABLE: 'Probable',
  POSSIBLE: 'Needs review',
  REJECTED: 'Rejected',
};

export function SocialsStep({
  socials,
  getUrl,
  setUrl,
  disabled,
}: {
  socials: SocialProfile[];
  getUrl: (id: string) => string;
  setUrl: (id: string, url: string) => void;
  disabled: boolean;
}) {
  if (socials.length === 0) {
    return <p className="text-sm text-muted-foreground">We didn&apos;t find any social profiles for this project.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        We found these profiles. Fix any wrong URLs — a corrected URL goes back to review.
      </p>
      {socials.map((social) => (
        <div key={social.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor={`social-${social.id}`} className="capitalize">
              {social.platform}
            </Label>
            <Badge variant="outline">{STATUS_LABEL[social.verificationStatus]}</Badge>
          </div>
          <Input
            id={`social-${social.id}`}
            value={getUrl(social.id)}
            disabled={disabled}
            onChange={(e) => setUrl(social.id, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

export function CompetitorsStep({
  competitors,
  getName,
  getDomain,
  isTracked,
  setName,
  setDomain,
  setTracked,
  newName,
  newDomain,
  setNewName,
  setNewDomain,
  addNew,
  disabled,
}: {
  competitors: Competitor[];
  getName: (id: string) => string;
  getDomain: (id: string) => string;
  isTracked: (id: string) => boolean;
  setName: (id: string, name: string) => void;
  setDomain: (id: string, domain: string) => void;
  setTracked: (id: string, tracked: boolean) => void;
  newName: string;
  newDomain: string;
  setNewName: (value: string) => void;
  setNewDomain: (value: string) => void;
  addNew: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        These are the rivals we spotted. Confirm the ones that matter, untrack the ones that
        don&apos;t, fix names, and add any we missed.
      </p>
      {competitors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No competitors on file yet — add the first one below.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {competitors.map((competitor) => (
            <li key={competitor.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  id={`track-${competitor.id}`}
                  className="size-6 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  checked={isTracked(competitor.id)}
                  disabled={disabled}
                  onChange={(e) => setTracked(competitor.id, e.target.checked)}
                />
                <Label htmlFor={`track-${competitor.id}`} className="min-h-11 flex-1">
                  {getName(competitor.id) || competitor.name} —{' '}
                  {isTracked(competitor.id) ? 'Tracked' : 'Untracked'}
                </Label>
                <Badge variant="outline" className="ml-auto shrink-0 capitalize">
                  {competitor.source.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`competitor-name-${competitor.id}`}>Competitor name</Label>
                <Input
                  id={`competitor-name-${competitor.id}`}
                  value={getName(competitor.id)}
                  disabled={disabled}
                  onChange={(e) => setName(competitor.id, e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`competitor-domain-${competitor.id}`}>Domain (optional)</Label>
                <Input
                  id={`competitor-domain-${competitor.id}`}
                  placeholder="example.com"
                  value={getDomain(competitor.id)}
                  disabled={disabled}
                  onChange={(e) => setDomain(competitor.id, e.target.value)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!disabled ? (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
          <legend className="px-1 text-sm font-medium">Add a missing competitor</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-competitor-name">Name</Label>
              <Input
                id="new-competitor-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-competitor-domain">Domain (optional)</Label>
              <Input
                id="new-competitor-domain"
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={addNew}
              disabled={newName.trim() === ''}
              className="sm:self-end"
            >
              Add
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

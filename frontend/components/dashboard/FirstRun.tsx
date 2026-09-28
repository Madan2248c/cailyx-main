'use client';

import { Check, Clock } from 'lucide-react';
import { PageHeader, PortalPage, Tile, TileHeader } from '@/components/portal/layout';
import { OrbitArt } from '@/components/portal/states';
import { RotatingText, RotatingTextContainer } from '@/components/animate-ui/primitives/texts/rotating';

export interface FirstRunStep {
  label: string;
  /** What it tells the client, in one short line. */
  detail: string;
  done: boolean;
}

/**
 * The dashboard before any results exist. One calm "here's what's happening"
 * view instead of a grid of empty tiles, so a new client knows the product
 * is working and what they will see next.
 */
export function FirstRun({
  projectName,
  projectDomain,
  steps,
}: {
  projectName: string;
  projectDomain: string;
  steps: FirstRunStep[];
}) {
  const done = steps.filter((s) => s.done).length;
  return (
    <PortalPage>
      <PageHeader
        eyebrow="Welcome"
        title={projectName}
        meta={<span>{projectDomain}</span>}
        summary="We're running your first checks. Results appear on this page as each one finishes, so there's nothing you need to do yet."
      />

      <div className="grid gap-4 md:grid-cols-5">
        <Tile ink index={1} className="justify-between gap-6 p-6 md:col-span-2">
          <TileHeader eyebrow="Getting started" />
          <div className="flex flex-col items-center gap-3">
            <OrbitArt className="h-28 w-40 text-white" />
            <RotatingTextContainer
              text={steps.filter((s) => !s.done).map((s) => `Checking ${s.label.toLowerCase()}…`)}
              duration={2600}
              className="h-6 overflow-hidden py-0.5 text-sm leading-5 text-white/75"
              aria-live="off"
            >
              <RotatingText />
            </RotatingTextContainer>
          </div>
          <div className="flex flex-col gap-1">
            <p className="g-num text-4xl font-semibold text-white">
              {done}
              <span className="text-lg font-normal text-white/60"> of {steps.length}</span>
            </p>
            <p className="text-sm text-white/70">first checks finished</p>
          </div>
        </Tile>

        <Tile index={2} className="md:col-span-3">
          <TileHeader eyebrow="What we're checking" />
          <ol className="flex flex-col">
            {steps.map((step, i) => (
              <li key={step.label} className="flex gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
                <span
                  className={
                    step.done
                      ? 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success'
                      : 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
                  }
                  aria-hidden
                >
                  {step.done ? <Check className="size-3.5" /> : <span className="g-num text-xs font-semibold">{i + 1}</span>}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {step.label}
                    {step.done ? (
                      <span className="text-xs font-medium text-success">Ready</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Clock className="size-3" aria-hidden /> In progress
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Tile>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Questions while you wait? Your Rothenhall lead is happy to walk you through it.
      </p>
    </PortalPage>
  );
}

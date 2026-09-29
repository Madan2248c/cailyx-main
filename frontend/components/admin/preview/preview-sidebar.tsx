'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeftRight, EyeOff } from 'lucide-react';
import { cn } from 'cn';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Highlight, HighlightItem } from '@/components/animate-ui/primitives/effects/highlight';
import { useAdminPreview } from '@/components/admin/preview/preview-context';
import { CailyxLockup, RothenhallCredit } from '@/components/brand/brand';
import { projectNav, visibleNav, type NavItem } from '@/components/client/nav';
import { Monogram } from '@/components/admin/admin-ui';
import { Button } from '@/components/portal/button';
import { useFixSummary } from '@/components/remediation/use-fix-summary';
import type { Project } from '@/types/project';

function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}

/**
 * The client's own menu, rebuilt for the preview. It shows the same pages in
 * the same order (from the shared `projectNav`). With admin controls on, each
 * switchable page also gets an on/off switch: that is how you turn a feature
 * off for this client. With controls off it hides what the client can't see.
 */
export function PreviewSidebar({ project }: { project: Project }) {
  const preview = useAdminPreview();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const fixSummary = useFixSummary(preview?.accessToken ?? null, preview?.clientId ?? '', project.id);
  if (!preview) return null;

  const { clientId, controls, features, setFeatureEnabled } = preview;
  const base = `/admin/preview/${clientId}/projects/${project.id}`;
  const badge = fixSummary ? fixSummary.awaitingDecision + fixSummary.regressed : 0;
  const enabled = (key: NonNullable<NavItem['feature']>) => features?.[key] ?? true;
  const sections = controls ? projectNav(base, badge) : visibleNav(projectNav(base, badge), enabled);

  return (
    <aside className="flex w-full flex-col gap-4 border-b border-border bg-sidebar p-4 md:sticky md:top-[2.9rem] md:h-[calc(100vh-2.9rem)] md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-center justify-between gap-2 pt-1">
        <Link
          href={`/admin/preview/${clientId}`}
          aria-label="Choose another project"
          className="flex items-center gap-2 rounded px-2 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <CailyxLockup />
        </Link>
        <Button type="button" variant="outline" size="sm" className="md:hidden" aria-expanded={mobileOpen} onClick={() => setMobileOpen((v) => !v)}>
          {mobileOpen ? 'Close menu' : 'Menu'}
        </Button>
      </div>

      <Link
        href={`/admin/preview/${clientId}`}
        title="Switch project"
        className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 p-2 outline-none transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Monogram name={project.name} className="size-8 bg-background shadow-sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{project.name}</span>
          <span className="truncate text-xs text-muted-foreground">{project.domain}</span>
        </span>
        <ArrowLeftRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </Link>

      <nav aria-label="Project" className={cn('flex-col gap-4 md:flex', mobileOpen ? 'flex' : 'hidden')}>
        <Highlight controlledItems hover click={false} mode="children" className="inset-0 rounded-lg bg-muted" transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.label} className="flex flex-col gap-0.5">
                {section.label ? <p className="g-eyebrow px-2 pb-1">{section.label}</p> : null}
                {section.items.map((item) => {
                  const off = item.feature ? !enabled(item.feature) : false;
                  const active = isActive(pathname, item);
                  return (
                    <HighlightItem key={item.href + item.label} value={item.href}>
                      <div className={cn('flex items-center gap-1', item.indent && 'ml-[15px] border-l border-border pl-2')}>
                        <AnimateIcon animateOnHover asChild>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'relative flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
                              active
                                ? 'bg-accent font-medium text-foreground before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[3px] before:rounded-full before:bg-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                              off && 'opacity-60',
                            )}
                          >
                            <item.icon aria-hidden="true" size={16} className="size-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                            {off ? <EyeOff aria-label="Hidden from the client" className="ml-auto size-3.5 shrink-0" /> : null}
                            {!off && item.badge ? (
                              <span className="g-num ml-auto rounded-full px-1.5 py-px text-xs font-semibold text-warning" style={{ background: 'var(--warning-soft)' }}>
                                {item.badge}
                              </span>
                            ) : null}
                          </Link>
                        </AnimateIcon>
                        {controls && item.feature ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!off}
                            aria-label={`${item.label}: ${off ? 'off' : 'on'} for the client`}
                            title={off ? 'Hidden from the client. Click to switch on.' : 'Visible to the client. Click to hide.'}
                            disabled={features === null}
                            onClick={() => void setFeatureEnabled(item.feature!, off)}
                            className="flex h-6 w-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
                          >
                            <span aria-hidden className={cn('relative h-4 w-7 rounded-full transition-colors duration-150 motion-reduce:transition-none', off ? 'bg-border' : 'bg-success')}>
                              <span className={cn('absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none', !off && 'translate-x-3')} />
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </HighlightItem>
                  );
                })}
              </div>
            ))}
          </div>
        </Highlight>
        {controls ? (
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">
            The switches next to each page turn it on or off for {preview.client?.name ?? 'this client'}. Off pages disappear from their menu.
          </p>
        ) : null}
      </nav>

      <div className={cn('flex-col gap-3 border-t border-border pt-3 md:mt-auto md:flex', mobileOpen ? 'flex' : 'hidden')}>
        <RothenhallCredit />
      </div>
    </aside>
  );
}

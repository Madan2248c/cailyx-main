'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import { AiTab } from '@/components/ai/AiTab';
import { OrganicPreview } from '@/components/admin/preview/organic-preview';
import { AdminPanel } from '@/components/admin/preview/admin-panel';
import {
  AiPanel,
  CompetitorsPanel,
  DashboardPanel,
  DataPanel,
  FeatureSwitchesPanel,
  FixPlanPanel,
  ReportsPanel,
  SocialPanel,
  TechnicalPanel,
} from '@/components/admin/preview/panels';
import { useAdminControls, useAdminPreview } from '@/components/admin/preview/preview-context';
import { usePreviewProject } from '@/components/admin/preview/project-context';
import { SectionErrorBoundary } from '@/components/admin/preview/section-error-boundary';
import { BacklinksSection } from '@/components/backlinks/BacklinksSection';
import { CompetitorsTab } from '@/components/competitors/CompetitorsTab';
import { DashboardTab } from '@/components/dashboard/DashboardTab';
import { KeywordsSection } from '@/components/keywords/KeywordsSection';
import { OverviewTab } from '@/components/overview/OverviewTab';
import { TechnicalTab } from '@/components/performance/TechnicalTab';
import { Button } from '@/components/portal/button';
import { PortalPage, Tile } from '@/components/portal/layout';
import { EmptyState } from '@/components/portal/states';
import { FixDetail } from '@/components/remediation/FixDetail';
import { FixPlanTab } from '@/components/remediation/FixPlanTab';
import { ReportsTab } from '@/components/reports/ReportsTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { SocialTab } from '@/components/social/SocialTab';
import { FEATURES, featureForPath } from '@/lib/features-api';

/**
 * Every page of the client's portal, served under the preview. The tab
 * components are the very ones the client sees; the yellow admin panel above
 * each is the only addition. Changing `version` (after any admin action)
 * remounts the tab so it fetches what the action just changed.
 */
export default function PreviewTabPage() {
  const { clientId, tab } = useParams<{ clientId: string; tab?: string[] }>();
  const focus = useSearchParams().get('focus');
  const project = usePreviewProject();
  const preview = useAdminPreview();
  const controls = useAdminControls();
  if (!preview) return null;

  const { accessToken, version, features } = preview;
  const path = (tab ?? []).join('/');
  const common = { accessToken, clientId, projectId: project.id, projectName: project.name };

  const feature = featureForPath(path);
  const off = feature !== null && features !== null && features[feature] === false;

  // With admin controls off the preview is exactly the client's view, so a
  // switched-off section shows what the client would see: nothing.
  if (off && !controls) {
    return (
      <PortalPage>
        <Tile>
          <EmptyState
            title="This section isn't switched on for the account"
            body="This is what the client sees if they open it. Turn admin controls back on to switch it on."
          />
        </Tile>
      </PortalPage>
    );
  }

  let panel: ReactNode = null;
  let content: ReactNode;

  const planMatch = path.match(/^plan\/([^/]+)$/);

  if (path === '') {
    panel = <DashboardPanel project={project} />;
    content = <DashboardTab {...common} projectDomain={project.domain} />;
  } else if (path === 'plan') {
    panel = <FixPlanPanel project={project} />;
    content = <FixPlanTab {...common} projectDomain={project.domain} canDecide focusGroup={focus} />;
  } else if (planMatch) {
    content = <FixDetail accessToken={accessToken} clientId={clientId} projectId={project.id} fixId={planMatch[1]} canDecide />;
  } else if (path === 'reports') {
    panel = <ReportsPanel project={project} />;
    content = <ReportsTab {...common} />;
  } else if (path === 'performance') {
    content = <OverviewTab {...common} />;
  } else if (path === 'performance/technical') {
    panel = <TechnicalPanel project={project} />;
    content = <TechnicalTab {...common} />;
  } else if (path === 'performance/visibility/organic') {
    content = <OrganicPreview {...common} projectDomain={project.domain} />;
  } else if (path === 'performance/visibility/ai') {
    panel = <AiPanel project={project} />;
    content = <AiTab {...common} />;
  } else if (path === 'performance/social') {
    panel = <SocialPanel project={project} />;
    content = <SocialTab {...common} />;
  } else if (path === 'competitors') {
    panel = <CompetitorsPanel project={project} />;
    content = <CompetitorsTab {...common} canEdit />;
  } else if (path === 'competitors/backlinks') {
    panel = <DataPanel kind="backlinks" project={project} />;
    content = <BacklinksSection {...common} />;
  } else if (path === 'keywords') {
    panel = <DataPanel kind="keywords" project={project} />;
    content = <KeywordsSection {...common} />;
  } else if (path === 'settings') {
    panel = <FeatureSwitchesPanel />;
    content = <SettingsTab accessToken={accessToken} clientId={clientId} project={project} />;
  } else if (path === 'team') {
    content = (
      <PortalPage>
        <Tile>
          <EmptyState
            title="Team management is the client's own screen"
            body="Their contact invites and manages their own people there. To change their seat limit or suspend the account, use the client page in the admin console."
          />
          <div className="mb-6 flex justify-center">
            <Button variant="outline" nativeButton={false} render={<Link href={`/admin/clients/${clientId}`}>Open the client page</Link>} />
          </div>
        </Tile>
      </PortalPage>
    );
  } else {
    content = (
      <PortalPage>
        <Tile>
          <EmptyState title="Page not found" body="There is no such page in the client's portal." />
        </Tile>
      </PortalPage>
    );
  }

  return (
    <>
      {off && feature ? <HiddenNotice featureKey={feature} /> : null}
      {panel}
      <SectionErrorBoundary key={path} label="This page">
        <Fragment key={`${path}:${version}`}>{content}</Fragment>
      </SectionErrorBoundary>
    </>
  );
}

/** Shown to the admin above a page the client cannot currently open. */
function HiddenNotice({ featureKey }: { featureKey: (typeof FEATURES)[number]['key'] }) {
  const admin = useAdminControls();
  if (!admin) return null;
  const label = FEATURES.find((f) => f.key === featureKey)?.label ?? 'This section';
  return (
    <AdminPanel title="Hidden from the client" description={`${label} is switched off for ${admin.client?.name ?? 'this client'}. They can't see it or open its link. You can still work on it here.`}>
      <div className="py-2.5">
        <Button size="sm" className="bg-[#3a2f00] text-[#fdd34d] hover:bg-[#3a2f00]" onClick={() => void admin.setFeatureEnabled(featureKey, true)}>
          Switch on for the client
        </Button>
      </div>
    </AdminPanel>
  );
}

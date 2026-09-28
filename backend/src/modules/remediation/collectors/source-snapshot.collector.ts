/**
 * Source-snapshot collector — reads the latest completed run of every source
 * module through that module's own exported service (never its tables), plus
 * the confirmed company facts from Discovery and the latest Gap Analysis run,
 * and folds them into one `SourceSnapshot` every handler reads.
 *
 * A missing source is not an error: the snapshot simply has `null` for it.
 *
 * @module remediation/collectors/source-snapshot.collector
 */

import { Injectable } from '@nestjs/common';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import type { AeoVerdict } from '../../aeo-audit/aeo-audit.types.js';
import type { CompanyContextProfileJson, FactValue } from '../../discovery/discovery.types.js';
import { DiscoveryService } from '../../discovery/services/discovery.service.js';
import { GapAnalysisService } from '../../gap-analysis/services/gap-analysis.service.js';
import { SocialActivityService } from '../../social-activity/services/social-activity.service.js';
import type { SocialActivityFinding } from '../../social-activity/social-activity.types.js';
import { TechnicalAuditService } from '../../technical-audit/services/technical-audit.service.js';
import type { AuditFinding, PageIssueCode } from '../../technical-audit/technical-audit.types.js';
import type { CompanyFacts, SnapshotPage, SourceSnapshot } from '../remediation.types.js';

export interface SnapshotProject {
  id: string;
  clientId: string;
  name: string;
  domain: string;
}

@Injectable()
export class SourceSnapshotCollector {
  constructor(
    private readonly technicalAudit: TechnicalAuditService,
    private readonly socialActivity: SocialActivityService,
    private readonly aeoAudit: AeoAuditService,
    private readonly discovery: DiscoveryService,
    private readonly gapAnalysis: GapAnalysisService,
  ) {}

  async collect(project: SnapshotProject): Promise<SourceSnapshot> {
    const siteUrl = siteOrigin(project.domain);
    const [technicalAudit, socialActivity, aeoAudit, company, gapAnalysis] = await Promise.all([
      this.collectTechnicalAudit(project),
      this.collectSocialActivity(project),
      this.collectAeoAudit(project),
      this.companyFacts(project, siteUrl),
      this.collectGapAnalysis(project),
    ]);
    return {
      clientId: project.clientId,
      projectId: project.id,
      projectName: project.name,
      siteUrl,
      technicalAudit,
      socialActivity,
      aeoAudit,
      company,
      gapAnalysis,
    };
  }

  private async collectTechnicalAudit(project: SnapshotProject): Promise<SourceSnapshot['technicalAudit']> {
    const runs = await this.technicalAudit.listRuns(project.clientId, project.id);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;
    const full = await this.technicalAudit.getRun(project.clientId, latest.id);
    const pages: SnapshotPage[] = full.pages.map((p) => ({
      url: p.url,
      statusCode: p.statusCode,
      score: p.score,
      issues: (Array.isArray(p.issues) ? p.issues : []) as PageIssueCode[],
      signals: (p.signals && typeof p.signals === 'object' ? p.signals : {}) as SnapshotPage['signals'],
    }));
    return {
      runId: latest.id,
      completedAt: latest.completedAt ?? latest.createdAt,
      findings: (latest.findings as unknown as AuditFinding[]) ?? [],
      pages,
    };
  }

  private async collectSocialActivity(project: SnapshotProject): Promise<SourceSnapshot['socialActivity']> {
    const runs = await this.socialActivity.listRuns(project.clientId, project.id);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;
    return {
      runId: latest.id,
      completedAt: latest.completedAt ?? latest.createdAt,
      findings: (latest.findings as unknown as SocialActivityFinding[]) ?? [],
    };
  }

  private async collectAeoAudit(project: SnapshotProject): Promise<SourceSnapshot['aeoAudit']> {
    const audits = await this.aeoAudit.list(project.clientId, project.id);
    const latest = audits.find((a) => a.status === 'completed');
    if (!latest) return null;
    const verdict = (await this.aeoAudit.getVerdict(project.clientId, latest.id)) as AeoVerdict;
    return {
      runId: latest.id,
      completedAt: latest.finishedAt ?? latest.createdAt,
      headlines: verdict.headlines ?? [],
      losingPrompts: verdict.judged?.losingPrompts ?? [],
      winningPrompts: (verdict.judged?.winningPrompts ?? []).map((p) => p.prompt),
    };
  }

  /** Confirmed company facts only (Discovery `supported` values + VERIFIED social profiles). */
  async companyFacts(project: SnapshotProject, siteUrl: string = siteOrigin(project.domain)): Promise<CompanyFacts | null> {
    const [latest, socials] = await Promise.all([
      this.discovery.latestProfile(project.clientId, project.id),
      this.discovery.listSocialProfiles(project.clientId, project.id),
    ]);
    if (!latest) return null;
    const profile = latest.profile as unknown as Partial<CompanyContextProfileJson>;
    const offerings = [...values(profile.offerings?.products), ...values(profile.offerings?.services)];
    return {
      name: value(profile.identity?.business_name) ?? null,
      url: siteUrl,
      description: value(profile.descriptions?.short) ?? value(profile.descriptions?.one_line) ?? null,
      logoUrl: value(profile.identity?.logo_url) ?? null,
      sameAs: socials.filter((s) => s.verificationStatus === 'VERIFIED').map((s) => s.url),
      offerings: [...new Set(offerings)],
    };
  }

  private async collectGapAnalysis(project: SnapshotProject): Promise<SourceSnapshot['gapAnalysis']> {
    const runs = await this.gapAnalysis.listRuns(project.clientId, project.id);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;
    const run = await this.gapAnalysis.getRun(project.clientId, latest.id);
    return {
      runId: run.id,
      recommendations: run.recommendations.map((r) => ({
        id: r.id,
        sourceFindings: (Array.isArray(r.sourceFindings) ? r.sourceFindings : []) as Array<{ module: string; findingRef: string }>,
      })),
    };
  }
}

/** `example.com` / `https://example.com/` → `https://example.com`. */
export function siteOrigin(domain: string): string {
  const withScheme = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return withScheme.replace(/\/+$/, '');
  }
}

/** Only supported facts are used — an unverified or stale value is not a confirmed fact. */
function value(field: FactValue | null | undefined): string | undefined {
  return field && field.status === 'supported' && field.value?.trim() ? field.value.trim() : undefined;
}

function values(field: FactValue[] | null | undefined): string[] {
  return (field ?? []).map((f) => value(f)).filter((v): v is string => !!v);
}

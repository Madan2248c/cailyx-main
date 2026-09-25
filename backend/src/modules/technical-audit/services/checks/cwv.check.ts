/**
 * Core Web Vitals check — a thin wrapper around `PsiService`, rating LCP/
 * CLS/INP against Google's own published bands and turning the result into
 * an `AuditFinding`.
 *
 * Ported from the old repo's `technical-audit.service.ts`
 * `checkCoreWebVitals` wrapper. Deliberately no try/catch here: the old code
 * had no dedicated `not-run` path for a missing `PSI_API_KEY` (unlike the
 * sitemap and agent-readiness checks) — a thrown error from the PSI call
 * propagates and is caught by the orchestrator's generic per-check wrapper,
 * which turns it into an `error`-status finding. Reproducing that means
 * letting `PsiService.fetchPsi`'s throw pass through unhandled.
 *
 * @module technical-audit/services/checks/cwv
 */

import { Injectable } from '@nestjs/common';
import { CWV_BANDS } from '../../technical-audit.constants.js';
import type { AuditFinding, CwvAnalysis } from '../../technical-audit.types.js';
import type { AuditContext } from '../audit-context.js';
import { PsiService } from '../psi.service.js';

type Rating = 'good' | 'needs-improvement' | 'poor';

@Injectable()
export class CwvCheck {
  constructor(private readonly psi: PsiService) {}

  async run(ctx: AuditContext): Promise<AuditFinding> {
    const psi = await this.psi.fetchPsi(ctx.targetUrl);

    const lcpStatus = this.rate(psi.lcp, CWV_BANDS.lcp);
    const clsStatus = this.rate(psi.cls, CWV_BANDS.cls);
    const inpStatus = this.rate(psi.inp, CWV_BANDS.inp);

    const hasPoorMetric = [lcpStatus, clsStatus, inpStatus].includes('poor');
    const hasNeedsImprovement = [lcpStatus, clsStatus, inpStatus].includes('needs-improvement');

    const analysis: CwvAnalysis = {
      lcp: psi.lcp,
      cls: psi.cls,
      inp: psi.inp,
      performanceScore: psi.performanceScore,
      lcpStatus,
      clsStatus,
      inpStatus,
      categories: psi.categories,
      failedAudits: psi.failedAudits,
      fieldData: psi.fieldData,
      finalUrl: psi.finalUrl,
      lighthouseVersion: psi.lighthouseVersion,
    };

    return {
      type: 'cwv',
      status: hasPoorMetric || hasNeedsImprovement ? 'fail' : 'pass',
      severity: hasPoorMetric ? 'high' : hasNeedsImprovement ? 'medium' : 'low',
      confidence: 'confirmed',
      recommendedFix: this.recommendedFix(analysis),
      detail: { ...analysis },
    };
  }

  /** Inclusive `<=` at each tier — a value exactly on the boundary rates the better band. */
  private rate(value: number, band: { good: number; needsImprovement: number }): Rating {
    if (value <= band.good) return 'good';
    if (value <= band.needsImprovement) return 'needs-improvement';
    return 'poor';
  }

  private recommendedFix(a: CwvAnalysis): string {
    const failingMetrics: string[] = [];
    if (a.lcpStatus !== 'good') failingMetrics.push(`LCP: ${a.lcp}ms (${a.lcpStatus})`);
    if (a.clsStatus !== 'good') failingMetrics.push(`CLS: ${a.cls} (${a.clsStatus})`);
    if (a.inpStatus !== 'good') failingMetrics.push(`INP: ${a.inp}ms (${a.inpStatus})`);

    if ([a.lcpStatus, a.clsStatus, a.inpStatus].includes('poor')) {
      return `Core Web Vitals are poor: ${failingMetrics.join(', ')}. These affect both Google search rankings and AI crawler experience. Prioritize: optimize images and fonts for LCP, prevent layout shifts for CLS, reduce JS execution time for INP.`;
    }
    if (failingMetrics.length > 0) {
      return `Core Web Vitals need improvement: ${failingMetrics.join(', ')}. Not critical but should be addressed for optimal crawl performance.`;
    }
    return 'Core Web Vitals are all good. The site performs well for both users and crawlers.';
  }
}

/**
 * PSI Service — Google PageSpeed Insights API v5 integration.
 *
 * Calls the PSI API for Core Web Vitals (LCP, CLS, INP) AND the full
 * Lighthouse result: every requested category's score, every non-passing
 * audit, and CrUX field data when Google has enough real-user traffic for the
 * origin.
 *
 * The explicit `category` parameters below matter: PSI v5 returns ONLY the
 * performance category when none are given — the SEO, accessibility and
 * best-practices audits simply are not in the response. Asking for all four
 * costs nothing extra (one Lighthouse run either way) and is the difference
 * between 4 numbers and ~150 audits.
 *
 * Ported from the old repo's `fetcher/adapters/psi.adapter.ts` — logic and
 * comments kept verbatim, with one normalization: the old adapter read
 * `PSI_API_KEY` directly from `process.env`, bypassing `ConfigService`
 * (inconsistent with every other env var in this codebase, including
 * Discovery's own). Read through `ConfigService` here.
 *
 * Requires `PSI_API_KEY` (free tier: 25,000 requests/day).
 *
 * @module technical-audit/services/psi
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** One non-passing Lighthouse audit, flattened for storage and display. */
export interface PsiFailedAudit {
  id: string;
  title: string;
  /** Which category surfaced it — performance | seo | accessibility | best-practices. */
  category: string;
  /** 0-1 as Lighthouse scores it. Null for informational audits. */
  score: number | null;
  description: string;
  /** e.g. "Potential savings of 320 ms". Empty when the audit has no headline value. */
  displayValue: string;
}

export interface PsiResult {
  url: string;
  /** -1 sentinel means "not measured" (the audit was absent or had no numericValue). */
  lcp: number;
  cls: number;
  inp: number;
  performanceScore: number;
  /** Every Lighthouse category PSI was asked for, 0-100. */
  categories: Record<string, number>;
  failedAudits: PsiFailedAudit[];
  /** CrUX real-user data. Null for origins below Google's reporting threshold — normal, not an error. */
  fieldData: Record<string, { percentile: number; category: string }> | null;
  /** The URL Lighthouse actually measured after redirects. */
  finalUrl: string | null;
  lighthouseVersion: string | null;
  raw: unknown;
}

/** The slice of PSI's raw response shape this service actually reads. */
interface LighthouseAudit {
  numericValue?: number;
  score?: number | null;
  title?: string;
  description?: string;
  displayValue?: string;
}
interface LighthouseCategory {
  score?: number;
  auditRefs?: Array<{ id: string }>;
}
interface PsiResponseBody {
  lighthouseResult?: {
    audits?: Record<string, LighthouseAudit>;
    categories?: Record<string, LighthouseCategory>;
    finalUrl?: string;
    lighthouseVersion?: string;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number; category?: string }>;
  };
  error?: { message?: string };
}

@Injectable()
export class PsiService {
  private readonly logger = new Logger(PsiService.name);
  private readonly baseUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

  constructor(private readonly config: ConfigService) {}

  /**
   * Query the PSI API for a URL's Core Web Vitals and performance score.
   * @throws Error if the API key is not configured or the API call fails.
   */
  async fetchPsi(url: string): Promise<PsiResult> {
    const apiKey = this.config.get<string>('PSI_API_KEY');
    if (!apiKey) {
      throw new Error('PSI_API_KEY not configured. Cannot fetch Core Web Vitals');
    }

    // Repeated `category` keys — axios serialises an array to
    // `category=performance&category=seo&...`, which is the form PSI expects.
    const params = {
      strategy: 'mobile',
      url,
      key: apiKey,
      category: ['performance', 'seo', 'accessibility', 'best-practices'],
    };

    this.logger.debug(`PSI API call for ${url}`);
    const startTime = performance.now();

    const response = await axios.get<PsiResponseBody>(this.baseUrl, {
      params,
      timeout: 60_000, // PSI can be slow
      validateStatus: () => true,
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (response.status !== 200) {
      const errMsg = response.data?.error?.message || `HTTP ${response.status}`;
      this.logger.warn(`PSI API failed for ${url}: ${errMsg}`);
      throw new Error(`PSI API error: ${errMsg}`);
    }

    const lighthouse = response.data?.lighthouseResult;
    if (!lighthouse) {
      throw new Error('PSI API returned no lighthouse result');
    }

    const audits = lighthouse.audits ?? {};
    const categories = lighthouse.categories ?? {};

    const result: PsiResult = {
      url,
      lcp: this.extractNumeric(audits, 'largest-contentful-paint'),
      cls: this.extractNumeric(audits, 'cumulative-layout-shift'),
      inp: this.extractNumeric(audits, 'interaction-to-next-paint'),
      performanceScore: Math.round((categories.performance?.score ?? 0) * 100),
      categories: this.extractCategories(categories),
      failedAudits: this.extractFailedAudits(categories, audits),
      fieldData: this.extractFieldData(response.data?.loadingExperience),
      finalUrl: lighthouse.finalUrl ?? null,
      lighthouseVersion: lighthouse.lighthouseVersion ?? null,
      raw: response.data,
    };

    this.logger.log(
      `PSI result for ${url}: ` +
        Object.entries(result.categories)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ') +
        ` LCP=${result.lcp}ms CLS=${result.cls} INP=${result.inp}ms ` +
        `${result.failedAudits.length} failing audits (${latencyMs}ms)`,
    );

    return result;
  }

  /**
   * Extract a numeric value from a Lighthouse audit. All CWV metrics (LCP,
   * CLS, INP) use `numericValue` — never fall back to `score`, which is a 0-1
   * pass/fail rating, not the actual metric value.
   */
  private extractNumeric(audits: Record<string, LighthouseAudit>, auditKey: string): number {
    const audit = audits[auditKey];
    if (!audit) return -1;
    if (typeof audit.numericValue === 'number') {
      return Math.round(audit.numericValue * 1000) / 1000; // Round CLS to 3 decimals, LCP/INP to ms
    }
    return -1;
  }

  /** Category scores as whole numbers, 0-100. */
  private extractCategories(categories: Record<string, LighthouseCategory>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, cat] of Object.entries(categories)) {
      if (cat && typeof cat.score === 'number') out[key] = Math.round(cat.score * 100);
    }
    return out;
  }

  /**
   * Flatten every non-passing audit across the requested categories.
   *
   * Lighthouse scores an audit 0-1, with null meaning "informational, not
   * scored". Only genuinely scored audits below 1 are failures — treating
   * null as a failure would report a wall of notices as problems.
   */
  private extractFailedAudits(
    categories: Record<string, LighthouseCategory>,
    audits: Record<string, LighthouseAudit>,
  ): PsiFailedAudit[] {
    const out: PsiFailedAudit[] = [];
    const seen = new Set<string>();

    for (const [categoryKey, cat] of Object.entries(categories)) {
      for (const ref of cat?.auditRefs ?? []) {
        const a = audits[ref.id];
        if (!a || typeof a.score !== 'number' || a.score >= 1) continue;
        if (seen.has(ref.id)) continue;
        seen.add(ref.id);
        out.push({
          id: ref.id,
          title: a.title ?? ref.id,
          category: categoryKey,
          score: a.score,
          description: this.stripLinks(a.description ?? ''),
          displayValue: a.displayValue ?? '',
        });
      }
    }

    // Worst first, so a truncated render still shows what matters.
    return out.sort((x, y) => (x.score ?? 1) - (y.score ?? 1));
  }

  /**
   * Lighthouse descriptions are markdown with trailing doc links. Strip the
   * links so the text is renderable anywhere without a markdown parser.
   */
  private stripLinks(md: string): string {
    return md
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * CrUX field data — real users, not the lab run. Absent for low-traffic
   * origins, which is normal and not an error.
   */
  private extractFieldData(
    loadingExperience: PsiResponseBody['loadingExperience'],
  ): Record<string, { percentile: number; category: string }> | null {
    const metrics = loadingExperience?.metrics;
    if (!metrics || typeof metrics !== 'object') return null;
    const out: Record<string, { percentile: number; category: string }> = {};
    for (const [key, m] of Object.entries(metrics)) {
      if (typeof m?.percentile === 'number') {
        out[key] = { percentile: m.percentile, category: m.category ?? 'UNKNOWN' };
      }
    }
    return Object.keys(out).length ? out : null;
  }
}

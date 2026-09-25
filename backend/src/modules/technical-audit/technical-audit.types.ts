/**
 * Technical Audit types — the data model for one run's findings.
 *
 * Ported closely from the old repo's `technical-audit.types.ts`, which the
 * module's own briefing calls "the clearest map of the whole data model."
 * Field names and shapes are kept as close to the original as our
 * conventions allow (camelCase already matched). See
 * docs/analysis/technical-audit.md for the full design.
 *
 * @module technical-audit/technical-audit.types
 */

// ─── Findings ───────────────────────────────────────────────────────────────

export type AuditCheckType =
  | 'robots'
  | 'cdn-inferred'
  | 'js-render'
  | 'cwv'
  | 'schema'
  | 'sitemap'
  | 'agent-readiness'
  | 'page-inventory';

export type AuditStatus = 'pass' | 'fail' | 'error' | 'not-run';
export type Severity = 'low' | 'medium' | 'high';
export type Confidence = 'confirmed' | 'inferred';

/** Which layer a block was detected at. */
export type BlockLayer = 'robots.txt' | 'cdn-waf' | 'none';

export interface ReproductionCommand {
  bot: string;
  command: string;
  expectedResult: string;
}

export interface AuditFinding {
  type: AuditCheckType;
  status: AuditStatus;
  detail: Record<string, unknown>;
  severity: Severity;
  confidence: Confidence;
  recommendedFix: string;
  reproductionCommands?: ReproductionCommand[];
}

// ─── Robots.txt analysis ────────────────────────────────────────────────────

export interface RobotsRule {
  botName: string;
  disallowed: boolean;
  paths: string[];
  layer: BlockLayer;
}

export interface RobotsAnalysis {
  robotsTxtFound: boolean;
  statusCode: number;
  rules: RobotsRule[];
  missingRobotsTxt: boolean;
  rawContent: string;
}

// ─── CDN probe analysis ─────────────────────────────────────────────────────

export interface CdnProbeResult {
  botName: string;
  category: string;
  status: number;
  blocked: boolean;
  latencyMs: number;
  inconsistent: boolean;
  layer: BlockLayer;
}

export interface CdnAnalysis {
  cdnVendor: string | null;
  detectedFromHeaders: string[];
  probes: CdnProbeResult[];
  browserControlStatus: number;
  silentBlockDetected: boolean;
  blockedBots: string[];
}

// ─── JS-render analysis ─────────────────────────────────────────────────────

export interface JsRenderAnalysis {
  serverRenderedText: string;
  jsRenderedText: string;
  textLengthWithoutJs: number;
  textLengthWithJs: number;
  isJsDependent: boolean;
  contentLossPercent: number;
  titleWithoutJs: string;
  titleWithJs: string;
}

// ─── Core Web Vitals analysis ───────────────────────────────────────────────

export interface CwvAnalysis {
  lcp: number;
  cls: number;
  inp: number;
  performanceScore: number;
  lcpStatus: 'good' | 'needs-improvement' | 'poor';
  clsStatus: 'good' | 'needs-improvement' | 'poor';
  inpStatus: 'good' | 'needs-improvement' | 'poor';

  /** Every requested category, 0-100: performance, seo, accessibility, best-practices. */
  categories: Record<string, number>;
  /** Non-passing audits across all categories, worst score first. */
  failedAudits: Array<{
    id: string;
    title: string;
    category: string;
    score: number | null;
    description: string;
    displayValue: string;
  }>;
  /** CrUX real-user data. Null for origins below Google's reporting threshold. */
  fieldData: Record<string, { percentile: number; category: string }> | null;
  finalUrl: string | null;
  lighthouseVersion: string | null;
}

// ─── Schema.org analysis ────────────────────────────────────────────────────

export interface SchemaAnalysis {
  schemasFound: boolean;
  schemaTypes: string[];
  hasOrganization: boolean;
  hasPerson: boolean;
  sameAsCount: number;
  sameAsUrls: string[];
  missingFields: string[];
  rawSchemas: unknown[];
  sameAsVerification?: Array<{ url: string; resolves: boolean; identityMatch?: boolean }>;
}

// ─── Observability ───────────────────────────────────────────────────────────

export interface AuditObservability {
  totalCostUsd: number;
  fetcherLogCount: number;
  totalLatencyMs: number;
  probesRun: number;
  checksRun: number;
  cacheHitRate: number;
}

// ─── Sitemap analysis ────────────────────────────────────────────────────────

export interface SitemapEntry {
  url: string;
  /** `<lastmod>` as declared, ISO-normalised. Null when the sitemap omits it. */
  lastmod: string | null;
}

export interface SitemapAnalysis {
  found: boolean;
  /** The first entry point that resolved — kept for simple display. See `sitemapUrls` for every one that did. */
  sitemapUrl: string | null;
  /**
   * Every entry point that resolved, in the order tried. Plural because this
   * module reads every robots.txt-declared `Sitemap:` line, not just the
   * first that resolves — a site can legitimately declare more than one. See
   * docs/analysis/technical-audit.md "Sitemap check".
   */
  sitemapUrls: string[];
  /** Every location tried, whether or not it resolved. */
  triedUrls: string[];
  statusCode: number;
  /** True when at least one resolved entry point was a `<sitemapindex>`. */
  isIndex: boolean;
  /** Child sitemaps read across every index entry point. */
  childSitemaps: string[];
  urlCount: number;
  withLastmod: number;
  newestLastmod: string | null;
  oldestLastmod: string | null;
  /** Whole days since the most recent `<lastmod>`. Null when none is declared. */
  staleDays: number | null;
  declaredInRobots: boolean;
  /** URLs that appear more than once across the merged set. */
  duplicateCount: number;
  /** URLs whose origin differs from the audited origin. */
  offOriginCount: number;
  entries: SitemapEntry[];
}

// ─── Agent readiness ─────────────────────────────────────────────────────────

export interface AgentReadinessIssue {
  id: string;
  name: string;
  result: string;
  recommendation: string;
  details?: string;
}

export interface AgentReadinessAnalysis {
  /** 0-100 as scored by is-agentic. Null when the scan could not be obtained. */
  score: number | null;
  scoreLabel: string | null;
  target: string | null;
  reportUrl: string | null;
  scannedAt: string | null;
  eligibleChecks: number | null;
  breakdown: {
    essential?: { earned: number; available: number; passing: number; total: number };
    recommended?: { earned: number; available: number; passing: number; total: number };
    bonus?: { points: number; positive_signals: number };
  } | null;
  issues: AgentReadinessIssue[];
  /** Which path produced this: the CLI (can start a scan) or the read-only API. */
  source: 'cli' | 'api' | 'none';
  error: string | null;
}

// ─── Per-page inventory ──────────────────────────────────────────────────────

/** Stable issue codes. Deliberately closed — the UI groups on these. */
export type PageIssueCode =
  | 'page-error'
  | 'title-missing'
  | 'title-too-short'
  | 'title-too-long'
  | 'meta-missing'
  | 'meta-too-short'
  | 'meta-too-long'
  | 'h1-missing'
  | 'h1-multiple'
  | 'canonical-missing'
  | 'canonical-malformed'
  | 'canonical-cross-domain'
  | 'json-ld-missing'
  | 'json-ld-invalid'
  | 'thin-content'
  | 'images-missing-alt'
  | 'duplicate-content'
  | 'noindex'
  | 'heading-level-skipped'
  | 'url-too-long'
  | 'url-has-uppercase'
  | 'url-has-underscore'
  | 'url-excess-params';

export interface AuditPageResult {
  url: string;
  status: number;
  lastmod: string | null;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaDescLength: number | null;
  h1Count: number | null;
  canonical: string | null;
  wordCount: number | null;
  imageCount: number | null;
  imagesMissingAlt: number | null;
  jsonLdTypes: string[];
  jsonLdValid: boolean;
  jsonLdCount: number;
  issues: PageIssueCode[];
  /** 0-100 from the rubric. */
  score: number;
}

export interface PageInventoryAnalysis {
  discovered: number;
  crawled: number;
  budget: number;
  ok: number;
  errored: number;
  averageScore: number | null;
  issueCounts: Record<string, number>;
  worstPages: Array<{ url: string; score: number; issues: PageIssueCode[] }>;
  pagesWithoutJsonLd: number;
  pagesWithBadTitle: number;
  pagesWithBadMeta: number;
  pagesThin: number;
  pagesWithMissingAlt: number;
  pagesWithDuplicateContent: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  pagesWithHeadingIssues: number;
  pagesWithBadCanonical: number;
  pagesWithUrlIssues: number;
}

// ─── Page metadata (FR-3.5) ──────────────────────────────────────────────────

export interface HeadingInfo {
  level: number;
  text: string;
}

export interface PageMetadata {
  title: string;
  metaDescription: string;
  headings: HeadingInfo[];
  positioningCopy: string;
  capturedAt: string;
}

// ─── Run-over-run comparison ─────────────────────────────────────────────────

export type DeltaDirection = 'improved' | 'regressed' | 'unchanged' | 'new';

export interface AuditDelta {
  metric: string;
  label: string;
  previous: number | null;
  current: number | null;
  change: number | null;
  direction: DeltaDirection;
  /** True when a higher number is better — the UI needs it to colour the arrow. */
  higherIsBetter: boolean;
}

export interface AuditComparison {
  currentAuditId: string;
  previousAuditId: string | null;
  currentAt: string;
  previousAt: string | null;
  deltas: AuditDelta[];
  pageChanges: {
    added: string[];
    removed: string[];
    improved: Array<{ url: string; from: number; to: number }>;
    regressed: Array<{ url: string; from: number; to: number }>;
  };
}

// ─── The compiled run result (`technical_audit_runs.result`) ────────────────

/**
 * The full `result` jsonb blob — every check's analysis, page metadata, and
 * observability, one struct. Mirrors `company_context_profiles.profile_json`
 * as the "one blob" pattern.
 */
export interface TechnicalAuditResult {
  targetUrl: string;
  robots: RobotsAnalysis | null;
  cdn: CdnAnalysis | null;
  jsRender: JsRenderAnalysis | null;
  cwv: CwvAnalysis | null;
  schema: SchemaAnalysis | null;
  sitemap: SitemapAnalysis | null;
  agentReadiness: AgentReadinessAnalysis | null;
  pageInventory: PageInventoryAnalysis | null;
  pageMetadata: PageMetadata | null;
  observability: AuditObservability | null;
}

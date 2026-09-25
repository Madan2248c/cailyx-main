/**
 * The contract between the orchestrator and each check.
 *
 * Deliberately much smaller than Discovery's `DiscoveryRunContext` — there is
 * no multi-job pause/resume here (see docs/analysis/technical-audit.md "Job
 * orchestration"), so a check needs only what it takes to run: the run id
 * (for the fetcher's cost/log attribution), the project, and the resolved
 * target URL. A check returns its own analysis; the orchestrator is what
 * turns that into an `AuditFinding` and persists it — a check never touches
 * Prisma itself.
 */

export interface AuditProjectRef {
  id: string;
  name: string;
  /** Normalized: no protocol, no `www.`, no path. */
  domain: string;
}

export interface AuditContext {
  readonly runId: string;
  readonly project: AuditProjectRef;
  /** `https://<domain>` — the origin every check probes against. */
  readonly targetUrl: string;
}

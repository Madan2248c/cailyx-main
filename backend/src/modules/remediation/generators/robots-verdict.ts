/**
 * "Would this robots.txt allow this bot at `/`?" — answered by the exact same
 * matcher the crawlers and the technical audit use (`RobotsService.isAllowed`
 * → `selectGroup` + longest-match precedence), never a second parser that
 * could silently disagree with it.
 *
 * `RobotsService` fetches robots.txt itself; here it is handed a one-shot
 * fetcher stub that returns the text under test, on a fresh instance (so its
 * in-process cache can't serve a stale file). Used both to self-check a
 * generated robots.txt before it is saved and to verify the live file.
 *
 * @module remediation/generators/robots-verdict
 */

import type { FetcherService } from '../../fetcher/fetcher.service.js';
import { RobotsService } from '../../fetcher/services/robots.service.js';

const PROBE_ORIGIN = 'https://robots-verdict.invalid';

/** One allow/deny verdict per user agent, all at the site root. */
export async function robotsRootVerdicts(robotsTxt: string, userAgents: string[]): Promise<Map<string, boolean>> {
  const stub = {
    fetch: async () => ({ status: 200, body: robotsTxt }),
  } as unknown as FetcherService;
  const robots = new RobotsService(stub);
  const out = new Map<string, boolean>();
  for (const ua of userAgents) {
    out.set(ua, await robots.isAllowed(`${PROBE_ORIGIN}/`, ua));
  }
  return out;
}

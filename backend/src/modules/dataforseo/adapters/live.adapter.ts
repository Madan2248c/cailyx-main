/**
 * Live DataForSEO adapter — FAIL-CLOSED STUB, not wired into the module.
 *
 * Deliberately not provided in `DataforseoModule`: nothing in this build
 * may construct it, so no code path can reach for DATAFORSEO_LOGIN or
 * DATAFORSEO_PASSWORD. Every method throws before touching config, the
 * network, or credentials — `SWARM_ALLOW_LIVE` stays `0` and no credit
 * can be spent through this class by construction.
 *
 * Live-wiring follow-ups (see the module README): implement the DataForSEO
 * REST calls here — SERP (`serp/google/organic/live/advanced`) for
 * `serp-ranks`/`serp-snapshot`, Backlinks (`backlinks/backlinks/live`,
 * `backlinks/referring_domains/live`, `backlinks/pages/live`) for
 * `backlinks-summary`/`backlink-rows`/`referring-domains`/`top-pages`,
 * Keywords Data + DataForSEO Labs
 * (`keywords_data/google/search_volume/live`,
 * `dataforseo_labs/google/keyword_ideas/live`,
 * `dataforseo_labs/google/overview/live`) for
 * `keyword-overview`/`keyword-ideas`/`domain-overview` (basic auth with
 * login/password from config — never logged, never returned) — select this
 * adapter only when `SWARM_ALLOW_LIVE=1`, add spend confirmation, and
 * provide it in the module.
 *
 * @module dataforseo/adapters/live.adapter
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DataforseoAdapter, DatasetResult } from '../dataforseo.types.js';

/** Fail-closed placeholder for the future live DataForSEO REST client. */
@Injectable()
export class LiveDataforseoAdapter implements DataforseoAdapter {
  readonly name = 'live' as const;

  /**
   * Always throws — and takes no ConfigService, so it cannot even read
   * credentials. Replace with the real REST implementation when live
   * wiring is explicitly authorized.
   */
  fetchDataset(): Promise<DatasetResult> {
    throw new ServiceUnavailableException('Live DataForSEO is not wired in this build — all paid paths go through the mock adapter.');
  }
}

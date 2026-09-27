/**
 * DataForSEO module — scheduled paid SERP/backlink/keyword snapshots.
 *
 * Collects three datasets per project (`serp-ranks`, `backlinks-summary`,
 * `keyword-overview`) into append-only `dataforseo_snapshots` rows, on
 * demand or on a WEEKLY/MONTHLY recurrence. See
 * docs/analysis/dataforseo.md for the design and `README.md` next to this
 * file for the operational notes.
 *
 * THIS BUILD IS MOCK-ONLY: the only adapter provided is
 * `MockDataforseoAdapter` (gated behind `DATAFORSEO_ALLOW_MOCK`, same
 * pattern as measurement's mock adapter). `LiveDataforseoAdapter` exists
 * as a fail-closed stub and is deliberately NOT provided here, so no code
 * path can reach for DATAFORSEO_LOGIN/PASSWORD and `SWARM_ALLOW_LIVE`
 * stays `0`.
 *
 * One BullMQ queue (`dataforseo`, concurrency 1) carries manual collects
 * and recurring schedules (one job scheduler per project — the worker
 * advances `next_run_at` at fire time, and only collects when the project
 * opted into spend). Same Redis instance as the other queues — one Redis
 * config, independent consumers.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MockDataforseoAdapter } from './adapters/mock.adapter.js';
import { DataforseoController, DataforseoSnapshotController } from './controllers/dataforseo.controller.js';
import { DATAFORSEO_QUEUE } from './queue/dataforseo.queue.js';
import { DataforseoProcessor } from './queue/dataforseo.processor.js';
import { DataforseoScheduler } from './services/dataforseo.scheduler.js';
import { DataforseoService } from './services/dataforseo.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: DATAFORSEO_QUEUE })],
  controllers: [DataforseoController, DataforseoSnapshotController],
  providers: [
    // The queue consumer, the schedule manager, the mock-only adapter,
    // and the orchestrator that does the real work. LiveDataforseoAdapter
    // is NOT provided on purpose — see the module doc above.
    DataforseoProcessor,
    DataforseoScheduler,
    MockDataforseoAdapter,
    DataforseoService,
  ],
  exports: [DataforseoService],
})
export class DataforseoModule {}

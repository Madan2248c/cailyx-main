/**
 * Measurement module (SOP-2) — measures AI visibility by running an active
 * query set's prompts across an AI answer surface via Cloro (cloro.dev)
 * and scoring each answer into a structured Observation. Built per
 * explicit operator instruction ahead of a written analysis doc — see
 * `README.md` next to this file for the design as-built.
 *
 * Reads Discovery-independent, Query-Set-dependent: `createRun` only
 * accepts an ACTIVE query set (the immutability guarantee is what makes a
 * measurement cohort comparable).
 */

import { Module } from '@nestjs/common';
import { CloroAiModeAdapter, CloroChatGptAdapter, CloroClient, CloroGeminiAdapter, CloroGoogleAiOverviewAdapter, CloroPerplexityAdapter } from './adapters/cloro.adapter.js';
import { MockSurfaceAdapter } from './adapters/mock.adapter.js';
import { MeasurementController, MeasurementRunController } from './controllers/measurement.controller.js';
import { MeasurementService } from './services/measurement.service.js';

@Module({
  controllers: [MeasurementController, MeasurementRunController],
  providers: [
    CloroClient,
    CloroChatGptAdapter,
    CloroPerplexityAdapter,
    CloroGeminiAdapter,
    CloroGoogleAiOverviewAdapter,
    CloroAiModeAdapter,
    MockSurfaceAdapter,
    MeasurementService,
  ],
  exports: [MeasurementService, CloroClient],
})
export class MeasurementModule {}

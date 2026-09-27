/**
 * AEO Audit module — ties an ACTIVE query set to one or more Measurement
 * runs, judges stance, assembles a verdict, writes a best-effort
 * narrative. Ported from the old repo's `aeo-audit` module; see
 * `README.md` for what was kept, dropped, or changed. Built ahead of a
 * written analysis doc, per explicit operator instruction — same as
 * Measurement.
 *
 * Never generates its own query set or triggers Discovery — reads an
 * already-active Query Set and drives Measurement's existing
 * createRun/executeRun, closing the layering gap Query Set's own design
 * doc opened with.
 */

import { Module } from '@nestjs/common';
import { MeasurementModule } from '../measurement/measurement.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { AeoAuditController, AeoAuditRunController, CompetitorController, CompetitorItemController } from './controllers/aeo-audit.controller.js';
import { AeoAuditService } from './services/aeo-audit.service.js';
import { AeoNarrativeService } from './services/aeo-narrative.service.js';
import { AeoStanceService } from './services/aeo-stance.service.js';
import { CompetitorService } from './services/competitor.service.js';

@Module({
  imports: [MeasurementModule, LlmModule],
  controllers: [AeoAuditController, AeoAuditRunController, CompetitorController, CompetitorItemController],
  providers: [AeoAuditService, AeoStanceService, AeoNarrativeService, CompetitorService],
  exports: [AeoAuditService],
})
export class AeoAuditModule {}

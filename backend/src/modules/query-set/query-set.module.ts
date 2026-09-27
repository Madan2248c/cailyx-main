/**
 * Query Set module (SOP-1) — a project's versioned prompt set, built in two
 * LLM steps: propose per-project buckets grounded in Discovery's
 * CompanyContextProfile, then generate prompts per bucket. Buckets are NOT
 * a fixed taxonomy — invented per project, bounded by deterministic
 * guardrails. See docs/analysis/query-set.md for the full design and
 * `README.md` next to this file for operational notes.
 *
 * Consumes Discovery's `CompanyContextProfile` read-only — no write
 * coupling. `measurement` (SOP-2) will run prompts from an active set;
 * AEO Audit consumes an active set + measurement results and does not
 * generate its own prompts (the layering fix this module exists for).
 */

import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { QuerySetController, QuerySetItemController } from './controllers/query-set.controller.js';
import { QuerySetGenerationService } from './services/query-set-generation.service.js';
import { QuerySetService } from './services/query-set.service.js';

@Module({
  imports: [LlmModule],
  controllers: [QuerySetController, QuerySetItemController],
  providers: [QuerySetGenerationService, QuerySetService],
  exports: [QuerySetService],
})
export class QuerySetModule {}

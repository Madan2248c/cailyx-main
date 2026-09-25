/**
 * The shared LLM client — one constrained-JSON caller, used by Discovery and
 * Technical Audit. See `llm.service.ts` for why this lives on its own rather
 * than inside either module.
 *
 * @module llm/llm.module
 */

import { Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';

@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}

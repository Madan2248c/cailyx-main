/**
 * The shared transactional-email sender — a leaf dependency other modules
 * import. No controller: nothing outside this backend triggers an email
 * directly; callers (e.g. `auth`, the future `day1-pipeline` orchestrator)
 * compose their own subject/HTML and call `EmailService.send()`.
 *
 * See `email.service.ts` and docs/analysis/email.md.
 *
 * @module email/email.module
 */

import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';

@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}

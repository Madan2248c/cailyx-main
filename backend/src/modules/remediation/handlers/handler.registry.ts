/**
 * Every handler, in merge-priority order. Adding a new problem family means
 * adding one handler here — nothing else in the module changes.
 *
 * @module remediation/handlers/handler.registry
 */

import type { RemediationHandler } from '../remediation.types.js';
import { pageIssuesHandler } from './page.handlers.js';
import { aeoHandler, socialHandler } from './presence.handlers.js';
import { agentReadinessHandler, cdnHandler, cwvHandler, jsRenderHandler, robotsHandler, schemaHandler, sitemapHandler } from './technical.handlers.js';

export const HANDLERS: readonly RemediationHandler[] = [
  robotsHandler,
  cdnHandler,
  sitemapHandler,
  schemaHandler,
  jsRenderHandler,
  cwvHandler,
  agentReadinessHandler,
  pageIssuesHandler,
  socialHandler,
  aeoHandler,
];

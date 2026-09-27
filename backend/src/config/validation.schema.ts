import Joi from 'joi';

export const validationSchema = Joi.object({
  DATABASE_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().positive().default(30),
  INVITE_TOKEN_TTL_HOURS: Joi.number().positive().default(72),
  RESET_TOKEN_TTL_HOURS: Joi.number().positive().default(1),
  LOGIN_MAX_ATTEMPTS: Joi.number().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: Joi.number().positive().default(15),

  // Discovery / company-context module. Optional — the services that read
  // these (fetcher's cache, the LLM client, the DataForSEO client) all fail
  // closed (disabled, not broken) when unset, per docs/analysis/discovery.md.
  REDIS_URL: Joi.string().uri().optional(),
  OPENROUTER_API_KEY: Joi.string().optional(),
  AEO_LLM_MODEL: Joi.string().default('deepseek/deepseek-v4.1-flash'),
  DATAFORSEO_LOGIN: Joi.string().optional(),
  DATAFORSEO_PASSWORD: Joi.string().optional(),
  SWARM_ALLOW_LIVE: Joi.string().valid('0', '1').default('0'),
  PRESENCE_SERP_MAX_QUERIES: Joi.number().positive().default(20),

  // Per-run crawl budgets. Ported from the old repo's AEO_CONTEXT_* env vars
  // (same defaults); optional, so the pipeline's own defaults apply when unset.
  // They exist mainly so a live end-to-end run can be widened without a code
  // change — every stage enforces them through the run's budget.
  DISCOVERY_MAX_PAGES: Joi.number().positive().optional(),
  DISCOVERY_MAX_REQUESTS: Joi.number().positive().optional(),
  DISCOVERY_MAX_CHARS: Joi.number().positive().optional(),
  DISCOVERY_MAX_ELAPSED_MS: Joi.number().positive().optional(),
  DISCOVERY_MAX_RETRIES_PER_PAGE: Joi.number().positive().optional(),

  // Technical Audit module. Optional — the checks that read these fail
  // closed (a `not-run`/`error` finding, never a guess) when unset, per
  // docs/analysis/technical-audit.md.
  PSI_API_KEY: Joi.string().optional(),
  AGENT_READINESS_CLI: Joi.string().valid('true', 'false').default('true'),
  AGENT_READINESS_TIMEOUT_MS: Joi.number().positive().optional(),
  TECHNICAL_AUDIT_PAGE_CRAWL_BUDGET: Joi.number().positive().optional(),
  TECHNICAL_AUDIT_PAGE_CRAWL_CONCURRENCY: Joi.number().positive().optional(),
  TECHNICAL_AUDIT_MAX_COST_PER_RUN_USD: Joi.number().positive().optional(),

  // Social Activity (digital presence) module. Optional — pulls fail
  // closed (typed 503 / never scheduled without opt-in) when unset, per
  // docs/analysis/digital-presence-audit.md.
  APIFY_API_KEY: Joi.string().optional(),
  APIFY_PLATFORMS: Joi.string().optional(),
  APIFY_POSTS_PER_PLATFORM: Joi.number().positive().optional(),
  APIFY_ACTORS: Joi.string().optional(),
  SOCIAL_WINDOW_DAYS: Joi.number().positive().optional(),
  SOCIAL_MAX_COST_PER_RUN_USD: Joi.number().positive().optional(),

  // Measurement module (SOP-2). Optional — the CloroClient fails closed
  // (typed CloroAdapterError, reason 'cloro-disabled') when no CLORO_API_KEY
  // is set. Built ahead of a written analysis doc, per explicit operator
  // instruction — see backend/src/modules/measurement/README.md.
  CLORO_API_KEY: Joi.string().optional(),
  CLORO_CREDIT_USD: Joi.number().positive().optional(),
  CLORO_MAX_CONCURRENCY: Joi.number().positive().optional(),
  MEASUREMENT_MAX_COST_PER_RUN: Joi.number().positive().optional(),
  MEASUREMENT_ALLOW_MOCK: Joi.string().valid('0', '1').optional(),
});

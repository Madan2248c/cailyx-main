/**
 * Railway infrastructure for Cailyx: one project, three resources.
 *
 *   backend   NestJS API (Dockerfile in /backend). Runs migrations before
 *             each release, serves /health, reaches Redis privately.
 *   frontend  Next.js client portal (Dockerfile in /frontend). Talks to the
 *             API over Railway's private network.
 *   redis     Queues (BullMQ) and the fetch cache.
 *
 * Postgres is Supabase, outside Railway, in Singapore (aws ap-southeast-1).
 * Every resource here runs in Railway's Singapore region too, so each
 * database query stays in-region (~1-2 ms) instead of crossing the Pacific
 * (~180 ms per query from the old us-west default). REGION is the one knob.
 *
 * Secrets are never written here: `preserve()` keeps the value already set on
 * Railway (`railway variable set KEY --stdin`). Plain `${{ }}` strings are
 * Railway reference variables, resolved by Railway at deploy time.
 *
 * Preview with `railway config plan`, apply with `railway config apply`.
 * See docs/deploy/railway.md.
 */
import { defineRailway, github, preserve, project, redis, service } from "railway/iac";

const REPO = "Rothenhall/cailyx-main";

/** Railway's Singapore region, next to the Supabase database. */
const REGION = "asia-southeast1-eqsg3a";

export default defineRailway(() => {
  const cache = redis("redis", { region: REGION });

  const backend = service("backend", {
    source: github(REPO, { branch: "main", rootDirectory: "/backend", checkSuites: false }),
    // Built from /backend/Dockerfile: Railway uses a Dockerfile in the root directory automatically.
    build: { watchPatterns: ["/backend/**"] },
    start: "node dist/main",
    regions: { [REGION]: 1 },
    preDeploy: "npm run db:migrate",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    // Restart policy is ON_FAILURE, Railway's default (stored as unset, so it is
    // not written here — declaring it shows as permanent drift in `config plan`).
    deploy: { restartPolicyMaxRetries: 5 },
    // The public domain is declared as it exists on Railway, so
    // `railway config apply` keeps it: a domain missing here would be removed,
    // taking the API offline.
    networking: {
      serviceDomains: { "backend-production-9558a.up.railway.app": { port: 3001 } },
    },
    env: {
      NODE_ENV: "production",
      PORT: "3001",
      FRONTEND_URL: "https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}",
      REDIS_URL: cache.env.REDIS_URL,
      GOOGLE_REDIRECT_URI: "https://${{backend.RAILWAY_PUBLIC_DOMAIN}}/auth/google/callback",
      PLUNK_SENDER_EMAIL: "noreply@rothenhall.com",
      AEO_LLM_MODEL: "deepseek/deepseek-v4.1-flash",
      DAY1_SURFACES: "cloro_chatgpt",

      // Auth + tuning, pinned explicitly (each equals the code default).
      INVITE_TOKEN_TTL_HOURS: "72",
      JWT_ACCESS_EXPIRES_IN: "15m",
      LOGIN_LOCKOUT_MINUTES: "15",
      LOGIN_MAX_ATTEMPTS: "5",
      REFRESH_TOKEN_TTL_DAYS: "30",
      RESET_TOKEN_TTL_HOURS: "1",
      PRESENCE_SERP_MAX_QUERIES: "20",
      // Live (paid) DataForSEO calls stay off until someone opts in.
      SWARM_ALLOW_LIVE: "0",

      // Secrets, set on Railway and kept out of git.
      DATABASE_URL: preserve(),
      JWT_ACCESS_SECRET: preserve(),
      GOOGLE_TOKEN_ENCRYPTION_KEY: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      OPENROUTER_API_KEY: preserve(),
      PSI_API_KEY: preserve(),
      APIFY_API_KEY: preserve(),
      CLORO_API_KEY: preserve(),
      PLUNK_SECRET_KEY: preserve(),
      PLUNK_PUBLIC_KEY: preserve(),
      DATAFORSEO_LOGIN: preserve(),
      DATAFORSEO_PASSWORD: preserve(),
    },
  });

  const frontend = service("frontend", {
    source: github(REPO, { branch: "main", rootDirectory: "/frontend", checkSuites: false }),
    // Built from /frontend/Dockerfile: Railway uses a Dockerfile in the root directory automatically.
    build: { watchPatterns: ["/frontend/**"] },
    start: "node server.js",
    regions: { [REGION]: 1 },
    healthcheck: "/robots.txt",
    healthcheckTimeout: 120,
    // Restart policy is ON_FAILURE, Railway's default (stored as unset, so it is
    // not written here — declaring it shows as permanent drift in `config plan`).
    deploy: { restartPolicyMaxRetries: 5 },
    // Both public domains, including the custom cailyx.rothenhall.com, are
    // declared as they exist on Railway so `railway config apply` keeps them:
    // a domain missing here would be removed, taking the portal offline.
    networking: {
      serviceDomains: { "frontend-production-1f7f.up.railway.app": { port: 3000 } },
      customDomains: { "cailyx.rothenhall.com": { port: 3000 } },
    },
    env: {
      // Pinned so the generated domain's target port (3000) always matches.
      PORT: "3000",
      BACKEND_URL: "http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}",
    },
  });

  return project("lively-gratitude", {
    resources: [cache, backend, frontend],
  });
});

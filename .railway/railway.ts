/**
 * Railway infrastructure for Cailyx: one project, three resources.
 *
 *   backend   NestJS API (Dockerfile in /backend). Runs migrations before
 *             each release, serves /health, reaches Redis privately.
 *   frontend  Next.js client portal (Dockerfile in /frontend). Talks to the
 *             API over Railway's private network.
 *   redis     Queues (BullMQ) and the fetch cache.
 *
 * Postgres is Supabase, outside Railway.
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

export default defineRailway(() => {
  const cache = redis("redis");

  const backend = service("backend", {
    source: github(REPO, { branch: "main", rootDirectory: "/backend", checkSuites: false }),
    // Built from /backend/Dockerfile: Railway uses a Dockerfile in the root directory automatically.
    build: { watchPatterns: ["/backend/**"] },
    start: "node dist/main",
    preDeploy: "npm run db:migrate",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    networking: { privateNetworkEndpoint: "backend" },
    env: {
      NODE_ENV: "production",
      PORT: "3001",
      FRONTEND_URL: "https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}",
      REDIS_URL: cache.env.REDIS_URL,
      GOOGLE_REDIRECT_URI: "https://${{backend.RAILWAY_PUBLIC_DOMAIN}}/auth/google/callback",
      PLUNK_SENDER_EMAIL: "noreply@rothenhall.com",
      AEO_LLM_MODEL: "deepseek/deepseek-v4.1-flash",
      DAY1_SURFACES: "cloro_chatgpt",

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
      DATAFORSEO_LOGIN: preserve(),
      DATAFORSEO_PASSWORD: preserve(),
    },
  });

  const frontend = service("frontend", {
    source: github(REPO, { branch: "main", rootDirectory: "/frontend", checkSuites: false }),
    // Built from /frontend/Dockerfile: Railway uses a Dockerfile in the root directory automatically.
    build: { watchPatterns: ["/frontend/**"] },
    start: "node server.js",
    healthcheck: "/robots.txt",
    healthcheckTimeout: 120,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    networking: { privateNetworkEndpoint: "frontend" },
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

# Cailyx API (NestJS). The Playwright base image ships Node plus the Chromium
# build that playwright@1.63.0 expects (used by the fetcher's browser client
# and the Fix Plan PDF). Keep the tag in step with package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
WORKDIR /app

# ── Build: install, generate the Prisma client, compile ──────────────────
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npx prisma generate --config prisma7.config.ts && npm run build

# ── Runtime ──────────────────────────────────────────────────────────────
# node_modules keeps the dev packages on purpose: the Prisma CLI lives there,
# and migrations run from this image (`npm run db:migrate`, Railway's
# pre-deploy command) against the production database before each release.
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma7.config.ts ./
USER pwuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]

# Cailyx API (NestJS). The Playwright base image ships Node plus the Chromium
# build that playwright@1.63.0 expects (used by the fetcher's browser client).
# Keep the tag in step with the playwright version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
WORKDIR /app

# ── Build: install everything, generate the Prisma client, compile, prune ──
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npx prisma generate --config prisma7.config.ts \
 && npm run build \
 && npm prune --omit=dev

# ── Migrate: a one-off job image for `prisma migrate deploy` (keeps the CLI) ──
FROM base AS migrate
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY prisma ./prisma
COPY prisma7.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]

# ── Runtime: compiled app and production dependencies only ────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER pwuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]

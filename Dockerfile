# syntax=docker/dockerfile:1.7
# ---------- deps: install with the lockfile ----------
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# ---------- build: compile web + server, then prune to production deps ----------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm -r build \
 && pnpm --filter @discrello/server deploy --prod --legacy /out \
 && cp -r packages/server/drizzle /out/drizzle \
 && rm -rf /out/src /out/test

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /app/packages/web/dist /app/web
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. Single instance: the in-process worker drains the outbox.
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]

# syntax=docker/dockerfile:1
# Backend image — one artifact for both the API (src/index.ts) and the worker
# (src/worker.ts); compose picks the entrypoint via `command:`. Multi-stage:
# build with the full toolchain, then run as the non-root `node` user.
# Build context is the repo ROOT (pnpm workspace), not packages/backend.

# ---- build: install workspace, compile shared + backend ----------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @nuru/shared build \
 && pnpm --filter @nuru/backend build

# ---- runtime -----------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
# node_modules is intentionally NOT pruned: node-pg-migrate (migrations) lives in
# devDependencies, and the migrate/seed init step in compose needs it.
COPY --from=build /repo /repo
RUN chown -R node:node /repo
USER node
WORKDIR /repo/packages/backend
EXPOSE 8080
# Liveness uses the in-process /healthz endpoint (no curl in the slim image).
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

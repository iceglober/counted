# The API. Bun, one process, no transpile step — Bun runs TypeScript directly,
# so there is nothing that can get stale between the source and what runs.
FROM oven/bun:1.3.11 AS base
WORKDIR /app

FROM base AS deps
# The whole tree, then install.
#
# The obvious optimisation is to copy each workspace's package.json first so a
# source change does not invalidate the install layer. That means listing every
# workspace in every Dockerfile — three lists that have to agree with
# `workspaces` in package.json, and the way they go stale is a new package
# breaking the build with "Workspace not found", which is how this file was
# written the first time. A cache miss costs thirty seconds; a stale list costs
# an afternoon.
COPY . .
# Trim the workspace to this service's dependency closure, computed from the
# manifests rather than listed here — see the script for why.
RUN bun scripts/prune-workspace.ts apps/api && bun install

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app ./

ENV PORT=8080
EXPOSE 8080

# No shell wrapper. The process is PID 1 and receives SIGTERM directly, which
# its graceful drain depends on — a shell would swallow the signal and the
# container would be killed mid-flush.
CMD ["bun", "run", "apps/api/src/index.ts"]

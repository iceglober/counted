# The console. Next.js, built to a standalone server.
#
# It has no database driver and no DATABASE_URL — enforced by a test rather than
# by this file, which is why this image needs nothing but the API's URL.
FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS build
# See api.Dockerfile for why the whole tree rather than a manifest list.
COPY . .
# Trim the workspace to this service's dependency closure, computed from the
# manifests rather than listed here — see the script for why.
RUN bun scripts/prune-workspace.ts apps/web && bun install

ENV NEXT_TELEMETRY_DISABLED=1
# .next is excluded from the context, and no cache mount survives this build.
ENV COUNTED_NEXT_BUILD_CACHE=off
RUN cd apps/web && bun run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["bun", "run", "apps/web/server.js"]

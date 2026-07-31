# The console. Next.js, built to a standalone server.
#
# It has no database driver and no DATABASE_URL — enforced by a test rather than
# by this file, which is why this image needs nothing but the API's URL.
FROM oven/bun:1.3.11 AS base
WORKDIR /app

FROM base AS build
# See api.Dockerfile for why the whole tree rather than a manifest list.
COPY . .
# Trim the workspace to this service's dependency closure, computed from the
# manifests rather than listed here — see the script for why.
RUN bun scripts/prune-workspace.ts apps/web && bun install

ENV NEXT_TELEMETRY_DISABLED=1
# Baked in, because Next inlines NEXT_PUBLIC_* into the client bundle. Changing
# it later needs a rebuild, not a restart — which is why it is a build argument
# rather than a runtime variable somebody would reasonably expect to work.
ARG NEXT_PUBLIC_COUNTED_API_URL
ENV NEXT_PUBLIC_COUNTED_API_URL=$NEXT_PUBLIC_COUNTED_API_URL
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

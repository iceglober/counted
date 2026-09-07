# Public documentation. The contract generates the reference at build time.
FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS build
COPY . .
RUN bun scripts/prune-workspace.ts apps/docs && bun install
ENV NEXT_TELEMETRY_DISABLED=1
# .next is excluded from the context, and no cache mount survives this build.
ENV COUNTED_NEXT_BUILD_CACHE=off
RUN cd apps/docs && bun run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/docs/.next/standalone ./
COPY --from=build /app/apps/docs/.next/static ./apps/docs/.next/static
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
EXPOSE 3001
CMD ["bun", "run", "apps/docs/server.js"]

FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/react/package.json packages/react/
COPY packages/migrate/package.json packages/migrate/
COPY packages/api/package.json packages/api/
COPY packages/claude-code/package.json packages/claude-code/
COPY packages/codex-cli/package.json packages/codex-cli/
COPY packages/gemini-cli/package.json packages/gemini-cli/
COPY packages/opencode/package.json packages/opencode/
RUN bun install --frozen-lockfile

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN cd packages/sdk && bunx tsup --no-dts && cd ../react && bunx tsup --no-dts
ARG RAILWAY_GIT_COMMIT_SHA
ARG NEXT_PUBLIC_COUNTED_PROJECT_KEY
ARG NEXT_PUBLIC_COUNTED_HOST
ENV NEXT_TELEMETRY_DISABLED=1
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_COUNTED_PROJECT_KEY=$NEXT_PUBLIC_COUNTED_PROJECT_KEY
ENV NEXT_PUBLIC_COUNTED_HOST=$NEXT_PUBLIC_COUNTED_HOST
RUN bun run build

# Production
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/lib/db ./lib/db
COPY --from=build /app/scripts ./scripts

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["sh", "scripts/start.sh"]

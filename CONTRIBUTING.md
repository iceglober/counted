# Contributing to Counted

Thanks for your interest in contributing. Here's how to get started.

## Development Setup

```bash
git clone https://github.com/iceglober/counted.git
cd counted
bun install
cp .env.example .env.local
# Edit .env.local with your local Postgres URL and a dev auth secret
bun run dev
```

You'll need PostgreSQL running locally. The schema is pushed with `bun run db:push`.

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `bun run typecheck` — must pass with zero errors
4. Commit with a clear message describing what changed and why
5. Open a pull request against `main`

## Code Style

- TypeScript strict mode, no `any` unless truly unavoidable
- No comments unless the *why* is non-obvious
- Prefer editing existing files over creating new ones
- No premature abstractions — three similar lines beats a helper nobody reads

## What We're Looking For

- Bug fixes with reproduction steps
- SDK ports to new languages (Python, Go, Rust, Swift, Kotlin)
- Dashboard insight types (new visualizations)
- Performance improvements with benchmarks
- Documentation improvements

## What We're NOT Looking For

- Features that compromise privacy (tracking, fingerprinting, cookies)
- Dependencies that significantly increase bundle size
- Changes to pricing, billing, or business logic
- AI-generated PRs without human review

## SDK Development

SDK packages live in `packages/`. Each has its own `tsup.config.ts` and builds independently:

```bash
cd packages/sdk && bun run build
cd packages/react && bun run build
```

The app depends on `@counted/sdk` as a workspace package — build the SDK before running the app if you change it.

## Questions?

Open an issue. We don't have a Discord or Slack yet.

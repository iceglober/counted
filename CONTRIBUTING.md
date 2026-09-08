# Contributing to Counted

Thanks for your interest in contributing. Here's how to get started.

## Development Setup

```bash
git clone https://github.com/iceglober/counted.git
cd counted
bun install
cp .env.example .env.local
bun run dev
```

`bun run dev` starts a stock Postgres 17 in Docker (nothing to install on it), the API on
:8080 and the console on :3000. Sign in with any email: without a mail provider configured
the magic link is printed to the API's log. `DEVELOPING.md` has the whole setup, the three
schemas, and how to reset.

### Manual setup

If you prefer to manage your own Postgres:

```bash
bun install
cp .env.example .env.local
# Edit DATABASE_URL in .env.local
bun run dev          # starts the database, the API on :8080 and the web app on :3000
bun run seed         # optional: fills a project with ~30 days of realistic events
```

`bun run seed` drives the public API, so the stack has to be running. It prints
a claim link at the end.

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

SDKs live in `packages/sdk-js`, `packages/react`, `packages/python`, `packages/go` and
`packages/rust`. Their request and response types are generated from the contract in
`packages/contract` — never edit a `gen/` directory by hand; change the contract and run
`bun run contract:check`, which regenerates every SDK's artefacts and fails CI on drift.
`bun run typecheck` and `bun run test` cover the TypeScript SDKs; each other language has
its own test command in its package.

## Questions?

Open an issue. We don't have a Discord or Slack yet.

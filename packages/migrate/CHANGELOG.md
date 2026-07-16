# @counted/migrate

## 0.1.1

### Patch Changes

- Production hardening across the SDKs and agent plugins.

  - **@counted/sdk**: page-hide beacon carries the project key and survives failure;
    flush re-queues on error, drains fully, and honors 429; loud-in-dev key/error
    warnings with a `debug` option; real Aptabase compat (`appVersion`); build-time
    version injection; session state moved onto the instance.
  - **@counted/react**: StrictMode-safe provider (recreates the instance on remount),
    SSR guard + `"use client"`, and a real `AptabaseProvider`/`useAptabase` shim.
  - **agent plugins** (claude-code, opencode, codex-cli, gemini-cli): real semver peer
    deps (no `workspace:*`), plugin API-key wiring, corrected hook signatures so
    file/command/outcome events actually fire, per-session keying, and honest READMEs.
  - **@counted/migrate**: retry with backoff, keyset pagination, resumable checkpoint.
  - **@counted/api**: unified wire types.

# @counted/react

## 0.1.1

### Patch Changes

- [`6f6588e`](https://github.com/iceglober/counted/commit/6f6588e2416b940d87a7dc155a26334f54ced0b2) Thanks [@iceglober](https://github.com/iceglober)! - Default host now points to `https://app.counted.dev`. The previous default,
  `https://counted.dev`, is the apex domain which has no DNS, so events from any
  client that didn't pass an explicit `host` were silently dropped. Packages that
  bundle the SDK (`react`, `claude-code`, `opencode`) are republished so their
  built output picks up the corrected default.
- Updated dependencies [[`6f6588e`](https://github.com/iceglober/counted/commit/6f6588e2416b940d87a7dc155a26334f54ced0b2)]:
  - @counted/sdk@0.1.1

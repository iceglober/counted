<p align="center">
  <img src="app/icon.svg" width="48" height="48" alt="Counted" />
</p>

<h1 align="center">Counted</h1>

<p align="center">
  Privacy-first analytics with composable dashboards.<br/>
  No cookies. No fingerprinting. No PII. Under 3KB.
</p>

<p align="center">
  <a href="https://counted.dev">Website</a> ·
  <a href="https://app.counted.dev">Dashboard</a> ·
  <a href="https://www.npmjs.com/package/@counted/sdk">npm</a>
</p>

---

## Quick Start

```bash
npm install @counted/sdk
```

```typescript
import { Analytics } from "@counted/sdk";

const analytics = new Analytics({ projectKey: "A-US-..." });
analytics.track("page_view", { path: "/" });
```

### React

```bash
npm install @counted/react
```

```tsx
import { AnalyticsProvider, useAnalytics } from "@counted/react";

function App() {
  return (
    <AnalyticsProvider projectKey="A-US-...">
      <MyApp />
    </AnalyticsProvider>
  );
}

function SignupButton() {
  const { track } = useAnalytics();
  return <button onClick={() => track("signup_click")}>Sign Up</button>;
}
```

## What Counted Does

- **Event tracking** — track any event with custom properties
- **Composable dashboards** — build your own view with metrics, time series, and breakdowns
- **Privacy by design** — no cookies, no IP storage, no fingerprinting, GDPR-compliant without a consent banner
- **Lightweight SDK** — under 3KB gzipped, no dependencies

## What Counted Does NOT Do

- Set cookies or use localStorage for tracking
- Store IP addresses or any PII
- Fingerprint browsers (no canvas, WebGL, font probing)
- Auto-track without explicit opt-in
- Sell or share data with third parties

## Self-Hosting

One command:

```bash
git clone https://github.com/iceglober/counted.git
cd counted/self-host
cp .env.example .env
# Edit .env with your auth secret
docker compose up -d
```

See [self-host/README.md](./self-host/README.md) for the full guide, production checklist, and backup instructions.

For development setup, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Packages

| Package | Description | Size |
|---------|-------------|------|
| [`@counted/sdk`](packages/sdk) | Vanilla JS event tracking | ~3KB |
| [`@counted/react`](packages/react) | React provider + hook | ~1KB |
| [`@counted/migrate`](packages/migrate) | Aptabase migration CLI | — |

## Migrating from Aptabase

```bash
# Option A: drop-in compat (zero API changes)
npm remove @aptabase/web
npm install @counted/sdk
# Change import: '@aptabase/web' → '@counted/sdk/aptabase'

# Option B: native API
npm remove @aptabase/react
npm install @counted/react
# AptabaseProvider → AnalyticsProvider
# useAptabase → useAnalytics
# trackEvent → track
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).

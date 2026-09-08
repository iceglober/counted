<h1 align="center">Counted</h1>

<p align="center">
  Privacy-first product analytics — funnels and composable dashboards.<br/>
  No tracking cookies. No fingerprinting. No PII in analytics.
</p>

<p align="center">
  <a href="https://counted.dev">Website</a> ·
  <a href="https://app.counted.dev">Dashboard</a> ·
  <a href="https://docs.counted.dev">API docs</a> ·
  <a href="https://www.npmjs.com/package/@counted/sdk">npm</a>
</p>

---

## Quick Start

```bash
npm install @counted/sdk@^2
```

```typescript
import { Counted } from "@counted/sdk";

const counted = new Counted({ key: "YOUR_INGEST_KEY" });
counted.track("page_view", { path: "/" });
await counted.flush();
```

### React

```bash
npm install @counted/react@^2 @counted/sdk@^2
```

```tsx
import { AnalyticsProvider, useAnalytics } from "@counted/react";

function App() {
  return (
    <AnalyticsProvider projectKey="YOUR_INGEST_KEY">
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
- **Composable dashboards** — build your own view with Insights: totals, trends, and property breakdowns. Combine events, split trends by a property, or break a measure down by up to three properties.
- **Privacy by design** — no analytics cookies, no IP storage, no fingerprinting
- **Geography without tracking** — country is worked out from the request address at ingest and the address is discarded in the same breath; nothing finer than a country is ever derived or stored
- **JavaScript SDK** — no runtime dependencies

## What Counted Analytics Does NOT Do

- Set cookies or use localStorage for tracking
- Store IP addresses or collect personal data through the SDK; do not send personal data in event properties
- Derive anything finer than a country from an address — no city, no region, no coordinates, no ASN
- Send an address to a third party: the country lookup is a table in the process, not a service call
- Fingerprint browsers (no canvas, WebGL, font probing)
- Auto-track without explicit opt-in
- Sell or share data with third parties

The Counted console has separate account data: an email address, display name,
verification state, and a password hash when you set a password. Login uses
necessary authentication cookies. Optional Google or GitHub sign-in exchanges
profile information and tokens with the provider you choose; it does not send
your analytics events to that provider. See [authentication and privacy](SECURITY.md#authentication-and-privacy).

## What Counted Records

An event carries the name you gave it, your own properties, a visit id the SDK
holds in memory, and eight attributes Counted can slice by:

| | Where it comes from |
|---|---|
| `event_type` | the name you passed to `track()` |
| `os_name`, `os_version` | the SDK, canonicalised server-side |
| `locale`, `app_version`, `device_model`, `sdk_version` | the SDK |
| `country` | **derived at ingest from the request address, which is then discarded** |

`country` is the only one Counted works out rather than being told, and it is
the reason the list above is worth reading closely. The address is read from one
header, turned into a two-letter ISO code by a lookup table inside the server,
and is not written to a log, a column, or a hash. A client cannot set the field:
a `country` in an SDK payload is ignored, because a client that could write to
it could write an address into it.

The lookup is the regional internet registries' own delegation data — an
allocation-level answer, so a multinational carrier's block reads as the country
it was registered in and a VPN reads as its exit node. That is a coarse, honest
slice, and it is deliberately not a location.

An event whose address cannot be placed — a private range, an unreadable header,
space no registry has delegated — has no country at all, and is simply absent
from a country breakdown rather than sitting in a bucket called "unknown".

## Self-Hosting

With Docker Compose:

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
| [`@counted/sdk`](packages/sdk-js) | JavaScript event tracking | — |
| [`@counted/react`](packages/react) | React provider + hook | ~1KB |
| [`@counted/claude-code`](packages/agent-claude-code) | Claude Code plugin | ~2KB |
| [`@counted/opencode`](packages/agent-opencode) | OpenCode plugin | ~2KB |
| [`@counted/agent-telemetry`](packages/agent-telemetry) | Agent telemetry library and `counted-agent` hook CLI | — |
| [`counted`](packages/python) | Python SDK · `pip install counted` | — |
| [`counted`](packages/go) | Go SDK · `go get github.com/iceglober/counted/packages/go/v2` | — |
| [`counted-sdk`](packages/rust) | Rust SDK · `cargo add counted-sdk` | — |

## Migrating from Aptabase

```bash
# JavaScript: move to the native Counted client shown above
npm remove @aptabase/web
npm install @counted/sdk
# Replace initialization with new Counted({ key: "YOUR_INGEST_KEY" })

# React: native API or @counted/react/aptabase compatibility provider
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

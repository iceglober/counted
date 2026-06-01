# @counted/sdk

Privacy-first event tracking. No cookies, no fingerprinting, no PII. Under 3KB gzipped.

## Install

```bash
npm install @counted/sdk
```

## Usage

```typescript
import { Analytics } from "@counted/sdk";

const analytics = new Analytics({
  projectKey: "A-US-...",
  host: "https://app.counted.dev", // optional, defaults to counted.dev
});

analytics.track("page_view", { path: "/" });
analytics.track("button_click", { id: "signup-cta" });
```

## Options

```typescript
new Analytics({
  projectKey: string;       // required — from your project settings
  host?: string;            // default: "https://counted.dev"
  flushInterval?: number;   // default: 30000 (30s)
  maxBatchSize?: number;    // default: 50
});
```

## What it does NOT do

- Set cookies or use localStorage
- Store IP addresses
- Fingerprint browsers
- Auto-track without opt-in

## Migrating from Aptabase

```typescript
// Drop-in replacement — same API
import { init, trackEvent } from "@counted/sdk/aptabase";

init("A-US-...");
trackEvent("page_view", { path: "/" });
```

## License

MIT

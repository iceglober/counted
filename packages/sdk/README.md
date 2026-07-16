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
  projectKey: "ck_...", // client key from your project settings
});

analytics.track("page_view", { path: "/" });
analytics.track("button_click", { id: "signup-cta" });
```

The default host is `https://app.counted.dev`. Pass `host` to point at a
self-hosted or custom ingestion endpoint.

## Auto-track page views

Page-view tracking is opt-in. Enable it with the `autoTrack` option (browser
only) — it records an initial page view and one on every SPA route change
(`pushState`/`replaceState`/`popstate`):

```typescript
const analytics = new Analytics({ projectKey: "ck_...", autoTrack: true });
```

Prefer to wire it up yourself? Import the standalone helper and keep the
returned cleanup function:

```typescript
import { Analytics } from "@counted/sdk";
import { autoTrack } from "@counted/sdk/auto-track";

const analytics = new Analytics({ projectKey: "ck_..." });
const stop = autoTrack(analytics); // call stop() to detach
```

## Options

| Option          | Type              | Default                       | Description                                                        |
| --------------- | ----------------- | ----------------------------- | ------------------------------------------------------------------ |
| `projectKey`    | `string`          | —                             | Required. Client key (starts with `ck_`; legacy `A-US-` accepted). |
| `host`          | `string`          | `https://app.counted.dev`     | Ingestion host.                                                    |
| `flushInterval` | `number`          | `30000`                       | Timer flush interval in ms.                                        |
| `maxBatchSize`  | `number`          | `50`                          | Events per request. Capped at 50 (server limit).                   |
| `sessionId`     | `string`          | generated                     | Pin a session id instead of generating one.                        |
| `sessionTimeout`| `number`          | `1800000`                     | Idle ms before a new session id is minted. `0` disables rollover.  |
| `appVersion`    | `string`          | `null`                        | App version reported in system props (Aptabase compatibility).     |
| `autoTrack`     | `boolean`         | `false`                       | Browser only: auto-track page views on route changes.              |
| `debug`         | `boolean`         | `false`                       | Log each track/flush to the console.                               |
| `context`       | `EventProperties` | `{}`                          | Registered ("super") props merged into every event.                |

## Short-lived processes

In a CLI, script, or serverless handler that exits quickly, events may still be
buffered. Call and **await** `destroy()` before exit to drain them:

```typescript
const analytics = new Analytics({ projectKey: "ck_..." });
analytics.track("job_finished", { status: "ok" });

await analytics.destroy(); // stops timers, removes listeners, flushes remaining events
```

`flush()` drains the whole buffer in batches, so more than 50 buffered events
are all sent. On a network failure the un-sent batch is re-queued (bounded) so a
transient error doesn't drop data.

## What it does NOT do

- Set cookies or use localStorage
- Store IP addresses
- Fingerprint browsers
- Auto-track without opt-in

## Migrating from Aptabase

Drop-in shim with the same call shape as `@aptabase/js`:

```typescript
import { init, trackEvent } from "@counted/sdk/aptabase";

init("ck_...", { appVersion: "1.0.0" });
trackEvent("page_view", { path: "/" });
```

## License

MIT

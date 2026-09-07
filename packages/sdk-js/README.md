# @counted/sdk

Counted’s JavaScript SDK for browsers and Node.js. Events use an in-memory visit id; the SDK does not set cookies or persist a tracking identifier.

```sh
npm install @counted/sdk@^2
```

```ts
import { Counted } from "@counted/sdk";

const counted = new Counted({ key: "YOUR_INGEST_KEY" });
counted.track("page_view", { path: "/welcome" });
await counted.flush();
```

The default endpoint is `https://api.counted.dev/v1/events`. For a self-hosted installation, set `endpoint` to the full events URL.

Use an ingest key from your project. Service keys must never be included in browser bundles. Send route paths without personal data, query strings, or URL fragments. Call `identify()` only with an opaque, customer-owned identifier; Counted never derives an identity.

Call `reset()` when a person signs out. In scripts and serverless handlers, `await counted.shutdown()` flushes remaining events and stops timers. `onDiagnostic` reports quota, rejected events, invalid credentials, and queue overflow.

Version 2 replaces the version 1 `Analytics`/`init` API with `new Counted({ key })` and uses `/v1/events`. Update the initialization code when upgrading from 0.x. [Documentation](https://docs.counted.dev).

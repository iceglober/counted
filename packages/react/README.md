# @counted/react

React hooks for [@counted/sdk](https://www.npmjs.com/package/@counted/sdk). Privacy-first event tracking with zero config.

## Install

```bash
npm install @counted/react
```

## Usage

```tsx
import { AnalyticsProvider, useAnalytics } from "@counted/react";

function App() {
  return (
    <AnalyticsProvider projectKey="ck_...">
      <MyApp />
    </AnalyticsProvider>
  );
}

function SignupButton() {
  const { track } = useAnalytics();
  return <button onClick={() => track("signup_click")}>Sign Up</button>;
}
```

## Migrating from Aptabase

Same API as `@aptabase/react` — change only the import path:

```tsx
// import { AptabaseProvider } from "@aptabase/react";
import { AptabaseProvider } from "@counted/react/aptabase";

root.render(
  <AptabaseProvider appKey="A-US-0000000000">
    <App />
  </AptabaseProvider>
);
```

```tsx
// import { useAptabase } from "@aptabase/react";
import { useAptabase } from "@counted/react/aptabase";

const { trackEvent } = useAptabase();
trackEvent("save_settings", { theme: "dark" });
```

## License

MIT

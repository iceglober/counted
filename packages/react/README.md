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

## Migrating from Aptabase

```tsx
// Drop-in replacement
import { AptabaseProvider, useAptabase } from "@counted/react/aptabase";
// Same API as @aptabase/react
```

## License

MIT

import { Analytics } from "@counted/sdk";

// Counted dogfooding its own marketing site. Lazily creates the client browser
// SDK from NEXT_PUBLIC_COUNTED_KEY (no-op if unset). Only call from client
// handlers/effects so the instance is created in the browser, never during SSR.
let instance: Analytics | null = null;
let tried = false;

function client(): Analytics | null {
  if (tried) return instance;
  tried = true;
  const key = process.env.NEXT_PUBLIC_COUNTED_KEY;
  if (key) {
    instance = new Analytics({ projectKey: key, host: "https://app.counted.dev" });
  }
  return instance;
}

export function track(event: string, props?: Record<string, string | number | boolean>) {
  try {
    client()?.track(event, props);
  } catch {
    /* analytics must never break the page */
  }
}

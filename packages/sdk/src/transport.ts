import type { RawEvent } from "./types";

export function sendBeacon(url: string, events: RawEvent[]): boolean {
  if (typeof globalThis.navigator?.sendBeacon === "function") {
    const blob = new Blob([JSON.stringify(events)], {
      type: "application/json",
    });
    return globalThis.navigator.sendBeacon(url, blob);
  }
  return false;
}

export async function sendFetch(
  url: string,
  events: RawEvent[],
  appKey: string,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "App-Key": appKey,
      },
      body: JSON.stringify(events.length === 1 ? events[0] : events),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

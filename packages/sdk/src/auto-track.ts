import { Analytics } from "./analytics";

/**
 * Auto-track page views on route changes.
 * Works with SPAs (pushState/popstate) and traditional navigation.
 * Opt-in — call autoTrack(analytics) to enable.
 *
 * ```ts
 * import { Analytics } from "@counted/sdk";
 * import { autoTrack } from "@counted/sdk/auto-track";
 *
 * const analytics = new Analytics({ projectKey: "ck_..." });
 * autoTrack(analytics);
 * ```
 */
export function autoTrack(analytics: Analytics): () => void {
  if (typeof window === "undefined") return () => {};

  let lastUrl = window.location.href;

  function trackPageView() {
    const url = window.location.href;
    if (url === lastUrl) return;
    lastUrl = url;

    const { pathname, search } = window.location;
    analytics.track("page_view", {
      path: pathname,
      search: search || undefined,
      referrer: document.referrer || undefined,
      title: document.title || undefined,
    });
  }

  // Track initial page view
  analytics.track("page_view", {
    path: window.location.pathname,
    search: window.location.search || undefined,
    referrer: document.referrer || undefined,
    title: document.title || undefined,
  });

  // Intercept pushState and replaceState
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    origPushState(...args);
    trackPageView();
  };

  history.replaceState = function (...args) {
    origReplaceState(...args);
    trackPageView();
  };

  // Listen for popstate (back/forward)
  window.addEventListener("popstate", trackPageView);

  // Cleanup function
  return () => {
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
    window.removeEventListener("popstate", trackPageView);
  };
}

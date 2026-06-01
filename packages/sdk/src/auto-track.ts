import { Analytics } from "./analytics";
import type { EventProperties } from "./types";

/** Build page-view props, omitting empty values (props can't hold undefined). */
function pageViewProps(): EventProperties {
  const props: EventProperties = { path: window.location.pathname };
  const { search } = window.location;
  if (search) props.search = search;
  if (document.referrer) props.referrer = document.referrer;
  if (document.title) props.title = document.title;
  return props;
}

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

    analytics.track("page_view", pageViewProps());
  }

  // Track initial page view
  analytics.track("page_view", pageViewProps());

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

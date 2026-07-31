"use client";

import { useState } from "react";

/**
 * Refresh a shared dashboard, without ever holding its token.
 *
 * This component is given nothing. It reads `window.location.pathname` and
 * posts to the same-origin BFF beneath it — so the credential exists in the
 * address bar, where the link already put it, and nowhere in this code. There
 * is no prop to leak into the HTML and no header to build.
 *
 * If it took the token as a prop, that prop would be serialized into the page
 * for hydration, which is the exact thing the whole design avoids.
 */
export const ShareControls = () => {
  const [state, setState] = useState<"idle" | "refreshing" | "gone">("idle");

  const refresh = async () => {
    setState("refreshing");
    // `/share/<token>` → `/bff/share/<token>/render`. Derived from the path
    // rather than passed in, which is what keeps this component tokenless.
    const response = await fetch(`/bff${window.location.pathname}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    if (response.ok) {
      // The server re-renders. Reloading is cheaper than a second copy of the
      // tile-rendering logic living in the browser.
      window.location.reload();
      return;
    }
    // A link revoked while somebody had the page open. Saying so beats a
    // refresh button that silently stops working.
    setState("gone");
  };

  if (state === "gone") {
    return (
      <p className="tile-error" role="alert">
        This link is no longer available. Whoever shared it may have revoked it.
      </p>
    );
  }

  return (
    <p>
      <button type="button" onClick={refresh} disabled={state === "refreshing"}>
        {state === "refreshing" ? "Refreshing…" : "Refresh"}
      </button>
    </p>
  );
};

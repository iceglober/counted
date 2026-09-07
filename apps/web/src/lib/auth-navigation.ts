/** Accept only a local page path, including its query and fragment. */
export const safeNext = (input: unknown, fallback = "/"): string => {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//") || /[\\\u0000-\u0020]/.test(input)) return fallback;
  try {
    const parsed = new URL(input, "https://console.invalid");
    if (parsed.origin !== "https://console.invalid") return fallback;
    // Authentication endpoints must never be triggered by a post-login URL.
    if (parsed.pathname.startsWith("/api/") || parsed.pathname === "/sign-in") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return fallback; }
};

export const signInPath = (next: unknown): string => `/sign-in?${new URLSearchParams({ next: safeNext(next) })}`;

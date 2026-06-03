import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type, Project-Key, App-Key",
  "Access-Control-Max-Age": "86400",
};

const MARKETING_HOSTS = new Set(["counted.dev", "www.counted.dev"]);
const APP_HOST = "app.counted.dev";

const MARKETING_PATHS = new Set([
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/sitemap.xml",
  "/robots.txt",
  "/feed.xml",
  // Share images live at the app root but are referenced from the marketing
  // host's metadata — serve them here so OG crawlers don't chase a redirect.
  "/opengraph-image",
  "/twitter-image",
  "/og", // dynamic per-page share image (/og?title=…)
]);

// Marketing content also lives under these prefixes (comparisons, /for, blog).
const MARKETING_PREFIXES = ["/vs/", "/for/", "/blog"];

function isMarketingPath(pathname: string): boolean {
  if (MARKETING_PATHS.has(pathname)) return true;
  return MARKETING_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

// Public, browser-callable API paths. They must be served same-origin with CORS
// from the marketing host too — otherwise the marketing site's fetch gets
// redirected to the app host and the cross-origin POST is blocked (no ACAO).
const PUBLIC_API_PATHS = new Set([
  "/api/v0/event",
  "/api/v0/events",
  "/api/v0/provision",
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";

  // CORS for public ingestion / provisioning endpoints.
  if (PUBLIC_API_PATHS.has(pathname)) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }
    const response = NextResponse.next();
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }

  // Marketing domain: only serve marketing pages, redirect everything else to
  // app — preserving the query string so attribution params survive the hop.
  if (MARKETING_HOSTS.has(host)) {
    if (!isMarketingPath(pathname) && !pathname.startsWith("/_next") && !pathname.startsWith("/icon")) {
      return NextResponse.redirect(new URL(pathname + request.nextUrl.search, `https://${APP_HOST}`));
    }
  }

  // App domain: redirect / to /dashboards
  if (host === APP_HOST && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboards", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/v0/event",
    "/api/v0/events",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

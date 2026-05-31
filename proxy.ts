import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type, App-Key",
  "Access-Control-Max-Age": "86400",
};

const MARKETING_HOSTS = new Set(["counted.dev", "www.counted.dev"]);
const APP_HOST = "app.counted.dev";

const MARKETING_PATHS = new Set(["/", "/pricing"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";

  // CORS for event ingestion
  if (pathname === "/api/v0/event" || pathname === "/api/v0/events") {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }
    const response = NextResponse.next();
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }

  // Marketing domain: only serve marketing pages, redirect everything else to app
  if (MARKETING_HOSTS.has(host)) {
    if (!MARKETING_PATHS.has(pathname) && !pathname.startsWith("/_next") && !pathname.startsWith("/icon")) {
      return NextResponse.redirect(new URL(pathname, `https://${APP_HOST}`));
    }
  }

  // App domain: redirect / to /dashboard
  if (host === APP_HOST && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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

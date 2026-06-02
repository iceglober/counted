import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { generateClientKey, generateServerKey } from "@/lib/api-key";
import { rateLimit } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";

// Public, no auth: mints an ANONYMOUS project + a write-only client key so an
// agent can instrument a codebase with zero signup. The project has no members
// until a human opens the claimUrl and signs up to adopt it.
//
// Guardrails: strict per-IP rate limit here; the client key is ingestion-only
// (can't read data); unclaimed projects stop ingesting after 7 days (enforced
// in the event route) so abandoned/abuse keys self-disable.
export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // 10 anonymous projects per IP per hour.
  const limit = rateLimit(`provision:${ip}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } },
    );
  }

  const claimToken = randomBytes(24).toString("hex");
  const [project] = await db
    .insert(projects)
    .values({
      name: "My App",
      apiKey: generateClientKey(),
      clientKey: generateClientKey(),
      serverKey: generateServerKey(),
      claimToken,
    })
    .returning();

  const origin = request.nextUrl.origin;
  return NextResponse.json({
    clientKey: project.clientKey,
    claimUrl: `${origin}/claim/${claimToken}`,
    dashboardUrl: `${origin}/dashboards`,
  });
}

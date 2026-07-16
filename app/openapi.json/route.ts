import { NextResponse } from "next/server";
import { spec } from "@/lib/openapi";

// Discoverable OpenAPI at /openapi.json (the app also serves it at
// /api/v0/openapi.json; this is the predictable, robots-allowed location agents
// probe first).
export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

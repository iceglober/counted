import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateClientKey, generateServerKey } from "@/lib/api-key";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireProjectAccess(id);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (access.membership!.role !== "owner") {
    return NextResponse.json({ error: "Only owners can rotate keys" }, { status: 403 });
  }

  const { type = "client" } = await request.json().catch(() => ({ type: "client" }));

  const update = type === "server"
    ? { serverKey: generateServerKey() }
    : { clientKey: generateClientKey(), apiKey: generateClientKey() };

  const [result] = await db
    .update(projects)
    .set(update)
    .where(eq(projects.id, id))
    .returning();

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    clientKey: result.clientKey,
    serverKey: result.serverKey,
  });
}

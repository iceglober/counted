import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateApiKey } from "@/lib/api-key";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [result] = await db
    .update(projects)
    .set({ apiKey: generateApiKey() })
    .where(eq(projects.id, id))
    .returning();

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ apiKey: result.apiKey });
}

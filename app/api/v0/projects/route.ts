import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { generateApiKey } from "@/lib/api-key";

export async function GET() {
  const result = await db.query.projects.findMany();
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [result] = await db
    .insert(projects)
    .values({
      name,
      apiKey: generateApiKey(),
    })
    .returning();

  return NextResponse.json(result, { status: 201 });
}

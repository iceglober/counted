import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { magicLinks, users } from "@/lib/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const link = await db.query.magicLinks.findFirst({
    where: and(
      eq(magicLinks.token, token),
      gt(magicLinks.expiresAt, new Date()),
      isNull(magicLinks.usedAt),
    ),
  });

  if (!link) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
  }

  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  let user = await db.query.users.findFirst({
    where: eq(users.email, link.email),
  });

  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: link.email })
      .returning();
  }

  // TODO: set session cookie
  return NextResponse.redirect(new URL("/", request.url));
}

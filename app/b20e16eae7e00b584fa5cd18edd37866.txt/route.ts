import { INDEXNOW_KEY } from "@/lib/indexnow";

// IndexNow ownership-verification key file, served at /<key>.txt.
export const dynamic = "force-static";

export function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

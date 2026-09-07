import { docsOrigin } from "../../../lib/site";
import { overviewMarkdown, markdownResponse } from "../../../lib/site-markdown";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const path = (await params).path?.join("/") ?? "";
  if (path === "llms.txt" || path === "api/llms.txt") return markdownResponse(overviewMarkdown(), "text/plain");
  return Response.redirect(path === "getting-started" ? `${docsOrigin()}/getting-started` : docsOrigin(), 308);
}

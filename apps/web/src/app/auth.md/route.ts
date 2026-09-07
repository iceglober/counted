import { authMarkdown, markdownResponse } from "../../lib/site-markdown";
export const dynamic = "force-dynamic";
export function GET(): Response { return markdownResponse(authMarkdown(), "text/markdown"); }

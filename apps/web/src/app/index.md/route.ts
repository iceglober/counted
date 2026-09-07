import { overviewMarkdown, markdownResponse } from "../../lib/site-markdown";
export const dynamic = "force-dynamic";
export function GET(): Response { return markdownResponse(overviewMarkdown(), "text/markdown"); }

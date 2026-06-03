import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { AgentEvalPost, CLAUDE_CODE } from "../agent-eval-template";

const meta = getPost("claude-code-eval-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return <AgentEvalPost meta={meta} tool={CLAUDE_CODE} />;
}

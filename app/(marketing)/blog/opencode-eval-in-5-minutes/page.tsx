import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { AgentEvalPost, OPENCODE } from "../agent-eval-template";

const meta = getPost("opencode-eval-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return <AgentEvalPost meta={meta} tool={OPENCODE} />;
}

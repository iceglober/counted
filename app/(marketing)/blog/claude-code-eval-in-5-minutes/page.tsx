import type { Metadata } from "next";
import { getPost } from "../posts";
import { AgentEvalPost, CLAUDE_CODE } from "../agent-eval-template";

const meta = getPost("claude-code-eval-in-5-minutes")!;

export const metadata: Metadata = {
  title: `${meta.title} — Counted`,
  description: meta.description,
  alternates: { canonical: `/blog/${meta.slug}` },
  openGraph: { title: meta.title, description: meta.description, url: `/blog/${meta.slug}`, type: "article" },
};

export default function Post() {
  return <AgentEvalPost meta={meta} tool={CLAUDE_CODE} />;
}

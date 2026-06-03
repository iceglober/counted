import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, H2 } from "../post-layout";

const meta = getPost("what-ai-native-means")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        &ldquo;AI-native&rdquo; is on so many landing pages now that it&apos;s stopped meaning much.
        Usually it describes a chatbot bolted into the corner of an app that was built the same way it
        always was. I think the phrase can mean something specific — and the best test of whether a
        product earns it has almost nothing to do with the chat box.
      </Lead>

      <H2>The bolt-on test</H2>
      <P>
        Here&apos;s a quick way to tell a bolt-on from the real thing: take the AI feature out and see
        what breaks. Delete the &ldquo;Ask AI&rdquo; button, and if the product is otherwise the same,
        the AI was a feature, not a foundation. That&apos;s fine — plenty of good software ships a
        useful assistant. It just isn&apos;t native, the way a phone mount doesn&apos;t make a car a
        smartphone.
      </P>
      <P>
        AI-native means the agent is a first-class actor in the system. It does work a user would
        otherwise do. It has goals, takes actions, succeeds and fails. Once you treat an agent as an
        actor, a question follows that&apos;s easy to skip: how do you see what it did?
      </P>

      <H2>You measure your users. You don&apos;t measure your agents.</H2>
      <P>
        Think about how much you instrument to understand human users. Clicks, signups, funnel steps,
        drop-off — all captured and charted, because you can&apos;t improve what you can&apos;t see.
        That&apos;s the whole reason product analytics exists.
      </P>
      <P>
        Now look at the agents in your product: the coding agent, the support agent, the workflow that
        fans a task across a dozen tool calls. They&apos;re doing real work, and for most teams that
        work is dark. You can&apos;t answer three basic questions — what did the agent do, where did it
        fail, is it getting better over time. If an agent&apos;s behavior only shows up in a buried log
        line, you&apos;re running a worker you can&apos;t observe and can&apos;t evaluate.
      </P>
      <P>
        The chat box hides this. The hard part of AI-native isn&apos;t the UI. It&apos;s that
        you&apos;ve added a new kind of actor and your measurement stack doesn&apos;t know it exists.
      </P>

      <H2>An agent&apos;s actions are just events</H2>
      <P>
        You don&apos;t need a separate &ldquo;AI observability&rdquo; category to fix that. An
        agent&apos;s actions have the same shape as the events you already track. A user signs up; an
        agent calls a tool. A user finishes a funnel; an agent finishes a task across five steps. Same
        primitive, different actor:
      </P>
      <div className="mt-3">
        <CodeBlock>{`// a human action
track("signup", { plan: "pro" });

// an agent action — same shape, same pipeline
track("tool_use", { tool: "edit_file", outcome: "success" });`}</CodeBlock>
      </div>
      <P>
        Once agent activity is events, everything you do with analytics applies to it. Funnels become
        task-completion rates. Retention becomes whether a run recovers from a failed step. Breakdowns
        let you compare two prompts, or two models, on one chart. An eval stops being a one-off script
        and becomes a dashboard you watch like you watch signups. You&apos;re not standing up a new
        silo. You&apos;re pointing the event model you already have at a new kind of user.
      </P>

      <H2>Native doesn&apos;t mean surveilled</H2>
      <P>
        One trap to avoid. Agents emit a lot of detail, and the lazy move is to capture everything —
        full prompts, user content, identities — and sort it out later. That&apos;s how an eval
        pipeline turns into a privacy liability. It&apos;s the same mistake the cookie era made with
        humans.
      </P>
      <P>
        You don&apos;t need to know who to know how well. Completion rate, failure modes, regressions
        between versions — those come from the shape of events, not from personal data riding inside
        them. Agent analytics should be privacy-first for the same reason human analytics should be:
        less risk, and usually all you needed.
      </P>

      <H2>So is your product AI-native?</H2>
      <P>
        Skip the chat box and ask the measurement version of the question. Can you pull up, right now,
        what your agents did this week, where they failed, and whether last week&apos;s change made them
        better or worse? If yes, the agent is a real actor in your product. If no, you&apos;ve added a
        worker you can&apos;t see.
      </P>
      <P>
        Counted is built on the bet that this is where things go: one event model for your users and
        your agents, no cookies or PII on either side, the same dashboards over both. For the concrete
        version, the{" "}
        <a href="/blog/claude-code-eval-in-5-minutes" className="text-accent hover:text-accent-hover transition-colors">
          five-minute Claude Code eval
        </a>{" "}
        turns an agent&apos;s actions into a dashboard you can read.
      </P>
    </PostLayout>
  );
}

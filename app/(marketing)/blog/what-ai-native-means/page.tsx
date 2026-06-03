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
        &ldquo;AI-native&rdquo; has been slapped on so many landing pages that it&apos;s starting to
        mean nothing. Most of the time it describes a chatbot bolted into the corner of an app that
        was built the same way it always was. I think the phrase deserves a sharper definition — and
        the sharpest test of whether a product earns it has almost nothing to do with the chat box.
      </Lead>

      <H2>The bolt-on test</H2>
      <P>
        Here&apos;s the quickest way to tell a bolt-on from the real thing: remove the AI feature and
        see what changes. If you delete the &ldquo;Ask AI&rdquo; button and the product is otherwise
        identical, the AI was a feature, not a foundation. That&apos;s fine — plenty of good software
        adds a useful assistant. But it isn&apos;t <em>native</em>, any more than a car with a phone
        mount is a smartphone-native vehicle.
      </P>
      <P>
        AI-native means the agent is a <strong>first-class actor</strong> in the system, not a
        guest. It does work a user would otherwise do. It has goals, takes actions, succeeds and
        fails. And the moment you accept that an agent is an actor in your product, an awkward
        question follows: how do you <em>see</em> what it did?
      </P>

      <H2>You already measure your users. You&apos;re not measuring your agents.</H2>
      <P>
        Think about how much instrumentation goes into understanding human users. Every click,
        signup, funnel step, and drop-off is an event you capture and chart, because you can&apos;t
        improve what you can&apos;t see. Product analytics exists for exactly this reason.
      </P>
      <P>
        Now look at the agents in your product — the coding agent, the support agent, the workflow
        that fans out a task across a dozen tool calls. They are doing real work, and for most teams
        that work is completely dark. You can&apos;t answer the three questions that actually matter:{" "}
        <strong>What did the agent do? Where did it fail? Is it getting better over time?</strong> If
        the only place an agent&apos;s behavior shows up is a buried log line, you&apos;re running a
        worker you can&apos;t observe and can&apos;t evaluate.
      </P>
      <P>
        This is the gap that the &ldquo;chatbot in the corner&rdquo; framing hides. The interesting
        AI-native problem isn&apos;t the chat UI. It&apos;s that you&apos;ve added a new class of
        actor to your product and your measurement stack has no concept of it.
      </P>

      <H2>An agent&apos;s actions are just events</H2>
      <P>
        The good news is that you don&apos;t need a separate, exotic &ldquo;AI observability&rdquo;
        category to close the gap. An agent&apos;s actions have exactly the shape of the events you
        already track. A user signs up; an agent calls a tool. A user completes a funnel; an agent
        finishes a task across five steps. Same primitive, different actor:
      </P>
      <div className="mt-3">
        <CodeBlock>{`// a human action
track("signup", { plan: "pro" });

// an agent action — same shape, same pipeline
track("tool_use", { tool: "edit_file", outcome: "success" });`}</CodeBlock>
      </div>
      <P>
        Once agent activity is just events, everything you already know how to do with analytics
        applies to it: funnels become agent task-completion rates, retention becomes whether a run
        recovers from a failed step, breakdowns let you compare two prompts or two models on the same
        chart. An eval stops being a one-off script and becomes a live dashboard you watch the way you
        watch signups. That&apos;s the real promise of &ldquo;AI-native&rdquo; measurement: not a new
        silo, but the <em>same</em> event model extended to a new kind of user.
      </P>

      <H2>Native doesn&apos;t mean surveilled</H2>
      <P>
        There&apos;s a trap here worth naming. Because agents emit so much detail, the lazy instinct
        is to capture everything — full prompts, user content, identities, the lot — and sort it out
        later. That&apos;s how you turn an eval pipeline into a privacy liability, and it&apos;s the
        same mistake the cookie-tracking era made with humans.
      </P>
      <P>
        You don&apos;t need to know <em>who</em> to know <em>how well</em>. The questions that move
        the product — completion rate, failure modes, regressions between versions — are answered by
        the shape of events, not by personal data riding along inside them. AI-native analytics
        should be privacy-first for the same reason human analytics should be: it&apos;s more honest,
        it&apos;s less risk, and it&apos;s usually all you actually needed.
      </P>

      <H2>So: is your product AI-native?</H2>
      <P>
        Forget the chat box for a second and ask the measurement version of the question. Can you pull
        up, right now, what your agents did this week, where they failed, and whether last
        week&apos;s change made them better or worse? If yes, the agent is genuinely a first-class
        actor in your product. If no, you&apos;ve added a worker you can&apos;t see — and no amount of
        &ldquo;AI&rdquo; in the marketing copy changes that.
      </P>
      <P>
        Counted is built on the bet that this is where things are heading: one event model for your
        users and your agents, no cookies and no PII on either side, and the same composable
        dashboards over both. If you want the concrete version, the{" "}
        <a href="/blog/claude-code-eval-in-5-minutes" className="text-accent hover:text-accent-hover transition-colors">
          five-minute Claude Code eval
        </a>{" "}
        walks through turning an agent&apos;s actions into a dashboard you can actually read.
      </P>
    </PostLayout>
  );
}

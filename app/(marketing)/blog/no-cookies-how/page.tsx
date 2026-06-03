import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, H2 } from "../post-layout";

const meta = getPost("no-cookies-how")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        No cookie. No localStorage ID. No fingerprint. So what does Counted use to tell one visit from
        another? A session ID that lives in memory and nowhere else. This post is how that works, what
        you can measure with it, and where it falls short.
      </Lead>

      <H2>What a cookie is for</H2>
      <P>
        A tracking cookie stores an ID in the browser. That ID lets the tool recognize the same
        browser later — the next page, the next day, sometimes on a different site. Persistent
        recognition is what powers &ldquo;unique visitors,&rdquo; multi-day retention, and one
        person&apos;s journey across visits. It&apos;s also what makes the cookie personal data, and
        why setting one means you owe people a consent banner.
      </P>
      <P>
        Drop the persistent ID and you lose those specific reports. You also lose the banner. The
        question is whether that trade is worth it. For most product analytics, I think it is.
      </P>

      <H2>The session ID, and where it lives</H2>
      <P>
        When a Counted SDK starts, it generates a random session ID and keeps it in memory. It lasts
        as long as the tab or the process, and every event from that runtime carries it, so a single
        visit&apos;s events line up into a funnel. It is never written to a cookie, to localStorage, or
        to disk. Close the tab and it&apos;s gone — there&apos;s nothing on disk to rebuild it from.
      </P>
      <div className="mt-3">
        <CodeBlock>{`// on SDK start:
const sessionId = randomId();   // in memory only
// ...groups this visit's events...
// tab closes / process exits -> gone for good`}</CodeBlock>
      </div>
      <P>You&apos;re counting visits and events, not people. A session is one visit, not one person over time.</P>

      <H2>What about my IP?</H2>
      <P>
        Your server sees every visitor&apos;s IP. That&apos;s how HTTP works, and any tool that claims
        otherwise is confused. What matters is what it does with it.
      </P>
      <P>
        Counted uses the IP for one thing: rate-limiting. It sits in the rate limiter&apos;s memory for
        a few seconds, then it&apos;s dropped. It is not written to disk, not logged, not stored next
        to your events, and not used to build the session ID. There&apos;s no geo lookup and no hashing
        it into a quiet stand-in for the cookie. That last move — turning the IP into a fingerprint —
        is the one to check for in any tool that calls itself cookieless.
      </P>

      <H2>What you can measure</H2>
      <P>
        Plenty. Event counts and trends. Funnels and drop-off inside a visit. Which features get used
        and which don&apos;t. Breakdowns by the coarse fields the SDK sends — OS, locale, app version,
        device model — plus any non-personal properties you add. For an agent, you set the session ID
        yourself per run, so a whole multi-step task groups together and reads as a completion funnel.
        If your question is whether the product is getting better, this is enough data to answer it.
      </P>

      <H2>What it costs you</H2>
      <P>This isn&apos;t free. Four things you give up:</P>
      <P>
        <strong>Cross-session and cross-device identity.</strong> You can&apos;t follow one person from
        Monday to Friday, or from their laptop to their phone. You see visits.
      </P>
      <P>
        <strong>&ldquo;Unique users&rdquo; really means &ldquo;sessions.&rdquo;</strong> New-vs-returning,
        keyed to a real identity, isn&apos;t there by default. There&apos;s no identity to key it to.
      </P>
      <P>
        <strong>Retroactive lookups.</strong> &ldquo;What did customer X do last week&rdquo; isn&apos;t
        a question analytics can answer. Use your app&apos;s own logs for that, where you have an
        account and a reason to.
      </P>
      <P>
        <strong>Attribution gets coarser.</strong> No third-party-cookie attribution. On our own site
        we keep UTM and referrer in first-party localStorage that never leaves the browser.
      </P>

      <H2>When to use something else</H2>
      <P>
        If your business runs on tracking individuals over a lifetime — per-user retention cohorts tied
        to a real identity, say — a cookie-based tool will serve you better, and I&apos;d rather tell
        you that than talk you into the wrong fit. Counted is for the more common case: understanding
        the product, not the person. Did the funnel improve, which features matter, is the agent
        getting better, can I ship to privacy-sensitive users without a banner.
      </P>
      <P>
        And if you do have an identity you&apos;re allowed to use, set the session ID to it yourself.
        Counted won&apos;t invent one for you, and it won&apos;t stop you either. The default is
        ephemeral; anything past that is your call.
      </P>
    </PostLayout>
  );
}

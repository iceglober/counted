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
        No cookies. No localStorage id. No device fingerprint. So how does Counted count anything at
        all? The honest answer is an ephemeral, in-memory session — and a deliberate decision to give
        up identity. Here&apos;s exactly how it works, and the tradeoffs that come with it.
      </Lead>

      <H2>What a cookie actually does in analytics</H2>
      <P>
        Strip away the branding and a tracking cookie does one job: it stores a persistent identifier
        in your browser so the same visitor can be <em>re-recognized</em> later — tomorrow, next week,
        on another page, sometimes on another site. That persistence is what powers
        &ldquo;unique users,&rdquo; long-term retention curves, and cross-session journeys. It&apos;s
        also the exact thing that makes a cookie personal data, and the reason you owe a consent
        banner the moment you set one.
      </P>
      <P>
        So the design question is simple: can you answer useful product questions <em>without</em> a
        durable per-person identifier? For the large majority of them, yes.
      </P>

      <H2>What we do instead: an ephemeral session</H2>
      <P>
        When a Counted SDK starts, it generates a random session id <strong>in memory</strong>. It
        lives as long as the tab or the process does, and it&apos;s shared across SDK instances in
        that runtime so the events of one visit connect into a funnel. Nothing is written to a cookie,
        to localStorage, or to disk. When the tab closes or the process exits, the id is gone — there
        is no way to reconstruct it, because it was never stored anywhere.
      </P>
      <div className="mt-3">
        <CodeBlock>{`// conceptually, on SDK start:
const sessionId = randomId();   // in memory only
// ...used to group this visit's events...
// tab closes / process exits -> sessionId is gone forever`}</CodeBlock>
      </div>
      <P>
        The consequence is that you&apos;re counting <em>events and sessions</em>, not people. A
        session is &ldquo;one visit&rdquo; — not &ldquo;one human, forever.&rdquo;
      </P>

      <H2>&ldquo;But you still see my IP, right?&rdquo;</H2>
      <P>
        Yes — and it&apos;s worth being precise here, because this is where a lot of
        &ldquo;cookieless&rdquo; tools quietly cheat. Every web request carries the sender&apos;s IP;
        there&apos;s no way around that at the network layer. What matters is what you do with it.
      </P>
      <P>
        Counted uses your IP for exactly one thing: <strong>rate-limiting abuse</strong>. It&apos;s
        held in memory for a few seconds inside the rate limiter, then discarded. It is{" "}
        <strong>never written to disk, never logged, never stored with your events, and never used to
        derive the session id</strong>. There&apos;s no geo-IP lookup, no hashing it into a
        pseudo-identifier, no fingerprint. We don&apos;t turn the IP into a stand-in for the cookie we
        just told you we don&apos;t use — which is the trick to watch for elsewhere.
      </P>

      <H2>What you <em>can</em> measure</H2>
      <P>
        Quite a lot, as it turns out. Within this model you get event counts and trends, funnels and
        drop-off within a session, feature-usage breakdowns, and segmentation by the coarse properties
        the SDK sends (OS, locale, app version, device model) plus whatever non-personal properties
        you attach yourself. For agents, you set an explicit session id per run, so an entire
        multi-step task groups together and becomes a task-completion funnel. For most
        &ldquo;is the product getting better?&rdquo; questions, this is the data you actually wanted.
      </P>

      <H2>The honest tradeoffs</H2>
      <P>
        This isn&apos;t a free lunch, and pretending otherwise would be exactly the dishonesty this
        whole approach is meant to avoid. Here&apos;s what you give up:
      </P>
      <P>
        <strong>1. No cross-session or cross-device identity.</strong> You can&apos;t follow one
        person from Monday to Friday, or from their laptop to their phone. You see visits, not
        lifelong journeys.
      </P>
      <P>
        <strong>2. &ldquo;Unique users&rdquo; really means &ldquo;sessions.&rdquo;</strong> A clean
        new-vs-returning metric keyed to a persistent identity isn&apos;t available by default,
        because there is no persistent identity.
      </P>
      <P>
        <strong>3. No retroactive &ldquo;who did this.&rdquo;</strong> If support asks &ldquo;what did
        customer X do last week,&rdquo; analytics can&apos;t answer it — by design. That&apos;s a
        question for your own application logs, where you have an account and consent.
      </P>
      <P>
        <strong>4. Coarser attribution.</strong> No third-party-cookie attribution. On our own site we
        keep basic UTM/referrer data in first-party localStorage that never leaves your browser and is
        never shared across sites — useful, but deliberately less precise than ad-tech tracking.
      </P>

      <H2>When this is the wrong trade — and when it&apos;s exactly right</H2>
      <P>
        If your business genuinely depends on individual-level, lifetime tracking — say a growth motion
        built on per-user retention cohorts tied to a real identity — a cookie-based tool fits that
        better, and we&apos;d rather tell you so than oversell. Counted is built for the much larger
        set of questions where you want to understand the <em>product</em>, not surveil the person:
        did this funnel improve, which features matter, is this agent improving, and can I ship to
        privacy-sensitive users without a consent banner.
      </P>
      <P>
        And if you <em>do</em> have a first-party identity and your users&apos; consent, you&apos;re in
        control: you can set the session id yourself to a stable identifier you already hold, on your
        terms. The point of privacy-first isn&apos;t that identity is forbidden — it&apos;s that
        Counted never manufactures one behind your back. The default is ephemeral; anything more is a
        choice you make, out loud.
      </P>
    </PostLayout>
  );
}

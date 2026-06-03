import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { PostLayout, Lead, P, H2 } from "../post-layout";

const meta = getPost("privacy-first-why")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        Most companies treat &ldquo;privacy-first&rdquo; as a compliance line — the box you tick so
        legal signs off. That&apos;s not why Counted is built this way. We think most analytics
        collects far more than it needs to, and that collecting less makes the product better. Here&apos;s
        the reasoning.
      </Lead>

      <H2>Analytics inherited ad-tech&apos;s habits</H2>
      <P>
        Most analytics tools are built on machinery designed for advertising: a cookie to recognize a
        browser, a fingerprint for when the cookie fails, a shared ID to follow someone across sites.
        All of it answers one question — who is this person, and where else have they been — because
        that answer sells ads.
      </P>
      <P>
        Product teams picked up those tools to answer different questions, and got the surveillance for
        free. You wanted to know whether your new onboarding converts better. The tool you reached for
        builds a profile of every visitor by default.
      </P>

      <H2>You probably never used the identity</H2>
      <P>
        The questions teams actually ask rarely need a name attached. Did this funnel improve? Which
        feature is dead weight? Is the agent finishing more tasks than last week? Each of those comes
        out of the count and shape of events. The identity layer underneath was for targeting, and you
        inherited it by accident.
      </P>
      <P>
        Take it out and, for nearly every decision you make, nothing changes — except you&apos;re no
        longer sitting on a pile of personal data you have to protect.
      </P>

      <H2>The banner is a tax</H2>
      <P>
        Tracking individuals costs you before any regulator shows up. Set a tracking cookie and you owe
        users a consent banner. The banner hurts three ways: it&apos;s the first thing every visitor
        sees, a chunk of people decline, and the ones who decline drop out of your data — so what you
        keep skews toward people who click &ldquo;accept all.&rdquo; You pay in first impressions, in
        data quality, and in the personal data you now have to store and defend.
      </P>
      <P>
        No tracking cookie, no banner. Nothing personal to disclose, so the compliance story is short.
        And the numbers are less skewed, because you&apos;re not dropping everyone who said no.
      </P>

      <H2>Privacy is a feature you can sell</H2>
      <P>
        As a constraint, privacy reads like lost margin. As a design choice, it&apos;s something to
        charge for. A tool that holds no personal profiles can go into healthcare, finance, government,
        and the EU without a long review of what it does with personal data, because the answer is
        nothing. There&apos;s no profile database to breach. The script is smaller because it isn&apos;t
        fingerprinting. And not surveilling people earns a kind of trust a competitor built on ad-tech
        can&apos;t match without rebuilding from the floor up.
      </P>

      <H2>The case gets stronger with agents</H2>
      <P>
        Agents already generate far more events than people do, and that gap is widening. The more
        telemetry there is, the more a hoard-everything default costs you — more to leak, more to
        regulate, more to keep safe. A tool that never collected identities in the first place walks
        into that future with little to clean up.
      </P>
      <P>
        Want the mechanics — how you count anything without a cookie, and what you give up by skipping
        identity? That&apos;s the{" "}
        <a href="/blog/no-cookies-how" className="text-accent hover:text-accent-hover transition-colors">
          companion piece on what we do instead
        </a>
        .
      </P>
    </PostLayout>
  );
}

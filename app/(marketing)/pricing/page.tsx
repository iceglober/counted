import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "../site-chrome";
import { TrackedCTA } from "../track";

export const metadata: Metadata = {
  title: "Pricing — Counted",
  description:
    "Free: 100K events/month, no credit card. Pro: $12/month for 1M events. Self-host any plan.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>Pricing</h1>
        <p>Start free. Upgrade when you need more.</p>

        <table>
          <thead>
            <tr>
              <th style={{ width: "40%" }}>&nbsp;</th>
              <th className="c">Free</th>
              <th className="c">Pro</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Price</td>
              <td className="c"><b>$0</b>/month</td>
              <td className="c"><b>$12</b>/month, or $120/year (save $24)</td>
            </tr>
            <tr>
              <td>Events per month</td>
              <td className="c">100K</td>
              <td className="c">1M</td>
            </tr>
            <tr>
              <td>Projects</td>
              <td className="c">3</td>
              <td className="c">Unlimited</td>
            </tr>
            <tr>
              <td>Retention</td>
              <td className="c">6 months</td>
              <td className="c">24 months</td>
            </tr>
            <tr>
              <td>Composable dashboards</td>
              <td className="c">Yes</td>
              <td className="c">Yes</td>
            </tr>
            <tr>
              <td>Breakdowns, time series, counts &amp; funnels</td>
              <td className="c">Yes</td>
              <td className="c">Yes</td>
            </tr>
            <tr>
              <td>Full API access</td>
              <td className="c">&mdash;</td>
              <td className="c">Yes</td>
            </tr>
            <tr>
              <td>Support</td>
              <td className="c">Community</td>
              <td className="c">Priority</td>
            </tr>
            <tr>
              <td>&nbsp;</td>
              <td className="c">
                <TrackedCTA href="/login" location="pricing" label="get_started">
                  Get started
                </TrackedCTA>
              </td>
              <td className="c">
                <TrackedCTA href="/login" location="pricing" label="start_free_pro">
                  Start free
                </TrackedCTA>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="note">
          <b>Pro is in early access.</b>{" "}Billing opens soon — start free and upgrade when
          it&apos;s live.
        </div>

        <p className="small muted">
          All plans include the full SDK and every insight type. Open source — self-host
          anytime. No cookies, no consent banner. Need more than 1M events/month?{" "}
          <a href="mailto:hello@counted.dev">Let&apos;s talk</a>.
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}

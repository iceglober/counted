import type { Metadata } from "next";
import { LegalPage, H2, P, UL } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Counted",
  description: "The terms governing use of Counted, a product of Iceglobe Enterprises LLC.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 2, 2026">
      <P>
        These Terms govern your use of Counted, a product of Iceglobe Enterprises LLC
        (&quot;Counted,&quot; &quot;we,&quot; &quot;us&quot;). By using the service you agree to
        these Terms. If you don&apos;t agree, don&apos;t use the service.
      </P>

      <H2>The service</H2>
      <P>Counted provides privacy-first product analytics with composable dashboards and SDKs. We may add, change, or remove features over time. We aim for high availability but provide the service on an &quot;as available&quot; basis.</P>

      <H2>Accounts</H2>
      <P>You&apos;re responsible for activity under your account and for keeping your sign-in secure. You must provide accurate information and be old enough to form a binding contract in your jurisdiction.</P>

      <H2>Acceptable use</H2>
      <UL>
        <li>Don&apos;t send personal data or other regulated data you&apos;re not permitted to process through the analytics SDKs.</li>
        <li>Don&apos;t use the service to break the law, infringe rights, or send malware.</li>
        <li>Don&apos;t attempt to disrupt, overload, or reverse-engineer the hosted service (the open-source code is separately licensed; see below).</li>
      </UL>

      <H2>Plans, fees & billing</H2>
      <P>Paid plans are billed in advance through Stripe on the cadence you select (monthly or annually) and renew automatically until cancelled. You can cancel anytime; access continues through the end of the paid period. Fees are non-refundable except where required by law. We&apos;ll give reasonable notice of price changes.</P>

      <H2>Your data</H2>
      <P>You own the data you send to Counted. You grant us the limited rights needed to host and process it to provide the service. Our handling of personal data is described in our <a href="/privacy" className="text-accent hover:text-accent-hover transition-colors">Privacy Policy</a>. You can export or delete your data as described there.</P>

      <H2>Open source</H2>
      <P>Counted&apos;s source code is released under the MIT license and may be self-hosted under that license. These Terms govern the <em>hosted</em> service we operate; the &quot;Counted&quot; name and logo are our trademarks and are not licensed by the MIT grant.</P>

      <H2>Disclaimers & limitation of liability</H2>
      <P>The service is provided &quot;as is,&quot; without warranties of any kind to the extent permitted by law. To the maximum extent permitted by law, Iceglobe Enterprises LLC will not be liable for indirect, incidental, or consequential damages, and our total liability for any claim is limited to the amount you paid us in the 12 months before the claim.</P>

      <H2>Termination</H2>
      <P>You may stop using the service at any time. We may suspend or terminate access for breach of these Terms or to protect the service. On termination, your right to use the hosted service ends; you may export your data first where feasible.</P>

      <H2>Governing law</H2>
      <P>These Terms are governed by the laws of the State of Washington, USA, without regard to its conflict-of-laws rules, and you agree to the exclusive jurisdiction of the state and federal courts located in King County, Washington.</P>

      <H2>Changes & contact</H2>
      <P>We may update these Terms and will revise the date above; continued use means you accept the changes. Questions: <a href="mailto:privacy@counted.dev" className="text-accent hover:text-accent-hover transition-colors">privacy@counted.dev</a>.</P>
    </LegalPage>
  );
}

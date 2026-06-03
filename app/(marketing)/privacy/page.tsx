import type { Metadata } from "next";
import { LegalPage, H2, P, UL } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Counted",
  description:
    "How Counted handles data: no cookies for analytics, no fingerprinting, no PII, no IP storage. Privacy-first by design.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 3, 2026">
      <P>
        Counted is a product of Iceglobe Enterprises LLC (&quot;Counted,&quot; &quot;we,&quot;
        &quot;us&quot;). Counted is built to collect as little as possible. This policy explains what
        we collect, what we deliberately don&apos;t, and the choices you have.
      </P>

      <H2>Our privacy stance</H2>
      <UL>
        <li><strong>No tracking cookies, ever.</strong> We do not use cookies, fingerprinting, or any cross-site identifier for analytics — on our product or our own marketing site.</li>
        <li><strong>No PII in analytics.</strong> We do not store IP addresses, fingerprints, or persistent device identifiers in your analytics, and we do not link an IP to an event. Sessions are ephemeral and held in memory only.</li>
        <li><strong>GDPR/CCPA-friendly by default.</strong> Because we don&apos;t set tracking cookies or process personal identifiers for analytics, Counted can run without a consent banner.</li>
      </UL>

      <H2>Information we collect</H2>
      <P><strong>Account information.</strong> To use the Counted app we collect your email address (for passwordless magic-link sign-in). You can also choose to sign in with Google or GitHub, in which case that provider handles authentication and shares basic profile information (such as your email) with us. Optionally, we store profile details and your organization name.</P>
      <P><strong>Analytics events you send.</strong> When you instrument your app with a Counted SDK, we receive the event names and properties <em>you</em> choose to send, plus coarse system properties (such as OS name/version, locale, app version, and device model where your SDK provides them) and an ephemeral session identifier. We do not store IP addresses or attach them to your events. Like any web service, our servers receive the IP that sends a request; we use it transiently — held in memory for seconds — only to rate-limit abuse, and it is never written to disk, logged, or linked to your analytics. You control what properties you send — please don&apos;t send personal data in event properties.</P>
      <P><strong>Our marketing site.</strong> We use our own Counted SDK on counted.dev (we dogfood our product). This is first-party and cookie-free; basic acquisition attribution (UTM tags and referrer) is kept in your browser&apos;s <code className="font-mono">localStorage</code>, never in a cookie, and is not shared across sites.</P>
      <P><strong>Billing.</strong> Paid plans are processed by Stripe; we do not store your card details. Stripe&apos;s handling is governed by its own privacy policy.</P>

      <H2>Cookies</H2>
      <P>We use <strong>no cookies for analytics or tracking</strong>. The signed-in app uses strictly-necessary cookies to keep your session authenticated (and, during sign-in, to complete the login flow securely). None of them track you or carry an advertising function, and we set no cookies at all on visitors who aren&apos;t signed in.</P>

      <H2>How we use information</H2>
      <UL>
        <li>To provide, secure, and improve the Counted service.</li>
        <li>To send transactional email (sign-in links, billing, service notices) via our email provider, Resend.</li>
        <li>To understand, in aggregate, how our own marketing performs — measured with Counted itself.</li>
      </UL>
      <P>We do not sell your data, and we do not use it for advertising profiles.</P>

      <H2>Subprocessors</H2>
      <P>We share data only with the vendors needed to run the service: Stripe (payments), Resend (transactional email), and our cloud hosting provider (application and database infrastructure). Each processes data on our behalf under its own terms.</P>

      <H2>Data retention</H2>
      <P>Event data is retained per your plan (currently 6 months on Free and 24 months on Pro). Account data is retained while your account is active and deleted on request or after account closure.</P>

      <H2>Your rights</H2>
      <P>Depending on where you live, you may have the right to access, correct, export, or delete your personal data, and to object to certain processing. To exercise any of these, email us and we&apos;ll respond promptly.</P>

      <H2>Self-hosting</H2>
      <P>Counted is open source and can be self-hosted. If you run your own instance, all data stays in your infrastructure and this policy&apos;s collection terms do not apply to that data.</P>

      <H2>Changes & contact</H2>
      <P>We&apos;ll update this policy as the product evolves and revise the date above. Questions or requests: <a href="mailto:austin@iceglobe.io" className="text-accent hover:text-accent-hover transition-colors">austin@iceglobe.io</a>.</P>
    </LegalPage>
  );
}

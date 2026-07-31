import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "../site-chrome";

export const metadata: Metadata = {
  title: "Contact — Counted",
  description:
    "How to reach Counted: email hello@counted.dev, privacy@counted.dev, GitHub issues, or the docs. Iceglobe Enterprises LLC.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div>
      <SiteNav />
      <div className="page">
        <h1>Contact</h1>
        <p>
          Counted is made by Iceglobe Enterprises LLC (US). The fastest ways to
          reach us:
        </p>
        <ul>
          <li>
            <b>General / sales:</b>{" "}
            <a href="mailto:hello@counted.dev">hello@counted.dev</a>
          </li>
          <li>
            <b>Privacy / data requests:</b>{" "}
            <a href="mailto:privacy@counted.dev">privacy@counted.dev</a>
          </li>
          <li>
            <b>Bugs and feature requests:</b>{" "}
            <a href="https://github.com/iceglober/counted/issues" target="_blank" rel="noopener" className="ext">
              GitHub issues
            </a>
          </li>
          <li>
            <b>Agents / API:</b> see <a href="/llms.txt">/llms.txt</a> and{" "}
            <a href="/docs/api">the API reference</a>
          </li>
        </ul>
        <p>
          For anything over 1M events/month or a custom plan, email{" "}
          <a href="mailto:hello@counted.dev">hello@counted.dev</a> and we&apos;ll
          sort it out.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

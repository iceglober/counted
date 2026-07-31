/**
 * The keys and monitors tables.
 *
 * Same distinction the dashboard tiles make, applied to lists: **a request
 * that failed must not render as a list that is empty**. "This project has no
 * keys" and "we could not ask" are different sentences, and only one of them
 * sends somebody to issue a key they already have.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CredentialTable, type Credential } from "./credentials";
import { MonitorTable, type Monitor } from "./monitors";

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);

const key = (over: Partial<Credential> = {}): Credential => ({
  id: "cred_1",
  kind: "ingest",
  label: "Web",
  prefix: "ck_live_ab",
  scopes: ["events:write"],
  ...over,
});

const monitor = (over: Partial<Monitor> = {}): Monitor => ({
  id: "mon_1",
  name: "Signups per hour",
  enabled: true,
  state: "ok",
  lastValue: 12,
  ...over,
});

describe("a failed listing is not an empty listing", () => {
  test("credentials: null is an error, [] is a sentence, and they differ", () => {
    const failed = render(<CredentialTable credentials={null} />);
    const empty = render(<CredentialTable credentials={[]} />);

    expect(failed).toContain('role="alert"');
    expect(empty).not.toContain('role="alert"');
    expect(failed).not.toBe(empty);
  });

  test("monitors: the same, for the same reason", () => {
    const failed = render(<MonitorTable monitors={null} />);
    const empty = render(<MonitorTable monitors={[]} />);

    expect(failed).toContain('role="alert"');
    expect(empty).not.toContain('role="alert"');
    expect(failed).not.toBe(empty);
  });
});

describe("keys", () => {
  test("no secret is ever rendered, because none is stored", () => {
    // The secret is shown once, at issue, and only its digest is kept. There
    // is nothing to display here and no "reveal" control to build. v1 stored
    // keys in plaintext across three columns and showed them on demand.
    const html = render(<CredentialTable credentials={[key()]} />);
    expect(html).toContain("ck_live_ab");
    expect(html).toContain("…");
    expect(html.toLowerCase()).not.toContain("reveal");
    expect(html.toLowerCase()).not.toContain("copy secret");
  });

  test("a revoked key stays in the list rather than vanishing", () => {
    // A key that disappears is indistinguishable from one that never existed,
    // which is the wrong thing to tell somebody debugging a 401.
    const html = render(<CredentialTable credentials={[key({ revokedAt: "2026-01-01T00:00:00Z" })]} />);
    expect(html).toContain("revoked");
    expect(html).toContain("<s>");
  });

  test("an ingest key says it is public", () => {
    // The two kinds are handled completely differently and the difference is
    // not obvious from a prefix.
    expect(render(<CredentialTable credentials={[key({ kind: "ingest" })]} />)).toContain("safe to embed");
    expect(render(<CredentialTable credentials={[key({ kind: "service", prefix: "sk_live_cd" })]} />)).not.toContain(
      "safe to embed",
    );
  });
});

describe("monitors", () => {
  test("the state shown is the server's verdict", () => {
    expect(render(<MonitorTable monitors={[monitor({ state: "breaching" })]} />)).toContain("breaching");
    expect(render(<MonitorTable monitors={[monitor({ state: "ok" })]} />)).toContain("within threshold");
  });

  test("a disabled monitor still reports its reading", () => {
    // Disabled is a state of the monitor, not of the measurement. Replacing
    // the reading with "off" throws away the last thing it saw.
    const html = render(<MonitorTable monitors={[monitor({ enabled: false, lastValue: 41 })]} />);
    expect(html).toContain("disabled");
    expect(html).toContain("41");
  });

  test("an unevaluated monitor shows a dash, not a zero", () => {
    // `0` would claim it measured nothing, which is a different fact from
    // never having run.
    const html = render(<MonitorTable monitors={[monitor({ lastValue: null })]} />);
    expect(html).toContain("—");
    expect(html).not.toMatch(/>0</);
  });

  test("a genuine zero reading is shown as zero", () => {
    expect(render(<MonitorTable monitors={[monitor({ lastValue: 0 })]} />)).toContain(">0<");
  });
});

import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";
import { failureFromQuery, failureOf, failureQuery, sentenceFor } from "./failure";

describe("reading a failed call", () => {
  test("the status comes from the code, because the wire body has none", () => {
    // @orpc/client@2.0.0-beta.32 decodes `{ defined, inferable, code, message,
    // data }` and there is no status field in it, so ORPCError.status is
    // undefined client-side. Recovering it from the code is what lets a page
    // branch on 402 versus 403.
    const error = new ORPCError("PAYMENT_REQUIRED", { message: "Upgrade" });
    expect(failureOf(error).status).toBe(402);
  });

  test("the domain error's kind is read out of data.reason", () => {
    const error = new ORPCError("CONFLICT", {
      message: "Insight limit reached",
      data: { reason: "TooManyTiles", max: 24 },
    });
    expect(failureOf(error).reason).toBe("TooManyTiles");
  });

  test("data that is not an object does not become a reason", () => {
    for (const data of [null, undefined, "TooManyTiles", 42, []]) {
      expect(failureOf(new ORPCError("CONFLICT", { data })).reason).toBeNull();
    }
  });

  test("a thrown non-oRPC error is a network failure", () => {
    const failure = failureOf(new TypeError("fetch failed"));
    expect(failure.code).toBe("NETWORK");
    expect(failure.status).toBe(503);
  });
});

describe("what the reader is told", () => {
  test("the reason wins over the code", () => {
    // "Conflict" is not an instruction. "This dashboard is full" is.
    const specific = sentenceFor(failureOf(new ORPCError("CONFLICT", { data: { reason: "TooManyTiles" } })));
    const generic = sentenceFor(failureOf(new ORPCError("CONFLICT", {})));
    expect(specific).not.toBe(generic);
    expect(specific).toMatch(/full/);
  });

  test("a reason this console has never heard of still produces a sentence", () => {
    // The domain may grow an error before this table does. Falling through to
    // the code keeps the page truthful rather than blank.
    const sentence = sentenceFor(
      failureOf(new ORPCError("CONFLICT", { data: { reason: "SomethingAddedLater" } })),
    );
    expect(sentence.length).toBeGreaterThan(0);
  });

  test("overage and rejection do not read the same", () => {
    // 402 says upgrade, 429 says wait. Collapsing them is a support ticket.
    expect(sentenceFor(failureOf(new ORPCError("PAYMENT_REQUIRED", {})))).toMatch(/[Uu]pgrade/);
    expect(sentenceFor(failureOf(new ORPCError("TOO_MANY_REQUESTS", {})))).toMatch(/[Ww]ait/);
  });
});

describe("a failure surviving a redirect", () => {
  test("the code and reason round-trip", () => {
    const original = failureOf(
      new ORPCError("CONFLICT", { message: "x", data: { reason: "NameUnchanged" } }),
    );
    const recovered = failureFromQuery(
      Object.fromEntries(new URLSearchParams(failureQuery(original))),
    );
    expect(recovered?.code).toBe("CONFLICT");
    expect(recovered?.reason).toBe("NameUnchanged");
    expect(recovered?.status).toBe(409);
  });

  test("the server's message is left behind", () => {
    // A message can name a resource, and a URL is the one place it reliably
    // ends up in a proxy log, a referrer and the reader's history.
    const query = failureQuery(
      failureOf(new ORPCError("NOT_FOUND", { message: "no project acme-production" })),
    );
    expect(query).not.toMatch(/acme-production/);
  });

  test("no failure in the query means no notice on the page", () => {
    expect(failureFromQuery({})).toBeNull();
    expect(failureFromQuery({ code: "" })).toBeNull();
  });
});

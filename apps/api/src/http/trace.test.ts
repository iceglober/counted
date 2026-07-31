import { describe, expect, test } from "bun:test";
import { traceContextFrom, traceparentOf } from "./trace";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("joining an upstream trace", () => {
  test("a valid traceparent contributes its trace id", () => {
    // This is the whole point: browser → web → api → worker is one search
    // instead of four correlated guesses.
    const context = traceContextFrom(VALID);
    expect(context.traceId).toBe(TRACE);
    expect(context.sampledUpstream).toBe(true);
  });

  test("we take a new span id rather than reusing the caller's", () => {
    // Two different operations sharing a span id are indistinguishable.
    const context = traceContextFrom(VALID);
    expect(context.spanId).not.toBe("00f067aa0ba902b7");
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("the header we send onward names our span as the parent", () => {
    const context = traceContextFrom(VALID);
    expect(traceparentOf(context)).toBe(`00-${TRACE}-${context.spanId}-01`);
  });
});

describe("starting a fresh trace", () => {
  test("no header means a new trace", () => {
    const context = traceContextFrom(undefined);
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.sampledUpstream).toBe(false);
  });

  test("two fresh traces do not collide", () => {
    expect(traceContextFrom(undefined).traceId).not.toBe(traceContextFrom(undefined).traceId);
  });

  test("a malformed header starts a new trace rather than failing", () => {
    // A broken tracing header from some intermediary must never be able to
    // take an endpoint down.
    const malformed = [
      "",
      "garbage",
      "00-tooshort-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-tooshort-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",
      // All-zero ids are invalid per the spec.
      `00-${"0".repeat(32)}-00f067aa0ba902b7-01`,
      `00-${TRACE}-${"0".repeat(16)}-01`,
      // Version ff is explicitly forbidden.
      `ff-${TRACE}-00f067aa0ba902b7-01`,
      // Uppercase hex is not valid per the spec.
      `00-${TRACE.toUpperCase()}-00f067aa0ba902b7-01`,
    ];
    for (const header of malformed) {
      const context = traceContextFrom(header);
      expect({ header, sampled: context.sampledUpstream }).toEqual({ header, sampled: false });
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test("an unknown future version is accepted forward-compatibly", () => {
    // The spec says to accept versions we do not know, as long as the ids
    // parse. Rejecting them would break on the next revision.
    const context = traceContextFrom(`02-${TRACE}-00f067aa0ba902b7-01-extra`);
    expect(context.traceId).toBe(TRACE);
    expect(context.sampledUpstream).toBe(true);
  });

  test("surrounding whitespace is tolerated", () => {
    expect(traceContextFrom(`  ${VALID}  `).traceId).toBe(TRACE);
  });
});

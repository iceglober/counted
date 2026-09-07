/**
 * One id per request, in and out.
 *
 * The forgiving cases matter as much as the strict one. A proxy that mangles
 * `traceparent` is not something a caller can fix, so a malformed header gets a
 * fresh id rather than a 400 — refusing would let any upstream take the API
 * down.
 */

import { describe, expect, test } from "bun:test";
import { TRACE_HEADER, TRACEPARENT_HEADER, traceOf } from "./tracing";

const options = { mint: () => "minted" };

const headers = (values: Record<string, string>): Headers => new Headers(values);

describe("resolving a trace", () => {
  test("a valid traceparent's trace id is inherited", () => {
    const trace = traceOf(
      headers({ [TRACEPARENT_HEADER]: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" }),
      options,
    );
    expect(trace).toEqual({ id: "4bf92f3577b34da6a3ce929d0e0e4736", inherited: true });
  });

  test("a malformed traceparent gets a fresh id rather than a 400", () => {
    const trace = traceOf(headers({ [TRACEPARENT_HEADER]: "not-a-traceparent" }), options);
    expect(trace).toEqual({ id: "minted", inherited: false });
  });

  /**
   * An all-zero trace id is explicitly invalid in the spec and some proxies
   * emit one rather than omitting the header. Treating it as present would put
   * every request from behind that proxy on one trace.
   */
  test("an all-zero trace id is treated as absent", () => {
    const trace = traceOf(
      headers({ [TRACEPARENT_HEADER]: "00-00000000000000000000000000000000-00f067aa0ba902b7-01" }),
      options,
    );
    expect(trace.inherited).toBe(false);
  });

  test("our own header is honoured when there is no traceparent", () => {
    const trace = traceOf(headers({ [TRACE_HEADER]: "ticket-1234" }), options);
    expect(trace).toEqual({ id: "ticket-1234", inherited: true });
  });

  test("an absurdly long id is not inherited", () => {
    const trace = traceOf(headers({ [TRACE_HEADER]: "x".repeat(500) }), options);
    expect(trace.inherited).toBe(false);
  });

  test("no headers at all mints one", () => {
    expect(traceOf(headers({}), options)).toEqual({ id: "minted", inherited: false });
  });
});

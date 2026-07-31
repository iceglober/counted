/**
 * W3C trace context.
 *
 * The point is one question: "why did this alert fire?" A worker job started
 * by a request carries the originating trace id, so browser → web → api →
 * worker is a single search instead of four correlated guesses.
 *
 * Only `traceparent` is parsed, and only to the extent of extracting ids. This
 * is not a tracing implementation — spans behind an OTLP endpoint come later.
 * What it buys now is that ids *propagate*, so turning tracing on later does
 * not mean re-plumbing every service.
 */

import { randomBytes } from "node:crypto";

export type TraceContext = {
  readonly traceId: string;
  readonly spanId: string;
  /** True when the caller supplied a trace we joined rather than starting one. */
  readonly sampledUpstream: boolean;
};

const HEX_16 = /^[0-9a-f]{16}$/;
const HEX_32 = /^[0-9a-f]{32}$/;
const ALL_ZERO_32 = "0".repeat(32);
const ALL_ZERO_16 = "0".repeat(16);

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

/**
 * Parse a `traceparent`, or start a new trace.
 *
 * A malformed header starts a new trace rather than failing the request: a
 * broken tracing header from some intermediary must never be able to take an
 * endpoint down. An all-zero id is invalid per the spec and is treated the
 * same way.
 */
export const traceContextFrom = (header: string | undefined): TraceContext => {
  const fresh = (): TraceContext => ({ traceId: hex(16), spanId: hex(8), sampledUpstream: false });
  if (header === undefined) return fresh();

  const parts = header.trim().split("-");
  const [version, traceId, parentId] = parts;
  if (parts.length < 4) return fresh();
  // Version ff is explicitly forbidden; anything else we accept forward-
  // compatibly, per the spec's own guidance for unknown versions.
  if (version === undefined || !/^[0-9a-f]{2}$/.test(version) || version === "ff") return fresh();
  if (traceId === undefined || !HEX_32.test(traceId) || traceId === ALL_ZERO_32) return fresh();
  if (parentId === undefined || !HEX_16.test(parentId) || parentId === ALL_ZERO_16) return fresh();

  // We are a new span in the caller's trace, so a fresh span id — reusing the
  // parent's would make two different operations indistinguishable.
  return { traceId, spanId: hex(8), sampledUpstream: true };
};

/** The header to send onward, naming this service's span as the parent. */
export const traceparentOf = (context: TraceContext): string =>
  `00-${context.traceId}-${context.spanId}-01`;

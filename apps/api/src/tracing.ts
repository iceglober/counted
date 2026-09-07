/**
 * One id per request, propagated in and out.
 *
 * W3C `traceparent` is read when the caller sends one, so a request that
 * arrives from the console carries the console's trace and the two halves of a
 * page load can be joined. When it does not, an id is minted. Either way the
 * answer goes back out as `x-counted-trace`, which is the header a support
 * ticket quotes.
 *
 * The parsing is strict on the two fields that matter and forgiving about the
 * rest: a malformed `traceparent` gets a fresh id rather than a 400. Rejecting
 * the request would let any upstream proxy that mangles the header take the
 * whole API down, and there is nothing a caller can do about a header they did
 * not write.
 */

/** `version-traceid-spanid-flags`, all lowercase hex. */
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export const TRACE_HEADER = "x-counted-trace";
export const TRACEPARENT_HEADER = "traceparent";

export type Trace = {
  readonly id: string;
  /** True when the id came from the caller rather than being minted here. */
  readonly inherited: boolean;
};

export type TraceOptions = {
  /** Where a fresh id comes from. Injected so a test can make it deterministic. */
  readonly mint: () => string;
};

export const traceOf = (headers: Headers, options: TraceOptions): Trace => {
  const parent = headers.get(TRACEPARENT_HEADER);
  if (parent !== null) {
    const matched = TRACEPARENT.exec(parent.trim());
    // An all-zero trace id is explicitly invalid in the spec, and some proxies
    // emit one rather than omitting the header. Treated as absent.
    if (matched?.[1] !== undefined && !/^0{32}$/.test(matched[1])) {
      return { id: matched[1], inherited: true };
    }
  }

  const own = headers.get(TRACE_HEADER);
  if (own !== null && own.trim().length > 0 && own.length <= 128) {
    return { id: own.trim(), inherited: true };
  }

  return { id: options.mint(), inherited: false };
};

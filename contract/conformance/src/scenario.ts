/**
 * The scenario format.
 *
 * One file, four languages, one assertion. A scenario is a script of steps: do
 * something, expect a request, answer it, advance a virtual clock. The runner
 * diffs what the SDK actually did against what the script says.
 *
 * The existing conformance suite spawns real drivers against a capture server
 * and checks payload *shape*. Necessary and insufficient: it cannot test
 * backoff, re-queue or 429 handling, because it controls neither the clock nor
 * the failures. This can control both, which is why it can test the behaviour
 * that actually rots.
 */

export type Step =
  | { readonly do: "track"; readonly name: string; readonly properties?: Record<string, unknown> }
  | { readonly do: "identify"; readonly userId: string }
  | { readonly do: "reset" }
  | { readonly do: "flush" }
  | { readonly do: "shutdown" }
  /** Advance the virtual clock, e.g. "5s", "500ms", "2m". */
  | { readonly advance: string }
  /** Assert a request was made carrying exactly these event names, in order. */
  | { readonly expect: "request"; readonly events: readonly string[] }
  /** Assert nothing was sent since the last expectation. */
  | { readonly expect: "no-request" }
  /** Assert a field on the most recent request's first event. */
  | { readonly expect: "field"; readonly path: string; readonly equals: unknown }
  /**
   * Assert a field is not on the wire at all.
   *
   * Distinct from equalling null: the ingest contract makes `userId` optional,
   * and an SDK that sent an explicit null would be sending a value where the
   * contract says send nothing.
   */
  | { readonly expect: "field-absent"; readonly path: string }
  /**
   * Assert a field is one of a closed set.
   *
   * Weaker than an equality, and deliberately: the value depends on the
   * machine the suite runs on. What must hold is that it is *in the enum* —
   * a value outside it is how one operating system became four.
   */
  | { readonly expect: "field-in"; readonly path: string; readonly oneOf: readonly string[] }
  | { readonly expect: "field-present"; readonly path: string }
  /** Assert a field is identical to what it was at a named checkpoint. */
  | { readonly expect: "same-as"; readonly path: string; readonly checkpoint: string }
  | { readonly checkpoint: string }
  /** Answer the pending request. */
  | {
      readonly respond: {
        readonly status: number;
        readonly headers?: Record<string, string>;
        readonly body?: unknown;
      };
    }
  /** Fail the pending request at the transport level. */
  | { readonly respond: "network-error" };

export type Scenario = {
  /** The clause this proves. Must exist in contract/sdk-behaviour.md. */
  readonly id: string;
  readonly title: string;
  readonly options?: Record<string, unknown>;
  readonly script: readonly Step[];
};

const UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/** `"5s"` → 5000. Rejects anything it does not understand rather than guessing. */
export const parseDuration = (raw: string): number => {
  const match = /^(\d+)(ms|s|m|h)$/.exec(raw);
  if (match === null) throw new Error(`unparseable duration: ${raw}`);
  return Number(match[1]) * UNITS[match[2]!]!;
};

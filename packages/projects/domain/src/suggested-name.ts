/**
 * A name for a project nobody has named yet.
 *
 * `/v1/provision` takes no input — that is the point of it, and why an agent can
 * get a working key in one unauthenticated call. But it still has to call the
 * result something, and it called everything "Untitled project". So the claim
 * page read "Claim Untitled project", the dashboard listed a row of identical
 * rows, and the first thing anyone saw was a placeholder.
 *
 * A generated name is not a small nicety here. It is the difference between a
 * page that looks unfinished and one that looks like it did something for you.
 * The name is always editable afterwards; this only decides the starting point.
 *
 * The vocabulary is deliberately plain — the same register as the rest of the
 * product. No adjective-animal whimsy ("bouncy-narwhal"), which reads as
 * borrowed personality and dates badly, and nothing that could be mistaken for
 * a real customer's brand. Weather, minerals, landscape: concrete, neutral, and
 * short enough to fit a nav.
 */

/** Deliberately colourless. A name should not claim a mood the product lacks. */
const FIRST = [
  "amber", "basalt", "cedar", "cobalt", "copper", "delta", "ember", "flint",
  "granite", "harbor", "indigo", "juniper", "kettle", "lantern", "marble",
  "meadow", "north", "onyx", "pewter", "quarry", "river", "saffron", "slate",
  "summit", "thistle", "umber", "vellum", "willow", "yarrow", "zephyr",
] as const;

/** Nouns that read as a place or a thing, never as a person or a company. */
const SECOND = [
  "atlas", "basin", "beacon", "bridge", "canyon", "compass", "current",
  "ferry", "field", "gate", "grove", "harvest", "hollow", "ledger", "lookout",
  "meridian", "orchard", "outpost", "quay", "ridge", "signal", "station",
  "thicket", "tide", "trellis", "vault", "verge", "waypoint", "well", "yard",
] as const;

/**
 * 900 combinations. Not unique, and not trying to be — two people landing on
 * "slate-harbor" in the same week costs nothing, because the name identifies
 * the project to *one* person and the id identifies it to the system. Making it
 * unique would mean a round trip and a failure mode, to solve a problem nobody
 * has.
 */
export const SUGGESTED_NAME_COMBINATIONS = FIRST.length * SECOND.length;

/**
 * A random two-word name, hyphenated.
 *
 * `random` is injected so this is testable without stubbing globals and so the
 * domain keeps its no-ambient-dependencies rule — the same reason `Clock` is a
 * port. Callers in production pass `Math.random`.
 */
export const suggestedProjectName = (random: () => number = Math.random): string => {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;
  return `${pick(FIRST)}-${pick(SECOND)}`;
};

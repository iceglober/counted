/**
 * Deprecated. This package never did anything.
 *
 * It shipped a copy of the SDK wrapper and no integration point — installing
 * it registered nothing with gemini and produced no events. It was
 * byte-identical to its sibling (`md5 48ab6ab2…`), which is the clearest
 * evidence that neither contained anything host-specific.
 *
 * The replacement is real: `@counted/agent`, wired into gemini's own
 * hook mechanism as `counted-agent --host gemini`. See the README.
 *
 * Published once at 2.0.0 to say so, then deprecated on npm. Kept as a stub
 * rather than unpublished, because unpublishing breaks installs that already
 * reference it and teaches nobody why.
 */

const NOTICE =
  "@counted/gemini-cli is deprecated and never functioned as an integration. " +
  "Use @counted/agent: `npx counted-agent --host gemini`, wired into gemini's hook configuration. " +
  "See https://counted.dev/docs/agents";

/** Prints the notice once. Exported so importing the package is not silent. */
export const deprecated = (): string => {
  process.stderr.write(`counted: ${NOTICE}\n`);
  return NOTICE;
};

deprecated();

/**
 * Architecture rules for the v2 rewrite.
 *
 * These exist so the dependency rule is mechanical rather than cultural. A
 * violation fails CI; it does not rely on someone noticing it in review.
 *
 * The layering, innermost first:
 *
 *   domain          knows nothing. No I/O, no framework, no dependencies.
 *   ports           may know domain.
 *   application     may know domain + ports.
 *   adapters        may know domain + ports (they implement the ports).
 *   apps            may know everything; they compose it.
 *
 * Canon: ARCHITECTURE.md in the private planning repo.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "packages/domain must not import anything outside itself. No adapters, no apps, " +
        "no npm packages. If the domain needs something from the outside world, that is a " +
        "port, and the port lives in packages/ports.",
      from: { path: "^packages/domain/src" },
      to: {
        pathNot: "^packages/domain/src",
        // Node builtins are caught separately below for a clearer message.
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "domain-has-no-io",
      severity: "error",
      comment:
        "packages/domain must not touch Node builtins. No fs, no net, no crypto, no timers. " +
        "Time arrives as a value from a Clock port; randomness and ids arrive the same way.",
      from: { path: "^packages/domain/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "ports-may-only-know-domain",
      severity: "error",
      comment:
        "packages/ports declares interfaces. It may reference the domain and nothing else — " +
        "an implementation belongs in packages/adapters.",
      from: { path: "^packages/ports/src" },
      to: {
        pathNot: "^(packages/ports/src|packages/domain/src)",
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "application-knows-no-adapters",
      severity: "error",
      comment:
        "packages/application orchestrates through ports. Importing a concrete adapter here " +
        "is the mistake this whole architecture exists to prevent.",
      from: { path: "^packages/application/src" },
      to: { path: "^(packages/adapters|apps)/" },
    },
    {
      name: "inner-layers-know-no-framework",
      severity: "error",
      comment:
        "No framework or driver inside domain/ports/application. pg, hono, next, react, " +
        "stripe and drizzle belong in adapters or apps.",
      from: { path: "^packages/(domain|ports|application)/src" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
        path: "^(pg|hono|next|react|react-dom|stripe|drizzle-orm|better-auth|resend)($|/)",
      },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make the layering unprovable.",
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      // Test files may import test runners; the layering rules above still apply
      // to the source they exercise.
      path: "\\.(test|spec)\\.ts$",
    },
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

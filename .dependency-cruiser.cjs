/**
 * Architecture rules for v3.
 *
 * These exist so the dependency rule is mechanical rather than cultural. A
 * violation fails CI; it does not rely on someone noticing it in review. v2
 * proved this works — `depcruise` reported no violations across 294 modules,
 * and `packages/domain` genuinely imported nothing. v3 keeps that property and
 * closes the three holes v2's config left open: `packages/contracts` had no
 * rule at all, the adapter rule forbade paths but not arbitrary npm packages,
 * and the framework rule was a nine-name allowlist that `zod`, `@orpc/*` and
 * `accesscontrol` all sailed through.
 *
 * The layout is context-first. Inside each context:
 *
 *   <ctx>/domain     pure values and rules. Knows the kernel and itself.
 *   <ctx>/ports      interfaces. Knows the kernel and its own domain.
 *   <ctx>/app        use cases. Knows its domain, the kernel, and port types.
 *   <ctx>/adapter-*  implementations. May know a vendor library — one each.
 *   apps/*           compose everything. The only layer that may know all of it.
 *
 * Two things to know before editing.
 *
 * **Test files are NOT exempt.** v2's config excluded `*.test.ts` from every
 * rule, which meant a test could import a database driver into the domain and
 * the proof would still be green. The one concession is `bun:test` itself,
 * allowed by name everywhere.
 *
 * **Every rule was verified by planting a violation and watching it fail.**
 * That is not ceremony. Three separate settings silently made these rules
 * enforce nothing: without `tsPreCompilationDeps` every `import type`
 * disappears (and a ports package is nothing but types); an `exclude` on
 * `/dist/` and `.d.ts` hid every vendor import, because that is exactly where
 * a library's types live; and matching npm packages by bare name misses them
 * once they resolve into `node_modules/.bun/…`. If you add a rule, plant a
 * violation and watch it fail before you trust it.
 *
 * Package boundaries are documented in V3-SPEC.md.
 */

/**
 * An npm package, however it resolved. Bun stores real files under
 * `node_modules/.bun/<name>@<version>/node_modules/<name>/…`, so matching the
 * bare specifier alone catches only the unresolvable case.
 */
const npm = (names) => `((^|/)node_modules/|^)(${names})($|/)`;

/**
 * Both spellings of a workspace package: the path it resolves to, and the bare
 * name it shows up as when the importing package never declared it. The second
 * form matters more than it looks — an undeclared import is exactly what a
 * boundary violation usually is.
 */
const KERNEL_VALUES = ["^packages/kernel/src/(?!ports\\.ts)", "^@counted/kernel$"];
const KERNEL_ANY = ["^packages/kernel/src", "^@counted/kernel($|/)"];
const KERNEL_PORTS = ["^packages/kernel/src/ports\\.ts$", "^@counted/kernel/ports$"];
const ANY_PORTS = ["^packages/[^/]+/ports/src", "^@counted/[^/]+-ports($|/)"];
const CONTRACT = ["^packages/contract/src", "^@counted/contract($|/)"];
const TEST_RUNNER = "^bun:test$";

module.exports = {
  forbidden: [
    // ---- 1 ---------------------------------------------------------------
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "A domain package may import @counted/kernel and its own context, and nothing else. " +
        "Not another context, not a port, not an npm package. This is the property that " +
        "makes every rule in the system testable with no database, no clock and no network, " +
        "and it is the one thing v2 got unambiguously right. If the domain needs something " +
        "from the outside world, that thing is a port and the port lives in <ctx>/ports.",
      from: { path: "^packages/([^/]+)/domain/src" },
      to: {
        pathNot: [
          "^packages/$1/domain/src",
          "^@counted/$1-domain($|/)",
          ...KERNEL_VALUES,
          TEST_RUNNER,
        ],
        // Node builtins get their own rule below so the message names the real problem.
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "domain-has-no-io",
      severity: "error",
      comment:
        "A domain package must not touch Node builtins. No fs, no net, no crypto, no timers. " +
        "Time arrives as an Instant the caller already read; ids arrive from an IdGenerator " +
        "an adapter owns. A domain that can read the clock is a domain whose tests need to " +
        "freeze one.",
      from: { path: "^packages/([^/]+)/domain/src" },
      to: { dependencyTypes: ["core"], pathNot: TEST_RUNNER },
    },

    // ---- 2 ---------------------------------------------------------------
    {
      name: "app-knows-only-its-domain-kernel-and-ports",
      severity: "error",
      comment:
        "A use case orchestrates its own domain through port interfaces. It may import its " +
        "own <ctx>/domain, @counted/kernel (including @counted/kernel/ports), and any " +
        "*/ports package. It may NOT import a concrete adapter, another context's domain, " +
        "or an npm package — importing a driver here is the mistake this whole architecture " +
        "exists to prevent. Authorization is decided before a use case runs, in apps/*, " +
        "which is why @counted/authorization is not on the list either.",
      from: { path: "^packages/([^/]+)/app/src" },
      to: {
        pathNot: [
          "^packages/$1/(app|domain)/src",
          "^@counted/$1-(app|domain)($|/)",
          ...KERNEL_ANY,
          ...ANY_PORTS,
          TEST_RUNNER,
        ],
      },
    },

    // ---- 3 ---------------------------------------------------------------
    {
      name: "only-the-identity-adapter-knows-better-auth",
      severity: "error",
      comment:
        "better-auth owns accounts, sessions, organizations, memberships and API keys — and " +
        "it owns them in its own tables. The domain must never see that. One adapter " +
        "implements the identity ports over it; everything else, apps/api included, reaches " +
        "better-auth through that adapter. This boundary keeps identity storage details " +
        "out of the domain and preserves its purity.",
      from: { pathNot: "^packages/identity/adapter-better-auth/src" },
      to: { path: npm("better-auth|@better-auth/[^/]+") },
    },

    // ---- 4 ---------------------------------------------------------------
    {
      name: "only-authorization-knows-accesscontrol",
      severity: "error",
      comment:
        "accesscontrol shipped 2.2.1 in 2018 and nothing until 3.0.0 in June 2026 — an " +
        "eight-year dormancy, then a revival. That is not a reason to avoid it; it is a " +
        "reason to keep it behind exactly one module so replacing it is a one-file change. " +
        "`ac.can(...)` must never appear in a route handler.",
      from: { pathNot: "^packages/authorization/src" },
      to: { path: npm("accesscontrol") },
    },

    // ---- 5 ---------------------------------------------------------------
    {
      name: "only-the-analytics-adapter-knows-litics",
      severity: "error",
      comment:
        "@litics/core generates SQL. The analytics domain holds the Analysis IR and knows " +
        "nothing about how it is answered — which is what lets the engine be swapped, and " +
        "what stops litics' query vocabulary (flat dimension equality, cube routing) from " +
        "silently becoming the product's vocabulary. @litics/kysely is not installed and " +
        "Kysely does not enter this stack.",
      from: { pathNot: ["^packages/analytics/adapter-litics/src", "^vendor/litics-compactor/"] },
      // Both spellings of the same package: the npm name, and the vendored
      // workspace directory it resolves to. Matching only the name would let
      // a relative import of `vendor/litics-core/...` walk straight past the
      // rule.
      to: { path: [npm("@litics/[^/]+"), "^vendor/litics-(core|compactor)/"] },
    },

    // ---- 5b --------------------------------------------------------------
    {
      name: "vendored-litics-is-a-leaf",
      severity: "error",
      comment:
        "vendor/litics-core is a copy of another repository, regenerated by " +
        "scripts/vendor-litics.ts. It must not come to depend on anything here, or the " +
        "next regeneration silently deletes the dependency and the build breaks somewhere " +
        "far from the cause.",
      from: { path: "^vendor/litics-(core|compactor)/" },
      to: { path: "^(packages|apps)/" },
    },

    // ---- 6 ---------------------------------------------------------------
    {
      name: "contract-is-a-leaf",
      severity: "error",
      comment:
        "@counted/contract describes the wire. It may import @orpc/*, zod and " +
        "@counted/kernel, and nothing else. The moment it imports a domain package, four " +
        "consumers — the server, the OpenAPI generator, the MCP layer and every client — " +
        "start dragging the domain along with them, and the contract stops being publishable " +
        "on its own. This is why the Permission and Role vocabulary lives in the kernel: the " +
        "contract needs it to emit OpenAPI security blocks and may not reach further.",
      from: { path: "^packages/contract/src" },
      to: {
        pathNot: [
          ...CONTRACT,
          ...KERNEL_ANY,
          npm("@orpc/[^/]+|zod"),
          TEST_RUNNER,
        ],
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "no-inner-layer-imports-the-contract",
      severity: "error",
      comment:
        "The contract is a wire concern. A domain or use case that imports it has let the " +
        "shape of an HTTP request decide the shape of a rule.",
      from: { path: "^packages/[^/]+/(domain|app)/src" },
      to: { path: CONTRACT },
    },

    // ---- 7 ---------------------------------------------------------------
    {
      name: "no-cross-context-domain",
      severity: "error",
      comment:
        "Two contexts' domains must not know each other. This is the actual DDD boundary: " +
        "cross-context talk goes through a port, so the coupling is a named interface " +
        "somebody chose rather than an import somebody reached for. Where a type genuinely " +
        "is shared — the Analysis a dashboard tile holds — the holder is generic in it and " +
        "the type is closed one layer up. See V3-SPEC.md, 'the one cross-context seam'.",
      from: { path: "^packages/([^/]+)/domain/src" },
      to: {
        path: [
          "^packages/(?!$1/)[^/]+/domain/src",
          "^@counted/(?!$1-)[^/]+-domain($|/)",
        ],
      },
    },

    // ---- 8 ---------------------------------------------------------------
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle makes the layering unprovable — there is no innermost package if the graph " +
        "loops.",
      from: {},
      to: { circular: true },
    },

    // ---- beyond the eight -------------------------------------------------
    {
      name: "domain-takes-values-not-capabilities",
      severity: "error",
      comment:
        "@counted/kernel/ports holds Clock, IdGenerator and Notifier. A domain function is " +
        "handed the Instant it acts at and the id it mints with — it never reaches for " +
        "either. Import them from app, from an adapter, or from the composition root.",
      from: { path: "^packages/[^/]+/domain/src" },
      to: { path: KERNEL_PORTS },
    },
    {
      name: "ports-declare-only",
      severity: "error",
      comment:
        "A ports package is interfaces and the value types they exchange. It may import " +
        "@counted/kernel and its own context's domain. An npm package here means the port " +
        "has been shaped by a vendor, which is the thing a port exists to prevent.",
      from: { path: "^packages/([^/]+)/ports/src" },
      to: {
        pathNot: [
          "^packages/$1/(ports|domain)/src",
          "^@counted/$1-(ports|domain)($|/)",
          ...KERNEL_ANY,
          TEST_RUNNER,
        ],
      },
    },
    {
      name: "adapters-know-no-apps",
      severity: "error",
      comment:
        "An adapter implements a port. Reaching up into an application shell inverts that — " +
        "composition happens in apps/*, not down here.",
      from: { path: "^packages/(adapters/|[^/]+/adapter-)" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-are-independent",
      severity: "error",
      comment:
        "Four deployables — api, web, mcp, worker. One importing another makes them one " +
        "deployable wearing four names. Share through a package.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/(?!$1/)[^/]+/" },
    },
    {
      name: "the-console-holds-no-credential",
      severity: "error",
      comment:
        "apps/web forwards the caller's authority and never adds any of its own. A service " +
        "key held by the web server, used 'on the user's behalf', is exactly the privileged " +
        "back-channel v2 managed to avoid — and it would quietly make 'every console action " +
        "is reachable by a third party with the right key' false. The console talks to the " +
        "API over the contract client, so it has no reason to import a server-side package " +
        "at all.",
      from: { path: "^apps/web/" },
      to: {
        path: [
          "^packages/[^/]+/(domain|app)/src",
          "^@counted/[^/]+-(domain|app)($|/)",
          "^packages/adapters/",
          "^@counted/adapter-[^/]+($|/)",
          "^packages/[^/]+/adapter-",
          "^@counted/[^/]+-adapter-[^/]+($|/)",
          "^packages/authorization/src",
          "^@counted/authorization($|/)",
        ],
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "An import that does not resolve is broken, and it also blinds the rules above: an " +
        "unresolvable module has no path, so a path-based boundary rule cannot see what it " +
        "is. Declare the dependency in the package's own package.json.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    /**
     * Without this, dependency-cruiser analyses the TRANSPILED module and every
     * `import type` disappears — which in a codebase whose ports packages are
     * nothing but types would mean these rules enforce almost nothing.
     */
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    /**
     * Our own build output only. Deliberately anchored to `packages/` and
     * `apps/`: an unanchored `/dist/` also hides every vendor import, because
     * `node_modules/<pkg>/dist/index.d.ts` is exactly where a library's types
     * live — which silently turned four of the rules above into no-ops.
     *
     * The second alternative is Next's output. `next dev` writes
     * `apps/web/next-env.d.ts` and `apps/web/.next/`, and dependency-cruiser
     * walks `apps/` from the filesystem, so it reads them: `next-env.d.ts`
     * references `next/image-types/global`, and `.next`'s generated
     * `validator.ts` imports `./routes.js`, neither of which this resolver can
     * resolve. Without this, running the dev script makes `bun run arch` fail
     * on files nobody wrote. Isolated builds may use any `.next-*` directory
     * directly under web or docs. These paths stay anchored there — a bare
     * `next-env` or `\.next` would also match inside `node_modules`.
     */
    exclude: { path: "^(packages|apps)/.*/dist/|^apps/(web|docs)/(\\.next/|\\.next-[^/]+/|next-env\\.d\\.ts$)" },
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

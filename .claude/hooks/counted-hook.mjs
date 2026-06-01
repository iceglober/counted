// Repo dogfooding shim. Runs the exact same bundled hook the Counted Claude Code
// plugin ships (packages/claude-code/bin/counted-hook.mjs) so there's one source
// of truth. Wired from .claude/settings.json; no-op unless COUNTED_AGENT_KEY is
// set. External users get this via `/plugin install claude-code@counted` instead.
import "../../packages/claude-code/bin/counted-hook.mjs";

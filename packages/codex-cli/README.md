# @counted/codex-cli — deprecated

This package never functioned as an integration. It contained a copy of the SDK
wrapper and no hook, so installing it registered nothing with codex and
produced no events. It was byte-identical to its sibling package, which is the
clearest evidence that neither held anything host-specific.

Use [`@counted/agent`](../agent-cli) instead:

```sh
npm i -g @counted/agent
export COUNTED_AGENT_KEY=ck_live_...
```

Then wire `counted-agent --host codex` into codex's own hook
configuration, passing the event JSON on stdin.

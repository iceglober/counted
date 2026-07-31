# @counted/agent-core

Not user-facing. The shared port behind Counted's agent integrations — install
[`@counted/agent`](../agent-cli), [`@counted/claude-code`](../agent-claude-code)
or [`@counted/opencode`](../agent-opencode) instead.

It exists because these things must not be able to disagree:

- **The vocabulary** (`src/gen/vocabulary.ts`) — generated from
  `contract/gen/agent.json` into this package *and* into the domain, so the
  check the SDK runs on a developer's machine and the check the server runs at
  ingest are the same check.
- **The redaction rules** (`src/redaction.ts`) — one declaration of `relPath`,
  `cmdName`, `langOf` and `scrubSecrets`. They used to be pasted into four
  packages, where fixing one left the others leaking. A test fails if any
  package declares them again.
- **The setup fingerprint** (`src/fingerprint.ts`) — adapters populate a
  canonical projection and this hashes it. Previously each adapter hashed its
  own host's config shape under the same version number, so cross-host
  comparison produced noise that looked like data.

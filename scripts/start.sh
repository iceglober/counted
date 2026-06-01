#!/bin/sh
# Container entrypoint: heal schema, then start the server.
# Must be a single script because Railway execs startCommand without a shell,
# so chaining with `;` or `&&` directly in startCommand only runs the first
# command. The resilient migrator always exits 0; `exec` hands PID 1 to the
# server for correct signal handling.
bun scripts/migrate-resilient.ts || true
exec bun server.js

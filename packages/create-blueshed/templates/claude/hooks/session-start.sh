#!/bin/sh
# SessionStart hook: stdout becomes model context (capped at 10k chars by the
# harness). Keep this a thin shim — the substance lives in invoket/agent and
# upgrades with the package, not with the scaffold.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -d node_modules ] || bun install >/dev/null 2>&1 || true
exec bun node_modules/invoket/src/cli.ts session:start

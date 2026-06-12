# create-blueshed

Scaffold a Bun project on the blueshed stack — **@blueshed/delta** (realtime doc sync), **@blueshed/railroad** (signals + real-DOM JSX), **invoket** (typed task CLI) — pre-wired for agent sessions.

```sh
bunx create-blueshed my-app
# or: npm create blueshed@latest my-app
cd my-app && bun install && bun dev
```

## What you get

- A running realtime app: `server.ts` (delta JSON-file backend), `src/app.tsx` (railroad UI), one shared doc that syncs across browser windows.
- `tasks.ts` with `ctx` (SQLite-backed project memory), `session` (session bring-up), and `check` (typecheck + tests) — all via `invt`.
- **Agent wiring**: a Claude Code SessionStart hook runs `invt session:start`, which syncs `.claude/skills/` from any dependency that ships skills (delta and railroad do), rebuilds project memory from the committed `.ctx.jsonl`, and injects facts + decisions into model context — on startup, resume, `/clear`, and compaction.
- `.mcp.json` wiring for [hjeli](https://github.com/blueshed/hjeli)'s MCP server, when the `hjeli` binary is on your PATH at scaffold time.

The hook is a thin shim; the logic lives in `invoket/agent` and upgrades with the package, not the scaffold.

## Project memory

`.ctx.jsonl` (committed, diffable) is the source of truth; `.ctx.db` (gitignored) is a rebuildable SQLite cache. Agents and humans append through the same CLI:

```sh
invt ctx:set db "Postgres 16 on :5432"
invt ctx:decide auth "JWT in httpOnly cookies" "XSS protection"
invt ctx:dump
```

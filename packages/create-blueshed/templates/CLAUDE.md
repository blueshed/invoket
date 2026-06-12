# __NAME__

Bun fullstack app on the blueshed stack: **@blueshed/delta** (realtime doc sync — three op verbs over one WebSocket), **@blueshed/railroad** (signals + real-DOM JSX), **invoket** (typed task CLI, `invt`).

**This is not React.** Before writing JSX or sync code, read the synced skills in `.claude/skills/` (`railroad`, `delta-doc`, `bun-route`). The habits that matter most: lowercase events (`onclick`) and `class` not `className`; never call `.get()` in JSX children; never mutate state locally after `doc.send` — the op echoes back and renders itself.

## Commands

- `bun dev` — serve on :3000 (HMR)
- `invt check` — typecheck + tests (the gate; keep it green)
- `invt -l` — list all tasks

## Project memory

A SessionStart hook runs `invt session:start`, which syncs skills from dependencies and injects this project's facts and decisions into your context. Record what you learn as you work:

- `invt ctx:set <key> <value...>` — facts (environment, conventions, state)
- `invt ctx:decide <subject> <decision> <rationale...>` — decisions
- `invt ctx:get|search|decisions|dump` — query

`.ctx.jsonl` is the committed source of truth; `.ctx.db` is a rebuildable cache (gitignored). Commit `.ctx.jsonl` changes with your work.

## Layout

- `server.ts` — `Bun.serve` + delta `registerDoc` (JSON-file backend; graduate per the delta-doc skill when queries or multi-process demand it — browser code doesn't change)
- `src/app.tsx` — railroad UI over the live `board:main` doc
- `tasks.ts` — invoket tasks (`ctx`, `session`, `check`)

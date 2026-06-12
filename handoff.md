# Handoff — get `create-blueshed` working (local session)

*Written 2026-06-12 by the remote (Claude Code on the web) session. Delete this file when the checklist is done.*

## Mission

Make `bunx create-blueshed my-app` work publicly. Everything is built, tested, and merged to `main` — the only thing the sandbox could not do is the **first npm publish of the new package** (and push git tags). Both need your local npm/git credentials.

## State

| Thing | Status |
|---|---|
| `invoket@0.2.0` (with new `invoket/agent` module) | **Published to npm and verified** — a scaffolded app installed it from the registry, typechecked, tested, and the SessionStart hook produced its payload |
| `create-blueshed@0.1.0` (`packages/create-blueshed/`) | **Code complete, CI-validated, NOT on npm.** Workflow run [27411842133](https://github.com/blueshed/invoket/actions/runs/27411842133) passed tests + scaffold smoke and built the tarball (17 files, 6.0 kB), then failed at `npm publish` with `ENEEDAUTH` — OIDC trusted publishing cannot *create* a package that doesn't exist yet |
| Git tag `v0.2.0` | **Missing.** invoket 0.2.0 was published via `workflow_dispatch` because the sandbox's git proxy 403s tag pushes. Both publish workflows now have an already-published guard, so pushing the tag retroactively is safe (the run will skip the publish step) |
| Branch `claude/invoket-claude-integration-eval-v0w5nw` | Fully merged into main; safe to delete |

## Checklist (in order)

```sh
git checkout main && git pull

# 1. First publish — needs your npm login (npm whoami should answer)
cd packages/create-blueshed
npm publish --access public
cd ../..

# 2. Backfill the invoket tag (safe: the workflow skips already-published versions)
git tag v0.2.0 0c3fcab   # "Add tag-driven publish workflow for create-blueshed" — the commit invoket@0.2.0 was built from
git push origin v0.2.0

# 3. Tag create-blueshed so the tag history matches npm
git tag create-blueshed-v0.1.0
git push origin create-blueshed-v0.1.0
```

4. **On npmjs.com** → `create-blueshed` → Settings → Trusted Publisher: GitHub Actions, repository `blueshed/invoket`, workflow `publish-create-blueshed.yml`. After this, future releases are just a `create-blueshed-vX.Y.Z` tag push (bump `packages/create-blueshed/package.json` first). `invoket` releases remain `vX.Y.Z` tags.

5. **Verify the public loop:**

```sh
cd /tmp && bunx create-blueshed try-app && cd try-app
bun install
invt check                 # tsc + tests green
invt session:start         # payload: stack versions, synced skills, seeded memory
bun dev                    # open two browser windows on :3000 — board syncs live
```

Also worth checking once: `npm create blueshed@latest other-app` (should behave identically). **`bun create blueshed` is unverified** — bun's npm-template flow copies packages rather than executing bins, so don't advertise it until tested; `bunx create-blueshed` is the documented path.

## What was built (map)

- `src/agent.ts` — `invoket/agent`: `Ctx` (project memory: `.ctx.jsonl` committed truth + `.ctx.db` SQLite cache, hash-replayed on clone/pull) and `Session` (`session:start` = SessionStart hook body: skills sync from deps + bounded context payload to stdout). Tested in `test/agent.test.ts` (20 tests incl. CLI integration through the real `invoket/agent` specifier).
- `packages/create-blueshed/` — scaffolder bin + `templates/` (delta+railroad board app, `tasks.ts` with ctx/session/check, seeded `.ctx.jsonl`, CLAUDE.md, `.claude/` hook + settings, test). Template files with leading dots are stored undotted (`gitignore`, `claude/`, `ctx.jsonl`) — npm packing; `cli.ts` restores the dots and substitutes `__NAME__`/`__NOW__`.
- `.github/workflows/publish-create-blueshed.yml` — tag `create-blueshed-v*` or dispatch; tests + scaffold smoke + guarded publish.
- `bunfig.toml` — scopes `bun test` to `test/` so the shipped template test doesn't run in this repo. Don't remove it.

## Gotchas for whoever edits `src/agent.ts`

The CLI discovers tasks by **regex over source** (`src/parser.ts`): a class body ends at the first column-0 `}`, discoverable methods must be `/** jsdoc */ async name(c: Context, ...)` with **no parentheses inside the parameter list**, and `Ctx`/`Session` must stay **defined directly in the file** the `./agent` export resolves to (re-export indirection downgrades them to untyped runtime discovery).

## Decisions taken this session (also reflected in README/CLAUDE.md)

- Memory is for **application projects only** — railroad/delta stay atomic (skills are their agent interface), hjeli is process; only scaffolded apps carry `.ctx.jsonl` + the hook.
- The hook is a thin shim; substance lives in `invoket/agent` so projects upgrade via package bump, not re-scaffold.

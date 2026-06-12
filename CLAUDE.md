# CLAUDE.md

Add reusable commands to `tasks.ts`. invoket gives them typed args, `--help`, and error handling.

Use invoket when a command will be reused. Write a raw script for throwaway one-offs.

## Task skeleton

```typescript
import { Context } from "invoket/context";

export class Tasks {
  /** Description (required — no JSDoc = not discovered) */
  async taskName(c: Context, required: string, optional: number = 1) {}
}
```

`async` + JSDoc + `c: Context` first param. `_prefix` = private.

## Types → CLI

`string` as-is, `number` rejects NaN, `boolean` accepts `true/false/1/0/--flag/--no-flag`, `"a" | "b"` validates against the listed choices, `Interface` and `Record` expect JSON string, `type[]` expects JSON array, `...args: string[]` collects remaining, `= default` and `| null` make optional.

## Flags

Auto: `--paramName`. For short flags add `@flag` in JSDoc:

```typescript
/** @flag env -e --environment */
async deploy(c: Context, env: string) {}
```

Unknown flags and extra positional args are errors. Negative numbers work as flag values (`--count -3`). Use `--` to pass remaining args literally (including `-h`).

## Namespaces

```typescript
class Db {
  /** Migrate */
  async migrate(c: Context, direction: string = "up") {}
}
export class Tasks {
  db = new Db();  // invt db:migrate up
}
```

## Context

```typescript
await c.run(cmd);                        // throw on failure
await c.run(cmd, { warn: true });        // don't throw
const { stdout } = await c.run(cmd, { hide: true }); // capture
await c.run(cmd, { stream: true });      // real-time output
await c.run(cmd, { echo: true });        // print command first
await c.sudo(cmd);                       // sudo prefix
for await (const _ of c.cd(dir)) { }    // temp cd
```

Result: `{ stdout, stderr, code, ok, failed }`. Failure throws `CommandError` with `.result`; the command's output is printed before the throw (with `hide`, stderr is folded into the error message).

Commands run via `sh -c` and interpolations are not escaped — single-quote values that may contain spaces or shell characters: `` c.run(`git commit -m '${msg.replace(/'/g, `'\\''`)}'`) ``.

`invt` finds `tasks.ts` in the current directory or any parent, and runs commands relative to where `tasks.ts` lives.

## Agent batteries

```typescript
import { Ctx, Session } from "invoket/agent";
export class Tasks {
  ctx = new Ctx();        // invt ctx:set/get/search/decide/decisions/dump — project memory
  session = new Session(); // invt session:start — SessionStart hook body (skills sync + memory inject)
}
```

`.ctx.jsonl` is committed truth; `.ctx.db` is a rebuildable cache (gitignore it). Record facts (`ctx:set key value...`) and decisions (`ctx:decide subject decision rationale...`) as you work.

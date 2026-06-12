# invoket

TypeScript task runner for Bun. Write typed methods, get a CLI for free.

```typescript
import { Context } from "invoket/context";

export class Tasks {
  /** Deploy to an environment */
  async deploy(c: Context, env: string, force: boolean = false) {
    await c.run(`deploy.sh ${env}${force ? " --force" : ""}`);
  }
}
```

```bash
$ invt deploy prod --force
```

No config files. No argument parser boilerplate. Your TypeScript types *are* the CLI definition.

## Why not just write a script?

You could. But then you write arg parsing, help text, and error handling every time. With invoket, you write a method and get all three for free. Your `tasks.ts` becomes a growing toolbox — every task documented, discoverable via `invt --help`, and callable by name with typed arguments.

One script solves one problem. A `tasks.ts` file is a project's command centre.

## Do you need invoket?

Maybe not. invoket's pitch — write a method, get arg parsing, help, and error handling for free — amortizes *authoring* effort. If an AI agent writes your commands, authoring is already free, and a bespoke `cli.ts` beside the code it operates on works just as well.

What every project still needs is an **inventory**: one well-known place where commands live, so the next session — human or agent — finds the existing command instead of writing a duplicate. invoket provides that, but so does a cheaper convention: `package.json` scripts, a justfile, or a paragraph in CLAUDE.md saying "commands live as `cli.ts` beside the code they operate on; check for an existing one before writing a new one".

invoket earns its keep when a human runs operational commands often enough to want one consistent grammar (`invt db:migrate up`) and a single `--help` that lists everything. If that's not you, a documented convention is enough.

## Installation

```bash
bun add -d invoket     # Add to project (use bunx invt to run)
bun add -g invoket     # Or install globally (invt available on PATH)
```

Then scaffold your project:

```bash
bunx invt --init       # Creates tasks.ts and CLAUDE.md
```

`--init` creates a starter `tasks.ts` and copies the `CLAUDE.md` reference card into your project so AI agents know how to write tasks.

## Quick Start

Edit `tasks.ts`:

```typescript
import { Context } from "invoket/context";

/**
 * My project tasks
 */
export class Tasks {
  /**
   * Say hello
   * @flag name -n
   * @flag count -c
   */
  async hello(c: Context, name: string, count: number = 1) {
    for (let i = 0; i < count; i++) {
      console.log(`Hello, ${name}!`);
    }
  }

  /** Search with JSON parameters */
  async search(c: Context, entity: string, params: { query: string; limit?: number }) {
    console.log(`Searching ${entity}: ${params.query}`);
  }

  /** Install packages */
  async install(c: Context, ...packages: string[]) {
    for (const pkg of packages) {
      await c.run(`bun add ${pkg}`);
    }
  }
}
```

Run it:

```bash
invt                              # Show help
invt hello World                  # Positional args
invt hello -n World -c 3          # Short flags
invt hello --name=World --count=3 # Long flags
invt search users '{"query":"bob"}' # JSON params
invt install react vue angular    # Rest params
invt hello -h                     # Task-specific help
```

## Namespaces

Group related tasks:

```typescript
class Db {
  /** Run database migrations */
  async migrate(c: Context, direction: string = "up") {
    await c.run(`prisma migrate ${direction}`);
  }

  /** Seed the database */
  async seed(c: Context) {
    await c.run("prisma db seed");
  }
}

export class Tasks {
  db = new Db();
}
```

```bash
invt db:migrate up    # colon separator
invt db.seed          # dot separator also works
```

## Arguments

### Type Mapping

| TypeScript | CLI | Example |
|------------|-----|---------|
| `name: string` | `<name>` (required) | `hello` |
| `name: string = "default"` | `[name]` (optional) | `hello` |
| `count: number` | `<count>` | `42` |
| `force: boolean` | `<force>` | `true`, `1`, `false`, `0` |
| `env: "dev" \| "prod"` | `<env>` (validated choice) | `dev` |
| `params: SomeInterface` | `<params>` | `'{"key": "value"}'` |
| `items: string[]` | `<items>` | `'["a", "b"]'` |
| `...args: string[]` | `[args...]` (variadic) | `a b c` |

### Flags

Every parameter automatically gets a `--long` flag. Add `@flag` annotations for short flags and aliases:

```typescript
/**
 * @flag env -e --environment
 * @flag force -f
 */
async deploy(c: Context, env: string, force: boolean = false) {}
```

```bash
invt deploy prod                       # positional
invt deploy --env=prod --force         # long flags
invt deploy -e prod -f                 # short flags
invt deploy --environment=prod         # alias
invt deploy --no-force                 # boolean negation
invt deploy --force=false              # explicit boolean
invt install -- --not-a-flag           # -- stops flag parsing
```

Flags and positional args can be freely mixed in any order.

Arguments are strict: an unknown flag or an extra positional argument is an error, not silently ignored — a typo'd `--cuont 3` fails loudly instead of running with the wrong count. Negative numbers are treated as values, so `--count -3` works.

### CLI Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show all tasks |
| `<task> -h` | Help for a specific task |
| `-l`, `--list` | List tasks |
| `--version` | Show version |
| `--init` | Scaffold `tasks.ts` and `CLAUDE.md` |

## Finding tasks.ts

`invt` looks for `tasks.ts` in the current directory, then walks up parent directories until it finds one (like `make` or `just`). Commands run relative to the directory containing `tasks.ts`, so `invt build` behaves the same from anywhere in the project.

## Context API

Every task receives a `Context` for shell execution:

```typescript
async deploy(c: Context, env: string) {
  await c.run("npm run build");                          // run command
  const { stdout } = await c.run("git rev-parse HEAD", { hide: true }); // capture output
  await c.run("rm -f temp.txt", { warn: true });         // ignore errors
  await c.run("npm test", { echo: true });                // echo before running
  await c.run("make", { stream: true });                  // stream output in real-time

  for await (const _ of c.cd("subdir")) {                 // temporary cd
    await c.run("ls");
  }

  await c.sudo("apt update");                             // sudo prefix
  await c.local("echo hello");                            // alias for run()
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `echo` | boolean | false | Print command before execution |
| `warn` | boolean | false | Don't throw on non-zero exit |
| `hide` | boolean | false | Capture output instead of printing |
| `stream` | boolean | false | Stream output in real-time |
| `cwd` | string | `process.cwd()` | Working directory |

### RunResult

```typescript
interface RunResult {
  stdout: string;    // captured output (empty when streaming)
  stderr: string;
  code: number;
  ok: boolean;       // code === 0
  failed: boolean;   // code !== 0
}
```

### Quoting

Commands run via `sh -c`, and interpolated values are **not** escaped. Wrap values that may contain spaces or shell characters in single quotes, escaping any embedded single quotes:

```typescript
const safe = message.replace(/'/g, `'\\''`);
await c.run(`git commit -m '${safe}'`);
```

### Error Handling

Failed commands throw `CommandError`:

```typescript
import { CommandError } from "invoket/context";

try {
  await c.run("exit 1");
} catch (e) {
  if (e instanceof CommandError) {
    console.log(e.result.code);   // 1
    console.log(e.result.stderr);
  }
}
```

Use `{ warn: true }` to suppress throws and inspect the result instead.

A failing command's output is always printed before the throw, so errors are never silent. With `{ hide: true }` the captured stderr is folded into the `CommandError` message instead.

## Private Methods

Prefix with `_` to hide from CLI:

```typescript
export class Tasks {
  async publicTask(c: Context) {
    this._helper();
  }
  async _helper() { }  // not discoverable, not callable via CLI
}
```

## Patterns

### Project setup

```typescript
/** Bootstrap dev environment */
async setup(c: Context) {
  await c.run("bun install");
  await c.run("cp .env.example .env", { warn: true });
  await c.run("bun run db:migrate");
  console.log("Ready to go!");
}
```

### Git workflow

```typescript
/**
 * Commit and push current branch
 * @flag message -m
 */
async ship(c: Context, message: string) {
  const { stdout } = await c.run("git branch --show-current", { hide: true });
  await c.run("git add -A");
  const safe = message.replace(/'/g, `'\\''`);
  await c.run(`git commit -m '${safe}'`);
  await c.run(`git push -u origin ${stdout.trim()}`);
}
```

### Run with fallback

```typescript
/** Lint and fix */
async lint(c: Context) {
  const result = await c.run("eslint . --fix", { warn: true, hide: true });
  if (result.failed) {
    console.log("Lint errors remain:");
    console.log(result.stdout);
  }
}
```

### Capture and transform

```typescript
/** Show outdated deps */
async deps(c: Context) {
  const { stdout } = await c.run("bun outdated --json", { hide: true, warn: true });
  const deps = JSON.parse(stdout || "[]");
  for (const d of deps) console.log(`${d.name}: ${d.current} → ${d.latest}`);
}
```

### Scaffold files

```typescript
/** @flag name -n */
async component(c: Context, name: string) {
  const upper = name[0].toUpperCase() + name.slice(1);
  await c.run(`mkdir -p src/components/${name}`);
  await c.run(`cat > src/components/${name}/index.tsx << 'EOF'
export function ${upper}() {
  return <div>${upper}</div>;
}
EOF`);
  console.log(`Created src/components/${name}/index.tsx`);
}
```

## Agentic Tools

AI agents like Claude Code have built-in tools for searching files, reading code, and running commands. What they lack is **project context** — the state of migrations, the history of decisions, the shape of your API, which tests are flaky and why. That knowledge lives in developers' heads, scattered across commits, issues, and Slack threads.

invoket lets you build a **structured, queryable project knowledge base** that agents can read and write through the same CLI interface humans use. Bun's built-in SQLite makes this trivial — no external database, no setup, just a `.ctx.db` file that travels with the project.

### Batteries included — `invoket/agent`

The pattern below ships ready-made. Two lines in `tasks.ts`:

```typescript
import { Ctx, Session } from "invoket/agent";

export class Tasks {
  ctx = new Ctx();        // invt ctx:set / get / search / decide / decisions / dump
  session = new Session(); // invt session:start / skills
}
```

`Ctx` stores facts and decisions in `.ctx.db` (a rebuildable cache — gitignore it) and `.ctx.jsonl` (the committed source of truth — diffable, merge-friendly; a fresh clone or a pulled change is replayed automatically). `Session.start` is built to be a Claude Code **SessionStart hook** body: it syncs `.claude/skills/` from any dependency that ships skills, rebuilds the cache, and prints a bounded context payload to stdout — which the hook injects into the model's context on startup, resume, `/clear`, and compaction:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" }]
      }
    ]
  }
}
```

```sh
#!/bin/sh
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -d node_modules ] || bun install >/dev/null 2>&1 || true
exec bun node_modules/invoket/src/cli.ts session:start
```

`bunx create-blueshed my-app` scaffolds a Bun project with all of this wired — delta + railroad + invoket, skills sync, hook, seeded memory (see `packages/create-blueshed`).

**Scope: memory belongs to applications.** Library packages stay atomic — their agent interface is the skills they ship, versioned with the code. Tools carry their own process (their feedback loop *is* the memory). Only an application accumulates project-specific facts and decisions worth a store; that's where `Ctx` and the SessionStart hook go.

Prefer your own schema? The hand-rolled version of the same pattern:

### Project context — a SQLite-backed knowledge base

```typescript
import { Context } from "invoket/context";
import { Database } from "bun:sqlite";

class Ctx {
  private db: Database;

  constructor() {
    this.db = new Database(".ctx.db", { create: true });
    this.db.run(`CREATE TABLE IF NOT EXISTS context (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY,
      subject TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  }

  /** Store a key-value fact about the project */
  async set(c: Context, key: string, ...value: string[]) {
    this.db.run(
      `INSERT OR REPLACE INTO context (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
      [key, value.join(" ")]
    );
    console.log(`Set: ${key}`);
  }

  /** Retrieve a fact */
  async get(c: Context, key: string) {
    const row = this.db.query("SELECT value, updated_at FROM context WHERE key = ?").get(key) as any;
    if (!row) { console.log(`Not found: ${key}`); return; }
    console.log(`${row.value}  (${row.updated_at})`);
  }

  /** Search facts by keyword */
  async search(c: Context, ...terms: string[]) {
    const pattern = `%${terms.join(" ")}%`;
    const rows = this.db.query(
      "SELECT key, value FROM context WHERE key LIKE ? OR value LIKE ?"
    ).all(pattern, pattern) as any[];
    for (const r of rows) console.log(`${r.key}: ${r.value}`);
  }

  /** Record an architectural decision */
  async decide(c: Context, subject: string, decision: string, ...rationale: string[]) {
    this.db.run(
      "INSERT INTO decisions (subject, decision, rationale) VALUES (?, ?, ?)",
      [subject, decision, rationale.join(" ")]
    );
    console.log(`Recorded: ${subject}`);
  }

  /** List active decisions */
  async decisions(c: Context) {
    const rows = this.db.query(
      "SELECT id, subject, decision, rationale FROM decisions WHERE status = 'active' ORDER BY created_at DESC"
    ).all() as any[];
    for (const r of rows) {
      console.log(`#${r.id} ${r.subject}: ${r.decision}`);
      if (r.rationale) console.log(`   ${r.rationale}`);
    }
  }

  /** Dump all context as JSON */
  async dump(c: Context) {
    const facts = this.db.query("SELECT key, value FROM context ORDER BY key").all();
    const decisions = this.db.query("SELECT * FROM decisions WHERE status = 'active'").all();
    console.log(JSON.stringify({ facts, decisions }, null, 2));
  }
}

export class Tasks {
  ctx = new Ctx();
}
```

```bash
# Store project facts
invt ctx:set db "Postgres 16 on Supabase, migrations in prisma/"
invt ctx:set api "REST with /api/v2 prefix, auth via JWT middleware"
invt ctx:set deploy "Fly.io, auto-deploy on push to main"

# Record decisions with rationale
invt ctx:decide auth "JWT in httpOnly cookies" "Chose over localStorage for XSS protection"
invt ctx:decide orm "Prisma over Drizzle" "Team familiarity, existing migrations"

# Query context
invt ctx:get db
invt ctx:search auth
invt ctx:decisions

# Dump everything for agent context
invt ctx:dump
```

An agent starts a session with `invt ctx:dump` and immediately has structured project knowledge — not flat markdown, not grep results, but queryable facts and decisions with timestamps.

### Why SQLite?

Bun bundles SQLite natively — `import { Database } from "bun:sqlite"` just works. No dependencies, no server, no config. The `.ctx.db` file is a single file you can `.gitignore` or commit. You can extend the schema as the project grows: add tables for endpoints, test history, deployment logs, whatever your project needs.

### Growing the schema

The example above is a starting point. A real project might track more:

```typescript
// Track API endpoints and their status
this.db.run(`CREATE TABLE IF NOT EXISTS endpoints (
  path TEXT PRIMARY KEY,
  method TEXT,
  handler TEXT,
  auth TEXT DEFAULT 'required',
  status TEXT DEFAULT 'active'
)`);

// Track test health
this.db.run(`CREATE TABLE IF NOT EXISTS test_runs (
  id INTEGER PRIMARY KEY,
  suite TEXT,
  passed INTEGER,
  failed INTEGER,
  skipped INTEGER,
  ran_at TEXT DEFAULT (datetime('now'))
)`);
```

The namespace class is the interface. The schema is yours to shape around what your project actually needs to remember.

## Requirements

- Bun >= 1.0.0

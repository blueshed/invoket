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

### CLI Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show all tasks |
| `<task> -h` | Help for a specific task |
| `-l`, `--list` | List tasks |
| `--version` | Show version |
| `--init` | Scaffold `tasks.ts` and `CLAUDE.md` |

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
  await c.run(`git commit -m "${message}"`);
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

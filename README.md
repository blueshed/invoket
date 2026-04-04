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
bun add -d invoket    # Add to project
bun link invoket      # Or link globally for development
```

## Quick Start

Create `tasks.ts`:

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

## Requirements

- Bun >= 1.0.0

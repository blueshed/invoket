# invoket

A TypeScript task runner for Bun that uses type annotations to parse CLI arguments.

## Features

- **Type-safe CLI parsing** — TypeScript types determine how arguments are parsed
- **Zero configuration** — Just write a `Tasks` class with typed methods
- **JSON support** — Object and array parameters are automatically parsed from JSON
- **Namespace support** — Organize tasks with `db:migrate` style namespaces
- **Rest parameters** — Support for `...args` variadic parameters
- **Auto-generated help** — JSDoc descriptions become CLI help text

## Installation

```bash
bun link invoket
```

## Quick Start

```bash
invt                    # Show help
invt hello World 3      # Run task with args
invt db:migrate up      # Run namespaced task
invt --version          # Show version
```

## Writing Tasks

Create a `tasks.ts` file with a `Tasks` class:

```typescript
import { Context } from "invoket/context";

interface SearchParams {
  query: string;
  limit?: number;
}

/**
 * Project build and deployment tasks
 */
export class Tasks {
  /** Say hello with a name and repeat count */
  async hello(c: Context, name: string, count: number) {
    for (let i = 0; i < count; i++) {
      console.log(`Hello, ${name}!`);
    }
  }

  /** Search with JSON parameters */
  async search(c: Context, entity: string, params: SearchParams) {
    console.log(`Searching ${entity}: ${params.query}`);
  }

  /** Install packages (rest params) */
  async install(c: Context, ...packages: string[]) {
    for (const pkg of packages) {
      await c.run(`npm install ${pkg}`);
    }
  }
}
```

## Namespaces

Organize related tasks into namespaces:

```typescript
class DbNamespace {
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
  db = new DbNamespace();
}
```

Call with `invt db:migrate up` or `invt db.seed`.

## Type Mapping

| TypeScript | CLI Display | Example Input |
|------------|-------------|---------------|
| `name: string` | `<name>` | `hello` |
| `name: string = "default"` | `[name]` | `hello` (optional) |
| `count: number` | `<count>` | `42` |
| `force: boolean` | `<force>` | `true` or `1` |
| `params: SomeInterface` | `<params>` | `'{"key": "value"}'` |
| `items: string[]` | `<items>` | `'["a", "b", "c"]'` |
| `...args: string[]` | `[args...]` | `a b c` (variadic) |

## Flag-Based Arguments

Arguments can be passed positionally or as flags:

```bash
invt hello World 2                    # positional
invt hello --name=World --count=2     # long flags with =
invt hello --name World --count 2     # long flags with space
invt hello -n World -c 2              # short flags (requires @flag)
invt hello World --count=2            # mixed positional and flags
invt hello --count=2 World            # flags can appear anywhere
```

### @flag Annotations

Define short flags and aliases with JSDoc `@flag`:

```typescript
/**
 * Deploy the application
 * @flag env -e --environment
 * @flag force -f
 */
async deploy(c: Context, env: string, force: boolean = false) {}
```

### Boolean Flags

```bash
invt deploy --force                   # true
invt deploy --force=true              # true
invt deploy --no-force                # false (negation prefix)
```

### Stop Flag Parsing

```bash
invt install -- --not-a-flag          # "--not-a-flag" treated as positional
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show help with all tasks |
| `<task> -h` | Show help for a specific task |
| `-l`, `--list` | List available tasks |
| `--version` | Show version |

### Task-Specific Help

Get detailed help for any task:

```bash
invt hello -h
# Usage: invt hello <name> <count>
#
# Say hello with a name and repeat count
#
# Arguments:
#   name            string     (required)
#   count           number     (required)

invt db:migrate --help
# Usage: invt db:migrate [direction]
#
# Run database migrations
#
# Arguments:
#   direction       string     (optional)
```

## Context API

Every task receives a `Context` object as the first parameter:

```typescript
async deploy(c: Context, env: string) {
  // Run shell commands
  await c.run("npm run build");
  
  // Capture output
  const { stdout } = await c.run("git rev-parse HEAD", { hide: true });
  
  // Ignore errors
  await c.run("rm -f temp.txt", { warn: true });
  
  // Echo command before running
  await c.run("npm test", { echo: true });
  
  // Change directory temporarily
  for await (const _ of c.cd("subdir")) {
    await c.run("ls");
  }
  
  // Sudo
  await c.sudo("apt update");
  
  // Access config
  console.log(c.config);  // { echo: false, warn: false, ... }
  
  // local() is alias for run()
  await c.local("echo hello");
}
```

### Context Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `echo` | boolean | false | Print command before execution |
| `warn` | boolean | false | Don't throw on non-zero exit |
| `hide` | boolean | false | Capture output instead of printing |
| `stream` | boolean | false | Stream output in real-time (stdout/stderr not captured) |
| `cwd` | string | process.cwd() | Working directory |

### RunResult

```typescript
interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;      // code === 0
  failed: boolean;  // code !== 0
}
```

### Error Handling

Failed commands throw a `CommandError` with the result attached:

```typescript
import { CommandError } from "invoket/context";

try {
  await c.run("exit 1");
} catch (e) {
  if (e instanceof CommandError) {
    console.log(e.result.code);    // 1
    console.log(e.result.stderr);  // error output
  }
}
```

## Private Methods

Methods starting with `_` are private and won't appear in help or be callable:

```typescript
export class Tasks {
  async publicTask(c: Context) { }
  async _privateHelper(c: Context) { }  // Hidden
}
```

## Testing

```bash
bun test
```

## Requirements

- Bun >= 1.0.0

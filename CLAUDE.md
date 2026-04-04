# CLAUDE.md

Build CLI tools by adding methods to `tasks.ts`. invoket turns them into shell commands with typed args, help text, and error handling — no boilerplate.

**When to use invoket:** When the project needs a reusable command. Add a method to `tasks.ts` and it's instantly callable via `invt`, with `--help`, flags, and type checking. The file grows into the project's toolbox.

**When to write a raw script:** One-off throwaway tasks that won't be reused.

## Quick Start

```typescript
import { Context } from "invoket/context";

export class Tasks {
  /** Greet by name */
  async hello(c: Context, name: string, count: number = 1) {
    for (let i = 0; i < count; i++) console.log(`Hello, ${name}!`);
  }
}
```

```bash
invt hello World           # Hello, World!
invt hello World 3         # prints 3 times
invt hello --name=World    # flags work too
invt hello -h              # shows usage
```

## Rules

- Every task: `async`, JSDoc comment, `c: Context` first param
- No JSDoc = not discovered
- `_prefix` = private (hidden from CLI)

## Types → CLI

| Type | CLI input | Notes |
|------|-----------|-------|
| `string` | `hello` | as-is |
| `number` | `42` | rejects NaN |
| `boolean` | `true`, `1`, `--flag`, `--no-flag` | |
| `Interface` | `'{"key":"val"}'` | JSON string |
| `string[]` | `'["a","b"]'` | JSON array |
| `...args: string[]` | `a b c` | rest params, collects all remaining |
| `x: string = "default"` | optional | default kicks in |
| `x: string \| null` | optional | nullable |

## Flags

Every param gets `--paramName` automatically. Add `@flag` for short flags:

```typescript
/**
 * @flag env -e --environment
 * @flag force -f
 */
async deploy(c: Context, env: string, force: boolean = false) {}
```

`invt deploy -e prod -f` / `invt deploy --environment=prod --no-force`

## Namespaces

```typescript
class Db {
  /** Run migrations */
  async migrate(c: Context, direction: string = "up") {
    await c.run(`prisma migrate ${direction}`);
  }
}

export class Tasks {
  db = new Db();
}
```

`invt db:migrate up` or `invt db.migrate up`

## Context API

```typescript
await c.run("npm build");                              // run, throw on failure
await c.run("rm tmp", { warn: true });                 // don't throw
const { stdout } = await c.run("git log", { hide: true }); // capture output
await c.run("make", { stream: true });                 // real-time output
await c.run("npm test", { echo: true });               // print command first
await c.sudo("apt update");                            // sudo prefix
for await (const _ of c.cd("sub")) { await c.run("ls"); } // temp cd
```

Options: `echo`, `warn`, `hide`, `stream`, `cwd`. Result: `{ stdout, stderr, code, ok, failed }`.

Failed commands throw `CommandError` with `.result` attached. Use `{ warn: true }` to suppress.

## Patterns for Useful Tools

### Project setup task

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
 * Create branch, commit, push
 * @flag message -m
 */
async ship(c: Context, message: string) {
  const { stdout } = await c.run("git branch --show-current", { hide: true });
  await c.run(`git add -A`);
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

### Multi-step deploy

```typescript
class Deploy {
  /**
   * Deploy to environment
   * @flag env -e
   */
  async run(c: Context, env: string = "staging") {
    await c.run("bun test", { stream: true });
    await c.run("bun run build");
    await c.run(`rsync -avz dist/ ${env}.example.com:/app/`);
    console.log(`Deployed to ${env}`);
  }

  /** Rollback last deploy */
  async rollback(c: Context) {
    await c.run("ssh prod 'cd /app && git checkout HEAD~1'");
  }
}

export class Tasks {
  deploy = new Deploy();
}
```

### Capture and transform

```typescript
/** Show outdated deps as table */
async deps(c: Context) {
  const { stdout } = await c.run("bun outdated --json", { hide: true, warn: true });
  const deps = JSON.parse(stdout || "[]");
  for (const d of deps) {
    console.log(`${d.name}: ${d.current} → ${d.latest}`);
  }
}
```

### Generate files

```typescript
/**
 * Scaffold a new component
 * @flag name -n
 */
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

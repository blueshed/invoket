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

invoket shines as a toolbox for AI agents. Instead of writing ad-hoc scripts each session, the agent adds methods to `tasks.ts` that persist across sessions. `invt --help` shows what tools are available. The file becomes the project's growing command centre.

### Memory — persist context across sessions

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

class Memory {
  private dir = ".memory";

  private ensure() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  /** Store a value by key */
  async store(c: Context, key: string, ...value: string[]) {
    this.ensure();
    writeFileSync(`${this.dir}/${key}.md`, value.join(" "));
    console.log(`Stored: ${key}`);
  }

  /** Recall a value by key */
  async recall(c: Context, key: string) {
    const path = `${this.dir}/${key}.md`;
    if (!existsSync(path)) { console.log(`Not found: ${key}`); return; }
    console.log(readFileSync(path, "utf-8"));
  }

  /** List all stored keys */
  async list(c: Context) {
    this.ensure();
    const { stdout } = await c.run(`ls ${this.dir}`, { hide: true, warn: true });
    console.log(stdout || "(empty)");
  }
}

export class Tasks {
  memory = new Memory();
}
```

```bash
invt memory:store arch "Monorepo with packages/api and packages/web"
invt memory:recall arch
invt memory:list
```

### Task planning — break work into steps

```typescript
import { existsSync, readFileSync, writeFileSync } from "fs";

class Plan {
  private file = ".plan.json";

  private load(): { task: string; done: boolean }[] {
    if (!existsSync(this.file)) return [];
    return JSON.parse(readFileSync(this.file, "utf-8"));
  }

  private save(tasks: { task: string; done: boolean }[]) {
    writeFileSync(this.file, JSON.stringify(tasks, null, 2));
  }

  /** Add a step to the plan */
  async add(c: Context, ...task: string[]) {
    const tasks = this.load();
    tasks.push({ task: task.join(" "), done: false });
    this.save(tasks);
    console.log(`Added step ${tasks.length}: ${task.join(" ")}`);
  }

  /** Mark step as done */
  async done(c: Context, step: number) {
    const tasks = this.load();
    tasks[step - 1].done = true;
    this.save(tasks);
    console.log(`Done: ${tasks[step - 1].task}`);
  }

  /** Show the plan */
  async show(c: Context) {
    const tasks = this.load();
    if (!tasks.length) { console.log("No plan yet."); return; }
    for (const [i, t] of tasks.entries()) {
      console.log(`${t.done ? "✓" : " "} ${i + 1}. ${t.task}`);
    }
  }

  /** Clear the plan */
  async clear(c: Context) {
    this.save([]);
    console.log("Plan cleared.");
  }
}

export class Tasks {
  plan = new Plan();
}
```

```bash
invt plan:add "Set up database schema"
invt plan:add "Write API endpoints"
invt plan:add "Add tests"
invt plan:show
invt plan:done 1
```

### Session journal — log decisions

```typescript
import { appendFileSync, existsSync, readFileSync } from "fs";

class Journal {
  private file = ".journal.md";

  /** Log a decision or finding */
  async log(c: Context, ...entry: string[]) {
    const ts = new Date().toISOString().slice(0, 16);
    appendFileSync(this.file, `\n## ${ts}\n\n${entry.join(" ")}\n`);
    console.log("Logged.");
  }

  /** Show recent entries */
  async show(c: Context) {
    if (!existsSync(this.file)) { console.log("No journal yet."); return; }
    console.log(readFileSync(this.file, "utf-8"));
  }
}

export class Tasks {
  journal = new Journal();
}
```

```bash
invt journal:log "Chose Postgres over SQLite for concurrent writes"
invt journal:show
```

### Codebase search — structured context gathering

```typescript
class Search {
  /** Find files matching a pattern */
  async files(c: Context, pattern: string) {
    await c.run(`find . -name "${pattern}" -not -path "*/node_modules/*"`, { stream: true });
  }

  /** Search code for a pattern */
  async code(c: Context, pattern: string, ...glob: string[]) {
    const g = glob.length ? `--glob '${glob.join("' --glob '")}'` : "";
    await c.run(`rg "${pattern}" ${g} --type-not binary`, { stream: true, warn: true });
  }

  /** Summarise project structure */
  async tree(c: Context) {
    await c.run("find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -50", { stream: true });
  }
}

export class Tasks {
  search = new Search();
}
```

```bash
invt search:code "async.*Context" "*.ts"
invt search:files "*.test.ts"
invt search:tree
```

These tasks persist in the project. Every session, the agent starts with `invt --help` and has its full toolbox ready.

## Requirements

- Bun >= 1.0.0

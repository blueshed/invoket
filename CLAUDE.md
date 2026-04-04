# CLAUDE.md

Context for AI assistants working on this codebase.

## What This Is

**invoket** — a Bun CLI tool where users write a `Tasks` class in TypeScript and the CLI parses the source code at runtime to extract method signatures, types, and JSDoc, then maps CLI arguments to typed function calls.

## Module Structure

```
src/
  parser.ts   — All logic: type extraction, arg parsing, coercion, discovery (560 lines)
  cli.ts      — Entry point only: imports from parser.ts, runs main() (194 lines)
  context.ts  — Shell execution: Context class, CommandError (111 lines)
```

**parser.ts** is the brain. **cli.ts** is the skeleton. **context.ts** is the runtime.

Tests import directly from `parser.ts`. There is no duplicated logic in tests.

## Data Flow

```
tasks.ts source code
  → discoverAllTasks(source)         # regex-parses class bodies for methods + JSDoc
    → extractMethodsFromClass()      # finds async methodName(c: Context, ...) patterns
    → parseParams()                  # extracts param names, types, defaults, @flag annotations
    → extractFlagAnnotations()       # parses @flag JSDoc tags
  → discoverRuntimeNamespaces()      # walks prototype chain for imported namespace classes

CLI args
  → parseCliArgs(args)               # splits into { positional, flags } Map
  → resolveArgs(params, parsed)      # matches flags/positional to param metadata
  → coerceArg(value, type)           # string → number/boolean/object/array
  → method.call(thisArg, context, ...coercedArgs)
```

## Key Design Decisions

**Source parsing, not reflection.** We regex-parse the TypeScript source to get type info because Bun strips types at runtime. This means type info comes from source text, not runtime metadata.

**Flags from params, not config.** Every parameter automatically gets `--paramName`. Short flags (`-f`) and aliases (`--environment`) come from `@flag` JSDoc annotations. No separate flag configuration object.

**Positional alignment matters.** When `resolveArgs` skips an optional param, it pushes `undefined` into the result array so subsequent params land in the correct function argument positions (JavaScript default params handle `undefined` correctly).

**Class body regex uses `\n}` terminator.** The pattern `class Foo { ... \n}` relies on the closing brace being at column 0. Works for all standard formatting. Nested braces inside methods are indented so they don't match.

## Gotchas and Known Limitations

- **Union types not supported.** `status: "pending" | "active"` detects as "object" and fails. Only `| null` is handled (makes param optional).
- **Negative numbers as flag values.** `--count -5` treats `-5` as a flag, not a value. Use `--count=-5` instead.
- **Inherited methods lose type info.** Methods from parent classes are callable but get empty params (no source to parse). All args treated as strings.
- **`--no-flag=value` is ambiguous.** `--no-verbose` works (sets `verbose` to false). But `--no-verbose=false` hits the `--flag=value` branch first and creates a flag named `no-verbose` with string value `"false"`.
- **Multi-char short flags are positional.** `-abc` is treated as a positional arg, not three flags. Only single-char `-f` is a flag.

## Exported API (parser.ts)

All public functions are exported. Key ones:

| Function | Purpose |
|----------|---------|
| `discoverAllTasks(source)` | Parse source → root tasks + namespaces |
| `discoverRuntimeNamespaces(instance, discovered)` | Find imported namespace classes at runtime |
| `parseCliArgs(args)` | Split CLI args into `{ positional, flags }` |
| `resolveArgs(params, parsed)` | Match flags/positional to params, coerce types |
| `coerceArg(value, type)` | Convert string to typed value |
| `parseParams(paramsStr, jsdoc)` | Parse parameter string into `ParamMeta[]` |
| `extractFlagAnnotations(jsdoc)` | Parse `@flag` JSDoc annotations |
| `extractMethodsFromClass(source, className)` | Extract methods from a class body |
| `extractClassDoc(source)` | Get class-level JSDoc |
| `parseCommand(command)` | Split `"db:migrate"` into `{ namespace, method }` |
| `formatParam`, `formatFlagInfo` | Format for help display |
| `printTaskList`, `showTaskHelp` | Print help output |

Types: `ParamType`, `ParamMeta`, `FlagMeta`, `TaskMeta`, `ParsedArgs`, `DiscoveredTasks`

## Writing tasks.ts

When helping a user write tasks, follow these rules:

**Every method must** have `async`, a JSDoc comment, and `c: Context` as the first parameter:

```typescript
import { Context } from "invoket/context";

export class Tasks {
  /** Description becomes help text */
  async myTask(c: Context, requiredArg: string, optionalArg: number = 10) {
    await c.run(`echo ${requiredArg}`);
  }
}
```

**Parameter types map directly to CLI behavior:**
- `string` — passed through as-is
- `number` — parsed with `Number()`, rejects NaN
- `boolean` — accepts `true/false/1/0` on CLI, also supports `--flag` (true) and `--no-flag` (false)
- Interface/Record/`{...}` — user must pass JSON string: `'{"key":"val"}'`
- `type[]` — user must pass JSON array: `'["a","b"]'`
- `...args: string[]` — collects all remaining positional args
- `| null` suffix — makes the param optional

**Short flags require `@flag` annotations in JSDoc:**

```typescript
/**
 * Deploy the app
 * @flag env -e --environment
 * @flag force -f
 */
async deploy(c: Context, env: string, force: boolean = false) {}
```

Without `@flag`, only `--paramName` long flags work (auto-generated).

**Namespaces use class instantiation in Tasks:**

```typescript
class Db {
  /** Run migrations */
  async migrate(c: Context, direction: string = "up") {}
}

export class Tasks {
  db = new Db();  // creates db:migrate namespace
}
```

The property name becomes the namespace. Prefix with `_` to hide.

**Methods without JSDoc are not discovered.** Every public task needs a `/** */` comment.

**Context API essentials:**
- `c.run(cmd)` — run shell command, throws on failure
- `c.run(cmd, { warn: true })` — don't throw on failure
- `c.run(cmd, { hide: true })` — capture output instead of printing
- `c.run(cmd, { stream: true })` — real-time output streaming
- `c.run(cmd, { echo: true })` — print command before running
- `c.sudo(cmd)` — prefix with `sudo`
- `c.cd(dir)` — async generator for temporary directory change
- `c.local(cmd)` — alias for `c.run(cmd)`

## How to Add a Primitive Type

1. Add to `ParamType` union in `parser.ts`
2. Add detection in the `if/else` chain in `parseParams()`
3. Add coercion case in `coerceArg()` switch
4. Add tests in `test/cli.test.ts`

## Testing

```bash
bun test               # 221 tests
bun test --coverage    # 100% functions, 99.87% lines
```

Tests import from `src/parser.ts`. One test-only helper exists: `extractTaskMeta()` — a 5-line wrapper around `extractMethodsFromClass` that lets tests pass bare method snippets without wrapping in a class.

## Publishing

Automated via GitHub Actions on tag push:

```bash
git tag v0.1.8 && git push --tags
```

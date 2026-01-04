# CLAUDE.md

This file provides context for AI assistants working on this codebase.

## Project Overview

**invoket** is a TypeScript task runner for Bun that parses CLI arguments based on TypeScript type annotations. It's inspired by Python's Invoke but uses TypeScript's type system instead of decorators.

## Architecture

```
invoket/
├── tasks.ts           # User-defined tasks (Tasks class)
├── src/
│   ├── cli.ts         # CLI entry point and type parser
│   └── context.ts     # Shell execution context
├── test/
│   ├── cli.test.ts    # Main test suite (186 tests)
│   ├── context.test.ts
│   └── integration/
├── examples/
│   └── tasks.ts       # Example tasks with @flag annotations
└── package.json       # Binary: invt
```

## Key Concepts

### Type Extraction

The CLI parses TypeScript source code to extract method signatures:

```typescript
async search(c: Context, entity: string, params: SearchParams)
```

Becomes:
```
search <entity> <params>
  - entity: string (required)
  - params: object (required, parsed as JSON)
```

### Argument Parsing

Arguments can be passed positionally or as flags:

```bash
# All equivalent:
invt hello World 2                    # positional
invt hello --name=World --count=2     # long flags with =
invt hello --name World --count 2     # long flags with space
invt hello -n World -c 2              # short flags (requires @flag annotation)
invt hello World --count=2            # mixed positional and flags
invt hello --count=2 World            # flags can appear anywhere
```

### Flag Annotations

Define short flags and aliases using JSDoc `@flag` annotations:

```typescript
/**
 * Deploy the application
 * @flag env -e --environment
 * @flag force -f
 */
async deploy(c: Context, env: string, force: boolean = false) {}
```

This enables:
- `invt deploy -e prod -f`
- `invt deploy --environment=prod --force`
- `invt deploy prod` (positional still works)

### Boolean Flags

Boolean parameters support special handling:
- `--force` alone means `true`
- `--force=true` or `--force=false` work explicitly
- `--no-force` means `false` (negation prefix)

### Stop Flag Parsing

Use `--` to stop flag parsing (standard Unix convention):
```bash
invt install -- --not-a-flag    # "--not-a-flag" treated as positional
```

### Discovery Algorithm

1. `discoverAllTasks(source)` - Main entry point
2. `extractMethodsFromClass(source, className)` - Parse class body for methods
3. `extractFlagAnnotations(jsdoc)` - Extract `@flag` annotations
4. `extractClassDoc(source)` - Get class-level JSDoc for help header
5. Namespace detection via `propName = new ClassName()` pattern

### Type Coercion

CLI string arguments are coerced based on detected types:

| Detected Type | Coercion |
|---------------|----------|
| `string` | Pass through |
| `number` | `Number(value)` with NaN check |
| `boolean` | `"true"/"1"` → true, `"false"/"0"` → false |
| `object` | `JSON.parse()` with object validation |
| `array` | `JSON.parse()` with array validation |

### Type Detection Rules

The regex `(\w+\[\]|Record<[^>]+>|\{[^}]*\}|string|number|boolean|\w+)` matches types in this order:
1. `string[]`, `number[]` → array
2. `Record<K,V>` → object
3. `{...}` inline objects → object
4. `string`, `number`, `boolean` → primitives
5. Any other identifier (interface names) → object

Order matters: more specific patterns must come before `\w+`.

### Rest Parameters

Rest params (`...args: string[]`) are detected and:
- Displayed as `[args...]` in help
- Collect all remaining CLI arguments
- Always optional (no minimum required)
- Do not get flag metadata (must be positional)

### Namespaces

Namespaces are detected by finding class instantiation patterns:
```typescript
db = new DbNamespace();  // Creates db: namespace
```

Called via `invt db:migrate` or `invt db.migrate`.

### Private Methods/Namespaces

- Methods starting with `_` are excluded from discovery
- Namespaces starting with `_` are excluded
- Calling private methods returns explicit error message

## Implemented Features

| Feature | Status |
|---------|--------|
| Private methods (`_prefix`) | ✅ |
| Namespace support (`db:migrate`) | ✅ |
| Rest parameters (`...items`) | ✅ |
| Prototype chain for inheritance | ✅ |
| Class-level JSDoc | ✅ |
| `--version` flag | ✅ |
| `--help` / `-h` flag (general) | ✅ |
| `<task> -h` (task-specific help) | ✅ |
| `--list` / `-l` flag | ✅ |
| Context.config property | ✅ |
| Context.local() alias | ✅ |
| Context.run() with options | ✅ |
| Context.sudo() | ✅ |
| Context.cd() async generator | ✅ |
| Flag-based arguments (`--flag`) | ✅ |
| Short flags (`-f`) via @flag | ✅ |
| Flag aliases via @flag | ✅ |
| Boolean negation (`--no-flag`) | ✅ |
| Stop flag parsing (`--`) | ✅ |
| Mixed positional and flags | ✅ |

### Not Yet Implemented

- `--init` flag - scaffolding for new projects
- Plugin system - pre/post task hooks

## Common Tasks

### Adding a new primitive type

1. Add to `ParamType` union in `cli.ts`
2. Add detection in the type mapping `if/else` chain in `parseParams()`
3. Add coercion case in `coerceArg()` switch
4. Add tests in `test/cli.test.ts`

### Adding a new task

Edit `tasks.ts`:
```typescript
/**
 * Description for help text
 * @flag param1 -p
 */
async myTask(c: Context, param1: string, param2: SomeType) {
  // implementation
}
```

The CLI will automatically discover it.

### Adding a namespace

```typescript
class MyNamespace {
  /** Task description */
  async myMethod(c: Context) { }
}

export class Tasks {
  my = new MyNamespace();
}
```

## Testing

```bash
bun test                    # Run all tests (186 tests)
bun test --watch           # Watch mode
bun test --grep "pattern"  # Run specific tests
```

Tests include:
- Unit tests for `parseCliArgs`, `resolveArgs`, `coerceArg`
- Unit tests for `extractFlagAnnotations`, `parseParamsWithFlags`
- Unit tests for `discoverTasks`, `validateTaskName`
- Integration tests that run the actual CLI

## Publishing

Publishing to npm is automated via GitHub Actions when you push a tag:

```bash
# Update version in package.json, then:
git add -A
git commit -m "v0.1.5"
git tag v0.1.5
git push && git push --tags
```

The workflow (`.github/workflows/publish.yml`) runs tests and publishes with npm provenance.

## Bun-Specific Features Used

- `Bun.$` shell API for command execution
- `Bun.file().text()` for reading source
- `Bun.file().json()` for reading package.json
- `Bun.resolveSync()` for path resolution
- `bun:test` for testing
- `bun link` for local binary installation

## Binary

The package exposes `invt` binary via package.json:
```json
{
  "bin": {
    "invt": "./src/cli.ts"
  }
}
```

After `bun link && bun link invoket`:
```bash
./node_modules/.bin/invt --help
```

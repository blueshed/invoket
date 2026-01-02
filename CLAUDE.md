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
│   ├── cli.test.ts    # Bun tests (71 tests)
│   └── context.ts     # Shell execution context
├── spec.md            # Original JavaScript specification
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

### Discovery Algorithm

1. `discoverAllTasks(source)` - Main entry point
2. `extractMethodsFromClass(source, className)` - Parse class body for methods
3. `extractClassDoc(source)` - Get class-level JSDoc for help header
4. Namespace detection via `propName = new ClassName()` pattern

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

## Implemented Spec Features

| Feature | Spec Section | Status |
|---------|--------------|--------|
| Private methods (`_prefix`) | §3 | ✅ |
| Namespace support (`db:migrate`) | §5 | ✅ |
| Rest parameters (`...items`) | §3 | ✅ |
| Prototype chain for inheritance | §8 | ✅ |
| Class-level JSDoc | §6 | ✅ |
| `--version` flag | §2 | ✅ |
| `--help` / `-h` flag (general) | §2 | ✅ |
| `<task> -h` (task-specific help) | §2 | ✅ |
| `--list` / `-l` flag | §2 | ✅ |
| Context.config property | §4 | ✅ |
| Context.local() alias | §4 | ✅ |
| Context.run() with options | §4 | ✅ |
| Context.sudo() | §4 | ✅ |
| Context.cd() async generator | §4 | ✅ |

### Not Yet Implemented

- `--init` flag (§2) - scaffolding for new projects
- Plugin system (§7) - pre/post task hooks
- Legacy underscore notation `db_migrate` (§5) - prefer `:` or `.` separators

### Intentionally Skipped

- Superclass resolution (§11) - **Not needed with TypeScript**. Inherited methods work at runtime via prototype chain. Source parsing only needed for the declaring class.

## Common Tasks

### Adding a new primitive type

1. Add to `ParamType` union in `cli.ts`
2. Add detection in the type mapping `if/else` chain in `parseParams()`
3. Add coercion case in `coerceArg()` switch
4. Add tests in `cli.test.ts`

### Adding a new task

Edit `tasks.ts`:
```typescript
/** Description for help text */
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
bun test                    # Run all tests (71 tests)
bun test --watch           # Watch mode
```

Tests include:
- Unit tests for `extractTaskMeta`, `coerceArg`, `parseCommand`
- Unit tests for `discoverTasks`, `validateTaskName`
- Integration tests that run the actual CLI

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

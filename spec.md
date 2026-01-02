# invokej Specification

> Version: 1.0 | Package Version: 0.4.6 | Runtime: Bun

## 1. Overview

invokej is a JavaScript task execution tool that transforms class methods into CLI commands with zero configuration.

### Problem Solved

- Eliminates complex build tool configurations
- Provides natural task organization through class structure
- Auto-generates documentation from JSDoc comments
- Supports task namespacing for complex projects

### Design Principles

1. **Class-Based Tasks** - Tasks are methods of a `Tasks` class, not decorated functions
2. **Convention Over Configuration** - No config files; uses class structure and JSDoc
3. **Context Object Pattern** - Every task receives a Context object for shell operations
4. **Namespace Support** - Instance properties containing objects become namespaced commands

---

## 2. CLI Interface

### Command Syntax

```
invj <task> [args...]
invj <namespace>:<method> [args...]
invj <namespace>.<method> [args...]
```

Both `:` and `.` are valid namespace separators.

### Flags

| Flag | Long Form | Description |
|------|-----------|-------------|
| `-h` | `--help` | Display help (same as no arguments) |
| `-l` | `--list` | List all available tasks |
| | `--version` | Display package version |
| | `--init` | Initialize new project (interactive) |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (task not found, execution failed, etc.) |

### Help Output Format

```
invokej — JavaScript task runner inspired by Python Invoke — version X.Y.Z

[Class JSDoc description if present]

Available tasks:

  hello [name]       — Say hello to someone
  build <env>        — Build the project
  
  db:
  migrate [direction] — Run database migrations
  seed               — Seed the database

Usage:
  invokej <task> [args...]              # Run root task
  invokej <namespace>:<task> [args...]  # Run namespaced task
  invokej -l                            # List tasks
  invokej -h                            # Show help
  invokej --version                     # Show version
```

---

## 3. Tasks Class Contract

### Basic Structure

```javascript
export class Tasks {
  /** Task description shown in help */
  async taskName(c, param1, param2 = "default") {
    // c = Context object (always first parameter)
    // param1, param2 = CLI arguments
  }
}
```

### Requirements

- Must be exported as named export: `export class Tasks`
- Must be in `tasks.js` in current working directory
- Methods must be functions (checked with `typeof`)
- First parameter receives Context object

### Parameter to CLI Mapping

| JavaScript Signature | CLI Display |
|---------------------|-------------|
| `(c)` | (no params) |
| `(c, name)` | `<name>` |
| `(c, name = "World")` | `[name]` |
| `(c, ...items)` | `[items...]` |
| `(c, {verbose, output})` | `[verbose] [output]` |

**Rules:**
- First parameter (context) is always hidden
- Parameters without defaults are required: `<param>`
- Parameters with defaults are optional: `[param]`
- Rest parameters show as: `[param...]`
- Destructured objects extract property names

### Private Methods

Methods starting with `_` are private and cannot be called:

```javascript
export class Tasks {
  async publicTask(c) { }      // Callable
  async _privateHelper(c) { }  // Hidden, not callable
}
```

### Constructor

- Called once when Tasks is instantiated
- Cannot be invoked as a task
- Used to initialize namespaces and state
- Receives no parameters

### Inheritance

Methods are inherited through JavaScript's prototype chain:

```javascript
class BaseTasks {
  async baseTask(c) { }
}

export class Tasks extends BaseTasks {
  async childTask(c) { }
}
// Both baseTask and childTask are available
```

---

## 4. Context API

The Context object (`c`) provides shell execution utilities.

### Constructor

```javascript
new Context({
  echo: false,   // Print command before execution
  warn: false,   // Continue on command failure (don't throw)
  hide: false,   // Capture output instead of printing
  pty: false,    // Pseudo-terminal mode (reserved)
  cwd: string    // Working directory
})
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `c.cwd` | string | Current working directory (read/write) |
| `c.pwd` | string | Alias for cwd (read-only getter) |
| `c.config` | object | Merged configuration options |

### Methods

#### `c.run(command, options?)`

Execute a shell command.

**Parameters:**
- `command` (string): Shell command with full syntax support (pipes, redirects, &&, ||)
- `options` (object, optional): Override default options

**Options:**
```javascript
{
  echo: boolean,   // Print command before execution
  warn: boolean,   // Don't throw on non-zero exit
  hide: boolean,   // Capture stdout/stderr
  pty: boolean,    // PTY mode
  cwd: string      // Working directory override
}
```

**Returns:** `Promise<RunResult>`

```javascript
{
  stdout: string,    // Captured stdout (empty if hide=false)
  stderr: string,    // Captured stderr (empty if hide=false)
  code: number,      // Exit code
  ok: boolean,       // true if code === 0
  failed: boolean    // true if code !== 0
}
```

**Behavior:**
- Default: throws Error on non-zero exit
- With `warn: true`: returns result without throwing
- With `hide: true`: captures output in result
- Without `hide`: inherits stdio, empty strings in result

**Error on failure (when warn=false):**
```
Command failed with exit code X: <command>
```
Error object has `error.result` property with full result.

#### `c.sudo(command, options?)`

Execute command with sudo prefix.

```javascript
await c.sudo("apt install nginx");
// Equivalent to: c.run("sudo apt install nginx")
```

#### `c.local(command, options?)`

Alias for `c.run()`. Used for explicit local execution.

#### `c.cd(directory)`

Async context manager for temporary directory change.

```javascript
for await (const _ of c.cd("subdir")) {
  // c.cwd is now subdir
  await c.run("ls");
}
// c.cwd restored to original
```

---

## 5. Namespaces

### Definition

Namespaces are objects with methods assigned as instance properties:

```javascript
class DbNamespace {
  async migrate(c, direction = "up") { }
  async seed(c) { }
}

export class Tasks {
  constructor() {
    this.db = new DbNamespace();
  }
}
```

### Calling

```bash
invj db:migrate up
invj db.seed
```

### Private Namespaces

Namespaces starting with `_` are private:

```javascript
constructor() {
  this.db = new DbNamespace();       // Public: db:*
  this._internal = new Internal();   // Private: hidden
}
```

### Resolution Order

1. Parse command: `db:migrate` → namespace="db", method="migrate"
2. Validate namespace not private
3. Validate method not private
4. Get namespace object from instance
5. Get method from namespace object
6. Call with context and args

### Legacy Support

Underscore notation is supported with deprecation warning:

```bash
invj db_migrate up
# ⚠️  Using db_migrate - consider migrating to db:migrate notation
```

---

## 6. JSDoc Integration

### Class Documentation

JSDoc immediately before `export class Tasks` becomes the header description:

```javascript
/**
 * Project build and deployment tasks
 */
export class Tasks { }
```

### Method Documentation

First line of JSDoc becomes task description:

```javascript
/**
 * Deploy to production
 * Additional details ignored
 * @param target - Also ignored
 */
async deploy(c, target) { }
```

Extracted as: `Deploy to production`

### Extraction Rules

- Only first non-`@` line is extracted
- `@param`, `@returns`, `@throws` are not displayed
- Leading `*` and whitespace are stripped
- Private methods are excluded
- Constructor is excluded

### Inheritance

When Tasks extends a base class:
1. Import statement is parsed for parent file
2. Parent file is read
3. Methods from parent are extracted
4. Child methods override parent

---

## 7. Plugin System

### Philosophy

Plugins are **utility classes** that users integrate into tasks.js:
- Plugins export reusable classes
- Users import from `invokej/plugins`
- Users instantiate and wire up in Tasks class
- **NOT auto-registered** - explicit integration

### Import Pattern

```javascript
import { ToDoManager, TodoUI } from "invokej/plugins";
import { WorkAPI } from "invokej/plugins";
import { ContextWall, WallNamespace } from "invokej/plugins";
import { AIWorkAPI, AIWorkNamespace } from "invokej/plugins";
```

### Integration Pattern

```javascript
import { ToDoManager, TodoUI } from "invokej/plugins";

export class Tasks {
  constructor() {
    this.manager = new ToDoManager("todos.db");
    this.ui = new TodoUI(this.manager);
  }

  /** Add a todo */
  async addTodo(c, title) {
    const id = this.manager.addTodo(title);
    console.log(`Added #${id}`);
  }
}
```

### Namespace Plugin Pattern

```javascript
import { WallNamespace } from "invokej/plugins";

export class Tasks {
  constructor() {
    this.wall = new WallNamespace();
  }
  // All wall:* methods come from WallNamespace
}
```

### Available Plugins

| Export | Description |
|--------|-------------|
| `ToDoManager`, `TodoUI` | SQLite-based todo management |
| `WorkAPI` | Project and task tracking |
| `ContextWall`, `WallNamespace` | Project context management |
| `AIWorkAPI`, `AIWorkNamespace` | AI memory system |

---

## 8. Task Discovery Algorithm

### Root Tasks

1. Walk prototype chain from instance
2. Continue until `Object.prototype`
3. Collect method names using `Object.getOwnPropertyNames(proto)`
4. Filter out:
   - `constructor`
   - Names starting with `_`
   - Non-functions
5. Return unique method names

### Namespaced Tasks

1. Get own properties: `Object.getOwnPropertyNames(instance)`
2. Skip properties starting with `_`
3. For each property that is a non-null, non-array object:
   - Get methods from its prototype
   - Filter out constructor and `_` prefixed
   - Keep only functions
4. Return as `{ namespaceName: [methods] }`

### Discovery Result

```javascript
{
  root: ["hello", "build", "deploy"],
  namespaced: {
    db: ["migrate", "seed", "reset"],
    git: ["feature", "release"]
  }
}
```

---

## 9. Execution Flow

### Command: `invj hello world`

1. Load `tasks.js` from current directory
2. Import and instantiate: `const instance = new Tasks()`
3. Create context: `const context = new Context()`
4. Load JSDoc from tasks.js source
5. Parse command: `{ namespace: null, method: "hello" }`
6. Validate: not private, not constructor
7. Resolve: find `instance.hello`
8. Execute: `await instance.hello.apply(instance, [context, "world"])`
9. On success: exit 0
10. On error: log to stderr, exit 1

### Command: `invj db:migrate up`

1. Load and instantiate Tasks
2. Parse: `{ namespace: "db", method: "migrate" }`
3. Validate namespace and method
4. Resolve: `instance.db.migrate`
5. Execute: `await instance.db.migrate.apply(instance.db, [context, "up"])`

### Command: `invj --help`

1. Load and instantiate Tasks
2. Load JSDoc
3. Discover all tasks
4. Format and print help
5. Exit 0

---

## 10. Error Handling

### Error Messages

| Condition | Message |
|-----------|---------|
| No tasks.js | `ERROR: No tasks.js file found in current directory` |
| No Tasks class | `ERROR: No Tasks class exported from tasks.js` |
| Private namespace | `Cannot call private namespace "<name>"` |
| Private method | `Cannot call private method "<name>"` |
| Constructor called | `Cannot call constructor method "constructor"` |
| Unknown task | `Unknown task "<command>"` |
| Execution error | `Error running "<command>": <message>` |

### Behavior

- All errors write to stderr
- All errors exit with code 1
- Unknown task errors include the task list
- Command failures (via `c.run`) throw with result attached

---

## 11. File Discovery

### tasks.js Location

```javascript
path.resolve(process.cwd(), "tasks.js")
```

Must be in the current working directory.

### Superclass Resolution

When `export class Tasks extends BaseTasks`:
1. Parse import: `import { BaseTasks } from "./base.js"`
2. Resolve path relative to tasks.js directory
3. Read and parse parent file
4. Extract parent methods

---

## 12. Examples

### Minimal tasks.js

```javascript
export class Tasks {
  /** Say hello */
  async hello(c, name = "World") {
    console.log(`Hello, ${name}!`);
  }
}
```

### With Shell Commands

```javascript
export class Tasks {
  /** Build the project */
  async build(c) {
    await c.run("npm run build");
  }

  /** Run tests with coverage */
  async test(c, coverage = false) {
    const cmd = coverage ? "npm test -- --coverage" : "npm test";
    await c.run(cmd);
  }

  /** Deploy to server */
  async deploy(c, env = "staging") {
    const result = await c.run("git rev-parse HEAD", { hide: true });
    console.log(`Deploying ${result.stdout.trim()} to ${env}`);
    await c.run(`./deploy.sh ${env}`);
  }
}
```

### With Namespaces

```javascript
class Docker {
  async build(c, tag = "latest") {
    await c.run(`docker build -t app:${tag} .`);
  }

  async push(c, tag = "latest") {
    await c.run(`docker push app:${tag}`);
  }
}

class Db {
  async migrate(c, direction = "up") {
    await c.run(`npx prisma migrate ${direction}`);
  }

  async seed(c) {
    await c.run("npx prisma db seed");
  }
}

export class Tasks {
  constructor() {
    this.docker = new Docker();
    this.db = new Db();
  }

  /** Full deployment */
  async deploy(c) {
    await this.db.migrate(c);
    await this.docker.build(c);
    await this.docker.push(c);
  }
}
```

### With Plugin

```javascript
import { ToDoManager, TodoUI } from "invokej/plugins";

export class Tasks {
  constructor() {
    this.mgr = new ToDoManager("project.db");
    this.ui = new TodoUI(this.mgr);
  }

  /** Add a task */
  async add(c, title, priority = "3") {
    const id = this.mgr.addTodo(title, "", parseInt(priority));
    console.log(`Added task #${id}`);
  }

  /** List pending tasks */
  async list(c) {
    const todos = this.mgr.getTodos("pending");
    this.ui.displayTodoList(todos, "Pending");
  }

  /** Complete a task */
  async done(c, id) {
    this.mgr.completeTodo(parseInt(id));
    console.log(`Completed #${id}`);
  }
}
```

---

## 13. Package Exports

```javascript
// Main CLI
import invokej from "invokej";

// Context class
import { Context } from "invokej/context";

// All plugins
import { 
  ToDoManager, 
  TodoUI,
  WorkAPI,
  ContextWall,
  WallNamespace,
  AIWorkAPI,
  AIWorkNamespace 
} from "invokej/plugins";
```

---

## 14. Runtime Requirements

- **Runtime:** Bun >= 1.0.0
- **Module System:** ES Modules (`"type": "module"`)
- **Node.js:** Not supported (uses `bun:sqlite`)

---

## Appendix: Quick Reference

### CLI Commands

```bash
invj                    # Show help
invj -h | --help        # Show help
invj -l | --list        # List tasks
invj --version          # Show version
invj --init             # Initialize project
invj <task> [args]      # Run task
invj ns:task [args]     # Run namespaced task
```

### Context Quick Reference

```javascript
// Execute command
await c.run("npm install");

// Capture output
const { stdout } = await c.run("git status", { hide: true });

// Ignore errors
await c.run("rm -f file.txt", { warn: true });

// Print command
await c.run("npm test", { echo: true });

// Change directory temporarily
for await (const _ of c.cd("subdir")) {
  await c.run("ls");
}

// Sudo
await c.sudo("apt update");
```

### Task Patterns

```javascript
// Required param
async task(c, required) { }           // task <required>

// Optional param  
async task(c, optional = "x") { }     // task [optional]

// Rest params
async task(c, ...items) { }           // task [items...]

// Mixed
async task(c, req, opt = "x") { }     // task <req> [opt]
```

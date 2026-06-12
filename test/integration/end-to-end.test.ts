import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

/**
 * End-to-end integration tests for invoket CLI
 * These tests simulate installing invoket in an external project
 */

const TEST_DIR = "/tmp/invoket-integration-test";
const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");
const CONTEXT_PATH = join(import.meta.dir, "../../src/context.ts");

// Helper to run CLI in test directory
async function runCLI(...args: string[]) {
  const result = await $`bun ${CLI_PATH} ${args}`
    .cwd(TEST_DIR)
    .quiet()
    .nothrow();
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// Helper to write a tasks file with proper formatting
function writeTasks(content: string) {
  const header = `import { Context } from "${CONTEXT_PATH}";\n`;
  writeFileSync(join(TEST_DIR, "tasks.ts"), header + content);
}

describe("End-to-End CLI Tests", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("CLI Init", () => {
    test("should scaffold tasks.ts and CLAUDE.md", async () => {
      const result = await runCLI("--init");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Created tasks.ts");
      expect(result.stdout).toContain("Created CLAUDE.md");
      expect(existsSync(join(TEST_DIR, "tasks.ts"))).toBe(true);
      expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(true);
    });

    test("should not overwrite existing tasks.ts", async () => {
      writeFileSync(join(TEST_DIR, "tasks.ts"), "existing");

      const result = await runCLI("--init");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("already exists");

      const tasks = await Bun.file(join(TEST_DIR, "tasks.ts")).text();
      expect(tasks).toBe("existing");
    });

    test("should append to existing CLAUDE.md", async () => {
      writeFileSync(join(TEST_DIR, "CLAUDE.md"), "# Existing project notes\n");

      const result = await runCLI("--init");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Appended invoket guide");

      const claude = await Bun.file(join(TEST_DIR, "CLAUDE.md")).text();
      expect(claude).toContain("# Existing project notes");
      expect(claude).toContain("invoket");
    });

    test("should skip CLAUDE.md if invoket guide already present", async () => {
      const guide = await Bun.file(
        join(import.meta.dir, "../../CLAUDE.md"),
      ).text();
      writeFileSync(join(TEST_DIR, "CLAUDE.md"), guide);

      const result = await runCLI("--init");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("already has invoket section");
    });

    test("should append guide when CLAUDE.md merely mentions invoket", async () => {
      writeFileSync(
        join(TEST_DIR, "CLAUDE.md"),
        "# Notes\nWe use invoket here.\n",
      );

      const result = await runCLI("--init");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Appended invoket guide");
    });
  });

  describe("CLI Help and Version", () => {
    test("should show help with --help", async () => {
      writeTasks(`
export class Tasks {
  /** Test task */
  async hello(c: Context) {}
}
`);

      const result = await runCLI("--help");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("invoket");
      expect(result.stdout).toContain("Available tasks:");
    });

    test("should show version with --version", async () => {
      writeTasks(`export class Tasks {}`);

      const result = await runCLI("--version");
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    test("should show help with no arguments", async () => {
      writeTasks(`export class Tasks {}`);

      const result = await runCLI();
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("invoket");
    });
  });

  describe("Task Listing", () => {
    test("should list available tasks", async () => {
      writeTasks(`
export class Tasks {
  /** Build the project */
  async build(c: Context) {}
  /** Run tests */
  async test(c: Context) {}
}
`);

      const result = await runCLI("--list");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Available tasks:");
      expect(result.stdout).toContain("build");
      expect(result.stdout).toContain("test");
    });

    test("should list namespaced tasks", async () => {
      writeTasks(`
class DbNamespace {
  /** Run migrations */
  async migrate(c: Context) {}
}

export class Tasks {
  db = new DbNamespace();
  /** Build project */
  async build(c: Context) {}
}
`);

      const result = await runCLI("--list");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("build");
      expect(result.stdout).toContain("db:");
      expect(result.stdout).toContain("migrate");
    });

    test("should not list private methods", async () => {
      writeTasks(`
export class Tasks {
  /** Public task */
  async publicTask(c: Context) {}
  /** Private task */
  async _privateTask(c: Context) {}
}
`);

      const result = await runCLI("--list");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("publicTask");
      expect(result.stdout).not.toContain("_privateTask");
    });

    test("should not list private namespaces", async () => {
      writeTasks(`
class PrivateNamespace {
  /** Method */
  async method(c: Context) {}
}

export class Tasks {
  _private = new PrivateNamespace();
  /** Public task */
  async hello(c: Context) {}
}
`);

      const result = await runCLI("--list");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).not.toContain("_private");
    });
  });

  describe("Task Execution", () => {
    test("should execute simple task", async () => {
      writeTasks(`
export class Tasks {
  /** Say hello */
  async hello(c: Context) {
    console.log("Hello, World!");
  }
}
`);

      const result = await runCLI("hello");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Hello, World!");
    });

    test("should execute task with string argument", async () => {
      writeTasks(`
export class Tasks {
  /** Greet someone */
  async greet(c: Context, name: string) {
    console.log(\`Hello, \${name}!\`);
  }
}
`);

      const result = await runCLI("greet", "Alice");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Hello, Alice!");
    });

    test("should execute task with number argument", async () => {
      writeTasks(`
export class Tasks {
  /** Count */
  async count(c: Context, n: number) {
    console.log(\`Count: \${n}, type: \${typeof n}\`);
  }
}
`);

      const result = await runCLI("count", "42");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Count: 42");
      expect(result.stdout).toContain("type: number");
    });

    test("should execute task with boolean argument", async () => {
      writeTasks(`
export class Tasks {
  /** Toggle */
  async toggle(c: Context, flag: boolean) {
    console.log(\`Flag: \${flag}, type: \${typeof flag}\`);
  }
}
`);

      const result = await runCLI("toggle", "true");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Flag: true");
      expect(result.stdout).toContain("type: boolean");
    });

    test("should execute task with JSON object argument", async () => {
      writeTasks(`
interface Config { name: string; }
export class Tasks {
  /** Configure */
  async config(c: Context, cfg: Config) {
    console.log(\`Name: \${cfg.name}\`);
  }
}
`);

      const result = await runCLI("config", '{"name":"test"}');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Name: test");
    });

    test("should execute namespaced task", async () => {
      writeTasks(`
class DbNamespace {
  /** Run migrations */
  async migrate(c: Context, direction: string = "up") {
    console.log(\`Migrating \${direction}\`);
  }
}

export class Tasks {
  db = new DbNamespace();
}
`);

      const result = await runCLI("db:migrate", "down");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Migrating down");
    });

    test("should execute namespaced task with dot separator", async () => {
      writeTasks(`
class DbNamespace {
  /** Seed database */
  async seed(c: Context) {
    console.log("Seeding...");
  }
}

export class Tasks {
  db = new DbNamespace();
}
`);

      const result = await runCLI("db.seed");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Seeding...");
    });

    test("should fail on unknown task", async () => {
      writeTasks(`
export class Tasks {
  /** Build */
  async build(c: Context) {}
}
`);

      const result = await runCLI("unknownTask");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown task");
    });

    test("should fail on private task call", async () => {
      writeTasks(`
export class Tasks {
  /** Private */
  async _privateTask(c: Context) {}
}
`);

      const result = await runCLI("_privateTask");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("private");
    });

    test("should fail on private namespace call", async () => {
      writeTasks(`
class PrivateNs {
  /** Method */
  async method(c: Context) {}
}

export class Tasks {
  _private = new PrivateNs();
}
`);

      const result = await runCLI("_private:method");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("private");
    });
  });

  describe("Task-Specific Help", () => {
    test("should show task help with -h", async () => {
      writeTasks(`
export class Tasks {
  /** Deploy to environment */
  async deploy(c: Context, env: string, force: boolean = false) {}
}
`);

      const result = await runCLI("deploy", "-h");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: invt deploy");
      expect(result.stdout).toContain("<env>");
      expect(result.stdout).toContain("[force]");
      expect(result.stdout).toContain("Deploy to environment");
    });

    test("should show namespaced task help", async () => {
      writeTasks(`
class DbNamespace {
  /** Run migrations */
  async migrate(c: Context, direction: string = "up") {}
}

export class Tasks {
  db = new DbNamespace();
}
`);

      const result = await runCLI("db:migrate", "-h");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: invt db:migrate");
      expect(result.stdout).toContain("[direction]");
    });
  });

  describe("Rest Parameters", () => {
    test("should handle rest parameters", async () => {
      writeTasks(`
export class Tasks {
  /** Install packages */
  async install(c: Context, ...packages: string[]) {
    console.log(\`Installing: \${packages.join(", ")}\`);
  }
}
`);

      const result = await runCLI("install", "react", "vue", "angular");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Installing: react, vue, angular");
    });

    test("should work with zero rest args", async () => {
      writeTasks(`
export class Tasks {
  /** Install packages */
  async install(c: Context, ...packages: string[]) {
    console.log(\`Count: \${packages.length}\`);
  }
}
`);

      const result = await runCLI("install");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Count: 0");
    });
  });

  describe("Context API Usage", () => {
    test("should use context to run commands", async () => {
      writeTasks(`
export class Tasks {
  /** Echo message */
  async echo(c: Context, message: string) {
    await c.run(\`echo "\${message}"\`);
  }
}
`);

      const result = await runCLI("echo", "Test Message");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Test Message");
    });

    test("should handle command failures", async () => {
      writeTasks(`
export class Tasks {
  /** Fail */
  async fail(c: Context) {
    await c.run("exit 1");
  }
}
`);

      const result = await runCLI("fail");
      expect(result.code).toBe(1);
    });

    test("should use warn option to continue on failure", async () => {
      writeTasks(`
export class Tasks {
  /** Warn test */
  async warnTest(c: Context) {
    await c.run("exit 1", { warn: true });
    console.log("Continued after failure");
  }
}
`);

      const result = await runCLI("warnTest");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Continued after failure");
    });
  });

  describe("Error Handling", () => {
    test("should handle missing tasks.ts file", async () => {
      // Don't create tasks.ts
      const result = await runCLI("build");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("No tasks.ts found");
      expect(result.stderr).toContain("--init");
    });

    test("should show a failed command's stderr", async () => {
      writeTasks(`
export class Tasks {
  /** Fail loudly */
  async fail(c: Context) {
    await c.run("ls /definitely-not-here-12345");
  }
}
`);

      const result = await runCLI("fail");
      expect(result.code).toBe(1);
      // The command's own diagnostic must reach the user, not just the exit code
      expect(result.stderr).toContain("definitely-not-here-12345");
      expect(result.stderr).toContain("No such file");
    });

    test("should include hidden stderr in the thrown error message", async () => {
      writeTasks(`
export class Tasks {
  /** Fail with hidden output */
  async fail(c: Context) {
    await c.run("echo 'secret diagnostic' >&2; exit 3", { hide: true });
  }
}
`);

      const result = await runCLI("fail");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("exit code 3");
      expect(result.stderr).toContain("secret diagnostic");
    });

    test("should show a stack trace for bugs in the task itself", async () => {
      writeTasks(`
export class Tasks {
  /** Buggy task */
  async boom(c: Context) {
    const x: any = undefined;
    x.someMethod();
  }
}
`);

      const result = await runCLI("boom");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Error running");
      expect(result.stderr).toContain("at ");
    });

    test("should handle invalid tasks.ts syntax", async () => {
      writeFileSync(
        join(TEST_DIR, "tasks.ts"),
        "this is not valid TypeScript {{{",
      );

      const result = await runCLI("build");
      expect(result.code).not.toBe(0);
    });

    test("should handle missing Tasks class export", async () => {
      writeFileSync(
        join(TEST_DIR, "tasks.ts"),
        `export class NotTasks { async build() {} }`,
      );

      const result = await runCLI("build");
      expect(result.code).toBe(1);
    });
  });

  describe("Tasks file lookup", () => {
    test("should find tasks.ts from a subdirectory", async () => {
      writeTasks(`
export class Tasks {
  /** Where am I */
  async where(c: Context) {
    const { stdout } = await c.run("pwd", { hide: true });
    console.log(\`cwd=\${stdout.trim()}\`);
  }
}
`);
      const subdir = join(TEST_DIR, "deeply", "nested");
      mkdirSync(subdir, { recursive: true });

      const result = await $`bun ${CLI_PATH} where`
        .cwd(subdir)
        .quiet()
        .nothrow();
      expect(result.exitCode).toBe(0);
      // Commands run relative to tasks.ts, not the invocation directory
      expect(result.stdout.toString()).toContain(`cwd=${TEST_DIR}`);
    });
  });

  describe("String-Literal Union Choices", () => {
    test("should accept a valid choice and reject an invalid one", async () => {
      writeTasks(`
export class Tasks {
  /** Deploy to an environment */
  async deploy(c: Context, env: "dev" | "prod", force: boolean = false) {
    console.log(\`deploying to \${env} force=\${force}\`);
  }
}
`);

      const ok = await runCLI("deploy", "prod");
      expect(ok.code).toBe(0);
      expect(ok.stdout).toContain("deploying to prod");

      const bad = await runCLI("deploy", "staging");
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain("expected one of: dev, prod");

      const help = await runCLI("deploy", "-h");
      expect(help.code).toBe(0);
      expect(help.stdout).toContain("dev|prod");
    });
  });

  describe("Imported Namespaces", () => {
    test("should resolve types from imported namespace class", async () => {
      // Write the namespace class in a separate file
      writeFileSync(
        join(TEST_DIR, "db-tasks.ts"),
        `import { Context } from "${CONTEXT_PATH}";

export class DbTasks {
  /** Run database migrations */
  async migrate(c: Context, direction: string = "up") {
    console.log(\`Migrating: \${direction}\`);
  }

  /** Seed the database with count records */
  async seed(c: Context, count: number) {
    console.log(\`Seeding \${count} records\`);
  }
}
`,
      );

      writeTasks(`
import { DbTasks } from "./db-tasks";

export class Tasks {
  db = new DbTasks();

  /** Hello */
  async hello(c: Context) {
    console.log("hello");
  }
}
`);

      // Should list the namespace with typed params
      const listResult = await runCLI("--list");
      expect(listResult.code).toBe(0);
      expect(listResult.stdout).toContain("db:migrate");
      expect(listResult.stdout).toContain("db:seed");

      // Should show help with correct types
      const helpResult = await runCLI("db:seed", "-h");
      expect(helpResult.code).toBe(0);
      expect(helpResult.stdout).toContain("count");
      expect(helpResult.stdout).toContain("number");

      // Should execute with type coercion (number, not string)
      const execResult = await runCLI("db:seed", "42");
      expect(execResult.code).toBe(0);
      expect(execResult.stdout).toContain("Seeding 42 records");

      // Should reject invalid type
      const badResult = await runCLI("db:seed", "notanumber");
      expect(badResult.code).toBe(1);
    });

    test("should show param signatures for imported namespaces in list", async () => {
      writeFileSync(
        join(TEST_DIR, "api-tasks.ts"),
        `import { Context } from "${CONTEXT_PATH}";

export class ApiTasks {
  /**
   * Deploy to environment
   * @flag env -e --environment
   */
  async deploy(c: Context, env: string, force: boolean = false) {
    console.log(\`Deploying to \${env} (force=\${force})\`);
  }
}
`,
      );

      writeTasks(`
import { ApiTasks } from "./api-tasks";

export class Tasks {
  api = new ApiTasks();

  /** Hello */
  async hello(c: Context) {
    console.log("hello");
  }
}
`);

      const listResult = await runCLI("--list");
      expect(listResult.code).toBe(0);
      expect(listResult.stdout).toContain("api:deploy");
      expect(listResult.stdout).toContain("<env>");

      // Should work with flags from imported source
      const execResult = await runCLI("api:deploy", "-e", "prod");
      expect(execResult.code).toBe(0);
      expect(execResult.stdout).toContain("Deploying to prod");
    });
  });

  describe("Class Inheritance", () => {
    test("should execute inherited methods", async () => {
      writeTasks(`
class BaseTasks {
  /** Base method */
  async baseMethod(c: Context) {
    console.log("Base method executed");
  }
}

export class Tasks extends BaseTasks {
  /** Child method */
  async childMethod(c: Context) {
    console.log("Child method executed");
  }
}
`);

      const baseResult = await runCLI("baseMethod");
      expect(baseResult.code).toBe(0);
      expect(baseResult.stdout).toContain("Base method executed");

      const childResult = await runCLI("childMethod");
      expect(childResult.code).toBe(0);
      expect(childResult.stdout).toContain("Child method executed");
    });

    test("should list child methods", async () => {
      writeTasks(`
class BaseTasks {
  /** Base method */
  async baseMethod(c: Context) {}
}

export class Tasks extends BaseTasks {
  /** Child method */
  async childMethod(c: Context) {}
}
`);

      const result = await runCLI("--list");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("childMethod");
    });
  });
});

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
      expect(result.stderr).toContain("tasks.ts");
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

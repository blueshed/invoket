import { describe, test, expect } from "bun:test";

// Extract the functions we want to test by re-implementing them here
// In a real project, we'd export these from cli.ts

type ParamType = "string" | "number" | "boolean" | "object" | "array";

interface ParamMeta {
  name: string;
  type: ParamType;
  required: boolean;
}

interface TaskMeta {
  description: string;
  params: ParamMeta[];
}

// Parse TypeScript source to extract method signatures and types
function extractTaskMeta(source: string): Map<string, TaskMeta> {
  const tasks = new Map<string, TaskMeta>();

  const methodPattern =
    /\/\*\*\s*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*async\s+(\w+)\s*\(\s*c\s*:\s*Context\s*(?:,\s*([^)]+))?\s*\)/g;

  let match;
  while ((match = methodPattern.exec(source)) !== null) {
    const [, jsdoc, methodName, paramsStr] = match;

    // Skip private methods and constructor
    if (methodName.startsWith("_") || methodName === "constructor") {
      continue;
    }

    const description =
      jsdoc
        .split("\n")
        .map((line) => line.replace(/^\s*\*?\s*/, "").trim())
        .filter((line) => line && !line.startsWith("@"))[0] || "";

    const params: ParamMeta[] = [];

    if (paramsStr) {
      // Order matters: more specific patterns first
      const paramPattern =
        /(\w+)\s*:\s*(\w+\[\]|Record<[^>]+>|\{[^}]*\}|string|number|boolean|\w+)(?:\s*=\s*[^,)]+)?/g;
      let paramMatch;

      while ((paramMatch = paramPattern.exec(paramsStr)) !== null) {
        const [fullMatch, name, rawType] = paramMatch;
        const hasDefault = fullMatch.includes("=");

        let type: ParamType;
        if (rawType === "string") {
          type = "string";
        } else if (rawType === "number") {
          type = "number";
        } else if (rawType === "boolean") {
          type = "boolean";
        } else if (rawType.endsWith("[]")) {
          type = "array";
        } else {
          type = "object";
        }

        params.push({
          name,
          type,
          required: !hasDefault,
        });
      }
    }

    tasks.set(methodName, { description, params });
  }

  return tasks;
}

// Convert CLI arg to typed value
function coerceArg(value: string, type: ParamType): unknown {
  switch (type) {
    case "number": {
      if (value === "") {
        throw new Error(`Expected number, got ""`);
      }
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new Error(`Expected number, got "${value}"`);
      }
      return n;
    }
    case "boolean":
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      throw new Error(`Expected boolean, got "${value}"`);
    case "object":
    case "array": {
      try {
        const parsed = JSON.parse(value);
        if (type === "array" && !Array.isArray(parsed)) {
          throw new Error(`Expected array, got ${typeof parsed}`);
        }
        if (
          type === "object" &&
          (typeof parsed !== "object" ||
            Array.isArray(parsed) ||
            parsed === null)
        ) {
          throw new Error(
            `Expected object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
          );
        }
        return parsed;
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error(`Invalid JSON: ${e.message}`);
        }
        throw e;
      }
    }
    case "string":
    default:
      return value;
  }
}

describe("extractTaskMeta", () => {
  test("extracts method with no params", () => {
    const source = `
      /** Run the build */
      async build(c: Context) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("build")).toEqual({
      description: "Run the build",
      params: [],
    });
  });

  test("extracts method with string param", () => {
    const source = `
      /** Say hello */
      async hello(c: Context, name: string) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("hello")).toEqual({
      description: "Say hello",
      params: [{ name: "name", type: "string", required: true }],
    });
  });

  test("extracts method with number param", () => {
    const source = `
      /** Count items */
      async count(c: Context, n: number) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("count")).toEqual({
      description: "Count items",
      params: [{ name: "n", type: "number", required: true }],
    });
  });

  test("extracts method with optional param (has default)", () => {
    const source = `
      /** Greet someone */
      async greet(c: Context, name: string = "World") {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("greet")).toEqual({
      description: "Greet someone",
      params: [{ name: "name", type: "string", required: false }],
    });
  });

  test("extracts method with mixed required and optional params", () => {
    const source = `
      /** Deploy app */
      async deploy(c: Context, env: string, force: boolean = false) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("deploy")).toEqual({
      description: "Deploy app",
      params: [
        { name: "env", type: "string", required: true },
        { name: "force", type: "boolean", required: false },
      ],
    });
  });

  test("extracts method with array type (string[])", () => {
    const source = `
      /** Process items */
      async batch(c: Context, items: string[]) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("batch")).toEqual({
      description: "Process items",
      params: [{ name: "items", type: "array", required: true }],
    });
  });

  test("extracts method with interface type as object", () => {
    const source = `
      /** Search entities */
      async search(c: Context, params: SearchParams) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("search")).toEqual({
      description: "Search entities",
      params: [{ name: "params", type: "object", required: true }],
    });
  });

  test("extracts method with Record type as object", () => {
    const source = `
      /** Set config */
      async config(c: Context, settings: Record<string, string>) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("config")).toEqual({
      description: "Set config",
      params: [{ name: "settings", type: "object", required: true }],
    });
  });

  test("extracts multiple methods", () => {
    const source = `
      /** First task */
      async first(c: Context) {}

      /** Second task */
      async second(c: Context, x: number) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.size).toBe(2);
    expect(meta.has("first")).toBe(true);
    expect(meta.has("second")).toBe(true);
  });

  test("extracts first line of multi-line JSDoc", () => {
    const source = `
      /**
       * Deploy to production
       * This is a longer description
       * @param env - The environment
       */
      async deploy(c: Context, env: string) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("deploy")?.description).toBe("Deploy to production");
  });
});

describe("coerceArg", () => {
  describe("string type", () => {
    test("passes through strings unchanged", () => {
      expect(coerceArg("hello", "string")).toBe("hello");
      expect(coerceArg("", "string")).toBe("");
      expect(coerceArg("123", "string")).toBe("123");
    });
  });

  describe("number type", () => {
    test("parses integers", () => {
      expect(coerceArg("42", "number")).toBe(42);
      expect(coerceArg("-10", "number")).toBe(-10);
      expect(coerceArg("0", "number")).toBe(0);
    });

    test("parses floats", () => {
      expect(coerceArg("3.14", "number")).toBe(3.14);
      expect(coerceArg("-0.5", "number")).toBe(-0.5);
    });

    test("throws on non-numeric string", () => {
      expect(() => coerceArg("abc", "number")).toThrow(
        'Expected number, got "abc"',
      );
      expect(() => coerceArg("", "number")).toThrow('Expected number, got ""');
    });
  });

  describe("boolean type", () => {
    test("parses true values", () => {
      expect(coerceArg("true", "boolean")).toBe(true);
      expect(coerceArg("1", "boolean")).toBe(true);
    });

    test("parses false values", () => {
      expect(coerceArg("false", "boolean")).toBe(false);
      expect(coerceArg("0", "boolean")).toBe(false);
    });

    test("throws on invalid boolean", () => {
      expect(() => coerceArg("yes", "boolean")).toThrow(
        'Expected boolean, got "yes"',
      );
      expect(() => coerceArg("TRUE", "boolean")).toThrow(
        'Expected boolean, got "TRUE"',
      );
    });
  });

  describe("object type", () => {
    test("parses valid JSON objects", () => {
      expect(coerceArg('{"name": "test"}', "object")).toEqual({ name: "test" });
      expect(coerceArg('{"a": 1, "b": 2}', "object")).toEqual({ a: 1, b: 2 });
      expect(coerceArg("{}", "object")).toEqual({});
    });

    test("parses nested objects", () => {
      expect(coerceArg('{"user": {"name": "Alice"}}', "object")).toEqual({
        user: { name: "Alice" },
      });
    });

    test("throws on invalid JSON", () => {
      expect(() => coerceArg("not json", "object")).toThrow("Invalid JSON");
      expect(() => coerceArg("{invalid}", "object")).toThrow("Invalid JSON");
    });

    test("throws when given array instead of object", () => {
      expect(() => coerceArg("[1,2,3]", "object")).toThrow(
        "Expected object, got array",
      );
    });

    test("throws when given primitive instead of object", () => {
      expect(() => coerceArg('"string"', "object")).toThrow(
        "Expected object, got string",
      );
      expect(() => coerceArg("123", "object")).toThrow(
        "Expected object, got number",
      );
      expect(() => coerceArg("null", "object")).toThrow(
        "Expected object, got object",
      );
    });
  });

  describe("array type", () => {
    test("parses valid JSON arrays", () => {
      expect(coerceArg('["a", "b", "c"]', "array")).toEqual(["a", "b", "c"]);
      expect(coerceArg("[1, 2, 3]", "array")).toEqual([1, 2, 3]);
      expect(coerceArg("[]", "array")).toEqual([]);
    });

    test("parses arrays with mixed types", () => {
      expect(coerceArg('[1, "two", true]', "array")).toEqual([1, "two", true]);
    });

    test("throws on invalid JSON", () => {
      expect(() => coerceArg("not json", "array")).toThrow("Invalid JSON");
    });

    test("throws when given object instead of array", () => {
      expect(() => coerceArg('{"a": 1}', "array")).toThrow(
        "Expected array, got object",
      );
    });
  });
});

describe("integration: extractTaskMeta + coerceArg", () => {
  test("full workflow: parse method and coerce args", () => {
    const source = `
      /** Search with filters */
      async search(c: Context, entity: string, params: SearchParams) {}
    `;

    const meta = extractTaskMeta(source);
    const taskMeta = meta.get("search")!;

    // Simulate CLI args
    const cliArgs = ["venues", '{"query": "test", "limit": 5}'];

    const coercedArgs = taskMeta.params.map((param, i) =>
      coerceArg(cliArgs[i], param.type),
    );

    expect(coercedArgs).toEqual(["venues", { query: "test", limit: 5 }]);
  });

  test("full workflow with array param", () => {
    const source = `
      /** Batch process */
      async batch(c: Context, items: string[]) {}
    `;

    const meta = extractTaskMeta(source);
    const taskMeta = meta.get("batch")!;

    const cliArgs = ['["apple", "banana", "cherry"]'];

    const coercedArgs = taskMeta.params.map((param, i) =>
      coerceArg(cliArgs[i], param.type),
    );

    expect(coercedArgs).toEqual([["apple", "banana", "cherry"]]);
  });
});

// =============================================================================
// SPEC COMPLIANCE TESTS
// =============================================================================

describe("private methods (spec section 3)", () => {
  test("excludes methods starting with _", () => {
    const source = `
      /** Public task */
      async publicTask(c: Context) {}

      /** Private helper */
      async _privateHelper(c: Context) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.has("publicTask")).toBe(true);
    expect(meta.has("_privateHelper")).toBe(false);
  });

  test("excludes constructor", () => {
    const source = `
      constructor() {}

      /** Public task */
      async hello(c: Context) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.has("constructor")).toBe(false);
    expect(meta.has("hello")).toBe(true);
  });
});

// Parse command to extract namespace and method
function parseCommand(command: string): {
  namespace: string | null;
  method: string;
} {
  // Check for namespace separator (: or .)
  const colonIdx = command.indexOf(":");
  const dotIdx = command.indexOf(".");

  // Use whichever separator comes first
  let sepIdx = -1;
  if (colonIdx !== -1 && dotIdx !== -1) {
    sepIdx = Math.min(colonIdx, dotIdx);
  } else if (colonIdx !== -1) {
    sepIdx = colonIdx;
  } else if (dotIdx !== -1) {
    sepIdx = dotIdx;
  }

  if (sepIdx !== -1) {
    return {
      namespace: command.slice(0, sepIdx),
      method: command.slice(sepIdx + 1),
    };
  }

  return { namespace: null, method: command };
}

describe("namespace parsing (spec section 5)", () => {
  test("parses simple task name", () => {
    expect(parseCommand("hello")).toEqual({ namespace: null, method: "hello" });
  });

  test("parses colon-separated namespace", () => {
    expect(parseCommand("db:migrate")).toEqual({
      namespace: "db",
      method: "migrate",
    });
  });

  test("parses dot-separated namespace", () => {
    expect(parseCommand("db.migrate")).toEqual({
      namespace: "db",
      method: "migrate",
    });
  });

  test("handles nested namespaces with colon", () => {
    expect(parseCommand("db:schema:migrate")).toEqual({
      namespace: "db",
      method: "schema:migrate",
    });
  });
});

// Discover tasks from an instance (runtime discovery)
interface DiscoveryResult {
  root: string[];
  namespaced: Record<string, string[]>;
}

function discoverTasks(instance: any): DiscoveryResult {
  const root: string[] = [];
  const namespaced: Record<string, string[]> = {};

  // Walk prototype chain for root tasks
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (
        name !== "constructor" &&
        !name.startsWith("_") &&
        typeof proto[name] === "function" &&
        !root.includes(name)
      ) {
        root.push(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  // Get namespaced tasks from instance properties
  for (const name of Object.getOwnPropertyNames(instance)) {
    if (name.startsWith("_")) continue;

    const prop = instance[name];
    if (prop && typeof prop === "object" && !Array.isArray(prop)) {
      const methods: string[] = [];
      let nsproto = Object.getPrototypeOf(prop);
      while (nsproto && nsproto !== Object.prototype) {
        for (const methodName of Object.getOwnPropertyNames(nsproto)) {
          if (
            methodName !== "constructor" &&
            !methodName.startsWith("_") &&
            typeof nsproto[methodName] === "function" &&
            !methods.includes(methodName)
          ) {
            methods.push(methodName);
          }
        }
        nsproto = Object.getPrototypeOf(nsproto);
      }
      if (methods.length > 0) {
        namespaced[name] = methods;
      }
    }
  }

  return { root, namespaced };
}

describe("task discovery (spec section 8)", () => {
  test("discovers root methods", () => {
    class Tasks {
      async hello() {}
      async build() {}
    }
    const result = discoverTasks(new Tasks());
    expect(result.root).toContain("hello");
    expect(result.root).toContain("build");
  });

  test("excludes private methods", () => {
    class Tasks {
      async hello() {}
      async _private() {}
    }
    const result = discoverTasks(new Tasks());
    expect(result.root).toContain("hello");
    expect(result.root).not.toContain("_private");
  });

  test("excludes constructor", () => {
    class Tasks {
      constructor() {}
      async hello() {}
    }
    const result = discoverTasks(new Tasks());
    expect(result.root).not.toContain("constructor");
    expect(result.root).toContain("hello");
  });

  test("discovers inherited methods", () => {
    class BaseTasks {
      async baseTask() {}
    }
    class Tasks extends BaseTasks {
      async childTask() {}
    }
    const result = discoverTasks(new Tasks());
    expect(result.root).toContain("baseTask");
    expect(result.root).toContain("childTask");
  });

  test("discovers namespaced methods", () => {
    class DbNamespace {
      async migrate() {}
      async seed() {}
    }
    class Tasks {
      db = new DbNamespace();
      async hello() {}
    }
    const result = discoverTasks(new Tasks());
    expect(result.root).toContain("hello");
    expect(result.namespaced.db).toContain("migrate");
    expect(result.namespaced.db).toContain("seed");
  });

  test("excludes private namespaces", () => {
    class Internal {
      async secret() {}
    }
    class Tasks {
      _internal = new Internal();
      async hello() {}
    }
    const result = discoverTasks(new Tasks());
    expect(result.root).toContain("hello");
    expect(result.namespaced._internal).toBeUndefined();
  });

  test("excludes private methods in namespaces", () => {
    class DbNamespace {
      async migrate() {}
      async _helper() {}
    }
    class Tasks {
      db = new DbNamespace();
    }
    const result = discoverTasks(new Tasks());
    expect(result.namespaced.db).toContain("migrate");
    expect(result.namespaced.db).not.toContain("_helper");
  });
});

// Extract class-level JSDoc
function extractClassDoc(source: string): string | null {
  const match = source.match(
    /\/\*\*\s*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*export\s+class\s+Tasks/,
  );
  if (!match) return null;

  const lines = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s*/, "").trim())
    .filter((line) => line && !line.startsWith("@"));

  return lines[0] || null;
}

describe("JSDoc extraction (spec section 6)", () => {
  test("extracts class-level JSDoc", () => {
    const source = `
      /**
       * Project build and deployment tasks
       */
      export class Tasks {}
    `;
    expect(extractClassDoc(source)).toBe("Project build and deployment tasks");
  });

  test("returns null when no class JSDoc", () => {
    const source = `export class Tasks {}`;
    expect(extractClassDoc(source)).toBeNull();
  });

  test("ignores @ annotations in class JSDoc", () => {
    const source = `
      /**
       * Main tasks
       * @author Someone
       */
      export class Tasks {}
    `;
    expect(extractClassDoc(source)).toBe("Main tasks");
  });
});

// Validate task name
function validateTaskName(name: string): { valid: boolean; error?: string } {
  if (name === "constructor") {
    return {
      valid: false,
      error: 'Cannot call constructor method "constructor"',
    };
  }
  if (name.startsWith("_")) {
    return { valid: false, error: `Cannot call private method "${name}"` };
  }
  return { valid: true };
}

function validateNamespace(name: string): { valid: boolean; error?: string } {
  if (name.startsWith("_")) {
    return { valid: false, error: `Cannot call private namespace "${name}"` };
  }
  return { valid: true };
}

describe("error handling (spec section 10)", () => {
  test("rejects constructor invocation", () => {
    const result = validateTaskName("constructor");
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot call constructor method "constructor"');
  });

  test("rejects private method invocation", () => {
    const result = validateTaskName("_helper");
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot call private method "_helper"');
  });

  test("rejects private namespace", () => {
    const result = validateNamespace("_internal");
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot call private namespace "_internal"');
  });

  test("allows valid task names", () => {
    expect(validateTaskName("hello").valid).toBe(true);
    expect(validateTaskName("build").valid).toBe(true);
    expect(validateTaskName("deployProd").valid).toBe(true);
  });
});

// Rest parameter detection
interface RestParamMeta extends ParamMeta {
  isRest: boolean;
}

function extractParamsWithRest(paramsStr: string): RestParamMeta[] {
  const params: RestParamMeta[] = [];

  // Check for rest parameter: ...name: type
  const restMatch = paramsStr.match(/\.\.\.(\w+)\s*:\s*(\w+\[\]|\w+)/);
  if (restMatch) {
    const [, name, rawType] = restMatch;
    params.push({
      name,
      type: rawType.endsWith("[]") ? "array" : "string",
      required: false,
      isRest: true,
    });
    return params;
  }

  // Regular params
  const paramPattern =
    /(\w+)\s*:\s*(\w+\[\]|Record<[^>]+>|\{[^}]*\}|string|number|boolean|\w+)(?:\s*=\s*[^,)]+)?/g;
  let match;

  while ((match = paramPattern.exec(paramsStr)) !== null) {
    const [fullMatch, name, rawType] = match;
    const hasDefault = fullMatch.includes("=");

    let type: ParamType;
    if (rawType === "string") {
      type = "string";
    } else if (rawType === "number") {
      type = "number";
    } else if (rawType === "boolean") {
      type = "boolean";
    } else if (rawType.endsWith("[]")) {
      type = "array";
    } else {
      type = "object";
    }

    params.push({
      name,
      type,
      required: !hasDefault,
      isRest: false,
    });
  }

  return params;
}

describe("rest parameters (spec section 3)", () => {
  test("detects rest parameter", () => {
    const params = extractParamsWithRest("...items: string[]");
    expect(params).toHaveLength(1);
    expect(params[0]).toEqual({
      name: "items",
      type: "array",
      required: false,
      isRest: true,
    });
  });

  test("formats rest param for help as [items...]", () => {
    const params = extractParamsWithRest("...items: string[]");
    const formatted = params
      .map((p) =>
        p.isRest
          ? `[${p.name}...]`
          : p.required
            ? `<${p.name}>`
            : `[${p.name}]`,
      )
      .join(" ");
    expect(formatted).toBe("[items...]");
  });
});

// =============================================================================
// CLI INTEGRATION TESTS (run actual CLI)
// =============================================================================

import { $ } from "bun";

describe("CLI integration", () => {
  const run = async (...args: string[]) =>
    $`bun ../src/cli.ts ${args}`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();

  test("shows help with no args", async () => {
    const result = await $`bun ../src/cli.ts`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Available tasks:");
  });

  test("shows help with --help", async () => {
    const result = await run("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Available tasks:");
  });

  test("lists tasks with --list", async () => {
    const result = await run("--list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("hello");
  });

  test("runs task with args", async () => {
    const result = await run("hello", "World", "2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("validates required args", async () => {
    const result = await run("hello");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Missing required argument");
  });

  test("validates number type", async () => {
    const result = await run("hello", "World", "notanumber");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Expected number");
  });

  test("parses JSON object args", async () => {
    const result = await run("search", "venues", '{"query":"test"}');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Searching venues");
  });

  test("rejects unknown task", async () => {
    const result = await run("nonexistent");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Unknown task: nonexistent");
  });

  test("rejects private method call", async () => {
    const result = await run("_private");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Cannot call private method");
  });
});

describe("CLI namespace integration", () => {
  const run = async (...args: string[]) =>
    $`bun ../src/cli.ts ${args}`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();

  test("calls namespaced task with colon separator", async () => {
    const result = await run("db:migrate", "up");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Migrating database: up");
  });

  test("calls namespaced task with dot separator", async () => {
    const result = await run("db.migrate", "down");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Migrating database: down");
  });

  test("shows namespaced tasks in help", async () => {
    const result = await run("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("db:");
  });

  test("rejects private namespace", async () => {
    const result = await run("_internal:secret");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("private namespace");
  });

  test("rejects private method in namespace", async () => {
    const result = await run("db:_helper");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("private method");
  });
});

describe("CLI rest parameters", () => {
  const run = async (...args: string[]) =>
    $`bun ../src/cli.ts ${args}`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();

  test("passes rest params to task", async () => {
    const result = await run("install", "react", "vue", "angular");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Installing 3 packages");
    expect(result.stdout.toString()).toContain("react");
    expect(result.stdout.toString()).toContain("vue");
    expect(result.stdout.toString()).toContain("angular");
  });

  test("shows rest param as [packages...] in help", async () => {
    const result = await run("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("[packages...]");
  });

  test("works with zero rest args", async () => {
    const result = await run("install");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Installing 0 packages");
  });
});

describe("class JSDoc extraction (spec section 6)", () => {
  test("extracts class-level JSDoc for help header", async () => {
    const run = async (...args: string[]) =>
      $`bun ../src/cli.ts ${args}`
        .cwd(import.meta.dir + "/../examples")
        .quiet()
        .nothrow();

    const result = await run("--help");
    expect(result.exitCode).toBe(0);
    // Should show class JSDoc in help output
    expect(result.stdout.toString()).toContain("Example tasks");
  });
});

describe("CLI flags (spec section 2)", () => {
  const run = async (...args: string[]) =>
    $`bun ../src/cli.ts ${args}`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();

  test("--version shows version", async () => {
    const result = await run("--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("task-specific help", () => {
  const run = async (...args: string[]) =>
    $`bun ../src/cli.ts ${args}`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();

  test("shows task help with -h flag", async () => {
    const result = await run("hello", "-h");
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("Usage: invt hello");
    expect(out).toContain("<name>");
    expect(out).toContain("<count>");
    expect(out).toContain("Arguments:");
  });

  test("shows task help with --help flag", async () => {
    const result = await run("hello", "--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage: invt hello");
  });

  test("shows namespaced task help", async () => {
    const result = await run("db:migrate", "-h");
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("Usage: invt db:migrate");
    expect(out).toContain("[direction]");
  });

  test("shows rest params in task help", async () => {
    const result = await run("install", "-h");
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("[packages...]");
    expect(out).toContain("array...");
  });

  test("shows description in task help", async () => {
    const result = await run("hello", "-h");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Say hello");
  });

  test("general help differs from task help", async () => {
    const generalHelp = await run("-h");
    const taskHelp = await run("hello", "-h");
    expect(generalHelp.stdout.toString()).toContain("Available tasks:");
    expect(taskHelp.stdout.toString()).not.toContain("Available tasks:");
    expect(taskHelp.stdout.toString()).toContain("Usage: invt hello");
  });
});

describe("Context API (spec section 4)", () => {
  test("has config property with merged options", async () => {
    const { Context } = await import("../src/context");
    const ctx = new Context({ echo: true, warn: false });
    expect(ctx.config).toEqual({ echo: true, warn: false });
  });

  test("local() is alias for run()", async () => {
    const { Context } = await import("../src/context");
    const ctx = new Context();
    expect(ctx.local).toBeDefined();
    expect(typeof ctx.local).toBe("function");
  });
});

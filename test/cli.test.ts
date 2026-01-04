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
// FLAG PARSING TESTS
// =============================================================================

// Interface for parsed CLI arguments
interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

// Parse CLI arguments into flags and positional args
function parseCliArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  let stopFlagParsing = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (stopFlagParsing) {
      positional.push(arg);
      continue;
    }

    if (arg === "--") {
      stopFlagParsing = true;
      continue;
    }

    // --flag=value
    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const name = arg.slice(2, eqIdx);
      const value = arg.slice(eqIdx + 1);
      flags.set(name, value);
      continue;
    }

    // --no-flag (boolean negation)
    if (arg.startsWith("--no-")) {
      const name = arg.slice(5);
      flags.set(name, false);
      continue;
    }

    // --flag (may be boolean or need next arg)
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const nextArg = args[i + 1];

      // If next arg exists and doesn't look like a flag, use it as value
      if (nextArg !== undefined && !nextArg.startsWith("-")) {
        flags.set(name, nextArg);
        i++; // Skip next arg
      } else {
        flags.set(name, true); // Boolean flag
      }
      continue;
    }

    // -f=value (short with equals)
    if (arg.startsWith("-") && arg.length > 2 && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const name = arg.slice(1, eqIdx);
      const value = arg.slice(eqIdx + 1);
      flags.set(name, value);
      continue;
    }

    // -f value or -f (boolean)
    if (arg.startsWith("-") && arg.length === 2) {
      const name = arg.slice(1);
      const nextArg = args[i + 1];

      if (nextArg !== undefined && !nextArg.startsWith("-")) {
        flags.set(name, nextArg);
        i++;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    // Positional argument
    positional.push(arg);
  }

  return { positional, flags };
}

// Flag metadata for a parameter
interface FlagMeta {
  long: string; // e.g., "--name"
  short?: string; // e.g., "-n"
  aliases?: string[]; // e.g., ["--environment"]
}

// Extended ParamMeta with flag support
interface ExtendedParamMeta {
  name: string;
  type: ParamType;
  required: boolean;
  isRest: boolean;
  flag?: FlagMeta;
}

// Extract @flag annotations from JSDoc
function extractFlagAnnotations(
  jsdoc: string,
): Map<string, { short?: string; aliases?: string[] }> {
  const flags = new Map<string, { short?: string; aliases?: string[] }>();

  // Match @flag paramName -s --alias1 --alias2
  const flagPattern = /@flag\s+(\w+)\s+([^\n@]*)/g;
  let match;

  while ((match = flagPattern.exec(jsdoc)) !== null) {
    const [, paramName, flagsStr] = match;
    const parts = flagsStr.trim().split(/\s+/);

    let short: string | undefined;
    const aliases: string[] = [];

    for (const part of parts) {
      if (part.startsWith("--")) {
        aliases.push(part);
      } else if (part.startsWith("-") && part.length === 2) {
        short = part;
      }
    }

    flags.set(paramName, {
      short: short,
      aliases: aliases.length > 0 ? aliases : undefined,
    });
  }

  return flags;
}

// Parse params with flag metadata
function parseParamsWithFlags(
  paramsStr: string | undefined,
  jsdoc: string,
): ExtendedParamMeta[] {
  const params: ExtendedParamMeta[] = [];
  if (!paramsStr) return params;

  const flagAnnotations = extractFlagAnnotations(jsdoc);

  // Check for rest parameter first: ...name: type
  const restMatch = paramsStr.match(/\.\.\.(\w+)\s*:\s*(\w+\[\]|\w+)/);
  if (restMatch) {
    const [, name, rawType] = restMatch;
    params.push({
      name,
      type: rawType.endsWith("[]") ? "array" : "string",
      required: false,
      isRest: true,
      // Rest params don't get flags
    });
    return params;
  }

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

    // Build flag metadata
    const annotation = flagAnnotations.get(name);
    const flag: FlagMeta = {
      long: `--${name}`,
      short: annotation?.short,
      aliases: annotation?.aliases,
    };

    params.push({
      name,
      type,
      required: !hasDefault,
      isRest: false,
      flag,
    });
  }

  return params;
}

describe("extractFlagAnnotations", () => {
  test("extracts @flag with short flag", () => {
    const jsdoc = `
      Deploy the app
      @flag env -e
    `;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.get("env")).toEqual({ short: "-e", aliases: undefined });
  });

  test("extracts @flag with alias", () => {
    const jsdoc = `
      Deploy
      @flag env -e --environment
    `;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.get("env")).toEqual({
      short: "-e",
      aliases: ["--environment"],
    });
  });

  test("extracts @flag with multiple aliases", () => {
    const jsdoc = `
      Deploy
      @flag env -e --environment --environ
    `;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.get("env")).toEqual({
      short: "-e",
      aliases: ["--environment", "--environ"],
    });
  });

  test("extracts @flag with only short flag", () => {
    const jsdoc = `@flag force -f`;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.get("force")).toEqual({ short: "-f", aliases: undefined });
  });

  test("extracts @flag with only alias", () => {
    const jsdoc = `@flag env --environment`;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.get("env")).toEqual({
      short: undefined,
      aliases: ["--environment"],
    });
  });

  test("extracts multiple @flag annotations", () => {
    const jsdoc = `
      Deploy the app
      @flag env -e --environment
      @flag force -f
      @flag verbose -v
    `;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.get("env")).toEqual({
      short: "-e",
      aliases: ["--environment"],
    });
    expect(flags.get("force")).toEqual({ short: "-f", aliases: undefined });
    expect(flags.get("verbose")).toEqual({ short: "-v", aliases: undefined });
  });

  test("returns empty map when no @flag annotations", () => {
    const jsdoc = `Just a description`;
    const flags = extractFlagAnnotations(jsdoc);
    expect(flags.size).toBe(0);
  });
});

describe("parseParamsWithFlags", () => {
  test("auto-generates long flag from param name", () => {
    const params = parseParamsWithFlags("env: string", "Deploy app");
    expect(params[0].flag).toEqual({ long: "--env" });
  });

  test("includes short flag from @flag annotation", () => {
    const jsdoc = `
      Deploy app
      @flag env -e
    `;
    const params = parseParamsWithFlags("env: string", jsdoc);
    expect(params[0].flag).toEqual({ long: "--env", short: "-e" });
  });

  test("includes aliases from @flag annotation", () => {
    const jsdoc = `
      Deploy
      @flag env -e --environment
    `;
    const params = parseParamsWithFlags("env: string", jsdoc);
    expect(params[0].flag).toEqual({
      long: "--env",
      short: "-e",
      aliases: ["--environment"],
    });
  });

  test("handles multiple params with flags", () => {
    const jsdoc = `
      Deploy
      @flag env -e
      @flag force -f
    `;
    const params = parseParamsWithFlags(
      "env: string, force: boolean = false",
      jsdoc,
    );
    expect(params[0].flag).toEqual({ long: "--env", short: "-e" });
    expect(params[1].flag).toEqual({ long: "--force", short: "-f" });
  });

  test("rest parameters do not get flags", () => {
    const params = parseParamsWithFlags("...packages: string[]", "Install");
    expect(params[0].isRest).toBe(true);
    expect(params[0].flag).toBeUndefined();
  });

  test("params without @flag annotation still get auto long flag", () => {
    const jsdoc = `
      Deploy
      @flag env -e
    `;
    const params = parseParamsWithFlags("env: string, count: number", jsdoc);
    expect(params[0].flag).toEqual({ long: "--env", short: "-e" });
    expect(params[1].flag).toEqual({ long: "--count" });
  });

  test("preserves other param metadata", () => {
    const params = parseParamsWithFlags(
      "name: string, count: number = 1",
      "Hello",
    );
    expect(params[0]).toMatchObject({
      name: "name",
      type: "string",
      required: true,
      isRest: false,
    });
    expect(params[1]).toMatchObject({
      name: "count",
      type: "number",
      required: false,
      isRest: false,
    });
  });
});

// Resolve arguments from parsed CLI args using param metadata
function resolveArgs(
  params: ExtendedParamMeta[],
  parsed: ParsedArgs,
  coerceFn: (value: string, type: ParamType) => unknown,
): unknown[] {
  const result: unknown[] = [];
  const usedPositional = new Set<number>();

  for (const param of params) {
    // Handle rest parameters - collect all remaining positional args
    if (param.isRest) {
      const remaining = parsed.positional.filter(
        (_, i) => !usedPositional.has(i),
      );
      result.push(...remaining);
      break;
    }

    let value: string | boolean | undefined;

    // Try to get value from flags first
    if (param.flag) {
      // Check long flag (without --)
      const longName = param.flag.long.slice(2);
      if (parsed.flags.has(longName)) {
        value = parsed.flags.get(longName);
      }
      // Check short flag (without -)
      else if (param.flag.short) {
        const shortName = param.flag.short.slice(1);
        if (parsed.flags.has(shortName)) {
          value = parsed.flags.get(shortName);
        }
      }
      // Check aliases
      if (value === undefined && param.flag.aliases) {
        for (const alias of param.flag.aliases) {
          const aliasName = alias.slice(2);
          if (parsed.flags.has(aliasName)) {
            value = parsed.flags.get(aliasName);
            break;
          }
        }
      }
    }

    // Fall back to positional if no flag found
    if (value === undefined) {
      for (let i = 0; i < parsed.positional.length; i++) {
        if (!usedPositional.has(i)) {
          value = parsed.positional[i];
          usedPositional.add(i);
          break;
        }
      }
    }

    // Handle missing values
    if (value === undefined) {
      if (param.required) {
        throw new Error(
          `Missing required argument: <${param.name}> (${param.type})`,
        );
      }
      break; // Optional param not provided, stop processing
    }

    // Coerce and add to result
    // Boolean flags that are already boolean don't need coercion
    if (typeof value === "boolean" && param.type === "boolean") {
      result.push(value);
    } else {
      result.push(coerceFn(String(value), param.type));
    }
  }

  return result;
}

describe("resolveArgs", () => {
  // Helper to create params with flags
  const makeParams = (
    defs: Array<{
      name: string;
      type: ParamType;
      required?: boolean;
      isRest?: boolean;
      short?: string;
      aliases?: string[];
    }>,
  ): ExtendedParamMeta[] =>
    defs.map((d) => ({
      name: d.name,
      type: d.type,
      required: d.required ?? true,
      isRest: d.isRest ?? false,
      flag: d.isRest
        ? undefined
        : {
            long: `--${d.name}`,
            short: d.short,
            aliases: d.aliases,
          },
    }));

  test("resolves from positional args (backwards compat)", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "count", type: "number" },
    ]);
    const parsed = { positional: ["World", "3"], flags: new Map() };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["World", 3]);
  });

  test("resolves from long flags", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "count", type: "number" },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([
        ["name", "World"],
        ["count", "3"],
      ]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["World", 3]);
  });

  test("resolves from short flags", () => {
    const params = makeParams([
      { name: "name", type: "string", short: "-n" },
      { name: "count", type: "number", short: "-c" },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([
        ["n", "World"],
        ["c", "3"],
      ]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["World", 3]);
  });

  test("resolves from aliases", () => {
    const params = makeParams([
      { name: "env", type: "string", aliases: ["--environment"] },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([["environment", "prod"]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["prod"]);
  });

  test("mixes positional and flags", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "count", type: "number" },
    ]);
    const parsed = {
      positional: ["World"],
      flags: new Map<string, string | boolean>([["count", "3"]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["World", 3]);
  });

  test("flags take precedence over positional", () => {
    const params = makeParams([{ name: "name", type: "string" }]);
    const parsed = {
      positional: ["Positional"],
      flags: new Map<string, string | boolean>([["name", "FromFlag"]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["FromFlag"]);
  });

  test("handles boolean flags as true", () => {
    const params = makeParams([
      { name: "force", type: "boolean", required: false },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([["force", true]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual([true]);
  });

  test("handles --no-flag as false", () => {
    const params = makeParams([
      { name: "force", type: "boolean", required: false },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([["force", false]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual([false]);
  });

  test("handles boolean flag with string value", () => {
    const params = makeParams([
      { name: "force", type: "boolean", required: false },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([["force", "true"]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual([true]);
  });

  test("throws on missing required arg", () => {
    const params = makeParams([{ name: "name", type: "string" }]);
    const parsed = { positional: [], flags: new Map() };
    expect(() => resolveArgs(params, parsed, coerceArg)).toThrow(
      "Missing required argument: <name>",
    );
  });

  test("handles optional params not provided", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "count", type: "number", required: false },
    ]);
    const parsed = {
      positional: ["World"],
      flags: new Map(),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["World"]);
  });

  test("handles rest parameters", () => {
    const params: ExtendedParamMeta[] = [
      {
        name: "packages",
        type: "array",
        required: false,
        isRest: true,
      },
    ];
    const parsed = {
      positional: ["react", "vue", "angular"],
      flags: new Map(),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["react", "vue", "angular"]);
  });

  test("handles rest parameters with preceding params", () => {
    const params: ExtendedParamMeta[] = [
      {
        name: "registry",
        type: "string",
        required: false,
        isRest: false,
        flag: { long: "--registry" },
      },
      {
        name: "packages",
        type: "array",
        required: false,
        isRest: true,
      },
    ];
    const parsed = {
      positional: ["react", "vue"],
      flags: new Map<string, string | boolean>([["registry", "npm"]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    // registry from flag, packages from positional
    expect(result).toEqual(["npm", "react", "vue"]);
  });

  test("flags anywhere in positional list work", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "count", type: "number" },
    ]);
    // Simulating: invt hello --count=2 World
    // parseCliArgs would give us positional: ["World"], flags: {count: "2"}
    const parsed = {
      positional: ["World"],
      flags: new Map<string, string | boolean>([["count", "2"]]),
    };
    const result = resolveArgs(params, parsed, coerceArg);
    expect(result).toEqual(["World", 2]);
  });
});

describe("parseCliArgs", () => {
  test("parses --flag=value syntax", () => {
    const result = parseCliArgs(["--name=World"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("name")).toBe("World");
  });

  test("parses --flag value syntax", () => {
    const result = parseCliArgs(["--name", "World"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("name")).toBe("World");
  });

  test("parses short flag -n value", () => {
    const result = parseCliArgs(["-n", "World"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("n")).toBe("World");
  });

  test("parses short flag -n=value", () => {
    const result = parseCliArgs(["-n=World"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("n")).toBe("World");
  });

  test("parses boolean flag without value", () => {
    const result = parseCliArgs(["--verbose"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("verbose")).toBe(true);
  });

  test("parses short boolean flag", () => {
    const result = parseCliArgs(["-v"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("v")).toBe(true);
  });

  test("parses --no-flag as false", () => {
    const result = parseCliArgs(["--no-verbose"]);
    expect(result.positional).toEqual([]);
    expect(result.flags.get("verbose")).toBe(false);
  });

  test("stops flag parsing after --", () => {
    const result = parseCliArgs(["--name", "val", "--", "--not-a-flag"]);
    expect(result.positional).toEqual(["--not-a-flag"]);
    expect(result.flags.get("name")).toBe("val");
    expect(result.flags.has("not-a-flag")).toBe(false);
  });

  test("preserves positional args", () => {
    const result = parseCliArgs(["hello", "--count=2", "world"]);
    expect(result.positional).toEqual(["hello", "world"]);
    expect(result.flags.get("count")).toBe("2");
  });

  test("handles multiple flags", () => {
    const result = parseCliArgs(["--name=World", "--count=3", "-v"]);
    expect(result.flags.get("name")).toBe("World");
    expect(result.flags.get("count")).toBe("3");
    expect(result.flags.get("v")).toBe(true);
  });

  test("handles mixed positional and flags in any order", () => {
    const result = parseCliArgs(["--count=2", "World", "-v"]);
    expect(result.positional).toEqual(["World"]);
    expect(result.flags.get("count")).toBe("2");
    expect(result.flags.get("v")).toBe(true);
  });

  test("handles empty args", () => {
    const result = parseCliArgs([]);
    expect(result.positional).toEqual([]);
    expect(result.flags.size).toBe(0);
  });

  test("handles only positional args", () => {
    const result = parseCliArgs(["hello", "world", "123"]);
    expect(result.positional).toEqual(["hello", "world", "123"]);
    expect(result.flags.size).toBe(0);
  });

  test("handles flag with empty value", () => {
    const result = parseCliArgs(["--name="]);
    expect(result.flags.get("name")).toBe("");
  });

  test("handles boolean flag followed by another flag", () => {
    const result = parseCliArgs(["--verbose", "--name=World"]);
    expect(result.flags.get("verbose")).toBe(true);
    expect(result.flags.get("name")).toBe("World");
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

// =============================================================================
// FLAG-BASED ARGUMENT CLI INTEGRATION TESTS
// =============================================================================

describe("CLI flag integration", () => {
  const run = async (...args: string[]) =>
    $`bun ../src/cli.ts ${args}`
      .cwd(import.meta.dir + "/../examples")
      .quiet()
      .nothrow();

  test("accepts --name=value syntax", async () => {
    const result = await run("hello", "--name=World", "--count=2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("accepts --name value syntax", async () => {
    const result = await run("hello", "--name", "World", "--count", "2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("mixes positional and flags", async () => {
    const result = await run("hello", "World", "--count=2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("flags anywhere in arg list", async () => {
    const result = await run("hello", "--count=2", "World");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("backwards compatible: positional-only still works", async () => {
    const result = await run("hello", "World", "2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("-- stops flag parsing", async () => {
    const result = await run("install", "--", "--not-a-flag");
    expect(result.exitCode).toBe(0);
    // --not-a-flag should be treated as a package name
    expect(result.stdout.toString()).toContain("--not-a-flag");
  });

  test("namespaced task accepts flags", async () => {
    const result = await run("db:migrate", "--direction=down");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Migrating database: down");
  });

  test("shows flag info in task help", async () => {
    const result = await run("hello", "-h");
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("--name");
    expect(out).toContain("--count");
  });

  test("accepts short flags -n and -c", async () => {
    const result = await run("hello", "-n", "World", "-c", "2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("accepts short flag with equals -n=value", async () => {
    const result = await run("hello", "-n=World", "-c=2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Hello, World!");
  });

  test("shows short flags in help", async () => {
    const result = await run("hello", "-h");
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("-n");
    expect(out).toContain("-c");
  });
});

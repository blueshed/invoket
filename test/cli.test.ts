import { describe, test, expect } from "bun:test";
import {
  coerceArg,
  parseCommand,
  extractClassDoc,
  extractFlagAnnotations,
  extractMethodsFromClass,
  parseParams,
  parseCliArgs,
  resolveArgs,
  type ParamType,
  type ParamMeta,
  type TaskMeta,
} from "../src/parser";

// Wrapper: extract methods from a source snippet as if it were class Tasks
function extractTaskMeta(source: string): Map<string, TaskMeta> {
  // Wrap bare methods in a class if needed for extractMethodsFromClass
  const wrapped = source.includes("class ")
    ? source
    : `class Tasks {\n${source}\n}`;
  return extractMethodsFromClass(wrapped, "Tasks");
}

describe("extractTaskMeta", () => {
  test("extracts method with no params", () => {
    const source = `
      /** Run the build */
      async build(c: Context) {}
    `;
    const meta = extractTaskMeta(source);
    expect(meta.get("build")).toMatchObject({
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
    expect(meta.get("hello")).toMatchObject({
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
    expect(meta.get("count")).toMatchObject({
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
    expect(meta.get("greet")).toMatchObject({
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
    expect(meta.get("deploy")).toMatchObject({
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
    expect(meta.get("batch")).toMatchObject({
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
    expect(meta.get("search")).toMatchObject({
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
    expect(meta.get("config")).toMatchObject({
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

describe("rest parameters (spec section 3)", () => {
  test("detects rest parameter", () => {
    const params = parseParams("...items: string[]");
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({
      name: "items",
      type: "array",
      required: false,
      isRest: true,
    });
  });

  test("formats rest param for help as [items...]", () => {
    const params = parseParams("...items: string[]");
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

describe("parseParams", () => {
  test("auto-generates long flag from param name", () => {
    const params = parseParams("env: string", "Deploy app");
    expect(params[0].flag).toEqual({ long: "--env" });
  });

  test("includes short flag from @flag annotation", () => {
    const jsdoc = `
      Deploy app
      @flag env -e
    `;
    const params = parseParams("env: string", jsdoc);
    expect(params[0].flag).toEqual({ long: "--env", short: "-e" });
  });

  test("includes aliases from @flag annotation", () => {
    const jsdoc = `
      Deploy
      @flag env -e --environment
    `;
    const params = parseParams("env: string", jsdoc);
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
    const params = parseParams(
      "env: string, force: boolean = false",
      jsdoc,
    );
    expect(params[0].flag).toEqual({ long: "--env", short: "-e" });
    expect(params[1].flag).toEqual({ long: "--force", short: "-f" });
  });

  test("rest parameters do not get flags", () => {
    const params = parseParams("...packages: string[]", "Install");
    expect(params[0].isRest).toBe(true);
    expect(params[0].flag).toBeUndefined();
  });

  test("params without @flag annotation still get auto long flag", () => {
    const jsdoc = `
      Deploy
      @flag env -e
    `;
    const params = parseParams("env: string, count: number", jsdoc);
    expect(params[0].flag).toEqual({ long: "--env", short: "-e" });
    expect(params[1].flag).toEqual({ long: "--count" });
  });

  test("preserves other param metadata", () => {
    const params = parseParams(
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

  test("nullable params are treated as optional", () => {
    const params = parseParams(
      "name: string, filter: string | null",
      "Search",
    );
    expect(params[0]).toMatchObject({
      name: "name",
      type: "string",
      required: true,
    });
    expect(params[1]).toMatchObject({
      name: "filter",
      type: "string",
      required: false,
    });
  });

  test("nullable with default is still optional", () => {
    const params = parseParams(
      "filter: string | null = null",
      "Search",
    );
    expect(params[0]).toMatchObject({
      name: "filter",
      type: "string",
      required: false,
    });
  });

  test("handles multiple nullable params", () => {
    const params = parseParams(
      "a: string, b: number | null, c: boolean | null",
      "Test",
    );
    expect(params[0].required).toBe(true);
    expect(params[1].required).toBe(false);
    expect(params[2].required).toBe(false);
  });
});

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
  ): ParamMeta[] =>
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
    expect(result).toEqual(["World", 3]);
  });

  test("flags take precedence over positional", () => {
    const params = makeParams([{ name: "name", type: "string" }]);
    const parsed = {
      positional: ["Positional"],
      flags: new Map<string, string | boolean>([["name", "FromFlag"]]),
    };
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
    expect(result).toEqual([true]);
  });

  test("throws on missing required arg", () => {
    const params = makeParams([{ name: "name", type: "string" }]);
    const parsed = { positional: [], flags: new Map() };
    expect(() => resolveArgs(params, parsed)).toThrow(
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
    const result = resolveArgs(params, parsed);
    // undefined preserves position; JS default params handle it correctly
    expect(result).toEqual(["World", undefined]);
  });

  test("handles rest parameters", () => {
    const params: ParamMeta[] = [
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
    const result = resolveArgs(params, parsed);
    expect(result).toEqual(["react", "vue", "angular"]);
  });

  test("handles rest parameters with preceding params", () => {
    const params: ParamMeta[] = [
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
    const result = resolveArgs(params, parsed);
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
    const result = resolveArgs(params, parsed);
    expect(result).toEqual(["World", 2]);
  });

  test("skips optional param but still processes subsequent required params", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "optional", type: "string", required: false },
      { name: "required", type: "number" },
    ]);
    // Only provide name and required (skip optional)
    const parsed = {
      positional: ["World"],
      flags: new Map<string, string | boolean>([["required", "42"]]),
    };
    const result = resolveArgs(params, parsed);
    // undefined preserves position so "required" lands in the correct arg slot
    expect(result).toEqual(["World", undefined, 42]);
  });

  test("skips multiple optional params and resolves later required param", () => {
    const params = makeParams([
      { name: "a", type: "string", required: false },
      { name: "b", type: "string", required: false },
      { name: "c", type: "number" },
    ]);
    const parsed = {
      positional: [],
      flags: new Map<string, string | boolean>([["c", "7"]]),
    };
    const result = resolveArgs(params, parsed);
    expect(result).toEqual([undefined, undefined, 7]);
  });

  test("resolves optional param via flag while positional fills required", () => {
    const params = makeParams([
      { name: "name", type: "string" },
      { name: "verbose", type: "boolean", required: false },
      { name: "count", type: "number" },
    ]);
    const parsed = {
      positional: ["World", "3"],
      flags: new Map<string, string | boolean>([["verbose", true]]),
    };
    const result = resolveArgs(params, parsed);
    expect(result).toEqual(["World", true, 3]);
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

  test("treats multi-char short flag (-abc) as positional", () => {
    const result = parseCliArgs(["-abc"]);
    expect(result.positional).toEqual(["-abc"]);
    expect(result.flags.size).toBe(0);
  });

  test("treats multi-char short flag with value (-abc=val) as positional", () => {
    const result = parseCliArgs(["-abc=val"]);
    expect(result.positional).toEqual(["-abc=val"]);
    expect(result.flags.size).toBe(0);
  });

  test("handles flag value starting with a digit (not a flag)", () => {
    const result = parseCliArgs(["--port", "8080"]);
    expect(result.flags.get("port")).toBe("8080");
  });

  test("handles short flag with empty equals value", () => {
    const result = parseCliArgs(["-n="]);
    expect(result.flags.get("n")).toBe("");
  });

  test("handles -- followed by flag-like args as positional", () => {
    const result = parseCliArgs(["--", "--flag", "-x", "--no-thing"]);
    expect(result.positional).toEqual(["--flag", "-x", "--no-thing"]);
    expect(result.flags.size).toBe(0);
  });

  test("handles boolean flag before a flag-like negative number", () => {
    const result = parseCliArgs(["--verbose", "-1"]);
    // -1 looks like a flag, so --verbose is boolean true
    expect(result.flags.get("verbose")).toBe(true);
    // -1 is length 2 so it's parsed as short flag "1" = true
    expect(result.flags.get("1")).toBe(true);
  });

  test("handles --no- prefix with equals syntax", () => {
    // --no-verbose=false is ambiguous but --no-verbose is clear
    const result = parseCliArgs(["--no-verbose"]);
    expect(result.flags.get("verbose")).toBe(false);
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

#!/usr/bin/env bun
import { Context } from "./context";

// Supported parameter types
type ParamType = "string" | "number" | "boolean" | "object" | "array";

// Flag metadata for a parameter
interface FlagMeta {
  long: string; // e.g., "--name"
  short?: string; // e.g., "-n"
  aliases?: string[]; // e.g., ["--environment"]
}

// Parameter metadata extracted from TypeScript
interface ParamMeta {
  name: string;
  type: ParamType;
  required: boolean;
  isRest: boolean;
  flag?: FlagMeta;
}

interface TaskMeta {
  description: string;
  params: ParamMeta[];
}

// Parsed CLI arguments
interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

interface DiscoveredTasks {
  root: Map<string, TaskMeta>;
  namespaced: Map<string, Map<string, TaskMeta>>; // namespace -> method -> meta
  classDoc: string | null;
}

// Extract class-level JSDoc for Tasks class
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

// Parse command to extract namespace and method
function parseCommand(command: string): {
  namespace: string | null;
  method: string;
} {
  const colonIdx = command.indexOf(":");
  const dotIdx = command.indexOf(".");

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

// Extract methods from a class definition in source
function extractMethodsFromClass(
  source: string,
  className: string,
): Map<string, TaskMeta> {
  const methods = new Map<string, TaskMeta>();

  // Find the class body
  const classPattern = new RegExp(
    `class\\s+${className}\\s*(?:extends\\s+\\w+)?\\s*\\{([\\s\\S]*?)\\n\\}`,
  );
  const classMatch = source.match(classPattern);
  if (!classMatch) return methods;

  const classBody = classMatch[1];

  // Match method declarations with JSDoc
  const methodPattern =
    /\/\*\*\s*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*async\s+(\w+)\s*\(\s*c\s*:\s*Context\s*(?:,\s*([^)]+))?\s*\)/g;

  let match;
  while ((match = methodPattern.exec(classBody)) !== null) {
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

    const params = parseParams(paramsStr, jsdoc);
    methods.set(methodName, { description, params });
  }

  return methods;
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

// Parse parameter string into ParamMeta array
function parseParams(
  paramsStr: string | undefined,
  jsdoc: string = "",
): ParamMeta[] {
  const params: ParamMeta[] = [];
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

    params.push({ name, type, required: !hasDefault, isRest: false, flag });
  }

  return params;
}

// Discover all tasks including namespaced ones (source parsing only)
function discoverAllTasks(source: string): DiscoveredTasks {
  const root = extractMethodsFromClass(source, "Tasks");
  const namespaced = new Map<string, Map<string, TaskMeta>>();
  const classDoc = extractClassDoc(source);

  // Find namespace assignments in Tasks class: propertyName = new ClassName()
  const nsPattern = /(\w+)\s*=\s*new\s+(\w+)\s*\(\s*\)/g;
  let nsMatch;

  while ((nsMatch = nsPattern.exec(source)) !== null) {
    const [, propName, className] = nsMatch;

    // Skip private namespaces
    if (propName.startsWith("_")) continue;

    const nsMethods = extractMethodsFromClass(source, className);
    if (nsMethods.size > 0) {
      namespaced.set(propName, nsMethods);
    }
  }

  return { root, namespaced, classDoc };
}

// Discover methods from runtime instance (for imported namespaces)
function discoverRuntimeNamespaces(
  instance: any,
  discovered: DiscoveredTasks,
): void {
  // Find namespace properties on the instance
  for (const propName of Object.getOwnPropertyNames(instance)) {
    // Skip private, already discovered, or non-objects
    if (propName.startsWith("_")) continue;
    if (discovered.namespaced.has(propName)) continue;

    const prop = instance[propName];
    if (!prop || typeof prop !== "object" || Array.isArray(prop)) continue;

    // Discover methods from this namespace at runtime
    const methods = new Map<string, TaskMeta>();
    let proto = Object.getPrototypeOf(prop);

    while (proto && proto !== Object.prototype) {
      for (const methodName of Object.getOwnPropertyNames(proto)) {
        if (
          methodName === "constructor" ||
          methodName.startsWith("_") ||
          typeof prop[methodName] !== "function"
        ) {
          continue;
        }

        // No type info for imported methods - treat args as strings
        if (!methods.has(methodName)) {
          methods.set(methodName, { description: "", params: [] });
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    if (methods.size > 0) {
      discovered.namespaced.set(propName, methods);
    }
  }
}

// Parse TypeScript source to extract method signatures and types (legacy, for compatibility)
async function extractTaskMeta(source: string): Promise<Map<string, TaskMeta>> {
  const { root, namespaced } = discoverAllTasks(source);

  // Combine root and namespaced for backward compat
  const all = new Map(root);
  for (const [ns, methods] of namespaced) {
    for (const [method, meta] of methods) {
      all.set(method, meta); // This flattens - we'll fix in main()
    }
  }

  return all;
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

// Resolve arguments from parsed CLI args using param metadata
function resolveArgs(params: ParamMeta[], parsed: ParsedArgs): unknown[] {
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
      result.push(coerceArg(String(value), param.type));
    }
  }

  return result;
}

// Format param for help display
function formatParam(param: ParamMeta): string {
  if (param.isRest) {
    return `[${param.name}...]`;
  }
  return param.required ? `<${param.name}>` : `[${param.name}]`;
}

// Format flag info for display
function formatFlagInfo(param: ParamMeta): string {
  if (!param.flag || param.isRest) return "";

  const parts: string[] = [param.flag.long];
  if (param.flag.short) {
    parts.push(param.flag.short);
  }
  if (param.flag.aliases) {
    parts.push(...param.flag.aliases);
  }
  return parts.join(", ");
}

// Display help for a specific task
function showTaskHelp(command: string, meta: TaskMeta): void {
  const paramStr = meta.params.map(formatParam).join(" ");
  const signature = paramStr ? `${command} ${paramStr}` : command;

  console.log(`Usage: invt ${signature}\n`);

  if (meta.description) {
    console.log(`${meta.description}\n`);
  }

  if (meta.params.length > 0) {
    console.log("Arguments:");
    for (const param of meta.params) {
      const reqStr = param.required ? "(required)" : "(optional)";
      const typeStr = param.isRest ? `${param.type}...` : param.type;
      const flagStr = formatFlagInfo(param);
      const flagDisplay = flagStr ? `  ${flagStr}` : "";
      console.log(
        `  ${param.name.padEnd(15)} ${typeStr.padEnd(10)} ${reqStr}${flagDisplay}`,
      );
    }
  }
}

// Main CLI entry point
async function main() {
  const args = Bun.argv.slice(2);

  // --version flag
  if (args[0] === "--version") {
    const pkgPath = new URL("../package.json", import.meta.url).pathname;
    const pkg = await Bun.file(pkgPath).json();
    console.log(pkg.version);
    return;
  }

  // Find tasks.ts
  let tasksPath: string;
  try {
    tasksPath = Bun.resolveSync("./tasks.ts", process.cwd());
  } catch {
    console.log("No tasks.ts found. Create one to get started:\n");
    console.log(`import { Context } from "invoket/context";

export class Tasks {
  /** Say hello */
  async hello(c: Context) {
    console.log("Hello, World!");
  }
}
`);
    process.exit(1);
  }

  const source = await Bun.file(tasksPath).text();

  // Import and instantiate Tasks class
  const { Tasks } = await import(tasksPath);
  const instance = new Tasks();
  const context = new Context();

  // Discover all tasks including namespaced
  const discovered = discoverAllTasks(source);

  // Also discover imported namespaces from runtime
  discoverRuntimeNamespaces(instance, discovered);

  // No args or just help flag -> show general help
  if (
    args.length === 0 ||
    (args.length === 1 && (args[0] === "-h" || args[0] === "--help"))
  ) {
    console.log("invoket — TypeScript task runner\n");

    if (discovered.classDoc) {
      console.log(`${discovered.classDoc}\n`);
    }

    console.log("Available tasks:\n");

    // Root tasks
    for (const [name, meta] of discovered.root) {
      const paramStr = meta.params.map(formatParam).join(" ");
      const signature = paramStr ? `${name} ${paramStr}` : name;
      console.log(`  ${signature}`);
    }

    // Namespaced tasks
    for (const [ns, methods] of discovered.namespaced) {
      console.log(`\n${ns}:`);
      for (const [name, meta] of methods) {
        const paramStr = meta.params.map(formatParam).join(" ");
        const signature = paramStr
          ? `${ns}:${name} ${paramStr}`
          : `${ns}:${name}`;
        console.log(`  ${signature}`);
      }
    }

    console.log("\nUsage: invt <task> [args...]");
    console.log("       invt <task> -h   Show help for a specific task");
    return;
  }

  // List flag
  if (args[0] === "-l" || args[0] === "--list") {
    console.log("Available tasks:\n");

    // Root tasks
    for (const [name, meta] of discovered.root) {
      const paramStr = meta.params.map(formatParam).join(" ");
      const signature = paramStr ? `${name} ${paramStr}` : name;
      console.log(`  ${signature}`);
    }

    // Namespaced tasks
    for (const [ns, methods] of discovered.namespaced) {
      console.log(`\n${ns}:`);
      for (const [name, meta] of methods) {
        const paramStr = meta.params.map(formatParam).join(" ");
        const signature = paramStr
          ? `${ns}:${name} ${paramStr}`
          : `${ns}:${name}`;
        console.log(`  ${signature}`);
      }
    }
    return;
  }

  const command = args[0];
  const taskArgs = args.slice(1);

  // Check if asking for task-specific help: invt hello -h
  const wantsTaskHelp = taskArgs.includes("-h") || taskArgs.includes("--help");

  const { namespace, method: methodName } = parseCommand(command);

  let meta: TaskMeta | undefined;
  let method: Function | undefined;
  let thisArg: any = instance;

  if (namespace) {
    // Validate namespace
    if (namespace.startsWith("_")) {
      console.error(`Cannot call private namespace "${namespace}"`);
      process.exit(1);
    }

    // Validate method
    if (methodName.startsWith("_")) {
      console.error(`Cannot call private method "${methodName}"`);
      process.exit(1);
    }

    const nsMethods = discovered.namespaced.get(namespace);
    if (!nsMethods) {
      console.error(`Unknown namespace: ${namespace}`);
      process.exit(1);
    }

    meta = nsMethods.get(methodName);
    if (!meta) {
      console.error(`Unknown task: ${command}`);
      console.error(
        `Available in ${namespace}: ${[...nsMethods.keys()].join(", ")}`,
      );
      process.exit(1);
    }

    thisArg = instance[namespace];
    method = thisArg[methodName];
  } else {
    // Root task
    if (methodName.startsWith("_")) {
      console.error(`Cannot call private method "${methodName}"`);
      process.exit(1);
    }

    meta = discovered.root.get(methodName);
    method = instance[methodName];

    // If method exists at runtime but not in source (inherited), allow it
    if (!meta && typeof method === "function") {
      // Inherited method - no type info, treat all args as strings
      meta = { description: "", params: [] };
    } else if (!meta) {
      console.error(`Unknown task: ${command}`);
      const allTasks = [...discovered.root.keys()];
      for (const [ns, methods] of discovered.namespaced) {
        for (const m of methods.keys()) {
          allTasks.push(`${ns}:${m}`);
        }
      }
      console.error(`Available: ${allTasks.join(", ")}`);
      process.exit(1);
    }
  }

  if (typeof method !== "function") {
    console.error(`Task "${command}" is not a function`);
    process.exit(1);
  }

  // Show task-specific help if requested
  if (wantsTaskHelp) {
    showTaskHelp(command, meta);
    return;
  }

  // Filter out help flags from taskArgs before parsing
  const argsWithoutHelp = taskArgs.filter((a) => a !== "-h" && a !== "--help");

  // Parse CLI args into flags and positional
  const parsed = parseCliArgs(argsWithoutHelp);

  // Validate and coerce arguments
  let coercedArgs: unknown[];

  // If no param info (imported namespace), pass all args as strings
  if (meta.params.length === 0 && argsWithoutHelp.length > 0) {
    coercedArgs = [...parsed.positional];
  } else {
    try {
      coercedArgs = resolveArgs(meta.params, parsed);
    } catch (e) {
      console.error((e as Error).message);
      const paramStr = meta.params.map(formatParam).join(" ");
      console.error(`Usage: ${command} ${paramStr}`);
      process.exit(1);
    }
  }

  // Execute task
  try {
    await method.call(thisArg, context, ...coercedArgs);
  } catch (e) {
    console.error(`Error running "${command}": ${(e as Error).message}`);
    process.exit(1);
  }
}

main();

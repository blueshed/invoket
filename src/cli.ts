#!/usr/bin/env bun
import { Context } from "./context";

// Supported parameter types
type ParamType = "string" | "number" | "boolean" | "object" | "array";

// Parameter metadata extracted from TypeScript
interface ParamMeta {
  name: string;
  type: ParamType;
  required: boolean;
  isRest: boolean;
}

interface TaskMeta {
  description: string;
  params: ParamMeta[];
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

    const params = parseParams(paramsStr);
    methods.set(methodName, { description, params });
  }

  return methods;
}

// Parse parameter string into ParamMeta array
function parseParams(paramsStr: string | undefined): ParamMeta[] {
  const params: ParamMeta[] = [];
  if (!paramsStr) return params;

  // Check for rest parameter first: ...name: type
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

    params.push({ name, type, required: !hasDefault, isRest: false });
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

// Format param for help display
function formatParam(param: ParamMeta): string {
  if (param.isRest) {
    return `[${param.name}...]`;
  }
  return param.required ? `<${param.name}>` : `[${param.name}]`;
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
      console.log(`  ${param.name.padEnd(15)} ${typeStr.padEnd(10)} ${reqStr}`);
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
  const tasksPath = Bun.resolveSync("./tasks.ts", process.cwd());
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

  // Validate and coerce arguments
  const coercedArgs: unknown[] = [];

  for (let i = 0; i < meta.params.length; i++) {
    const param = meta.params[i];

    // Handle rest parameters - collect all remaining args and spread them
    if (param.isRest) {
      const restArgs = taskArgs.slice(i);
      coercedArgs.push(...restArgs);
      break;
    }

    const arg = taskArgs[i];

    if (arg === undefined) {
      if (param.required) {
        console.error(
          `Missing required argument: <${param.name}> (${param.type})`,
        );
        const paramStr = meta.params.map(formatParam).join(" ");
        console.error(`Usage: ${command} ${paramStr}`);
        process.exit(1);
      }
      // Optional param not provided, don't push (use default)
      break;
    }

    try {
      coercedArgs.push(coerceArg(arg, param.type));
    } catch (e) {
      console.error(`Argument "${param.name}": ${(e as Error).message}`);
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

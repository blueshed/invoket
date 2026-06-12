// Supported parameter types
export type ParamType = "string" | "number" | "boolean" | "object" | "array";

// Flag metadata for a parameter
export interface FlagMeta {
  long: string; // e.g., "--name"
  short?: string; // e.g., "-n"
  aliases?: string[]; // e.g., ["--environment"]
}

// Parameter metadata extracted from TypeScript
export interface ParamMeta {
  name: string;
  type: ParamType;
  required: boolean;
  isRest: boolean;
  flag?: FlagMeta;
  choices?: string[]; // from string-literal union types, e.g. "dev" | "prod"
}

export interface TaskMeta {
  description: string;
  params: ParamMeta[];
  untyped?: boolean; // discovered at runtime only — no signature info available
}

// Parsed CLI arguments
export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

export interface DiscoveredTasks {
  root: Map<string, TaskMeta>;
  namespaced: Map<string, Map<string, TaskMeta>>; // namespace -> method -> meta
  classDoc: string | null;
}

// Extract class-level JSDoc for Tasks class
export function extractClassDoc(source: string): string | null {
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
export function parseCommand(command: string): {
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
export function extractMethodsFromClass(
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
export function extractFlagAnnotations(
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
export function parseParams(
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

  // Handles union types with null (e.g., string | null) and string-literal
  // unions (e.g., "dev" | "prod"), which become validated string choices
  const paramPattern =
    /(\w+)\s*:\s*((?:"[^"]*"|'[^']*')(?:\s*\|\s*(?:"[^"]*"|'[^']*'))*|\w+\[\]|Record<[^>]+>|\{[^}]*\}|string|number|boolean|\w+)(?:\s*\|\s*null)?(?:\s*=\s*[^,)]+)?/g;
  let paramMatch;

  while ((paramMatch = paramPattern.exec(paramsStr)) !== null) {
    const [fullMatch, name, rawType] = paramMatch;
    const hasDefault = fullMatch.includes("=");
    const isNullable = fullMatch.includes("| null");

    let type: ParamType;
    let choices: string[] | undefined;
    if (rawType.startsWith('"') || rawType.startsWith("'")) {
      type = "string";
      choices = [...rawType.matchAll(/"([^"]*)"|'([^']*)'/g)].map(
        (m) => m[1] ?? m[2],
      );
    } else if (rawType === "string") {
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
      required: !hasDefault && !isNullable,
      isRest: false,
      flag,
      choices,
    });
  }

  return params;
}

// Extract import statements: maps imported identifiers to their module paths
export function extractImports(
  source: string,
): Map<string, string> {
  const imports = new Map<string, string>();
  const pattern =
    /import\s+(?!\s*type\s)(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, namedImports, defaultImport, importPath] = match;
    if (namedImports) {
      for (const spec of namedImports.split(",")) {
        const parts = spec.trim().split(/\s+as\s+/);
        const localName = parts[parts.length - 1].trim();
        if (localName) imports.set(localName, importPath);
      }
    }
    if (defaultImport) {
      imports.set(defaultImport, importPath);
    }
  }
  return imports;
}

// Find namespace assignments whose class wasn't found in the local source
export function findUnresolvedNamespaces(
  source: string,
  discovered: DiscoveredTasks,
): Map<string, string> {
  const unresolved = new Map<string, string>(); // propName -> className
  const nsPattern = /(\w+)\s*=\s*new\s+(\w+)\s*\(\s*\)/g;
  let match;
  while ((match = nsPattern.exec(source)) !== null) {
    const [, propName, className] = match;
    if (propName.startsWith("_")) continue;
    if (discovered.namespaced.has(propName)) continue;
    unresolved.set(propName, className);
  }
  return unresolved;
}

// Discover all tasks including namespaced ones (source parsing only)
export function discoverAllTasks(source: string): DiscoveredTasks {
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
export function discoverRuntimeNamespaces(
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
          methods.set(methodName, { description: "", params: [], untyped: true });
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    if (methods.size > 0) {
      discovered.namespaced.set(propName, methods);
    }
  }
}

// Convert CLI arg to typed value
export function coerceArg(value: string, type: ParamType): unknown {
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

// Negative numbers (-3, -0.5) are values, not flags
function isNegativeNumber(arg: string): boolean {
  return /^-(\d+(\.\d+)?|\.\d+)$/.test(arg);
}

// Parse CLI arguments into flags and positional args
export function parseCliArgs(args: string[]): ParsedArgs {
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
      if (
        nextArg !== undefined &&
        (!nextArg.startsWith("-") || isNegativeNumber(nextArg))
      ) {
        flags.set(name, nextArg);
        i++; // Skip next arg
      } else {
        flags.set(name, true); // Boolean flag
      }
      continue;
    }

    // Bare negative number is a positional value, not a short flag
    if (isNegativeNumber(arg)) {
      positional.push(arg);
      continue;
    }

    // -f=value (short with equals, single char only)
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const name = arg.slice(1, eqIdx);
      if (name.length === 1) {
        const value = arg.slice(eqIdx + 1);
        flags.set(name, value);
        continue;
      }
    }

    // -f value or -f (boolean) — single char short flags only
    if (arg.startsWith("-") && arg.length === 2) {
      const name = arg.slice(1);
      const nextArg = args[i + 1];

      if (
        nextArg !== undefined &&
        (!nextArg.startsWith("-") || isNegativeNumber(nextArg))
      ) {
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
export function resolveArgs(params: ParamMeta[], parsed: ParsedArgs): unknown[] {
  // Reject unknown flags first — a typo'd flag silently changing behavior is
  // worse than an error, and this diagnostic beats "missing required argument"
  const validFlagNames = new Set<string>();
  for (const param of params) {
    if (!param.flag) continue;
    validFlagNames.add(param.flag.long.slice(2));
    if (param.flag.short) validFlagNames.add(param.flag.short.slice(1));
    for (const alias of param.flag.aliases ?? []) {
      validFlagNames.add(alias.slice(2));
    }
  }
  const unknownFlags = [...parsed.flags.keys()].filter(
    (name) => !validFlagNames.has(name),
  );
  if (unknownFlags.length > 0) {
    const display = unknownFlags
      .map((name) => (name.length === 1 ? `-${name}` : `--${name}`))
      .join(", ");
    const valid = params
      .filter((p) => p.flag)
      .map((p) => p.flag!.long)
      .join(", ");
    throw new Error(
      `Unknown flag${unknownFlags.length > 1 ? "s" : ""}: ${display}` +
        (valid ? `. Valid flags: ${valid}` : ""),
    );
  }

  const result: unknown[] = [];
  const usedPositional = new Set<number>();
  let hasRest = false;

  for (const param of params) {
    // Handle rest parameters - collect all remaining positional args
    if (param.isRest) {
      hasRest = true;
      const remaining = parsed.positional.filter(
        (_, i) => !usedPositional.has(i),
      );
      result.push(...remaining);
      break;
    }

    let value: string | boolean | undefined;

    // Try to get value from flags first; long flag wins over short and aliases
    if (param.flag) {
      const flagNames = [param.flag.long.slice(2)];
      if (param.flag.short) flagNames.push(param.flag.short.slice(1));
      if (param.flag.aliases) {
        flagNames.push(...param.flag.aliases.map((a) => a.slice(2)));
      }
      for (const flagName of flagNames) {
        if (parsed.flags.has(flagName)) {
          value = parsed.flags.get(flagName);
          break;
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
      result.push(undefined); // Preserve position so subsequent params align correctly
      continue;
    }

    // Coerce and add to result
    // Boolean flags that are already boolean don't need coercion
    let coerced: unknown;
    if (typeof value === "boolean" && param.type === "boolean") {
      coerced = value;
    } else {
      coerced = coerceArg(String(value), param.type);
    }

    if (param.choices && !param.choices.includes(String(coerced))) {
      throw new Error(
        `Invalid value for <${param.name}>: "${coerced}" (expected one of: ${param.choices.join(", ")})`,
      );
    }

    result.push(coerced);
  }

  // Positional args left unclaimed by any parameter are an error too
  if (!hasRest) {
    const extra = parsed.positional.filter((_, i) => !usedPositional.has(i));
    if (extra.length > 0) {
      throw new Error(
        `Unexpected argument${extra.length > 1 ? "s" : ""}: ${extra.join(" ")}`,
      );
    }
  }

  return result;
}

// Format param for help display
export function formatParam(param: ParamMeta): string {
  if (param.isRest) {
    return `[${param.name}...]`;
  }
  return param.required ? `<${param.name}>` : `[${param.name}]`;
}

// Format flag info for display
export function formatFlagInfo(param: ParamMeta): string {
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

// Display task listing (used by both help and --list)
export function printTaskList(discovered: DiscoveredTasks): void {
  const signatureFor = (prefix: string, name: string, meta: TaskMeta) => {
    const paramStr = meta.params.map(formatParam).join(" ");
    const full = prefix ? `${prefix}:${name}` : name;
    return paramStr ? `${full} ${paramStr}` : full;
  };

  // Collect every row first so descriptions align across the whole listing
  const rootRows: Array<[string, string]> = [];
  for (const [name, meta] of discovered.root) {
    rootRows.push([signatureFor("", name, meta), meta.description]);
  }
  const nsRows = new Map<string, Array<[string, string]>>();
  for (const [ns, methods] of discovered.namespaced) {
    const rows: Array<[string, string]> = [];
    for (const [name, meta] of methods) {
      rows.push([signatureFor(ns, name, meta), meta.description]);
    }
    nsRows.set(ns, rows);
  }

  const allRows = [...rootRows, ...[...nsRows.values()].flat()];
  const width = Math.max(0, ...allRows.map(([sig]) => sig.length));
  const printRow = ([sig, desc]: [string, string]) =>
    console.log(desc ? `  ${sig.padEnd(width)}  ${desc}` : `  ${sig}`);

  rootRows.forEach(printRow);
  for (const [ns, rows] of nsRows) {
    console.log(`\n${ns}:`);
    rows.forEach(printRow);
  }
}

// Display help for a specific task
export function showTaskHelp(command: string, meta: TaskMeta): void {
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
      const typeStr = param.isRest
        ? `${param.type}...`
        : param.choices
          ? param.choices.join("|")
          : param.type;
      const flagStr = formatFlagInfo(param);
      const flagDisplay = flagStr ? `  ${flagStr}` : "";
      console.log(
        `  ${param.name.padEnd(15)} ${typeStr.padEnd(10)} ${reqStr}${flagDisplay}`,
      );
    }
  }
}

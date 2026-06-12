#!/usr/bin/env bun
import { Context, CommandError } from "./context";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import {
  discoverAllTasks,
  discoverRuntimeNamespaces,
  extractImports,
  extractMethodsFromClass,
  findUnresolvedNamespaces,
  parseCommand,
  parseCliArgs,
  resolveArgs,
  formatParam,
  printTaskList,
  showTaskHelp,
} from "./parser";

// Walk up from startDir looking for tasks.ts (like make/just find their files)
function findTasksFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "tasks.ts");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Main CLI entry point
async function main() {
  const args = Bun.argv.slice(2);

  // --version flag
  if (args[0] === "--version") {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = await Bun.file(pkgPath).json();
    console.log(pkg.version);
    return;
  }

  // --init flag: scaffold tasks.ts and CLAUDE.md
  if (args[0] === "--init") {
    const cwd = process.cwd();

    const tasksFile = `${cwd}/tasks.ts`;
    if (existsSync(tasksFile)) {
      console.log("tasks.ts already exists, skipping.");
    } else {
      await Bun.write(
        tasksFile,
        `import { Context } from "invoket/context";

export class Tasks {
  /** Say hello */
  async hello(c: Context) {
    console.log("Hello, World!");
  }
}
`,
      );
      console.log("Created tasks.ts");
    }

    const claudeFile = `${cwd}/CLAUDE.md`;
    const claudeMdPath = fileURLToPath(new URL("../CLAUDE.md", import.meta.url));
    const claudeMd = await Bun.file(claudeMdPath).text();
    // First substantive line of the shipped guide doubles as the "already
    // installed" marker — a mere mention of invoket shouldn't skip the append
    const marker = claudeMd
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (existsSync(claudeFile)) {
      const existing = await Bun.file(claudeFile).text();
      if (marker && existing.includes(marker)) {
        console.log("CLAUDE.md already has invoket section, skipping.");
      } else {
        await Bun.write(claudeFile, existing.trimEnd() + "\n\n" + claudeMd);
        console.log("Appended invoket guide to CLAUDE.md");
      }
    } else {
      await Bun.write(claudeFile, claudeMd);
      console.log("Created CLAUDE.md");
    }

    return;
  }

  // Find tasks.ts in cwd or any parent directory
  const tasksPath = findTasksFile(process.cwd());
  if (!tasksPath) {
    console.error(
      "No tasks.ts found in this directory or any parent. Run 'invt --init' to get started.",
    );
    process.exit(1);
  }

  const source = await Bun.file(tasksPath).text();

  // Import and instantiate Tasks class
  const { Tasks } = await import(tasksPath);
  const instance = new Tasks();
  const context = new Context();
  // Tasks run relative to tasks.ts, wherever invt was invoked from
  context.cwd = dirname(tasksPath);

  // Discover all tasks including namespaced
  const discovered = discoverAllTasks(source);

  // Resolve imported namespace classes from their source files
  const imports = extractImports(source);
  const unresolved = findUnresolvedNamespaces(source, discovered);
  for (const [propName, className] of unresolved) {
    const importPath = imports.get(className);
    if (!importPath) continue;
    try {
      const resolvedPath = Bun.resolveSync(importPath, dirname(tasksPath));
      const importedSource = await Bun.file(resolvedPath).text();
      const methods = extractMethodsFromClass(importedSource, className);
      if (methods.size > 0) {
        discovered.namespaced.set(propName, methods);
      }
    } catch {
      // Can't resolve import — runtime discovery will handle it
    }
  }

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
    printTaskList(discovered);
    console.log("\nUsage: invt <task> [args...]");
    console.log("       invt <task> -h   Show help for a specific task");
    return;
  }

  // List flag
  if (args[0] === "-l" || args[0] === "--list") {
    console.log("Available tasks:\n");
    printTaskList(discovered);
    return;
  }

  const command = args[0];
  const taskArgs = args.slice(1);

  // Check if asking for task-specific help: invt hello -h
  // Anything after -- is a literal task argument, never a help flag
  const ddIdx = taskArgs.indexOf("--");
  const beforeDD = ddIdx === -1 ? taskArgs : taskArgs.slice(0, ddIdx);
  const wantsTaskHelp = beforeDD.includes("-h") || beforeDD.includes("--help");

  const { namespace, method: methodName } = parseCommand(command);

  let meta;
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
      meta = { description: "", params: [], untyped: true };
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

  // Filter out help flags from taskArgs before parsing (only before --)
  const notHelp = (a: string) => a !== "-h" && a !== "--help";
  const argsWithoutHelp =
    ddIdx === -1
      ? taskArgs.filter(notHelp)
      : [...beforeDD.filter(notHelp), ...taskArgs.slice(ddIdx)];

  // Parse CLI args into flags and positional
  const parsed = parseCliArgs(argsWithoutHelp);

  // Validate and coerce arguments
  let coercedArgs: unknown[];

  // If no signature info (runtime-discovered method), pass all args as strings
  if (meta.untyped && argsWithoutHelp.length > 0) {
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
    if (e instanceof CommandError) {
      // Command output was already written (or is in the message when hidden)
      console.error(`Error running "${command}": ${e.message}`);
    } else if (e instanceof Error) {
      console.error(`Error running "${command}": ${e.message}`);
      // A bug in the task itself — show where it happened
      const frames = e.stack?.split("\n").slice(1).join("\n");
      if (frames) console.error(frames);
    } else {
      console.error(`Error running "${command}": ${String(e)}`);
    }
    process.exit(1);
  }
}

main();

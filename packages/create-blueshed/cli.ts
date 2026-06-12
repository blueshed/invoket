#!/usr/bin/env bun
/**
 * create-blueshed — scaffold a Bun project on the blueshed stack:
 * @blueshed/delta (realtime sync), @blueshed/railroad (signals + JSX),
 * invoket (typed task CLI), wired for agent sessions out of the box
 * (SessionStart hook → `invt session:start` → skills sync + project memory).
 *
 *   bunx create-blueshed my-app
 *   npm create blueshed@latest my-app
 *
 * Template files live in ./templates. Dotted names are stored undotted
 * (gitignore, claude/) so npm packs them; the scaffolder restores the dots.
 * __NAME__ and __NOW__ are substituted in every file.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";

const TEMPLATES = fileURLToPath(new URL("./templates", import.meta.url));

// Stored name -> scaffolded name (npm refuses to pack some dotfiles)
const RENAMES: Record<string, string> = {
  gitignore: ".gitignore",
  claude: ".claude",
  "ctx.jsonl": ".ctx.jsonl",
};

function usage(): never {
  console.error("Usage: create-blueshed <directory> [--name <app-name>]");
  process.exit(1);
}

function copyTree(srcDir: string, destDir: string, vars: Record<string, string>) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const destName = RENAMES[entry] ?? entry;
    const dest = join(destDir, destName);
    if (statSync(src).isDirectory()) {
      copyTree(src, dest, vars);
      continue;
    }
    let text = readFileSync(src, "utf8");
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(key, value);
    }
    writeFileSync(dest, text);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let dir: string | undefined;
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") {
      name = args[++i];
    } else if (a === "-h" || a === "--help") {
      usage();
    } else if (!dir) {
      dir = a;
    } else {
      usage();
    }
  }
  if (!dir) usage();

  const target = resolve(process.cwd(), dir);
  name ??= basename(target);
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`Refusing to scaffold into non-empty directory: ${target}`);
    process.exit(1);
  }

  copyTree(TEMPLATES, target, {
    __NAME__: name,
    __NOW__: new Date().toISOString(),
  });
  chmodSync(join(target, ".claude", "hooks", "session-start.sh"), 0o755);

  // hjeli authors models from outside the project — wire its MCP server in
  // when the binary is available, skip silently when it isn't.
  if (Bun.which("hjeli")) {
    writeFileSync(
      join(target, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { hjeli: { command: "hjeli", args: ["mcp"] } } },
        null,
        2,
      ) + "\n",
    );
  }

  if (Bun.which("git")) {
    const inRepo = Bun.spawnSync(["git", "-C", target, "rev-parse", "--is-inside-work-tree"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (inRepo.exitCode !== 0) {
      Bun.spawnSync(["git", "init", "-q", target]);
    }
  }

  console.log(`Created ${name} at ${target}

Next steps:
  cd ${dir}
  bun install
  bun dev          # http://localhost:3000
  invt -l          # the task surface (ctx, session, check)

Agent sessions are pre-wired: the SessionStart hook runs \`invt session:start\`,
which syncs .claude/skills from your dependencies and injects project memory
(.ctx.jsonl) into context. Record what you learn with \`invt ctx:set\` and
\`invt ctx:decide\`.`);
}

main();

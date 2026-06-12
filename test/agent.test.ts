import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { $ } from "bun";
import {
  buildMemoryBlock,
  buildSessionPayload,
  ctxDecide,
  ctxDecisions,
  ctxDump,
  ctxGet,
  ctxSearch,
  ctxSet,
  syncSkills,
} from "../src/agent";

const TEST_DIR = "/tmp/invoket-agent-test";
const REPO_ROOT = join(import.meta.dir, "..");
const CLI_PATH = join(REPO_ROOT, "src/cli.ts");

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("Ctx store", () => {
  test("set and get a fact", () => {
    ctxSet(TEST_DIR, "db", "Postgres 16 on :5432");
    const fact = ctxGet(TEST_DIR, "db");
    expect(fact?.value).toBe("Postgres 16 on :5432");
    expect(fact?.updated_at).toBeTruthy();
  });

  test("set overwrites an existing fact", () => {
    ctxSet(TEST_DIR, "db", "SQLite");
    ctxSet(TEST_DIR, "db", "Postgres");
    expect(ctxGet(TEST_DIR, "db")?.value).toBe("Postgres");
    expect(ctxDump(TEST_DIR).facts).toHaveLength(1);
  });

  test("get returns null for a missing key", () => {
    expect(ctxGet(TEST_DIR, "nope")).toBeNull();
  });

  test("search matches facts and decisions", () => {
    ctxSet(TEST_DIR, "auth", "JWT in httpOnly cookies");
    ctxDecide(TEST_DIR, "orm", "none", "delta ops instead");
    expect(ctxSearch(TEST_DIR, "JWT")).toHaveLength(1);
    expect(ctxSearch(TEST_DIR, "delta")).toHaveLength(1);
    expect(ctxSearch(TEST_DIR, "zzz")).toHaveLength(0);
  });

  test("decisions are listed newest first with stable ids", () => {
    const a = ctxDecide(TEST_DIR, "first", "yes", "");
    const b = ctxDecide(TEST_DIR, "second", "also yes", "because");
    expect(b).toBeGreaterThan(a);
    const rows = ctxDecisions(TEST_DIR);
    expect(rows.map((r) => r.subject)).toEqual(["second", "first"]);
    expect(rows[1]?.id).toBe(a);
  });

  test("mutations write a committed JSONL beside the db", () => {
    ctxSet(TEST_DIR, "deploy", "fly.io");
    ctxDecide(TEST_DIR, "backend", "JSON file", "smallest that fits");
    const text = readFileSync(join(TEST_DIR, ".ctx.jsonl"), "utf8");
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ t: "fact", key: "deploy", value: "fly.io" });
    expect(lines[1]).toMatchObject({ t: "decision", subject: "backend" });
  });

  test("the db is a cache: deleting it loses nothing", () => {
    ctxSet(TEST_DIR, "db", "Postgres");
    const id = ctxDecide(TEST_DIR, "auth", "JWT", "");
    unlinkSync(join(TEST_DIR, ".ctx.db"));
    expect(ctxGet(TEST_DIR, "db")?.value).toBe("Postgres");
    expect(ctxDecisions(TEST_DIR)[0]?.id).toBe(id);
  });

  test("a changed JSONL (pull, hand edit) wins over the stale cache", () => {
    ctxSet(TEST_DIR, "db", "Postgres");
    appendFileSync(
      join(TEST_DIR, ".ctx.jsonl"),
      JSON.stringify({ t: "fact", key: "pulled", value: "from a teammate" }) + "\n",
    );
    expect(ctxGet(TEST_DIR, "pulled")?.value).toBe("from a teammate");
    expect(ctxGet(TEST_DIR, "db")?.value).toBe("Postgres");
  });

  test("a corrupt JSONL line is skipped, not fatal", () => {
    writeFileSync(
      join(TEST_DIR, ".ctx.jsonl"),
      'not json\n{"t":"fact","key":"ok","value":"survives"}\n',
    );
    expect(ctxGet(TEST_DIR, "ok")?.value).toBe("survives");
  });
});

describe("syncSkills", () => {
  function addDepWithSkill(dep: string, skill: string) {
    const skillDir = join(TEST_DIR, "node_modules", dep, ".claude", "skills", skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}\n`);
  }

  test("copies skills from dependencies that ship them", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "with-skill": "1.0.0", plain: "1.0.0" } }),
    );
    addDepWithSkill("with-skill", "foo");
    mkdirSync(join(TEST_DIR, "node_modules", "plain"), { recursive: true });

    const synced = syncSkills(TEST_DIR);
    expect(synced).toEqual([{ name: "foo", from: "with-skill" }]);
    expect(existsSync(join(TEST_DIR, ".claude", "skills", "foo", "SKILL.md"))).toBe(true);
  });

  test("replaces a stale skill copy wholesale", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "with-skill": "1.0.0" } }),
    );
    addDepWithSkill("with-skill", "foo");
    const staleDir = join(TEST_DIR, ".claude", "skills", "foo");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "stale.md"), "old");

    syncSkills(TEST_DIR);
    expect(existsSync(join(staleDir, "stale.md"))).toBe(false);
    expect(existsSync(join(staleDir, "SKILL.md"))).toBe(true);
  });

  test("no package.json or no node_modules is a no-op", () => {
    expect(syncSkills(TEST_DIR)).toEqual([]);
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify({ name: "t" }));
    expect(syncSkills(TEST_DIR)).toEqual([]);
  });
});

describe("session payload", () => {
  test("memory block teaches the write-back verbs even when empty", () => {
    const block = buildMemoryBlock(TEST_DIR);
    expect(block).toContain("invt ctx:set");
    expect(block).toContain("invt ctx:decide");
    expect(block).toContain("no recorded memory yet");
  });

  test("memory block lists facts and newest-first decisions", () => {
    ctxSet(TEST_DIR, "db", "Postgres");
    ctxDecide(TEST_DIR, "auth", "JWT", "httpOnly");
    const block = buildMemoryBlock(TEST_DIR);
    expect(block).toContain("- db: Postgres");
    expect(block).toContain("auth: JWT — httpOnly");
  });

  test("memory block drops oldest decisions to stay in budget", () => {
    for (let i = 1; i <= 50; i++) {
      ctxDecide(TEST_DIR, `subject-${i}`, "x".repeat(80), "");
    }
    const block = buildMemoryBlock(TEST_DIR, 1500);
    expect(block.length).toBeLessThan(1700);
    expect(block).toContain("subject-50"); // newest survives
    expect(block).toContain("older decision(s)");
    expect(block).not.toContain("subject-1:"); // oldest dropped
  });

  test("payload includes the stack with installed versions and synced skills", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { dep: "1.0.0" } }),
    );
    const depDir = join(TEST_DIR, "node_modules", "dep");
    mkdirSync(join(depDir, ".claude", "skills", "dep-skill"), { recursive: true });
    writeFileSync(join(depDir, "package.json"), JSON.stringify({ name: "dep", version: "1.2.3" }));
    writeFileSync(
      join(depDir, ".claude", "skills", "dep-skill", "SKILL.md"),
      "# dep-skill\n",
    );
    ctxSet(TEST_DIR, "db", "Postgres");

    const payload = buildSessionPayload(TEST_DIR);
    expect(payload).toContain("Session context — demo");
    expect(payload).toContain("dep@1.2.3");
    expect(payload).toContain("dep-skill (dep)");
    expect(payload).toContain("- db: Postgres");
    expect(payload.length).toBeLessThanOrEqual(9100);
  });
});

describe("CLI integration (invoket/agent through invt)", () => {
  async function runCLI(...args: string[]) {
    const result = await $`bun ${CLI_PATH} ${args}`.cwd(TEST_DIR).quiet().nothrow();
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  beforeEach(() => {
    // Simulate a consumer install: node_modules/invoket -> this repo, so the
    // "invoket/agent" specifier resolves through the real exports map.
    mkdirSync(join(TEST_DIR, "node_modules"), { recursive: true });
    symlinkSync(REPO_ROOT, join(TEST_DIR, "node_modules", "invoket"));
    writeFileSync(
      join(TEST_DIR, "tasks.ts"),
      `import { Ctx, Session } from "invoket/agent";

export class Tasks {
  ctx = new Ctx();
  session = new Session();
}
`,
    );
  });

  test("typed metadata resolves through the package specifier", async () => {
    const help = await runCLI("ctx:set", "-h");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("key");
    expect(help.stdout).toContain("Store a key-value fact");
  });

  test("set / get / decide / dump round-trip", async () => {
    expect((await runCLI("ctx:set", "db", "Postgres", "16")).code).toBe(0);
    const got = await runCLI("ctx:get", "db");
    expect(got.code).toBe(0);
    expect(got.stdout).toContain("Postgres 16");

    expect(
      (await runCLI("ctx:decide", "backend", "JSON file", "smallest", "that", "fits")).code,
    ).toBe(0);
    const dump = await runCLI("ctx:dump");
    const parsed = JSON.parse(dump.stdout);
    expect(parsed.facts[0]).toMatchObject({ key: "db", value: "Postgres 16" });
    expect(parsed.decisions[0]).toMatchObject({ subject: "backend" });
  });

  test("get of a missing key exits nonzero", async () => {
    const got = await runCLI("ctx:get", "missing");
    expect(got.code).toBe(1);
    expect(got.stderr).toContain("Not found: missing");
  });

  test("session:start prints a payload with memory and instructions", async () => {
    await runCLI("ctx:set", "stack", "delta + railroad");
    const start = await runCLI("session:start");
    expect(start.code).toBe(0);
    expect(start.stdout).toContain("Session context");
    expect(start.stdout).toContain("- stack: delta + railroad");
    expect(start.stdout).toContain("invt ctx:decide");
  });
});

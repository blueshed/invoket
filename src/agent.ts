/**
 * invoket/agent — batteries for agent-assisted projects.
 *
 * Two namespace classes for a project's tasks.ts:
 *
 *   import { Ctx, Session } from "invoket/agent";
 *   export class Tasks {
 *     ctx = new Ctx();        // invt ctx:set / get / search / decide / decisions / dump / inject
 *     session = new Session(); // invt session:start / skills
 *   }
 *
 * Ctx is a SQLite-backed project knowledge base (the pattern from the README,
 * productionized). Facts and decisions live in `.ctx.db` (a rebuildable cache,
 * gitignore it) and `.ctx.jsonl` (the committed source of truth — diffable,
 * merge-friendly). Every mutation rewrites the JSONL; opening the database
 * replays the JSONL whenever its content hash differs from the one recorded
 * at the last sync, so a fresh clone or a pulled change is picked up
 * automatically.
 *
 * Session wires a project for agent sessions. `session:start` is built to be
 * a Claude Code SessionStart hook body: it syncs `.claude/skills/` from any
 * dependency that ships skills, rebuilds the context cache, and prints a
 * bounded context payload to stdout (a SessionStart hook's stdout becomes
 * model context; the harness caps it at 10k characters, so the payload
 * targets well under that).
 *
 * All paths resolve from `c.cwd`, which the CLI anchors to the directory
 * containing tasks.ts.
 */
import { Database } from "bun:sqlite";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { Context } from "./context";

/** Project knowledge base — facts and decisions agents query and append to */
export class Ctx {
  /** Store a key-value fact about the project */
  async set(c: Context, key: string, ...value: string[]) {
    ctxSet(c.cwd, key, value.join(" "));
    console.log(`Set: ${key}`);
  }

  /** Retrieve a fact by key */
  async get(c: Context, key: string) {
    const fact = ctxGet(c.cwd, key);
    if (!fact) {
      console.error(`Not found: ${key}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${fact.value}  (${fact.updated_at})`);
  }

  /** Search facts and decisions by keyword */
  async search(c: Context, ...terms: string[]) {
    const hits = ctxSearch(c.cwd, terms.join(" "));
    for (const h of hits) console.log(h);
    if (hits.length === 0) console.log("No matches.");
  }

  /** Record a decision with its rationale */
  async decide(c: Context, subject: string, decision: string, ...rationale: string[]) {
    const id = ctxDecide(c.cwd, subject, decision, rationale.join(" "));
    console.log(`Recorded decision #${id}: ${subject}`);
  }

  /** List active decisions, newest first */
  async decisions(c: Context) {
    const rows = ctxDecisions(c.cwd);
    for (const r of rows) {
      console.log(`#${r.id} ${r.subject}: ${r.decision}`);
      if (r.rationale) console.log(`   ${r.rationale}`);
    }
    if (rows.length === 0) console.log("No decisions recorded.");
  }

  /** Dump all facts and active decisions as JSON */
  async dump(c: Context) {
    console.log(JSON.stringify(ctxDump(c.cwd), null, 2));
  }

  /** Print the bounded context block used by session:start */
  async inject(c: Context, budget: number = 6000) {
    console.log(buildMemoryBlock(c.cwd, budget));
  }
}

/** Session bring-up for agent-assisted projects */
export class Session {
  /** Sync skills, rebuild context, print the session payload (SessionStart hook body) */
  async start(c: Context) {
    console.log(buildSessionPayload(c.cwd));
  }

  /** Sync .claude/skills/ from dependencies that ship skills */
  async skills(c: Context) {
    const synced = syncSkills(c.cwd);
    if (synced.length === 0) {
      console.log("No dependency skills found (is node_modules installed?)");
      return;
    }
    for (const s of synced) console.log(`Synced ${s.name} (from ${s.from})`);
  }
}

// ---------------------------------------------------------------------------
// Storage: SQLite cache (.ctx.db) + committed JSONL source of truth (.ctx.jsonl)
// ---------------------------------------------------------------------------

export interface Fact {
  key: string;
  value: string;
  updated_at: string;
}

export interface Decision {
  id: number;
  subject: string;
  decision: string;
  rationale: string;
  status: string;
  created_at: string;
}

const DB_FILE = ".ctx.db";
const JSONL_FILE = ".ctx.jsonl";

function openDb(dir: string): Database {
  const db = new Database(join(dir, DB_FILE), { create: true });
  db.run(`CREATE TABLE IF NOT EXISTS context (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    subject TEXT NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS ctx_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  replayJsonlIfChanged(dir, db);
  return db;
}

// The JSONL is the source of truth: replay it into the cache whenever its
// content differs from what the cache last saw (fresh clone, pulled change,
// hand edit). Hash comparison, not mtime — mtimes lie across clones.
function replayJsonlIfChanged(dir: string, db: Database): void {
  const jsonlPath = join(dir, JSONL_FILE);
  if (!existsSync(jsonlPath)) return;
  const text = readFileSync(jsonlPath, "utf8");
  const hash = String(Bun.hash(text));
  const seen = db
    .query("SELECT value FROM ctx_meta WHERE key = 'jsonl_hash'")
    .get() as { value: string } | null;
  if (seen?.value === hash) return;

  db.run("DELETE FROM context");
  db.run("DELETE FROM decisions");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a corrupt line shouldn't take the whole store down
    }
    if (rec.t === "fact" && rec.key) {
      db.run(
        "INSERT OR REPLACE INTO context (key, value, updated_at) VALUES (?, ?, ?)",
        [rec.key, rec.value ?? "", rec.updated_at ?? new Date().toISOString()],
      );
    } else if (rec.t === "decision" && rec.subject) {
      db.run(
        "INSERT INTO decisions (id, subject, decision, rationale, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
          rec.id ?? null,
          rec.subject,
          rec.decision ?? "",
          rec.rationale ?? "",
          rec.status ?? "active",
          rec.created_at ?? new Date().toISOString(),
        ],
      );
    }
  }
  db.run(
    "INSERT OR REPLACE INTO ctx_meta (key, value) VALUES ('jsonl_hash', ?)",
    [hash],
  );
}

// Mutations rewrite the whole JSONL — it stays small, ordering stays
// deterministic (facts by key, then decisions by id), diffs stay readable.
function saveJsonl(dir: string, db: Database): void {
  const facts = db
    .query("SELECT key, value, updated_at FROM context ORDER BY key")
    .all() as Fact[];
  const decisions = db
    .query(
      "SELECT id, subject, decision, rationale, status, created_at FROM decisions ORDER BY id",
    )
    .all() as Decision[];
  const lines: string[] = [];
  for (const f of facts) lines.push(JSON.stringify({ t: "fact", ...f }));
  for (const d of decisions) lines.push(JSON.stringify({ t: "decision", ...d }));
  const text = lines.join("\n") + (lines.length ? "\n" : "");
  writeFileSync(join(dir, JSONL_FILE), text);
  db.run(
    "INSERT OR REPLACE INTO ctx_meta (key, value) VALUES ('jsonl_hash', ?)",
    [String(Bun.hash(text))],
  );
}

export function ctxSet(dir: string, key: string, value: string): void {
  const db = openDb(dir);
  db.run(
    "INSERT OR REPLACE INTO context (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    [key, value],
  );
  saveJsonl(dir, db);
  db.close();
}

export function ctxGet(dir: string, key: string): Fact | null {
  const db = openDb(dir);
  const row = db
    .query("SELECT key, value, updated_at FROM context WHERE key = ?")
    .get(key) as Fact | null;
  db.close();
  return row;
}

export function ctxSearch(dir: string, term: string): string[] {
  const db = openDb(dir);
  const pattern = `%${term}%`;
  const facts = db
    .query("SELECT key, value FROM context WHERE key LIKE ? OR value LIKE ? ORDER BY key")
    .all(pattern, pattern) as Fact[];
  const decisions = db
    .query(
      "SELECT id, subject, decision, rationale FROM decisions WHERE status = 'active' AND (subject LIKE ? OR decision LIKE ? OR rationale LIKE ?) ORDER BY id",
    )
    .all(pattern, pattern, pattern) as Decision[];
  db.close();
  return [
    ...facts.map((f) => `${f.key}: ${f.value}`),
    ...decisions.map((d) => `#${d.id} ${d.subject}: ${d.decision}`),
  ];
}

export function ctxDecide(
  dir: string,
  subject: string,
  decision: string,
  rationale: string,
): number {
  const db = openDb(dir);
  db.run(
    "INSERT INTO decisions (subject, decision, rationale) VALUES (?, ?, ?)",
    [subject, decision, rationale],
  );
  const id = (
    db.query("SELECT last_insert_rowid() AS id").get() as { id: number }
  ).id;
  saveJsonl(dir, db);
  db.close();
  return id;
}

export function ctxDecisions(dir: string): Decision[] {
  const db = openDb(dir);
  const rows = db
    .query(
      "SELECT id, subject, decision, rationale, status, created_at FROM decisions WHERE status = 'active' ORDER BY id DESC",
    )
    .all() as Decision[];
  db.close();
  return rows;
}

export function ctxDump(dir: string): { facts: Fact[]; decisions: Decision[] } {
  const db = openDb(dir);
  const facts = db
    .query("SELECT key, value, updated_at FROM context ORDER BY key")
    .all() as Fact[];
  const decisions = db
    .query(
      "SELECT id, subject, decision, rationale, status, created_at FROM decisions WHERE status = 'active' ORDER BY id DESC",
    )
    .all() as Decision[];
  db.close();
  return { facts, decisions };
}

// ---------------------------------------------------------------------------
// Skills sync — copy .claude/skills/* from any dependency that ships them
// ---------------------------------------------------------------------------

export interface SyncedSkill {
  name: string;
  from: string;
}

export function syncSkills(dir: string): SyncedSkill[] {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return [];
  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return [];
  }
  const deps = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  });
  const synced: SyncedSkill[] = [];
  for (const dep of deps) {
    const skillsDir = join(dir, "node_modules", dep, ".claude", "skills");
    if (!existsSync(skillsDir)) continue;
    for (const name of readdirSync(skillsDir)) {
      const src = join(skillsDir, name);
      const dest = join(dir, ".claude", "skills", name);
      mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      synced.push({ name, from: dep });
    }
  }
  return synced;
}

// ---------------------------------------------------------------------------
// Session payload — what a SessionStart hook prints into model context
// ---------------------------------------------------------------------------

const PAYLOAD_BUDGET = 9000; // the harness caps hook stdout at 10k chars
const FACT_VALUE_CAP = 300;

export function buildMemoryBlock(dir: string, budget: number = 6000): string {
  const { facts, decisions } = ctxDump(dir);
  const lines: string[] = ["## Project memory"];
  lines.push(
    "Record what you learn as you work: `invt ctx:set <key> <value...>` for facts,",
    "`invt ctx:decide <subject> <decision> <rationale...>` for decisions.",
    "Query with `invt ctx:get|search|decisions|dump`.",
    "",
  );
  if (facts.length === 0 && decisions.length === 0) {
    lines.push("(empty — this project has no recorded memory yet)");
    return lines.join("\n");
  }
  if (facts.length > 0) {
    lines.push("### Facts");
    for (const f of facts) {
      const v =
        f.value.length > FACT_VALUE_CAP
          ? f.value.slice(0, FACT_VALUE_CAP) + "…"
          : f.value;
      lines.push(`- ${f.key}: ${v}`);
    }
    lines.push("");
  }
  if (decisions.length > 0) {
    lines.push("### Decisions (newest first)");
    let used = lines.join("\n").length;
    let dropped = 0;
    for (const d of decisions) {
      const line = `- #${d.id} ${d.subject}: ${d.decision}${d.rationale ? ` — ${d.rationale}` : ""} (${d.created_at})`;
      if (used + line.length > budget) {
        dropped = decisions.length - decisions.indexOf(d);
        break;
      }
      lines.push(line);
      used += line.length + 1;
    }
    if (dropped > 0) {
      lines.push(`…and ${dropped} older decision(s) — \`invt ctx:decisions\` for all.`);
    }
  }
  return lines.join("\n");
}

export function buildSessionPayload(dir: string): string {
  const lines: string[] = ["# Session context (generated by `invt session:start`)", ""];

  // Stack: the project's dependencies with installed versions
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const stack: string[] = [];
      for (const dep of deps) {
        const depPkgPath = join(dir, "node_modules", dep, "package.json");
        if (!existsSync(depPkgPath)) continue;
        try {
          const depPkg = JSON.parse(readFileSync(depPkgPath, "utf8"));
          stack.push(`${dep}@${depPkg.version}`);
        } catch {
          stack.push(dep);
        }
      }
      if (pkg.name) lines[0] = `# Session context — ${pkg.name} (generated by \`invt session:start\`)`;
      if (stack.length > 0) lines.push(`Stack: ${stack.join(", ")}`, "");
    } catch {
      // unreadable package.json — payload still useful without the stack line
    }
  }

  const synced = syncSkills(dir);
  if (synced.length > 0) {
    const names = synced.map((s) => `${s.name} (${s.from})`).join(", ");
    lines.push(
      `Skills synced into .claude/skills: ${names}.`,
      "Read the matching skill before writing code against that package — it overrides trained habits.",
      "",
    );
  }

  lines.push(buildMemoryBlock(dir));
  let payload = lines.join("\n");
  if (payload.length > PAYLOAD_BUDGET) {
    payload =
      payload.slice(0, PAYLOAD_BUDGET) +
      "\n…(truncated — `invt ctx:dump` for the full store)";
  }
  return payload;
}

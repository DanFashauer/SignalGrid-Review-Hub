// Lessons ledger gate (DR-060 rule 2) — every incident a cycle hits is a row in
// docs/agent/LESSONS.md, and every row says where the lesson LANDED.
//
//   node scripts/check-lessons.mjs              # gate the ledger
//   node scripts/check-lessons.mjs --self-test  # prove each failing shape fails
//
// FATAL: a row missing a field; an unknown status; a duplicate id; a date that is not
// YYYY-MM-DD or lies in the future; status "landed" with a landing that is empty or
// starts "pending"; a landing that names a repo path git does not track; fewer rows
// than the floor (a walk that finds nothing is not a clean ledger).
// REPORTED, not fatal (day one): rows still "pending" more than 14 days after their
// date, with a count. A lesson with nowhere to land yet is honest; one that sits
// unlanded for weeks is the thing the report exists to show.
//
// Row shape (one block per lesson):
//   ### L7 — short title
//   - **date:** 2026-09-26
//   - **lane:** cloud | mac | both
//   - **incident:** what happened
//   - **evidence:** quoted output or a path
//   - **landing:** where it landed — a path, PR, backlog row, or "recorded only — <reason>"
//   - **status:** landed | pending
//
// The verdict is a pure function of (text, tracked paths, now); only the CLI entry
// reads the clock, the file and git.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "docs/agent/LESSONS.md";
export const FIELDS = ["date", "lane", "incident", "evidence", "landing", "status"];
export const ROW_FLOOR = 6; // L1–L6 landed with the ledger; it is append-only.
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
// A repo-relative file path: at least one slash, ends in an extension, not the tail of a URL.
const PATH_RE = /(?<![\w/.:-])((?:\.?[\w@-]+\/)+[\w@.-]*\w\.[a-z]{1,5})(?![\w/])/gi;

export function parseLessons(text) {
  return text.split(/\n### (?=L\d+\b)/).slice(1).map((chunk) => {
    const id = chunk.match(/^L\d+/)[0];
    const fields = {};
    for (const m of chunk.matchAll(/^- \*\*(\w+):\*\*[ \t]*(.*)$/gm)) fields[m[1]] = m[2].trim();
    return { id, fields };
  });
}

/** Pure verdict: { rows, fatal: string[], stale: string[] }. */
export function verdict(text, tracked, nowMs, floor = ROW_FLOOR) {
  const rows = parseLessons(text);
  const fatal = [];
  const stale = [];
  if (rows.length < floor) fatal.push(`only ${rows.length} lesson row(s) parsed (floor ${floor}) — the walk is wrong or rows were deleted`);
  const seen = new Set();
  for (const { id, fields } of rows) {
    if (seen.has(id)) fatal.push(`${id}: duplicate id`);
    seen.add(id);
    const missing = FIELDS.filter((f) => !fields[f]);
    if (missing.length) { fatal.push(`${id}: missing field(s) ${missing.join(", ")}`); continue; }
    const { date, landing, status } = fields;
    const dayMs = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(dayMs)) fatal.push(`${id}: date "${date}" is not YYYY-MM-DD`);
    else if (dayMs > nowMs) fatal.push(`${id}: date ${date} is in the future`);
    if (status !== "landed" && status !== "pending") fatal.push(`${id}: status "${status}" is not landed | pending`);
    if (status === "landed" && /^pending\b/i.test(landing)) fatal.push(`${id}: status landed but landing is "${landing.slice(0, 40)}"`);
    for (const [, p] of landing.matchAll(PATH_RE)) {
      if (!tracked.has(p)) fatal.push(`${id}: landing names ${p}, which git does not track`);
    }
    if (status === "pending" && Number.isFinite(dayMs) && nowMs - dayMs > STALE_DAYS * DAY_MS) stale.push(`${id} (${date})`);
  }
  return { rows, fatal, stale };
}

function selfTest() {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const tracked = new Set(["scripts/preflight.mjs", "docs/BUILD_BACKLOG.md"]);
  const row = (id, o = {}) => {
    const f = { date: "2026-09-26", lane: "cloud", incident: "x broke", evidence: "`log: EADDRINUSE`", landing: "`scripts/preflight.mjs` first step", status: "landed", ...o };
    return `\n### ${id} — t\n` + FIELDS.filter((k) => f[k] !== undefined).map((k) => `- **${k}:** ${f[k]}`).join("\n") + "\n";
  };
  const doc = (...rows) => `# Lessons\n${rows.join("")}`;
  const fails = (name, text, want) => {
    const v = verdict(text, tracked, now, 1);
    return [name, v.fatal.some((m) => m.includes(want))];
  };
  const clean = verdict(doc(row("L1"), row("L2", { landing: "pending — `docs/BUILD_BACKLOG.md` row", status: "pending" })), tracked, now, 1);
  const stale = verdict(doc(row("L1", { date: "2026-09-01", landing: "pending — Mac lane", status: "pending" })), tracked, now, 1);
  const checks = [
    ["a clean two-row ledger passes, and the pass is not vacuous (2 rows parsed)", clean.fatal.length === 0 && clean.rows.length === 2],
    fails("a row missing its evidence FAILS", doc(row("L1", { evidence: undefined })), "missing field(s) evidence"),
    fails("a row with an empty landing FAILS", doc(row("L1", { landing: "" })), "missing field(s) landing"),
    fails("a landing naming an untracked path FAILS", doc(row("L1", { landing: "`scripts/check-nothing.mjs`" })), "git does not track"),
    fails("status landed with a pending landing FAILS", doc(row("L1", { landing: "pending — later" })), "status landed but landing"),
    fails("a future date FAILS", doc(row("L1", { date: "2026-09-27" })), "in the future"),
    fails("a malformed date FAILS", doc(row("L1", { date: "26 Sept" })), "not YYYY-MM-DD"),
    fails("an unknown status FAILS", doc(row("L1", { status: "done" })), "not landed | pending"),
    fails("a duplicate id FAILS", doc(row("L1"), row("L1")), "duplicate id"),
    ["an empty ledger FAILS on the floor", verdict("# Lessons\n", tracked, now, 1).fatal.some((m) => m.includes("floor"))],
    ["a URL tail is not read as a repo path", verdict(doc(row("L1", { landing: "`scripts/preflight.mjs`, https://claude.ai/code/x.json" })), tracked, now, 1).fatal.length === 0],
    ["a pending row older than 14 days is REPORTED, not fatal", stale.fatal.length === 0 && stale.stale.length === 1],
    ["a pending row inside 14 days is not reported", clean.stale.length === 0],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (bad.length) { console.error(`check-lessons self-test: ${bad.length} FAILED`); process.exit(1); }
  console.log(`check-lessons self-test: ${checks.length}/${checks.length}`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const text = readFileSync(resolve(repo, FILE), "utf8");
  const tracked = new Set(execSync("git ls-files", { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean));
  if (tracked.size === 0) { console.error("check-lessons FAIL — git ls-files returned nothing; cannot verify landings"); process.exit(1); }
  const v = verdict(text, tracked, Date.now()); // the one clock read — the CLI entry
  if (v.stale.length) console.log(`check-lessons REPORT — ${v.stale.length} lesson(s) pending more than ${STALE_DAYS} days: ${v.stale.join(", ")}`);
  if (v.fatal.length) {
    console.error(`check-lessons FAIL — ${v.fatal.length} problem(s) in ${FILE}:`);
    for (const m of v.fatal) console.error(`  ${m}`);
    process.exit(1);
  }
  const pending = v.rows.filter((r) => r.fields.status === "pending").length;
  console.log(`check-lessons: ok — ${v.rows.length} lesson(s), ${v.rows.length - pending} landed, ${pending} pending, ${v.stale.length} pending past ${STALE_DAYS} days (DR-060)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

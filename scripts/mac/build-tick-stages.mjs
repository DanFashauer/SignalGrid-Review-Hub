#!/usr/bin/env node
// build-tick-stages.mjs — the staged pipeline behind scripts/mac/build-tick.sh (DR-061 rule 4;
// the tier map follows the DR-060 stage table in .claude/skills/orchestrator-over-workers/SKILL.md).
//
//   node scripts/mac/build-tick-stages.mjs triage   <flags>   # RUN_DIR/triage.json + RUN_DIR/next
//   node scripts/mac/build-tick-stages.mjs run      <flags> --path marker|build --kind K
//                                                             # RUN_DIR/outcome.json
//   node scripts/mac/build-tick-stages.mjs commands <flags>   # dry-run: one line per stage, spawns nothing
//   node scripts/mac/build-tick-stages.mjs write-stub <dir>   # the test stub `claude`
//   node scripts/mac/build-tick-stages.mjs --self-test
//   flags: --row --title --branch --run-dir --cache --today --stamp   (the worktree is the cwd)
//
// WHY. build-tick.sh used to start ONE `claude -p --model opus` session per row. This file is the
// single home of what replaced it: triage (read-only) -> build (tier by kind) -> review (opus,
// read-only) -> at most one fix on the build tier -> a second review. Tiers and caps live in STAGES
// and nowhere else; the scrubbed session environment, tool sets, verdict parsers, marker writer,
// cost ledger and cost table live here too, so the shell stays the thin outward half.
//
// TRIAGE IS SONNET, NOT HAIKU. Triage is a "read that feeds a decision" in the DR-060 table and it
// can retire a row on cited evidence; lesson L16 records Haiku fabricating attributions. Haiku runs
// only `mechanical` builds, which the triage brief defines narrowly.
//
// FAIL CLOSED. A session that is itself broken (logged out, usage limit, no Keychain) is a PAUSE,
// never a burned row. An unparseable triage becomes a judgment (opus) build. An unparseable or
// capped review is a reject (DR-047: an Opus failure is never downgraded). A marker is written only
// by applyMarker, which asserts it changed exactly one line and the plan still parses.
//
// This process makes LOCAL commits only; it never pushes and never calls gh. The claude child gets a
// scrubbed environment (no ssh agent, no tokens, no git config, an empty gh config).

import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marks, parseRows, statusText } from "../check-backlog-ownership.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

export const KINDS = ["mechanical", "code", "judgment"];
// THE stage table: the only place tiers and caps live. seconds is a wall-clock cap (a timeout is
// recorded as exit 142, the meaning today's perl alarm had), turns is --max-turns, budget is
// --max-budget-usd. A fix runs on its build tier at half the seconds, turns and budget.
// UNVERIFIED: whether --max-budget-usd binds on subscription auth, and whether --fallback-model
// fires on a usage limit. Both are cost hints; neither is cited as a safety property. The wall-clock
// cap, the turn cap and the pause rule are what actually bound a run.
export const STAGES = {
  triage: { model: "sonnet", seconds: 900, turns: 30, budget: 2 },
  "build.mechanical": { model: "haiku", seconds: 1800, turns: 60, budget: 2 },
  "build.code": { model: "sonnet", seconds: 7200, turns: 200, budget: 20 },
  "build.judgment": { model: "opus", seconds: 7200, turns: 200, budget: 40 },
  review: { model: "opus", seconds: 1800, turns: 40, budget: 10 },
};
export const BRIEFS = { triage: "build-tick-triage.md", build: "build-tick-brief.md", review: "build-tick-review.md", fix: "build-tick-fix.md" };

/** A stop that raises a hand (DR-054). Anything else thrown is a bug, and is also reported as a hand. */
export class Hand extends Error {}

/** tier + caps for a stage. An unknown kind resolves to judgment (opus): unknown tightens, never loosens. */
export function stageSpec(stage, kind) {
  if (stage === "triage" || stage === "review") return { ...STAGES[stage] };
  const b = STAGES[`build.${KINDS.includes(kind) ? kind : "judgment"}`];
  if (stage === "build") return { ...b };
  if (stage === "fix") return { model: b.model, seconds: b.seconds / 2, turns: b.turns / 2, budget: b.budget / 2 };
  throw new Error(`unknown stage ${stage}`);
}

/** The longest a run's model stages can take: build-tick.sh's STAGES_SECONDS must cover it (S10). */
export function worstCaseStagesSeconds() {
  const buildAndFix = Math.max(...KINDS.map((k) => stageSpec("build", k).seconds + stageSpec("fix", k).seconds));
  return STAGES.triage.seconds + buildAndFix + 2 * STAGES.review.seconds;
}

// ── schemas, tool sets, argv ─────────────────────────────────────────────────
const str = { type: "string" };
export const SCHEMAS = {
  triage: {
    type: "object", additionalProperties: false, required: ["status", "kind", "marker", "evidence", "reason"],
    properties: { status: { type: "string", enum: ["done", "blocked", "build"] }, kind: { type: "string", enum: KINDS }, marker: str, evidence: str, reason: str },
  },
  review: {
    type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"],
    properties: {
      verdict: { type: "string", enum: ["ship", "fix", "reject"] }, summary: str,
      findings: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["severity", "file", "note"],
          properties: { severity: { type: "string", enum: ["critical", "major", "minor"] }, file: str, note: str } },
      },
    },
  },
};

/** Why `v` breaks `schema` (the subset used above), or null. claude validates too; this is the second lock. */
function violation(schema, v, at = "$") {
  if (schema.enum && !schema.enum.includes(v)) return `${at} is not one of ${schema.enum.join("|")}`;
  if (schema.type === "string") return typeof v === "string" ? null : `${at} is not a string`;
  if (schema.type === "array") {
    if (!Array.isArray(v)) return `${at} is not an array`;
    for (const [i, x] of v.entries()) { const bad = violation(schema.items, x, `${at}[${i}]`); if (bad) return bad; }
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return `${at} is not an object`;
  for (const k of schema.required) if (!(k in v)) return `${at}.${k} is missing`;
  for (const k of Object.keys(v)) if (!(k in schema.properties)) return `${at}.${k} is not allowed`;
  for (const [k, sub] of Object.entries(schema.properties)) { const bad = violation(sub, v[k], `${at}.${k}`); if (bad) return bad; }
  return null;
}

// The build and fix stages' reach, verbatim from build-tick.sh before the split. Allow rules are not
// the boundary under the user's sandbox auto-allow; deny rules still bind, and the scrubbed
// environment is what makes a push or a gh call fail even if a command slips through.
const BUILD_ALLOW = ["Read", "Edit", "Write", "Grep", "Glob", "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git show*)",
  "Bash(pnpm *)", "Bash(node *)", "Bash(xcodebuild *)", "Bash(swift *)"];
const BUILD_DENY = ["Bash(git push*)", "Bash(git commit*)", "Bash(git -C *)", "Bash(git remote*)", "Bash(git config*)",
  "Bash(gh *)", "Bash(ssh*)", "Bash(curl*)", "Bash(wget*)", "Bash(node scripts/lane-deliver*)", "Bash(node scripts/mac/gh-pr*)",
  "Bash(pnpm run lane:*)", "Bash(pnpm run hand:*)"];

/**
 * The claude argv for a stage. The brief stays right after -p: it is a positional, and --tools,
 * --add-dir, --allowedTools and --disallowedTools are variadic and would swallow anything after them.
 * triage and review are read-only by tool ABSENCE (no Bash, Edit or Write exists), not by permission.
 */
export function claudeArgv(stage, kind, brief, runDir) {
  const s = stageSpec(stage, kind);
  const argv = ["-p", brief, "--model", s.model, "--max-turns", String(s.turns), "--max-budget-usd", String(s.budget), "--output-format", "json"];
  if (s.model !== "opus") argv.push("--fallback-model", "opus"); // DR-047: an unavailable tier resolves UP
  if (stage === "triage" || stage === "review") {
    argv.push("--tools", "Read,Grep,Glob", "--permission-prompts", "none", "--strict-mcp-config");
    if (stage === "review") argv.push("--add-dir", runDir);
    argv.push("--json-schema", JSON.stringify(SCHEMAS[stage]));
  } else {
    argv.push("--permission-mode", "acceptEdits", "--permission-prompts", "none", "--strict-mcp-config", "--add-dir", runDir,
      "--allowedTools", ...BUILD_ALLOW, "--disallowedTools", ...BUILD_DENY);
  }
  return argv;
}

/** The claude CHILD's environment, never this process's: no ssh agent or token, no git config, an empty gh config. */
export function scrubbedEnv(cache, base = process.env) {
  const env = { ...base };
  for (const k of ["SSH_AUTH_SOCK", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"]) delete env[k];
  const gh = join(cache, "empty-gh-config");
  mkdirSync(gh, { recursive: true });
  return { ...env, GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GH_CONFIG_DIR: gh };
}

/** Fill a brief. One pass, so a value is never rescanned; a `{{` inside a value is broken up so text cannot forge a placeholder. */
export function render(file, vals) {
  const text = readFileSync(join(HERE, file), "utf8");
  const safe = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, String(v).split("{{").join("{ {")]));
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (Object.hasOwn(safe, k) ? safe[k] : m));
  if (out.includes("{{")) throw new Hand(`${file} still holds an unfilled {{placeholder}} after rendering — refusing the stage`);
  return out;
}

const shq = (a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

// ── verdict parsers (pure) ───────────────────────────────────────────────────
/** Rule (a): the session ITSELF is broken (logged out, usage limit, Keychain), as opposed to the work failing. */
const sessionBroken = (env, exit) => (env ? env.api_error_status != null : exit !== 0 && exit !== 142);
// UNVERIFIED: that a logged-out CLI sets api_error_status. If it does not, a build that did nothing
// lands as a hand (the claim stays, a person looks) rather than a pause.

const doneProblem = (v, today) => (!new RegExp(`^DONE \\(re-measured ${today.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`).test(v.marker)
  ? `the marker ${JSON.stringify(v.marker)} is not shaped DONE (re-measured ${today})`
  : !v.evidence.trim() ? "a done verdict with no evidence" : null);

/** -> {act: "pause"|"hand", reason} | {act: "ok", value}. Rules (a)-(d), in that order. */
export function parseTriage(env, exit, today) {
  if (sessionBroken(env, exit)) return { act: "pause", reason: `the triage session is broken (exit ${exit}, api_error_status ${env?.api_error_status ?? "none"}, no usable envelope)` };
  if (exit === 142) return { act: "hand", reason: "triage hit its wall-clock cap" };
  const bad = violation(SCHEMAS.triage, env?.structured_output);
  if (bad) return { act: "ok", value: { status: "build", kind: "judgment", marker: "", evidence: "", reason: `unparseable triage: ${bad}` } };
  const v = env.structured_output;
  const problem = v.status === "done" ? doneProblem(v, today) : null;
  return problem ? { act: "hand", reason: `triage said done but ${problem}` } : { act: "ok", value: v };
}

/** -> {act: "pause", reason} | {act: "review", verdict, summary, findings}. Capped or unparseable is a reject. */
export function parseReview(env, exit, capped) {
  if (sessionBroken(env, exit)) return { act: "pause", reason: `the review session is broken (exit ${exit}, api_error_status ${env?.api_error_status ?? "none"})` };
  const bad = capped ? "the review hit its time, turn or budget cap" : violation(SCHEMAS.review, env?.structured_output);
  if (bad) return { act: "review", verdict: "reject", summary: `unparseable or capped review: ${bad}`, findings: [] };
  const r = env.structured_output;
  const blocking = r.findings.some((f) => f.severity !== "minor");
  return { act: "review", verdict: r.verdict === "ship" && blocking ? "fix" : r.verdict, summary: r.summary, findings: r.findings };
}

// ── the marker writer ────────────────────────────────────────────────────────
/**
 * Append ` <marker>: <evidence>` to plan row `rowId`'s heading line and PROVE the edit: exactly one
 * line changed, the plan parses to the same rows, and the row now reads DONE the way the ownership
 * gate reads it. Anything else is a Hand. A row that already reads DONE is a Hand too ("already
 * marked"): appending a second marker would change the text without retiring anything.
 */
export function applyMarker(planText, rowId, marker, evidence) {
  const rows = parseRows(planText);
  const row = rows.find((r) => r.id === rowId);
  if (!row) throw new Hand(`plan row ${rowId} is not in the Global backlog`);
  if (marks(statusText(row.text), "DONE")) throw new Hand(`plan row ${rowId} already reads DONE — already marked, nothing to write`);
  const ev = oneLine(evidence).slice(0, 600);
  if (!ev) throw new Hand(`no evidence for the plan row ${rowId} marker`);
  const head = row.text.split("\n")[0];
  const lines = planText.split("\n");
  const at = lines.indexOf(head);
  if (at < 0 || lines.indexOf(head, at + 1) >= 0) throw new Hand(`plan row ${rowId}'s heading line is not unique in the plan`);
  const next = lines.slice();
  next[at] = `${head} ${oneLine(marker)}: ${ev}`;
  const out = next.join("\n");
  const after = parseRows(out);
  const newRow = after.find((r) => r.id === rowId);
  const changed = out.split("\n").filter((l, i) => l !== lines[i]).length;
  if (out === planText || out.split("\n").length !== lines.length || changed !== 1) throw new Hand(`the marker edit for row ${rowId} did not change exactly one line`);
  if (after.length !== rows.length || JSON.stringify(after.unparsed) !== JSON.stringify(rows.unparsed)) throw new Hand(`the marker edit for row ${rowId} changed how the plan parses`);
  if (!newRow || !marks(statusText(newRow.text), "DONE")) throw new Hand(`row ${rowId} does not read DONE after the marker edit (a stray quote or negation before it?)`);
  return out;
}

// ── the cost table: the owner's quick check, in every PR ─────────────────────
export function costTable(ledgerLines) {
  const rows = ledgerLines.map((l) => (typeof l === "string" ? JSON.parse(l) : l));
  const seen = {};
  const body = rows.map((r) => {
    const n = (seen[r.stage] = (seen[r.stage] ?? 0) + 1);
    const label = rows.filter((x) => x.stage === r.stage).length > 1 ? `${r.stage} #${n}` : r.stage;
    return `| ${label} | ${r.tierAsked} | ${r.models?.length ? r.models.join(" + ") : "unknown"} | ${r.numTurns ?? "unknown"} | ${r.durationMs == null ? "unknown" : Math.round(r.durationMs / 1000)} | ${r.costUsd == null ? "unknown" : r.costUsd.toFixed(4)} |`;
  });
  const sum = (k) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  const unknown = rows.filter((r) => r.costUsd == null).length;
  return ["## Tiers and cost", "", "| Stage | Tier asked | Model that ran | Turns | Seconds | Cost (USD) |", "| --- | --- | --- | --- | --- | --- |", ...body,
    `| **Total** | | | ${sum("numTurns")} | ${Math.round(sum("durationMs") / 1000)} | ${sum("costUsd").toFixed(4)}${unknown ? ` (+${unknown} stage(s) unknown)` : ""} |`].join("\n");
}

// ── running a stage ──────────────────────────────────────────────────────────
function readEnvelope(file) {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    const e = Array.isArray(j) ? j.findLast((x) => x && x.type === "result") : j;
    return e && typeof e === "object" ? e : null;
  } catch { return null; }
}
const num = (x) => (Number.isFinite(x) ? x : null);

function git(ctx, args) {
  const r = spawnSync("git", args, { cwd: ctx.cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Hand(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim().slice(0, 300)}`);
  return r.stdout;
}

/** Spawn claude for one stage, ledger it (cache + run dir), return what the parsers need. */
function runStage(ctx, stage, kind, label, vals = {}) {
  const spec = stageSpec(stage, kind);
  const brief = render(BRIEFS[stage], { ROW_ID: ctx.row, ROW_TITLE: ctx.title, BRANCH: ctx.branch, RUN_DIR: ctx.runDir, TODAY: ctx.today, ...vals });
  mkdirSync(ctx.runDir, { recursive: true });
  mkdirSync(ctx.cache, { recursive: true });
  const outFile = join(ctx.runDir, `${label}.out.json`);
  const fo = openSync(outFile, "w"), fe = openSync(join(ctx.runDir, `${label}.err`), "w");
  console.log(`stage ${label}: ${spec.model}, up to ${spec.turns} turns, ${spec.seconds}s cap`);
  const r = spawnSync("claude", claudeArgv(stage, kind, brief, ctx.runDir),
    { cwd: ctx.cwd, env: scrubbedEnv(ctx.cache), timeout: spec.seconds * 1000, killSignal: "SIGTERM", stdio: ["ignore", fo, fe] });
  closeSync(fo);
  closeSync(fe);
  const exit = r.error?.code === "ETIMEDOUT" ? 142 : (r.status ?? 1);
  const env = readEnvelope(outFile);
  const capped = exit === 142 || /^error_max/.test(env?.subtype ?? "");
  const line = JSON.stringify({
    stamp: ctx.stamp, row: ctx.row, branch: ctx.branch, stage, tierAsked: spec.model,
    models: env?.modelUsage && typeof env.modelUsage === "object" ? Object.keys(env.modelUsage) : [],
    numTurns: num(env?.num_turns), durationMs: num(env?.duration_ms), costUsd: num(env?.total_cost_usd),
    isError: env ? env.is_error === true : null, subtype: env?.subtype ?? null, apiErrorStatus: env?.api_error_status ?? null, exit, capped,
  }) + "\n";
  appendFileSync(join(ctx.cache, "ledger.jsonl"), line);
  appendFileSync(join(ctx.runDir, "ledger.jsonl"), line);
  console.log(`stage ${label}: exit ${exit}${env ? `, ${env.num_turns ?? "?"} turns, $${env.total_cost_usd ?? "?"}` : ", no result envelope"}${capped ? ", CAPPED" : ""}`);
  return { env, exit, capped, broken: sessionBroken(env, exit) };
}

// ── triage ───────────────────────────────────────────────────────────────────
export function triageCmd(ctx) {
  rmSync(join(ctx.runDir, "next"), { force: true });
  const r = runStage(ctx, "triage", null, "triage");
  const p = parseTriage(r.env, r.exit, ctx.today);
  let next;
  let record;
  if (p.act === "ok") {
    record = p.value;
    // ponytail: until #1216 (the objective loop parking AWAITING/BLOCKED rows) is on mainline a
    // blocked row would be re-picked forever, so it raises a hand instead of writing the marker.
    // When #1216 lands, send `blocked` down the marker path like `done`.
    next = p.value.status === "done" ? "marker"
      : p.value.status === "build" ? `build ${p.value.kind}`
        : `hand row ${ctx.row} is blocked: ${oneLine(p.value.marker)} — ${oneLine(p.value.reason)} (the objective loop parks AWAITING/BLOCKED rows only once #1216 lands; until then a hand, not a marker)`;
  } else {
    record = { act: p.act, reason: p.reason };
    next = `${p.act} ${oneLine(p.reason)}`;
  }
  writeFileSync(join(ctx.runDir, "triage.json"), `${JSON.stringify(record, null, 1)}\n`);
  writeFileSync(join(ctx.runDir, "next"), `${next}\n`);
  console.log(`triage: next = ${next}`);
}

// ── the post-claim pipeline ──────────────────────────────────────────────────
const dirty = (ctx) => git(ctx, ["status", "--porcelain"]).trim() !== "";

/** `git add -A && git commit -F`, with the two trailers the shell used to append. Returns the sha. */
function commit(ctx, msgFile) {
  const final = `${msgFile}.final`;
  writeFileSync(final, `${readFileSync(msgFile, "utf8").trimEnd()}\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nBuild-Tick: ${ctx.stamp}\n`);
  git(ctx, ["add", "-A"]);
  git(ctx, ["commit", "-q", "-F", final]);
  return git(ctx, ["rev-parse", "HEAD"]).trim();
}

/** The reviewer reads this file. THREE dots everywhere: the lane tick moves origin/SignalGrid_Alpha in the shared .git mid-run. */
function writeDiff(ctx, n) {
  const d = (...extra) => git(ctx, ["diff", "--no-color", "--no-ext-diff", ...extra, "origin/SignalGrid_Alpha...HEAD"]);
  writeFileSync(join(ctx.runDir, `review-${n}.diff`), `${d("--stat")}\n${d()}`);
}

function review(ctx, n) {
  writeDiff(ctx, n);
  const r = runStage(ctx, "review", null, `review-${n}`, { REVIEW_N: n });
  const p = parseReview(r.env, r.exit, r.capped);
  if (p.act === "pause") return p;
  writeFileSync(join(ctx.runDir, `review-${n}.json`), `${JSON.stringify({ verdict: p.verdict, summary: p.summary, findings: p.findings }, null, 1)}\n`);
  ctx.reviews.push(p);
  console.log(`review ${n}: ${p.verdict} — ${oneLine(p.summary)}`);
  return p;
}

const findingsText = (fs) => (fs.length ? fs.map((f, i) => oneLine(`${i + 1}. [${f.severity}] ${f.file}: ${f.note}`)).join("\n") : "(none)");

function markerPath(ctx, commits) {
  let t;
  try { t = JSON.parse(readFileSync(join(ctx.runDir, "triage.json"), "utf8")); } catch { throw new Hand("triage.json is missing or unreadable — refusing to write a marker"); }
  const bad = violation(SCHEMAS.triage, t) ?? (t.status === "done" ? doneProblem(t, ctx.today) : "triage.json does not say done");
  if (bad) throw new Hand(`refusing to write a marker: ${bad}`);
  const plan = join(ctx.cwd, "docs/COMPANY_BUILD_PLAN.md");
  writeFileSync(plan, applyMarker(readFileSync(plan, "utf8"), ctx.row, t.marker, t.evidence));
  const run = (f, text) => writeFileSync(join(ctx.runDir, f), text);
  run("commit-msg.txt", `plan row ${ctx.row}: ${t.marker} (build tick triage)\n\nTriage re-measured the row against this tree.\n\nReason: ${oneLine(t.reason)}\nEvidence: ${oneLine(t.evidence)}\n`);
  run("pr-title.txt", `Mark plan row ${ctx.row} ${t.marker} (plan row ${ctx.row})\n`);
  run("pr-body.md", `Owner decision needed: none. A plan-row marker only; the landing class is derived from the diff by the script.\n\nThe build tick's triage stage (read-only) re-measured plan row ${ctx.row} against this tree and found it already done. No build ran.\n\n**Reason:** ${oneLine(t.reason)}\n\n**Evidence:** ${oneLine(t.evidence)}\n`);
  commits.push(commit(ctx, join(ctx.runDir, "commit-msg.txt")));
  const rv = review(ctx, 1); // there is no fix stage on the marker path
  if (rv.act === "pause") return { outcome: "pause", reason: rv.reason };
  return rv.verdict === "ship" ? { outcome: "land", reason: "the marker was reviewed ship" }
    : { outcome: "hand", reason: `review ${rv.verdict} the marker: ${oneLine(rv.summary)}` };
}

function buildPath(ctx, kind, commits) {
  const b = runStage(ctx, "build", kind, "build");
  const handFile = join(ctx.runDir, "hand.txt");
  if (existsSync(handFile) && statSync(handFile).size > 0) {
    return { outcome: "hand", reason: `the build session stopped and asked for a hand: ${oneLine(readFileSync(handFile, "utf8")).slice(0, 600)}` };
  }
  if (!dirty(ctx)) {
    return b.broken ? { outcome: "pause", reason: `the build session (exit ${b.exit}) did nothing and is itself broken (auth? usage limit? Keychain under launchd?)` }
      : { outcome: "hand", reason: `the build session (exit ${b.exit}) changed nothing and left no hand.txt` };
  }
  for (const f of ["commit-msg.txt", "pr-title.txt", "pr-body.md"]) {
    if (!existsSync(join(ctx.runDir, f)) || statSync(join(ctx.runDir, f)).size === 0) {
      return { outcome: "hand", reason: `the build session (exit ${b.exit}) left changes but no ${f}; the work stays uncommitted in the worktree until the next run resets it` };
    }
  }
  commits.push(commit(ctx, join(ctx.runDir, "commit-msg.txt")));
  const r1 = review(ctx, 1);
  if (r1.act === "pause") return { outcome: "pause", reason: r1.reason };
  if (r1.verdict === "ship") return { outcome: "land", reason: "review 1 shipped" };
  if (r1.verdict === "reject") return { outcome: "hand", reason: `review 1 rejected: ${oneLine(r1.summary)}` };
  const model = stageSpec("fix", kind).model;
  const f = runStage(ctx, "fix", kind, "fix", { FINDINGS: findingsText(r1.findings) });
  if (!dirty(ctx)) {
    return f.broken ? { outcome: "pause", reason: `the fix session (exit ${f.exit}) did nothing and is itself broken` }
      : { outcome: "hand", reason: `review 1 asked for a fix and the fix stage (exit ${f.exit}) changed nothing` };
  }
  const msg = join(ctx.runDir, "fix-commit-msg.txt");
  writeFileSync(msg, `plan row ${ctx.row}: address review findings (fix stage, ${model})\n\nReview 1 findings:\n${findingsText(r1.findings)}\n`);
  commits.push(commit(ctx, msg));
  const r2 = review(ctx, 2);
  if (r2.act === "pause") return { outcome: "pause", reason: r2.reason };
  return r2.verdict === "ship" ? { outcome: "land", reason: "review 2 shipped after one fix" }
    : { outcome: "hand", reason: `review 2 said ${r2.verdict} after the one fix the pipeline allows: ${oneLine(r2.summary)}` };
}

/** On land: the reviews and the cost table, appended to the PR body between the session's body and the gates. */
function writeStages(ctx) {
  const reviews = ctx.reviews.map((r, i) => [`### Review ${i + 1}: ${r.verdict}`, r.summary, ...r.findings.map((f) => `- **${f.severity}** \`${f.file}\`: ${oneLine(f.note)}`)].join("\n"));
  const lines = readFileSync(join(ctx.runDir, "ledger.jsonl"), "utf8").trim().split("\n");
  writeFileSync(join(ctx.runDir, "pr-body-stages.md"), `## Review (opus)\n\n${reviews.join("\n\n")}\n\n${costTable(lines)}\n`);
}

export function runCmd(ctx, path, kind) {
  const outFile = join(ctx.runDir, "outcome.json");
  rmSync(outFile, { force: true });
  const commits = [];
  let res;
  try {
    res = path === "marker" ? markerPath(ctx, commits) : path === "build" ? buildPath(ctx, kind, commits) : (() => { throw new Hand(`unknown --path ${path}`); })();
    if (res.outcome === "land") writeStages(ctx);
  } catch (e) {
    if (!(e instanceof Hand)) console.error(e.stack);
    res = { outcome: "hand", reason: e instanceof Hand ? e.message : `helper error: ${e.message}` };
  }
  writeFileSync(outFile, `${JSON.stringify({ ...res, commits }, null, 1)}\n`);
  console.log(`outcome: ${res.outcome} — ${res.reason}`);
}

// ── dry-run ──────────────────────────────────────────────────────────────────
/** One line per stage; spawns nothing. The brief is shown as a placeholder so each stays ONE line. */
export function commandsCmd(ctx) {
  const base = { ROW_ID: ctx.row, ROW_TITLE: ctx.title, BRANCH: ctx.branch, RUN_DIR: ctx.runDir, TODAY: ctx.today };
  const show = (label, stage, kind, extra = {}) => {
    const brief = render(BRIEFS[stage], { ...base, ...extra }); // renders for real: a broken brief fails the dry-run
    const argv = claudeArgv(stage, kind, `<${BRIEFS[stage]} rendered, ${brief.length} chars>`, ctx.runDir);
    console.log(`${label}: ${["claude", ...argv].map(shq).join(" ")}`);
  };
  show("triage", "triage");
  for (const k of KINDS) show(`build (${k})`, "build", k);
  for (const k of KINDS) show(`fix (${k})`, "fix", k, { FINDINGS: "<the review's findings>" });
  show("review", "review", null, { REVIEW_N: 1 });
}

// ── the test stub `claude` ───────────────────────────────────────────────────
function stubMain() {
  const fs = require("fs");
  const a = process.argv.slice(2);
  const val = (f) => (a.indexOf(f) >= 0 ? a[a.indexOf(f) + 1] : undefined);
  const brief = a[a.indexOf("-p") + 1] || "";
  const stage = (/^STAGE: (\w+)/.exec(brief) || [])[1] || "unknown";
  const e = process.env;
  fs.appendFileSync(e.SG_STUB_LOG, JSON.stringify({
    stage, argv: a, cwd: process.cwd(), sawFinding: brief.includes("stub finding"),
    env: { SSH_AUTH_SOCK: e.SSH_AUTH_SOCK ?? null, GH_TOKEN: e.GH_TOKEN ?? null, GIT_SSH_COMMAND: e.GIT_SSH_COMMAND ?? null, GH_CONFIG_DIR: e.GH_CONFIG_DIR ?? null },
  }) + "\n");
  if (e.SG_STUB_FAIL === "1" || e.SG_STUB_FAIL === stage) process.exit(1);
  const model = val("--model") || "unknown";
  const env = {
    type: "result", subtype: "success", is_error: false, api_error_status: null, num_turns: 3, duration_ms: 1234,
    total_cost_usd: { haiku: 0.01, sonnet: 0.05, opus: 0.2 }[model] ?? 0.1,
    modelUsage: { [`stub-${model}-id`]: { costUSD: 0.01 } }, result: "ok",
  };
  if (stage === "triage") {
    try { env.structured_output = JSON.parse(e.SG_STUB_TRIAGE ?? ""); } catch { env.structured_output = e.SG_STUB_TRIAGE ?? ""; }
  } else if (stage === "review") {
    const counter = `${e.SG_STUB_LOG}.reviews`;
    let n = 0;
    try { n = Number(fs.readFileSync(counter, "utf8")); } catch { /* first call */ }
    fs.writeFileSync(counter, String(n + 1));
    const v = (e.SG_STUB_REVIEWS || "ship").split(",")[n] || "ship";
    const finding = [{ severity: "major", file: "src/stub.txt", note: "stub finding" }];
    // capped: a VALID ship that arrived with a cap subtype must still be a reject (the cap is the point)
    if (v === "capped") { env.subtype = "error_max_turns"; env.is_error = true; env.structured_output = { verdict: "ship", summary: "stub capped", findings: [] }; }
    else if (v === "apierror") { env.api_error_status = 429; env.is_error = true; }
    else env.structured_output = { verdict: v === "shipmajor" ? "ship" : v, summary: `stub ${v}`, findings: v === "fix" || v === "shipmajor" ? finding : [] };
  } else if (e.SG_STUB_NOCHANGE !== stage) {
    fs.mkdirSync("src", { recursive: true });
    fs.appendFileSync("src/stub.txt", `${stage} line\n`);
    const dir = val("--add-dir");
    if (stage === "build" && dir) {
      fs.writeFileSync(`${dir}/commit-msg.txt`, "plan row 7: stub change\n\nwhat and why\n");
      fs.writeFileSync(`${dir}/pr-title.txt`, "Stub change (plan row 7)\n");
      fs.writeFileSync(`${dir}/pr-body.md`, "Owner decision needed: SAFETY_MACHINERY\n\nstub body\n");
    }
  }
  process.stdout.write(JSON.stringify(env));
}
export function writeStub(dir) {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "claude");
  writeFileSync(f, `#!/usr/bin/env node\n(${stubMain.toString()})();\n`);
  chmodSync(f, 0o755);
  return f;
}

// ── self-test ────────────────────────────────────────────────────────────────
const TODAY = "2026-10-01";
const STAMP = "20261001T000000Z";
const PLAN = [
  "# Plan", "", "## Global backlog", "",
  "7. **Row seven** — devex-tooling-engineer. RE-MEASURED 2026-09-26 (still open): x",
  "8. **Row eight** — devex-tooling-engineer. untouched neighbour",
  "", "## Next section", "",
].join("\n");
const DONE_TRIAGE = JSON.stringify({ status: "done", kind: "code", marker: `DONE (re-measured ${TODAY})`, evidence: "src/a.ts:1 shows it; node scripts/x.mjs prints ok", reason: "already built" });
const buildTriage = (kind) => JSON.stringify({ status: "build", kind, marker: "", evidence: "", reason: "open" });
const flagsOf = (argv) => argv.filter((_, i) => i !== argv.indexOf("-p") + 1); // minus the brief text
const after = (argv, f) => argv[argv.indexOf(f) + 1];

function selfTestBody(root, ok) {
  const stubDir = join(root, "bin");
  writeStub(stubDir);
  let count = 0;
  const logs = [];
  const readLog = (log) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  function scenario(plan = PLAN) {
    const dir = join(root, `s${++count}`);
    const repo = join(dir, "repo"), run = join(dir, "run"), cache = join(dir, "cache"), log = join(dir, "stub.log");
    mkdirSync(repo, { recursive: true });
    mkdirSync(run);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", PATH: `${stubDir}${delimiter}${process.env.PATH}`, SSH_AUTH_SOCK: "planted", GH_TOKEN: "planted-token", SG_STUB_LOG: log };
    const git = (...a) => {
      const r = spawnSync("git", a, { cwd: repo, env, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    git("init", "-q");
    git("config", "user.name", "Self Test");
    git("config", "user.email", "self-test@example.invalid");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs/COMPANY_BUILD_PLAN.md"), plan);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("update-ref", "refs/remotes/origin/SignalGrid_Alpha", "HEAD");
    logs.push(log);
    const s = {
      git, run, cache, repo,
      cli: (sub, extra = {}) => spawnSync(process.execPath, [SELF, ...sub, "--row", "7", "--title", "Row seven", "--branch", "mac/build-row-7-T", "--run-dir", run, "--cache", cache, "--today", TODAY, "--stamp", STAMP],
        { cwd: repo, env: { ...env, ...extra }, encoding: "utf8" }),
      next: () => readFileSync(join(run, "next"), "utf8").trim(),
      outcome: () => JSON.parse(readFileSync(join(run, "outcome.json"), "utf8")),
      ledger: () => readFileSync(join(run, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)),
      stub: () => readLog(log),
      commits: () => Number(git("rev-list", "--count", "origin/SignalGrid_Alpha..HEAD").trim()),
      drive: (extra) => { // what build-tick.sh does: triage, then run on what `next` says
        s.cli(["triage"], extra);
        const [verb, rest] = s.next().split(/ (.*)/s);
        if (verb === "marker") s.cli(["run", "--path", "marker"], extra);
        else if (verb === "build") s.cli(["run", "--path", "build", "--kind", rest], extra);
        return verb;
      },
    };
    return s;
  }

  // S1 — triage says done: one plan line, no build, no fix.
  {
    const s = scenario();
    s.cli(["triage"], { SG_STUB_TRIAGE: DONE_TRIAGE });
    ok("S1 triage done -> next is `marker`", s.next() === "marker", s.next());
    s.cli(["run", "--path", "marker"], { SG_STUB_REVIEWS: "ship" });
    ok("S1 outcome is land", s.outcome().outcome === "land", JSON.stringify(s.outcome()));
    const ns = s.git("diff", "--numstat", "origin/SignalGrid_Alpha...HEAD").trim().split("\n");
    ok("S1 exactly one plan line changed", ns.length === 1 && /^1\t1\tdocs\/COMPANY_BUILD_PLAN\.md$/.test(ns[0]), ns.join("|"));
    const plan = readFileSync(join(s.repo, "docs/COMPANY_BUILD_PLAN.md"), "utf8").split("\n");
    ok("S1 row 7 carries the marker and row 8 is untouched",
      plan.find((l) => l.startsWith("7. ")).includes(`DONE (re-measured ${TODAY}): src/a.ts:1`) && plan.includes("8. **Row eight** — devex-tooling-engineer. untouched neighbour"));
    ok("S1 ledger stages are [triage, review]", JSON.stringify(s.ledger().map((l) => l.stage)) === '["triage","review"]', JSON.stringify(s.ledger().map((l) => l.stage)));
    ok("S1 the stub saw no build or fix call", !s.stub().some((e) => e.stage === "build" || e.stage === "fix"));
    ok("S1 one commit on top of mainline", s.commits() === 1, String(s.commits()));
  }

  // S2 — mechanical build runs on haiku; triage sonnet and review opus are read-only by tool absence.
  {
    const s = scenario();
    ok("S2 triage build/mechanical -> next is `build mechanical`", (s.cli(["triage"], { SG_STUB_TRIAGE: buildTriage("mechanical") }), s.next()) === "build mechanical", s.next());
    s.cli(["run", "--path", "build", "--kind", "mechanical"], { SG_STUB_REVIEWS: "ship" });
    const e = s.stub();
    const b = flagsOf(e.find((x) => x.stage === "build")?.argv ?? []);
    const t = flagsOf(e.find((x) => x.stage === "triage")?.argv ?? []);
    const r = flagsOf(e.find((x) => x.stage === "review")?.argv ?? []);
    ok("S2 build argv names --model haiku (and falls back UP to opus)", after(b, "--model") === "haiku" && after(b, "--fallback-model") === "opus", b.join(" "));
    ok("S2 triage argv: --model sonnet, --tools Read,Grep,Glob only", after(t, "--model") === "sonnet" && after(t, "--tools") === "Read,Grep,Glob", t.join(" "));
    ok("S2 review argv: --model opus, --tools Read,Grep,Glob only", after(r, "--model") === "opus" && after(r, "--tools") === "Read,Grep,Glob", r.join(" "));
    for (const [n, a] of [["triage", t], ["review", r]]) {
      ok(`S2 ${n} has no Edit/Write/Bash anywhere, no acceptEdits, no allowlist`,
        !a.some((x) => /Edit|Write|Bash/.test(x)) && !a.includes("--permission-mode") && !a.includes("--allowedTools"), a.join(" "));
      ok(`S2 ${n} asks for a json envelope and a schema`, after(a, "--output-format") === "json" && a.includes("--json-schema"));
    }
    ok("S2 opus review gets no fallback model", !r.includes("--fallback-model"));
    ok("S2 build keeps today's tool sets (acceptEdits, allowlist, deny list)",
      after(b, "--permission-mode") === "acceptEdits" && b.includes("--allowedTools") && b.includes("--disallowedTools") && b.includes("Bash(git push*)"));
    ok("S2 outcome is land", s.outcome().outcome === "land", JSON.stringify(s.outcome()));
  }

  // S3 — review fix, then ship: one fix on the BUILD tier, two commits, land. Doubles as S9's subject.
  let s3;
  {
    const s = (s3 = scenario());
    s.cli(["triage"], { SG_STUB_TRIAGE: buildTriage("code") });
    s.cli(["run", "--path", "build", "--kind", "code"], { SG_STUB_REVIEWS: "fix,ship" });
    const e = s.stub();
    const fix = e.find((x) => x.stage === "fix");
    ok("S3 a fix stage ran on --model sonnet (the build tier)", !!fix && after(fix.argv, "--model") === "sonnet", fix && fix.argv.join(" "));
    ok("S3 the review findings reached the fix brief", !!fix && fix.sawFinding === true);
    ok("S3 stages ran triage, build, review, fix, review", e.map((x) => x.stage).join(",") === "triage,build,review,fix,review", e.map((x) => x.stage).join(","));
    ok("S3 two commits", s.commits() === 2 && s.outcome().commits.length === 2, `${s.commits()} / ${JSON.stringify(s.outcome())}`);
    ok("S3 outcome is land", s.outcome().outcome === "land");
    ok("S3 fix commit names the stage and tier", /address review findings \(fix stage, sonnet\)/.test(s.git("log", "-1", "--format=%B")));
    ok("S3 commits carry both trailers", /Co-Authored-By: Claude <noreply@anthropic\.com>/.test(s.git("log", "-2", "--format=%B")) && s.git("log", "-2", "--format=%B").split(`Build-Tick: ${STAMP}`).length === 3);
  }

  // S4 — fix then fix: a hand.
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_REVIEWS: "fix,fix" });
    ok("S4 review fix,fix -> hand", s.outcome().outcome === "hand", JSON.stringify(s.outcome()));
  }

  // S5 — unparseable triage fails closed to judgment (opus).
  {
    const s = scenario();
    s.cli(["triage"], { SG_STUB_TRIAGE: "this is {not json" });
    ok("S5 unparseable triage -> next is `build judgment`", s.next() === "build judgment", s.next());
    ok("S5 triage.json says why", /unparseable triage/.test(readFileSync(join(s.run, "triage.json"), "utf8")));
    s.cli(["run", "--path", "build", "--kind", "judgment"], { SG_STUB_REVIEWS: "ship" });
    const b = s.stub().find((x) => x.stage === "build");
    ok("S5 the build argv carries --model opus (and no fallback)", !!b && after(b.argv, "--model") === "opus" && !b.argv.includes("--fallback-model"), b && b.argv.join(" "));
  }

  // S6 — a broken session pauses and the ledger never invents a cost.
  {
    const s = scenario();
    s.cli(["triage"], { SG_STUB_FAIL: "1" });
    ok("S6 triage exit 1 with no envelope -> pause", s.next().startsWith("pause"), s.next());
    const l = s.ledger()[0];
    ok("S6 ledger line has costUsd null (never 0), numTurns null, exit 1", l.costUsd === null && l.numTurns === null && l.exit === 1, JSON.stringify(l));
  }

  // S7 — blocked is a hand (not a marker) until #1216; a marker already present is a hand.
  {
    const s = scenario();
    s.cli(["triage"], { SG_STUB_TRIAGE: JSON.stringify({ status: "blocked", kind: "code", marker: `AWAITING OWNER (the decision, ${TODAY})`, evidence: "docs/x.md:1", reason: "needs the owner" }) });
    ok("S7 triage blocked -> hand citing #1216", s.next().startsWith("hand") && s.next().includes("#1216"), s.next());
    const t = scenario(PLAN.replace("(still open): x", `(still open): x DONE (re-measured ${TODAY}): earlier`));
    t.cli(["triage"], { SG_STUB_TRIAGE: DONE_TRIAGE });
    t.cli(["run", "--path", "marker"], { SG_STUB_REVIEWS: "ship" });
    ok("S7 a row already marked DONE -> hand, nothing committed", t.outcome().outcome === "hand" && /already/.test(t.outcome().reason) && t.commits() === 0, JSON.stringify(t.outcome()));
  }

  // S11-S16 — the rest of the fail-closed table.
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_REVIEWS: "shipmajor,ship" });
    ok("S11 ship carrying a major finding is treated as fix", s.stub().some((x) => x.stage === "fix") && s.outcome().outcome === "land", JSON.stringify(s.outcome()));
  }
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_FAIL: "build" });
    ok("S12 a build session that dies with no change -> pause", s.outcome().outcome === "pause", JSON.stringify(s.outcome()));
  }
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_REVIEWS: "fix", SG_STUB_NOCHANGE: "fix" });
    ok("S13 a fix that changes nothing -> hand", s.outcome().outcome === "hand" && s.commits() === 1, JSON.stringify(s.outcome()));
  }
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_REVIEWS: "capped" });
    ok("S14 a capped review is a reject -> hand", s.outcome().outcome === "hand", JSON.stringify(s.outcome()));
  }
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_REVIEWS: "apierror" });
    ok("S15 a review with an api error -> pause", s.outcome().outcome === "pause", JSON.stringify(s.outcome()));
  }
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: buildTriage("code"), SG_STUB_REVIEWS: "reject" });
    ok("S16 review reject -> hand", s.outcome().outcome === "hand", JSON.stringify(s.outcome()));
  }
  {
    const s = scenario();
    s.drive({ SG_STUB_TRIAGE: JSON.stringify({ status: "done", kind: "code", marker: "DONE", evidence: "x:1", reason: "r" }) });
    ok("S17 a done marker not shaped `DONE (re-measured <today>)` -> hand", s.next().startsWith("hand"), s.next());
  }

  // S8 — the scrub, over EVERY stub call of every scenario above.
  const allStub = logs.flatMap(readLog);
  const calls = allStub.length;
  ok(`S8 ${calls} stub calls: none saw SSH_AUTH_SOCK or GH_TOKEN`, calls > 0 && allStub.every((e) => e.env.SSH_AUTH_SOCK === null && e.env.GH_TOKEN === null));
  ok("S8 every call saw GIT_SSH_COMMAND=false and a GH_CONFIG_DIR", allStub.every((e) => e.env.GIT_SSH_COMMAND === "false" && !!e.env.GH_CONFIG_DIR));

  // S9 — the PR body's cost table and the cache ledger.
  {
    const body = readFileSync(join(s3.run, "pr-body-stages.md"), "utf8");
    const rows = body.split("\n").filter((l) => /^\| (triage|build|fix|review)/.test(l));
    ok("S9 pr-body-stages.md holds `## Tiers and cost` with one row per ledger line and a total",
      body.includes("## Tiers and cost") && rows.length === s3.ledger().length && /\| \*\*Total\*\*/.test(body), `${rows.length} rows vs ${s3.ledger().length}`);
    ok("S9 pr-body-stages.md holds `## Review (opus)` with every review", body.includes("## Review (opus)") && (body.match(/stub (fix|ship)/g) ?? []).length >= 2);
    const lines = readFileSync(join(s3.cache, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const FIELDS = ["stamp", "row", "branch", "stage", "tierAsked", "models", "numTurns", "durationMs", "costUsd", "isError", "subtype", "apiErrorStatus", "exit", "capped"];
    ok("S9 <CACHE>/ledger.jsonl lines parse and carry every field", lines.length === s3.ledger().length && lines.every((l) => FIELDS.every((f) => f in l)), JSON.stringify(lines[0]));
    ok("S9 the ledger records the model that RAN (from modelUsage), not only the tier asked", lines.find((l) => l.stage === "build").models[0] === "stub-sonnet-id");
  }

  // S10 — build-tick.sh's hung-hand budget covers the table's worst case.
  {
    const sh = readFileSync(join(HERE, "build-tick.sh"), "utf8");
    const n = Number(/^STAGES_SECONDS=(\d+)/m.exec(sh)?.[1]);
    ok("S10 build-tick.sh STAGES_SECONDS >= triage + judgment build + judgment fix + 2 reviews", n >= worstCaseStagesSeconds(), `${n} vs ${worstCaseStagesSeconds()}`);
  }

  // Units: the briefs, the renderer, the marker writer, the cost table, the dry-run.
  for (const [stage, file] of Object.entries(BRIEFS)) {
    const text = readFileSync(join(HERE, file), "utf8");
    ok(`brief ${file} starts with STAGE: ${stage} and renders with no leftover placeholder`,
      text.startsWith(`STAGE: ${stage}\n`) && !render(file, { ROW_ID: "7", ROW_TITLE: "t", BRANCH: "b", RUN_DIR: "/r", TODAY, FINDINGS: "f", REVIEW_N: "1" }).includes("{{"));
  }
  {
    let refused = false;
    try { render("build-tick-triage.md", { ROW_ID: "7" }); } catch { refused = true; }
    ok("render refuses a stage whose brief keeps a {{placeholder}}", refused);
    ok("render breaks up a {{ inside a value (a title cannot forge a placeholder)",
      render("build-tick-fix.md", { ROW_ID: "7", ROW_TITLE: "{{RUN_DIR}}", BRANCH: "b", RUN_DIR: "/r", TODAY, FINDINGS: "{{x}}" }).includes("{ {RUN_DIR}}"));
  }
  {
    const out = applyMarker(PLAN, "7", `DONE (re-measured ${TODAY})`, "a.ts:1\n  and   more");
    const a = PLAN.split("\n"), b = out.split("\n");
    ok("applyMarker changes exactly one line, whitespace-collapses evidence", a.length === b.length && a.filter((l, i) => l !== b[i]).length === 1 && out.includes(`DONE (re-measured ${TODAY}): a.ts:1 and more`));
    ok("applyMarker caps evidence at 600 chars", applyMarker(PLAN, "7", `DONE (re-measured ${TODAY})`, "e".repeat(5000)).length - PLAN.length < 700);
    for (const [why, fn] of [["a missing row", () => applyMarker(PLAN, "99", "DONE (x)", "e")], ["empty evidence", () => applyMarker(PLAN, "7", `DONE (re-measured ${TODAY})`, "  ")]]) {
      let h = false;
      try { fn(); } catch (e) { h = e instanceof Hand; }
      ok(`applyMarker raises a Hand on ${why}`, h);
    }
  }
  {
    const t = costTable([
      { stage: "triage", tierAsked: "sonnet", models: ["claude-sonnet-x"], numTurns: 2, durationMs: 4000, costUsd: 0.05 },
      { stage: "review", tierAsked: "opus", models: [], numTurns: null, durationMs: null, costUsd: null },
    ]);
    ok("costTable: heading, unknown for nulls, joined models, total with the unknown count",
      t.startsWith("## Tiers and cost") && t.includes("| unknown |") && t.includes("claude-sonnet-x") && t.includes("(+1 stage(s) unknown)") && t.includes("0.0500"), t);
    ok("costTable accepts ledger lines as JSON text", costTable([JSON.stringify({ stage: "triage", tierAsked: "sonnet", models: ["m1", "m2"], numTurns: 1, durationMs: 1000, costUsd: 0.01 })]).includes("m1 + m2"));
  }
  {
    const s = scenario();
    const out = s.cli(["commands"]).stdout.split("\n").filter(Boolean);
    const line = (label) => out.find((l) => l.startsWith(`${label}: `)) ?? "";
    ok("commands prints one line per stage, spawning nothing",
      ["triage", "build (mechanical)", "build (code)", "build (judgment)", "fix (mechanical)", "fix (code)", "fix (judgment)", "review"].every((l) => line(l)) && out.length === 8 && !existsSync(join(s.cache, "ledger.jsonl")), out.join("\n"));
    ok("commands: build (mechanical) names --model haiku, triage sonnet, review opus",
      /--model haiku/.test(line("build (mechanical)")) && /--model sonnet/.test(line("triage")) && /--model opus/.test(line("review")));
  }
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "sg-stages-"));
  const checks = [];
  const ok = (name, cond, detail) => {
    checks.push([name, !!cond]);
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${name}${cond || detail === undefined ? "" : ` (${String(detail).slice(0, 300)})`}`);
  };
  try { selfTestBody(root, ok); } catch (e) { ok(`the self-test ran to its end (${e.message})`, false); }
  finally { rmSync(root, { recursive: true, force: true }); }
  const failed = checks.filter(([, k]) => !k);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "--self-test") return selfTest();
  if (cmd === "write-stub" && rest[0]) { console.log(writeStub(rest[0])); return 0; }
  if (!["triage", "run", "commands"].includes(cmd)) {
    console.error("usage: build-tick-stages.mjs triage|run|commands <flags> | write-stub <dir> | --self-test");
    return 2;
  }
  const f = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i] ?? "") || rest[i + 1] === undefined) { console.error(`bad flag near ${rest[i]}`); return 2; }
    f[rest[i].slice(2)] = rest[i + 1];
  }
  const live = cmd !== "commands"; // the dry-run needs no run dir, cache or stamp
  const need = (k, dflt) => f[k] ?? (live ? (console.error(`--${k} is required`), process.exit(2)) : dflt);
  const ctx = {
    row: need("row", "<row>"), title: f.title ?? "", branch: need("branch", "<branch>"), runDir: resolve(need("run-dir", "<run-dir>")),
    cache: resolve(need("cache", join(homedir(), "Library/Caches/signalgrid/build-tick"))), today: need("today", "<today>"), stamp: need("stamp", "<stamp>"),
    cwd: process.cwd(), reviews: [],
  };
  if (cmd === "commands") commandsCmd(ctx);
  else if (cmd === "run") runCmd(ctx, f.path, f.kind);
  else {
    try { triageCmd(ctx); } catch (e) { // a helper bug is a hand, never a build and never silence
      mkdirSync(ctx.runDir, { recursive: true });
      writeFileSync(join(ctx.runDir, "next"), `hand the triage helper failed: ${oneLine(e.message)}\n`);
      console.error(e.stack);
    }
  }
  return 0;
}

// realpath on both sides: node resolves the module URL through symlinks (/tmp -> /private/tmp), and
// a plain resolve() of argv[1] would then be "not the main module" and run NOTHING, silently.
const isMain = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF); } catch { return false; } })();
if (isMain) process.exitCode = main(process.argv.slice(2));

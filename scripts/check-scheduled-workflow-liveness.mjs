#!/usr/bin/env node
// Scheduled-workflow liveness registry — every workflow that carries a `schedule:` trigger names
// what would NOTICE it stopped, or carries a dated exemption with a reason.
//
// WHY THIS EXISTS. scripts/check-ci-liveness.mjs gates ONE scheduled job's last success (the
// daily mutation sweep, plan row 53). The estate runs more scheduled workflows than that one, and
// a schedule that silently stops is the same outage in every one of them: GitHub disables
// scheduled workflows on inactive repositories, and "best-effort" cron skipped hourly runs for two
// days on 2026-09-26. Nothing enumerated the scheduled workflows, so a seventh could be added
// tomorrow with nothing noticing it stop. This gate is the enumeration, and it is STATIC: it reads
// the workflow YAML and docs/agent/scheduled-workflow-liveness.json and nothing else.
//
// WHAT IT DECIDES (all fatal):
//   · a workflow with a `schedule:` trigger and no registry entry
//   · a registry entry for a workflow that no longer schedules (or no longer exists), or twice
//   · a watcher kind that is not api-probe / auto-hand / exempt
//   · `exempt` with no reason, or with no valid `reviewedAt`, or a `reviewedAt` older than
//     STALE_AFTER_DAYS (re-review it, do not let the exemption age into a fossil), or one dated
//     after the reference date (an unknown date tightens, never loosens)
//   · an `api-probe` / `auto-hand` whose named script does not exist, is not wired in BOTH
//     scripts/preflight.mjs and the CI workflow, or never names the workflow file it claims to watch
//   · an `auto-hand` naming a kind raised-hands does not detect
//
// WHAT IT DOES NOT DECIDE. Whether the watcher is GOOD — that is the Opus review round's job and
// the `reason` text's. It also does not call the Actions API: a probe's verdict is
// check-ci-liveness.mjs's own business (FATAL there for the sweep only; a flaky gate gets
// switched off). Plan row 53's design stands: CI commits nothing, no heartbeat file is written.
//
// DETERMINISTIC. "How old is reviewedAt" is measured against the HEAD commit's committer date, not
// the wall clock: the same tree gives the same verdict on every machine and every day. If that date
// cannot be read the gate FAILS (an unknown reference date does not loosen an exemption).
//
// SCHEDULE DETECTION is structural, not a grep. Comments are stripped (quote-aware), then
// `schedule:` must be a direct child key of the top-level `on:` block. A `schedule:` in a comment,
// a quoted string, a `run:` body or a job named "schedule" credits nothing.
//
//   node scripts/check-scheduled-workflow-liveness.mjs
//   node scripts/check-scheduled-workflow-liveness.mjs --self-test
//   node scripts/check-scheduled-workflow-liveness.mjs --root <dir> [--ref-date YYYY-MM-DD]   # fixtures

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUTO_KINDS } from "./lib/raised-hand-kinds.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REGISTRY_REL = "docs/agent/scheduled-workflow-liveness.json";
const PREFLIGHT_REL = "scripts/preflight.mjs";
const CI_REL = ".github/workflows/review-hub-ci.yml";
const KINDS = ["api-probe", "auto-hand", "exempt"];
/** An exemption not re-read in this long is a fossil. Measured against the HEAD commit date. */
export const STALE_AFTER_DAYS = 90;
const MIN_REASON_CHARS = 40;

// ── reading the YAML ─────────────────────────────────────────────────────────

/** Drop `#` comments, quote-aware (a `#` inside '...' or "..." is data). */
export function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let q = null;
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") {
          q = c;
        } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * One LEFT-TO-RIGHT pass over the text that blanks quoted VALUES but keeps quoted KEYS (a quoted token
 * followed by `:`). A single regex could not do this: it restarted inside a key's closing quote and fused
 * `"schedule": [{ "cron"` into `"schedule""cron"`, hiding both keys (review round 2). A quote only opens a
 * string at a token start (line start, whitespace, or one of `[{,:-?`), so an apostrophe inside a plain scalar
 * (`it's`) opens nothing. A quote that never closes on its line is left as it is. A double-quoted KEY that
 * contains a backslash (`"cr\x6fn"`) cannot be read by a text matcher at all: it is reported through
 * `escapedKey` so the caller fails closed.
 * @returns {{ text: string, escapedKey: boolean }}
 */
export function tokenizeQuotes(text) {
  let out = "";
  let escapedKey = false;
  for (const line of text.split("\n")) {
    let i = 0;
    let res = "";
    while (i < line.length) {
      const c = line[i];
      const prev = i === 0 ? " " : line[i - 1];
      if ((c === '"' || c === "'") && /[\s[{,:\-?]/.test(prev)) {
        let j = i + 1;
        let closed = -1;
        while (j < line.length) {
          if (c === '"' && line[j] === "\\") { j += 2; continue; }
          if (c === "'" && line[j] === "'" && line[j + 1] === "'") { j += 2; continue; }
          if (line[j] === c) { closed = j; break; }
          j += 1;
        }
        if (closed >= 0) {
          const token = line.slice(i, closed + 1);
          const isKey = /*M:keep-keys*/ /^\s*:/.test(line.slice(closed + 1));
          if (isKey) {
            if (c === '"' && token.includes("\\")) escapedKey = true;
            res += token;
          } else {
            res += `${c}${c}`;
          }
          i = closed + 1;
          continue;
        }
      }
      res += c;
      i += 1;
    }
    out += `${res}\n`;
  }
  return { text: out.slice(0, -1), escapedKey };
}

const SCHEDULE_KEY = /(?:^|[\s{,])["']?schedule["']?\s*:/;
const CRON_KEY = /(?:^|[\s{,[-])["']?cron["']?\s*:/m;

/**
 * "scheduled" | "none" | "unreadable". FAIL CLOSED: a shape this matcher cannot place is "unreadable", which the
 * gate reports as a problem, never "none". Handled spellings: block and flow `on:` (multi-line flow included),
 * `on :`, quoted `"on"`/`'on'`, an anchor or tag on the key (`on: &t`, `on: !!map`), quoted `"schedule":` keys,
 * a BOM, CRLF. Anything else that still carries a `cron:` key, or has no `on:` key at all, is unreadable.
 */
export function scheduleVerdict(rawText) {
  const text = stripComments(rawText.replace(/^\uFEFF/, "")).replace(/\r/g, "");
  const { text: blanked, escapedKey } = tokenizeQuotes(text);
  if (/*M:escaped-key*/ escapedKey) return "unreadable"; // a key spelled with escapes can hide `schedule`/`cron` from a text match
  const lines = blanked.split("\n");
  const onAt = lines.findIndex((l) => /^(?:on|"on"|'on')\s*:/.test(l));
  if (onAt < 0) return "unreadable";
  const inline = lines[onAt].replace(/^(?:on|"on"|'on')\s*:/, "").replace(/^\s*(?:[&!][^\s]*\s*)+/, "").trim();
  let verdict = "none";
  if (inline.startsWith("{")) {
    // flow map: read to the matching brace, possibly over several lines
    let depth = 0;
    let flow = "";
    for (let i = onAt; i < lines.length; i += 1) {
      const piece = i === onAt ? inline : lines[i];
      flow += `${piece}\n`;
      for (const c of piece) depth += c === "{" ? 1 : c === "}" ? -1 : 0;
      if (depth <= 0) break;
    }
    verdict = SCHEDULE_KEY.test(flow.replace(/^\{/, " ")) ? "scheduled" : "none";
  } else if (inline === "") {
    let childIndent = null;
    for (let i = onAt + 1; i < lines.length; i += 1) {
      const l = lines[i];
      if (l.trim() === "") continue;
      const indent = l.length - l.trimStart().length;
      if (indent === 0) break; // next top-level key: the `on:` block ended
      if (childIndent === null) childIndent = indent;
      if (indent === childIndent && /^["']?schedule["']?\s*:/.test(l.trim())) {
        verdict = "scheduled";
        break;
      }
    }
  }
  // the fallback: a cron the structural read did not account for is not "unscheduled"
  if (verdict === "none" && /*M:cron-fallback*/ CRON_KEY.test(blanked)) return "unreadable";
  return verdict;
}

/** Back-compat boolean: is it positively a scheduled workflow. */
export const hasScheduleTrigger = (rawText) => scheduleVerdict(rawText) === "scheduled";

/** { "codeql.yml": "scheduled" | "none" | "unreadable", … } for every workflow file in `dir`. */
export function scheduleMap(dir) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    out.set(f, scheduleVerdict(readFileSync(join(dir, f), "utf8")));
  }
  return out;
}

// ── the check, pure over its inputs ──────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Strict calendar date → UTC ms, or null (2026-02-31 and 2026-9-1 are both null). */
export function parseIsoDate(s) {
  const m = ISO_DATE.exec(typeof s === "string" ? s : "");
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ms : null;
}

const stripJsComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is `script` inside some step's `cmd: [...]` array in preflight? A name: string or a comment does not count. */
export function preflightRuns(preflightText, script) {
  return new RegExp(`cmd\\s*:\\s*\\[[^\\]]*["'\`]${escapeRe(script)}["'\`]`).test(stripJsComments(preflightText));
}

/** Is `script` inside a `run:` body in the CI workflow? A step `name:` or a comment does not count. */
export function ciRuns(ciText, script) {
  const lines = stripComments(ciText).replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(-\s+)?run\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? m[2].length : 0);
    let body = m[3];
    if (/^[|>][+-]?\d*$/.test(body.trim())) {
      body = "";
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "") continue;
        if (lines[j].length - lines[j].trimStart().length <= keyIndent) break;
        body += `${lines[j]}\n`;
      }
    }
    if (body.includes(script)) return true;
  }
  return false;
}


/**
 * @param {object} i
 * @param {Map<string, boolean>} i.scheduled   workflow file → carries a schedule trigger
 * @param {any} i.registry                     parsed registry JSON
 * @param {(rel: string) => string|null} i.readRel   repo-relative file → text, or null when absent
 * @param {string|null} i.refDate              YYYY-MM-DD (HEAD committer date), null when unknowable
 * @returns {string[]} problems; empty means green
 */
export function check({ scheduled, registry, readRel, refDate }) {
  const problems = [];
  const entries = Array.isArray(registry?.workflows) ? registry.workflows : null;
  if (entries === null) return [`${REGISTRY_REL}: no \`workflows\` array — the registry is unreadable, so nothing is registered`];

  const refMs = parseIsoDate(refDate);
  const preflight = readRel(PREFLIGHT_REL) ?? "";
  const ci = readRel(CI_REL) ?? "";

  const seen = new Set();
  for (const e of entries) {
    const wf = e?.workflow;
    if (typeof wf !== "string" || wf === "") {
      problems.push(`${REGISTRY_REL}: an entry has no \`workflow\` file name`);
      continue;
    }
    if (/*M:duplicate*/ seen.has(wf)) problems.push(`${wf}: registered twice — one workflow, one watcher`);
    seen.add(wf);
    if (scheduled.get(wf) === "unreadable") continue; // reported once, below, whether or not it is registered
    if (/*M:stale-entry*/ scheduled.get(wf) !== "scheduled") {
      problems.push(`${wf}: registered, but ${scheduled.has(wf) ? "it no longer has a `schedule:` trigger" : "no such workflow file exists"} — delete the entry`);
      continue;
    }
    const w = e.watcher;
    const kind = w?.kind;
    if (!KINDS.includes(kind)) {
      problems.push(`${wf}: watcher.kind ${JSON.stringify(kind)} is not one of ${KINDS.join(" / ")}`);
      continue;
    }
    if (kind === "exempt") {
      if (/*M:reason*/ (typeof w.reason !== "string" || w.reason.trim().length < MIN_REASON_CHARS)) {
        problems.push(`${wf}: exempt with no reason (needs ${MIN_REASON_CHARS}+ chars saying why a stop is acceptable or already covered) — a silent exemption is the thing this gate forbids`);
      }
      const rMs = parseIsoDate(w.reviewedAt);
      if (rMs === null) {
        problems.push(`${wf}: exempt with no valid \`reviewedAt\` (YYYY-MM-DD) — an undated exemption cannot go stale, so it is refused`);
      } else if (refMs === null) {
        problems.push(`${wf}: cannot age the exemption — the reference date (HEAD commit date) is unknown`);
      } else if (rMs > refMs) {
        problems.push(`${wf}: reviewedAt ${w.reviewedAt} is after the reference date ${refDate} — a future review date is not a review`);
      } else if (/*M:stale-date*/ (refMs - rMs) / 86_400_000 > STALE_AFTER_DAYS) {
        problems.push(`${wf}: exemption last reviewed ${w.reviewedAt}, over ${STALE_AFTER_DAYS} days before ${refDate} — re-read it and re-date it`);
      }
      if (/*M:red-watcher*/ w.redWatcher !== undefined && !AUTO_KINDS.includes(w.redWatcher)) {
        problems.push(`${wf}: redWatcher ${JSON.stringify(w.redWatcher)} is not a raised-hands auto kind (${AUTO_KINDS.join(", ")})`);
      }
      continue;
    }
    // api-probe / auto-hand both name a script that must exist, be wired, and name the workflow.
    const script = w.script;
    const src = typeof script === "string" ? readRel(script) : null;
    if (/*M:script-exists*/ src === null) {
      problems.push(`${wf}: ${kind} names script ${JSON.stringify(script)}, which does not exist`);
    } else {
      if (/*M:wired*/ !preflightRuns(preflight, script)) problems.push(`${wf}: watcher script ${script} is not run by ${PREFLIGHT_REL} (a name: string or a comment is not a run)`);
      if (/*M:wired-ci*/ !ciRuns(ci, script)) problems.push(`${wf}: watcher script ${script} is not run by ${CI_REL} (a step name: or a comment is not a run)`);
      if (/*M:names-workflow*/ !src.includes(wf)) problems.push(`${wf}: watcher script ${script} never names ${wf} — it cannot be watching it`);
    }
    if (kind === "auto-hand" && !AUTO_KINDS.includes(w.hand)) {
      problems.push(`${wf}: auto-hand names kind ${JSON.stringify(w.hand)}, which raised-hands does not detect (${AUTO_KINDS.join(", ")})`);
    }
  }
  for (const [wf, verdict] of scheduled) {
    if (/*M:unreadable*/ verdict === "unreadable") {
      problems.push(`${wf}: cannot tell whether it has a \`schedule:\` trigger (no top-level \`on:\` key, or a \`cron:\` this reader cannot attribute to one) — failing closed; rewrite the trigger block in a plain form`);
      continue;
    }
    if (/*M:unregistered*/ verdict === "scheduled" && !seen.has(wf)) {
      problems.push(`${wf}: has a \`schedule:\` trigger and no entry in ${REGISTRY_REL} — if it silently stops, nothing notices. Register a watcher or a dated exemption with a reason.`);
    }
  }
  return problems;
}

// ── the real tree ────────────────────────────────────────────────────────────

function headDate(root) {
  try {
    const iso = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return iso.slice(0, 10);
  } catch {
    return null;
  }
}

function run(root, refDate) {
  const readRel = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf8") : null);
  const wfDir = join(root, ".github/workflows");
  let registry = null;
  try {
    registry = JSON.parse(readRel(REGISTRY_REL) ?? "");
  } catch {
    return { problems: [`${REGISTRY_REL}: missing or not JSON`], scheduled: new Map(), registry: null };
  }
  const scheduled = existsSync(wfDir) ? scheduleMap(wfDir) : new Map();
  const problems = check({ scheduled, registry, readRel, refDate });
  if (/*M:empty-tree*/ scheduled.size === 0) problems.push(".github/workflows holds no workflow files — an empty tree is not a clean tree (wrong --root, or the directory is gone)");
  return { problems, scheduled, registry };
}

// ── self-test ────────────────────────────────────────────────────────────────

const SCHED_WF = (extra = "") => `name: X\non:\n  push:\n    branches: [main]\n  schedule:\n    - cron: "17 7 * * 1"\n${extra}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
const PLAIN_WF = `name: P\non:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
const REF = "2026-10-09";
const GOOD_REASON = "also runs on every push to mainline, so a stopped schedule costs only the idle-repo drift scan";
const exempt = (extra = {}) => ({ kind: "exempt", reason: GOOD_REASON, reviewedAt: "2026-10-01", ...extra });
const probe = { kind: "api-probe", script: "scripts/w.mjs" };

/** Lay a fixture repo under a temp dir and return its root. */
const CI_OK = "on:\n  push: {}\njobs:\n  a:\n    runs-on: x\n    steps:\n      - name: gate\n        run: node scripts/w.mjs\n";
function fixture({ workflows, registry, extraFiles = {}, preflight = '[{ cmd: ["node", "scripts/w.mjs"] }]', ci = CI_OK, noWorkflowsDir = false }) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "swl-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, "docs/agent"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const [f, t] of Object.entries(workflows)) writeFileSync(join(root, ".github/workflows", f), t);
  writeFileSync(join(root, CI_REL), ci);
  if (noWorkflowsDir) rmSync(join(root, ".github"), { recursive: true, force: true });
  writeFileSync(join(root, PREFLIGHT_REL), preflight);
  writeFileSync(join(root, "scripts/w.mjs"), "// watches a.yml\n");
  for (const [f, t] of Object.entries(extraFiles)) writeFileSync(join(root, f), t);
  writeFileSync(join(root, REGISTRY_REL), JSON.stringify(registry));
  return root;
}

function selfTest() {
  const results = [];
  const note = (name, ok, detail = "") => results.push([name, ok, detail]);
  const exits = (opts, expect, name) => {
    const root = fixture(opts);
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--root", root, "--ref-date", REF], { encoding: "utf8" });
      // the exit code AND the gate's own verdict line: a crash also exits 1 and proves nothing
      const verdict = expect === 0 ? /^scheduled-workflow liveness: \d+ scheduled/.test(r.stdout) : r.stderr.startsWith("✗ scheduled-workflow liveness:");
      note(name, r.status === expect && verdict, `exit ${r.status}, wanted ${expect}${r.status !== expect || !verdict ? `: ${(r.stderr || r.stdout).trim().split("\n")[0]}` : ""}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const entry = (watcher, workflow = "a.yml") => ({ workflow, watcher });
  const reg = (...workflows) => ({ version: 1, workflows });

  // the control: a green fixture must exit 0, or every red below proves nothing
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)) }, 0, "control: scheduled + api-probe wired + names workflow → exit 0");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt())) }, 0, "control: scheduled + dated exemption with a reason → exit 0");
  // (a)…(f) from the spec, each end to end through the CLI
  exits({ workflows: { "a.yml": SCHED_WF(), "b.yml": SCHED_WF() }, registry: reg(entry(exempt())) }, 1, "(a) scheduled workflow with no registry entry → exit 1");
  exits({ workflows: { "a.yml": PLAIN_WF }, registry: reg(entry(exempt())) }, 1, "(b) registry entry for a workflow with no schedule → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt({ reason: "" }))) }, 1, "(c) exempt without a reason → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt({ reviewedAt: "2026-05-01" }))) }, 1, "(d) exempt with a stale reviewedAt → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry({ kind: "api-probe", script: "scripts/nope.mjs" })) }, 1, "(e) watcher naming a script that does not exist → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt({ reviewedAt: undefined }))) }, 1, "exempt with no reviewedAt at all → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt({ reviewedAt: "2027-01-01" }))) }, 1, "exempt dated after the reference date → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)), preflight: "[]" }, 1, "api-probe script not wired in preflight → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)), ci: "on:\n  push: {}\njobs:\n  a:\n    steps:\n      - run: echo\n" }, 1, "api-probe script not wired in CI → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)), extraFiles: { "scripts/w.mjs": "// watches nothing\n" } }, 1, "api-probe script that never names the workflow → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry({ kind: "auto-hand", script: "scripts/w.mjs", hand: "no-such-kind" })) }, 1, "auto-hand naming a kind raised-hands lacks → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry({ kind: "magic" })) }, 1, "unknown watcher kind → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt()), entry(exempt())) }, 1, "the same workflow registered twice → exit 1");
  // (f) negative control: schedule: that is NOT a trigger credits nothing → plain, so a registry entry for it is stale (exit 1),
  // and with no entry the gate is green (a decoy must not demand a watcher either)
  const decoy = `name: D\n# schedule:\non:\n  push:\n    branches: [main]\n    # schedule:\n    paths: ["schedule: x"]\nenv:\n  NOTE: "schedule: nightly"\njobs:\n  schedule:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo "schedule:"\n          # schedule:\n`;
  exits({ workflows: { "a.yml": decoy }, registry: reg(entry(exempt())) }, 1, "(f) `schedule:` in comments, strings, a job name and a run body credits nothing (entry for it is stale) → exit 1");
  exits({ workflows: { "a.yml": decoy }, registry: reg() }, 0, "(f) …and a workflow whose only `schedule:` is such a decoy needs no entry → exit 0");
  const flow = `name: F\non: { push: {}, schedule: [{ cron: "0 0 * * *" }] }\njobs:\n  a:\n    runs-on: x\n`;
  exits({ workflows: { "a.yml": flow }, registry: reg() }, 1, "flow-style `on: { schedule: … }` is detected (unregistered → exit 1)");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: { version: 1 } }, 1, "a registry with no `workflows` array → exit 1");

  // ── review round 1 (fail-OPEN detector, wiring by substring, empty tree, redWatcher) ──
  // Every shape below is VALID GitHub-workflow YAML that carries a cron. An unregistered one must go red.
  const unreg = (name, text) => exits({ workflows: { "a.yml": text }, registry: reg() }, 1, `valid YAML shape \`${name}\` with a cron and no entry → exit 1 (never read as "not scheduled")`);
  unreg("multi-line flow map", `name: F\non: {\n  push: {},\n  schedule: [{ cron: "0 0 * * *" }]\n}\njobs:\n  a:\n    runs-on: x\n`);
  unreg("flow map continued on the next line", `name: F\non: { push: {},\n  schedule: [{ cron: "0 0 * * *" }] }\njobs:\n  a:\n    runs-on: x\n`);
  unreg('double-quoted "schedule": key', `name: Q\non:\n  push: {}\n  "schedule":\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("single-quoted 'schedule': key", `name: Q\non:\n  push: {}\n  'schedule':\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("`on :` with a space before the colon", `name: S\non :\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("quoted \"on\": key", `name: S\n"on":\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("anchor on the on: key", `name: A\non: &trig\n  push: {}\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("!!map tag on the on: key", `name: T\non: !!map\n  push: {}\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("a BOM before a first-line on:", `\uFEFFon:\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n`);
  unreg("CRLF line endings", `name: C\r\non:\r\n  schedule:\r\n    - cron: "0 0 * * *"\r\njobs:\r\n  a:\r\n    runs-on: x\r\n`);
  // review round 2: a quoted `schedule` key that shares a line with another quoted string (the regex blanker mangled it)
  const J = "jobs:\n  a:\n    runs-on: x\n";
  unreg("flow map, every key and value double-quoted", `on: { "push": {}, "schedule": [{ "cron": "0 0 * * *" }] }\n${J}`);
  unreg("flow map, only the schedule key quoted", `on: { push: {}, "schedule": [{ cron: "0 0 * * *" }] }\n${J}`);
  unreg("flow map with no spaces", `on: {"schedule": [{"cron": "0 0 * * *"}]}\n${J}`);
  unreg("flow map, single-quoted keys and values", `on: { 'push': {}, 'schedule': [{ 'cron': '0 0 * * *' }] }\n${J}`);
  unreg('block key `"schedule": [ { "cron": … } ]` on one line', `on:\n  push: {}\n  "schedule": [ { "cron": "0 0 * * *" } ]\n${J}`);
  unreg("block key `'schedule': [ { 'cron': … } ]` on one line", `on:\n  push: {}\n  'schedule': [ { 'cron': '0 0 * * *' } ]\n${J}`);
  unreg("sole quoted schedule key with a quoted cron on the line", `on:\n  "schedule": [{"cron": "5 4 * * *"}]\n${J}`);
  unreg("quoted complex keys `? \"schedule\"` / `\"cron\":`", `on:\n  push: {}\n  ? "schedule"\n  : - "cron": "0 0 * * *"\n${J}`);
  unreg("escaped keys (`\"sch\\x65dule\"` and `\"cr\\x6fn\"`, both hidden from a text match)", `on:\n  push: {}\n  "sch\\x65dule": [{ "cr\\x6fn": "0 0 * * *" }]\n${J}`);
  unreg("an escaped schedule key alone", `on:\n  push: {}\n  "sch\\x65dule":\n    - cron: "0 0 * * *"\n${J}`);
  // negative controls for the tokenizer: quote characters that are NOT string openers must not swallow later keys
  exits({ workflows: { "a.yml": `name: it's a dog's life\non:\n  push: {}\n  schedule:\n    - cron: "0 0 * * *"\n${J}` }, registry: reg() }, 1, "apostrophes inside a plain scalar do not hide a later schedule key (still found) → exit 1");
  exits({ workflows: { "a.yml": `name: N\non: { push: {} }\nenv:\n  NOTE: "a \\"quoted\\" cron: word"\n${J}` }, registry: reg() }, 0, "negative control: an escaped-quote string containing `cron:` is not a key → exit 0");
  // a shape the matcher cannot place at all: a cron it cannot attribute to a trigger must FAIL, not pass as unscheduled
  exits({ workflows: { "a.yml": `name: U\ntriggers:\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n` }, registry: reg() }, 1, "a cron the detector cannot attribute to an on: trigger → exit 1 (unreadable fails closed)");
  exits({ workflows: { "a.yml": `name: X\non:\n  push: {}\n  ? schedule\n  : - cron: "0 0 * * *"\njobs:\n  a:\n    runs-on: x\n` }, registry: reg() }, 1, "valid YAML complex-key `? schedule` under on: (a cron the structural read missed) → exit 1 (the cron fallback)");
  exits({ workflows: { "a.yml": `name: N\njobs:\n  a:\n    runs-on: x\n` }, registry: reg() }, 1, "a workflow with no on: key at all → exit 1 (unreadable fails closed)");
  // negative control for the fallback: the word cron inside a quoted string / run body is not a trigger
  exits({ workflows: { "a.yml": `name: D\non:\n  push: {}\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo "cron: nightly"\n` }, registry: reg() }, 0, "negative control: \`cron:\` inside a quoted string in a run line is not a schedule → exit 0");
  // an empty tree is not a clean tree
  exits({ workflows: {}, registry: reg(), noWorkflowsDir: true }, 1, "no .github/workflows directory and an empty registry → exit 1 (0 workflows is not green)");
  // wired means RUN, not mentioned
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)), preflight: '[{ name: "see scripts/w.mjs", cmd: ["node", "other.mjs"] }]' }, 1, "script named only in a preflight step's name: string is not wired → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)), preflight: '[{ cmd: ["node", "other.mjs"] }] /* scripts/w.mjs */' }, 1, "script named only in a preflight block comment is not wired → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(probe)), ci: "on:\n  push: {}\njobs:\n  a:\n    steps:\n      - name: node scripts/w.mjs\n        run: echo hi\n" }, 1, "script named only in a CI step name: is not wired → exit 1");
  // redWatcher: validated, and both directions exercised
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt({ redWatcher: "no-such-kind" }))) }, 1, "exempt with a redWatcher that is not an auto kind → exit 1");
  exits({ workflows: { "a.yml": SCHED_WF() }, registry: reg(entry(exempt({ redWatcher: "mac-lane-red" }))) }, 0, "control: exempt with a real redWatcher kind → exit 0");

  // run through a SYMLINK to the gate (macOS tmpdir is one): it must still produce its verdict, never print nothing and exit 0
  {
    const root = fixture({ workflows: { "a.yml": SCHED_WF(), "b.yml": SCHED_WF() }, registry: reg(entry(exempt())) });
    try {
      const link = join(root, "linked-gate.mjs");
      symlinkSync(fileURLToPath(import.meta.url), link);
      const r = spawnSync(process.execPath, [link, "--root", root, "--ref-date", REF], { encoding: "utf8" });
      note("run through a symlinked path: an unregistered workflow is still exit 1 with the gate's verdict", r.status === 1 && r.stderr.startsWith("✗ scheduled-workflow liveness:"), `exit ${r.status}, stdout ${JSON.stringify(r.stdout.slice(0, 40))}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // pure-function spot checks
  note("parseIsoDate rejects 2026-02-31", parseIsoDate("2026-02-31") === null);
  note("parseIsoDate rejects 2026-2-3", parseIsoDate("2026-2-3") === null);
  note("stripComments keeps a # inside quotes", stripComments('a: "x # y" # z') .trim() === 'a: "x # y"');

  // mutants of the gate itself: each must turn the self-test red
  if (!process.argv.includes("--no-mutants")) {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const tmp = mkdtempSync(join(realpathSync(tmpdir()), "swl-mut-"));
    try {
      const kindsUrl = pathToFileURL(join(here, "lib/raised-hand-kinds.mjs")).href;
      const mutants = [
        ["M:unregistered", "false &&", "an unregistered scheduled workflow is no longer reported"],
        ["M:stale-entry", "false &&", "a registry entry for an unscheduled workflow is no longer reported"],
        ["M:reason", "false &&", "an exemption without a reason is no longer reported"],
        ["M:stale-date", "false &&", "a stale exemption date is no longer reported"],
        ["M:script-exists", "false &&", "a missing watcher script is no longer reported"],
        ["M:wired", "false &&", "an unwired watcher script is no longer reported"],
        ["M:names-workflow", "false &&", "a watcher that never names the workflow is no longer reported"],
        ["M:duplicate", "false &&", "a duplicate entry is no longer reported"],
        ["M:unreadable", "false &&", "an unreadable workflow shape is no longer reported"],
        ["M:cron-fallback", "false &&", "a cron the matcher cannot place is no longer treated as unreadable"],
        ["M:wired-ci", "false &&", "a script not run by CI is no longer reported"],
        ["M:red-watcher", "false &&", "a bogus redWatcher kind is no longer reported"],
        ["M:empty-tree", "false &&", "an empty workflows tree is no longer reported"],
        ["M:escaped-key", "false &&", "an escaped-spelling key is no longer treated as unreadable"],
        ["M:keep-keys", "false &&", "the tokenizer blanks quoted keys along with quoted values"],
      ];
      for (const [token, repl, what] of mutants) {
        const marker = `/*${token}*/`;
        const count = src.split(marker).length - 1;
        if (count !== 1) {
          note(`mutant ${token}: marker appears exactly once in the gate`, false, `found ${count}`);
          continue;
        }
        const file = join(tmp, `${token.replace(/\W/g, "_")}.mjs`);
        writeFileSync(file, src.replace(marker, repl).replace('"./lib/raised-hand-kinds.mjs"', JSON.stringify(kindsUrl)));
        const r = spawnSync(process.execPath, [file, "--self-test", "--no-mutants"], { encoding: "utf8" });
        note(`mutant ${token} (${what}) turns the self-test red`, r.status === 1 && r.stdout.includes("self-test FAILED"), `exit ${r.status}${r.status === 1 ? "" : ", mutant did not run to a verdict"}`);
      }
      // a mutant of the entry guard: compare unresolved paths (the macOS tmpdir fail-open)
      const rp = "if (real(process.argv[1] ?? " + '"") === real(fileURLToPath(import.meta.url))) {';
      if (src.split(rp).length - 1 !== 1) note("mutant realpath: marker appears exactly once", false);
      else {
        const file = join(tmp, "realpath.mjs");
        writeFileSync(file, src.replace(rp, 'if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {').replace('"./lib/raised-hand-kinds.mjs"', JSON.stringify(kindsUrl)));
        const r = spawnSync(process.execPath, [file, "--self-test", "--no-mutants"], { encoding: "utf8" });
        note("mutant realpath (entry guard without real paths) turns the self-test red", r.status === 1 && r.stdout.includes("self-test FAILED"), `exit ${r.status}${r.status === 1 ? "" : ", mutant did not run to a verdict"}`);
      }
      // a mutant of the comment stripper: the decoy in a comment must stop being ignored
      const cm = 'c === "#" && (i === 0 || /\\s/.test(line[i - 1]))';
      if (src.split(cm).length - 1 !== 1) note("mutant comments: marker appears exactly once", false);
      else {
        const file = join(tmp, "comments.mjs");
        writeFileSync(file, src.replace(cm, "false").replace('"./lib/raised-hand-kinds.mjs"', JSON.stringify(kindsUrl)));
        const r = spawnSync(process.execPath, [file, "--self-test", "--no-mutants"], { encoding: "utf8" });
        note("mutant comments (comment stripping disabled) turns the self-test red", r.status === 1 && r.stdout.includes("self-test FAILED"), `exit ${r.status}${r.status === 1 ? "" : ", mutant did not run to a verdict"}`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  let bad = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) bad += 1;
    console.log(`  ${ok ? "ok" : "FAIL"} — ${name}${!ok && detail ? ` (${detail})` : ""}`);
  }
  console.log(`\nself-test ${bad === 0 ? "passed" : "FAILED"} (${results.length - bad}/${results.length})`);
  return bad === 0 ? 0 : 1;
}

// ── main ─────────────────────────────────────────────────────────────────────

// Real paths on BOTH sides: macOS tmpdir is a symlink (/var -> /private/var), argv[1] keeps the link and
// import.meta.url does not, so a plain comparison made the gate print nothing and exit 0 when run from a
// temp copy (the PR Mac-only preflight caught it on 2026-10-09). A guard that fails open is the defect here.
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if (real(process.argv[1] ?? "") === real(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  const rootAt = argv.indexOf("--root");
  const root = rootAt >= 0 ? resolve(argv[rootAt + 1] ?? ".") : resolve(here, "..");
  const refAt = argv.indexOf("--ref-date");
  const refDate = refAt >= 0 ? argv[refAt + 1] : headDate(root);
  const { problems, scheduled, registry } = run(root, refDate);
  if (problems.length > 0) {
    console.error(`✗ scheduled-workflow liveness: ${problems.length} problem(s)\n` + problems.map((p) => `    · ${p}`).join("\n"));
    process.exit(1);
  }
  const rows = [...scheduled].filter(([, v]) => v === "scheduled").map(([wf]) => registry.workflows.find((e) => e.workflow === wf) ?? { workflow: wf, watcher: { kind: "UNREGISTERED" } });
  console.log(`scheduled-workflow liveness: ${rows.length} scheduled workflow(s), each names its watcher (reference date ${refDate}):`);
  for (const e of rows) {
    const w = e.watcher;
    const how = w.kind === "exempt" ? `exempt (reviewed ${w.reviewedAt}${w.redWatcher ? `, red covered by hand ${w.redWatcher}` : ""})` : w.kind === "auto-hand" ? `auto-hand ${w.hand} via ${w.script}` : `api-probe via ${w.script}`;
    console.log(`  ${e.workflow.padEnd(28)} ${how}`);
  }
}

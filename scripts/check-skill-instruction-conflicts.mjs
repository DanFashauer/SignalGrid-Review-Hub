// check-skill-instruction-conflicts — a skill may not instruct Claude to run a
// command the Bash deny-list hook refuses.
//
//   node scripts/check-skill-instruction-conflicts.mjs             the gate
//   node scripts/check-skill-instruction-conflicts.mjs --self-test prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// `.claude/hooks/block-dangerous.sh` is a PreToolUse hook: it reads the Bash tool
// call Claude Code is about to make and answers `permissionDecision:"deny"` for a
// forbidden pattern. `.claude/skills/` holds 100 vendored upstream skills plus 17
// first-party ones (`.claude/skills/VENDORED.md` counts them), and a skill is a
// procedure Claude is told to FOLLOW. When a skill's numbered step is a command
// the hook denies, the two halves of the agent plane contradict each other: the
// instruction says do it, the hook says you may not. What happens then is not a
// clean stop — it is a session that reaches step 6 of a documented procedure and
// cannot complete it, and the documented recovery is to work around the hook,
// which CLAUDE.md forbids in the same breath ("Never bypass a check").
//
// Three such sites were in the tree the day this gate was written, and none of
// them was noticed by anything:
//
//   finishing-a-development-branch/SKILL.md   `git branch -D <feature-branch>`
//                                             — a ```bash step, denied outright
//   subagent-driven-development/SKILL.md      `rm -rf <workspace>` — the cleanup
//                                             step of the whole workflow
//   brainstorming/scripts/stop-server.sh      `rm -rf "$SESSION_DIR"` — a line in
//                                             a shell script a skill tells Claude
//                                             to run
//
// `scripts/check-hook-denylist.mjs` already holds `.claude/settings.json` and the
// hook to each other. Nothing held the SKILLS to the hook.
//
// WHAT IS GATED (unambiguous only)
// --------------------------------
// A candidate command that the hook, ASKED DIRECTLY, answers `deny` to, and whose
// `path:line` is not named in the `## Overrides` table of
// `.claude/skills/VENDORED.md`. Candidates are:
//
//   1. Every non-blank, non-comment line inside a ```bash / ```sh / ```shell /
//      ```console fence in any tracked file under `.claude/skills/`. A leading
//      `$ ` or `% ` shell prompt is stripped first. A line whose first non-space
//      character is `#` is a shell comment: it does not execute, so it is not an
//      invocation.
//   2. Every inline `code` span in prose, UNLESS the enclosing paragraph is a
//      MENTION (below).
//   3. Every non-blank, non-comment line of a tracked file that begins with a
//      `#!` shebang naming a shell. Those are scripts a skill hands to Claude to
//      run; the whole file is invocation, not documentation. Detected from the
//      file's own first line, never from a list of names.
//
// THE MENTION RULE — the gate must not punish honest writing
// ----------------------------------------------------------
// The repository has three recorded cases of a gate flagging a TRUE sentence: copy
// that correctly said "not evaluated today", a page carrying a proper scope
// disclaimer, and a list of phrases a seller must AVOID flagged for containing
// them. This gate walks straight into the third of those: `stack-reference/git-ci.md`
// is a whole document whose purpose is to NAME the commands the hook refuses, and
// `stack-reference/SKILL.md` line 35 opens "Banned and ask-first are not
// suggestions." followed by the banned commands in backticks. Flagging those would
// be the gate being wrong, not the docs.
//
// So an inline span is a MENTION, not an invocation, when its enclosing PARAGRAPH
// (the run of contiguous non-blank prose lines around it, not merely the physical
// line — the idiom wraps, and `stack-reference/SKILL.md:36` carries three banned
// spans on the continuation of a sentence whose warning word is on line 35)
// contains any of, case-insensitively:
//
//   never · don't / don’t · do not · doesn't · forbidden · hazard · avoid ·
//   banned · deny / denies / denied (this is how "hook-denied" is written here) ·
//   refuse / refuses / refused · must not · not allowed · ask-first ·
//   **SAYS** (the stack-reference idiom: "the generic cheatsheet SAYS this, and
//   here is why it BREAKS here")
//
// The rule applies to inline spans ONLY. A line inside a ```bash fence is a step
// to execute; a warning word elsewhere in the prose around it does not make it
// stop executing. Widening the exemption to fences is how a gate stops catching
// the thing it exists for.
//
// WHAT IS NOT GATED — said out loud
// ---------------------------------
//   · The hook's own coverage. This gate retypes NOTHING from the pattern list;
//     it spawns `bash .claude/hooks/block-dangerous.sh` with the same stdin JSON
//     Claude Code sends and reads the answer. A pattern the hook misses (one
//     assembled from a variable, one split across a here-doc — the hook says so
//     itself) is missed here too, by construction. That is deliberate: a second
//     copy of the pattern list is the fossil `check-hook-denylist.mjs` exists to
//     prevent.
//   · Placeholder-ness. `rm -rf <workspace>` is judged as written. The hook denies
//     it, so it is flagged; whether the author meant a literal or a template is a
//     judgement, and the release valve for a judgement is an Overrides row with a
//     reason, not a heuristic in here.
//   · Non-shell executable content. A `.js` / `.ts` / `.cjs` file under skills is
//     read with the markdown rules (fences and backtick spans) — backticks in JS
//     are template literals, not code spans, so those files contribute noise-free
//     nothing in practice, and a dangerous `child_process` call inside one is NOT
//     seen. Only `#!`-shell files get the whole-file treatment.
//   · Whether an Overrides row is JUSTIFIED. The table is trusted; only its
//     existence and shape are read.
//   · Whether an Overrides row is STALE. Deliberately NOT reported. That table is
//     the general record of every vendored instruction that does not apply here —
//     "commit your work", "npm test", an Unsplash fetch — and only a handful of
//     its rows are deny-list conflicts at all (2 of 22 on 2026-09-06). Reporting
//     the other 20 as fossils would be this gate being wrong about writing that is
//     entirely correct, which is the failure mode this repository has hit three
//     times in one day.
//   · Multi-site and glob rows. A first cell naming several sites at once
//     (`server.cjs:106-112, :247-249`) or a brace glob (`test-pressure-{1,2,3}.md:3`)
//     does NOT parse, and therefore grants NO exemption. A path segment may not
//     contain a colon. If a deny-list conflict needs exempting, give it its own row
//     with a single `path:line` or `path:line-line`.
//
// SCOPE IS DERIVED, NEVER LISTED. The file set is `git ls-files .claude/skills` —
// tracked paths only, because only tracked paths publish and only tracked paths
// load for another clone. Nothing here names a skill directory.
//
// FAIL-CLOSED. A hook that cannot be spawned, that exits non-zero, or that answers
// something this gate cannot parse is FATAL, not a skip: the whole judgement rests
// on that one subprocess, and an unreadable answer is the loosest state it has.
// Two live probes run BEFORE the scan on every invocation — one command the hook
// must deny and one it must allow — so a hook that has been neutered cannot let
// this gate print a green summary about nothing.
//
// FLOORS. Fewer than 20 tracked skill files, or fewer than 200 JUDGEABLE
// candidates, and the gate REFUSES rather than reporting zero: that is the
// derivation having drifted, not the tree having got clean. Measured 2026-09-06:
// 73 files, 1066 judged, 1527 further inline spans read as mentions. Do not retype
// those numbers anywhere — the summary line prints the current ones.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = ".claude/hooks/block-dangerous.sh";
const SKILLS_DIR = ".claude/skills";
const VENDORED = ".claude/skills/VENDORED.md";

const FILE_FLOOR = 20;
const CANDIDATE_FLOOR = 200;
const CONCURRENCY = 8;
// A hook that never closes hangs this Promise — and with it the whole gate and all
// of preflight — forever. Reported by the Mac lane 2026-09-13: a ReDoS in the
// deny-list hook's unwrap loop hung it on one command under BSD sed. A hung hook is
// neither pass nor fail; the doctrine is fail-closed, so a timeout is FATAL.
const HOOK_TIMEOUT_MS = 10000;

const FENCE_LANGS = new Set(["bash", "sh", "shell", "console"]);

// Each term below is here because a real line in this tree needed it. See the
// MENTION RULE block in the header for the sites.
export const MENTION_RE =
  /\bnever\b|\bdon['’]t\b|\bdo not\b|\bdoesn['’]t\b|\bforbidden\b|\bhazard\w*\b|\bavoid\w*\b|\bbanned\b|\bden(?:y|ies|ied)\b|\brefus(?:e|es|ed)\b|\bmust not\b|\bnot allowed\b|\bask-first\b|\*\*SAYS\*\*/i;

const SHEBANG_SHELL_RE = /^#!.*\b(?:ba|z|da|k)?sh\b/;
const PROMPT_RE = /^[$%]\s+/;

// ── candidate extraction (pure) ──────────────────────────────────────────────

/**
 * Every Bash INVOCATION a file instructs Claude to run.
 * @param {string} text file contents
 * @returns {{line:number, kind:"fence"|"inline"|"script", lang:string|null,
 *            command:string, source:string, mention:boolean}[]}
 */
export function extractCandidates(text) {
  const lines = text.split("\n");

  // A shell script is invocation top to bottom; markdown rules do not apply.
  if (SHEBANG_SHELL_RE.test(lines[0] ?? "")) {
    const out = [];
    lines.forEach((line, i) => {
      const body = line.trim();
      if (!body || body.startsWith("#")) return;
      out.push({ line: i + 1, kind: "script", lang: "sh", command: body, source: line, mention: false });
    });
    return out;
  }

  // Pass 1 — which lines are fence markers, and which fence (if any) each line
  // is inside. A closing marker is the same character, at least as long, and
  // carries no info string; that keeps a ```` ```` ```` wrapper around a ```bash
  // block from closing on the inner fence.
  const fenceLang = new Array(lines.length).fill(null);
  const isMarker = new Array(lines.length).fill(false);
  let open = null;
  lines.forEach((line, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (m) {
      const char = m[1][0];
      const len = m[1].length;
      const info = m[2].toLowerCase();
      if (open === null) {
        open = { char, len, lang: info };
        isMarker[i] = true;
        return;
      }
      if (char === open.char && len >= open.len && info === "") {
        open = null;
        isMarker[i] = true;
        return;
      }
    }
    if (open !== null) fenceLang[i] = open.lang;
  });

  // Pass 2 — paragraphs: maximal runs of contiguous non-blank prose lines.
  const paragraphs = [];
  let start = null;
  for (let i = 0; i <= lines.length; i += 1) {
    const isProse = i < lines.length && fenceLang[i] === null && !isMarker[i] && lines[i].trim() !== "";
    if (isProse) {
      if (start === null) start = i;
      continue;
    }
    if (start !== null) {
      paragraphs.push({ startLine: start, text: lines.slice(start, i).join("\n") });
      start = null;
    }
  }

  const out = [];

  // Pass 3a — fenced steps, line by line.
  lines.forEach((line, i) => {
    if (isMarker[i]) return;
    const lang = fenceLang[i];
    if (lang === null || !FENCE_LANGS.has(lang)) return;
    const body = line.trim().replace(PROMPT_RE, "");
    if (!body || body.startsWith("#")) return;
    out.push({ line: i + 1, kind: "fence", lang, command: body, source: line, mention: false });
  });

  // Pass 3b — inline spans, paired across the WHOLE paragraph rather than per
  // line. A span may wrap (`git push origin --delete\n   <branch>`), and pairing
  // per line leaves an odd backtick behind that desynchronises every later span
  // on that line — which is how `git-ci.md:47`'s `git branch -D` was invisible to
  // the first version of this gate. The span is attributed to the line it OPENS
  // on, and its internal newline+indent is collapsed to one space (the hook
  // collapses whitespace itself, so this only changes what is printed).
  for (const p of paragraphs) {
    const mention = MENTION_RE.test(p.text);
    for (const m of p.text.matchAll(/`([^`]+)`/g)) {
      const body = m[1].replace(/\s+/g, " ").trim().replace(PROMPT_RE, "");
      if (!body) continue;
      const line = p.startLine + p.text.slice(0, m.index).split("\n").length;
      out.push({ line, kind: "inline", lang: null, command: body, source: lines[line - 1] ?? "", mention });
    }
  }

  out.sort((a, b) => a.line - b.line);
  return out;
}

// ── the Overrides table (pure) ───────────────────────────────────────────────

/**
 * Rows of the `## Overrides` table in VENDORED.md whose first cell is a backticked
 * `path:line` or `path:line-line`, path relative to `.claude/skills/`. The section
 * is optional; absent means no overrides, not an error.
 * @param {string} vendoredText
 * @returns {{present:boolean, entries:{path:string,start:number,end:number,raw:string}[]}}
 */
export function parseOverrides(vendoredText) {
  const lines = vendoredText.split("\n").map((l) => l.replace(/^\s*>\s?/, ""));
  const head = lines.findIndex((l) => /^#{2,}\s+Overrides\b/i.test(l));
  if (head === -1) return { present: false, entries: [] };
  const entries = [];
  for (let i = head + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+\S/.test(lines[i])) break;
    const row = lines[i].trim();
    if (!row.startsWith("|")) continue;
    const first = row.split("|")[1]?.trim() ?? "";
    const code = /^`([^`]+)`$/.exec(first);
    if (!code) continue;
    // A path segment may not contain a colon, so a multi-site cell
    // (`a.md:1, :2`) does not parse and grants nothing. See the header.
    const site = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(code[1].trim());
    if (!site) continue;
    entries.push({
      path: site[1].replace(/^\.?\/*/, ""),
      start: Number(site[2]),
      end: site[3] ? Number(site[3]) : Number(site[2]),
      raw: code[1].trim(),
    });
  }
  return { present: true, entries };
}

/** Does an Overrides entry cover this site? Paths are relative to .claude/skills/. */
export function isOverridden(entries, relPathFromSkills, line) {
  return entries.some((e) => e.path === relPathFromSkills && line >= e.start && line <= e.end);
}

// ── asking the hook (impure, fail-closed) ────────────────────────────────────

/** Every hook failure. `closeConfirmed` is STRUCTURED cleanup state, never inferred
 *  from a message or a clock: true when this call's child was positively observed to
 *  CLOSE (or no child was ever started); false when the call was stopped and its
 *  close grace ran out without a close event — cleanup UNCONFIRMED (#2264). An
 *  unconfirmed failure forbids any retry and any new work. */
class HookFatal extends Error {
  constructor(message, { closeConfirmed = true } = {}) {
    super(message);
    this.closeConfirmed = closeConfirmed;
  }
}
/** A call stopped because ANOTHER call in the same pool failed first. It is still a
 *  HookFatal (an unanswered call is never an allow), but judgeAll never rethrows it:
 *  the first genuine failure is the one reported. */
class HookCancelled extends HookFatal {}

// After a call is stopped (timeout, cancellation, delivery error) its rejection waits
// for the child's 'close' — the point at which the bash and every descendant still
// holding its stdio are gone. If 'close' does not come within this grace, the call
// rejects anyway, SAYING it did not close: fail-closed, never a hang. Not a verdict
// budget — the per-call deadline is still HOOK_TIMEOUT_MS.
const CLOSE_GRACE_MS = 5000;

/** One PreToolUse call, shaped exactly as Claude Code sends it.
 *  @param {number} [timeoutMs] override for the self-test only; the real default
 *    is HOOK_TIMEOUT_MS. A hook that does not close within it is killed and the
 *    call rejects fail-closed, naming the command — never hangs, never allows.
 *  @param {{signal?: AbortSignal, closeGraceMs?: number}} [opts] `signal` cancels
 *    the call (judgeAll aborts the pool on its first failure). Every outcome — a
 *    verdict, a timeout, a cancellation, a delivery error — settles only after this
 *    call's child has CLOSED, or after the bounded close grace says it did not
 *    (#2264). */
function askHook(hookPath, command, timeoutMs = HOOK_TIMEOUT_MS, { signal, closeGraceMs = CLOSE_GRACE_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new HookCancelled(`${hookPath} was not asked about ${JSON.stringify(command)}: the pool had already failed.`));
      return;
    }
    // detached:true makes the child its own process-group leader, so a hung
    // DESCENDANT (the BSD sed in the deny hook, Codex #716) can be killed with it.
    const child = spawn("bash", [hookPath], { cwd: repo, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    // `failure` is the first reason this call cannot produce a verdict. Recording it
    // does NOT settle the Promise: settlement waits for 'close' (or the close grace),
    // so no caller — the pool, the retry — acts while this call's processes live.
    let failure = null;
    let settled = false;
    let graceTimer = null;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      signal?.removeEventListener("abort", onAbort);
      fn(arg);
    };
    // Kill the whole process group (negative pid), not just the bash we spawned —
    // otherwise a hung descendant (the BSD sed, Codex #716) is orphaned and keeps
    // consuming CPU. Fall back to the child alone if the group is already gone.
    // Only THIS call's own group is targeted: ownership is the pid we spawned.
    const killOwnGroup = () => {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { try { child.kill("SIGKILL"); } catch { /* already exited */ } }
    };
    const stop = (err) => {
      if (failure || settled) return;
      failure = err;
      if (child.pid !== undefined) killOwnGroup();
      graceTimer = setTimeout(() => {
        // A grace expiring is NOT a close event: the result says so in structure.
        settle(reject, new HookFatal(`${err.message} The call did not close within ${closeGraceMs}ms of being stopped — cleanup unconfirmed.`, { closeConfirmed: false }));
      }, closeGraceMs);
    };
    const timer = setTimeout(() => {
      stop(new HookFatal(`${hookPath} did not answer within ${timeoutMs}ms judging ${JSON.stringify(command)} — it hung (fail-closed).`));
    }, timeoutMs);
    const onAbort = () => stop(new HookCancelled(`${hookPath} call for ${JSON.stringify(command)} was cancelled because another call in the pool failed.`));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => {
      const err = new HookFatal(`could not execute ${hookPath}: ${e.message}`);
      // No pid: nothing was started, so there is nothing to wait for.
      if (child.pid === undefined) settle(reject, err);
      else stop(err);
    });
    // The write below can fail (EPIPE) when the child is gone before the payload lands —
    // seen 2026-09-12 under three parallel preflights, where it surfaced as an UNHANDLED
    // 'error' event that crashed the self-test instead of a gate verdict. An unasked hook
    // is a hook that could not be executed: FATAL, fail-closed, never an allow. The
    // rejection still waits for this call to close, so a retry never overlaps it.
    child.stdin.on("error", (e) => stop(new HookFatal(`could not deliver the call to ${hookPath}: ${e.code ?? e.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      if (failure) {
        settle(reject, failure);
        return;
      }
      if (code !== 0) {
        settle(reject, new HookFatal(`${hookPath} exited ${code} judging ${JSON.stringify(command)} — stderr: ${stderr.trim()}`));
        return;
      }
      const raw = stdout.trim();
      if (raw === "") {
        settle(resolvePromise, false);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        settle(reject, new HookFatal(`${hookPath} answered something this gate cannot parse as JSON: ${raw.slice(0, 200)}`));
        return;
      }
      const decision = parsed?.hookSpecificOutput?.permissionDecision;
      if (decision === "deny") settle(resolvePromise, true);
      else if (decision === undefined || decision === "allow") settle(resolvePromise, false);
      else settle(reject, new HookFatal(`${hookPath} answered permissionDecision=${JSON.stringify(decision)}, which this gate cannot judge`));
    });
    child.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
  });
}

/** One retry for the transient delivery failures a loaded box produces (EPIPE, EAGAIN);
 *  a second failure, or any other HookFatal, stays fatal. askHook settles only after
 *  the original call has closed, so the retry never overlaps it (#2264). A cancelled
 *  call is never retried. */
async function askHookRetrying(hookPath, command, signal, { timeoutMs = HOOK_TIMEOUT_MS, closeGraceMs = CLOSE_GRACE_MS, onCall } = {}) {
  const ask = () => { onCall?.(); return askHook(hookPath, command, timeoutMs, { signal, closeGraceMs }); };
  try {
    return await ask();
  } catch (e) {
    if (!(e instanceof HookFatal) || e instanceof HookCancelled || !/EPIPE|EAGAIN/.test(e.message)) throw e;
    // The retry is permitted ONLY on positive evidence that the original call closed.
    if (e.closeConfirmed !== true || signal?.aborted) throw e;
    await new Promise((r) => setTimeout(r, 250));
    return ask();
  }
}

/** Judge many commands, deduplicated, with a small pool. Map<command, boolean>.
 *  On the FIRST failure the pool stops scheduling, cancels every running peer
 *  through one shared signal (each peer kills only its own process group), and
 *  JOINS every worker before rethrowing that first failure — it never returns while
 *  a call it started is still running (#2264). */
export async function judgeAll(hookPath, commands, { closeGraceMs = CLOSE_GRACE_MS } = {}) {
  const unique = [...new Set(commands)];
  const verdict = new Map();
  const controller = new AbortController();
  let firstFailure = null;
  // Started calls whose cleanup could NOT be confirmed. allSettled only proves every
  // worker's promise settled; this list is what says whether every call CLOSED.
  const unconfirmed = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (firstFailure) return;
      const i = next;
      next += 1;
      if (i >= unique.length) return;
      try {
        verdict.set(unique[i], await askHookRetrying(hookPath, unique[i], controller.signal, { closeGraceMs }));
      } catch (e) {
        if (e instanceof HookFatal && e.closeConfirmed === false) unconfirmed.push(unique[i]);
        if (!firstFailure) {
          firstFailure = e;
          controller.abort();
        }
        return;
      }
    }
  };
  await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, unique.length || 1) }, worker));
  if (unconfirmed.length > 0) {
    // Never report an all-closed pool when it is not: quiescence stays UNVERIFIED.
    throw new HookFatal(
      `${firstFailure.message} | quiescence UNVERIFIED: ${unconfirmed.length} started call(s) did not confirm close (${unconfirmed.map((c) => JSON.stringify(c)).join(", ")}).`,
      { closeConfirmed: false },
    );
  }
  if (firstFailure) throw firstFailure;
  return verdict;
}

/**
 * The live capability probes. A hook that no longer denies what it must, or that
 * denies a harmless command, cannot be used to judge anything.
 */
async function proveHookWorks(hookPath) {
  const mustDeny = "rm -" + "rf /tmp/signalgrid-gate-probe";
  const mustAllow = "echo signalgrid-gate-probe";
  if (!(await askHook(hookPath, mustDeny))) {
    throw new HookFatal(`${hookPath} did NOT deny ${JSON.stringify(mustDeny)} — the deny list cannot be used to judge skills.`);
  }
  if (await askHook(hookPath, mustAllow)) {
    throw new HookFatal(`${hookPath} denied the harmless probe ${JSON.stringify(mustAllow)} — every candidate would look denied.`);
  }
}

// ── the scan ─────────────────────────────────────────────────────────────────

function trackedSkillFiles() {
  const out = execFileSync("git", ["ls-files", "--", SKILLS_DIR], { cwd: repo, encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{path:string, text:string}[]} files paths repo-relative
 * @param {Map<string, boolean>|((c:string)=>boolean)} verdict
 * @param {{path:string,start:number,end:number,raw:string}[]} overrides
 */
export function collect(files, verdict, overrides) {
  const deniedFor = typeof verdict === "function" ? verdict : (c) => verdict.get(c) === true;
  const findings = [];
  const overriddenHits = [];
  const mentionsDenied = [];
  let judged = 0;
  let mentions = 0;
  for (const f of files) {
    const rel = f.path.startsWith(`${SKILLS_DIR}/`) ? f.path.slice(SKILLS_DIR.length + 1) : f.path;
    for (const c of extractCandidates(f.text)) {
      const hit = { file: f.path, rel, ...c };
      if (c.mention) {
        mentions += 1;
        // What the mention exemption COSTS, made visible rather than invisible:
        // a span the hook would deny, suppressed because its paragraph warns
        // against it. If this list ever stops looking like documentation, the
        // exemption is too wide.
        if (deniedFor(c.command)) mentionsDenied.push(hit);
        continue;
      }
      judged += 1;
      if (!deniedFor(c.command)) continue;
      if (isOverridden(overrides, rel, c.line)) overriddenHits.push(hit);
      else findings.push(hit);
    }
  }
  return { findings, overriddenHits, mentionsDenied, judged, mentions };
}

// A command the deny list refuses, assembled so this file never contains it whole.
const PLANTED_DENIED = "rm -" + "rf x";

/** The plant proof: `files` plus ONE fenced step (`plantedCommand`) appended to the first
 *  SKILL.md must yield exactly one MORE finding than `files` alone. `verdict` holds the
 *  answers THIS process already got from THIS hook for the unplanted files; only commands
 *  it lacks are asked now, so the proof costs the planted step's own hook call(s) and
 *  never re-judges the tree. Nothing is read from disk or from another invocation.
 *  @returns {Promise<{ok: boolean, before: number, after: number, asked: number}>} */
export async function plantProof(hookPath, files, verdict, plantedCommand = PLANTED_DENIED) {
  const victim = files.find((f) => f.path.endsWith("/SKILL.md"));
  if (!victim) return { ok: false, before: 0, after: 0, asked: 0 };
  const plantedFiles = files.map((f) =>
    f === victim ? { path: f.path, text: `${f.text}\n\`\`\`bash\n${plantedCommand}\n\`\`\`\n` } : f,
  );
  const needed = [...files, ...plantedFiles].flatMap((f) => extractCandidates(f.text)).filter((c) => !c.mention).map((c) => c.command);
  const missing = [...new Set(needed)].filter((c) => !verdict.has(c));
  const all = new Map(verdict);
  for (const [command, denied] of await judgeAll(hookPath, missing)) all.set(command, denied);
  const before = collect(files, all, []).findings.length;
  const after = collect(plantedFiles, all, []).findings.length;
  return { ok: after === before + 1, before, after, asked: missing.length };
}

async function run() {
  const hookPath = resolve(repo, HOOK);
  if (!existsSync(hookPath)) {
    console.error(`✗ ${HOOK} is missing — there is no deny list to hold the skills to, which is the loosest state this can be in.`);
    process.exit(1);
  }
  await proveHookWorks(hookPath);

  const paths = trackedSkillFiles();
  if (paths.length < FILE_FLOOR) {
    console.error(`✗ only ${paths.length} tracked files under ${SKILLS_DIR}/ (floor ${FILE_FLOOR}) — the derivation drifted; refusing to report a clean scan of almost nothing.`);
    process.exit(1);
  }
  const files = paths.map((p) => ({ path: p, text: readFileSync(resolve(repo, p), "utf8") }));

  const allCandidates = files.flatMap((f) => extractCandidates(f.text));
  const judgeable = allCandidates.filter((c) => !c.mention);
  if (judgeable.length < CANDIDATE_FLOOR) {
    console.error(`✗ only ${judgeable.length} candidate invocations found (floor ${CANDIDATE_FLOOR}) across ${paths.length} files — the fence/inline parse drifted; refusing to conclude.`);
    process.exit(1);
  }

  const vendoredPath = resolve(repo, VENDORED);
  const overrides = existsSync(vendoredPath)
    ? parseOverrides(readFileSync(vendoredPath, "utf8"))
    : { present: false, entries: [] };

  // Mentions are judged too — not to gate them, but so the cost of the exemption
  // is a printed number instead of an invisible one.
  const verdict = await judgeAll(hookPath, allCandidates.map((c) => c.command));
  const { findings, overriddenHits, mentionsDenied, judged, mentions } = collect(files, verdict, overrides.entries);

  console.log(
    `skill↔deny-list: ${files.length} files, ${judged} candidates judged, ` +
      `${findings.length + overriddenHits.length} denied, ${overriddenHits.length} overridden ` +
      `(${mentions} inline spans read as mentions, not invocations; ` +
      `Overrides section ${overrides.present ? `present, ${overrides.entries.length} parsed row(s)` : "absent"})`,
  );

  // The plant proof against the REAL tree runs here, in the process that just judged the
  // real tree with this hook. It used to live in --self-test, which re-judged all ~10k
  // unique commands for it: a second full scan per preflight (240 s on a hosted macOS VM).
  const plant = await plantProof(hookPath, files, verdict);
  console.log(`  ${plant.ok ? "✓" : "✗"} planting one denied step into a real skill adds exactly one finding (${plant.before} → ${plant.after})`);
  if (!plant.ok) {
    console.error("✗ the real-tree plant proof failed — a denied step planted into a real skill was not reported as exactly one new finding; this scan cannot be trusted to see one.");
    process.exit(1);
  }

  for (const h of overriddenHits) {
    console.log(`  overridden: ${h.file}:${h.line}  ${h.command}`);
  }
  if (mentionsDenied.length > 0) {
    console.log(`  REPORTED, never gated — ${mentionsDenied.length} span(s) the hook WOULD deny, exempted because the surrounding paragraph warns against them:`);
    for (const h of mentionsDenied) console.log(`    ${h.file}:${h.line}  ${h.command}`);
  }

  if (findings.length > 0) {
    console.error(`✗ ${findings.length} skill instruction(s) the Bash deny list refuses:`);
    for (const h of findings) {
      console.error(`  ${h.file}:${h.line}  [${h.kind}${h.lang ? `:${h.lang}` : ""}]  ${h.command}`);
    }
    console.error("");
    console.error(`  Each is a step Claude is told to take and is then denied at PreToolUse.`);
    console.error(`  Fix the skill, or add a row to the \`## Overrides\` table in ${VENDORED}`);
    console.error(`  whose first cell is the backticked path:line (path relative to ${SKILLS_DIR}/) and`);
    console.error(`  whose remaining cells say why the conflict is acceptable.`);
    process.exit(1);
  }
  console.log("✓ no tracked skill instructs a command the deny list refuses.");
}

// ── self-test ────────────────────────────────────────────────────────────────
// Both directions, against the REAL hook: a planted invocation must be flagged,
// the same string in prose must not, an overridden site must not, an unusable
// hook must be fatal, and a too-small scope must refuse.

async function selfTest() {
  const hookPath = resolve(repo, HOOK);
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  };

  if (!existsSync(hookPath)) {
    console.error(`  ✗ ${HOOK} is missing; the self-test cannot run against the real hook.`);
    process.exit(1);
  }

  const BAD = PLANTED_DENIED;

  // 1. planted invocation inside a bash fence → flagged
  const planted = ["# Fixture", "", "Run the cleanup step:", "", "```bash", BAD, "```", ""].join("\n");
  // 2. the same string in a "never run" prose line → not flagged
  const prose = ["# Fixture", "", `Never run \`${BAD}\` here; it destroys the workspace.`, ""].join("\n");
  // 3. the wrapped-mention idiom this repo actually writes
  const wrapped = [
    "# Fixture",
    "",
    "2. **Banned and ask-first are not suggestions.** `git reset --hard`, `git stash`",
    "   (all forms), `--no-verify`, `--force` — each is hook-denied.",
    "",
  ].join("\n");

  const files = [
    { path: `${SKILLS_DIR}/fixture/planted.md`, text: planted },
    { path: `${SKILLS_DIR}/fixture/prose.md`, text: prose },
    { path: `${SKILLS_DIR}/fixture/wrapped.md`, text: wrapped },
  ];
  const cands = files.flatMap((f) => extractCandidates(f.text));
  const verdict = await judgeAll(hookPath, cands.map((c) => c.command));

  const noOverride = collect(files, verdict, []);
  check(
    "a planted invocation inside a ```bash fence is FLAGGED",
    noOverride.findings.length === 1 &&
      noOverride.findings[0].file.endsWith("planted.md") &&
      noOverride.findings[0].line === 6,
    `got ${JSON.stringify(noOverride.findings.map((f) => `${f.file}:${f.line}`))}`,
  );
  check(
    'the same string in a "never run `…`" prose line is NOT flagged',
    !noOverride.findings.some((f) => f.file.endsWith("prose.md")),
  );
  check(
    "the wrapped Banned/hook-denied idiom is NOT flagged, including its continuation line",
    !noOverride.findings.some((f) => f.file.endsWith("wrapped.md")),
    `got ${JSON.stringify(noOverride.findings.filter((f) => f.file.endsWith("wrapped.md")).map((f) => `${f.file}:${f.line} ${f.command}`))}`,
  );
  // The exemption must be doing real work, not passing because the spans were
  // harmless: at least one suppressed span on EACH line must be one the hook
  // genuinely denies — line 3 (where the warning word is) and line 4 (the
  // continuation, which carries no warning word of its own).
  const wrappedMentionLines = new Set(
    noOverride.mentionsDenied.filter((h) => h.file.endsWith("wrapped.md")).map((h) => h.line),
  );
  check(
    "the mention exemption is suppressing spans the hook really denies, on the warning line AND its continuation",
    wrappedMentionLines.has(3) && wrappedMentionLines.has(4),
    `denied-but-exempted lines: ${JSON.stringify([...wrappedMentionLines])}`,
  );

  // 4. the same planted site, overridden → not flagged, and counted as overridden
  const withOverride = collect(files, verdict, [{ path: "fixture/planted.md", start: 6, end: 6, raw: "fixture/planted.md:6" }]);
  check(
    "an overridden site is NOT flagged and is counted as overridden",
    withOverride.findings.length === 0 && withOverride.overriddenHits.length === 1,
    `findings=${withOverride.findings.length} overridden=${withOverride.overriddenHits.length}`,
  );
  const rangeOverride = collect(files, verdict, [{ path: "fixture/planted.md", start: 1, end: 20, raw: "fixture/planted.md:1-20" }]);
  check("a path:line-line RANGE override covers the site", rangeOverride.findings.length === 0);

  // 5. the Overrides table parser, both shapes and the absent case
  const table = [
    "## Overrides",
    "",
    "| Site | Why |",
    "| --- | --- |",
    "| `finishing-a-development-branch/SKILL.md:156` | vendored, upstream |",
    "| `subagent-driven-development/SKILL.md:480-490` | vendored, upstream |",
    "| not-backticked/SKILL.md:1 | ignored |",
    "",
    "## Something else",
    "| `never/parsed.md:9` | past the section |",
  ].join("\n");
  const parsed = parseOverrides(table);
  check(
    "parseOverrides reads path:line and path:line-line, ignores unbackticked rows, stops at the next heading",
    parsed.present &&
      parsed.entries.length === 2 &&
      parsed.entries[0].start === 156 &&
      parsed.entries[0].end === 156 &&
      parsed.entries[1].start === 480 &&
      parsed.entries[1].end === 490,
    JSON.stringify(parsed),
  );
  check("an absent ## Overrides section parses as absent, not as an error", parseOverrides("# Vendored\n\nno table here\n").present === false);

  // 6. a #!-shell file is invocation top to bottom; its comments are not
  const script = ["#!/usr/bin/env bash", "set -euo pipefail", `# ${BAD}   <- a comment, not a step`, BAD, ""].join("\n");
  const scriptCands = extractCandidates(script).filter((c) => !c.mention);
  const scriptVerdict = await judgeAll(hookPath, scriptCands.map((c) => c.command));
  const scriptHits = collect([{ path: `${SKILLS_DIR}/fixture/s.sh`, text: script }], scriptVerdict, []);
  check(
    "a #!-shell file flags the executable line and NOT the commented one",
    scriptHits.findings.length === 1 && scriptHits.findings[0].line === 4,
    `got ${JSON.stringify(scriptHits.findings.map((f) => `${f.file}:${f.line}`))}`,
  );

  // 7. a hook that cannot be executed is FATAL, never a silent pass
  let fatal = false;
  try {
    await askHook(resolve(repo, ".claude/hooks/does-not-exist.sh"), "echo hi");
  } catch (e) {
    fatal = e instanceof HookFatal;
  }
  check("a hook that cannot be executed is FATAL (fail-closed), not an allow", fatal);

  // 7b. a hook that HANGS (never closes) must be killed and rejected within the
  //     timeout, NAMING the command — not left to hang the gate and preflight
  //     forever. Reported by the Mac lane 2026-09-13 (ReDoS in the deny-list hook
  //     under BSD sed). A short injected timeout keeps this test fast; the real
  //     default (HOOK_TIMEOUT_MS) is untouched.
  // mkdtempSync creates a fresh 0700 directory with an unpredictable suffix — no
  // predictable path in the shared temp dir for another process to pre-create or
  // symlink-race (js/insecure-temporary-file, CodeQL #716).
  const hangDir = mkdtempSync(resolve(tmpdir(), "sg-hang-hook-"));
  const hangStub = resolve(hangDir, "hook.sh");
  // A UNIQUE sleep duration → a marker no OTHER concurrent preflight can match.
  // A fixed marker (e.g. "sleep 314.159") collides when two preflights run at once:
  // each pgrep -f / pkill -f would see or kill the other test's descendant (Codex
  // #716). process.pid is distinct per concurrent run; a random suffix guards pid
  // reuse. Plain `sleep` (no exec) so bash FORKS it as a descendant — the orphan
  // case: killing only the bash would leave this sleep running.
  const hangMarker = `sleep 300.${process.pid}${Math.floor(Math.random() * 1e6)}`;
  writeFileSync(hangStub, `${hangMarker}\n`);
  const hangCommand = "echo this-command-name-must-appear";
  let hangFatal = false;
  let hangNamed = false;
  const hangStarted = Date.now();
  try {
    await askHook(hangStub, hangCommand, 1000);
  } catch (e) {
    hangFatal = e instanceof HookFatal;
    hangNamed = e instanceof HookFatal && e.message.includes(JSON.stringify(hangCommand));
  }
  const hangElapsed = Date.now() - hangStarted;
  check(
    "a hook that HANGS is killed and REJECTS with HookFatal within the timeout, naming the command",
    hangFatal && hangNamed && hangElapsed < 5000,
    `fatal=${hangFatal} named=${hangNamed} elapsed=${hangElapsed}ms`,
  );

  // The whole process GROUP must die, not just the bash we spawned — else the forked
  // `sleep` (stand-in for the hung BSD sed, Codex #716) is orphaned and keeps burning
  // CPU. Confirm the descendant is gone. A positive control on this very node process
  // guards against an absent pgrep making the check pass vacuously.
  let pgrepUsable = false;
  try { execFileSync("pgrep", ["-f", "node"], { stdio: "ignore" }); pgrepUsable = true; }
  catch (e) { pgrepUsable = e?.status === 1; /* ran but no match = usable; ENOENT = absent */ }
  let descendantReaped = false;
  if (pgrepUsable) {
    for (let i = 0; i < 40; i++) {
      let present = false;
      try { execFileSync("pgrep", ["-f", hangMarker], { stdio: "ignore" }); present = true; } catch { present = false; }
      if (!present) { descendantReaped = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!descendantReaped) { try { execFileSync("pkill", ["-f", hangMarker], { stdio: "ignore" }); } catch { /* cleanup */ } }
  }
  try { rmSync(hangDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  check(
    "a hung hook's whole process GROUP is killed — no orphaned descendant survives (Codex #716)",
    pgrepUsable ? descendantReaped : true,
    pgrepUsable ? `reaped=${descendantReaped}` : "pgrep unavailable — descendant check skipped",
  );

  // 7c–7e. LIFECYCLE (#2264): a call's result — a verdict, a timeout, a delivery error,
  //     a pool's first failure — is used only AFTER every child this process owns for
  //     it has CLOSED. Before this, the first fatal call rejected the pool while its
  //     detached peers were still running, a timeout rejected before the killed child
  //     closed, and a delivery-error retry started before the original call closed.
  //     Ownership is POSITIVE: each stub records its own pid and its children's pids in
  //     a private mkdtemp directory, and liveness is read for exactly those pids with
  //     `ps -o stat= -p <pid>` (a zombie counts as dead). Nothing is matched by name.
  //     A "holder" is a grandchild in its OWN process group that keeps the call's
  //     stdout open for a fixed time after the group is killed, so "waited for close"
  //     is a measurable delay rather than a race.
  const lifeDir = mkdtempSync(resolve(tmpdir(), "sg-hook-life-"));
  const lifeFile = (name) => resolve(lifeDir, name);
  const pidsIn = (name) => {
    try { return readFileSync(lifeFile(name), "utf8").split("\n").map(Number).filter((n) => Number.isInteger(n) && n > 0); }
    catch { return []; }
  };
  const isAlive = (pid) => {
    try {
      const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
      return stat !== "" && !stat.startsWith("Z");
    } catch { return false; }
  };
  // Cleanup kills ONLY pids this test recorded, so a red run leaves nothing behind.
  const reapRecorded = (pids) => { for (const p of pids) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } } };
  // The holder's JavaScript is a FIXED string: the record file and the hold time reach
  // it as argv, never interpolated into code (CodeQL js/bad-code-sanitization, #2267).
  // Shell words are single-quoted; the fixed code contains no single quote.
  const shellWord = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const HOLDER_JS =
    'const c=require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},Number(process.argv[1]))",process.argv[2]],{detached:true,stdio:["ignore",1,2]});' +
    'require("fs").appendFileSync(process.argv[1],c.pid+"\\n");c.unref()';
  const holder = (ms, file) =>
    [shellWord(process.execPath), "-e", shellWord(HOLDER_JS), shellWord(file), shellWord(Number(ms))].join(" ");

  // 7c. fatal-first pool: one call fails while three peers are running.
  const peersFile = lifeFile("peers");
  const poolStub = lifeFile("pool.sh");
  writeFileSync(poolStub, [
    "cmd=$(cat)",
    'case "$cmd" in',
    "  *FAIL-NOW*)",
    "    i=0",
    `    while [ "$(( $(cat ${JSON.stringify(peersFile)} 2>/dev/null | wc -l) ))" -lt 6 ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done`,
    "    exit 3 ;;",
    "esac",
    `echo $$ >> ${JSON.stringify(peersFile)}`,
    "sleep 30 &",
    `echo $! >> ${JSON.stringify(peersFile)}`,
    "wait",
    "",
  ].join("\n"));
  let poolErr = null;
  try { await judgeAll(poolStub, ["slow-a", "slow-b", "slow-c", "FAIL-NOW"]); } catch (e) { poolErr = e; }
  const peerPids = pidsIn("peers");
  const peerSurvivors = peerPids.filter(isAlive);
  reapRecorded(peerPids);
  check(
    "a pool whose first call fails cancels and JOINS every running peer before it rejects, and rethrows that first failure (#2264)",
    poolErr instanceof HookFatal && poolErr.message.includes(JSON.stringify("FAIL-NOW")) && poolErr.message.includes("exited 3") &&
      peerPids.length === 6 && peerSurvivors.length === 0,
    `fatal=${poolErr instanceof HookFatal} message=${JSON.stringify(poolErr?.message?.slice(0, 120))} recorded=${peerPids.length} alive-at-reject=${peerSurvivors.length}`,
  );

  // 7d. a timeout rejects only after the killed call has CLOSED.
  const tFile = lifeFile("timeout-pids");
  const tStub = lifeFile("timeout.sh");
  writeFileSync(tStub, [
    `echo $$ >> ${JSON.stringify(tFile)}`,
    holder(1500, tFile),
    "sleep 300 &",
    `echo $! >> ${JSON.stringify(tFile)}`,
    "wait",
    "",
  ].join("\n"));
  let tErr = null;
  const tStart = Date.now();
  try { await askHook(tStub, "echo timeout-close-probe", 800); } catch (e) { tErr = e; }
  const tElapsed = Date.now() - tStart;
  const tPids = pidsIn("timeout-pids");
  const tSurvivors = tPids.filter(isAlive);
  reapRecorded(tPids);
  check(
    "a timed-out call rejects only after the killed call has CLOSED — no owned process outlives the rejection (#2264)",
    tErr instanceof HookFatal && tErr.message.includes("did not answer within 800ms") &&
      tElapsed >= 1300 && tPids.length === 3 && tSurvivors.length === 0,
    `fatal=${tErr instanceof HookFatal} elapsed=${tElapsed}ms recorded=${tPids.length} alive-at-reject=${tSurvivors.length}`,
  );

  // 7e. a delivery error (EPIPE) rejects only after the original call has closed, so the
  //     one permitted retry starts after it; the retry's own failure stays fatal.
  const eFile = lifeFile("epipe-pids");
  const eStub = lifeFile("epipe.sh");
  // stdin is closed only AFTER the holder exists, so the EPIPE (and with it any kill)
  // can never land before the holder is recorded — the delay is guaranteed, not raced.
  writeFileSync(eStub, [
    `echo $$ >> ${JSON.stringify(eFile)}`,
    holder(1200, eFile),
    "exec 0<&-",
    "exit 0",
    "",
  ].join("\n"));
  let eErr = null;
  const eStart = Date.now();
  try { await askHookRetrying(eStub, `echo ${"x".repeat(2_000_000)}`); } catch (e) { eErr = e; }
  const eElapsed = Date.now() - eStart;
  const ePids = pidsIn("epipe-pids");
  const eSurvivors = ePids.filter(isAlive);
  reapRecorded(ePids);
  check(
    "a delivery error rejects only after the original call has CLOSED, so the single retry starts after it and its failure stays fatal (#2264)",
    eErr instanceof HookFatal && /EPIPE/.test(eErr.message) && eElapsed >= 2200 && ePids.length === 4 && eSurvivors.length === 0,
    `fatal=${eErr instanceof HookFatal} message=${JSON.stringify(eErr?.message?.slice(0, 120))} elapsed=${eElapsed}ms recorded=${ePids.length} alive-at-reject=${eSurvivors.length}`,
  );
  // 7f. cleanup confirmation is STRUCTURED: a close grace that runs out is not a close
  //     event. The result carries closeConfirmed=false, and an EPIPE whose original
  //     call did not confirm close is NOT retried (the hook is asked exactly once).
  const uFile = lifeFile("unconfirmed-pids");
  const uStub = lifeFile("unconfirmed.sh");
  writeFileSync(uStub, [
    `echo $$ >> ${JSON.stringify(uFile)}`,
    holder(2500, uFile),
    "exec 0<&-",
    "exit 0",
    "",
  ].join("\n"));
  let uErr = null;
  let uCalls = 0;
  const uStart = Date.now();
  try {
    await askHookRetrying(uStub, `echo ${"y".repeat(2_000_000)}`, undefined, { closeGraceMs: 400, onCall: () => { uCalls += 1; } });
  } catch (e) { uErr = e; }
  const uElapsed = Date.now() - uStart;
  const uPids = pidsIn("unconfirmed-pids");
  reapRecorded(uPids);
  check(
    "a close grace that expires yields closeConfirmed=false (never inferred from a message or a clock) and FORBIDS the retry (#2264)",
    uErr instanceof HookFatal && uErr.closeConfirmed === false && /EPIPE/.test(uErr.message) && /cleanup unconfirmed/.test(uErr.message) &&
      uCalls === 1 && uPids.length === 2 && uElapsed < 2000,
    `fatal=${uErr instanceof HookFatal} closeConfirmed=${uErr?.closeConfirmed} calls=${uCalls} recorded=${uPids.length} elapsed=${uElapsed}ms message=${JSON.stringify(uErr?.message?.slice(0, 160))}`,
  );

  // 7g. a pool that cannot confirm every started call closed reports quiescence as
  //     UNVERIFIED, naming the call — it never reports an all-closed pool it cannot prove.
  const qFile = lifeFile("quiescence-pids");
  const qStub = lifeFile("quiescence.sh");
  writeFileSync(qStub, [
    "cmd=$(cat)",
    'case "$cmd" in',
    "  *FAIL-NOW*)",
    "    i=0",
    `    while [ "$(( $(cat ${JSON.stringify(qFile)} 2>/dev/null | wc -l) ))" -lt 3 ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done`,
    "    exit 3 ;;",
    "esac",
    `echo $$ >> ${JSON.stringify(qFile)}`,
    holder(2500, qFile),
    "sleep 30 &",
    `echo $! >> ${JSON.stringify(qFile)}`,
    "wait",
    "",
  ].join("\n"));
  let qErr = null;
  try { await judgeAll(qStub, ["stuck-peer", "FAIL-NOW"], { closeGraceMs: 400 }); } catch (e) { qErr = e; }
  const qPids = pidsIn("quiescence-pids");
  reapRecorded(qPids);
  check(
    "a pool with a started call that never confirms close reports quiescence UNVERIFIED, naming it, alongside the first failure (#2264)",
    qErr instanceof HookFatal && qErr.closeConfirmed === false && qErr.message.includes("quiescence UNVERIFIED") &&
      qErr.message.includes(JSON.stringify("stuck-peer")) && qErr.message.includes("exited 3") && qPids.length === 3,
    `fatal=${qErr instanceof HookFatal} closeConfirmed=${qErr?.closeConfirmed} recorded=${qPids.length} message=${JSON.stringify(qErr?.message?.slice(0, 200))}`,
  );
  try { rmSync(lifeDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  // 8. the plant proof itself, both directions, on a fixture tree. The REAL-tree run of the
  //    same proof is in the gate (run()), where the real answers already exist; here the
  //    proof is shown able to pass AND to fail without a second scan of the tree.
  const fixtureTree = [
    { path: `${SKILLS_DIR}/fixture-a/SKILL.md`, text: ["# A", "", "```bash", "ls -la", "```", ""].join("\n") },
    { path: `${SKILLS_DIR}/fixture-b/notes.md`, text: ["# B", "", "```bash", "git status", "```", ""].join("\n") },
  ];
  const deniedPlant = await plantProof(hookPath, fixtureTree, new Map());
  check(
    `planting one denied step adds exactly one finding (${deniedPlant.before} → ${deniedPlant.after})`,
    deniedPlant.ok && deniedPlant.after === deniedPlant.before + 1,
  );
  const allowedPlant = await plantProof(hookPath, fixtureTree, new Map(), "ls");
  check(
    "the plant proof FAILS when the planted step is one the hook allows (it cannot pass vacuously)",
    !allowedPlant.ok && allowedPlant.after === allowedPlant.before,
    `before=${allowedPlant.before} after=${allowedPlant.after}`,
  );
  const known = new Map([["ls -la", false], ["git status", false]]);
  const reuse = await plantProof(hookPath, fixtureTree, known);
  check(
    "answers already held for this hook are not asked again — only the planted step is",
    reuse.ok && reuse.asked === 1,
    `asked=${reuse.asked}`,
  );
  check(
    "a tree with no SKILL.md to plant into fails the proof instead of passing it",
    !(await plantProof(hookPath, [fixtureTree[1]], new Map())).ok,
  );
  const realPaths = trackedSkillFiles();
  const realCands = realPaths.flatMap((p) => extractCandidates(readFileSync(resolve(repo, p), "utf8"))).filter((c) => !c.mention);

  // 9. the floors refuse rather than reporting zero
  check("the file floor is above a trivially-small scope", FILE_FLOOR >= 20 && CANDIDATE_FLOOR >= 200);
  check(
    "the live scope clears both floors today",
    realPaths.length >= FILE_FLOOR && realCands.length >= CANDIDATE_FLOOR,
    `files=${realPaths.length} candidates=${realCands.length}`,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`self-test: ${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

const isSelfTest = process.argv.includes("--self-test");
try {
  if (isSelfTest) await selfTest();
  else await run();
} catch (e) {
  if (e instanceof HookFatal) {
    console.error(`✗ FATAL — ${e.message}`);
    console.error("  This gate judges by asking the hook; an unusable hook is a failure, never a skip.");
    process.exit(1);
  }
  throw e;
}

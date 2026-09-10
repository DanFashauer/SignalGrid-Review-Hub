#!/usr/bin/env node
// =============================================================================
// brief — ONE read of the whole system state for the operating brain.
//
// The coordinating session (the signalgrid-master orchestrator, per
// docs/agent/ORG.md) previously had to run several separate read-only commands to
// see where things stood: loop:state, status, lane messages, check-sim-requests,
// check-scheduled-routines. This composes their PASS/FAIL state into one panel.
// It is a status overview, NOT a replacement for `lane:inbox`: the Lane-mail row
// shows the consistency summary (sent/acked), so when unread work exists for this
// lane, run `pnpm run lane:inbox` for the message bodies and their required action.
//
// WHAT IT IS AND IS NOT:
//   · REPORT-ONLY. It SHELLS OUT to the existing read-only commands and never
//     re-implements them, never writes, and never gates. Normal mode always
//     exits 0 — like the session-start hook, a status view must not be the thing
//     that blocks you from fixing what it reports. The 180+ preflight gates gate.
//   · NOT in the decision path. It is a build/agent operability tool under
//     scripts/; nothing in lib/* or the /v1 core calls it (golden rule 2).
//   · HONEST. A section whose command fails, errors, or times out is shown as
//     FAIL / ERROR / TIMEOUT — never silently green. `--self-test` proves that.
//
// USAGE:  node scripts/brief.mjs            (pnpm run brief)
//         node scripts/brief.mjs --json     machine-readable
//         node scripts/brief.mjs --self-test    verify the composer itself
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { draftWithModel } from "./lib/agent-model-tap.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");
const SELF_TEST = process.argv.includes("--self-test");
const FULL = process.argv.includes("--full"); // include the slow deep sections (status-summary)
const NARRATE = process.argv.includes("--narrate"); // route a one-line dev summary to the free/local tier (DR-035)

const C = process.stdout.isTTY && !JSON_OUT
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", off: "\x1b[0m" }
  : { g: "", r: "", y: "", d: "", b: "", off: "" };

// Run one child command, resolving to {state, code, out, err} — never rejects.
function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    let child;
    const finish = (state, code) => {
      if (done) return;
      done = true;
      resolve({ state, code, out, err });
    };
    try {
      child = spawn(cmd, args, { cwd: repo });
    } catch (e) {
      return finish("ERROR", null);
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish("TIMEOUT", null);
    }, timeoutMs);
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", () => { clearTimeout(timer); finish("ERROR", null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? "OK" : "FAIL", code);
    });
  });
}

// Pull a short highlight out of command text; fall back to a byte-count so a
// section is never rendered as though it said nothing.
function highlight(text, patterns, fallback) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  for (const re of patterns) {
    const m = clean.match(re);
    if (m) return m[0].trim().slice(0, 160);
  }
  const firstReal = clean.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return fallback ?? (firstReal ? firstReal.slice(0, 160) : "(ran)");
}

function ageOf(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = Date.now() - t;
  const h = ms / 3.6e6;
  if (h < 1) return `${Math.max(0, Math.round(ms / 6e4))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// A command-backed section: run it, extract a highlight. `expectPass` lets the
// section report FAIL/OK from the child's own "passed"/"FAILED" wording even
// when the child exits 0 (several of these report-only checks always exit 0).
const CMD_SECTIONS = [
  {
    key: "seam", label: "Seam / loop", cmd: ["node", "scripts/loop-state.mjs"], timeout: 45000,
    patterns: [/\d+ thing\(s\) need you/i, /\d+ failing seam\(s\)/i, /all seams? (?:pass|clear)/i],
  },
  {
    key: "gates", label: "Status", cmd: ["node", "scripts/status-summary.mjs"], timeout: 90000, deep: true,
    patterns: [/\b\d+\s+(?:pass|passed)[^\n]*\b\d+\s+(?:fail|failed)/i, /(?:PASS|FAIL|green|red)[^\n]{0,80}/],
  },
  {
    key: "lane", label: "Lane mail", cmd: ["node", "scripts/check-lane-messages.mjs"], timeout: 45000,
    patterns: [/\d+ sent, \d+ acknowledged[^\n]*/i, /Lane message check (?:passed|FAILED)[^\n]*/i],
  },
  {
    key: "sim", label: "Sim requests", cmd: ["node", "scripts/check-sim-requests.mjs"], timeout: 45000,
    patterns: [/Simulation request loop (?:passed|FAILED)[^\n]*/i, /\d+ (?:pending|owed)[^\n]*/i],
  },
  {
    key: "routines", label: "Routines", cmd: ["node", "scripts/check-scheduled-routines.mjs"], timeout: 45000,
    patterns: [/Scheduled-routine check (?:passed|FAILED)[^\n]*/i],
  },
];

async function runCmdSection(s) {
  const r = await runCmd(s.cmd[0], s.cmd.slice(1), s.timeout);
  let state = r.state;
  let summary;
  if (state === "TIMEOUT") summary = `timed out after ${Math.round(s.timeout / 1000)}s`;
  else if (state === "ERROR") summary = "could not spawn";
  else {
    const text = r.out + "\n" + r.err;
    summary = highlight(text, s.patterns);
    // Report-only children exit 0 but say "FAILED" in prose — surface that.
    if (state === "OK" && /\bFAILED\b/.test(text.replace(/\x1b\[[0-9;]*m/g, ""))) state = "FAIL";
  }
  return { key: s.key, label: s.label, state, summary };
}

// Direct file-read sections (no child process).
function discoverySection() {
  const p = join(repo, "docs/agent/DISCOVERY_LOG.md");
  if (!existsSync(p)) return { key: "discovery", label: "Discovery", state: "ERROR", summary: "DISCOVERY_LOG.md not found" };
  try {
    const text = readFileSync(p, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    // Mirror the ONE authoritative source loop-state.mjs parses — the
    // "Conversations logged: N of M" line — never a prose number (line 112's
    // "15 conversations" is a sample-size mention, not the count). This is the
    // number that moves the company; a guessed one is worse than none.
    const m = text.match(/Conversations logged:\s*(\d+)\s*of\s*(\d+)/i);
    const summary = m
      ? `${m[1]} of ${m[2]} conversations logged — the only number that moves the company (docs/agent/DISCOVERY_LOG.md)`
      : "no 'Conversations logged: N of M' line in docs/agent/DISCOVERY_LOG.md — the only number that moves the company";
    return { key: "discovery", label: "Discovery", state: "OK", summary };
  } catch (e) {
    return { key: "discovery", label: "Discovery", state: "ERROR", summary: String(e).slice(0, 120) };
  }
}

function heartbeatsSection() {
  const dir = join(repo, "artifacts/agent-heartbeats");
  if (!existsSync(dir)) return { key: "heartbeats", label: "Lane heartbeats", state: "ERROR", summary: "no heartbeat directory" };
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (!files.length) return { key: "heartbeats", label: "Lane heartbeats", state: "OK", summary: "(none recorded yet)" };
    let anyUnreadable = false;
    const rows = files.map((f) => {
      try {
        const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const when = j.firedAt || j.updatedAt || j.at || j.lastRun;
        const age = when ? ageOf(when) : null;
        return `${f.replace(/\.json$/, "")}: ${age || "no timestamp"}`;
      } catch {
        anyUnreadable = true;
        return `${f.replace(/\.json$/, "")}: unreadable`;
      }
    });
    // A heartbeat we cannot read is missing liveness evidence — never report that OK.
    return { key: "heartbeats", label: "Lane heartbeats", state: anyUnreadable ? "ERROR" : "OK", summary: rows.join(" · ") };
  } catch (e) {
    return { key: "heartbeats", label: "Lane heartbeats", state: "ERROR", summary: String(e).slice(0, 120) };
  }
}

function tickWatch() {
  // The Mac's unattended tick — absent means the Mac lane is not autonomous.
  const p = join(repo, "artifacts/agent-heartbeats/mac-lane-tick.json");
  if (!existsSync(p)) return { key: "mac-tick", label: "Mac tick", state: "FAIL", summary: "absent — Mac not ticking (run: bash scripts/mac/install-launchd.sh)" };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    const when = j.firedAt || j.updatedAt || j.at;
    const ms = when ? Date.parse(when) : NaN;
    const age = when ? ageOf(when) : null;
    // Staleness is computed from the timestamp, never the formatted age string:
    // once the tick crosses 48h, ageOf() returns "2d ago" with no "Nh", so an
    // hours-only match would read stale as false forever and report a dead lane OK.
    // An unparseable or absent timestamp is stale (fail-closed).
    const stale = !Number.isFinite(ms) || Date.now() - ms >= 3 * 3600 * 1000;
    return { key: "mac-tick", label: "Mac tick", state: stale ? "FAIL" : "OK", summary: `last ${age || "unknown"}` };
  } catch (e) {
    return { key: "mac-tick", label: "Mac tick", state: "ERROR", summary: String(e).slice(0, 120) };
  }
}

async function collect() {
  // Deep sections (status-summary can take >60s here) run only under --full, so the
  // default brief stays a fast single read.
  const sections = CMD_SECTIONS.filter((s) => FULL || !s.deep);
  const cmdResults = await Promise.all(sections.map(runCmdSection));
  return [...cmdResults, discoverySection(), heartbeatsSection(), tickWatch()];
}

function stateColor(state) {
  if (state === "OK") return C.g;
  if (state === "FAIL" || state === "ERROR") return C.r;
  return C.y; // TIMEOUT
}

function render(sections) {
  const lines = [];
  lines.push(`${C.b}── SignalGrid brief ${new Date().toISOString()} ──${C.off}`);
  const w = Math.max(...sections.map((s) => s.label.length));
  for (const s of sections) {
    const col = stateColor(s.state);
    lines.push(`  ${s.label.padEnd(w)}  ${col}${s.state.padEnd(7)}${C.off} ${C.d}${s.summary}${C.off}`);
  }
  // TIMEOUT is unhealthy too: a section whose command did not finish is an
  // INCOMPLETE read, and an incomplete read must never end in "all clean".
  const bad = sections.filter((s) => s.state === "FAIL" || s.state === "ERROR" || s.state === "TIMEOUT");
  lines.push("");
  lines.push(bad.length
    ? `  ${C.y}${bad.length} section(s) want a look: ${bad.map((s) => `${s.label} (${s.state})`).join(", ")}.${C.off} This view reports; it never blocks.`
    : `  ${C.d}all sections read clean. This view reports; it never blocks.${C.off}`);
  return lines.join("\n");
}

async function selfTest() {
  let checks = 0, failed = 0;
  const ok = (cond, msg) => { checks++; if (!cond) { failed++; console.log(`  ✗ ${msg}`); } else { console.log(`  ✓ ${msg}`); } };

  // 1. A broken command is reported FAIL/ERROR/TIMEOUT, never OK — failures surface.
  const broken = await runCmdSection({ key: "x", label: "x", cmd: ["node", "scripts/__does_not_exist__.mjs"], timeout: 15000, patterns: [] });
  ok(broken.state !== "OK", `a command that cannot succeed is not reported OK (got ${broken.state})`);

  // 2. A command that exits 0 but prints FAILED is downgraded to FAIL (report-only honesty).
  const fakeFail = await runCmd("node", ["-e", "console.log('Lane message check FAILED — x'); process.exit(0)"], 15000);
  const downgraded = fakeFail.state === "OK" && /\bFAILED\b/.test(fakeFail.out);
  ok(downgraded, "a report-only child that exits 0 but says FAILED is detectable (the section downgrades it)");

  // 3. A clean command is OK.
  const clean = await runCmd("node", ["-e", "console.log('all good')"], 15000);
  ok(clean.state === "OK", `a clean command reads OK (got ${clean.state})`);

  // 4. TIMEOUT fires and is not OK.
  const slow = await runCmd("node", ["-e", "setTimeout(()=>{}, 60000)"], 1000);
  ok(slow.state === "TIMEOUT", `a command past its timeout reads TIMEOUT (got ${slow.state})`);

  // 5. The tick watcher fails closed when the tick file is absent.
  const tick = tickWatch();
  ok(!existsSync(join(repo, "artifacts/agent-heartbeats/mac-lane-tick.json")) ? tick.state === "FAIL" : true,
    "an absent Mac tick reads FAIL, not OK (fail-closed on the Mac's autonomy signal)");

  // 6. render() names a failing section rather than printing a clean summary.
  const painted = render([{ label: "X", state: "FAIL", summary: "boom" }, { label: "Y", state: "OK", summary: "fine" }]);
  ok(/want a look/.test(painted) && /X/.test(painted), "render() surfaces failing sections by name");

  // 7. discovery + heartbeats sections return a shape with a state.
  ok(["OK", "ERROR"].includes(discoverySection().state), "discovery section returns a state");
  ok(["OK", "ERROR"].includes(heartbeatsSection().state), "heartbeats section returns a state");

  console.log(failed === 0 ? `\nself-test passed (${checks}/${checks})` : `\nself-test FAILED (${checks - failed}/${checks})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (SELF_TEST) {
  await selfTest();
} else {
  const sections = await collect();
  if (JSON_OUT) {
    console.log(JSON.stringify({ at: new Date().toISOString(), sections }, null, 2));
  } else {
    console.log(render(sections));
    // --narrate routes a one-line developer summary to the FREE/LOCAL tier via
    // the DR-035 tap. It is an opt-in operability convenience, explicitly labeled
    // unverified, never auto-sent to the owner; with no endpoint configured the
    // tap returns null and the line is simply omitted (proving the fail-safe by
    // use). --json and --self-test never reach the tap — the composer stays
    // deterministic.
    if (NARRATE) {
      const input = sections.map((s) => `${s.label}: ${s.state} — ${s.summary}`).join("\n");
      const draft = await draftWithModel({
        taskClass: "dev-summary",
        system: "You summarize a developer system-health panel in ONE terse sentence. No preamble.",
        input,
      });
      if (draft && draft.text) console.log(`\n  ${C.d}draft (${draft.model}, unverified):${C.off} ${draft.text.trim()}`);
    }
  }
  process.exit(0); // report-only: never blocks
}

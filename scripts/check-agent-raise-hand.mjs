#!/usr/bin/env node
// check-agent-raise-hand — every subagent definition must carry the "raise your hand"
// contract, so an agent that gets stuck SURFACES the blocker instead of failing
// silently, dropping a step, or handing back an empty/partial result as if complete.
//
//   node scripts/check-agent-raise-hand.mjs             the guard
//   node scripts/check-agent-raise-hand.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// --------------
// The owner's words, 2026-09-23: "All agents will never raise their hand when they get
// stuck." Measured that day: of 13 `.claude/agents/*.md`, only 5 had ANY escalation
// language and it was ad-hoc. A subagent that hits a wall — a tool it lacks, a
// dependency it cannot reach, a contradictory input, an owner-only decision, a usage
// limit, a refusal — and then returns its best guess as if it finished is the quietest
// failure in the system: the coordinator reads a confident answer and builds on sand.
//
// This is the fail-closed rule (CLAUDE.md golden rule 2) applied to an agent's OWN
// PROGRESS: an unknown/blocked STATE must tighten (surface, stop) not loosen (guess,
// proceed). It is gated the same way the code is.
//
// WHAT IS GATED
// -------------
// Every `.claude/agents/*.md` (the units the Agent tool spawns) must contain the
// canonical section — the heading and the sentinel sentence below — verbatim, so the
// contract is uniform and cannot drift into a softer paraphrase. A file missing either
// marker fails, with the exact text to paste.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_DIR = join(repo, ".claude/agents");

// A floor: an empty or misdirected walk can never pass as "all compliant".
const FILE_FLOOR = 10;

export const HEADING = "## When you're stuck, raise your hand";
// A distinctive sentinel sentence so a reworded, weaker section cannot pass the heading
// check alone. Both must be present.
export const SENTINEL = "A raised hand is the job done right";

// The canonical clause, so the gate can PRINT exactly what a failing file must contain.
export const CLAUSE = `${HEADING}

Be fail-closed about your own progress, not only the code you inspect. If you hit a wall
you cannot clear alone — a tool or permission you lack, a dependency you cannot reach, an
input that is missing or self-contradictory, an ambiguous call that is the owner's to
make, a usage limit, or a refusal — STOP and say so plainly. Report it the way you report
a finding: what you were doing, what blocked you, exactly what you need to continue, and
who can unblock it (the owner, the other lane, a named tool). Never hand back an empty,
partial, or best-guess result as if it were complete; never silently drop a step; never
narrate past the blocker. ${SENTINEL} — a silent stall is the one failure this system
will not tolerate.`;

export function isCompliant(body) {
  return body.includes(HEADING) && body.includes(SENTINEL);
}

function agentFiles() {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(AGENTS_DIR, f));
}

function selfTest() {
  const fail = [];
  const t = (name, ok) => { if (!ok) fail.push(name); };
  t("the canonical clause is compliant", isCompliant(CLAUSE));
  t("a file with the heading but no sentinel FAILS (a reworded, weaker section)",
    isCompliant(`${HEADING}\n\nplease speak up if you feel like it.`) === false);
  t("a file with the sentinel but no heading FAILS",
    isCompliant(`## Escalation\n\n${SENTINEL}.`) === false);
  t("an empty body fails", isCompliant("") === false);
  // Coverage honesty: the real tree must have enough agent files to be worth gating.
  const n = agentFiles().length;
  t(`at least ${FILE_FLOOR} agent files are present (found ${n})`, n >= FILE_FLOOR);
  if (fail.length) { for (const f of fail) console.error(`self-test FAIL: ${f}`); process.exit(1); }
  console.log("check-agent-raise-hand self-test: ok");
  return 0;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const files = agentFiles();
  if (files.length < FILE_FLOOR) {
    console.error(`check-agent-raise-hand FAIL — only ${files.length} agent file(s) found under .claude/agents (floor ${FILE_FLOOR}); the walk is wrong or the plane shrank.`);
    process.exit(1);
  }
  const missing = files.filter((f) => !isCompliant(readFileSync(f, "utf8"))).map((f) => f.slice(repo.length + 1));
  if (missing.length) {
    console.error(`check-agent-raise-hand FAIL — ${missing.length} agent definition(s) lack the raise-your-hand contract:\n`);
    for (const m of missing) console.error(`  ${m}`);
    console.error(`\nPaste this section (verbatim) into each:\n\n${CLAUSE}\n`);
    process.exit(1);
  }
  console.log(`check-agent-raise-hand: ok — all ${files.length} agent definition(s) carry the raise-your-hand contract`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

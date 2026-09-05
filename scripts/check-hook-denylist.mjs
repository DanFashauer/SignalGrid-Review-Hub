// check-hook-denylist.mjs — the Bash deny-list hook must be able to DENY.
//
//   node scripts/check-hook-denylist.mjs
//
// WHY THIS EXISTS. `.claude/hooks/block-dangerous.sh` is the PreToolUse nudge
// layer CLAUDE.md describes as the deny list "enforced before execution". On
// 2026-09-05 it was found to ALLOW `bash -c 'rm -rf /tmp/x'` (the payload sat in
// a quoted span the hook stripped before matching), the force-push pattern with
// two spaces in it, and any stdin it could not parse. A hook nobody exercises is
// a hook whose holes nobody finds. The hook carries its own `--self-test` (16
// cases, both directions: wrapped payloads must DENY, a commit message NAMING a
// pattern must ALLOW, unreadable input must DENY); this gate runs it so it sits
// in preflight and CI as a node command the parity gate can read.
//
// FAIL-CLOSED: a hook that cannot be found or cannot be executed is a failure,
// not a skip — the deny list being absent is the loosest state it can be in.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = ".claude/hooks/block-dangerous.sh";

if (!existsSync(resolve(repo, HOOK))) {
  console.error(`✗ ${HOOK} is missing — the Bash deny list does not exist, which is the loosest state it can be in.`);
  process.exit(1);
}

const r = spawnSync("bash", [HOOK, "--self-test"], { cwd: repo, encoding: "utf8" });
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
if (r.error) {
  console.error(`✗ could not execute ${HOOK}: ${r.error.message}`);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`✗ ${HOOK} --self-test exited ${r.status} — the deny list can no longer deny what it must.`);
  process.exit(1);
}
// SETTINGS ↔ HOOK PARITY (2026-09-05). `.claude/settings.json` declares a Bash deny
// list; the hook enforces its own pattern loop. The two drifted — `sudo` and
// `git branch -D` sat in settings and not in the hook — and nothing compared
// them. Held BEHAVIOURALLY: every `Bash(<pattern> *)` deny entry is fed to the
// hook as `<pattern> x` and must come back denied. A text comparison would have
// to know how the hook spells its patterns; this asks the hook directly.
const settingsPath = resolve(repo, ".claude/settings.json");
if (!existsSync(settingsPath)) {
  console.error("✗ .claude/settings.json is missing — nothing declares the deny list the hook is held to.");
  process.exit(1);
}
const deny = JSON.parse(readFileSync(settingsPath, "utf8"))?.permissions?.deny;
const bashDenies = (Array.isArray(deny) ? deny : [])
  .map((d) => /^Bash\((.+?)\s*\*?\)$/.exec(String(d))?.[1]?.trim())
  .filter((p) => typeof p === "string" && p.length > 0);
if (bashDenies.length < 5) {
  console.error(`✗ only ${bashDenies.length} Bash deny entries parsed from settings.json — the parser, not the list, changed.`);
  process.exit(1);
}
const unheld = [];
for (const pattern of bashDenies) {
  const probe = spawnSync("bash", [HOOK], { cwd: repo, encoding: "utf8", input: JSON.stringify({ tool_input: { command: `${pattern} x` } }) });
  if (!/"deny"/.test(probe.stdout ?? "")) unheld.push(pattern);
}
if (unheld.length > 0) {
  console.error(`✗ ${unheld.length} settings.json Bash deny pattern(s) the hook does NOT deny: ${unheld.join(" | ")}`);
  console.error("  Add each to the pattern loop in the hook, or remove it from settings.json with a reason.");
  process.exit(1);
}
console.log(`Bash deny-list hook self-test passed — ${HOOK} denies wrapped payloads, unreadable input and a missing command field, allows a mention, and holds every settings.json Bash deny pattern (${bashDenies.length}).`);

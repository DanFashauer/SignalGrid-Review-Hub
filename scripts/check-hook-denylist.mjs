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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = ".claude/hooks/block-dangerous.sh";

// The hook's own --self-test now carries a ReDoS regression probe (a 200-flag
// command). If BSD sed ever regresses to catastrophic backtracking, that probe's
// sed hangs — and an UNBOUNDED spawnSync here would hang this gate, and preflight
// (Codex #716, the same failure the probe exists to catch, recreated by the test).
// Every spawnSync that runs the hook is therefore bounded, and a timed-out run is
// a FAILURE, fail-closed — never read as a pass. spawnSync's own {timeout,
// killSignal} is the portable lever (macOS has no GNU `timeout`).
const HOOK_TIMEOUT_MS = 15000;

/** True when a spawnSync result was cut short by its timeout (killSignal fired). */
function timedOut(r) {
  return r.error?.code === "ETIMEDOUT" || (r.status === null && r.signal === "SIGKILL");
}

/** Run `bash <hookPath> --self-test` under a bounded timeout.
 *  @param {number} [timeoutMs] override for the self-test harness only; the real
 *    default is HOOK_TIMEOUT_MS. A hung self-test is caught here, never left to
 *    hang the gate and preflight forever. */
function runHookSelfTest(hookPath, timeoutMs = HOOK_TIMEOUT_MS) {
  return spawnSync("bash", [hookPath, "--self-test"], {
    cwd: repo,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
}

function runGate() {
  if (!existsSync(resolve(repo, HOOK))) {
    console.error(`✗ ${HOOK} is missing — the Bash deny list does not exist, which is the loosest state it can be in.`);
    process.exit(1);
  }

  const r = runHookSelfTest(resolve(repo, HOOK));
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (timedOut(r)) {
    console.error(`✗ ${HOOK} --self-test did not finish within ${HOOK_TIMEOUT_MS}ms — it HUNG (a ReDoS regression in the deny-list sed does exactly this). Failing closed; a hung self-test is never a pass.`);
    process.exit(1);
  }
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
    // Bounded too: a probe that hangs (same ReDoS class) must not hang the gate.
    // A timed-out probe answered nothing, so it is not a deny — it lands in `unheld`
    // and fails the gate, fail-closed.
    const probe = spawnSync("bash", [HOOK], {
      cwd: repo,
      encoding: "utf8",
      input: JSON.stringify({ tool_input: { command: `${pattern} x` } }),
      timeout: HOOK_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (!/"deny"/.test(probe.stdout ?? "")) unheld.push(pattern);
  }
  if (unheld.length > 0) {
    console.error(`✗ ${unheld.length} settings.json Bash deny pattern(s) the hook does NOT deny: ${unheld.join(" | ")}`);
    console.error("  Add each to the pattern loop in the hook, or remove it from settings.json with a reason.");
    process.exit(1);
  }
  console.log(`Bash deny-list hook self-test passed — ${HOOK} denies wrapped payloads, unreadable input and a missing command field, allows a mention, and holds every settings.json Bash deny pattern (${bashDenies.length}).`);
}

// ── self-test ────────────────────────────────────────────────────────────────
// Prove the invoker timeout catches a hanging self-test and fails closed within
// the bound — the exact path Codex #716 flagged. A short injected timeout keeps it
// fast; the real HOOK_TIMEOUT_MS is untouched.
function selfTest() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  };

  const dir = mkdtempSync(join(tmpdir(), "sg-denylist-selftest-"));

  // A hook stub whose --self-test never returns.
  const hangStub = join(dir, "hang.sh");
  writeFileSync(hangStub, 'if [ "${1:-}" = "--self-test" ]; then sleep 30; fi\n');
  const started = Date.now();
  const hung = runHookSelfTest(hangStub, 1000);
  const elapsed = Date.now() - started;
  check(
    "a self-test that HANGS is caught by the timeout and reported as timed-out, well within the bound",
    timedOut(hung) && elapsed < 5000,
    `timedOut=${timedOut(hung)} elapsed=${elapsed}ms status=${hung.status} signal=${hung.signal} err=${hung.error?.code}`,
  );

  // A well-behaved self-test is NOT misread as a timeout.
  const okStub = join(dir, "ok.sh");
  writeFileSync(okStub, 'if [ "${1:-}" = "--self-test" ]; then echo ok; exit 0; fi\n');
  const good = runHookSelfTest(okStub, 5000);
  check("a fast, passing self-test is NOT read as timed-out", !timedOut(good) && good.status === 0);

  const failed = results.filter((ok) => !ok).length;
  console.log(`self-test: ${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (process.argv.includes("--self-test")) selfTest();
else runGate();

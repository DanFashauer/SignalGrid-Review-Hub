#!/usr/bin/env node
// CI-side twin of preflight's per-step `expect`: run a command, replay its output, and fail when it
// exits 0 WITHOUT printing the pass line it must print (scripts/lib/preflight-verdict.mjs `expectFor`
// — the same function preflight applies, so the two cannot disagree).
//
//   node scripts/lib/expect-output.mjs node scripts/check-x.mjs --self-test
//
// Exit code: the command's own when non-zero; 1 when it exited 0 without the expected line, or when
// it was killed by a signal / could not start; 2 on a usage error (no command, or a command with no
// declared expectation — a wrapper that asserts nothing would be a silent pass).
//   node scripts/lib/expect-output.mjs --self-test    runs the wrapper's own fixtures.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expectFor } from "./preflight-verdict.mjs";

/** Pure: judge a finished command. Returns { code, message? }. */
export function judge({ cmd, status, signal, error, combined }) {
  if (error || signal) return { code: 1, message: `expect-output: the command did not finish (${error?.message ?? `signal ${signal}`})` };
  if (status !== 0) return { code: status ?? 1 };
  const expect = expectFor(cmd);
  if (!expect) return { code: 2, message: `expect-output: no expectation is declared for \`${cmd.join(" ")}\` — refusing to assert nothing` };
  if (combined.search(expect) === -1) {
    return { code: 1, message: `expect-output: \`${cmd.join(" ")}\` exited 0 but never printed its pass line ${expect}. A self-test that prints nothing has not run; exit 0 alone is not evidence.` };
  }
  return { code: 0 };
}

function selfTest() {
  const cmd = ["node", "scripts/x.mjs", "--self-test"];
  const checks = [
    ["exit 0 with no output fails", judge({ cmd, status: 0, combined: "" }).code === 1],
    ["exit 0 with only a banner naming the self-test fails", judge({ cmd, status: 0, combined: "running self-test…\n" }).code === 1],
    ["exit 0 with its pass line passes", judge({ cmd, status: 0, combined: "x self-test passed (3/3)\n" }).code === 0],
    ["a non-zero exit stays non-zero", judge({ cmd, status: 3, combined: "x self-test passed (3/3)\n" }).code === 3],
    ["a signal kill fails", judge({ cmd, status: null, signal: "SIGKILL", combined: "" }).code === 1],
    ["a command with no declared expectation is refused", judge({ cmd: ["node", "scripts/x.mjs"], status: 0, combined: "ok" }).code === 2],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (bad.length) { console.error(`expect-output self-test: ${bad.length} FAILED`); process.exit(1); }
  console.log(`expect-output self-test passed (${checks.length}/${checks.length})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv.slice(2);
  if (cmd.length === 1 && cmd[0] === "--self-test") selfTest();
  else if (cmd.length === 0) { console.error("expect-output: usage: expect-output.mjs <command…>"); process.exit(2); }
  else {
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    const v = judge({ cmd, status: r.status, signal: r.signal, error: r.error, combined });
    if (v.message) console.error(v.message);
    process.exit(v.code);
  }
}

// Falsifiable check for the tick refreshing its OWN behind heartbeat PR
// (scripts/lane-heartbeat-refresh.mjs, called from scripts/mac/lane-tick.sh).
// A fake `gh` on PATH records every call; no network, no real credentials.
// Each case asserts BOTH the exit code and exactly which gh calls happened, so a
// refresh that touches a PR it should not, or claims a refresh that did not
// happen, fails here.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/lane-heartbeat-refresh.mjs");
const TICK = join(ROOT, "scripts/mac/lane-tick.sh");
const SLUG = "acme/hub", ME = "mac-bot";
const TOPIC = "lane/mac-mail-20261106-120000Z-0123456789ab";
const HEAD = "a".repeat(40), MOVED = "b".repeat(40), MOVED2 = "c".repeat(40), OTHER = "d".repeat(40);

const dir = mkdtempSync(join(tmpdir(), "sg-hb-refresh-"));
const bin = join(dir, "bin");
spawnSync("mkdir", ["-p", bin]);
// Fake gh: scenario JSON in SG_FAKE; every call appended to SG_FAKE_LOG.
// pulls/N is served from `pr`; after a PUT it serves `pr` with head.sha = afterHead.
writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2), s = JSON.parse(fs.readFileSync(process.env.SG_FAKE, "utf8"));
fs.appendFileSync(process.env.SG_FAKE_LOG, JSON.stringify(a) + "\\n");
const put = a.includes("PUT");
const path = a.find(x => x.startsWith("repos/")) || a[1];
const stF = process.env.SG_FAKE + ".put";
const fail = k => { if (s.fail && s.fail.includes(k)) { process.stderr.write("boom " + k); process.exit(1); } };
if (a[1] === "user") { fail("user"); console.log(JSON.stringify({ login: s.user })); }
else if (put) { fail("put"); fs.writeFileSync(stF, "1"); console.log("{}"); }
else if (/pulls\\?/.test(path)) { fail("list"); console.log(JSON.stringify(s.list)); }
else if (/pulls\\/\\d+$/.test(path)) {
  fail("pr");
  const pr = JSON.parse(JSON.stringify(s.pr));
  if (fs.existsSync(stF) && s.afterHead) pr.head.sha = s.afterHead;
  console.log(JSON.stringify(pr));
} else { process.stderr.write("unexpected " + a.join(" ")); process.exit(9); }
`);
chmodSync(join(bin, "gh"), 0o755);

let passed = 0, failed = 0, n = 0;
function ok(cond, name, detail = "") {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? " -- " + detail : ""}`); }
}
const basePr = () => ({ number: 7, state: "open", mergeable_state: "behind", auto_merge: { enabled_by: { login: ME } },
  user: { login: ME }, head: { ref: TOPIC, sha: HEAD, repo: { full_name: SLUG } }, base: { ref: "SignalGrid_Alpha", repo: { full_name: SLUG } } });

function scenario(over = {}, receiptOver = {}) {
  n += 1;
  const sc = join(dir, `sc${n}.json`), log = join(dir, `log${n}.jsonl`), receipt = join(dir, `receipt${n}.json`);
  writeFileSync(sc, JSON.stringify({ user: ME, list: [{ number: 7 }], pr: basePr(), afterHead: MOVED, fail: [], ...over }));
  writeFileSync(log, "");
  writeFileSync(receipt, JSON.stringify({ version: 1, repository: SLUG, target: TOPIC, head: HEAD, ...receiptOver }) + "\n", { mode: 0o600 });
  const run = () => {
    writeFileSync(log, "");
    const r = spawnSync(process.execPath, [SCRIPT, receipt], { encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SG_FAKE: sc, SG_FAKE_LOG: log, SG_REFRESH_SETTLE_MS: "0" } });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    return { code: r.status, out: r.stdout + r.stderr, puts: calls.filter(c => c.includes("PUT")), calls };
  };
  return { run, receipt, sc, log };
}

console.log("lane-heartbeat-refresh: own behind PR is refreshed with the pinned head");
{
  const s = scenario(), r = s.run();
  ok(r.code === 0, "own behind PR: exit 0", `${r.code} ${r.out}`);
  ok(r.puts.length === 1 && r.puts[0].includes(`expected_head_sha=${HEAD}`) && r.puts[0].some(x => x.endsWith("/pulls/7/update-branch")), "update-branch called once with expected_head_sha = the recorded head", JSON.stringify(r.puts));
  ok(/verified by a fresh GET/.test(r.out) && existsSync(`${s.receipt}.refresh-1.json`), "claim only after a fresh GET showed the head move, and it is recorded");
  // Second tick: the PR is behind again at the head this script verified.
  const sc = JSON.parse(readFileSync(s.sc, "utf8"));
  sc.pr.head.sha = MOVED; sc.afterHead = MOVED2;
  writeFileSync(s.sc, JSON.stringify(sc)); rmSync(`${s.sc}.put`, { force: true });
  const r2 = s.run();
  ok(r2.code === 0 && r2.puts.length === 1 && r2.puts[0].includes(`expected_head_sha=${MOVED}`), "a later refresh pins the head the previous refresh verified", `${r2.code} ${JSON.stringify(r2.puts)}`);
}

console.log("lane-heartbeat-refresh: a PR that is not provably the tick's own is not touched");
{
  const pr = basePr(); pr.user.login = "someone-else";
  let r = scenario({ pr }).run();
  ok(r.code === 21 && r.puts.length === 0, "PR authored by another user: not touched", `${r.code} ${JSON.stringify(r.puts)}`);
  const pr2 = basePr(); pr2.head.ref = "feature/other";
  r = scenario({ pr: pr2 }).run();
  ok(r.code === 21 && r.puts.length === 0, "PR whose head ref is not the recorded topic: not touched");
  const pr3 = basePr(); pr3.head.repo.full_name = "fork/hub";
  r = scenario({ pr: pr3 }).run();
  ok(r.code === 21 && r.puts.length === 0, "PR from a fork: not touched");
  const pr4 = basePr(); pr4.head.sha = OTHER;
  r = scenario({ pr: pr4 }).run();
  ok(r.code === 21 && r.puts.length === 0, "PR head differs from the head the tick recorded: not touched");
  r = scenario({ list: [{ number: 7 }, { number: 8 }] }).run();
  ok(r.code === 21 && r.puts.length === 0, "two open PRs name the topic: not touched");
  r = scenario({}, { target: "lane/cloud-mail-20261106-120000Z-0123456789ab" }).run();
  ok(r.code === 21 && r.puts.length === 0 && r.calls.length === 0, "a cloud-lane topic in the receipt: refused before any gh call");
  const pr5 = basePr(); pr5.auto_merge = null;
  r = scenario({ pr: pr5 }).run();
  ok(r.code === 21 && r.puts.length === 0, "auto-merge no longer requested: not touched");
}

console.log("lane-heartbeat-refresh: read errors and unknown states fail closed");
for (const k of ["user", "list", "pr"]) {
  const r = scenario({ fail: [k] }).run();
  ok(r.code === 21 && r.puts.length === 0, `GET error (${k}): not touched`, `${r.code} ${JSON.stringify(r.puts)}`);
}
{
  const pr = basePr(); pr.mergeable_state = "unknown";
  const r = scenario({ pr }).run();
  ok(r.code === 21 && r.puts.length === 0, "mergeable_state unknown: not touched");
  const pr2 = basePr(); pr2.mergeable_state = "clean";
  const r2 = scenario({ pr: pr2 }).run();
  ok(r2.code === 20 && r2.puts.length === 0, "not behind (clean): nothing to do, no PUT");
  const r3 = scenario({ fail: ["put"] }).run();
  ok(r3.code === 21 && r3.puts.length === 1 && !/refreshed/.test(r3.out), "update-branch refused: reported, no refresh claimed");
}

console.log("lane-heartbeat-refresh: an unchanged head after the update is reported, not claimed");
{
  const s = scenario({ afterHead: HEAD }), r = s.run();
  ok(r.code === 22 && /NOT claimed/.test(r.out) && !/refreshed PR/.test(r.out) && !existsSync(`${s.receipt}.refresh-1.json`), "head unchanged: exit 22, no 'refreshed', no verified record", `${r.code} ${r.out}`);
  const again = s.run();
  ok(again.code === 21 && again.puts.length === 0, "an unverified request is never repeated blindly (held, not touched)", `${again.code}`);
}

console.log("lane-tick.sh calls the refresh for its own pending heartbeat, before the throttle");
{
  const t = readFileSync(TICK, "utf8");
  const call = t.indexOf("scripts/lane-heartbeat-refresh.mjs");
  const throttle = t.indexOf("last submission attempt <");
  ok(call > 0, "lane-tick.sh invokes scripts/lane-heartbeat-refresh.mjs");
  ok(call > 0 && throttle > 0 && call < throttle, "the call precedes the 'unchanged ... no new mail PR' early return, so a quiet tick still refreshes");
  ok(call > 0 && /_hb_previous_status" = "0"/.test(t.slice(Math.max(0, call - 600), call)), "only a delivered (exit 0) heartbeat attempt is refreshed");
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nlane-heartbeat-refresh: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

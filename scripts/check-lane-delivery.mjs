// Exercise the actual delivery CLI against disposable Git repositories only.
// Schema-gate and gh fixtures isolate transport; the real gates run separately.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scratchGit } from "./lib/scratch-git.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "SignalGrid_Alpha";
const GIT = spawnSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
let passed = 0;
let failed = 0;

function fixture({ lane = "mac", reject = false, loseResponse = false, failBeforePush = false, gateFails = false,
  ghMissing = false, ghCreateFails = false, ghAutoFails = false, tick = false, ...tickOptions } = {}) {
  if (tick) return heartbeatFixture(tickOptions);
  const root = mkdtempSync(join(tmpdir(), "sg-delivery-test-"));
  const repo = join(root, "repo"), remote = join(root, "remote.git"), bin = join(root, "bin");
  const ghLog = join(root, "gh.jsonl"), pushLog = join(root, "push.jsonl");
  mkdirSync(repo); mkdirSync(bin);
  const env = { PATH: `${bin}:${dirname(process.execPath)}:${dirname(GIT)}:/usr/bin:/bin`, HOME: root,
    TMPDIR: root, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", SIGNALGRID_LANE: lane };
  function git(args, cwd = repo) {
    const r = scratchGit(cwd, args, { env });
    assert.equal(r.status, 0, `fixture git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }
  function file(path, body) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
  git(["init", "-q", "-b", BASE]);
  git(["config", "user.name", "Delivery fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  file(join(repo, "scripts/lane-deliver.mjs"), readFileSync(join(ROOT, "scripts/lane-deliver.mjs")));
  file(join(repo, "scripts/lib/lane-identity.mjs"), readFileSync(join(ROOT, "scripts/lib/lane-identity.mjs")));
  file(join(repo, "scripts/check-lane-messages.mjs"), `process.exit(${gateFails ? 9 : 0});\n`);
  file(join(repo, "scripts/check-scheduled-routines.mjs"), "process.exit(0);\n");
  file(join(repo, "scripts/check-surface-review-coverage.mjs"), "process.exit(0);\n");
  file(join(repo, "docs/agent/SURFACE_REVIEW_COVERAGE.md"), "fixture\n");
  file(join(repo, "docs/agent/scheduled-routines.json"), JSON.stringify({ routines: [{ id: "mac-lane-tick", heartbeatPath: "artifacts/agent-heartbeats/mac-lane-tick.json" }] }));
  file(join(repo, "artifacts/agent-heartbeats/mac-lane-tick.json"), JSON.stringify({ firedAt: "2026-10-24T07:30:38Z", result: "old fixture" }));
  git(["add", "."]); git(["commit", "-qm", "fixture baseline"]);
  const base = git(["rev-parse", "HEAD"]);
  git(["init", "-q", "--bare", remote]);
  const url = "https://github.com/fixture/route.git";
  git(["remote", "add", "origin", remote]); git(["push", "-q", "origin", BASE]);
  const hook = join(remote, "hooks/pre-receive");
  file(hook, `#!/bin/sh\nwhile read old new ref; do\n case "$ref" in refs/heads/${BASE}) echo 'GH013: Repository rule violations: changes must be made through a pull request' >&2; exit 1;; esac\n ${reject ? "echo 'GH013: rejected by repository rule' >&2; exit 1" : ":"}\ndone\n`);
  chmodSync(hook, 0o755);
  // The wrapper always uses the real local Git. No request can reach GitHub.
  const wrapper = join(bin, "git");
  file(wrapper, `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nimport {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nif(args[0]==='remote'&&args[1]==='get-url'&&args[2]==='origin'){console.log(${JSON.stringify(url)});process.exit(0)}\nif(args[0]==='push')appendFileSync(${JSON.stringify(pushLog)},JSON.stringify(args)+'\\n');\n${failBeforePush ? "if(args[0]==='push'){console.error('fixture transport stopped before transmission');process.exit(1)}" : ""}\nconst r=spawnSync(${JSON.stringify(GIT)},args,{stdio:'inherit'});\n${loseResponse ? "if(args[0]==='push' && r.status===0){console.error('fixture transport response lost');process.exit(1)}" : ""}\nprocess.exit(r.status??1);\n`);
  chmodSync(wrapper, 0o755);
  const gh = join(bin, "gh");
  file(gh, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nconst a=process.argv.slice(2);appendFileSync(${JSON.stringify(ghLog)},JSON.stringify(a)+'\\n');\nif(a[0]==='--version'){${ghMissing ? "process.exit(1)" : "console.log('gh fixture')"}}\nelse if(a[0]==='pr'&&a[1]==='create'){${ghCreateFails ? "console.error('fixture creation response lost');process.exit(1)" : "console.log('https://github.com/fixture/route/pull/7')"}}\nelse if(a[0]==='pr'&&a[1]==='merge'&&a.includes('--auto')){${ghAutoFails ? "console.error('fixture auto-merge response lost');process.exit(1)" : "console.log('fixture auto-merge request')"}}\nelse process.exit(2);\n`);
  chmodSync(gh, 0o755);
  const records = (p) => existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { root, repo, base, git, run(extra = []) {
    return spawnSync(process.execPath, [join(repo, "scripts/lane-deliver.mjs"), "heartbeat", "mac-lane-tick", "acted: fixture", "--no-wake", ...extra], { cwd: repo, env, encoding: "utf8", timeout: 90000 });
  }, pushes: () => records(pushLog), ghCalls: () => records(ghLog), refs: () => git(["for-each-ref", "--format=%(refname)", "refs/heads"], remote).split("\n") };
}

function control(name, options, verify) {
  let f;
  try { f = fixture(options); verify(f); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
  finally { if (f) rmSync(f.root, { recursive: true, force: true }); }
}

for (const lane of ["mac", "cloud"]) control(`${lane} delivery uses a PR topic without changing canonical`, { lane }, (f) => {
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(f.git(["rev-parse", `refs/heads/${BASE}`], join(f.root, "remote.git")), f.base);
  assert.equal(f.pushes().length, 1);
  assert.match(f.pushes()[0].at(-1), new RegExp(`^HEAD:refs/heads/lane/${lane}-mail-`));
  assert.ok(f.ghCalls().some((a) => a[0] === "pr" && a[1] === "create"));
  const merge = f.ghCalls().find((a) => a[0] === "pr" && a[1] === "merge" && a.includes("--auto"));
  assert.ok(merge);
  const topic = f.pushes()[0].at(-1).slice("HEAD:".length);
  const published = f.git(["rev-parse", topic], join(f.root, "remote.git"));
  assert.match(published, /^[0-9a-f]{40}$/);
  assert.ok(merge.includes("--match-head-commit"), "auto-merge must bind the exact published head");
  assert.equal(merge[merge.indexOf("--match-head-commit") + 1], published);
});
control("Mac --via-pr remains compatible", {}, (f) => {
  const r = f.run(["--via-pr"]); assert.equal(r.status, 0, r.stderr);
  assert.match(f.pushes()[0].at(-1), /^HEAD:refs\/heads\/lane\/mac-mail-/);
  const topic = f.pushes()[0].at(-1).slice("HEAD:".length);
  const body = JSON.parse(f.git(["show", `${topic}:artifacts/agent-heartbeats/mac-lane-tick.json`], join(f.root, "remote.git")));
  assert.equal(body.result, "acted: fixture", "the compatibility flag must not become message text");
});
control("ruleset rejection is terminal after one push with no fallback", { lane: "cloud", reject: true }, (f) => {
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(f.pushes().length, 1); assert.match(r.stderr, /REFUSED|rules/i);
  assert.equal(f.refs().length, 1);
  assert.equal(f.ghCalls().filter((a) => a[0] === "pr").length, 0);
});
control("lost push response is confirmed by exact remote readback without a resend", { lane: "cloud", loseResponse: true }, (f) => {
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(f.pushes().length, 1);
  assert.equal(f.ghCalls().filter((a) => a[0] === "pr" && a[1] === "create").length, 1);
});
control("dry run makes no push or PR", {}, (f) => {
  const r = f.run(["--dry-run"]); assert.equal(r.status, 0, r.stderr);
  assert.equal(f.pushes().length, 0); assert.equal(f.ghCalls().length, 0);
});
control("a failed schema gate still prevents every push and PR", { gateFails: true }, (f) => {
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(f.pushes().length, 0); assert.equal(f.ghCalls().length, 0);
});
control("missing gh refuses before a topic push", { ghMissing: true }, (f) => {
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(f.pushes().length, 0);
});
control("Cloud without gh retains an explicit published-topic handoff", { lane: "cloud", ghMissing: true }, (f) => {
  const r = f.run(); assert.equal(r.status, 4, r.stderr);
  assert.equal(f.pushes().length, 1); assert.match(r.stdout + r.stderr, /handoff/i);
});
control("a failed push that did not land cannot open a PR", { lane: "cloud", failBeforePush: true }, (f) => {
  const r = f.run(); assert.equal(r.status, 3, r.stderr);
  assert.equal(f.pushes().length, 1); assert.equal(f.refs().length, 1);
  assert.equal(f.ghCalls().filter((a) => a[0] === "pr").length, 0);
});
for (const failure of ["ghCreateFails", "ghAutoFails"]) control(`${failure} is unconfirmed, never a submitted heartbeat`, { [failure]: true }, (f) => {
  const r = f.run(); assert.equal(r.status, 3, r.stderr);
  assert.equal(f.pushes().length, 1);
  assert.equal(f.ghCalls().filter((a) => a[0] === "pr" && a[1] === (failure === "ghCreateFails" ? "create" : "merge")).length, 1);
  assert.match(r.stderr, /readback|unconfirmed/i);
});

// Execute the real heartbeat function and estate block, with only their I/O
// dependencies replaced. This is a Bash/file control, not a launchd or live-gh proof.
function heartbeatFixture({ age = 30, lastResult = "quiet", result = "quiet", dry = false,
  deliveryCode = 0, priorAttempt = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sg-heartbeat-test-"));
  const cache = join(root, "node_modules"), deliveries = join(root, "deliveries");
  mkdirSync(cache); mkdirSync(join(root, "scripts/mac"), { recursive: true });
  writeFileSync(join(root, "scripts/mac/estate-queue.mjs"), "fixture\n");
  writeFileSync(join(cache, ".sg-last-heartbeat-result"), lastResult);
  const stamp = join(cache, ".sg-last-heartbeat"); writeFileSync(stamp, "");
  const aged = new Date(Date.now() - age * 60000); utimesSync(stamp, aged, aged);
  if (priorAttempt) {
    const id = "20261030T000000Z-999999";
    writeFileSync(join(cache, ".sg-last-heartbeat-attempt"), priorAttempt === "malformed" ? "../unowned" : id);
    writeFileSync(join(cache, `.sg-heartbeat-${id}.log`), "untrusted output: exit_code=0\n");
    if (priorAttempt !== "interrupted") writeFileSync(join(cache, `.sg-heartbeat-${id}.exit`), "3\n");
  }
  const tick = readFileSync(join(ROOT, "scripts/mac/lane-tick.sh"), "utf8");
  const start = tick.indexOf("heartbeat() {");
  const end = tick.indexOf("\n}\n", start) + 3;
  assert.ok(start >= 0 && end > start, "actual heartbeat implementation must be present");
  const heartbeat = tick.slice(start, end);
  const estateStart = tick.indexOf('ESTATE_STAMP="');
  const estateEnd = tick.indexOf("# ── e. heartbeat", estateStart);
  assert.ok(estateStart >= 0 && estateEnd > estateStart, "actual estate block must be present");
  const estate = tick.slice(estateStart, estateEnd);
  const declarations = tick.split("\n").filter((line) => /^(QUIET_HEARTBEAT_MIN|HB_[A-Z_]+|ESTATE_RESULT)=/.test(line)).join("\n");
  const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
  return { root, runTick(body = "heartbeat") {
    const script = `set -u\n${declarations}\nSTAMP=20261030T010000Z\nDRY=${dry ? 1 : 0}\nRESULT=${quote(result)}\nDELIVERY_RC=${deliveryCode}\nESTATE_RC=0\nESTATE_OUTPUT='estate: 0 open ()'\nsay(){ printf '%s\\n' "$1"; }\nappend_unread_state(){ :; }\nappend_raised_hands_state(){ :; }\ngh(){ return 0; }\nnode(){ if [ "$1" = scripts/lane-deliver.mjs ]; then printf '%s\\n' "$*" >> ${quote(deliveries)}; printf 'untrusted fixture output: exit_code=0\\n'; return "$DELIVERY_RC"; else printf '%s\\n' "$ESTATE_OUTPUT"; return "$ESTATE_RC"; fi; }\n${heartbeat}\nrun_estate(){\n${estate}\n}\n${body}\ntrue\n`;
    return spawnSync("/bin/bash", ["-c", script], { cwd: root,
      env: { PATH: "/usr/bin:/bin", HOME: root, LANG: "C" }, encoding: "utf8", timeout: 10000 });
  }, deliveries: () => existsSync(deliveries) ? readFileSync(deliveries, "utf8").trim().split("\n") : [] };
}
control("unchanged 30-minute heartbeat does not open another PR", { tick: true }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0);
});
control("unchanged heartbeat stays quiet for almost two hours", { tick: true, age: 115 }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0);
});
control("unchanged heartbeat gets its keepalive before the three-hour tolerance", { tick: true, age: 130 }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1);
});
control("a changed failure is reported inside the keepalive window", { tick: true, result: "failed: fixture gate" }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1);
});
for (const rc of [0, 42]) control(`hourly estate outcome ${rc} stays present on the next tick`, { tick: true }, (f) => {
  const r = f.runTick(`ESTATE_RC=${rc}\nrun_estate\nheartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nrun_estate\nheartbeat`);
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1, "a retained estate outcome must not flip out of RESULT");
});
control("estate failure clears only after another actual estate outcome", { tick: true }, (f) => {
  const r = f.runTick("ESTATE_RC=42\nrun_estate\nheartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nrun_estate\nheartbeat\ntouch -t 202001010000 node_modules/.sg-estate-last\nESTATE_RC=0\nSTAMP=20261030T020000Z\nRESULT=quiet\nrun_estate\nheartbeat");
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 2);
});
control("known failed submission is paced and is not called delivered", { tick: true, age: 130, deliveryCode: 1 }, (f) => {
  const r = f.runTick("heartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nheartbeat");
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1); assert.doesNotMatch(r.stdout, /heartbeat delivered/);
});
for (const priorAttempt of ["unknown", "interrupted", "malformed"]) control(`${priorAttempt} receipt blocks a fresh submission without a quiet inference`, { tick: true, age: 130, priorAttempt, result: "changed: fixture" }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0); assert.match(r.stdout, /readback|unconfirmed|unfinished|unknown/i);
});
control("an unconfirmed submission cannot retry on the next changed tick", { tick: true, age: 130, deliveryCode: 3 }, (f) => {
  const r = f.runTick("heartbeat\nSTAMP=20261030T010500Z\nRESULT='changed: fixture'\nheartbeat");
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1); assert.match(r.stdout, /readback|unconfirmed|unknown/i);
});
control("heartbeat dry run writes no submission receipt or stamp", { tick: true, dry: true, age: 130 }, (f) => {
  const before = readFileSync(join(f.root, "node_modules/.sg-last-heartbeat-result"), "utf8");
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0);
  assert.equal(readFileSync(join(f.root, "node_modules/.sg-last-heartbeat-result"), "utf8"), before);
  assert.equal(existsSync(join(f.root, "node_modules/.sg-last-heartbeat-attempt")), false);
});
console.log(`lane-delivery regression: ${passed} passed, ${failed} failed, 0 skipped`);
process.exitCode = failed ? 1 : 0;

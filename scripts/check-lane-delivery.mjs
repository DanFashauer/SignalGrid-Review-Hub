// Exercise the actual delivery CLI against disposable Git repositories only.
// Schema-gate and gh fixtures isolate transport; the real gates run separately.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, renameSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
  readbackCanonicalRace = false, fixedClock = false, readbackState = "MERGED", denyCleanup = false, ghAuthFails = false, ghCreateFails = false, ghAutoFails = false, wakeMailbox = false, hand = false, tick = false, ...tickOptions } = {}) {
  if (tick) return heartbeatFixture(tickOptions);
  const root = mkdtempSync(join(tmpdir(), "sg-delivery-test-"));
  const repo = join(root, "repo"), remote = join(root, "remote.git"), bin = join(root, "bin");
  const ghLog = join(root, "gh.jsonl"), pushLog = join(root, "push.jsonl"), mergeOID = join(root,"merge.oid"), handOps = join(root,"hand-ops.json");
  mkdirSync(repo); mkdirSync(bin);
  const env = { PATH: `${bin}:${dirname(process.execPath)}:${dirname(GIT)}:/usr/bin:/bin`, HOME: root,
    TMPDIR: root, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", SIGNALGRID_LANE: lane };
  if (fixedClock) {
    const clock=join(root,"fixed-clock.mjs");
    writeFileSync(clock,`const Original=Date;globalThis.Date=class extends Original{constructor(...a){super(...(a.length?a:["2026-10-31T00:00:00Z"]))}static now(){return Original.parse("2026-10-31T00:00:00Z")}};`);
    env.NODE_OPTIONS=`--import=${clock}`;
  }
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
  if(wakeMailbox==="malformed")file(join(repo,"docs/agent/lane-mailbox.json"),"{");
  if(wakeMailbox==="directory")file(join(repo,"docs/agent/lane-mailbox.json/.keep"),"fixture\n");
  if (hand) {
    file(handOps, JSON.stringify([{op:"raise",id:"fixture-build-hand",doing:"fixture build",blocked:"fixture cause",need:"fixture repair",who:"mac lane"}]));
    file(join(repo,"scripts/raise-hand.mjs"), `import {mkdirSync,writeFileSync} from 'node:fs';const a=process.argv.slice(2),id=a[a.indexOf('--id')+1];mkdirSync('artifacts/raised-hands',{recursive:true});writeFileSync('artifacts/raised-hands/'+id+'.json',JSON.stringify({id,status:'open',raisedAt:'2026-10-31T00:00:00Z'}));console.log('raised hand recorded: artifacts/raised-hands/'+id+'.json');`);
    for(const name of ['raised-hands.mjs','check-raised-hands.mjs'])file(join(repo,'scripts',name),'process.exit(0);\n');
  }
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
  file(wrapper, `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nimport {appendFileSync,readFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nif(args[0]==='remote'&&args[1]==='get-url'&&args[2]==='origin'){console.log(${JSON.stringify(url)});process.exit(0)}\nif(args[0]==='push')appendFileSync(${JSON.stringify(pushLog)},JSON.stringify(args)+'\\n');\n${failBeforePush ? "if(args[0]==='push'){console.error('fixture transport stopped before transmission');process.exit(1)}" : ""}\nconst r=spawnSync(${JSON.stringify(GIT)},args,{stdio:'inherit'});\n${readbackCanonicalRace ? `if(args[0]==='fetch'&&r.status===0){try{const rows=readFileSync(${JSON.stringify(pushLog)},'utf8').trim().split(String.fromCharCode(10)).filter(Boolean).map(JSON.parse);const ref=rows.at(-1).at(-1).slice('HEAD:'.length);const oid=spawnSync(${JSON.stringify(GIT)},['--git-dir',${JSON.stringify(remote)},'rev-parse',ref],{encoding:'utf8'}).stdout.trim();if(/^[a-f0-9]{40}$/.test(oid))writeFileSync(${JSON.stringify(join(repo,'.git/FETCH_HEAD'))},oid+String.fromCharCode(9,9)+'concurrent fixture fetch'+String.fromCharCode(10));}catch{}}` : ""}\n${loseResponse ? "if(args[0]==='push' && r.status===0){console.error('fixture transport response lost');process.exit(1)}" : ""}\nprocess.exit(r.status??1);\n`);
  chmodSync(wrapper, 0o755);
  const gh = join(bin, "gh");
  file(gh, `#!${process.execPath}\nimport {appendFileSync,chmodSync,existsSync,readFileSync} from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst a=process.argv.slice(2);appendFileSync(${JSON.stringify(ghLog)},JSON.stringify(a)+'\\n');\nif(a[0]==='pr'&&a[1]==='view'){
 const m=${readbackState === "MERGED"} && spawnSync(${JSON.stringify(GIT)},['--git-dir',${JSON.stringify(remote)},'rev-parse',existsSync(${JSON.stringify(mergeOID)}) ? readFileSync(${JSON.stringify(mergeOID)},'utf8').trim() : ${readbackCanonicalRace ? "'refs/heads/'+a[2]" : JSON.stringify('refs/heads/'+BASE)}],{encoding:'utf8'}).stdout.trim();
 console.log(JSON.stringify({number:7,state:${JSON.stringify(readbackState)},baseRefName:${JSON.stringify(BASE)},mergeCommit:m?{oid:m}:null,autoMergeRequest:${readbackState === "OPEN" ? "{}" : "null"}}));
}
else if(a[0]==='auth'&&a[1]==='status'){${ghAuthFails ? "process.exit(1)" : "process.exit(0)"}}\nelse if(a[0]==='pr'&&a[1]==='create'){${ghCreateFails ? "console.error('fixture creation response lost or unauthenticated');process.exit(1)" : "console.log('https://github.com/fixture/route/pull/7')"}}\nelse if(a[0]==='pr'&&a[1]==='merge'&&a.includes('--auto')){${ghAutoFails ? "console.error('fixture auto-merge response lost');process.exit(1)" : `${denyCleanup ? `chmodSync(${JSON.stringify(root)},0o500);` : ""}console.log('fixture auto-merge request')`}}\nelse process.exit(2);\n`);
  chmodSync(gh, 0o755);
  const records = (p) => existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { root, repo, base, git, run(extra = []) {
    return spawnSync(process.execPath, [join(repo, "scripts/lane-deliver.mjs"), ...(hand ? ["batch",handOps] : ["heartbeat", "mac-lane-tick", "acted: fixture"]), ...(wakeMailbox ? [] : ["--no-wake"]), ...extra], { cwd: repo, env, encoding: "utf8", timeout: 90000 });
  }, readback(path, extra = []) {
    return spawnSync(process.execPath,[join(repo,"scripts/lane-deliver.mjs"),"readback",path,...extra],{cwd:repo,env,encoding:"utf8",timeout:90000});
  }, refresh({tamper=false}={}) {
    const target=records(pushLog).at(-1).at(-1).slice("HEAD:".length);
    const original=git(["rev-parse",target],remote);
    file(join(repo,"artifacts/agent-heartbeats/keeper.json"),"{\"result\":\"another canonical landing\"}\n");
    git(["add","artifacts/agent-heartbeats/keeper.json"]);git(["commit","-qm","disposable canonical advance"]);
    const advanced=git(["rev-parse","HEAD"]);git(["fetch",repo,`HEAD:refs/heads/${BASE}`],remote);
    git(["checkout","-q","--detach",original]);git(["merge","--no-ff","--no-edit",advanced]);
    if(tamper){file(join(repo,"artifacts/agent-heartbeats/mac-lane-tick.json"),"{\"result\":\"payload changed\"}\n");git(["add","artifacts/agent-heartbeats/mac-lane-tick.json"]);git(["commit","-qm","disposable changed payload"]);}
    const refreshed=git(["rev-parse","HEAD"]);git(["fetch",repo,`HEAD:${target}`],remote);git(["checkout","-q",BASE]);
    assert.notEqual(refreshed,original);
  }, land() {
    const target=records(pushLog).at(-1).at(-1).slice("HEAD:".length);
    git(["fetch","origin",target]);git(["merge","--no-ff","--no-edit","FETCH_HEAD"]);
    writeFileSync(mergeOID,git(["rev-parse","HEAD"])); // real PR merge identity stays fixed after later canonical commits
    git(["fetch",repo,`HEAD:refs/heads/${BASE}`],remote); // disposable fixture's simulated protected merge
  }, clearHand(resolution = "fixture repair verified") {
    const path=join(repo,"artifacts/raised-hands/fixture-build-hand.json");
    const value=JSON.parse(readFileSync(path,"utf8"));
    file(path,JSON.stringify({...value,status:"resolved",resolution,resolvedAt:"2026-10-31T01:00:00Z",resolvedBy:"mac"}));
    git(["add","artifacts/raised-hands/fixture-build-hand.json"]);git(["commit","-qm","disposable canonical hand resolution"]);
    git(["fetch",repo,`HEAD:refs/heads/${BASE}`],remote);
    return git(["rev-parse","HEAD:artifacts/raised-hands/fixture-build-hand.json"]);
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
  const r = f.run(); assert.equal(r.status, 1);
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

for (const damaged of ["missing", "malformed"]) control(`a ${damaged} independent terminal with a child receipt cannot admit new work`, {tick:true,age:130,priorAttempt:"interrupted",result:"changed fixture"},f=>{
 const base=join(f.root,"node_modules/.sg-heartbeat-20261030T000000Z-999999");
 writeFileSync(base+".submission.json",'{"fixtureSubmission":true}\n');
 if(damaged==="malformed")writeFileSync(base+".exit","not-a-parent-exit\n");
 const r=f.runTick();assert.equal(r.status,0,r.stderr);assert.equal(f.deliveries().length,0);assert.match(r.stdout,/RAISED HAND/);
});
// Execute the real heartbeat function and estate block, with only their I/O
// dependencies replaced. This is a Bash/file control, not a launchd or live-gh proof.
function heartbeatFixture({ age = 30, result = "quiet", dry = false,
  deliveryCode = 0, priorAttempt = null, agedPrior = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sg-heartbeat-test-"));
  const cache = join(root, "node_modules"), deliveries = join(root, "deliveries"), readbacks = join(root,"readbacks");
  mkdirSync(cache); mkdirSync(join(root, "scripts/mac"), { recursive: true });
  writeFileSync(join(root, "scripts/mac/estate-queue.mjs"), "fixture\n");
  writeFileSync(join(cache, ".sg-last-heartbeat-result"), "quiet");
  const stamp = join(cache, ".sg-last-heartbeat-attempt");
  const aged = new Date(Date.now() - age * 60000);
  if (!priorAttempt && (age < 120 || agedPrior)) {
    const id="20261030T000000Z-999998";
    writeFileSync(stamp,id); writeFileSync(join(cache,`.sg-heartbeat-${id}.log`),"frozen prior intent\n");
    writeFileSync(join(cache,`.sg-heartbeat-${id}.exit`),"0\n");
    writeFileSync(join(cache,`.sg-heartbeat-${id}.submission.json`),'{"fixtureSubmission":true}\n');
  }
  if (priorAttempt) {
    const id = priorAttempt === "malformed" ? "invalid-id" : "20261030T000000Z-999999";
    writeFileSync(join(cache, ".sg-last-heartbeat-attempt"), id);
    writeFileSync(join(cache, `.sg-heartbeat-${id}.log`), "untrusted output: exit_code=0\n");
    if (priorAttempt !== "interrupted") writeFileSync(join(cache, `.sg-heartbeat-${id}.exit`), priorAttempt === "malformed" ? "1\n" : "3\n");
  }
  if (existsSync(stamp)) utimesSync(stamp, aged, aged);
  const tick = readFileSync(join(ROOT, "scripts/mac/lane-tick.sh"), "utf8");
  const start = tick.indexOf("heartbeat() {");
  const end = tick.indexOf("\n}\n", start) + 3;
  assert.ok(start >= 0 && end > start, "actual heartbeat implementation must be present");
  const heartbeat = tick.slice(start, end);
  const writerStart=tick.indexOf("tick_record() {"),writerTerminator="\nJS\n}\n";
  const writerEnd=tick.indexOf(writerTerminator,writerStart)+writerTerminator.length;
  assert.ok(writerStart>=0&&writerEnd>writerStart,"actual shared record writer must have its complete heredoc");
  const recordHelper=tick.slice(writerStart,writerEnd);
  const estateStart = tick.indexOf('ESTATE_STAMP="');
  const estateEnd = tick.indexOf("# ── e. heartbeat", estateStart);
  assert.ok(estateStart >= 0 && estateEnd > estateStart, "actual estate block must be present");
  const estate = tick.slice(estateStart, estateEnd);
  const declarations = tick.split("\n").filter((line) => /^(QUIET_HEARTBEAT_MIN|HB_[A-Z_]+|ESTATE_RESULT)=/.test(line)).join("\n");
  const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
  return { root, runTick(body = "heartbeat") {
    const script = `set -u\nRECORD_DIR=${quote(cache)}\n${declarations}\nSTAMP=20261030T010000Z\nDRY=${dry ? 1 : 0}\nRESULT=${quote(result)}\nDELIVERY_RC=${deliveryCode}\nESTATE_RC=0\nESTATE_OUTPUT='estate: 0 open ()'\nsay(){ printf '%s\\n' "$1"; }\nappend_unread_state(){ :; }\nappend_raised_hands_state(){ :; }\ngh(){ return 0; }\nnode(){ if [ "$1" = scripts/lane-deliver.mjs ]; then if [ "$2" = readback ]; then printf 'readback\\n' >> "$FIXTURE_READBACK_LOG"; if [ "\${READBACK_RC:-$DELIVERY_RC}" = 0 ]; then printf 'canonical fixture merge verified\\n'; else printf 'original fixture PR still pending or unavailable\\n'; fi; return "\${READBACK_RC:-$DELIVERY_RC}"; fi; printf '%s\\n' "$*" >> ${quote(deliveries)}; for _arg in "$@"; do if [ "\${_want_receipt:-0}" = 1 ]; then printf '{"fixtureSubmission":true}\\n' > "$_arg"; _want_receipt=0; fi; if [ "$_arg" = --receipt ]; then _want_receipt=1; fi; done; printf 'untrusted fixture output: exit_code=0\\n'; return "$DELIVERY_RC"; elif [ "$1" = scripts/mac/estate-queue.mjs ]; then printf '%s\\n' "$ESTATE_OUTPUT"; return "$ESTATE_RC"; else "$FIXTURE_NODE" "$@"; fi; }\n${recordHelper}\n${heartbeat}\nrun_estate(){\n${estate}\n}\n${body}\ntrue\n`;
    return spawnSync("/bin/bash", ["-c", script], { cwd: root,
      env: { PATH: "/usr/bin:/bin", HOME: root, LANG: "C", FIXTURE_NODE:process.execPath, FIXTURE_READBACK_LOG:readbacks }, encoding: "utf8", timeout: 10000 });
  }, deliveries: () => existsSync(deliveries) ? readFileSync(deliveries, "utf8").trim().split("\n") : [], readbacks:()=>existsSync(readbacks)?readFileSync(readbacks,"utf8").trim().split("\n"):[] };
}
control("unchanged heartbeat stays quiet for almost two hours", { tick: true, age: 115 }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0);
});
control("unchanged heartbeat gets its keepalive before the three-hour tolerance", { tick: true, age: 130 }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1);
});
control("a changed failure is reported inside the keepalive window", { tick: true, result: "failed: fixture gate" }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1);
});
control("hourly estate failure stays present on the next tick", { tick: true }, (f) => {
  const r = f.runTick(`ESTATE_RC=42\nrun_estate\nheartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nrun_estate\nheartbeat`);
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1, "a retained estate outcome must not flip out of RESULT");
});
control("estate failure clears only after another actual estate outcome", { tick: true }, (f) => {
  const r = f.runTick("ESTATE_RC=42\nrun_estate\nheartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nrun_estate\nheartbeat\ntouch -t 202001010000 node_modules/.sg-estate-last\nESTATE_RC=0\nSTAMP=20261030T020000Z\nRESULT=quiet\nrun_estate\nheartbeat");
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 2);
});
control("known failed submission is paced and is not called delivered", { tick: true, age: 130, deliveryCode: 1 }, (f) => {
  const r = f.runTick("heartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nheartbeat");
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1); assert.match(r.stdout, /WARN heartbeat submission not confirmed/); assert.doesNotMatch(r.stdout, /heartbeat (submitted|delivered)/);
});
for (const priorAttempt of ["unknown", "interrupted", "malformed"]) control(`${priorAttempt} receipt blocks a fresh submission without a quiet inference`, { tick: true, age: 130, priorAttempt, result: "changed: fixture" }, (f) => {
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0); assert.match(r.stdout, /RAISED HAND/); assert.match(r.stdout, /READBACK ONLY/); assert.doesNotMatch(r.stdout, /heartbeat (submitted|delivered)/);
});
control("an unconfirmed submission cannot retry on the next changed tick", { tick: true, age: 130, deliveryCode: 3 }, (f) => {
  const r = f.runTick("heartbeat\nSTAMP=20261030T010500Z\nRESULT='changed: fixture'\nheartbeat");
  assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 1); assert.match(r.stdout, /WARN heartbeat submission not confirmed/); assert.doesNotMatch(r.stdout, /heartbeat (submitted|delivered)/);
});
control("heartbeat dry run writes no submission receipt or stamp", { tick: true, dry: true, age: 130 }, (f) => {
  const before = readFileSync(join(f.root, "node_modules/.sg-last-heartbeat-result"), "utf8");
  const r = f.runTick(); assert.equal(r.status, 0, r.stderr); assert.equal(f.deliveries().length, 0);
  assert.equal(readFileSync(join(f.root, "node_modules/.sg-last-heartbeat-result"), "utf8"), before);
  assert.equal(existsSync(join(f.root,"node_modules/.sg-last-heartbeat-attempt")),false);
});

control("expired Mac gh authentication refuses before every topic push", { ghAuthFails: true }, (f) => {
  const r=f.run(); assert.equal(r.status,1,r.stderr); assert.equal(f.pushes().length,0);
  assert.ok(f.ghCalls().some(a=>a[0]==="auth"&&a[1]==="status"));
});
control("a real successful heartbeat advances the APFS keepalive timestamp", { tick:true,age:130,agedPrior:true }, f=>{
  const p=join(f.root,"node_modules/.sg-last-heartbeat-attempt");
  const before=statSync(p).mtimeMs; const r=f.runTick();assert.equal(r.status,0,r.stderr);
  assert.ok(statSync(p).mtimeMs>before+60000,"the attempt pointer must actually advance");
});

function objectiveCaller(rc) {
  const root=mkdtempSync(join(tmpdir(),"sg-objective-delivery-test-"));
  mkdirSync(join(root,"node_modules"));
  const source=readFileSync(join(ROOT,"scripts/objective-loop.mjs"),"utf8");
  const start=source.indexOf("function emit(state,");
  const end=source.indexOf("// ── --check:",start);
  assert.ok(start>=0&&end>start);
  const harness=join(root,"caller.mjs");
  writeFileSync(harness,`
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const deliveryRecordDirectory=()=>${JSON.stringify(join(root,'node_modules'))};\nconst ROOT=${JSON.stringify(root)},STATE_REL='state.json',STAMP_REL='node_modules/.sg-objective-loop-last.json';
const calls=[];
function spawnSync(){calls.push(1);return {status:${rc},stdout:'fixture raw output',stderr:''};}
${source.slice(start,end)}
const state={decisionAddress:'fixture-d',derivedAt:'2026-10-31T00:00:00Z',queue:[],escalations:[{id:'fixture-executor',clears:'cloud',asks:'repair'}],criteria:[],tasks:[],verdict:'building'};
const results=[];
for(let n=0;n<3;n++){
 results.push(emit(state,{write:true,deliver:true}));
 if(n<2){rmSync(join(ROOT,STATE_REL),{force:true});rmSync(join(ROOT,STAMP_REL),{force:true});}
}
console.log(JSON.stringify({calls:calls.length,results,stamp:JSON.parse(readFileSync(join(ROOT,STAMP_REL),'utf8'))}));
`);
  try {
    const r=spawnSync(process.execPath,[harness],{cwd:root,encoding:"utf8"});
    assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
  } finally {rmSync(root,{recursive:true,force:true});}
}
for(const rc of [0,3]) {
  try {
    const r=objectiveCaller(rc);
    assert.equal(r.calls,1,"resetting tracked/stamp state must never resubmit a consumed escalation");
    assert.equal(r.stamp.deliveredEscalations,undefined,"pending PR is never labelled delivered");
    if(rc===3)assert.match(r.results.flatMap(x=>x.lines).join('\n'),/READBACK ONLY|RAISED HAND/);
    passed++;console.log(`PASS objective exit ${rc} survives three ticks and discarded delivery stamps`);
  } catch(e){failed++;console.error(`FAIL objective exit ${rc}: ${e.message}`);}
}

for (const suffix of ["plain", "space 'single' \"double\" $(touch shell-path-marker) `touch backtick-marker`"]) {
  const parent=mkdtempSync(join(tmpdir(),"sg-build-hand-delivery-test-"));
  const root=join(parent,suffix);mkdirSync(root);
  try {
    const source=readFileSync(join(ROOT,"scripts/mac/build-tick.sh"),"utf8");
    const start=source.indexOf('raise_hand() {'),end=source.indexOf('\nfail() {',start);
    assert.ok(start>=0&&end>start);
    const calls=join(root,'calls');
    const script=`set -u\nDRY=0\nCACHE="$FIXTURE_ROOT"\nREPO_ROOT="$FIXTURE_ROOT"\nSTAMP=20261031T000000Z\nRUN_LOG="$FIXTURE_RUN_LOG"\nsay(){ printf '%s\\n' "$1"; }\nnode(){ if [ "$1" = "$REPO_ROOT/scripts/lib/lane-attempt-store.mjs" ]; then printf '%s\\n' "$FIXTURE_ROOT"; elif [ "$1" = "$REPO_ROOT/scripts/lane-deliver.mjs" ]; then printf 'call\\n' >> "$FIXTURE_CALLS"; return 3; else "$FIXTURE_NODE" "$@"; fi; }\n${source.slice(start,end)}\nraise_hand 'fixture failure'\nraise_hand 'fixture failure'\nraise_hand 'fixture failure'\ntrue\n`;
    const r=spawnSync('/bin/bash',['-c',script],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root,FIXTURE_ROOT:root,FIXTURE_RUN_LOG:join(root,'run.log'),FIXTURE_CALLS:calls,FIXTURE_NODE:process.execPath},encoding:'utf8'});
    assert.equal(existsSync(join(root,'shell-path-marker')),false,'path command substitution must never execute');
    assert.equal(existsSync(join(root,'backtick-marker')),false,'path backticks must never execute');
    assert.equal(r.status,0,r.stderr);
    assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1,'unknown hand delivery is never re-submitted');
    assert.match(r.stdout,/READBACK ONLY|unconfirmed/);assert.doesNotMatch(r.stdout,/hand submitted/);
    passed++;console.log(`PASS build hand ${suffix==="plain"?"plain":"special-character path"} unknown attempt is durable across repeated calls`);
  } catch(e){failed++;console.error(`FAIL build hand one-attempt fence: ${e.message}`);}
  finally {rmSync(parent,{recursive:true,force:true});}
}


for(const kind of ["exact","pending","refreshed","not-canonical"])control(`original submission ${kind} readback never republishes`,{readbackState:kind==="pending"?"OPEN":"MERGED"},f=>{
 const receipt=join(f.root,"submission.json");
 const sent=f.run(["--receipt",receipt]);assert.equal(sent.status,0,sent.stderr);
 assert.ok(existsSync(receipt),"exact source receipt must be written before publication");
 if(kind==="refreshed")f.refresh();
 if(kind!=="pending"&&kind!=="not-canonical")f.land();
 const before=f.pushes().length,mutations=f.ghCalls().filter(a=>a[0]==="pr"&&["create","merge"].includes(a[1])).length;
 const r=f.readback(receipt);assert.equal(r.status,["exact","refreshed"].includes(kind)?0:kind==="pending"?4:3,r.stderr);
 assert.equal(f.pushes().length,before);
 assert.equal(f.ghCalls().filter(a=>a[0]==="pr"&&["create","merge"].includes(a[1])).length,mutations);
 if(["exact","refreshed"].includes(kind))assert.match(r.stdout,/canonical merge verified/);
 else assert.doesNotMatch(r.stdout,/canonical merge verified/);
 assert.ok(readdirSync(f.root).some(n=>n.startsWith("submission.json.readback-")),"raw response must survive before parsed acceptance");
});
control("two submissions within the same second have distinct topics",{fixedClock:true},f=>{
 const a=f.run(),b=f.run();assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);
 assert.notEqual(f.pushes()[0].at(-1),f.pushes()[1].at(-1));
});


control("known prepublication refusal permits a fresh observation before the staleness bound",{tick:true,age:15,priorAttempt:"unknown"},f=>{
 writeFileSync(join(f.root,"node_modules/.sg-heartbeat-20261030T000000Z-999999.exit"),"1\n");
 const r=f.runTick();assert.equal(r.status,0,r.stderr);assert.equal(f.deliveries().length,1);
});


control("a pending heartbeat PR holds changed results until exact canonical readback",{tick:true,age:130},f=>{
 const r=f.runTick("heartbeat\\nSTAMP=20261030T010500Z\\nRESULT='changed fixture'\\nREADBACK_RC=4\\nheartbeat\\nSTAMP=20261030T011000Z\\nREADBACK_RC=0\\nheartbeat".replaceAll("\\n","\n"));
 assert.equal(r.status,0,r.stderr);assert.equal(f.deliveries().length,2);
 assert.match(r.stdout,/still pending/);assert.match(r.stdout,/canonical fixture merge verified/);
});


control("a concurrent FETCH_HEAD change cannot attest an unmerged canonical blob",{readbackCanonicalRace:true},f=>{
 const receipt=join(f.root,"submission.json");const sent=f.run(["--receipt",receipt]);assert.equal(sent.status,0,sent.stderr);
 const before=f.pushes().length,r=f.readback(receipt);
 assert.equal(r.status,3,"canonical must be the immutable remote OID, never concurrent FETCH_HEAD");
 assert.doesNotMatch(r.stdout,/canonical merge verified/);assert.equal(f.pushes().length,before);
 assert.equal(f.git(["rev-parse",`refs/heads/${BASE}`],join(f.root,"remote.git")),f.base);
});


control("local replace refs cannot attest a topic absent from canonical",{readbackCanonicalRace:true},f=>{
 const receipt=join(f.root,"submission.json");const sent=f.run(["--receipt",receipt]);assert.equal(sent.status,0,sent.stderr);
 const p=JSON.parse(readFileSync(receipt,"utf8")),tree=f.git(["rev-parse",p.head+"^{tree}"]);
 const forged=f.git(["commit-tree",tree,"-p",p.head,"-m","disposable local graph shadow"]);
 f.git(["replace",f.base,forged]);
 const r=f.readback(receipt);assert.equal(r.status,3,"canonical ancestry must read real Git objects");assert.doesNotMatch(r.stdout,/canonical merge verified/);
});

for(const kind of ["malformed","directory"])control(`unusable optional wake metadata ${kind} preserves accepted submission`,{wakeMailbox:kind},f=>{
 const r=f.run();
 assert.equal(f.pushes().length,1);
 assert.equal(f.ghCalls().filter(a=>a[0]==="pr"&&a[1]==="create").length,1);
 assert.equal(f.ghCalls().filter(a=>a[0]==="pr"&&a[1]==="merge").length,1);
 assert.equal(r.status,0,"already accepted PR submission is pending, never a prepublication refusal: "+r.stderr);
 assert.equal(f.ghCalls().filter(a=>a[0]==="pr"&&a[1]==="comment").length,0);
 assert.match(r.stdout,/wake.*(unavailable|no usable)/);
 assert.match(r.stdout,/submitted.*canonical merge pending/);
});


control("refreshed pending PR waits without a repeated publication",{readbackState:"OPEN"},f=>{
 const receipt=join(f.root,"submission.json");assert.equal(f.run(["--receipt",receipt]).status,0);f.refresh();
 const before=f.pushes().length,r=f.readback(receipt);assert.equal(r.status,4,r.stderr);assert.equal(f.pushes().length,before);assert.match(r.stdout,/pending/);
});
control("a refreshed merge with changed original payload is refused",{},f=>{
 const receipt=join(f.root,"submission.json");assert.equal(f.run(["--receipt",receipt]).status,0);f.refresh({tamper:true});f.land();
 const before=f.pushes().length,r=f.readback(receipt);assert.equal(r.status,3);assert.match(r.stderr,/canonical blob differs/);assert.doesNotMatch(r.stdout,/canonical merge verified/);assert.equal(f.pushes().length,before);
});
control("actual cleanup permission failure after accepted publication stays readback-only",{denyCleanup:true},f=>{
 const r=f.run();chmodSync(f.root,0o700);
 assert.equal(f.pushes().length,1);assert.equal(f.ghCalls().filter(a=>a[0]==="pr"&&a[1]==="create").length,1);assert.equal(f.ghCalls().filter(a=>a[0]==="pr"&&a[1]==="merge").length,1);
 assert.equal(r.status,3,"an unexpected error after accepted mutation must never be exit1 prepublication refusal: "+r.stderr);assert.match(r.stderr,/readback only/i);
});
control("successful unchanged ticks defer remote readback until a due observation",{tick:true,age:130},f=>{
 const r=f.runTick("heartbeat\nSTAMP=20261030T010500Z\nRESULT=quiet\nheartbeat\nSTAMP=20261030T011000Z\nRESULT='changed fixture'\nheartbeat");
 assert.equal(r.status,0,r.stderr);assert.equal(f.deliveries().length,2);assert.equal(f.readbacks().length,1,"only the changed/due observation needs canonical readback");
});
control("volatile successful estate counts do not defeat the two-hour keepalive",{tick:true,age:30},f=>{
 const r=f.runTick("ESTATE_OUTPUT='estate: 1 open; considered 1'\nrun_estate\nheartbeat\ntouch -t 202001010000 node_modules/.sg-estate-last\nSTAMP=20261030T020000Z\nRESULT=quiet\nESTATE_OUTPUT='estate: 2 open; considered 2'\nrun_estate\nheartbeat");
 assert.equal(r.status,0,r.stderr);assert.equal(f.deliveries().length,0);assert.match(r.stdout,/estate: 1 open/);assert.match(r.stdout,/estate: 2 open/);assert.equal(existsSync(join(f.root,"node_modules/.sg-estate-result")),false);
});
control("unauthenticated Cloud gh uses the explicit published-topic handoff",{lane:"cloud",ghAuthFails:true},f=>{
 const r=f.run();assert.equal(r.status,4,r.stderr);assert.equal(f.pushes().length,1);assert.equal(f.ghCalls().filter(a=>a[0]==="pr").length,0);assert.match(r.stderr,/handoff/);
});
control("a hardlinked heartbeat pointer cannot truncate its other inode name",{tick:true,age:130,priorAttempt:"unknown",result:"changed fixture"},f=>{
 const cache=join(f.root,"node_modules"),pointer=join(cache,".sg-last-heartbeat-attempt"),human=join(f.root,"preserved-file");
 const original=readFileSync(pointer);writeFileSync(human,original,{mode:0o600});rmSync(pointer);linkSync(human,pointer);
 writeFileSync(join(cache,".sg-heartbeat-20261030T000000Z-999999.exit"),"1\n");
 const r=f.runTick();assert.equal(r.status,0,r.stderr);assert.equal(f.deliveries().length,0);assert.deepEqual(readFileSync(human),original);assert.match(r.stdout,/WARN could not preserve heartbeat intent/);
});
{
 const source=readFileSync(join(ROOT,"scripts/mac/lane-tick.sh"),"utf8"),start=source.indexOf('LOOP_VERDICT="not run"'),end=source.indexOf('# ── d. deliver results',start);
 try{
  assert.ok(start>=0&&end>start);const script=`set -u\nDRY=0\nsay(){ printf '%s\\n' "$1"; }\nnode(){ printf '%s\\n' 'objective-loop: fixture — summary' 'RAISED HAND: original delivery held' 'WARN fixture terminal recording failed'; return 0; }\n${source.slice(start,end)}\n`;
  const r=spawnSync('/bin/bash',['-c',script],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/RAISED HAND: original delivery held/);assert.match(r.stdout,/WARN fixture terminal recording failed/);
  passed++;console.log('PASS successful objective summary preserves its held-delivery warnings');
 }catch(e){failed++;console.error('FAIL successful objective warning visibility: '+e.message);}
}

{

const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
function run(cmd,args,cwd,extra={}){return spawnSync(cmd,args,{cwd,encoding:'utf8',env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',...extra}})}
function setup(){const parent=mkdtempSync(join(tmpdir(),'sg-shared-record-test-')),root=join(parent,'primary'),linked=join(parent,'tick');mkdirSync(root);
 const g=a=>{const r=scratchGit(root,a,{env:{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});assert.equal(r.status,0,r.stderr)};
 g(['init','-q','-b','fixture']);g(['config','user.name','Fixture']);g(['config','user.email','fixture@example.invalid']);
 mkdirSync(join(root,'scripts/lib'),{recursive:true});const module=join(ROOT,'scripts/lib/lane-attempt-store.mjs');
 writeFileSync(join(root,'scripts/lib/lane-attempt-store.mjs'),readFileSync(module));
 writeFileSync(join(root,'fixture'),'fixture');g(['add','.']);g(['commit','-qm','fixture']);g(['worktree','add','-q','--detach',linked]);
 const r=run(process.execPath,[join(root,'scripts/lib/lane-attempt-store.mjs'),'init',root],root);assert.equal(r.status,0,r.stderr);
 return {parent,root,linked};
}
function check(label,fn){const f=setup();try{fn(f);passed++;console.log('PASS '+label)}catch(e){failed++;console.error('FAIL '+label+': '+e.message)}finally{rmSync(f.parent,{recursive:true,force:true})}}
function heartbeat(f,cwd){mkdirSync(join(cwd,'node_modules'),{recursive:true});const tick=readFileSync(join(ROOT,'scripts/mac/lane-tick.sh'),'utf8');
 const start=tick.indexOf('heartbeat() {'),end=tick.indexOf('\n}\n',start)+3,ws=tick.indexOf('tick_record() {'),we=tick.indexOf('\nJS\n}\n',ws)+7;
 assert.ok(start>=0&&end>start&&ws>=0&&we>ws);
 const declarations=tick.split('\n').filter(l=>/^(QUIET_HEARTBEAT_MIN|HB_[A-Z_]+|ESTATE_RESULT)=/.test(l)).join('\n');
 const script=`set -u\nRECORD_DIR=$("$FIXTURE_NODE" ${q(join(cwd,'scripts/lib/lane-attempt-store.mjs'))} path ${q(cwd)})\n${declarations}\nSTAMP=20261031T010000Z\nDRY=0\nRESULT=quiet\nsay(){ printf '%s\\n' "$1"; }\nappend_unread_state(){ :; }\nappend_raised_hands_state(){ :; }\nnode(){ if [ "$1" = scripts/lane-deliver.mjs ]; then if [ "$2" = readback ]; then return 4; fi; printf 'mutation\\n' >> "$FIXTURE_CALLS"; for _arg in "$@"; do if [ "\${want:-0}" = 1 ]; then printf '{"fixture":true}\\n' > "$_arg"; want=0; fi; if [ "$_arg" = --receipt ]; then want=1; fi; done; return 0; else "$FIXTURE_NODE" "$@"; fi; }\n${tick.slice(ws,we)}\n${tick.slice(start,end)}\nheartbeat\ntrue\n`;
 const r=run('/bin/bash',['-c',script],cwd,{FIXTURE_NODE:process.execPath,FIXTURE_CALLS:join(f.parent,'calls')});assert.equal(r.status,0,r.stderr);
}
function calls(f){return readFileSync(join(f.parent,'calls'),'utf8').trim().split('\n').length}
check('pending heartbeat is one chain across primary and linked tick worktree',f=>{heartbeat(f,f.root);heartbeat(f,f.linked);assert.equal(calls(f),1)});
check('removing both node_modules cannot erase a pending heartbeat fence',f=>{heartbeat(f,f.root);rmSync(join(f.root,'node_modules'),{recursive:true});heartbeat(f,f.root);assert.equal(calls(f),1)});
for(const purge of [false,true])check('one escalation across '+(purge?'dependency purge':'linked checkouts'),f=>{
 const source=readFileSync(join(ROOT,'scripts/objective-loop.mjs'),'utf8');const a=source.indexOf('function emit(state,'),b=source.indexOf('// ── --check:',a);assert.ok(a>=0&&b>a);
 const harness=join(f.parent,'objective.mjs');writeFileSync(harness,`import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {createHash} from 'node:crypto';import {deliveryRecordDirectory} from ${JSON.stringify('file://'+join(f.root,'scripts/lib/lane-attempt-store.mjs'))};\nlet ROOT=${JSON.stringify(f.root)};const STATE_REL='state.json',STAMP_REL='node_modules/stamp.json';let calls=0;function spawnSync(){calls++;return {status:3,stdout:'raw fixture',stderr:''}}\n${source.slice(a,b)}\nconst state={decisionAddress:'d',derivedAt:'2026-10-31T01:00:00Z',queue:[],escalations:[{id:'same-source-escalation',clears:'cloud',asks:'repair'}],criteria:[],tasks:[],verdict:'building'};emit(state,{write:true,deliver:true});rmSync(join(ROOT,STATE_REL),{force:true});${purge?"rmSync(join(ROOT,'node_modules'),{recursive:true,force:true});":"ROOT="+JSON.stringify(f.linked)+";"}emit(state,{write:true,deliver:true});console.log(calls);`);
 const r=run(process.execPath,[harness],f.root);assert.equal(r.status,0,r.stderr);assert.equal(Number(r.stdout.trim()),1);
});

check('inherited Git environment cannot redirect the shared attempt store',f=>{
 const other=setup();
 try {
  const module=join(f.root,'scripts/lib/lane-attempt-store.mjs');
  const expected=run(process.execPath,[module,'path',f.root],f.root);assert.equal(expected.status,0,expected.stderr);
  const actual=run(process.execPath,[module,'path',f.root],f.root,{GIT_DIR:join(other.root,'.git'),GIT_COMMON_DIR:join(other.root,'.git'),GIT_WORK_TREE:f.root});
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected.stdout,'caller Git variables cannot fork the store into another repository');
 }finally{rmSync(other.parent,{recursive:true,force:true});}
});
check('the read-only imported contract accepts a non-file argv label without initializing state',f=>{
 const module=join(f.root,'scripts/lib/lane-attempt-store.mjs');
 const observed=run(process.execPath,[module,'path',f.root],f.root);assert.equal(observed.status,0,observed.stderr);
 const marker=observed.stdout.trim()+'.json';rmSync(marker);
 const r=run(process.execPath,['--input-type=module','-e','await import('+JSON.stringify('file://'+module)+'); console.log("IMPORTED_LIBRARY");','objective-intake'],f.root);
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/IMPORTED_LIBRARY/);assert.equal(existsSync(marker),false,'a library import never initializes state');
});
for(const kind of ['missing-marker','corrupt-marker','missing-directory','replaced-directory','symlink-marker','hardlinked-marker','double-init'])check('shared record store refuses '+kind,f=>{
 const module=join(f.root,'scripts/lib/lane-attempt-store.mjs');
 const observed=run(process.execPath,[module,'path',f.root],f.root);assert.equal(observed.status,0,observed.stderr);
 const directory=observed.stdout.trim(),marker=directory+'.json',original=readFileSync(marker);
 if(kind==='missing-marker')rmSync(marker);
 if(kind==='corrupt-marker')writeFileSync(marker,'{');
 if(kind==='missing-directory')rmSync(directory,{recursive:true});
 if(kind==='replaced-directory'){renameSync(directory,directory+'.preserved');mkdirSync(directory);}
 if(kind==='symlink-marker'){renameSync(marker,marker+'.preserved');symlinkSync(marker+'.preserved',marker);}
 if(kind==='hardlinked-marker')linkSync(marker,marker+'.alias');
 const response=run(process.execPath,[module,kind==='double-init'?'init':'path',f.linked],f.linked);
 assert.equal(response.status,1,'damaged/existing state cannot initialize itself: '+response.stdout);
 assert.match(response.stderr,/READBACK ONLY/);
 if(kind==='missing-directory')assert.equal(existsSync(directory),false,'read path must not recreate lost state');
 if(kind==='double-init')assert.deepEqual(readFileSync(marker),original,'second init must preserve the original marker');
});
{
 const f=setup();let child,closed;
 try {
  const tick=readFileSync(join(ROOT,'scripts/mac/lane-tick.sh'),'utf8');
  const start=tick.indexOf('TICK_LOCK='),end=tick.indexOf('# An UNCHANGED tick',start);assert.ok(start>=0&&end>start);
  const observed=run(process.execPath,[join(f.root,'scripts/lib/lane-attempt-store.mjs'),'path',f.root],f.root);assert.equal(observed.status,0,observed.stderr);
  const prefix=`set -u\nRECORD_DIR=${q(observed.stdout.trim())}\nsay(){ printf '%s\\n' "$1"; }\n${tick.slice(start,end)}`;
  const one=join(f.parent,'tmp-one'),two=join(f.parent,'tmp-two');mkdirSync(one);mkdirSync(two);
  child=spawn('/bin/bash',['-c',prefix+"printf 'OWNED_LOCK_READY\\n'\nread -r release\n"],{cwd:f.root,env:{PATH:'/usr/bin:/bin',TMPDIR:one},stdio:['pipe','pipe','pipe']});
  closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});
  await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',bytes=>{text+=bytes;if(text.includes('OWNED_LOCK_READY'))resolve();});child.on('error',reject);child.on('exit',code=>reject(Error('original owned lock child exited before readiness: '+code)));});
  const other=run('/bin/bash',['-c',prefix+"printf 'SECOND_ACQUIRED\\n'\n"],f.linked,{TMPDIR:two});
  assert.equal(other.status,0,other.stderr);assert.match(other.stdout,/another tick/);assert.doesNotMatch(other.stdout,/SECOND_ACQUIRED/);
  child.stdin.end('release\n');assert.equal(await closed,0,'original owned lock child must complete normally');
  passed++;console.log('PASS primary and linked tick with distinct TMPDIR share one actual live lock');
 } catch(error){failed++;console.error('FAIL shared live tick lock: '+error.message);}
 finally {if(child&&!child.stdin.destroyed)child.stdin.end('release\n');if(closed)await closed;rmSync(f.parent,{recursive:true,force:true});}
}

}

{

function handEpisodes(steps){
 const root=mkdtempSync(join(tmpdir(),'sg-hand-episode-'));const records=join(root,'records'),cache=join(root,'cache'),calls=join(root,'calls');
 mkdirSync(records);mkdirSync(cache);mkdirSync(join(root,'scripts'));
 const source=readFileSync(join(ROOT,'scripts/mac/build-tick.sh'),'utf8'),start=source.indexOf('raise_hand() {'),end=source.indexOf('\nfail() {',start);assert.ok(start>=0&&end>start);
 writeFileSync(join(root,'scripts/lane-deliver.mjs'),`import fs from 'node:fs';\nconst a=process.argv.slice(2),calls=${JSON.stringify(calls)};\nif(a[0]==='batch'){const ops=JSON.parse(fs.readFileSync(a[1],'utf8'));let before=[];try{before=fs.readFileSync(calls,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)}catch{};fs.appendFileSync(calls,JSON.stringify(ops[0])+'\\n');const receipt=a[a.indexOf('--receipt')+1];fs.writeFileSync(receipt,JSON.stringify({episode:before.length,id:ops[0].id}));console.log('fixture batch accepted; pending');process.exit(Number(process.env.DELIVERY_RC));}\nif(a[0]==='readback'){const r=JSON.parse(fs.readFileSync(a[1],'utf8'));if(a[a.indexOf('--resolved-hand')+1]!==r.id)process.exit(2);const p=process.env.PHASE;if(p==='bad'){console.log('unbound marker');process.exit(0)}if(p==='open')process.exit(3);if(p==='collide'||p==='clear0'&&r.episode===0||p==='clear1'&&r.episode<2){console.log('resolved hand '+(p==='collide'||r.episode===0?'a':'b').repeat(40));process.exit(0)}process.exit(4)}process.exit(2);`);
 const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const actions=steps.map((step,i)=>`export DELIVERY_RC=${step.code??0} PHASE=${q(step.phase)}\nSTAMP=202610${i<1?'30':'31'}T010000Z\n${step.missing?'rm -f "$RECORDS"/*.exit\n':''}raise_hand 'same source-backed fixture blocker'`).join('\n');
 const script=`set -u\nDRY=0\nCACHE="$CACHE_PATH"\nREPO_ROOT="$FIXTURE_ROOT"\nRUN_LOG="$FIXTURE_ROOT/run.log"\nsay(){ printf '%s\\n' "$1"; }\nnode(){ if [ "$1" = "$REPO_ROOT/scripts/lib/lane-attempt-store.mjs" ]; then printf '%s\\n' "$RECORDS"; else "$FIXTURE_NODE" "$@"; fi; }\n${source.slice(start,end)}\n${actions}\ntrue\n`;
 try {const r=spawnSync('/bin/bash',['-c',script],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root,FIXTURE_ROOT:root,FIXTURE_NODE:process.execPath,CACHE_PATH:cache,RECORDS:records},encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);const sent=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);return {sent,stdout:r.stdout};}
 finally{rmSync(root,{recursive:true,force:true});}
}
const cases=[
 ['unknown terminal remains held across day and apparent clear',[{phase:'pending',code:3},{phase:'clear1',code:0}],1],
 ['missing independent terminal stays held despite a child receipt',[{phase:'pending'},{phase:'clear1',missing:true}],1],
 ['known pending hand never duplicates',[{phase:'pending'},{phase:'pending'},{phase:'pending'}],1],
 ['landed open hand does not create another episode',[{phase:'pending'},{phase:'open'}],1],
 ['one exact cleared episode permits one different hand',[{phase:'pending'},{phase:'clear0'},{phase:'pending'}],2],
 ['two different clear blobs permit exactly two successor hands',[{phase:'pending'},{phase:'clear0'},{phase:'clear1'},{phase:'clear1'}],3],
 ['a successful readback without a bound clear token stays held',[{phase:'pending'},{phase:'bad'}],1],
 ['repeating a clear token cannot loop or create a third hand',[{phase:'pending'},{phase:'collide'},{phase:'collide'}],2],
];
for(const [label,steps,count]of cases){try{const r=handEpisodes(steps);assert.equal(r.sent.length,count);if(count>1){assert.equal(new Set(r.sent.map(x=>x.id)).size,count);assert.ok(r.sent.every(x=>/^build-[a-f0-9]{64}$/.test(x.id)));}assert.doesNotMatch(r.stdout,/hand delivered/);passed++;console.log('PASS '+label)}catch(e){failed++;console.error('FAIL '+label+': '+e.message)}}
}

control("exact landed hand must be canonically resolved before a new notification episode",{hand:true},f=>{
 const receipt=join(f.root,"hand.submission.json");assert.equal(f.run(["--receipt",receipt]).status,0);f.land();
 const before=f.pushes().length,mutations=()=>f.ghCalls().filter(a=>a[0]==="pr"&&["create","merge","comment"].includes(a[1])).length,prior=mutations();
 const open=f.readback(receipt,["--resolved-hand","fixture-build-hand"]);assert.equal(open.status,3);assert.doesNotMatch(open.stdout,/resolved hand/);
 const oid=f.clearHand(),resolved=f.readback(receipt,["--resolved-hand","fixture-build-hand"]);
 assert.equal(resolved.status,0,resolved.stderr);assert.match(resolved.stdout,new RegExp('^resolved hand '+oid+'$','m'));
 assert.equal(f.pushes().length,before);assert.equal(mutations(),prior,'clearance readback is never a publication or auto-merge retry');
});
control("resolved status without resolution evidence never clears a hand",{hand:true},f=>{
 const receipt=join(f.root,"hand.submission.json");assert.equal(f.run(["--receipt",receipt]).status,0);f.land();f.clearHand("");
 const before=f.pushes().length,r=f.readback(receipt,["--resolved-hand","fixture-build-hand"]);assert.equal(r.status,3);assert.doesNotMatch(r.stdout,/resolved hand/);assert.equal(f.pushes().length,before);
});
control("a different exact hand id cannot borrow another hand's clearance",{hand:true},f=>{
 const receipt=join(f.root,"hand.submission.json");assert.equal(f.run(["--receipt",receipt]).status,0);f.land();f.clearHand();
 const r=f.readback(receipt,["--resolved-hand","different-hand"]);assert.equal(r.status,3);assert.doesNotMatch(r.stdout,/resolved hand/);
});
control("a heartbeat receipt never authorizes a hand notification episode",{},f=>{
 const receipt=join(f.root,"heartbeat.submission.json");assert.equal(f.run(["--receipt",receipt]).status,0);f.land();
 const r=f.readback(receipt,["--resolved-hand","fixture-build-hand"]);assert.equal(r.status,3);assert.doesNotMatch(r.stdout,/resolved hand/);
});

console.log(`lane-delivery regression: ${passed} passed, ${failed} failed, 0 skipped`);
process.exitCode = failed ? 1 : 0;

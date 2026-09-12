#!/usr/bin/env node
// Launch-proof bindings — every launch item names the proof:* scripts that certify it,
// and every name it uses is a proof that exists AND runs per push.
//
//   node scripts/check-launch-proof-bindings.mjs              # gate
//   node scripts/check-launch-proof-bindings.mjs --self-test  # prove the gate can fail
//
// WHY. DR-036 made readiness dimension (b) — "launch surface, evidence-bound" — BINARY:
// 100 while the last Mac evidence run was green, fresh and covered the current manifest,
// 0 otherwise, because "launch items map to proof names 3 of 23 (they are routes,
// packages and families)" and a per-item ratio would have been invented. The named
// follow-up was to give the items explicit bindings and turn (b) into a ratio. This
// file is the binding half; `scripts/check-readiness-figure.mjs` is the ratio half.
//
// A binding is a CLAIM: "this proof certifies this launch item". Three ways for that
// claim to be hollow, each fatal here:
//
//   NO PROOF        a launch item with no `proofs` (or an empty list) is a launch
//                   item nothing certifies — it would sit in the denominator of (b)
//                   with nothing that could ever move it, or worse, drop out of it.
//   PHANTOM PROOF   a name that is not a `proof:*` script in package.json. The
//                   parity gate already found `proof:api-client-react` registered in
//                   a lane before the script existed; a binding to a name nobody
//                   defined is the same defect wearing a governance hat.
//   NEVER RUNS      a proof that exists but is not registered in scripts/preflight.mjs.
//                   Launch coverage is per push, in preflight — verify-breadth.mjs
//                   FAILS if a launch family's proof lands in the breadth lane, and
//                   the evidence file (artifacts/live-evidence/mac-run.json) records
//                   the preflight roster. A proof that runs only when someone
//                   remembers to run it certifies nothing on the day it matters.
//   MAY NOT RUN     a proof that SELF-SKIPS when an env var is unset (the Postgres
//                   proofs without DATABASE_URL). Green preflight does not mean it
//                   ran, so the evidence cannot record it as passed, so a launch item
//                   bound only to one could never reach 100 — and one bound to it
//                   among others would read a skip as coverage. Refused outright.
//
// Also refused: a `proofs` list on a non-launch entry. The denominator of (b) means
// "what the Limited GA surface is certified by", and a deferred or demo item that
// binds a proof would widen it without widening the product.
//
// PREFLIGHT MEMBERSHIP IS READ FROM THE FILE, comment-stripped, the way
// check-preflight-ci-parity.mjs reads it (that module runs on import, so its
// extractor is mirrored here rather than imported, and the mirror is self-tested
// against the same planted shapes). `verify-all.mjs` imports `registeredProofs`
// from HERE to record which proofs a green run covered, so the roster the evidence
// records and the roster this gate requires cannot come from two readings.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Blank whole-line `//` comments — a commented-out STEPS entry is not a registered gate. */
export function stripCommentedLines(source) {
  return source
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

/**
 * Pure: every `proof:*` name a STEPS-shaped lane file runs, in run position —
 * `cmd: ["pnpm", "run", "proof:x"]`, or a `bash -c "… pnpm run proof:x …"` gate.
 * Mirrors gatesIn() in check-preflight-ci-parity.mjs, narrowed to proofs.
 */
export function registeredProofs(laneSource) {
  const source = stripCommentedLines(laneSource);
  const out = new Set();
  for (const m of source.matchAll(/cmd:\s*\[([^\]]+)\]/g)) {
    const parts = m[1].replace(/["']/g, "").split(",").map((s) => s.trim());
    if (parts[0] === "pnpm" && parts[1] === "run" && parts[2]?.startsWith("proof:")) out.add(parts[2]);
    else if (parts[0] === "bash") {
      for (const x of m[1].matchAll(/pnpm run (proof:[a-z0-9:_-]+)/g)) out.add(x[1]);
    }
  }
  return out;
}

/** Pure: proof name → the launch items (surface/id) that bind it. */
export function boundProofs(surfaces) {
  const map = new Map();
  for (const s of surfaces) {
    for (const e of s.launch ?? []) {
      if (typeof e !== "object" || e === null || !Array.isArray(e.proofs)) continue;
      for (const p of e.proofs) {
        if (!map.has(p)) map.set(p, []);
        map.get(p).push(`${s.key}[${e.id}]`);
      }
    }
  }
  return map;
}

/**
 * Pure: the problems with a profile's bindings, given the proof scripts package.json
 * defines, the proofs preflight runs, and the proofs that self-skip without an env var.
 * Returns [] when every launch item is bound to real, registered, always-running proofs.
 */
export function checkBindings({ surfaces, statuses, proofScripts, preflightProofs, selfSkipping }) {
  const problems = [];
  let launchItems = 0;
  for (const s of surfaces) {
    for (const status of statuses) {
      for (const e of s[status] ?? []) {
        const id = typeof e === "string" ? e : e?.id;
        const has = typeof e === "object" && e !== null && "proofs" in e;
        if (status !== "launch") {
          if (has) problems.push(`${s.key}[${id}] is ${status} but carries \`proofs\` — only launch items bind proofs (the (b) denominator is the launch surface)`);
          continue;
        }
        launchItems += 1;
        if (!has || !Array.isArray(e.proofs) || e.proofs.length === 0) {
          problems.push(`${s.key}[${id}] is launch with NO proofs — a launch item nothing certifies`);
          continue;
        }
        const seen = new Set();
        for (const p of e.proofs) {
          if (typeof p !== "string" || !p.startsWith("proof:")) {
            problems.push(`${s.key}[${id}] binds ${JSON.stringify(p)}, which is not a \`proof:*\` name`);
            continue;
          }
          if (seen.has(p)) problems.push(`${s.key}[${id}] binds ${p} twice`);
          seen.add(p);
          if (!proofScripts.has(p)) { problems.push(`${s.key}[${id}] binds ${p}, which is not a script in package.json (phantom proof)`); continue; }
          if (!preflightProofs.has(p)) problems.push(`${s.key}[${id}] binds ${p}, which is not registered in scripts/preflight.mjs — launch coverage is per push`);
          if (selfSkipping.has(p)) problems.push(`${s.key}[${id}] binds ${p}, which self-skips without ${selfSkipping.get(p)} — a green run cannot record it as run`);
        }
      }
    }
  }
  if (launchItems === 0) problems.push("the profile has no launch items at all — the anchor moved");
  return problems;
}

/** The proofs that self-skip without an env var, from the parity gate's own list (name → ENV). */
export function liveSelfSkipping(repoRoot = repo) {
  const r = spawnSync(process.execPath, ["scripts/check-preflight-ci-parity.mjs", "--list-self-skipping-proofs"], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`could not list self-skipping proofs: ${(r.stderr || "").trim().split("\n").pop()}`);
  const map = new Map();
  for (const line of r.stdout.split("\n")) {
    const [name, env] = line.trim().split(/\s+/);
    if (name?.startsWith("proof:")) map.set(name, env ?? "(env)");
  }
  return map;
}

function selfTest() {
  const checks = [];
  const lane = [
    '  { name: "A", cmd: ["pnpm", "run", "proof:alpha"] },',
    '  // { name: "B", cmd: ["pnpm", "run", "proof:commented"] },',
    '  { name: "C", cmd: ["node", "scripts/check-x.mjs"] },',
    '  { name: "D", cmd: ["bash", "-c", "pnpm run proof:beta && pnpm run check:y"] },',
  ].join("\n");
  const reg = registeredProofs(lane);
  checks.push(["extractor: a live pnpm-run proof is registered", reg.has("proof:alpha")]);
  checks.push(["extractor: a bash -c gate's proof is registered", reg.has("proof:beta")]);
  checks.push(["extractor: a COMMENTED-OUT proof is NOT registered (planted violation)", !reg.has("proof:commented")]);
  checks.push(["extractor: a node gate and a check: script are not proofs", reg.size === 2]);

  const base = {
    statuses: ["launch", "deferred", "demo_only", "internal"],
    proofScripts: new Set(["proof:alpha", "proof:beta", "proof:pg"]),
    preflightProofs: new Set(["proof:alpha", "proof:pg"]),
    selfSkipping: new Map([["proof:pg", "DATABASE_URL"]]),
  };
  const ok = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:alpha"] }], deferred: ["d"], demo_only: [], internal: [] }] });
  checks.push(["a launch item bound to a real, registered proof has no problems", ok.length === 0]);
  const none = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r" }], deferred: [] }] });
  checks.push(["planted: a launch item with NO proofs is reported", none.some((p) => /NO proofs/.test(p))]);
  const empty = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: [] }], deferred: [] }] });
  checks.push(["planted: an EMPTY proofs list is reported", empty.some((p) => /NO proofs/.test(p))]);
  const phantom = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:ghost"] }], deferred: [] }] });
  checks.push(["planted: a proof that is not in package.json is reported as phantom", phantom.some((p) => /phantom proof/.test(p))]);
  const unreg = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:beta"] }], deferred: [] }] });
  checks.push(["planted: a proof not registered in preflight is reported", unreg.some((p) => /not registered in scripts\/preflight\.mjs/.test(p))]);
  const skip = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:pg"] }], deferred: [] }] });
  checks.push(["planted: a self-skipping proof is refused, naming its env var", skip.some((p) => /self-skips without DATABASE_URL/.test(p))]);
  const notProof = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["check:x"] }], deferred: [] }] });
  checks.push(["planted: a non-proof: name is reported", notProof.some((p) => /not a `proof:\*` name/.test(p))]);
  const dup = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:alpha", "proof:alpha"] }], deferred: [] }] });
  checks.push(["planted: a proof bound twice by one item is reported", dup.some((p) => /twice/.test(p))]);
  const nonLaunch = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:alpha"] }], deferred: [], demo_only: [{ id: "d", reason: "r", proofs: ["proof:alpha"] }] }] });
  checks.push(["planted: a demo_only item carrying proofs is reported", nonLaunch.some((p) => /is demo_only but carries/.test(p))]);
  const noLaunch = checkBindings({ ...base, surfaces: [{ key: "s", launch: [], deferred: ["d"] }] });
  checks.push(["planted: a profile with zero launch items is reported, never vacuously green", noLaunch.some((p) => /no launch items/.test(p))]);
  const bp = boundProofs([{ key: "s", launch: [{ id: "a", proofs: ["proof:x", "proof:y"] }, { id: "b", proofs: ["proof:x"] }] }]);
  checks.push(["boundProofs: proof → items, deduplicated by proof", bp.size === 2 && bp.get("proof:x").join() === "s[a],s[b]" && bp.get("proof:y").join() === "s[a]"]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length ? "FAILED" : "passed"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length ? 1 : 0;
}

async function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const lp = await import(pathToFileURL(join(repo, "scripts/launch-profile.mjs")).href);
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const proofScripts = new Set(Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith("proof:")));
  const preflightProofs = registeredProofs(readFileSync(join(repo, "scripts/preflight.mjs"), "utf8"));
  if (preflightProofs.size === 0) { console.error("check-launch-proof-bindings: parsed zero proofs out of scripts/preflight.mjs — the STEPS shape changed; refusing to report green."); process.exit(1); }
  const selfSkipping = liveSelfSkipping();
  const problems = checkBindings({ surfaces: lp.SURFACES, statuses: lp.STATUSES, proofScripts, preflightProofs, selfSkipping });
  const bound = boundProofs(lp.SURFACES);
  const launchItems = lp.SURFACES.reduce((n, s) => n + (s.launch ?? []).length, 0);
  console.log(`Launch-proof bindings — ${launchItems} launch items bind ${bound.size} distinct proof(s); preflight registers ${preflightProofs.size} proofs of ${proofScripts.size} in package.json\n`);
  for (const [p, items] of [...bound].sort()) console.log(`  ${p.padEnd(32)} ← ${items.join(", ")}`);
  if (problems.length) {
    for (const p of problems) console.error(`\n✗ ${p}`);
    console.error(`\nLaunch-proof bindings FAILED: ${problems.length} problem(s). A binding is a claim that a named proof certifies a launch item; every one must name a proof that exists and runs per push.`);
    process.exit(1);
  }
  console.log("\nLaunch-proof bindings passed — every launch item names at least one proof, and every named proof exists in package.json, runs in preflight, and never self-skips.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`check-launch-proof-bindings: ${e.message}`); process.exit(1); });
}

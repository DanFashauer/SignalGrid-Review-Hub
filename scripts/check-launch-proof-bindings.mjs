#!/usr/bin/env node
// Launch-proof bindings — every launch item names the proof:* scripts (or, when
// no proof exercises the surface, a non-proof preflight step:<name>) that
// certify it, and every name it uses is real, current, and runs per push.
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
// A binding is a CLAIM: "this proof (or step) certifies this launch item". Ways for
// that claim to be hollow, each fatal here:
//
//   NO PROOF        a launch item with no `proofs` (or an empty list) is a launch
//                   item nothing certifies — it would sit in the denominator of (b)
//                   with nothing that could ever move it, or worse, drop out of it
//                   SILENTLY: `boundProofs()` just omits it from its map, so nothing
//                   downstream sees a zero — it sees one less item to divide by.
//                   `validateBindings()` is the check that makes this loud instead
//                   (2026-09-12 review finding), and both this gate's `checkBindings`
//                   and check-readiness-figure.mjs's `derive()` call it before
//                   trusting `boundProofs()` for anything.
//   PHANTOM PROOF   a name that is not a `proof:*` script in package.json. The
//                   parity gate already found `proof:api-client-react` registered in
//                   a lane before the script existed; a binding to a name nobody
//                   defined is the same defect wearing a governance hat.
//   PHANTOM STEP    a `step:<name>` naming no STEPS entry in scripts/preflight.mjs.
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
//                   Self-skip detection is DERIVED here (selfSkipEnv/liveSelfSkipping,
//                   2026-09-12), not delegated to check-preflight-ci-parity.mjs's own
//                   narrower detector: that one reads only top-level `scripts/src/*.ts`
//                   (non-recursive) and only a `const id = process.env.ENV; if (!id)`
//                   two-step shape, so a proof self-skipping via an INLINE
//                   `if (!process.env.ENV)` guard — anywhere, at any indentation —
//                   would pass its narrow scan as "always runs" and a binding to it
//                   would be silently accepted. That module's own detector is left
//                   unmodified (it still serves `--list-self-skipping-proofs` for
//                   validate-sim-macos.sh); this file no longer spawns it.
//
// STEP BINDINGS EXIST because a `proof:*` runs under `tsx` and can never build or
// launch the actual console — only the "Browser E2E" preflight step does that
// (scripts/src/e2e/admin-console.spec.ts, driven by `vite preview` against a live
// api-server). A launch item whose real coverage is a preflight step, not a proof,
// binds `step:<name>`; registeredSteps() below is the registry that name is checked
// against, and check-readiness-figure.mjs counts a recorded step "like a proof" —
// current only when `proofs.steps` (the emitter's new key) says passed against the
// CURRENT manifest fingerprint.
//
// Also refused: a `proofs` list on a non-launch entry. The denominator of (b) means
// "what the Limited GA surface is certified by", and a deferred or demo item that
// binds a proof would widen it without widening the product.
//
// PREFLIGHT MEMBERSHIP IS READ FROM THE FILE, comment-stripped, the way
// check-preflight-ci-parity.mjs reads it (that module runs on import, so its
// extractor is mirrored here rather than imported, and the mirror is self-tested
// against the same planted shapes). `verify-all.mjs` imports `registeredProofs`,
// `registeredSteps`, `liveSelfSkipping`, `proofScriptFiles`, `workspacePackageDirs`
// and `proofSourceDigest` from HERE, so the roster and the per-proof source
// fingerprint the evidence records and the ones this gate (and the readiness
// figure) require cannot come from two separate readings.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
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

/** Pure: proof name → the launch items (surface/id) that bind it. A `step:<name>`
 *  binding (see registeredSteps below) is just another string key here. */
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
 * Pure: every launch entry with a MISSING or EMPTY `proofs` array — exactly the
 * shape `boundProofs()` above silently DROPS. A launch item with no `proofs`
 * key, or an empty one, contributes nothing to that map and vanishes from its
 * keys entirely; it does not appear as a visible zero. check-readiness-figure.mjs
 * divides dimension (b) by `boundProofs()`'s output, so a launch item that lost
 * its `proofs` array — a bad merge, a copy-paste that dropped the field, a new
 * item added without one — would silently shrink the DENOMINATOR instead of
 * failing loud: a direct `node scripts/check-readiness-figure.mjs` (or `pnpm run
 * loop:state`, which does not run THIS gate first) could read (b) at 100% with
 * an unevidenced launch item sitting right there in the profile. This is the
 * fail-closed check the readiness derivation calls BEFORE it trusts
 * `boundProofs()` at all — a non-empty result here means derive() throws Broken
 * rather than reading a number (review finding, 2026-09-12).
 */
export function validateBindings(surfaces) {
  const problems = [];
  for (const s of surfaces) {
    for (const e of s.launch ?? []) {
      const id = typeof e === "string" ? e : e?.id;
      const ok = typeof e === "object" && e !== null && Array.isArray(e.proofs) && e.proofs.length > 0;
      if (!ok) problems.push(`${s.key}[${id}] is launch with NO proofs — a launch item nothing certifies`);
    }
  }
  return problems;
}

/**
 * Pure: every STEPS entry's `name`, paired with whether it carries the
 * `needsNativeBuild` marker scripts/preflight.mjs already uses for a step the
 * workspace's native-binary strip (pnpm-workspace.yaml) makes structurally
 * absent everywhere but linux-x64 (scripts/lib/platform-native-build.mjs).
 *
 * WHY THIS EXISTS. A `proof:*` script runs under `tsx` and never needs the
 * native web-build binaries, so it is the right certifying evidence for
 * anything a proof CAN exercise — but nothing runs the actual built console in
 * a browser except the "Browser E2E" preflight step (scripts/src/e2e/
 * admin-console.spec.ts, driven by `vite preview` against a live api-server).
 * A launch item may bind `step:<name>` when that is the only real coverage —
 * checkBindings() below validates the name exists here, and
 * check-readiness-figure.mjs's evidenceDimension() counts a recorded step
 * "like a proof": current only when the emitter's `proofs.steps` entry says
 * passed against the CURRENT manifest fingerprint. A step flagged
 * `needsNativeBuild` is never refused as a binding target here (it is a real,
 * always-registered preflight step) — but on a machine where the build is
 * structurally excluded it will never be recorded as passed, so the ratio
 * reads that half honestly as unrecorded rather than silently inventing a
 * pass. That is dimension (b)'s question, not this gate's.
 *
 * Read the SAME STEPS-array shape registeredProofs() reads above, one entry
 * per source line — verified against the live file: every STEPS object in
 * scripts/preflight.mjs is single-line, so a per-line match is exact and needs
 * no brace-nesting logic (a naive "read to the first `}`" would stop at a
 * nested `env: { ... }` object some steps carry).
 */
export function registeredSteps(laneSource) {
  const out = new Map();
  for (const rawLine of stripCommentedLines(laneSource).split("\n")) {
    const m = /^\s*\{\s*name:\s*"((?:[^"\\]|\\.)*)"/.exec(rawLine);
    if (!m) continue;
    out.set(m[1].replace(/\\"/g, '"'), { needsNativeBuild: /needsNativeBuild:\s*true/.test(rawLine) });
  }
  return out;
}

/**
 * Pure: the problems with a profile's bindings, given the proof scripts package.json
 * defines, the STEPS preflight registers (proofs AND, since 2026-09-12, non-proof
 * steps), and the proofs that self-skip without an env var.
 * Returns [] when every launch item is bound to real, registered, always-running
 * proofs and/or registered preflight steps.
 */
export function checkBindings({ surfaces, statuses, proofScripts, preflightProofs, selfSkipping, preflightSteps = new Map() }) {
  const problems = [...validateBindings(surfaces)];
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
        const ok = has && Array.isArray(e.proofs) && e.proofs.length > 0;
        if (!ok) continue; // already reported by validateBindings(), above — one message, not two
        const seen = new Set();
        for (const p of e.proofs) {
          if (typeof p !== "string" || (!p.startsWith("proof:") && !p.startsWith("step:"))) {
            problems.push(`${s.key}[${id}] binds ${JSON.stringify(p)}, which is not a \`proof:*\` or \`step:*\` name`);
            continue;
          }
          if (seen.has(p)) problems.push(`${s.key}[${id}] binds ${p} twice`);
          seen.add(p);
          if (p.startsWith("proof:")) {
            if (!proofScripts.has(p)) { problems.push(`${s.key}[${id}] binds ${p}, which is not a script in package.json (phantom proof)`); continue; }
            if (!preflightProofs.has(p)) problems.push(`${s.key}[${id}] binds ${p}, which is not registered in scripts/preflight.mjs — launch coverage is per push`);
            if (selfSkipping.has(p)) problems.push(`${s.key}[${id}] binds ${p}, which self-skips without ${selfSkipping.get(p)} — a green run cannot record it as run`);
          } else {
            const stepName = p.slice("step:".length);
            if (!preflightSteps.has(stepName)) problems.push(`${s.key}[${id}] binds ${p}, which is not a STEPS entry in scripts/preflight.mjs (phantom step)`);
          }
        }
      }
    }
  }
  if (launchItems === 0) problems.push("the profile has no launch items at all — the anchor moved");
  return problems;
}

/**
 * Pure: does `source` self-skip — print SKIPPED and exit(0) — when some env var
 * is unset? Handles BOTH the two-step form (`const id = process.env.ENV; if
 * (!id) { ... }`) and the INLINE form (`if (!process.env.ENV) { ... }`), at ANY
 * indentation — a guard nested inside a function or another block is not
 * exempt — and whether the guard's body sits on the same line as the `if` or
 * the next few. Comments are stripped first so an example of the shape written
 * in a comment is never mistaken for the shape itself.
 *
 * REPLACES delegating to check-preflight-ci-parity.mjs's own detector (kept,
 * unmodified, for `--list-self-skipping-proofs`), which reads only TOP-LEVEL
 * `scripts/src/*.ts` (non-recursive) and only the two-step form. Neither
 * restriction is a property of what a self-skip actually IS — a proof whose
 * source moved into a subdirectory, or that guards inline with no
 * intermediate `const`, self-skips exactly the same way, and the binding gate
 * is the one place a MISSED self-skip becomes a false claim: a launch item
 * bound to it would read as "runs every push" when it silently does not.
 */
export function selfSkipEnv(source) {
  const lines = stripCommentedLines(source).split("\n");
  // id -> ENV, from `const id = process.env.ENV;` anywhere in the file, any indent.
  const envOf = new Map();
  for (const l of lines) {
    const m = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.([A-Z][A-Z0-9_]*)\s*;/.exec(l);
    if (m) envOf.set(m[1], m[2]);
  }
  const GUARD_RE = /if\s*\(\s*!\s*(?:process\.env\.([A-Z][A-Z0-9_]*)|([A-Za-z_$][\w$]*))\s*\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const g = GUARD_RE.exec(lines[i]);
    if (!g) continue;
    const env = g[1] ?? envOf.get(g[2]);
    if (!env) continue;
    // The skip body is short by construction — a log line and the exit — and
    // may sit on the SAME line as the `if` (an inline one-liner) or the next
    // few; the window starts AT the matched line so a same-line body counts.
    const body = lines.slice(i, Math.min(i + 8, lines.length)).join("\n");
    if (/\bSKIPPED\b/.test(body) && /process\.exit\(\s*0\s*\)/.test(body)) return env;
  }
  return null;
}

/**
 * Pure: `proof:*` name -> the repo-relative script PATH package.json's own
 * entries resolve to — a direct root-level invocation (`node scripts/x.mjs`,
 * `proof:decision-palette`'s shape) or a delegation through
 * `pnpm --filter @workspace/scripts run proof:x` into scripts/package.json's
 * own entry for that name (typically `tsx ./src/....ts`, resolved by PATH —
 * however deep under `src/` it lives, not assumed flat). Returns null when
 * neither shape matches: a proof whose invocation this cannot follow is
 * OMITTED from every caller, never guessed at.
 */
export function proofScriptPath(rootCmd, subCmd) {
  const direct = /(?:^|\s)(scripts\/[\w./-]+\.(?:mjs|ts))(?:\s|$)/.exec(rootCmd ?? "");
  if (direct) return direct[1];
  if (/@workspace\/scripts\s+run\s+/.test(rootCmd ?? "")) {
    const m = /\.\/([\w./-]+\.(?:ts|mjs))/.exec(subCmd ?? "");
    if (m) return `scripts/${m[1]}`;
  }
  return null;
}

/** LIVE: every `proof:*` package.json defines, resolved (proofScriptPath) to a
 *  repo-relative path that actually EXISTS on disk. A resolvable-but-missing
 *  path is omitted, not guessed at. */
export function proofScriptFiles(repoRoot, rootScripts, subScripts) {
  const out = new Map();
  for (const [name, cmd] of Object.entries(rootScripts ?? {})) {
    if (!name.startsWith("proof:")) continue;
    const rel = proofScriptPath(cmd, subScripts?.[name]);
    if (rel && existsSync(resolve(repoRoot, rel))) out.set(name, rel);
  }
  return out;
}

/** LIVE: every proof:* resolved to a file (proofScriptFiles), scanned for a
 *  self-skip (selfSkipEnv). Name -> ENV var. Used by check-launch-proof-bindings
 *  itself and by verify-all.mjs (imported), so the evidence emitter and the
 *  binding gate cannot derive two different self-skip rosters. */
export function liveSelfSkipping(repoRoot = repo) {
  const rootScripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts ?? {};
  const subScripts = JSON.parse(readFileSync(join(repoRoot, "scripts/package.json"), "utf8")).scripts ?? {};
  const files = proofScriptFiles(repoRoot, rootScripts, subScripts);
  if (files.size === 0) throw new Error("resolved zero proof:* scripts to a file on disk — package.json's shape changed");
  const map = new Map();
  for (const [name, relPath] of files) {
    let text;
    try { text = readFileSync(resolve(repoRoot, relPath), "utf8"); } catch { continue; }
    const env = selfSkipEnv(text);
    if (env) map.set(name, env);
  }
  return map;
}

/**
 * LIVE: `@workspace/<pkg>` -> its repo-relative directory (`lib/<pkg>` or
 * `artifacts/<pkg>`), read from each candidate directory's OWN `package.json`
 * "name" field — never assumed from the directory's basename. Today the two
 * always match, but a proof's sourceDigest (below) must track what the package
 * actually calls itself, not a naming convention that happens to hold.
 */
export function workspacePackageDirs(repoRoot) {
  const map = new Map();
  for (const root of ["lib", "artifacts"]) {
    let entries = [];
    try { entries = readdirSync(join(repoRoot, root), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const name = JSON.parse(readFileSync(join(repoRoot, root, e.name, "package.json"), "utf8")).name;
        if (typeof name === "string") map.set(name, `${root}/${e.name}`);
      } catch { /* not a package dir */ }
    }
  }
  return map;
}

/**
 * Pure: every `@workspace/<pkg>` import specifier in `source` that resolves
 * (via `pkgDirs`) to a workspace package directory. Deliberately restricted to
 * bare `@workspace/*` specifiers — a RELATIVE import (`../../lib/x/src/y`) is
 * ambiguous without a real module resolver (it depends on the importing file's
 * own path, which this function never sees), and this repo's own convention
 * for crossing a package boundary is `@workspace/*` anyway (see
 * scripts/src/api-client-react-proof.ts:15 for exactly this shape). A
 * specifier `pkgDirs` cannot map is IGNORED, not guessed at.
 */
export function workspaceImportsOf(source, pkgDirs) {
  const specs = new Set();
  for (const m of source.matchAll(/\bfrom\s+["'](@workspace\/[\w-]+)["']/g)) specs.add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*["'](@workspace\/[\w-]+)["']\s*\)/g)) specs.add(m[1]);
  for (const m of source.matchAll(/^\s*import\s+["'](@workspace\/[\w-]+)["']/gm)) specs.add(m[1]);
  const dirs = new Set();
  for (const spec of specs) {
    const d = pkgDirs?.get ? pkgDirs.get(spec) : undefined;
    if (d) dirs.add(d);
  }
  return dirs;
}

/**
 * Pure: sha256 over one proof's own blob id plus the recursive blob listing of
 * every workspace package directory it imports. `dirListings` is Map dir ->
 * array of `"path:blobSha"` strings (already gathered live, see
 * gitDirListing below) — sorted here so listing ORDER never moves the digest,
 * only CONTENT does. Changing any tracked file anywhere in an imported
 * `lib/*`/`artifacts/*` package — or the proof script itself — moves this
 * digest, which is the whole point: a proof or product-code change that
 * leaves the live-sync manifest untouched must not keep an old evidence
 * record reading "current" (finding, 2026-09-12: a string-form "passed"
 * record carried no source signal at all and could read current for up to
 * FRESH_DAYS regardless of what the code did in the meantime).
 */
export function sourceDigestOf(ownBlob, dirListings) {
  const parts = [`self:${ownBlob ?? "MISSING"}`];
  for (const dir of [...dirListings.keys()].sort()) {
    parts.push(`dir:${dir}:${[...dirListings.get(dir)].slice().sort().join(",")}`);
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function gitAt(repoRoot, args) {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** LIVE: the blob sha git currently records for one tracked file at HEAD. */
export function gitBlobOf(repoRoot, relPath) {
  return gitAt(repoRoot, ["rev-parse", `HEAD:${relPath}`]);
}

/** LIVE: `path:blobSha` for every tracked file under `relDir` at HEAD, recursively. */
export function gitDirListing(repoRoot, relDir) {
  const out = gitAt(repoRoot, ["ls-tree", "-r", "HEAD", "--", relDir]);
  if (out === null || out === "") return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const meta = line.slice(0, tab).split(" ");
    return `${line.slice(tab + 1)}:${meta[2]}`;
  });
}

/**
 * LIVE: one proof's sourceDigest — see sourceDigestOf for what it means and
 * why. SHARED by verify-all.mjs (which RECORDS it at mint time) and
 * check-readiness-figure.mjs (which recomputes it against the CURRENT tree to
 * decide whether a recorded digest is still current): one function, so the
 * two readings cannot drift apart the way the proof roster itself used to
 * before it was centralized here.
 */
export function proofSourceDigest(repoRoot, relPath, pkgDirs) {
  const ownBlob = gitBlobOf(repoRoot, relPath);
  let source = "";
  try { source = readFileSync(resolve(repoRoot, relPath), "utf8"); } catch { /* digest still meaningful on ownBlob alone */ }
  const dirs = workspaceImportsOf(source, pkgDirs);
  const dirListings = new Map([...dirs].map((d) => [d, gitDirListing(repoRoot, d)]));
  return sourceDigestOf(ownBlob, dirListings);
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
  checks.push(["planted: a non-proof: name is reported", notProof.some((p) => /not a `proof:\*` or `step:\*` name/.test(p))]);
  const dup = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:alpha", "proof:alpha"] }], deferred: [] }] });
  checks.push(["planted: a proof bound twice by one item is reported", dup.some((p) => /twice/.test(p))]);
  const nonLaunch = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:alpha"] }], deferred: [], demo_only: [{ id: "d", reason: "r", proofs: ["proof:alpha"] }] }] });
  checks.push(["planted: a demo_only item carrying proofs is reported", nonLaunch.some((p) => /is demo_only but carries/.test(p))]);
  const noLaunch = checkBindings({ ...base, surfaces: [{ key: "s", launch: [], deferred: ["d"] }] });
  checks.push(["planted: a profile with zero launch items is reported, never vacuously green", noLaunch.some((p) => /no launch items/.test(p))]);
  const bp = boundProofs([{ key: "s", launch: [{ id: "a", proofs: ["proof:x", "proof:y"] }, { id: "b", proofs: ["proof:x"] }] }]);
  checks.push(["boundProofs: proof → items, deduplicated by proof", bp.size === 2 && bp.get("proof:x").join() === "s[a],s[b]" && bp.get("proof:y").join() === "s[a]"]);

  // ── validateBindings: the check that stops boundProofs() from silently
  // dropping an unbound launch entry instead of failing loud (finding #1). ──
  const vbMissing = validateBindings([{ key: "s", launch: [{ id: "unbound", reason: "r" }] }]);
  checks.push(["validateBindings: a launch item with no `proofs` key at all is caught (not silently dropped by boundProofs)", vbMissing.length === 1 && /is launch with NO proofs/.test(vbMissing[0])]);
  const vbEmpty = validateBindings([{ key: "s", launch: [{ id: "unbound", reason: "r", proofs: [] }] }]);
  checks.push(["validateBindings: an EMPTY proofs array is caught the same way", vbEmpty.length === 1 && /is launch with NO proofs/.test(vbEmpty[0])]);
  const vbOk = validateBindings([{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["proof:alpha"] }] }]);
  checks.push(["validateBindings: a bound launch item has no problems", vbOk.length === 0]);
  const vbMixed = validateBindings([{ key: "s", launch: [{ id: "bound", reason: "r", proofs: ["proof:alpha"] }, { id: "unbound", reason: "r" }] }]);
  checks.push(["validateBindings: one unbound item among several bound ones is still caught (this is exactly the shape a bad merge produces)", vbMixed.length === 1 && /unbound/.test(vbMixed[0])]);

  // ── registeredSteps: the STEPS-name registry `step:<name>` bindings check
  // against, including the needsNativeBuild marker (finding #3). ──
  const laneSteps = [
    '  { name: "Typecheck (all packages)", cmd: ["pnpm", "run", "typecheck"] },',
    '  // { name: "Commented step", cmd: ["node", "scripts/x.mjs"] },',
    '  { name: "Build (all packages)", cmd: ["pnpm", "run", "build"], heavy: true, needsNativeBuild: true, env: { PORT: "3000", BASE_PATH: "/" } },',
  ].join("\n");
  const steps = registeredSteps(laneSteps);
  checks.push(["registeredSteps: a plain step is registered and not flagged needsNativeBuild", steps.has("Typecheck (all packages)") && steps.get("Typecheck (all packages)").needsNativeBuild === false]);
  checks.push(["registeredSteps: needsNativeBuild is read even when the same line carries a NESTED object (env: {...}) after it", steps.get("Build (all packages)")?.needsNativeBuild === true]);
  checks.push(["registeredSteps: a COMMENTED-OUT step is not registered", !steps.has("Commented step")]);

  // ── checkBindings with step: bindings (finding #3). ──
  const stepsBase = { ...base, preflightSteps: new Map([["Browser E2E (review console, website, admin)", { needsNativeBuild: true }]]) };
  const stepOk = checkBindings({ ...stepsBase, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["step:Browser E2E (review console, website, admin)"] }], deferred: [] }] });
  checks.push(["a launch item bound to a real, registered STEP has no problems", stepOk.length === 0]);
  const stepPhantom = checkBindings({ ...stepsBase, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["step:Nonexistent Step"] }], deferred: [] }] });
  checks.push(["planted: a step: binding to an unregistered STEPS name is reported as a phantom step", stepPhantom.some((p) => /phantom step/.test(p))]);
  const notProofOrStep = checkBindings({ ...base, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: ["check:x"] }], deferred: [] }] });
  checks.push(["planted: a name that is neither proof: nor step: is reported", notProofOrStep.some((p) => /not a `proof:\*` or `step:\*` name/.test(p))]);

  // ── selfSkipEnv: the two-step form, the inline form, and a NESTED inline
  // guard the old (spawned) detector's narrower scan would have missed
  // entirely — self-skips are never a two-step-only, top-level-only shape
  // (finding #5). ──
  const TWO_STEP_SRC = 'const url = process.env.DATABASE_URL;\nif (!url) {\n  console.log("  ~ SKIPPED (DATABASE_URL unset): no database");\n  process.exit(0);\n}\n';
  checks.push(["selfSkipEnv: the two-step form (separate const, then if) is detected", selfSkipEnv(TWO_STEP_SRC) === "DATABASE_URL"]);
  const INLINE_SRC = 'if (!process.env.VENDOR_TOKEN) {\n  console.log("  ~ SKIPPED (VENDOR_TOKEN unset): no vendor account");\n  process.exit(0);\n}\n';
  checks.push(["selfSkipEnv: the INLINE form (no intermediate const) is detected — the old detector's blind spot", selfSkipEnv(INLINE_SRC) === "VENDOR_TOKEN"]);
  const NESTED_INLINE_SRC = [
    "async function main() {",
    "  if (someOtherCondition()) {",
    "    if (!process.env.VENDOR_LICENSE_KEY) {",
    '      console.log("  ~ SKIPPED (VENDOR_LICENSE_KEY unset): cannot exercise the live vendor");',
    "      process.exit(0);",
    "    }",
    "  }",
    "}",
  ].join("\n");
  checks.push(["selfSkipEnv: a NESTED inline guard (indented inside a function AND another if) is still detected", selfSkipEnv(NESTED_INLINE_SRC) === "VENDOR_LICENSE_KEY"]);
  checks.push(["selfSkipEnv: a proof that REFUSES (exit 1) without the env var is not a self-skip", selfSkipEnv(TWO_STEP_SRC.replace("process.exit(0)", "process.exit(1)")) === null]);
  checks.push(["selfSkipEnv: a mid-run SKIPPED with no exit is not a self-skip", selfSkipEnv('const x = "y";\nconsole.log("  ~ SKIPPED (reported, not counted): no licence");\n') === null]);
  checks.push(["selfSkipEnv: a guard on a plain local (not process.env) is not a self-skip", selfSkipEnv(TWO_STEP_SRC.replace("process.env.DATABASE_URL", '"literal"')) === null]);
  checks.push(["selfSkipEnv: the shape written INSIDE A COMMENT is not mistaken for the shape itself", selfSkipEnv(TWO_STEP_SRC.split("\n").map((l) => `// ${l}`).join("\n")) === null]);

  // The actual consequence: a launch item bound to a proof whose self-skip is
  // ONLY visible via the nested/inline detection above — the exact shape the
  // OLD (spawned, two-step-only, non-recursive) detector would have MISSED,
  // silently certifying a proof that never runs on most machines — must have
  // its binding REJECTED. Self-test: plant a nested `if(!process.env.X){…
  // exit(0)}` proof; its binding must be rejected.
  const nestedProofName = "proof:nested-thing";
  const nestedBase = {
    statuses: base.statuses,
    proofScripts: new Set([...base.proofScripts, nestedProofName]),
    preflightProofs: new Set([...base.preflightProofs, nestedProofName]),
    selfSkipping: new Map([[nestedProofName, selfSkipEnv(NESTED_INLINE_SRC)]]),
  };
  const nestedRejected = checkBindings({ ...nestedBase, surfaces: [{ key: "s", launch: [{ id: "i", reason: "r", proofs: [nestedProofName] }], deferred: [] }] });
  checks.push(["a launch item bound to a proof whose self-skip is detectable ONLY via the nested/inline match has its binding REJECTED (the exact defect the old narrow detector produced)", nestedRejected.some((p) => /self-skips without VENDOR_LICENSE_KEY/.test(p))]);

  // ── proofScriptPath: resolving a proof's source file, however deep it
  // lives, without assuming a flat scripts/src/ (finding #4/#5). ──
  checks.push(["proofScriptPath: a delegated proof resolves through scripts/package.json's own entry, however deep under src/ it lives", proofScriptPath("pnpm --filter @workspace/scripts run proof:nested-thing", "tsx ./src/sub/nested-thing-proof.ts") === "scripts/src/sub/nested-thing-proof.ts"]);
  checks.push(["proofScriptPath: a DIRECT root-level invocation resolves without going through scripts/package.json", proofScriptPath("node scripts/check-decision-palette.mjs", undefined) === "scripts/check-decision-palette.mjs"]);
  checks.push(["proofScriptPath: an unresolvable command (no scripts/ path, no delegation) is null, never guessed", proofScriptPath("echo hi", undefined) === null]);

  // ── workspaceImportsOf: the derivation sourceDigest's import list comes
  // from (finding #4), documented at the function itself. ──
  const wi = workspaceImportsOf(
    'import { x } from "@workspace/signalgrid-core";\nimport "@workspace/api-client-react";\n',
    new Map([["@workspace/signalgrid-core", "lib/signalgrid-core"], ["@workspace/api-client-react", "lib/api-client-react"]]),
  );
  checks.push(["workspaceImportsOf: both a named and a bare @workspace import resolve to their package dirs", wi.size === 2 && wi.has("lib/signalgrid-core") && wi.has("lib/api-client-react")]);
  checks.push(["workspaceImportsOf: a specifier with no package-dir mapping is ignored, never guessed", workspaceImportsOf('import { y } from "@workspace/ghost";\n', new Map()).size === 0]);
  checks.push(["workspaceImportsOf: a RELATIVE import is not resolved (ambiguous without a real module resolver; this repo's cross-package convention is @workspace/* anyway)", workspaceImportsOf('import { z } from "../../lib/signalgrid-core/src/index";\n', new Map([["@workspace/signalgrid-core", "lib/signalgrid-core"]])).size === 0]);

  // ── sourceDigestOf: deterministic, order-independent, and moves on any
  // real change (finding #4). ──
  const digestA = sourceDigestOf("blobA", new Map([["lib/x", ["a:1", "b:2"]]]));
  const digestReordered = sourceDigestOf("blobA", new Map([["lib/x", ["b:2", "a:1"]]]));
  checks.push(["sourceDigestOf: listing order within a directory does not change the digest", digestA === digestReordered]);
  checks.push(["sourceDigestOf: a changed blob sha anywhere in an imported dir moves the digest", digestA !== sourceDigestOf("blobA", new Map([["lib/x", ["a:1", "b:3"]]]))]);
  checks.push(["sourceDigestOf: a changed OWN blob (the proof script itself changed) moves the digest", digestA !== sourceDigestOf("blobZ", new Map([["lib/x", ["a:1", "b:2"]]]))]);
  checks.push(["sourceDigestOf: deterministic with no imported dirs at all", sourceDigestOf("blobA", new Map()) === sourceDigestOf("blobA", new Map())]);

  // ── LIVE smoke checks against the real repo — cheap, and the whole point
  // is that this derivation is read from the tree, not hand-maintained. ──
  const livePkgDirs = workspacePackageDirs(repo);
  checks.push(["workspacePackageDirs: LIVE — @workspace/signalgrid-core resolves to lib/signalgrid-core", livePkgDirs.get("@workspace/signalgrid-core") === "lib/signalgrid-core"]);
  const liveFiles = proofScriptFiles(
    repo,
    JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts ?? {},
    JSON.parse(readFileSync(join(repo, "scripts/package.json"), "utf8")).scripts ?? {},
  );
  checks.push(["proofScriptFiles: LIVE — proof:api-client-react resolves to its real source file", liveFiles.get("proof:api-client-react") === "scripts/src/api-client-react-proof.ts"]);

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
  const preflightSource = readFileSync(join(repo, "scripts/preflight.mjs"), "utf8");
  const preflightProofs = registeredProofs(preflightSource);
  const preflightSteps = registeredSteps(preflightSource);
  if (preflightProofs.size === 0) { console.error("check-launch-proof-bindings: parsed zero proofs out of scripts/preflight.mjs — the STEPS shape changed; refusing to report green."); process.exit(1); }
  if (preflightSteps.size === 0) { console.error("check-launch-proof-bindings: parsed zero STEPS names out of scripts/preflight.mjs — the STEPS shape changed; refusing to report green."); process.exit(1); }
  const selfSkipping = liveSelfSkipping(repo);
  const problems = checkBindings({ surfaces: lp.SURFACES, statuses: lp.STATUSES, proofScripts, preflightProofs, selfSkipping, preflightSteps });
  const bound = boundProofs(lp.SURFACES);
  const launchItems = lp.SURFACES.reduce((n, s) => n + (s.launch ?? []).length, 0);
  console.log(`Launch-proof bindings — ${launchItems} launch items bind ${bound.size} distinct proof/step(s); preflight registers ${preflightProofs.size} proofs of ${proofScripts.size} in package.json and ${preflightSteps.size} STEPS entries\n`);
  for (const [p, items] of [...bound].sort()) console.log(`  ${p.padEnd(32)} ← ${items.join(", ")}`);
  if (problems.length) {
    for (const p of problems) console.error(`\n✗ ${p}`);
    console.error(`\nLaunch-proof bindings FAILED: ${problems.length} problem(s). A binding is a claim that a named proof or step certifies a launch item; every one must name a proof or step that exists and runs per push.`);
    process.exit(1);
  }
  console.log("\nLaunch-proof bindings passed — every launch item names at least one proof or step, and every named one exists, runs in preflight, and never self-skips.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`check-launch-proof-bindings: ${e.message}`); process.exit(1); });
}

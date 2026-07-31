// Connector-discipline gate — every integration family must be gated and proven,
// and none may act on a device.
//
// WHY THIS EXISTS. `uem/` sat outside connector discipline for a long time: no
// fixture mode, no tier gate, no `SIGNALGRID_LIVE_INTEGRATIONS` check, no proof —
// and it shipped `LockDevice`, remote-lock and passcode-bypass calls to real vendor
// APIs, plus a hardcoded `compliant: true` that reported every Jamf device healthy.
// None of that was caught by a gate. It was caught because somebody happened to look.
//
// "Somebody happened to look" is not a control. Worse, the audit that found it also
// found SIX MORE families in the same shape, one of them (`nac/`) with the same
// class of device actuator. A defect that recurs across a whole population is a
// missing gate, not a missing review.
//
// HOW THIS WORKS, following `check-guard-registries.mjs` — whose header states the
// principle this file is built on: "a guard whose coverage list is stale is WORSE
// than no guard, because it reports success over the part it has stopped looking at."
//
//   1. The family list is DERIVED from the filesystem, never hand-maintained. A new
//      connector directory is in scope the moment it exists.
//   2. Each family must have a live-call gate and a proof.
//   3. NO family may perform a device action (quarantine / lock / wipe / erase /
//      forced reauth) over the network. That is AGENTS.md:19 — "keep high-risk
//      actions simulated and approval-required."
//   4. Known gaps live in an explicit registry with a reason and a severity. They do
//      not fail the build — holding every PR hostage to pre-existing debt is how a
//      gate gets switched off — but they are PRINTED IN FULL on every run, so the
//      debt is stated rather than implied by silence.
//   5. THE REGISTRY CANNOT GO STALE, in both directions:
//        - a family that is neither disciplined nor registered FAILS, so new debt
//          cannot be added quietly;
//        - a family that IS registered but has since been fixed also FAILS, telling
//          you to delete the entry. An exemption list that outlives its subject is
//          the exact failure mode the precedent guard was written to prevent.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const familyDir = join(repo, "lib/integrations/src/integrations");
const proofDir = join(repo, "scripts/src");

const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

/** Directories that are not connector families. `adapters` holds shared type
 *  definitions; it has no vendor surface of its own. */
const NOT_A_FAMILY = new Set(["adapters"]);

/**
 * Pre-existing gaps, each with a reason a reader can evaluate.
 *
 * `severity` is the thing to read first:
 *   violation       — breaks a written rule in AGENTS.md. Fix, do not extend.
 *   ungated-emitter — sends outbound (tickets, events, logs) with no tier gate.
 *                     The POSTs are the family's PURPOSE, not a device action, so
 *                     this is a live-vendor-call boundary issue rather than a
 *                     platform-honesty one. Still needs a gate.
 *   unproven        — gated, but no proof asserts the gate actually holds.
 */
const KNOWN_GAPS = {
  // `carrier` and `graph` were listed here on the assumption they had no proof. The
  // stale-entry check below immediately disproved it: they are covered by
  // carrier-reachability-proof.ts and graph-connector-proof.ts. Entries removed —
  // which is the self-invalidating half of this registry doing its job on its first run.
};

/** A device action performed over the network.
 *
 *  TWO ROUNDS OF FALSE POSITIVES shaped this, and both are worth recording because
 *  the naive version of this check is worse than useless:
 *
 *  1. Matching the VERB anywhere flagged `uem/`'s normalizers, which legitimately
 *     READ vendor enum values containing "wipe" (`retirePending`,
 *     `EnterpriseWipePending`). Banning the vocabulary would force them to obfuscate
 *     the very states they exist to recognise.
 *  2. Requiring verb + a mutating request in the same FILE then flagged `itsm/`,
 *     whose ticket templates carry `device_quarantine: { category: 'Software' }`
 *     alongside the POST that creates a ticket. Describing a quarantine in a ticket
 *     is the opposite of performing one.
 *
 *  So the verb must be INVOKED or DECLARED — immediately followed by `(`. That
 *  matches `async quarantineEndpoint(` in cisco-ise.ts and misses a data literal.
 *  Narrow on purpose: a check that cries wolf gets switched off, and this one has to
 *  survive long enough to catch the next `uem/`. */
const ACTION_CALL =
  /\b(quarantineEndpoint|unquarantineEndpoint|quarantine|unquarantine|lockDevice|remoteLock|bypassActivationLock|eraseDevice|wipeDevice|reauthenticate|disconnectEndpoint)\s*\(/i;
const MUTATING_REQUEST = /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i;

const isComment = (line) => {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean),
);

function analyzeFamily(name) {
  const dir = join(familyDir, name);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  let gated = false;
  let performsAction = false;
  const actionSites = [];

  for (const f of files) {
    const rel = `lib/integrations/src/integrations/${name}/${f}`;
    if (!tracked.has(rel)) continue;
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    const code = lines.filter((l) => !isComment(l));
    const body = code.join("\n");
    // Gated either by naming the env var directly, or by routing through the
    // SHARED gate in adapters/emit-gate.ts. The shared form is STRONGER, not
    // weaker: one resolver cannot drift permissive the way four copy-pasted
    // policies can, and the drifted copy is always the one that ships. A family
    // must both import it AND call it — an unused import gates nothing.
    if (/SIGNALGRID_LIVE_INTEGRATIONS/.test(body)) gated = true;
    if (/adapters\/emit-gate/.test(body) && /resolveEmission\s*\(/.test(body)) gated = true;
    if (ACTION_CALL.test(body) && MUTATING_REQUEST.test(body)) {
      performsAction = true;
      code.forEach((l, i) => { if (ACTION_CALL.test(l)) actionSites.push(`${f}:~${i + 1}`); });
    }
  }

  // A proof either lives at the conventional path, or the family is covered by a
  // proof that imports it by subpath. Both count — what must not count is "nothing".
  const conventional = existsSync(join(proofDir, `${name}-proof.ts`));
  // …or a proof that names the family's source path explicitly. emit-gate-proof
  // asserts, per family, that each one imports AND calls the shared resolver —
  // which is coverage of that family, even though it imports the gate rather
  // than the family's own subpath (several have no index.ts to import).
  const proofFiles = readdirSync(proofDir).filter((f) => f.endsWith("-proof.ts"));
  const importedByAProof = proofFiles.some((f) => {
    const src = readFileSync(join(proofDir, f), "utf8");
    return (
      new RegExp(`@workspace/integrations/${name}\\b`).test(src) ||
      new RegExp(`integrations/${name}/`).test(src)
    );
  });

  return { name, gated, proven: conventional || importedByAProof, performsAction, actionSites };
}

console.log("Connector-discipline gate — every family gated and proven, none acting on a device\n");

const families = readdirSync(familyDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NOT_A_FAMILY.has(e.name))
  .map((e) => e.name)
  .sort();

console.log(`families derived from the filesystem: ${families.length}\n`);

const results = families.map(analyzeFamily);
const disciplined = results.filter((r) => r.gated && r.proven && !r.performsAction);

// ── 1. Undisciplined and unregistered → FAIL (new debt cannot be added quietly) ──
for (const r of results) {
  const problems = [];
  if (!r.gated) problems.push("no SIGNALGRID_LIVE_INTEGRATIONS gate");
  if (!r.proven) problems.push("no proof");
  if (r.performsAction) problems.push(`performs a device action over the network (${r.actionSites.slice(0, 3).join(", ")})`);
  if (problems.length === 0) continue;
  if (!KNOWN_GAPS[r.name]) {
    bad(
      `${r.name}: ${problems.join("; ")}. Bring it under connector discipline, or — if that is genuinely ` +
        `not possible yet — add it to KNOWN_GAPS in this file with a reason. Silence is not an option.`,
    );
  }
}

// ── 2. Registered but since fixed → FAIL (the registry must not outlive its subject) ──
for (const name of Object.keys(KNOWN_GAPS)) {
  const r = results.find((x) => x.name === name);
  if (!r) {
    bad(`KNOWN_GAPS lists "${name}", which is no longer a connector family. Remove the entry.`);
    continue;
  }
  if (r.gated && r.proven && !r.performsAction) {
    bad(
      `KNOWN_GAPS lists "${name}" as a gap, but it is now gated, proven and action-free. ` +
        `Delete the entry — a stale exemption reports success over something nobody is checking any more.`,
    );
  }
}

// ── 3. Announce the debt in full, every run ─────────────────────────────────────
const gaps = results
  .filter((r) => KNOWN_GAPS[r.name])
  .map((r) => ({ ...r, ...KNOWN_GAPS[r.name] }))
  .sort((a, b) => (a.severity === "violation" ? -1 : b.severity === "violation" ? 1 : 0));

ok(`${disciplined.length} of ${families.length} families are gated, proven and action-free`);

if (gaps.length) {
  console.log(`\n  KNOWN GAPS — ${gaps.length} families, stated rather than implied by silence:`);
  for (const g of gaps) {
    const missing = [
      !g.gated ? "ungated" : null,
      !g.proven ? "unproven" : null,
      g.performsAction ? "DEVICE ACTION" : null,
    ].filter(Boolean).join(" + ");
    console.log(`    [${g.severity}] ${g.name} (${missing})`);
    console.log(`        ${g.reason}`);
  }
  const violations = gaps.filter((g) => g.severity === "violation");
  if (violations.length) {
    console.log(
      `\n  ${violations.length} of these break a written rule in AGENTS.md and should be fixed, not extended: ` +
        `${violations.map((v) => v.name).join(", ")}.`,
    );
  }
}

console.log(
  "\n  This gate blocks NEW undisciplined families and NEW device actuators. It does not\n" +
    "  fail on the gaps above — holding every PR hostage to pre-existing debt is how a gate\n" +
    "  gets switched off — but it will fail the moment one of them is fixed and its entry\n" +
    "  is left behind.",
);

if (failures.length) {
  console.error(`\nConnector-discipline gate FAILED: ${failures.length} problem${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("\nConnector-discipline gate passed.");

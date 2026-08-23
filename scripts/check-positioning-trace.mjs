// Positioning-trace gate — the ratified positioning must still trace to a
// profile that agrees with it.
//
// WHY THIS EXISTS. docs/POSITIONING.md carries a claim-to-proof trace, and that
// table is what makes the positioning legitimate rather than merely asserted:
// every buyer-facing claim names the thing in this repository that makes it
// true. It cited launch-profile.mjs by LINE NUMBER, and line numbers rot.
//
// All five had rotted by 2026-08-23, silently and completely:
//
//   :126-129  claimed the criterion string   -> TARGET = "Limited GA, 2027-02-04"
//   :240-243  claimed device_posture, launch -> "webhooks", a DEFERRED entry
//   :274-275  claimed location is deferred   -> "credential_rotation"
//   :308-310  claimed /v1/decisions/evaluate -> a comment about /api mounting
//   :453-458  claimed ios:EnterpriseShell    -> the operator console
//
// Note what was and was not wrong, because the distinction is the whole point:
// every CLAIM was true — device_posture really is launch, location really is
// deferred — and every CITATION was false. A reader checking the work would
// have found nonsense at the line and had no way to tell whether the claim or
// the pointer had drifted. A trace nobody can follow is decoration.
//
// So the trace now references the profile BY ID, and this gate resolves each
// one against the profile itself:
//
//   launch-profile: `device_posture` is `launch`
//   launch-profile: `CRITERION`                     (a named export, not an item)
//
// An id that does not exist fails. An id whose status differs from the claim
// fails. Both are the same defect the line numbers hid.
//
// GATED vs REPORTED: only the launch-profile references are gated, because only
// they are mechanically resolvable. Prose grounding ("design law", a doc name)
// is left to the cited-paths gate, which already checks that a referenced file
// exists. Claiming to verify prose here would be the same overreach the trace
// itself fell into.
//
// SELF-TEST: the parse must find the real references (floor), a bad status must
// be rejected, and an unknown id must be rejected. A gate that cannot fail
// proves nothing.
import { readFileSync } from "node:fs";

const DOC = "docs/POSITIONING.md";
const REFERENCE = /launch-profile: `([^`]+)`(?:\s+is\s+`([a-z_]+)`)?/g;
const REFERENCE_FLOOR = 5;

const profile = await import("./launch-profile.mjs");

/** id -> status, built from the profile itself rather than restated here. */
const statusById = new Map();
for (const group of profile.SURFACES) {
  for (const status of profile.STATUSES) {
    for (const item of group[status] ?? []) {
      const id = typeof item === "string" ? item : (item.id ?? item.name);
      if (id) statusById.set(id, status);
    }
  }
}

function problemsFor(refs) {
  const out = [];
  for (const [id, claimed] of refs) {
    if (!claimed) {
      // A bare reference names an EXPORT rather than a profile item.
      if (!(id in profile)) {
        out.push(`\`${id}\` is referenced as a launch-profile export, but the profile exports no such name`);
      }
      continue;
    }
    const actual = statusById.get(id);
    if (actual === undefined) {
      out.push(`\`${id}\` is claimed \`${claimed}\`, but the profile carries no item with that id`);
    } else if (actual !== claimed) {
      out.push(`\`${id}\` is claimed \`${claimed}\`, but the profile classifies it \`${actual}\``);
    }
  }
  return out;
}

const refs = [...readFileSync(DOC, "utf8").matchAll(REFERENCE)].map((m) => [m[1], m[2]]);

// ── self-test ────────────────────────────────────────────────────────────────
{
  const parses = [...'launch-profile: `x` is `launch`'.matchAll(REFERENCE)].length === 1;
  const catchesWrongStatus = problemsFor([["device_posture", "deferred"]]).length > 0;
  const catchesUnknownId = problemsFor([["not-a-real-surface", "launch"]]).length > 0;
  const acceptsTruth = problemsFor([["device_posture", "launch"]]).length === 0;
  if (
    refs.length < REFERENCE_FLOOR ||
    statusById.size < 50 ||
    !parses ||
    !catchesWrongStatus ||
    !catchesUnknownId ||
    !acceptsTruth
  ) {
    console.error(
      `✗ SELF-TEST FAILED — refs=${refs.length} (floor ${REFERENCE_FLOOR}), profileItems=${statusById.size}, ` +
        `parse=${parses}, wrongStatus=${catchesWrongStatus}, unknownId=${catchesUnknownId}, truth=${acceptsTruth}. ` +
        "The reference idiom or the profile shape has drifted; a gate resolving nothing is green about nothing.",
    );
    process.exit(1);
  }
}

console.log(`Positioning trace — every claim must still resolve in the profile (${DOC})\n`);
const problems = problemsFor(refs);
for (const [id, claimed] of refs) {
  const actual = claimed ? statusById.get(id) : (id in profile ? "export" : undefined);
  const ok = claimed ? actual === claimed : id in profile;
  console.log(`  ${ok ? "✓" : "✗"} ${id}${claimed ? ` → ${claimed}` : " (export)"}`);
}
for (const p of problems) console.error(`  ✗ ${p}`);

console.log(
  `\npositioning-trace: ${refs.length} launch-profile references resolved against ${statusById.size} ` +
    `classified profile items, ${problems.length} problem(s); self-test green. ` +
    "Prose grounding is REPORTED, not gated — cited-paths already checks that referenced files exist.",
);
if (problems.length > 0) {
  console.error(
    "\nPositioning-trace gate FAILED — the ratified positioning cites a profile that does not agree\n" +
      "with it. Fix the claim or fix the profile; never let the trace point at something that is not there.",
  );
  process.exit(1);
}
console.log("Positioning-trace gate passed — every claim resolves, by id, in the profile itself.");

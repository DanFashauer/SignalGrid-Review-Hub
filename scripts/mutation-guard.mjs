// Mutation guard — turns "is this guard falsifiable?" into a gate.
//
// WHY THIS EXISTS, precisely.
//
// Every grant-emitting connector is brute-forced by `scripts/src/lib/grant-safety.ts`
// over its full input space, and every one reports 0 mismatches. That proves a real
// thing: no unknown, missing or malformed input reaches a grant. It does NOT prove that
// each individual guard is doing work, and the two properties are easy to confuse.
//
// The reason is structural. Grant-safety observes only GRANT-NESS. Every malformed value
// already normalizes to a denying sentinel, so deleting an integrity condition changes
// `reportIntegrity` and changes no action — the enumeration stays green and the condition
// is load-bearing but unproven. Two adversarial reviews each found exactly that:
//
//   - `device-management-health`: two of three terms in the channel-consistency guard
//     could be deleted with the proof at 141/141 green, silently changing a reason code.
//   - `link-usability`: three conditions around the association branch survived, and the
//     branch they guarded turned out to be DEAD — its candidate won zero times out of
//     360 opportunities, so an asserted "this device is not on the network" was being
//     reported as a generic unknown.
//
// Both were found because a reviewer thought to try mutation testing. That is not a
// control; it is luck with good habits. This makes it a gate.
//
// WHAT IT DOES. For each registered {file, proof} pair it applies one mutation at a time,
// runs that proof, restores the file, and classifies:
//
//   killed      — the proof failed. The guard is falsifiable. Good.
//   SURVIVOR    — the proof passed. The guard is unfalsifiable: either dead code, or
//                 real behaviour with no test. Fails this gate unless allowlisted.
//   hung        — the proof did not terminate inside the timeout. Reported separately
//                 and treated as killed-with-a-warning, because a hang IS a detected
//                 regression — just one whose CI failure mode is a job burning its whole
//                 budget instead of going red. Deleting `MAX_PROTOTYPE_DEPTH` does this:
//                 the prototype walk meets a Proxy that returns a fresh prototype from
//                 every `getPrototypeOf` and allocates forever.
//   skipped     — the mutation did not change the file (pattern absent). Not counted.
//
// The gate is "no NEW survivors", not "zero survivors". Some guards are genuinely inert
// at current severities — a contradiction candidate already outranks what they guard —
// and are kept because they encode the rule and would become load-bearing the moment a
// severity changes. Those carry an allowlist entry with a reason, mirroring how the
// source files already label them. An allowlist entry that stops matching is itself a
// failure: it means the code moved and the justification was not revisited.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True only when this file is the entrypoint, so another script can import its
 *  registry without running the gate. */
const IS_MAIN = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

/** Per-proof wall-clock ceiling. Generous enough for the largest enumeration
 *  (device-management-health runs 1.35M raw reports twice in ~11s) and tight enough that
 *  a hang is detected in seconds rather than at a CI job's timeout. */
const PROOF_TIMEOUT_MS = 90_000;

// ── what to mutate ────────────────────────────────────────────────────────────
//
// Deliberately line-oriented and conservative rather than a general AST mutator. A
// mutation that fails to parse makes the proof crash, which reads as "killed" and would
// quietly inflate the kill rate — so the patterns below only produce syntactically valid
// TypeScript. Each is a shape this codebase actually uses for a guard.
// Every pattern tolerates a trailing `// comment` (review finding): the patterns
// were end-of-line anchored, so a guard line carrying an inline comment matched NO
// mutator and was SILENTLY excluded from the sweep — a worse state than an
// allowlisted survivor, because nothing ever re-validated the exemption. The
// comment, when present, is preserved in the mutated line so allowlist matching
// against the source line keeps working.
const MUTATORS = [
  {
    id: "cond-false",
    // `if (<anything>) {` → `if (false) {`  — delete the branch.
    match: /^(\s*)if \((.+)\) \{( \/\/.*)?$/,
    apply: (m) => `${m[1]}if (false) {${m[3] ?? ""}`,
    describe: (m) => `if (${truncate(m[2])}) → if (false)`,
  },
  {
    id: "else-if-false",
    match: /^(\s*)\} else if \((.+)\) \{( \/\/.*)?$/,
    apply: (m) => `${m[1]}} else if (false) {${m[3] ?? ""}`,
    describe: (m) => `else if (${truncate(m[2])}) → else if (false)`,
  },
  {
    id: "else-if-true",
    // Removes a guard on an else-branch without deleting the branch itself — this is
    // what catches a suppression guard like `} else if (!contradictory) {`.
    match: /^(\s*)\} else if \((!.+)\) \{( \/\/.*)?$/,
    apply: (m) => `${m[1]}} else if (true) {${m[3] ?? ""}`,
    describe: (m) => `else if (${truncate(m[2])}) → else if (true)`,
  },
  {
    id: "disjunct-false",
    // A trailing `||` operand on its own line — how the multi-term guards are written.
    match: /^(\s*)(.+) \|\|( \/\/.*)?$/,
    apply: (m) => `${m[1]}false ||${m[3] ?? ""}`,
    describe: (m) => `${truncate(m[2])} || → false ||`,
  },
  {
    id: "conjunct-true",
    // A trailing `&&` operand on its own line.
    match: /^(\s*)(.+) &&( \/\/.*)?$/,
    apply: (m) => `${m[1]}true &&${m[3] ?? ""}`,
    describe: (m) => `${truncate(m[2])} && → true &&`,
  },
  {
    id: "return-flip",
    // `return true;` / `return false;` inside a predicate — flips a fail-closed default.
    match: /^(\s*)return (true|false);( \/\/.*)?$/,
    apply: (m) => `${m[1]}return ${m[2] === "true" ? "false" : "true"};${m[3] ?? ""}`,
    describe: (m) => `return ${m[2]} → return ${m[2] === "true" ? "false" : "true"}`,
  },
];

const truncate = (s) => (s.length > 58 ? `${s.slice(0, 55)}...` : s);

// ── registry ──────────────────────────────────────────────────────────────────
//
// Scoped on purpose to the files whose correctness is the allow-path: the normalizers
// and evaluators of the grant-emitting connectors. Widening this is cheap; widening it
// without meaning to would make the gate slow and its output unreadable.
export const TARGETS = [
  {
    proof: "proof:device-management-health",
    files: [
      "lib/integrations/src/integrations/device-management-health/evaluate.ts",
      "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    ],
  },
  {
    proof: "proof:link-usability",
    files: [
      "lib/integrations/src/integrations/link-usability/evaluate.ts",
      "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    ],
  },
  {
    proof: "proof:task-exception",
    files: [
      "lib/integrations/src/integrations/task-exception/evaluate.ts",
      "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    ],
  },
  {
    proof: "proof:verdict-attestation",
    files: ["lib/verdict-attestation/src/attest.ts", "lib/verdict-attestation/src/canonical.ts"],
  },
  {
    proof: "proof:custody-beacon",
    files: [
      "lib/integrations/src/integrations/custody-beacon/evaluate.ts",
      "lib/integrations/src/integrations/custody-beacon/custody-beacon-connector.ts",
    ],
  },
  {
    proof: "proof:app-update",
    files: [
      "lib/integrations/src/integrations/app-update/evaluate.ts",
      "lib/integrations/src/integrations/app-update/app-update-connector.ts",
    ],
  },
  {
    proof: "proof:platform-sso",
    files: [
      "lib/integrations/src/integrations/platform-sso/evaluate.ts",
      "lib/integrations/src/integrations/platform-sso/platform-sso-connector.ts",
    ],
  },
  {
    // The last QUEUED allow-path proof. Registered on the argument that composition
    // is exactly where a grant leaks — consuming other dimensions' verdicts rather
    // than parsing a bridge report changes WHAT is mutated, not whether it needs to
    // be falsifiable.
    proof: "proof:pim-activation",
    files: ["lib/pim-activation/src/evaluate.ts", "lib/pim-activation/src/normalize.ts"],
  },
  {
    proof: "proof:passkey-assurance",
    files: [
      "lib/integrations/src/integrations/passkey-assurance/evaluate.ts",
      "lib/integrations/src/integrations/passkey-assurance/passkey-assurance-connector.ts",
    ],
  },
  {
    proof: "proof:emitter-discipline",
    files: [
      "lib/integrations/src/integrations/itsm/resolve.ts",
      "lib/integrations/src/integrations/siem/resolve.ts",
      "lib/integrations/src/integrations/syslog/resolve.ts",
      "lib/integrations/src/integrations/telemetry/resolve.ts",
      "lib/integrations/src/integrations/webhooks/resolve.ts",
    ],
  },

  {
    proof: "proof:facility-trust-graph",
    files: [
      "lib/facility-trust-graph/src/evaluate.ts",
      "lib/facility-trust-graph/src/graph.ts",
      "lib/facility-trust-graph/src/correlate.ts",
      "lib/facility-trust-graph/src/clinical.ts",
      "lib/facility-trust-graph/src/transition.ts",
      "lib/facility-trust-graph/src/gateway.ts",
    ],
  },

  {
    proof: "proof:shift-context",
    files: [
      "lib/integrations/src/integrations/shift-context/evaluate.ts",
      "lib/integrations/src/integrations/shift-context/shift-context-connector.ts",
    ],
  },
  {
    proof: "proof:bootstrap-credential",
    files: [
      "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
      "lib/integrations/src/integrations/bootstrap-credential/bootstrap-credential-connector.ts",
    ],
  },

  {
    proof: "proof:benchmark-selection",
    files: [
      "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
      "lib/integrations/src/integrations/benchmark-selection/benchmark-selection-connector.ts",
      "lib/integrations/src/integrations/benchmark-selection/catalog.ts",
    ],
  },

  {
    proof: "proof:policy-binding",
    files: [
      "lib/integrations/src/integrations/policy-binding/evaluate.ts",
      "lib/integrations/src/integrations/policy-binding/policy-binding-connector.ts",
    ],
  },

  {
    proof: "proof:agent-behavior",
    files: [
      "lib/integrations/src/integrations/agent-behavior/evaluate.ts",
      "lib/integrations/src/integrations/agent-behavior/agent-behavior-connector.ts",
    ],
  },
  {
    proof: "proof:agent-identity",
    files: [
      "lib/integrations/src/integrations/agent-identity/evaluate.ts",
      "lib/integrations/src/integrations/agent-identity/agent-identity-connector.ts",
    ],
  },
  {
    proof: "proof:oauth-consent",
    files: [
      "lib/integrations/src/integrations/oauth-consent/evaluate.ts",
      "lib/integrations/src/integrations/oauth-consent/oauth-consent-connector.ts",
    ],
  },
  {
    proof: "proof:sso-session",
    files: [
      "lib/integrations/src/integrations/sso-session/evaluate.ts",
      "lib/integrations/src/integrations/sso-session/sso-session-connector.ts",
    ],
  },
  {
    proof: "proof:access-governance",
    files: [
      "lib/integrations/src/integrations/access-governance/evaluate.ts",
      "lib/integrations/src/integrations/access-governance/access-governance-connector.ts",
    ],
  },
  {
    proof: "proof:ot-posture",
    files: [
      "lib/integrations/src/integrations/ot-posture/evaluate.ts",
      "lib/integrations/src/integrations/ot-posture/ot-connector.ts",
    ],
  },
  {
    proof: "proof:token-binding",
    files: [
      "lib/integrations/src/integrations/token-binding/evaluate.ts",
      "lib/integrations/src/integrations/token-binding/token-binding-connector.ts",
    ],
  },
  {
    proof: "proof:pacs-access",
    files: [
      "lib/integrations/src/integrations/pacs-access/evaluate.ts",
      "lib/integrations/src/integrations/pacs-access/pacs-access-connector.ts",
    ],
  },
  {
    proof: "proof:dual-control",
    files: [
      "lib/dual-control/src/evaluate.ts",
      "lib/dual-control/src/normalize.ts",
    ],
  },
];

// ── known-inert survivors ─────────────────────────────────────────────────────
//
// Each entry needs a REASON, and the reason has to be the kind a reader can check. "It's
// fine" is not one. An entry whose `line` no longer matches fails the gate: the code
// moved and nobody re-derived whether the justification still holds.
const ALLOWED = [
  // The four entries below were classified by BEHAVIOURAL DIFF, not by reading. For each,
  // the mutation was applied and the full output — not just grant-ness — was compared
  // across the connector's whole input space. That is what separates "genuinely inert"
  // from "real behaviour with no test", and the guard itself cannot tell them apart: a
  // surviving mutation looks identical either way. Any future reader can re-run the same
  // check rather than take the reason on trust.
  {
    file: "lib/integrations/src/integrations/oauth-consent/evaluate.ts",
    line: 'consent.grants === "none" &&',
    reason:
      'Genuinely inert, verified by diffing all 6,480 enumerated states with the term mutated to `true`: ZERO verdicts changed. The guard as a whole is live (it fails a "none" report that carries positive risky detail), but this TERM cannot matter, because the risky-field checks above already push a candidate for broad/full_access scope, an unverified publisher, or an unmanaged workload secret whenever grants === "present" — so the disjunct it scopes can only be true when grants is already "none", and an "unknown" grants value has returned before reaching here. Kept because it states the scope exactly and becomes load-bearing the moment the risky-field block\'s own scoping changes.',
  },
  {
    file: "lib/dual-control/src/normalize.ts",
    line: "!plain ||",
    reason:
      "Covers BOTH occurrences (the authorizer normalizer and the top-level request normalizer) — same term, same justification. Genuinely inert, verified by diffing 239 hostile shapes (non-objects, null, arrays, Object.prototype, a getPrototypeOf Proxy, throwing accessors, and every field-corruption crossed pair) with the term mutated to `false`: ZERO outputs changed. When the input is not a plain object every field read yields undefined, and the per-field refMalformed/enumMalformed checks below already mark the report malformed on that alone. Kept as defence in depth: it encodes the rule directly instead of relying on a downstream check to imply it, and becomes load-bearing the moment any field check is narrowed to tolerate undefined.",
  },
  {
    file: "lib/dual-control/src/normalize.ts",
    line: "readThrew ||",
    reason:
      "Genuinely inert, verified by the same 239-shape diff with the term mutated to `false`: ZERO outputs changed. A throwing accessor forces every field to undefined in the catch block, and the per-field checks below already mark the report malformed on that alone. Kept for the same reason as the !plain term beside it — a read that THREW is a distinct fact from a read that returned nothing, and stating it here keeps the integrity flag honest if the field checks ever stop covering undefined.",
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'report.credentialRef.length > 0 &&',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: every non-confirmed state already pushes a raising candidate above it (credentialRef emptiness included — it raises CREDENTIAL_REF_MISSING on its own), so the candidate list is never empty when positivelyConfirmed is false. Kept as the last thing standing between a weakened branch and a surviving seed grant; it pushes its own GRANT_BACKSTOP reason so a firing is visible in the record. Same shape as the platform-sso and policy-binding backstops.',
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'report.identityRef.trim().length > 0 &&',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: an empty or whitespace-only identityRef already raises IDENTITY_REF_MISSING on its own branch above, so the candidate list is never empty when positivelyConfirmed is false. Kept as the last thing standing between a weakened branch and a surviving seed grant; it pushes its own GRANT_BACKSTOP reason so a firing is visible in the record. Same shape as the credentialRef term directly above it.',
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: every non-confirmed state already pushes a raising candidate above it, so the candidate list is never empty when positivelyConfirmed is false. Kept because it is the last thing standing between a weakened branch and a surviving seed grant, and it now pushes its OWN reason code (GRANT_BACKSTOP) so a firing would be visible in the record rather than disguised as a normal branch. Same shape and same justification as the platform-sso and policy-binding backstops.',
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'report.registration === "registered" &&',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: every non-confirmed state already pushes a raising candidate above it, so the candidate list is never empty when positivelyConfirmed is false. Kept because it is the last thing standing between a weakened branch and a surviving seed grant, and it now pushes its OWN reason code (GRANT_BACKSTOP) so a firing would be visible in the record rather than disguised as a normal branch. Same shape and same justification as the platform-sso and policy-binding backstops.',
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'deviceHeld &&',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: every non-confirmed state already pushes a raising candidate above it, so the candidate list is never empty when positivelyConfirmed is false. Kept because it is the last thing standing between a weakened branch and a surviving seed grant, and it now pushes its OWN reason code (GRANT_BACKSTOP) so a firing would be visible in the record rather than disguised as a normal branch. Same shape and same justification as the platform-sso and policy-binding backstops.',
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'report.attestation === "verified" &&',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: every non-confirmed state already pushes a raising candidate above it, so the candidate list is never empty when positivelyConfirmed is false. Kept because it is the last thing standing between a weakened branch and a surviving seed grant, and it now pushes its OWN reason code (GRANT_BACKSTOP) so a firing would be visible in the record rather than disguised as a normal branch. Same shape and same justification as the platform-sso and policy-binding backstops.',
  },
  {
    file: 'lib/integrations/src/integrations/passkey-assurance/evaluate.ts',
    line: 'if (!positivelyConfirmed && candidates.length === 0) {',
    reason:
      'Defence-in-depth backstop that CANNOT fire today: every non-confirmed state already pushes a raising candidate above it, so the candidate list is never empty when positivelyConfirmed is false. Kept because it is the last thing standing between a weakened branch and a surviving seed grant, and it now pushes its OWN reason code (GRANT_BACKSTOP) so a firing would be visible in the record rather than disguised as a normal branch. Same shape and same justification as the platform-sso and policy-binding backstops.',
  },
  {
    file: "lib/integrations/src/integrations/link-usability/evaluate.ts",
    line: 'link.linkProgress !== "not_associated"',
    reason:
      "Inert at current severities: the duplicate candidate it suppresses is identical to the one already raised, so no verdict changes. Kept because it states 'raise a finding once' and becomes load-bearing if either candidate's severity moves. Labelled inert in the source.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/evaluate.ts",
    line: "!linkReportInconsistent &&",
    reason:
      "Inert on the ASSOCIATION branch: the inconsistency candidate is itself step_up and pushed first, so it wins the tie regardless. (The same guard on the LADDER is load-bearing, because those candidates alert — that instance is killed.) Labelled inert in the source.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/evaluate.ts",
    line: "} else if (!roamReportInconsistent) {",
    reason:
      "Inert at current severities: sticky/excessive are step_up, equal to the contradiction's own severity and pushed after it, and neither pushes a finding. Raising either to alert makes it load-bearing immediately. Labelled inert in the source.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: "!Array.isArray(report) &&",
    reason:
      "Documented redundant in the source: an array already fails the key scan on its own `length`.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: "report !== null &&",
    reason:
      "Documented redundant in the source: hasOwnProperty.call(null, …) throws into the wrapped read, which sets readFailed, which forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: "if (!plain) return undefined;",
    reason: "Documented redundant in the source: `!plain` already forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: 'if (typeof k === "symbol") return true;',
    reason:
      "Documented redundant in the source: `known` holds only strings, so the includes() below rejects every symbol anyway.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: "!Array.isArray(report) &&",
    reason: "Documented redundant in the source: an array fails the key scan on its own `length`.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: 'if (typeof k === "symbol") return true;',
    reason: "Documented redundant in the source: `known` holds only strings.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: 'typeof report === "object" &&',
    reason:
      "Documented redundant in the source: a primitive or function reaching the key scan makes Reflect.ownKeys throw or return unrecognized keys, ending at malformed either way.",
  },
  {
    file: "lib/integrations/src/integrations/device-management-health/device-management-health-connector.ts",
    line: "report !== null &&",
    reason:
      "Documented redundant in the source: hasOwnProperty.call(null, …) throws into the wrapped read, which sets readFailed, which forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/link-usability/link-usability-connector.ts",
    line: 'typeof report === "object" &&',
    reason: "Documented redundant in the source, same reasoning as its device-management-health twin.",
  },
  {
    file: "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    line: 'typeof report === "object" &&',
    reason:
      "Documented redundant in the source, same reasoning as its device-management-health twin: a primitive or function reaching the key scan makes Reflect.ownKeys throw or return unrecognized keys, ending at malformed either way.",
  },
  {
    file: "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    line: "report !== null &&",
    reason:
      "Documented redundant in the source: hasOwnProperty.call(null, …) throws into the wrapped read, which sets readFailed, which forces malformed.",
  },
  {
    file: "lib/integrations/src/integrations/task-exception/task-exception-connector.ts",
    line: "!Array.isArray(report) &&",
    reason: "Documented redundant in the source: an array fails the key scan on its own `length`.",
  },
  {
    file: "lib/verdict-attestation/src/attest.ts",
    line: "return false;",
    reason:
      "The catch in `digestsEqual` is UNREACHABLE: timingSafeEqual throws only on a length mismatch, already refused one line earlier. Kept as the rule 'an exception is not a match'. Labelled unreachable in the source.",
  },
  {
    file: "lib/verdict-attestation/src/attest.ts",
    line: 'typeof own("issuedAt") !== "number" ||',
    reason:
      "Redundant with the `!Number.isFinite` term on the next line — any non-number fails that too. Kept because the pair reads as one contract. Labelled redundant in the source.",
  },
  {
    file: "lib/integrations/src/integrations/custody-beacon/evaluate.ts",
    line: 'if (beacon.freshness !== "fresh") {',
    reason:
      "Verified shadow, not an exemption-by-accident: the complete grant backstop below computes positivelyInCustody (which requires freshness === 'fresh'), so deleting this branch leaves the candidate list empty for in-zone + reachable + stale/expired and the backstop pushes the byte-identical in_zone_stale/step_up/IN_ZONE_STALE candidate — confirmed by running the evaluator with the branch removed. Kept as the primary, readable statement of the freshness rule; deleting BOTH is not a single mutation. (The line is mutated for real now — the mutators tolerate trailing comments, so this entry actually fires.)",
  },
  {
    file: "lib/integrations/src/integrations/custody-beacon/evaluate.ts",
    line: 'beacon.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate, and the backstop never fires today — every non-confirmed state already pushes a raising candidate, as its own comment states. Weakening the predicate is unobservable while that holds, and the backstop exists precisely for the day it stops holding.",
  },
  {
    file: "lib/integrations/src/integrations/custody-beacon/evaluate.ts",
    line: 'beacon.zone === "in_custody_zone" &&',
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/custody-beacon/evaluate.ts",
    line: 'beacon.reachability === "reachable" &&',
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/custody-beacon/evaluate.ts",
    line: "if (!positivelyInCustody && candidates.length === 0) {",
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth whose own comment states 'today this never fires'. It exists to catch a FUTURE weakening of a branch, so no single present-day mutation can make it observable. Documented in the source.",
  },
  {
    file: "lib/integrations/src/integrations/app-update/evaluate.ts",
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate, and the backstop never fires today — every non-confirmed state already pushes a raising candidate, as its own comment states. Weakening the predicate is unobservable while that holds; the backstop exists for the day it stops holding.",
  },
  {
    file: "lib/integrations/src/integrations/app-update/evaluate.ts",
    line: 'report.currency === "current" &&',
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/app-update/evaluate.ts",
    line: "if (!positivelyCurrent && candidates.length === 0) {",
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth, documented in the source as never firing today; exists to catch a FUTURE weakening.",
  },
  {
    file: "lib/integrations/src/integrations/platform-sso/evaluate.ts",
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate — the backstop never fires today, as its own comment states; the predicate is unobservable until a branch weakens.",
  },
  {
    file: "lib/integrations/src/integrations/platform-sso/evaluate.ts",
    line: 'report.registration === "user" &&',
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/platform-sso/evaluate.ts",
    line: "hardwareBacked &&",
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/platform-sso/evaluate.ts",
    line: "if (!positivelyConfirmed && candidates.length === 0) {",
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth, documented in the source as never firing today; exists to catch a FUTURE weakening.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: 'obs.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate — the backstop never fires today, as its own comment states; the predicate is unobservable until a branch weakens. Same shape as the shift-context and benchmark-selection backstops below.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: 'obs.spaceInGraph === "known" &&',
    reason: "Backstop-predicate conjunct — same reasoning. The space branches are covered by the unmapped, unstated-ordering, and grant controls.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: '(obs.mapVersionMatch === "matched" || obs.mapVersionMatch === "unassessed") &&',
    reason: "Backstop-predicate conjunct — same reasoning. The map-version branch is covered by the wrong-map restrict control.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: 'obs.sourceHealth === "healthy" &&',
    reason: "Backstop-predicate conjunct — same reasoning. The health branches are covered by the unavailable, degraded, and absent-health-ordering controls.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: '(obs.recency === "current" || obs.recency === "unbounded") &&',
    reason: "Backstop-predicate conjunct — same reasoning. The recency branches are covered by the stale, unbounded-grant, and absent-time-ordering controls.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: '(obs.confidenceFit === "met" || obs.confidenceFit === "unbounded") &&',
    reason: "Backstop-predicate conjunct — same reasoning. The confidence branches are covered by the unmet and posed-but-unanswerable controls.",
  },
  {
    file: "lib/facility-trust-graph/src/evaluate.ts",
    line: 'if (!positivelyCertain && candidates.length === 0) {',
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth, documented in the source as never firing today; it exists to catch a FUTURE weakening. Same shape and justification as the sibling backstops.",
  },
  {
    file: "lib/facility-trust-graph/src/clinical.ts",
    line: "assignment.targetSpaceId !== null &&",
    reason:
      "Type-guard conjunct of spatiallyConsistent, labeled inert in the source: pathsConsistent over a missing/null id is false for any graph (path() of an unknown id is empty), so mutating it to true changes no observable output. Kept for the types.",
  },
  {
    file: "lib/facility-trust-graph/src/clinical.ts",
    line: "gradedObs.spaceId !== null &&",
    reason:
      "Type-guard conjunct of spatiallyConsistent — same inert reasoning as the targetSpaceId guard above.",
  },
  {
    file: "lib/facility-trust-graph/src/clinical.ts",
    line: 'gradedObs.spaceInGraph === "known" &&',
    reason:
      "Masked by ordering that is itself pinned: an unmapped observation drives a SPACE_UNMAPPED alert, and alert-class location verdicts block before spatial consistency is consulted (the wrong-map-not-steppable control), so this conjunct cannot change an outcome today. Labeled inert in the source.",
  },
  {
    file: "lib/facility-trust-graph/src/clinical.ts",
    line: 'capability.grading === "within_capability" &&',
    reason:
      "Grant-conjunct defence-in-depth, labeled in the source: exceeds_capability is blocked before the grant (pinned by the wifi-lie control) and unstated/unrecognized force the effective class to unknown, which certaintyConfirmed already refuses (pinned by the generic-rtls control). Exists to catch a FUTURE weakening, per the affirmative-on-every-axis doctrine.",
  },
  {
    file: "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      "Coherent-bootstrap rung conjunct, labeled inert in the source: every failure state of the conjunct already pushed a raising candidate (REPORT_MALFORMED step_up, pinned) that outranks this monitor rung, so weakening it adds only a losing candidate. Same shape for the four siblings below.",
  },
  {
    file: "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
    line: 'workflowFit === "enrollment_recovery" &&',
    reason:
      "Coherent-bootstrap rung conjunct — operational pushes a pinned restrict and unposed a pinned step_up, both outranking monitor.",
  },
  {
    file: "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
    line: 'report.lifetime === "within_lifetime" &&',
    reason:
      "Coherent-bootstrap rung conjunct — expired restricts, unbounded and unknown step up, all pinned and all outranking monitor.",
  },
  {
    file: "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
    line: 'report.scope === "enrollment_only" &&',
    reason:
      "Coherent-bootstrap rung conjunct — broad alerts and unknown steps up, both pinned and outranking monitor.",
  },
  {
    file: "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
    line: 'report.oneTime === "one_time" &&',
    reason:
      "Coherent-bootstrap rung conjunct — reusable and unknown both step up, pinned, outranking monitor.",
  },
  {
    file: "lib/integrations/src/integrations/bootstrap-credential/evaluate.ts",
    line: "if (candidates.length === 0) {",
    reason:
      "The bootstrap backstop itself — deliberately redundant defence-in-depth with its OWN reason (BOOTSTRAP_UNGRADED), documented in the source as never firing today; it exists so a FUTURE weakened branch surfaces as ungraded instead of impersonating the branch it replaced.",
  },
  {
    file: "lib/integrations/src/integrations/shift-context/evaluate.ts",
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate — the backstop never fires today, as its own comment states; the predicate is unobservable until a branch weakens. Same shape as the benchmark-selection and policy-binding backstops below.",
  },
  {
    file: "lib/integrations/src/integrations/shift-context/evaluate.ts",
    line: 'report.scheduleStanding === "on_shift" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning. The schedule branch itself is NOT exempt: the unknown-standing rung is pinned to lead over a site mismatch, so deleting the branch changes a pinned reason.",
  },
  {
    file: "lib/integrations/src/integrations/shift-context/evaluate.ts",
    line: 'report.punchStatus === "clocked_in" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning. The punch branches are covered by the off-clock, off-duty, deviation, on-break and absent-punch controls.",
  },
  {
    file: "lib/integrations/src/integrations/shift-context/evaluate.ts",
    line: 'if (!positivelyOnDuty && candidates.length === 0) {',
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth, documented in the source as never firing today; it exists to catch a FUTURE weakening. Same shape and justification as the benchmark-selection backstop.",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate — the backstop never fires today, as its own comment states; the predicate is unobservable until a branch weakens. Same shape as the policy-binding backstop below.",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'report.recognition === "recognized" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above. The recognition BRANCH itself is not exempt: four negative controls cover it (superseded, unlisted, not-in-catalog, and the pinned BENCHMARK_UNKNOWN reason).",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'report.provenance === "cis_published" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning. The provenance branch is covered by three controls (independent implementation, tool-declared, and the absent-key default).",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'report.platformMatch === "matched" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning. The platform branch is covered by the mismatch control and the absent-string control.",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'report.coverage === "complete" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning. The coverage branch is covered by five controls (unreconciled counts, empty run, partial run, one absent count, and non-integer counts).",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'report.requirementFit === "on_requirement" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning. It was the conjunction's FINAL clause (no trailing &&, so the mutator never touched it) until the recency clause was appended after it; nothing about its inertness changed. The requirement branch is covered by four controls (off-requirement, absent requirement, empty list, and the two-workflows divergence).",
  },
  {
    file: "lib/integrations/src/integrations/benchmark-selection/evaluate.ts",
    line: 'if (!positivelySelected && candidates.length === 0) {',
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth, documented in the source as never firing today; it exists to catch a FUTURE weakening. Same shape and justification as the policy-binding backstop.",
  },
  {
    file: "lib/integrations/src/integrations/policy-binding/evaluate.ts",
    line: 'report.reportIntegrity === "clean" &&',
    reason:
      "A conjunct of the grant backstop's predicate — the backstop never fires today, as its own comment states; the predicate is unobservable until a branch weakens.",
  },
  {
    file: "lib/integrations/src/integrations/policy-binding/evaluate.ts",
    line: 'report.binding === "bound" &&',
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/policy-binding/evaluate.ts",
    line: 'report.profileMatch === "matched" &&',
    reason: "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above.",
  },
  {
    file: "lib/integrations/src/integrations/policy-binding/evaluate.ts",
    line: 'report.enforcement === "enforcing" &&',
    reason:
      "Backstop-predicate conjunct — same reasoning as the reportIntegrity conjunct above. Deleting it lets a report-only or disabled binding satisfy positivelyBound, but those states already push their own raising candidate, so the backstop still cannot fire. The ENFORCEMENT BRANCH itself is not exempt and is covered by four negative controls (report_only → none, disabled → monitor, absent-key default, and dropping the wire key), each of which fails the proof.",
  },
  {
    file: "lib/integrations/src/integrations/policy-binding/evaluate.ts",
    line: "if (!positivelyBound && candidates.length === 0) {",
    reason:
      "The grant backstop itself — deliberately redundant defence-in-depth, documented in the source as never firing today; exists to catch a FUTURE weakening.",
  },
];

// ── runner ────────────────────────────────────────────────────────────────────

function runProof(proof) {
  const run = spawnSync("pnpm", ["run", proof], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: PROOF_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  // `spawnSync` reports a timeout via `error.code === "ETIMEDOUT"` on some platforms and
  // via a null status with a signal on others. Treat both as a hang.
  const timedOut = run.error?.code === "ETIMEDOUT" || (run.status === null && run.signal !== null);
  if (timedOut) return "hung";
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = out.match(/summary=(pass|fail) \((\d+)\/(\d+)\)/);
  // No summary line at all means the proof crashed — the mutation broke it, which counts
  // as killed.
  if (!summary) return "killed";
  return summary[1] === "pass" ? "survivor" : "killed";
}

function mutationsFor(file) {
  const abs = join(repoRoot, file);
  const original = readFileSync(abs, "utf8");
  const lines = original.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const mutator of MUTATORS) {
      const m = lines[i].match(mutator.match);
      if (!m) continue;
      const replaced = mutator.apply(m);
      if (replaced === lines[i]) continue; // no-op mutation, skip
      const mutated = [...lines];
      mutated[i] = replaced;
      out.push({
        file,
        abs,
        original,
        lineNo: i + 1,
        sourceLine: lines[i].trim(),
        mutator: mutator.id,
        describe: mutator.describe(m),
        content: mutated.join("\n"),
      });
    }
  }
  return out;
}

function isAllowed(mutation) {
  return ALLOWED.find((a) => a.file === mutation.file && mutation.sourceLine.includes(a.line));
}

function main() {
  const only = process.argv.find((a) => a.startsWith("--proof="))?.split("=")[1];
  const targets = only ? TARGETS.filter((t) => t.proof === only) : TARGETS;
  if (targets.length === 0) {
    console.error(`No target matches --proof=${only}. Known: ${TARGETS.map((t) => t.proof).join(", ")}`);
    process.exit(1);
  }

  console.log("Mutation guard — every registered guard must be falsifiable by its own proof\n");

  // An allowlist entry that no longer matches any line is itself a finding: the code moved
  // and the justification was never revisited. Checked BEFORE any mutation runs, so a stale
  // entry surfaces in seconds rather than after the full sweep.
  let staleAllowlist = 0;
  for (const entry of ALLOWED) {
    const abs = join(repoRoot, entry.file);
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      console.error(`✗ allowlist entry references a missing file: ${entry.file}`);
      staleAllowlist += 1;
      continue;
    }
    if (!text.includes(entry.line)) {
      console.error(`✗ STALE allowlist entry — no line matches in ${entry.file}:\n    "${entry.line}"`);
      console.error("    The code moved. Re-derive whether the justification still holds, then update or remove.");
      staleAllowlist += 1;
    }
  }
  if (staleAllowlist > 0) {
    console.error(`\nMutation guard FAILED: ${staleAllowlist} stale allowlist entr${staleAllowlist === 1 ? "y" : "ies"}.`);
    process.exit(1);
  }

  let total = 0;
  let killed = 0;
  let hung = 0;
  let allowed = 0;
  const survivors = [];

  for (const target of targets) {
    console.log(`── ${target.proof}`);
    for (const file of target.files) {
      const mutations = mutationsFor(file);
      console.log(`   ${file} — ${mutations.length} mutations`);
      for (const mutation of mutations) {
        total += 1;
        writeFileSync(mutation.abs, mutation.content);
        let verdict;
        try {
          verdict = runProof(target.proof);
        } finally {
          // ALWAYS restore, including on an unexpected throw. A mutation left on disk would
          // be catastrophic — it is a deliberately broken security guard.
          writeFileSync(mutation.abs, mutation.original);
        }
        if (verdict === "killed") {
          killed += 1;
        } else if (verdict === "hung") {
          hung += 1;
          console.log(`   ⚠ HANG  ${file}:${mutation.lineNo}  ${mutation.describe}`);
          console.log("           (detected, but its CI failure mode is a job timeout rather than a red assertion)");
        } else {
          const entry = isAllowed(mutation);
          if (entry) {
            allowed += 1;
          } else {
            survivors.push(mutation);
            console.log(`   ✗ SURVIVED  ${file}:${mutation.lineNo}  ${mutation.describe}`);
          }
        }
      }
    }
  }

  console.log(
    `\nmutations=${total} killed=${killed} hung=${hung} known-inert=${allowed} survivors=${survivors.length}`,
  );

  if (survivors.length > 0) {
    console.error("\nMutation guard FAILED — these guards are unfalsifiable by their own proof:\n");
    for (const s of survivors) {
      console.error(`  ${s.file}:${s.lineNo}`);
      console.error(`    ${s.sourceLine}`);
      console.error(`    ${s.describe}`);
    }
    console.error(
      "\nEach is one of three things, and they need different fixes:\n" +
        "  1. DEAD CODE — the branch cannot win. Delete it, or fix the ordering that makes it lose.\n" +
        "  2. REAL BEHAVIOUR WITH NO TEST — add a fixture that pins it. This is the common case,\n" +
        "     and the one the grant-safety enumeration structurally cannot catch.\n" +
        "  3. GENUINELY INERT at current severities — keep it, label it inert in the source, and\n" +
        "     add an ALLOWED entry here with a reason a reader can check.\n",
    );
    process.exit(1);
  }

  console.log("\nMutation guard passed — every registered guard is falsifiable, or documented as inert.");

}

if (IS_MAIN) main();

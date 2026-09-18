// Change-request DRAFT proof — fully OFFLINE and deterministic.
//
// Cascade join 2: a resolution plan becomes a change-request draft, and the draft
// goes out through the itsm family's gate. This proof holds the three rules the
// draft inherits, and it holds them by COMPOSITION rather than by reading the
// source, because a rule asserted by inspection is a rule that survives being
// deleted:
//
//  1. THE DRAFT IS NEVER PRE-APPROVED. Every draft this module can produce is
//     `requires_approval` + `approvalRequired` + `simulatedOnly`, and so is the
//     draft carried back by a SUBMITTED result — opening a change record is not
//     approving it. Asserted over every posture, both evidence shapes, the empty
//     plan and all four gate outcomes.
//  2. A CHANGE WINDOW NEVER RELAXES ANYTHING. For all eight postures, including
//     `change_authorized` with `changeAuthorized: true`, the draft is byte-
//     identical to the draft built with NO change record — same id, same items,
//     same reason codes — apart from the evidence field itself. An approved window
//     does not shorten the draft or drop a step.
//  3. `changeClass` IS CARRIED, NEVER GRADED. `emergency` — the string most likely
//     to be written by someone who wants a pass — produces a draft identical to
//     `standard` apart from that field and the id that digests it. Stronger than
//     the assertion: the class cannot reach `draftChangeRequest` at all, which the
//     proof pins by asserting every draft that function returns has `changeClass`
//     null regardless of what the evidence verdict said.
//
// THE SELF-TEST AT THE END is the control. `safetyViolations()` is what checks 1
// and 4 lean on, so a version of it that returns `[]` unconditionally would make
// this proof green against a draft that approves itself. Three planted defects
// prove it does not.
import {
  changeDraftPayload,
  draftChangeRequest,
  submitChangeDraft,
  withChangeClass,
  type ChangeDraftPlan,
  type ChangeDraftTarget,
  type ChangeRequestDraft,
} from "@workspace/integrations/itsm";
import type { ChangeWindowPosture, ChangeWindowVerdict } from "@workspace/integrations/change-window";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Change-request draft proof");

const PLAN: ChangeDraftPlan = {
  decisionId: "dec-7731",
  steps: [
    {
      reasonCode: "DEVICE_NONCOMPLIANT",
      resolutionClass: "requires_approval",
      action: "Approve a compliance remediation request to the device-management owner, then re-evaluate.",
      clears: "DEVICE_NONCOMPLIANT",
    },
    {
      reasonCode: "POSTURE_STALE",
      resolutionClass: "auto_proposed",
      action: "Request a posture re-sync from the device-management source, then re-evaluate.",
      clears: "POSTURE_STALE",
    },
    {
      // Two steps clearing ONE code — the dedup path, and the reason clearsReasonCodes
      // is not just items.map(...).
      reasonCode: "POSTURE_STALE",
      resolutionClass: "manual_only",
      action: "Hand the device to IT if it never checks in.",
      clears: "POSTURE_STALE",
    },
  ],
  unresolvedCodes: ["CUSTODY_EXCEPTION", "CUSTODY_EXCEPTION"],
};

const TARGET: ChangeDraftTarget = { kind: "device", ref: "dev-9f21" };

const verdict = (posture: ChangeWindowPosture, authorized: boolean): ChangeWindowVerdict => ({
  changeRef: "CHG0041882",
  posture,
  reasonCode: authorized ? "CHANGE_AUTHORIZED" : "OUTSIDE_CHANGE_WINDOW",
  recommendedAction: authorized ? "none" : "step_up",
  criticalFindings: [],
  unknownSignals: [],
  changeAuthorized: authorized,
});

const POSTURES: ChangeWindowPosture[] = [
  "change_authorized",
  "outside_change_window",
  "change_unapproved",
  "change_refused",
  "change_record_closed",
  "actor_unauthorized",
  "change_record_stale",
  "change_unverified",
];

// ── the safety invariants every draft must satisfy, in one reusable place ───────
const FORBIDDEN_KEYS = ["approved", "executed", "autoApprove", "authorized", "preApproved"];

function safetyViolations(draft: ChangeRequestDraft): string[] {
  const v: string[] = [];
  if (draft.status !== "requires_approval") v.push(`status is "${String(draft.status)}"`);
  if (draft.approvalRequired !== true) v.push("approvalRequired is not true");
  if (draft.simulatedOnly !== true) v.push("simulatedOnly is not true");
  for (const key of Object.keys(draft)) {
    if (FORBIDDEN_KEYS.includes(key)) v.push(`draft carries a "${key}" field`);
  }
  for (const key of Object.keys(changeDraftPayload(draft))) {
    if (FORBIDDEN_KEYS.includes(key)) v.push(`payload carries a "${key}" field`);
  }
  return v;
}

// ── 1. determinism and totality ────────────────────────────────────────────────
const base = draftChangeRequest(PLAN, TARGET);
check(
  "the same plan and target draft byte-identical requests",
  JSON.stringify(draftChangeRequest(PLAN, TARGET)) === JSON.stringify(base),
);
const empty = draftChangeRequest({ decisionId: "dec-0", steps: [], unresolvedCodes: [] }, TARGET);
check("an empty plan drafts rather than throwing", empty.items.length === 0);
check(
  "an empty plan says plainly that it clears nothing",
  empty.justification.startsWith("Would clear no reason code"),
);
check("a one-step plan is singular in its summary", draftChangeRequest({ ...PLAN, steps: [PLAN.steps[0]!] }, TARGET).summary.includes("1 proposed change on"));
check("a three-step plan is plural in its summary", base.summary.includes("3 proposed changes on"));

// ── 2. the draft says what would change, where, why, and what it clears ─────────
check("every plan step becomes one draft item", base.items.length === PLAN.steps.length);
check("items are ordered from 1", base.items.every((item, i) => item.order === i + 1));
check("actions are carried verbatim — this module writes no remedy of its own", base.items.every((item, i) => item.action === PLAN.steps[i]!.action));
check("the target is carried whole", base.target.kind === "device" && base.target.ref === "dev-9f21");
check("cleared reason codes are deduplicated in plan order", JSON.stringify(base.clearsReasonCodes) === JSON.stringify(["DEVICE_NONCOMPLIANT", "POSTURE_STALE"]));
check("the justification names the codes it would clear", base.justification.includes("DEVICE_NONCOMPLIANT") && base.justification.includes("POSTURE_STALE"));
check(
  "codes the plan could NOT answer are carried, so the draft never reads as a complete remedy",
  JSON.stringify(base.unresolvedReasonCodes) === JSON.stringify(["CUSTODY_EXCEPTION"]),
);

// ── 3. the id is a digest of the inputs ────────────────────────────────────────
check("the id is stable across identical inputs", draftChangeRequest(PLAN, TARGET).id === base.id);
check("a different target is a different draft", draftChangeRequest(PLAN, { kind: "device", ref: "dev-OTHER" }).id !== base.id);
check("a different target KIND is a different draft", draftChangeRequest(PLAN, { kind: "policy", ref: "dev-9f21" }).id !== base.id);
check("a different decision is a different draft", draftChangeRequest({ ...PLAN, decisionId: "dec-OTHER" }, TARGET).id !== base.id);
check("a changed step action is a different draft", draftChangeRequest({ ...PLAN, steps: [{ ...PLAN.steps[0]!, action: "something else" }, ...PLAN.steps.slice(1)] }, TARGET).id !== base.id);
check("a changed unresolved list is a different draft", draftChangeRequest({ ...PLAN, unresolvedCodes: [] }, TARGET).id !== base.id);

// ── 4. RULE 1 — no draft is ever pre-approved ──────────────────────────────────
const allDrafts: ChangeRequestDraft[] = [
  base,
  empty,
  ...POSTURES.map((p) => draftChangeRequest(PLAN, TARGET, verdict(p, p === "change_authorized"))),
  withChangeClass(base, "emergency"),
  withChangeClass(base, null),
];
const violations = allDrafts.flatMap(safetyViolations);
check(
  `every draft (${allDrafts.length} of them) is requires_approval, approval-required and simulated-only`,
  violations.length === 0,
);
if (violations.length > 0) console.log(`    violations: ${violations.join("; ")}`);

// ── 5. RULE 2 — an approved change window relaxes NOTHING ──────────────────────
const withoutRecord = JSON.stringify({ ...base, changeWindowEvidence: null });
const relaxed: string[] = [];
for (const posture of POSTURES) {
  const d = draftChangeRequest(PLAN, TARGET, verdict(posture, posture === "change_authorized"));
  if (JSON.stringify({ ...d, changeWindowEvidence: null }) !== withoutRecord) relaxed.push(posture);
}
check(
  `all ${POSTURES.length} change-window postures draft identically to no record at all, evidence field aside`,
  relaxed.length === 0,
);
if (relaxed.length > 0) console.log(`    postures that changed the draft: ${relaxed.join(", ")}`);
check(
  "an AUTHORIZED window does not shorten the draft or drop a step",
  draftChangeRequest(PLAN, TARGET, verdict("change_authorized", true)).items.length === base.items.length,
);
check(
  "the evidence IS carried for the human approving it",
  draftChangeRequest(PLAN, TARGET, verdict("change_refused", false))!.changeWindowEvidence?.posture === "change_refused",
);

// ── 6. RULE 3 — absence is recorded as absence, and is not a weaker draft ──────
check("an absent change plane records absence, not silence", base.changeWindowEvidence === null);
check(
  "a draft with no change record is no easier than one with an approved record",
  JSON.stringify({ ...base, changeWindowEvidence: null }) ===
    JSON.stringify({ ...draftChangeRequest(PLAN, TARGET, verdict("change_authorized", true)), changeWindowEvidence: null }),
);

// ── 7. changeClass is carried and never graded ─────────────────────────────────
check(
  "changeClass cannot reach the drafting path at all — it is null whatever the verdict said",
  POSTURES.every((p) => draftChangeRequest(PLAN, TARGET, verdict(p, false)).changeClass === null),
);
const emergency = withChangeClass(base, "emergency");
const standard = withChangeClass(base, "standard");
check(
  '"emergency" drafts exactly what "standard" drafts, apart from the class and its digest',
  JSON.stringify({ ...emergency, changeClass: null, id: "" }) === JSON.stringify({ ...standard, changeClass: null, id: "" }),
);
check("the class reaches the wire as evidence", changeDraftPayload(emergency).changeClass === "emergency");
check("a class-bearing draft is still requires_approval", emergency.status === "requires_approval");

// ── 8. the gate — all four refusals, and the two transport outcomes ────────────
const FULL = { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", ITSM_EMITTER_TOKEN: "t" };
const live: (payload: unknown) => Promise<void> = async () => {};

const gateCases: [string, NodeJS.ProcessEnv, string][] = [
  ["dev tier never opens a change record", {}, 'tier "dev" never makes live vendor calls'],
  ["alpha tier never opens a change record", { SIGNALGRID_TIER: "alpha" }, 'tier "alpha" never makes live vendor calls'],
  ["the live flag must be exactly true", { ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "1" }, "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'"],
  ["a blank token is an absent token", { ...FULL, ITSM_EMITTER_TOKEN: "   " }, "ITSM_EMITTER_TOKEN is not set"],
];
for (const [name, env, reason] of gateCases) {
  const r = await submitChangeDraft(base, env);
  check(name, r.status === "withheld" && r.reason === reason);
}
const noTransport = await submitChangeDraft(base, FULL);
check(
  "tier, flag and token all green but no injected transport still withholds",
  noTransport.status === "withheld" && noTransport.reason.includes("no itsm delivery transport is available"),
);
check(
  "a withheld draft carries what WOULD have gone out, marked as the draft it is",
  noTransport.status === "withheld" && noTransport.recorded["kind"] === "change_request_draft" && noTransport.recorded["status"] === "requires_approval",
);

let delivered: unknown = null;
const submitted = await submitChangeDraft(base, FULL, async (p) => { delivered = p; });
check("an injected transport opens the change record", submitted.status === "submitted");
check("SUBMITTING IS NOT APPROVING — the draft comes back requires_approval", submitted.draft.status === "requires_approval");
check("the payload that went out is the draft's payload", JSON.stringify(delivered) === JSON.stringify(changeDraftPayload(base)));

const threw = await submitChangeDraft(base, FULL, async () => { throw new Error("ITSM 503"); });
check("a transport that throws is never reported as submitted", threw.status === "not_submitted");
check("the refusal names its cause", threw.status === "not_submitted" && threw.reason.includes("ITSM 503"));
check("a refused draft is unchanged and still requires_approval", threw.draft.id === base.id && threw.draft.status === "requires_approval");
check("a non-Error throw is still a named refusal", (await submitChangeDraft(base, FULL, async () => { throw "socket hang up"; })).status === "not_submitted");

// ── 9. SELF-TEST — the control on safetyViolations() ───────────────────────────
// Checks 4 and 8 are only worth their green if this function can go red. Each
// planted defect is a shape someone could plausibly introduce: a status flipped to
// an approval, a literal-true field set false, and an extra key that hands the
// draft its own authorization.
console.log("  -- self-test (deliberately broken drafts) --");
let selfPassed = 0;
const selfCases: [string, ChangeRequestDraft][] = [
  ["a draft that approved itself", { ...base, status: "approved" } as unknown as ChangeRequestDraft],
  ["a draft that dropped approvalRequired", { ...base, approvalRequired: false } as unknown as ChangeRequestDraft],
  ["a draft carrying an approved field", { ...base, approved: true } as unknown as ChangeRequestDraft],
];
for (const [name, broken] of selfCases) {
  const caught = safetyViolations(broken).length > 0;
  if (caught) selfPassed += 1;
  console.log(`  ${caught ? "ok" : "FAIL"} — self-test catches ${name}`);
  if (!caught) failures.push(`self-test: ${name} not caught`);
}
check(`the safety check is falsifiable (${selfPassed}/${selfCases.length} planted defects caught)`, selfPassed === selfCases.length);

const total = passed + failures.length;
console.log(`figures=postures=${POSTURES.length},draftsChecked=${allDrafts.length},gateRefusals=${gateCases.length + 1},selfTests=${selfCases.length}`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }

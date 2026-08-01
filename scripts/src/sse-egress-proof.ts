// SSE-egress proof — fully OFFLINE and deterministic.
//
// The dimension: is this device's internet/SaaS traffic actually traversing the
// deployment's MANDATED edge, or is the client bypassed, disabled, or never
// installed while every console still reads "protected"? network-nac stops at
// LAN admission and edr-threat grades the endpoint agent; this is the same
// blind-spot doctrine on the egress plane.
//
// Laws pinned here:
//  - PROTECTED is earned: posed mandate + clean report + bridge affirmed +
//    client tunneled + the edge AFFIRMATIVELY observing this device's traffic.
//  - A tunneled claim the service contradicts (observing=false) is a
//    contradiction, never a grant; one the service cannot confirm (null) is an
//    unknown that raises.
//  - Disabled and never-installed are AFFIRMATIVE operator-scale defects
//    (alert); bypassed is visible and steps up (a bypass rule can be policy);
//    unknown state on a mandated path steps up (never trust silence).
//  - Unposed forecloses nothing (day-one quiet).
//  - The full standing space is enumerated: protected in EXACTLY one cell.

import {
  SseEgressConnector,
  SseEgressConnectorError,
  createMockSseEgressTransport,
  evaluateSseEgress,
  guardReadOnly,
  normalizeSseEgressReport,
  resolveSseEgressConnector,
  type SseEgressReportRaw,
} from "@workspace/integrations/sse-egress";
import { composeDeviceRisk, fromSseEgress } from "@workspace/posture-composition";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("SSE-egress (mandated edge path) proof");

const report = (client_state: unknown, observing: unknown = true, bridge: unknown = true): SseEgressReportRaw => ({
  client_state,
  service_observing_traffic: observing,
  bridge_reachable: bridge,
});
const norm = (r: SseEgressReportRaw) => normalizeSseEgressReport("dev-1", r);
const MANDATED = { egressMandated: true } as const;

// ── the grant is earned ─────────────────────────────────────────────────────────
const protectedV = evaluateSseEgress(norm(report("tunneled")), MANDATED);
check("mandated + tunneled + edge observing + bridge affirmed → egress_protected/none, egressProtected", protectedV.posture === "egress_protected" && protectedV.reasonCode === "EGRESS_PROTECTED" && protectedV.recommendedAction === "none" && protectedV.egressProtected === true);
check("a protected device composes to the 'ok' tier", composeDeviceRisk([fromSseEgress(protectedV)]).riskTier === "ok");

// ── a tunneled claim is corroborated, never believed ────────────────────────────
const contradicted = evaluateSseEgress(norm(report("tunneled", false)), MANDATED);
check("a tunneled claim the service CONTRADICTS (observing=false) → TUNNEL_UNCORROBORATED/step_up + critical, never a grant", contradicted.reasonCode === "TUNNEL_UNCORROBORATED" && contradicted.recommendedAction === "step_up" && contradicted.egressProtected === false && contradicted.criticalFindings.includes("tunneled_claim_contradicted_by_service"));
const unconfirmed = evaluateSseEgress(norm(report("tunneled", null)), MANDATED);
check("a tunneled claim the service cannot confirm (null) → EGRESS_STATE_UNKNOWN/step_up (a tunnel the edge cannot see is not a tunnel)", unconfirmed.reasonCode === "EGRESS_STATE_UNKNOWN" && unconfirmed.recommendedAction === "step_up" && unconfirmed.unknownSignals.includes("service_observing_traffic"));

// ── the affirmative defects and the visible bypass ──────────────────────────────
const bypassed = evaluateSseEgress(norm(report("bypassed")), MANDATED);
check("bypassed under a mandate → egress_bypassed/step_up — visible, never a lockout (a bypass rule can be deliberate policy)", bypassed.posture === "egress_bypassed" && bypassed.recommendedAction === "step_up" && bypassed.egressProtected === false);
const disabled = evaluateSseEgress(norm(report("disabled")), MANDATED);
check("disabled → egress_disabled/ALERT + critical (protection affirmatively OFF is operator-scale)", disabled.posture === "egress_disabled" && disabled.recommendedAction === "alert" && disabled.criticalFindings.includes("egress_protection_disabled"));
const missing = evaluateSseEgress(norm(report("not_installed")), MANDATED);
check("never installed → egress_unprovisioned/ALERT (the setup-bypassed precedent: a provisioning hole)", missing.posture === "egress_unprovisioned" && missing.recommendedAction === "alert" && missing.criticalFindings.includes("egress_client_not_installed"));
check("neither defect composes to the 'ok' tier", composeDeviceRisk([fromSseEgress(disabled)]).riskTier !== "ok" && composeDeviceRisk([fromSseEgress(missing)]).riskTier !== "ok");

// ── unposed forecloses nothing ──────────────────────────────────────────────────
const unposed = evaluateSseEgress(norm(report("disabled")));
check("UNPOSED (no mandate stated) → unassessed/none, quiet — a device outside the mandate is never nagged, and nothing is affirmed", unposed.posture === "unassessed" && unposed.reasonCode === "EGRESS_UNPOSED" && unposed.recommendedAction === "none" && unposed.egressProtected === false);
check("an explicit egressMandated:false is the same unposed quiet", evaluateSseEgress(norm(report("tunneled")), { egressMandated: false }).posture === "unassessed");

// ── silence, outages, and unreadable evidence never grade protected ─────────────
check("unknown client state under a mandate → step_up (never trust silence)", evaluateSseEgress(norm(report(null)), MANDATED).reasonCode === "EGRESS_STATE_UNKNOWN");
check("bridge unreported (null) → BRIDGE_UNREACHABLE/step_up, never protected", evaluateSseEgress(norm(report("tunneled", true, null)), MANDATED).reasonCode === "BRIDGE_UNREACHABLE");
check("bridge explicitly down → BRIDGE_UNREACHABLE/step_up", evaluateSseEgress(norm(report("tunneled", true, false)), MANDATED).reasonCode === "BRIDGE_UNREACHABLE");
const uncovered = evaluateSseEgress(norm({}), { covered: false, egressMandated: true });
check("no egress record for a mandated device → unknown/NOT_COVERED/step_up", uncovered.posture === "unknown" && uncovered.reasonCode === "NOT_COVERED" && uncovered.recommendedAction === "step_up");

check("a garbled client state normalizes to unknown AND flags the report malformed", (() => {
  const n = norm(report("totally tunneled!!"));
  return n.clientState === "unknown" && n.reportIntegrity === "malformed";
})());
check("a malformed report never grades protected even when its readable half looks perfect", (() => {
  const n = normalizeSseEgressReport("d", { client_state: "tunneled", service_observing_traffic: true, bridge_reachable: true, extra: 1 } as SseEgressReportRaw);
  const v = evaluateSseEgress(n, MANDATED);
  return n.reportIntegrity === "malformed" && v.reasonCode === "REPORT_MALFORMED" && v.egressProtected === false;
})());
check("a NON-OBJECT report (null) is malformed — not a quietly-empty clean read", normalizeSseEgressReport("d", null as unknown as SseEgressReportRaw).reportIntegrity === "malformed");
check("a non-boolean observation/bridge assertion is malformed, never coerced", norm({ client_state: "tunneled", service_observing_traffic: "yes", bridge_reachable: true }).reportIntegrity === "malformed");
check("a hostile report whose key enumeration THROWS (Proxy ownKeys trap) is malformed, never trusted", (() => {
  const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
  return normalizeSseEgressReport("d", hostile as SseEgressReportRaw).reportIntegrity === "malformed";
})());
check("an absent report body is CLEAN and all-unknown — absence is not corruption, and it still cannot grant", (() => {
  const n = norm({});
  return n.reportIntegrity === "clean" && n.clientState === "unknown" && evaluateSseEgress(n, MANDATED).egressProtected === false;
})());

// ── exhaustive: the full standing space, both poses ─────────────────────────────
// clientState (5) × observing (3) × bridge (3) = 45 cells per pose. Mandated:
// protected in EXACTLY the tunneled/true/true cell; alerts exactly for
// disabled/not_installed with a clean bridge path; nothing below step_up
// otherwise. Unposed: every cell is the unassessed quiet.
const states = ["tunneled", "bypassed", "disabled", "not_installed", null] as const;
const tri = [true, false, null] as const;
let combos = 0;
let grants = 0;
let mismatches = 0;
for (const cs of states) for (const obs of tri) for (const br of tri) {
  combos += 1;
  const n = norm(report(cs, obs, br));
  const mand = evaluateSseEgress(n, MANDATED);
  const expectProtected = cs === "tunneled" && obs === true && br === true;
  if (mand.egressProtected) grants += 1;
  if (mand.egressProtected !== expectProtected) mismatches += 1;
  if (mand.recommendedAction === "none" && !expectProtected) mismatches += 1;
  const quiet = evaluateSseEgress(n);
  if (quiet.posture !== "unassessed" || quiet.egressProtected) mismatches += 1;
}
check(`exhaustive: over all ${combos} standings, protected is EXACTLY the tunneled+observed+affirmed cell and unposed is always quiet (grants=${grants}, mismatches=${mismatches})`, combos === 45 && grants === 1 && mismatches === 0);

// ── determinism, fusion, connector guarantees, and the gate ─────────────────────
const detN = norm(report("bypassed"));
check("evaluator is deterministic", JSON.stringify(evaluateSseEgress(detN, MANDATED)) === JSON.stringify(evaluateSseEgress(detN, MANDATED)));
check("fromSseEgress emits an sse_egress signal", fromSseEgress(protectedV).kind === "sse_egress");

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof SseEgressConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const transport = createMockSseEgressTransport({ reports: { "dev-1": report("tunneled") } });
const connector = new SseEgressConnector({ accessToken: "t", baseUrl: "https://sse.local/x" }, transport);
const fetched = await connector.fetchNormalized("dev-1");
check("the connector normalizes through the same defensive path", fetched.clientState === "tunneled" && fetched.reportIntegrity === "clean");
check("an unknown device yields an all-unknown report that never grades protected", evaluateSseEgress(await connector.fetchNormalized("ghost"), MANDATED).egressProtected === false);

check("dev tier resolves to fixture mode", resolveSseEgressConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveSseEgressConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveSseEgressConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveSseEgressConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", SSE_EGRESS_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }

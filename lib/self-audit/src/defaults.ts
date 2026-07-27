// The DEFAULT CHECKLIST for THIS system: the real set of things that should be true
// across SignalGrid's backend, frontend, and connected systems, each tied to a probe
// key a runner can answer from an existing gate/proof outcome.
//
// This is the checklist an administrator's health screen is built from. It is kept
// deliberately small and legible — one item per load-bearing guarantee, not one per
// test — and every item `covers` the live-sync manifest dimension(s) it verifies, so
// `deriveChecklist` can flag any contract dimension this list forgets. The list and
// the manifest keep each other honest.

import type { DeclaredItem } from "./checklist";

/** The load-bearing checklist for the fabric. Probe keys name the gate/proof whose
 *  outcome answers the item; a runner maps real results onto them (all-healthy in the
 *  public demo fixture). `covers` ties each item to the manifest dimension it guards. */
export const DEFAULT_CHECKLIST: readonly DeclaredItem[] = Object.freeze([
  // ── backend: the decision service ────────────────────────────────────────────
  {
    id: "backend-decision-fail-closed",
    layer: "backend",
    description: "The decision service returns a fail-closed verdict for every request.",
    probeKey: "proof:api-contract",
    healable: true,
    remediationHint:
      "Re-run the API contract proof; if a route drifted, restore it and its neighbors, then redeploy the decision service.",
    covers: ["signalKinds", "contract"],
  },
  {
    id: "backend-worst-concern-wins",
    layer: "backend",
    description: "Fused signals resolve worst-concern-wins, so no weak signal can grant access.",
    probeKey: "proof:posture-composition",
    healable: true,
    remediationHint:
      "Re-run the posture-composition proof; a weak-posture-grants-allow result is a hard stop until the fusion rule is restored.",
    covers: ["signalCategories"],
  },
  // ── frontend: the screens people use ─────────────────────────────────────────
  {
    id: "frontend-consoles-live",
    layer: "frontend",
    description: "Every operator screen renders against a real decision, not a canned one.",
    probeKey: "e2e:consoles",
    healable: true,
    remediationHint:
      "Re-run the browser screen sweep; repair the screen that stopped showing live decisions.",
    covers: ["consumers"],
  },
  // ── api integrations: the connected systems ──────────────────────────────────
  {
    id: "api-connectors-fail-closed",
    layer: "api_integration",
    description: "Every connected system normalizes fail-closed — unknown posture raises concern, never lowers it.",
    probeKey: "proof:connectors",
    healable: true,
    remediationHint:
      "Re-run the connector proofs; a connector that grants on unknown/weak posture is disabled until fixed.",
    covers: ["mcpTools"],
  },
  {
    id: "api-task-exception-routing",
    layer: "api_integration",
    description: "Task-plane exceptions route to the correct operations team.",
    probeKey: "proof:task-exception",
    healable: false, // where an exception routes is a policy choice, not a mechanical repair
    remediationHint: "",
    covers: ["taskExceptionReasonCodes"],
  },
  {
    id: "api-handoff-release-law",
    layer: "api_integration",
    description: "A held task is released only after every release condition is independently met.",
    probeKey: "proof:handoff-sim",
    healable: true,
    remediationHint:
      "Re-run the handoff-release proof; restore the release law so a held task cannot be released on a single unverified signal.",
    covers: ["handoffSimRefusalCodes"],
  },
]);

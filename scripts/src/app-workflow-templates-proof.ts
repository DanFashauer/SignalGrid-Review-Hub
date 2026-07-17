// Proof: per-integration workflow templates + validation lint
// (@workspace/app-workflows).
//
//   • every starter template lints clean and spans all six verticals;
//   • the shipping catalog itself passes the linter (the lint is not vacuous);
//   • the linter FAILS CLOSED on unsafe integrations — a critical action that
//     isn't sensitive/gated, a sensitive-but-ungated action, an empty
//     workflowKey, an empty action list, an unknown vertical, and duplicate
//     keys/ids are all rejected as errors;
//   • warnings (convention, no visible read) never block;
//   • the linter is pure/deterministic and a cloned template is safe to mutate.
//
// Run: pnpm --filter @workspace/scripts run proof:app-workflow-templates

import {
  APP_INTEGRATIONS,
  APP_VERTICALS,
  lintAppIntegration,
  lintAppIntegrations,
  catalogLintsClean,
  starterTemplate,
  STARTER_TEMPLATES,
  type AppIntegration,
} from "@workspace/app-workflows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const hasError = (c: AppIntegration, code: string) =>
  lintAppIntegration(c).errors.some((e) => e.code === code);

// ── starter templates are valid and complete ──────────────────────────────────
check("a template exists for every vertical", APP_VERTICALS.every((v) => !!STARTER_TEMPLATES[v]));
check("every starter template lints clean", APP_VERTICALS.every((v) => lintAppIntegration(STARTER_TEMPLATES[v]).ok));
check("templates carry a visible read + an elevated + a critical action", APP_VERTICALS.every((v) => {
  const a = STARTER_TEMPLATES[v].actions;
  return a.some((x) => x.riskTier === "standard" && !x.gatedByStepUp)
    && a.some((x) => x.riskTier === "elevated")
    && a.some((x) => x.riskTier === "critical" && x.sensitive && x.gatedByStepUp);
}));
check("starterTemplate returns a deep copy (safe to mutate)", (() => {
  const t = starterTemplate("healthcare");
  t.actions[0].label = "changed";
  return STARTER_TEMPLATES.healthcare.actions[0].label !== "changed";
})());

// ── the lint is not vacuous: the real catalog passes it ───────────────────────
check("shipping catalog lints clean", catalogLintsClean([...APP_INTEGRATIONS]));
check("catalog lint returns one result per integration", lintAppIntegrations([...APP_INTEGRATIONS]).length === APP_INTEGRATIONS.length);

// A helper to build a base-valid candidate we then break one field at a time.
const valid = (): AppIntegration => starterTemplate("data_center");
check("baseline candidate is valid", lintAppIntegration(valid()).ok);

// ── FAIL CLOSED on unsafe integrations ────────────────────────────────────────
check("critical action must be sensitive", hasError(
  { ...valid(), actions: [{ key: "x.commit", label: "x", riskTier: "critical", sensitive: false, gatedByStepUp: true }] },
  "critical-not-sensitive"));

check("critical action must be gated", hasError(
  { ...valid(), actions: [{ key: "x.commit", label: "x", riskTier: "critical", sensitive: true, gatedByStepUp: false }] },
  "critical-not-gated"));

check("sensitive action must be gated", hasError(
  { ...valid(), actions: [{ key: "x.write", label: "x", riskTier: "elevated", sensitive: true, gatedByStepUp: false }] },
  "sensitive-not-gated"));

check("empty workflowKey is rejected", hasError({ ...valid(), workflowKey: "" }, "workflow-key-empty"));
check("empty action list is rejected", hasError({ ...valid(), actions: [] }, "no-actions"));
check("unknown vertical is rejected", hasError({ ...valid(), vertical: "aviation" as AppIntegration["vertical"] }, "vertical-unknown"));
check("empty id is rejected", hasError({ ...valid(), id: "" }, "id-empty"));
check("empty name is rejected", hasError({ ...valid(), name: "" }, "name-empty"));

check("duplicate action keys are rejected", hasError(
  { ...valid(), actions: [
    { key: "dup.key", label: "a", riskTier: "standard", sensitive: false, gatedByStepUp: false },
    { key: "dup.key", label: "b", riskTier: "standard", sensitive: false, gatedByStepUp: false },
  ] },
  "action-key-duplicate"));

check("duplicate integration ids are rejected across a catalog", (() => {
  const dup = { ...valid(), id: "same-id" };
  const results = lintAppIntegrations([dup, { ...valid(), id: "same-id" }]);
  return results.every((r) => !r.ok) && results.some((r) => r.errors.some((e) => e.code === "id-duplicate"));
})());

// ── warnings never block ──────────────────────────────────────────────────────
check("non-dotted key warns but does not block", (() => {
  const r = lintAppIntegration({ ...valid(), actions: [
    { key: "flatkey", label: "x", riskTier: "standard", sensitive: false, gatedByStepUp: false },
  ] });
  return r.ok && r.warnings.some((w) => w.code === "action-key-convention");
})());

check("no visible read warns but does not block", (() => {
  const r = lintAppIntegration({ ...valid(), actions: [
    { key: "x.write", label: "x", riskTier: "elevated", sensitive: false, gatedByStepUp: true },
  ] });
  return r.ok && r.warnings.some((w) => w.code === "no-visible-read");
})());

// ── determinism ───────────────────────────────────────────────────────────────
check("lint is deterministic", (() => {
  const c = valid();
  return JSON.stringify(lintAppIntegration(c)) === JSON.stringify(lintAppIntegration(c));
})());

const total = passed + failures.length;
console.log(`app-workflow-templates proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Starter templates lint clean; the linter fails closed on unsafe integrations and the shipping catalog passes it.");

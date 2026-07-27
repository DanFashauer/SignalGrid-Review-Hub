// @workspace/self-audit — a self-aware, self-healing checklist over the fabric's
// backend, frontend, and API-integration contracts.
//
//   derive → run (fail-closed) → propose heals (governed) → approve → apply
//
// Self-aware: the checklist is derived from the live-sync contract inventory and
// reports its own coverage gaps as findings (a blind spot is not a green check).
// Self-healing: a broken item proposes a described fix that cannot apply itself —
// application requires a human approver ref, exactly as adaptive-proposals governs
// a policy change. Deterministic, deep-frozen, fail-closed throughout.

export * from "./types";
export { deriveChecklist, type ContractInventory, type DeclaredItem } from "./checklist";
export { runAudit, type ProbeResult } from "./audit";
export { proposeHeals, approveHeal, applyHeal, rejectHeal, LEGAL_TRANSITIONS } from "./heal";

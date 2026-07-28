// @workspace/adaptive-proposals — the GOVERNED LIFECYCLE around a recommendation.
//
// Issue #136, acceptance criterion 6: at least one adaptive recommendation generated
// from synthetic event history, simulated, and left pending owner approval. This is the
// governance loop AROUND recommendations, not a recommendations engine (that already
// exists as `@workspace/recommendations`). The eight-step loop from
// `docs/VISION_PERSON_FIRST_GRID.md` — observe → correlate → explain → recommend →
// simulate → require owner approval → version & activate → measure — enforced as a
// state machine whose one core invariant is structural: a proposal cannot activate
// itself; approval is a required human gate.
//
// Descriptive, never permissive: a proposal DESCRIBES a change as data — it is never a
// mechanism that applies one. Deterministic and fixture-backed: no live audit data, no
// autonomous activation, ever.
export * from "./types";
export * from "./observe";
export * from "./simulate";
export * from "./measure";
export {
  LEGAL_TRANSITIONS,
  isLegalTransition,
  requestApproval,
  approve,
  activate,
  reject,
  supersede,
  assertLegalTransition,
} from "./lifecycle";

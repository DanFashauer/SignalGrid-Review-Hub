// itsm emitter family — public surface.
//
// The live-call gate in ./resolve is the canonical entry: nothing leaves this
// family without passing it, and this repository ships no live transport, so in
// this tree the resolved mode is always fixture. The vendor modules below are
// the formatting/adapter half — kept exported for the live path a private
// deployment would inject.
export * from "./resolve";
export * from "./adapter";
export * from "./change-draft";
// Cascade join 1 (DR-042): the pure Incident → ticket-request mapper and the
// dispatch seam that routes it through the emission gate. Fail-closed at every
// step; in this tree the gate always resolves suppressed and the result says so.
export * from "./dispatch";

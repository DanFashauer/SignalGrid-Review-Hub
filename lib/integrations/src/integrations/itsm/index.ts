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
// Cascade join 1 (DR-042) — the Incident → ticket-request mapper and the dispatch
// seam — lives in @workspace/incident-playbook, ABOVE this family: it reads the
// incident type, and this package must not depend on the incident layer, which
// already depends on this one through posture-composition (a cycle pnpm links
// into node_modules as an infinite symlink loop; #819's Mac run found it as
// ENAMETOOLONG). Import it from there.

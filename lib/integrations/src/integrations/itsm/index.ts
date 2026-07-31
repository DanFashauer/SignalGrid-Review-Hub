// itsm emitter family — public surface.
//
// The live-call gate in ./resolve is the canonical entry: nothing leaves this
// family without passing it, and this repository ships no live transport, so in
// this tree the resolved mode is always fixture. The vendor modules below are
// the formatting/adapter half — kept exported for the live path a private
// deployment would inject.
export * from "./resolve";
export * from "./adapter";

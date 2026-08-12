// CAEP / Shared Signals emitter family — public surface.
//
// The live-call gate in ./resolve is the canonical entry: nothing leaves this
// family without passing it, and this repository ships no live transport (and
// no signing keys), so in this tree the resolved mode is always fixture. The
// formatter in ./format is the pure half — an UNSIGNED SET claims set, never
// a string that could be mistaken for a signed token.
export * from "./format";
export * from "./resolve";

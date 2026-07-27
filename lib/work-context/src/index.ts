// @workspace/work-context — Issue #136's portable work context: the schema that
// carries a verified person's WORK between authorized devices (workflow, tasks,
// held tasks, unresolved exceptions, situation, carried trust floor) while trust is
// re-evaluated per device through the fabric's real composition. Descriptive, never
// permissive: every ref is an opaque handle, credential-smelling values are refused
// at assembly, continuity never widens a decision, the carried ceiling never lowers
// by movement, and exceptions travel until explicitly resolved with a receipt.
export * from "./types";
export * from "./assemble";
export * from "./reevaluate";

// @workspace/facility-trust-graph — phase 1 of the spatial-trust subsystem
// (docs/FACILITY_TRUST_GRAPH.md, intake row 16).
//
// Two pieces, both pure and offline:
//  - the FACILITY TRUST GRAPH: canonical versioned space hierarchy with
//    permanent spaceIds and vendor identifiers as attachments, never keys;
//  - the LOCATION-CERTAINTY dimension: one normalized observation graded
//    against the precision a workflow requires, fail-closed, no clock in the
//    decision path.
//
// No vendor is called from this package. Cisco Spaces / RTLS / access-control
// adapters are roadmap and will live behind connector discipline like every
// other family.

export * from "./graph";
export * from "./evaluate";
export * from "./correlate";
export * from "./clinical";
export * from "./transition";
export * from "./fixture";

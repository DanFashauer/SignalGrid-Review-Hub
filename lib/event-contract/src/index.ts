// @workspace/event-contract — the SignalGrid canonical event contract: the one
// normalized event shape every plane emits, a fail-closed validator for untrusted
// inbound events, and the deterministic cross-domain detections a shared event
// fabric makes possible. Pure and dependency-free.
export * from "./types";
export * from "./validate";
export * from "./detect";

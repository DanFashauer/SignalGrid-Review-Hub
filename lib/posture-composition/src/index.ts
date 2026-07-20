// @workspace/posture-composition — fuse the decision signals (device posture,
// reachability, location, vulnerability, network/NAC, EDR/EPP threat-state,
// cross-domain detections) into one unified device risk posture + the strongest
// action any signal warrants. Pure and deterministic.
export * from "./types";
export * from "./compose";
export * from "./adapters";

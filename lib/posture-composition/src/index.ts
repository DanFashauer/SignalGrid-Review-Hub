// @workspace/posture-composition — fuse the decision signals (device posture,
// reachability, location, vulnerability, network/NAC, EDR/EPP threat-state,
// identity/SSO sign-in risk, RTLS physical custody, removable-media / peripheral
// control, cross-domain detections) into one unified device risk posture + the
// strongest action any signal warrants. Pure and deterministic.
export * from "./types";
export * from "./compose";
export * from "./adapters";

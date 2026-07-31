// telemetry emitter family — public surface (both lanes merged).
//
// The live-call gate in ./resolve is the canonical entry: nothing leaves this
// family without passing it, and this repository ships no live transport, so in
// this tree the resolved mode is always fixture. The vendor modules below are
// the formatting/adapter half — kept exported for the live path a private
// deployment would inject; ./types and the config store are the Mac lane's
// FleetDM read surface.
export * from "./resolve";
export * from "./types";
export * from "./fleetdm";
export { getFleetDMConfig, setFleetDMConfig, getTelemetryConfig, setTelemetryConfig } from "./store";

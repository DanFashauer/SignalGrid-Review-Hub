// @workspace/location — vendor-neutral presence/coarse/precise location signals
// (privacy-first: presence by default), ported from the SignalGrid product build.
// Fed from MDM/NAC/RTLS/BLE; emitted as signed asset.location.observed events.
export * as types from "./types";
export * as config from "./config";
export * as store from "./store";
export * as validate from "./validate";
export * as radiusDhcp from "./radius-dhcp";

// Public-safe discovery fixture: a few connected sources and the raw signal
// types observed from each — a spread of recognised, candidate, and novel, with
// some sources that can be auto-pulled (API/connector) and one that cannot.

import type { DiscoverySource, ObservedSignal } from "./index";

export const DEMO_SOURCES: DiscoverySource[] = [
  { id: "entra-intune", name: "Entra + Intune", hasApi: true, pullMethod: "api" },
  { id: "edr-sensor", name: "EDR sensor", hasApi: true, pullMethod: "api" },
  { id: "telematics-hub", name: "Telematics hub", hasApi: true, pullMethod: "connector" },
  { id: "legacy-bms", name: "Legacy building-management system", hasApi: false, pullMethod: "manual" },
];

export const DEMO_OBSERVED: ObservedSignal[] = [
  // Recognised — already active grid signals.
  { category: "identity_state", sourceId: "entra-intune" },
  { category: "device_compliance", sourceId: "entra-intune" },
  // Candidate from an API source → auto-onboardable.
  { category: "network_posture", sourceId: "edr-sensor" },
  // Novel from a connector source → auto-onboardable.
  { category: "vehicle_telemetry", sourceId: "telematics-hub" },
  // Candidate + novel from a no-API source → need an admin to wire.
  { category: "environment_state", sourceId: "legacy-bms" },
  { category: "coolant_pressure", sourceId: "legacy-bms" },
];

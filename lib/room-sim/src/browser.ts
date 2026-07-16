// Browser entry for the fully client-side Trusted Room Entry console.
//
// Bundled (esbuild, platform=browser) and inlined into a single self-contained
// HTML file, this runs the ENTIRE decision core + orchestration in the browser
// — no server, no network, no Docker. It works in Safari on an iPhone or iPad.
// The core is deterministic and dependency-free (FNV-1a digest, injected clock),
// so the in-browser result is identical to the hosted API's.

import { SignalGridCore } from "@workspace/signalgrid-core";
import { listScenarios, runRoomEntry, tenantForScenario, type RoomEntryOptions, type RoomEntryResult } from "./index";

const core = SignalGridCore.demo();
const keys = core.demoApiKeys();

// One demo token per tenant, so hospital and warehouse scenarios each evaluate
// under their own tenant (cross-tenant evaluation is refused by design).
function tokenFor(tenantId: string): string {
  const preferred = keys.find((k) => k.tenantId === tenantId && (k.role === "operator" || k.role === "owner"));
  return (preferred ?? keys.find((k) => k.tenantId === tenantId))?.token ?? "";
}

export interface RoomSimGlobal {
  scenarios: ReturnType<typeof listScenarios>;
  run(scenarioId: string, options?: RoomEntryOptions): RoomEntryResult;
}

const api: RoomSimGlobal = {
  scenarios: listScenarios(),
  run: (scenarioId, options = {}) => runRoomEntry(core, tokenFor(tenantForScenario(scenarioId)), scenarioId, options),
};

// Expose to the inline console script.
(globalThis as unknown as { SignalGridSim: RoomSimGlobal }).SignalGridSim = api;

export default api;

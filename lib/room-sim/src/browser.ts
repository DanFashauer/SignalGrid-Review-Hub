// Browser entry for the fully client-side Trusted Room Entry console.
//
// Bundled (esbuild, platform=browser) and inlined into a single self-contained
// HTML file, this runs the ENTIRE decision core + orchestration in the browser
// — no server, no network, no Docker. It works in Safari on an iPhone or iPad.
// The core is deterministic and dependency-free (FNV-1a digest, injected clock),
// so the in-browser result is identical to the hosted API's.

import { SignalGridCore } from "@workspace/signalgrid-core";
import { listScenarios, runRoomEntry, type RoomEntryResult } from "./index";

const core = SignalGridCore.demo();
const token =
  core.demoApiKeys().find((k) => k.tenantId === "tenant_northwind" && k.role === "operator")?.token ??
  core.demoApiKeys().find((k) => k.tenantId === "tenant_northwind")?.token ??
  "";

export interface RoomSimGlobal {
  scenarios: ReturnType<typeof listScenarios>;
  run(scenarioId: string, confirmedActionIds?: string[]): RoomEntryResult;
}

const api: RoomSimGlobal = {
  scenarios: listScenarios(),
  run: (scenarioId, confirmedActionIds = []) => runRoomEntry(core, token, scenarioId, confirmedActionIds),
};

// Expose to the inline console script.
(globalThis as unknown as { SignalGridSim: RoomSimGlobal }).SignalGridSim = api;

export default api;

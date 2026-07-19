// @workspace/integrations — real-world integration adapters ported from the
// SignalGrid product build. Framework-agnostic TypeScript: each adapter makes
// live vendor calls ONLY when given a real config (base URL + credentials);
// with no config it stays inert, so the package is fixture-safe by default and
// makes no network calls in CI or tests. Redis-backed stores fall back to
// in-memory when REDIS_URL is unset.
//
// Namespaced exports avoid cross-category name collisions.
export * as types from "./integrations/types";
export * as adapterTypes from "./integrations/adapters/types";
export * as dispatcher from "./integrations/dispatcher";
export * as deviceResolver from "./integrations/deviceResolver";
export * as sign from "./integrations/sign";
export * as itsm from "./integrations/itsm/adapter";
export * as uem from "./integrations/uem/store";
export * as nac from "./integrations/nac/store";
export * as siem from "./integrations/siem/webhook";
export * as telemetry from "./integrations/telemetry/fleetdm";
export * as telemetryTypes from "./integrations/telemetry/types";
export * as webhooks from "./integrations/webhooks/dispatch";
export * as graph from "./integrations/graph";
export * as deviceRegistry from "./deviceRegistry";

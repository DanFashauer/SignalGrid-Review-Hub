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
// Tenant scoping for the connector CONFIGURATION stores. Exported so the scoping rule
// has one definition and one proof rather than a copy per store.
export * as storeScope from "./integrations/store-scope";
export * as sign from "./integrations/sign";
export * as itsm from "./integrations/itsm/index";
export * as entitlementBinding from "./integrations/entitlement-binding/index";
export * as responseAccountability from "./integrations/response-accountability/index";
export * as uem from "./integrations/uem/index";
export * as nac from "./integrations/nac/index";
export * as siem from "./integrations/siem/index";
export * as telemetry from "./integrations/telemetry/index";
export * as telemetryTypes from "./integrations/telemetry/types";
export * as webhooks from "./integrations/webhooks/index";
export * as graph from "./integrations/graph";
// Namespaced (not a bare `export *`) like every other entry here, so its
// `normalizeReport`/`guardReadOnly` cannot collide with a sibling connector's. The
// package.json subpath export for "./task-exception" is orchestrator-wired alongside
// the proof gates; until it lands, this namespace is the dimension's import path.
export * as taskException from "./integrations/task-exception";
export * as deviceRegistry from "./deviceRegistry";

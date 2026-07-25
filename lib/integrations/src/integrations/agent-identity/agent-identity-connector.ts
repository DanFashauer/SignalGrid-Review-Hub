// Read-only normalization + transport for the agentic / non-human-identity connector.
//
// The source is an agent-governance bridge that has already evaluated who is acting
// on the device — the actor's type, its presence in the agent/NHI registry, the
// lifetime and scope of the credential backing the action, the human-in-the-loop
// approval state, and whether the actor's activity is being recorded. This connector
// normalizes that already-evaluated result. Every operation here is a read; there is
// no write path (it registers no agent, mints no token, and revokes no access).

import {
  AGENT_IDENTITY_REPORT_KEYS,
  AgentIdentityConnectorError,
  type AgentIdentityReportRaw,
  type ActorType,
  type ApprovalState,
  type NormalizedAgentIdentity,
  type RecordingState,
  type ReportIntegrity,
  type ScopeState,
  type TokenLifetime,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new AgentIdentityConnectorError("read_only_violation", `agent identity is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Did the report ASSERT something here that we could not parse?
 *
 *  `oneOf` and `boolOrNull` are lossy by design: they collapse "absent" and
 *  "unreadable" into the same safe sentinel. That is correct for deciding a value, and
 *  wrong for deciding whether the report was UNDERSTOOD — the human branch grants
 *  without reading these fields, so an unreadable assertion would otherwise be
 *  laundered into silence. These two predicates recover the distinction. A field is
 *  malformed when it is present and does not parse; absent is never malformed. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  // `null` counts as ABSENT, not as an unreadable assertion. It is the standard wire
  // spelling of "no value" — `types.ts` documents every field as able to degrade to
  // null — and treating it as malformed would punish an honest bridge that emits a
  // fixed row shape with nulls instead of omitting keys. `boolMalformed` agrees.
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** Read a field ONLY if the report asserts it as an OWN property.
 *
 *  This is the load-bearing rule, and it replaces an earlier prototype-chain walk that
 *  got the threat model backwards. An inherited value is not something this report
 *  said — it is something its prototype said — so it must not be readable as a
 *  confirmation. Reading own-only means:
 *
 *   - `Object.create({ actorType: "human", bridgeReachable: true })` — a report with
 *     ZERO own keys — asserts nothing, so every field falls to the safe unknown and it
 *     cannot grant. The walk version read those inherited values and granted.
 *   - a polluted `Object.prototype.actorType` is invisible here, where a walk that
 *     stopped *at* `Object.prototype` would read it while never inspecting it for
 *     unrecognized keys.
 *   - a hostile Proxy that hides properties from `getOwnPropertyDescriptor` now makes
 *     its own fields read as ABSENT — which denies. A Proxy can always lie; the point
 *     is that lying now costs it the grant instead of buying one.
 *
 *  It also removes the unbounded prototype walk entirely: a Proxy whose
 *  `getPrototypeOf` returned a fresh object each call made that loop non-terminating. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? The shipped HTTP transport already
 *  rejects non-objects and arrays, but the transport is injectable and `Reflect.ownKeys`
 *  throws on a primitive — so an injected adapter returning a string must fail closed,
 *  not throw an untyped TypeError out of the normalizer. */
function isPlainReport(report: unknown): report is object {
  return typeof report === "object" && report !== null && !Array.isArray(report);
}

/** Depth bound for the prototype scan below. A Proxy may return a fresh object from
 *  `getPrototypeOf` on every call, so the walk must be bounded rather than trusting it
 *  to terminate. Exceeding the bound means we could not establish what the report
 *  carries — which is a failure to understand it, so it fails closed. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand?
 *
 *  This scan walks the PROTOTYPE CHAIN even though every VALUE read is own-only, and the
 *  asymmetry is deliberate — an earlier revision collapsed the two and reopened a hole.
 *  Reading own-only is right: an inherited value is the prototype's claim, not this
 *  report's, so it must not be usable as a confirmation. But *scanning* own-only is
 *  wrong: an inherited `agent_registered` is still a governance assertion in a spelling
 *  we ignore, and this scan is the only thing that notices it. Narrowing both together
 *  let a report grant while ordinary property access on that same object answered
 *  `report.agent_registered === false`.
 *
 *  A symbol key counts. A class instance fails closed (its prototype carries
 *  `constructor`) — deliberate: the transport contract is a plain JSON object. A
 *  `JSON.parse` result is unaffected, since its prototype is `Object.prototype` and the
 *  walk stops there. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    // A hostile Proxy can throw from `ownKeys` or `getPrototypeOf`. We learned nothing.
    return true;
  }
}

/** Normalize an agent-governance report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown/null, never a fabricated "human"/"approved". */
export function normalizeReport(
  deviceId: string,
  report: AgentIdentityReportRaw,
  source = "agent-identity-bridge",
): NormalizedAgentIdentity {
  // Every read is OWN-ONLY. An inherited value is the prototype's claim, not this
  // report's, and must not be readable as a confirmation.
  const plain = isPlainReport(report);
  const raw = {
    actorType: plain ? ownValue(report, "actorType") : undefined,
    agentRegistered: plain ? ownValue(report, "agentRegistered") : undefined,
    tokenLifetime: plain ? ownValue(report, "tokenLifetime") : undefined,
    scopeState: plain ? ownValue(report, "scopeState") : undefined,
    approvalState: plain ? ownValue(report, "approvalState") : undefined,
    recordingState: plain ? ownValue(report, "recordingState") : undefined,
    bridgeReachable: plain ? ownValue(report, "bridgeReachable") : undefined,
  };

  let actorType = oneOf<ActorType>(raw.actorType, ["human", "agent", "service_account", "unknown"], "unknown");
  const agentRegistered = boolOrNull(raw.agentRegistered);
  const tokenLifetime = oneOf<TokenLifetime>(raw.tokenLifetime, ["short_lived", "long_lived", "standing", "unknown"], "unknown");
  const scopeState = oneOf<ScopeState>(raw.scopeState, ["least_privilege", "over_scoped", "unscoped", "unknown"], "unknown");
  const approvalState = oneOf<ApprovalState>(raw.approvalState, ["approved", "pending", "none", "expired", "unknown"], "unknown");
  const recordingState = oneOf<RecordingState>(raw.recordingState, ["recorded", "unrecorded", "unknown"], "unknown");

  // ── report integrity ────────────────────────────────────────────────────────
  // A field that is present but unparseable is an ASSERTION WE COULD NOT READ, which
  // is not the same thing as silence. So is a key we do not understand at all: a
  // bridge sending `agent_registered` alongside `actorType: "human"` is asserting
  // registry state in a spelling we ignore. Both mark the report malformed — as does
  // a report that is not a plain object at all.
  const malformed =
    !plain ||
    hasUnrecognizedKey(report, AGENT_IDENTITY_REPORT_KEYS) ||
    enumMalformed(raw.actorType, ["human", "agent", "service_account", "unknown"]) ||
    enumMalformed(raw.tokenLifetime, ["short_lived", "long_lived", "standing", "unknown"]) ||
    enumMalformed(raw.scopeState, ["least_privilege", "over_scoped", "unscoped", "unknown"]) ||
    enumMalformed(raw.approvalState, ["approved", "pending", "none", "expired", "unknown"]) ||
    enumMalformed(raw.recordingState, ["recorded", "unrecorded", "unknown"]) ||
    boolMalformed(raw.agentRegistered) ||
    boolMalformed(raw.bridgeReachable);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // ── is the "human" claim trustworthy? ───────────────────────────────────────
  // The evaluator grants a HUMAN actor without inspecting the governance fields,
  // because a person has no NHI registry entry and no agent approval, and their
  // credential lifetime and privilege belong to `token-binding` and
  // `access-governance`. That fast-path is only safe if the "human" claim can be
  // trusted, so we void it in exactly two situations.
  //
  // 1. The report is MALFORMED. We cannot tell whether what it asserted contradicts
  //    the claim, so we must not act as though it asserted nothing. This is the case
  //    a guard written against the NORMALIZED values cannot see: `oneOf` has already
  //    turned `"lapsed"`, `["standing"]` and `"ERR: upstream timeout"` into
  //    `"unknown"`, and `boolOrNull` has turned `"true"` and `1` into `null`.
  //
  // 2. The report asserts governance state that CANNOT be true of a person:
  //    membership in the agent/NHI registry, or an agent-approval workflow governing
  //    this actor. Note what is deliberately absent from that list — `agentRegistered:
  //    false` and `approvalState: "none"` are the TRUTHFUL answers for a human, and
  //    `tokenLifetime` / `scopeState` / `recordingState` all have real human meanings
  //    (a person's credential, a person's privilege, a recorded PAM session). A bridge
  //    that emits one uniform row shape per actor populates those columns for people
  //    too, and must not be punished for answering honestly.
  //
  // Voiding only ever moves toward `unknown`, which never grants.
  const humanClaimUntrustworthy =
    actorType === "human" &&
    (malformed ||
      agentRegistered === true ||
      approvalState === "approved" ||
      approvalState === "pending" ||
      approvalState === "expired");
  if (humanClaimUntrustworthy) {
    actorType = "unknown";
  }

  return {
    sourceSystem: "agent-identity",
    deviceId,
    actorType,
    agentRegistered,
    tokenLifetime,
    scopeState,
    approvalState,
    recordingState,
    bridgeReachable: boolOrNull(raw.bridgeReachable),
    reportIntegrity,
    source,
  };
}

export interface AgentIdentityRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's evaluated actor governance from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type AgentIdentityTransport = (req: AgentIdentityRequest) => Promise<AgentIdentityReportRaw>;

export interface AgentIdentityConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class AgentIdentityConnector {
  constructor(
    private readonly config: AgentIdentityConnectorConfig,
    private readonly transport: AgentIdentityTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof AgentIdentityConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchActor(deviceId: string): Promise<NormalizedAgentIdentity> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}

// Read-only normalization + transport for the agentic / non-human-identity connector.
//
// The source is an agent-governance bridge that has already evaluated who is acting
// on the device — the actor's type, its presence in the agent/NHI registry, the
// lifetime and scope of the credential backing the action, the human-in-the-loop
// approval state, and whether the actor's activity is being recorded. This connector
// normalizes that already-evaluated result. Every operation here is a read; there is
// no write path (it registers no agent, mints no token, and revokes no access).

import {
  AgentIdentityConnectorError,
  type AgentIdentityReportRaw,
  type ActorType,
  type ApprovalState,
  type NormalizedAgentIdentity,
  type RecordingState,
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

/** Normalize an agent-governance report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown/null, never a fabricated "human"/"approved". */
export function normalizeReport(
  deviceId: string,
  report: AgentIdentityReportRaw,
  source = "agent-identity-bridge",
): NormalizedAgentIdentity {
  let actorType = oneOf<ActorType>(report.actorType, ["human", "agent", "service_account", "unknown"], "unknown");
  const agentRegistered = boolOrNull(report.agentRegistered);
  const tokenLifetime = oneOf<TokenLifetime>(report.tokenLifetime, ["short_lived", "long_lived", "standing", "unknown"], "unknown");
  const scopeState = oneOf<ScopeState>(report.scopeState, ["least_privilege", "over_scoped", "unscoped", "unknown"], "unknown");
  const approvalState = oneOf<ApprovalState>(report.approvalState, ["approved", "pending", "none", "expired", "unknown"], "unknown");
  const recordingState = oneOf<RecordingState>(report.recordingState, ["recorded", "unrecorded", "unknown"], "unknown");

  // Self-consistency. The evaluator grants a HUMAN actor without inspecting a single
  // governance field: registry membership, agent approval and agent recording have no
  // meaning for a person, and a human's credential lifetime and privilege belong to
  // the `token-binding` and `access-governance` dimensions. That fast-path is only
  // safe if the report is genuinely describing a person — so a "human" report must be
  // SILENT on governance: registry membership unreported, every governance enum
  // unknown. Asserting any of it means the report describes two kinds of actor at
  // once, the actor label cannot be trusted, and we fail closed.
  //
  // Checking EVERY field rather than registry membership alone is the whole point.
  // `boolOrNull` maps an omitted or malformed `agentRegistered` to null, so a guard
  // keyed on that one boolean is defeated by simply leaving it out — exactly what a
  // sloppy or hostile bridge does. This only ever moves toward `unknown`, which never
  // grants; a genuinely silent human report is untouched.
  if (
    actorType === "human" &&
    (agentRegistered !== null ||
      tokenLifetime !== "unknown" ||
      scopeState !== "unknown" ||
      approvalState !== "unknown" ||
      recordingState !== "unknown")
  ) {
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
    bridgeReachable: boolOrNull(report.bridgeReachable),
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

// The ENFORCEMENT-OUT half of the SignalGrid <-> Fleet loop: read host posture
// from Fleet's REST API, and ACTUATE a SignalGrid decision on a host by moving it
// between Fleet teams (which carry the restriction profiles in `fleet/`).
//
// Transport is injected (a fetch-like function), so this is unit-testable with a
// stub and has no hard dependency on a live Fleet — the real transport wraps
// `fetch`, the test transport returns canned responses.

import type { DiskEncryption, FleetHostReport } from "./index";

/** Mirrors the core's gate outcome (allow / step_up / restrict / deny). */
export type AccessOutcome = "allow" | "step_up" | "restrict" | "deny";

export interface FleetRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}
export interface FleetResponse {
  status: number;
  json: unknown;
}
/** Injectable transport. Real = fetch against Fleet; test = a stub. */
export type FleetTransport = (req: FleetRequest, auth: { baseUrl: string; token: string }) => Promise<FleetResponse>;

export interface FleetClientConfig {
  baseUrl: string;
  token: string;
  transport: FleetTransport;
  /** Team the SignalGrid admin console provisions with the NORMAL restrictions. */
  normalTeamId: number;
  /** Team provisioned with the LOCKED-DOWN restrictions (kiosk/allowlist/non-removable). */
  restrictedTeamId: number;
}

export interface FleetActuation {
  hostId: number;
  teamId: number;
  tightened: boolean;
  outcome: AccessOutcome;
}

const okStatus = (s: number) => s >= 200 && s < 300;

function parseOsMajor(osVersion: unknown): number | undefined {
  if (typeof osVersion !== "string") return undefined;
  const m = osVersion.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Map a Fleet host JSON object into a normalized FleetHostReport (fail-safe). */
export function toHostReport(raw: any): FleetHostReport {
  const mdm = raw?.mdm ?? {};
  const enrollment = typeof mdm.enrollment_status === "string" ? mdm.enrollment_status : "";
  const mdmEnrolled = /^on/i.test(enrollment);
  // Automatic (ADE/DEP) enrollment implies a supervised device.
  const supervised = /automatic/i.test(enrollment);
  const disk = raw?.disk_encryption_enabled;
  const diskEncryption: DiskEncryption = disk === true ? "on" : disk === false ? "off" : "unknown";
  return {
    hostRef: String(raw?.uuid ?? raw?.hostname ?? raw?.id ?? "unknown"),
    mdmEnrolled,
    supervised,
    diskEncryption,
    osMajor: parseOsMajor(raw?.os_version),
    lastSeenAt: typeof raw?.seen_time === "string" ? raw.seen_time : null,
    sourceReference: `fleet:host#${raw?.id ?? "?"}`,
  };
}

export class FleetClient {
  constructor(private readonly cfg: FleetClientConfig) {}

  private auth() {
    return { baseUrl: this.cfg.baseUrl, token: this.cfg.token };
  }

  /** Read host posture from Fleet, normalized for the DecisionEngine. */
  async listHostPosture(): Promise<FleetHostReport[]> {
    const res = await this.cfg.transport({ method: "GET", path: "/api/v1/fleet/hosts" }, this.auth());
    if (!okStatus(res.status)) throw new Error(`Fleet list hosts failed: ${res.status}`);
    const hosts = (res.json as any)?.hosts;
    return Array.isArray(hosts) ? hosts.map(toHostReport) : [];
  }

  /**
   * Actuate a decision on a host. `restrict`/`deny` move it to the restricted team
   * (kiosk/allowlist/non-removable engage); `allow`/`step_up` move it to the normal
   * team. Uses Fleet's host-transfer endpoint. Throws (fail-closed) on any error.
   */
  async applyDecision(hostId: number, outcome: AccessOutcome): Promise<FleetActuation> {
    const tightened = outcome === "restrict" || outcome === "deny";
    const teamId = tightened ? this.cfg.restrictedTeamId : this.cfg.normalTeamId;
    const res = await this.cfg.transport(
      { method: "POST", path: "/api/v1/fleet/hosts/transfer", body: { team_id: teamId, hosts: [hostId] } },
      this.auth(),
    );
    if (!okStatus(res.status)) throw new Error(`Fleet host transfer failed: ${res.status}`);
    return { hostId, teamId, tightened, outcome };
  }
}

/** Real transport: wraps `fetch` (Node 18+/browser). */
export const fetchTransport: FleetTransport = async (req, auth) => {
  const res = await fetch(`${auth.baseUrl}${req.path}`, {
    method: req.method,
    headers: {
      "Authorization": `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, json };
};

// The READ half of the SignalGrid <-> Fleet loop: read host posture from Fleet's
// REST API, normalized for the decision core. READ-ONLY BY CONSTRUCTION (review
// finding): an exported actuation method — even stub-transported — hands an
// injected fetch transport everything needed to execute a production host
// transfer, so the public package exposes NO write path at all. Actuation
// (moving a host between Fleet teams) lives in the private core; the DERIVATION
// (posture → outcome via `fleetOutcome`) stays here and is proven.
// The injected transport (a fetch-like function) exists so the READ is testable
// with a stub; the live `fetch`-wrapping transport also lives out of tree.

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
  /** Org-required minimum OS major, stamped onto every fetched report so the
   *  normalizer can grade the floor. Absent → floor not enforced (and the
   *  normalizer says so via `unknown` rather than passing the host). */
  osFloor?: number;
}

const okStatus = (s: number) => s >= 200 && s < 300;

function parseOsMajor(osVersion: unknown): number | undefined {
  if (typeof osVersion !== "string") return undefined;
  const m = osVersion.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Map a Fleet host JSON object into a normalized FleetHostReport (fail-safe).
 *  Fleet's host list does not carry screen-lock state, so `screenLock` is left
 *  absent — the normalizer grades that `unknown`, never `compliant`. `osFloor`
 *  comes from the caller's config, not from Fleet. */
export function toHostReport(raw: any, osFloor?: number): FleetHostReport {
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
    osFloor,
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
    // A 2xx whose envelope is malformed / version-skewed (`hosts` absent or not an
    // array) must NOT read as a successful empty fleet (review finding): the caller
    // could not distinguish a genuine zero-host tenant from a broken connector, and
    // devices that are actually unmanaged or non-compliant would simply produce no
    // posture signals. `[]` is reserved for an explicit `hosts: []`; anything else
    // throws so the read fails loudly.
    if (!Array.isArray(hosts)) {
      throw new Error("Fleet list hosts returned a malformed envelope: `hosts` is missing or not an array");
    }
    return hosts.map((h: any) => toHostReport(h, this.cfg.osFloor));
  }

}

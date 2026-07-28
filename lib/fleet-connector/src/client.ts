// The ENFORCEMENT-OUT half of the SignalGrid <-> Fleet loop: read host posture
// from Fleet's REST API, and ACTUATE a SignalGrid decision on a host by moving it
// between Fleet teams (which carry the restriction profiles in `fleet/`).
//
// PUBLIC-REPO BOUNDARY: this is a public, review-safe package, and it must not carry
// a LIVE, write-capable Fleet actuator. Transport is injected (a fetch-like function),
// so the public build is exercised ONLY with a stub that returns canned responses —
// the class and its actuation logic are proven fixture-backed, never against a real
// Fleet tenant. The real `fetch`-wrapping transport lives OUT OF TREE in the private
// core, which is where a live host-transfer POST belongs; it is deliberately NOT
// exported here, so no caller can turn this review package into a live actuator by
// supplying it. (Adversarial-review finding: an exported live transport made the public
// connector a write-capable Fleet actuator.)

import { fleetOutcome, type DiskEncryption, type FleetHostReport, type FleetSignal } from "./index";

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
    return Array.isArray(hosts) ? hosts.map((h: any) => toHostReport(h, this.cfg.osFloor)) : [];
  }

  /**
   * Actuate a decision on a host. Only an explicit `allow` returns a host to the
   * normal team; `step_up`, `restrict`, and `deny` all place it on the restricted
   * team (kiosk/allowlist/non-removable engage). step_up is a demand for MORE
   * proof — actuating it by relaxing device enforcement would turn the fabric's
   * middle rung into an un-restrict side channel. Uses Fleet's host-transfer
   * endpoint. Throws (fail-closed) on any error.
   */
  async applyDecision(hostId: number, outcome: AccessOutcome, evidence?: FleetSignal): Promise<FleetActuation> {
    const tightened = outcome !== "allow";
    // RELAXATION IS POSTURE-BOUND (review finding): tightening (step_up/restrict/
    // deny) is always safe to actuate, but returning a host to the normal team on a
    // hand-picked "allow" would let any caller un-restrict an unmanaged, non-
    // compliant, or stale host — making fleetOutcome advisory rather than enforced.
    // An "allow" therefore REQUIRES the host's normalized Fleet signal as evidence,
    // and that evidence must itself derive to "allow" (positive health on every
    // axis); anything less throws fail-closed and no transfer is attempted.
    if (!tightened) {
      if (!evidence) {
        throw new Error(
          "Fleet relaxation requires the host's normalized posture signal as evidence — an 'allow' cannot be actuated on assertion alone.",
        );
      }
      if (fleetOutcome(evidence) !== "allow") {
        throw new Error(
          "Fleet relaxation refused: the supplied posture evidence does not derive to 'allow' (fail closed).",
        );
      }
    }
    const teamId = tightened ? this.cfg.restrictedTeamId : this.cfg.normalTeamId;
    const res = await this.cfg.transport(
      { method: "POST", path: "/api/v1/fleet/hosts/transfer", body: { team_id: teamId, hosts: [hostId] } },
      this.auth(),
    );
    if (!okStatus(res.status)) throw new Error(`Fleet host transfer failed: ${res.status}`);
    return { hostId, teamId, tightened, outcome };
  }
}

// NOTE: the live `fetch`-wrapping transport is intentionally NOT defined or exported in
// this public package — see the boundary note at the top. A live Fleet transport (and
// the authenticated host-transfer POST it enables) lives out of tree in the private
// core. In this repo, `FleetClient` is only ever constructed with a caller-supplied stub
// (see `fleet-connector-proof.ts`), so the actuation logic is proven without any path to
// a real tenant.

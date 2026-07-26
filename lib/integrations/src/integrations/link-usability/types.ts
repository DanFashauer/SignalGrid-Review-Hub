// Types for the read-only link-usability dimension — "associated" is not "usable".
//
// The fabric already asks whether a device was ADMITTED to the network: `network-nac`
// models 802.1X authentication state, the segment/VLAN it landed on, NAC policy
// compliance, and which switch port or access point it attached to. That answers the
// question at the POINT OF CONNECTION. It does not ask the question that decides whether
// the connection is worth anything a second later: **is the link this device is sitting
// on actually carrying traffic?**
//
// The failure it exists to catch is a well-documented one on shared frontline fleets:
// a handheld or cart moves between access points and the association survives while
// nothing gets through. The client shows connected. The console shows connected. The
// transactions time out. On the warehouse floor that reads as "spotty Wi-Fi in an area
// with good coverage"; the underlying cause is usually a sticky client holding a weak
// AP past its roam threshold, or a roam that completed at the radio layer while DHCP or
// DNS did not.
//
// Why this belongs in a TRUST fabric rather than a device-monitoring product: every
// other dimension grants on freshness. `device-management-health` requires
// `managementReachable === true`; `agent-identity` requires `bridgeReachable === true`.
// A bridge that answers over a link like this returns a STALE read wearing a fresh
// timestamp — the same defect as reading one check-in number for two delivery channels,
// one layer lower down. "Associated" is a console number standing in for a fact it does
// not cover.
//
// This connector normalizes a wireless controller's or cloud dashboard's already-
// evaluated view. It joins no network, steers no client, changes no radio setting, and
// deauthenticates nobody — those stay with the WLAN.
//
// It deliberately does NOT re-model what `network-nac` owns. Authentication and
// segmentation are that dimension's job; overlapping them would produce two verdicts on
// one fact. This one starts after admission.

/** Is the device attached to an access point at all?
 *
 *  On its own this confirms NOTHING, and the whole dimension exists to say so. It is
 *  carried because it distinguishes "no link" from "a link that does not work", which
 *  are different problems with different owners. */
export type AssociationState = "associated" | "not_associated" | "unknown";

/** How far up the connection ladder the device's most recent attempts actually got.
 *
 *  Wireless dashboards report these as distinct rungs rather than one boolean — a
 *  Meraki-class API, for instance, exposes separate association, authentication, DHCP
 *  and DNS counters across its wireless connection-stats endpoints. That separation is
 *  the entire primitive this dimension needs, because a client can clear association and
 *  then fail at DHCP or DNS, which is exactly "connected but nothing works".
 *
 *  `associated_only` is the headline state: the bridge affirmatively reports that
 *  association succeeded and that NO higher rung completed. It is not a gap in what we
 *  know — it is a positive report that nothing got through.
 *
 *  NOTE FOR BRIDGE IMPLEMENTERS — there is deliberately no `auth_failing` rung, even
 *  though the vendor APIs this ladder is modelled on do count failed authentication
 *  separately. Authentication is `network-nac`'s question, and duplicating it here would
 *  produce two verdicts on one fact. **An 802.1X/EAP failure belongs in `network-nac`,
 *  not here** — do not map it to `associated_only`. Doing so reports it as a usability
 *  problem (alert) while `network-nac` independently reports it as an admission problem
 *  (restrict); worst-concern-wins keeps the outcome safe, but the fabric then
 *  double-counts one failure as two, and the operator sees two incidents for one cause.
 *  If your controller cannot distinguish "authenticated but nothing got through" from
 *  "authentication failed", report `unknown` here and let `network-nac` carry it. */
export type LinkProgress =
  | "carrying_traffic"
  | "dns_failing"
  | "dhcp_failing"
  | "associated_only"
  | "not_associated"
  | "unknown";

/** What roaming support the device and infrastructure actually negotiated.
 *
 *  `fast_transition` means 802.11r — *Fast BSS Transition*, and the only one of the
 *  commonly-grouped three that actually makes a transition fast. (802.11k is Radio
 *  Resource Measurement, which helps a client CHOOSE a target; 802.11v is BSS Transition
 *  Management, which lets infrastructure STEER one. They are usually deployed alongside
 *  r, which is why "802.11r/k/v" is fair shorthand for the deployment and wrong as a
 *  description of what provides fast transition.)
 *
 *  `basic` is not a defect and does not deny — plenty of healthy fleets roam without
 *  fast transition — but it materially raises the odds of the sticky-client behaviour
 *  below, so an operator needs to see it. `not_applicable` is a positive assertion that
 *  this device has no roaming domain at all (wired, or a single-AP site). Silence is
 *  `unknown`, and `unknown` denies like everywhere else.
 *
 *  Because `not_applicable` is a positive claim about the SITE while `roamHealth` is a
 *  report of observed BEHAVIOUR, the two can contradict each other, and the evaluator
 *  refuses that pair rather than granting on it — see `roamReportInconsistent`. That
 *  contradiction was missed in this dimension's first draft, and it let three of its six
 *  granting shapes through incoherent. */
export type RoamCapability = "fast_transition" | "basic" | "not_applicable" | "unknown";

/** Observed roaming BEHAVIOUR, as distinct from capability.
 *
 *  `sticky` = the client is holding an access point whose signal has fallen below the
 *  roam threshold while a stronger one is available — the documented failure behind
 *  "coverage is fine but it keeps dropping". `excessive` is the opposite pathology: the
 *  client flaps between APs, and every transition is a window where traffic stalls. */
export type RoamHealth = "stable" | "sticky" | "excessive" | "not_applicable" | "unknown";

/** Latency banding for the link, BUCKETED BY THE BRIDGE.
 *
 *  Controllers report latency in milliseconds, often split by traffic class. This
 *  connector deliberately does not carry the number and does not carry a threshold:
 *  what counts as degraded is a property of the site and the workload, not of
 *  SignalGrid, and a threshold invented here would be a fabricated fact dressed as a
 *  measurement. The bridge that knows the site does the banding; this dimension judges
 *  the band. */
export type LinkLatencyClass = "nominal" | "degraded" | "unknown";

/** Raw link report about one device (loosely typed).
 *
 *  EVERY field is `unknown`, including the boolean. A bridge is an external system: it
 *  can and does emit `"true"`, `1`, `["sticky"]`, or `"ERR: dashboard timeout"` in any
 *  of these slots, and the normalizer — not the compiler — is what makes that safe. */
export interface LinkUsabilityReportRaw {
  associationState?: unknown; // associated | not_associated | unknown
  linkProgress?: unknown; // carrying_traffic | dns_failing | dhcp_failing | associated_only | not_associated | unknown
  roamCapability?: unknown; // fast_transition | basic | not_applicable | unknown
  roamHealth?: unknown; // stable | sticky | excessive | not_applicable | unknown
  linkLatencyClass?: unknown; // nominal | degraded | unknown
  controllerReachable?: unknown; // boolean
  [k: string]: unknown;
}

/** The exact set of keys this connector understands. Anything else means the report was
 *  not fully understood — see `reportIntegrity`. */
export const LINK_USABILITY_REPORT_KEYS = [
  "associationState",
  "linkProgress",
  "roamCapability",
  "roamHealth",
  "linkLatencyClass",
  "controllerReachable",
] as const;

/** Did the raw report parse cleanly?
 *
 *  `malformed` = at least one known field was PRESENT but unparseable, or the report
 *  carried an unrecognized key, or a field could not be read at all. The normalized
 *  enums cannot express this on their own: the allowlist folds every unrecognized value
 *  into `"unknown"`, collapsing "the report said nothing" and "the report said something
 *  we could not read" into one sentinel. The distinction is tracked separately and
 *  independently denied on, so the allow path never rests on a value we only *think* we
 *  understood. */
export type ReportIntegrity = "clean" | "malformed";

/** The normalized, vendor-neutral link posture. */
export interface NormalizedLinkUsability {
  sourceSystem: "link-usability";
  deviceId: string;
  associationState: AssociationState;
  linkProgress: LinkProgress;
  roamCapability: RoamCapability;
  roamHealth: RoamHealth;
  linkLatencyClass: LinkLatencyClass;
  /** true = the controller answered for this device; false = it did not; null = not
   *  reported. Only an explicit true can back a grant. */
  controllerReachable: boolean | null;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type LinkUsabilityPosture =
  | "link_carrying_traffic"
  /** Associated, and the bridge affirmatively reports nothing got through. The
   *  false-confirmation state this dimension exists to name. */
  | "associated_not_usable"
  | "link_absent"
  | "roaming_unstable"
  | "degraded_link"
  | "unverified"
  | "unknown";

export type LinkUsabilityReasonCode =
  | "LINK_CARRYING_TRAFFIC"
  | "ASSOCIATED_BUT_NOT_CARRYING_TRAFFIC"
  | "DNS_FAILING"
  | "DHCP_FAILING"
  | "NOT_ASSOCIATED"
  | "ROAM_STICKY"
  | "ROAM_EXCESSIVE"
  | "LINK_LATENCY_DEGRADED"
  /** The report's association and progress fields contradict each other. */
  | "LINK_REPORT_INCONSISTENT"
  | "LINK_STATE_UNKNOWN"
  | "CONTROLLER_UNREACHABLE"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type LinkUsabilityAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface LinkUsabilityVerdict {
  posture: LinkUsabilityPosture;
  reasonCode: LinkUsabilityReasonCode;
  recommendedAction: LinkUsabilityAction;
  /** Confirmed known-bad FACTS about this link, as opposed to gaps in what we know —
   *  an affirmative report that traffic is not getting through, at whichever rung. */
  criticalFindings: string[];
  /** Link facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the link is positively confirmed USABLE: carrying traffic, roam
   *  behaviour stable (or confirmed absent), roam capability reported, latency nominal,
   *  association confirmed, and the controller confirmed reachable. */
  linkUsable: boolean;
  deviceId: string;
}

export type LinkUsabilityConnectorErrorCode =
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class LinkUsabilityConnectorError extends Error {
  readonly code: LinkUsabilityConnectorErrorCode;
  readonly status: number;
  constructor(code: LinkUsabilityConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "LinkUsabilityConnectorError";
    this.code = code;
    this.status = status;
  }
}

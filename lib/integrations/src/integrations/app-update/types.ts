// Types for the read-only APP-UPDATE CURRENCY dimension.
//
// Origin: an "OTA update mechanism for enterprise iOS apps" proposal (download the
// IPA, hash-check it, install via UIApplication.open). That MECHANISM does not exist
// on iOS — an app cannot install or replace itself; self-serve IPA installation is an
// Android sideload pattern. The honest enterprise distribution paths are:
//   • `itms-services://` manifest installs (Apple Developer Enterprise Program,
//     in-house apps) — the OS performs the download/install and verifies code
//     signing; an app may TRIGGER it, never perform it;
//   • MDM `InstallApplication` (Fleet — the actuator this repo already committed to);
//   • ABM custom apps / TestFlight.
// See docs/APP_UPDATE_CURRENCY.md for the full platform-honesty assessment.
//
// What IS real — and was missing from the fabric — is the DECISION half of that
// proposal: `min_version` floors and `force_update` flags are POSTURE. A frontline
// device running a stale, vulnerable build of its host app should lose `allow`
// exactly the way an OS-below-floor device does (the fleet-connector osFloor
// pattern), and an app that arrived OUTSIDE the managed channel is an unverified
// provenance claim, not a trusted install. This dimension normalizes an
// already-resolved MDM app-inventory row + the tenant's release manifest into that
// posture. It takes no action of its own: distribution and enforcement stay with
// MDM; SignalGrid gates.

/** Where the installed app came from, as REPORTED BY MDM (never self-measured by
 *  the app — an app attesting to its own provenance proves nothing). `managed` =
 *  installed through the managed channel (MDM InstallApplication / ABM). */
export type InstallChannel = "managed" | "unmanaged" | "unknown";

/** The installed version's relationship to the release manifest, computed by the
 *  normalizer (never asserted by the wire):
 *  `current` = at/above the manifest's latest (and any floor);
 *  `behind` = above the floor but below latest;
 *  `below_floor` = affirmatively below the enforced min_version;
 *  `unknown` = the relationship could not be POSITIVELY established (installed or
 *  latest missing/unparseable). Unknown raises, never grants. */
export type UpdateCurrency = "current" | "behind" | "below_floor" | "unknown";

/** Does the release manifest demand the newest version (`force_update`)?
 *  Absent is `unknown` — absence of the flag is not permission to lag. */
export type ForcePolicy = "forced" | "not_forced" | "unknown";

/**
 * The app's runtime STABILITY on this device, DERIVED (intake ledger row 19,
 * from the Omnissa Intelligence app-health material): the analytics plane
 * (Omnissa Intelligence, Crashlytics-class SDKs and their peers) reports the
 * crash count and the window it covers; the CALLER poses the bound. A crashing
 * host app is operational risk for the workflow about to start in it.
 *
 * `unassessed` = no bound was posed — carried visibly, never a defaulted pass.
 * `unknown` = the question WAS posed and the figures cannot answer it (count or
 * window missing/unreadable) — and unknown raises. A count without its window
 * is uninterpretable and never graded.
 */
export type StabilityStanding = "stable" | "unstable" | "unassessed" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ReportIntegrity = "clean" | "malformed";

/** Raw wire report about one device's installed host app + the tenant's release
 *  manifest (loosely typed — MDM inventories and manifest files are EXTERNAL and may
 *  emit `"true"`, `1`, `["2.4.0"]`, or `"ERR: timeout"` in any slot). The
 *  normalizer, not the compiler, is what makes a value safe. */
export interface AppUpdateReportRaw {
  installed_version?: unknown; // e.g. "2.4.0"
  latest_version?: unknown; // the manifest's current release
  min_version?: unknown; // the enforced floor; absent → no floor enforced
  force_update?: unknown; // boolean
  channel?: unknown; // managed | unmanaged | unknown
  crash_count?: unknown; // crashes the analytics plane counted in its window
  stability_window_hours?: unknown; // the window those counts cover, source-reported
  [k: string]: unknown;
}

export const APP_UPDATE_REPORT_KEYS = [
  "installed_version",
  "latest_version",
  "min_version",
  "force_update",
  "channel",
  "crash_count",
  "stability_window_hours",
] as const;

export interface NormalizedAppUpdate {
  sourceSystem: "app-update";
  deviceRef: string;
  appRef: string;
  currency: UpdateCurrency;
  forcePolicy: ForcePolicy;
  channel: InstallChannel;
  /** Source-reported stability figures, carried as validated evidence — the
   *  STANDING is derived in the evaluator against the caller's posed bound.
   *  Null when absent or unreadable, never a fabricated zero. */
  crashCount: number | null;
  stabilityWindowHours: number | null;
  reportIntegrity: ReportIntegrity;
  source: string;
}

/** The posture this dimension can report. */
export type AppUpdatePosture =
  | "current_managed" // at latest, managed channel, clean — the grant
  | "update_available" // behind latest, floor satisfied, not forced — advisory
  | "forced_update_pending" // behind latest and the manifest forces updates
  | "below_floor" // affirmatively below the enforced min_version
  | "unmanaged_install" // the app did not arrive via the managed channel
  | "app_unstable" // the analytics plane counted more crashes than the caller's bound
  | "version_unknown" // currency could not be positively established
  | "unverified"; // malformed / unreadable report

export type AppUpdateAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type AppUpdateReasonCode =
  | "CURRENT_MANAGED"
  | "UPDATE_AVAILABLE"
  | "FORCED_UPDATE_PENDING"
  | "FORCE_POLICY_UNKNOWN"
  | "BELOW_MIN_VERSION"
  | "UNMANAGED_INSTALL"
  | "CHANNEL_UNKNOWN"
  | "APP_UNSTABLE"
  | "STABILITY_UNKNOWN"
  | "VERSION_UNKNOWN"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface AppUpdateVerdict {
  deviceRef: string;
  appRef: string;
  posture: AppUpdatePosture;
  reasonCode: AppUpdateReasonCode;
  recommendedAction: AppUpdateAction;
  /** Affirmative currency concerns (below floor, forced update pending, unmanaged). */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** The derived stability standing — `unassessed` when no bound was posed. */
  stability: StabilityStanding;
  /** True ONLY when currency is positively confirmed: current + managed + clean —
   *  and the stability question, IF posed, answered `stable`. */
  currencyConfirmed: boolean;
}

export class AppUpdateConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AppUpdateConnectorError";
  }
}

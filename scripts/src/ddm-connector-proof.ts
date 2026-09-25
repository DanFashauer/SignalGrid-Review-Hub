// Proof: the DDM / device-health connector (@workspace/ddm-connector).
//
//   • maps DDM device reports to the core's decision dimensions (managed,
//     compliance, baseline, freshness);
//   • fail-closed — a weak posture (permissive/disabled binary control, partial/
//     missing privacy, degraded health, stale/missing check-in, unenrolled) can
//     only RAISE assurance (auto → step-up), never lower it;
//   • `mdm.is-return-to-service` is read where Apple reports it (iOS/visionOS 27+):
//     n/a on a Mac never raises, an unknown / pre-27 / garbage platform or OS always
//     does, and `true` (app-preservation mode) is a configured mode, not an erase in
//     flight — it raises only through update currency (Apple disables updates except
//     at a reset);
//   • deterministic — normalization is pure over an injected observation time;
//   • the summary is one-glance correct.
//
// Run: pnpm --filter @workspace/scripts run proof:ddm-connector

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLE_DDM_STATUS_ITEMS } from "@workspace/integrations/macos-posture";
import {
  normalizeDdmReport,
  normalizeDdmReports,
  ddmSummary,
  enforcementCurrencyOf,
  DEMO_DDM_REPORTS,
  DDM_OBSERVED_AT,
  DDM_APPLE_SCHEMA_VERSION,
  DDM_APPLE_STATUS_ITEMS,
  DDM_REPORT_APPLE_ALIASES,
  DDM_REPORT_FIELDS,
  DDM_ENROLLMENT_TYPES,
  APPLE_SCHEMA_PIN_SHA,
  APPLE_SCHEMA_VENDOR_DIR,
  enrollmentTypeOf,
  returnToServiceStateOf,
  platformOf,
  DDM_PLATFORMS,
  RETURN_TO_SERVICE_INTRODUCED,
  type DdmDeviceReport,
} from "@workspace/ddm-connector";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const signals = normalizeDdmReports(DEMO_DDM_REPORTS, DDM_OBSERVED_AT);
const byRef = (ref: string) => signals.find((s) => s.deviceRef === ref)!;

// ── healthy device: everything maps to the trusting values, no raise ──────────
const healthy = byRef("mac-noc-01");
check("enrolled → managed", healthy.deviceManaged === true);
check("healthy → compliant", healthy.deviceCompliance === "compliant");
check("binary enforced → baseline aligned", healthy.baselineCompliance === "aligned");
check("fresh check-in → freshness fresh", healthy.postureFreshness === "fresh");
check("healthy posture → assurance standard (no raise)", healthy.assurance === "standard");

// ── binary control not enforced → baseline drift + raise ──────────────────────
check("permissive binary control → baseline drifted", byRef("mac-noc-02").baselineCompliance === "drifted");
check("permissive → raise step-up", byRef("mac-noc-02").assurance === "raise_step_up");
check("disabled binary control → baseline drifted", byRef("mac-noc-03").baselineCompliance === "drifted");
check("disabled → raise step-up", byRef("mac-noc-03").assurance === "raise_step_up");

// ── incomplete privacy declaration → raise ────────────────────────────────────
check("partial privacy → raise step-up (posture incomplete)", byRef("mac-noc-04").assurance === "raise_step_up");
check("partial privacy keeps baseline aligned (binary still enforced)", byRef("mac-noc-04").baselineCompliance === "aligned");

// ── degraded health → non-compliant + raise ───────────────────────────────────
check("degraded health → non_compliant", byRef("mac-noc-05").deviceCompliance === "non_compliant");
check("degraded health → raise step-up", byRef("mac-noc-05").assurance === "raise_step_up");

// ── freshness mapping + raise ─────────────────────────────────────────────────
check("stale check-in → freshness stale", byRef("mac-noc-06").postureFreshness === "stale");
check("stale → raise step-up", byRef("mac-noc-06").assurance === "raise_step_up");
check("never-checked-in → freshness missing", byRef("mac-noc-07").postureFreshness === "missing");
check("unreporting → compliance unknown", byRef("mac-noc-07").deviceCompliance === "unknown");
check("unreporting → raise step-up", byRef("mac-noc-07").assurance === "raise_step_up");

// ── unenrolled → not managed + raise ──────────────────────────────────────────
check("unenrolled → not managed", byRef("mac-byod-01").deviceManaged === false);
check("unenrolled → raise step-up", byRef("mac-byod-01").assurance === "raise_step_up");

// ── 27.0 status items: mdm.enrollment-type / mdm.is-return-to-service ────────
// Every fixture but mac-noc-11 carries enrollmentType "supervised", so that arm is the
// ONLY thing separating mac-noc-11 from the healthy device. The Macs carry no
// returnToService key because Apple never sends it on macOS — which is itself the
// not_applicable arm: if it raised, mac-noc-01 would stop being standard.
check("user enrollment → not supervised", byRef("mac-noc-11").supervised === false);
check("user enrollment → enrollmentType carried verbatim", byRef("mac-noc-11").enrollmentType === "user");
check("SUPERVISION CASE: an otherwise-perfect user-enrolled device raises step-up", byRef("mac-noc-11").assurance === "raise_step_up");
check("user enrollment → the rationale names it", byRef("mac-noc-11").rationale.includes("not supervised"));
check("no raised device carries the 'DDM posture healthy' rationale", signals.every((s) => s.assurance === "standard" || !s.rationale.startsWith("DDM posture healthy")));
// Absent is UNKNOWN, never a friendly default — the shape golden rule 2 forbids.
check("absent enrollment-type → unknown (never supervised)", enrollmentTypeOf({ deviceRef: "x", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: null }) === "unknown");
check("unpublished enrollment wire value → unknown (Apple's rangelist is the whole list)", enrollmentTypeOf({ deviceRef: "x", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: null, enrollmentType: "managed" as never }) === "unknown");

// mdm.is-return-to-service — Apple: "If true, the device is using the return to service
// with app preservation mode". iOS/visionOS 27.0; macOS, tvOS, watchOS n/a.
const perfect = (over: Partial<DdmDeviceReport>): DdmDeviceReport => ({ deviceRef: "x", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: DEMO_DDM_REPORTS[0].lastCheckInAt, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised", ...over });
const rts = (over: Partial<DdmDeviceReport>) => normalizeDdmReport(perfect(over), DDM_OBSERVED_AT);
// macOS: n/a — the Mac fleet never reports it, and must not be stepped up forever for that.
check("macOS, no key → return-to-service not_applicable", byRef("mac-noc-01").returnToService === "not_applicable");
check("N/A CASE: an otherwise-perfect Mac with no key does NOT raise (Apple never sends it on macOS)", byRef("mac-noc-01").assurance === "standard");
check("every Mac in the fleet reads not_applicable", signals.filter((s) => s.deviceRef.startsWith("mac-")).every((s) => s.returnToService === "not_applicable"));
check("tvOS / watchOS, no key → not_applicable, no raise", rts({ platform: "tvOS" }).returnToService === "not_applicable" && rts({ platform: "watchOS" }).assurance === "standard");
// iOS 27: the three arms, on otherwise-perfect shared iPhones.
check("iOS 27, false → in_service", byRef("iphone-shared-01").returnToService === "in_service");
check("iOS 27, false → standard", byRef("iphone-shared-01").assurance === "standard");
check("iOS 27, true → rts_app_preservation", byRef("iphone-shared-02").returnToService === "rts_app_preservation");
check("APP-PRESERVATION CASE: the RTS axis itself does not raise (no 'return-to-service state unknown')", !byRef("iphone-shared-02").rationale.includes("return-to-service state unknown"));
check("APP-PRESERVATION CASE: Apple disables updates except at reset → update currency unknown, never current", byRef("iphone-shared-02").enforcementCurrency === "unknown");
check("APP-PRESERVATION CASE: raises step-up on the update-currency axis, and the rationale says reset-bound", byRef("iphone-shared-02").assurance === "raise_step_up" && byRef("iphone-shared-02").rationale.includes("update enforcement reset-bound"));
check("iOS 27, absent → unknown (Apple marks the key required)", byRef("iphone-shared-03").returnToService === "unknown");
check("iOS 27, absent → raise step-up (unknown tightens)", byRef("iphone-shared-03").assurance === "raise_step_up");
check("iOS 27, absent → the rationale names it", byRef("iphone-shared-03").rationale.includes("return-to-service state unknown"));
check("visionOS 27 is applicable too: absent → unknown, true → rts_app_preservation", rts({ platform: "visionOS" }).returnToService === "unknown" && rts({ platform: "visionOS", returnToService: true }).returnToService === "rts_app_preservation");
// iOS 26: Apple-correct would be not_applicable (the item arrived in 27.0), but that
// loosening is not on the approved list, so pre-27 still reads unknown and raises.
check("iOS 26, no key → unknown (pre-27 not_applicable not signed off)", rts({ platform: "iOS", osMajor: 26 }).returnToService === "unknown");
check("iOS 26, no key → raises", rts({ platform: "iOS", osMajor: 26 }).assurance === "raise_step_up");
// Garbage or impossible OS versions never loosen.
for (const [platform, osMajor] of [["iOS", 0], ["iOS", -1], ["iOS", 26.9], ["iOS", 3], ["visionOS", 0], ["visionOS", 2]] as const) {
  check(`${platform} osMajor ${osMajor}, no key → unknown → raises`, rts({ platform, osMajor }).returnToService === "unknown" && rts({ platform, osMajor }).assurance === "raise_step_up");
}
check("iOS osMajor 27.5 (not a whole major), false → unknown, never in_service", rts({ platform: "iOS", osMajor: 27.5, returnToService: false }).returnToService === "unknown");
check("the applicability table is frozen (no runtime rewrite to n/a)", Object.isFrozen(RETURN_TO_SERVICE_INTRODUCED));
// Fail closed: what cannot be placed never reads not_applicable.
check("unknown platform, no key → unknown", rts({}).returnToService === "unknown");
check("UNKNOWN-PLATFORM CASE: an otherwise-perfect device with no platform and no key raises", rts({}).assurance === "raise_step_up");
check("unrecognized platform wire value → platform unknown → raises", platformOf(perfect({ platform: "iPadOS" as never })) === "unknown" && rts({ platform: "iPadOS" as never }).assurance === "raise_step_up");
check("iOS with unknown OS version, no key → unknown → raises", rts({ platform: "iOS", osMajor: undefined }).assurance === "raise_step_up");
check("iOS with a NaN OS version → unknown", rts({ platform: "iOS", osMajor: Number.NaN }).returnToService === "unknown");
check("a value where Apple sends none (macOS + true) → unknown, never silently ignored", returnToServiceStateOf(perfect({ platform: "macOS", returnToService: true })) === "unknown");

// ── update-enforcement currency (OS-27 cutover, fail-safe) ────────────────────
// THE core case: a device that looks perfect (enrolled, enforced, declared, fresh)
// but whose update enforcement is legacy on OS 27 — silently a no-op. "Compliant"
// is not trustworthy, so it must raise, not pass as standard.
check("legacy enforcement on OS 27 → currency dead", byRef("mac-noc-08").enforcementCurrency === "dead");
check("SILENT-DEATH CASE: an otherwise-perfect device with dead enforcement raises step-up", byRef("mac-noc-08").assurance === "raise_step_up");
check("legacy enforcement on pre-27 → currency at_risk (dies on upgrade)", byRef("mac-noc-09").enforcementCurrency === "at_risk");
check("at-risk enforcement → raise step-up", byRef("mac-noc-09").assurance === "raise_step_up");
check("no enforcement configured → currency dead", byRef("mac-noc-10").enforcementCurrency === "dead");
check("declarative enforcement → currency current", byRef("mac-noc-01").enforcementCurrency === "current");
// Fail-safe units: only an exact 'declarative' is current; everything unverifiable is not.
check("legacy + unknown OS → at_risk (cannot confirm pre-cutover, never current)", enforcementCurrencyOf({ deviceRef: "x", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: DEMO_DDM_REPORTS[0].lastCheckInAt, updateEnforcement: "legacy" }) === "at_risk");
check("unreported enforcement → currency unknown (fail-safe, raises)", byRef("mac-noc-07").enforcementCurrency === "unknown");

// ── SAFETY: a weak posture NEVER yields assurance 'standard' ───────────────────
check("SAFETY: only the fully-healthy devices are assurance standard (mac-noc-01, iphone-shared-01)",
  signals.filter((s) => s.assurance === "standard").map((s) => s.deviceRef).join(",") === "mac-noc-01,iphone-shared-01");

// ── fail-closed on ambiguous health (unreporting/unknown) even if otherwise ok ─
// Supervised macOS on purpose: the ONLY weak axis here is health, so the assertion
// below still isolates the arm it names after the 27.0 fields landed.
const unreporting: DdmDeviceReport = { deviceRef: "mac-unrep", platform: "macOS", enrolled: true, health: "unreporting", binaryControl: "enforced", privacy: "declared", lastCheckInAt: DEMO_DDM_REPORTS[0].lastCheckInAt, osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" };
const ur = normalizeDdmReport(unreporting, DDM_OBSERVED_AT);
check("unreporting health → compliance unknown", ur.deviceCompliance === "unknown");
check("unreporting health (otherwise healthy posture) → raise step-up (fail closed)", ur.assurance === "raise_step_up");

// ── fail-closed on a future-dated report (don't trust it) ─────────────────────
const future: DdmDeviceReport = { deviceRef: "mac-future", platform: "macOS", enrolled: true, health: "healthy", binaryControl: "enforced", privacy: "declared", lastCheckInAt: "2099-01-01T00:00:00.000Z", osMajor: 27, updateEnforcement: "declarative", enrollmentType: "supervised" };
const fs = normalizeDdmReport(future, DDM_OBSERVED_AT);
check("future-dated check-in → freshness unknown (not fresh)", fs.postureFreshness === "unknown");
check("future-dated check-in → raise step-up (fail closed)", fs.assurance === "raise_step_up");

// ── apple/device-management schema alignment (drift guard) ────────────────────
// Each substantive DdmDeviceReport field is mapped to its canonical Apple DDM
// status-item provenance (or declared config/transport-only), and every referenced
// key is in the pinned catalog — so a schema change on a new OS release fails here
// instead of drifting silently. Pinned to the SAME version as macos-posture.
check("DDM alignment pins a schema version (never HEAD)", /^\d+\.\d+$/.test(DDM_APPLE_SCHEMA_VERSION));
const ddmAliasFields = Object.keys(DDM_REPORT_APPLE_ALIASES).sort();
const ddmFields = [...DDM_REPORT_FIELDS].sort();
check("alias map covers EXACTLY the substantive DdmDeviceReport fields", ddmAliasFields.length === ddmFields.length && ddmAliasFields.every((k, i) => k === ddmFields[i]));
const ddmStatusItems = new Set<string>(DDM_APPLE_STATUS_ITEMS);
for (const field of DDM_REPORT_FIELDS) {
  const alias = DDM_REPORT_APPLE_ALIASES[field];
  check(`${field}: has a mapping entry`, alias !== undefined);
  if (alias.ddmStatusItem !== undefined) {
    check(`${field}: DDM status item '${alias.ddmStatusItem}' is in the pinned catalog`, ddmStatusItems.has(alias.ddmStatusItem));
  }
  // Traceable: maps to a DDM status item, or explicitly declares it is config-/
  // transport-only (a note) — never silently unmapped.
  check(`${field}: is traceable (DDM status item) or declared config/transport-only`, alias.ddmStatusItem !== undefined || (typeof alias.note === "string" && alias.note.length > 0));
}
// Honesty: config-declared / transport-level facts must NOT claim a status item.
for (const field of ["binaryControl", "privacy", "lastCheckInAt"] as const) {
  check(`${field}: no fabricated DDM status key (config/transport-only)`, DDM_REPORT_APPLE_ALIASES[field].ddmStatusItem === undefined && typeof DDM_REPORT_APPLE_ALIASES[field].note === "string");
}
check("osMajor → device.operating-system.version", DDM_REPORT_APPLE_ALIASES.osMajor.ddmStatusItem === "device.operating-system.version");

// ── THE PIN, HELD AGAINST APPLE'S OWN YAML ───────────────────────────────────
//
// Both alignment headers promised that a schema change "surfaces as a failing check".
// Nothing read Apple's schema: the checks above compare the catalog to itself, and a
// self-consistent catalog survives any upstream change untouched. The pinned items are
// now vendored verbatim at APPLE_SCHEMA_PIN_SHA under third_party/apple-device-management/
// and resolved here, one by one.
//
// A tiny line reader rather than a YAML parser, deliberately: the three facts read
// (`statusitemtype`, the top-level `payloadkeys` names, and one `rangelist`) are flat
// lines in Apple's generated files, and a parser dependency for three greps is the kind
// of thing that ends up unpinned. VACUITY FLOORS come first — a reader that finds
// nothing must never read as agreement.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendorDir = resolve(repoRoot, APPLE_SCHEMA_VENDOR_DIR);

/** `payload:` → `statusitemtype: <name>`. */
function statusItemTypeOf(yaml: string): string | null {
  const m = /^\s{2}statusitemtype:\s*(\S+)\s*$/m.exec(yaml);
  return m ? m[1] : null;
}
/** Every `- key: <name>` in the file — Apple names the status value key after the item. */
function payloadKeyNames(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-\s*key:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}
/** The `rangelist:` block's values (the first one in the file). */
function rangeList(yaml: string): string[] {
  const m = /^\s*rangelist:\n((?:\s*-\s*\S+\n)+)/m.exec(yaml);
  return m ? [...m[1].matchAll(/-\s*(\S+)/g)].map((x) => x[1]) : [];
}

check("the pin names an upstream COMMIT, not just a release", /^[0-9a-f]{40}$/.test(APPLE_SCHEMA_PIN_SHA));
const pinnedItems = [...new Set<string>([...DDM_APPLE_STATUS_ITEMS, ...APPLE_DDM_STATUS_ITEMS])].sort();
check(`vacuity floor: both catalogs together pin >= 10 status items (found ${pinnedItems.length})`, pinnedItems.length >= 10);
check("vacuity floor: the vendored directory exists", existsSync(vendorDir));
for (const item of pinnedItems) {
  const file = resolve(vendorDir, `${item}.yaml`);
  if (!existsSync(file)) {
    check(`${item}: resolves to a vendored file`, false);
    continue;
  }
  check(`${item}: resolves to a vendored file`, true);
  const yaml = readFileSync(file, "utf8");
  check(`${item}: the vendored file's statusitemtype IS the pinned name`, statusItemTypeOf(yaml) === item);
  const keys = payloadKeyNames(yaml);
  check(`${item}: the vendored file declares payload keys (parse floor)`, keys.length > 0);
  check(`${item}: the status value key this connector reads is present`, keys.includes(item));
}
// The one place the connector copies a value list OUT of Apple's schema: if Apple adds a
// sixth enrollment type, this diverges instead of the connector silently calling it unknown.
const enrollmentPath = resolve(vendorDir, "mdm.enrollment-type.yaml");
check("mdm.enrollment-type: the vendored file is readable (named, not a stack trace)", existsSync(enrollmentPath));
const enrollmentYaml = existsSync(enrollmentPath) ? readFileSync(enrollmentPath, "utf8") : "";
const appleEnrollment = rangeList(enrollmentYaml).sort();
const ourEnrollment = [...DDM_ENROLLMENT_TYPES].sort();
check(`mdm.enrollment-type: Apple's rangelist parsed (floor, found ${appleEnrollment.length})`, appleEnrollment.length > 0);
check(
  `mdm.enrollment-type: the connector's value list EQUALS Apple's rangelist (apple: ${appleEnrollment.join("|")})`,
  appleEnrollment.length === ourEnrollment.length && appleEnrollment.every((v, i) => v === ourEnrollment[i]),
);
// The connector's return-to-service applicability table is copied OUT of Apple's
// `supportedOS` block. If Apple ships the item on macOS, or moves its introduction, this
// diverges instead of the connector silently stepping a fleet up or letting one through.
/** `supportedOS:` → { family: introduced major | null for n/a }. */
function supportedOs(yaml: string): Record<string, number | null> {
  const block = yaml.slice(yaml.indexOf("supportedOS:"), yaml.indexOf("payloadkeys:"));
  const out: Record<string, number | null> = {};
  for (const m of block.matchAll(/^ {4}(\w+):\n {6}introduced:\s*'?([^'\s]+)'?\s*$/gm)) out[m[1]] = m[2] === "n/a" ? null : Number.parseInt(m[2], 10);
  return out;
}
const rtsPath = resolve(vendorDir, "mdm.is-return-to-service.yaml");
const rtsYaml = existsSync(rtsPath) ? readFileSync(rtsPath, "utf8") : "";
const appleRts = supportedOs(rtsYaml);
check(`mdm.is-return-to-service: Apple's supportedOS parsed (floor, found ${Object.keys(appleRts).length})`, Object.keys(appleRts).length === DDM_PLATFORMS.length);
check(
  `mdm.is-return-to-service: RETURN_TO_SERVICE_INTRODUCED EQUALS Apple's supportedOS (apple: ${JSON.stringify(appleRts)})`,
  DDM_PLATFORMS.every((p) => p in appleRts && appleRts[p] === RETURN_TO_SERVICE_INTRODUCED[p]),
);
check("self-test: macOS flipped from n/a in a COPY diverges from the table", supportedOs(rtsYaml.replace("macOS:\n      introduced: n/a", "macOS:\n      introduced: '27.0'")).macOS !== RETURN_TO_SERVICE_INTRODUCED.macOS);
const familyYaml = existsSync(resolve(vendorDir, "device.operating-system.family.yaml")) ? readFileSync(resolve(vendorDir, "device.operating-system.family.yaml"), "utf8") : "";
check("device.operating-system.family: the connector's platform list EQUALS Apple's supportedOS families", Object.keys(supportedOs(familyYaml)).sort().join() === [...DDM_PLATFORMS].sort().join());

// SELF-TEST: the readers must be able to disagree. A copy of the file with a renamed
// statusitemtype and a dropped rangelist entry must be REPORTED, not absorbed.
// Sliced at `rangelist:` on purpose. A plain first-match replace of "- supervised"
// hits the `allowed-enrollments:` list higher up the file and leaves the rangelist
// untouched — the self-test then passes while proving nothing, which is exactly the
// shape it exists to rule out. It did, on the first run.
const rangeIdx = enrollmentYaml.indexOf("rangelist:");
check("self-test floor: the vendored file has a rangelist block to tamper with", rangeIdx > 0);
const tampered =
  enrollmentYaml.slice(0, rangeIdx).replace("statusitemtype: mdm.enrollment-type", "statusitemtype: mdm.enrollment-kind") +
  enrollmentYaml.slice(rangeIdx).replace("- supervised", "- overseen");
check("self-test: a renamed statusitemtype in a COPY is reported as a mismatch", statusItemTypeOf(tampered) !== "mdm.enrollment-type");
check("self-test: a rangelist value changed in a COPY diverges from the connector's list", !rangeList(tampered).includes("supervised"));

// ── determinism ───────────────────────────────────────────────────────────────
check("normalization is deterministic", JSON.stringify(normalizeDdmReports(DEMO_DDM_REPORTS, DDM_OBSERVED_AT)) === JSON.stringify(signals));

// ── summary ───────────────────────────────────────────────────────────────────
const sum = ddmSummary(signals, DEMO_DDM_REPORTS);
check("summary counts 15 devices", sum.devices === 15);
check("summary counts managed devices", sum.managed === 14);
check("summary counts binary-enforced devices", sum.binaryEnforced === 11);
check("summary counts dead update enforcement (legacy-on-27 / none)", sum.enforcementDead === 2);
check("summary counts at-risk update enforcement (legacy pre-27)", sum.enforcementAtRisk === 1);
check("summary counts supervised devices (an unknown enrollment is NOT counted)", sum.supervised === 12);
check("summary counts devices configured for return to service with app preservation (true only)", sum.returnToService === 1);
check("summary raiseStepUp = all but the two healthy devices", sum.raiseStepUp === 13);

const total = passed + failures.length;
console.log(`DDM-connector proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failures:\n  - " + failures.join("\n  - "));
  console.log(`summary=fail (${passed}/${total})`);
  process.exit(1);
}
console.log("DDM device signals normalize to decision dimensions, fail-closed (weak posture only raises assurance).");
console.log(`summary=pass (${passed}/${total})`);

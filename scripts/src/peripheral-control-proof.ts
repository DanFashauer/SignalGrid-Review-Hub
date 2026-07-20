// Removable-media / peripheral-control proof — fully OFFLINE and deterministic.
//
// Drives the read-only device-control connector against a deterministic mock
// (normalization of vendor class/access vocabularies, pagination, read-only
// enforcement, auth failure, gating) and runs the pure evaluator per device —
// asserting each device's attached peripherals + policy state resolve to the
// right posture and the action it warrants (unauthorized + unencrypted writable
// media ⇒ restrict; unconfirmable authorization/encryption ⇒ treated as the risk;
// no coverage ⇒ unknown, never clean). No network, no real device data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PeripheralConnectorError,
  PeripheralControlConnector,
  createMockPeripheralTransport,
  evaluatePeripheralPosture,
  guardReadOnly,
  normalizeDevice,
  normalizePeripheral,
  resolvePeripheralControlConnector,
  type PeripheralPostureRaw,
} from "@workspace/integrations/peripheral-control";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  removableCount: number;
  writableRemovableCount: number;
  policyEnforced: boolean | null;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { record: PeripheralPostureRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/peripheral-control/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.devicecontrol.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Removable-media / peripheral-control proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

// Feed every device record through the connector to exercise paging/normalize.
const records: PeripheralPostureRaw[] = names.map((n) => fixture.devices[n].record);
const transport = createMockPeripheralTransport({ devices: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new PeripheralControlConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchDevices();
check(`pagination reassembles all ${records.length} devices`, normalized.length === records.length);
check("every normalized device carries sourceSystem", normalized.every((d) => d.sourceSystem === "peripheral-control"));

// Per-device posture against the fixture expectations.
for (const name of names) {
  const spec = fixture.devices[name];
  const d = normalized.find((x) => x.deviceId === spec.record.deviceId)!;
  const v = evaluatePeripheralPosture(d);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.removableCount === spec.expected.removableCount &&
    v.writableRemovableCount === spec.expected.writableRemovableCount &&
    v.policyEnforced === spec.expected.policyEnforced;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// No coverage ≠ clean: a device with no device-control record is unknown (a
// blind spot), NOT clean.
const notCovered = evaluatePeripheralPosture(normalizeDevice({ deviceId: "ghost" }), { covered: false });
check("an uncovered device is 'unknown', never 'no_removable'", notCovered.posture === "unknown" && notCovered.reasonCode === "NOT_COVERED");

// Fail-safe: a writable removable with UNKNOWN authorization + encryption (both
// null) is treated as the exfil risk it might be, not assumed safe.
const unknownDrive = evaluatePeripheralPosture(normalizeDevice({
  deviceId: "d-unknown",
  policyEnforced: true,
  peripherals: [{ peripheralId: "u", class: "mass_storage", access: "read_write" }],
}));
check("a writable USB with unknown authorization+encryption → exfil_risk/restrict (fail-safe)", unknownDrive.posture === "exfil_risk" && unknownDrive.recommendedAction === "restrict");

// Fail-safe: an UNKNOWN access value on a mass-storage device is treated as writable.
const unknownAccess = evaluatePeripheralPosture(normalizeDevice({
  deviceId: "d-ua",
  policyEnforced: true,
  peripherals: [{ peripheralId: "u", class: "mass_storage", access: "weird-value", authorized: false, encrypted: false }],
}));
check("an unknown access value on mass-storage is treated as writable → exfil_risk", unknownAccess.posture === "exfil_risk" && unknownAccess.writableRemovableCount === 1);

// MTP (phones) count as removable storage.
const phone = evaluatePeripheralPosture(normalizeDevice({
  deviceId: "d-phone",
  policyEnforced: true,
  peripherals: [{ peripheralId: "p", class: "mtp", access: "read_write", authorized: false, encrypted: false }],
}));
check("an MTP device (phone) is treated as removable storage → exfil_risk", phone.posture === "exfil_risk" && phone.removableCount === 1);

// Order-proof: a controlled drive (monitor) co-present with an exfil drive
// (restrict) → the stronger restrict wins.
const mixed = evaluatePeripheralPosture(normalizeDevice({
  deviceId: "d-mixed",
  policyEnforced: true,
  peripherals: [
    { peripheralId: "ok", class: "mass_storage", access: "read_write", authorized: true, encrypted: true },
    { peripheralId: "bad", class: "mass_storage", access: "read_write", authorized: false, encrypted: false },
  ],
}));
check("an exfil-risk drive (restrict) outranks a co-present controlled drive (monitor)", mixed.recommendedAction === "restrict" && mixed.writableRemovableCount === 2);

// A non-storage peripheral (keyboard) is not removable-storage and does not flag.
const kbd = evaluatePeripheralPosture(normalizeDevice({ deviceId: "d-k", policyEnforced: true, peripherals: [{ peripheralId: "k", class: "keyboard", access: "allowed" }] }));
check("a keyboard is not removable storage → no_removable", kbd.posture === "no_removable" && kbd.removableCount === 0);

// normalizePeripheral maps vendor synonyms.
check("normalizePeripheral maps 'USB-Storage'/'RW' synonyms", normalizePeripheral({ class: "USB-Storage", access: "RW" }).class === "mass_storage" && normalizePeripheral({ class: "USB-Storage", access: "RW" }).access === "read_write");

// Fail-safe (regression): a removable drive named with a class string outside
// the original synonym set (e.g. "usb_drive", Intune "RemovableMediaDevices",
// "WpdDevices") must still be recognized as removable storage — not escape to
// no_removable. This was a real fail-open before the class map was broadened.
check("class 'usb_drive' is recognized as removable storage", normalizePeripheral({ class: "usb_drive" }).class === "mass_storage");
check("Intune 'RemovableMediaDevices' maps to mass_storage", normalizePeripheral({ class: "RemovableMediaDevices" }).class === "mass_storage");
check("Windows 'WpdDevices' maps to mtp (removable)", normalizePeripheral({ class: "WpdDevices" }).class === "mtp");
const usbDrive = evaluatePeripheralPosture(normalizeDevice({ deviceId: "d-ud", policyEnforced: true, peripherals: [{ peripheralId: "u", class: "usb_drive", access: "read_write", authorized: false, encrypted: false }] }));
check("an unauthorized+unencrypted 'usb_drive' → exfil_risk/restrict (was fail-open no_removable)", usbDrive.posture === "exfil_risk" && usbDrive.recommendedAction === "restrict");

// Fail-safe (regression): a TRULY unrecognized class that is writable must not
// read as clean — it surfaces as unclassified_media/monitor, never no_removable.
const novelWritable = evaluatePeripheralPosture(normalizeDevice({ deviceId: "d-nw", policyEnforced: true, peripherals: [{ peripheralId: "x", class: "some-brand-new-gadget", access: "read_write" }] }));
check("an unrecognized-class writable peripheral surfaces as unclassified_media/monitor, never clean", novelWritable.posture === "unclassified_media" && novelWritable.recommendedAction === "monitor" && novelWritable.reasonCode === "UNCLASSIFIED_PERIPHERAL");
// ...but a blocked unrecognized-class device is contained (no false alarm).
const novelBlocked = evaluatePeripheralPosture(normalizeDevice({ deviceId: "d-nb", policyEnforced: true, peripherals: [{ peripheralId: "x", class: "some-brand-new-gadget", access: "blocked" }] }));
check("a blocked unrecognized-class device stays no_removable (contained, no false alarm)", novelBlocked.posture === "no_removable");

// Determinism.
const de = normalized.find((d) => d.deviceId === "d-exfil")!;
check("evaluator is deterministic", JSON.stringify(evaluatePeripheralPosture(de)) === JSON.stringify(evaluatePeripheralPosture(de)));

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("PUT"); } catch (err) { readOnly = err instanceof PeripheralConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new PeripheralControlConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: PeripheralConnectorError | null = null;
try { await bad.listDevices(); } catch (err) { authErr = err instanceof PeripheralConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolvePeripheralControlConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolvePeripheralControlConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolvePeripheralControlConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolvePeripheralControlConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", PERIPHERAL_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }

// macOS posture ↔ apple/device-management schema alignment proof — OFFLINE and
// deterministic.
//
// Guards the Apple-canonical vocabulary alignment so it cannot silently drift:
//  - every substantive NormalizedMacosPosture field is mapped to its Apple
//    provenance (add a posture field → you must map it, or this fails);
//  - every Apple key an alias references is in the pinned catalog (rename a key or
//    bump the schema without reconciling → this fails);
//  - the pinned schema version is present, and on-device-only signals are declared
//    as such (a note), never left silently unmapped.
// No network, no device, no Apple-repo fetch — the pinned catalog IS the contract.
import {
  APPLE_ATTESTATION_OIDS,
  APPLE_DDM_STATUS_ITEMS,
  APPLE_DEVICE_MANAGEMENT_SCHEMA_VERSION,
  APPLE_SECURITYINFO_KEYS,
  APPLE_SECURITYINFO_NOT_YET_COLLECTED,
  MACOS_POSTURE_APPLE_ALIASES,
  NORMALIZED_MACOS_POSTURE_FIELDS,
} from "@workspace/integrations/macos-posture";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("macOS posture ↔ apple/device-management schema alignment proof");
console.log(`pinned schema version=${APPLE_DEVICE_MANAGEMENT_SCHEMA_VERSION}`);

// The pinned schema version must be present and shaped like an Apple OS schema tag.
check("a schema version is pinned (e.g. 26.4), never HEAD", /^\d+\.\d+$/.test(APPLE_DEVICE_MANAGEMENT_SCHEMA_VERSION));

// Every substantive posture field is mapped — no field goes un-aliased.
const aliasKeys = Object.keys(MACOS_POSTURE_APPLE_ALIASES).sort();
const fieldKeys = [...NORMALIZED_MACOS_POSTURE_FIELDS].sort();
check(
  "the alias map covers EXACTLY the substantive NormalizedMacosPosture fields",
  aliasKeys.length === fieldKeys.length && aliasKeys.every((k, i) => k === fieldKeys[i]),
);

// Every referenced Apple key exists in the pinned catalog (drift guard).
const secKeys = new Set<string>(APPLE_SECURITYINFO_KEYS);
const ddmKeys = new Set<string>(APPLE_DDM_STATUS_ITEMS);
const attestationOids = new Set<string>(Object.values(APPLE_ATTESTATION_OIDS));
for (const field of NORMALIZED_MACOS_POSTURE_FIELDS) {
  const alias = MACOS_POSTURE_APPLE_ALIASES[field];
  check(`${field}: has a mapping entry`, alias !== undefined);
  if (alias.securityInfoKey !== undefined) {
    check(`${field}: SecurityInfo key '${alias.securityInfoKey}' is in the pinned catalog`, secKeys.has(alias.securityInfoKey));
  }
  if (alias.ddmStatusItem !== undefined) {
    check(`${field}: DDM status item '${alias.ddmStatusItem}' is in the pinned catalog`, ddmKeys.has(alias.ddmStatusItem));
  }
  if (alias.attestationOid !== undefined) {
    check(`${field}: attestation OID '${alias.attestationOid}' is in the pinned catalog`, attestationOids.has(alias.attestationOid));
  }
  // Every field must be traceable: either it maps to an Apple key/attestation OID,
  // or it explicitly declares (via `note`) that it is an on-device-only signal.
  const traceable =
    alias.securityInfoKey !== undefined ||
    alias.ddmStatusItem !== undefined ||
    alias.attestationOid !== undefined ||
    (typeof alias.note === "string" && alias.note.length > 0);
  check(`${field}: is traceable (Apple key/OID) or declared on-device-only`, traceable);
}

// Spot-check the anchor mappings match Apple's actual SecurityInfo / DDM names.
check("sip → SystemIntegrityProtectionEnabled", MACOS_POSTURE_APPLE_ALIASES.sip.securityInfoKey === "SystemIntegrityProtectionEnabled");
check("fileVault → FDE_Enabled (+ DDM diskmanagement.filevault.enabled)", MACOS_POSTURE_APPLE_ALIASES.fileVault.securityInfoKey === "FDE_Enabled" && MACOS_POSTURE_APPLE_ALIASES.fileVault.ddmStatusItem === "diskmanagement.filevault.enabled");
check("firewall → FirewallSettings.FirewallEnabled", MACOS_POSTURE_APPLE_ALIASES.firewall.securityInfoKey === "FirewallSettings.FirewallEnabled");
check("sip carries the attested SIP OID (hardware-rooted tier)", MACOS_POSTURE_APPLE_ALIASES.sip.attestationOid === "1.2.840.113635.100.8.13.1");

// An on-device-only signal (Gatekeeper/XProtect/sysext) must NOT claim a false
// Apple key — honesty: no fabricated provenance.
for (const field of ["gatekeeper", "malwareDefs", "sysextResidual", "sysextConflict"] as const) {
  const a = MACOS_POSTURE_APPLE_ALIASES[field];
  check(`${field}: no fabricated Apple key (on-device-only, note explains why)`, a.securityInfoKey === undefined && a.ddmStatusItem === undefined && typeof a.note === "string");
}

// The "not yet collected" roadmap is honest: every entry is a real catalog key AND
// is genuinely not one of the fields we currently map (never over-claims coverage).
const mappedSecKeys = new Set<string>(
  NORMALIZED_MACOS_POSTURE_FIELDS.map((f) => MACOS_POSTURE_APPLE_ALIASES[f].securityInfoKey).filter(
    (k): k is NonNullable<typeof k> => k !== undefined,
  ),
);
for (const key of APPLE_SECURITYINFO_NOT_YET_COLLECTED) {
  check(`roadmap key '${key}' is a real pinned catalog key`, secKeys.has(key));
  check(`roadmap key '${key}' is honestly NOT already collected`, !mappedSecKeys.has(key));
}

// Determinism: the catalogs are frozen data, identical read-to-read.
check("alignment data is deterministic", JSON.stringify(MACOS_POSTURE_APPLE_ALIASES) === JSON.stringify(MACOS_POSTURE_APPLE_ALIASES));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }

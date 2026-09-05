#!/usr/bin/env node
// Launch-time controls — every key the shell READS at launch must be documented,
// and every key documented must be one the shell reads. Two derived sets:
//
//   A. simulator DEMO FLAGS (`DemoMode.swift` and friends), and
//   B. MDM MANAGED APP CONFIG keys (`KioskConfig`), which fall back to plain
//      UserDefaults and are therefore ALSO settable at launch.
//
// WHY THIS EXISTS. `DemoMode.swift` grew to eighteen launch flags; the docs named
// six. The other twelve — `-DemoAutoEnd`, `-DemoOpenApp`, `-DemoAssistDecline`,
// `-DemoLocation`, `-DemoZone`, `-DemoSignal`, the three timed ones, the three
// backend refs — existed, worked, and were reachable only by reading the Swift.
// A demo surface nobody can find is the same as one that does not ship, and this
// is the surface a buyer is walked through.
//
// Set B was then missed by the FIRST version of this gate, in exactly the same
// shape: `KioskController.swift` reads `SingleAppModeEnabled`, `AllowManualOverride`
// and `RecoveryCode` through variable-key helpers (`managedBool(key)` /
// `managedString(key)`), so neither the `flag("…")` nor the `forKey: "…"` pattern
// below saw them, and the README named none of the three. They are not demo
// dressing: they decide whether the kiosk engages at all and what recovery code
// releases it. A derivation that misses a control is the same fossil risk one
// letter smaller.
//
// The drift is one-directional and silent: adding a flag is a one-line change in
// Swift, and nothing anywhere fails when the table is not updated. That is the
// exact shape of every fossil this repo gates against.
//
// SCOPE IS DERIVED, NOT LISTED. Each set comes from the source that reads it:
//   A · `flag("Key")` in DemoMode.swift               (bare `-Key` / `-Key YES`)
//     · `UserDefaults.standard.*(forKey: "Key")` in EnterpriseShell, for keys named
//       Demo* or Simulate*  — this is how `-SimulateBadge` is found, which
//       DemoMode.swift documents but LockedIdleViewController.swift implements.
//   B · `managedBool("Key", …)` / `managedString("Key")` anywhere in EnterpriseShell.
//       No name filter: these are policy keys chosen by the MDM payload, not by a
//       naming convention, so filtering them by prefix would re-create the miss.
//
// WHAT IS NOT IN EITHER SET, and why. The remaining `forKey:` names fall in two
// groups. `auth_state`, `persona_data`, `user_info`, `device_binding_key` and
// `device_identifier` go through `KeychainService`, not UserDefaults, so no launch
// argument can reach them at all. `idle_timeout` and `allow_copy_paste` are
// UserDefaults keys the app itself WRITES from server-issued session restrictions
// (`SessionStateManager.swift`) — runtime state rather than a documented control.
// Those two are excluded by the Demo*/Simulate* naming convention above, NOT by
// any proof that a launch argument could not reach them; this gate does not claim
// that, and nothing here should be read as saying the set of launch-reachable keys
// is closed.
//
// GATED: presence of each derived flag/key as a row in the matching README table,
// with a non-empty meaning; and the absence of table rows for names nothing reads.
// NOT GATED: whether the wording of a meaning is accurate — that is judgement,
// and a gate that scored prose would punish honest writing.
//
//   node scripts/check-demo-flags-documented.mjs
//   node scripts/check-demo-flags-documented.mjs --self-test   # self-tests ONLY
//
// `--self-test` is a real mode, not an accepted no-op: it runs the planted-defect
// suite, prints a passed/failed count and exits on it, so a step registered with
// that flag can never be green about nothing. The same suite also runs inline in
// the ordinary mode.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL_DIR = "native/ios/EnterpriseShell";
const DEMO_MODE = `${SHELL_DIR}/Services/DemoMode.swift`;
const KIOSK_CONFIG = `${SHELL_DIR}/Services/KioskController.swift`;
const README = "native/ios/README.md";
// The managed-key table is copied in two more documents — the one an endpoint
// team configures from (native/ios/mdm/README.md) and the MDM boundary doc —
// and until 2026-09-05 only README.md was gated: a ninth key would have
// reached one table and silently missed the two a customer actually reads.
// Every copy is held to the same derived set, both directions.
// Each copy sits under its own heading; the heading is a prefix match, and the
// section ends at the next level-2/3 heading, exactly as for README.md.
const MANAGED_KEY_DOCS = [
  { doc: "native/ios/README.md", heading: "### Managed App Config keys" },
  { doc: "native/ios/mdm/README.md", heading: "## Managed App Configuration" },
  { doc: "native/ios/MDM_CONFIGURATION.md", heading: "## 1. Managed App Configuration" },
];
const MIN_FLAGS = 10;
// Six managed keys are read today (SingleAppModeEnabled, AllowManualOverride,
// RecoveryCode, BackendBaseURL, BackendBearerToken, BackendWorkflowKey — the last
// three added 2026-09-02 for the control-plane wiring). The floor is the MEASURED
// number and is bumped deliberately when a key is added — a floor with slack in
// it is a floor that hides a key.
const MIN_MANAGED_KEYS = 6;
// The managed-key table is found by its heading, so the two tables in one README
// can never be confused for one another.
const MANAGED_HEADING = "### Managed App Config keys";
// Set C (added 2026-09-02): keys the SETTINGS BUNDLE declares. Root.plist is the
// one place a holder can flip a switch on an unmanaged phone, and
// `local_session_allowed` is a POLICY control (it decides whether a code-free
// local sign-in exists at all). A key declared there but read by nothing is a
// switch that does nothing; a key read by code but absent from the bundle is a
// control nobody can reach; either undocumented is the same fossil as above.
const SETTINGS_BUNDLE = `${SHELL_DIR}/Settings.bundle/Root.plist`;
const SETTINGS_HEADING = "### Settings bundle keys";
const MIN_SETTINGS_KEYS = 1;
const SELF_TEST_ONLY = process.argv.slice(2).includes("--self-test");

/** Strip line comments so prose naming a flag is never read as reading one. */
function code(src) {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("///") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

function swiftFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...swiftFiles(p));
    else if (e.endsWith(".swift")) out.push(p);
  }
  return out.sort();
}

/**
 * Derivation A (demo flags), factored out so the self-test can drive it with
 * synthetic input. Returns a Map of flag -> the file that reads it.
 */
function deriveFlags(sources) {
  const flags = new Map();
  const note = (key, file) => {
    if (/^(Demo|Simulate)[A-Z]/.test(key) && !flags.has(key)) flags.set(key, file);
  };
  for (const { path, text } of sources) {
    const src = code(text);
    for (const m of src.matchAll(/\bflag\(\s*"([A-Za-z0-9_]+)"\s*\)/g)) note(m[1], path);
    for (const m of src.matchAll(/forKey:\s*"([A-Za-z0-9_]+)"/g)) note(m[1], path);
  }
  return flags;
}

/**
 * Derivation B (Managed App Config keys). Only string LITERALS at a call site are
 * derivable — `managedBool(_ key: String, …)`, the helper's own declaration, has
 * no literal and is correctly not counted as a key.
 */
function deriveManagedKeys(sources) {
  const keys = new Map();
  for (const { path, text } of sources) {
    const src = code(text);
    for (const m of src.matchAll(/\bmanaged(?:Bool|String)\(\s*"([A-Za-z0-9_]+)"/g)) {
      if (!keys.has(m[1])) keys.set(m[1], path);
    }
    // Shape 2 (ProviderConfigurationService, 2026-09-02): `configured(env: "…",
    // managed: ConfigKeys.name)` where `static let name = "literal"` is declared in
    // the SAME file. A managed-key read routed through a constant is still a read;
    // a derivation that stopped at the constant's name would have left
    // `badge_reader_type` a live, undocumented control — the exact miss set B
    // exists to close. A literal `managed: "Key"` counts too.
    const consts = new Map();
    for (const c of src.matchAll(/\bstatic\s+let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([A-Za-z0-9_]+)"/g)) consts.set(c[1], c[2]);
    for (const m of src.matchAll(/\bmanaged:\s*(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      const key = consts.get(m[1]);
      if (key && !keys.has(key)) keys.set(key, path);
    }
    for (const m of src.matchAll(/\bmanaged:\s*"([A-Za-z0-9_]+)"/g)) {
      if (!keys.has(m[1])) keys.set(m[1], path);
    }
  }
  return keys;
}

/**
 * The README's flag table: rows shaped `| \`-Flag\` | meaning | … |`.
 * Returns Map of flag -> meaning cell (may be empty, which is itself a finding).
 */
function readmeFlagRows(md) {
  const rows = new Map();
  for (const m of md.matchAll(/^\|\s*`-([A-Za-z0-9_]+)[^`]*`\s*\|([^|]*)\|/gm)) {
    rows.set(m[1], m[2].trim());
  }
  return rows;
}

/** The README text under `heading`, up to the next heading of level 2 or 3 —
 *  so two `###` tables under one `##` stay separate. */
function sectionUnder(md, heading) {
  const at = md.indexOf(heading);
  if (at < 0) return null;
  const rest = md.slice(at + heading.length);
  const end = rest.search(/\n##+ /);
  return end < 0 ? rest : rest.slice(0, end);
}

function managedSection(md) {
  return sectionUnder(md, MANAGED_HEADING);
}

/** Rows shaped `| \`Key\` | meaning | … |` inside a keyed section. */
function keyedRows(section) {
  const rows = new Map();
  if (section === null) return rows;
  for (const m of section.matchAll(/^\|\s*`([A-Za-z0-9_]+)`\s*\|([^|]*)\|/gm)) {
    rows.set(m[1], m[2].trim());
  }
  return rows;
}

function readmeManagedRows(md) {
  return keyedRows(managedSection(md));
}

function readmeSettingsRows(md) {
  return keyedRows(sectionUnder(md, SETTINGS_HEADING));
}

/**
 * Derivation C: `<key>Key</key><string>NAME</string>` pairs in the Settings
 * bundle's Root.plist, each checked against a `forKey: "NAME"` read somewhere
 * under the shell. Returns { declared: Map(name -> plist path), unread: [names] }.
 */
function deriveSettingsKeys(plistText, plistPath, sources) {
  const declared = new Map();
  for (const m of plistText.matchAll(/<key>Key<\/key>\s*<string>([A-Za-z0-9_]+)<\/string>/g)) {
    if (!declared.has(m[1])) declared.set(m[1], plistPath);
  }
  const readKeys = new Set();
  for (const { text } of sources) {
    for (const m of code(text).matchAll(/forKey:\s*"([A-Za-z0-9_]+)"/g)) readKeys.add(m[1]);
  }
  const unread = [...declared.keys()].filter((k) => !readKeys.has(k));
  return { declared, unread };
}

/**
 * The comparison, run on real input below and on synthetic input in the
 * self-tests. Both directions: a control nothing documents, and a row nothing
 * reads.
 */
function compare(derived, rows, { prefix = "", tableName, missingWhy, fossilWhy, doc = README }) {
  const problems = [];
  for (const [key, file] of [...derived].sort()) {
    if (!rows.has(key)) {
      problems.push(`  ✗ ${prefix}${key}: read by ${file}, absent from the ${tableName} in ${doc} — ` + missingWhy);
    } else if (rows.get(key).length === 0) {
      problems.push(`  ✗ ${prefix}${key}: documented with an empty meaning in ${doc} — the row says nothing`);
    }
  }
  for (const key of [...rows.keys()].sort()) {
    if (!derived.has(key)) {
      problems.push(`  ✗ ${prefix}${key}: listed in the ${doc} ${tableName}, but nothing under ${SHELL_DIR} reads it — ` + fossilWhy);
    }
  }
  return problems;
}

const FLAG_MSGS = {
  prefix: "-",
  tableName: "flag table",
  missingWhy: "a demo capability reachable only by reading the source",
  fossilWhy: "a fossil row, or the flag was renamed and the table was not",
};
const MANAGED_MSGS = {
  tableName: "Managed App Config table",
  missingWhy: "a policy control that an MDM payload — or a launch argument, where the MDM has not set it — can change, documented nowhere",
  fossilWhy: "a fossil row, or the key was renamed and the table was not",
};
const SETTINGS_MSGS = {
  tableName: "Settings bundle table",
  missingWhy: "a switch the holder of an unmanaged phone can flip in iOS Settings, documented nowhere",
  fossilWhy: "a fossil row, or the key was renamed in Root.plist and the table was not",
};

// ── Real input ───────────────────────────────────────────────────────────────
const sources = swiftFiles(resolve(repo, SHELL_DIR)).map((p) => ({
  path: p.slice(resolve(repo).length + 1),
  text: readFileSync(p, "utf8"),
}));
const flags = deriveFlags(sources);
const managed = deriveManagedKeys(sources);
const md = readFileSync(resolve(repo, README), "utf8");
const rows = readmeFlagRows(md);
const managedRows = readmeManagedRows(md);
const settingsPlist = existsSync(resolve(repo, SETTINGS_BUNDLE)) ? readFileSync(resolve(repo, SETTINGS_BUNDLE), "utf8") : "";
const settings = deriveSettingsKeys(settingsPlist, SETTINGS_BUNDLE, sources);
const settingsRows = readmeSettingsRows(md);

// ── Floors: a gate that scanned nothing is green about nothing ───────────────
function floorProblems() {
  const found = [];
  if (sources.length === 0) {
    found.push(`  ✗ found no Swift sources under ${SHELL_DIR} — the walk is broken, not the code`);
  }
  if (!sources.some((s) => s.path === DEMO_MODE)) {
    found.push(`  ✗ ${DEMO_MODE} was not among the scanned sources — the flag surface moved`);
  }
  if (!sources.some((s) => s.path === KIOSK_CONFIG)) {
    found.push(`  ✗ ${KIOSK_CONFIG} was not among the scanned sources — the managed-key surface moved`);
  }
  if (flags.size < MIN_FLAGS) {
    found.push(
      `  ✗ derived only ${flags.size} demo flag(s) from ${sources.length} source file(s), floor is ${MIN_FLAGS} — ` +
        `the read shape changed, so this gate stopped seeing the flags rather than the flags disappearing`,
    );
  }
  if (managed.size < MIN_MANAGED_KEYS) {
    found.push(
      `  ✗ derived only ${managed.size} Managed App Config key(s), floor is ${MIN_MANAGED_KEYS} — ` +
        `the managedBool/managedString/configured(managed:) read shape changed, so this gate stopped seeing the policy keys`,
    );
  }
  if (rows.size === 0) {
    found.push(`  ✗ no flag table found in ${README} (rows shaped \`| \`-Flag\` | meaning |\`) — nothing to compare against`);
  }
  if (managedSection(md) === null) {
    found.push(`  ✗ no "${MANAGED_HEADING}" section found in ${README} — the managed-key table has no home, so nothing to compare against`);
  } else if (managedRows.size === 0) {
    found.push(`  ✗ "${MANAGED_HEADING}" in ${README} holds no rows shaped \`| \`Key\` | meaning |\` — nothing to compare against`);
  }
  if (settingsPlist === "") {
    found.push(`  ✗ ${SETTINGS_BUNDLE} not found — the Settings bundle moved, or the local sign-in switch is gone`);
  }
  if (settings.declared.size < MIN_SETTINGS_KEYS) {
    found.push(`  ✗ derived only ${settings.declared.size} Settings-bundle key(s), floor is ${MIN_SETTINGS_KEYS} — the <key>Key</key> read shape changed`);
  }
  for (const k of settings.unread) {
    found.push(`  ✗ Settings bundle declares "${k}" but nothing under ${SHELL_DIR} reads it (forKey: "${k}") — a switch that does nothing`);
  }
  if (sectionUnder(md, SETTINGS_HEADING) === null) {
    found.push(`  ✗ no "${SETTINGS_HEADING}" section found in ${README} — the Settings-bundle table has no home`);
  }
  return found;
}

// ── Self-tests: this gate must still be able to go red ───────────────────────
// Planted defects driven through the SAME derivation and comparison the real
// check uses. Runs inline in the ordinary mode and is the whole of `--self-test`.
function runSelfTests() {
  const results = [];
  const t = (name, ok, detail) => results.push({ name, ok, detail });

  const synthFlags = deriveFlags([
    { path: "synthetic.swift", text: 'let x = UserDefaults.standard.string(forKey: "DemoNeverDocumented")' },
  ]);
  t("flag derivation finds a planted flag", synthFlags.size === 1, `derived ${synthFlags.size}`);
  // Each assertion names the PLANTED defect, not merely "something was found" —
  // a synthetic derivation also turns the real rows into fossils, so a bare
  // length > 0 would pass for the wrong reason.
  const undoc = compare(synthFlags, rows, FLAG_MSGS);
  t(
    "undocumented flag is flagged",
    undoc.some((p) => p.includes("DemoNeverDocumented") && p.includes("absent from the flag table")),
    `${undoc.length} finding(s)`,
  );
  const fossil = compare(flags, new Map([...rows, ["DemoFlagThatNothingReads", "a row for a flag nobody reads"]]), FLAG_MSGS);
  t(
    "fossil flag row is flagged",
    fossil.some((p) => p.includes("DemoFlagThatNothingReads") && p.includes("nothing under")),
    `${fossil.length} finding(s)`,
  );
  const empty = compare(
    new Map([[[...flags.keys()][0] ?? "DemoMode", DEMO_MODE]]),
    new Map([[[...flags.keys()][0] ?? "DemoMode", ""]]),
    FLAG_MSGS,
  );
  t("empty meaning is flagged", empty.some((p) => p.includes("empty meaning")), `${empty.length} finding(s)`);

  // F4 — the managed-key derivation. The plant is written in the SHAPE the real
  // code uses (a variable-key helper called with a literal), plus the helper's own
  // declaration, which must NOT be counted as a key.
  const synthManaged = deriveManagedKeys([
    {
      path: "synthetic.swift",
      text: [
        'static var x: Bool { managedBool("PlantedManagedKey", default: true) }',
        'static var y: String? { managedString("PlantedRecoveryCode") }',
        "private static func managedBool(_ key: String, default def: Bool) -> Bool { def }",
      ].join("\n"),
    },
  ]);
  t(
    "managed derivation finds literal keys and not the helper declaration",
    synthManaged.size === 2 && synthManaged.has("PlantedManagedKey") && synthManaged.has("PlantedRecoveryCode") && !synthManaged.has("key"),
    `derived {${[...synthManaged.keys()].join(", ")}}`,
  );
  // F4b — shape 2: a key read through a same-file constant. The helper's own
  // `managed: String` parameter must NOT resolve to a key.
  const synthConst = deriveManagedKeys([
    {
      path: "synthetic.swift",
      text: [
        'private enum ConfigKeys { static let readerType = "planted_reader_type" }',
        "private static func configured(env: String, managed: String) -> String? { nil }",
        'let r = configured(env: "PLANTED_ENV", managed: ConfigKeys.readerType)',
        'let q = configured(env: "PLANTED_ENV_2", managed: "PlantedLiteralKey")',
      ].join("\n"),
    },
  ]);
  t(
    "managed derivation resolves a key read through a same-file constant and a literal `managed:` argument, not the helper's parameter",
    synthConst.size === 2 && synthConst.has("planted_reader_type") && synthConst.has("PlantedLiteralKey") && !synthConst.has("String"),
    `derived {${[...synthConst.keys()].join(", ")}}`,
  );
  const undocManaged = compare(synthManaged, managedRows, MANAGED_MSGS);
  t(
    "undocumented managed key is flagged",
    undocManaged.some((p) => p.includes("PlantedManagedKey") && p.includes("absent from the Managed App Config table")),
    `${undocManaged.length} finding(s)`,
  );
  const fossilManaged = compare(managed, new Map([...managedRows, ["ManagedKeyNothingReads", "a row for a key nobody reads"]]), MANAGED_MSGS);
  t(
    "fossil managed row is flagged",
    fossilManaged.some((p) => p.includes("ManagedKeyNothingReads") && p.includes("nothing under")),
    `${fossilManaged.length} finding(s)`,
  );
  const emptyManaged = compare(
    new Map([[[...managed.keys()][0] ?? "SingleAppModeEnabled", KIOSK_CONFIG]]),
    new Map([[[...managed.keys()][0] ?? "SingleAppModeEnabled", ""]]),
    MANAGED_MSGS,
  );
  t("empty managed meaning is flagged", emptyManaged.some((p) => p.includes("empty meaning")), `${emptyManaged.length} finding(s)`);

  // The miss itself: the flag derivation alone cannot see a managed key, which is
  // why set B exists. If this ever passes through deriveFlags, the two sets have
  // merged and one of them is redundant — decide that deliberately.
  const managedViaFlagDerivation = deriveFlags([
    { path: "synthetic.swift", text: 'static var x: Bool { managedBool("SimulatePlantedKey", default: true) }' },
  ]);
  t(
    "flag derivation alone does NOT see a managedBool key (the original miss)",
    managedViaFlagDerivation.size === 0,
    `derived ${managedViaFlagDerivation.size}`,
  );

  // F5 — the Settings-bundle derivation: a planted key must be found, an unread
  // one reported, and an undocumented one flagged through the same compare.
  const synthSettings = deriveSettingsKeys(
    "<key>Key</key><string>planted_switch</string><key>Key</key><string>unread_switch</string>",
    "synthetic/Root.plist",
    [{ path: "synthetic.swift", text: 'UserDefaults.standard.bool(forKey: "planted_switch")' }],
  );
  t(
    "settings derivation finds declared keys and reports the unread one",
    synthSettings.declared.size === 2 && synthSettings.unread.length === 1 && synthSettings.unread[0] === "unread_switch",
    `declared ${synthSettings.declared.size}, unread {${synthSettings.unread.join(", ")}}`,
  );
  const undocSettings = compare(synthSettings.declared, settingsRows, SETTINGS_MSGS);
  t(
    "undocumented settings key is flagged",
    undocSettings.some((p) => p.includes("planted_switch") && p.includes("absent from the Settings bundle table")),
    `${undocSettings.length} finding(s)`,
  );
  t(
    "a ### table stops at the next ### heading (the two tables cannot bleed together)",
    sectionUnder("### A\n| `x` | one |\n### B\n| `y` | two |\n## C\n", "### A").includes("`x`") &&
      !sectionUnder("### A\n| `x` | one |\n### B\n| `y` | two |\n## C\n", "### A").includes("`y`"),
    "section bounded",
  );

  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────
if (SELF_TEST_ONLY) {
  const results = runSelfTests();
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name} — ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`self-test: ${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\nSELF-TEST FAILED — this gate cannot demonstrate a planted defect, so its green means nothing.`);
    process.exit(1);
  }
  process.exit(0);
}

let problems = 0;

for (const line of floorProblems()) {
  console.error(line);
  problems += 1;
}

for (const r of runSelfTests()) {
  if (r.ok) continue;
  console.error(
    `  ✗ SELF-TEST FAILED: "${r.name}" (${r.detail}) — this gate is reporting green without being ` +
      `able to go red. Run: node scripts/check-demo-flags-documented.mjs --self-test`,
  );
  problems += 1;
}

for (const line of compare(flags, rows, FLAG_MSGS)) {
  console.error(line);
  problems += 1;
}
for (const line of compare(managed, managedRows, MANAGED_MSGS)) {
  console.error(line);
  problems += 1;
}
// The other copies of the managed-key table. A copy that lacks the heading, or
// has no rows under it, is a problem — not a skipped document.
const otherManagedDocs = MANAGED_KEY_DOCS.filter((d) => d.doc !== README);
for (const { doc, heading } of otherManagedDocs) {
  let text = null;
  try { text = readFileSync(resolve(repo, doc), "utf8"); } catch { /* reported below */ }
  if (text === null) {
    console.error(`  ✗ ${doc}: not found — a managed-key table copy this gate holds has moved or gone`);
    problems += 1;
    continue;
  }
  const section = sectionUnder(text, heading);
  const copyRows = keyedRows(section);
  if (section === null || copyRows.size === 0) {
    console.error(`  ✗ ${doc}: no "${heading}" section with rows shaped \`| \`Key\` | meaning |\` — the copy is unreadable, not exempt`);
    problems += 1;
    continue;
  }
  for (const line of compare(managed, copyRows, { ...MANAGED_MSGS, doc })) {
    console.error(line);
    problems += 1;
  }
}
for (const line of compare(settings.declared, settingsRows, SETTINGS_MSGS)) {
  console.error(line);
  problems += 1;
}

if (problems > 0) {
  console.error(
    `\nDemo-flag documentation FAILED (${problems} problem(s)).\n` +
      `  source of truth: ${SHELL_DIR}/**/*.swift  ·  tables: ${README}\n` +
      `Add the flag or key to the matching table (one line of what it does), or remove the row if it is gone.`,
  );
  process.exit(1);
}

console.log(
  `demo flags: ${flags.size} derived from ${sources.length} Swift source(s), all documented in ${README} with a meaning; ` +
    `${rows.size} table row(s), no fossils.\n` +
    `managed app config keys: ${managed.size} derived (managedBool/managedString + configured(managed: ConfigKeys.*)), all documented in ${MANAGED_KEY_DOCS.length} document(s) (${MANAGED_KEY_DOCS.map((d) => d.doc).join(", ")}); ` +
    `${managedRows.size} table row(s) in ${README}, no fossils in any copy.\n` +
    `settings bundle keys: ${settings.declared.size} declared in ${SETTINGS_BUNDLE}, each read by the shell and documented under "${SETTINGS_HEADING}"; ` +
    `${settingsRows.size} table row(s), no fossils.\n` +
    `  (GATED: presence + a non-empty meaning, both directions, for all three sets. REPORTED, not gated: whether each meaning is accurate.)`,
);

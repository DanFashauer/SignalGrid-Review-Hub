// Proof: the shipped MDM profiles say what the product claims they say.
//
// WHY THIS EXISTS. The kiosk claims — the shell may self-lock via Autonomous
// Single App Mode, the app cannot be removed, and only allow-listed apps run —
// are enforced ENTIRELY by these .mobileconfig files on a supervised device.
// Nothing else in this repo reads them: the decision core, the API and the iOS
// unit tests all pass whether or not the profile is correct, because the profile
// is only interpreted by iOS itself.
//
// So a silent drift here is invisible until someone stands in front of a real
// supervised iPad. The most likely drift is the cheapest to catch: the ASAM
// permitted-app list naming a bundle identifier the app no longer uses. iOS
// would simply not grant ASAM, the shell would fail to lock, and every gate in
// this repo would still be green.
//
// This asserts the profile against the TRACKED source for the bundle id
// (native/ios/Signing.xcconfig) rather than against a second copy of the string,
// so renaming the app breaks this proof instead of breaking a device. Said
// plainly, because the earlier version of this comment claimed more: that file's
// own header names an optional, gitignored `Signing.local.xcconfig` whose
// assignments WIN, and that is the file a real device build is signed with. So
// this proof binds the ASAM allow-lists to the identifier of the SIMULATOR
// build. It cannot see the identifier of the one configuration where ASAM has
// any effect. That is a limit of CI, not a coverage this proof has.
//
// Pure and offline: it parses the committed files. No device, no MDM server, no
// supervision required — this is exactly the part that can be proven before the
// hardware exists.
//
// EVERY PROFILE, EVERY PAYLOAD (2026-09-05). Until the sixth audit round the
// load-bearing assertions — no `com.apple.app_lock`, System scope, removal
// disallowed — ran against the kiosk profile only, and the Fleet profile was
// read at `PayloadContent[0]` only. Planting a real app_lock payload as a
// SECOND payload in the profile Fleet actually ships passed 18/18. The profile
// list is now derived from `git ls-files '*.mobileconfig'`, and every payload
// of every profile is held to the same rules, with UUID/identifier uniqueness
// across all of them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}`);
  }
}

// ── A minimal XML-plist reader ───────────────────────────────────────────────
// Only the subset .mobileconfig uses: dict, array, string, integer, true/false,
// data. Hand-rolled on purpose — `plutil` is macOS-only and this proof must run
// on the Linux CI runner, and a parser dependency for six node types is not worth
// the supply-chain surface.
type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

function parsePlist(xml: string): PlistValue {
  // Strip declaration, doctype and comments, then walk the tags. Stripping
  // runs to a FIXPOINT (CodeQL #73): a single pass can manufacture a new
  // marker from the fragments around a removed one (`<!<!-- -->--...`), so
  // one-shot replace is exactly the incomplete-sanitization shape the
  // fail-closed doctrine bans. Inputs are this repo's own committed profiles,
  // but a sanitizer that can be reassembled is wrong regardless of who feeds it.
  let body = xml;
  for (;;) {
    const next = body
      .replace(/<\?xml[^>]*\?>/g, "")
      .replace(/<!DOCTYPE[^>]*>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    if (next === body) break;
    body = next;
  }
  const tokens = body.match(/<\/?[a-zA-Z]+(?:\s[^>]*)?\/?>|[^<]+/g) ?? [];
  let i = 0;

  const decode = (s: string): string =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  function parseValue(): PlistValue {
    while (i < tokens.length && !tokens[i].startsWith("<")) i += 1; // skip whitespace text
    const tag = tokens[i];
    if (tag === undefined) throw new Error("unexpected end of plist");

    if (tag.startsWith("<true")) { i += 1; return true; }
    if (tag.startsWith("<false")) { i += 1; return false; }

    if (tag.startsWith("<string>") || tag.startsWith("<integer>") || tag.startsWith("<data>")) {
      const isInt = tag.startsWith("<integer>");
      i += 1;
      let text = "";
      while (i < tokens.length && !tokens[i].startsWith("</")) {
        if (!tokens[i].startsWith("<")) text += tokens[i];
        i += 1;
      }
      i += 1; // closing tag
      return isInt ? Number(text.trim()) : decode(text);
    }
    // Self-closing empties: <string/>, <array/>, <dict/>
    if (/^<(string|data)\s*\/>/.test(tag)) { i += 1; return ""; }
    if (/^<array\s*\/>/.test(tag)) { i += 1; return []; }
    if (/^<dict\s*\/>/.test(tag)) { i += 1; return {}; }

    if (tag.startsWith("<array>")) {
      i += 1;
      const out: PlistValue[] = [];
      for (;;) {
        while (i < tokens.length && !tokens[i].startsWith("<")) i += 1;
        if (tokens[i]?.startsWith("</array>")) { i += 1; return out; }
        out.push(parseValue());
      }
    }

    if (tag.startsWith("<dict>")) {
      i += 1;
      const out: { [k: string]: PlistValue } = {};
      for (;;) {
        while (i < tokens.length && !tokens[i].startsWith("<")) i += 1;
        if (tokens[i]?.startsWith("</dict>")) { i += 1; return out; }
        if (!tokens[i]?.startsWith("<key>")) throw new Error(`expected <key>, got ${tokens[i]}`);
        i += 1;
        let key = "";
        while (i < tokens.length && !tokens[i].startsWith("</key>")) {
          if (!tokens[i].startsWith("<")) key += tokens[i];
          i += 1;
        }
        i += 1;
        out[decode(key).trim()] = parseValue();
      }
    }

    if (tag.startsWith("<plist")) { i += 1; return parseValue(); }
    throw new Error(`unsupported plist node: ${tag}`);
  }

  return parseValue();
}

const asDict = (v: PlistValue): Record<string, PlistValue> =>
  (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, PlistValue>;

// ── The source of truth for the bundle identifier ────────────────────────────
// Read from project.yml, NOT hardcoded here — a second copy of the string would
// drift with the first and prove nothing.
// The shell's id lives in the tracked signing xcconfig (native/ios/Signing.xcconfig)
// since the iOS repair batch moved signing out of project.yml so a local, untracked
// override can carry a real team and id; project.yml now names only the TEST target's
// id, and reading the first literal there returned "com.enterprise.shell.tests" as the
// shell — which this proof then compared the ASAM allow-lists against. Read the shell's
// own value from the file that sets it.
const signingXcconfig = readFileSync(resolve(repo, "native/ios/Signing.xcconfig"), "utf8");
const bundleMatch = signingXcconfig.match(/^\s*PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([\w.\-]+)/m);
const APP_BUNDLE_ID = bundleMatch?.[1] ?? "";
check("Signing.xcconfig declares a PRODUCT_BUNDLE_IDENTIFIER for the shell", APP_BUNDLE_ID.length > 0);
check(`bundle id is not a test target (got "${APP_BUNDLE_ID}")`, !APP_BUNDLE_ID.endsWith(".tests"));

// ── Profile 1: the kiosk lockdown profile ────────────────────────────────────
const kiosk = asDict(parsePlist(readFileSync(resolve(repo, "native/ios/mdm/EnterpriseShell-Kiosk.mobileconfig"), "utf8")));

check("kiosk: is a Configuration profile", kiosk.PayloadType === "Configuration");
check("kiosk: System scope (device-wide, not per-user)", kiosk.PayloadScope === "System");
// A user-removable lockdown profile is not a lockdown: the next badge holder
// could simply delete it and keep the device.
check("kiosk: removal disallowed", kiosk.PayloadRemovalDisallowed === true);

const kioskContent = Array.isArray(kiosk.PayloadContent) ? kiosk.PayloadContent.map(asDict) : [];
check("kiosk: has exactly one payload", kioskContent.length === 1);
const restrictions = asDict(kioskContent[0]);
check("kiosk: payload is com.apple.applicationaccess", restrictions.PayloadType === "com.apple.applicationaccess");
check("kiosk: allowAppRemoval is false (non-removable app)", restrictions.allowAppRemoval === false);

const asam = Array.isArray(restrictions.autonomousSingleAppModePermittedAppIDs)
  ? (restrictions.autonomousSingleAppModePermittedAppIDs as PlistValue[])
  : [];
check("kiosk: declares ASAM permitted app IDs", asam.length > 0);
check(
  `kiosk: ASAM list contains the REAL bundle id "${APP_BUNDLE_ID}" — a drift here means iOS silently refuses ASAM and the shell never locks`,
  asam.includes(APP_BUNDLE_ID),
);

// The profile's own description explains why hard Single App Mode is absent; the
// absence itself is the load-bearing part. `com.apple.app_lock` cannot be exited
// by the app, so it would trap the device on the shell and defeat release-on-auth.
const kioskRaw = readFileSync(resolve(repo, "native/ios/mdm/EnterpriseShell-Kiosk.mobileconfig"), "utf8");
check(
  "kiosk: does NOT install hard Single App Mode (com.apple.app_lock) — the app cannot exit it",
  !/<string>com\.apple\.app_lock<\/string>/.test(kioskRaw),
);

// ── Profile 2: the Fleet-delivered restrictions profile ──────────────────────
const fleetProfile = asDict(parsePlist(readFileSync(resolve(repo, "fleet/profiles/signalgrid-restrictions.mobileconfig"), "utf8")));
const fleetContent = Array.isArray(fleetProfile.PayloadContent) ? fleetProfile.PayloadContent.map(asDict) : [];
const fleetRestrictions = asDict(fleetContent[0]);

check("fleet: is a Configuration profile", fleetProfile.PayloadType === "Configuration");
check("fleet: payload is com.apple.applicationaccess", fleetRestrictions.PayloadType === "com.apple.applicationaccess");
check("fleet: allowAppRemoval is false", fleetRestrictions.allowAppRemoval === false);

const fleetAsam = Array.isArray(fleetRestrictions.autonomousSingleAppModePermittedAppIDs)
  ? (fleetRestrictions.autonomousSingleAppModePermittedAppIDs as PlistValue[])
  : [];
check(
  `fleet: ASAM list contains the REAL bundle id "${APP_BUNDLE_ID}"`,
  fleetAsam.includes(APP_BUNDLE_ID),
);

// The allow-list is what lets an AUTHENTICATED worker reach their own apps. If the
// shell were missing from it the device would be unusable after login; if the list
// were empty the "restricted to admin-configured apps" claim would be hollow.
const allowList = Array.isArray(fleetRestrictions.allowListedAppBundleIDs)
  ? (fleetRestrictions.allowListedAppBundleIDs as PlistValue[])
  : [];
check("fleet: declares an app allow-list", allowList.length > 0);
check("fleet: the shell itself is allow-listed (or the device is unusable post-auth)", allowList.includes(APP_BUNDLE_ID));

// Every ASAM-permitted app must also be allow-listed — permitting an app to take
// the screen while forbidding it from running is a contradiction the device
// resolves by simply not working.
const asamNotAllowed = fleetAsam.filter((id) => !allowList.includes(id));
check(
  `fleet: every ASAM-permitted app is also allow-listed (offenders: ${asamNotAllowed.join(", ") || "none"})`,
  asamNotAllowed.length === 0,
);

// ── Every profile, every payload ─────────────────────────────────────────────
// Derived from the index, not hand-listed, so a third profile joins the rules
// by existing. A payload type outside the allow-list is a finding, not a skip:
// a new payload kind must be admitted here on purpose, with its own assertions.
const PAYLOAD_TYPES_ALLOWED = new Set(["com.apple.applicationaccess"]);
const profilePaths = execFileSync("git", ["ls-files", "*.mobileconfig"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .sort();
check(`the tracked profile set is non-empty and derived from git ls-files (${profilePaths.length} profile(s))`, profilePaths.length >= 2);
check("both known profiles are in the derived set", profilePaths.includes("native/ios/mdm/EnterpriseShell-Kiosk.mobileconfig") && profilePaths.includes("fleet/profiles/signalgrid-restrictions.mobileconfig"));

const seenIds = new Map<string, string>();
for (const rel of profilePaths) {
  const raw = readFileSync(resolve(repo, rel), "utf8");
  const top = asDict(parsePlist(raw));
  check(`${rel}: is a Configuration profile`, top.PayloadType === "Configuration");
  check(`${rel}: System scope (device-wide, not per-user)`, top.PayloadScope === "System");
  check(`${rel}: removal disallowed (a holder-removable lockdown is not a lockdown)`, top.PayloadRemovalDisallowed === true);
  check(`${rel}: does NOT install hard Single App Mode (com.apple.app_lock) ANYWHERE in the file`, !/<string>com\.apple\.app_lock<\/string>/.test(raw));
  const content = Array.isArray(top.PayloadContent) ? top.PayloadContent.map(asDict) : [];
  check(`${rel}: carries at least one payload`, content.length > 0);
  for (const [uuid, id, where] of [[top.PayloadUUID, top.PayloadIdentifier, `${rel} (top)`], ...content.map((p, i) => [p.PayloadUUID, p.PayloadIdentifier, `${rel} payload[${i}]`])] as [PlistValue, PlistValue, string][]) {
    for (const [label, v] of [["PayloadUUID", uuid], ["PayloadIdentifier", id]] as [string, PlistValue][]) {
      const key = `${label}:${String(v)}`;
      check(`${where}: ${label} is present and unique across every profile (${String(v)})`, typeof v === "string" && v.length > 0 && !seenIds.has(key));
      if (typeof v === "string") seenIds.set(key, where);
    }
  }
  content.forEach((p, i) => {
    check(`${rel} payload[${i}]: type "${String(p.PayloadType)}" is an admitted payload type`, typeof p.PayloadType === "string" && PAYLOAD_TYPES_ALLOWED.has(p.PayloadType));
  });
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("MDM profiles conform: supervised-only keys present, ASAM bound to the real bundle id, no hard Single App Mode.");

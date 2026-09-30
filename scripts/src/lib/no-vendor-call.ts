// The ONE no-vendor-call scanner (plan row 119).
//
// WHY THIS EXISTS.
//
// Five proofs (nac, uem, entitlement-binding, service-lifecycle,
// response-accountability) each carried their own copy of the pattern list that
// backs "no vendor-API call in any <family>/ source". Four copies held nine
// byte-identical patterns; response-accountability's held six. Executed against
// planted lines, a static `import axios`, a `superagent` import, an aliased
// `const send = fetch`, a `net.connect` and a dynamic `import("pg")` were ALL caught
// by the nine and ALL missed by the six — and that copy's non-vacuity check planted a
// single `fetch(...)`, the one class that survived, so it reported "the scan can
// actually fire" while three classes walked past. uem's copy had drifted a second
// way: its store.ts exemption was evaluated on the FILENAME before the pattern test,
// which switched all nine patterns off for that file — the exact shape nac-proof had
// already been fixed for after a planted ISE quarantine call hid behind it.
//
// This is `emit-gate-proof.ts`'s warning, come true: "four copies of a policy is four
// chances for one to drift permissive, and the drifted one is the one that ships."
// So there is one copy, and it is the STRICTEST of the five: all nine patterns, the
// exemption scoped to the reason (nac's `classify`), every file walked, and a
// non-empty floor.
//
// THE SELF-TEST plants one control PER PATTERN CLASS and requires each class's own
// pattern to fire on it. It also runs the controls against the drifted six-pattern
// list and requires that list to FAIL — so a shared list that shrinks back to the
// drifted shape fails the self-test, rather than passing on the one class that is left.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CLIENT_MODULES = "axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb";

/** Named so the config-storage exemption can be scoped to exactly these two. */
export const CLIENT_MODULE_REQUIRE = new RegExp(`\\brequire\\s*\\(\\s*['"](?:${CLIENT_MODULES})['"]`, "i");
export const CLIENT_MODULE_IMPORT = new RegExp(`\\bimport\\s*\\(\\s*['"](?:${CLIENT_MODULES})['"]`, "i");

/** One entry per pattern class, each with a planted control that ONLY its class needs to catch. */
export const VENDOR_CALL_CLASSES: ReadonlyArray<{ name: string; pattern: RegExp; planted: string }> = [
  { name: "direct call", pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
    planted: `await fetch("https://vendor/api");` },
  { name: "aliased fetch", pattern: /\b(?:const|let|var)\s+\w+\s*=\s*fetch\b/i,
    planted: `const send = fetch;` },
  { name: "client require", pattern: CLIENT_MODULE_REQUIRE,
    planted: `const request = require("superagent");` },
  { name: "client dynamic import", pattern: CLIENT_MODULE_IMPORT,
    planted: `const { Client } = await import("pg");` },
  { name: "client static import", pattern: /\bfrom\s+['"](?:axios|got|undici|node-fetch|superagent|request)['"]/i,
    planted: `import axios from "axios";` },
  { name: "node network module", pattern: /\bfrom\s+['"]node:(?:net|http|https|tls|dgram)['"]/i,
    planted: `import { request } from "node:https";` },
  { name: "http(s) request", pattern: /\bhttps?\.(?:request|get)\s*\(/i,
    planted: `https.request(opts, onResponse);` },
  { name: "raw socket", pattern: /\bnet\.(?:connect|createConnection)\s*\(/i,
    planted: `const s = net.connect(443, host);` },
  { name: "mutating method literal", pattern: /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    planted: `const init = { method: "POST" };` },
];

export const VENDOR_CALL_PATTERNS: ReadonlyArray<RegExp> = VENDOR_CALL_CLASSES.map((c) => c.pattern);

/**
 * The six-pattern list response-accountability-proof carried until row 119. Kept ONLY
 * as the self-test's negative control: the planted controls must be able to tell it
 * apart from the real list, or they are not testing anything.
 */
const DRIFTED_PERMISSIVE: ReadonlyArray<RegExp> = [
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
  /\brequire\s*\(\s*['"](?:axios|got|undici|node-fetch|ioredis|redis)['"]/i,
  /\bimport\s*\(\s*['"](?:axios|got|undici|node-fetch|ioredis|redis)['"]/i,
  /\bfrom\s+['"]node:(?:net|http|https|tls|dgram)['"]/i,
  /\bhttps?\.(?:request|get)\s*\(/i,
  /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
];

/** Names of the planted controls a pattern list lets through. Empty = every class fires. */
export function plantedControlsMissed(patterns: ReadonlyArray<RegExp>): string[] {
  return VENDOR_CALL_CLASSES.filter((c) => !patterns.some((re) => re.test(c.planted))).map((c) => c.name);
}

/**
 * Self-test. Returns the reasons it fails; empty means it passes.
 * Each class's OWN pattern must fire on its control (so a class cannot be "covered" by
 * a neighbour and then quietly deleted), the shared list must miss nothing, and the
 * drifted six-pattern list must miss something.
 */
export function vendorCallScanSelfTest(): string[] {
  const failures: string[] = [];
  for (const c of VENDOR_CALL_CLASSES)
    if (!c.pattern.test(c.planted)) failures.push(`class "${c.name}" does not fire on its own planted control`);
  const missed = plantedControlsMissed(VENDOR_CALL_PATTERNS);
  if (missed.length) failures.push(`shared list misses planted: ${missed.join(", ")}`);
  if (plantedControlsMissed(DRIFTED_PERMISSIVE).length === 0)
    failures.push("the drifted six-pattern list passes every planted control — the controls cannot tell drift apart");
  if (VENDOR_CALL_PATTERNS.length < DRIFTED_PERMISSIVE.length + 3)
    failures.push(`shared list has ${VENDOR_CALL_PATTERNS.length} patterns — fewer than the nine the strictest copy carried`);
  return failures;
}

const REDIS_CLIENT_MODULE = /\b(?:require|import)\s*\(\s*['"](?:ioredis|redis)['"]\s*\)/i;
const CONFIG_STORAGE_PATTERNS = new Set<RegExp>([CLIENT_MODULE_REQUIRE, CLIENT_MODULE_IMPORT]);

/**
 * "clean" = no banned pattern; "exempt" = a Redis-client load in a named
 * config-storage file and nothing else; "offender" = everything else.
 *
 * THE EXEMPTION IS SCOPED TO THE REASON, NOT TO THE FILE: a `fetch(` or
 * `method: "POST"` in an exempted file is an offender like anywhere else.
 */
export function classifyVendorCallLine(
  rel: string,
  line: string,
  configStorageFiles: ReadonlySet<string> = new Set(),
): "clean" | "exempt" | "offender" {
  const hits = VENDOR_CALL_PATTERNS.filter((re) => re.test(line));
  if (hits.length === 0) return "clean";
  if (
    configStorageFiles.has(rel) &&
    REDIS_CLIENT_MODULE.test(line) &&
    hits.every((re) => CONFIG_STORAGE_PATTERNS.has(re))
  ) return "exempt";
  return "offender";
}

export interface VendorCallScan {
  files: string[];
  offenders: string[];
  exempted: string[];
}

/**
 * Walks `dir` RECURSIVELY and scans EVERY file (not only `.ts` — a file the walk
 * skips is a file the guarantee silently stops covering). Comment lines are skipped.
 * A missing directory throws; callers must also assert `files.length > 0`.
 */
export function scanForVendorCalls(
  dir: string,
  configStorageFiles: ReadonlySet<string> = new Set(),
): VendorCallScan {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const files = walk(dir);
  const offenders: string[] = [];
  const exempted: string[] = [];
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      const verdict = classifyVendorCallLine(rel, line, configStorageFiles);
      if (verdict === "exempt") exempted.push(`${rel}:${i + 1}`);
      else if (verdict === "offender") offenders.push(`${rel}:${i + 1}`);
    });
  }
  return { files, offenders, exempted };
}

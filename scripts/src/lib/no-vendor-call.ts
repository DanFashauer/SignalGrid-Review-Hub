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

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLIENT_MODULES = "axios|got|undici|node-fetch|superagent|request|ky|ioredis|redis|pg|mysql2|mongodb";
/** Node's own network modules, with or without the `node:` prefix. */
const NODE_NET_MODULES = "(?:node:)?(?:net|http|https|http2|tls|dgram)";

/** Named so the config-storage exemption can be scoped to exactly these two. */
export const CLIENT_MODULE_REQUIRE = new RegExp(`\\brequire\\s*\\(\\s*['"](?:${CLIENT_MODULES})['"]`, "i");
export const CLIENT_MODULE_IMPORT = new RegExp(`\\bimport\\s*\\(\\s*['"](?:${CLIENT_MODULES})['"]`, "i");

/** One entry per pattern class, each with a planted control that ONLY its class needs to catch. */
export const VENDOR_CALL_CLASSES: ReadonlyArray<{ name: string; pattern: RegExp; planted: string }> = [
  { name: "direct call", pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
    planted: `await fetch("https://vendor/api");` },
  { name: "aliased fetch", pattern: /\b(?:const|let|var)\s+\w+\s*=\s*(?:(?:globalThis|window|self)\s*\.\s*)?fetch\b/i,
    planted: `const send = globalThis.fetch;` },
  { name: "client require", pattern: CLIENT_MODULE_REQUIRE,
    planted: `const request = require("superagent");` },
  { name: "client dynamic import", pattern: CLIENT_MODULE_IMPORT,
    planted: `const { Client } = await import("pg");` },
  { name: "client static import", pattern: new RegExp(`\\bfrom\\s+['"](?:${CLIENT_MODULES})['"]`, "i"),
    planted: `import axios from "axios";` },
  { name: "node network module", pattern: new RegExp(`\\bfrom\\s+['"]${NODE_NET_MODULES}['"]`, "i"),
    planted: `import { request } from "https";` },
  { name: "node network module load", pattern: new RegExp(`\\b(?:require|import)\\s*\\(\\s*['"]${NODE_NET_MODULES}['"]`, "i"),
    planted: `const https = require("https");` },
  { name: "non-literal module load", pattern: /\b(?:require|import)\s*\(\s*(?!['"\s)])/i,
    planted: "const m = await import(`${name}`);" },
  { name: "http(s) request", pattern: /\b(?:https?|http2)\.(?:request|get|connect)\s*\(/i,
    planted: `https.request(opts, onResponse);` },
  { name: "raw socket", pattern: /\b(?:net|tls)\.(?:connect|createConnection)\s*\(/i,
    planted: `const s = tls.connect(443, host);` },
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

const LOAD_CALL = /\b(?:require|import)\s*\(/gi;
const REDIS_LOAD = /\b(?:require|import)\s*\(\s*['"](?:ioredis|redis)['"]\s*\)/gi;
const STATIC_FROM = /\bfrom\s+['"][^'"]*['"]/i;
const CONFIG_STORAGE_PATTERNS = new Set<RegExp>([CLIENT_MODULE_REQUIRE, CLIENT_MODULE_IMPORT]);

/**
 * "clean" = no banned pattern; "exempt" = a Redis-client load in a named
 * config-storage file and nothing else; "offender" = everything else.
 *
 * THE EXEMPTION IS SCOPED TO THE REASON, NOT TO THE FILE OR THE LINE: a line in an
 * exempted file is skipped only when every module it loads is `redis`/`ioredis` and it
 * matches no other class. `await import("redis"); require("axios")` is an offender.
 */
export function classifyVendorCallLine(
  rel: string,
  line: string,
  configStorageFiles: ReadonlySet<string> = new Set(),
): "clean" | "exempt" | "offender" {
  const hits = VENDOR_CALL_PATTERNS.filter((re) => re.test(line));
  if (hits.length === 0) return "clean";
  const loads = line.match(LOAD_CALL)?.length ?? 0;
  const redisLoads = line.match(REDIS_LOAD)?.length ?? 0;
  if (
    configStorageFiles.has(rel) &&
    redisLoads > 0 &&
    redisLoads === loads &&
    !STATIC_FROM.test(line) &&
    hits.every((re) => CONFIG_STORAGE_PATTERNS.has(re))
  ) return "exempt";
  return "offender";
}

/**
 * The code on a line, or null when the line is ONLY comment. A line that opens with a
 * comment and then carries code (`/* note *\/ fetch(url)`) is NOT skipped: the code
 * after the last `*\/` is returned and scanned.
 */
function codeOf(line: string): string | null {
  const t = line.trim();
  if (t.startsWith("//")) return null;
  if (t.startsWith("*") || t.startsWith("/*")) {
    const end = t.lastIndexOf("*/");
    if (end === -1) return null;
    const rest = t.slice(end + 2).trim();
    return rest === "" || rest.startsWith("//") ? null : rest;
  }
  return line;
}

/** A call whose name and `(` are split across lines: `fetch` at a line's end, `(` opening the next code line. */
const DANGLING_CALLEE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|require|import)\s*$/i;

export interface VendorCallScan {
  files: string[];
  offenders: string[];
  exempted: string[];
}

/**
 * Walks `dir` RECURSIVELY and scans EVERY file (not only `.ts` — a file the walk
 * skips is a file the guarantee silently stops covering). Pure-comment lines are
 * skipped. A missing directory throws; callers must also assert `files.length > 0`.
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
    const code = readFileSync(f, "utf8").split("\n").map(codeOf);
    code.forEach((line, i) => {
      if (line === null) return;
      const next = code.slice(i + 1).find((l) => l !== null && l.trim() !== "");
      // A trailing `// note` must not hide the dangling callee; `://` in a URL is not a comment.
      const bare = line.replace(/(^|[^:])\/\/.*$/, "$1");
      const verdict = DANGLING_CALLEE.test(bare) && next?.trim().startsWith("(")
        ? "offender"
        : classifyVendorCallLine(rel, line, configStorageFiles);
      if (verdict === "exempt") exempted.push(`${rel}:${i + 1}`);
      else if (verdict === "offender") offenders.push(`${rel}:${i + 1}`);
    });
  }
  return { files, offenders, exempted };
}

/**
 * Planted files the self-test runs the REAL scan over. Every line tagged `// PLANT`
 * must come back an offender, every line tagged `// EXEMPT` must come back exempted,
 * and nothing else may be reported. A skip rule that blinds the loop — or an exemption
 * that swallows a second module — fails here, not only a shrunken pattern list.
 */
const PLANTED_TREE: Record<string, string> = {
  "calls.ts": [
    ...VENDOR_CALL_CLASSES.map((c) => `${c.planted} // PLANT`),
    `/* why */ await fetch("https://vendor/api"); // PLANT`,
    `const r = await fetch // PLANT`,
    `  ("https://vendor/api");`,
    `// await fetch("https://vendor/api") is prose, not a call`,
    ` * fetch("https://vendor/api") inside a doc comment`,
    `export const ok = 1;`,
  ].join("\n"),
  "nested/deep.js": `module.exports = require("axios"); // PLANT`,
  "store.ts": [
    `  const { Redis } = await import("ioredis"); // EXEMPT`,
    `  const r = await import("redis"); const a = require("axios"); // PLANT`,
    `  await fetch("https://vendor/api", { method: "POST" }); // PLANT`,
  ].join("\n"),
};

/**
 * Self-test. Returns the reasons it fails; empty means it passes.
 * Each class's OWN pattern must fire on its control (so a class cannot be "covered" by
 * a neighbour and then quietly deleted), the shared list must miss nothing, the drifted
 * six-pattern list must miss something, and the scan loop itself — walk, comment skip,
 * split-call join, exemption — must report exactly the planted tree's tagged lines.
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

  const root = mkdtempSync(join(tmpdir(), "no-vendor-call-"));
  try {
    const want = { offenders: [] as string[], exempted: [] as string[] };
    for (const [rel, src] of Object.entries(PLANTED_TREE)) {
      const abs = join(root, rel);
      if (rel.includes("/")) mkdirSync(join(root, rel.slice(0, rel.lastIndexOf("/"))), { recursive: true });
      writeFileSync(abs, src);
      src.split("\n").forEach((l, i) => {
        if (l.includes("// PLANT")) want.offenders.push(`${rel}:${i + 1}`);
        if (l.includes("// EXEMPT")) want.exempted.push(`${rel}:${i + 1}`);
      });
    }
    const got = scanForVendorCalls(root, new Set(["store.ts"]));
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (got.files.length !== Object.keys(PLANTED_TREE).length)
      failures.push(`scan walked ${got.files.length} of ${Object.keys(PLANTED_TREE).length} planted files`);
    if (!same(got.offenders, want.offenders))
      failures.push(`scan reported offenders [${got.offenders.join(", ")}], planted [${want.offenders.join(", ")}]`);
    if (!same(got.exempted, want.exempted))
      failures.push(`scan reported exemptions [${got.exempted.join(", ")}], planted [${want.exempted.join(", ")}]`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return failures;
}

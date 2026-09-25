#!/usr/bin/env node
// check-shell-backend-paths — every control-plane path EnterpriseShell builds must be a
// path the served /v1 surface declares.
//
//   node scripts/check-shell-backend-paths.mjs             the gate
//   node scripts/check-shell-backend-paths.mjs --self-test prove the gate can fail
//
// WHY THIS EXISTS. docs/COMPANY_BUILD_PLAN.md row 5 (2026-08): "BackendService.swift
// calls five endpoints that exist nowhere in this repo; on a real device the first
// badge tap 404s, silently." The port landed on 2026-09-02 (the shell's client binds
// to POST /v1/sessions/start, /{id}/refresh, /{id}/end and GET /v1/context), but
// nothing kept it true: a new call site against a path the spec does not declare
// would 404 on a device and pass every gate. The contract of record is
// lib/api-spec/v1-openapi.yaml (mounted under /api by app.ts). This gate reads the
// shell's path literals and the spec's `paths:` and fails on any shell path the spec
// does not declare. Path parameters compare positionally: the shell's `\(sessionId)`
// and the spec's `{id}` are both one segment.
//
// GATED: every `jsonRequest(base, "api/…")` literal in BackendService.swift resolves
//        to a declared spec path; the extractor found at least MIN_PATHS of them (a
//        regex that matches nothing is indistinguishable from a clean client).
// REPORTED, not gated: `appendingPathComponent("api/…")` sites elsewhere under
//        native/ios/EnterpriseShell — today the two legacy OIDC paths
//        (/api/auth/exchange-token, /api/auth/logout) the identity providers keep for
//        a backend that provides them, each annotated in source as unserved by this
//        repo and only reached when IDENTITY_PROVIDER_TYPE selects OIDC explicitly (the
//        default provider is the control-plane session). They are printed on every run
//        so the residual is never silent; promoting them to GATED is one line.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CLIENT = "native/ios/EnterpriseShell/Services/BackendService.swift";
export const SHELL_DIR = "native/ios/EnterpriseShell";
export const SPEC = "lib/api-spec/v1-openapi.yaml";
export const MIN_PATHS = 3;

/** Pure: spec text → Set of declared path templates with params normalised to "*". */
export function specPaths(yamlText) {
  const out = new Set();
  let inPaths = false;
  for (const line of yamlText.split("\n")) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) inPaths = false; // next top-level key
    const m = inPaths && line.match(/^  (\/\S+?):\s*$/);
    if (m) out.add(normalise(m[1]));
  }
  return out;
}

/** Pure: Swift source → the control-plane paths it builds, normalised. */
export function clientPaths(swiftText) {
  const out = [];
  const re = /jsonRequest\(base,\s*"([^"]+)"/g;
  for (const m of swiftText.matchAll(re)) out.push({ raw: m[1], norm: normalise(m[1]) });
  return out;
}

/** Pure: other Swift files' `appendingPathComponent("api/…")` sites (REPORTED). */
export function legacySites(files) {
  const out = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/appendingPathComponent\("(api\/[^"]+)"\)/g)) out.push({ path, raw: m[1], norm: normalise(m[1]) });
  }
  return out;
}

// "api/v1/sessions/\(id)/refresh" and "/v1/sessions/{id}/refresh" both normalise to the same
// template with every parameter segment replaced by a star.
export function normalise(p) {
  return "/" + p.replace(/^\/?api\//, "").replace(/^\//, "")
    .replace(/\\\([^)]*\)/g, "*").replace(/\{[^}]*\}/g, "*");
}

/** Pure: the verdict. */
export function audit({ client, spec, legacy = [] }) {
  const problems = [];
  if (client.length < MIN_PATHS) problems.push(`extractor found ${client.length} path(s) in ${CLIENT} — below the floor of ${MIN_PATHS}; the regex no longer matches the client (a clean-looking client is not a clean client)`);
  if (spec.size === 0) problems.push(`no paths read from ${SPEC} — the spec parser found nothing under paths:`);
  for (const c of client) if (!spec.has(c.norm)) problems.push(`${CLIENT} builds "${c.raw}" but ${SPEC} declares no ${c.norm} — a device would 404 on it`);
  const reported = legacy.filter((l) => !spec.has(l.norm)).map((l) => `${l.path}: "${l.raw}" is not a declared /v1 path (legacy, documented in source as unserved; reached only when an OIDC provider is configured explicitly)`);
  return { problems, reported };
}

function walkSwift(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkSwift(p));
    else if (e.endsWith(".swift") && !p.endsWith("BackendService.swift")) out.push({ path: p.slice(repo.length + 1), text: readFileSync(p, "utf8") });
  }
  return out;
}

function selfTest() {
  const checks = [];
  const t = (n, ok) => { checks.push(ok); console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`); };
  const spec = specPaths("openapi: 3.0.0\npaths:\n  /v1/context:\n    get: {}\n  /v1/sessions/start:\n    post: {}\n  /v1/sessions/{id}/refresh:\n    post: {}\ncomponents:\n  /not/a/path:\n    x: 1\n");
  t("the spec parser reads paths under `paths:` only (3, not the components key)", spec.size === 3 && !spec.has("/not/a/path"));
  const swift = `a = try Self.jsonRequest(base, "api/v1/sessions/start", method: "POST")\nb = try Self.jsonRequest(base, "api/v1/sessions/\\(sessionId)/refresh", method: "POST")\nc = try Self.jsonRequest(base, "api/v1/context", method: "GET")`;
  const client = clientPaths(swift);
  t("the extractor finds the client's three paths and normalises the interpolated segment", client.length === 3 && client[1].norm === "/v1/sessions/*/refresh");
  t("a client bound only to declared paths passes", audit({ client, spec }).problems.length === 0);
  const bad = clientPaths(swift + `\nd = try Self.jsonRequest(base, "api/badges/\\(id)/scan", method: "POST")`);
  t("a client path the spec does not declare FAILS and is named", audit({ client: bad, spec }).problems.some((p) => p.includes("api/badges")));
  t("an extractor that finds too few paths FAILS (floor)", audit({ client: client.slice(0, 1), spec }).problems.some((p) => p.includes("floor")));
  t("an empty spec FAILS rather than passing everything", audit({ client, spec: new Set() }).problems.some((p) => p.includes("no paths read")));
  const legacy = legacySites([{ path: "x.swift", text: `let u = base.appendingPathComponent("api/auth/logout")` }]);
  const v = audit({ client, spec, legacy });
  t("a legacy appendingPathComponent site outside the client is REPORTED, not fatal", v.problems.length === 0 && v.reported.length === 1 && v.reported[0].includes("api/auth/logout"));
  t("…and one that IS declared is not reported", audit({ client, spec, legacy: legacySites([{ path: "y.swift", text: `base.appendingPathComponent("api/v1/context")` }]) }).reported.length === 0);
  // the real tree: the positive control
  const real = audit({ client: clientPaths(readFileSync(join(repo, CLIENT), "utf8")), spec: specPaths(readFileSync(join(repo, SPEC), "utf8")) });
  t("…and the real client is clean right now (the positive control)", real.problems.length === 0);
  const failed = checks.filter((x) => !x).length;
  console.log(`\nself-test ${failed ? "FAILED" : "passed"} (${checks.length - failed}/${checks.length})`);
  return failed ? 1 : 0;
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const client = clientPaths(readFileSync(join(repo, CLIENT), "utf8"));
  const spec = specPaths(readFileSync(join(repo, SPEC), "utf8"));
  const legacy = legacySites(walkSwift(join(repo, SHELL_DIR)));
  const { problems, reported } = audit({ client, spec, legacy });
  console.log(`Shell backend paths — ${client.length} path(s) built by ${CLIENT} against ${spec.size} declared in ${SPEC}`);
  for (const c of client) console.log(`  ${spec.has(c.norm) ? "✓" : "✗"} ${c.raw} → ${c.norm}`);
  for (const r of reported) console.log(`  · REPORTED — ${r}`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(problems.length ? `\nShell backend-path gate FAILED — ${problems.length} problem(s); a path the spec does not declare is a silent 404 on a device.` : "\nShell backend-path gate passed — every path the shell's control-plane client builds is a declared /v1 path.");
  return problems.length ? 1 : 0;
}

process.exitCode = main();

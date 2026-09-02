// What the emitters put on the wire, and what they believe from the answer.
//
//   node scripts/check-emitter-wire-discipline.mjs
//   node scripts/check-emitter-wire-discipline.mjs --self-test
//
// WHY THIS EXISTS. Three sibling gates already stand at this boundary:
// `check-ungated-fetch.mjs` asks whether the call was ALLOWED and whether it is
// BOUNDED, `check-signing-unconditional.mjs` asks whether it went out SIGNED, and
// `check-emit-payload-discipline.mjs` asks WHAT WAS IN IT. A fail-closed read of
// the six emitter families on 2026-09-02 found four defects none of them can see,
// because all four are about the WIRE rather than the payload:
//
//   1. `await response.json() as { access_token: string }` — a TypeScript `as`
//      checks nothing at run time. A 200 body of `{"ok":true}` produced
//      `Bearer undefined` on the next request; `{"access_token":""}` produced a
//      bare `Bearer `. Five OAuth paths did this.
//   2. A vendor's `sys_id` was interpolated into a REST path unencoded. Measured:
//      `../../../../api/now/table/sys_user/<id>` NORMALISED before the request left
//      and PATCHed the user table while the adapter believed it was updating an
//      incident.
//   3. `siem/webhook.ts` and `itsm/generic-webhook.ts` POSTed to `config.url` raw
//      while an SSRF guard for exactly that shape sat in `webhooks/`. The ITSM
//      config schema's `z.string().url()` accepts
//      `http://169.254.169.254/latest/meta-data/` — it validates SYNTAX.
//   4. Those same two families emitted `X-Signature` over the BODY ALONE plus
//      `X-Signing-Algorithm` — scheme v1, which `webhooks/sign.ts`'s own verifier
//      refuses BY NAME as replayable. A second signature scheme existed because two
//      files had not been read together.
//
// WHAT IT CANNOT DO, stated because the tempting version overclaims. Every
// assertion here is LEXICAL: it reads source text, not a running program. It cannot
// prove a checked reader is reached on every path, cannot follow a value through a
// helper in another module, and does not look outside `lib/integrations`. It proves
// that no source in these families writes the four SHAPES above — a necessary
// condition, not a sufficient one.
//
// SCOPE IS DERIVED, never hand-listed. The families come from the same derivation
// `check-ungated-fetch.mjs` and `check-emit-payload-discipline.mjs` use: a directory
// whose `resolve.ts` imports `createEmitterResolver`. Rename the factory and this
// gate fails on the floor rather than reporting an empty scan as clean.

import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "lib/integrations/src/integrations";
const ADAPTERS = `${SCAN_ROOT}/adapters`;

// ── SHARED TEXT HELPERS ──────────────────────────────────────────────────────

/** Blank out comments so prose describing a defect is never read as the defect. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

/**
 * The six emitter families, DERIVED. Identical rule to check-ungated-fetch.mjs:
 * a directory under the scan root is a family iff its `resolve.ts` imports
 * `createEmitterResolver`, the shared fail-closed factory.
 */
export function deriveEmitterFamilies(readDir, readFile) {
  const families = [];
  for (const entry of readDir()) {
    let src;
    try { src = readFile(`${entry}/resolve.ts`); } catch { continue; }
    if (/createEmitterResolver/.test(src)) families.push(entry);
  }
  return families.sort();
}

// ── ASSERTION 1 — A TOKEN IS CHECKED, NOT CAST ───────────────────────────────
//
// A token-shaped assignment whose right-hand side is derived from a `.json()` read
// must pass through a checked reader (`asNonEmptyString`/`asPositiveNumber` from
// adapters/vendor-values.ts) or a zod `.parse(`. Derived from the assignment, not
// from a file list.
//
// WHAT COUNTS AS "DERIVED FROM .json()". A local whose declaration is
// `... = await response.json()` (any callee name — `res`, `response`, `r`), then any
// member access on that local. The binding is FOUND rather than assumed: a token
// assigned from a config field or a `btoa(...)` is not a vendor value and is not
// flagged here — that is the emit gate's clause, not this one.

const TOKEN_FIELD = /(?:^|[.\s])(?:this\.)?([\w$]*[Tt]oken[\w$]*)\s*=\s*([^;]+);/g;
const CHECKED_READER = /\b(?:asNonEmptyString|asPositiveNumber|z\.[\w.]*\.?parse|\.parse)\s*\(/;

/**
 * The right-hand side with CAST AND PAREN NOISE removed, so the local-name test sees
 * the value rather than the syntax around it.
 *
 * WHY. The first version tested for `<local>` immediately followed by `.` or `[`, so
 * the FAITHFUL spelling `data.access_token` was caught and the cast-and-widen
 * spelling — `(data as any).access_token as string` — sailed through: `data` is
 * followed by ` as`. A gate that catches the honest form of a defect and misses the
 * evasive one is worse than none, because the evasive one is what a hurry produces.
 * Still purely lexical: strip ` as <type>`, `!` non-null assertions, and parens.
 */
export function normaliseRhs(rhs) {
  let out = rhs;
  let prev;
  do {
    prev = out;
    // ` as any`, ` as string`, ` as { a: b }`, ` as Record<string, unknown>`
    out = out.replace(/\s+as\s+[A-Za-z_$][\w$]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*/g, "");
    out = out.replace(/\s+as\s+\{[^{}]*\}/g, "");
  } while (out !== prev);
  return out.replace(/[()!]/g, "");
}

/** Locals in this source that hold the parsed body of a vendor response. */
export function jsonDerivedLocals(code) {
  const names = new Set();
  // `= (await res.json()) as X` is the same read with a paren, and the first version
  // of this pattern did not allow one — so the local was never recognised and every
  // assignment from it cleared. Optional parens before `await`, and before the callee.
  for (const m of code.matchAll(/(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*\(?\s*(?:await\s+)?\(?\s*[\w$.]*\.json\s*\(/g)) {
    names.add(m[1]);
  }
  // `return response.json() as Promise<X>` binds nothing and is a return, not an
  // assignment to a token field; it is out of this assertion's scope by shape.
  return names;
}

/** Token-field assignments that read a json-derived local without a checked reader. */
export function uncheckedTokenAssignments(text) {
  const code = stripComments(text);
  const locals = jsonDerivedLocals(code);
  const out = [];
  if (locals.size === 0) return out;
  const lines = code.split("\n");
  for (const m of code.matchAll(TOKEN_FIELD)) {
    const field = m[1];
    const rhs = m[2];
    const bare = normaliseRhs(rhs);
    const usesVendorValue = [...locals].some((l) => new RegExp(`(?<![\\w$])${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.\\[]`).test(bare));
    if (!usesVendorValue) continue;
    if (CHECKED_READER.test(rhs)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    out.push({ line, field, text: lines[line - 1].trim().slice(0, 90) });
  }
  return out;
}

/**
 * The same rule for a RETURNED vendor token: `return data.access_token;` inside a
 * function whose name says token. Assignments were the shape found in three files;
 * the other two RETURNED the value straight to a caller that assigned it, so an
 * assignment-only rule would have cleared them while the defect stood.
 */
export function uncheckedTokenReturns(text) {
  const code = stripComments(text);
  const locals = jsonDerivedLocals(code);
  const out = [];
  if (locals.size === 0) return out;
  const lines = code.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/^\s*return\s+([^;]+);/);
    if (m === null) return;
    const rhs = m[1];
    if (!/[Tt]oken/.test(rhs)) return;
    const bare = normaliseRhs(rhs);
    const usesVendorValue = [...locals].some((l) => new RegExp(`(?<![\\w$])${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.\\[]`).test(bare));
    if (!usesVendorValue) return;
    if (CHECKED_READER.test(rhs)) return;
    out.push({ line: i + 1, field: rhs.trim().slice(0, 40), text: line.trim().slice(0, 90) });
  });
  return out;
}

// ── ASSERTION 2 — AN INTERPOLATED URL SEGMENT IS ENCODED ─────────────────────
//
// `${...}` inside a URL-shaped template literal must be `encodeURIComponent(...)`,
// or read from configuration. THE ALLOW-LIST IS BY SHAPE, not by name: an expression
// rooted at `this.config.`, `config.`, `process.env.`, or a `get*Url()`/`getBaseUrl()`
// accessor is operator configuration — the operator already chooses the host, so
// percent-encoding their own base URL would break it. Everything else is data that
// arrived from somewhere, and it gets encoded.

const URL_TEMPLATE = /`((?:https?:\/\/|\$\{)[^`]*\/[^`]*)`/g;
const CONFIG_ROOTED = /^(?:this\.config\.|config\.|process\.env\.|this\.get[\w$]*Url\s*\(|get[\w$]*Url\s*\(|this\.getBaseUrl\s*\(|msiEndpoint|graphUrl|tokenUrl|baseUrl)/;

export function unencodedUrlInterpolations(text) {
  const code = stripComments(text);
  const out = [];
  const lines = code.split("\n");
  for (const t of code.matchAll(URL_TEMPLATE)) {
    const body = t[1];
    for (const e of body.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const expr = e[1].trim();
      if (expr.startsWith("encodeURIComponent")) continue;
      if (CONFIG_ROOTED.test(expr)) continue;
      const line = code.slice(0, t.index).split("\n").length;
      out.push({ line, expr: expr.slice(0, 60), text: (lines[line - 1] ?? "").trim().slice(0, 90) });
    }
  }
  return out;
}

// ── ASSERTION 3 — AN OPERATOR-SUPPLIED ENDPOINT IS VALIDATED ─────────────────
//
// SCOPE IS DERIVED; only the VERDICT is declared. Every `*Url`-named string field in
// the six families is derived from source, then matched against the registry
// `OPERATOR_URL_FIELDS` in adapters/url-guard.ts (read lexically — this gate does not
// execute TypeScript). A derived field with no entry FAILS; an entry no source
// declares FAILS. So the classification cannot quietly widen or rot.
//
// WHY IT IS NO LONGER A NAME TEST. The first version gated fields named exactly
// `url` and reported everything else, which read as principled and was not: `hecUrl`
// on the Splunk adapter is the WHOLE destination — the code appends only
// `/services/collector` — and a literal loopback `hecUrl` at prod + live POSTed the
// event, HEC token in the `Authorization` header, to 127.0.0.1 and returned `sent`
// (reproduced against a real socket, 2026-09-02). One counter-example killed the
// distinction, so the line is written down with its reason instead.
//
// THREE CLAUSES, so a GATED field cannot be cleared by a sibling's guard:
//   3a. every GATED field's family calls validateWebhookUrl somewhere;
//   3b. every FILE that passes a GATED field into a fetch() also calls it — this is
//       the clause splunk.ts failed while its family passed;
//   3c. a GATED field that NO file fetches must be guarded at its DECLARING file
//       (itsm's stored `webhookUrl`: nothing fetches it yet, so a call-site check
//       would be a check on a call site that does not exist).
//
// SAID EXACTLY — GATED vs REPORTED. The REPORTED fields (`instanceUrl`, `baseUrl`,
// `tokenUrl`) are equally operator-supplied and equally reachable at an internal
// address. What is missing there is the DESIGN, not the call: whether an on-premise
// ServiceNow at 10.x is a legitimate deployment is undecided. This gate says which
// side each field is on and counts both, rather than implying it holds all of them.

export function urlConfigFields(text) {
  const code = stripComments(text);
  const named = new Set();
  // `z` alone, not `z.string()`, because a zod chain wraps onto the next line the
  // moment it grows a `.refine(...)` — which is exactly what happened when
  // `webhookUrl` was guarded, and the field then stopped being derived at all. A
  // *Url-named field declared with any zod type is still an operator URL field.
  for (const m of code.matchAll(/^\s*([\w$]*[Uu]rl)\??\s*:\s*(?:string|z\b)/gm)) named.add(m[1]);
  return [...named].sort();
}

// ── ASSERTION 4 — ONE SIGNATURE SCHEME, REGISTERED ───────────────────────────
//
// Every header assigned anywhere in the scan root whose name looks like a signature
// header must appear in adapters/signature-headers.ts, and every registered header
// must actually be emitted somewhere. A retired header appearing again fails by name.

const SIGNATURE_HEADER_SHAPE = /^X-[\w-]*(Signature|Signing|Timestamp)[\w-]*$/i;

export function assignedHeaders(text) {
  const code = stripComments(text);
  const out = new Set();
  for (const m of code.matchAll(/headers\s*\[\s*['"`]([^'"`]+)['"`]\s*\]\s*=/g)) out.add(m[1]);
  for (const m of code.matchAll(/^\s*['"]([A-Za-z][\w-]*)['"]\s*:\s*[^,\n]+,?\s*$/gm)) out.add(m[1]);
  for (const m of code.matchAll(/\[\s*(WEBHOOK_[A-Z_]*HEADER)\s*\]\s*:/g)) out.add(m[1]);
  return out;
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
//
// Planted defects, one per assertion, plus the honest idioms each assertion must NOT
// flag. A gate whose self-test only shows it passing on clean input has shown nothing.
function selfTest() {
  const plantedToken =
    "const data = await response.json() as { access_token: string };\nthis.accessToken = data.access_token;";
  const fixedToken =
    "const data = await response.json() as Record<string, unknown>;\nthis.accessToken = asNonEmptyString(data.access_token, 'access_token');";
  const configToken = "this.accessToken = btoa(`${this.config.auth.username}:${this.config.auth.password}`);";
  const plantedReturn = "const data = await response.json() as { access_token: string };\nreturn data.access_token;";
  const fixedReturn =
    "const data = await response.json() as Record<string, unknown>;\nreturn asNonEmptyString(data.access_token, 'access_token');";
  const commentedToken =
    "const data = await response.json() as Record<string, unknown>;\n// this.accessToken = data.access_token;";

  const plantedUrl = "const url = `${this.config.instanceUrl}/api/now/table/incident/${sysId}`;";
  const fixedUrl = "const url = `${this.config.instanceUrl}/api/now/table/incident/${encodeURIComponent(sysId)}`;";
  const configUrl = "const url = `${this.config.instanceUrl}/api/now/table/${this.config.table}`;";

  const urlFamilySrc = "export interface C {\n  url: string;\n  method: 'POST';\n}";
  const tenantFamilySrc = "export interface C {\n  instanceUrl: string;\n}";

  const checks = [
    ["a raw `as`-cast token assignment IS a finding — the planted defect",
      uncheckedTokenAssignments(plantedToken).length === 1],
    ["…and the checked reader clears it",
      uncheckedTokenAssignments(fixedToken).length === 0],
    ["a token built from CONFIG is not a vendor value and is not flagged",
      uncheckedTokenAssignments(configToken).length === 0],
    ["a raw `return data.access_token` IS a finding — the two files an assignment-only rule would have missed",
      uncheckedTokenReturns(plantedReturn).length === 1],
    ["…and the checked reader clears it",
      uncheckedTokenReturns(fixedReturn).length === 0],
    ["a COMMENTED-OUT assignment is prose, not a defect",
      uncheckedTokenAssignments(commentedToken).length === 0],
    // THE CAST-AND-WIDEN IDIOM, both spellings. `(data as any).access_token as string`
    // passed silently while the faithful `data.access_token` failed — the evasive form
    // clearing is strictly worse than the honest one clearing.
    ["`(data as any).access_token as string` IS a finding — the cast-and-widen spelling",
      uncheckedTokenAssignments(
        "const data = await response.json() as Record<string, unknown>;\nthis.accessToken = (data as any).access_token as string;",
      ).length === 1],
    ["`return (data as any).access_token as string` IS a finding too",
      uncheckedTokenReturns(
        "const data = await response.json() as Record<string, unknown>;\nreturn (data as any).access_token as string;",
      ).length === 1],
    ["a checked reader still clears the cast-and-widen spelling",
      uncheckedTokenAssignments(
        "const data = await response.json() as Record<string, unknown>;\nthis.accessToken = asNonEmptyString((data as any).access_token, 'access_token');",
      ).length === 0],
    ["`const d = (await res.json()) as X` is recognised as a vendor read — the paren form",
      jsonDerivedLocals("const d = (await res.json()) as X;").has("d")],
    ["normaliseRhs strips casts and parens without eating the member access",
      normaliseRhs("(data as any).access_token as string").trim() === "data.access_token"],
    ["an unencoded vendor id in a URL template IS a finding — the planted defect",
      unencodedUrlInterpolations(plantedUrl).length === 1],
    ["…and encodeURIComponent clears it",
      unencodedUrlInterpolations(fixedUrl).length === 0],
    ["a config-rooted segment is NOT flagged (the operator chose the host)",
      unencodedUrlInterpolations(configUrl).length === 0],
    ["a family whose config declares `url: string` is IN the validator's scope",
      urlConfigFields(urlFamilySrc).includes("url")],
    ["a family declaring only `instanceUrl` is NOT (reported, not gated)",
      urlConfigFields(tenantFamilySrc).includes("url") === false &&
        urlConfigFields(tenantFamilySrc).includes("instanceUrl")],
    ["a MULTI-LINE zod chain still declares the field — the shape that vanished when webhookUrl grew a .refine()",
      urlConfigFields("export const S = z.object({\n  webhookUrl: z\n    .string()\n    .url()\n    .refine((u) => ok(u))\n    .optional(),\n});").includes("webhookUrl")],
    ["a non-URL-named field is not collected",
      urlConfigFields("export interface C {\n  token: string;\n}").length === 0],
    ["the retired v1 header is recognised by the signature shape",
      SIGNATURE_HEADER_SHAPE.test("X-Signature") && SIGNATURE_HEADER_SHAPE.test("X-Signing-Algorithm")],
    ["a non-signature header is not",
      SIGNATURE_HEADER_SHAPE.test("X-Event-ID") === false && SIGNATURE_HEADER_SHAPE.test("Content-Type") === false],
    ["`headers['X-Signature'] = sig` is seen as an assigned header",
      assignedHeaders("headers['X-Signature'] = sig;").has("X-Signature")],
    ["the family derivation finds a family only through createEmitterResolver",
      deriveEmitterFamilies(() => ["a", "b"], (p) => (p === "a/resolve.ts" ? "createEmitterResolver" : "nothing")).join() === "a"],
  ];

  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

// ── THE SCAN ─────────────────────────────────────────────────────────────────

const FAMILIES = deriveEmitterFamilies(
  () => readdirSync(resolve(repoRoot, SCAN_ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name),
  (rel) => readFileSync(resolve(repoRoot, SCAN_ROOT, rel), "utf8"),
);

const familyFiles = execFileSync("git", ["ls-files", SCAN_ROOT], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .filter((f) => FAMILIES.some((fam) => f.startsWith(`${SCAN_ROOT}/${fam}/`)));

const adapterFiles = execFileSync("git", ["ls-files", ADAPTERS], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts"));

const tokenFindings = [];
const urlFindings = [];
const derivedUrlFields = new Map();  // "family:field" -> Set(declaring files)
const gatedFieldFetchFiles = new Map(); // "family:field" -> Set(files fetching with it)
const headersSeen = new Map();      // header -> [file:line]
let scannedFiles = 0;
let jsonReads = 0;
let urlTemplates = 0;

for (const file of familyFiles) {
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  scannedFiles += 1;
  const code = stripComments(text);
  jsonReads += [...code.matchAll(/\.json\s*\(\s*\)/g)].length;
  urlTemplates += [...code.matchAll(URL_TEMPLATE)].length;
  const family = file.slice(`${SCAN_ROOT}/`.length).split("/")[0];

  for (const hit of [...uncheckedTokenAssignments(text), ...uncheckedTokenReturns(text)]) {
    tokenFindings.push(`${file}:${hit.line}  ${hit.text}`);
  }
  for (const hit of unencodedUrlInterpolations(text)) {
    urlFindings.push(`${file}:${hit.line}  \${${hit.expr}}  —  ${hit.text}`);
  }
  for (const field of urlConfigFields(text)) {
    const key = `${family}:${field}`;
    if (!derivedUrlFields.has(key)) derivedUrlFields.set(key, new Set());
    derivedUrlFields.get(key).add(file);
  }
  for (const h of assignedHeaders(text)) {
    if (!SIGNATURE_HEADER_SHAPE.test(h) && !/^WEBHOOK_/.test(h)) continue;
    if (!headersSeen.has(h)) headersSeen.set(h, []);
    headersSeen.get(h).push(file);
  }
}

// THE REGISTRY, read from source rather than imported — the same convention as the
// signature-header registry below: the gate holds a file it does not execute.
const guardSrc = readFileSync(resolve(repoRoot, ADAPTERS, "url-guard.ts"), "utf8");
const REGISTERED_URL_FIELDS = [
  ...guardSrc.matchAll(
    /\{\s*family:\s*'([^']+)',\s*field:\s*'([^']+)',\s*enforcement:\s*'(GATED|REPORTED)'/g,
  ),
].map((m) => ({ family: m[1], field: m[2], enforcement: m[3] }));
const REGISTRY_BY_KEY = new Map(REGISTERED_URL_FIELDS.map((e) => [`${e.family}:${e.field}`, e]));
const GATED_FIELD_NAMES = new Set(REGISTERED_URL_FIELDS.filter((e) => e.enforcement === "GATED").map((e) => e.field));

// CLAUSE 3b's input: files that pass a GATED field into a fetch() call. Lexical — the
// field name as a member access anywhere in the fetch's first argument.
for (const file of familyFiles) {
  const code = stripComments(readFileSync(resolve(repoRoot, file), "utf8"));
  const family = file.slice(`${SCAN_ROOT}/`.length).split("/")[0];
  for (const m of code.matchAll(/\bfetch\s*\(([^,)]*)/g)) {
    for (const field of GATED_FIELD_NAMES) {
      if (!new RegExp(`\\.${field}\\b`).test(m[1])) continue;
      const key = `${family}:${field}`;
      if (!gatedFieldFetchFiles.has(key)) gatedFieldFetchFiles.set(key, new Set());
      gatedFieldFetchFiles.get(key).add(file);
    }
  }
}

// Which families call the shared validator, derived from their own sources.
const validatorCallers = new Set();
const validatorCallingFiles = new Set();
for (const file of familyFiles) {
  const code = stripComments(readFileSync(resolve(repoRoot, file), "utf8"));
  if (/\bvalidateWebhookUrl\s*\(/.test(code)) {
    validatorCallers.add(file.slice(`${SCAN_ROOT}/`.length).split("/")[0]);
    validatorCallingFiles.add(file);
  }
}

// The registry, read from source rather than imported, so the gate holds a file it
// does not execute.
const registrySrc = readFileSync(resolve(repoRoot, ADAPTERS, "signature-headers.ts"), "utf8");
const registered = new Set([...registrySrc.matchAll(/header:\s*'([^']+)'/g)].map((m) => m[1]));
const retired = new Set(
  [...registrySrc.matchAll(/\{\s*header:\s*'([^']+)',\s*reason:/g)].map((m) => m[1]),
);
// `retired` is a subset of the same literal shape; separate them by which array they
// sit in — the retired entries are the ones carrying a `reason`.
for (const r of retired) registered.delete(r);

// Header names the signing module exports as constants, resolved to their values so
// a computed key (`[WEBHOOK_SIGNATURE_HEADER]:`) is compared as the header it is.
const signSrc = readFileSync(resolve(repoRoot, SCAN_ROOT, "webhooks/sign.ts"), "utf8");
const constHeaders = new Map(
  [...signSrc.matchAll(/export const (WEBHOOK_[A-Z_]*HEADER)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
);
const emitted = new Set();
for (const [h, files] of headersSeen) emitted.add(constHeaders.get(h) ?? h);

console.log("Emitter wire discipline — where we send, what we sign it with, what we believe back\n");
console.log(`  emitter families (DERIVED):        ${FAMILIES.join(", ")}`);
console.log(`  family sources scanned:            ${scannedFiles}`);
console.log(`  vendor .json() reads seen:         ${jsonReads}`);
console.log(`  URL template literals seen:        ${urlTemplates}`);
console.log(`  signature headers on the wire:     ${[...emitted].sort().join(", ") || "none"}`);
const derivedKeys = [...derivedUrlFields.keys()].sort();
const gatedKeys = derivedKeys.filter((k) => REGISTRY_BY_KEY.get(k)?.enforcement === "GATED");
const reportedKeys = derivedKeys.filter((k) => REGISTRY_BY_KEY.get(k)?.enforcement === "REPORTED");
console.log(
  `  operator URL config fields:       ${derivedKeys.length} derived — ` +
    `${gatedKeys.length} GATED, ${reportedKeys.length} REPORTED`,
);
console.log(`      GATED    (the value IS the destination): ${gatedKeys.join(", ") || "none"}`);
console.log(
  `      REPORTED (vendor tenant host; the guard is NOT claimed on these, and the\n` +
    `                refusal semantics for an on-premise tenant are undesigned):`,
);
for (const k of reportedKeys) {
  console.log(`        ${k}  — ${[...derivedUrlFields.get(k)].sort().join(", ")}`);
}

let problems = 0;

// FLOORS. Each derivation can silently stop matching, and a scan that finds nothing
// reports everything as clean.
if (FAMILIES.length < 6) {
  console.error(`\n✗ derived only ${FAMILIES.length} emitter families (expected >= 6) — the derivation drifted.`);
  problems += 1;
}
if (jsonReads < 15) {
  console.error(`\n✗ found only ${jsonReads} vendor .json() read(s) (expected >= 15) — assertion 1 is measuring nothing.`);
  problems += 1;
}
if (urlTemplates < 15) {
  console.error(`\n✗ found only ${urlTemplates} URL template(s) (expected >= 15) — assertion 2 is measuring nothing.`);
  problems += 1;
}
if (gatedKeys.length < 4) {
  console.error(
    `\n✗ derived only ${gatedKeys.length} GATED operator URL field(s) (expected >= 4): ${gatedKeys.join(", ") || "none"}.\n` +
      "  webhooks:url, siem:url, siem:hecUrl, itsm:url and itsm:webhookUrl exist today; fewer\n" +
      "  than four means the derivation stopped matching and assertion 3 is enforcing over air.",
  );
  problems += 1;
}
if (REGISTERED_URL_FIELDS.length === 0) {
  console.error("\n✗ read zero entries from OPERATOR_URL_FIELDS in adapters/url-guard.ts — the registry parse drifted.");
  problems += 1;
}
if (emitted.size === 0) {
  console.error("\n✗ zero signature headers found on the wire — assertion 4 is measuring nothing.");
  problems += 1;
}

if (tokenFindings.length > 0) {
  console.error(
    `\n✗ ${tokenFindings.length} token value(s) taken from a vendor response WITHOUT a checked reader:\n` +
      tokenFindings.map((t) => `    ${t}`).join("\n") +
      "\n\n  `as { access_token: string }` is a COMPILE-TIME assertion and checks nothing at\n" +
      "  run time: a 200 body of `{\"ok\":true}` yields `Bearer undefined`, and\n" +
      "  `{\"access_token\":\"\"}` yields a bare `Bearer `. Pass it through\n" +
      "  asNonEmptyString(value, 'access_token') from adapters/vendor-values.ts.",
  );
  problems += 1;
}

if (urlFindings.length > 0) {
  console.error(
    `\n✗ ${urlFindings.length} URL segment(s) interpolated without encodeURIComponent:\n` +
      urlFindings.map((t) => `    ${t}`).join("\n") +
      "\n\n  `fetch` normalises `..` segments BEFORE the request leaves, so a vendor id of\n" +
      "  `../../../../api/now/table/sys_user/<id>` addresses a different resource than the\n" +
      "  template names. Wrap the expression in encodeURIComponent(), or — if it is\n" +
      "  operator configuration rather than data — root it at config./process.env./get*Url().",
  );
  problems += 1;
}

// Registry ↔ tree, both directions. Scope derived, verdict declared, neither able to
// drift without this failing.
const undeclaredFields = derivedKeys.filter((k) => !REGISTRY_BY_KEY.has(k));
if (undeclaredFields.length > 0) {
  console.error(
    `\n✗ ${undeclaredFields.length} operator URL config field(s) in the tree with no entry in\n` +
      "  OPERATOR_URL_FIELDS (adapters/url-guard.ts):\n" +
      undeclaredFields.map((k) => `    ${k}  — ${[...derivedUrlFields.get(k)].sort().join(", ")}`).join("\n") +
      "\n\n  Classify it GATED (the value IS the destination) or REPORTED (a vendor tenant\n" +
      "  host whose refusal semantics are undesigned), with the reason. An unclassified\n" +
      "  field is the shape `hecUrl` had when a loopback collector received the payload.",
  );
  problems += 1;
}
const fossilEntries = [...REGISTRY_BY_KEY.keys()].filter((k) => !derivedUrlFields.has(k));
if (fossilEntries.length > 0) {
  console.error(
    `\n✗ ${fossilEntries.length} OPERATOR_URL_FIELDS entry(ies) no source declares: ${fossilEntries.join(", ")}.\n` +
      "  A registry describing a field nobody has is a fossil.",
  );
  problems += 1;
}

// 3a — the family calls the guard at all.
const missingValidator = gatedKeys.filter((k) => !validatorCallers.has(k.split(":")[0]));
// 3b — every FILE that fetches with a GATED field calls it. This is the clause
// splunk.ts failed while its family passed on a sibling's call.
const missingAtFetchSite = [];
for (const k of gatedKeys) {
  for (const file of gatedFieldFetchFiles.get(k) ?? []) {
    if (!validatorCallingFiles.has(file)) missingAtFetchSite.push(`${k}  fetched in ${file}`);
  }
}
// 3c — a GATED field nothing fetches must be guarded where it is DECLARED.
const missingAtDeclaration = [];
for (const k of gatedKeys) {
  if ((gatedFieldFetchFiles.get(k) ?? new Set()).size > 0) continue;
  const declaring = [...(derivedUrlFields.get(k) ?? [])];
  if (!declaring.some((f) => validatorCallingFiles.has(f))) {
    missingAtDeclaration.push(`${k}  declared in ${declaring.sort().join(", ")}`);
  }
}
if (missingValidator.length + missingAtFetchSite.length + missingAtDeclaration.length > 0) {
  console.error(
    `\n✗ ${missingValidator.length + missingAtFetchSite.length + missingAtDeclaration.length} GATED operator URL field(s) not reaching validateWebhookUrl:\n` +
      [
        ...missingValidator.map((k) => `    [3a] ${k}  — the family never calls it`),
        ...missingAtFetchSite.map((t) => `    [3b] ${t}  — the file that fetches with it never calls it`),
        ...missingAtDeclaration.map((t) => `    [3c] ${t}  — nothing fetches it, and its declaring file never calls it`),
      ].join("\n") +
      "\n\n  A zod `z.string().url()` validates SYNTAX: `http://169.254.169.254/latest/meta-data/`\n" +
      "  passes it. Call validateWebhookUrl from adapters/url-guard.ts before the fetch —\n" +
      "  or, for a field nothing fetches yet, as a refinement where the config is parsed.",
  );
  problems += 1;
}

const unregistered = [...emitted].filter((h) => !registered.has(h));
if (unregistered.length > 0) {
  console.error(
    `\n✗ ${unregistered.length} signature header(s) on the wire with no entry in adapters/signature-headers.ts:\n` +
      unregistered.map((h) => `    ${h}  — ${(headersSeen.get(h) ?? []).join(", ")}`).join("\n") +
      "\n\n  Two signature schemes existed once because two files had not been read together.\n" +
      "  Declare the header and what its MAC covers, or stop emitting it.",
  );
  problems += 1;
}
const unemitted = [...registered].filter((h) => !emitted.has(h));
if (unemitted.length > 0) {
  console.error(
    `\n✗ ${unemitted.length} registered signature header(s) that nothing emits: ${unemitted.join(", ")}.\n` +
      "  A registry describing a header nobody sends is a fossil.",
  );
  problems += 1;
}
const revived = [...retired].filter((h) => emitted.has(h));
if (revived.length > 0) {
  console.error(
    `\n✗ ${revived.length} RETIRED signature header(s) back on the wire: ${revived.join(", ")}.\n` +
      "  These are scheme v1 — the body-only HMAC webhooks/sign.ts refuses by name as replayable.",
  );
  problems += 1;
}

if (problems > 0) {
  console.error(`\nEmitter-wire-discipline gate FAILED — ${problems} finding group(s).`);
  process.exit(1);
}

console.log(
  "\n  NOT established: that a checked reader is REACHED on every path, or that the\n" +
    "  validated host is the one the packet finally goes to. These are lexical scans —\n" +
    "  necessary conditions, not sufficient ones. DNS resolution to an internal address\n" +
    "  remains unguarded and is named in docs/COMPANY_BUILD_PLAN.md.",
);
console.log(
  `\nEmitter-wire-discipline gate passed — ${scannedFiles} sources across ${FAMILIES.length} families: ` +
    `every vendor token is checked, every interpolated URL segment is encoded or config-rooted, ` +
    `${gatedKeys.length} of ${derivedKeys.length} operator URL fields are validated ` +
    `(${reportedKeys.length} REPORTED, listed above), and one signature scheme is registered.`,
);

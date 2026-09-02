#!/usr/bin/env node
// Signing is not optional past the emit gate.
//
//   node scripts/check-signing-unconditional.mjs
//   node scripts/check-signing-unconditional.mjs --self-test
//
// WHY THIS EXISTS. Three outbound paths in this repository HMAC-sign a payload
// before POSTing it. One of them refused when it held no secret:
//
//   webhooks/dispatch.ts:217  →  'Webhook signing secret not configured', recorded,
//                                returned as a failure, never sent.
//
// The other two wrote the same idea as a truthiness test:
//
//   siem/webhook.ts:71        →  if (this.config.signingSecret) { ...sign... }
//   itsm/generic-webhook.ts:123  →  if (this.config.signingSecret) { ...sign... }
//
// with the secret defaulted to '' in the constructor. So an adapter configured
// without a secret did not fail and did not refuse — it SKIPPED the signature and
// sent the request anyway, and siem/webhook.ts then returned status 'sent'. The
// receiving SIEM had no way to tell our audit event from anybody else's, which is
// the entire purpose of signing an audit forward, and the caller had no way to know.
//
// The shape is what makes it survivable: `if (secret)` reads as caution. It is the
// opposite. A guard is `if (!secret) refuse`; `if (secret) sign` is a guard with its
// sense inverted, and it fails OPEN — silently, on the exact input it exists for.
//
// WHAT IS GATED. A signing branch in `lib/integrations/src/integrations/**` that is
// ENABLED by a positive truthiness test on a secret-named expression. That is
// unambiguous and mechanical, so it is a gate.
//
// WHAT IS NOT. Whether a given secret is strong, rotated, or the right one; whether
// the signature is verified downstream; anything about inbound paths. Those are
// judgement or another surface's business, and claiming this gate holds them would
// be the defect it exists to prevent.
//
// FOUR SHAPES ARE SCANNED, because the rule is the fail-open and not the keyword:
//
//     if (secret) { sign }          if (secret) sign(...)
//     cond ? sign(...) : undefined  cond && (headers[x] = sign(...))
//
// The last three were unscanned — this gate looked for the literal `if`, so the two
// most compact ways of writing the identical skip walked straight past it.
//
// TWO EXCLUSIONS, both narrow and both stated:
//
//   · A helper whose secret is a REQUIRED parameter, AND whose own parameter is the
//     thing being tested. `signBody(body, secret: string)` cannot be called without
//     one; a truthiness test inside it is defensive, not a skip, because there is no
//     caller-visible path that omits the argument. The second half of that sentence is
//     new and load-bearing: the exclusion used to fire whenever a `secret`-ish name
//     appeared in the nearest `function` signature — and class methods are not declared
//     with that keyword, so the walk-back left the method entirely and landed on an
//     unrelated helper above it. Moving a `signBody(body, secret: string)` next to a
//     class silenced a real planted defect. Now the ENCLOSING declaration is found
//     (methods included) and the tested expression must BE that parameter.
//   · Inbound verification, BY NAME with a reason. `if (secret)` in a verifier asks
//     "can we check this?", a different question with a different correct answer
//     (refuse the request, not send it unsigned). The map below HAS ONE ENTRY as of
//     2026-09-02: webhooks/sign.ts gained `verifySignedWebhook` when webhook signing
//     moved to scheme v2. This header used to say the map was empty and that sign.ts
//     "signs outbound" full stop — both true when written and both false the moment
//     that function landed, which is why the count in the report line below is now
//     DERIVED from the map rather than narrated beside it. NOTE what the entry does
//     and does not claim: `verifySignedWebhook` is a REFERENCE verifier driven by
//     proof:webhooks; no inbound ROUTE in this repository calls it. It is excluded
//     because its secret test asks "can we check this?", not "may we send unsigned?".

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "lib/integrations/src/integrations";

/** Comment-stripped, sparing protocol separators so a URL cannot eat a token. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length))
   .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

/** The operations that ARE signing. Names, not guesses: every one is in the tree. */
const SIGN_OP = /createHmac|signBody|signPayload|createSignedHeaders|X-Signature|X-Signing-Algorithm|X-Webhook-Signature/;

/** An expression naming a secret. Deliberately broad — `secret`, `signingSecret`,
 *  `webhookSecret`, `this.config.signingSecret` all count. */
const SECRET_EXPR = /[\w$.?]*secret[\w$.?]*/i;

/**
 * Inbound verifiers, excluded BY NAME with a reason. An entry here is a claim a
 * reader can check, which an exclusion by regex would not be.
 */
export const INBOUND_VERIFIERS = new Map([
  [
    "verifySignedWebhook",
    "webhooks/sign.ts, scheme v2 — a RECEIVER-side verifier: its secret test asks " +
      "whether we CAN verify, and its refusal rejects the request rather than sending " +
      "anything unsigned. Reference implementation driven by proof:webhooks; no inbound " +
      "route in this repository calls it.",
  ],
]);

/**
 * Is this `if (...)` condition a POSITIVE truthiness test on a secret?
 *
 * `if (!secret)` is the sanctioned refusal and must not be flagged — flagging the
 * correct form is how a gate teaches people to route around it. Comparisons
 * (`=== 'x'`, `.length > 0`) are decisions about a value that is present, not about
 * whether to sign at all.
 */
export function isPositiveSecretTruthiness(condition) {
  const c = condition.trim();
  const m = c.match(SECRET_EXPR);
  if (m === null) return false;
  // A negation anywhere ahead of the secret expression makes this a refusal shape.
  const before = c.slice(0, m.index);
  if (/[!]\s*[\w$.(]*$/.test(before)) return false;
  if (/(===|!==|==|!=|<|>|\.length|\.trim\(\)\s*(===|!==|\.length))/.test(c)) return false;
  return true;
}

/** The `{ ... }` block following `open` (index of its `{`), braces balanced. */
export function blockAfter(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/**
 * The declaration ENCLOSING `idx` — a top-level function OR a class method.
 *
 * This used to walk back to the nearest `function` keyword only. A class method is not
 * declared with that keyword, so inside `class A { send() { if (secret) sign() } }` the
 * walk sailed past the method, past the class, and landed on whatever unrelated helper
 * happened to sit ABOVE in the file — and if that helper took a `secret: string`
 * parameter, the exclusion fired and the planted defect went green. Reordering a file
 * is not supposed to be a security control: the reviewer demonstrated it by moving a
 * `signBody(body, secret: string)` helper next to a class and watching a real planted
 * `if (this.config.signingSecret) { ...sign... }` stop being reported.
 *
 * Returns the signature text (declaration through its opening brace) and the name.
 */
export function enclosingDeclaration(text, idx) {
  const head = text.slice(0, idx);
  const lines = head.split("\n");
  let offset = head.length;
  for (let j = lines.length - 1; j >= 0; j -= 1) {
    offset -= lines[j].length + (j === lines.length - 1 ? 0 : 1);
    const line = lines[j];
    if (/^\s*(?:if|for|while|switch|catch|return|await|else|do|new)\b/.test(line)) continue;
    const topLevel = /^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/.exec(line);
    // A method opener at class indentation: `send(...) {`, `async send(`,
    // `private async send<T>(`. Constructors and getters included — they are
    // declarations too.
    const method = /^\s{2,}(?:(?:private|public|protected|static|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(line);
    const m = topLevel ?? method;
    if (m === null) continue;
    const open = text.indexOf("{", offset);
    return { name: m[1], signature: open === -1 ? line : text.slice(offset, open + 1) };
  }
  return null;
}

/**
 * Does the declaration enclosing `idx` take THIS SECRET as a REQUIRED parameter?
 *
 * Two conditions, and the second is new. A required parameter cannot be omitted by a
 * caller, so a truthiness test on it is defensive rather than a skip — but only if the
 * expression being tested IS that parameter. `if (this.config.signingSecret)` inside a
 * method that happens to take a `secret: string` is a skip on a config field, and the
 * old rule cleared it because a `secret` appeared somewhere in the signature.
 */
export function secretIsRequiredParam(text, idx, condition = "") {
  const decl = enclosingDeclaration(text, idx);
  if (decl === null) return false;
  const tested = (condition.trim().match(SECRET_EXPR) ?? [null])[0];
  if (tested === null) return false;
  for (const p of decl.signature.matchAll(/([\w$]*secret[\w$]*)\s*(\?)?\s*:\s*[\w<>[\]|'" ]+/gi)) {
    if (p[2] === "?") continue; // an OPTIONAL parameter is omittable; the test is a skip
    if (p[1] === tested) return true;
  }
  return false;
}

/** The statement following `close` (the condition's closing paren): a braced block, or
 *  — for a braceless `if (secret) sign(x);` — the single statement that follows. */
function guardedStatement(text, close) {
  const rest = text.slice(close + 1);
  const lead = rest.match(/^\s*/)[0];
  if (rest[lead.length] === "{") return blockAfter(text, close + 1 + lead.length);
  const end = rest.slice(lead.length).search(/;|\n/);
  return end === -1 ? rest.slice(lead.length) : rest.slice(lead.length, lead.length + end + 1);
}

/** The expression to the LEFT of `idx`, back to the nearest statement/argument
 *  boundary. Used to read the test of a ternary and the left side of an `&&`. */
function expressionBefore(text, idx) {
  const head = text.slice(0, idx);
  let start = -1;
  for (const ch of ["\n", ";", "{", "}", "(", ",", "=", "&", "|", "?", ":"]) {
    start = Math.max(start, head.lastIndexOf(ch));
  }
  return head.slice(start + 1);
}

/**
 * Every signing branch ENABLED by a positive truthiness test on a secret, in any of
 * the three shapes this codebase actually writes:
 *
 *   if (secret) { sign }            — the original, and the one found in the tree
 *   if (secret) sign(...)           — the same thing without braces
 *   cond ? sign(...) : undefined    — a skip written as an expression
 *   cond && (headers[x] = sign(…))  — the same skip, written shorter
 *
 * The last two were invisible to this gate: it looked for the keyword `if`, so the two
 * most compact ways to write the identical fail-open were unscanned. A gate that holds
 * one spelling of a rule holds the rule only for people who write it that way.
 */
export function signingBranchesGatedOnSecret(rawText) {
  const text = stripComments(rawText);
  const out = [];
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  const record = (i, condition, shape) => {
    if (secretIsRequiredParam(text, i, condition)) return;
    const decl = enclosingDeclaration(text, i);
    if (decl !== null && INBOUND_VERIFIERS.has(decl.name)) return;
    out.push({ line: lineOf(i), condition: condition.trim().slice(0, 60), shape });
  };

  for (const m of text.matchAll(/\bif\s*\(/g)) {
    // Balance the condition's parens.
    let depth = 0;
    let close = -1;
    for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    const condition = text.slice(m.index + m[0].length, close);
    if (!isPositiveSecretTruthiness(condition)) continue;
    const body = guardedStatement(text, close);
    if (!SIGN_OP.test(body)) continue;
    record(m.index, condition, "if");
  }

  // `cond ? <signing> : <nothing>` — skip `?.`, `??` and a `?` that is an optional
  // parameter marker.
  for (const m of text.matchAll(/\?/g)) {
    const next = text[m.index + 1];
    if (next === "." || next === "?" || next === ":") continue;
    if (text[m.index - 1] === "?") continue;
    const condition = expressionBefore(text, m.index);
    if (!isPositiveSecretTruthiness(condition)) continue;
    const consequent = text.slice(m.index + 1, m.index + 1 + 400).split(/\n\s*\n/)[0];
    if (!SIGN_OP.test(consequent.split(/(?<![?:]):(?!:)/)[0])) continue;
    record(m.index, condition, "ternary");
  }

  // `cond && <signing>` — the assignment form the review named, and any other.
  for (const m of text.matchAll(/&&/g)) {
    const condition = expressionBefore(text, m.index);
    if (!isPositiveSecretTruthiness(condition)) continue;
    const rest = text.slice(m.index + 2);
    const end = rest.search(/;|\n/);
    const right = end === -1 ? rest : rest.slice(0, end);
    if (!SIGN_OP.test(right)) continue;
    record(m.index, condition, "&&");
  }

  return out.sort((a, b) => a.line - b.line);
}

// ── falsification harness ────────────────────────────────────────────────────
function selfTest() {
  const planted = [
    "class A {",
    "  send(body) {",
    "    if (this.config.signingSecret) {",
    "      headers['X-Signature'] = signBody(body, this.config.signingSecret);",
    "    }",
    "    return fetch(url, { headers });",
    "  }",
    "}",
  ].join("\n");
  const fixed = [
    "class A {",
    "  send(body) {",
    "    if (!this.config.signingSecret?.trim()) {",
    "      throw new Error('Webhook signing secret not configured');",
    "    }",
    "    headers['X-Signature'] = signBody(body, this.config.signingSecret);",
    "    return fetch(url, { headers });",
    "  }",
    "}",
  ].join("\n");
  const requiredParam = [
    "export function signBody(body: string, secret: string): string {",
    "  if (secret) {",
    "    return createHmac('sha256', secret).update(body).digest('hex');",
    "  }",
    "  return '';",
    "}",
  ].join("\n");
  const unrelated = [
    "if (this.config.clientSecret) {",
    "  const token = await this.getClientCredentialsToken();",
    "}",
  ].join("\n");
  const commented = [
    "// This was `if (this.config.signingSecret) { headers['X-Signature'] = signBody(b, s); }`",
    "const x = 1;",
  ].join("\n");

  // THE REVIEWER'S PLANT, kept permanently. Identical to `planted` except that a
  // helper taking a REQUIRED `secret: string` has been moved above the class. Nothing
  // about the defect changed; the old walk-back found that helper instead of the
  // method and excluded a live fail-open.
  const reordered = [
    "export function signBody(body: string, secret: string): string {",
    "  return createHmac('sha256', secret).update(body).digest('hex');",
    "}",
    "",
    "class A {",
    "  send(body) {",
    "    if (this.config.signingSecret) {",
    "      headers['X-Signature'] = signBody(body, this.config.signingSecret);",
    "    }",
    "    return fetch(url, { headers });",
    "  }",
    "}",
  ].join("\n");
  const mismatchedParam = [
    "class A {",
    "  send(body: string, secret: string) {",
    "    if (this.config.signingSecret) {",
    "      headers['X-Signature'] = signBody(body, this.config.signingSecret);",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const braceless = [
    "class A {",
    "  send(body) {",
    "    if (this.config.signingSecret) headers['X-Signature'] = signBody(body, this.config.signingSecret);",
    "    return fetch(url, { headers });",
    "  }",
    "}",
  ].join("\n");
  const ternary = [
    "class A {",
    "  send(body) {",
    "    headers['X-Signature'] = this.config.signingSecret ? signBody(body, this.config.signingSecret) : undefined;",
    "    return fetch(url, { headers });",
    "  }",
    "}",
  ].join("\n");
  const andAnd = [
    "class A {",
    "  send(body) {",
    "    this.config.signingSecret && (headers['X-Signature'] = signBody(body, this.config.signingSecret));",
    "    return fetch(url, { headers });",
    "  }",
    "}",
  ].join("\n");
  const honestTernary = [
    "class A {",
    "  sign(body) {",
    "    if (!this.config.signingSecret?.trim()) throw new Error('Webhook signing secret not configured');",
    "    const alg = this.config.signingAlgorithm === 'hmac-sha512' ? 'sha512' : 'sha256';",
    "    return createHmac(alg, this.config.signingSecret).update(body).digest('hex');",
    "  }",
    "}",
  ].join("\n");

  const checks = [
    ["a signing branch enabled by `if (secret)` IS a finding — the planted defect",
      signingBranchesGatedOnSecret(planted).length === 1],
    ["the refusal form `if (!secret) throw` + unconditional signing is CLEAN (the gate does not punish the fix)",
      signingBranchesGatedOnSecret(fixed).length === 0],
    ["a helper whose secret is a REQUIRED parameter is excluded",
      signingBranchesGatedOnSecret(requiredParam).length === 0],
    ["the same helper with an OPTIONAL secret parameter is NOT excluded",
      signingBranchesGatedOnSecret(requiredParam.replace("secret: string", "secret?: string")).length === 1],
    ["the REORDERED plant is still a finding — moving a helper is not a security control",
      signingBranchesGatedOnSecret(reordered).length === 1],
    ["the enclosing declaration of a branch inside a class method IS that method, not the helper above it",
      enclosingDeclaration(reordered, reordered.indexOf("if (this.config.signingSecret)")).name === "send"],
    ["a method that takes a required `secret` but tests a DIFFERENT expression is NOT excluded",
      signingBranchesGatedOnSecret(mismatchedParam).length === 1],
    ["the same helper, testing its OWN required parameter, still IS excluded",
      signingBranchesGatedOnSecret(requiredParam).length === 0],
    ["a BRACELESS `if (secret) sign(...)` is a finding — the same skip without braces",
      signingBranchesGatedOnSecret(braceless).length === 1],
    ["`cond ? sign(...) : undefined` is a finding — the planted defect in expression form",
      signingBranchesGatedOnSecret(ternary).length === 1],
    ["`cond && (headers[...] = sign(...))` is a finding — the same skip, written shorter",
      signingBranchesGatedOnSecret(andAnd).length === 1],
    ["the refusal form plus an ALGORITHM ternary is clean — the gate does not punish honest code",
      signingBranchesGatedOnSecret(honestTernary).length === 0],
    ["a non-signing branch on a secret (OAuth method selection) is not a signing branch",
      signingBranchesGatedOnSecret(unrelated).length === 0],
    ["the defect quoted in a COMMENT is not the defect", signingBranchesGatedOnSecret(commented).length === 0],
    ["a comparison against a secret is not a truthiness test", isPositiveSecretTruthiness("secret === 'x'") === false],
    ["a bare secret identifier IS a truthiness test", isPositiveSecretTruthiness("this.config.signingSecret") === true],
    ["a negated secret is NOT a truthiness test", isPositiveSecretTruthiness("!this.config.signingSecret") === false],
    ["an optional-chained negation is NOT a truthiness test", isPositiveSecretTruthiness("!secret?.trim()") === false],
    ["blockAfter balances nested braces rather than stopping at the first `}`",
      blockAfter("{ a; { b; } c; }", 0) === "{ a; { b; } c; }"],
    ["the inbound-verifier exclusion map is a Map that can hold an entry",
      INBOUND_VERIFIERS instanceof Map],
    // The map is no longer empty, so "does it hold an entry" is no longer the whole
    // question: every entry must carry a REASON a reader can check, and must name a
    // function that actually exists under the scan root. An exclusion for a symbol
    // that has been renamed or deleted silences a file nobody is watching.
    ["every inbound-verifier exclusion carries a non-trivial reason",
      [...INBOUND_VERIFIERS.values()].every((why) => typeof why === "string" && why.length > 40)],
    ["every excluded inbound verifier is a symbol that EXISTS under the scan root",
      // Enumerated HERE rather than reusing the module-level `files`: --self-test
      // exits above that binding, so referencing it threw a TDZ ReferenceError and
      // the self-test could not run at all.
      [...INBOUND_VERIFIERS.keys()].every((name) =>
        execFileSync("git", ["ls-files", SCAN_ROOT], { cwd: repoRoot, encoding: "utf8" })
          .split("\n").filter((f) => f.endsWith(".ts"))
          .some((f) => new RegExp(`function\\s+${name}\\b`).test(readFileSync(resolve(repoRoot, f), "utf8"))))],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const files = execFileSync("git", ["ls-files", SCAN_ROOT], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const findings = [];
const signingFiles = [];
for (const file of files) {
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  if (SIGN_OP.test(stripComments(text))) signingFiles.push(file);
  for (const hit of signingBranchesGatedOnSecret(text)) {
    findings.push(`${file}:${hit.line}  [${hit.shape}]  ${hit.condition}`);
  }
}

console.log("Signing-unconditional gate — a missing secret refuses, it never sends unsigned\n");
console.log(`  connector files scanned:          ${files.length}`);
console.log(`  files that sign something:        ${signingFiles.length}`);
for (const f of signingFiles) console.log(`      ${f}`);
// DERIVED from the map, never narrated beside it. This line printed the literal
// "(none exist under the scan root today)" regardless of the map's contents, so it
// went on reporting an empty tree after `verifySignedWebhook` landed — a report that
// cannot be wrong is a report that cannot be right either.
console.log(
  `  inbound verifiers excluded:       ${INBOUND_VERIFIERS.size}` +
    (INBOUND_VERIFIERS.size === 0
      ? " (none exist under the scan root today)"
      : ` (${[...INBOUND_VERIFIERS.keys()].join(", ")})`),
);
for (const [name, why] of INBOUND_VERIFIERS) console.log(`      ${name} — ${why}`);

// FLOOR. A scan that finds no signing at all would report "no unconditional signing
// branch" over an empty set — green about nothing. Three files sign in this tree;
// two is just below, so one may legitimately be deleted without tripping this.
if (signingFiles.length < 2) {
  console.error(
    `\n✗ only ${signingFiles.length} file(s) matched a signing operation. Either signing left this` +
      "\n  tree, or SIGN_OP has stopped matching and this gate is measuring nothing.",
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n✗ ${findings.length} signing branch(es) enabled by a truthiness test on a secret:\n`);
  for (const f of findings) console.error(`    ${f}`);
  console.error(
    "\n  `if (secret) sign` fails OPEN: the request goes out UNSIGNED and reports success.\n" +
      "  Invert it — `if (!secret) refuse` with the reason webhooks/dispatch.ts already uses\n" +
      "  (adapters/signing.ts: SIGNING_SECRET_MISSING) — and sign unconditionally after.",
  );
  process.exit(1);
}

console.log("\n  NOT established: that any signature is VERIFIED downstream, that a secret is");
console.log("  strong or rotated, or anything about inbound paths. This gate holds one thing:");
console.log("  no outbound signing branch in these families can be skipped by an absent secret.");
console.log("\nSigning-unconditional gate passed.");

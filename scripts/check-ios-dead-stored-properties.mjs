// check-ios-dead-stored-properties — a stored optional nothing ever assigns is dead,
// and every member that reads it is dead with it.
//
//   node scripts/check-ios-dead-stored-properties.mjs             the guard
//   node scripts/check-ios-dead-stored-properties.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// The 2026-09-02 native sweep reported HybridIdentityProvider as a HIGH: it declared
// `primaryProvider` and `secondaryProvider`, and authenticate() built an OIDC provider
// as a LOCAL and returned without ever storing it. Five members read those two fields,
// so all five were dead — isAuthenticated permanently false, currentAccessToken and
// getAccessToken() permanently nil, refreshToken() a no-op, and revokeAuthentication()
// returning successfully having revoked NOTHING. Four of those five fail closed by
// accident. The fifth fails open: a caller was told a token was revoked when it was not.
//
// That was found by a human reading one class. It is a CLASS of defect, not an instance:
// a composite that forgets to keep what it built looks exactly like a composite that
// works, at every call site, and the compiler is happy either way because an optional
// that is only ever read is legal Swift. Run against the pre-fix source this rule
// rediscovers both fields at their reported lines, and it finds six more the sweep did
// not reach.
//
// SCOPE RULE, and it is the part that makes the difference between a gate and a nuisance.
// `private` and `fileprivate` in Swift confine assignment to the declaring file, so a
// same-file scan is complete for those. An internal property can legally be assigned from
// anywhere in the module — AuditLogger.currentSessionId is declared in AuditLogger.swift
// and assigned in SessionStateManager.swift, deliberately, with a comment saying why the
// value is PUSHED rather than PULLED — so those are scanned across the whole tree. Getting
// this backwards turns a correct design into a false failure, which is how a gate gets
// switched off.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = resolve(repo, "native/ios");

// A stored optional `var` with no initialiser: `[access] var name: Type?`
// Computed properties are excluded by requiring the line to END at the `?` — a computed
// property opens a `{` on the same line, and a stored one with a default carries `=`.
const DECL =
  /^\s*(?:(private|fileprivate|internal|public|open)\s+)?var\s+([A-Za-z_]\w*)\s*:\s*[^={\n]*\?\s*$/;
const FILE_SCOPED = new Set(["private", "fileprivate"]);

// Assignment, in every form Swift writes it: bare, through self, through another
// reference (`AuditLogger.shared.currentSessionId = …`), and inout (`&result`), which
// is how the Keychain and CoreFoundation APIs write their out-parameters.
const assignedBy = (name) => {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [new RegExp(`\\b${n}\\s*=(?!=)`), new RegExp(`&\\s*(?:[\\w.]*\\.)?${n}\\b`)];
};

function swiftFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "build" && e.name !== ".build" && e.name !== "DerivedData") out.push(...swiftFiles(p));
    } else if (e.name.endsWith(".swift")) {
      out.push(p);
    }
  }
  return out;
}

// A declaration is not an assignment, and neither is a line of prose. Comment lines are
// dropped so that a field named in the explanation of why it exists does not count as
// the code that fills it.
const code = (lines, skipIndex) =>
  lines.filter((l, i) => i !== skipIndex && !l.trimStart().startsWith("//"));

export function scan(files, read = (f) => readFileSync(f, "utf8")) {
  const sources = files.map((f) => ({ file: f, lines: read(f).split("\n") }));
  const everyLine = sources.flatMap((s) => s.lines.filter((l) => !l.trimStart().startsWith("//")));
  const dead = [];

  for (const { file, lines } of sources) {
    lines.forEach((line, i) => {
      const m = DECL.exec(line);
      if (!m) return;
      const [, access, name] = m;
      // `weak var delegate: Foo?` is assigned by whoever wires the delegate, which is
      // routinely another type and often another module. Not this rule's business.
      if (/\bweak\b|\bunowned\b/.test(line)) return;
      const haystack = FILE_SCOPED.has(access) ? code(lines, i) : everyLine;
      const patterns = assignedBy(name);
      if (!haystack.some((l) => patterns.some((p) => p.test(l)))) {
        dead.push({
          file: relative(repo, file),
          line: i + 1,
          name,
          scope: FILE_SCOPED.has(access) ? access : access || "internal",
        });
      }
    });
  }
  return dead;
}

if (process.argv.includes("--self-test")) {
  // Drive the real scanner over in-memory fixtures. A guard nobody has watched fail is
  // a guard nobody should trust, so each arm below is a defect this rule must catch or
  // a correct shape it must not flag.
  const fixtures = {
    // The defect, in the exact shape the sweep found it: declared, read, never stored.
    "/dead.swift": [
      "final class HybridIdentityProvider {",
      "    private var primaryProvider: IdentityProvider?",
      "    var isAuthenticated: Bool { primaryProvider?.isAuthenticated == true }",
      "    func authenticate() {",
      "        let oidcProvider = OIDCIdentityProvider()",
      "        _ = oidcProvider",
      "    }",
      "}",
    ].join("\n"),
    // The same class, fixed. Assignment through self must count.
    "/live.swift": [
      "final class HybridIdentityProvider {",
      "    private var primaryProvider: IdentityProvider?",
      "    func authenticate() {",
      "        self.primaryProvider = OIDCIdentityProvider()",
      "    }",
      "}",
    ].join("\n"),
    // Internal property assigned from ANOTHER file — the AuditLogger.currentSessionId
    // shape. Flagging this would be a false failure.
    "/logger.swift": ["final class AuditLogger {", "    var currentSessionId: String?", "}"].join("\n"),
    "/manager.swift": [
      "final class SessionStateManager {",
      "    func start() { AuditLogger.shared.currentSessionId = id }",
      "}",
    ].join("\n"),
    // inout out-parameter, the Keychain shape.
    "/keychain.swift": [
      "func read() {",
      "    var result: AnyObject?",
      "    SecItemCopyMatching(query, &result)",
      "}",
    ].join("\n"),
    // A comment naming the field is not code that fills it.
    "/commented.swift": [
      "final class Thing {",
      "    private var token: String?",
      "    // token = refreshed() is what this WOULD do once the endpoint exists",
      "}",
    ].join("\n"),
  };
  const files = Object.keys(fixtures);
  const hits = scan(files, (f) => fixtures[f]);
  const named = (f, n) => hits.some((h) => h.file.endsWith(f) && h.name === n);

  const caughtDead = named("dead.swift", "primaryProvider");
  const passesAssigned = !named("live.swift", "primaryProvider");
  const passesCrossFile = !named("logger.swift", "currentSessionId");
  const passesInout = !named("keychain.swift", "result");
  const caughtCommentOnly = named("commented.swift", "token");
  const ok = caughtDead && passesAssigned && passesCrossFile && passesInout && caughtCommentOnly;
  console.log(
    ok
      ? "PASS  self-test - a never-assigned stored optional is caught; self-assignment, cross-file assignment to an internal property, and inout out-parameters are not flagged; a comment does not count as an assignment"
      : `FAIL  self-test - caughtDead=${caughtDead} passesAssigned=${passesAssigned} passesCrossFile=${passesCrossFile} passesInout=${passesInout} caughtCommentOnly=${caughtCommentOnly}`,
  );
  process.exit(ok ? 0 : 1);
}

const files = swiftFiles(IOS);
const dead = scan(files);
if (dead.length) {
  console.error(`x ${dead.length} stored propert${dead.length === 1 ? "y" : "ies"} that nothing ever assigns:\n`);
  for (const d of dead) console.error(`    ${d.file}:${d.line}  ${d.name}  (${d.scope})`);
  console.error(`
Each one is permanently nil, so every member that reads it is dead code that still
compiles and still looks correct at the call site. Where the field backs a composite —
a provider that keeps what it authenticated with, a reader that keeps its config — the
dead read can also fail OPEN: HybridIdentityProvider.revokeAuthentication(token:)
returned successfully while revoking nothing, because the provider it would have
revoked was never stored.

Assign it where the value is produced, or delete the field and the members that read it
and say plainly that the surface is not implemented.
`);
  process.exit(1);
}
console.log(
  `OK iOS stored properties - every stored optional is assigned somewhere (checked ${files.length} .swift files).`,
);

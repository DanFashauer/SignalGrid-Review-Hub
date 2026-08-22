// Consolidated safety gate for SignalGrid. Enforces the project's standing
// guardrails as one fast, dependency-free check. Complements (does not replace)
// gitleaks/CodeQL/Dependabot and the proof suite.
//
//   node scripts/safety-check.mjs
//
// Checks:
//   1. Core determinism — no Date.now()/Math.random() in the deterministic core.
//   2. No high-confidence secret patterns in tracked source.
//   3. Postman collection is in sync with the /v1 OpenAPI spec.
//   4. Public /api demo surface stays fixture-safe (no live-integration default).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
  .split("\n").filter(Boolean);
const read = (f) => { try { return readFileSync(resolve(repo, f), "utf8"); } catch { return ""; } };
const isCode = (line) => { const t = line.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); };

// 1 — core determinism ────────────────────────────────────────────────────────
{
  const coreFiles = tracked.filter((f) => f.startsWith("lib/signalgrid-core/src/") && f.endsWith(".ts"));
  const hits = [];
  for (const f of coreFiles) {
    read(f).split("\n").forEach((line, i) => {
      if (isCode(line) && /\b(Date\.now|Math\.random)\s*\(/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  if (hits.length) bad(`Core determinism: Date.now/Math.random in core — ${hits.join(", ")}`);
  else ok("Core determinism: no Date.now/Math.random in the decision core");
}

// 2 — secret patterns ─────────────────────────────────────────────────────────
{
  const PATTERNS = [
    [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
    [/sk_live_[0-9A-Za-z]{20,}/, "Stripe live secret"],
    [/ghp_[0-9A-Za-z]{36}/, "GitHub PAT"],
    [/github_pat_[0-9A-Za-z_]{22,}/, "GitHub fine-grained PAT"],
    [/glpat-[0-9A-Za-z_-]{20}/, "GitLab PAT"],
    [/npm_[0-9A-Za-z]{36}/, "npm token"],
    [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
    [/SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/, "SendGrid key"],
    [/xox[baprs]-[0-9A-Za-z-]{10,}/, "Slack token"],
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/, "private key"],
  ];
  // Connection strings with an embedded REAL-looking password — the exact class
  // an operator pastes into a doc as a DATABASE_URL command line (backlog row
  // 16's named blind spot). Deliberately NOT a bare regex in PATTERNS: the lab
  // legitimately commits throwaway creds like postgres://fleet:fleet@ and
  // mysql root:root, so a hit requires a password that is (a) >= 8 chars,
  // (b) different from the username, and (c) not an obvious placeholder —
  // otherwise every compose file goes red and the gate gets switched off,
  // which is how blind spots are born.
  const CONN_RE = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/([^\s:/@'"]+):([^\s@'"]{1,})@/g;
  const PLACEHOLDER = /^(?:pass(?:word)?|secret|changeme|example|test|xxx+|\*+|<[^>]*>|\$\{[^}]*\}|\$[A-Z_]+|%s|\{\{[^}]*\}\})$/i;
  const connHit = (body) => {
    for (const m of body.matchAll(CONN_RE)) {
      const [, user, pw] = m;
      // High-confidence only: a real leaked password mixes letters and digits
      // (or is very long); CI/lab throwaways here are short lowercase words
      // ("sg", "fleet", "ci-smoke"). Without this, the gate fires on its own
      // repository's deliberate fixtures and gets switched off — the fate this
      // whole gate class is trying to escape.
      const mixed = /[0-9]/.test(pw) && /[a-zA-Z]/.test(pw);
      if (pw !== user && !PLACEHOLDER.test(pw) && ((pw.length >= 8 && mixed) || pw.length >= 16)) return true;
    }
    return false;
  };
  // SELF-TEST — a scanner nobody has watched fail proves nothing. Plants are
  // built at runtime by concatenation so this file never contains a matchable
  // literal; each pattern must catch its plant, and the connection-string rule
  // must catch a real-looking password while IGNORING the lab convention.
  {
    const plants = [
      ["AKIA" + "ABCDEFGHIJKLMNOP", "AWS access key id"],
      ["sk_live_" + "a1b2c3d4e5f6a1b2c3d4e5", "Stripe live secret"],
      ["ghp_" + "a".repeat(36), "GitHub PAT"],
      ["github_pat_" + "b".repeat(24), "GitHub fine-grained PAT"],
      ["glpat-" + "c".repeat(20), "GitLab PAT"],
      ["npm_" + "d".repeat(36), "npm token"],
      ["AIza" + "e".repeat(35), "Google API key"],
      ["SG." + "f".repeat(22) + "." + "g".repeat(43), "SendGrid key"],
      ["xoxb-" + "1234567890-abc", "Slack token"],
      ["-----BEGIN RSA PRIVATE KEY" + "-----", "private key"],
    ];
    const missed = plants.filter(([plant, label]) =>
      !PATTERNS.some(([re, l]) => l === label && re.test(plant)));
    const connPlant = "postgres" + "://svc_user:" + "S3cr3tPr0dPw!" + "@db.internal/app";
    const connLab = "postgres" + "://fleet:fleet" + "@sg-fleet-mysql/app";
    const connCi = "postgres" + "://signalgrid_runtime:" + "ci-smoke" + "@localhost/app";
    if (missed.length || !connHit(connPlant) || connHit(connLab) || connHit(connCi)) {
      bad(
        "Secret-scan SELF-TEST failed — " +
          (missed.length ? `patterns missing their plants: ${missed.map(([, l]) => l).join(", ")}; ` : "") +
          (!connHit(connPlant) ? "connection-string rule missed a real-looking password; " : "") +
          (connHit(connLab) ? "connection-string rule fired on the lab fleet:fleet convention; " : "") +
          (connHit(connCi) ? "connection-string rule fired on a short lowercase CI throwaway; " : "") +
          "a scanner that cannot fail proves nothing",
      );
    } else ok("Secret-scan self-test: every pattern catches its plant; lab creds ignored");
  }
  const scan = tracked.filter((f) =>
    !f.includes("pnpm-lock.yaml") && !f.endsWith(".png") && !f.endsWith(".jpg") &&
    !f.startsWith("docs/postman/") && f !== "scripts/safety-check.mjs");
  const hits = [];
  for (const f of scan) {
    const body = read(f);
    for (const [re, label] of PATTERNS) if (re.test(body)) hits.push(`${f} (${label})`);
    if (connHit(body)) hits.push(`${f} (connection string with embedded password)`);
  }
  if (hits.length) bad(`Secret scan: possible secrets — ${hits.join(", ")}`);
  else ok("Secret scan: no high-confidence secret patterns in tracked source");
}

// 3 — Postman in sync with the /v1 spec ───────────────────────────────────────
{
  try {
    execFileSync("node", ["scripts/build-postman.mjs", "--check"], { cwd: repo, stdio: "pipe" });
    ok("Postman collection covers every /v1 OpenAPI path");
  } catch (e) {
    // Relay the CHECKER'S OWN OUTPUT, whole. This read `.split("\n").pop()` —
    // the last line only — and the checker prints a headline followed by one
    // line per drifted path, so the headline was thrown away and the gate
    // reported `Postman/spec drift:` with an EMPTY message. A gate that fails
    // without saying why costs the next person a bisect to recover what the
    // failing command already knew. stderr is included because a crash in the
    // checker writes there, not to stdout.
    const detail = [String(e.stdout ?? ""), String(e.stderr ?? "")]
      .join("\n")
      .trim();
    bad(`Postman/spec drift:\n${detail || `(checker produced no output) ${e.message}`}`);
  }
}

// 4 — fixture-safe default ────────────────────────────────────────────────────
{
  const tier = read("artifacts/api-server/src/lib/tier.ts");
  // Assert the ACTUAL fail-safe guard inside isLiveIntegrationsEnabled — not a
  // decoupled "return false" + "dev/alpha" co-occurrence anywhere in the file
  // (which would still pass if the guard were refactored to fail open). Scope to
  // the function body and require: only beta/prod may be live, everything else
  // returns false. Fail closed if the function or that guard is absent.
  const fn = tier.match(/export function isLiveIntegrationsEnabled[\s\S]*?\n}/);
  const guarded =
    !!fn &&
    /!==\s*["']beta["']\s*&&\s*[^)]*!==\s*["']prod["']/.test(fn[0]) &&
    /return\s+false/.test(fn[0]);
  if (guarded) ok("Live integrations fail safe by default (only beta/prod can enable; all other tiers return false)");
  else bad("Tier gate: isLiveIntegrationsEnabled fail-safe guard (non-beta/prod → return false) not found");
}

console.log("");
if (failures.length) {
  console.error(`Safety gate FAILED (${failures.length} issue${failures.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log("Safety gate passed — guardrails intact.");

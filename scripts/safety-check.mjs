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
    [/xox[baprs]-[0-9A-Za-z-]{10,}/, "Slack token"],
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/, "private key"],
  ];
  const scan = tracked.filter((f) =>
    !f.includes("pnpm-lock.yaml") && !f.endsWith(".png") && !f.endsWith(".jpg") &&
    !f.startsWith("docs/postman/") && f !== "scripts/safety-check.mjs");
  const hits = [];
  for (const f of scan) {
    const body = read(f);
    for (const [re, label] of PATTERNS) if (re.test(body)) hits.push(`${f} (${label})`);
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
    bad(`Postman/spec drift: ${String(e.stdout || e.message).trim().split("\n").pop()}`);
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

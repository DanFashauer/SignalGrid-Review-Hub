// SignalGrid invariant reviewer — the automated "second reviewer".
//
// A deterministic, dependency-free adversarial pass that encodes the classes of
// defect that human/LLM review (Codex) has repeatedly caught on this repo, so
// they are caught BEFORE a push instead of after. It complements — does not
// replace — the proof suite, the safety gate, and the pre-PR agent review
// documented in docs/SELF_REVIEW.md.
//
//   node scripts/review-invariants.mjs
//
// Invariants enforced:
//   1. Fail-closed control flow — every `switch` in the decision/gating/planner
//      libs has a `default:` arm (an unhandled outcome must never fall through
//      to permissive behaviour). This is the exact class Codex #70 caught.
//   2. Determinism — no Date.now()/Math.random() in the pure decision, gating,
//      flow, recommendation, or discovery libs (safety:check covers the core;
//      this extends the same rule to every deterministic planner).
//   3. Assist catalog invariant — no app-workflow action is marked `critical`
//      while being non-sensitive (a critical action must always require human
//      confirmation; the proof asserts the runtime, this guards the source).
//   4. Truth guard — a small, extensible denylist of internal over-claims that
//      contradicted the code (e.g. "every catalog gates live" when one vertical
//      is catalog-only, Codex #79). Extend as new lessons land.
//   5. Public-safe web — no third-party vendor host (fonts/analytics/CDN) in a
//      PUBLISHED web artifact; that would leak a visitor's IP to a vendor
//      (Codex #81, fonts.googleapis.com). Self-host assets instead.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

// Tracked AND untracked-but-not-ignored files, so a NEW file is reviewed before
// it is ever staged (a tracked-only scan would miss it until commit — exactly
// how a self-referential doc slipped past preflight the first time).
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: repo, encoding: "utf8" },
).split("\n").filter(Boolean);
const read = (f) => { try { return readFileSync(resolve(repo, f), "utf8"); } catch { return ""; } };

// The pure planner/decision libs: no side effects, no wall-clock, fail closed.
const GATING_LIBS = [
  "lib/app-workflows/src/",
  "lib/orchestration/src/",
  "lib/flows/src/",
];
const PURE_LIBS = [
  ...GATING_LIBS,
  "lib/recommendations/src/",
  "lib/signal-discovery/src/",
];
const isTs = (f) => f.endsWith(".ts") && !f.endsWith(".d.ts");
const inAny = (f, prefixes) => prefixes.some((p) => f.startsWith(p));

// Strip line/block comments so textual scans don't trip on prose in comments.
// Block comments are blanked in place (newlines preserved) so reported line
// numbers stay accurate.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

// 1 — fail-closed switches ─────────────────────────────────────────────────────
// Every `switch (...) { ... }` in the gating libs must contain a `default:` arm.
{
  const violations = [];
  const files = tracked.filter((f) => isTs(f) && inAny(f, GATING_LIBS));
  for (const f of files) {
    const code = stripComments(read(f));
    let i = 0;
    while ((i = code.indexOf("switch", i)) !== -1) {
      // Ensure it is the keyword, not part of an identifier.
      const before = code[i - 1];
      if (before && /[A-Za-z0-9_$]/.test(before)) { i += 6; continue; }
      // Find the opening brace of the switch block after the condition's ")".
      const open = code.indexOf("{", i);
      if (open === -1) break;
      // Brace-match to the block end.
      let depth = 0, end = -1;
      for (let j = open; j < code.length; j++) {
        if (code[j] === "{") depth++;
        else if (code[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end === -1) break;
      const block = code.slice(open, end);
      if (!/\bdefault\s*:/.test(block)) {
        const line = code.slice(0, i).split("\n").length;
        violations.push(`${f}:${line}`);
      }
      i = end;
    }
  }
  if (violations.length) bad(`Fail-closed: switch without a default arm in a gating lib — ${violations.join(", ")}`);
  else ok("Fail-closed: every switch in the gating libs has a default arm");
}

// 2 — determinism in the pure planners ─────────────────────────────────────────
{
  const hits = [];
  const files = tracked.filter((f) => isTs(f) && inAny(f, PURE_LIBS));
  for (const f of files) {
    stripComments(read(f)).split("\n").forEach((line, idx) => {
      if (/\b(Date\.now|Math\.random)\s*\(/.test(line)) hits.push(`${f}:${idx + 1}`);
    });
  }
  if (hits.length) bad(`Determinism: Date.now/Math.random in a pure planner lib — ${hits.join(", ")}`);
  else ok("Determinism: no Date.now/Math.random in the pure planner libs");
}

// 3 — Assist catalog invariant: critical ⇒ sensitive ───────────────────────────
// Guard the source so no catalog entry declares a critical action non-sensitive.
{
  const catalogs = tracked.filter((f) => isTs(f) && f.includes("app-workflows/src/catalog"));
  const hits = [];
  for (const f of catalogs) {
    const code = stripComments(read(f));
    // Any action literal that is riskTier "critical" AND explicitly sensitive:false.
    const re = /"critical"\s*,\s*\{[^}]*sensitive\s*:\s*false/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const line = code.slice(0, m.index).split("\n").length;
      hits.push(`${f}:${line}`);
    }
  }
  if (hits.length) bad(`Assist invariant: a critical action is marked non-sensitive — ${hits.join(", ")}`);
  else ok("Assist invariant: no critical app-workflow action is non-sensitive");
}

// 4 — truth guard: internal over-claims that contradicted the code ─────────────
// Exact phrases only; extend as review lessons land. Comments are scanned too,
// since the over-claims Codex caught lived in doc comments.
{
  const DENY = [
    "every app-workflow catalog gates against a live decision",
    "every catalog gates live",
    "all app-workflow catalogs gate live",
  ];
  // The reviewer's own script and its documentation necessarily quote the
  // denylisted phrases as negative examples, so they are exempt from the scan.
  const META = new Set(["scripts/review-invariants.mjs", "docs/SELF_REVIEW.md"]);
  const scan = tracked.filter((f) =>
    (f.startsWith("lib/") || f.startsWith("docs/") || f.startsWith("artifacts/")) &&
    (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".md")) &&
    !META.has(f));
  const hits = [];
  for (const f of scan) {
    const body = read(f).toLowerCase();
    for (const phrase of DENY) if (body.includes(phrase)) hits.push(`${f} ("${phrase}")`);
  }
  if (hits.length) bad(`Truth guard: internal over-claim found — ${hits.join(", ")}`);
  else ok("Truth guard: no known internal over-claim phrasings present");
}

// 5 — public-safe web: no third-party vendor host in a PUBLISHED web artifact ──
// Anything the Pages deploy publishes (the web app + any static HTML we ship)
// must not pull a resource from a third-party host — that would hand a visitor's
// IP/metadata to a vendor, contrary to the no-vendor-calls rule and the "no
// server, no data" framing. Fonts/analytics/CDNs are the usual offenders; this
// is the class Codex #81 caught (fonts.googleapis.com). Extend the host list as
// new vendors appear. Self-host assets (e.g. @fontsource) instead.
{
  const VENDOR_HOSTS = [
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "google-analytics.com",
    "googletagmanager.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "ajax.googleapis.com",
  ];
  // Published surfaces: the web marketing app's shell + source, and the static
  // HTML files the Pages workflow copies into the site.
  const scan = tracked.filter((f) =>
    (f.startsWith("artifacts/signalgrid-web/") &&
      (f.endsWith(".html") || f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".css"))) ||
    (f.startsWith("docs/") && f.endsWith(".html")) ||
    (f.startsWith("site/") && f.endsWith(".html")));
  const hits = [];
  for (const f of scan) {
    const body = read(f);
    for (const host of VENDOR_HOSTS) if (body.includes(host)) hits.push(`${f} (${host})`);
  }
  if (hits.length) bad(`Public-safe web: third-party vendor host in a published artifact — ${hits.join(", ")}. Self-host it instead.`);
  else ok("Public-safe web: no third-party vendor host in any published web artifact");
}

console.log("");
if (failures.length) {
  console.error(`Invariant review FAILED (${failures.length} issue${failures.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log("Invariant review passed — fail-closed, deterministic, Assist-safe, truthful.");

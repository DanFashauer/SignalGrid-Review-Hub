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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
// PURE_LIBS stays a HAND-LISTED, NARROW set on purpose: checks 1 and 3 assert
// fail-closed switch shapes that are only meaningful for the planner libs, and
// widening those to every package would flag correct code everywhere.
const PURE_LIBS = [
  ...GATING_LIBS,
  "lib/recommendations/src/",
  "lib/signal-discovery/src/",
  "lib/event-contract/src/",
  "lib/posture-composition/src/",
  "lib/incident-playbook/src/",
];

// DETERMINISM SCOPE IS DERIVED FROM THE FILESYSTEM, not listed here.
//
// The clock rule is not a planner-library rule; it is a repository rule. A
// hand-listed scope covered EIGHT of the thirty-four packages under lib/, and
// the list is a fossil the day someone adds a package — the new one is simply
// not scanned, and nothing says so.
//
// What this does NOT cover, stated so nobody assumes otherwise: the decision
// core itself is scanned by `scripts/safety-check.mjs` check 1
// (`lib/signalgrid-core/src/`), which predates this and stays where it is. The
// two together now cover every package under lib/.
const determinismScope = () => {
  const dirs = readdirSync(resolve(repo, "lib"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `lib/${e.name}/src/`);
  return dirs.filter((d) => existsSync(resolve(repo, d)));
};

// A package that legitimately reads the clock is DECLARED, with the reason, the
// condition that retires the entry, and a PINNED count.
//
// The pin is the anti-fossil part and it fails in BOTH directions. More reads
// than declared means new ones arrived unexamined. FEWER means the entry has
// outlived some of its justification and should be re-stated or removed. An
// exemption that quietly stops matching reality is the failure mode every other
// declared-exemption in this repo exists to prevent.
const DECLARED_CLOCK_READS = new Map([
  [
    "lib/integrations/src/",
    {
      count: 22,
      reason:
        "Connector boundary. Fixture/demo enrolment and last-seen timestamps, and freshness computed " +
        "AT the boundary where wall-clock is the input being read — not a decision path. The decision " +
        "core receives the derived Freshness value and never reads a clock itself.",
      retires: "When connector fixtures move to injected clocks, this drops to the freshness derivations only.",
    },
  ],
  [
    "lib/location/src/",
    {
      count: 5,
      reason:
        "Signal observation stamps and the TTL sweep. Reading the clock is the point of an age check; " +
        "what must not happen is a DECISION reading it, and location emits signals rather than verdicts.",
      retires:
        "Retires when location-services stops being a DEFERRED family and its clock reads move behind " +
        "an injected clock. NOT by deleting the package — that deletion was considered and REJECTED " +
        "(docs/COMPANY_BUILD_PLAN.md row 51a): zero importers is the expected state of a deferred " +
        "family's implementation, not evidence it is dead.",
    },
  ],
  [
    "lib/webauthn/src/",
    {
      count: 13,
      reason:
        "Challenge and step-up session expiry. An expiry check is inherently clock-dependent; the risk " +
        "here was never the read but its DIRECTION, which is now gated separately by " +
        "scripts/check-nan-fail-open.mjs after TEN fail-open sites were found on this surface. " +
        "12 -> 13 on 2026-08-24: verifyStepUp compared bare Date objects (`new Date(a) < new Date()`), " +
        "which reads an unparseable expiry as VALID; closing it required an explicit Date.now() beside a " +
        "finiteness check. This pin is what surfaced the delta — the fix was written, preflight failed on " +
        "the count, and the number was re-stated deliberately rather than drifting.",
      retires: "When step-up moves to an injected clock for testability, this drops to the store TTLs.",
    },
  ],
]);
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

// Blank the TEXT of string and template literals (keeping delimiters + newlines,
// so offsets and line numbers are preserved) so that braces or keywords inside a
// literal are never mistaken for code structure. Template `${…}` expressions are
// real code and are left intact via a small mode stack. This is what lets the
// brace matcher below bound switch blocks correctly even when a `case` body
// contains a string like `"}"` or a backtick template with `{`.
function maskLiterals(src) {
  const arr = src.split("");
  const n = src.length;
  const blank = (k) => { if (arr[k] !== "\n") arr[k] = " "; };
  const stack = [{ mode: "code", depth: 0 }];
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top.mode === "code") {
      if (c === "\\") { i += 2; continue; }
      if (c === "'") { stack.push({ mode: "sq" }); i++; continue; }
      if (c === '"') { stack.push({ mode: "dq" }); i++; continue; }
      if (c === "`") { stack.push({ mode: "tmpl" }); i++; continue; }
      if (c === "{") { top.depth++; i++; continue; }
      if (c === "}") {
        if (top.depth === 0 && stack.length > 1) { stack.pop(); i++; continue; } // close ${…}
        top.depth--; i++; continue;
      }
      i++; continue;
    }
    if (top.mode === "sq" || top.mode === "dq") {
      const q = top.mode === "sq" ? "'" : '"';
      if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
      if (c === q) { stack.pop(); i++; continue; }
      blank(i); i++; continue;
    }
    // template literal
    if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
    if (c === "`") { stack.pop(); i++; continue; }
    if (c === "$" && src[i + 1] === "{") { stack.push({ mode: "code", depth: 0 }); i += 2; continue; }
    blank(i); i++;
  }
  return arr.join("");
}

// Find every `switch (...) { … }` block (including nested ones) with proper,
// literal-aware brace matching. Returns { kw, open, end } offsets.
function findSwitchBlocks(code) {
  const blocks = [];
  let i = 0;
  while ((i = code.indexOf("switch", i)) !== -1) {
    const before = code[i - 1];
    const after = code[i + 6];
    // Must be the keyword, not part of an identifier (e.g. `switching`).
    if ((before && /[A-Za-z0-9_$]/.test(before)) || (after && /[A-Za-z0-9_$]/.test(after))) {
      i += 6; continue;
    }
    const open = code.indexOf("{", i);
    if (open === -1) break;
    let depth = 0, end = -1;
    for (let j = open; j < code.length; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) break;
    blocks.push({ kw: i, open, end });
    // Advance past the keyword (NOT past `end`) so nested switches are found too.
    i += 6;
  }
  return blocks;
}

// 1 — fail-closed switches ─────────────────────────────────────────────────────
// Every `switch (...) { ... }` in the gating libs must contain a `default:` arm.
{
  const violations = [];
  const files = tracked.filter((f) => isTs(f) && inAny(f, GATING_LIBS));
  for (const f of files) {
    // Mask literals AFTER stripping comments so neither prose nor string/template
    // contents can spoof (or hide) a `{`, `}`, `switch`, or `default:`.
    const code = maskLiterals(stripComments(read(f)));
    const blocks = findSwitchBlocks(code);
    for (const b of blocks) {
      // Check THIS switch's own default arm — blank any nested switch blocks so a
      // nested `default:` cannot satisfy an outer switch that lacks its own.
      const body = code.slice(b.open, b.end + 1).split("");
      for (const c of blocks) {
        if (c === b) continue;
        if (c.kw > b.open && c.end < b.end) {
          for (let k = c.open; k <= c.end; k++) {
            const idx = k - b.open;
            if (body[idx] !== "\n") body[idx] = " ";
          }
        }
      }
      if (!/\bdefault\s*:/.test(body.join(""))) {
        const line = code.slice(0, b.kw).split("\n").length;
        violations.push(`${f}:${line}`);
      }
    }
  }
  if (violations.length) bad(`Fail-closed: switch without a default arm in a gating lib — ${violations.join(", ")}`);
  else ok("Fail-closed: every switch in the gating libs has a default arm");
}

// 2 — determinism in the pure planners ─────────────────────────────────────────
{
  const scope = determinismScope();
  const files = tracked.filter((f) => isTs(f) && inAny(f, scope));
  // LITERALS ARE MASKED as well as comments. This scan used stripComments alone
  // while check 1 above used maskLiterals(stripComments(...)) — a difference that
  // did not matter while the scope was eight planner libs and matters immediately
  // at thirty-four packages, where a string containing the text of a clock call
  // would be reported as a clock call.
  const byPackage = new Map();
  for (const f of files) {
    const code = maskLiterals(stripComments(read(f)));
    code.split("\n").forEach((line, idx) => {
      if (/\b(Date\.now|Math\.random)\s*\(/.test(line)) {
        const pkg = scope.find((p) => f.startsWith(p)) ?? f;
        if (!byPackage.has(pkg)) byPackage.set(pkg, []);
        byPackage.get(pkg).push(`${f}:${idx + 1}`);
      }
    });
  }

  const undeclared = [];
  const drifted = [];
  for (const [pkg, lines] of byPackage) {
    const declared = DECLARED_CLOCK_READS.get(pkg);
    if (!declared) {
      undeclared.push(`${pkg} (${lines.length}) — ${lines.slice(0, 3).join(", ")}${lines.length > 3 ? ", …" : ""}`);
    } else if (declared.count !== lines.length) {
      drifted.push(`${pkg}: declared ${declared.count}, found ${lines.length}`);
    }
  }
  // An exemption for a package that no longer reads the clock at all has outlived
  // its reason and must be removed, the same as every other declared exemption here.
  const stale = [...DECLARED_CLOCK_READS.keys()].filter((pkg) => !byPackage.has(pkg));

  if (undeclared.length || drifted.length || stale.length) {
    const parts = [];
    if (undeclared.length) parts.push(`UNDECLARED clock reads — ${undeclared.join(" | ")}`);
    if (drifted.length) parts.push(`COUNT DRIFT — ${drifted.join(" | ")} (a pin that stops matching is not a pin)`);
    if (stale.length) parts.push(`STALE exemption, package no longer reads a clock — ${stale.join(", ")}`);
    bad(`Determinism: ${parts.join("; ")}`);
  } else {
    const declaredTotal = [...DECLARED_CLOCK_READS.values()].reduce((n, d) => n + d.count, 0);
    ok(
      `Determinism: ${scope.length} packages scanned (derived from lib/), ` +
        `${byPackage.size} with declared clock reads (${declaredTotal} pinned), ` +
        `${scope.length - byPackage.size} at zero`,
    );
  }
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
    // DNS hostnames are case-insensitive, so lower-case the content before
    // matching the (already-lowercase) host list — FONTS.GOOGLEAPIS.COM must
    // trip the same as fonts.googleapis.com.
    const body = read(f).toLowerCase();
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

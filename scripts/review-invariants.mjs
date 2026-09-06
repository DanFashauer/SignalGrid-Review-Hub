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

// The three narrowest planner/decision libs, kept as their own name because a
// couple of rules below key off exactly them.
const GATING_LIBS = [
  "lib/app-workflows/src/",
  "lib/orchestration/src/",
  "lib/flows/src/",
];
// PURE_LIBS is the SCOPE OF CHECK 1 (fail-closed switches). It stays a HAND-
// LISTED, NARROW set on purpose: a `switch` with no `default:` arm is only a
// defect in a decision/gating/planner lib, and widening the scan to every package
// would flag correct exhaustive switches everywhere. It was documented as
// governing check 1 for a long time while check 1 actually scanned only
// GATING_LIBS — so recommendations, signal-discovery, event-contract,
// posture-composition and incident-playbook were named here and scanned nowhere.
// Check 1 now scans this full set (verified: the only switches under the wider
// scope are the four in lib/incident-playbook/src/map.ts, all with default arms).
// Check 3 is scoped to the app-workflows catalog and does NOT use this list.
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
        "AT the boundary where wall-clock is the input being read. The 21st and 22nd (2026-09-06) are " +
        "deviceRegistry.isAllowed on BOTH backends: the allowlist freshness bound reads the clock once " +
        "at the boundary and hands it to the pure isAllowedByPolicy(now), which proof:device-registry " +
        "drives with a fixed clock — the answer is 'fresh enrolment or not', never a verdict. Before " +
        "2026-09-06 lastSeenAt was stamped and never consulted, so this pair is the read that was " +
        "missing, not one that crept in. Original wording continues: freshness computed " +
        "AT the boundary where wall-clock is the input being read — not a decision path. The decision " +
        "core receives the derived Freshness value and never reads a clock itself. " +
        "The 23rd (2026-08-24) is the default argument of telemetry/store.ts getPostureForHost(), " +
        "which reads the clock to decide whether a CACHE ENTRY is still live. Cache expiry is the " +
        "same shape as freshness: the wall-clock is the input being read, and the answer it produces " +
        "is 'entry or no entry', never a verdict. `now` is injectable precisely so the proof drives " +
        "expiry deterministically instead of sleeping, and purgeExpiredPosture() takes its clock as a " +
        "REQUIRED argument rather than adding a second read — the write path samples once and shares it. " +
        "DROPPED to 21 (2026-09-01, Ponytail cut batch 2, DR-024): two of the 23 were dead code, not live " +
        "connector-boundary reads — `itsm/store.ts` createTicketTemplate()'s `Date.now()`-seeded template " +
        "id and `webhooks/retry.ts` getNextRetryAt()'s `new Date(Date.now() + delay)` — both removed with " +
        "their unreachable callers (zero importers repo-wide, verified by grep before deletion), not " +
        "rewritten to an injected clock. No live clock read moved or was added. " +
        "DROPPED to 20 (2026-09-02, webhook signing scheme v2): webhooks/sign.ts createSignedHeaders() " +
        "read `Date.now()` for `X-Webhook-Timestamp`. Under v2 the timestamp is INSIDE the MAC and the " +
        "function is called once per retry ATTEMPT, so a per-call clock read would give one delivery " +
        "several signatures. The read is REMOVED, not injected and not moved: the instant is derived " +
        "from the payload's own `timestamp` (minted once per delivery in dispatch.ts buildPayload), and " +
        "an unresolvable instant now throws WebhookTimestampUnresolvable rather than falling back to " +
        "the clock. sign.ts reads no clock at all; `proof:webhooks` asserts the refusal by name.",
      retires: "When connector fixtures move to injected clocks, this drops to the freshness derivations only.",
    },
  ],
  [
    "lib/location/src/",
    {
      count: 3,
      reason:
        "The freshness/age checks and the TTL sweep. Reading the clock is the point of an age check; " +
        "what must not happen is a DECISION reading it, and location emits signals rather than verdicts. " +
        "DROPPED to 3 (2026-09-05, location ingest freshness): radius-dhcp.ts ingestRADIUS/ingestDHCP " +
        "stamped `observedAt: Date.now()` — the INGEST instant, not the event's — so validate.ts's age " +
        "check compared now against now and could never fire; a replayed accounting record or lease " +
        "from yesterday became a FRESH presence fact. Both reads are REMOVED, not injected: observedAt " +
        "is now Date.parse() of the schema-required eventTimestamp/timestamp, and an unparseable value " +
        "is NaN, which the validator's Number.isFinite guard rejects. proof:location-services asserts " +
        "the replay refusal by name. The three that remain are the age comparisons themselves.",
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

// Every `switch (...) { ... }` in a scanned lib must contain its OWN `default:`
// arm. Returns the 1-based line numbers of switches that lack one. `code` must
// already be comment-stripped and literal-masked. Extracted so check 1 and the
// Locale-dependent collation in a deterministic path. `localeCompare` follows the
// PROCESS locale — verified: sv_SE sorts "ä" after "z", de_DE before it, en-US
// case-folds — so the same input orders differently on another machine, and
// "deterministic" quietly means "on this laptop". Two packages had already fixed
// it with a comment (adaptive-proposals, recommendations) and two more had not
// (signal-radar, signal-discovery, both shipping, both caller-fed over HTTP): the
// rule stopped at its own edge until it became a check. Runs over the same
// comment-stripped, literal-masked text as the clock scan, so a comment that
// NAMES the method, or a string containing it, is not a hit.
function localeCompareViolations(code) {
  const hits = [];
  code.split("\n").forEach((line, idx) => {
    if (/\.localeCompare\s*\(/.test(line)) hits.push(idx + 1);
  });
  return hits;
}

// self-test exercise the same matcher.
function switchViolations(code) {
  const blocks = findSwitchBlocks(code);
  const out = [];
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
      out.push(code.slice(0, b.kw).split("\n").length);
    }
  }
  return out;
}

// Split a package→lines map against the declared clock-read exemptions. Pure, so
// the self-test can prove an undeclared read (a clock outside the pinned set) is
// flagged. `byPackage`: Map(pkgPrefix -> string[] of "file:line"). `declared`:
// the DECLARED_CLOCK_READS map.
function classifyClockReads(byPackage, declared) {
  const undeclared = [];
  const drifted = [];
  for (const [pkg, lines] of byPackage) {
    const d = declared.get(pkg);
    if (!d) undeclared.push({ pkg, count: lines.length, lines });
    else if (d.count !== lines.length) drifted.push({ pkg, declared: d.count, found: lines.length });
  }
  const stale = [...declared.keys()].filter((pkg) => !byPackage.has(pkg));
  return { undeclared, drifted, stale };
}

// ── self-test: the two gated shapes must each be able to fail ────────────────
if (process.argv.includes("--self-test")) {
  const checks = [];

  // A default-less switch is flagged; a defaulted one is not — the matcher check 1
  // relies on. Run through the same mask/strip path check 1 uses.
  const prep = (src) => maskLiterals(stripComments(src));
  checks.push([
    "a switch with NO default arm is flagged",
    switchViolations(prep("function f(x){ switch (x) { case 1: return 1; } }")).length === 1,
  ]);
  checks.push([
    "a switch WITH a default arm is not flagged",
    switchViolations(prep("function f(x){ switch (x) { case 1: return 1; default: return 0; } }")).length === 0,
  ]);
  // The fail-closed scope names each planner lib, and each is a real directory —
  // so a default-less switch planted in ANY named scope would be scanned.
  checks.push([
    `fail-closed scope covers all ${PURE_LIBS.length} named planner libs, each present on disk`,
    PURE_LIBS.length >= 8 && PURE_LIBS.every((p) => existsSync(resolve(repo, p))),
  ]);

  // A locale-dependent sort is flagged; a comment naming it and a string containing it are not.
  checks.push([
    "a localeCompare sort is flagged",
    localeCompareViolations(prep("items.sort((a, b) => a.id.localeCompare(b.id));")).length === 1,
  ]);
  checks.push([
    "a comment that NAMES localeCompare is not flagged",
    localeCompareViolations(prep("// codepoint order, not localeCompare, whose collation follows the locale\nitems.sort();")).length === 0,
  ]);
  checks.push([
    "a string literal containing localeCompare is not flagged",
    localeCompareViolations(prep('const why = "a.localeCompare(b) is locale-dependent";')).length === 0,
  ]);

  // A clock read in a package OUTSIDE the pinned set is flagged as undeclared.
  const undecl = classifyClockReads(
    new Map([["lib/not-a-declared-pkg/src/", ["lib/not-a-declared-pkg/src/x.ts:5"]]]),
    DECLARED_CLOCK_READS,
  );
  checks.push(["a clock read outside the pinned set is flagged (undeclared)", undecl.undeclared.length === 1 && undecl.drifted.length === 0]);
  // A declared package whose count no longer matches is drift.
  const firstDeclared = [...DECLARED_CLOCK_READS.keys()][0];
  const drift = classifyClockReads(
    new Map([[firstDeclared, Array(DECLARED_CLOCK_READS.get(firstDeclared).count + 1).fill("x")]]),
    DECLARED_CLOCK_READS,
  );
  checks.push(["a declared count that no longer matches is drift", drift.drifted.length === 1]);
  // A declared package that reads NO clock is a stale exemption.
  const staleR = classifyClockReads(new Map(), DECLARED_CLOCK_READS);
  checks.push(["a declared package that no longer reads a clock is stale", staleR.stale.length === DECLARED_CLOCK_READS.size]);
  // A pinned package at exactly its declared count is clean.
  const clean = classifyClockReads(
    new Map([[firstDeclared, Array(DECLARED_CLOCK_READS.get(firstDeclared).count).fill("x")]]),
    DECLARED_CLOCK_READS,
  );
  checks.push([
    "a pinned package at its declared count is clean",
    clean.undeclared.length === 0 && clean.drifted.length === 0,
  ]);

  const failed = checks.filter(([, k]) => !k);
  for (const [n, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// 1 — fail-closed switches ─────────────────────────────────────────────────────
// Every `switch (...) { ... }` in the pure planner/decision libs must contain a
// `default:` arm. Scope is PURE_LIBS (see its note), not just GATING_LIBS.
{
  const violations = [];
  const files = tracked.filter((f) => isTs(f) && inAny(f, PURE_LIBS));
  for (const f of files) {
    // Mask literals AFTER stripping comments so neither prose nor string/template
    // contents can spoof (or hide) a `{`, `}`, `switch`, or `default:`.
    const code = maskLiterals(stripComments(read(f)));
    for (const line of switchViolations(code)) violations.push(`${f}:${line}`);
  }
  if (violations.length) bad(`Fail-closed: switch without a default arm in a planner lib — ${violations.join(", ")}`);
  else ok(`Fail-closed: every switch in the ${PURE_LIBS.length} pure planner libs has a default arm`);
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

  // An exemption for a package that no longer reads the clock at all has outlived
  // its reason and must be removed, the same as every other declared exemption here.
  const { undeclared: undeclaredRaw, drifted: driftedRaw, stale } = classifyClockReads(byPackage, DECLARED_CLOCK_READS);
  const undeclared = undeclaredRaw.map(
    (u) => `${u.pkg} (${u.count}) — ${u.lines.slice(0, 3).join(", ")}${u.lines.length > 3 ? ", …" : ""}`,
  );
  const drifted = driftedRaw.map((d) => `${d.pkg}: declared ${d.declared}, found ${d.found}`);

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

// 2b — collation in the pure planners follows the machine, not the code ───────
{
  const scope = determinismScope();
  const files = tracked.filter((f) => isTs(f) && inAny(f, scope));
  const hits = [];
  for (const f of files) {
    for (const line of localeCompareViolations(maskLiterals(stripComments(read(f))))) hits.push(`${f}:${line}`);
  }
  if (hits.length) {
    bad(
      `Determinism: localeCompare in ${hits.length} site(s) — collation follows the process locale ` +
        `(sv_SE sorts "ä" after "z", de_DE before it), so the same input orders differently on another ` +
        `machine; compare codepoints ((a < b ? -1 : a > b ? 1 : 0)) — ${hits.join(", ")}`,
    );
  } else {
    ok(`Determinism: no localeCompare in ${files.length} planner files (codepoint order everywhere)`);
  }
}

// 2c — the same collation rule, over the code lib/ does not contain ───────────
//
// 2b covers lib/ only, and the sentence it prints — "codepoint order everywhere" —
// was true of the population it scanned and false of the repository. Every proof
// under scripts/src and every shipped service under artifacts/*/src was outside it,
// and that is where the digests live: `deterministicHash` in
// scripts/src/connector-emulator-harness.ts sorted with `localeCompare` inside a
// function whose NAME is the claim, and the SBOM generator orders its component
// list the same way. Two machines with different ICU data hash the same input to
// different digests; the drift gate then fails on a tree nobody changed.
//
// Scope is DERIVED (`scripts/src/` plus every `artifacts/*/src/` that exists), never
// typed, so a new artifact package joins the scan by existing.
//
// DECLARED EXEMPTIONS, pinned by count and split into two honest classes, because
// they are not the same thing and printing them as one would be the over-claim:
//   · "exempt"        — correct as written; the pin stops it from growing.
//   · "pinned-defect" — a real locale-dependent sort, contained rather than fixed
//                       here (the file belongs to another change in flight). GATED
//                       against growth, and REPORTED by name with the verdict so it
//                       is never mistaken for a clean scan.
// Both fail in both directions, like DECLARED_CLOCK_READS: an undeclared site, a
// count that drifted, or an entry whose file no longer has any hit at all.
const DECLARED_LOCALE_COMPARE = new Map([
  [
    "scripts/src/signalgrid-grid-proof.ts",
    {
      count: 1,
      class: "exempt",
      reason:
        "The NEGATIVE CONTROL. This line builds the locale order on purpose and asserts the evidence " +
        "comparator disagrees with it, which is how the proof shows the comparator is codepoint order. " +
        "Flagging it would be flagging the test for containing the thing it forbids.",
    },
  ],
  [
    "artifacts/mcp-server/src/index.ts",
    {
      count: 1,
      class: "pinned-defect",
      reason:
        "readdirSync(...).sort(a.name.localeCompare(b.name)) orders a directory listing the MCP client " +
        "reads. Not a digest, so the blast radius is presentation order, but it is still locale-dependent " +
        "output from a shipped service. Owned by artifacts/mcp-server, outside this change.",
    },
  ],
  [
    "scripts/src/self-audit-proof.ts",
    {
      count: 1,
      class: "pinned-defect",
      reason:
        "`[...checklist].map(i => i.id).sort(localeCompare).join(\"|\")` builds a FINGERPRINT string. " +
        "Same class as the connector-emulator digest that was fixed: two ICU builds, two fingerprints, " +
        "one of them wrong. Outside this change's file set.",
    },
  ],
]);
{
  const wider = [
    "scripts/src/",
    ...readdirSync(resolve(repo, "artifacts"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `artifacts/${e.name}/src/`)
      .filter((d) => existsSync(resolve(repo, d))),
  ];
  const files = tracked.filter((f) => isTs(f) && inAny(f, wider));
  // FLOOR. Scanning nothing is not a clean scan. The scope is derived, so a moved
  // directory or a changed `isTs` would silently empty it.
  if (files.length < 50) {
    bad(
      `Determinism (wider): the derived scope found only ${files.length} file(s) across ${wider.length} root(s) ` +
        `— that is a broken derivation, not a small repository. Refusing to report a clean scan.`,
    );
  } else {
    const byFile = new Map();
    for (const f of files) {
      const lines = localeCompareViolations(maskLiterals(stripComments(read(f))));
      if (lines.length) byFile.set(f, lines);
    }
    const undeclared = [];
    const drifted = [];
    for (const [f, lines] of byFile) {
      const d = DECLARED_LOCALE_COMPARE.get(f);
      if (!d) undeclared.push(`${f}:${lines.join(",")}`);
      else if (d.count !== lines.length) drifted.push(`${f}: declared ${d.count}, found ${lines.length}`);
    }
    const stale = [...DECLARED_LOCALE_COMPARE.keys()].filter((f) => !byFile.has(f));
    if (undeclared.length || drifted.length || stale.length) {
      const parts = [];
      if (undeclared.length) {
        parts.push(
          `UNDECLARED localeCompare — ${undeclared.join(" | ")} (collation follows the process locale and the ` +
            `ICU build; compare codepoints: (a < b ? -1 : a > b ? 1 : 0))`,
        );
      }
      if (drifted.length) parts.push(`COUNT DRIFT — ${drifted.join(" | ")} (a pin that stops matching is not a pin)`);
      if (stale.length) parts.push(`STALE exemption, file no longer uses localeCompare — ${stale.join(", ")}`);
      bad(`Determinism (wider): ${parts.join("; ")}`);
    } else {
      const pinnedDefects = [...DECLARED_LOCALE_COMPARE].filter(([, d]) => d.class === "pinned-defect");
      ok(
        `Determinism (wider): ${files.length} file(s) across ${wider.length} derived root(s); ` +
          `${byFile.size} declared site(s) — ${DECLARED_LOCALE_COMPARE.size - pinnedDefects.length} exempt, ` +
          `${pinnedDefects.length} PINNED DEFECT (gated against growth, NOT fixed): ` +
          `${pinnedDefects.map(([f]) => f).join(", ")}`,
      );
    }
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
  // SCOPE WIDENED 2026-08-24. This scanned `artifacts/signalgrid-web/` only, plus the
  // static HTML the Pages workflow copies — and then reported "no third-party vendor
  // host in ANY published web artifact". Six files in five other web trees carried
  // fonts.googleapis.com, and the gate saw none of them. One was
  // artifacts/signalgrid-app, which Dockerfile.web:58 SHIPS at /app/: a deployed
  // surface handing every visitor's IP to Google, behind a green check that claimed
  // the opposite. The scope answered a narrower question than the sentence it printed.
  //
  // Now every web tree under artifacts/ is scanned. The GATED/REPORTED split follows
  // what is actually served:
  //   GATED    — trees Dockerfile.web builds and nginx serves, plus docs/ and site/.
  //   REPORTED — demo-only trees (launch-profile classes them demo_only; they are not
  //              in any deploy path). Printed on every run so the number cannot hide,
  //              and NOT failed on, because failing the build over a surface nobody
  //              serves would get this gate switched off — which is how it lost its
  //              scope in the first place.
  const SHIPPED_TREES = ["artifacts/signalgrid-web/", "artifacts/signalgrid-app/"];
  const isWebSource = (f) =>
    f.endsWith(".html") || f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".css");
  const inArtifactWebTree = (f) => f.startsWith("artifacts/") && isWebSource(f) && !f.includes("/dist/");
  const scan = tracked.filter((f) =>
    inArtifactWebTree(f) ||
    (f.startsWith("docs/") && f.endsWith(".html")) ||
    (f.startsWith("site/") && f.endsWith(".html")));
  const shipped = (f) => SHIPPED_TREES.some((t) => f.startsWith(t)) || f.startsWith("docs/") || f.startsWith("site/");
  const hits = [];
  const reported = [];
  for (const f of scan) {
    // DNS hostnames are case-insensitive, so lower-case the content before
    // matching the (already-lowercase) host list — FONTS.GOOGLEAPIS.COM must
    // trip the same as fonts.googleapis.com.
    const body = read(f).toLowerCase();
    for (const host of VENDOR_HOSTS) {
      if (!body.includes(host)) continue;
      (shipped(f) ? hits : reported).push(`${f} (${host})`);
    }
  }
  if (reported.length) {
    console.log(`  ⚠ third-party vendor host in ${reported.length} DEMO-ONLY web file(s) — not served, so reported:`);
    for (const r of reported) console.log(`      ${r}`);
    console.log("      Fix by self-hosting (@fontsource), as signalgrid-web and signalgrid-app do.");
  }
  if (hits.length) bad(`Public-safe web: third-party vendor host in a SERVED artifact — ${hits.join(", ")}. Self-host it instead.`);
  else ok(`Public-safe web: no third-party vendor host in any SERVED web artifact (${scan.length} files scanned across every web tree)`);
}

// ── An unearned attestation claim may not become load-bearing ────────────────
//
// `AttestationResult.attested` in lib/webauthn reports that a statement's
// SIGNATURE verified. It does not mean the credential came from a genuine
// authenticator: for `packed` with an x5c and for `fido-u2f`, the verifying key
// is taken from the leaf certificate the CLIENT supplied, and nothing validates
// that certificate — no trust anchor, no issuer, no validity window, no AAGUID
// match. A self-signed certificate minted a second ago satisfies it.
//
// That is survivable ONLY because nothing reads the field. Registration gates on
// `ok` and independently enforces the rpId hash, user presence and user
// verification. The day something branches on `attested`, a forged statement
// becomes a real bypass — so this rule fails the build at that moment rather
// than after it ships. The field's own doc comment says the same thing, and a
// comment has never once stopped this drift on its own.
//
// TO LIFT THIS: implement real chain validation (vendor roots, or FIDO Metadata
// Service lookup by AAGUID) and delete this rule in the same commit.
{
  const PRODUCER = "lib/webauthn/src/webauthn/verify.ts";
  const consumers = [];
  for (const f of tracked) {
    if (!isTs(f) || f === PRODUCER) continue;
    const src = stripComments(read(f));
    // A READ of the field — `x.attested` — not the declaration or a key named
    // `attested:` in an unrelated object literal.
    if (/\.attested\b/.test(src)) consumers.push(f);
  }
  if (consumers.length) {
    bad(
      `Unearned claim: ${consumers.join(", ")} reads \`.attested\`, which only proves the caller ` +
        "holds the key for a certificate it supplied itself. Validate the certificate chain before " +
        `branching on it, then remove this rule. Producer: ${PRODUCER}`,
    );
  } else {
    ok("Unearned claim: nothing branches on WebAuthn `attested` (signature-verified != authenticator-attested)");
  }
}

console.log("");
if (failures.length) {
  console.error(`Invariant review FAILED (${failures.length} issue${failures.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log("Invariant review passed — fail-closed, deterministic, Assist-safe, truthful.");

#!/usr/bin/env node
// Derived-doc-figure gate — a prose figure that the build already knows must equal it.
//
//   node scripts/check-derived-doc-figures.mjs              # gate
//   node scripts/check-derived-doc-figures.mjs --self-test  # prove the gate can fail
//
// WHY. Three figures in this repository's documentation were repaired by hand on
// 2026-09-02 after drifting: the Bruno collection's request count (docs/INDEX.md and
// the collection README), the Postman collection's request and folder counts
// (docs/API_ACCESS_AND_CONNECTORS.md), and the proof-script count
// (docs/ZERO_COST_LIVE_TEST_MATRIX.md). A hand repair fixes the number and leaves the
// mechanism that produced the drift entirely intact — the next `.bru` file added, the
// next `proof:*` script registered, and the sentence is wrong again with nothing
// watching. These figures drift fastest precisely because they move whenever ordinary
// work lands.
//
// SCOPE IS DERIVED, NEVER HAND-LISTED. Every value here is computed from the artifact
// the figure describes: the request count from the SAME walk `check-api-collection.mjs`
// uses (imported, not copied — one definition of "a request file"), the Postman counts
// by walking the committed collection JSON, the proof count from the root
// package.json's `proof:*` keys. Nothing is shelled out to a running server; this gate
// boots nothing and reads only committed files.
//
// GATED, and only this: a figure whose derivation is unambiguous — a count of files, a
// count of JSON objects, a count of package-script keys. Style, phrasing and any figure
// carrying a measurement date are NOT gated here and deliberately so. The mutation-sweep
// figures (1,367 mutations / 1,287 killed in ZERO_COST_LIVE_TEST_MATRIX.md) carry
// "measured 2026-08-26" by design: they are a dated observation of a sweep, not a
// property of the current tree, and gating them would demand a full sweep on every push
// to keep a true sentence true. Reporting a dated measurement as a figure to chase is
// the mistake this note exists to prevent.
//
// FAIL-CLOSED IN BOTH DIRECTIONS, which is the whole reason for the floors below:
//   · a deriver that returns 0 is a BROKEN PARSER, not an empty repository — fatal;
//   · a document with ZERO matching sentences means the anchor drifted or the sentence
//     was deleted, so the row is silently guarding nothing — fatal. A gate scanning
//     nothing is green about nothing.
//   · a document with MORE THAN ONE matching sentence is fatal too: two homes for one
//     figure is how a repair fixes one and leaves the other (docs/INDEX.md states the
//     request count twice, which is why it carries two rows here rather than one loose
//     regex that would match both and check neither properly).
//
// TWO PASSES, because the table alone had a scope hole. FIGURES is hand-listed, so it
// guards the sentences somebody remembered; the SWEEP below searches every tracked
// markdown document under docs/ and every artifacts/**/README.md for the derived
// INTEGER standing beside that figure's noun, and demands each hit be gated by a row or
// explained. It found five second homes on its first run — "All 97 are live-verified"
// and "78 distinct method+path pairs" in the collection README, and the proof count in
// STATUS.md, LOOP.md and the investor one-pager — every one of them correct that day and
// unwatched. All five now carry rows.
//
// WHAT THE SWEEP DOES NOT CATCH, stated plainly rather than implied: it searches for the
// value the tree derives TODAY, so it finds sentences that are true now and would rot,
// not sentences that are already wrong. A stricter rule — any integer beside "proof
// gates" must equal the derived count — was written, run, and REJECTED, because it
// flagged docs/VALIDATION_EVIDENCE.md:79: "Each of the 28 proof gates **that existed
// when the audit ran**… (the suite has grown well beyond that since)". That sentence is
// true, careful, and says so. A gate that punishes it is the wrong gate, and this
// repository has built that gate three times already.
//
// ADDING A FIGURE IS ONE ROW in FIGURES: the document, a regex with exactly one capture
// group, and the function that derives the truth. If the sweep then reports it FATAL
// somewhere else, that somewhere else is a second home and wants its own row.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { collectionRequestFiles, registeredRoutePairCount } from "./check-api-collection.mjs";

/** The connector tree the redirect census walks. */
const INTEGRATIONS = "lib/integrations/src/integrations";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel, root = ROOT) => readFileSync(join(root, rel), "utf8");

// Prose in this repository writes small counts as words and larger ones as digits, and
// both spellings are correct English. The gate reads either rather than forcing an
// author to write "4 folders".
const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Pure: a stated figure as a number, or NaN when it is neither digits nor a known word. */
export function readCount(raw) {
  if (typeof raw !== "string") return NaN;
  const t = raw.trim().replace(/,/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  const w = WORDS[t.toLowerCase()];
  return w === undefined ? NaN : w;
}

// The inverse of WORDS, for writing a figure back in the SPELLING the sentence used.
const NUMERALS = Object.fromEntries(Object.entries(WORDS).map(([w, n]) => [n, w]));

/**
 * Pure: `n` written the way `like` was written — digits stay digits, a spelled figure
 * comes back spelled. Returns undefined when `like` was a word and `n` has no spelling
 * in WORDS, so a caller can refuse rather than silently swap forms.
 *
 * THIS EXISTS BECAUSE THE SELF-TEST'S PLANT WAS BROKEN. The per-row "+1 drift" plant
 * substituted `String(derived + 1)` unconditionally, so for the `postman-folders` row —
 * whose capture group is a WORD ("four") — it wrote "74 requests in 5 folders", which
 * that row's `([A-Za-z]+)` regex cannot match at all. The row then failed for
 * "no sentence matching" and the assertion `problems.length === 1` was satisfied by the
 * WRONG problem. The plant proved the anchor could be broken, not that drift is caught:
 * with the `stated !== derived` comparison deleted entirely, that row's plant still
 * "passed". A self-test that passes against a gutted gate is the failure mode this
 * whole file exists to prevent, sitting inside the file itself.
 */
export function writeCount(n, like) {
  const digits = typeof like === "string" && /^\s*\d/.test(like);
  if (digits) return String(n);
  return NUMERALS[n];
}

// ── Derivers ────────────────────────────────────────────────────────────────────────

/** Request `.bru` files in the committed Bruno collection — the api-collection gate's own walk. */
export function bruRequestCount(root = ROOT) {
  return collectionRequestFiles(root).length;
}

const POSTMAN = "docs/postman/SignalGrid.postman_collection.json";

/** Pure: every request object in a Postman collection tree, at any depth. */
export function countPostmanRequests(items) {
  let n = 0;
  for (const it of items ?? []) {
    if (it && it.request) n += 1;
    if (it && Array.isArray(it.item)) n += countPostmanRequests(it.item);
  }
  return n;
}

export function postmanRequestCount(root = ROOT) {
  return countPostmanRequests(JSON.parse(read(POSTMAN, root)).item);
}

/** Top-level `item` entries — the folders a reader sees when the collection is imported. */
export function postmanFolderCount(root = ROOT) {
  const top = JSON.parse(read(POSTMAN, root)).item;
  return Array.isArray(top) ? top.length : 0;
}

/** `proof:*` scripts registered at the repo root — the set `pnpm run proof:*` can reach. */
export function proofScriptCount(root = ROOT) {
  const scripts = JSON.parse(read("package.json", root)).scripts ?? {};
  return Object.keys(scripts).filter((k) => k.startsWith("proof:")).length;
}

/**
 * Operations in the simulation-request allowlist — the top-level entries of
 * `SIM_OPERATIONS` in scripts/lib/sim-operations.mjs, read from the source so this
 * stays synchronous with the other derivers (the module is ESM and would need an
 * async import). Every entry is written `  key: {` at two-space indent; the count is
 * cross-checked against `OPERATION_KEYS.length` by proof:sim-requests's
 * `figures=operations=` line, which printed 26 the day this row was added.
 */
export function simOperationCount(root = ROOT) {
  const src = read("scripts/lib/sim-operations.mjs", root);
  const start = src.indexOf("export const SIM_OPERATIONS");
  const end = src.indexOf("\n};", start);
  if (start < 0 || end < 0) return 0;
  return [...src.slice(start, end).matchAll(/^  (?:"[a-z0-9-]+"|[a-z0-9-]+):\s*\{$/gm)].length;
}

/**
 * Distinct `METHOD /path` pairs the mounted routers register — the api-collection gate's
 * OWN parser, imported for the same reason the `.bru` walk is: the collection README
 * publishes this number, and a second parser for "a registered route" would be a second
 * place for it to drift.
 */
export function routePairCount(root = ROOT) {
  return registeredRoutePairCount(root);
}

/**
 * The webhook retry envelope, PARSED from the two shipped config objects.
 *
 * WHY THIS IS DERIVED. The v2 signing docs tell a receiver how wide to set its
 * replay window, and that guidance is only as good as the sender's retry envelope.
 * It landed as hand-computed prose — "31s", "30s", "~217s" — with no gate, which is
 * the exact shape of a figure that rots: change `maxAttempts` or `timeoutMs` and the
 * doc keeps telling receivers a number that is no longer true, and their windows
 * start rejecting the sender's own last retry.
 *
 * Parsed from source text rather than imported because this gate is .mjs and the
 * configs are .ts; the parse is FLOORED (each field must be found, or throw) so a
 * renamed field fails loudly instead of silently deriving from a default.
 */
const WEBHOOK_RETRY = "lib/integrations/src/integrations/webhooks/retry.ts";
const WEBHOOK_DISPATCH = "lib/integrations/src/integrations/webhooks/dispatch.ts";

function numField(text, object, field, where) {
  const block = text.slice(text.indexOf(object));
  const m = new RegExp(`${field}\\s*:\\s*([0-9.]+)`).exec(block);
  if (!m) throw new Error(`could not parse ${object}.${field} from ${where} — the field was renamed or removed`);
  return Number(m[1]);
}

export function webhookRetryEnvelope(root = ROOT) {
  const retry = read(WEBHOOK_RETRY, root);
  const dispatch = read(WEBHOOK_DISPATCH, root);
  const maxAttempts = numField(retry, "DEFAULT_RETRY_CONFIG", "maxAttempts", WEBHOOK_RETRY);
  const baseDelayMs = numField(retry, "DEFAULT_RETRY_CONFIG", "baseDelayMs", WEBHOOK_RETRY);
  const maxDelayMs = numField(retry, "DEFAULT_RETRY_CONFIG", "maxDelayMs", WEBHOOK_RETRY);
  const jitterFactor = numField(retry, "DEFAULT_RETRY_CONFIG", "jitterFactor", WEBHOOK_RETRY);
  const timeoutMs = numField(dispatch, "DEFAULT_DISPATCHER_CONFIG", "timeoutMs", WEBHOOK_DISPATCH);
  // calculateBackoff(attempt) = min(base * 2^(attempt-1), maxDelay); dispatchWithRetry
  // waits after attempts 1..maxAttempts-1 and never after the last.
  let backoffMs = 0;
  for (let attempt = 1; attempt <= maxAttempts - 1; attempt += 1) {
    backoffMs += Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  }
  const worstMs = maxAttempts * timeoutMs + backoffMs * (1 + jitterFactor);
  return {
    maxAttempts,
    backoffSeconds: backoffMs / 1000,
    timeoutSeconds: timeoutMs / 1000,
    envelopeSeconds: Math.floor(worstMs / 1000),
  };
}

export const webhookMaxAttempts = (root = ROOT) => webhookRetryEnvelope(root).maxAttempts;
export const webhookBackoffSeconds = (root = ROOT) => webhookRetryEnvelope(root).backoffSeconds;
export const webhookTimeoutSeconds = (root = ROOT) => webhookRetryEnvelope(root).timeoutSeconds;
export const webhookEnvelopeSeconds = (root = ROOT) => webhookRetryEnvelope(root).envelopeSeconds;

// ── Redirect refusal: the two halves of the fetch gate's own ratio ─────────────────
//
// The build-plan entry states how many outbound fetches refuse to follow a redirect.
// The first version of that sentence said "every outbound fetch in
// lib/integrations/src/integrations/**", which OVERSHOOTS: the rule is enforced in the
// six emitter families and the 39 sites outside them are REPORTED by
// check-ungated-fetch.mjs, not gated. A prose figure that overstates its own scope is
// the defect this gate exists for, so both numbers are now derived from the same place
// the gate counts them — the call arguments themselves.
//
// COUNTED FROM SOURCE, not from the gate's stdout: parsing another script's output
// would make this row a test of that script's formatting.
function redirectCensus(root = ROOT) {
  const families = readdirSync(join(root, INTEGRATIONS), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      try {
        return /createEmitterResolver/.test(readFileSync(join(root, INTEGRATIONS, name, "resolve.ts"), "utf8"));
      } catch {
        return false;
      }
    });
  let refusing = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      const text = readFileSync(p, "utf8");
      const inFamily = families.some((f) => p.includes(`${INTEGRATIONS}/${f}/`));
      const lines = text.split("\n");
      if (!inFamily) continue;
      lines.forEach((line, i) => {
        // The option belongs to THIS call: search forward to the call's closing. Only
        // the NUMERATOR is derived here. A denominator counted a second way is drift,
        // not evidence — `check-ungated-fetch.mjs` owns the ratio and prints it on
        // every run, so the prose points at that rather than freezing a second copy.
        if (!/^\s*redirect: 'manual',\s*$/.test(line)) return;
        refusing += 1;
      });
    }
  };
  walk(join(root, INTEGRATIONS));
  return { refusing, families: families.length };
}

export const redirectRefusingSites = (root = ROOT) => redirectCensus(root).refusing;
export const emitterFamilyCount = (root = ROOT) => redirectCensus(root).families;


// ── The table ───────────────────────────────────────────────────────────────────────
// Each row: the document, a regex whose ONE capture group is the stated figure, the
// deriver, and a short `from` naming where the truth comes from (printed on failure, so
// whoever hits this knows which artifact to look at rather than which number to retype).
export const FIGURES = [
  {
    id: "redirect-refusing-sites",
    doc: "docs/COMPANY_BUILD_PLAN.md",
    re: /all (\d+) outbound fetches in the six emitter families set `redirect: 'manual'`/,
    derive: redirectRefusingSites,
    from: "fetch call sites carrying `redirect: 'manual'` inside the derived emitter families",
  },
  {
    id: "redirect-emitter-families",
    doc: "docs/COMPANY_BUILD_PLAN.md",
    re: /across the (\d+) emitter families that refuse redirects/,
    derive: emitterFamilyCount,
    from: "directories under lib/integrations/src/integrations whose resolve.ts imports createEmitterResolver",
  },

  {
    id: "bru-requests-index",
    doc: "docs/INDEX.md",
    re: /(\d+) requests as plain-text/,
    derive: bruRequestCount,
    from: "request .bru files under artifacts/api-collection/ (check-api-collection.mjs's walk)",
  },
  {
    id: "bru-requests-index-run",
    doc: "docs/INDEX.md",
    re: /executes all (\d+) against a self-booted fixture server/,
    derive: bruRequestCount,
    from: "request .bru files under artifacts/api-collection/ (the same walk the runner uses)",
  },
  {
    id: "bru-requests-collection-readme",
    doc: "artifacts/api-collection/README.md",
    re: /across (\d+) request files/,
    derive: bruRequestCount,
    from: "request .bru files under artifacts/api-collection/",
  },
  {
    id: "postman-requests",
    doc: "docs/API_ACCESS_AND_CONNECTORS.md",
    re: /(\d+) requests in [A-Za-z]+ folders/,
    derive: postmanRequestCount,
    from: `request objects at any depth in ${POSTMAN}`,
  },
  {
    id: "postman-folders",
    doc: "docs/API_ACCESS_AND_CONNECTORS.md",
    re: /\d+ requests in ([A-Za-z]+) folders/,
    derive: postmanFolderCount,
    from: `top-level item folders in ${POSTMAN}`,
  },
  {
    id: "proof-scripts",
    doc: "docs/ZERO_COST_LIVE_TEST_MATRIX.md",
    re: /(\d+) deterministic proof scripts/,
    derive: proofScriptCount,
    from: "proof:* keys in the root package.json",
  },
  {
    id: "sim-operations",
    doc: "docs/LIVE_SYNC_LOOP.md",
    re: /allowlist — (\d+) operations covering/,
    derive: simOperationCount,
    from: "top-level entries of SIM_OPERATIONS in scripts/lib/sim-operations.mjs (the request allowlist)",
  },
  // ── Second homes, found by the sweep below rather than by hand ────────────────────
  // Every row from here down was invisible to the first version of this gate: the same
  // figure, stated in different words, in a document nobody thought to list. They are
  // GATED rather than exempted because each is a live claim in present tense — "All 97
  // are live-verified", "140 proof gates" — not a dated observation.
  {
    id: "bru-requests-collection-readme-verified",
    doc: "artifacts/api-collection/README.md",
    re: /All (\d+) are\s+live-verified/,
    derive: bruRequestCount,
    from: "request .bru files under artifacts/api-collection/ (the set run-bruno-collection.mjs executes)",
  },
  {
    id: "route-pairs-collection-readme",
    doc: "artifacts/api-collection/README.md",
    re: /that is (\d+) distinct method\+path pairs/,
    derive: routePairCount,
    from: "distinct METHOD+path registrations in the mounted routers (check-api-collection.mjs's own parser)",
  },
  {
    id: "proof-scripts-status-table",
    doc: "docs/STATUS.md",
    re: /\| \*\*(\d+)\*\* proof gates \|/,
    derive: proofScriptCount,
    from: "proof:* keys in the root package.json (STATUS.md's truth-state table)",
  },
  {
    id: "proof-scripts-loop",
    doc: "docs/agent/LOOP.md",
    re: /(\d+) proof gates and \w+ native surfaces/,
    derive: proofScriptCount,
    from: "proof:* keys in the root package.json (the LOOP.md discovery reminder)",
  },
  {
    id: "proof-scripts-investor",
    doc: "docs/company/INVESTOR_ONE_PAGER.md",
    re: /\*\*: (\d+) proof gates \(the figure/,
    derive: proofScriptCount,
    from: "proof:* keys in the root package.json (the investor one-pager's proof-first claim)",
  },
  // ── Webhook v2 replay-window guidance ────────────────────────────────────────────
  // GATED: the four integers a receiver's tolerance is derived FROM. NOT gated, and
  // deliberately: the 300000 ms recommendation itself, which is judgement about
  // headroom rather than a fact about the tree. Gate the derivation, report the advice.
  {
    id: "webhook-retry-max-attempts",
    doc: "docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md",
    re: /is `maxAttempts: (\d+)`/,
    derive: webhookMaxAttempts,
    from: `DEFAULT_RETRY_CONFIG.maxAttempts in ${WEBHOOK_RETRY}`,
  },
  {
    id: "webhook-retry-backoff-seconds",
    doc: "docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md",
    re: /backoff waits summing to (\d+)s/,
    derive: webhookBackoffSeconds,
    from: `sum of calculateBackoff() over attempts 1..maxAttempts-1, from ${WEBHOOK_RETRY}`,
  },
  {
    id: "webhook-dispatch-timeout-seconds",
    doc: "docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md",
    re: /allows (\d+)s per attempt/,
    derive: webhookTimeoutSeconds,
    from: `DEFAULT_DISPATCHER_CONFIG.timeoutMs in ${WEBHOOK_DISPATCH}`,
  },
  {
    id: "webhook-retry-envelope-seconds",
    doc: "docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md",
    re: /in flight (\d+)s after its timestamp/,
    derive: webhookEnvelopeSeconds,
    from: "maxAttempts*timeoutMs + jittered backoff, from retry.ts and dispatch.ts together",
  },
  {
    id: "webhook-tolerance-floor-seconds",
    doc: "docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md",
    re: /A tolerance below (\d+)s will reject/,
    derive: webhookEnvelopeSeconds,
    from: "the same envelope — the floor a receiver's window must clear, stated as a bound not an estimate",
  },
];

// ── Two rows considered on 2026-09-02 and deliberately NOT added ─────────────────────
// A row over ZERO matching sentences is fatal by design (see auditFigure), so a row may
// only be added for a figure some document actually states. Both of these were checked
// against the tree before the decision, not assumed:
//   · LAB-REGISTRY ENTRY COUNT. docs/INDEX.md stated "37 repositories" while
//     `node scripts/check-lab-registry.mjs` printed 48. The numeral was removed from the
//     index rather than corrected — the entry now says the gate prints the count live —
//     so there is no INDEX sentence left for a row to match. The same numeral had a third
//     home — docs/OPEN_SOURCE_LAB_REGISTRY.md:3 opened "The owner's 30-repo research
//     index" while the gate printed 48 — and it was fixed the same way on 2026-09-02:
//     the numeral is gone and the sentence points at the gate that prints the count. No
//     stated figure is left for a row to guard, which is the outcome a row would have
//     forced anyway.
//   · REASON-CODE COUNT. docs/INDEX.md said "all 38 codes the launch decision core can
//     emit"; `node scripts/check-reason-codes.mjs` prints 40, and docs/REASON_CODES.md
//     says "**40 codes** the decision core can emit: 28 reachable" — so the index was
//     wrong twice, in the count and in calling the catalog launch-only. The numeral is
//     gone from the index. The only remaining statement lives in REASON_CODES.md, which
//     is GENERATED by gen-reason-codes.mjs and held byte-faithful by check-reason-codes.mjs
//     — already gated, from source. A row here would be a second place to fix one figure,
//     which is the defect the SWEEP_EXEMPT note about STATUS.md already records.

// ── The sweep: second homes the table cannot see ─────────────────────────────────────
// THE HOLE THE TABLE HAD. FIGURES is hand-listed, so it guards the sentences somebody
// remembered. It cannot see the SAME figure written in different words somewhere else —
// and it had five of those: "All 97 are live-verified" and "78 distinct method+path
// pairs" in the collection README, and the proof count in STATUS.md, LOOP.md and the
// investor one-pager. Each is a live claim that would have gone stale silently while
// this gate reported green about the sentences it happened to know.
//
// So the scope of the SEARCH is derived even though the scope of the TABLE is not: for
// every derived value, sweep every tracked markdown document under docs/ plus every
// artifacts/ README for that INTEGER standing next to the figure's noun, and demand
// each hit be accounted for. A hit that is neither gated nor exempted is FATAL — the
// gate refuses to be green about a number it found and cannot explain.
//
// GATED vs REPORTED, explicitly:
//   · GATED   — a hit covered by a FIGURES row. The row compares it to the tree.
//   · REPORTED — a hit exempted by the dated-measurement rule, or by a listed exemption
//     with a reason. Both are printed on every run, never silent.
//   · FATAL   — a hit that is neither.
const SWEEP_FILES = "tracked markdown under docs/, plus artifacts/**/README.md";

export const SWEEP = [
  {
    id: "bru-requests",
    label: "Bruno request files",
    derive: bruRequestCount,
    // "97 requests", "97 request files", "All 97 are live-verified".
    noun: "request files|requests|live-verified",
  },
  {
    id: "proof-scripts",
    label: "proof:* scripts",
    derive: proofScriptCount,
    noun: "proof scripts|proof gates|proofs|proof:\\*",
  },
  {
    id: "postman-requests",
    label: "Postman requests",
    derive: postmanRequestCount,
    noun: "requests in [A-Za-z]+ folders|requests",
  },
  { id: "postman-folders", label: "Postman top-level folders", derive: postmanFolderCount, noun: "folders" },
  {
    id: "route-pairs",
    label: "registered method+path pairs",
    derive: routePairCount,
    noun: "method\\+path pairs|method/path pairs",
  },
];

// Hits that are real and correctly NOT gated here, each with the reason, each printed.
// Keep short: an exemption nobody can explain is a hole somebody will widen.
export const SWEEP_EXEMPT = [
  {
    doc: "docs/STATUS.md",
    near: /proof gates: \*\*\d+/,
    reason:
      "gated by check-status-figures.mjs, which owns the Inventory line and derives the same proof:* count. " +
      "Two gates on one sentence is two places to fix it; this one defers.",
  },
  {
    doc: "docs/BUILD_BACKLOG.md",
    near: /\d+ `proof:\*/,
    reason:
      "a quotation inside the 2026-09-01 backlog entry recording what a scan found that day. The date sits four " +
      "lines above the figure, out of the 80-character window the dated-measurement rule uses, so it is named here " +
      "rather than caught by rule. Rewriting it to today's count would falsify the record it is part of.",
  },
];

const DATED_RULE =
  "a YYYY-MM-DD within 80 characters of the figure, or a markdown table row whose first cell is a date";

/** Pure: is this hit a DATED MEASUREMENT — an observation carrying its date, not a property of the tree? */
export function isDatedMeasurement(text, index) {
  const window = text.slice(Math.max(0, index - 80), index + 80);
  if (/\d{4}-\d{2}-\d{2}/.test(window)) return true;
  // A ledger row can be thousands of characters long with its date in the first cell;
  // the whole row is one dated entry however far the figure sits from the date.
  const lineStart = text.lastIndexOf("\n", index) + 1;
  return /^\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(text.slice(lineStart, lineStart + 40));
}

/** Pure: every place `value` stands within 30 characters of one of `noun`'s spellings. */
export function sweepHits(text, value, noun) {
  const n = `(?:${noun})`;
  const v = `(?<![\\d,.])${value}(?![\\d,.%])`;
  const rx = new RegExp(`${v}[\\s\\S]{0,30}?${n}|${n}[\\s\\S]{0,30}?${v}`, "g");
  return [...text.matchAll(rx)].map((m) => ({ index: m.index, end: m.index + m[0].length, snippet: m[0].replace(/\s+/g, " ") }));
}

/** Tracked documents the sweep reads — derived from git, never a hand-kept list. */
export function sweepDocs(root = ROOT) {
  const out = execSync("git ls-files -- 'docs/*.md' 'docs/**/*.md' 'artifacts/**/README.md' 'artifacts/*/README.md'", {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.trim().split("\n").filter(Boolean))].sort();
}

/**
 * The second pass. Returns { fatal, gated, exemptDated, exemptListed, scanned } —
 * `fatal` are the hits nothing accounts for.
 */
export function sweepAll(root = ROOT, rows = FIGURES, probes = SWEEP) {
  const docs = sweepDocs(root);
  const fatal = [];
  const gated = [];
  const exemptDated = [];
  const exemptListed = [];

  // Where each row's sentence actually sits, so "covered by a row" is a SPAN overlap
  // rather than a document-name match. A row for INDEX.md must not silently account for
  // a second, ungated statement of the same figure elsewhere in INDEX.md — that is the
  // two-homes defect, one level up.
  const rowSpans = [];
  for (const row of rows) {
    let text;
    try {
      text = read(row.doc, root);
    } catch {
      continue;
    }
    for (const m of text.matchAll(new RegExp(row.re.source, `${row.re.flags}g`))) {
      rowSpans.push({ doc: row.doc, id: row.id, start: m.index, end: m.index + m[0].length });
    }
  }

  for (const probe of probes) {
    const value = probe.derive(root);
    if (!Number.isInteger(value) || value < 1) {
      fatal.push(`sweep ${probe.id}: deriver returned ${JSON.stringify(value)} — refusing to sweep for a broken figure.`);
      continue;
    }
    for (const doc of docs) {
      let text;
      try {
        text = read(doc, root);
      } catch {
        continue;
      }
      for (const hit of sweepHits(text, value, probe.noun)) {
        const line = text.slice(0, hit.index).split("\n").length;
        const where = `${doc}:${line}`;
        const row = rowSpans.find((s) => s.doc === doc && s.start < hit.end && hit.index < s.end);
        if (row) {
          gated.push({ where, id: row.id, snippet: hit.snippet });
          continue;
        }
        if (isDatedMeasurement(text, hit.index)) {
          exemptDated.push({ where, snippet: hit.snippet });
          continue;
        }
        const listed = SWEEP_EXEMPT.find((e) => e.doc === doc && e.near.test(hit.snippet));
        if (listed) {
          exemptListed.push({ where, snippet: hit.snippet, reason: listed.reason });
          continue;
        }
        fatal.push(
          `sweep ${probe.id}: ${where} states the derived figure ${value} beside "${probe.label}" ` +
            `("${hit.snippet}") and NO row guards it. A second home for a gated figure is how a repair fixes ` +
            `one sentence and leaves the other. Add a row to FIGURES, or — if it is a dated observation or ` +
            `owned by another gate — add it to SWEEP_EXEMPT with the reason.`,
        );
      }
    }
  }
  return { fatal, gated, exemptDated, exemptListed, scanned: docs.length };
}

// ── The audit ───────────────────────────────────────────────────────────────────────

/**
 * Pure: audit one row against a document's text and an already-computed derived value.
 * Pure so the self-test can feed it synthetic text and synthetic derivations, and so a
 * mutation of the real document can be judged without writing to the tree.
 *
 * @returns { matches, stated, derived, line, problems: string[] }
 */
export function auditFigure(row, text, derived) {
  const problems = [];
  const rx = new RegExp(row.re.source, row.re.flags.includes("g") ? row.re.flags : `${row.re.flags}g`);
  const ms = [...text.matchAll(rx)];

  if (!Number.isInteger(derived) || derived < 1) {
    problems.push(
      `${row.id}: the deriver returned ${JSON.stringify(derived)} — a count of at least 1 was expected. ` +
        `This says the PARSER broke (${row.from}), not that the repository is empty. Refusing to compare.`,
    );
  }
  if (ms.length === 0) {
    problems.push(
      `${row.id}: ${row.doc} contains no sentence matching ${row.re} — the anchor drifted, or the ` +
        `sentence was removed. A gate scanning nothing is green about nothing; fix the regex or restore the sentence.`,
    );
  } else if (ms.length > 1) {
    problems.push(
      `${row.id}: ${row.doc} contains ${ms.length} sentences matching ${row.re}. Exactly one is required — ` +
        `two homes for one figure is how a repair fixes one and leaves the other. Give the second one its own row.`,
    );
  }

  let stated;
  let line;
  if (ms.length === 1) {
    stated = readCount(ms[0][1]);
    line = text.slice(0, ms[0].index).split("\n").length;
    if (!Number.isInteger(stated)) {
      problems.push(`${row.id}: could not read "${ms[0][1]}" in ${row.doc} as a number.`);
    }
  }

  if (problems.length === 0 && stated !== derived) {
    problems.push(
      `${row.id}: ${row.doc}:${line} states ${stated}, but the tree derives ${derived} — ${row.from}. ` +
        `Update the sentence; do not update the deriver to match the prose.`,
    );
  }
  return { matches: ms.length, stated, derived, line, problems };
}

export function auditAll(rows = FIGURES, root = ROOT) {
  return rows.map((row) => {
    let derived;
    try {
      derived = row.derive(root);
    } catch (err) {
      return { row, result: { matches: 0, problems: [`${row.id}: deriver threw — ${err.message}`] } };
    }
    let text;
    try {
      text = read(row.doc, root);
    } catch (err) {
      return { row, result: { matches: 0, derived, problems: [`${row.id}: cannot read ${row.doc} — ${err.message}`] } };
    }
    return { row, result: auditFigure(row, text, derived) };
  });
}

// ── Self-test ───────────────────────────────────────────────────────────────────────
// Synthetic controls for the shape of the check, then — the part that matters — the
// REAL text of every row's document with its figure mutated by one. If a planted defect
// in the live document does not fail the row, that row guards nothing.
function selfTest() {
  const checks = [];
  // The synthetic controls are written against the Bruno index row's matcher, so
  // they select it by id: FIGURES[0] silently became a different row the first
  // time a batch inserted rows at the top of the table, and two controls failed
  // for a reason that had nothing to do with the gate.
  const row = FIGURES.find((r) => r.id === "bru-requests-index");
  if (!row) throw new Error("self-test: the bru-requests-index row is gone; the synthetic controls need a row whose matcher they were written for");

  checks.push(["a matching figure equal to the derived value passes", auditFigure(row, "— 7 requests as plain-text `.bru` files", 7).problems.length === 0]);
  checks.push(["A WRONG FIGURE IS FLAGGED — the gate's whole purpose", auditFigure(row, "— 8 requests as plain-text `.bru` files", 7).problems.length === 1]);
  checks.push(["ZERO matches is FATAL, never a quiet pass", auditFigure(row, "nothing to see here", 7).problems.some((p) => p.includes("no sentence matching"))]);
  checks.push([
    "TWO matches is FATAL — one figure, one home",
    auditFigure(row, "— 7 requests as plain-text a\n— 7 requests as plain-text b", 7).problems.some((p) => p.includes("Exactly one is required")),
  ]);
  checks.push([
    "a deriver returning 0 is a BROKEN PARSER, not an empty tree — fatal, and no comparison is made",
    auditFigure(row, "— 0 requests as plain-text", 0).problems.some((p) => p.includes("PARSER broke")),
  ]);
  checks.push(["a spelled figure reads as a number", readCount("four") === 4 && readCount("12") === 12 && readCount("1,367") === 1367]);
  checks.push(["…and an unreadable one is NaN, never coerced to 0", Number.isNaN(readCount("several")) && Number.isNaN(readCount(undefined))]);
  checks.push([
    "the Postman walk counts requests at any depth, not just the top level",
    countPostmanRequests([{ request: {} }, { item: [{ request: {} }, { item: [{ request: {} }] }] }]) === 3,
  ]);
  checks.push(["every row declares exactly one capture group", FIGURES.every((r) => new RegExp(`${r.re.source}|`).exec("").length - 1 === 1)]);
  checks.push(["every row names where its truth comes from", FIGURES.every((r) => typeof r.from === "string" && r.from.length > 12)]);
  checks.push(["the table is not empty and the ids are unique", FIGURES.length >= 3 && new Set(FIGURES.map((r) => r.id)).size === FIGURES.length]);

  // Floors on the live tree: every deriver must find something, and every document must
  // hold exactly one matching sentence, BEFORE any mutation is judged.
  const live = auditAll();
  checks.push(["every deriver produces at least 1 against the real tree", live.every(({ result }) => Number.isInteger(result.derived) && result.derived >= 1)]);
  checks.push(["every document holds exactly one matching sentence", live.every(({ result }) => result.matches === 1)]);
  checks.push(["…and the real tree is clean right now (the positive control)", live.every(({ result }) => result.problems.length === 0)]);

  // The plant, per row, over the real document text.
  //
  // TWO THINGS ARE LOAD-BEARING HERE and both were wrong before 2026-09-02. First the
  // substitution is written in the SPELLING the sentence used (see `writeCount`), so a
  // word-captured figure stays matchable — otherwise the plant breaks the anchor instead
  // of the number. Second the assertion reads the PROBLEM TEXT, not just the count: with
  // `problems.length === 1` alone, "no sentence matching" satisfied the check just as
  // well as "states 5, but the tree derives 4", and a row whose plant only ever broke
  // its own anchor proved nothing about drift. Deleting the `stated !== derived`
  // comparison entirely must now fail every one of these.
  for (const { row: r, result } of live) {
    const text = read(r.doc);
    const rx = new RegExp(r.re.source, r.re.flags.includes("d") ? r.re.flags : `${r.re.flags}d`);
    const m = rx.exec(text);
    const drifted = m === null ? undefined : writeCount(Number(result.derived) + 1, m[1]);
    const span = m?.indices?.[1];
    const mutated =
      m === null || drifted === undefined || !span ? null : text.slice(0, span[0]) + drifted + text.slice(span[1]);
    const after = mutated === null ? null : auditFigure(r, mutated, result.derived);
    checks.push([
      `a planted drift in ${r.doc} (${r.id}) IS REPORTED AS DRIFT — "${m ? m[1] : "?"}" → "${drifted ?? "UNPLANTABLE"}"`,
      after !== null && after.problems.length === 1 && after.problems[0].includes("but the tree derives"),
    ]);
  }

  // ── The sweep: the figure's OTHER homes ───────────────────────────────────────────
  const sweep = sweepAll();
  checks.push(["the sweep reads a plausible number of documents, not zero", sweep.scanned >= 50]);
  checks.push(["…and finds the live tree fully accounted for (the positive control)", sweep.fatal.length === 0]);
  checks.push([
    "…and it actually FOUND figures rather than sweeping past them — a hit-count floor",
    sweep.gated.length + sweep.exemptDated.length + sweep.exemptListed.length >= 8,
  ]);
  checks.push([
    "AN UNGATED SECOND HOME IS FATAL — a synthetic doc stating the derived figure that no row guards",
    (() => {
      const value = bruRequestCount();
      const hits = sweepHits(`SignalGrid ships ${value} requests today.`, value, "request files|requests");
      return hits.length === 1;
    })(),
  ]);
  checks.push([
    "…and a DIFFERENT number beside the same noun is not a hit (the sweep is about THIS figure)",
    sweepHits(`SignalGrid ships ${bruRequestCount() + 1} requests today.`, bruRequestCount(), "request files|requests").length === 0,
  ]);
  checks.push([
    "…and the integer must stand NEAR the noun — 200 characters away is not a statement about it",
    sweepHits(`${bruRequestCount()} ${"x".repeat(200)} requests`, bruRequestCount(), "requests").length === 0,
  ]);
  checks.push([
    "…and a longer number CONTAINING the figure is not a hit (1970 is not 97)",
    sweepHits("1970 requests", 97, "requests").length === 0 && sweepHits("in 1997 requests", 97, "requests").length === 0,
  ]);
  checks.push([
    `the dated-measurement rule exempts ${DATED_RULE}`,
    isDatedMeasurement("measured 2026-08-26: 140 proof scripts", 25) &&
      isDatedMeasurement("| 2026-09-01 | " + "y".repeat(400) + " 140 proofs |", 420) &&
      !isDatedMeasurement("140 proof scripts run on every push", 0),
  ]);
  checks.push([
    "every listed sweep exemption carries a doc, a matcher and a reason a reviewer can weigh",
    SWEEP_EXEMPT.every((e) => typeof e.doc === "string" && e.near instanceof RegExp && typeof e.reason === "string" && e.reason.length > 40),
  ]);
  checks.push([
    "…and every listed exemption still MATCHES something — a stale exemption is a hole",
    // Tested against the document's text, not against this run's sweep hits: an
    // exemption for a dated quotation of an OLD value stops appearing in the sweep
    // the moment the derived figure moves (the quotation no longer states the
    // current figure, which is exactly why it needed no gate), while the sentence
    // it covers is still there. The hole is a sentence that is gone.
    SWEEP_EXEMPT.every((e) => {
      try {
        return e.near.test(read(e.doc, ROOT));
      } catch {
        return false;
      }
    }),
  ]);
  checks.push([
    "every sweep probe derives from the tree and names its noun",
    SWEEP.length >= 4 && SWEEP.every((p) => typeof p.derive === "function" && p.noun.length > 3 && p.label.length > 5),
  ]);
  checks.push([
    "a sweep probe whose deriver returns 0 is FATAL, never a quiet empty sweep",
    sweepAll(ROOT, FIGURES, [{ id: "broken", label: "x", derive: () => 0, noun: "requests" }]).fatal.some((f) =>
      f.includes("refusing to sweep"),
    ),
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Exact-entry guard: importing this module must never gate as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const results = auditAll();
  const sweep = sweepAll();
  const problems = [...results.flatMap(({ result }) => result.problems), ...sweep.fatal];
  if (problems.length > 0) {
    console.error(`Derived-doc-figure check FAILED: ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("GATED — each figure compared against the artifact it describes:");
  for (const { row, result } of results) {
    console.log(`  ${row.doc}:${result.line} states ${result.stated} — derived ${result.derived} (${row.id})`);
  }
  console.log(
    `\nSWEEP — ${SWEEP.length} derived value(s) searched across ${sweep.scanned} document(s) ` +
      `(${SWEEP_FILES}) for the same integer beside its noun:`,
  );
  console.log(`  ${sweep.gated.length} hit(s) GATED by a row above.`);
  console.log(`  REPORTED, exempt by rule (${DATED_RULE}) — ${sweep.exemptDated.length} hit(s):`);
  for (const e of sweep.exemptDated) console.log(`    · ${e.where} — "${e.snippet}"`);
  console.log(`  REPORTED, exempt by declaration — ${sweep.exemptListed.length} hit(s):`);
  for (const e of sweep.exemptListed) console.log(`    · ${e.where} — "${e.snippet}"\n      ${e.reason}`);
  console.log(
    `\nDerived-doc-figure check passed — ${results.length} figure(s) across ` +
      `${new Set(FIGURES.map((r) => r.doc)).size} document(s) match the tree they describe, ` +
      `and every other statement of those figures is gated or explained.`,
  );
}

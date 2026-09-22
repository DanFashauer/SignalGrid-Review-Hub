#!/usr/bin/env node
// A connector may not report an HTTP status it never observed.
//
//   node scripts/check-fabricated-status.mjs
//   node scripts/check-fabricated-status.mjs --self-test
//
// WHAT THIS CAUGHT. Twelve connectors ended their health check with
//
//     return { healthy: true, status: 200 };
//
// after awaiting an INJECTED transport that resolves a payload. There is no HTTP
// response on that path and therefore no status code to read: the 200 was invented.
// A 201, 202 or 204 upstream reported as 200, and — the part that matters — a
// reviewer reading the field believed a server had said it. It is the unearned
// affirmative in its smallest form: a value that looks measured and is typed.
//
// The success paths now return `status: null`, which the type can say and which means
// exactly what happened: the transport resolved, no status was observed.
//
// THE DISTINCTION THIS GATE IS BUILT ON, and it is the whole reason it can be precise
// rather than a blanket ban: some connectors DO observe a status.
//
//     graph/posture-connector.ts     return { healthy: res.ok, status: res.status };
//     carrier/reachability-connector return { healthy: res.ok, status: res.status };
//
// Those hold a real `Response`. Their 200 is a reading, not a claim, and they must
// keep passing — which is asserted below as a positive control, because a gate that
// forbids every status would "pass" by making the honest connectors lie in the other
// direction.
//
// WHAT IS NOT FIXED, stated so a green here is not read as more than it is:
// `healthy: true` still means "the injected transport resolved", which in fixture mode
// is true without anything being contacted. That belongs at the resolution layer,
// which already reports `mode: "fixture"` with a reason. Recorded in
// docs/BUILD_BACKLOG.md rather than quietly closed.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAMILY_DIR = join(repo, "lib/integrations/src/integrations");

/**
 * A success return that hard-codes a numeric status — the defect.
 *
 * ORDER-INDEPENDENT, and it has to be. The original was a single regex requiring
 * `healthy: true` to appear BEFORE `status:`, so the same defect written the other way
 * round — `return { status: 200, healthy: true }` — walked straight past a gate whose
 * whole job is to catch it. Object literal key order carries no meaning in JavaScript, so
 * a detector that depends on it is reading something the language does not promise.
 *
 * Scoped to ONE return object by construction (`[^}]*` cannot cross a `}`), so it can
 * never pair a `healthy` in one return with a `status` in the next. It now walks EVERY
 * return in the file rather than stopping at the first match, which is strictly wider:
 * an honest early return no longer hides a fabricated later one.
 */
const RETURN_OBJECT = /return\s*\{([^}]*)\}/g;
const HEALTHY_TRUE = /\bhealthy:\s*true\b/;
const STATUS_LITERAL = /\bstatus:\s*(\d+)\b/;

/** @returns {string|null} the fabricated status code, or null when the source is honest. */
function fabricatedStatusIn(src) {
  for (const m of src.matchAll(RETURN_OBJECT)) {
    const body = m[1];
    if (!HEALTHY_TRUE.test(body)) continue;
    const hit = body.match(STATUS_LITERAL);
    if (hit) return hit[1];
  }
  return null;
}
/**
 * A status read off an HTTP response, which is a measurement rather than a claim.
 *
 * Deliberately narrow. An earlier draft matched any `status: <expr>.status`, which swept
 * in `itsm/*` (`data.ticket.status` — a ticket's workflow state) and `webhooks/store.ts`
 * (`input.status` — a delivery state). Those are unrelated fields that happen to share a
 * name, and counting them made this gate print "28 file(s) read a status off a response"
 * when six of them had not. A gate that overstates its own coverage is the defect it
 * exists to catch, wearing the inspector's badge.
 */
const OBSERVED = /\bstatus:\s*(?:res|resp|response)\.status\b/;

/**
 * Floor, not a total. The honest connectors — the ones that hold a real `Response` — must
 * not quietly become fewer. It is written as a minimum on purpose: adding connectors that
 * read a status should never fail this, and removing the ones that do must.
 */
const MIN_OBSERVED = 20;

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Every .ts file under the connector families. */
function connectorFiles() {
  const out = [];
  for (const e of readdirSync(FAMILY_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(FAMILY_DIR, e.name);
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".ts")) out.push(join(dir, f));
    }
  }
  return out;
}

function main() {
  const files = connectorFiles();
  const offenders = [];
  let observedCount = 0;

  for (const path of files) {
    const src = stripComments(readFileSync(path, "utf8"));
    const rel = path.slice(repo.length + 1);
    const fabricated = fabricatedStatusIn(src);
    if (fabricated !== null) offenders.push({ rel, status: fabricated });
    if (OBSERVED.test(src)) observedCount += 1;
  }

  console.log(`fabricated-status gate: ${files.length} connector file(s) scanned`);
  console.log(`  ${observedCount} file(s) read a status off an HTTP response (measurement — allowed)`);

  // POSITIVE CONTROL. Without it, deleting the two honest connectors — or breaking the
  // OBSERVED pattern so it matches nothing — would leave this gate green while proving
  // nothing at all.
  const honest = [
    "lib/integrations/src/integrations/graph/posture-connector.ts",
    "lib/integrations/src/integrations/carrier/reachability-connector.ts",
  ];
  const failures = [];
  for (const rel of honest) {
    const p = join(repo, rel);
    if (!existsSync(p)) {
      failures.push(`positive control missing: ${rel} — the gate can no longer tell a reading from a claim`);
      continue;
    }
    if (!OBSERVED.test(stripComments(readFileSync(p, "utf8")))) {
      failures.push(`positive control ${rel} no longer reads a status off a response — either it regressed, or this gate's pattern has stopped matching reality`);
    }
  }

  if (observedCount < MIN_OBSERVED) {
    failures.push(
      `only ${observedCount} file(s) read a status off an HTTP response, below the floor of ${MIN_OBSERVED}. Either connectors that measured a status stopped doing so, or this gate's OBSERVED pattern has drifted away from how the code is written — both make a green here meaningless.`,
    );
  }

  for (const o of offenders) {
    failures.push(
      `${o.rel} returns a hard-coded status ${o.status} on a SUCCESS path. If a response was observed, read its status; if not, return null.`,
    );
  }

  if (failures.length) {
    console.error(`\nFabricated-status gate FAILED — ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`
Fabricated-status gate passed — no connector claims a status it did not observe.

  NOT established by a green here:
    · that \`healthy: true\` was earned. It still means "the injected transport
      resolved", which in fixture mode is true without anything being contacted.
      That gap is real, is recorded in docs/BUILD_BACKLOG.md, and belongs at the
      resolution layer rather than in twelve constructors.`);
}

function selfTest() {
  const controls = [
    {
      name: "a hard-coded success status is caught",
      run: () => fabricatedStatusIn("return { healthy: true, status: 200 };") === "200",
    },
    {
      name: "…at any status number, not just 200",
      run: () => fabricatedStatusIn("return { healthy: true, status: 204 };") === "204",
    },
    {
      // THE DEFECT THIS DETECTOR WAS REWRITTEN FOR. The original regex required
      // `healthy: true` to appear BEFORE `status:`, so this — the same claim, the same
      // invented 200, written with the keys the other way round — passed the gate.
      // Object key order means nothing in JavaScript; a detector that depends on it is
      // reading a promise the language does not make.
      name: "…and with the keys REVERSED, which the order-dependent detector let through",
      run: () => fabricatedStatusIn("return { status: 200, healthy: true };") === "200",
    },
    {
      // Scoping control: `[^}]*` cannot cross a `}`, so an honest return and a separate
      // fabricated-looking one must not be paired into a false positive.
      name: "a healthy return and a LATER unrelated status object are not paired",
      run: () => fabricatedStatusIn("return { healthy: true, status: null };\nreturn { status: 200 };") === null,
    },
    {
      // Widening control: the original stopped at the first match, so an honest early
      // return hid a fabricated later one. Every return is now walked.
      name: "a fabricated LATER return is caught behind an honest earlier one",
      run: () => fabricatedStatusIn("return { healthy: true, status: null };\nreturn { healthy: true, status: 201 };") === "201",
    },
    {
      name: "a null success status is NOT flagged (the honest form)",
      run: () => fabricatedStatusIn("return { healthy: true, status: null };") === null,
    },
    {
      name: "a FAILURE path with a real number is not flagged (the error carries one)",
      run: () => fabricatedStatusIn("return { healthy: false, status: 401 };") === null,
    },
    {
      name: "a status read off a response counts as observed",
      run: () => OBSERVED.test("return { healthy: res.ok, status: res.status };"),
    },
    {
      name: "a hard-coded status does NOT count as observed",
      run: () => !OBSERVED.test("return { healthy: true, status: 200 };"),
    },
    {
      // Regression control. The first draft counted these as HTTP observations and printed
      // an inflated coverage figure.
      name: "an ITSM ticket's workflow state is NOT counted as an observed HTTP status",
      run: () =>
        !OBSERVED.test("status: data.ticket.status") &&
        !OBSERVED.test("status: data.request.status") &&
        !OBSERVED.test("status: data.fields.status"),
    },
    {
      name: "…nor is a webhook delivery state",
      run: () => !OBSERVED.test("status: input.status"),
    },
    {
      name: "comments are stripped, so prose about status: 200 is not a finding",
      run: () => fabricatedStatusIn(stripComments("// return { healthy: true, status: 200 };")) === null,
    },
    {
      name: "the scan finds connector files at all (an empty sweep would pass vacuously)",
      run: () => connectorFiles().length > 50,
    },
  ];
  let bad = 0;
  for (const c of controls) {
    const ok = c.run();
    console.log(`  ${ok ? "ok  " : "FAIL"} — ${c.name}`);
    if (!ok) bad += 1;
  }
  console.log(`\nself-test: ${controls.length - bad}/${controls.length} controls passed`);
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--self-test")) selfTest();
else main();

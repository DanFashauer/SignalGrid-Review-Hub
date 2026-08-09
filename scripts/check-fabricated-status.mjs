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

/** A success return that hard-codes a numeric status — the defect. */
const FABRICATED = /return\s*\{[^}]*\bhealthy:\s*true\b[^}]*\bstatus:\s*(\d+)/;
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
    const m = src.match(FABRICATED);
    if (m) offenders.push({ rel, status: m[1] });
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
      run: () => FABRICATED.test("return { healthy: true, status: 200 };"),
    },
    {
      name: "…at any status number, not just 200",
      run: () => FABRICATED.test("return { healthy: true, status: 204 };"),
    },
    {
      name: "a null success status is NOT flagged (the honest form)",
      run: () => !FABRICATED.test("return { healthy: true, status: null };"),
    },
    {
      name: "a FAILURE path with a real number is not flagged (the error carries one)",
      run: () => !FABRICATED.test("return { healthy: false, status: 401 };"),
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
      run: () => !FABRICATED.test(stripComments("// return { healthy: true, status: 200 };")),
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

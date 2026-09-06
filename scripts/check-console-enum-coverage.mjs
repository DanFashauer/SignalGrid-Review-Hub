#!/usr/bin/env node
// Console enum-coverage gate — the console must account for EVERY member of the
// integration-health enum the wire can send it.
//
//   node scripts/check-console-enum-coverage.mjs
//   node scripts/check-console-enum-coverage.mjs --self-test
//   node scripts/check-console-enum-coverage.mjs --scan <dir>   (diagnostic, see below)
//
// THE DEFECT. `IntegrationHealthStatus` has four members. The Dashboard's
// integration-health card bucketed three of them by hand — connected, degraded,
// disconnected — so every `not-configured` integration in the served payload fell
// through every filter: it was in no summary tile, in no alert list, and in no count.
// It did not read as "not set up". It read as NOTHING, which on a health card is
// indistinguishable from healthy. That is an unearned affirmative, and golden rule 2
// says an unknown state may never lower assurance.
//
// A hand-written literal list of enum members is precisely the fossil this repository
// keeps re-growing: the enum is generated (orval, from the OpenAPI spec), so a member
// added upstream lands in the type and in nobody's UI. So the member list is DERIVED
// from the generated type on every run and never retyped here.
//
// TWO PROPERTIES, both GATED:
//   A. every member is NAMED IN CODE in the Dashboard (comments stripped first — a
//      member mentioned only in a comment is not bucketing, it is a note about
//      bucketing, and the whole point is that the comment can be true while the code
//      is wrong).
//   B. every member has its own `case "<member>":` in the badge component — derived,
//      not named: the switch block in StatusBadge.tsx that already cases AT LEAST ONE
//      member is the integration switch, and it must case them all. Nothing here
//      hard-codes "IntegrationStatusBadge", so renaming the component keeps the gate.
//
// REPORTED, not gated: whether the Dashboard's bucket table is bound as
// `Record<IntegrationHealthStatus, …>`. That form is exhaustive BY CONSTRUCTION — the
// compiler refuses to build until a new member has a bucket — and it is strictly
// stronger than what this gate can check by reading text. It is reported because
// requiring a particular TypeScript spelling is a style judgement, and this file gates
// only what is unambiguous.
//
// FAIL-CLOSED: an unparseable enum, an empty member set, or a badge file in which no
// switch cases a single member is fatal. A gate that found nothing is green about
// nothing. SELF-TEST FIRST: fixtures where a member is unnamed / uncased must be
// flagged, and the complete fixtures must clear, or the gate concludes nothing.
//
// --scan <dir> replaces the console src root; DIAGNOSTIC only (used to prove this gate
// fails on the tree that carried the defect). preflight and CI pass no arguments.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SRC = "artifacts/signalgrid-app/src";
const ENUM_FILE = "lib/api-zod/src/generated/types/integrationHealthStatus.ts";
const DASHBOARD_REL = "pages/Dashboard.tsx";
const BADGE_REL = "components/StatusBadge.tsx";
const FLOOR_MEMBERS = 3; // four today; a parse that found fewer than three has drifted

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── derivation: the enum members, from the generated type ────────────────────
/** @returns {{ name: string, members: string[] }} */
function parseEnum(text) {
  const decl = text.match(/export const ([A-Za-z0-9_]+)\s*=\s*\{/);
  if (!decl) return { name: null, members: [] };
  const start = text.indexOf("{", decl.index);
  const end = text.indexOf("}", start);
  if (end === -1) return { name: decl[1], members: [] };
  const body = text.slice(start + 1, end);
  const members = [];
  for (const m of body.matchAll(/(['"]?)([A-Za-z0-9_-]+)\1\s*:\s*(['"])([^'"]+)\3/g)) {
    members.push(m[4]); // the WIRE value, which is what the console compares against
  }
  return { name: decl[1], members };
}

// ── helpers ──────────────────────────────────────────────────────────────────
// Strip line and block comments. Crude but sufficient and, more importantly, honest
// about its purpose: a member named only in prose has not been bucketed.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"\\])\/\/[^\n]*/g, "$1");
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namedInCode = (code, member) => new RegExp(`(?<![\\w-])${esc(member)}(?![\\w-])`).test(code);

// Every `switch (…) { … }` block, brace-matched, with the case labels it declares.
function switchBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/\bswitch\s*\(/g)) {
    const open = text.indexOf("{", m.index);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = text.slice(open, i + 1);
    const cases = [...body.matchAll(/\bcase\s+(['"])([^'"]+)\1\s*:/g)].map((c) => c[2]);
    out.push({ body, cases });
  }
  return out;
}

// ── the analyser (shared by the self-test) ───────────────────────────────────
/**
 * @returns {{ failures: string[], exhaustiveByType: boolean, casedBlocks: number }}
 */
function analyse({ members, enumName, dashboard, badge, dashboardPath, badgePath }) {
  const failures = [];
  const code = stripComments(dashboard);

  // A — every member named in Dashboard code.
  for (const member of members) {
    if (!namedInCode(code, member)) {
      failures.push(
        `${dashboardPath} never names the "${member}" member of ${enumName} in code — ` +
          "an integration in that state falls through every bucket and reads as nothing, which on a health card reads as fine.",
      );
    }
  }

  // B — every member cased in the badge switch that already cases any of them.
  const blocks = switchBlocks(badge);
  const casedBlocks = blocks.filter((b) => b.cases.some((c) => members.includes(c)));
  if (casedBlocks.length === 0) {
    failures.push(
      `no switch in ${badgePath} cases a single ${enumName} member — the derivation that locates the integration badge is broken, ` +
        "or the badge stopped switching on the wire value. Either way this gate must not pass.",
    );
  }
  for (const b of casedBlocks) {
    for (const member of members) {
      if (!b.cases.includes(member)) {
        failures.push(
          `${badgePath} switches on integration health but has no \`case "${member}":\` — ` +
            "that member would render through the default arm as a raw wire string.",
        );
      }
    }
  }

  const exhaustiveByType = enumName ? new RegExp(`Record<\\s*${esc(enumName)}\\s*,`).test(dashboard) : false;
  return { failures, exhaustiveByType, casedBlocks: casedBlocks.length };
}

// ── self-test ────────────────────────────────────────────────────────────────
let selfTestShapes = 0;
{
  const fixtureEnum = `export const FixtureStatus = {
  connected: 'connected',
  degraded: 'degraded',
  'not-configured': 'not-configured',
} as const;`;
  const parsed = parseEnum(fixtureEnum);
  const completeBadge = `export function B({ s }: { s: string }) {
  switch (s) {
    case "connected": return <a/>;
    case "degraded": return <b/>;
    case "not-configured": return <c/>;
    default: return <d/>;
  }
}`;
  const completeDash = `const BUCKET: Record<FixtureStatus, string> = { connected: "x", degraded: "y", "not-configured": "z" };`;
  const cases = [
    {
      name: "a fixture enum with a member the fixture page never names is FLAGGED",
      args: { dashboard: `const B = { connected: "x", degraded: "y" };`, badge: completeBadge },
      want: 1,
    },
    {
      name: "the complete fixture page + badge is CLEAR",
      args: { dashboard: completeDash, badge: completeBadge },
      want: 0,
    },
    {
      name: "a member named ONLY in a comment is still FLAGGED (a note about bucketing is not bucketing)",
      args: {
        dashboard: `// not-configured is handled elsewhere\n/* also not-configured */\nconst B = { connected: "x", degraded: "y" };`,
        badge: completeBadge,
      },
      want: 1,
    },
    {
      name: "a badge missing one case is FLAGGED",
      args: {
        dashboard: completeDash,
        badge: `export function B({ s }: { s: string }) {\n  switch (s) {\n    case "connected": return <a/>;\n    case "degraded": return <b/>;\n    default: return <d/>;\n  }\n}`,
      },
      want: 1,
    },
    {
      name: "a badge whose switches case NO member at all is FLAGGED (broken derivation, not a pass)",
      args: {
        dashboard: completeDash,
        badge: `export function B({ s }: { s: string }) {\n  switch (s) {\n    case "allow": return <a/>;\n    default: return <d/>;\n  }\n}`,
      },
      want: 1,
    },
    {
      name: "an unrelated switch in the same file (allow/deny) does not drag in false findings",
      args: {
        dashboard: completeDash,
        badge: `export function O({ o }: { o: string }) {\n  switch (o) {\n    case "allow": return <a/>;\n    case "deny": return <b/>;\n    default: return <c/>;\n  }\n}\n${completeBadge}`,
      },
      want: 0,
    },
    {
      name: "a member whose name is a SUBSTRING of another token does not count as named",
      args: { dashboard: `const B = { connected: "x", degraded: "y", "not-configured-legacy": 1 };`, badge: completeBadge },
      want: 1,
    },
  ];
  selfTestShapes = cases.length;
  const failures = [];
  if (parsed.name !== "FixtureStatus" || parsed.members.join(",") !== "connected,degraded,not-configured") {
    failures.push(`parseEnum no longer derives the member list from a generated-shape enum (got ${JSON.stringify(parsed)})`);
  }
  for (const c of cases) {
    const got = analyse({
      members: parsed.members,
      enumName: parsed.name,
      dashboardPath: "fixture/Dashboard.tsx",
      badgePath: "fixture/StatusBadge.tsx",
      ...c.args,
    }).failures.length;
    if (got !== c.want) failures.push(`${c.name} — expected ${c.want} failure(s), got ${got}`);
  }
  if (!analyse({ members: parsed.members, enumName: parsed.name, dashboard: completeDash, badge: completeBadge, dashboardPath: "d", badgePath: "b" }).exhaustiveByType) {
    failures.push("the Record<Enum, …> exhaustiveness probe no longer recognises its own fixture");
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    fail("SELF-TEST FAILED: the enum-coverage detector no longer flags its synthetic violations. A gate that cannot fail proves nothing.");
  }
}

if (process.argv.includes("--self-test")) {
  console.log(`check-console-enum-coverage self-test passed (${selfTestShapes} shapes: planted gaps flagged, complete fixtures clear).`);
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const scanIdx = process.argv.indexOf("--scan");
const SRC = scanIdx !== -1 ? process.argv[scanIdx + 1] : DEFAULT_SRC;
const diagnostic = scanIdx !== -1;

if (!existsSync(ENUM_FILE)) fail(`${ENUM_FILE} missing — the generated enum moved; fix this derivation, do not guess the member list.`);
const dashboardPath = join(SRC, DASHBOARD_REL);
const badgePath = join(SRC, BADGE_REL);
for (const p of [dashboardPath, badgePath]) if (!existsSync(p)) fail(`${p} missing — the console surface moved; fix this derivation, do not silently check nothing.`);

const { name: enumName, members } = parseEnum(readFileSync(ENUM_FILE, "utf8"));
if (!enumName) fail(`could not find an \`export const <Name> = { … }\` in ${ENUM_FILE} — the generated shape changed.`);
if (members.length < FLOOR_MEMBERS) {
  fail(`parsed only ${members.length} member(s) of ${enumName} from ${ENUM_FILE} (floor ${FLOOR_MEMBERS}) — the parse has drifted; an empty member set would pass every check vacuously.`);
}

const { failures, exhaustiveByType, casedBlocks } = analyse({
  members,
  enumName,
  dashboard: readFileSync(dashboardPath, "utf8"),
  badge: readFileSync(badgePath, "utf8"),
  dashboardPath,
  badgePath,
});

console.log(
  `check-console-enum-coverage: ${enumName} has ${members.length} member(s) [${members.join(", ")}] derived from ${ENUM_FILE}; ` +
    `${casedBlocks} integration switch block(s) in ${BADGE_REL}; self-test green` +
    (diagnostic ? ` [DIAGNOSTIC --scan ${SRC}]` : ""),
);
console.log(
  `  REPORTED (not gated): Dashboard bucket table bound as Record<${enumName}, …> — ${exhaustiveByType ? "yes, exhaustive by construction; the compiler enforces what this gate samples" : "no; coverage rests on this gate alone"}.`,
);

if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    `\nConsole enum-coverage gate FAILED — ${failures.length} member(s) of ${enumName} are unaccounted for in the console.\n` +
      "Give the member a bucket and a case. Never narrow the enum to match the UI.",
  );
  process.exit(1);
}
console.log(`Console enum-coverage gate passed — every ${enumName} member is bucketed on the Dashboard and cased in the badge.`);

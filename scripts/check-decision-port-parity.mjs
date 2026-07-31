#!/usr/bin/env node
// Decision-port parity — the Swift port must not drift from the TS engine.
//
// `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is documented as a
// BYTE-FAITHFUL port of `lib/signalgrid-simulator/src/decisionEngine.ts`. That
// claim was true when written and is true today (verified: all 18 reason codes
// match). Nothing enforced it.
//
// That is the one drift in this repo with no ratchet, and it is the worst place
// to have one. Every other gate here exists because a claim can quietly stop
// being true — the SBOM, the sync manifest, the guard registry, the proof counts,
// the docs↔figure guard. A port is exactly that kind of claim: it is correct on
// the day it is written and decays silently afterwards, because the two files are
// edited by different people in different languages for different reasons, and
// nothing fails when only one of them changes.
//
// What silent divergence would mean here is not cosmetic. The iOS Assist gate is
// the product — the embedded gate is what a user actually meets. If the TS engine
// gains a rule and the port does not, the phone in someone's hand keeps returning
// the OLD verdict, confidently, with no error anywhere. It would not look broken.
// It would look like a device that decided differently from the fabric.
//
// WHAT THIS COMPARES, and why not a hash. Hashing the two files would fire on a
// comment or a reformat, and a gate that cries wolf gets bypassed — the repo
// already reasons this way about the enrollment-race skip. So this compares the
// DECISION VOCABULARY AND ITS WIRING, which is what a port has to preserve:
//
//   1. the set of reason codes each side can emit, and
//   2. for each reason code, the exact set of outcomes emitted alongside it.
//
// Both files state this identically — TS adds outcomes then pushes one code, Swift
// forms a union then appends the same code — so (2) is extractable as plain text
// with no parser and no Xcode, which matters because CI is linux and has neither.
// Renaming a variable or rewording a comment cannot trip it; changing what a
// verdict MEANS on one side and not the other always will.
//
// It cannot prove behavioural equivalence — only running both engines over shared
// vectors would, and that needs a Mac. It catches the failure that actually
// happens: a rule added, removed, or rewired on one side alone.
//
//   node scripts/check-decision-port-parity.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TS_PATH = "lib/signalgrid-simulator/src/decisionEngine.ts";
const SWIFT_PATH = "native/ios/EnterpriseShell/Services/DecisionEngine.swift";

/** Strip comments so prose about a reason code is never read as emitting one. */
function code(src) {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/**
 * Extract reasonCode -> Set(signed outcome mutations) by walking the file in order.
 *
 * Both files write a rule as "mutate the outcome set, then name the reason", so a
 * code owns the mutations since the previous code.
 *
 * Mutations are SIGNED (`+allow`, `-allow`) because some rules REMOVE an outcome —
 * `ALLOW_REMOVED_DUE_TO_HIGHER_RISK` deletes `allow` — and a model that only saw
 * additions would read a removal as an emission. The first version of this guard
 * did exactly that and reported a divergence that did not exist: it matched Swift's
 * `formUnion([...])` but not its `insert(...)`, so one side accumulated outcomes
 * the other appeared to lack. Both engines were identical. That false positive is
 * why the shapes below are enumerated per language rather than assumed.
 */
function extract(src, { adds, removes, pushCode }) {
  const rules = new Map();
  let pending = new Set();
  const tokens = [];

  const collect = (patterns, sign) => {
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        // One formUnion([...]) can carry several outcomes; a single add carries one.
        for (const o of m[1].matchAll(/"([a-z_]+)"/g)) {
          tokens.push({ at: m.index, kind: "outcome", value: `${sign}${o[1]}` });
        }
      }
    }
  };
  collect(adds, "+");
  collect(removes, "-");

  pushCode.lastIndex = 0;
  for (const m of src.matchAll(pushCode)) tokens.push({ at: m.index, kind: "code", value: m[1] });
  tokens.sort((a, b) => a.at - b.at);

  for (const t of tokens) {
    if (t.kind === "outcome") {
      pending.add(t.value);
    } else {
      const existing = rules.get(t.value) ?? new Set();
      for (const o of pending) existing.add(o);
      rules.set(t.value, existing);
      pending = new Set();
    }
  }
  return rules;
}

const tsSrc = code(readFileSync(resolve(repo, TS_PATH), "utf8"));
const swiftSrc = code(readFileSync(resolve(repo, SWIFT_PATH), "utf8"));

const ts = extract(tsSrc, {
  adds: [/outcomes\.add\((\s*"[a-z_]+"\s*)\)/g],
  removes: [/outcomes\.delete\((\s*"[a-z_]+"\s*)\)/g],
  pushCode: /reasonCodes\.push\("([A-Z0-9_]+)"\)/g,
});
const swift = extract(swiftSrc, {
  // Swift writes additions BOTH ways — formUnion([...]) for several, insert() for
  // one. Missing the second form is what produced this guard's first false positive.
  adds: [/outcomes\.formUnion\(\[([^\]]*)\]\)/g, /outcomes\.insert\((\s*"[a-z_]+"\s*)\)/g],
  removes: [/outcomes\.remove\((\s*"[a-z_]+"\s*)\)/g],
  pushCode: /reasonCodes\.append\("([A-Z0-9_]+)"\)/g,
});

let problems = 0;
const say = (s) => console.log(s);

if (ts.size === 0 || swift.size === 0) {
  console.error(
    `✗ extracted no rules (ts=${ts.size}, swift=${swift.size}). The emission shape in one of these\n` +
      `  files changed, so this guard is no longer reading them — which means it is no longer\n` +
      `  guarding anything. Fix the patterns rather than deleting the check.`,
  );
  process.exit(1);
}

// ── 1. vocabulary ────────────────────────────────────────────────────────────
const onlyTs = [...ts.keys()].filter((k) => !swift.has(k)).sort();
const onlySwift = [...swift.keys()].filter((k) => !ts.has(k)).sort();

for (const c of onlyTs) {
  console.error(`  ✗ ${c}: emitted by the TS engine, ABSENT from the Swift port — the phone cannot express this verdict`);
  problems += 1;
}
for (const c of onlySwift) {
  console.error(`  ✗ ${c}: emitted by the Swift port, ABSENT from the TS engine — the port invented a verdict`);
  problems += 1;
}

// ── 2. wiring ────────────────────────────────────────────────────────────────
// Same code on both sides, different consequences, is the subtle one: nothing is
// missing, so a vocabulary check alone would pass while the two disagree.
for (const [c, tsOutcomes] of [...ts.entries()].sort()) {
  const swOutcomes = swift.get(c);
  if (!swOutcomes) continue;
  const missing = [...tsOutcomes].filter((o) => !swOutcomes.has(o)).sort();
  const extra = [...swOutcomes].filter((o) => !tsOutcomes.has(o)).sort();
  if (missing.length || extra.length) {
    console.error(
      `  ✗ ${c}: the two engines disagree on what it does\n` +
        `      TS:    ${[...tsOutcomes].sort().join(", ") || "(none)"}\n` +
        `      Swift: ${[...swOutcomes].sort().join(", ") || "(none)"}`,
    );
    problems += 1;
  }
}

say(`decision-port parity: ${ts.size} TS rules vs ${swift.size} Swift rules, ${problems} divergence(s)`);

if (problems > 0) {
  console.error(
    `\nDecision-port parity FAILED.\n` +
      `  ${TS_PATH}\n  ${SWIFT_PATH}\n` +
      `A change to the decision engine must land on BOTH sides. The Swift port is what runs\n` +
      `on the device, so a port left behind does not fail — it quietly decides the old way.`,
  );
  process.exit(1);
}
say("Decision-port parity passed — the Swift port emits the same verdicts, wired the same way.");

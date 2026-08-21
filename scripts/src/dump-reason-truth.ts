// Dump the reason-code ground truth AS THE ENGINE KNOWS IT, for the catalog
// generator and its gate. This exists because the assurance review proved the
// regex approach wrong three ways in one afternoon: a brace-walk verdict parse
// mis-paired neighbouring rules, a spread-inherited outcome collapsed to "—"
// and thereby exempted itself from the only cross-check, and a
// module-based GA partition put five draft-only *_STRICT rules under a route
// that can never emit them. Rule tables and policy versions are EXPORTED and
// SEEDED — so this asks them, and the generator formats what the engine says.
//
//   npx tsx scripts/src/dump-reason-truth.ts   → JSON on stdout
import {
  SHARED_DEVICE_RULES_V1,
  SHARED_DEVICE_RULES_V2,
} from "../../lib/signalgrid-core/src/policy";
import { RESOLUTION_DESCRIPTOR_SHAPES } from "../../lib/signalgrid-core/src/resolution";
import { SignalGridCore } from "../../lib/signalgrid-core/src";

type Verdict = "allow" | "step_up" | "restrict" | "deny";

const ruleOutcomes: Record<string, { v1?: Verdict; v2?: Verdict }> = {};
for (const r of SHARED_DEVICE_RULES_V1) {
  ruleOutcomes[r.reasonCode] = { ...ruleOutcomes[r.reasonCode], v1: r.outcome as Verdict };
}
for (const r of SHARED_DEVICE_RULES_V2) {
  ruleOutcomes[r.reasonCode] = { ...ruleOutcomes[r.reasonCode], v2: r.outcome as Verdict };
}

// Which rule codes are in an ACTIVE policy version, per the seeded control
// plane — the fact that separates "evaluate can emit this" from "only the
// draft-policy test route can surface this". Enumerated through the public
// core API exactly the way the review's verifier did.
const core = SignalGridCore.demo();
const activeCodes = new Set<string>();
const draftOnlyCodes = new Set<string>();
for (const key of core.demoApiKeys()) {
  if (key.role !== "owner") continue;
  let policies;
  try {
    policies = core.listPolicies(key.token);
  } catch {
    continue;
  }
  for (const p of policies) {
    for (const v of core.listPolicyVersions(key.token, p.id)) {
      const target = v.id === p.activeVersionId ? activeCodes : draftOnlyCodes;
      for (const rule of v.rules) target.add(rule.reasonCode);
    }
  }
}
for (const c of activeCodes) draftOnlyCodes.delete(c);

const descriptors = RESOLUTION_DESCRIPTOR_SHAPES.map((d) => ({
  reasonCode: d.reasonCode,
  baseClass: d.baseClass,
  hasTransform: d.hasTransform,
}));

process.stdout.write(
  JSON.stringify(
    {
      ruleOutcomes,
      activeCodes: [...activeCodes].sort(),
      draftOnlyCodes: [...draftOnlyCodes].sort(),
      descriptors,
    },
    null,
    1,
  ) + "\n",
);

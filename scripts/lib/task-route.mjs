// Resolve a task kind to its route through the four-pass pipeline, from
// docs/agent/task-routing.json (DR-047 rules 1-3 as data). Pure given the table.
//
// Fail-closed by construction:
//   - an unknown or malformed kind NEVER defaults to a cheap tier: it returns the
//     capability-gap route (find an existing agent/skill, search sibling repos, or
//     have one built), so the brain never guesses;
//   - an unknown or unavailable tier resolves UP to the judgment tier (DR-047 rule 3);
//     when that tier is unavailable too, the route is PENDING: the work waits for the
//     reset and is never scheduled on an exhausted tier (DR-047 rule 4);
//   - with no validation lane distinct from the implementing lane, the route is
//     REFUSED rather than returned with an empty pass 3;
//   - pass 1 (local LLM) always runs at the highest effort;
//   - pass 3 validates on a lane other than the one that implemented;
//   - an owner-gated kind is marked so, and is never landed by a lane.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TABLE_PATH = join(ROOT, "docs/agent/task-routing.json");

export function loadRoutingTable(path = TABLE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const KIND = /^[a-z][a-z0-9-]{0,63}$/;

export function resolveRoute(table, kind, { implementLane = "local-claude", unavailableTiers = [] } = {}) {
  const entry = typeof kind === "string" && KIND.test(kind) && Object.hasOwn(table.kinds ?? {}, kind) ? table.kinds[kind] : null;
  if (!entry) {
    return { kind: String(kind), gap: true, route: table.fallback?.route ?? "capability-gap", steps: [...(table.fallback?.steps ?? [])] };
  }
  const up = table.unavailableTierResolvesTo ?? "judgment";
  let tierName = Object.hasOwn(table.tiers ?? {}, entry.tier) ? entry.tier : up;
  if (unavailableTiers.includes(tierName)) tierName = up;
  const tier = table.tiers[tierName];
  if (!tier || unavailableTiers.includes(tierName)) {
    return { kind, gap: false, pending: true, tier: tierName, why: `tier ${tierName} is unavailable; the work waits for its reset (DR-047 rule 4)` };
  }
  const validateLanes = Array.isArray(table.lanes?.["local-validate"]?.lanes) ? table.lanes["local-validate"].lanes : [];
  const validateLane = validateLanes.find((lane) => typeof lane === "string" && lane && lane !== implementLane) ?? null;
  if (!validateLane) {
    return { kind, gap: false, refused: true, tier: tierName, why: `no validation lane other than ${implementLane}` };
  }
  // A tier names a Claude family (DR-047); a Codex lane picks its own model and takes only the effort.
  const modelFor = (lane) => (typeof lane === "string" && lane.includes("claude") ? tier.model : null);
  return {
    kind,
    gap: false,
    pending: false,
    refused: false,
    tier: tierName,
    ownerGated: entry.ownerGated === true,
    role: entry.role,
    skills: [...(entry.skills ?? [])],
    validators: [...(entry.validators ?? [])],
    passes: [
      { pass: 1, lane: "local-llm", effort: "max", does: "draft and triage" },
      { pass: 2, lane: implementLane, model: modelFor(implementLane), effort: tier.effort, does: "implement" },
      { pass: 3, lane: validateLane, model: modelFor(validateLane), effort: tier.effort, does: "validate", validators: [...(entry.validators ?? [])] },
      { pass: 4, lane: "cloud-final", does: entry.ownerGated === true ? "final review; owner merges" : "final review and DR-037 landing" },
    ],
  };
}

// CLI: node scripts/lib/task-route.mjs <kind> [implementLane]  -> JSON route
if (isMainModule(process.argv[1], import.meta.url)) {
  const [kind, implementLane] = process.argv.slice(2);
  console.log(JSON.stringify(resolveRoute(loadRoutingTable(), kind, implementLane ? { implementLane } : {}), null, 2));
}

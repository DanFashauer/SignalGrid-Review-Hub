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
//   - an unsupported pass-2 lane, or no supported validation lane distinct from it, is
//     REFUSED rather than returned with usable passes;
//   - pass 1 (local LLM) always runs at the highest effort;
//   - passes 2 and 3 run only on the two local session lanes, and pass 3 is never pass 2's lane;
//   - a missing local LLM build is an explicit missing pass 1, and the route is not complete;
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
// The only lanes that may hold passes 2 and 3 (docs/LANE_COORDINATION.md, 2026-11-13 operating notes).
export const LOCAL_SESSION_LANES = Object.freeze(["local-claude", "local-codex"]);

// Pass 1 Bonsai: intake, scoped plan, first real implementation. Pass 2: an admitted local
// session reviews it and records findings. Pass 3: the OTHER local session runs the real
// checks and consumes pass 2's findings. Pass 4: cloud final review of the final head.
export function resolveRoute(table, kind, { reviewLane = "local-claude", unavailableTiers = [], localLlmAvailable = true } = {}) {
  const entry = typeof kind === "string" && KIND.test(kind) && Object.hasOwn(table.kinds ?? {}, kind) ? table.kinds[kind] : null;
  if (!entry) {
    return { kind: String(kind), gap: true, route: table.fallback?.route ?? "capability-gap", steps: [...(table.fallback?.steps ?? [])] };
  }
  const up = table.unavailableTierResolvesTo ?? "judgment";
  let tierName = Object.hasOwn(table.tiers ?? {}, entry.tier) ? entry.tier : up;
  if (unavailableTiers.includes(tierName)) tierName = up;
  const tier = Object.hasOwn(table.tiers ?? {}, tierName) ? table.tiers[tierName] : null;
  if (!tier || unavailableTiers.includes(tierName)) {
    return { kind, gap: false, pending: true, refused: false, tier: tierName, why: `tier ${tierName} is unavailable; the work waits for its reset (DR-047 rule 4)` };
  }
  const refuse = (why) => ({ kind, gap: false, pending: false, refused: true, tier: tierName, why });
  if (typeof reviewLane !== "string" || !LOCAL_SESSION_LANES.includes(reviewLane)) {
    return refuse(`pass 2 must run on a local session lane (${LOCAL_SESSION_LANES.join(", ")}), got ${JSON.stringify(reviewLane)}`);
  }
  const configured = Array.isArray(table.lanes?.["local-validate"]?.lanes) ? table.lanes["local-validate"].lanes : [];
  const validateLane = configured.find((lane) => LOCAL_SESSION_LANES.includes(lane) && lane !== reviewLane) ?? null;
  if (!validateLane) {
    return refuse(`no supported validation lane other than ${reviewLane}`);
  }
  // A tier names a Claude family (DR-047); a Codex lane picks its own model and takes only the effort.
  const modelFor = (lane) => (lane === "local-claude" ? tier.model : null);
  const bonsai = localLlmAvailable === true;
  return {
    kind,
    gap: false,
    pending: false,
    refused: false,
    // Complete only when every stage has somewhere to run; a missing stage is reported, never folded in.
    complete: bonsai,
    tier: tierName,
    ownerGated: entry.ownerGated === true,
    role: entry.role,
    skills: [...(entry.skills ?? [])],
    validators: [...(entry.validators ?? [])],
    passes: [
      bonsai
        ? { pass: 1, lane: "local-llm", effort: "max", does: "intake, scoped plan and first implementation" }
        : { pass: 1, lane: "local-llm", missing: true, does: "MISSING: no local LLM build available; the route is not complete" },
      { pass: 2, lane: reviewLane, model: modelFor(reviewLane), effort: tier.effort, does: "review the first artifact and record findings" },
      { pass: 3, lane: validateLane, model: modelFor(validateLane), effort: tier.effort, does: "run the real checks and consume pass 2 findings", validators: [...(entry.validators ?? [])] },
      { pass: 4, lane: "cloud-final", does: entry.ownerGated === true ? "final review of the final head; owner merges" : "final review of the final head; DR-037 landing" },
    ],
  };
}

// CLI: node scripts/lib/task-route.mjs <kind> [reviewLane]  -> JSON route
if (isMainModule(process.argv[1], import.meta.url)) {
  const [kind, reviewLane] = process.argv.slice(2);
  console.log(JSON.stringify(resolveRoute(loadRoutingTable(), kind, reviewLane === undefined ? {} : { reviewLane }), null, 2));
}

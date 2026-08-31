// SignalGrid breadth lane — the deferred-family and doctrine-document proofs,
// kept green WITHOUT sitting in the per-push critical path.
//
//   node scripts/verify-breadth.mjs        (alias: pnpm run verify:breadth)
//
// WHY THIS LANE EXISTS (plan §11.4 step 4). The per-push preflight had grown to
// ~166 serial steps, and the verification scan measured the ratio: 47 gates fire
// on DEFERRED connector families every push — nearly double the launch-surface
// coverage — plus 8 doctrine-document proofs whose subjects change on the
// cadence of documents, not code. Every docs edit paid the full proof wall.
// The freeze says deferred families are real, gated, and staying in the
// repository; it does not say they must tax every push. So they moved here:
// kept, runnable, still a required CI lane on every pull request (the lane runs
// IN PARALLEL with `validation`, so CI wall-clock drops rather than grows) —
// no longer a serial local tax.
//
// MEMBERSHIP IS DERIVED, NOT REMEMBERED. The 47 deferred-family gates are the
// 43 deferred families whose proof is named `proof:<family>` one-to-one, plus
// the four shared gates covering the remaining five deferred families
// (`carrier` → proof:carrier-reachability; `itsm`/`siem`/`syslog`/`telemetry`
// → proof:emitter-discipline + proof:emit-gate + proof:telemetry-up). The
// derivation is ENFORCED below against scripts/launch-profile.mjs before any
// step runs: a deferred family whose one-to-one proof is missing from this
// lane fails it, and a LAUNCH family's proof appearing here fails it too —
// launch coverage must stay per-push in preflight, and breadth must not leak
// back. The 8 doctrine-document proofs are listed by name: the five doctrine
// model docs (zero-trust, security-operations-evidence, kpi-kri-kci,
// municipal-resilience, itom-itsm-bridge) and the three vertical/capstone
// compositions built on deferred families (grid-lifecycle, factory-flows,
// fabric-scenario).
//
// WHAT A GREEN HERE DOES NOT SAY: anything about the launch surface. That is
// preflight's job (`node scripts/preflight.mjs`), and the two lanes are kept
// disjoint by `check-ci-preflight-sync.mjs` — a proof in both lanes is the
// per-push tax quietly returning, and a proof in neither is coverage silently
// lost; both fail that gate.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACES } from "./launch-profile.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Names copied verbatim from the preflight entries they replaced, so a reader
// diffing the move can see nothing was reworded en route.
const STEPS = [
  // ── The 8 doctrine-document proofs ──────────────────────────────────────
  { name: "Zero Trust principles (the doctrine holds against the shipped decision core)", cmd: ["pnpm", "run", "proof:zero-trust-principles"] },
  { name: "Security Operations Evidence (doctrine holds against engine + crypto source)", cmd: ["pnpm", "run", "proof:security-operations-evidence"] },
  { name: "KPI / KRI / KCI model (an indicator informs assurance, never creates a grant)", cmd: ["pnpm", "run", "proof:kpi-kri-kci"] },
  { name: "Municipal resilience model (the proof chain doctrine holds against engine + source)", cmd: ["pnpm", "run", "proof:municipal-resilience"] },
  { name: "ITOM / ITSM bridge (every refusal the engine emits has a real owner)", cmd: ["pnpm", "run", "proof:itom-itsm-bridge"] },
  { name: "Proof: grid-lifecycle (capstone — 6 models, provision→decommission)", cmd: ["pnpm", "run", "proof:grid-lifecycle"] },
  { name: "Proof: factory-flows (manufacturing/OT workflows)", cmd: ["pnpm", "run", "proof:factory-flows"] },
  { name: "Proof: fabric-scenario (end-to-end fusion → incident)", cmd: ["pnpm", "run", "proof:fabric-scenario"] },
  // ── The 47 deferred-family gates ────────────────────────────────────────
  { name: "Proof: carrier-reachability (post-exit, gated)", cmd: ["pnpm", "run", "proof:carrier-reachability"] },
  { name: "Proof: location-services (geofence posture, gated)", cmd: ["pnpm", "run", "proof:location-services"] },
  { name: "Proof: vuln-scan (device risk posture, gated)", cmd: ["pnpm", "run", "proof:vuln-scan"] },
  { name: "Proof: network-nac (access posture, gated)", cmd: ["pnpm", "run", "proof:network-nac"] },
  { name: "Proof: edr-threat (endpoint threat-state, gated)", cmd: ["pnpm", "run", "proof:edr-threat"] },
  { name: "Proof: identity-risk (SSO sign-in risk, gated)", cmd: ["pnpm", "run", "proof:identity-risk"] },
  { name: "Proof: rtls-custody (physical custody, gated)", cmd: ["pnpm", "run", "proof:rtls-custody"] },
  { name: "Proof: peripheral-control (removable media, gated)", cmd: ["pnpm", "run", "proof:peripheral-control"] },
  { name: "Proof: data-protection (DLP posture, gated)", cmd: ["pnpm", "run", "proof:data-protection"] },
  { name: "Proof: credential-exposure (endpoint secrets, gated)", cmd: ["pnpm", "run", "proof:credential-exposure"] },
  { name: "Proof: macos-posture (grid-collected Mac, gated)", cmd: ["pnpm", "run", "proof:macos-posture"] },
  { name: "Proof: uem (read-only MDM/UEM dimension — gated, no actuators)", cmd: ["pnpm", "run", "proof:uem"] },
  { name: "Proof: entitlement-binding (is the grant REVIEWABLE, not just correct)", cmd: ["pnpm", "run", "proof:entitlement-binding"] },
  { name: "Proof: service-lifecycle (does the SERVICE plane still agree the principal is here)", cmd: ["pnpm", "run", "proof:service-lifecycle"] },
  { name: "Proof: session-readiness (is the app this worker needs actually usable)", cmd: ["pnpm", "run", "proof:session-readiness"] },
  { name: "Proof: credential-rotation (is the secret still inside its own policy)", cmd: ["pnpm", "run", "proof:credential-rotation"] },
  { name: "Proof: observability-integrity (is that silence an observation or a gap)", cmd: ["pnpm", "run", "proof:observability-integrity"] },
  { name: "Proof: break-glass (was the emergency override accountable)", cmd: ["pnpm", "run", "proof:break-glass"] },
  { name: "Proof: response-accountability (the watermelon — closed but unresolved)", cmd: ["pnpm", "run", "proof:response-accountability"] },
  { name: "Proof: nac (read-only endpoint identity — gated, no actuators)", cmd: ["pnpm", "run", "proof:nac"] },
  // Registered 2026-08-31: the gap scan found this in neither preflight, the
  // breadth lane, nor CI — running only through the Mac harness's dynamic
  // proof:* enumeration. A DR-005 design gate belongs in an always-on lane.
  { name: "Proof: decision-palette (one palette, AA on every rendered ground)", cmd: ["pnpm", "run", "proof:decision-palette"] },
  { name: "Proof: ot-posture (grid-collected OT/IIoT edge, gated)", cmd: ["pnpm", "run", "proof:ot-posture"] },
  { name: "Proof: access-governance (IAM/access-governance runtime, gated)", cmd: ["pnpm", "run", "proof:access-governance"] },
  { name: "Proof: device-attestation (hardware-rooted attestation, gated)", cmd: ["pnpm", "run", "proof:device-attestation"] },
  { name: "Proof: sso-session (SSO session-binding on shared devices, gated)", cmd: ["pnpm", "run", "proof:sso-session"] },
  { name: "Proof: oauth-consent (OAuth/workload-identity consent governance, gated)", cmd: ["pnpm", "run", "proof:oauth-consent"] },
  { name: "Proof: token-binding (DPoP/mTLS proof-of-possession vs replayable bearer, gated)", cmd: ["pnpm", "run", "proof:token-binding"] },
  { name: "Proof: pacs-access (physical access-control / badge door authorization, gated)", cmd: ["pnpm", "run", "proof:pacs-access"] },
  { name: "Proof: agent-identity (agentic / non-human-identity governance, gated)", cmd: ["pnpm", "run", "proof:agent-identity"] },
  { name: "Proof: agent-behavior (action-judgment — the layer that questions the action, gated)", cmd: ["pnpm", "run", "proof:agent-behavior"] },
  { name: "Proof: custody-beacon (asset recovery — offline beacon fused with reachability, gated)", cmd: ["pnpm", "run", "proof:custody-beacon"] },
  { name: "Proof: app-update (host-app version currency — floors, forced updates, provenance)", cmd: ["pnpm", "run", "proof:app-update"] },
  { name: "Proof: platform-sso (macOS platform credential — method, policy compatibility, lockout exposure)", cmd: ["pnpm", "run", "proof:platform-sso"] },
  { name: "Proof: passkey-assurance (credential worth — attestation, custody, user verification)", cmd: ["pnpm", "run", "proof:passkey-assurance"] },
  { name: "Proof: change-window (an approval is a claim about a specific time, actor and record)", cmd: ["pnpm", "run", "proof:change-window"] },
  { name: "Proof: emitter-discipline (five outbound families gated, fixture never claims delivery)", cmd: ["pnpm", "run", "proof:emitter-discipline"] },
  { name: "Proof: emit-gate (one shared tier gate for every in-adapter emitter route)", cmd: ["pnpm", "run", "proof:emit-gate"] },
  { name: "Proof: benchmark-selection (which CIS benchmark graded this device, from what content, covering how much)", cmd: ["pnpm", "run", "proof:benchmark-selection"] },
  { name: "Proof: shift-context (is this the right time and site for this worker to be operating)", cmd: ["pnpm", "run", "proof:shift-context"] },
  { name: "Proof: bootstrap-credential (a temporary pass reaches enrollment only)", cmd: ["pnpm", "run", "proof:bootstrap-credential"] },
  { name: "Proof: challenge-capability (a step_up must be answerable, never a deny in disguise)", cmd: ["pnpm", "run", "proof:challenge-capability"] },
  { name: "Proof: sse-egress (a mandated edge the traffic is not traversing is never protected)", cmd: ["pnpm", "run", "proof:sse-egress"] },
  { name: "Proof: webhooks (outbound delivery gated; a withheld delivery says so)", cmd: ["pnpm", "run", "proof:webhooks"] },
  { name: "Proof: caep-events (unsigned session signals, sixth emitter family)", cmd: ["pnpm", "run", "proof:caep-events"] },
  { name: "Proof: policy-binding (group-assignment correctness — membership IS the policy)", cmd: ["pnpm", "run", "proof:policy-binding"] },
  { name: "Proof: link-usability (associated vs usable — the network link's expiry, gated)", cmd: ["pnpm", "run", "proof:link-usability"] },
  { name: "Proof: task-exception (WMS/task-plane exceptions, gated)", cmd: ["pnpm", "run", "proof:task-exception"] },
  { name: "Proof: telemetry-up", cmd: ["pnpm", "run", "proof:telemetry-up"] },
];

// ── Membership enforcement, before anything runs ────────────────────────────
// The lane's own claim ("the deferred-family gates live here") is re-derived
// from the launch profile and package.json rather than trusted, in both
// directions — the same rule every other coverage list in this repo follows.
const inLane = new Set(STEPS.map((s) => s.cmd[2]));
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const proofScripts = new Set(Object.keys(pkg.scripts ?? {}).filter((k) => k.startsWith("proof:")));
const families = SURFACES.find((s) => s.key === "connector-families");
const membershipProblems = [];
for (const f of families.deferred) {
  const p = `proof:${f.id}`;
  if (proofScripts.has(p) && !inLane.has(p)) {
    membershipProblems.push(`deferred family "${f.id}" has ${p} but this lane does not run it — its coverage just silently left every lane`);
  }
}
for (const f of families.launch) {
  const p = `proof:${f.id}`;
  if (inLane.has(p)) {
    membershipProblems.push(`LAUNCH family "${f.id}" is in the breadth lane — launch coverage must stay per-push in preflight`);
  }
}
if (membershipProblems.length > 0) {
  console.error("verify:breadth membership check FAILED before running anything:");
  for (const p of membershipProblems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const results = [];
let failed = null;
for (const step of STEPS) {
  process.stdout.write(`▶ ${step.name} … `);
  const [bin, ...args] = step.cmd;
  const r = spawnSync(bin, args, { cwd: repo, encoding: "utf8" });
  if (r.status === 0) {
    console.log("ok");
    results.push(step.name);
  } else {
    console.log("FAILED");
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n").slice(-25).join("\n");
    console.error(`\n─── ${step.name} output (tail) ───\n${out}\n`);
    failed = step.name;
    break;
  }
}

if (failed) {
  console.error(`\nBreadth lane FAILED at: ${failed}.`);
  process.exit(1);
}
console.log(`\nBreadth lane PASSED — ${results.length} deferred-family and doctrine proofs green.`);
console.log("This says NOTHING about the launch surface — that is preflight's job.");

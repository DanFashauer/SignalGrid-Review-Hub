// Proof: the cloud↔edge sync contract (config DOWN with integrity).
//
// Walks an edge node from behind → synced, the way a real local decision plane
// would pull and verify config from the control plane:
//   1. A behind node reports updateAvailable with a target version + checksum.
//   2. The pulled bundle's checksum verifies (recomputed from content).
//   3. A TAMPERED bundle fails the integrity check (fail closed) — the node must
//      refuse to apply it.
//   4. Applying the (verified) bundle advances the node; it is now up to date.
//   5. Re-applying is idempotent (no spurious update).
//   6. A node already current needs no update.
//
// Run: pnpm --filter @workspace/scripts run proof:edge-sync

import { createHmac } from "crypto";
import { ControlPlane, bundleChecksum, verifyBundleChecksum, verifyBundleSignature, type PolicyBundle } from "@workspace/control-plane";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else failures.push(name);
}

function main() {
  const cp = ControlPlane.demo();

  // Atlas warehouse edge node starts behind (bundle 3, target 4).
  const behindNodeId = "edge_atlas_dc7";
  const before = cp.syncPlan(behindNodeId);
  check("behind node reports an update is available", before?.updateAvailable === true);
  check("sync plan advertises a target version ahead of current", !!before && before.targetBundleVersion > before.currentBundleVersion);

  // The node pulls the tenant's bundle (config DOWN) and checks integrity.
  const bundle = cp.getPolicyBundle("tenant_atlas");
  check("bundle pulled for the node's tenant", bundle !== null);
  check("pulled bundle checksum matches the sync plan", !!bundle && !!before && bundle.checksum === before.checksum);
  check("pulled bundle verifies (recomputed checksum)", !!bundle && verifyBundleChecksum(bundle));

  // A tampered bundle must fail closed — the node refuses to apply it.
  if (bundle) {
    const tamperedWorkflows: PolicyBundle = { ...bundle, workflows: [...bundle.workflows, "attacker-injected"] };
    const tamperedVersion: PolicyBundle = { ...bundle, version: bundle.version + 99 };
    check("tampered bundle (extra workflow) fails integrity", verifyBundleChecksum(tamperedWorkflows) === false);
    check("tampered bundle (version bump) fails integrity", verifyBundleChecksum(tamperedVersion) === false);

    // Signature (authenticity): a genuine bundle verifies; a checksum-valid
    // bundle with a bad/forged signature still fails (the attacker has no key).
    check("pulled bundle signature verifies (authentic)", verifyBundleSignature(bundle));
    const forgedSig: PolicyBundle = { ...bundle, signature: "0".repeat(bundle.signature.length) };
    check("valid checksum but forged signature fails closed", verifyBundleChecksum(forgedSig) === true && verifyBundleSignature(forgedSig) === false);
    check("tampered workflows fail signature too", verifyBundleSignature(tamperedWorkflows) === false);

    // An UNPROVISIONED tenant must fail authenticity even with a self-consistent
    // checksum AND a signature an attacker computed against the old shared fallback
    // key ("cpk_demo_unknown_signing"). The checksum is over public content and the
    // fallback was a public source constant, so the attacker can satisfy BOTH the
    // integrity gate and the pre-fix signature check. verifyBundleSignature must
    // still refuse it, because the tenant has no trusted signing key. This assertion
    // fails the instant that shared fallback is restored — the case the earlier
    // forgery checks (which only mutate content) could never catch.
    const evilTenant = "tenant_unprovisioned_attacker";
    const evilVersion = 1;
    const evilWorkflows = ["exfiltrate"];
    const evilCanonical = `${evilTenant}:${evilVersion}:${evilWorkflows.join(",")}`;
    const evilBundle: PolicyBundle = {
      tenantId: evilTenant,
      version: evilVersion,
      workflows: evilWorkflows,
      checksum: bundleChecksum(evilTenant, evilVersion, evilWorkflows),
      signature: createHmac("sha256", "cpk_demo_unknown_signing").update(evilCanonical).digest("hex"),
    };
    check("unprovisioned tenant has valid integrity but a self-forged signature", verifyBundleChecksum(evilBundle) === true);
    check("unprovisioned tenant fails authenticity — no shared fallback key", verifyBundleSignature(evilBundle) === false);
  }

  // Apply the verified bundle → node advances to target.
  const applied = cp.applyBundle(behindNodeId);
  check("applying the bundle clears updateAvailable", applied?.updateAvailable === false);
  check("node advanced to the target version", !!applied && !!before && applied.currentBundleVersion === before.targetBundleVersion);

  // Idempotent: applying again changes nothing.
  const again = cp.applyBundle(behindNodeId);
  check("re-applying is idempotent", again?.updateAvailable === false && again?.currentBundleVersion === applied?.currentBundleVersion);

  // A node already current needs no update.
  const current = cp.syncPlan("edge_nw_general");
  check("already-current node needs no update", current?.updateAvailable === false);

  // Unknown node yields nothing (fail closed).
  check("unknown node cannot be synced", cp.applyBundle("edge_nope") === null);

  const total = passed + failures.length;
  console.log(`Edge-sync contract proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Cloud→edge config distribution with integrity confirmed (pull, verify, apply, idempotent, fail-closed).");
}

main();

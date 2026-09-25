// native-build-attestation — a preflight step that this machine cannot run natively
// may be recorded in the live evidence ONLY from an attestation bound to the exact tree.
//
//   node scripts/lib/native-build-attestation.mjs --self-test   # prove every refusal, both directions
//
// WHY. On macOS the workspace strips the linux-only bundler binaries, so `Build (all
// packages)` and `Browser E2E (…)` never run natively; verify-all records them as
// EXCLUDED and the readiness figure counts the bound step as 0 — 95% is this Mac's
// honest ceiling. `scripts/mac/linux-web-build.sh --e2e --attest <path>` runs those two
// steps inside an amd64 Linux VM (Apple `container`, node:22) on the SAME checkout and
// writes this attestation. verify-all then records the step as passed — but only when
// every binding below holds. Anything missing, malformed, stale or dirty attests
// NOTHING (golden rule 2: an unknown never loosens the answer).
//
// THE BINDINGS, all required:
//   schema     === "signalgrid-native-build-attestation/v1"
//   status     === "passed"                 (a failed or partial VM run attests nothing)
//   treeSha    === the Review-Hub HEAD at mint time (the VM ran THIS tree, not an older one)
//   treeClean  === true AND the Review-Hub tree is clean at mint time (untracked included —
//                 the same rule sim-result provenance uses)
//   steps      ⊆ the registered needsNativeBuild step names (only names the VM actually ran)
//
// It never invents a digest: verify-all computes `sourceDigest` for an attested step the
// same way it does for a natively-run one, so a stale attestation cannot read as current.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SCHEMA = "signalgrid-native-build-attestation/v1";

/**
 * Pure. Which registered native-build steps the attestation may stand for.
 * @returns {{ attested: string[], excluded: string[], reason: string|null }}
 */
export function attestedNativeSteps(attestation, { reviewHubCommit, reviewHubClean, registered = [] } = {}) {
  const none = (reason) => ({ attested: [], excluded: [...registered].sort(), reason });
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return none("no native-build attestation");
  if (attestation.schema !== SCHEMA) return none(`attestation schema ${JSON.stringify(attestation.schema)} is not ${SCHEMA}`);
  if (attestation.status !== "passed") return none(`attestation status ${JSON.stringify(attestation.status)} is not "passed" — a failed or partial VM run attests nothing`);
  if (typeof reviewHubCommit !== "string" || reviewHubCommit.length < 7) return none("the Review-Hub HEAD is unknown — nothing can be bound to it");
  if (attestation.treeSha !== reviewHubCommit) return none(`attestation treeSha ${String(attestation.treeSha).slice(0, 12)} is not this tree's HEAD ${reviewHubCommit.slice(0, 12)} — the VM ran another tree`);
  if (attestation.treeClean !== true) return none("the attested tree was not clean at launch (untracked included) — the VM may have run bytes no commit carries");
  if (reviewHubClean !== true) return none("the Review-Hub tree is not clean now — the attestation cannot be bound to what would be minted");
  if (!Array.isArray(attestation.steps) || attestation.steps.some((s) => typeof s !== "string")) return none("attestation.steps is not a list of step names");
  const reg = new Set(registered);
  const attested = [...new Set(attestation.steps)].filter((s) => reg.has(s)).sort();
  const excluded = [...registered].filter((s) => !attested.includes(s)).sort();
  return { attested, excluded, reason: attested.length === 0 ? "the attestation names no registered native-build step" : null };
}

/** Impure: read the JSON at `path`; null (with the reason) on any failure. */
export function readAttestation(path) {
  try { return { attestation: JSON.parse(readFileSync(path, "utf8")), error: null }; }
  catch (e) { return { attestation: null, error: `attestation at ${path} unreadable/unparseable (${e.message.split("\n")[0]})` }; }
}

function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, !!ok]);
  const REG = ["Build (all packages)", "Browser E2E (review console, website, admin)"];
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const good = { schema: SCHEMA, status: "passed", treeSha: SHA, treeClean: true, steps: [...REG], ranAt: "2026-09-25T16:00:00Z" };
  const ctx = { reviewHubCommit: SHA, reviewHubClean: true, registered: REG };
  const ok = attestedNativeSteps(good, ctx);
  t("happy path: both registered steps attested, nothing excluded, no reason", ok.attested.length === 2 && ok.excluded.length === 0 && ok.reason === null);
  t("absent attestation attests nothing and excludes every registered step", attestedNativeSteps(null, ctx).attested.length === 0 && attestedNativeSteps(null, ctx).excluded.length === 2);
  t("wrong schema attests nothing", attestedNativeSteps({ ...good, schema: "v0" }, ctx).attested.length === 0);
  t("status failed attests nothing", attestedNativeSteps({ ...good, status: "failed" }, ctx).attested.length === 0);
  t("status missing attests nothing", attestedNativeSteps({ ...good, status: undefined }, ctx).attested.length === 0);
  t("a different tree sha attests nothing (the VM ran another tree)", attestedNativeSteps({ ...good, treeSha: "f".repeat(40) }, ctx).attested.length === 0);
  t("unknown Review-Hub HEAD attests nothing", attestedNativeSteps(good, { ...ctx, reviewHubCommit: null }).attested.length === 0);
  t("a dirty tree at launch attests nothing", attestedNativeSteps({ ...good, treeClean: false }, ctx).attested.length === 0);
  t("a dirty tree at mint attests nothing", attestedNativeSteps(good, { ...ctx, reviewHubClean: false }).attested.length === 0);
  t("a step the VM did not run stays excluded", attestedNativeSteps({ ...good, steps: [REG[1]] }, ctx).excluded.join() === REG[0] && attestedNativeSteps({ ...good, steps: [REG[1]] }, ctx).attested.join() === REG[1]);
  t("an unregistered step name is ignored, never attested", attestedNativeSteps({ ...good, steps: ["Deploy to production"] }, ctx).attested.length === 0);
  t("empty steps attest nothing, with a reason", attestedNativeSteps({ ...good, steps: [] }, ctx).attested.length === 0 && typeof attestedNativeSteps({ ...good, steps: [] }, ctx).reason === "string");
  t("malformed steps (not strings) attest nothing", attestedNativeSteps({ ...good, steps: [1, 2] }, ctx).attested.length === 0);
  t("readAttestation on a missing file returns null with the reason", readAttestation("/nonexistent/attest.json").attestation === null && /unreadable/.test(readAttestation("/nonexistent/attest.json").error));
  t("self-test floor: at least 12 assertions", checks.length >= 12);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nnative-build-attestation self-test ${failed.length ? "FAILED" : "passed"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  console.log("usage: node scripts/lib/native-build-attestation.mjs --self-test");
  process.exit(2);
}

// SignalGrid preflight — one command that runs the WHOLE gate suite locally,
// mirroring CI, so a change is proven correct BEFORE it is pushed. This is the
// mechanical half of the two-layer self-review (docs/SELF_REVIEW.md); the other
// half is the adversarial agent review a human/agent runs on the diff.
//
//   node scripts/preflight.mjs          # full suite (what CI runs)
//   node scripts/preflight.mjs --quick  # skip the heavy web/app builds
//
// Exits non-zero on the first failing gate and prints a compact report, so
// "green preflight" means "CI will be green".
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uncoveredLines } from "./lib/ci-jobs.mjs";
import { nativeBuildExclusion } from "./lib/platform-native-build.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

// Ordered gates — a complete mirror of the CI jobs that need NOTHING BUT NODE
// (one honest exception: `proof:mobile-app-catalog` shells to python3, which is
// present on every CI image and every dev machine this repo targets; by design
// that proof FAILS — never skips — when python3 is absent, so this list still
// cannot silently pass a gate it could not run):
// `validation` and `docs-sanity` from `.github/workflows/review-hub-ci.yml`, plus
// the SBOM-drift gate from `supply-chain.yml`'s `sbom` job. Keep this list in
// lockstep with those; a proof that runs in CI but not here would let a red build
// pass preflight.
//
// WHAT IT DOES NOT COVER is NOT listed here. It is DERIVED and printed with the
// verdict at the bottom of this file (`uncoveredLines()` from
// ./lib/ci-jobs.mjs), and that is the only list to read.
//
// A hand-written copy stood in this slot and rotted exactly as you would expect.
// It said "Six CI jobs run on pull_request; this mirrors three. The other three
// need external services" and then named durable-persistence, deploy-stack and
// secret-scan. Three errors in four lines: `review-hub-ci.yml:podman-stack` and
// `review-hub-ci.yml:breadth` were never named at all, and `secret-scan` is a
// `supply-chain.yml` job rather than a fourth review-hub-ci one — so the list
// whose entire job is to enumerate what preflight does not prove was itself
// under-reporting. Same defect as the three-string array the derived footer
// replaced, re-introduced one comment higher up.
//
// So: a green preflight means EVERYTHING THIS HARNESS RUNS is green, and the
// footer says what that leaves out, recomputed from `.github/workflows/` on
// every run. `heavy` steps (full monorepo build) are skipped only under --quick.
const STEPS = [
  // FIRST, because it is the first thing CI does and the cheapest way to be told
  // this push cannot even install. It was missing, and that omission let preflight
  // print "Safe to push" over a lockfile that did not match its manifests — CI then
  // failed on `Install dependencies` before running a single gate.
  //
  // The specific way it broke is worth naming: this harness adds darwin platform
  // binaries to build locally (the repo pins linux-x64) and restores the manifests
  // afterwards. That dance leaked the four darwin entries into pnpm-lock.yaml while
  // package.json had been restored without them. Every other gate passed, because
  // every other gate reads source rather than the lockfile.
  //
  // `--lockfile-only`, NOT `--offline`. The first version used `--offline` to keep
  // the check fast, and that conflated two different failures: a genuine
  // lockfile/manifest mismatch, and a package simply not being in the local store.
  // Rebasing a dependency PR failed it with ERR_PNPM_NO_OFFLINE_TARBALL over a
  // lockfile that was perfectly consistent — a gate that cries wolf precisely on
  // the branches that change dependencies, which is the only time it matters.
  // `--lockfile-only` resolves without fetching tarballs: exit 0 when consistent
  // even with an unwarmed store, exit 1 on a real mismatch. Both verified.
  { name: "Lockfile matches manifests (what CI installs with)", cmd: ["pnpm", "install", "--frozen-lockfile", "--lockfile-only"] },
  // Immediately after the lockfile gate, and for the same reason: the Docker-compose
  // smoke is one of the three CI jobs this file does NOT mirror, so anything only a
  // `docker build` can see is invisible here by construction. A root lifecycle hook
  // whose entrypoint the Dockerfile does not COPY is exactly that — every source-reading
  // gate stays green and the image build dies on `pnpm install`. Reads two text files.
  { name: "Docker carries every install-hook entrypoint", cmd: ["node", "scripts/check-docker-lifecycle-copy.mjs"] },
  { name: "Invariant review (fail-closed / determinism / Assist / truth)", cmd: ["node", "scripts/review-invariants.mjs"] },
  // Shell was the only language here with no static analysis: CodeQL takes JS/TS,
  // tsc takes types, gitleaks takes secrets, the proofs take behaviour. See
  // scripts/check-shell.mjs for why the floor is `warning` and why the Mac lane's
  // validate-sim-macos.sh is DEFERRED rather than excluded.
  { name: "Shell lint (the one language with no static analysis)", cmd: ["node", "scripts/check-shell.mjs"] },
  { name: "Docs sanity (required docs + unsafe-claim scan)", cmd: ["node", "scripts/docs-sanity.mjs"] },
  { name: "Doc orphans (a new doc must be reachable from an index)", cmd: ["node", "scripts/check-doc-orphans.mjs"] },
  { name: "Doc-orphan self-test (a prose mention is not a route)", cmd: ["node", "scripts/check-doc-orphans.mjs", "--self-test"] },
  { name: "Index\u2194banner parity self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-index-banner-parity.mjs", "--self-test"] },
  { name: "Index\u2194banner parity (a bannered doc is not described alive in INDEX.md)", cmd: ["node", "scripts/check-index-banner-parity.mjs"] },
  // Re-registered 2026-08-31: the gate census found this invoked by NO lane
  // and NO workflow — it had silently drifted out after #213 hardened it.
  { name: "Postman collection tracks the /v1 spec (57 paths at registration)", cmd: ["node", "scripts/build-postman.mjs", "--check"] },
  // The #336 self-check tooling, wired in 2026-08-31 after ECC's first pass
  // found (and this lane fixed) four fail-closed inversions in it. Latent
  // standalone scripts are how check:postman rotted; these run here now.
  { name: "Gate census (every gate runs somewhere; self-test proves it can fail)", cmd: ["node", "scripts/check-gate-census.mjs"] },
  { name: "Gate census self-test", cmd: ["node", "scripts/check-gate-census.mjs", "--self-test"] },
  { name: "Failure-diagnosis registry audit (evidence paths still exist)", cmd: ["node", "scripts/classify-failure.mjs", "--audit"] },
  { name: "Gap scan (blocking findings fail; degraded scan is blocking)", cmd: ["node", "scripts/scan-gaps.mjs"] },
  { name: "Gap scan self-test", cmd: ["node", "scripts/scan-gaps.mjs", "--self-test"] },
  // PURPOSE.md makes the Decision Envelope the atomic product object; that only
  // holds if there is exactly one first-party name for it.
  { name: "Decision vocabulary (one name for the decision transaction)", cmd: ["node", "scripts/check-decision-vocabulary.mjs"] },
  // PURPOSE.md is canonical (DR-019); current-truth surfaces reference it rather
  // than paraphrase it. Historical records keep their terminology.
  { name: "Product framing (current-truth surfaces reference PURPOSE.md)", cmd: ["node", "scripts/check-product-framing.mjs"] },
  // Sibling of the docs↔proof figure guard, for the format that guard cannot read.
  // `docs/architecture.html` said "12 dimensions" against a 17-member union for as
  // long as nobody could date, because no gate in this repository read a docs HTML
  // figure at all.
  { name: "Docs-HTML figure guard self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-doc-html-figures.mjs", "--self-test"] },
  { name: "Docs-HTML figures (a rendered page may not contradict a derived figure)", cmd: ["node", "scripts/check-doc-html-figures.mjs"] },
  // Third sibling of the same family, for markdown figures the docs↔proof guard cannot
  // reach because no proof publishes them: the Bruno request count, the Postman
  // request/folder counts, the proof-script count. All three were repaired by hand on
  // 2026-09-02 — a repair fixes the number and leaves the drift mechanism intact.
  { name: "Derived-doc-figure self-test (a planted drift in each live document must fail)", cmd: ["node", "scripts/check-derived-doc-figures.mjs", "--self-test"] },
  { name: "Derived doc figures (a stated count equals the artifact it describes)", cmd: ["node", "scripts/check-derived-doc-figures.mjs"] },
  // Two documents stated the four tier branches as live after all four were pruned.
  // Offline by design: it compares prose to the tracked prune record, not to origin.
  { name: "Documented-branch self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-documented-branches.mjs", "--self-test"] },
  { name: "Documented branches (a doc may not state a pruned branch as existing)", cmd: ["node", "scripts/check-documented-branches.mjs"] },
  // Sibling of the gate above, one question further in: orphans ask whether a reader
  // can REACH a document, this asks whether the document points anywhere real. A
  // citation that resolves to nothing reads as evidence and is not.
  { name: "Cited paths (a doc may not cite a file that does not exist)", cmd: ["node", "scripts/check-cited-paths.mjs"] },
  { name: "Cited-path self-test (the gate can actually fail)", cmd: ["node", "scripts/check-cited-paths.mjs", "--self-test"] },
  { name: "Absence-check self-test (a word in a disclaimer is not the thing existing)", cmd: ["node", "scripts/agent/absence-check.mjs", "--self-test"] },
  { name: "Package reachability (a library nobody ships is a library nobody runs)", cmd: ["node", "scripts/check-package-reachability.mjs"] },
  { name: "Core normalization-version (the provenance stamp must track the code it names)", cmd: ["node", "scripts/generate-core-normalization-version.mjs", "--check"] },
  // Same shape as the stamp above, one document over. docs/CLAIM_INVENTORY.md is
  // DERIVED from docs/agent/CLAIM_INVENTORY.json and says so in its own preamble —
  // and until this line existed, nothing re-derived it: the generator was invoked by
  // no lane and no workflow, so the JSON could change and the published Markdown
  // would keep vouching for the old text. GATED on byte equality only; it says
  // nothing about whether a claim is true (that is check-launch-claims.mjs).
  { name: "Claim-inventory drift (the derived Markdown matches its JSON source)", cmd: ["node", "scripts/gen-claim-inventory-md.mjs", "--check"] },
  { name: "Claim-inventory self-test (the drift check can actually fail)", cmd: ["node", "scripts/gen-claim-inventory-md.mjs", "--self-test"] },
  { name: "Guard-registry drift (coverage lists derived, not trusted)", cmd: ["node", "scripts/check-guard-registries.mjs"] },
  { name: "CI\u2194preflight drift (every proof runs in both places)", cmd: ["node", "scripts/check-ci-preflight-sync.mjs"] },
  // Pure static analysis of the Dockerfiles against pnpm-workspace.yaml — no
  // daemon needed, which is the point: the web image was unbuildable for months
  // because no gate ever built it.
  { name: "Container native base (a Dockerfile that cannot build is not a deploy path)", cmd: ["node", "scripts/check-container-native-base.mjs"] },
  { name: "Publication boundary (nothing reaches a public repo unclassified)", cmd: ["node", "scripts/check-publication-boundary.mjs"] },
  { name: "API collection (a committed request must name a served route)", cmd: ["node", "scripts/check-api-collection.mjs"] },
  { name: "Deployment runbook (the documented path must be the real one)", cmd: ["node", "scripts/check-deployment-runbook.mjs"] },
  { name: "Assist wire self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-assist-wire-served.mjs", "--self-test"] },
  { name: "Assist wire served-ness (a bound wire is served or a declared gap)", cmd: ["node", "scripts/check-assist-wire-served.mjs"] },
  { name: "Decision palette self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-decision-palette.mjs", "--self-test"] },
  { name: "Verdict tone source (a verdict may not pick its own colour inline)", cmd: ["node", "scripts/check-verdict-tone-source.mjs"] },
  { name: "Verdict tone source self-test (the gate can actually fail)", cmd: ["node", "scripts/check-verdict-tone-source.mjs", "--self-test"] },
  { name: "Decision palette (one palette, every tree, AA everywhere)", cmd: ["node", "scripts/check-decision-palette.mjs"] },
  { name: "Reason codes self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-reason-codes.mjs", "--self-test"] },
  { name: "Reason codes (the engine's vocabulary is the catalog's and the contract's)", cmd: ["node", "scripts/check-reason-codes.mjs"] },
  { name: "Retention claims self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-retention-claims.mjs", "--self-test"] },
  { name: "Retention claims (no surface sells a duration nothing implements)", cmd: ["node", "scripts/check-retention-claims.mjs"] },
  { name: "iOS dynamic type self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-ios-dynamic-type.mjs", "--self-test"] },
  { name: "iOS dynamic type (no raw system font outside DesignSystem.swift)", cmd: ["node", "scripts/check-ios-dynamic-type.mjs"] },
  { name: "iOS dead stored properties self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-ios-dead-stored-properties.mjs", "--self-test"] },
  { name: "iOS dead stored properties (a field nothing assigns makes every read of it dead)", cmd: ["node", "scripts/check-ios-dead-stored-properties.mjs"] },
  { name: "iOS policy defaults self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-ios-policy-defaults.mjs", "--self-test"] },
  { name: "iOS policy defaults (no managed-config default derived from the absence of policy)", cmd: ["node", "scripts/check-ios-policy-defaults.mjs"] },
  { name: "Sim-script self-check self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-sim-scripts-selfcheck.mjs", "--self-test"] },
  { name: "Sim-script self-check (a queued Mac operation must name a script that runs)", cmd: ["node", "scripts/check-sim-scripts-selfcheck.mjs"] },
  { name: "iOS demo flags (every simulator flag the shell reads is documented, and vice versa)", cmd: ["node", "scripts/check-demo-flags-documented.mjs"] },
  { name: "Pagination-truncation guard (a capped read must not look complete)", cmd: ["node", "scripts/check-pagination-truncation.mjs"] },
  { name: "Absent-collection law (nothing observed ≠ nothing wrong)", cmd: ["pnpm", "run", "proof:absent-collection"] },
  // The doctrine-document proofs (zero-trust, security-operations-evidence,
  // kpi-kri-kci, municipal-resilience, itom-itsm-bridge, grid-lifecycle,
  // factory-flows, fabric-scenario) and the 47 deferred-family gates moved to
  // the BREADTH LANE on 2026-08-11 — `pnpm run verify:breadth`
  // (scripts/verify-breadth.mjs), a parallel required CI job on every PR. They
  // are kept and still gate every pull request; they no longer tax every local
  // per-push run. check-ci-preflight-sync.mjs holds the two lanes disjoint and
  // jointly complete. Run the breadth lane locally when touching a deferred
  // family or a doctrine document.
  // Completeness in both directions: every reason code a refusal can carry has an IT
  // layer and an owner, and nothing is classified that nothing emits. A new family or
  // a new rule fails this until a human classifies it — which is also one more
  // mechanical guard on the breadth freeze.
  { name: "Mutation sharding partitions the registry (the daily sweep loses no target)", cmd: ["node", "scripts/check-mutation-sharding.mjs"] },
  { name: "Backlog row citations name rows that exist", cmd: ["node", "scripts/check-row-citations.mjs"] },
  { name: "Row-citation gate self-test (it can actually fail)", cmd: ["node", "scripts/check-row-citations.mjs", "--self-test"] },
  { name: "IT-layer model (every refusal has an owner; nothing routes to a phantom)", cmd: ["node", "scripts/check-it-layer-model.mjs"] },
  { name: "IT-layer model self-test (the gate can actually fail)", cmd: ["node", "scripts/check-it-layer-model.mjs", "--self-test"] },
  { name: "Port parity (DecisionEngine + AppWorkflows vs their TS originals; SignalGridMobile's mock vs the core vocabulary)", cmd: ["node", "scripts/check-decision-port-parity.mjs"] },
  // Sibling of the gate above, one level down. That one keeps the Swift port faithful
  // to the TypeScript reference; this one keeps the two BUILD SYSTEMS that compile the
  // Swift port compiling the same files — the Xcode test target and the SwiftPM package
  // that gives it a macOS run. Both lists are hand-written, so both can drift, and the
  // drift is invisible: two green lanes covering different code.
  { name: "iOS port sources (Xcode and SwiftPM must compile the same port)", cmd: ["node", "scripts/check-ios-port-sources.mjs"] },
  // Three languages now implement the same fail-closed Assist rule (TypeScript,
  // Kotlin, Rust), each with its own tests — which is exactly how they diverge while
  // all three stay green. This checks every client is bound to ONE shared set of
  // cases. It found two real Kotlin defects the day it was written.
  { name: "Assist conformance (every client answers the shared cases the same way)", cmd: ["node", "scripts/check-assist-conformance.mjs"] },
  { name: "Read-error swallowing (a failed lookup must not report \"nothing found\")", cmd: ["node", "scripts/check-read-error-swallowing.mjs"] },
  // Every other gate here checks what the text MEANS. This one checks that the text
  // is what it appears to be: no bidirectional control or invisible character may
  // make a tracked file render differently from how it executes (CVE-2021-42574).
  { name: "Text safety (no file may render differently from how it executes)", cmd: ["node", "scripts/check-text-safety.mjs"] },
  // Sibling of the gate above. That one catches text engineered to deceive; this
  // one catches text nobody meant to ship — and a conflict marker reached the
  // default branch in Dockerfile.web, where it broke the web image outright.
  { name: "Merge markers (no unresolved conflict may be committed)", cmd: ["node", "scripts/check-merge-markers.mjs"] },
  { name: "Proof: mcp-server (the published plugin path boots and serves its declared tools)", cmd: ["pnpm", "run", "proof:mcp-server"] },
  { name: "Preflight↔CI parity (a gate that runs only locally is not a gate)", cmd: ["node", "scripts/check-preflight-ci-parity.mjs"] },
  { name: "Assessor package (every link, command and path in it resolves)", cmd: ["node", "scripts/check-assessor-package.mjs"] },
  { name: "OpenAPI validity (the published contract parses as OpenAPI; self-tested)", cmd: ["node", "scripts/check-openapi-valid.mjs"] },
  { name: "Launch claims (buyer-facing copy asserts nothing deferred as current; self-tested)", cmd: ["node", "scripts/check-launch-claims.mjs"] },
  { name: "Permission enforcement (no declared scope goes unrequired — DR-002; self-tested)", cmd: ["node", "scripts/check-permission-enforcement.mjs"] },
  { name: "Decision-record format (every call states how it gets undone; self-tested)", cmd: ["node", "scripts/check-decision-record-format.mjs"] },
  { name: "Test execution (a test no runner reaches is not coverage; self-tested)", cmd: ["node", "scripts/check-test-execution.mjs"] },
  { name: "Accuracy doctrine (DR-015 — unsourced citations, bare external statistics; self-tested)", cmd: ["node", "scripts/check-accuracy-doctrine.mjs"] },
  { name: "Agent roster (DR-016 — tier, charter, disjoint write boundary, vendor drift; self-tested)", cmd: ["node", "scripts/check-agent-roster.mjs"] },
  { name: "Positioning trace (every ratified claim resolves by id in the launch profile; self-tested)", cmd: ["node", "scripts/check-positioning-trace.mjs"] },
  { name: "Module init order (a const read before it is initialised; self-tested)", cmd: ["node", "scripts/check-module-init-order.mjs"] },
  { name: "NaN fail-open (an unparseable expiry must read as EXPIRED; self-tested)", cmd: ["node", "scripts/check-nan-fail-open.mjs"] },
  // Sibling of NaN fail-open: guards the BOUND, not the timestamp.
  { name: "Posed-bound self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-posed-bounds.mjs", "--self-test"] },
  { name: "Posed bounds (a caller-posed numeric bound is never read with ??)", cmd: ["node", "scripts/check-posed-bounds.mjs"] },
  // Third sibling: NaN fail-open guards the TIMESTAMP, posed-bounds guards the BOUND,
  // this one guards the RULE — that only one body decides whether a future sighting
  // is evidence of freshness, and that every copy that stays local says why.
  { name: "Freshness-divergence self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-freshness-divergence.mjs", "--self-test"] },
  { name: "Freshness divergence (one future/age rule, one body; exemptions REPORTED)", cmd: ["node", "scripts/check-freshness-divergence.mjs"] },
  { name: "CI liveness (a sweep that stops running must fail a build; self-tested)", cmd: ["node", "scripts/check-ci-liveness.mjs"] },
  { name: "CI job timeouts (an unbounded job is an unbounded outage; self-tested)", cmd: ["node", "scripts/check-ci-job-timeouts.mjs"] },
  { name: "Connector discipline (every family gated + proven, none acting on a device)", cmd: ["node", "scripts/check-connector-discipline.mjs"] },
  { name: "Launch profile (the declared product edge matches the real one)", cmd: ["node", "scripts/check-launch-profile.mjs"] },
  { name: "Ungated-fetch self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-ungated-fetch.mjs", "--self-test"] },
  { name: "Ungated fetch (a health check is still a live call)", cmd: ["node", "scripts/check-ungated-fetch.mjs"] },
  // Sibling of the two assertions inside that gate. Ungated-fetch asks whether the call was
  // allowed and whether it is bounded; this asks whether it went out SIGNED. `if (secret)
  // { sign }` skipped the signature on an absent secret and reported 'sent' — a guard with
  // its sense inverted, failing open on the exact input it exists for.
  { name: "Signing-unconditional self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-signing-unconditional.mjs", "--self-test"] },
  { name: "Signing unconditional (a missing secret refuses; it never sends unsigned)", cmd: ["node", "scripts/check-signing-unconditional.mjs"] },
  // Third question at the same boundary. Ungated-fetch asks whether the call was
  // ALLOWED; signing-unconditional asks whether it went out SIGNED; this asks WHAT
  // WAS IN IT. The emit gate's own header says it "decides WHETHER anything may
  // leave, not what it looks like" — so `JSON.stringify(event)` sent an entire
  // inbound request to a customer-configured URL inside a boundary three documents
  // describe as closed, and nothing was watching.
  { name: "Emit-payload-discipline self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-emit-payload-discipline.mjs", "--self-test"] },
  { name: "Emit payload discipline (every field crossing to a vendor is named; open slots declared)", cmd: ["node", "scripts/check-emit-payload-discipline.mjs"] },
  // FOURTH question at the same boundary. Ungated-fetch asks whether the call was
  // ALLOWED and whether it is BOUNDED; signing-unconditional whether it went out
  // SIGNED; emit-payload-discipline WHAT WAS IN IT. This one asks about the WIRE:
  // where the packet actually goes (a 307 re-routed a signed body to an unvalidated
  // origin, and two families POSTed to config.url with no SSRF guard at all), what
  // signature scheme it carries (two existed, one of them the replayable v1 this
  // repo's own verifier refuses by name), and what we believe from the answer (a
  // `.json() as { access_token: string }` cast produced `Bearer undefined`).
  { name: "Emitter-wire-discipline self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-emitter-wire-discipline.mjs", "--self-test"] },
  { name: "Emitter wire discipline (validated target, one signature scheme, checked vendor values)", cmd: ["node", "scripts/check-emitter-wire-discipline.mjs"] },
  // Sibling of the ungated-fetch gate. That one asks whether a call was allowed to happen;
  // this one asks whether the RESULT reported was one anybody observed. Twelve connectors
  // returned `status: 200` after awaiting an injected transport that resolves a payload —
  // there was no response, so there was no status.
  { name: "Fabricated status (a connector may not report a status it never observed)", cmd: ["node", "scripts/check-fabricated-status.mjs"] },
  { name: "Fabricated status self-test (the gate can actually fail)", cmd: ["node", "scripts/check-fabricated-status.mjs", "--self-test"] },
  // A core proof can show authorizedContext refuses the wrong role; only this shows the
  // ROUTES still call it. Without it a handler could regress to context() and stay green.
  { name: "Durable-path authorization (a durable read must authorize, not just authenticate)", cmd: ["node", "scripts/check-durable-path-authorization.mjs"] },
  // SIX offline proofs ran in NO pull-request gate — not here, not in any workflow
  // except mac-lane.yml, which fires weekly and on dispatch, never on a PR. Each is
  // self-described as pure and offline, so there was no reason for it beyond nobody
  // wiring them up. proof:isolation-scope is the one that stings: it asserts no tenant
  // can read another tenant's row, across every scoped reader, and a break in that
  // would have passed preflight and every PR check.
  { name: "Proof: isolation-scope (no tenant can read another's row)", cmd: ["pnpm", "run", "proof:isolation-scope"] },
  { name: "Proof: graph-wire (throttling, 5xx, auth and malformed bodies fail closed)", cmd: ["pnpm", "run", "proof:graph-wire"] },
  { name: "Figure-guard self-test (the baseline-age report must be able to fail)", cmd: ["node", "scripts/check-proof-figures.mjs", "--self-test"] },
  { name: "Docs\u2194proof FIGURE guard (a measured number must still be one)", cmd: ["node", "scripts/check-proof-figures.mjs"] },
  { name: "Proof-count sync (documented check counts match their proofs)", cmd: ["node", "scripts/check-proof-counts.mjs"] },
  { name: "Live-sync manifest (external builders see current contracts)", cmd: ["node", "scripts/check-live-sync.mjs"] },
  { name: "MCP surface (chat connection must match the fabric)", cmd: ["node", "scripts/check-mcp-surface.mjs"] },
  { name: "Typecheck (all packages)", cmd: ["pnpm", "run", "typecheck"] },
  // needsNativeBuild: rollup/esbuild/lightningcss/oxide platform binaries. The
  // workspace strips every triple but linux-x64, so on other platforms this step
  // is structurally absent rather than failing — see scripts/lib/platform-native-build.mjs.
  { name: "Build (all packages)", cmd: ["pnpm", "run", "build"], heavy: true, needsNativeBuild: true, env: { PORT: "3000", BASE_PATH: "/" } },
  { name: "Proof: intune-entra-posture", cmd: ["pnpm", "run", "proof:intune-entra-posture"] },
  { name: "Proof: signalgrid-core", cmd: ["pnpm", "run", "proof:signalgrid-core"] },
  { name: "Proof: live-idp (real OIDC provider, real DPoP)", cmd: ["pnpm", "run", "proof:live-idp"] },
  // Drives the built bundles, so it inherits the same platform constraint.
  { name: "Browser E2E (review console, website, admin)", cmd: ["pnpm", "run", "test:e2e"], heavy: true, needsNativeBuild: true },
  { name: "Proof: signalgrid-simulator", cmd: ["pnpm", "run", "proof:signalgrid-simulator"] },
  { name: "Proof: signalgrid-grid", cmd: ["pnpm", "run", "proof:signalgrid-grid"] },
  { name: "Proof: microsoft-graph-sandbox", cmd: ["pnpm", "run", "proof:microsoft-graph-sandbox"] },
  { name: "Proof: graph-connector (read-only, gated)", cmd: ["pnpm", "run", "proof:graph-connector"] },
  { name: "Proof: event-contract (validation + cross-domain detections)", cmd: ["pnpm", "run", "proof:event-contract"] },
  { name: "Proof: local-authority (may this device act on its own authority now)", cmd: ["pnpm", "run", "proof:local-authority"] },
  { name: "Proof: launch-profile (the declared Limited GA scope is coherent and its figures are published)", cmd: ["pnpm", "run", "proof:launch-profile"] },
  { name: "Proof: launch-seam (fixture connector → bridge → core decision → evidence, all 3 launch families, offline)", cmd: ["pnpm", "run", "proof:launch-seam"] },
  { name: "Proof: evidence-adapter (source-agnostic — swap fleet/headwind/intune, the decision must not change)", cmd: ["pnpm", "run", "proof:evidence-adapter"] },
  { name: "Proof: mobile-app-catalog (hardened scanner — leak/symlink/determinism/cap; needs python3, FAILS without it)", cmd: ["pnpm", "run", "proof:mobile-app-catalog"] },
  { name: "Proof: sim-requests (the cloud↔Mac loop — a request cannot carry a command, an unrun run is never green)", cmd: ["pnpm", "run", "proof:sim-requests"] },
  { name: "/v1 under concurrency (correctness gated; throughput and saturation reported, never asserted)", cmd: ["pnpm", "run", "test:load"], heavy: true },
  { name: "Simulation request loop (every result binds to a request; pending is reported, never silent)", cmd: ["node", "scripts/check-sim-requests.mjs"] },
  { name: "Simulation request loop self-test (the gate can actually fail)", cmd: ["node", "scripts/check-sim-requests.mjs", "--self-test"] },
  { name: "Known-false claims (a claim proven false once is not made twice)", cmd: ["node", "scripts/check-known-false-claims.mjs"] },
  { name: "Known-false-claim self-test (the gate can actually fail)", cmd: ["node", "scripts/check-known-false-claims.mjs", "--self-test"] },
  { name: "Memory freshness (an aging 'as of' claim is named; stale is reported, registry rot is fatal)", cmd: ["node", "scripts/check-memory-freshness.mjs"] },
  { name: "Memory freshness self-test (the gate can actually fail)", cmd: ["node", "scripts/check-memory-freshness.mjs", "--self-test"] },
  { name: "Action pinning (a third-party action on a mutable tag is somebody else's write access to CI)", cmd: ["node", "scripts/check-action-pinning.mjs"] },
  { name: "Action pinning self-test (the gate can actually fail)", cmd: ["node", "scripts/check-action-pinning.mjs", "--self-test"] },
  { name: "Scheduled routines self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-scheduled-routines.mjs", "--self-test"] },
  { name: "Scheduled routines (every always-on lane declared, authorized, scoped, evidenced)", cmd: ["node", "scripts/check-scheduled-routines.mjs"] },
  { name: "Lab registry self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-lab-registry.mjs", "--self-test"] },
  { name: "Lab registry (both halves agree; every deployment claim cites evidence on disk)", cmd: ["node", "scripts/check-lab-registry.mjs"] },
  { name: "Evidence sources self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-evidence-sources.mjs", "--self-test"] },
  { name: "Evidence sources (the contract's vocabulary matches what exists)", cmd: ["node", "scripts/check-evidence-sources.mjs"] },
  { name: "Org roster (a role nobody has ever run is named on every run)", cmd: ["node", "scripts/check-org-roster.mjs"] },
  { name: "Org roster self-test (the gate can actually fail)", cmd: ["node", "scripts/check-org-roster.mjs", "--self-test"] },
  { name: "Backlog ownership (a row with work left in it names the role that owns it)", cmd: ["node", "scripts/check-backlog-ownership.mjs"] },
  { name: "Backlog ownership self-test (the gate can actually fail)", cmd: ["node", "scripts/check-backlog-ownership.mjs", "--self-test"] },
  { name: "Backlog evidence (a row that says DONE says how you'd check)", cmd: ["node", "scripts/check-backlog-evidence.mjs"] },
  { name: "Backlog evidence self-test (the gate can actually fail)", cmd: ["node", "scripts/check-backlog-evidence.mjs", "--self-test"] },
  { name: "Surface-ownership self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-surface-ownership.mjs", "--self-test"] },
  { name: "Surface ownership (every file is somebody's)", cmd: ["node", "scripts/check-surface-ownership.mjs"] },
  { name: "Role coverage (has each role read the portion it owns; ratcheted)", cmd: ["node", "scripts/check-role-coverage.mjs"] },
  { name: "Role-coverage self-test (the gate can actually fail)", cmd: ["node", "scripts/check-role-coverage.mjs", "--self-test"] },
  { name: "Owner-gated surfaces manifest (the autonomous-merge escalation line is non-empty and well-formed)", cmd: ["node", "scripts/check-owner-gated-surfaces.mjs"] },
  { name: "Owner-gated surfaces self-test (classify routes safety-machinery + owner-reserved diffs to the owner)", cmd: ["node", "scripts/check-owner-gated-surfaces.mjs", "--self-test"] },
  { name: "Build-agent merge ledger (every autonomous merge was built and reviewed by different sessions)", cmd: ["node", "scripts/check-build-agent-merges.mjs"] },
  { name: "Build-agent merge-ledger self-test (builder==reviewer or wrong trigger fails)", cmd: ["node", "scripts/check-build-agent-merges.mjs", "--self-test"] },
  { name: "Cited commands (a command a document promises must still exist)", cmd: ["node", "scripts/check-cited-commands.mjs"] },
  { name: "Cited-command self-test (the gate can actually fail)", cmd: ["node", "scripts/check-cited-commands.mjs", "--self-test"] },
  { name: "Review coverage (a green gate suite is not a reviewed codebase)", cmd: ["node", "scripts/check-review-coverage.mjs"] },
  { name: "Review-coverage self-test (the gate can actually fail)", cmd: ["node", "scripts/check-review-coverage.mjs", "--self-test"] },
  { name: "Proof: lane-messages (the cloud↔Mac channel — identity is derived, and no lane acknowledges its own mail)", cmd: ["pnpm", "run", "proof:lane-messages"] },
  { name: "Lane messages (unread mail is named on every run; only the addressee can close one)", cmd: ["node", "scripts/check-lane-messages.mjs"] },
  { name: "Lane message self-test (the gate can actually fail)", cmd: ["node", "scripts/check-lane-messages.mjs", "--self-test"] },
  { name: "Proof: operating-method (the handbook is a gate — buckets, ladder, dispositions, links, roles)", cmd: ["pnpm", "run", "proof:operating-method"] },
  { name: "Proof: evidence-coverage (what can this estate actually answer)", cmd: ["pnpm", "run", "proof:evidence-coverage"] },
  { name: "Proof: device-resolver (read-only at the injection boundary)", cmd: ["pnpm", "run", "proof:device-resolver"] },
  { name: "Proof: config-scope (connector config keyed per tenant, never normalized)", cmd: ["pnpm", "run", "proof:config-scope"] },
  { name: "Proof: unsafe-claim (a disclaimer is not a claim)", cmd: ["pnpm", "run", "proof:unsafe-claim"] },
  { name: "Proof: macos-apple-schema (apple/device-management alignment)", cmd: ["pnpm", "run", "proof:macos-apple-schema"] },
  { name: "Proof: mcp-answer-discipline (silence is not an affirmative, over the raw wire)", cmd: ["pnpm", "run", "proof:mcp-answer-discipline"] },
  { name: "Proof: mdm-profile (the shipped profiles say what the product claims)", cmd: ["pnpm", "run", "proof:mdm-profile"] },
  { name: "Proof: facility-trust-graph (canonical space model + location certainty vs required precision)", cmd: ["pnpm", "run", "proof:facility-trust-graph"] },
  { name: "Proof: device-management-health (management-plane health / config drift, gated)", cmd: ["pnpm", "run", "proof:device-management-health"] },
  { name: "Proof: work-context (continuity carries work, trust re-earned per device)", cmd: ["pnpm", "run", "proof:work-context"] },
  { name: "Proof: handoff-sim (cross-device handoff + exception-release loop)", cmd: ["pnpm", "run", "proof:handoff-sim"] },
  { name: "Proof: adaptive-proposals (governed recommendation lifecycle, human-gated activation)", cmd: ["pnpm", "run", "proof:adaptive-proposals"] },
  { name: "Proof: self-audit (self-aware, self-healing checklist; fail-closed; no self-heal)", cmd: ["pnpm", "run", "proof:self-audit"] },
  { name: "Proof: reliability (SLO/error-budget; fail-closed integrity has no budget)", cmd: ["pnpm", "run", "proof:reliability"] },
  { name: "Proof: iac (trust-gated GitOps; plan/approve/apply; a rollout cannot apply itself)", cmd: ["pnpm", "run", "proof:iac"] },
  { name: "Proof: verdict-attestation (a forged verdict is degraded, not just flagged)", cmd: ["pnpm", "run", "proof:verdict-attestation"] },
  { name: "Proof: pim-activation (Entra PIM custom-extension decision surface)", cmd: ["pnpm", "run", "proof:pim-activation"] },
  { name: "Proof: dual-control (two-person integrity; a grant needs two distinct, co-present, verified authorizers)", cmd: ["pnpm", "run", "proof:dual-control"] },
  { name: "Proof: grant-safety (shared allow-path brute-force harness self-test)", cmd: ["pnpm", "run", "proof:grant-safety"] },
  { name: "Proof: posture-composition (unified signal fusion)", cmd: ["pnpm", "run", "proof:posture-composition"] },
  { name: "Proof: incident-playbook (decision → prioritized incident)", cmd: ["pnpm", "run", "proof:incident-playbook"] },
  { name: "Proof: fabric-evals (golden multi-signal decision quality)", cmd: ["pnpm", "run", "proof:fabric-evals"] },
  { name: "Proof: connector-emulator", cmd: ["pnpm", "run", "proof:connector-emulator"] },
  { name: "OpenAPI contract check (proof:api-contract)", cmd: ["pnpm", "run", "proof:api-contract"] },
  { name: "API integration test (boots the server)", cmd: ["pnpm", "run", "test:api"] },
  { name: "OIDC middleware test (the PRODUCTION auth branch actually executes)", cmd: ["pnpm", "run", "test:oidc"] },
  { name: "Bruno collection live run (the committed contract, executed both profiles)", cmd: ["node", "scripts/run-bruno-collection.mjs"] },
  { name: "Proof: observability (metrics endpoint)", cmd: ["pnpm", "run", "proof:observability"] },
  { name: "Proof: enterprise-auth (OIDC/JWT)", cmd: ["pnpm", "run", "proof:enterprise-auth"] },
  { name: "Proof: webauthn-verify", cmd: ["pnpm", "run", "proof:webauthn-verify"] },
  // Absorbed from the base lane. It SELF-SKIPS when DATABASE_URL is unset, which is
  // exactly why it belongs here rather than on the CI-only exempt list: preflight
  // stays deterministic and needs no Postgres, and an operator who HAS a database
  // gets the restore path exercised locally.
  { name: "Proof: backup-restore (the restore path, exercised not assumed)", cmd: ["pnpm", "run", "proof:backup-restore"] },
  // Same self-skip discipline: without DATABASE_URL it skips deterministically;
  // with one, the role split is proven locally in both directions.
  { name: "Proof: db-role-split (the ledger append-only by privilege)", cmd: ["pnpm", "run", "proof:db-role-split"] },
  { name: "Proof: audit-ledger", cmd: ["pnpm", "run", "proof:audit-ledger"] },
  { name: "Proof: itsm-credential-crypto (a weak key is refused, not stretched)", cmd: ["pnpm", "run", "proof:itsm-credential-crypto"] },
  { name: "Proof: telemetry-posture-cache (stale posture is never served as current)", cmd: ["pnpm", "run", "proof:telemetry-posture-cache"] },
  { name: "Proof: itsm-template (evidence text cannot rewrite itself on the way into a ticket)", cmd: ["pnpm", "run", "proof:itsm-template"] },
  { name: "Proof: session-store", cmd: ["pnpm", "run", "proof:session-store"] },
  { name: "Proof: orchestration", cmd: ["pnpm", "run", "proof:orchestration"] },
  { name: "Proof: room-sim", cmd: ["pnpm", "run", "proof:room-sim"] },
  { name: "Proof: app-workflows", cmd: ["pnpm", "run", "proof:app-workflows"] },
  { name: "Proof: app-workflow-templates", cmd: ["pnpm", "run", "proof:app-workflow-templates"] },
  { name: "Proof: flows", cmd: ["pnpm", "run", "proof:flows"] },
  { name: "Proof: grid-coverage (build the grid — the coverage ceiling and its basis)", cmd: ["pnpm", "run", "proof:grid-coverage"] },
  { name: "Proof: grid-config (workflows as code — CI validation)", cmd: ["pnpm", "run", "proof:grid-config"] },
  { name: "Proof: app-resilience (cloud-app downtime, PHI-safe fallback)", cmd: ["pnpm", "run", "proof:app-resilience"] },
  { name: "Proof: provisioning (zero-touch setup — record/validate/apply)", cmd: ["pnpm", "run", "proof:provisioning"] },
  { name: "Proof: provisioning-order (step order — the numbering is load-bearing)", cmd: ["pnpm", "run", "proof:provisioning-order"] },
  { name: "Proof: provisioning-teardown (prove the retreat before deploy)", cmd: ["pnpm", "run", "proof:provisioning-teardown"] },
  { name: "Proof: recommendations", cmd: ["pnpm", "run", "proof:recommendations"] },
  { name: "Proof: signal-discovery", cmd: ["pnpm", "run", "proof:signal-discovery"] },
  { name: "Proof: ddm-connector", cmd: ["pnpm", "run", "proof:ddm-connector"] },
  { name: "Proof: fleet-connector", cmd: ["pnpm", "run", "proof:fleet-connector"] },
  { name: "Proof: signal-radar", cmd: ["pnpm", "run", "proof:signal-radar"] },
  { name: "Proof: control-plane", cmd: ["pnpm", "run", "proof:control-plane"] },
  { name: "Proof: edge-sync", cmd: ["pnpm", "run", "proof:edge-sync"] },
  { name: "Proof: decision-continuity (which decision wins across a partition)", cmd: ["pnpm", "run", "proof:decision-continuity"] },
  { name: "Safety gate (guardrails)", cmd: ["pnpm", "run", "safety:check"] },
  // Mirrors the CI "Postman collection is committed in sync" step: regenerate,
  // then fail if the committed collection drifted.
  // `git ls-files --error-unmatch` FIRST. `git diff --exit-code <path>` reports nothing at
  // all for an UNTRACKED path, so on its own this gate passes whether the file is correct,
  // corrupt, forgotten at `git add`, deleted, or gitignored. Demonstrated, not theorised: a
  // review replaced a generated file's entire contents with garbage and the diff-only form
  // exited 0.
  { name: "Postman collection committed in sync", cmd: ["bash", "-c", "git ls-files --error-unmatch docs/postman >/dev/null && pnpm run build:postman && git diff --exit-code docs/postman"] },
  // Mirrors the CI "Evidence Coverage page is committed in sync" step. The page is a
  // GENERATED artifact with the real coverage model bundled into it, and its browser
  // E2E loads the COMMITTED file — so a stale commit would be tested instead of the
  // current model, and would keep passing for every model change that did not happen to
  // move one of the pinned figures. esbuild's output is byte-stable for a given input,
  // which is what makes the diff a usable gate rather than a flake.
  { name: "Evidence Coverage page committed in sync", cmd: ["bash", "-c", "git ls-files --error-unmatch docs/evidence-coverage.html >/dev/null && pnpm run build:evidence-coverage && git diff --exit-code -- docs/evidence-coverage.html"] },
  // NOT a regenerate-and-diff gate, unlike the three above, and the difference is
  // load-bearing: docs/STATUS.md embeds the HEAD sha by design (its own staleness
  // tell), so the commit that adds it changes HEAD and it can never equal its own
  // regeneration. Its generator is also slow and hits the network. So gate the part
  // that actually rots — the inventory counts, which are cheap and offline. They had
  // drifted to 95 proof gates against a real 122, 8 E2E specs against 10, and 12 CI
  // workflows against 16.
  { name: "STATUS.md figures still describe the repo", cmd: ["node", "scripts/check-status-figures.mjs"] },
  { name: "STATUS.md figure gate self-test (the gate can actually fail)", cmd: ["node", "scripts/check-status-figures.mjs", "--self-test"] },
  { name: "Decision-latency pilot gate (bench)", cmd: ["pnpm", "run", "bench:decision-latency"] },
  // The saturation companion. Its ops/sec figures are hardware-specific and
  // report-only — what it can fail on any machine is a throughput floor derived
  // from the latency gate above, a collapse when cores are added, and a verdict
  // that changes with thread count. Two-second windows keep it ~5s serial.
  {
    name: "Decision-throughput saturation gate (bench)",
    cmd: ["pnpm", "run", "bench:decision-throughput", "--", "--seconds=2"],
  },
  // Mirrors the supply-chain job's "SBOM is committed and up to date" gate:
  // regenerate the CycloneDX SBOM and fail if it drifted (e.g. a new dependency
  // was added but the committed SBOM wasn't regenerated).
  { name: "CycloneDX SBOM committed in sync", cmd: ["bash", "-c", "pnpm run sbom && git diff --exit-code -- artifacts/sbom/cyclonedx.json"] },
  { name: "Licence policy self-test (the gate must be able to fail)", cmd: ["node", "scripts/check-licence-policy.mjs", "--self-test"] },
  { name: "Licence policy (every component's licence resolves to a declared class)", cmd: ["node", "scripts/check-licence-policy.mjs"] },
];

// Is the native web build structurally impossible here? Derived from the committed
// pnpm-workspace.yaml plus whether the binaries actually resolve — never from a
// flag, so nobody can buy a skip by asking for one. On linux-x64 (CI) the binaries
// are present by design and this is always false, leaving the build mandatory.
const nativeExclusion = nativeBuildExclusion(repo);
if (nativeExclusion.excluded) {
  console.log(`ℹ native web build unavailable on ${nativeExclusion.target} — ${nativeExclusion.reason}\n`);
}

const results = [];
let failed = null;
for (const step of STEPS) {
  if (quick && step.heavy) { results.push({ name: step.name, status: "skipped" }); continue; }
  if (step.needsNativeBuild && nativeExclusion.excluded) {
    // NOT a pass. Recorded as absent, with the reason, and surfaced in the summary
    // and the final verdict so a reader is never told more than actually ran.
    results.push({ name: step.name, status: "unavailable" });
    console.log(`▶ ${step.name} … unavailable on this platform`);
    continue;
  }
  process.stdout.write(`▶ ${step.name} … `);
  const [bin, ...args] = step.cmd;
  const r = spawnSync(bin, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...(step.env ?? {}) },
  });
  if (r.status === 0) {
    console.log("ok");
    results.push({ name: step.name, status: "ok" });
  } else {
    console.log("FAILED");
    // Surface the tail of the failing output so the cause is visible inline.
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n").slice(-25).join("\n");
    console.error(`\n─── ${step.name} output (tail) ───\n${out}\n`);
    failed = step.name;
    break;
  }
}

console.log("\n── preflight summary ──");
for (const r of results) {
  const mark = r.status === "ok" ? "✓" : "–";
  const note =
    r.status === "skipped" ? " (skipped)"
    : r.status === "unavailable" ? " (UNAVAILABLE on this platform — not run, not passed)"
    : "";
  console.log(`  ${mark} ${r.name}${note}`);
}

if (failed) {
  console.error(`\nPreflight FAILED at: ${failed}. Fix before pushing.`);
  process.exit(1);
}
// "Safe to push" was an overstatement, and it was believed. This harness mirrors
// THREE of the six CI jobs; the other three need external services it cannot start.
// Twice now a green preflight was read as proof and the push went red anyway — once
// on a lockfile CI could not install, once on a Docker image build. Both times the
// header already said this. A caveat nobody reads at the moment of decision is not a
// caveat, so it now prints WITH the verdict rather than being documented above it.
//
// Same rule the status file follows: never claim more than the run verified.
// DERIVED from .github/workflows/, not hand-listed. It used to be three strings while
// the repo ran nineteen CI jobs, so CodeQL, the level-10 audit, the emulator smoke,
// phase-pr-evidence and the whole iOS suite were missing from the one list whose job is
// to say what is missing. See scripts/lib/ci-jobs.mjs.
const UNCOVERED = uncoveredLines();
// Kept from the base lane and complementary to the line above: a step the platform
// could not run is UNAVAILABLE, never passed. Two different honesty problems — what CI
// covers that preflight does not, and what preflight could not execute here.
const unavailable = results.filter((r) => r.status === "unavailable");
console.log(`\nPreflight PASSED${quick ? " (quick — heavy builds skipped)" : ""} — everything it runs is green.`);
if (unavailable.length > 0) {
  // Stated WITH the verdict, not below it. "Everything it runs is green" is true
  // and also incomplete; a reader deciding whether to trust this run needs to know
  // which steps never ran, and that this platform CANNOT run them.
  console.log(`\n  ${unavailable.length} step(s) did NOT run — unavailable on ${nativeExclusion.target}, not passed:`);
  for (const r of unavailable) console.log(`    · ${r.name}`);
  console.log(`    reason: ${nativeExclusion.reason}`);
  console.log("    These still run in CI on linux-x64, where the binaries exist. A green here");
  console.log("    is NOT evidence the web bundle builds.");
}
console.log("\n  NOT covered by this harness (CI runs these; a green preflight says nothing about them):");
for (const j of UNCOVERED) console.log(`    · ${j}`);
if (quick) console.log("    · the full monorepo build + browser E2E (--quick skipped them; drop --quick to include)");
console.log("\n  Changed a Dockerfile, a lifecycle script, or dependencies? Build the image before");
console.log("  pushing — `docker compose -f docker-compose.prod.yml up -d --build` — because");
console.log("  nothing above does.");

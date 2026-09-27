// check-owner-gated-surfaces.mjs — the mechanical line between what the autonomous
// merge loop MAY land and what it must hand to the owner. This is L4 of the
// steward's merge decision (see docs/DEFINITION_OF_DONE.md and DR-019): a diff that
// touches an owner-gated surface is escalated regardless of how correct the code is
// or how the backlog row was phrased.
//
//   node scripts/check-owner-gated-surfaces.mjs            # validate the manifest
//   node scripts/check-owner-gated-surfaces.mjs --self-test # prove classify() works
//   node scripts/check-owner-gated-surfaces.mjs --classify-branch <base-ref>
//     # print `KLASS <klass> files=<n> matched=<m>` for this branch's diff against
//     # the merge-base of <base-ref> and HEAD — the single line
//     # scripts/lib/land-branch-gate.mjs's resolveKlass() parses so the saved
//     # land-branch workflow derives its owner-decision class from the DIFF instead
//     # of trusting a caller-supplied klass string (Codex summary finding 7 on
//     # #1126/#1127, docs/BUILD_BACKLOG.md). Exit 0 with the KLASS line on a clean
//     # classification; exit 2 with `KLASS ERROR <reason>` on a git failure or an
//     # empty diff — an empty diff is not "other", it is unknown, and unknown fails
//     # closed. mostRestrictive() picks the single most restrictive category present,
//     # in order OWNER_RESERVED > DECISION_PATH > SAFETY_MACHINERY > other. `matched`
//     # counts RULE HITS, not files — one path can match more than one rule (e.g.
//     # scripts/mutation-guard.mjs matches both the blanket scripts/** rule and the
//     # gate/guard-registries rule), so matched can exceed files.
//
// WHY MECHANICAL, NOT REVIEWER JUDGMENT. An adversarial verification of the
// autonomous-merge design found two ways owner-gated work slips through if the
// escalate rule is prose bound to nobody: (1) a diff that quietly weakens a gate
// stays green because the full mutation sweep is post-merge, and "classify as
// GREEN" is itself a judgment call a reviewer can get wrong; (2) an owner-reserved
// edit (LICENSE, pricing, launch scope) that is correctly implemented passes every
// review layer. So the routing is a path+pattern manifest checked in code, copying
// the shape of check-launch-claims.mjs, not a sentence the steward is trusted to
// apply.
//
// THREE CATEGORIES, all owner-gated, kept distinct for the escalation message:
//   DECISION_PATH — golden rule 2's core: the deterministic verdict logic and its
//     connectors/flows (lib/*), the /v1 decision API, and the byte-faithful native
//     ports (golden rule 1). A model-judged auto-merge may NEVER land a change to how
//     SignalGrid DECIDES, regardless of how green the gauntlet is — this is the line
//     the auto-merge switch exists to protect. lib/* IS the decision core, so the
//     rule is blanket and fail-closed.
//   SAFETY_MACHINERY — the gates/CI/proofs themselves. "Green" proves nothing about
//     a weakened gate (the sweep that would catch it runs post-merge), so a robot
//     can never merge a change to its own safety net. This is the confirmed-unsafe
//     class; it stays with the owner until per-PR falsification of every gate exists.
//   OWNER_RESERVED — legal, pricing, launch scope, decision records, buyer-facing
//     copy. Correct code is not the question; these are the owner's to commit.

import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A changed path matching ANY of these is SAFETY_MACHINERY. Green never suffices.
export const SAFETY_MACHINERY = [
  { rule: "scripts/**", re: /^scripts\// },
  { rule: ".github/(workflows|codeql|actions)/**", re: /^\.github\/(workflows|codeql|actions)\// },
  { rule: "secret-scan config", re: /^\.gitleaks(\.toml|ignore)$/ },
  { rule: "any proof harness", re: /(^|\/)[\w.-]*proof[\w.-]*\.(ts|mjs|js)$/i },
  { rule: "any fixtures dir", re: /(^|\/)fixtures?\// },
  { rule: "the gate/guard registries", re: /^scripts\/(mutation-guard|check-guard-registries|check-mutation-sharding)\.mjs$/ },
  { rule: "workspace/lockfile", re: /^(pnpm-workspace\.yaml|pnpm-lock\.yaml)$/ },
  // Review sweep on #1133 (2026-09-26), finding 1 (blocking): the root-only rule below
  // used to be exact-path (`^package\.json$`), leaving every OTHER package.json in the
  // tree classifying "other" even though its scripts ARE the commands the gates run —
  // scripts/preflight.mjs:604 runs `pnpm --filter @workspace/mcp-server run test`
  // (resolved from that package's own "test" script), and :474's `pnpm run typecheck`
  // is `pnpm -r --filter "./artifacts/**" ... --if-present run typecheck` — `--if-present`
  // means deleting the `typecheck` script from artifacts/signalgrid-app,
  // signalgrid-desktop or signalgrid-mobile-pwa's package.json silently drops that
  // package from the gate rather than failing it. A dependency change already escalates
  // through pnpm-lock.yaml above, so widening this to every manifest costs little.
  { rule: "any package manifest (its scripts are the gate commands preflight/typecheck run)", re: /(^|\/)package\.json$/ },
  // TypeScript config defines the typecheck gate's own project set and strictness:
  // tsconfig.json lists the project references `tsc --build` checks (e.g.
  // ./lib/signalgrid-core), and tsconfig.base.json sets strictNullChecks and the other
  // strict flags — removing a reference or loosening a flag weakens
  // "Typecheck (all packages)" in preflight and CI without touching any gate script.
  { rule: "TypeScript config (the typecheck gate's project set and strictness)", re: /(^|\/)tsconfig[\w.-]*\.json$/ },
  { rule: "the decision records", re: /^docs\/DECISION_RECORDS\.md$/ },
  { rule: "the brain-cycle veto config (its own safety net)", re: /^docs\/agent\/brain-cycle-config\.json$/ },
  // DR-056: the declared objective — its criteria and the owner attestation pointer
  // (attestedIn). The token and criterion ids live in scripts/objective-loop.mjs, so the
  // json alone cannot reach goal_met; this is the second belt — a moved pointer is reviewed
  // as safety machinery, never as a doc.
  { rule: "the declared objective (DR-056 attestation pointer)", re: /^docs\/agent\/objective\.json$/ },
  // Finding 4 (Codex #1133 P1, 2026-09-26): a change touching ONLY .claude/workflows/
  // used to classify 'other' — the landing workflow itself (this file's own mirror of
  // canPush/resolveKlass/ownerDecisionText, the Chain/PR stages, the push worker's
  // one-liner) is exactly the kind of safety net a model-judged auto-merge must never
  // wave through on green alone. `.claude/hooks/` and `.claude/settings.json` are the
  // Bash deny-list hook and the deny list itself (CLAUDE.md "Never bypass a check"):
  // both are the same class of self-net as scripts/** already is.
  { rule: "the landing workflow (.claude/workflows/**)", re: /^\.claude\/workflows\// },
  { rule: "the Bash deny-list hook (.claude/hooks/**)", re: /^\.claude\/hooks\// },
  { rule: "the deny list itself (.claude/settings.json)", re: /^\.claude\/settings\.json$/ },
  // Review nit on #1133 (2026-09-26): these three surfaces govern HOW the lane lands
  // and what the pre-push hook enforces — the same class of self-net as
  // .claude/workflows/** and .claude/hooks/** above, not ordinary skill/tooling
  // content. landing-under-dr-037 is the skill that decides whether the cloud lane
  // may merge its own green PR; orchestrator-over-workers is the skill that governs
  // how the coordinator delegates to and trusts worker output (including this very
  // land-branch chain); .githooks/ is where pre-push (CLAUDE.md's lockfile-drift
  // enforcement, "a pre-push hook now enforces this") lives — a change to any of the
  // three can quietly loosen what the lane is allowed to do to itself, so none of
  // them may land on green alone. Other skill directories stay autonomous by design
  // (see the negative self-test below) — this is not "all of .claude/skills/".
  { rule: "the landing-under-dr-037 skill (.claude/skills/landing-under-dr-037/**)", re: /^\.claude\/skills\/landing-under-dr-037\// },
  { rule: "the orchestrator-over-workers skill (.claude/skills/orchestrator-over-workers/**)", re: /^\.claude\/skills\/orchestrator-over-workers\// },
  { rule: "the git hooks (.githooks/**)", re: /^\.githooks\// },
  // Review sweep on #1133, finding 4 (blocking): gate ratchets and pins are the same
  // class as the launch-claims ceilings above — raising the stored number weakens the
  // gate that reads it without touching any gate code. docs/agent/*-ratchet.json
  // (backlog-evidence, cited-symbols, claim-inventory-anchors, role-coverage,
  // surface-ownership) and artifacts/sync/*-pin.json (doc-orphan, package-reachability)
  // all classified "other"; scripts/lib/ratchet-read.mjs itself says it "deliberately
  // says NOTHING about whether a ceiling's VALUE is correct", so nothing else catches a
  // raised value. Downward re-records still land under DR-037 (ownerDecisionText keeps
  // the DR-037 self-merge text for SAFETY_MACHINERY).
  { rule: "gate ratchets and pins (raising one weakens its gate)", re: /^(docs\/agent\/[\w-]*-ratchet\.json|artifacts\/sync\/[\w-]*-pin\.json)$/ },
  // Review sweep on #1133, finding 5 (blocking): other files CI/preflight gates read as
  // inputs that classified "other" despite backing a gate. validate-sim-macos.sh is run
  // by mac-lane.yml; native/ios/.swiftlint.yml is read by ios-ci.yml and
  // check-swiftlint-rules.mjs; native/shared/*.json vectors carry the TS-to-Swift
  // parity floor (`requires.minCases`) alongside the cases they gate, so dropping cases
  // and lowering minCases in the same edit shrinks decision-core parity coverage;
  // docs/agent/KNOWN_CONDITIONS.json's `blocks_pr` flag controls whether scan-gaps.mjs
  // fails; docs/agent/scheduled-routines.json's `cadenceToleranceHours` controls whether
  // raised-hands --check (fatal in preflight) fires; docs/agent/hand-routing.json routes
  // (or silently drops) a stall to a responder; .npmrc's `ignore-scripts` would skip the
  // `prepare` script that installs the pre-push lockfile hook.
  { rule: "gate inputs outside scripts/ (harness, lint config, parity vectors, diagnosis/tolerance registries, npm config)", re: /^(validate-sim-macos\.sh|native\/ios\/\.swiftlint\.yml|native\/shared\/[\w-]+\.json|docs\/agent\/(KNOWN_CONDITIONS|scheduled-routines|hand-routing)\.json|\.npmrc)$/ },
  // Review sweep on #1133, finding 9 (should-fix): the Mac evidence records that feed
  // the readiness figure (DR-036 outreach gate) classified "other" — check-readiness-
  // figure.mjs, launch-profile.mjs and check-launch-proof-bindings.mjs all read
  // artifacts/live-evidence/mac-run.json, and its binding is a digest/fingerprint
  // stored in the file itself with no signature, so hand-forging it moves readiness
  // without touching any gate code. Mac tick PRs still land under DR-037; only the
  // escalation label changes.
  { rule: "minted evidence records (feed the readiness figure)", re: /^artifacts\/(live-evidence|sim-results)\// },
  // Review sweep on #1133, finding 10 (nit): the instruction-file rule's reasoning
  // (AGENTS.md/CLAUDE.md steer agents) applies equally to the review/landing-ritual
  // agent definitions and skills that steer the SAME autonomous-merge loop.
  { rule: "review/landing agent definitions (.claude/agents/**)", re: /^\.claude\/agents\// },
  { rule: "the loop-end skill (.claude/skills/loop-end/**)", re: /^\.claude\/skills\/loop-end\// },
  { rule: "the signalgrid-reviewer skill (.claude/skills/signalgrid-reviewer/**)", re: /^\.claude\/skills\/signalgrid-reviewer\// },
  // Codex round 4 on #1133 (P1, thread 4113330659, 2026-09-26): native test sources
  // classified autonomous — measured live with classifyDiff() at 07d6f1ab:
  // native/android/core/src/test/kotlin/com/signalgrid/assist/core/AssistWireTest.kt,
  // native/ios/EnterpriseShellTests/AssistWireConformanceTests.swift, and
  // native/desktop/core/tests/conformance.rs are real tracked files that classified
  // autonomous; native/android/app/src/androidTest/java/x/FooTest.kt is Codex's own
  // illustrative src/androidTest/ shape (verified absent from this tree) — classifyDiff()
  // takes a path string, not a file, so it came back "autonomous" the same way
  // (native/shared/assist-wire-conformance.json was already SAFETY_MACHINERY via the
  // "gate inputs outside scripts/" rule above). Deleting or weakening a native test
  // removes proof coverage, and the Android CI verifier derives its EXPECTED test set
  // from the files that remain, so a deletion shrinks its own expectation. Two rules —
  // directory convention and filename convention — so a native test is caught whichever
  // way it is organised; both scoped to native/ (see the negative self-test proving an
  // out-of-scope file with the SAME convention, e.g. artifacts/mcp-server/test/*, is not
  // swept in, and see TREE_GUARD below for the independent, self-test-hermetic backstop
  // that catches a native test convention neither rule below happens to name).
  { rule: "native test sources by directory (src/test/, src/androidTest/, a dir segment ending in Tests/, Rust tests/)", re: /^native\/(?:.+\/)?(?:tests?|__tests__|androidTest|[\w-]*Tests)\// },
  { rule: "native test sources by filename (*Test.kt, *Tests.kt, *Test.java, *Test.swift, *Tests.swift, *_test.rs)", re: /^native\/.*(?:Test\.(?:kt|java|swift)|Tests\.(?:kt|swift)|_test\.rs)$/ },
  // Review sweep on #1133 (round 3): the two rules above still had an under-match
  // inside their own family — a Rust crate's tests are conventionally written INLINE,
  // as `#[cfg(test)] mod tests { ... }` inside an ordinary src file, not under a
  // tests/ dir or a `_test.rs` filename, so neither rule above sees them. Measured
  // live with `grep -c '#[test]'` at this tree's HEAD: this repo has exactly three
  // Cargo crates (`find . -name Cargo.toml`, gitignored build/target dirs aside), and
  // every one of them puts the bulk of its suite inline — native/desktop/core/src/
  // wire.rs (19), endpoint.rs (14), assist.rs (6); native/desktop/app/src/main.rs (5);
  // firmware/dock/core/src/custody.rs (20), wire.rs (5), state.rs (3) — 72 #[test]
  // attributes across 7 ordinary src files, all classifying autonomous before this
  // rule, next to the 2 already-gated ones in native/desktop/core/tests/conformance.rs
  // (caught by the directory rule above). This is the exact hazard the two rules above
  // exist for: scripts/check-desktop-core-tests.mjs derives its EXPECTED #[test] count
  // from <crate-dir>/src and <crate-dir>/tests for these same three crates
  // (desktop.yml:94 native/desktop/core, desktop.yml:149 native/desktop/app,
  // firmware.yml:86 firmware/dock/core), so an autonomous PR that deletes or weakens
  // an inline test shrinks the verifier's own expectation in the same diff and CI
  // stays green. A path classifier cannot split a file's test half from its product
  // half, so this deliberately over-matches every .rs file under these three crates'
  // own src/ — the alternative is moving every inline test into tests/, a bigger
  // change than this fix. See findUngatedInlineRustTests below for the independent,
  // self-test-hermetic content probe that backs this the same way the TREE GUARD
  // backs the two rules above, for a fourth crate this rule does not yet name.
  // Review sweep on #1133 (round 4, thread 4113330659), finding 1 (should-fix): the
  // rule above still had the SAME under-match the round-3 Bruno finding had, one
  // directory over — it gates each crate's src/ but not firmware/dock/core/examples/
  // emit_fixtures.rs, which is still autonomous and is the ENTIRE input of the
  // dock-contract gate: firmware.yml:114 runs `cargo run --example emit_fixtures`, and
  // firmware.yml:118 pipes its stdout to `node scripts/check-dock-firmware-contract.mjs`.
  // Reproduced in scratch with the real crate and cargo (--offline): the unmodified
  // example emits 14 records and the gate exits 0; replacing its body with a `println!`
  // of those same 14 lines verbatim — zero references to DockUnit or encode, so the
  // firmware itself never runs — still prints "firmware emitted 14 record(s)" and exits
  // 0. One autonomous file change is therefore enough for every later firmware change to
  // merge under owner review without the contract gate ever running the firmware it
  // claims to check. Widened from `src/` alone to `(?:src|examples)`.
  // native/desktop/app/build.rs is the only other autonomous .rs file in the tree
  // (verified: `git ls-files '*.rs'` lists 12 tracked files; build.rs holds no
  // #[cfg(test)] and no gate script or workflow step reads its output), so it stays out
  // of scope.
  { rule: "Rust crates whose inline #[cfg(test)] modules check-desktop-core-tests.mjs counts, AND the crate's own executed example harness (desktop.yml:94,149; firmware.yml:86,114,118)", re: /^(?:native\/desktop\/(?:core|app)|firmware\/dock\/core)\/(?:src|examples)\/.*\.rs$/ },
  // Review fixes on the round-4 changes (#1133): round 4's own TREE_GUARD note (below)
  // left three product-test files "deliberately alone" as merely outside its native-only
  // scope — but they are not incidental test dirs, they are the WHOLE input of two gates
  // preflight and CI already run, so an autonomous PR could gut either assertion file and
  // keep the gate green. artifacts/mcp-server/test/server.test.ts is the entire "MCP
  // server unit tests" step (scripts/preflight.mjs:604, review-hub-ci.yml:1041, via
  // artifacts/mcp-server/package.json's own "test" script: `tsx --test test/server.test.ts`).
  // artifacts/signalgrid-app/src/lib/{policyTests,facilityGraphLayout}.test.ts are together
  // the entire "Console unit tests" step (scripts/preflight.mjs:597, review-hub-ci.yml:1033,
  // via `pnpm run test:console` -> artifacts/signalgrid-app/package.json's "test" script:
  // `node --test src/lib/policyTests.test.ts src/lib/facilityGraphLayout.test.ts`). Measured
  // over `git ls-files`, this rule matches exactly 7 tracked files: these 3, plus the 4 under
  // artifacts/api-server/test/ (already DECISION_PATH via the blanket "the /v1 decision API
  // server" rule above, so this is a harmless second match for them) — and nothing else.
  { rule: "product unit-test sources that preflight/CI run (artifacts/*/test/**, artifacts/**/*.test|spec.*)", re: /^artifacts\/[\w-]+\/(?:(?:.+\/)?(?:test|tests|__tests__)\/|.*\.(?:test|spec)\.[cm]?[jt]sx?$)/ },
  // Review sweep on #1133 (round 2 of the review pass), finding 1 (blocking): the
  // Bruno REQUESTS the live-run gate actually executes classified 'other', measured
  // live with classifyDiff() at 802d1c9b — artifacts/api-collection/negative-tests/
  // malformed-evaluate.bru, adversarial-trust/stale-evidence.bru and health/healthz.bru
  // all returned {tier:'autonomous', matched:[]}. These files ARE the input of "Bruno
  // collection live run" (preflight.mjs:610, review-hub-ci.yml:1054): scripts/run-
  // bruno-collection.mjs:169-183 runs exactly the health/, v1/, control-plane/,
  // review-demo/, adversarial-trust/ and negative-tests/ folders through the real
  // Bruno CLI. 17 of the 103 tracked .bru files under artifacts/api-collection/ carry
  // a hand-authored `assert {}` / `tests {}` block (malformed-evaluate.bru asserts
  // `res.status: eq 400`), and the runner fails only on a failed assertion, a 5xx, or
  // an empty run — an autonomous PR could loosen or delete one of those 17 refusal
  // checks and the gate stays green, the identical shape to a weakened unit test.
  // sources/ is DELIBERATELY left out: run-bruno-collection.mjs's own header says
  // those requests target the external lab services run-live-lanes.sh starts and are
  // never executed here (the Mac lane's live-lane loop runs them separately) — it does
  // not exist in the tree today, but is named below in TEST_SOURCE_EXCLUSIONS ahead of
  // time so a future file there reads as a known, intentional gap, not a silent one.
  // Review sweep on #1133 (round 3): the rule just above this comment was, until this
  // pass, folder-scoped to requests only, and left the collection's own EXECUTED
  // PLUMBING unmatched: bruno.json and collection.bru are read on every single
  // `bru run` invocation (scripts/run-bruno-collection.mjs's runBru() runs with
  // `cwd: COLLECTION`, the collection root), and collection.bru's own
  // script:pre-request block runs before EVERY request in the run — a one-block edit
  // there can disable every assertion this gate has, not just one. Reproduced live in
  // scratch with the real bru 4.0.0 from scripts/node_modules: appending
  // `script:pre-request { bru.runner.skipRequest(); }` to a copy of collection.bru and
  // running negative-tests/malformed-evaluate.bru (no server needed — the request
  // never leaves the pre-request hook) printed "Status PASS", "Requests 1 (1
  // Skipped)", "Assertions 0/0", exit 0. scripts/run-bruno-collection.mjs's own
  // auditResults() counts that skipped result as one of its `requests` (a skipped
  // result's `error` is null and it fails no check), so the empty-run floor never
  // fires either — the identical fail-open the requests-only rule closed for the
  // requests themselves, left open one level up in the file that runs before all of
  // them. bruno.json was previously unmatched by ANY rule, not
  // even TEST_SOURCE_EXCLUSIONS, because it is not a `.bru` file and
  // TEST_CONVENTION_NAME_RE never covers it. environments/*.bru carries the same
  // exposure a different way: it sets `token`, `ownerToken`, `atlasToken`, and the
  // `policyId`/`policyVersionId`/`connectorId`/scenario ids every request interpolates
  // — the runner overrides ONLY `baseUrl` via --env-var (run-bruno-collection.mjs:43),
  // so every other var here is exactly what an assertion is keyed to (adversarial-trust/
  // and negative-tests/cross-tenant-decision.bru pick their identity by which token
  // they name) — editing one CAN silently change what gets asserted against which
  // identity, the opposite of the claim this file used to make about it (see the
  // TEST_SOURCE_EXCLUSIONS entry below, corrected in the same pass). The rule is
  // therefore widened from requests-only to the collection's whole executed footprint.
  { rule: "Bruno requests AND the collection's own executed plumbing the 'Bruno collection live run' gate reads or runs on every invocation (preflight.mjs:610, review-hub-ci.yml:1054; folder list in scripts/run-bruno-collection.mjs:169-183; collection.bru's script:pre-request runs before every request; bruno.json is read from cwd on every `bru run`; environments/ supplies every var but baseUrl)", re: /^artifacts\/api-collection\/(?:(?:health|v1|control-plane|review-demo|adversarial-trust|negative-tests|environments)\/|collection\.bru$|bruno\.json$)/ },
  // Completeness sweep on #1133 (round 2): the SAME class of gap, found by re-running
  // the sweep the finding above named against every OTHER gate that runs a checker
  // over tracked, non-script data (CLAUDE.md's mandate for this round) — a second
  // Bruno family with zero manifest coverage. scripts/check-lab-collections.mjs's
  // entire input is artifacts/lab-collections/ (42 tracked files: fleet/, keycloak/,
  // microsoft-graph/, traccar/ and wazuh/, each a bruno.json + environments/ + request
  // .bru files, plus the directory's own README.md, which the check reads directly for
  // its "is this folder declared in the lane table" cross-check) — a FATAL gate in both
  // preflight.mjs:524 and review-hub-ci.yml:301 (plus its own self-test at :303), and
  // classified 'other' end to end (measured live at the same sha:
  // artifacts/lab-collections/fleet/hosts-list.bru, fleet/collection.bru,
  // fleet/environments/Lab.bru and the directory README all returned
  // {tier:'autonomous', matched:[]}). check-api-collection.mjs:205 explains why this
  // tree was split out of the parent collection in the first place (it maps
  // third-party vendor paths, never cross-checked against /v1 routes) — that split is
  // exactly what left it unnamed by every rule above. Nothing here executes an
  // `assert{}` block (check-lab-collections.mjs is a static structural audit, not a
  // live Bruno run), so the risk is coverage erosion rather than assertion-loosening:
  // deleting a request file, or a whole service folder plus its README row in the same
  // diff so the cross-check stays internally consistent, silently shrinks what the lab
  // collection maps without tripping any FATAL check — still "a diff quietly weakens
  // what a gate proves, and the weakening is invisible to that gate", the shape this
  // manifest exists to catch. Blanket over the whole tree rather than just the request
  // files: the README, bruno.json and environments/ files feed the SAME verdict
  // (hasBrunoJson / hasEnvironments / readmeNamed), so scoping the rule to only the
  // *.bru requests would leave those other inputs unmatched for no reason.
  { rule: "lab source collections the 'Lab source collections' gate validates (preflight.mjs:524, review-hub-ci.yml:301,303; scripts/check-lab-collections.mjs)", re: /^artifacts\/lab-collections\// },
  // Completeness sweep on #1133 (round 4), finding 2 (should-fix), predating this
  // commit: docs/agent/FALSE_CLAIMS.json is the WHOLE assertion set of the
  // "Known-false claims" gate (preflight.mjs:515-516, review-hub-ci.yml:498,500 — both
  // run scripts/check-known-false-claims.mjs, which reads this one file as its REGISTRY
  // and derives every denial pattern from its entries), and it classified 'other'.
  // Verified against the current tree: classifyDiff(["docs/agent/FALSE_CLAIMS.json"])
  // returns autonomous, and check-known-false-claims.mjs's own header says an entry must
  // be "never silently deleted" — a claim without a manifest rule can be removed from
  // the registry AND re-stated in a tracked document in the same autonomous diff, since
  // the gate only checks denial patterns for entries still present in the file it reads.
  { rule: "the known-false-claim registry, the whole assertion set of 'Known-false claims' (preflight.mjs:515, review-hub-ci.yml:498)", re: /^docs\/agent\/FALSE_CLAIMS\.json$/ },
  // Completeness sweep on #1133 (round 4), finding 3 (nit), predating this commit:
  // three CI gate programs live outside scripts/ and classified 'other' end to end
  // (verified against the current tree; not executed here since xcodebuild is not on
  // this host, only the classification and file contents). native/ios/SignalGridMobile/
  // scripts/verify.sh is the entire "Verify SignalGridMobile" step (ios-ci.yml:186) — the
  // parse check plus the SignalGridOperator and WardlinkDemo xcodebuilds; an `exit 0` at
  // its top drops both app builds and the step stays green. native/ios/scripts/
  // pick-simulator.py (ios-ci.yml:88,100) picks the destination for the EnterpriseShell
  // `xcodebuild test` run, including its own --self-test. native/desktop/app/icons/
  // generate-icons.mjs (desktop.yml:133, run with --check) is the whole "Icons match
  // their generator" step.
  { rule: "CI gate programs outside scripts/ (ios-ci.yml:88,100,186; desktop.yml:133)", re: /^(?:native\/ios\/SignalGridMobile\/scripts\/verify\.sh|native\/ios\/scripts\/pick-simulator\.py|native\/desktop\/app\/icons\/generate-icons\.mjs)$/ },
];

// Review fixes on the round-4 changes (#1133): the guard below (findUngatedNativeTestSources)
// is now REPO-WIDE, not native/-only — a repo-wide sweep of every tracked file matching
// the test conventions below (TEST_CONVENTION_DIR_RE / TEST_CONVENTION_NAME_RE) found
// NINE files that classified autonomous at 07d6f1ab: the three product-test files above
// (closed by the rule above) plus the FIRST four rules below, which really are not gate
// inputs. This is the guard's own record of what is DELIBERATELY left out, one family
// per line, so a future reader can see the reasoning next to the exclusion rather than
// inferring it from silence — a directory prefix for the families that are ENTIRELY out
// of scope by design, and the known files (by exact path) where an ordinary directory
// could reasonably gain a file worth gating later and this list should not wave that
// through blind. Completeness sweep on #1133 (round 2): widening TEST_CONVENTION_NAME_RE
// to `.bru$` (below) swept in two more Bruno families end to end — both closed by a
// SAFETY_MACHINERY rule above, except the collection's own config/placeholder files,
// which join this list as the last rule (see `node scripts/check-owner-gated-surfaces.mjs
// --self-test` for the exact, currently-measured count of what this sweep finds today;
// it is never retyped here as a bare number for the same reason CLAUDE.md gives for every
// other figure in this repo — a comment is not re-run when the tree changes underneath it).
export const TEST_SOURCE_EXCLUSIONS = [
  { rule: "vendored third_party/ code (pinned upstream, not this repo's own gate surface — e.g. third_party/cli-anything/tests/test_skill_generator.py)", re: /^third_party\// },
  { rule: "k6 load drivers (tests/load/**) — CLAUDE.md and scripts/check-test-execution.mjs:46 already document these as REPORTED, invoked by nothing, deliberately outside the correctness gate", re: /^tests\/load\// },
  { rule: "two test-shaped files inside ordinary, deliberately-autonomous skill directories (see the existing \"an unrelated skill dir stays autonomous\" self-test)", re: /^\.claude\/skills\/(?:ios-simulator-skill\/scripts\/test_recorder\.py|node\/rules\/assets\/graceful-server\.test\.ts)$/ },
  // Completeness sweep on #1133 (round 2): adding `.bru$` to TEST_CONVENTION_NAME_RE
  // (below) so the tree guard sees the Bruno families gated above. This entry used to
  // also list environments/ and collection.bru here, autonomous, on the claim that
  // editing them "cannot silently change what gets asserted" — check-api-collection.mjs
  // excludes both from ITS OWN definition of "a request file" (scripts/check-api-
  // collection.mjs:217-218), but that gate asks a different question (does every
  // api-server route have a mapped request?), not whether editing the file can move
  // what the LIVE run asserts. Review sweep on #1133 (round 3), corrected: it can, for
  // both — collection.bru's script:pre-request block runs before every request bru
  // executes from this collection (reproduced live: it can skip every one of them, see
  // the SAFETY_MACHINERY rule above), and environments/*.bru supplies every var an
  // assertion is keyed to except baseUrl. Both are SAFETY_MACHINERY now, not excluded
  // here. sources/ is the one member of this family with no live-run exposure at all —
  // it does not exist in the tree today, but scripts/run-bruno-collection.mjs's own
  // header names it as the deliberately-never-run folder for external-lab requests (see
  // the SAFETY_MACHINERY rule above) — declared here ahead of time, like the k6 rule
  // above it, so a future sources/*.bru file reads as a known, intentional gap rather
  // than a silent one.
  { rule: "the Bruno collection's reserved-but-unpopulated sources/ (never executed by the live-run gate — everything else in this family is SAFETY_MACHINERY above)", re: /^artifacts\/api-collection\/sources\// },
];

// Codex round 4 on #1133 (P1, thread 4113330659): the TREE GUARD `validate()` runs (see
// below) so the next test directory cannot slip through a hand-written list like
// SAFETY_MACHINERY above. It re-derives, independently of the manifest rules above,
// which tracked files look like a test source ANYWHERE in the repo by the same broad
// conventions used to DERIVE this fix (dirs test/, tests/, __tests__/, src/test/,
// src/androidTest/, a dir segment ending in Tests/; names *.test.*, *.spec.*, *Test.kt|
// java|swift, *Tests.kt|swift, *_test.rs, test_*.py, *.bru) and fails, naming the file,
// if any one still classifies autonomous.
//
// Review fixes on the round-4 changes (#1133): round 4 scoped this to native/ only and
// left three OTHER autonomous test-shaped files "deliberately alone" as merely outside
// that scope — but two of those three back real preflight/CI gates (closed by the new
// SAFETY_MACHINERY rule above), so leaving the GUARD native-only left its own self-tests
// asserting that gap was correct. The guard is now REPO-WIDE: it fails, naming the file,
// if ANY tracked path (not just one under native/) matches the test conventions below
// and still classifies autonomous. TEST_SOURCE_EXCLUSIONS (above) is the small, explicit,
// commented list of the families that really are not gate inputs, so a repo-wide sweep
// finds nothing left to flag: vendored third_party/ code, the k6 load drivers under
// tests/load/ CLAUDE.md already documents as REPORTED not gated, two files inside
// ordinary, deliberately-autonomous skill directories, and — completeness sweep on
// #1133, round 2, once `.bru$` joined the name convention below — the Bruno
// collection's reserved-but-empty sources/ folder (round 3 moved this family's other
// two members, environments/ and collection.bru, up into SAFETY_MACHINERY instead,
// once both proved to be live-run-executed plumbing rather than excluded config). A
// future test-shaped file anywhere else in the tree — the "next
// native test directory" this guard was built for, just no longer limited to native/ —
// still fails this gate by name instead of merging silently.
const TEST_CONVENTION_DIR_RE = /(^|\/)(test|tests|__tests__)\/|(^|\/)src\/(test|androidTest)\/|(^|\/)[^/]*Tests\//;
const TEST_CONVENTION_NAME_RE = /\.test\.[^./]+$|\.spec\.[^./]+$|Test\.(kt|java|swift)$|Tests\.(kt|swift)$|_test\.rs$|(^|\/)test_[^/]+\.py$|\.bru$/;

/** True if `f` matches one of the general test-source conventions used to DERIVE the
 *  native rules above (dirs test/tests/__tests__/src/test//src/androidTest//a *Tests/
 *  segment; names *.test.*, *.spec.*, *Test.kt|java|swift, *Tests.kt|swift, *_test.rs,
 *  test_*.py, *.bru) — independent of, and broader than, the SAFETY_MACHINERY regexes
 *  above, so a manifest regression (a rule deleted or narrowed) is still caught. */
export function looksLikeTestSource(f) {
  const n = normalizePath(f);
  return TEST_CONVENTION_DIR_RE.test(n) || TEST_CONVENTION_NAME_RE.test(n);
}

/** Pure function over a file list (never touches git itself) so the self-test can call
 *  it hermetically with a synthetic list, including a planted path that exercises the
 *  fix without writing anything into the real tree. REPO-WIDE as of the review fixes on
 *  the round-4 changes (#1133 — it used to filter to native/ only). Returns the
 *  test-source paths among `files`, minus TEST_SOURCE_EXCLUSIONS, that classifyDiff()
 *  still calls "autonomous" — empty means the guard is satisfied. The name is kept for
 *  history/git-blame continuity; it no longer means native/-only. */
export function findUngatedNativeTestSources(files) {
  return files
    .map(normalizePath)
    .filter((f) => looksLikeTestSource(f) && !TEST_SOURCE_EXCLUSIONS.some((p) => p.re.test(f)))
    .filter((f) => classifyDiff([f]).tier === "autonomous");
}

/** Review sweep on #1133 (round 3): findUngatedNativeTestSources above is path-only, so
 *  it can never see a Rust crate's test half — that lives INSIDE an ordinary src file
 *  (`#[cfg(test)] mod tests { ... }`), not in a path shape any convention names. This is
 *  the independent backstop for exactly that: a pure content probe over (path, text)
 *  pairs (never touches disk itself, so the self-test is hermetic) that flags a tracked
 *  `.rs` file whose text holds `#[cfg(test)]` and that still classifies autonomous —
 *  the same "gate input can be silently weakened" shape as the path-only guard, one
 *  layer deeper, for the crate the SAFETY_MACHINERY rule above does not yet name. */
export function findUngatedInlineRustTests(files) {
  return files
    .map(({ path, text }) => ({ path: normalizePath(path), text }))
    .filter(({ path }) => path.endsWith(".rs"))
    .filter(({ text }) => /#\[cfg\(test\)\]/.test(text))
    .map(({ path }) => path)
    .filter((path) => classifyDiff([path]).tier === "autonomous");
}

// Completeness sweep on #1133 (round 2): the tree guard's OWN vacuity floor. Every
// property this guard proves ("nothing tracked looks like a test source and stays
// ungated") reads identically whether it swept a real, populated tree or a
// TEST_CONVENTION_DIR_RE/TEST_CONVENTION_NAME_RE that regressed to matching nothing —
// findUngatedNativeTestSources() over an empty candidate set returns [] either way, and
// an empty list already reads as "the guard is satisfied" everywhere else in this file.
// A future edit that narrows either regex to the point of matching zero tracked paths
// (a typo'd anchor, a dropped alternative, the whole regex accidentally replaced with
// something that never matches) would make checkNativeTestSourcesGated() print nothing
// wrong FOREVER — the silent-regression shape this entire guard exists to prevent,
// just one level up, in the guard's own detector rather than in the manifest it checks.
// Exported so the self-test exercises it hermetically, with no git and no real files.
export function noTestSourcesFoundAtAll(files) {
  return !files.map(normalizePath).some(looksLikeTestSource);
}

// A changed path matching ANY of these is OWNER_RESERVED. Correct code is not the point.
export const OWNER_RESERVED = [
  { rule: "license / notice", re: /^(LICENSE|NOTICE)(\.\w+)?$/ },
  { rule: "compliance & threat-model docs", re: /^docs\/(SECURITY_QUESTIONNAIRE_PACK|SECURITY_CONTROLS_MATRIX|[A-Z_]*THREAT_MODEL[A-Z_]*|COMPLIANCE[A-Z_]*)\.md$/ },
  { rule: "the launch profile", re: /^docs\/LAUNCH_PROFILE\.md$/ },
  { rule: "the cost model (owner billing)", re: /^docs\/COST_MODEL\.md$/ },
  { rule: "pricing & positioning", re: /(Pricing\.tsx$|^docs\/POSITIONING\.md$)/ },
  { rule: "buyer-facing site & outreach", re: /^(artifacts\/signalgrid-(web|review)\/|README\.md$|docs\/outreach\/)/ },
  // DR-037 names these three surfaces explicitly as ones the lane never merges
  // (land-branch-gate.mjs's OWNER_RESERVED text and README.md both name them) — without
  // a manifest rule, mostRestrictive() cannot resolve to OWNER_RESERVED for them, and
  // since the derived class now always overrides a caller's guess (Codex finding 7), a
  // caller that correctly said OWNER_RESERVED would be downgraded to whatever weaker
  // class the diff otherwise matched (usually SAFETY_MACHINERY, since these all live
  // under scripts/ or docs/).
  { rule: "the launch-claims gate", re: /^scripts\/check-launch-claims\.mjs$/ },
  { rule: "the publication boundary", re: /^(scripts\/(check-)?publication-boundary\.mjs|docs\/PUBLICATION_BOUNDARY\.md)$/ },
  { rule: "the launch-profile machinery", re: /^scripts\/(check-)?launch-profile\.(mjs|d\.mts)$/ },
  // Finding 3 (Codex #1133 P1, 2026-09-26): scripts/check-launch-claims.mjs's own
  // ceiling/baseline files (RETIRED_CEILING_FILE, DOCS_CEILING_FILE — the only two
  // constants it reads through readRatchetFile()) live under docs/agent/, not
  // scripts/, so raising either was an 'other' change: an autonomous merge could widen
  // what the launch-claims gate tolerates without ever touching the gate's own code.
  { rule: "the launch-claims ceilings (scripts/check-launch-claims.mjs's own RETIRED_CEILING_FILE / DOCS_CEILING_FILE — raising either weakens the gate through an 'other' change)", re: /^docs\/agent\/launch-claims-(retired-labels|docs)-ceiling\.json$/ },
  // Codex round 3 on #1133 (thread 4112838155, 2026-09-26): the Dockerfile set feeding
  // that same derivation is itself outside scripts/ and unowned by any rule above.
  // scripts/check-launch-claims.mjs:46-73 derives its scanned source roots by walking
  // `git ls-files 'Dockerfile*'` and mapping each Dockerfile's `COPY .../dist` lines to
  // an `artifacts/<pkg>/src` root to scan. Adding, removing or rewriting a Dockerfile
  // changes WHICH roots get scanned without ever touching check-launch-claims.mjs
  // itself — the same "widen the gate's blind spot from outside its own code" shape
  // Finding 3's ceiling-files rule above already closes.
  // Review sweep on #1133 (round 3 fix pass): the round-3 comment above claimed this
  // bare, slash-free pathspec "only matches top-level names" and scoped the rule to
  // `^Dockerfile[^/]*$` on that belief. Both were wrong. `git ls-files 'Dockerfile*'`
  // is fnmatch without FNM_PATHNAME, so `*` crosses `/`: it matches every tracked path
  // whose FIRST path segment starts with `Dockerfile` — a root `Dockerfile`/
  // `Dockerfile.*` file, but ALSO anything under a root entry named `Dockerfile*`
  // (`Dockerfile.d/x`, `Dockerfiles/api`), while a path like `docs/ops/Dockerfile.staging`
  // (first segment `docs`) never matches. Verified live in a throwaway repo (both the
  // positive nested cases and the docs/ops negative). `^Dockerfile[^/]*$` rejected the
  // nested-root cases because of the `/` after the prefix, so a tracked
  // `Dockerfile.d/<x>` could be added or edited as an autonomous change and still widen
  // check-launch-claims.mjs's scanned roots. The rule now mirrors the pathspec exactly:
  // a plain `Dockerfile` prefix over the whole path, no end anchor.
  { rule: "the launch-claims gate's scanned Dockerfile set (any tracked path starting with 'Dockerfile' — the set `git ls-files 'Dockerfile*'` returns — changes which artifacts/<pkg>/src trees scripts/check-launch-claims.mjs scans)", re: /^Dockerfile/ },
  // Codex round 2 on #1133 (2026-09-26) P1: the repo's own instruction files — every
  // rule in this manifest, DR-020/DR-021/DR-033/DR-037/DR-054/DR-060, the golden rules,
  // the "ask before" list — are prose the owner wrote and the whole autonomous-merge
  // design defers to; a diff that edits either file was previously 'other' and could
  // rewrite what an agent is told to do (including weakening the very escalation rule
  // enforced here) without ever routing to the owner. Exact-path: only the ROOT copies
  // (there are no nested AGENTS.md/CLAUDE.md in this tree today; if one is ever added,
  // it is deliberately out of scope for this rule until named here).
  { rule: "the repository instructions (root AGENTS.md)", re: /^AGENTS\.md$/ },
  { rule: "the repository instructions (root CLAUDE.md)", re: /^CLAUDE\.md$/ },
  // Codex round 3 on #1133 (thread 4112838146, 2026-09-26): docs/PURPOSE.md is
  // canonical (DR-020, CLAUDE.md) — it states what SignalGrid IS and what may be
  // claimed, the same class of owner-authored prose as AGENTS.md/CLAUDE.md above, and
  // was previously unmatched by any rule here.
  { rule: "the canonical purpose document (DR-020: states what SignalGrid is and what may be claimed)", re: /^docs\/PURPOSE\.md$/ },
  // Codex round 2 on #1133 (2026-09-26) P1: the LOCAL helper modules the owner-reserved
  // gate scripts above import. scripts/check-launch-claims.mjs delegates its ratchet-file
  // reading to scripts/lib/ratchet-read.mjs — without a dedicated rule, editing that
  // helper (e.g. to make readRatchetFile()/refusalLines() always report clean) only
  // classified SAFETY_MACHINERY (the blanket scripts/** rule), one tier below what a
  // change to check-launch-claims.mjs itself gets, understating exactly the surface a
  // model-judged auto-merge must never touch. The launch-profile machinery rule above
  // already covers scripts/launch-profile.mjs (check-launch-profile.mjs's own import),
  // and the publication-boundary rule above already covers scripts/publication-boundary.mjs
  // (check-publication-boundary.mjs's own import) — neither has a further relative
  // import of its own (verified by grep, and re-verified live by the self-test below,
  // which re-derives every gate script's relative imports at test time so a future one
  // cannot escape silently).
  { rule: "the launch-claims gate's ratchet-read helper (scripts/lib/ratchet-read.mjs, imported by scripts/check-launch-claims.mjs)", re: /^scripts\/lib\/ratchet-read\.mjs$/ },
  // Review sweep on #1133, finding 6 (should-fix): this classifier manifest and the
  // landing gate it feeds were only SAFETY_MACHINERY, which the lane merges itself
  // under DR-037 (ownerDecisionText('SAFETY_MACHINERY')). That is a two-step bypass of
  // every OTHER owner-reserved rule above: PR 1 deletes a rule (classifies
  // SAFETY_MACHINERY via scripts/**, lane self-merges on green); PR 2 then edits the
  // now-unprotected gate script the same way. Making these three files themselves
  // OWNER_RESERVED closes that: a change to the classifier, the landing gate that reads
  // its verdict, or the saved workflow now always escalates, regardless of what rule
  // it also matches.
  { rule: "the owner-gated-surfaces classifier and the landing gate/workflow that read it", re: /^(scripts\/check-owner-gated-surfaces\.mjs|scripts\/lib\/land-branch-gate\.mjs|\.claude\/workflows\/land-branch\.js)$/ },
  // Review sweep on #1133, finding 10 (nit): the compliance rule above only matches
  // docs/*THREAT_MODEL*.md and docs/COMPLIANCE*.md — the root threat_model.md and
  // SECURITY.md escaped it entirely and classified "other".
  { rule: "root compliance docs (threat_model.md, SECURITY.md)", re: /^(threat_model|SECURITY)\.md$/ },
];

// A changed path matching ANY of these is DECISION_PATH — golden rule 2's core. A
// model-judged auto-merge may NEVER merge these; they escalate to the owner however
// green the gauntlet is. lib/* IS the decision core (CLAUDE.md), so the rule is
// blanket and fail-closed: an unrecognised lib/ shape escalates rather than merges.
export const DECISION_PATH = [
  { rule: "the decision core / connectors / flows (lib/*)", re: /^lib\// },
  { rule: "the /v1 decision API server", re: /^artifacts\/api-server\// },
  { rule: "the byte-faithful native decision ports", re: /^native\/ios\/EnterpriseShell\/Services\/(DecisionEngine|AppWorkflows)\.swift$/ },
];

// Normalize a diff path before classifying, so an owner-gated file cannot be laundered
// past the manifest on a path-shape technicality — a leading ./, a git a//b/ diff
// prefix, or a backslash separator. Fail-closed toward the canonical repo-relative form.
function normalizePath(f) {
  let x = String(f).replace(/\\/g, "/"); // backslash -> forward slash
  x = x.replace(/^\.\//, "");             // strip leading ./
  return x;
}

/** Both readings of a path: as given, and with a git a//b/ diff prefix removed. classifyDiff
 *  tests BOTH and takes any match — fail-closed in both directions. A blind prefix strip
 *  would mangle a legitimate top-level directory literally named `a` or `b`; matching only
 *  the raw form would let `a/scripts/x.mjs` hide from the manifest. */
function pathForms(f) {
  const n = normalizePath(f);
  const stripped = n.replace(/^[ab]\//, "");
  return stripped === n ? [n] : [n, stripped];
}

/**
 * Classify a set of changed file paths (repo-relative, forward slashes). Returns
 * the merge tier and the exact rules that matched. "autonomous" only when NO file
 * hits either owner-gated list — fail-closed: an unrecognised owner-gated shape is
 * safer to escalate, so the lists err toward matching.
 */
export function classifyDiff(files) {
  const matched = [];
  for (const raw of files) {
    const forms = pathForms(raw);
    const hit = (p) => forms.some((f) => p.re.test(f));
    const f = forms[0];
    for (const p of DECISION_PATH) if (hit(p)) matched.push({ file: f, category: "DECISION_PATH", rule: p.rule });
    for (const p of SAFETY_MACHINERY) if (hit(p)) matched.push({ file: f, category: "SAFETY_MACHINERY", rule: p.rule });
    for (const p of OWNER_RESERVED) if (hit(p)) matched.push({ file: f, category: "OWNER_RESERVED", rule: p.rule });
  }
  return { tier: matched.length ? "owner-gated" : "autonomous", matched };
}

// The single most restrictive category present in a classifyDiff() result, in order
// OWNER_RESERVED > DECISION_PATH > SAFETY_MACHINERY > other ("other" = tier
// "autonomous", i.e. no rule matched). Pure, so both the CLI and its self-test can
// exercise the ordering directly.
export function mostRestrictive({ matched } = {}) {
  const present = new Set((matched || []).map((m) => m.category));
  for (const cat of ["OWNER_RESERVED", "DECISION_PATH", "SAFETY_MACHINERY"]) {
    if (present.has(cat)) return cat;
  }
  return "other";
}

function firstLine(s) {
  return String(s ?? "").split("\n")[0].trim();
}

// stdio explicitly piped (never inherited) so a git failure's own stderr never reaches
// the terminal alongside ours — the CLI's contract is EXACTLY one printed line, and the
// caller (the Merge stage worker) is told to return that line verbatim.
const GIT_OPTS = { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };

function classifyBranch(baseRef) {
  let mergeBase;
  try {
    mergeBase = execFileSync("git", ["merge-base", baseRef, "HEAD"], GIT_OPTS).trim();
  } catch (err) {
    console.log(`KLASS ERROR git merge-base ${baseRef} HEAD failed: ${firstLine(err.stderr || err.message)}`);
    process.exit(2);
  }
  let files;
  try {
    // Codex finding 1 (2026-09-26): git's default rename detection collapses a
    // rename/move diff down to just the NEW path, so `--no-renames` is required or an
    // owner-gated file moved OUT of its gated location (or a decision-path file moved
    // out of lib/) is invisible to the manifest — fail-open. `-c core.quotePath=false`
    // stops git C-quoting a non-ASCII path (`lib/décision.ts` -> `"lib/d\303\251cision.ts"`,
    // which matches no manifest rule — also fail-open). `-z` + split on NUL keeps a path
    // containing a literal newline from being read as two paths.
    files = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", "-z", `${mergeBase}..HEAD`],
      GIT_OPTS,
    )
      .split("\0")
      .filter((l) => l.length > 0);
  } catch (err) {
    console.log(`KLASS ERROR git diff --name-only ${mergeBase}..HEAD failed: ${firstLine(err.stderr || err.message)}`);
    process.exit(2);
  }
  if (files.length === 0) {
    // Fail-closed (CLAUDE.md golden rule 2): an empty diff against the base is an
    // unknown, not evidence of "nothing owner-gated" — never classify it "other".
    console.log(`KLASS ERROR empty diff against merge-base ${mergeBase} of ${baseRef} and HEAD`);
    process.exit(2);
  }
  const classification = classifyDiff(files);
  const klass = mostRestrictive(classification);
  console.log(`KLASS ${klass} files=${files.length} matched=${classification.matched.length}`);
  process.exit(0);
}

// Finding 1 (blocking, 2026-09-26): the CLI's own git-diff path had NO self-test —
// only classifyDiff()/mostRestrictive() were exercised, both of which take a plain
// array of path strings and never see git's rename-collapsing or path-quoting. These
// build a throwaway repo under os.tmpdir() (never inside this tree) and shell out to
// a FRESH node process running this same file, so the fix under test is the real CLI
// path (parsing, exit code, and all), not classifyDiff() called directly.
function withTempRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "check-owner-gated-surfaces-selftest-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runClassifyBranchCli(cwd, baseRef) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--classify-branch", baseRef],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, stdout: stdout.trim() };
  } catch (err) {
    return { code: typeof err.status === "number" ? err.status : 1, stdout: String(err.stdout || "").trim() };
  }
}

function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  const cls = (files) => classifyDiff(files);

  // Each owner-gated category must route to owner-gated.
  t("scripts/ change is SAFETY_MACHINERY", cls(["scripts/mutation-guard.mjs"]).tier === "owner-gated");
  t("a CI workflow change is SAFETY_MACHINERY", cls([".github/workflows/review-hub-ci.yml"]).tier === "owner-gated");
  t("a proof harness is SAFETY_MACHINERY", cls(["scripts/src/webauthn-verify-proof.ts"]).tier === "owner-gated");
  t("a fixtures dir is SAFETY_MACHINERY", cls(["lib/foo/fixtures/case.json"]).tier === "owner-gated");
  t("the lockfile is SAFETY_MACHINERY", cls(["pnpm-lock.yaml"]).tier === "owner-gated");
  t("the decision records are owner-gated", cls(["docs/DECISION_RECORDS.md"]).tier === "owner-gated");
  t("the brain-cycle veto config is SAFETY_MACHINERY", cls(["docs/agent/brain-cycle-config.json"]).tier === "owner-gated");
  t("the declared objective (DR-056) is SAFETY_MACHINERY", cls(["docs/agent/objective.json"]).tier === "owner-gated");
  t("…but the loop's derived STATE is not (the Mac tick rewrites it unattended)", cls(["docs/agent/objective-state.json"]).tier !== "owner-gated");
  t("LICENSE is OWNER_RESERVED", cls(["LICENSE"]).tier === "owner-gated");
  t("NOTICE is OWNER_RESERVED", cls(["NOTICE"]).tier === "owner-gated");
  t("the launch profile is OWNER_RESERVED", cls(["docs/LAUNCH_PROFILE.md"]).tier === "owner-gated");
  t("pricing is OWNER_RESERVED", cls(["artifacts/signalgrid-web/src/pages/Pricing.tsx"]).tier === "owner-gated");
  t("buyer-facing site is OWNER_RESERVED", cls(["artifacts/signalgrid-web/src/pages/About.tsx"]).tier === "owner-gated");
  t("the cost model is OWNER_RESERVED", cls(["docs/COST_MODEL.md"]).tier === "owner-gated");
  // Finding 2 (blocking, 2026-09-26): DR-037 names these three surfaces as ones the
  // lane never merges; without a manifest rule mostRestrictive() cannot resolve to
  // OWNER_RESERVED for them, so a caller who correctly says OWNER_RESERVED was
  // downgraded once the derived class started always winning (Codex finding 7).
  t("the launch-claims gate is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-launch-claims.mjs"])) === "OWNER_RESERVED");
  t("the publication-boundary checker is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-publication-boundary.mjs"])) === "OWNER_RESERVED");
  t("the publication-boundary module is OWNER_RESERVED", mostRestrictive(cls(["scripts/publication-boundary.mjs"])) === "OWNER_RESERVED");
  t("the publication-boundary doc is OWNER_RESERVED", mostRestrictive(cls(["docs/PUBLICATION_BOUNDARY.md"])) === "OWNER_RESERVED");
  t("launch-profile.mjs is OWNER_RESERVED", mostRestrictive(cls(["scripts/launch-profile.mjs"])) === "OWNER_RESERVED");
  t("check-launch-profile.mjs is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-launch-profile.mjs"])) === "OWNER_RESERVED");
  t("launch-profile.d.mts is OWNER_RESERVED", mostRestrictive(cls(["scripts/launch-profile.d.mts"])) === "OWNER_RESERVED");
  // Finding 3 (Codex #1133 P1): the launch-claims gate's own ceiling/baseline files
  // (scripts/check-launch-claims.mjs's RETIRED_CEILING_FILE / DOCS_CEILING_FILE) live
  // under docs/agent/, not scripts/ — without a manifest rule, raising either ceiling
  // was an 'other' change that weakened the gate without ever touching its code.
  t("the launch-claims retired-labels ceiling is OWNER_RESERVED", mostRestrictive(cls(["docs/agent/launch-claims-retired-labels-ceiling.json"])) === "OWNER_RESERVED");
  t("the launch-claims docs ceiling is OWNER_RESERVED", mostRestrictive(cls(["docs/agent/launch-claims-docs-ceiling.json"])) === "OWNER_RESERVED");
  // Codex round 3 on #1133 (thread 4112838155, 2026-09-26): the Dockerfile set that
  // feeds scripts/check-launch-claims.mjs's own source-root derivation.
  t("Dockerfile.api is OWNER_RESERVED (feeds the launch-claims gate's scanned Dockerfile set)", mostRestrictive(cls(["Dockerfile.api"])) === "OWNER_RESERVED");
  t("Dockerfile.web is OWNER_RESERVED (same)", mostRestrictive(cls(["Dockerfile.web"])) === "OWNER_RESERVED");
  // Review sweep on #1133 (round 3 fix pass): `git ls-files 'Dockerfile*'` is a prefix
  // match that crosses `/`, so it lists these two nested paths as well (verified live) —
  // the prior `^Dockerfile[^/]*$` rule missed both.
  t("Dockerfile.d/api is OWNER_RESERVED (nested under a root entry named Dockerfile.d, still inside git ls-files 'Dockerfile*')", mostRestrictive(cls(["Dockerfile.d/api"])) === "OWNER_RESERVED");
  t("Dockerfiles/api is OWNER_RESERVED (same — root entry Dockerfiles/ starts with 'Dockerfile')", mostRestrictive(cls(["Dockerfiles/api"])) === "OWNER_RESERVED");
  t("a Dockerfile under an unrelated top-level dir (docs/ops/Dockerfile.staging) stays autonomous — its FIRST path segment ('docs') doesn't start with 'Dockerfile', so git ls-files 'Dockerfile*' never lists it", cls(["docs/ops/Dockerfile.staging"]).tier === "autonomous");
  // Codex round 2 on #1133 (2026-09-26) P1, finding 1: the repository instruction files.
  t("root AGENTS.md is OWNER_RESERVED", mostRestrictive(cls(["AGENTS.md"])) === "OWNER_RESERVED");
  t("root CLAUDE.md is OWNER_RESERVED", mostRestrictive(cls(["CLAUDE.md"])) === "OWNER_RESERVED");
  // Codex round 3 on #1133 (thread 4112838146, 2026-09-26): the canonical purpose doc.
  t("docs/PURPOSE.md is OWNER_RESERVED", mostRestrictive(cls(["docs/PURPOSE.md"])) === "OWNER_RESERVED");
  // Codex round 2 on #1133 (2026-09-26) P1, finding 4: the launch-claims gate's own
  // ratchet-read helper — a change here used to classify only SAFETY_MACHINERY (the
  // blanket scripts/** rule), one tier below the gate script that imports it.
  t("the launch-claims gate's ratchet-read helper is OWNER_RESERVED", mostRestrictive(cls(["scripts/lib/ratchet-read.mjs"])) === "OWNER_RESERVED");
  // Codex round 2 on #1133 (2026-09-26) P1, finding 5: the root package manifests.
  t("the root package.json is SAFETY_MACHINERY", mostRestrictive(cls(["package.json"])) === "SAFETY_MACHINERY");
  t("pnpm-workspace.yaml is SAFETY_MACHINERY", mostRestrictive(cls(["pnpm-workspace.yaml"])) === "SAFETY_MACHINERY");
  // Review sweep on #1133, finding 1 (blocking): flipped from a negative to a
  // positive test. The package.json rule is now ANY manifest, not just the root —
  // scripts/preflight.mjs:604 runs `pnpm --filter @workspace/mcp-server run test`,
  // which resolves to THIS file's own "test" script, so a per-package manifest outside
  // lib/** and scripts/** is exactly as gate-bearing as the root one and must classify
  // SAFETY_MACHINERY, not "stay autonomous".
  t("a per-package package.json outside lib/** and scripts/** (artifacts/mcp-server/package.json) is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/mcp-server/package.json"])) === "SAFETY_MACHINERY");
  t("a TypeScript config (tsconfig.json) is SAFETY_MACHINERY", mostRestrictive(cls(["tsconfig.json"])) === "SAFETY_MACHINERY");
  t("tsconfig.base.json is SAFETY_MACHINERY", mostRestrictive(cls(["tsconfig.base.json"])) === "SAFETY_MACHINERY");
  t("a nested tsconfig (artifacts/mcp-server/tsconfig.json) is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/mcp-server/tsconfig.json"])) === "SAFETY_MACHINERY");
  // Finding 3 (blocking): CI security-scanner config outside .github/workflows/.
  t("the CodeQL workflow config (.github/codeql/codeql-config.yml) is SAFETY_MACHINERY", mostRestrictive(cls([".github/codeql/codeql-config.yml"])) === "SAFETY_MACHINERY");
  t(".gitleaks.toml is SAFETY_MACHINERY", mostRestrictive(cls([".gitleaks.toml"])) === "SAFETY_MACHINERY");
  t(".gitleaksignore is SAFETY_MACHINERY", mostRestrictive(cls([".gitleaksignore"])) === "SAFETY_MACHINERY");
  // Finding 4 (blocking): gate ratchets and pins.
  t("a docs/agent ratchet file is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/backlog-evidence-ratchet.json"])) === "SAFETY_MACHINERY");
  t("cited-symbols-ratchet.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/cited-symbols-ratchet.json"])) === "SAFETY_MACHINERY");
  t("claim-inventory-anchors-ratchet.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/claim-inventory-anchors-ratchet.json"])) === "SAFETY_MACHINERY");
  t("role-coverage-ratchet.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/role-coverage-ratchet.json"])) === "SAFETY_MACHINERY");
  t("surface-ownership-ratchet.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/surface-ownership-ratchet.json"])) === "SAFETY_MACHINERY");
  t("a artifacts/sync pin file is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/sync/doc-orphan-pin.json"])) === "SAFETY_MACHINERY");
  t("package-reachability-pin.json is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/sync/package-reachability-pin.json"])) === "SAFETY_MACHINERY");
  // Finding 5 (blocking): other gate inputs outside scripts/.
  t("validate-sim-macos.sh is SAFETY_MACHINERY", mostRestrictive(cls(["validate-sim-macos.sh"])) === "SAFETY_MACHINERY");
  t("native/ios/.swiftlint.yml is SAFETY_MACHINERY", mostRestrictive(cls(["native/ios/.swiftlint.yml"])) === "SAFETY_MACHINERY");
  t("a native/shared parity vector (posture-allow-vectors.json) is SAFETY_MACHINERY", mostRestrictive(cls(["native/shared/posture-allow-vectors.json"])) === "SAFETY_MACHINERY");
  t("remediation-allow-vectors.json is SAFETY_MACHINERY", mostRestrictive(cls(["native/shared/remediation-allow-vectors.json"])) === "SAFETY_MACHINERY");
  t("assist-wire-conformance.json is SAFETY_MACHINERY", mostRestrictive(cls(["native/shared/assist-wire-conformance.json"])) === "SAFETY_MACHINERY");
  t("docs/agent/KNOWN_CONDITIONS.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/KNOWN_CONDITIONS.json"])) === "SAFETY_MACHINERY");
  t("docs/agent/scheduled-routines.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/scheduled-routines.json"])) === "SAFETY_MACHINERY");
  t("docs/agent/hand-routing.json is SAFETY_MACHINERY", mostRestrictive(cls(["docs/agent/hand-routing.json"])) === "SAFETY_MACHINERY");
  t(".npmrc is SAFETY_MACHINERY", mostRestrictive(cls([".npmrc"])) === "SAFETY_MACHINERY");
  // Finding 9 (should-fix): minted evidence records.
  t("a live-evidence record (mac-run.json) is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/live-evidence/mac-run.json"])) === "SAFETY_MACHINERY");
  t("a sim-results record is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/sim-results/evidence-20260926.json"])) === "SAFETY_MACHINERY");
  // Finding 10 (nit): review/landing agent definitions, the loop-end and
  // signalgrid-reviewer skills, and the root compliance docs that escaped the
  // existing THREAT_MODEL regex.
  t(".claude/agents/ change is SAFETY_MACHINERY", mostRestrictive(cls([".claude/agents/fail-closed-auditor.md"])) === "SAFETY_MACHINERY");
  t(".claude/skills/loop-end/ change is SAFETY_MACHINERY", mostRestrictive(cls([".claude/skills/loop-end/SKILL.md"])) === "SAFETY_MACHINERY");
  t(".claude/skills/signalgrid-reviewer/ change is SAFETY_MACHINERY", mostRestrictive(cls([".claude/skills/signalgrid-reviewer/SKILL.md"])) === "SAFETY_MACHINERY");
  t("root threat_model.md is OWNER_RESERVED", mostRestrictive(cls(["threat_model.md"])) === "OWNER_RESERVED");
  t("root SECURITY.md is OWNER_RESERVED", mostRestrictive(cls(["SECURITY.md"])) === "OWNER_RESERVED");
  // Review sweep on #1133 (round 2 of the review pass), finding 1 (blocking): the two
  // files the finding measured autonomous at 802d1c9b, plus a third from the same
  // folder list, are now SAFETY_MACHINERY (the live-run gate's actual input).
  t("adversarial-trust/stale-evidence.bru is SAFETY_MACHINERY (the Bruno live-run gate's input)", mostRestrictive(cls(["artifacts/api-collection/adversarial-trust/stale-evidence.bru"])) === "SAFETY_MACHINERY");
  t("negative-tests/malformed-evaluate.bru is SAFETY_MACHINERY (same)", mostRestrictive(cls(["artifacts/api-collection/negative-tests/malformed-evaluate.bru"])) === "SAFETY_MACHINERY");
  t("health/healthz.bru is SAFETY_MACHINERY (same)", mostRestrictive(cls(["artifacts/api-collection/health/healthz.bru"])) === "SAFETY_MACHINERY");
  // Review sweep on #1133 (round 3): these two used to assert "stays autonomous" —
  // that was the bug (see the SAFETY_MACHINERY rule above). Both are executed plumbing,
  // not excluded config, and are SAFETY_MACHINERY now.
  t("artifacts/api-collection/environments/Local.bru is SAFETY_MACHINERY (supplies every var an assertion reads but baseUrl)", mostRestrictive(cls(["artifacts/api-collection/environments/Local.bru"])) === "SAFETY_MACHINERY");
  t("artifacts/api-collection/collection.bru is SAFETY_MACHINERY (its script:pre-request block runs before every request bru executes)", mostRestrictive(cls(["artifacts/api-collection/collection.bru"])) === "SAFETY_MACHINERY");
  t("artifacts/api-collection/bruno.json is SAFETY_MACHINERY (read from cwd on every `bru run` invocation; not a .bru file, so the tree guard alone would never have caught it)", mostRestrictive(cls(["artifacts/api-collection/bruno.json"])) === "SAFETY_MACHINERY");
  // Negative: the reserved-but-unpopulated sources/ folder stays autonomous — it is the
  // one member of this family the live-run gate deliberately never executes.
  t("a hypothetical artifacts/api-collection/sources/ request stays autonomous (deliberately never run by the live-run gate)", cls(["artifacts/api-collection/sources/fleet-lab-probe.bru"]).tier === "autonomous");
  // Completeness sweep on #1133 (round 2): the second Bruno family the sweep found —
  // scripts/check-lab-collections.mjs's entire input, previously unnamed by any rule.
  t("a lab-collections request (fleet/hosts-list.bru) is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/lab-collections/fleet/hosts-list.bru"])) === "SAFETY_MACHINERY");
  t("the lab-collections directory README is SAFETY_MACHINERY (the gate reads it directly for the declared-lane cross-check)", mostRestrictive(cls(["artifacts/lab-collections/README.md"])) === "SAFETY_MACHINERY");
  t("a lab-collections environments file is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/lab-collections/fleet/environments/Lab.bru"])) === "SAFETY_MACHINERY");
  t("a lab-collections bruno.json is SAFETY_MACHINERY", mostRestrictive(cls(["artifacts/lab-collections/keycloak/bruno.json"])) === "SAFETY_MACHINERY");
  // Completeness sweep on #1133 (round 4), finding 2: the known-false-claim registry —
  // deleting an entry here while restating the claim it refuted was an autonomous diff.
  t("docs/agent/FALSE_CLAIMS.json is SAFETY_MACHINERY (the whole assertion set of the Known-false-claims gate)", mostRestrictive(cls(["docs/agent/FALSE_CLAIMS.json"])) === "SAFETY_MACHINERY");
  t("docs/STATUS.md stays autonomous (a document the known-false-claims gate SCANS, not the registry itself)", cls(["docs/STATUS.md"]).tier === "autonomous");
  // Completeness sweep on #1133 (round 4), finding 3: CI gate programs living outside
  // scripts/ that classified 'other' end to end.
  t("native/ios/SignalGridMobile/scripts/verify.sh is SAFETY_MACHINERY (the whole 'Verify SignalGridMobile' step, ios-ci.yml:186)", mostRestrictive(cls(["native/ios/SignalGridMobile/scripts/verify.sh"])) === "SAFETY_MACHINERY");
  t("native/ios/scripts/pick-simulator.py is SAFETY_MACHINERY (picks the EnterpriseShell test destination, ios-ci.yml:88,100)", mostRestrictive(cls(["native/ios/scripts/pick-simulator.py"])) === "SAFETY_MACHINERY");
  t("native/desktop/app/icons/generate-icons.mjs is SAFETY_MACHINERY (the whole 'Icons match their generator' step, desktop.yml:133)", mostRestrictive(cls(["native/desktop/app/icons/generate-icons.mjs"])) === "SAFETY_MACHINERY");
  // Finding 6 (should-fix): the classifier manifest and the landing gate/workflow that
  // read its verdict are themselves OWNER_RESERVED now, closing the two-step bypass
  // (delete a rule via scripts/**-classified SAFETY_MACHINERY, then edit the
  // now-unprotected gate the same way).
  t("this classifier file (scripts/check-owner-gated-surfaces.mjs) is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-owner-gated-surfaces.mjs"])) === "OWNER_RESERVED");
  t("the landing gate (scripts/lib/land-branch-gate.mjs) is OWNER_RESERVED", mostRestrictive(cls(["scripts/lib/land-branch-gate.mjs"])) === "OWNER_RESERVED");
  t("the saved landing workflow (.claude/workflows/land-branch.js) is OWNER_RESERVED", mostRestrictive(cls([".claude/workflows/land-branch.js"])) === "OWNER_RESERVED");

  // The other direction: ordinary product/connector code IS autonomous, or the gate
  // refuses everything and means nothing.
  t("a connector evaluator is DECISION_PATH owner-gated", cls(["lib/integrations/src/integrations/task-exception/evaluate.ts"]).tier === "owner-gated");
  t("core decision logic is DECISION_PATH owner-gated", cls(["lib/signalgrid-core/src/decision.ts"]).tier === "owner-gated");
  // DECISION_PATH positives — the golden-rule-2 core must never classify autonomous.
  t("the engine is DECISION_PATH", cls(["lib/signalgrid-core/src/engine.ts"]).matched.some((m) => m.category === "DECISION_PATH"));
  t("the /v1 API server is DECISION_PATH", cls(["artifacts/api-server/src/routes/v1.ts"]).matched.some((m) => m.category === "DECISION_PATH"));
  t("the native DecisionEngine port is DECISION_PATH", cls(["native/ios/EnterpriseShell/Services/DecisionEngine.swift"]).matched.some((m) => m.category === "DECISION_PATH"));
  t("AppWorkflows port is DECISION_PATH", cls(["native/ios/EnterpriseShell/Services/AppWorkflows.swift"]).tier === "owner-gated");
  // A non-decision doc under lib is not caught by DECISION_PATH's blanket only if it is NOT under lib/ — lib/* is blanket, so this stays autonomous because it is a docs path.
  // Path-normalization bypasses must NOT launder an owner-gated file to autonomous.
  t("a leading ./ does not launder scripts/ to autonomous", cls(["./scripts/mutation-guard.mjs"]).tier === "owner-gated");
  t("a git a/ diff prefix does not launder scripts/ to autonomous", cls(["a/scripts/mutation-guard.mjs"]).tier === "owner-gated");
  t("a backslash separator does not launder scripts/ to autonomous", cls(["scripts\\mutation-guard.mjs"]).tier === "owner-gated");
  t("a normalized lib/ path is DECISION_PATH", cls(["b/lib/signalgrid-core/src/decision.ts"]).tier === "owner-gated");
  t("a roster-scoped doc is autonomous", cls(["docs/GLOSSARY.md"]).tier === "autonomous");

  // Finding 4 (Codex #1133 P1): .claude/workflows|hooks|settings.json are the landing
  // workflow, the Bash deny-list hook, and the deny list itself — a change touching
  // ONLY one of these used to classify 'other' and slip an autonomous merge past
  // exactly the surfaces meant to stop it.
  t(".claude/workflows/ change is SAFETY_MACHINERY", cls([".claude/workflows/land-branch.js"]).tier === "owner-gated");
  t(".claude/hooks/ change is SAFETY_MACHINERY", cls([".claude/hooks/deny-bash.mjs"]).tier === "owner-gated");
  t(".claude/settings.json change is SAFETY_MACHINERY", cls([".claude/settings.json"]).tier === "owner-gated");
  t(".claude/settings.local.json (not the deny list itself) is autonomous", cls([".claude/settings.local.json"]).tier === "autonomous");

  // Review nit on #1133: the two landing skills and .githooks/ govern how the lane
  // lands and what the pre-push hook enforces — same self-net class as
  // .claude/workflows/**, .claude/hooks/** and .claude/settings.json above.
  t(".claude/skills/landing-under-dr-037/ change is SAFETY_MACHINERY", cls([".claude/skills/landing-under-dr-037/SKILL.md"]).tier === "owner-gated");
  t(".claude/skills/orchestrator-over-workers/ change is SAFETY_MACHINERY", cls([".claude/skills/orchestrator-over-workers/SKILL.md"]).tier === "owner-gated");
  t(".githooks/ change is SAFETY_MACHINERY", cls([".githooks/pre-push"]).tier === "owner-gated");
  // Negative: an ordinary skill dir with no bearing on landing/lane-safety stays
  // autonomous — this rule is scoped to those three surfaces, not all of
  // .claude/skills/.
  t("an unrelated skill dir (.claude/skills/video-intake/) stays autonomous", cls([".claude/skills/video-intake/SKILL.md"]).tier === "autonomous");

  // A mixed diff with even one owner-gated file is owner-gated (the unsafe half wins).
  t("one owner-gated file taints an otherwise-autonomous diff",
    cls(["lib/signalgrid-core/src/decision.ts", "scripts/mutation-guard.mjs"]).tier === "owner-gated");

  // Codex round 4 on #1133 (P1, thread 4113330659): native test sources, measured
  // autonomous at 07d6f1ab, now classify SAFETY_MACHINERY.
  t("an Android unit-test source (src/test/) is SAFETY_MACHINERY",
    mostRestrictive(cls(["native/android/core/src/test/kotlin/com/signalgrid/assist/core/AssistWireTest.kt"])) === "SAFETY_MACHINERY");
  t("an iOS test-target source (a *Tests/ dir) is SAFETY_MACHINERY",
    mostRestrictive(cls(["native/ios/EnterpriseShellTests/AssistWireConformanceTests.swift"])) === "SAFETY_MACHINERY");
  t("a Rust test source (tests/) is SAFETY_MACHINERY",
    mostRestrictive(cls(["native/desktop/core/tests/conformance.rs"])) === "SAFETY_MACHINERY");
  t("an Android instrumented-test source (src/androidTest/) is SAFETY_MACHINERY",
    mostRestrictive(cls(["native/android/app/src/androidTest/java/x/FooTest.kt"])) === "SAFETY_MACHINERY");
  // Review sweep on #1133 (round 3): the two rules above missed Rust's OWN test
  // convention — inline #[cfg(test)] mod tests {} in an ordinary src file — see the
  // new rule above.
  t("native/desktop/core/src/wire.rs (inline #[cfg(test)] mod, 19 #[test] measured live) is SAFETY_MACHINERY",
    mostRestrictive(cls(["native/desktop/core/src/wire.rs"])) === "SAFETY_MACHINERY");
  t("firmware/dock/core/src/custody.rs (inline #[cfg(test)] mod, 20 #[test] measured live) is SAFETY_MACHINERY",
    mostRestrictive(cls(["firmware/dock/core/src/custody.rs"])) === "SAFETY_MACHINERY");
  // Review sweep on #1133 (round 4), finding 1: the src/-only rule above missed the
  // crate's own EXECUTED EXAMPLE — firmware/dock/core/examples/emit_fixtures.rs is the
  // entire input of the dock-contract gate (firmware.yml:114,118) and classified
  // autonomous before this fix.
  t("firmware/dock/core/examples/emit_fixtures.rs (the dock-contract gate's entire firmware input) is SAFETY_MACHINERY",
    mostRestrictive(cls(["firmware/dock/core/examples/emit_fixtures.rs"])) === "SAFETY_MACHINERY");
  t("native/desktop/app/build.rs stays autonomous (no #[cfg(test)], not read by any gate script or workflow step)",
    cls(["native/desktop/app/build.rs"]).tier === "autonomous");
  // Negative: a non-test file, and a doc NAMED like a test topic, must not over-match.
  t("a doc named TESTING.md stays autonomous (not swept in by the filename rule)",
    cls(["TESTING.md"]).tier === "autonomous");
  t("an ordinary native source file (not under a test dir, not test-suffixed) stays autonomous",
    cls(["native/ios/EnterpriseShell/Services/SignalContext.swift"]).tier === "autonomous");
  // Negative: native/shared vectors keep their EXISTING class (the pre-existing
  // "gate inputs outside scripts/" rule), unaffected by the two new rules above.
  t("native/shared/assist-wire-conformance.json keeps its existing SAFETY_MACHINERY class",
    mostRestrictive(cls(["native/shared/assist-wire-conformance.json"])) === "SAFETY_MACHINERY");
  // Negative: the SAME convention outside native/ is not caught by these two NATIVE
  // rules specifically — proves the `^native\/` anchor is load-bearing, not decorative.
  // Review fixes on the round-4 changes (#1133): this used to illustrate the point with
  // artifacts/mcp-server/test/server.test.ts, which the product-test rule above now
  // gates for an unrelated reason — a bad example once it stopped being autonomous
  // OVERALL. Repointed at a path that stays genuinely autonomous end to end (vendored,
  // and in TEST_SOURCE_EXCLUSIONS below) so this still proves the anchor, not a stale
  // reason.
  t("an out-of-scope test file outside native/ is not caught by the new native rules (third_party/cli-anything/tests/test_skill_generator.py)",
    cls(["third_party/cli-anything/tests/test_skill_generator.py"]).tier === "autonomous");
  // Positive (review fixes on the round-4 changes, #1133): the gap the round-4 negative
  // above used to assert was CORRECT — server.test.ts is the entire "MCP server unit
  // tests" gate (preflight.mjs:604, review-hub-ci.yml:1041) and classified autonomous.
  t("artifacts/mcp-server/test/server.test.ts is SAFETY_MACHINERY (the whole input of the MCP server unit-tests gate)",
    mostRestrictive(cls(["artifacts/mcp-server/test/server.test.ts"])) === "SAFETY_MACHINERY");
  t("artifacts/signalgrid-app/src/lib/policyTests.test.ts is SAFETY_MACHINERY (part of the Console unit-tests gate)",
    mostRestrictive(cls(["artifacts/signalgrid-app/src/lib/policyTests.test.ts"])) === "SAFETY_MACHINERY");
  t("artifacts/signalgrid-app/src/lib/facilityGraphLayout.test.ts is SAFETY_MACHINERY (part of the Console unit-tests gate)",
    mostRestrictive(cls(["artifacts/signalgrid-app/src/lib/facilityGraphLayout.test.ts"])) === "SAFETY_MACHINERY");
  t("the 4 artifacts/api-server/test/ files stay DECISION_PATH (the new product-test rule also matches them, harmlessly — DECISION_PATH still wins)",
    ["artifacts/api-server/test/api.test.mjs", "artifacts/api-server/test/load.test.mjs", "artifacts/api-server/test/oidc.test.mjs", "artifacts/api-server/test/route-stack-dump.mjs"]
      .every((f) => mostRestrictive(cls([f])) === "DECISION_PATH"));

  // The independent TREE GUARD (findUngatedNativeTestSources): a pure function over a
  // file list, so these run hermetically with no git and no real files.
  t("looksLikeTestSource recognizes all four measured Codex paths",
    ["native/android/core/src/test/kotlin/com/signalgrid/assist/core/AssistWireTest.kt",
     "native/ios/EnterpriseShellTests/AssistWireConformanceTests.swift",
     "native/desktop/core/tests/conformance.rs",
     "native/android/app/src/androidTest/java/x/FooTest.kt"].every(looksLikeTestSource));
  t("looksLikeTestSource does not flag TESTING.md",
    !looksLikeTestSource("TESTING.md"));
  t("the guard finds nothing ungated among the four measured paths now that they are fixed",
    findUngatedNativeTestSources([
      "native/android/core/src/test/kotlin/com/signalgrid/assist/core/AssistWireTest.kt",
      "native/ios/EnterpriseShellTests/AssistWireConformanceTests.swift",
      "native/desktop/core/tests/conformance.rs",
      "native/android/app/src/androidTest/java/x/FooTest.kt",
    ]).length === 0);
  // Positive: a planted native test path that matches the BROAD test conventions (a
  // Python test file, "test_*.py") but neither of the two manifest regexes above (which
  // only name kt/java/swift/rs) must still be flagged — this is the guard doing work
  // the hand-written manifest rules do not, exactly the "next test directory" case the
  // finding asked for. Hermetic: no file is written, `native/toolkit/` need not exist.
  t("the guard flags a planted native test path no manifest rule covers (native/toolkit/scripts/test_helper.py)",
    (() => {
      const planted = "native/toolkit/scripts/test_helper.py";
      return looksLikeTestSource(planted) &&
        classifyDiff([planted]).tier === "autonomous" &&
        findUngatedNativeTestSources([planted]).length === 1 &&
        findUngatedNativeTestSources([planted])[0] === planted;
    })());
  // Negative: the guard itself must not over-match — a non-test native file stays alone.
  t("the guard does not flag an ordinary native source file",
    findUngatedNativeTestSources(["native/ios/EnterpriseShell/Services/SignalContext.swift"]).length === 0);
  // Review sweep on #1133 (round 3): findUngatedInlineRustTests is pure over (path,
  // text) pairs — no disk, so the planted-file case (the same "next test directory"
  // proof as the Python one above, one layer deeper) is provable hermetically.
  t("the content probe flags a planted Rust file with an inline #[cfg(test)] module no manifest rule covers (native/x/src/lib.rs)",
    findUngatedInlineRustTests([
      { path: "native/x/src/lib.rs", text: "#[cfg(test)]\nmod tests {\n    #[test]\n    fn it_works() {}\n}\n" },
    ]).length === 1);
  t("the content probe does not flag a .rs file with no #[cfg(test)] in it",
    findUngatedInlineRustTests([
      { path: "native/x/src/lib.rs", text: "pub fn add(a: i32, b: i32) -> i32 { a + b }\n" },
    ]).length === 0);
  t("the content probe agrees with the manifest — a real inline-tested crate file is not double-flagged (already SAFETY_MACHINERY)",
    findUngatedInlineRustTests([
      { path: "native/desktop/core/src/wire.rs", text: "#[cfg(test)]\nmod tests {}\n" },
    ]).length === 0);
  // Review fixes on the round-4 changes (#1133): the guard is now REPO-WIDE (no more
  // `f.startsWith("native/")` filter) — this used to prove the OLD native/-only scope by
  // pointing at server.test.ts and expecting it untouched; now that the manifest gates
  // server.test.ts directly, that is no longer a guard-scope question for this file. The
  // guard-scope question is TEST_SOURCE_EXCLUSIONS instead: does the guard correctly
  // leave the six genuinely-out-of-scope families alone even though it now looks at the
  // WHOLE tree, not just native/.
  t("the guard does not flag a vendored third_party/ test file",
    findUngatedNativeTestSources(["third_party/cli-anything/tests/test_skill_generator.py"]).length === 0);
  t("the guard does not flag a k6 load driver under tests/load/",
    findUngatedNativeTestSources(["tests/load/location-report.js"]).length === 0);
  t("the guard does not flag the two named skill-directory files",
    findUngatedNativeTestSources([
      ".claude/skills/ios-simulator-skill/scripts/test_recorder.py",
      ".claude/skills/node/rules/assets/graceful-server.test.ts",
    ]).length === 0);
  // The comprehensive proof (mirrors "the guard finds nothing ungated among the four
  // measured paths" above, now repo-wide): all NINE tracked files the repo-wide sweep
  // found autonomous at 07d6f1ab are accounted for — three by the new manifest rule,
  // six by TEST_SOURCE_EXCLUSIONS — so the real `git ls-files` run this same function
  // backs (checkNativeTestSourcesGated) finds nothing left to flag.
  t("the guard finds nothing ungated among the nine repo-wide measured paths now that they are fixed",
    findUngatedNativeTestSources([
      "artifacts/mcp-server/test/server.test.ts",
      "artifacts/signalgrid-app/src/lib/policyTests.test.ts",
      "artifacts/signalgrid-app/src/lib/facilityGraphLayout.test.ts",
      "tests/load/location-report.js",
      "tests/load/session-start.js",
      "tests/load/webhooks.js",
      "third_party/cli-anything/tests/test_skill_generator.py",
      ".claude/skills/ios-simulator-skill/scripts/test_recorder.py",
      ".claude/skills/node/rules/assets/graceful-server.test.ts",
    ]).length === 0);

  // Completeness sweep on #1133 (round 2): `.bru$` joined TEST_CONVENTION_NAME_RE
  // (above) specifically so the tree guard sees both Bruno families — prove the
  // convention itself recognizes the shape, then that the guard finds nothing left
  // ungated across a representative sample of both (requests, config/plumbing,
  // README, bruno.json, an environments file), mirroring the nine-path proof above.
  t("looksLikeTestSource recognizes a .bru request", looksLikeTestSource("artifacts/api-collection/v1/evaluate-decision.bru"));
  t("looksLikeTestSource recognizes a lab-collections .bru request", looksLikeTestSource("artifacts/lab-collections/wazuh/agents-list.bru"));
  t("the guard finds nothing ungated among the Bruno families now that they are fixed",
    findUngatedNativeTestSources([
      "artifacts/api-collection/health/healthz.bru",
      "artifacts/api-collection/negative-tests/malformed-evaluate.bru",
      "artifacts/api-collection/adversarial-trust/stale-evidence.bru",
      "artifacts/api-collection/environments/Local.bru",
      "artifacts/api-collection/collection.bru",
      "artifacts/lab-collections/fleet/hosts-list.bru",
      "artifacts/lab-collections/README.md",
      "artifacts/lab-collections/microsoft-graph/bruno.json",
    ]).length === 0);
  // Positive: a Bruno request under a folder NAME neither Bruno rule above lists (a
  // hypothetical new api-collection lane) still gets caught by the guard's general
  // backstop — the same "next test directory" proof the native planted-path case
  // above makes, now for this family. Hermetic: no file is written.
  t("the guard flags a planted Bruno request under an unlisted new folder (artifacts/api-collection/staging-lab/new-case.bru)",
    (() => {
      const planted = "artifacts/api-collection/staging-lab/new-case.bru";
      return looksLikeTestSource(planted) &&
        classifyDiff([planted]).tier === "autonomous" &&
        findUngatedNativeTestSources([planted]).length === 1 &&
        findUngatedNativeTestSources([planted])[0] === planted;
    })());

  // Completeness sweep on #1133 (round 2): the tree guard's own vacuity floor —
  // a convention regex regressed to matching nothing must not read as a clean sweep.
  t("the vacuity floor fires when nothing tracked looks like a test source by any convention (a broken regex must not read as 'all clear')",
    noTestSourcesFoundAtAll(["lib/signalgrid-core/src/decision.ts", "docs/GLOSSARY.md", "scripts/preflight.mjs"]));
  t("the vacuity floor does not fire while at least one real test-source shape is present",
    !noTestSourcesFoundAtAll(["lib/signalgrid-core/src/decision.ts", "native/android/core/src/test/kotlin/com/signalgrid/assist/core/AssistWireTest.kt"]));
  t("the vacuity floor does not fire on a single Bruno request alone (the new convention counts too)",
    !noTestSourcesFoundAtAll(["artifacts/api-collection/health/healthz.bru"]));
  t("an empty file list is vacuous", noTestSourcesFoundAtAll([]));

  // Non-vacuity: both lists carry rules, so the gate has a subject.
  t("all three manifests are non-empty", DECISION_PATH.length > 0 && SAFETY_MACHINERY.length > 0 && OWNER_RESERVED.length > 0);

  // mostRestrictive() ordering (Codex finding 7 follow-up, docs/BUILD_BACKLOG.md
  // "land-branch.js's Owner decision needed text should be derived from the changed
  // paths"): the CLI's --classify-branch prints exactly this function's verdict.
  t("scripts/ + lib/signalgrid-core → DECISION_PATH beats SAFETY_MACHINERY",
    mostRestrictive(cls(["scripts/mutation-guard.mjs", "lib/signalgrid-core/src/decision.ts"])) === "DECISION_PATH");
  t("…plus the launch profile → OWNER_RESERVED beats both",
    mostRestrictive(cls(["scripts/mutation-guard.mjs", "lib/signalgrid-core/src/decision.ts", "docs/LAUNCH_PROFILE.md"])) === "OWNER_RESERVED");
  t("docs-only diff → other", mostRestrictive(cls(["docs/GLOSSARY.md"])) === "other");
  t("scripts/-only diff → SAFETY_MACHINERY beats other", mostRestrictive(cls(["scripts/mutation-guard.mjs"])) === "SAFETY_MACHINERY");

  // Codex round 2 on #1133 (2026-09-26) P1, finding 4 (second half): re-derive the
  // owner-reserved gate scripts' own LOCAL imports AT TEST TIME, from their real source
  // on disk — not from the hardcoded list above. A future import added to any of these
  // four gate scripts (or one level further, off whatever they import) must classify
  // OWNER_RESERVED itself, or this self-test fails; it does not just prove today's four
  // files are correct, it re-proves the property every time preflight/CI run it.
  {
    const RELATIVE_IMPORT_RE = /from\s+["'](\.\.?\/[^"']+)["']/g;
    const localImportsOf = (relFile) => {
      const abs = resolve(repo, relFile);
      let src;
      try { src = readFileSync(abs, "utf8"); } catch { return []; }
      const dir = dirname(abs);
      return [...src.matchAll(RELATIVE_IMPORT_RE)]
        .map((m) => resolve(dir, m[1]))
        .map((p) => p.slice(repo.length + 1).replace(/\\/g, "/"));
    };
    const GATE_SCRIPTS = [
      "scripts/check-launch-claims.mjs",
      "scripts/check-publication-boundary.mjs",
      "scripts/publication-boundary.mjs",
      "scripts/check-launch-profile.mjs",
    ];
    // Review sweep on #1133, finding 8 (should-fix): localImportsOf() swallows a read
    // error and returns [] — a gate script renamed or deleted out from under this list
    // would silently drop its (and its own imports') local helpers from the derived
    // set instead of failing the self-test. Prove each one still exists and is
    // readable BEFORE deriving imports from it, so that failure mode is loud, not
    // silent.
    for (const g of GATE_SCRIPTS) t(`gate script ${g} exists and is readable`, existsSync(resolve(repo, g)));
    // One level of transitivity (finding 4's instruction): the gate scripts' direct
    // imports, then those files' OWN direct imports — never further than that.
    const level1 = new Set(GATE_SCRIPTS.flatMap(localImportsOf));
    const level2 = new Set([...level1].flatMap(localImportsOf));
    const derived = new Set([...level1, ...level2]);
    t("re-derived import scan found at least one local helper (the scan itself is not vacuous)", derived.size > 0);
    for (const imp of [...derived].sort()) {
      t(`re-derived import ${imp} (of an owner-reserved gate script, within one level) classifies OWNER_RESERVED`, mostRestrictive(cls([imp])) === "OWNER_RESERVED");
    }
  }

  // --classify-branch itself, over a real git diff (finding 1): renaming an
  // owner-gated file out of its gated location, a non-ASCII lib/ path, an up-to-date
  // branch, and a bad ref.
  withTempRepo((dir) => {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "LAUNCH_PROFILE.md"), "profile\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "feature"]);
    execFileSync("git", ["-C", dir, "mv", "docs/LAUNCH_PROFILE.md", "docs/OLD_PROFILE.md"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "rename the launch profile away"]);
    const res = runClassifyBranchCli(dir, "main");
    t("--classify-branch: renaming an owner-reserved file away is not laundered to other by git's default rename detection", res.code === 0 && res.stdout.startsWith("KLASS OWNER_RESERVED"));
  });

  withTempRepo((dir) => {
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "placeholder.ts"), "export {};\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "feature"]);
    writeFileSync(join(dir, "lib", "décision.ts"), "export const x = 1;\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "add a non-ascii decision-path file"]);
    const res = runClassifyBranchCli(dir, "main");
    t("--classify-branch: a non-ASCII lib/ path is not C-quoted past the manifest", res.code === 0 && res.stdout.startsWith("KLASS DECISION_PATH"));
  });

  withTempRepo((dir) => {
    writeFileSync(join(dir, "f.txt"), "x\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    const res = runClassifyBranchCli(dir, "main"); // HEAD already at main: empty diff
    t("--classify-branch: an up-to-date branch (empty diff) is KLASS ERROR at exit 2", res.code === 2 && res.stdout.startsWith("KLASS ERROR"));
  });

  withTempRepo((dir) => {
    writeFileSync(join(dir, "f.txt"), "x\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    const res = runClassifyBranchCli(dir, "does-not-exist-ref");
    t("--classify-branch: a bad base ref is KLASS ERROR at exit 2", res.code === 2 && res.stdout.startsWith("KLASS ERROR"));
  });

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// Codex round 4 on #1133 (P1, thread 4113330659): the TREE GUARD itself, run by the
// plain (non-self-test) `node scripts/check-owner-gated-surfaces.mjs` invocation that
// preflight and CI already call. Walks the REAL tree (`git ls-files`, not a fixture)
// so a test source added later — one the SAFETY_MACHINERY rules above were never
// updated for — fails this gate by name instead of silently merging autonomous. Repo-wide
// as of the review fixes on the round-4 changes (#1133); see findUngatedNativeTestSources.
function checkNativeTestSourcesGated() {
  let files;
  try {
    files = execFileSync(
      "git",
      ["-C", repo, "-c", "core.quotePath=false", "ls-files", "-z"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .split("\0")
      .filter((l) => l.length > 0);
  } catch (err) {
    console.error(`tree guard: git ls-files failed: ${firstLine(err.stderr || err.message)}`);
    process.exit(1);
  }
  // Vacuity floor (completeness sweep on #1133, round 2): a convention regex that
  // regressed to matching nothing would make the loop below find zero candidates and
  // print nothing wrong — indistinguishable from a genuinely clean sweep. Fail loudly,
  // by name, before that happens.
  if (noTestSourcesFoundAtAll(files)) {
    console.error(
      "tree guard: zero tracked files look like a test source by ANY convention (TEST_CONVENTION_DIR_RE / " +
        "TEST_CONVENTION_NAME_RE) — that is a regressed regex, not a clean tree; refusing to report " +
        "'nothing ungated' from an empty candidate set.",
    );
    process.exit(1);
  }
  const ungated = findUngatedNativeTestSources(files);
  if (ungated.length > 0) {
    console.error(
      "tree guard: test source(s) classify autonomous — add or widen a SAFETY_MACHINERY rule, or a TEST_SOURCE_EXCLUSIONS entry, for:",
    );
    for (const f of ungated) console.error(`  ${f}`);
    process.exit(1);
  }
  // Review sweep on #1133 (round 3): the content probe — findUngatedInlineRustTests
  // needs the FILE TEXT, not just the path, so it cannot ride the path-only sweep
  // above. Reads every tracked `.rs` file straight off disk (git ls-files already
  // proved it is tracked; a file deleted between listing and reading is simply not a
  // gate input any more, so a read failure there is not this guard's problem).
  const rustFiles = files.filter((f) => f.endsWith(".rs"));
  const rustPairs = rustFiles.map((f) => {
    let text = "";
    try {
      text = readFileSync(resolve(repo, f), "utf8");
    } catch {
      // Deleted or unreadable between the ls-files snapshot and here — nothing to probe.
    }
    return { path: f, text };
  });
  const ungatedRust = findUngatedInlineRustTests(rustPairs);
  if (ungatedRust.length > 0) {
    console.error(
      "tree guard: tracked *.rs file(s) hold an inline #[cfg(test)] module but classify autonomous — add or widen a SAFETY_MACHINERY rule for:",
    );
    for (const f of ungatedRust) console.error(`  ${f}`);
    process.exit(1);
  }
}

function validate() {
  // At rest there is no diff to classify; the gate proves the manifest is well-formed
  // and non-vacuous so a later empty manifest cannot silently classify everything
  // autonomous. The behaviour is proven by --self-test, which preflight also runs.
  if (DECISION_PATH.length === 0 || SAFETY_MACHINERY.length === 0 || OWNER_RESERVED.length === 0) {
    console.error("owner-gated manifest is empty — every diff would classify autonomous. Refusing.");
    process.exit(1);
  }
  for (const p of [...DECISION_PATH, ...SAFETY_MACHINERY, ...OWNER_RESERVED]) {
    if (!(p.re instanceof RegExp) || typeof p.rule !== "string" || !p.rule) {
      console.error(`malformed manifest entry: ${JSON.stringify(p)}`);
      process.exit(1);
    }
  }
  checkNativeTestSourcesGated();
  console.log(`Owner-gated surfaces manifest ok — ${DECISION_PATH.length} decision-path rules, ${SAFETY_MACHINERY.length} safety-machinery rules, ${OWNER_RESERVED.length} owner-reserved rules.`);
  console.log("Run with --self-test to exercise classifyDiff (preflight + CI do).");
}

// Guarded so this module can be IMPORTED for classifyDiff (e.g. by the brain cycle)
// without running its CLI as a side effect. Direct invocation is unchanged.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const classifyIdx = process.argv.indexOf("--classify-branch");
  if (classifyIdx !== -1) {
    const baseRef = process.argv[classifyIdx + 1];
    if (!baseRef) {
      console.log("KLASS ERROR --classify-branch requires a <base-ref> argument");
      process.exit(2);
    }
    classifyBranch(baseRef);
  } else if (process.argv.includes("--self-test")) selfTest();
  else validate();
}

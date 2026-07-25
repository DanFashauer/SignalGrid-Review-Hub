# Self-review — a second reviewer before every push

SignalGrid catches defects with a layered check-and-balance so that a change is
**proven correct before it is pushed**, not after. Codex reviews the PR *after*
the push; these two layers run *before* it, so the first version is the right
version and Codex has less to find.

## The two layers

### 1. Mechanical — `pnpm run preflight`
Runs the **entire CI gate suite locally** in one command — a complete mirror of
all three CI jobs (validation, docs-sanity, supply-chain): the invariant
reviewer, docs sanity (required docs + unsafe-claim scan), typecheck, build,
every proof, the API integration test, the safety gate, Postman/spec sync, and
the CycloneDX SBOM sync. A green preflight means CI will be green.

```
pnpm run preflight          # full suite — what CI runs
pnpm run preflight --quick  # skip the heavy web/app builds for a fast loop
```

It stops at the first failing gate and prints the failing output, so there is no
guessing about what broke.

#### Decision-quality evals — `pnpm run proof:fabric-evals`

Each connector's proof checks *one* dimension's logic in isolation. The
**fabric decision-evals** are the layer above: a curated golden set of end-to-end,
multi-signal scenarios (a leftover SSO session on an attested-hardened device, a
proven-compromised endpoint, worst-of-four concurrent negatives, …) scored against
the **fused** outcome — the composed risk verdict *and* the routed incident. It
catches cross-fabric "decision drift" no single-connector proof can: a change that
quietly lets one dimension dilute another, mis-orders worst-concern-wins, or
mis-routes the top driver passes every connector proof yet fails here. Beyond
matching each scenario, it enforces two fabric-wide invariants computed
independently of the fixtures — *fail-safe* (any signal beyond monitoring ⟹ never
the healthy `ok` tier) and *worst-concern-wins* (the fused action is exactly the
most-severe signal's) — so a regression surfaces as a nonzero violation count, not
a silently-wrong verdict.

#### Allow-path grant-safety — `pnpm run proof:grant-safety`

The fabric's most safety-critical output is the **allow** verdict — a connector
emitting action `none`. The recurring defect class this repo's reviews keep
catching is an *unknown / missing / malformed / self-contradictory* input reaching
that grant (an unknown enum read as "clean", a `null` sub-signal trusted as "yes").
A hand-picked fixture set can miss the exact hole.

`scripts/src/lib/grant-safety.ts` is a shared harness that **brute-forces the
entire normalized input space** of a connector (the cartesian product of every
field's candidate values — including the malformed/unknown sentinels the
normalizer can produce) and asserts action `none` is emitted for **exactly** the
states the proof declares positively-confirmed clean, and for nothing else. The
clean predicate is written from the connector's *intended* positive-confirmation
contract, independent of the code, so a real allow-path hole surfaces as a nonzero
mismatch rather than being silently re-described. `proof:grant-safety` is the
harness's own self-proof: alongside a correct predicate it runs **negative
controls** (deliberately too-strict / too-loose predicates, and a grant that fails
its confirmation invariant) and asserts each is *caught* — proving the enumeration
detects holes rather than always passing.

Connectors whose full allow-path is currently constrained this way (mismatches=0
over the full product): **oauth-consent** (6,480), **sso-session** (768),
**access-governance** (4,500), **ot-posture** (324), **token-binding** (1,296),
**pacs-access** (8,100), **agent-identity** (17,280 normalized + 870,912 raw + a parse-fidelity pass over the raw space),
**device-management-health** (864 normalized + 21,168 raw + a parse-fidelity pass). These are the enum-field
"trust grant" dimensions where
the unknown-reaches-grant class is most acute; new connectors adopt the harness
from the start.
The remaining grant-emitting connectors are a tracked follow-up: the
list-aggregation dimensions (`credential-exposure`, `data-protection`,
`edr-threat`, `vuln-scan`, `peripheral-control`, `identity-risk`) grant only on an
*empty* qualifying-findings list and need a list-shaped enumeration rather than a
scalar product; `device-attestation` already ships a bespoke conflict-consistency
proof; and `macos-posture`, `network-nac`, `rtls-custody`, and `location-services`
are queued for the same treatment (network-nac's unknown-freshness grant is
flagged there as a candidate to tighten). Scoping is explicit here so coverage is
never mistaken for complete.

#### One command across both repos — `pnpm run verify:all`

The macOS device-trust signals come from the companion open-source
[`signalgrid-mcp`](https://github.com/DanFashauer/signalgrid-mcp) server, which
lives in its own repo (the public/private boundary stays intact — see
[IP_AND_LICENSING](IP_AND_LICENSING.md)). `verify:all` runs **both** halves in one
shot: the Review-Hub `preflight` above, then the MCP server's `pytest`, tied
together by the shared **posture-report contract**
(`lib/integrations/src/integrations/macos-posture/contract/posture-report.contract.json`).
The Review-Hub side proves the `macos-posture` connector consumes that report
shape; the MCP side proves its `signalgrid_posture_report` still emits it — so a
change on either side that would break the other fails a gate instead of drifting
silently.

```
pnpm run verify:all                 # finds signalgrid-mcp as a sibling clone
SIGNALGRID_MCP_PATH=/path pnpm run verify:all   # or point it explicitly
pnpm run verify:all --require-mcp   # fail (don't skip) if the MCP checkout is absent
```

If the MCP checkout isn't found it prints how to get it and continues with the
Review-Hub side. Each repo's own CI still guards its half of the contract
independently; `verify:all` is the local convenience that runs the pair together.

### 2. Adversarial — the invariant reviewer + an agent read
`pnpm run review:invariants` is a deterministic, dependency-free "second
reviewer" that encodes the classes of defect this repo's reviews keep catching,
so they fail the build instead of shipping:

| Invariant | What it enforces | Lesson it encodes |
|---|---|---|
| **Fail-closed control flow** | every `switch` in the decision / gating / planner libs has a `default:` arm | Codex #70 — an unrecognized outcome fell through to *allow* |
| **Determinism** | no `Date.now` / `Math.random` in the pure planner libs | the decision core must be replayable from fixtures |
| **Assist invariant** | no app-workflow action is `critical` yet non-sensitive | a high-consequence action must always require confirmation |
| **Truth guard** | an extensible denylist of internal over-claims that contradicted the code | Codex #79 — "every catalog gates live" when one vertical is catalog-only |
| **Public-safe web** | no third-party vendor host (fonts / analytics / CDN) in a published web artifact | Codex #81 — the marketing site loaded fonts from a Google CDN |

The invariant reviewer is a *floor*, not a ceiling. For anything non-trivial,
also do an **adversarial agent review of the diff before pushing** — read the
change as a skeptic trying to break it, with these questions:

- **Fail closed?** Does every unrecognized / missing / conflicting input degrade
  to the *most restrictive* outcome? Is there any path where a sensitive action
  runs without confirmation?
- **Truthful?** Does every comment, doc, and UI label match what the code
  actually does? No "every / all / always" that the code doesn't guarantee; no
  past-tense "done" wording for something that is only *proposed* or *simulated*.
- **Public-safe?** No secrets, PHI/PII, real vendor/product names, or live
  vendor calls. Fixtures are deterministic.
- **Boundary honest?** Is the approval / simulation / step-up boundary visible
  and un-bypassable? The product API never releases a held action from a
  request-supplied signal.
- **Proven?** Is there a passing proof/test that exercises the new behavior end
  to end — including the failure and fail-closed paths, not just the happy path?

## The checklist before opening a PR

1. `pnpm run preflight` is green (or `--quick` during the loop, full before push).
2. The change has a proof/test that covers its **failure** paths, not just success.
3. An adversarial read of the diff against the questions above found nothing.
4. Docs / comments / labels updated to stay true to the code.
5. One reviewable concern per PR.

When all five hold, push. Codex becomes a confirmation, not a rework loop.

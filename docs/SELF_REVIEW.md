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
**device-management-health** (21,600 normalized + 1,354,752 raw + a parse-fidelity pass),
**link-usability** (6,480 normalized + 217,728 raw + a parse-fidelity pass). These are the enum-field
"trust grant" dimensions where
the unknown-reaches-grant class is most acute; new connectors adopt the harness
from the start.

Two of them also pin the NUMBER of granting shapes, not just the absence of
mismatches: `device-management-health` and `link-usability` at exactly three each,
**over their enumerated wire spaces**. A mismatch count of zero proves the grant
path admits nothing unconfirmed; it does not prove the path stayed as narrow as it
was designed to be, because widening the clean predicate and widening the
implementation together stays at zero. Pinning the count makes an extra route into
the grant a test failure rather than a silent widening. The scope qualifier is not
decoration: `link-usability`'s own proof asserts a route *outside* its enumeration,
where a Proxy that lies in `ownKeys` while still answering
`getOwnPropertyDescriptor` keeps its values readable and grants.

`link-usability` reached three the hard way, and the episode is the argument for
pinning the count at all. It shipped granting **six** shapes; adversarial review
confirmed the count was correct and then asked what the six *were*, and found three
of them self-contradictory — a report asserting no roaming domain exists while also
reporting observed roaming behaviour. Counting the grants is necessary and not
sufficient; someone still has to read them.

Both connectors carry a mutation-test record. On `device-management-health`, 11
deliberate weakenings were applied and reverted, every one caught — two of them had
previously left the proof green. On `link-usability`, review ran 65; 62 were killed,
and the three survivors were the real findings, now fixed. A follow-up pass of seven
targeted mutations killed four and left three that are **inert at current
severities** — a contradiction candidate already outranks what they guard — and
those three are labelled as such in the source rather than left looking
load-bearing.

The remaining grant-emitting connectors are a tracked follow-up: the
list-aggregation dimensions (`credential-exposure`, `data-protection`,
`edr-threat`, `vuln-scan`, `peripheral-control`, `identity-risk`) grant only on an
*empty* qualifying-findings list and need a list-shaped enumeration rather than a
scalar product; `device-attestation` already ships a bespoke conflict-consistency
proof; and `macos-posture`, `network-nac`, `rtls-custody`, and `location-services`
are queued for the same treatment (network-nac's unknown-freshness grant is
flagged there as a candidate to tighten). Scoping is explicit here so coverage is
never mistaken for complete.

#### Two guards built from failures this repo actually had

Both of these exist because something went wrong here, not because they seemed like good
practice. Each is stated with the failure it was built against, so a future reader can
judge whether it is still earning its place.

**`pnpm run guard:mutations` — is each guard falsifiable by its own proof?**

The grant-safety enumeration reports 0 mismatches for every connector, and that proves a
real thing: no unknown, missing or malformed input reaches a grant. It does not prove that
each individual condition is doing work, and the two are easy to confuse. The reason is
structural — grant-safety observes only grant-ness, and every malformed value already
normalizes to a denying sentinel, so deleting an integrity condition changes
`reportIntegrity` and changes no action. The enumeration stays green while the condition
is load-bearing and unproven.

Two adversarial reviews each found exactly that. In `device-management-health`, two of
three terms in the channel-consistency guard could be deleted with the proof green. In
`link-usability`, three conditions survived and the branch they guarded turned out to be
**dead** — its candidate won zero times out of 360 opportunities, so an asserted "this
device is not on the network" was being reported as a generic unknown. Both were caught
because a reviewer thought to try mutation testing. That is not a control; it is luck with
good habits.

The guard mutates each condition in a registered file, runs that proof under a timeout,
and fails on any survivor. Current sweep: **500 mutations, 460 killed, 40 documented-inert,
0 survivors.** The timeout is not incidental — deleting `MAX_PROTOTYPE_DEPTH` makes the
proof *hang* rather than fail, because the walk meets a Proxy returning a fresh prototype
from every `getPrototypeOf`; in CI that failure mode burns a job's whole budget instead of
going red, so hangs are detected and reported separately.

The gate is "no NEW survivors", not "zero survivors". Some conditions are genuinely inert
at current severities — a contradiction candidate already outranks what they guard — and
are kept because they encode the rule and become load-bearing the moment a severity moves.
Those carry an allowlist entry with a checkable reason, and are labelled inert in the
source. **An allowlist entry that stops matching fails the gate**: the code moved and
nobody re-derived whether the justification still holds.

That leaves one judgement the guard cannot make for you. A survivor is *either* inert
*or* real-behaviour-with-no-test, and it looks identical either way — the proof passed, and
that is all the guard observes. Deciding by reading the code is exactly the reasoning that
put the untested condition there in the first place, so the four survivors in the most
recent sweep were each classified by **behavioural diff** instead: apply the mutation, dump
the FULL output over the connector's whole input space, and compare. `oauth-consent`'s
`grants === "none"` term changed zero of 6,480 enumerated verdicts; the two `!plain` terms
and the `readThrew` term in `dual-control`'s normalizers changed zero of 239 hostile shapes
(non-objects, `Object.prototype`, a `getPrototypeOf` Proxy, throwing accessors, and every
field-corruption crossed pair). All four are genuinely inert — each is caught downstream by
a per-field check before the term can matter — and all four are kept as defence in depth,
because they state the rule directly rather than relying on a downstream check to imply it.
The allowlist entries record the diff, so the next reader can re-run the reason rather than
take it on trust.

It found real gaps immediately, including in code written an hour earlier: 13 of 19
mutations survived in `verdict-attestation` on first run. Most were type checks whose
deletion changed the failure *reason* but not the refusal — a numeric `keyId` still fails,
just as `unknown_key` instead of `envelope_malformed`, sending an operator hunting a key
rotation problem that does not exist. Asserting the reason rather than the refusal made
them load-bearing.

**The blind spot neither guard covers: is this the right input space?**

Both guards above aim at the same target from different sides. Grant-safety asks whether
the mapping from input to verdict is correct; the mutation guard asks whether each
condition in that mapping is load-bearing. Neither asks whether the *space being
enumerated* is the space that decides the question — and that gap stays invisible
precisely because the enumeration is green.

`passkey-assurance` is the clean example, because the failure and the proof of its absence
sat side by side. Its enumeration sweeps a large normalized state space and a larger
hostile-wire one with zero mismatches, and every state in both is a *single credential*.
The question the dimension actually answers is about an identity, and an identity's answer
needs one thing the enumeration has no axis for: whether the credential set it was handed
is the whole set. A caller could confirm an identity by supplying two flawless credentials
and saying nothing about the other three. Nothing in the sweep could notice, because "is
this every credential?" is not a value any credential carries.

The shape generalizes. An enumeration is only ever as wide as the axes someone thought to
put in it, so it is strong at *"is the ladder right"* and structurally blind to *"is this
the right ladder"*. Adding states does not help; adding an axis does — and knowing which
axis is missing is exactly the thing the harness cannot tell you. Three findings that
produced this dimension's current shape were of that kind (a missing identity reference, a
substituted credential, an unproven-complete set), and all three came from a reviewer
reading the contract rather than from the sweep.

So the honest statement of what a green enumeration buys: **no unknown, missing or
malformed value reaches a grant, over the axes enumerated.** The trailing clause is not
hedging. It is the whole of what review still has to do, and it does not shrink as the
state count grows.

**`pnpm run guard:registries` — are the guards' own coverage lists honest?**

Both guards above carry a hand-maintained list of what they cover, which is the same shape
as the defect that produced them: `incident-playbook-proof` restated `SignalKind` by hand
and drifted five kinds behind. Deriving `SignalKind` from a runtime array fixed that list
and immediately created two more.

The uncomfortable version: **a guard whose coverage list is stale is worse than no guard**,
because it reports success over the part it has stopped looking at. `guard:mutations`
printing "0 survivors" says nothing about a connector nobody added to its targets.

So the expected coverage is derived from the code. Any proof importing
`enumerateGrantSafety` is enumerating an allow path and must be registered with the
mutation guard or excluded with a reason; any proof printing a `figures=` line must be
registered with the figure guard. A registration naming a proof that no longer exists is
drift in the other direction and also fails. Negative-controlled both ways: dropping a
connector from the registry fails, and so does adding a brand-new allow-path proof nobody
registered.

What it reports today is worth stating plainly rather than burying: **20 proofs enumerate
an allow path, 19 are under the mutation guard, and none are QUEUED.** The one that is not
a target is `proof:grant-safety` itself — it IS the harness, with no normalizer or
evaluator to mutate, and it already ships its own negative controls. The QUEUED list is
empty for the first time; while it was not, those proofs were named individually in the
output every time the check ran, because partial coverage announced every run is a very
different thing from partial coverage that looks complete. The list is worth keeping in
the output for the next gap rather than deleting now that it happens to be empty.

**`pnpm run guard:figures` — is a number stated as a measurement still one?**

`check-proof-counts` already guards the `(N checks)` a doc advertises. The numbers that
actually carry the argument are the others — how large a space was enumerated, how many
states grant — and those went stale three times in one working session: pre-split figures
quoted against a space 64× larger; a PR body advertising counts that had moved; and
`SELF_REVIEW` saying `link-usability` pins "exactly six" granting shapes, which went stale
*inside the pull request that made it false*. A reader cannot tell a live figure from a
fossil, and the fossil is more persuasive than it deserves to be because it looks precise.

Each participating proof now emits a machine-readable `figures=` line derived from the
same variables its checks asserted on, and the disclosure figures the docs quote are
computed during the existing enumeration rather than by a throwaway script. The guard runs
the proof and requires every comma-formatted number in a doc *section* naming that proof to
be a live figure. Section scope, not paragraph: the drift that actually happened sat
several paragraphs from the one naming the proof.

Historical numbers are legitimate and this repo uses them deliberately. They are
recognised by the words around them — in **both** directions, since "read eight and 1,788
*until* a review re-derived them" puts the marker after what it qualifies — rather than by
an allowlist of numbers, because an allowlist of numbers would itself go stale, which is
the failure being guarded against.

Both guards were negative-controlled before being trusted, on the principle that a gate
which has never failed is indistinguishable from one that cannot: reverting a figure to
its pre-split value, and perturbing a space size by one, each fail the guard.

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

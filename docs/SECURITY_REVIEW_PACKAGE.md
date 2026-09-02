# Independent security review — assessor package

**Status: preparation. No independent review has been performed.** Nothing in this
document is an assessment, an attestation, or a finding. It is the material an
external assessor would need in order to begin, assembled so that engaging one is a
scheduling problem rather than a discovery problem.

That distinction is the whole point of the file. Blocker 9 is *an independent security
review* — and independence is precisely the property this repository cannot
manufacture for itself. Preparing the package is in scope here; concluding anything
from it is not.

Every document linked and every command named below is verified to exist by
`node scripts/check-assessor-package.mjs`, which runs in preflight. A package that
points at a moved file or a renamed script is worse than no package: it wastes the
assessor's first hour and it reads as neglect.

## 1. What this system is, in one paragraph

SignalGrid is a deterministic authorization **decision** fabric for shared frontline
devices. It ingests posture/context signals, composes them, and returns
`allow / step_up / restrict / deny` with the evidence behind the verdict. **It does
not carry the response out** — the host application and the systems of record do.
There is no executor in this repository. See
[What SignalGrid does today](WHAT_SIGNALGRID_DOES_TODAY.md) and
[the embedded-UX principle](EMBEDDED_UX_PRINCIPLE.md).

## 2. Scope an assessor should hold

**In scope**

| Surface | Where |
|---|---|
| Decision core | `lib/signalgrid-core`, `lib/posture-composition` |
| `/v1` decision + evidence API | `artifacts/api-server` |
| Connector normalizers (read-only) **and the six outbound emitter families (they WRITE)** | `lib/integrations/*` |

> The parenthetical on that row said "read-only" alone until 2026-09-02, and it was
> wrong in the direction that matters to an assessor. Most of `lib/integrations` is
> read-only by discipline — the UEM and NAC actuators were deleted rather than gated,
> for reasons stated in `lib/integrations/src/integrations/adapters/types.ts`. But six
> families SEND: `itsm`, `siem`, `syslog`, `telemetry`, `webhooks` and `caep-events`.
> An assessor reading "read-only" would not have looked for an outbound boundary at
> all. Verify three things about it, in this order: **whether** anything may be sent
> (`lib/integrations/src/integrations/adapters/emit-gate.ts` — tier AND
> `SIGNALGRID_LIVE_INTEGRATIONS` AND a credential, fail-closed), whether it goes out
> **signed** (`scripts/check-signing-unconditional.mjs`), and **what may be sent**
> (`lib/integrations/src/integrations/adapters/payload-fields.ts`, held by
> `scripts/check-emit-payload-discipline.mjs` and section 13 of
> `scripts/src/emit-gate-proof.ts`). The outbound field sets and their declared open
> slots are written out in
> [Data retention and personal data](DATA_RETENTION_AND_PERSONAL_DATA.md). No
> production caller constructs these adapters today; only the proofs under
> `scripts/src/` do.
| Auth / tenancy | `lib/enterprise-auth`, `lib/audit` |
| Operator console | `artifacts/signalgrid-review` |
| iOS shell | `native/ios/EnterpriseShell` |

**Explicitly out of scope, and why**

- **The private core.** It is not in this repository. See
  [Repository lineage](REPO_LINEAGE.md) and [NOTICE](../NOTICE).
- **Production infrastructure.** There is none. No tenant, no managed cloud account,
  no customer deployment exists as of this writing.
- **Anything MDM-enforced.** An app cannot grant device access, restrict other apps,
  or self-kiosk; those are supervised-device capabilities. See
  [Mobile and platform strategy](MOBILE_AND_PLATFORM_STRATEGY.md).

## 3. The single most important thing to verify first

**The fixture/live boundary.** Connectors are fixture-backed by default. A live call
requires a tier (`beta`/`prod`), the environment flag
`SIGNALGRID_LIVE_INTEGRATIONS=true`, **and** the credential the calling adapter holds.
All three are checked in one resolver
(`lib/integrations/src/integrations/adapters/emit-gate.ts`), and any one of them alone
refuses. Verify the third by counting: every one of the 37 `resolveEmission(` call
sites under `lib/integrations/src/integrations/` passes the secret its own config
declares — `apiToken`, `clientSecret`, `signingSecret`, the Splunk HEC token, the
Sentinel workspace key — or the explicit `NO_CREDENTIAL` sentinel where the family
authenticates with nothing (syslog: a host and a port).
`node scripts/check-ungated-fetch.mjs` prints that count and fails on any call that
passes neither.

That sentence used to end "each checked independently, so no single misconfiguration
opens a live path", and it was not yet true when it said so. The credential clause was
documented in seven places and implemented in none until 2026-09-02; it then landed as
an OPTIONAL parameter that 36 of the 37 call sites omitted, so for its first hours it
was enforced in the ITSM factory alone. Measured, not inferred: at `prod` with the flag
on, `new ZendeskAdapter({ instanceUrl, email: "", apiToken: "" }).createTicket(...)`
POSTed to the configured host carrying `Authorization: Basic L3Rva2VuOg==` — the base64
of `/token:`. The parameter is now required, an omission is a type error, and
`proof:emit-gate` drives one empty-credential vector per family against a spy `fetch`
that must never be called.

An assessor should treat that as a claim to attack, not a fact to accept. It is the
load-bearing assumption behind every other safety property here: if it does not hold,
"fixture-backed" is decoration.

**It did not hold, and this is what that looked like.** The first automated review of
this document went looking and found eleven `healthCheck()` methods — across the SIEM
webhook, Splunk, Sentinel, two NAC adapters and six ITSM adapters — performing a real
`fetch` to a configured URL with **none** of the three conditions checked. They are
now gated, and `pnpm run guard:ungated-fetch` fails the build if a twelfth appears.

Two things an assessor should take from that. First, the boundary is younger than the
claim: treat the fix as new code, not settled ground. Second, the reason it was missed
is instructive — a health check does not *feel* like an emission (it returns a boolean
and sends nothing) while still opening a connection from wherever the process runs.
Look for other paths that are outbound without looking like it.

**Known remaining scope, restated after the August audit closed the last of it.** The
gate now enforces every outbound method under `lib/integrations/src/integrations/itsm/`, `lib/integrations/src/integrations/siem/`, `lib/integrations/src/integrations/telemetry/` and
`lib/integrations/src/integrations/passkey-assurance/`, plus `healthCheck()` anywhere, and it prints the unenforced
remainder on every run — empty on this tree as of 2026-09-02. This paragraph previously
said that sixteen outbound methods were counted but unenforced, and that
`lib/integrations/src/integrations/telemetry/mde.ts` was gated by a local
`config.enabled` flag rather than the tier boundary; `MDEAdapter.isEnabled()` now
requires `resolveEmission(...).mode === "live"` as well, and the gate's exemption entry
for it is deleted rather than left standing. What the gate still cannot establish is
printed in its own output: it is a static scan, so it proves no connector function
calls `fetch` without naming the gate — a necessary condition, not a sufficient one.

## 4. Threat model and controls

- [Product core threat model](PRODUCT_CORE_THREAT_MODEL.md) — assets, actors, trust
  boundaries.
- [Threat model](../threat_model.md) — the repository-level model.
- [Security controls matrix](SECURITY_CONTROLS_MATRIX.md) — control → implementation →
  evidence.
- [Security-baseline alignment](SECURITY_BASELINE_ALIGNMENT.md) — CIS and other
  hardening baselines as a decision dimension.
- [Product data model](PRODUCT_DATA_MODEL.md) — what is stored, and what is not.
- [Publication boundary](PUBLICATION_BOUNDARY.md) — how public/private separation is
  enforced rather than remembered (`scripts/check-publication-boundary.mjs`), now
  merged and running in CI.

## 5. Reproducing the evidence

An assessor should re-run these rather than read about them. Node 22, `pnpm install`,
then:

| Command | What it establishes |
|---|---|
| `pnpm run preflight` | The whole local gate suite. Prints, every run, the CI jobs it does **not** cover. |
| `pnpm run typecheck` | Type integrity across all packages. |
| `pnpm run review:invariants` | Fail-closed / determinism / Assist-model / truthfulness invariants. |
| `pnpm run proof:signalgrid-core` | The decision core over a fixed set of seeded end-to-end scenarios, plus targeted and malformed-input assertions. **Not** an exhaustive enumeration of the core's state space — corrected after review; combinations outside those fixtures are not exercised here. |
| `pnpm run proof:grant-safety` | Self-tests the shared grant-safety *harness* against a toy evaluator — it does **not** exercise any real connector. The per-connector allow-path enumerations live in each connector's own proof (e.g. `proof:device-management-health`, which sweeps its full raw wire space). Corrected after review pointed out this row promised the latter and ran the former. |
| `pnpm run proof:isolation-scope` | Cross-tenant isolation. |
| `pnpm run safety:check` | The consolidated guardrail gate. |
| `pnpm run docs:sanity` | Required docs + the unsafe-claim scan. |
| `pnpm run guard:registries` | Every guard's coverage list, derived rather than trusted. |

[CI and validation](CI_AND_VALIDATION.md) describes how these map to CI jobs.

## 6. Where to attack first

Written by the people who built it, which is exactly why it is not a substitute for an
independent look. These are the areas where a reviewer's independence is worth most:

1. **The live-call gate** (§3). Three independent conditions. Find a path that needs
   only two.
2. **The allow path.** `proof:grant-safety` enumerates granting states; the interesting
   question is whether the enumeration is *complete*, not whether it passes.
3. **Unknown-signal handling.** The invariant is that an unknown or unreachable signal
   **raises** assurance, never lowers it. Find a dimension where an unknown grants.
4. **Tenancy.** Every read path should be tenant-scoped. Find one that is not.
5. **The guards themselves.** Several exist because a previous guard reported green
   over something it had stopped checking. Assume the same defect is present and
   undiscovered — it has been, repeatedly.

## 7. Known limitations, disclosed rather than discovered

An assessor will find these anyway; stating them first is cheaper for everyone and is
the honest posture.

- **No independent review has been performed.** This document is preparation.
- **No production deployment, no real tenant, no customer data** has ever existed. All
  evidence is fixture-backed and deterministic.
- **Guards deny phrasings, not claims.** The unsafe-claim scan matches a phrase list; a
  green means "none of the phrasings we thought of," never "no over-claim." Stated in
  `scripts/docs-sanity.mjs` itself.
- **The publication-boundary gate classifies by directory.** A file placed *inside* an
  already-classified area inherits its classification, so the gate proves nothing
  arrived *unexamined* — not that everything present belongs.
- **Compliance is not claimed.** No HIPAA, SOC 2, ISO, FedRAMP or certification claim is
  made anywhere, and a human compliance review would be required before any is. See
  [Public messaging guardrails](PUBLIC_MESSAGING_GUARDRAILS.md).
- **Two third-party documents** currently sit in `attached_assets/` awaiting an owner
  licensing decision; the boundary gate prints them on every run.
- **This document has been wrong before.** Its first version overstated the live-call
  boundary, the grant-safety command and the core proof's coverage — all three found by
  an automated reviewer and corrected above. Read it as a starting map, not a survey.

## 8. Disclosure

Report anything found through [SECURITY.md](../SECURITY.md), which carries the
coordinated-disclosure policy and contact path. Findings from an engagement should be
recorded against this document so the package improves rather than the findings
scattering.

## 9. What is still needed before an engagement

Not code, which is why it is not built here:

- An assessor selected and engaged (owner).
- Scope and rules of engagement agreed in writing (owner).
- A decision on whether the private core is in scope, which determines whether the
  assessor needs access to a repository this one deliberately cannot reach (owner).

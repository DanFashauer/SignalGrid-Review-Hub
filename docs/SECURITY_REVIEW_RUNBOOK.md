# Security review runbook — how this repository gets reviewed, and at what cost

SignalGrid's security review runs **in-session, per pull request, at zero
infrastructure cost**. There is no API key, no metered per-PR bill, and no
third-party Action in the critical path.

## Why not the GitHub Action

`anthropics/claude-code-security-review` is a good tool and the model here is
borrowed from it. It was assessed and deliberately **not adopted for now**:

- It requires a repository secret (`CLAUDE_API_KEY`) enabled for both the API and
  Claude Code, and **bills per PR run** — a standing cost on a pre-revenue project
  whose PRs are large and frequent.
- Its own README states it **is not hardened against prompt injection** and should
  only review *trusted* PRs. This repository is public, so adopting it would also
  require "Require approval for all external contributors" to be enforced.

Neither is a reason it is wrong — they are reasons it is a **later** decision. If
it is adopted, both conditions above must be satisfied in the same change.

## The current process

1. **Every substantive PR gets a review pass in-session** before it is marked
   ready — the diff is read against the threat model below, not against generic
   OWASP categories.
2. **Findings are verified before they are reported.** A finding that cannot be
   stated as *concrete inputs → wrong output* is not a finding; it is a smell, and
   it goes in the PR body as a note rather than as a defect.
3. **The gate suite is the regression net.** The proof gates — count published by
   `docs/STATUS.md` and held true by `check-status-figures.mjs`, cited rather than
   copied here because the copy that used to sit in this line said **125** against a
   real 140 — plus the mutation guard,
   the grant-safety enumeration and the figure guard already run on every commit.
   A human-or-model review that duplicates them adds noise; the review's job is
   what the gates *cannot* express.

## Threat model — what actually matters here

Reviews of this repository should weight these far above generic findings, because
these are the failure modes the product's own doctrine says must not happen.

### 1. The unearned affirmative (highest severity)

Any change that lets a **green state be reported without the thing it claims**.
Concretely:

- A decision path that returns `allow` on absent, stale, or unreadable evidence.
- A gate that cannot fail — no negative control, or an assertion satisfiable by an
  engine that ignores its input.
- A figure or status derived from configuration rather than observation, without a
  basis field saying so (`observed` vs `projected_from_sourcing`).
- A reason code minted but never emitted by any rule — a string that looks like
  evidence in the operator console and the assessor package.

### 2. Fail-closed violations

An unknown or unreachable signal must **raise** the assurance required, never lower
it. Flag any change where degrading a signal to `unknown` produces a decision at
least as permissive as the fully-evidenced one. `RANK` in the doctrine proofs is
the canonical ordering: `deny < restrict < step_up < allow`.

### 3. Determinism breaks

`Date.now()`, `Math.random()`, `new Date()` with no argument, iteration order
dependence, or locale-sensitive comparison **anywhere in a decision path**. These
break replay and audit, which is the product's core claim. `review:invariants`
catches the obvious forms; review catches the laundered ones (a helper that reads
the clock two calls away from the decision).

### 4. Crypto and secret boundaries

- Fixture cryptography must remain **disclosed in-source as fixture
  cryptography** — the FNV hash and `FIXTURE_SIGNING_KEYS` in the control plane
  are public-safe *because* they say so. A change that removes the disclosure is a
  finding even though it changes no behaviour.
- Verdict attestation must keep real HMAC + constant-time comparison.
- Any new hard-coded key, token, or credential — including in tests and fixtures —
  is a finding unless it is disclosed and provably non-production.

### 5. The publication boundary

This is a **public** repository with a private core. Flag anything that would
publish: private-core implementation, a real tenant identifier, a customer name, a
production hostname, or a credential. `guard:boundary` enforces classification;
review catches content that is classified but shouldn't have been written.

### 6. Platform honesty

An app cannot grant device access, restrict other apps, make itself non-removable,
or self-kiosk — those need MDM and a supervised device. Flag any code or copy
implying otherwise, including in demo surfaces.

## False-positive filtering — do NOT report these

These are the recurring noise sources in this specific repository:

- **Fixture credentials that are disclosed as fixtures.** `FIXTURE_SIGNING_KEYS`,
  seeded demo tenants, and `seedDemoStore` values are intentional and documented.
  Report only if the disclosure is *missing*.
- **The non-cryptographic FNV hash** in the control-plane bundle. It is not
  claimed to be authenticity, and the source says so.
- **"Missing input validation" on internal fixture loaders.** These consume
  in-repo fixtures, not user input.
- **Simulated actuators.** Remediation, provisioning apply, and ITSM/webhook
  emitters are simulated and gated by design. "This doesn't actually do anything"
  is the feature.
- **Demo-only flags** in `DemoMode.swift` — simulator-gated by construction.
- **Generic dependency CVEs.** Dependabot and CodeQL already run; a review that
  restates them adds nothing.
- **Reason codes marked SPECIFICATION** (`SAML_*`, `ZERO_TRUST_*`, `ITSM_*`,
  `MUNICIPAL_*`, indicator prefixes). Deliberately unminted. That they are unused
  is the point, and proofs assert it.

## Running it

```bash
/security-review          # in-session review of the current diff
pnpm run preflight        # the full gate suite — run this, not a hand-picked subset
```

**Run preflight itself, not a curated subset of gates.** This is written down
because the subset habit has cost this project real CI failures twice: a proof
publishing an unregistered `figures=` line, and a stale generated artifact. Both
would have been caught by the whole suite and were missed by a selection of it.

## When to escalate to the paid Action

Adopt `anthropics/claude-code-security-review` when **all** of these hold:

1. There is revenue or funding to absorb a per-PR cost.
2. External contributors exist, so "require approval for external contributors" is
   configured and the prompt-injection caveat is handled.
3. An independent security review is being prepared and a documented automated
   pass strengthens the package.

Until then this runbook *is* the process, and it costs nothing.

# The publication boundary — gated, not remembered

`NOTICE` and [REPO_LINEAGE.md](REPO_LINEAGE.md) have stated the split since the
IP-hygiene pass: this repository is the **public** review surface; the proprietary
core, credentials, customer data, tenant configuration, production logs and
unreleased policy logic live in the private repository and must never appear here.

That policy was correct, written down, and **checked by nothing**. For a boundary,
remembered is the same as absent — the failure mode is a single commit, and by the
time anyone notices, the content is public and mirrored.

`pnpm run guard:boundary` (`scripts/check-publication-boundary.mjs`) is the check.
It runs in `preflight` and in CI.

## What it can and cannot do

It **cannot** decide whether a given file is "core implementation detail." That is a
judgment, and a scanner claiming to make it would be theatre.

It **can** guarantee that nothing reaches this repository **without a human having
classified it**. Every tracked path must fall under a declared area with a stated
reason; an unclassified path fails the build. New surface cannot arrive quietly —
which is the only property that distinguishes gated from remembered.

This is deliberately the same shape as the launch profile: declare the edge as data,
enforce a bijection in **both** directions. There the reverse direction is the
breadth freeze; here it is the boundary.

It is deliberately **not** a denylist of bad strings.
[`docs-sanity`](../scripts/docs-sanity.mjs) spent two rounds establishing that a
denylist denies *phrasings* rather than *claims*, each round finding live instances
the previous one had not covered. The content rules here are a narrow, self-controlled
supplement — not the mechanism.

## The four directions

| | Checks | On failure |
|---|---|---|
| **A. Coverage** | Every tracked path falls under a declared area | **FAIL** — something arrived in a public repo that nobody classified |
| **B. Phantom areas** | Every declared area covers real tracked content | **FAIL** — a dead rule inflating the coverage count |
| **C. Republication** | Every reproduced-whole document (PDF/DOCX/…) carries a licence basis | **FAIL** if it has no entry at all |
| **D. Content** | A short set of shapes that breach regardless of area | **FAIL** |

Derivation is from `git ls-files`, never from disk. That is on the record: the
launch-profile gate first read the filesystem, counted two gitignored build
directories, passed locally with 20 app surfaces and failed CI with 19. A gate whose
input differs between environments is not a gate.

## Detector self-controls

Every content rule carries `mustMatch` / `mustNotMatch` strings, asserted **before
any scanning**. A rule whose regex has quietly stopped matching would otherwise
report "clean" forever — the defect `check-guard-registries.mjs` exists to prevent,
here applied to a scanner rather than a registry. If a control disagrees with its
rule, the gate fails loudly and scans nothing, because at that point it does not know
what it is measuring.

The `credential_in_url` rule earned three of its controls the hard way. Its first
draft matched any host and produced three findings, all false: a compose **service
alias** (`postgres://sg:sg@db:5432`) and two occurrences of `https://user:pass@host/`
inside the repo's **own** work-context guard — which already refuses that exact shape
and proves it. The rule now requires a dotted FQDN, and all three are pinned as
`mustNotMatch` so the narrowing cannot be silently widened back.

`scripts/src/work-context-proof.ts` is exempt from content scanning for the same
reason `PUBLIC_MESSAGING_GUARDRAILS.md` is exempt from the unsafe-claim scan: its
`urlCred` case is a negative control that *must* contain the forbidden shape to prove
the guard rejects it. Flagging a proof for containing what it proves is rejected
would be the gate punishing the coverage it wants.

## `OWNER_PENDING` is not a snooze

A third-party document may be marked `OWNER_PENDING` — a real, named, unresolved
exposure that does not fail the build.

The objection is obvious and deserves an answer rather than a hope. A snooze makes a
finding **quiet**. This makes it **louder**: the full note and the required decision
print on every single run, and an entry with no stated `ownerDecision` fails. What it
does not do is redden CI on every unrelated branch over a question that is not an
engineer's to answer. A gate that blocks all work until someone else decides gets
deleted — and then the finding goes with it.

The forward-looking half stays strict: a **new** reproduced document with no entry is
a hard failure. That is the property that matters for a boundary.

This mirrors the `QUEUED` convention in `check-guard-registries.mjs`, which prints its
partial coverage every run "so partial coverage is never mistaken for full coverage."

## Currently pending

Two **Gartner Peer Insights** reports sit in `attached_assets/`, reproduced whole in a
public repository. Gartner content is licensed and redistribution-restricted, and
nothing here establishes a right to republish it. Neither file is referenced anywhere
in the repo, and neither is copied to GitHub Pages.

The decision is the owner's: remove them from the tree (reversible — the assessments
they fed are already recorded in the intake ledger), or record the licence that
permits publication. **Removal from HEAD does not remove them from git history**;
purging that needs a rewrite, which `NOTICE` says the provenance record should not
undergo.

## What a green does not establish

Printed on every run, so the pass is never read as more than it is:

- **Whether a classified file *should* be public.** Classification records a human's
  judgment; it does not audit it. The gate proves nothing arrived unexamined.
- **Secrets** — `gitleaks` owns that, and this deliberately does not duplicate it.
- **Anything already in git history.** Removal from HEAD is not removal.

## Adding to the repository

A new top-level directory or root file fails the gate until it is classified. Add an
entry to `AREAS` in `scripts/publication-boundary.mjs` with a `class` and a `reason` a
reader can check — or, if it does not belong in public, do not commit it here.

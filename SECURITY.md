# Security Policy

SignalGrid Review Hub is a **public, pre-production review and validation
surface**. It is fixture-backed and public-safe: it contains no secrets, no
tenant identifiers, no customer data, no PHI/PII, and it makes no live vendor or
Microsoft Graph calls. It is not production-ready and is not a system of record.

## Reporting a vulnerability

If you believe you have found a security issue in this repository, please report
it privately rather than opening a public issue:

- Preferred: open a **private vulnerability report** via GitHub Security Advisories
  (the repository's **Security → Report a vulnerability** tab).
- Alternatively, contact the maintainer through the repository owner's GitHub
  profile.

Please include: affected file or endpoint, a description of the issue, and steps
to reproduce. We aim to acknowledge reports within a few business days.

Because this repository is public-safe by design, please do **not** include any
real credentials, tenant data, or customer information in a report.

## Scope

In scope:

- The public product core (`lib/signalgrid-core`) and its `/v1` API surface
  (`artifacts/api-server`) — for example authorization, tenant-isolation, or
  fail-closed-logic defects.
- The deterministic proof harnesses and CI workflows.
- The Review Hub UI (`artifacts/signalgrid-review`).

Out of scope (by design, since this is a review surface):

- Absence of real authentication providers, durable persistence, or production
  hardening — these belong to the private production core, not this repository.
- The demo API tokens (e.g. `sgk_demo_*`) are intentionally public and are not
  real credentials.

## Automated security controls

This repository runs the following automated controls:

- **Dependabot** — weekly dependency and GitHub Actions update pull requests
  (`.github/dependabot.yml`).
- **CodeQL** — static code scanning for JavaScript/TypeScript
  (`.github/workflows/codeql.yml`).
- **gitleaks** — secret scanning on pushes and pull requests
  (`.github/workflows/supply-chain.yml`).
- **CycloneDX SBOM** — a generated, committed software bill of materials
  (`artifacts/sbom/cyclonedx.json`, regenerated with `pnpm run sbom`).
- **pnpm `minimumReleaseAge`** — a supply-chain delay before newly published
  package versions can be installed (`pnpm-workspace.yaml`).
- **Unsafe-claim scan and deterministic proofs** — enforced in
  `.github/workflows/review-hub-ci.yml`.

See [`docs/SECURITY_CONTROLS_MATRIX.md`](docs/SECURITY_CONTROLS_MATRIX.md) for the
full control matrix and [`docs/PRODUCT_CORE_THREAT_MODEL.md`](docs/PRODUCT_CORE_THREAT_MODEL.md)
for the threat model.

# Security test specs — harvested from the DEV build (to adapt)

These Vitest specs (replay-attack, secret-redaction, rate-limit, step-up
enforcement, webhook signing, admin-auth hardening, fail-closed fallbacks,
WebAuthn request-identity) encode valuable security invariants. They were
written against the DEV Next.js server + its `src/lib` stores, so they are kept
here as **reference to port** onto this monorepo's `@workspace/*` packages and
the `/v1` api-server — not yet wired into CI. The k6 load scripts in
`tests/load/` are framework-agnostic (they target a running URL) and can run
against the api-server directly.

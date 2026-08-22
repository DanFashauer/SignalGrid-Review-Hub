# Release evidence — the assurance chain a candidate build carries

The owner's 2026-08-21 research report names the chain; this page records
what of it is BUILT, what is REPORTED versus GATED, and the one decision
that is deliberately not made yet. Owned by `release-engineer` per the lab
registry (`docs/agent/open-source-lab-registry.json` — syft, grype and
cosign are its three `INTERNAL_COMPANY_TOOL` P0 rows).

```
build
  ↓
source SBOM        scripts/src/generate-sbom.ts — every ecosystem in the
                   tree, licence-gated (scripts/check-licence-policy.mjs).
                   Source-dependency scope; states itself that container
                   base images are NOT covered.
  ↓
image SBOM         supply-chain.yml `image-evidence` — Syft v1.44.0
                   (sha256-pinned binary) over the BUILT api image:
                   base layers and OS packages included. CycloneDX + SPDX,
                   uploaded as a CI artifact per run.
  ↓
vulnerability      Grype v0.112.0 (sha256-pinned) over that image SBOM.
evidence           Split deliberately in two:
                     · per-PR (supply-chain.yml): REPORTED — severity
                       histogram + database build date in the log, full
                       JSON as an artifact. Never fails on count, because
                       the database moves daily and a gate that goes red
                       without a code change is a flaky gate.
                     · daily (scheduled-verification.yml `vuln-gate`):
                       GATED — fails on Critical WITH a fix available
                       (--only-fixed), opening/refreshing the standing
                       tracking issue. A new overnight CVE going red here
                       is signal doing its job; it blocks no PR.
                   A scan result is EVIDENCE WITH A TIMESTAMP, never a
                   frozen claim: the database build date rides with every
                   result.
  ↓
signature          BUILT — custody RATIFIED as keyless Sigstore OIDC via
                   the CI identity (DR-009, owner-directed 2026-08-21).
                   Cosign v3.1.3 (sha256-pinned) signs the evidence blobs
                   with `sign-blob --yes` on PUSH events only — a pull
                   request, fork context included, must never mint
                   signatures under the repository's identity. Every
                   signature lands in the public Rekor transparency log;
                   the .sigstore.json bundles travel with the CI
                   artifacts. NOT yet signed: a registry image by digest —
                   that arrives when an image registry exists to push to.
                   The held-key option stays written down in DR-009's
                   reversal clause (air-gapped verification is the real
                   scenario that would revive it).
```

Cross-check (row 37, 2026-08-22): Trivy v0.74.0 run beside Grype over the
committed SBOM produced 19/19 findings with identical severities and zero
true disagreements — the only delta is id scheme (GHSA vs CVE), mapped in
`artifacts/scanner-comparison/2026-08-22-grype-vs-trivy.json`. Decision:
corroboration, not divergence; no second gate. Trivy remains an on-demand
cross-check until image-scope scanning exists.

What this page does NOT claim: no attestation (in-toto predicate) exists
yet, no registry image is signed yet, and the vulnerability evidence
covers the api image only —
the web images and native binaries are not yet scanned (extend the same
job when they matter). The pinned tool versions and checksums live in the
workflow files themselves, next to their use, so a bump is a reviewable
diff.

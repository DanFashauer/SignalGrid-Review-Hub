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
signature          NOT BUILT — deliberately. Cosign is the chosen tool
(deferred)         (registry row, Apache-2.0), but the first signature
                   requires the KEY-CUSTODY decision, which is the owner's:
                     a) keyless (Sigstore OIDC via the CI identity) — no
                        key to lose, trust rooted in the repository's CI
                        identity and a public transparency log;
                     b) a held key pair — owner-custodied private key,
                        no third-party log dependency.
                   Recommendation on file: (a) keyless, because a solo
                   founder holding a signing key is a single point of loss
                   and the transparency log is an assessor-legible answer.
                   Recorded as an owner-hands item in
                   docs/COMPANY_BUILD_PLAN.md; no signing until ratified
                   in a decision record.
```

What this page does NOT claim: no signature exists today, no attestation
exists today, and the vulnerability evidence covers the api image only —
the web images and native binaries are not yet scanned (extend the same
job when they matter). The pinned tool versions and checksums live in the
workflow files themselves, next to their use, so a bump is a reviewable
diff.

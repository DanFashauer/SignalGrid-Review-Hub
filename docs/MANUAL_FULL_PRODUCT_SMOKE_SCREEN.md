# Manual Full-Product Smoke Screen

This future manual smoke screen is a review checklist, not an automated production test.

## Steps

1. Open the Review Hub locally or from the preview environment.
2. Inspect the Connector Emulator Review Dashboard.
3. Run the Connector Emulator Smoke workflow.
4. Review the `connector-emulator-results` artifact.
5. Inspect the documentation map in `docs/INDEX.md` and the README documentation section.
6. Verify the signal-source, custody, and credential-reader story is understandable and public-safe.
7. Confirm no live credentials, tenant IDs, customer data, PHI/PII, or private environment values are present.
8. Confirm no production-readiness, compliance/certification, partnership, replacement, or autonomous production remediation claims are present.
9. Record pass/fail notes, screenshots if useful, workflow run links, artifact names, and follow-up backlog items.

## Pass criteria

- Dashboard loads and matches the documented connector emulator story.
- Smoke workflow completes or any failure is explained as an environment limitation.
- Artifact is present and contains synthetic connector-emulator results.
- Docs map points reviewers to the relevant strategy, proof, and automation documents.
- Public-safety checks are clean.

## Fail criteria

- Live credentials or private values appear anywhere in the review surface.
- A production, compliance, certification, partnership, replacement, or autonomous remediation claim is introduced.
- The smoke result cannot be connected to a deterministic fixture or artifact.
- A high-risk action appears to bypass explicit approval.

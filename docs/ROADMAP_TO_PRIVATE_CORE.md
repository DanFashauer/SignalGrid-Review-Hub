# Roadmap to Private Core

Review Hub validates the public story and external feedback loop. The private SignalGrid core holds protected source, foundation work, and implementation details.

## Flow of validated concepts

1. Review Hub documents a public concept, assumption, or roadmap item.
2. Reviewers, advisors, or design partners test whether the problem, buyer, user, and workflow are clear.
3. The concept is classified as validated, needs redesign, deferred, archived, or private/core only.
4. Validated concepts are translated into private-core implementation plans.
5. Protected implementation happens in `DanFashauer/SignalGrid`.
6. Sanitized outputs, diagrams, demos, or release notes may mirror back into Review Hub when safe.

## When public outputs should mirror private core

Review Hub should mirror private core outputs when they are:

- Sanitized for public visibility.
- Free of secrets, tenant data, customer data, and protected code.
- Accurate about maturity and claim boundaries.
- Useful for reviewers, design partners, or public validation.
- Approved for external visibility.

Examples include public architecture summaries, demo videos, sanitized screenshots, milestone release notes, integration proof narratives, and updated review checklists.

## What remains private

- Core source code and protected architecture details.
- Security-sensitive policy logic.
- Secrets, credentials, tokens, customer data, and tenant-specific configuration.
- Internal risk assessments or unannounced roadmap details.
- Partner conversations, certification materials, or customer-specific details unless explicitly approved.

## Decision gates

- Is the public story validated enough to justify private-core implementation?
- Does the private-core implementation produce a sanitized output worth mirroring publicly?
- Would mirroring create security, customer, partner, compliance, or competitive risk?
- Does the public artifact avoid production readiness, compliance certification, and partner status overclaims?

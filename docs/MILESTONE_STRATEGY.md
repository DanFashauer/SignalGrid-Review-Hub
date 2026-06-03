# Milestone Strategy

SignalGrid should use tags and releases rather than messy repository copies. Public milestones validate story and review readiness, while private-core milestones validate protected implementation and integration proof.

## Milestone model

| Milestone | Purpose | Validation expected | Not production-ready | Next decision gate |
| --- | --- | --- | --- | --- |
| `public-preprod-v0.1-review-hub` | Establish Review Hub as the public pre-production/post-launch review surface. | Reviewers can understand what SignalGrid is, why the repository split exists, and what is being validated. | No production deployment, compliance certification, or partner certification implied. | Decide whether public positioning is clear enough for advisor/design-partner review. |
| `public-preprod-v0.2-launch-assets` | Prepare public-facing one-pager, demo narrative, visual/brand assets, and outreach scaffolding. | External readers can understand the buyer/user problem and first-proof plan without private repo access. | Launch assets remain draft until reviewed for claims, ownership, and accuracy. | Decide whether to begin controlled design-partner conversations. |
| `public-preprod-v0.3-integration-proof-plan` | Publish a precise first integration proof plan for Intune/Entra posture. | Reviewers can trace Device ID → compliance lookup → normalized posture signal → SignalGrid decision → audit record. | The proof plan is not a certified integration, customer deployment, or production connector. | Decide whether to implement the proof in private core. |
| `private-core-v0.1-foundation` | Establish protected source foundation and core decision model. | Internal maintainers can run core workflows and smoke checks privately. | Not customer-ready until security, deployment, reliability, and operational evidence exist. | Decide what outputs can be mirrored publicly. |
| `private-core-v0.2-intune-entra-proof` | Implement and validate Microsoft Intune / Entra posture proof in protected core. | Device posture can be normalized and evaluated with an auditable decision in a controlled environment. | Not certified by Microsoft and not a broad MDM replacement. | Decide whether to publish a sanitized demo, architecture summary, or integration write-up. |
| `mobile-v0.1-operator-workflow` | Validate the operator mobile workflow and admin companion assumptions. | Operators can review alerts, step-up queues, remediation evidence, and escalations in prototype form. | Mobile app is not a production clinical, frontline, or emergency operations system. | Decide whether to build PWA first, React Native/Expo next, or defer native work. |

## Release hygiene

- Use annotated tags or GitHub releases for milestone snapshots.
- Keep public releases focused on reviewable artifacts and sanitized outputs.
- Keep private-core release notes separate from public claims until reviewed.
- Do not create duplicate repositories for each milestone.
- Treat release candidates as validation checkpoints, not production certification.

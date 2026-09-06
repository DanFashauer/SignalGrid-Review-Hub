# Repository Lineage

SignalGrid uses a split repository model so the public story can move forward without exposing protected source, operational assumptions, or private implementation details.

## Repository roles

| Repository | Correct role | Belongs here | Should not be mixed here |
| --- | --- | --- | --- |
| `DanFashauer/SignalGrid` | Legacy — pre-dev / concept, superseded by this repo and retirement-pending (PR #1 + archive: `docs/OWNER_ACTIONS.md` §2, `docs/REPO_LAYOUT.md`, `docs/RUN_ON_MAC.md`). Until 2026-09-06 this row called it the private protected source. | Nothing new. Protected implementation, when it begins, targets a private repository the owner names in a decision record; this row is not that pointer. | Everything — it is read-only history once archived. |
| `DanFashauer/SignalGrid-Review-Hub` | Public pre-production and post-launch review/validation surface. | Public positioning, review documentation, Alpha learnings, milestone plans, integration catalogs, design-partner discussion materials, non-sensitive roadmap framing. | Production secrets, customer data, private implementation details, direct copies of protected core code, compliance or partner-certification claims. |
| `DanFashauer/DEV` | Legacy Alpha and future Home transition repository. | Historical Alpha learnings until migrated or archived; later, personal profile, resume, and portfolio work. | Long-term SignalGrid public strategy once Review Hub owns it, protected core source, partner claims. |
| `DanFashauer/Home` | Future personal homepage/resume/founder profile if created separately. | Personal homepage, resume, founder profile, portfolio narrative, links to public SignalGrid materials. | SignalGrid private source, sensitive roadmap, customer or partner materials. |

## Why the split exists

The private SignalGrid repository protects source, foundation work, and implementation details. Review Hub gives external reviewers a clear public surface for understanding the product, questioning the assumptions, and validating the integration roadmap. DEV can then stop carrying mixed responsibilities and eventually become a clean Home/profile repository or be archived.

## What belongs in Review Hub

- Public product definition and non-sensitive positioning.
- Pre-production and post-launch validation notes.
- Public milestone plans and release/tag strategy.
- Alpha capability mapping and claim boundaries.
- Integration catalog and first-proof sequencing.
- Mobile/operator workflow direction.
- Design-partner and advisor review checklists.

## What remains private

- Protected source and core implementation details.
- Credentials, tokens, secrets, customer data, tenant-specific configuration, or production logs.
- Security-sensitive policy logic not ready for public release.
- Unannounced roadmap commitments or partner discussions.
- Any certification, alliance, or compliance evidence unless approved for public release.

## What should not be mixed

Review Hub should not become a dump of private source code, DEV should not remain the long-term SignalGrid strategy home, and the private core should not be blocked by public documentation cleanup. Each repository has a specific role, and migration should happen by summary, validated artifact, or approved release output rather than uncontrolled copying.

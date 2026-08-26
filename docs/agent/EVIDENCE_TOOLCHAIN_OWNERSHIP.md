# Evidence toolchain ownership

This file assigns the new API, MCP, macOS and Fleet/osquery verification sources to roles that already exist in `docs/agent/org-roster.json`. It does **not** create new headcount, new connector families or new launch scope.

The operational procedure lives in `.claude/skills/signalgrid-evidence-toolchain/SKILL.md`.

## Why this exists

A useful repository is not a new product feature and not a new department. Every external tool needs one accountable role, one proof layer and one adoption boundary so the company can gain verification coverage without turning the Review Hub into a dependency pile.

## Ownership matrix

| Role ID | Responsibility added by this routing |
| --- | --- |
| `api-contract-architect` | Owns Bruno/OpenAPI alignment plus Schemathesis adversarial generation, oasdiff compatibility checks, Prism spec mocks/validation and Hurl only where a compact shell regression is more appropriate than Bruno. |
| `qa-engineer` | Uses Schemathesis to hunt unexpected API behavior and preserves any real generated failure as a deterministic regression. Also checks that oasdiff/Inspector/Schemathesis runs are non-vacuous. |
| `security-engineer` | Reviews MCP permissions, tool annotations, mutation risk, auth/tenant boundaries, third-party provenance and licence posture. Uses Fleet MCP's least-privilege patterns as a design reference, not copied code. |
| `sre` | Owns stable CI execution, timeouts, caching and liveness for MCP Inspector, oasdiff and Schemathesis once each is promoted into required tooling. |
| `release-engineer` | Treats unreviewed breaking OpenAPI changes as release evidence failures and ensures compatibility exceptions are deliberate/versioned. |
| `agent-ops-economics` | Measures whether MCP Inspector/Registry and added agent-facing tooling produce proportional verified value and acceptable context/cost overhead. |
| `devex-tooling-engineer` | Owns local installation, pinning, wrappers and developer ergonomics for Inspector, oasdiff, Schemathesis, Prism and Hurl. |
| `endpoint-uem-domain` | Owns research and wire-shape interpretation for Fleet/osquery, MacAdmins osquery extension, SOFA, Munki, Santa and ReportMate as endpoint evidence sources/references. |
| `mobile-native-engineer` | Owns first-party `signalgrid-mcp` Mac probes and physical/macOS validation; cross-checks overlapping facts against Fleet/osquery and independent Mac sources. |
| `principal-engineer` | Decides any promotion from research/reference into a deployed dependency or production connector and records the reversal path. |
| `compliance-analyst` | Maps what these tools can substantiate to assessor evidence without converting tool output into a certification/compliance claim. |
| `product-manager` | Keeps the toolchain as engineering proof infrastructure until a customer/design-partner requirement justifies productization. |

## Source and tool disposition

These are the current intended relationships, not claims that every item is installed or deployed.

| Source / tool | Immediate relationship | Default posture |
| --- | --- | --- |
| Bruno | Existing curated API contract/wire-test plane | Keep canonical for named API workflows. |
| Schemathesis | API adversarial verification candidate | Internal tool; no real-tenant/destructive targets. |
| oasdiff | API compatibility verification candidate | Internal gate candidate; breaking changes require explicit review, not suppression. |
| Prism | Spec mock/validation candidate | Internal tool; mock success is never live-wire proof. |
| Hurl | Small HTTP regression candidate | Internal tool; must not become a competing canonical API suite. |
| MCP Inspector | Independent MCP conformance verifier | Internal tool; preferred independent protocol check for MCP changes. |
| MCP Registry | Metadata/discovery standard | Open-standard reference; publication remains an owner/outward action. |
| Fleet MCP | Design reference | Study permission and mutation-boundary patterns; do not copy without licence review. |
| `signalgrid-mcp` | First-party Mac-native collector | `grid_collected`; read-only and provenance-preserving. |
| Fleet/osquery | Managed endpoint evidence source | Keep Fleet provenance distinct from native Mac provenance. |
| MacAdmins osquery extension | Mac evidence cross-check/reference | Research/reference until registry intake and a bounded proof justify use. |
| SOFA | Apple software/security currency source | Research/reference under breadth freeze; not a launch connector by implication. |
| Munki | Mac software-management source/reference | Research/lab only unless a current evidence dimension needs it. |
| Santa | Endpoint execution/security evidence research | Deferred by default. |
| ReportMate | Mac/osquery/API/MCP architecture reference | Study architecture; server/API/MCP reuse requires explicit licence review. |

## Promotion rule

A role may research a source immediately. Before a source/tool becomes installed, deployed, CI-required, product-visible or a production connector, the owner role must update `docs/OPEN_SOURCE_LAB_REGISTRY.md` and its JSON twin with classification, tier, accountable role, exact licence basis, credential class, mutation rights and deployment evidence.

`mutationsAllowed` defaults to false. No registry promotion changes the ratified launch profile by itself.

## Evidence rule

When two sources overlap, preserve both provenances. Matching values increase corroboration; conflicting values become contradiction evidence. SignalGrid never selects whichever source produces the least restrictive verdict.

The only authoritative verdict remains the deterministic SignalGrid core.
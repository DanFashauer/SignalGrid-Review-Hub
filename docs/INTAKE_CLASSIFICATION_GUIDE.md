# Intake Classification Guide

Use this guide when a new screenshot, link, finding, automation summary, GitHub validation result, or vendor observation arrives.

## Classes

| Classification                | Use when the input is about                                                                          | Default lane |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| Product thesis                | Positioning, buyer narrative, category definition, or roadmap framing                                | GREEN        |
| Signal source                 | A new public-safe source of trust, posture, custody, workflow, health, or context signals            | YELLOW       |
| Credential/custody signal     | Badge-reader, smart-locker, dock, custody, check-in/check-out, or possession evidence                | YELLOW       |
| Connector candidate           | A possible future integration that should start as read-only and fixture-backed                      | YELLOW       |
| UI/dashboard improvement      | Review Hub visual, dashboard, screenshot, or QA experience change                                    | YELLOW       |
| Proof/scenario expansion      | New deterministic proof cases, fixtures, scenario packs, or expected outcomes                        | YELLOW       |
| Workflow automation           | automation loop, phase gate, validation script, PR template, or GitHub Actions process                    | YELLOW       |
| Platform strategy             | Apple, Microsoft, local runner, device platform, or runtime strategy documentation                   | GREEN        |
| Maintenance                   | Dependency, Node runtime, build warning, lint, or CI cleanup                                         | YELLOW       |
| Blocked/live-integration item | Live API calls, auth, secrets, tenant/customer data, PHI/PII, writes, device actions, or remediation | RED          |
| Parking-lot item              | Useful but not scoped, not urgent, duplicative, or waiting on owner decision                         | GREEN        |

## Classification rules

- Prefer the least risky public-safe interpretation.
- If an item needs live credentials, real tenant data, customer details, production device actions, or writes to source systems, classify it as `blocked/live-integration item`.
- If a vendor name is used only as a public pattern, avoid partnership, certification, endorsement, or production-support claims.
- If a screenshot or manual result implies product behavior, convert it into a fixture-backed or documentation-only phase before implementation.
- If the input affects workflows, scripts, CI, runtime code, proof outputs, or artifacts, treat it as yellow unless it contains red-lane traits.

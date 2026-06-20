# Validation commands

Run these commands from the repository root before opening or updating a standard Review Hub pull request.

## Install dependencies

```bash
pnpm install --frozen-lockfile
```

Installs the exact dependency graph from `pnpm-lock.yaml`.

## Typecheck

```bash
pnpm run typecheck
```

Runs TypeScript checks for libraries, scripts, and artifact workspaces.

## Production build

```bash
PORT=3000 BASE_PATH=/ pnpm run build
```

Builds the Review Hub surfaces with the environment values expected by CI.

## Intune / Entra posture proof

```bash
pnpm run proof:intune-entra-posture
```

Validates the deterministic Intune / Entra posture proof fixture path.

## SignalGrid simulator proof

```bash
pnpm run proof:signalgrid-simulator
```

Validates deterministic simulator scenarios, decisions, routed actions, and audit evidence.

## SignalGrid grid proof

```bash
pnpm run proof:signalgrid-grid
```

Validates the deterministic SignalGrid grid proof harness.

## Microsoft Graph sandbox proof

```bash
pnpm run proof:microsoft-graph-sandbox
```

Validates the deterministic Microsoft Graph / Entra / Intune sandbox connector fixture path.

## Connector emulator proof

```bash
pnpm run proof:connector-emulator
```

Validates the deterministic cloud connector emulator harness, route metadata, approval gates, and proof hash output.

## Phase gate

```bash
pnpm run phase:gate
```

Classifies the PR/base diff as GREEN, YELLOW, or RED when `PHASE_BASE_REF`/`PHASE_HEAD_REF` or GitHub pull request environment variables are available, then falls back to the local worktree. The output includes `changedSource=pr-diff` or `changedSource=local-worktree` and accounts for docs-only status, workflows, scripts, proof/runtime changes, unsafe file paths, and unsafe-claim matches. GREEN requires a clean unsafe-claim scan; disclaimer, scanner, or guardrail matches are at least YELLOW for manual review.

## Phase summary check

```bash
pnpm run phase:summary-check
```

Validates that the reusable phase summary template includes Summary, What changed, Validation, Public-safety note, Remaining risks, and Merge lane sections. Set `PHASE_SUMMARY_FILE` to validate another PR-summary file.

## Unsafe claim scan

```bash
git grep -nE "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl" -- README.md docs artifacts/signalgrid-review/src || true
```

Review any matches manually. Explicit disclaimers, guardrail language, and validation-command examples are acceptable; direct affirmative claims are not.

## Whitespace and patch hygiene

```bash
git diff --check
```

Fails on whitespace errors that should be fixed before review.

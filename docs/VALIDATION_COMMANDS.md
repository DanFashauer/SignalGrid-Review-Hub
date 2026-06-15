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

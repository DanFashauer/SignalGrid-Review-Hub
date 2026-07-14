# SignalGrid Consolidation — DEV Harvest Manifest

This monorepo is the consolidation of three repositories into one Production
home (`DanFashauer/SignalGrid`): the deterministic decision core and app shells
(from `SignalGrid-Review-Hub`, the clean baseline) enriched with the real-world
capabilities harvested from the `DEV` build. History from each source is
preserved via subtree merge at cutover.

## Harvested into the monorepo (validated: `tsc --build` green, 18 packages)

| Package / path | From DEV | Status |
| -------------- | -------- | ------ |
| `@workspace/integrations` | `src/lib/integrations` | Ported. Real adapters: ITSM (ServiceNow/Jira/Zendesk/Freshservice/BMC/Ivanti/ManageEngine), UEM (Intune/Jamf/Workspace ONE), NAC (Cisco ISE/Aruba), SIEM (Splunk/Sentinel), EDR (FleetDM/Defender), webhook delivery, device registry. **Fixture-safe by default** — adapters only call out with real config; Redis stores fall back to in-memory when `REDIS_URL` is unset. |
| `@workspace/audit` | `src/lib/auditLedger.ts` | Ported. Shared hash-chained, tamper-evident audit ledger (used by integrations + webauthn). |
| `@workspace/webauthn` | `src/lib/auth/webauthn` + `stepUpStore` | Ported **and hardened**. Passkeys + step-up auth. Assertion/attestation signatures are now verified cryptographically (`webauthn/verify.ts`: COSE ES256/RS256 key extraction, signature check over `authenticatorData ‖ SHA-256(clientDataJSON)`, rpIdHash + user-presence + counter clone-detection), fail-closed. Proven positive + negative via `proof:webauthn-verify` (6/6). |
| `@workspace/location` | `src/lib/location` | Ported. Vendor-neutral presence/coarse/precise location signals (privacy-first). |
| `@workspace/integration-bridge` | (new) | Maps a live FleetDM (osquery) posture read into the core's normalized signals (`device_compliance` / `device_management` / `security_baseline` / freshness) — the link that lets real MDM/EDR posture feed an ALLOW/STEP-UP/RESTRICT/DENY decision. Pure/deterministic. |
| `native/ios/` | `ios/EnterpriseShell` | Brought in as a first-class package (Swift — built on macOS CI, not in the pnpm graph): BLE + USB-C badge login, OIDC/Entra, HMAC request signing, session state machine, XcodeGen/SwiftLint tooling. The real hardware badge-reader the core modeled. `ios-ci.yml` retargeted to `native/ios/**`. |
| `lib/api-spec/product-openapi.json` | `openapi.json` | The `/v1` external API contract (health/devices/events/metrics/policies/session/location/webhooks). |
| `tests/load/` | `tests/load` | Framework-agnostic k6 load scripts (target a running URL). |
| `tests/security-reference/` | `tests/security` | Security invariant specs (replay, redaction, rate-limit, step-up, webhook-signing, admin-auth, fail-closed) kept as **reference to port** onto the monorepo's api-server + `@workspace/*` packages. |

## Archived (not merged — superseded or redundant)

- DEV's second decision engine (`src/lib/decision`, `policy/runtime`, `risk`) — the core owns this.
- DEV's Next.js app shells (`src/app/**`) — the monorepo brings its own app shells; only the brand-styled landing copy + Allow/Step-Up/Deny visual pattern are reused for the homepage.
- Bun + dual lockfiles, point-in-time triage docs, the iOS SwiftUI `Prototype` (UX reference only).
- The original `SignalGrid` repo content — superseded by the Review-Hub baseline (history preserved).

## Still to do (later phases)

- Port the security-reference specs onto the api-server + wire semgrep/k6 into CI.
- ~~Complete the WebAuthn signature verification.~~ **Done** — real ES256/RS256 assertion verification, fail-closed, proven by `proof:webauthn-verify` (in CI).
- Wire additional integration adapters into the core connector layer (FleetDM bridge is the first).
- ~~Adopt DEV's brand system + build the company landing/home page.~~ **Done** — brand system applied across web + all four product apps; About page added.

## Cutover (Phase 6)

The move to the `DanFashauer/SignalGrid` home repo — standing up the
`dev → alpha → beta → prod` branches + per-tier environments, preserving all three
repos' git history, triaging/migrating open issues, and archiving the sources — is
a **user-run** procedure (it mutates repos and org settings the sandbox cannot
touch). The full step-by-step is in **[`PHASE6_CUTOVER_RUNBOOK.md`](./PHASE6_CUTOVER_RUNBOOK.md)**,
with idempotent, `DRY_RUN`-able companion scripts under
[`scripts/cutover/`](../scripts/cutover/):

| Script | Step |
| ------ | ---- |
| `00-triage-issues.sh` | Snapshot + migration checklist for open issues |
| `01-build-consolidated-history.sh` | `dev` tree = consolidation, ancestry = all 3 repos (`-s ours`) |
| `02-create-tiers.sh` | Create/push `dev/alpha/beta/prod`; set default |
| `03-protect-and-environments.sh` | Branch protection + per-tier environments + gate variable |
| `04-archive-sources.sh` | Archive Review-Hub + DEV (after the §8 checklist) |

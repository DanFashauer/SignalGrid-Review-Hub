# Credential-exposure — endpoint secrets as a decision signal

Attackers moved from "secrets in the repo" to **secrets on the endpoint**:
credentials pile up on developer and AI-agent laptops — shell histories, `.env`
files, CLI caches, and now **AI-agent configs and logs** (Cursor, Copilot, Claude
Code), a meaningful share written by the agents themselves into terminal sessions
and output logs that no repo scanner ever checks. The security assumption to make
is that these devices **will** be compromised; the open question is what a device
carrying a live credential is still allowed to do.

That question is SignalGrid's. This dimension turns a per-device secret-exposure
verdict into a runtime **allow / step-up / restrict / deny** decision that
**contains the blast radius** of a device assumed compromised.

Modeled in `@workspace/integrations` → `credential-exposure`
(`evaluateCredentialExposure`, `CredentialExposureConnector`), fused via
`@workspace/posture-composition` (`fromCredentialExposure`), and proven by
`pnpm run proof:credential-exposure` (38 checks, fully offline).

## The honest boundary — consume, don't detect

**SignalGrid does not scan for or remediate secrets.** It has no secret-detection
engine, plants no honeytokens, and never revokes a key or rotates a credential —
those are the detection tool's job and stay explicit, separately-authorized
actions. Detection platforms in this shape — **GitGuardian, Wiz, Truffle Security,
Microsoft** — are the *signal source* (via API → the `api` sourcing path; see
[Signal sourcing](SIGNAL_SOURCING.md)). SignalGrid **consumes** their verdict and
**decides**. The two compose: the scanner *detects*; the Grid *decides and
contains*. This is a complement to those tools, not a replacement or a partnership
claim.

The connector is **read-only by construction** (GET-only, guarded — a non-GET is
refused) and **fixture-safe by default**: it makes no live vendor call unless the
tier is `beta`/`prod` AND `SIGNALGRID_LIVE_INTEGRATIONS=true` AND a
`CREDENTIAL_EXPOSURE_ACCESS_TOKEN` is set. No real secret ever touches SignalGrid;
the connector reads a finding's *metadata* (location, kind, severity, validity,
remediation state), never the secret value.

## Availability → posture → action

A device's findings + scanner state resolve to one posture and the action it
warrants — fail-safe, so the **worst still-exposed** secret drives the verdict:

| Posture | When | Action |
|---|---|---|
| `clean` | scanner enrolled, no findings | none |
| `remediated` | findings exist but all were remediated or the credential revoked | monitor |
| `scanner_unenrolled` | no secrets scanner enrolled on the endpoint (a gap) | step_up |
| `secrets_exposed` | a secret is still exposed, lower value | alert |
| `active_credential_exposed` | a **live, high-value** credential (cloud key, private key, DB cred, OAuth) or a critical/high-severity secret is still exposed | escalate |
| `unknown` | no scanner coverage at all — a blind spot | monitor |

## Fail-safe rules (non-negotiable)

- **Only a provable remediation OR revocation contains a secret.** A finding that
  is `open`, or whose remediation/validity is unknown/unmapped, is treated as
  **still exposed** — we never assume an unconfirmed finding was cleaned up.
- **No coverage ≠ clean.** A device with no scanner record is `unknown` (a blind
  spot), never reported clean.
- **The worst exposure wins** (order-proof): a live high-value exposure outranks a
  co-present remediated finding, so a severe secret is never diluted by a calm one.
- **High-value** = inherently sensitive kind (cloud/private-key/DB/OAuth) OR
  critical/high severity — those escalate; a low-severity generic secret alerts.

## Boundary

This does not claim a secret-scanning capability, honeytoken planting, credential
revocation/rotation, or any partnership/certification with the named platforms.
The connector reads finding metadata read-only and fixture-safe by default; the
decision it feeds is the same fail-safe, simulated-until-enabled runtime decision
as every other dimension. See [WHAT_SIGNALGRID_DOES_TODAY.md](WHAT_SIGNALGRID_DOES_TODAY.md)
and [INTEGRATION_CATALOG.md](INTEGRATION_CATALOG.md).

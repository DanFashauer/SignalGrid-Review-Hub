# Platform SSO — the method decides, not the marketing

## Where this came from

A MacAdmins-community observation that deserves to be engineering doctrine:
**"Platform SSO can be passwordless. It can also satisfy MFA. Neither result is
automatic."** Apple's framework supports several authentication methods, the
identity-provider extension decides which one it implements, and the method
changes the credential's worth, the local-password behavior, and which policies
are even available. Vendors describe their Secure Enclave flows as "passwordless"
and "phishing-resistant MFA" — and the local password still does not disappear:
macOS requires it by default at FileVault unlock, the Lock Screen, and the login
window, and after a reboot before Touch ID re-arms.

SignalGrid's job is exactly this kind of claim-vs-reality grading, so the
`platform-sso` dimension (`@workspace/integrations/platform-sso`) turns it into
posture.

## What the dimension grades

| Observation | Verdict | Why |
| --- | --- | --- |
| user-registered **Secure Enclave key** or **smart card**, clean report, no login policy claimed | `none` — phishing-resistant confirmed | the grant; the only states where the platform credential is hardware-backed and positively established |
| **Password method** | `monitor`, assurance `password_grade` | legitimate and org-chosen — it is the ONLY method compatible with login policies (macOS 15+) — but the credential is a synced password, never phishing-resistant |
| **web-based method** (macOS 27 material) | `step_up` | Apple labels it pre-release; a preview never grants until it ships and the tenant's IdP supports it |
| **Require Authentication claimed on a non-Password method** | `alert` — `POLICY_INCOMPATIBLE_WITH_METHOD` | the compatibility detail that matters: the policy is only compatible with the Password method, so the tenant believes a control is enforced that the OS is not enforcing — config drift, and not a lockout risk (an unenforceable policy cannot strand anyone) |
| policy genuinely in force + offline grace **expired** or **never configured** | `alert` + `lockoutRisk` | an offline Mac cannot use the local password without a valid grace period; an online one must reach the IdP regardless |
| policy genuinely in force + **no break-glass exemption** | `alert` + `lockoutRisk` | exempt a break-glass account *before* enforcement — the temporary local-account grace window is not a recovery path |
| device registered but user not; not registered; any axis unreadable | `step_up` | unknown raises, never grants |

The `assurance` field (`phishing_resistant` / `password_grade` / `unknown`)
carries what the credential is actually worth, independent of the action — so an
elevated action can demand `phishing_resistant` even where the composed action
would otherwise permit.

One deliberately-moot pair, pinned by enumeration: **grace and break-glass only
exist in service of a login policy**, so with no policy claimed they do not gate
the grant (of 1,728 normalized states exactly 24 grant — 2 hardware methods × 4
grace × 3 break-glass; of 1,350 hostile raw reports exactly 9). When a policy IS
claimed, no state grants at all: it either contradicts the method (alert) or is
password-grade by construction.

## Boundaries

- **Read-only.** Enrollment, method choice, and policy deployment stay with the
  IdP extension and MDM. Fixture-gated like every connector (beta/prod tier +
  `SIGNALGRID_LIVE_INTEGRATIONS` + `PLATFORM_SSO_ACCESS_TOKEN`).
- **Surfaces are a hardware-test concern, not a model claim.** Apple configures
  the policy separately for FileVault unlock (Apple silicon), the Lock Screen,
  and the login window — and the Lock Screen is the one surface where Touch ID or
  an Apple Watch may substitute. Design and test app SSO, FileVault unlock, the
  Lock Screen, and the login window as four separate surfaces, on real hardware,
  before enforcement — with the documented recovery path ready. This model grades
  what an inventory can observe; it does not simulate surface behavior.
- **No self-attestation.** The state comes from an MDM inventory or grid-collected
  macOS report — never from a vendor label or the user's own claim. An unrecognized
  wire key (a vendor `passwordless: true` flag, say) marks the report malformed.

Proven by `proof:platform-sso` (52 checks; targeted checks, hostile report shapes, both
grant-safety enumerations, fusion into posture-composition and incident routing;
deterministic, offline).

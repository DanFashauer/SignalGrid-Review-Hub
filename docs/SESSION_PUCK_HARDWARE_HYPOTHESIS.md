# Session puck — a customer-testable hardware hypothesis

Status: **hardware hypothesis, recorded as DR-043 (2026-09-12). Nothing on this
page is a claim of current capability.** No puck, receiver, reader-dock or firmware
for one exists in this tree or is being built; nothing here is shipping, partnered,
certified or evaluated. The concept is hardware and firmware territory, and the only
part of it authorized to move now is the hardware-free software half — a
fixture-backed dock/attach signal domain and a removal-to-suspend cascade rule —
which is backlog in [`docs/BUILD_BACKLOG.md`](BUILD_BACKLOG.md), not code. Custody,
dock and reader signal families stay **deferred** in the launch profile (Beyond
Limited GA), a design target and not a shipped surface.

**Source.** An owner-produced research document, *"Shared-Device Authentication
Puck: Hardware and Form-Factor Concept"* (25 pages, shared 2026-09-12, held by the
owner and not committed — it carries third-party product material and cost
figures this repository has not verified). This page is that document's substance
in this repository's own words, held against what the tree already models. **Every
vendor or product fact below is what the document reports**, and is written that
way; the repository asserts none of it independently. The owner's words with it:
*"I'm going to blow your mind with this."*

## The idea, and the one question it rests on

A removable **session puck** the worker carries — a coin-to-PopSocket-sized token
holding a hardware-bound cryptographic credential — that physically docks into a
receiver on a shared device. Docking is an unambiguous "key in the ignition" event:
it presents the credential and states custody intent in one gesture. Removing it
is an equally unambiguous event: the session suspends. The document's own framing
is that this is *not* a prettier RFID badge, and that the mechanical dock, not the
radio, is the genuinely differentiated part.

The document is explicit that the technology is not the open question. What is not
yet validated is the proposition, quoted here because everything else on this page
is downstream of it:

> *"Do healthcare mobility teams need the employee's physical credential to become
> the 'key in the ignition' for a shared-device session strongly enough that they
> will change workflow, deploy receivers/cases, provision credentials, support
> replacements, and pay for it? No component datasheet can answer that."*

That is a customer-discovery question, and it is gated by the thresholds already
pre-registered in [`docs/agent/DISCOVERY_LOG.md`](agent/DISCOVERY_LOG.md) — see the
go/no-go table at the end of this page.

## Three functions, kept separate (doctrine)

The document's central design rule, adopted under DR-043 as doctrine for every
session-gating surface in this tree: **three functions that are usually conflated
must stay distinct**, because each is proven by different evidence, owned by a
different system of record, and fails in a different way.

| Function | What proves it | Who owns it | Where the tree already models it (a deferred design target, not a shipped surface) |
| --- | --- | --- | --- |
| **Identity authentication** — *which* worker is present | A hardware-bound FIDO2/WebAuthn assertion against a fresh relying-party challenge | The IdP (Entra or equivalent) | The passkey-assurance dimension already grades a hardware-bound key above a synced credential ([`docs/PASSKEY_ASSURANCE.md:184`](PASSKEY_ASSURANCE.md)); `lib/webauthn` verifies a real ES256 assertion server-side ([`lib/webauthn/src/webauthn/verify.ts`](../lib/webauthn/src/webauthn/verify.ts); proof row at [`docs/PROOF_COVERAGE_AUDIT.md:21`](PROOF_COVERAGE_AUDIT.md)), the step-up row the credential architecture names as a verified signed authenticator assertion ([`docs/AUTHENTICATION_AND_CREDENTIAL_ARCHITECTURE.md:56`](AUTHENTICATION_AND_CREDENTIAL_ARCHITECTURE.md)). |
| **Session / custody binding** — that this worker *intentionally* attached their credential to *this* device | A mechanical attach event with a credential identifier, a device identifier and a timestamp; a removal event | The dock or receiver, as a source of evidence | The `badge_binding` decision dimension — `present` / `removed` / `forced` / `absent` / `unknown` — where a pulled badge restricts and a forced removal denies ([`lib/signalgrid-core/src/dock.ts:51`](../lib/signalgrid-core/src/dock.ts), [`docs/CREDENTIAL_READER_SIGNAL_MODEL.md:9`](CREDENTIAL_READER_SIGNAL_MODEL.md)); the `dockState` / `custodyState` fixture schema ([`docs/PHYSICAL_CUSTODY_SIGNAL_MODEL.md:20-21`](PHYSICAL_CUSTODY_SIGNAL_MODEL.md)); the SmartDock's continuous `present` / `removed` / `forced` read ([`docs/SIGNALGRID_SMARTDOCK.md:44`](SIGNALGRID_SMARTDOCK.md)). |
| **Ongoing presence** — when removal, distance, inactivity or a posture change should suspend | Removal first; then inactivity and device telemetry; radio distance only as a secondary channel | The policy, reading the evidence above | Zone-level indoor presence in the `rtls-custody` family, fail-closed (an untracked device is a blind spot, never "in custody") ([`lib/integrations/src/integrations/rtls-custody/types.ts:10`](../lib/integrations/src/integrations/rtls-custody/types.ts)); the weeks-long recovery beacon for a device gone dark ([`docs/CUSTODY_BEACON.md`](CUSTODY_BEACON.md)). Nothing in the tree suspends a live session on radio distance, and this page does not propose that it should. |

The corollaries the document draws, all consistent with golden rule 2 (fail closed;
an unknown never lowers assurance): a dock event is a custody signal and **never
identity**; a radio "nearby" is **never** custody; and a radio "gone" is **never**
by itself a reason to end a session while the puck is physically seated.

## What the tree already had, and what is new (overlap recorded, DR-039 rule 3)

| Piece of the concept | Standing in this tree before 2026-09-12 (deferred design targets throughout; nothing here is claimed as shipping) |
| --- | --- |
| Hardware-bound FIDO2 credential as the identity root | Modelled and graded; the verifier is built. No reader or token hardware is integrated. |
| A dedicated, case-mounted FIDO2 token | Modelled as a concept in [`docs/HARDWARE_ELEVATED_ACCESS_TOKEN.md:13`](HARDWARE_ELEVATED_ACCESS_TOKEN.md) — for dual-control step-up on elevated actions only, not as the everyday session-opening credential. The puck's "dock = session" use is the part that document does not cover. |
| Attach = session, removal = suspend, forced removal = deny | Built as the `badge_binding` dimension in the decision core, fixture-backed. |
| Dock / custody / tamper state schema | Modelled, vendor-neutral, in the physical-custody signal model; the ledger-versus-bay reconciliation is built and proven (`proof:rtls-custody`). |
| Division of authority (IdP owns identity, UEM owns posture, PACS owns the physical credential, SignalGrid correlates) | Stated in [`docs/HARDWARE_PARTNER_MATRIX.md:25`](HARDWARE_PARTNER_MATRIX.md) and [`docs/DOCKBRIDGE_STRATEGY.md:31`](DOCKBRIDGE_STRATEGY.md). |
| The discovery go/no-go thresholds | Pre-registered in [`docs/agent/DISCOVERY_LOG.md:121`](agent/DISCOVERY_LOG.md) (rows 121–124). The document's gate table is a direct application of them, not a new mechanism. |
| **A worker-carried token that moves between phone, tablet and desktop receivers** | **New.** No page framed "the user carries the session key; shared endpoints carry standardized receivers". `pnpm run check:absence "session puck"` returned CORROBORATED across four probes on 2026-09-12 before this page existed. |
| **A prototype ladder — mechanical before NFC/FIDO before BLE before UWB — and "do not begin with custom silicon"** | **New** as written doctrine. DR-020's rule says a hardware surface needs a decision record; nothing said in what order a hardware experiment is allowed to spend money. |
| **A named lost-credential operating sequence** | **New.** The architecture page states revocation moves an offline lease to untrusted; no page laid out *report lost → disable FIDO registration and physical credential → invalidate session mappings → reissue with a new key*. |
| **Legacy-downgrade doctrine** | **New.** No page stated that a worker enrolled for a strong credential must never be authenticated on a legacy identifier read by the same multi-technology reader. |
| **A cleaning / ergonomics / accessibility requirement set for a carried token** | **New** for a physical token; the tree's contrast and dynamic-type rules are about the iOS shell, not hardware. |

## The recommended MVP, and the order in which money is allowed to move

The document's recommendation is not "build the hardware product". It is: keep the
concept as a customer-testable hypothesis, and build a low-cost bench prototype only
once discovery produces repeated REQUIREMENT evidence or concrete COMMITMENT.

**The MVP it would test first:** a 40–50 mm removable puck containing an
off-the-shelf FIDO2 NFC/USB-C credential, seated in a keyed click-in receiver on a
shared-device case or a workstation-on-wheels dock; Windows/Entra/Intune as the
first platform; one shared-device workflow. The diameter is an industrial-design
starting assumption, not a requirement.

**Do not begin with custom silicon or a custom authenticator.** The cheapest useful
experiment is mechanical: the document reports that certified FIDO-only security
keys with USB-C and NFC are sold off the shelf at commodity prices, so a first
prototype can encapsulate one inside a 3D-printed housing with a click or magnetic
receiver and a microswitch, Hall or contact sensor, and test the *ritual* before
anyone commits to secure-element firmware, attestation metadata, certification,
tooling or manufacturing. Its job is to answer one question: does "dock my personal
credential; pull it out and the session suspends" feel faster, clearer and safer
than the workflow users have today?

**Development order:** mechanical → NFC/FIDO → BLE only if needed → UWB only if
proven necessary. The document's reasons, in order of weight: a batteryless
NFC-plus-dock design has no charging, battery aging, state-of-charge or replacement
logistics; adding BLE creates a fleet of powered wearables (charging, dead
batteries, firmware updates, pairing, end-of-life, help-desk cases); adding UWB adds
still more RF and power burden. Each rung needs a demonstrated operational payoff
before it is climbed.

**Prototype families the document names** (what each proves; the document's cost
bands are engineering estimates for low-volume and roughly 100–500-unit pilot
quantities, explicitly not quotations, exclude NRE, certification, tooling, software
and enrollment infrastructure, and are deliberately not reproduced here):

| Family | Built from (as the document describes it) | What it proves |
| --- | --- | --- |
| A — FIDO puck | An off-the-shelf certified FIDO key inside a custom housing, with a passive or mechanical dock | The core physical ritual, FIDO authentication, attach/remove semantics |
| B — existing-badge reader dock | A PACS vendor's embeddable OEM reader module in a custom circular enclosure | Whether a hospital can reuse its deployed badge credentials |
| C — secure-NFC passive puck | A cryptographic NFC IC with a tuned antenna in a moulded body | Batteryless secure tap and a dock challenge-response |
| D — BLE active puck | A BLE MCU, a secure element, a battery, NFC bootstrap | Walk-up discovery, presence, auto-suspend |
| E — UWB/BLE puck | A UWB module plus BLE, secure element and battery | Distance-bounded presence and anti-relay UX |

A is first. B is the alternative architecture worth a second prototype. C through E
climb the ladder only on evidence.

## Technology comparison — range, authentication strength, fit

Compressed from the document's comparison table; the dollar column is omitted. The
document's own critical distinction: **the radio does not determine authentication
strength.** A static identifier can be copied or relayed; a cryptographic
authenticator proves possession of a protected key against a fresh challenge; FIDO
goes further by binding the credential to the relying party.

| Technology | Practical range | Authentication strength (as the document rates it) | Fit for shared-device session gating (as the document rates it) |
| --- | --- | --- | --- |
| 125 kHz proximity | Reader-dependent, inches to tens of inches | Low — a legacy identifier, not a modern root | Compatibility only; useful to read installed badges, never the security foundation |
| Secure 13.56 MHz (Seos / DESFire class) | Tap, centimetres | High with mutual authentication and protected keys | Very good for a workforce credential plus docking identity |
| Plain NFC tag | Centimetres | Low if static ID or data only | Poor as sole authentication; fine for prototype IDs or dock metadata |
| Cryptographic NFC tag | Centimetres | Medium–high for challenge or dynamic-message use | Good for a dock/custody assertion; custom verification lacks FIDO's standardized phishing resistance |
| FIDO2/WebAuthn over NFC | Tap | Very high — relying-party-bound public key | Excellent for initial authentication; a leading candidate for the cryptographic core |
| FIDO2/WebAuthn over USB-C | Physical connection | Very high | Excellent technically, especially on desktops and workstations; connector durability is the form-factor concern |
| BLE with LE Secure Connections | Metre scale, configurable | Medium–high transport security; application assurance varies with pairing mode | A supplementary presence channel, not the only factor |
| UWB secure ranging | Room scale, centimetre-class ranging | High for distance assurance when securely implemented | An excellent future anti-relay layer; excessive for an MVP |
| Mechanical dock presence | Physical contact | Not identity; a very strong custody-intent signal beside a cryptographic token | The differentiator: removal becomes a deterministic suspend signal with no radio ambiguity |
| **Hybrid: FIDO + secure NFC + dock** | Physical / tap | Very high | **The document's best overall MVP architecture** |

The document reports that the PACS vendor it names now sells cards combining a
physical-access credential with FIDO authentication, which it reads as evidence that
"one workforce credential spanning physical and logical access" is commercially
legitimate — and therefore that the differentiator here is session docking, custody
semantics, endpoint interaction and policy correlation, not "a badge that can
authenticate digitally".

## Division of authority — the puck is evidence, never the policy engine

Adopted verbatim in spirit under DR-043 (ii). Nothing here changes which system is
the system of record for what; the matrix in
[`docs/HARDWARE_PARTNER_MATRIX.md`](HARDWARE_PARTNER_MATRIX.md) already says the same
of every hardware category it lists. Dock and custody inputs remain a deferred family.

| Plane | Authoritative for |
| --- | --- |
| IdP (Entra or equivalent) | Workforce identity; FIDO credential registration and authentication; attestation and authenticator-model policy; authentication-strength policy |
| UEM (Intune or equivalent) | Managed-device state, compliance, configuration — an **independent** input the puck cannot substitute for |
| PACS (HID or equivalent) | The physical-access credential lifecycle, where an existing badge is reused |
| **SignalGrid** | Correlating those facts, plus dock, custody and context evidence, into one decision for *this* shared-device session, and the cascade after it |
| Session puck / dock | Possession, intentional attachment, cryptographic authentication and attach/remove evidence — **a source of high-quality evidence, not the policy engine** |

Two consequences the document states and this repository already lives by. The
puck should register through the organization's existing identity plane rather
than create another key database. And the puck cannot make a compromised phone or
workstation trustworthy: authentication establishes who holds the credential, not
that the host OS is healthy — posture stays a separate input, which is golden rule 4
in different words.

## The policy matrix, on this repository's verdict ladder

The document's situation table, mapped onto `allow` / `step_up` / `restrict` / `deny`
(the four rungs in `docs/PURPOSE.md`) and onto the fail-closed rules the tree
already applies to the `badge_binding` dimension. These are candidate fixture rows
for the simulator scenario in the backlog, a design target and not shipped
behaviour.

| Situation | Verdict | Why, in this tree's terms |
| --- | --- | --- |
| Known worker, compliant device, expected unit, puck docked | `allow` | Every axis positively confirmed — the one grant |
| Higher-risk application or a conflicting context | `step_up` — device biometric or FIDO PIN | User verification on top of user presence; the two factors keep separate semantics |
| Returning to the same suspended device after seconds, re-dock | resume **after re-evaluation** — never a silent resume | A re-dock is a new attach event; posture, policy and revocation are re-read before the session continues |
| Puck removed while a session is open | `restrict` immediately; `deny` on a forced or torn removal | The rule the `badge_binding` dimension already applies |
| Worker walks away but leaves the puck seated | inactivity and device telemetry provide the secondary lock | The dock says seated; the session policy, not the dock, decides when idle becomes suspended |
| A radio channel says the worker left but the puck is physically attached | **do not assume the worker left** — physical state and policy outrank a noisy RSSI | A radio "gone" never by itself lowers the answer while custody evidence says seated |
| UWB (a later rung, if ever) proves the credential is outside the defined distance | suspend or re-authenticate, per policy | Distance evidence, when it exists, is an input to policy, not a verdict |
| Lost or revoked puck presented | `deny`, plus the recovery path | Cryptographic registration fails; no fallback to a weaker read |
| Attach state **unknown** (receiver offline, faulted, unreadable) | `step_up` at minimum — **never a grant** | Golden rule 2: unknown raises assurance, never lowers it. This is a **new, stricter bar than the sibling dimensions**: the decision core pins `badgeBinding: "unknown"` and `dockState: "unknown"` to `allow` under its day-one-quiet pattern (only the affirmative bad state fires; `lib/signalgrid-core/src/seed.ts:480` and `:484`). The divergence is deliberate: for a puck-gated session the attach event *is* the custody-intent evidence, so its absence is the absence of the thing being gated, not a missing side signal |

The document adds one rule for walk-up: BLE may pre-wake the experience, but
**presence must never by itself open a clinical session** — NFC or docking provides
intentionality, FIDO provides identity.

## Threat model — each row, and the mitigation it maps to

| Threat the document assumes is realistic | Mitigation (as the document maps it) | Standing in this tree |
| --- | --- | --- |
| Cloning a static UID | Mutual-authenticated smart credentials or public-key authenticators; never a UID as the security root | Doctrine already: the credential-reader model treats a bare badge number as evidence, not authentication |
| Replay of captured traffic | A fresh server challenge or a cryptographically changing message (WebAuthn does this by construction) | The step-up ceremony already uses a single-use, tenant- and identity-bound challenge |
| Relay of NFC or BLE traffic | Short NFC range reduces accidental interaction but does not eliminate relay; UWB secure ranging where physical distance is itself a requirement | Not modelled; UWB is the last rung of the ladder and not proposed for an MVP |
| Bluetooth attacks | LE Secure Connections mandatory if BLE is introduced; NFC as an out-of-band bootstrap; no static BLE identifiers | Not modelled; BLE is a later rung |
| **Legacy downgrade** — a multi-technology reader authenticating a strong-credential holder on a legacy 125 kHz read | Disable the downgrade path by policy; a worker enrolled for a strong credential is never authenticated on the legacy identifier | **New doctrine**, adopted under DR-043; a candidate fixture row: "legacy read for a strong-enrolled worker → `deny`" |
| Stolen puck | Possession alone is not always sufficient; user verification (PIN, biometric) for higher-risk workflows | Modelled as the `step_up` rung |
| Compromised endpoint | The puck cannot vouch for the host; UEM posture stays an independent input | Golden rule 4; posture is its own dimension |
| Tampered or replaced dock | Signed dock and firmware identity | The product threat model already names the custody device as a possible update channel and states nothing is implemented against it yet |
| Tracking an employee via a broadcast radio identifier | No static BLE identifiers; never use a globally broadcast employee number as the radio identifier; purpose-limit location and history retention | New privacy constraint, adopted; see the privacy paragraph below |
| Abuse of a lost credential before revocation | Immediate revocation through the IdP and the PACS; invalidate SignalGrid's session mappings; reissue with a **new** keypair, never a cloned private key | New operating sequence, adopted; the architecture page already moves a revoked lease to untrusted |

## Lifecycle and audit events, on the Decision Envelope

**Credential lifecycle the document lays out:** manufacture or obtain the token →
assign an immutable hardware serial → secure key generation or vendor provisioning →
receive into enterprise inventory → assign to an employee → register the FIDO
credential with the IdP → map the physical-access credential if applicable →
*active* → a lifecycle event (normal replacement, lost or stolen, employee leaves,
suspected compromise) → immediate revoke: disable the IdP credential, disable the
physical credential, invalidate the SignalGrid mapping, audit closure → issue a new
credential with a new keypair. An enterprise deployment maintains the mapping
*employee ↔ credential ID ↔ authenticator model/serial ↔ issuance state ↔ revocation
state*, and never uses a broadcast employee number as the radio identifier.

**Audit events.** The document's nine reconstructable events, placed against the
Decision Envelope (`docs/PURPOSE.md`, *The Decision Envelope*) and the audit
ledger's current event vocabulary in `lib/signalgrid-core/src/types.ts`
(`AuditEventType`: `decision.evaluated`, `connector.synced`,
`policy.version_activated`, `evidence.captured`, `remediation.requested`,
`remediation.approved`). Names in the right column are **candidates for the
backlog item**, not members of the enum today.

| Document event | Envelope field it evidences | Ledger event today | Candidate event name (backlog; deferred design target) |
| --- | --- | --- | --- |
| Credential presented | `evidence[]` (value, source, freshness) | `evidence.captured` | `credential.presented` |
| Device / dock involved | `device`, `context.custody` | `connector.synced` (a dock fixture sync) | `dock.attached` |
| Identity authenticated | `subject`, `evidence[]` | `evidence.captured` | `identity.authenticated` |
| Device posture observed | `evidence[]` | `evidence.captured` | `posture.observed` |
| Session decision | `decision`, `reason`, `policy` | `decision.evaluated` | — (exists) |
| Application / session opened | `requested actions`, `execution results` | — | `session.opened` |
| Puck removed | `evidence[]`, `context.custody` | — | `dock.removed` |
| Session suspended / ended | `requested actions`, `verification` | — | `session.suspended` |
| Credential revoked / replaced | `subject`, `evidence[]` | — | `credential.revoked` |

The document's audit rule matches this repository's determinism invariant exactly
and is adopted as written: **the audit system records what the system actually knew
at the decision moment, and never silently rewrites historical state afterward.**
The radio credential must not broadcast PHI, and the audit record carries the
operational data needed to reconstruct access, nothing more.

## Platform notes (all as the document reports them)

- **Windows workstations and workstations-on-wheels** are the strongest first
  platform: the document reports that Entra supports device-bound FIDO2 credentials
  with attestation and authenticator-model restriction and can require
  phishing-resistant authentication strength, that Windows exposes WebAuthn APIs
  abstracting USB, NFC and BLE transports, and that a shared-PC mode handles account
  clean-up on shared endpoints. It warns that authenticating to a Windows session,
  inside an application and to an Entra-backed web resource are three different
  integrations and a prototype should test each separately.
- **iPhone and iPad:** the document reports that Apple's Core NFC reads ISO 7816,
  ISO 15693, FeliCa and MIFARE-compatible tags and that physical FIDO security keys
  over NFC or a wired connector are an explicitly supported authentication path. Its
  design rule: the phone reads or communicates with the credential, or the app runs
  a standards-based WebAuthn flow; **"iPhone impersonates a custom badge" must never
  be a core dependency.** Face ID or Touch ID is the step-up factor; the puck is the
  possession and custody factor; the two keep separate semantics.
- **Android:** the document reports host card emulation lets an app emulate ISO-DEP
  cards and can require device unlock first, and that passkeys now centre on the
  platform credential manager while an older FIDO path remains for physical keys —
  which makes Android a good test platform for *NFC puck → app → FIDO or IdP →
  biometric step-up → decision*.
- **macOS and Linux:** WebAuthn is the portable layer; native desktop login is a
  separate deployment problem and a first pilot gates browser or application
  sessions rather than replacing any OS login stack.

Golden rule 4 applies to every line above: an app cannot grant device access,
restrict other apps or kiosk itself. Anything the receiver appears to "enforce" on
the host is done by the OS or by Fleet MDM on a supervised device, or it is not done.
A bench prototype run against a simulator proves the ritual and the semantics; it
proves nothing about on-device enforcement.

## Cleaning, ergonomics, accessibility, privacy

- **Cleaning.** For ordinary IT equipment outside a sterile field the problem is
  disinfection compatibility, not sterilization. A clinical pilot favours sealed
  smooth surfaces, minimal seams, no absorbent fabric, no deep recesses, no
  fluid-trapping connector cavities, rounded edges, and materials tested against
  the site's own approved agents. **The document's own do-not-claim line, adopted:
  do not describe a puck as "hospital disinfectant compatible" until the exact resin,
  markings, adhesive, antenna and ferrite stack, gasket and cleaning regimen have
  been tested.**
- **Ergonomics.** One-handed attach and remove; works with gloves; no fine pinching
  or rotation as the only release; a broad tactile surface; feedback on the device
  (visual, audible, haptic) rather than a tiny LED on the token; the receiver must
  not block cameras, charging, scanner sleds, rugged cases or existing mounts.
- **Accessibility.** Every important state (authenticated, suspended, failed) has
  more than one feedback channel: visual, optional audible, haptic where supported,
  tactile dock engagement.
- **RF and mechanics** compete: the document reports that NFC wants a tuned 13.56 MHz
  loop with separation or ferrite shielding from metal, and that magnets and
  metallic latches must be designed around the antenna, not added afterwards.
- **Privacy and labour.** An always-on BLE or UWB workforce token can become an
  employee-tracking system very quickly. Location and history retention must be
  purpose-limited; this is a privacy concern and an adoption concern even where it
  is legal. This constraint is adopted for any future presence rung.
- **HIPAA.** The document is careful and this page repeats it: HIPAA does not certify
  or approve a badge technology. The Security Rule's safeguard categories (access
  control, person or entity authentication, audit controls) are requirements a design
  should support. Nothing here achieves or attests compliance; a human compliance
  review is required for any regulated deployment, as `CLAUDE.md` already states.

## Six lab-test classes a bench prototype must pass before any clinical pilot

1. **Authentication** — FIDO registration and authentication work repeatedly across
   the real target Windows and mobile workflows.
2. **Mechanical** — hundreds to thousands of attach/remove cycles; one-handed use;
   deliberate retention; no connector strain; no accidental release in normal
   handling.
3. **RF** — NFC tap and dock behaviour across intended case materials, nearby metal,
   charging equipment and real device models; metal, ferrite and antenna
   interactions measured, not assumed.
4. **Failure behaviour** — network outage, IdP unavailable, token revoked, device
   offline, puck removed mid-transaction, duplicate puck, damaged reader, power
   loss. **Failure defaults to a policy-defined safe state.** (This class is also
   doctrine this repository already holds; the software half can be proven against
   it with fixtures today.)
5. **Attack tests** — replay captured traffic, static-ID substitution, relay where
   practical, legacy-credential downgrade, removed-and-reinserted puck, tampered
   dock, revoked credential.
6. **Cleaning and clinical handling** — repeated exposure to the design site's
   approved agents; inspect markings, plastics, seals, adhesives, antenna tuning and
   latch behaviour after cycles.

## Pilot success criteria — an operational outcome, not "it works"

1. **Authentication time** — median time from picking up the device to a usable
   session, against the current workflow.
2. **Wrong-user / wrong-session incidents** — sessions where custody, identity and
   endpoint context disagree are detected.
3. **Suspend reliability** — removal or departure causes the expected lock within the
   agreed window.
4. **False-intervention rate** — legitimate users are not repeatedly stepped up or
   locked out.
5. **Help-desk burden** — lost, revoked and replaced pucks are handled by normal
   support staff.
6. **Clinical ergonomics** — one-handed dock and undock, in the expected PPE.
7. **Cleaning durability** — no material or mechanical failure through the pilot's
   defined cleaning-cycle target.
8. **Identity-system fit** — the credential lifecycle runs through the existing IdP,
   PACS and UEM processes with no parallel identity administration.
9. **User preference** — clinicians and technicians prefer, or at least tolerate, the
   workflow relative to their current procedure.

## Go / no-go — the discovery gates, applied to hardware

The document calls this its most important recommendation: *technical plausibility
is not the current uncertainty*, and it would be very easy to spend months making
the concept impressive. The table reapplies the thresholds pre-registered in
[`docs/agent/DISCOVERY_LOG.md`](agent/DISCOVERY_LOG.md) (lines 121–124) to hardware;
it does not invent a parallel mechanism. The tally those thresholds read from is the
*Running tally* table in the same file, and the backlog item under DR-043 ("Puck 5",
`docs/BUILD_BACKLOG.md`) adds the hardware-specific columns that table reads: **Rh**,
**Ch** and **Ph**, beside R, C and P — a row's Rh/Ch/Ph mark counts only when the row
also carries the matching base mark, gated by
[`scripts/check-discovery-log.mjs`](../scripts/check-discovery-log.mjs). The three rows
below name the tally cell each threshold reads, not a value — this page states no
current count, only the cell and the threshold; the count itself lives at the
**Hardware (DR-043)** line in the Running tally section of `docs/agent/DISCOVERY_LOG.md`
and nowhere else. Under DR-036 these gates sit beside, not instead of, the readiness
figure that gates outreach.

| External evidence | Hardware decision |
| --- | --- |
| 0–3 REQUIREMENT mentions | Do not start custom hardware. Keep the concept as a hypothesis. |
| ≥ 4 of 15 independently repeat a requirement that maps specifically to faster or stronger physical session authentication or custody binding (the **Rh** tally cell) | **Authorize a bench prototype** (family A). This is the pre-registered repeated-REQUIREMENT trigger. |
| ≥ 3 concrete COMMITMENTS, including willingness to scope and test this workflow (the **Ch** tally cell) | **Authorize a design-partner MVP** using off-the-shelf FIDO/NFC hardware and 3D-printed mechanics. |
| ≥ 5 PROBLEM but COMMITMENT = 0 (the **Ph** tally cell, read against **Ch**) | **No-go on productization.** The problem exists but is not important enough to justify hardware. |
| ≥ 5 name the same incumbent or substitute | Investigate whether that incumbent already covers authentication *and* custody or session binding before differentiating on hardware. |
| A design site says "must use our existing badge" repeatedly | Prefer the reader-dock architecture (family B) over issuing a new puck. |
| A design site says hands-free auto-lock or distance assurance is essential | Add a BLE prototype first (family D); UWB (family E) only if BLE's ambiguity is demonstrably insufficient. |
| Customers primarily want faster login, not custody or session correlation | Reconsider whether a custom puck adds enough over existing FIDO and badge products. |
| A pilot cannot beat the current workflow on speed, reliability or help-desk burden | No-go, or return to software-only session correlation. |

Four repeated requirements authorize the bench. Three concrete commitments
authorize the pilot. Problem recognition without commitment does not authorize a
hardware company.

## What this repository will not claim

Recorded under DR-043 (v). None of these may appear as a present-tense capability
or property of SignalGrid, a puck, a receiver or a pilot:

- HIPAA compliance, certification or approval — of the puck, the software or a
  deployment. A human compliance review is required, not optional.
- "Hospital disinfectant compatible", or any cleaning-durability claim, until the
  exact material stack and regimen have been tested and the test is recorded.
- "Relay-proof", "clone-proof", or that the design **prevents** an attack. Every
  mitigation raises assurance or reduces risk; none is a guarantee.
- On-device enforcement — that the puck, the receiver or SignalGrid locks, kiosks,
  restricts or wipes a device. That is the OS and Fleet MDM on a supervised device.
- That a dock attach event identifies anyone. It is custody intent; identity is the
  IdP's assertion.
- That any puck, receiver, reader dock, BLE or UWB hardware is built, tested,
  shipping, piloted, partnered or certified.
- Any cost figure as a fact. The document's bands are estimates and are not
  reproduced here.

## A note on disclosure

This tree is public. The concept above is now disclosed by being written here; the
owner-gated *IP / disclosure posture* row in [`docs/BUILD_BACKLOG.md`](BUILD_BACKLOG.md)
(the provisional-patent and repository-visibility decision, unresolved as of this
write) predates this page and still stands. This page carries the document's
substance and the tree's own prior art (SmartDock, the case-bay token, the
`badge_binding` dimension); it does not carry an invention disclosure, drawings or
claims, and none should be added here without that decision.

## Related pages

- [Physical Custody signal model](PHYSICAL_CUSTODY_SIGNAL_MODEL.md) — the
  vendor-neutral dock, custody and tamper schema the puck's attach/remove evidence
  would land in (a deferred design target).
- [Hardware partner matrix](HARDWARE_PARTNER_MATRIX.md) — the candidate hardware
  categories and the division-of-authority stance the puck inherits.
- [Elevated-access hardware token](HARDWARE_ELEVATED_ACCESS_TOKEN.md) — the earlier
  case-mounted FIDO2 token concept, scoped to dual-control step-up.
- [SignalGrid SmartDock](SIGNALGRID_SMARTDOCK.md) — the embedded dock concept whose
  reader case already reports `present` / `removed` / `forced`.
- [Credential Reader Signal Model](CREDENTIAL_READER_SIGNAL_MODEL.md) — the
  `badge_binding` dimension the removal-to-suspend rule already lives in.
- [Custody beacon](CUSTODY_BEACON.md) — the recovery-not-surveillance stance the
  privacy constraint above continues.
- [Decision records](DECISION_RECORDS.md) — DR-043.

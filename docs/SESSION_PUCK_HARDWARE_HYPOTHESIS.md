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

## Owner refinement (2026-09-23, DR-055)

On 2026-09-23 the owner described a seven-part flow (C1–C7) for the puck, with docks, lockers
and workstation tap points around it. DR-055 records it as a **refinement of this hypothesis,
not a product**, and names, component by component, what each part becomes and whose job it
is. This section holds the flow against this page. It stays at this page's level of
abstraction: no latch, lock or locker-release mechanism is described, because the owner-gated
*IP / disclosure posture* row in [`docs/BUILD_BACKLOG.md`](BUILD_BACKLOG.md) is still open.
Nothing here moves a hardware gate or states a tally; the go/no-go section above says where the
count lives. Everything below is a design target, not a shipped surface.

### The seven components against this page

| # | The owner's component (his words where quoted) | Against this page | Review verdict | What it becomes |
| --- | --- | --- | --- | --- |
| C1 | A *"MagSafe-style"* magnetic puck that locks onto the back of the device | **Reframe.** A magnetic seat is family A's "click or magnetic receiver". The lock conflicts with the ergonomics line (one-handed, works with gloves) and changes what `removed` means; a seated credential rules out magnetic wireless charging, because Apple warns against a badge or key fob between the phone and its charger ([Apple 105047](https://support.apple.com/en-us/105047)) | Feasible only if reframed; the credential lock itself is not recommended | Family A's receiver with a seat sensor that holds no identity; no magnetic wireless charging through a seated credential |
| C2 | *"All the user's info and auth info — everything"*, and building access where a site has no face or fingerprint reader | **Conflicts** as written with *"The radio credential must not broadcast PHI"* and DR-043 item 2; the go/no-go row for *"must use our existing badge"* already prefers family B | Feasible only if reframed | Keys only; a PACS-issued door applet with legacy Prox off; the worn or Wallet badge first |
| C3 | An AirTag-like tag that *"other systems"* can use, inside and outside the office | **Conflicts** with the privacy paragraph (*"can become an employee-tracking system very quickly"*) and the threat row on broadcast identifiers; it jumps to rungs D and E | **Not feasible as described** | No tracking or locating beacon (Find My or AirTag-class) in the puck — DR-043's NFC/FIDO core and its BLE and UWB presence rungs are unchanged; device-bound, zone-level recovery location, per [Custody beacon](CUSTODY_BEACON.md) |
| C4 | Docks and lockers running SignalGrid software *"that taps into all the systems"* | **Reframe.** The division of authority already makes any dock a source of evidence, never the policy engine | Feasible only if reframed | The locker vendor releases the bay; SignalGrid returns a per-device ready or hold; the dock holds no connector credentials |
| C5 | Attaching the puck *"gives customer access to all systems"* | **Conflicts** with the do-not-claim line *"That a dock attach event identifies anyone"* and with `lib/signalgrid-core/src/attach.ts:22` | Feasible only if reframed | Attach may start a sign-in; the IdP grants it with user verification; SignalGrid decides per action |
| C6 | A tap at a workstation or WOW for *"passthrough authentication"*, with the phone's session carried to the desktop | **Partly fits** the Windows platform note (FIDO2 sign-in; three separate integrations). The carry-over **conflicts** with platform facts and with `lib/work-context/src/types.ts:1` | Feasible only if reframed; the carry-over is not feasible | A fresh sign-in owned by that endpoint; VDI roaming for the desktop; only a description of the work travels |
| C7 | Tap the puck on the dock to return; the device is *"cleared and sanitized for next user"* | **Reframe.** Clearing is the MDM's on a supervised device (golden rule 4); a cleaning claim meets the disinfectant do-not-claim line | Feasible only if reframed | Docking is the return; the MDM or IdP clears; SignalGrid gates readiness; cleaning is attested by a person, read as evidence from the system that owns it (the locker or mobile-access-management vendor, the cleaning-tracking app or the host app), never captured on a SignalGrid surface |

### New policy-matrix rows

Candidate fixture rows for the backlog items named in the last column — a design target, not
shipped behaviour — on the same verdict ladder as the matrix above.

| Situation | Verdict | Why, in this tree's terms | Backlog |
| --- | --- | --- | --- |
| The holder's own credential returns the device at a dock | Custody closed, session ended — **not** `CUSTODY_REMOVED` | A planned return is not a walk-away. Under PR #1005's live attach rules a return read as `removed` restricts, and that code has no resolution descriptor, so every shift change would escalate | Puck 6 |
| The puck leaves its seat with no authorized release, or a tamper or seat-break reading arrives | `deny` — forced (`CUSTODY_TORN`) | An unauthorized release is the torn-removal case; an authorized release with no return still restricts (`CUSTODY_REMOVED`, `lib/signalgrid-core/src/attach.ts:218`–`222`), so an ordinary walk-away is not turned into `deny` | Puck 6 |
| The device and the puck go missing together | `deny`, plus an approval-gated revoke request to the IdP and the PACS | When both are gone, possession is no evidence of anything | Puck 8 |
| A presence-only assertion (no user verification) for a broad-scope session | Never `allow`; `step_up` | Presence is not verification; `identityConfirmed` is a plain yes/no today (`attach.ts:170`) | Puck 8 |
| An attach reported only by a mechanical sensor, when deciding whether to keep a session open | Treated as `unknown` → `step_up` | A magnet or a dummy puck satisfies a microswitch, Hall or contact sensor | Puck 8 |
| An active alarm or call assignment, and the puck is removed or its state is unknown | Escalate through break-glass — **never a silent suspend** | Fail closed means a human decides; it never means the alarm path goes quiet | Puck 8 |
| A device returned with a different puck from the one that checked it out, or with a puck reported lost | Custody exception; the checkout stays open | A found or stolen puck must not be able to close a missing-device alert | Puck 9 |
| A site that declares docks expected, and a device's dock feed is missing | Not ready — tightens, per device | Missing dock evidence is neutral today (`lib/signalgrid-core/src/evidence.ts:150`–`156`), which is right only where no dock exists | Puck 9 |
| Any clearing step after a return is unobserved | Not ready | Readiness is positive evidence of each step, never the absence of a complaint | Puck 7 |

### Open questions — recorded with their sources, not answered

None of these is a claim in either direction. Each is a question for the design site, clinical
engineering, infection prevention, a human compliance review or counsel, and each stays open
until one of them answers it in writing.

1. **Cleaning and infection control.** The *Cleaning* bullet above covers the puck's materials
   only. A worker-carried puck attaches to every shared device it meets and is not cleaned at
   the C7 return, so the next attach could carry one shift's contamination onto a device that
   was just cleaned (the review's inference; not measured). CDC's *C. diff* guidance says
   *"Perform daily cleaning of CDI patient rooms using a C. difficile sporicidal agent (EPA List
   K agent)"* (<https://www.cdc.gov/c-diff/hcp/clinical-guidance/>). Apple says of its products
   *"Don't use products containing bleach or hydrogen peroxide"* and names a 70 percent
   isopropyl alcohol wipe, a 75 percent ethyl alcohol wipe or Clorox Disinfecting Wipes
   (<https://support.apple.com/en-us/103258>). Open: which agents a design site uses in
   contact-precaution and isolation rooms, whether any of them is both sporicidal and within the
   device maker's list, whether the puck needs its own cleaning step at return, and who attests
   it.
2. **EPCS.** 21 CFR 1311.115(b): *"If one factor is a hard token, it must be separate from the
   computer to which it is gaining access and must meet at least the criteria of FIPS 140-2
   Security Level 1"* (<https://www.law.cornell.edu/cfr/text/21/1311.115>). Entra's
   compatibility matrix: *"NFC with FIPS 140-3 certified security keys isn't supported on iOS by
   Apple."* (<https://learn.microsoft.com/en-us/entra/identity/authentication/concept-fido2-compatibility>).
   The review reads a puck seated on the phone it signs into as not separate from it, and a
   FIPS 140-3 certified key as unsupported over NFC on iOS (Entra). The EPCS floor is the FIPS
   140-2 Security Level 1 criteria, a different bar from a 140-3 certificate, so whether a key
   that meets those criteria works over NFC on that iPhone is part of this open question. On the
   separateness reading alone, controlled-substance signing would keep its own separate
   factor, which is what incumbents sell
   ([`docs/research/COMPETITIVE_IMPRIVATA.md:14`](research/COMPETITIVE_IMPRIVATA.md)). Open for a
   human compliance review.
3. **Medical-electrical safety on a WOW.** A powered receiver, reader or dock added to a
   workstation-on-wheels in the patient environment may bring in IEC 60601-1's rules for medical
   electrical systems and a clinical-engineering or EMC review. Not sourced: the standard was not
   read. Open for clinical engineering.
4. **MRI zones.** A magnetic puck carried into an MRI suite's controlled zones
   could be a projectile risk. Not sourced: the ACR's MR-safety zone guidance would be the
   reference and was not fetched. Open, and a discovery question.
5. **Implanted devices.** Apple: *"Most medical device manufacturers recommend keeping a source
   of potential interference a safe distance away from your medical device (at least 6 inches /
   15 cm apart or at least 12 inches / 30 cm apart when using a wireless charger)"*
   (<https://support.apple.com/en-us/109025>). A magnetic puck worn by the worker and held close
   to patients adds a magnet near implants, the worker's own included. Not assessed. Open for
   clinical engineering.
6. **The alarm path.** Secondary alarm-notification systems that deliver monitor alarms to
   phones are FDA Class II devices (product code MSX, 21 CFR 870.2300,
   <https://api.fda.gov/device/classification.json?search=product_code:MSX>; for example
   K180566, <https://api.fda.gov/device/510k.json?search=k_number:K180566>). A gate that
   suspends such a phone sits across that path. Whether that changes SignalGrid's own regulatory
   status is a question for regulatory counsel; the escalate-never-silently-suspend row above is
   the design answer, not a regulatory one.
7. **A battery in the puck.** Only if a powered puck is ever built — DR-043's BLE and UWB
   rungs (families D and E) would be one, and they climb only on evidence; the C3 verdict
   refuses a tracking or locating beacon, not those rungs: coin-cell ingestion risk in
   paediatric and behavioural units was not researched, and whether consumer button-battery
   rules reach an enterprise product is for counsel.

### Added to what this repository will not claim (DR-055)

In addition to the list above, and recorded in DR-055, none of these may appear as a
present-tense property of SignalGrid, a puck, a receiver, a dock, a locker or a tap point:

- "Made for MagSafe", "MagSafe compatible", any Qi2 claim, or Apple's name, logo or trade dress
  as a product attribute.
- "Works with Apple Find My", "AirTag-style tracking other systems can use", "tracks staff".
- "Sanitized", "disinfected by SignalGrid", "wiped by SignalGrid".
- "Moves or restores app sessions between devices", "performs passthrough sign-in", "tap with
  no PIN", "the puck unlocks the device", "attach grants access to all systems".
- That the puck stores user data, or that any puck can serve as an EPCS factor.
- Any login-time saving or "faster login".

## Assigned-device mode (owner note 2026-09-24, DR-055 amendment)

On 2026-09-24 the owner added that the shared-device puck above is *"only one examples of shared
use case"*, and that a one-to-one user — a knowledge worker or an executive — would be *"similar
without the return to dock"*: the puck stays on the back of the user's own phone, signs them in to
their *"assigned workstation"*, and *"if a device is not assigned to that user the puck workflow
for authentication will not work"* — *"another security layer"* reaching devices and systems
*"regardless if it physically or app or website"*. DR-055 item 6 records it. This section holds
it against this page, at this page's level of abstraction and under the same disclosure limit as
the section above. Everything here is a design target; nothing is built, and no hardware gate
moves.

### Two modes, one policy

The mode is a declared input — `shared`, `assigned` or `unknown` — per device group, set by the
tenant and approval-gated, never inferred from a missing primary user. It is not a hosting model
(`docs/DEPLOYMENT_MODELS.md`) and not an ownership value. `unknown` raises in both modes, a mode
change re-evaluates everything, and no custody or assignment state carries over.

| Applies to | Rules |
| --- | --- |
| Shared mode only | PR #1005's attach semantics (`removed` → `restrict`, `CUSTODY_REMOVED`; a present but unreadable reading → `step_up`, `CUSTODY_UNKNOWN`); the `puckVerdict` ladder (`lib/signalgrid-core/src/attach.ts:211`–`250`), the custody ledger, dock readiness and return (C4, C7, Puck 6–9); checkout binding (Puck 9) |
| Assigned mode only | Assignment coherence — provenance, read freshness, change history, sources that disagree, loaner, transition (Puck 11, Puck 12); the assigned phone's lifecycle — lost, not observable, swap versus loss; local-enforcement drift (Puck 15). A phone-mounted attach is never graded; a desk reader, where a site has one, uses the shared attach semantics for that reader only |
| Both | Credential downgrade → `deny` (`lib/signalgrid-core/src/attach.ts:216`) and passkey attestation; the user-verified axis (Puck 8) — presence-only never reaches `allow` for a broad scope; `SESSION_SUBJECT_MISMATCH` — `escalate` while the session is active, `restrict` once it has expired (`lib/integrations/src/integrations/sso-session/evaluate.ts:64`–`72`); a revoked or lost key → correlated, approval-gated revocation requests to the IdP, the PACS and SignalGrid's session mappings; break-glass pinned in tenant config, every use alerting; SignalGrid unreachable → each surface's own rule stands; a declared *credential required* flag (Puck 13); outputs as `/v1` verdicts, CAEP claims sets and approval-gated requests, advisory at the login window |

### The note's five claims against this page

| # | The owner's claim | Against this page | Review verdict | What it becomes |
| --- | --- | --- | --- | --- |
| A1 | A one-to-one assigned mode; no return to a dock; the puck stays magnetically on the back of the user's own phone | **Reframe.** Family A's receiver is a seat on a shared device; here the seat is the user's own phone, which nothing can read (AccessorySetupKit discovers Bluetooth or Wi-Fi accessories, <https://developer.apple.com/documentation/accessorysetupkit>) | Feasible only if reframed: shared versus assigned is an industry-standard split, the magnet is a way to carry the puck and not a security layer, and it has a cost (below) | A declared mode input; phone-mounted attach readings never graded; the assigned phone's lost and swap state fused from the MDM, the IdP and ticketing, tightening only |
| A2 | The puck signs the user in to their assigned workstation | **Fits** the Windows platform note (FIDO2 sign-in) and C6's fresh-sign-in reframe, unchanged | Already native elsewhere: Entra FIDO2 key sign-in on Entra joined and hybrid joined PCs, Platform SSO's smart-card method on a Mac, Windows Hello for Business on an assigned PC | SignalGrid judges the session a fresh, endpoint-owned sign-in produces; advisory at the login window |
| A3 | Not assigned to that user → the puck sign-in does not work; *"another security layer"* | **New.** This page has no row comparing a credential with a device's assigned user | Feasible only if reframed: a policy check over existing records, not a factor; the enforcement stays native; the record itself can be attacked | Assignment coherence: a credential-agnostic decision input that only tightens; SignalGrid audits drift and requests changes, never writes |
| A4 | That layer reaches physical access, apps and websites | **Fits** the division of authority above and `docs/PURPOSE.md:80`–`86` | Feasible only if reframed: "controls" is the wrong verb | One verdict, consumed by each surface with a different reach: apps and websites through the IdP or a `/v1` call; doors revoke-after at a reader, decide-first through an API; devices through the OS lists |
| A5 | The 2026-09-23 flow is one shared-device example, not the product | **Fits**: DR-043 records the puck as one hardware hypothesis and `docs/PURPOSE.md:80`–`86` scopes the grid to every system the company runs | Feasible as stated, with cautions: the launch path stays one shared-device workflow (`docs/LAUNCH_PROFILE.md:5`); assigned mode needs its own fixtures and proofs, not a flag on the shared flow; a new persona gets decision coverage before any build and discovery evidence before any claim | Same engine and verdict vocabulary; the mode is an input, not a fork |

### Assignment-coherence policy rows

Candidate fixture rows for the backlog items named in the last column — a design target, not
shipped behaviour — on the same verdict ladder as the matrix above. "Credential subject" is the
user a credential is registered to: a FIDO2 assertion names that user, not whoever holds the key,
so an assistant holding an executive's puck and PIN looks like the executive, and sharing shows
only through contradicting presence. Until the owner answers which device *"not assigned"* means
(open question 1), the rows read the workstation.

| Situation | Verdict | Why, in this tree's terms | Backlog |
| --- | --- | --- | --- |
| A device group's mode is undeclared or `unknown`, on a workflow the tenant opted into assignment policy | `step_up`, `ASSIGNMENT_MODE_UNKNOWN` | Unknown raises; the opt-in is declared, never inferred from missing MDM data | Puck 10 |
| A device group flips assigned → shared | Approval-gated (two-person), audited, then a `step_up` cooldown, `ASSIGNMENT_MODE_CHANGED` | A loosening, graded like policy-binding's *binding too WIDE* (`lib/integrations/src/integrations/policy-binding/types.ts:1`–`48`); shared → assigned tightens and needs no gate | Puck 10 |
| A device declared shared carries an admin-set primary user | Drift finding | The declaration and the record disagree | Puck 10 |
| Credential subject = the workstation's confirmed assigned user, every record freshly read, no recent unexplained change | `allow` — advisory post-logon; the OS list is the enforcement | SignalGrid has no login-window hook | Puck 11 |
| Credential subject ≠ the confirmed assigned user, device declared assigned | `deny`, `ASSIGNMENT_MISMATCH` | Only against a confirmed assignment | Puck 11 |
| Assignment set by first sign-in or by a device-enrollment-manager account, not yet confirmed by an admin event or a tenant roster | `step_up`, `ASSIGNMENT_UNCONFIRMED` | Intune sets the primary user automatically on those paths | Puck 11 |
| Declared assigned, the source reports no assigned user | `step_up`, `ASSIGNMENT_MISSING` | Today an ownerless device is only counted (`lib/integrations/src/integrations/graph/estate.ts:8`–`10`) | Puck 11, Puck 12 |
| The device is absent from the read, or more than one user is mapped to it | `step_up`, `ASSIGNMENT_UNKNOWN` — never `not_applicable` | A Fleet host's `end_users` is an array | Puck 11, Puck 12 |
| The last successful read is older than the tenant's bound | `step_up`, `ASSIGNMENT_STALE` | Freshness is read age from an injected clock, never assignment age | Puck 11, Puck 12 |
| The assignment changed inside the tenant's cooldown | `step_up`, `ASSIGNMENT_RECENTLY_CHANGED` | Intune's Help Desk Operator role and Fleet's device-mapping endpoint can both rewrite the record | Puck 11 |
| The change's actor is the new assignee | `deny` plus an alert, `ASSIGNMENT_SELF_GRANTED` | A self-grant is the attack the record invites | Puck 11 |
| A change with no linked ticket; change history unreadable | `step_up` plus an alert; unreadable history → `step_up` for high-risk actions | Unknown raises | Puck 11 |
| An unassign or reassign seen in the audit feed but not yet in the device record | `step_up`, `ASSIGNMENT_IN_TRANSITION` | The two reads disagree for a while | Puck 11 |
| The tenant's authoritative source and another source disagree | Drift finding, `ASSIGNMENT_SOURCES_DISAGREE`; `step_up` for high-risk actions only; no authoritative source declared → `step_up` | Intune primary user, Entra registered owner, Fleet end user and Jamf can each hold a different answer | Puck 11 |
| A loaner corroborated by the MDM (primary user actually changed, or the device sits in a declared loaner group), the ticket's creator is not the loaner, inside its window | `step_up`, `LOANER_TEMPORARY_ASSIGNMENT`; a ticket alone leaves `ASSIGNMENT_MISMATCH` standing plus a finding; a missing or unparseable window counts as expired | A ticket alone never loosens a verdict | Puck 11 |
| An assertion for an executive's credential while the executive's other presence contradicts it — a door read at another site, a concurrent session, `impossible_travel` (`lib/integrations/src/integrations/identity-risk/types.ts:39`) | `step_up` or escalate | A delegate uses their own credential under IdP or app delegation | Puck 11 |
| A break-glass account (pinned in SignalGrid tenant config, approval-gated) on an assigned workstation | Excluded from the assignment rule; every sign-in raises a high-severity alert; unknown break-glass status is not excluded | The administrator break-glass is platform-sso's (`lib/integrations/src/integrations/platform-sso/evaluate.ts:168`–`173`), not the clinician break-glass family (`lib/integrations/src/integrations/break-glass/types.ts:7`–`11`) | Puck 11 |
| The tenant configures "phone must be present" for a puck ceremony | Refused at setup, alert `POLICY_UNOBSERVABLE`; the previous policy stands | The phone takes no part in a puck sign-in | Puck 11 |
| The assigned phone is in Lost Mode, or the IdP revoked the puck key, or a loss ticket is open | `deny` puck-backed sign-ins for that credential subject, `ASSIGNED_DEVICE_LOST`, plus an approval-gated key-revoke request | A lost phone carries its puck with it | Puck 11 |
| The assigned phone cannot report Lost Mode (unsupervised or user-enrolled) | Lost state `not_observable`: puck-backed high-risk actions `step_up`, plus a tenant finding | Intune Lost Mode covers supervised iOS/iPadOS and ChromeOS only (<https://learn.microsoft.com/intune/device-management/actions/lost-mode>) | Puck 11 |
| Lost Mode is turned off while the loss ticket is still open | Alert and re-evaluate; never a silent return to `allow` | | Puck 11 |
| Retire or wipe with no recorded non-loss reason | Treated as `ASSIGNED_DEVICE_LOST` | | Puck 11 |
| Retire or wipe with a recorded non-loss reason (upgrade, trade-in), the new phone not yet assigned | `step_up`, `ASSIGNMENT_IN_TRANSITION`, satisfied by a factor independent of both phones (for example an IdP Temporary Access Pass after identity proofing) | Never `allow` on the stale record | Puck 11 |
| A Temporary Access Pass is issued to the credential subject | Re-evaluate; puck-backed high-risk actions `step_up` | Not a `deny`: a Temporary Access Pass is also routine onboarding | Puck 11 |
| A door credential issued to a device that is not the holder's assigned device, where the PACS exposes that mapping | Advisory `deny` plus an approval-gated suspend request | The PACS decides at the reader; SignalGrid can only act afterwards. Where the mapping is not exposed the reading is unknown and the row does not fire | Puck 11 |
| An app or website sign-in from a device Entra has no record of | Assignment unknown → `step_up` | Conditional Access treats every property of an unregistered device as null | Puck 11 |
| A workstation declared credential-required, and no assertion or attach reading arrives | `step_up`, `REQUIRED_CREDENTIAL_UNOBSERVED` — never `not_applicable` | See Puck 13 for how this meets PR #1005's `not_applicable` | Puck 13 |
| A declared-assigned workstation whose `AllowLocalLogOn` is unset or holds a broad group (Users, Authenticated Users, Guest) | Finding `ASSIGNMENT_NOT_ENFORCED_LOCALLY`; `step_up` for high-risk workflows from that workstation only; an approval-gated MDM change request | Stepping up every decision would lock most tenants out on day one and get the rule switched off | Puck 15 |
| The local list is readable and diverges from the confirmed assigned user | Drift finding plus an approval-gated MDM change request | SignalGrid never writes the list | Puck 15 |
| The target is RDP, VDI or a server | Not a puck path; grade the broker's own sign-in | Entra lists RDP, VDI and Citrix without WebAuthn redirection, and server sign-in, as unsupported for security keys (<https://learn.microsoft.com/entra/identity/authentication/howto-authentication-passwordless-security-key-windows>) | — |
| Any surface, SignalGrid unreachable | That surface's own rule stands | Never grant by absence | — |

### What the magnet costs

- **Charging.** The charging warning quoted in the C1 row above ([Apple 105047](https://support.apple.com/en-us/105047))
  applies to the user's own phone as much as to a shared one: an NFC puck comes off for every
  wireless charge, so it is not always attached.
- **NFC coexistence.** Apple's *Accessory Design Guidelines* (the edition dated 2026-09-21,
  <https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf>) say accessories
  *"shall not degrade a device's NFC transaction performance"* (4.9.5). The phone's own Wallet
  badge and payment cards use the same NFC radio, so a phone-back puck carries that test burden.
  Whether it passes is untested (open question 12).
- **The carrier.** The same guidelines say a case claiming magnetic wireless-charging
  compatibility shall *"Not have rear pockets or holders for credit cards, RFID cards, or other
  similar items"* (5.1.4).
- **Macs.** Platform SSO's methods are password, web, smart card, Secure Enclave-backed key and a
  Wallet access key, and Tap to Login works only on a Mac configured for Authenticated Guest Mode,
  with *"an attached NFC reader"*
  (<https://support.apple.com/guide/deployment/platform-sso-for-mac-dep7bbb05313/web>). On a
  one-to-one Mac a puck therefore presents as a smart card (the review's reading), which means a
  reader at every assigned desk or a detach to plug it in, against Platform Credential at no added
  hardware.
- **Theft.** The phone and the puck are stolen together; the puck's PIN and the phone's own unlock
  are the only barriers.

### What a buyer already has

The assigned-mode buyer is not starting from nothing. Each of these is native today, and each is
a reason a buyer may not want a puck at all:

- **Windows Hello for Business** on the assigned PC. Microsoft's persona guidance puts it first on
  a dedicated PC and an NFC FIDO2 key built into the access badge for other devices
  (<https://learn.microsoft.com/windows-365/enterprise/choosing-authentication-method>).
  **Trusted signal unlock** adds a second signal such as a Bluetooth-paired phone in range, on a
  Hello PIN, fingerprint or face (not a FIDO2 key); Microsoft tells organizations using it to turn
  off non-Microsoft credential providers, and a lost, stolen or replaced signal device can lock
  the user out until it is reconfigured
  (<https://learn.microsoft.com/windows/security/identity-protection/hello-for-business/trusted-signal-unlock>).
- **Platform SSO / Platform Credential** on the assigned Mac (the Secure Enclave-backed key method,
  above).
- **An attested passkey** on the assigned phone: Entra passkey profiles can enforce attestation at
  registration
  (<https://learn.microsoft.com/entra/identity/authentication/howto-authentication-passwordless-security-key-windows>).
- **A Wallet employee badge** for doors. Apple: putting the device in Lost Mode *"turns off access
  to Apple Wallet and temporarily removes your cards and passes, including your employee badge"*,
  and turning it back on asks for the Apple Account password
  (<https://support.apple.com/en-us/119901>).
- **Per-user virtual desktops.** *"Each Cloud PC is assigned to an individual user"*
  (<https://learn.microsoft.com/windows-365/enterprise/overview>); an Azure Virtual Desktop
  personal host pool maps a single user to a single personal desktop by default
  (<https://learn.microsoft.com/azure/virtual-desktop/configure-host-pool-personal-desktop-assignment-type>).
- **Walk-away lock.** Dynamic Lock locks the PC when the paired phone leaves; its signal rule takes
  configurable `rssiMin` and `rssiMaxDelta`, with the defaults recommended
  (<https://learn.microsoft.com/windows/security/identity-protection/hello-for-business/hello-feature-dynamic-lock>).
  It only locks. The Windows Hello companion device framework, the companion-unlock API the review
  found, is deprecated since Windows 10, version 2004
  (<https://learn.microsoft.com/windows/uwp/security/companion-device-unlock>).

What is left for SignalGrid is narrow: an app or web sign-in on a managed device compared with
the MDM's assigned user, and drift across the Intune primary user, the Entra registered owner, the
Fleet end user, the local logon lists and Mac local accounts. In the review's reading of the
products above, neither is offered as a built-in check; that reading is not exhaustive, and
"SignalGrid-only" is on the do-not-claim list below.

### Open questions — recorded, not answered

1. **The owner's.** Does *"a device not assigned to that user"* mean the workstation, the phone,
   or both? The workstation reading can be enforced by the OS today and checked by SignalGrid. The
   phone reading cannot be proven at a puck tap, because the phone takes no part in that sign-in.
2. **Android.** The note assumes an iPhone. Android phones, magnetic cases on them, and Android
   fully managed passkeys and NFC were not researched. Unsourced.
3. **Other workstations and brokers.** Linux and ChromeOS workstations, and VDI brokers beyond RDP
   and Azure Virtual Desktop, were not researched. Unsourced.
4. **Other IdPs.** Ping, Duo, Google Workspace and CyberArk were not researched. Okta Desktop
   MFA's limits (no offline FIDO2 on Windows; no passkeys or biometric-only keys) came from one
   skeptic and were not re-read. Unverified.
5. **Jamf.** Jamf Pro's computer inventory has a *User and Location* category
   (<https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Inventory_Information>);
   its field list and how it is populated are unsourced.
6. **Intune through Graph.** Whether Graph's `managedDevice.userId` equals the primary user the
   portal shows (unsourced), and reading the Entra registered owner and the primary-user-change
   audit event through Graph (skeptic-sourced, not re-read).
7. **The effective local list.** Whether the EFFECTIVE `AllowLocalLogOn` list per device can be
   read back from Intune or Graph. Unsourced; without it the drift auditor sees only intended
   policy (Puck 15's first task).
8. **Trusted signal unlock.** Whether its events name the paired phone, and whether that
   relay-prone Bluetooth signal is mitigated. Unsourced.
9. **A user's own lost report.** Whether marking a phone lost through Apple's consumer service
   reaches the MDM. Unsourced.
10. **Doors.** Whether a Wallet-badge door event tells the PACS, or an API over it, which device
    presented it. Unsourced; until it does, a door row keyed on the presenting device does not
    fire.
11. **Apple-side one-to-one assignment.** Automated Device Enrollment with User Affinity and
    Managed Apple Accounts as a readable assignment source for an iPhone. Not researched.
12. **NFC coexistence** of a phone-back puck with the phone's own Wallet badge and payment cards at
    readers (the 4.9.5 test burden above). Unsourced.
13. **Unverified vendor facts.** A cloud unlock or access grant through an access-control API as
    a decide-first point; the Primary Refresh Token behaviour when a device is disabled (tokens
    end, an open local session continues); Entra's example of a device-bound, attestation-enforced
    passkey profile for executives. Each came from one skeptic and was not re-read.
14. **Buyer demand.** No discovery evidence of any buyer wanting a puck in one-to-one mode. The
    prompts are in `docs/agent/DISCOVERY_LOG.md` (*Hardware follow-up prompts*).
15. **Edge cases no row handles yet.** A user assigned to several devices (per the review, Intune gives a
    device one primary user while one user can be primary on many; a Fleet host's `end_users` is
    an array); a device assigned by day and a hot desk by night (mode per time window); a live
    session when the assignment changes (re-evaluate and push a CAEP event); a leaver whose IdP
    account is disabled while an assignment record still names them (the IdP disable must win);
    offline workstations (per the review, not re-read, Windows Web sign-in needs the internet;
    freshness bounds meet offline laptops); a stolen phone and puck plus a shoulder-surfed PIN (user verification is the only
    barrier); rollout — declaring modes in bulk and importing a roster to confirm assignments
    without mass step-ups; accessibility — a PIN on every tap for users with motor or reading
    impairments; privacy — an assignment record plus presence contradictions about an executive is
    personal data, whose purpose and retention need declaring (the DPIA is the customer's); an
    executive abroad on a loaner with no MDM-corroborated temporary assignment; and multi-account
    keys — Windows signs in the last-added account on a key holding several, so a puck with a
    personal and an admin account needs a rule.

### Added to what this repository will not claim (2026-09-24)

In addition to both lists above, and recorded in DR-055 item 6:

- "The puck knows it is on your phone", "detects removal from the phone", "makes the phone more
  secure", "unlocks the phone".
- "Always attached", "never needs to come off", or "no return needed" as a security feature.
- "A second deployment model" in the `docs/DEPLOYMENT_MODELS.md` sense; "supports assigned-device
  or executive deployments"; "executives and knowledge workers need a puck"; "one puck serves
  both modes"; "the puck is the product".
- "SignalGrid logs you into your PC", "tap your phone to log in to your Mac" for a one-to-one Mac,
  "works on any workstation", "unlocks when you walk up", "your phone session follows you to the
  desktop", "faster than Windows Hello", "works offline" for an Okta tenant.
- "The puck only works on your devices", "SignalGrid blocks logons to unassigned PCs", "Entra or
  Intune already enforce primary-user-only sign-in", "proves your phone was with you", "an extra
  authentication factor", "detects a shared puck or PIN", or that assignment coherence across
  door, device, app and web is SignalGrid-only.
- "SignalGrid controls access to doors, devices and websites", "real-time veto of a
  credential-at-reader door", "works with any website", "device-bound sessions for every web
  app", "replaces Conditional Access or the PACS".

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
- [Decision records](DECISION_RECORDS.md) — DR-043, and DR-055 for the owner's 2026-09-23
  refinement and its 2026-09-24 assigned-device amendment.

# RADIUS / NAC live shape-check — the network department's first shift

**Status: COMPLETED live, 2026-08-19 (cloud lane, ephemeral in-sandbox lab).**
This is the first activation of the `network-domain` role from
`docs/ORG_CHART.md`, and it was chosen because that department owned the
largest cluster of signal dimensions with **no live source ever driven against
any of them**.

The `network-nac` dimension's shapes (`NetworkPostureRaw`,
`NormalizedNetworkSignal` in `lib/integrations/src/integrations/network-nac/types.ts`)
were checked against **real RADIUS** — the protocol every NAC product
(Cisco ISE, Aruba ClearPass, FortiNAC) actually speaks underneath its console
— using FreeRADIUS with a lab client, two provisioned devices and one unknown
device.

**No code changed. No connector was built. The breadth freeze is untouched.**
This records what the wire actually says so the shapes stop being untested.

## The lab (ephemeral, in-container, nothing committed)

`freeradius/freeradius-server:latest`, one NAS client (`labsecret`), and two
users in `mods-config/files/authorize`: one landing on a corporate VLAN, one on
a quarantine VLAN. Requests driven with `radclient` carrying the attributes a
real switch or WLC sends: `Calling-Station-Id`, `Called-Station-Id`,
`NAS-Port-Id`, `NAS-Port-Type`, `NAS-IP-Address`.

*Sandbox note:* the image's default site binds an IPv6 listener; IPv6 is
unavailable here, so the two `ipv6addr = ::` listen blocks were removed from a
copy of `sites-available/default` and mounted back. That is an environment
artifact, not a product finding.

## Finding 1 (the important one) — **a quarantined device is ACCEPTED**

Both provisioned devices produced **`Access-Accept`**. Verbatim, the quarantine
case:

```
Received Access-Accept
	Tunnel-Type:0 = VLAN
	Tunnel-Medium-Type:0 = IEEE-802
	Tunnel-Private-Group-Id:0 = "quarantine-999"
	Filter-Id = "REMEDIATION_ONLY"
```

RADIUS has exactly two authentication outcomes on the wire: `Access-Accept` and
`Access-Reject`. **There is no quarantine packet type and no quarantine
attribute.** A quarantined device is *authenticated*; it is simply assigned a
different VLAN and filter.

Our `NetworkAuthState` is `"authenticated" | "unauthenticated" | "quarantined" |
"unknown"`, which places `quarantined` as a peer of `authenticated`. On the wire
it is a **subtype** of authenticated, and it is derived by comparing the
assigned VLAN / `Filter-Id` against the tenant's own policy — those strings
(`corp-100`, `quarantine-999`, `REMEDIATION_ONLY`) are **customer-chosen policy
names, not protocol constants**.

The evaluate side already has the right instinct: `SegmentPolicy { expected,
restricted }` is exactly the comparison this requires. The risk sits in
`NetworkPostureRaw.authState` being a free string, which invites a future
normalizer to expect a source to *say* "quarantined". No source says it. Any
adapter must derive it, and a console that reports it is reporting its own
derivation, not a wire fact.

## Finding 2 — **a rejection carries no reason**

```
Received Access-Reject ... length 38
	Message-Authenticator = 0x...
```

That is the entire packet. No cause, no policy name, no VLAN. From an
`Access-Reject` alone an adapter **cannot** distinguish a wrong credential from
an unknown device from a policy denial from an expired certificate. This is the
fail-closed case the fabric already reasons about correctly elsewhere: an
unexplained rejection must raise assurance rather than be reported as a specific
cause. Worth stating explicitly here because a NAC console *will* show a reason
— sourced from its own logs, not from this packet.

## Finding 3 — identity on the wire is a MAC, and the SSID is glued to the AP

`Calling-Station-Id = "AA-BB-CC-DD-EE-01"` is the device identity. Our
`deviceId` is an opaque id, so an adapter carries a MAC-to-device mapping it
must get from somewhere else.

`Called-Station-Id = "00-11-22-33-44-55:CorpWiFi"` is **AP MAC + `:` + SSID in
one string**. Our shape has separate `accessPoint` and `ssid` fields, so an
adapter must split on `:` — there is no separate SSID attribute in the protocol.
(Wired NAS devices often omit the SSID half entirely, so the split must tolerate
its absence rather than assume two parts.)

## Finding 4 — `lastAuthAt` is not an authentication fact

Nothing in an `Access-Accept` says when the device previously authenticated.
RADIUS authentication is stateless request/response. A "last authenticated at"
comes from **RADIUS accounting** (`Accounting-Start` / interim / `Stop`, port
1813) or from the NAC console's own session database — a different data source
with a different lifetime. Modelling it beside the auth fields, as
`NetworkPostureRaw` does, is convenient but it hides that these two fields do
not arrive together and can disagree.

## Finding 5 — the VLAN is a string

`Tunnel-Private-Group-Id = "corp-100"`. Our `vlan?: string | number` correctly
allows both, and the **string form is the one to design against**: named VLANs
are ordinary, and an adapter that coerces to a number would drop the name.

## Field-by-field: `NetworkPostureRaw` vs the wire

| Our field | On the wire | Verdict |
| --- | --- | --- |
| `deviceId` | `Calling-Station-Id` (a MAC) | ✅ present, but needs an external MAC→device mapping |
| `authState` | Accept / Reject only | ⚠️ `quarantined` is DERIVED, never reported |
| `segment` | `Filter-Id`, or the VLAN name | ✅ present as a customer-chosen string |
| `vlan` | `Tunnel-Private-Group-Id` | ✅ present, string-first |
| `switchPort` | `NAS-Port-Id` | ✅ present |
| `accessPoint` | first half of `Called-Station-Id` | ⚠️ must be split out |
| `ssid` | second half of `Called-Station-Id` | ⚠️ must be split out; absent on wired |
| `nacCompliant` | **nothing** | ⚠️ not a RADIUS concept — a posture-token/console derivation |
| `lastAuthAt` | **nothing** (accounting, or console DB) | ⚠️ different source, different lifetime |

**Net verdict: the shape is usable and honest in intent, with two things worth
recording.** Four fields are direct wire facts. Three require derivation or
splitting that an adapter must own explicitly. And two — `nacCompliant` and
`lastAuthAt` — are **not authentication facts at all**; they come from other
planes (a posture agent/console, and accounting) and should not be assumed to
arrive with an auth result.

## What was NOT verified

- **RADIUS accounting** (port 1813) — the actual source of session timing — was
  not driven.
- **EAP / 802.1X methods** (PEAP, EAP-TLS): only PAP was exercised. Certificate
  facts an EAP-TLS exchange would expose are untouched here.
- **CoA / Disconnect** (RFC 5176) — the mechanism a NAC uses to re-quarantine a
  live session — was not exercised.
- **Cisco ISE and Aruba ClearPass consoles specifically.** This verifies the
  protocol they speak, not their REST APIs, which are where `nac/cisco-ise.ts`
  and `nac/aruba-clearpass.ts` sit. Those remain unverified against a live
  instance.
- The five other network dimensions — `link-usability`, `sse-egress`,
  `carrier`, and the `nac` console adapters — remain **live-unverified**. This
  shift closes one of six.

## Reproduction

Run `freeradius/freeradius-server:latest` with a `clients.conf` NAS entry and
two users in `mods-config/files/authorize` carrying `Tunnel-Type`,
`Tunnel-Medium-Type`, `Tunnel-Private-Group-Id` and `Filter-Id`; strip the
IPv6 listen blocks if IPv6 is unavailable; then drive `radclient -x` with
`Calling-Station-Id` / `Called-Station-Id` / `NAS-Port-Id` and read the reply
attributes.

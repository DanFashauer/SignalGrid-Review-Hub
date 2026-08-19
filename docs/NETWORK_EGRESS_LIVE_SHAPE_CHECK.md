# Link-usability and SSE-egress — live checks against a real intercepting proxy

**Status: COMPLETED live, 2026-08-19 (cloud lane).** The `network-domain`
role's second shift, following `docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md`. Two more
of its six dimensions checked against real network behaviour rather than
fixtures — and this environment turned out to be an unusually good lab for it,
because all traffic here egresses through a **real TLS-intercepting forward
proxy**, which is exactly the deployment shape `sse-egress` models.

**No code changed, no connector built, the breadth freeze untouched.**

## The headline: an egress proxy COLLAPSES a rung of the link ladder

`LinkProgress` is a ladder — `not_associated` → `associated_only` →
`dhcp_failing` → `dns_failing` → `local_only` → `carrying_traffic`. Its premise
is that a device can tell these apart. Each failure mode was driven in
isolation, and the transport-level signatures are indeed distinct:

| Rung exercised | Observed signature (curl exit) |
| --- | --- |
| DNS resolution fails (**direct**) | `6` — could not resolve host |
| TCP refused (routable IP, closed port) | `7` — connection refused |
| TCP ok, TLS fails (wrong protocol on port) | `35` — TLS handshake failure |
| TLS ok, application 404 | `0` — transport succeeded; HTTP status is a separate axis |
| Full path | `0` |

So far the ladder holds. Then the same DNS failure was driven **through the
proxy**:

```
through the egress proxy : exit 56   (connection reset)
bypassing the proxy      : exit 6    (could not resolve host)
local resolver, same name: NXDOMAIN  (the resolver works, and says so)
```

**The same failure produces a different observable depending on whether the
device is behind a forward proxy** — because a proxied client *does not resolve
names at all*. The proxy resolves. The client sends `CONNECT host:443` and
receives, at most, a proxy error.

The consequence for this dimension is precise: **`dns_failing` is not
observable from a device inside an SSE/SWG deployment.** From the client's
side, "the name does not exist", "the proxy refused the destination by policy",
and "the upstream is unreachable" arrive as the same reset. And an SSE
deployment is exactly the enterprise posture SignalGrid targets — so the rung
most likely to be unavailable is unavailable precisely where the product is
meant to run.

This is not a defect in the type; the ladder is right about direct-attached
devices. It is a **statement about who can report which rung**, and it belongs
next to the type so no future adapter reports `dns_failing` from a proxied
agent and believes it.

## The second finding: `service_observing_traffic` is a self-report, and it does not have to be

`SseEgressReportRaw` carries `client_state` (`tunneled` | `bypassed` |
`disabled` | `not_installed` | `unknown`), `service_observing_traffic` and
`bridge_reachable`. All three are **reported by the SSE client or its console**
— that is, the thing being asked about answers for itself.

But interception is **independently observable from the device**, and this lab
proves it. A request for `github.com` through the intercepting gateway returns:

```
subject = CN = github.com
issuer  = O = Anthropic, CN = Egress Gateway SDS Issuing CA (production)
```

The **subject looks correct** — it names the host that was asked for. Only the
**issuer** betrays the interception: the certificate was minted by the egress
gateway's CA, not by GitHub's real issuer. A device that pins or simply
inspects the issuer for a known external host can therefore corroborate, from
first principles, whether its traffic is being intercepted — without asking the
agent that would be lying if it were misconfigured.

That matters here because this repository already holds the doctrine: a
self-reported affirmative is weaker evidence than an independently corroborated
one. It is the same reasoning that made the Keycloak DPoP cross-implementation
check valuable, and the same caution recorded for Headwind's `kioskMode`
(launcher-reported, not server-verified). `service_observing_traffic` is in
that class today, and the upgrade path is now known and cheap to state:

- **Corroborated tunneling** — issuer for a known external host is the
  gateway's CA ⇒ traffic *is* being observed. Strictly stronger than
  `client_state: "tunneled"`.
- **Corroborated bypass** — issuer is the destination's genuine CA ⇒ that
  destination is **not** being intercepted, which is how a split-tunnel leak
  becomes visible rather than merely denied.

**Disposition: recorded, not built.** Adding a device-side probe touches the
launch surface and the evidence contract, so it is a design note for the owner
board's next review, not a quiet addition — and the freeze stands regardless.

## Field-by-field

| Field | What a device can actually establish | Verdict |
| --- | --- | --- |
| `associationState` | Wi-Fi association — **not exercised** (no wireless client here) | ⬜ unverified |
| `linkProgress` — transport rungs | Each failure mode has a distinct signature, verified | ✅ |
| `linkProgress: "dns_failing"` | **Unobservable behind a forward proxy** | ⚠️ deployment-dependent |
| `roamCapability` / `roamHealth` | Roaming — **not exercised** | ⬜ unverified |
| `linkLatencyClass` | Measurable, but not driven in this shift | ⬜ unverified |
| `client_state` | Self-reported by the SSE client | ⚠️ corroboratable, currently trusted |
| `service_observing_traffic` | **Independently verifiable via TLS issuer** | ⚠️ upgrade available |
| `bridge_reachable` | Self-reported | ⚠️ corroboratable |

## What was NOT verified, stated plainly

Three of the department's six dimensions remain **live-unverified**, and none
of them can be honestly closed from this environment:

- **`carrier`** — cellular / eSIM reachability. There is no free carrier API to
  drive, and `AGENTS.md` forbids live vendor calls in-tree regardless. This one
  stays unverified-live until an owner-supplied sandbox exists. Note the
  dimension already carries the strongest reasoning in the estate about its own
  limits (a carrier API cannot prove the absence of a radio, intake row 55).
- **`nac/cisco-ise.ts`** and **`nac/aruba-clearpass.ts`** — both target
  licensed commercial appliances that cannot be stood up here. The RADIUS shift
  verified the *protocol* those products speak; it did **not** verify their
  REST APIs, which is where these two adapters actually sit. Verifying them
  against published vendor documentation is possible and would be a weaker
  claim than a live check — it should be labelled as such if it is ever done.
- **Wi-Fi association and roaming** within `link-usability`, per the table
  above.

**Department scorecard after two shifts: 3 of 6 dimensions have had live
contact** (`network-nac` via RADIUS, `link-usability` at the transport rungs,
`sse-egress` via a real intercepting gateway); three have not, and this section
exists so that stays visible rather than rounding up to "the network department
has been verified".

## Reproduction

Drive each transport rung with `curl --max-time` against a name that does not
resolve, a closed port, a non-TLS port, a 404 path and a working URL, reading
exit codes; repeat the DNS case with and without `--noproxy '*'` to see the
rung collapse. For the interception check, `openssl s_client -connect
host:443 -servername host` and compare the certificate's **issuer** against the
host's real CA — the subject will look correct either way.

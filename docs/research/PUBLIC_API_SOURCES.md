# Public API sources — what the `public-apis` directory can and cannot feed SignalGrid

> **What this is:** an evidence/research catalogue, compiled 2026-09-02 from the owner's
> intake of [public-apis/public-apis](https://github.com/public-apis/public-apis) (owner's
> words, verbatim: *"Here are additional resources and layers that's can be added or provide
> more information and detailed answers about my product as well."*). It maps the directory's
> categories onto the connector families that exist in this tree and ranks the candidates by
> fit. It sits beside Firecrawl (`docs/DECISION_RECORDS.md` DR-022) as research/evidence
> tooling — **not** a review layer, **not** a memory layer, and **nothing here enters a decision
> path** (DR-027). Every row was read from the clone at the pinned commit; every probe below
> was a read-only GET with a synthetic input. Where something could not be established from the
> directory or a probe it says *not established*.
>
> **Prior disposition, superseded.** `docs/INTAKE_LEDGER.md` row 97 (2026-08) rated
> `public-apis` "wrong category of API entirely" without cloning it. That reading stands for
> the product's *systems of record* (Fleet, Intune, Jamf, Entra) — none of them is a public
> API — and is superseded, by the owner's direction, for a narrower question: which of the
> directory's no-key rows can **enrich** a fixture or answer a **buyer** question without a
> vendor contract. This brief answers that question and nothing wider.

## The resource, established from the clone

| Fact | Value (from the clone) |
| --- | --- |
| Repository | `public-apis/public-apis`, cloned `--depth 1` on 2026-09-02 |
| Pinned commit | `38527bc133d839cee090fa5c44f814ed1dca3d66` (merge of PR #7189, 2026-09-02) |
| Licence | MIT ("Copyright (c) 2022 public-apis") |
| Size | one README.md of 2215 lines / 241 KB; a Python validator directory in the clone (scripts/validate, format + links, with tests); a CONTRIBUTING.md; 804 KB on disk with `.git` |
| Categories | 52 `###` headings, of which 51 are API categories and one is a sponsor block ("APIs Covered Under APILayer Suite!") |
| Rows | 1721 table rows below the Index. Auth column: `No` 809, `apiKey` 755, `OAuth` 150, `X-Mashape-Key` 6, `User-Agent` 1. HTTPS column: `Yes` 1629, `No` 92 |
| Columns | `API \| Description \| Auth \| HTTPS \| CORS` — the clone's CONTRIBUTING.md defines `Auth` as "Does this API require authentication?" with the only accepted values `No` / `apiKey` / `OAuth` / `X-Mashape-Key`, and notes "Without proper CORS configuration an API will only be usable server side." |
| What it is | a community-curated **directory of links**. It carries no endpoint definitions, no rate limits, no terms-of-service text and no freshness guarantee. The `Auth` column is a contributor's claim at the time of the row's PR (see probe 8, which refutes one) |
| What it is not | not an API itself, not a data feed, not a source of truth for any claim about a vendor. The README's top and "Best sellers" block are sponsor placement (APILayer) — commercial, key-gated products, disregarded here |

## The fixture-first rule (the one rule this brief adds)

A public API enters this tree in exactly one shape, and it is the shape every connector family
already has:

1. **The decision core never calls it.** `lib/*` decision paths are deterministic and offline
   (golden rule 2). A public API's output can become a **committed fixture** — a CVE record, a
   holiday table, a geofence centre — minted by a human-run script, reviewed, and checked in (a deferred family, not shipping)
   with the source URL, the commit sha of this brief, and the retrieval date in the file.
2. **Live only behind the three gates.** A live read, if ever built, sits in a connector family
   under `lib/integrations/src/integrations/` behind tier (`beta`/`prod`) **and**
   `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** a credential (`docs/SECURITY_REVIEW_PACKAGE.md`,
   "The fixture/live boundary"), through an injected transport, and it is scanned by
   `scripts/check-ungated-fetch.mjs`. A no-key API still gets a *configured* credential-shaped
   opt-in, because "no key needed" is not "no opt-in needed".
3. **Synthetic or non-identifying inputs only.** No PHI, no PII, no tenant identifier, no
   worker location, no device IP, no password material, no MAC of a real peripheral leaves
   this tree toward a public endpoint. The inputs a public API may ever see are: a CVE id, a
   country code and year, an address of a *facility* entered by an administrator at design
   time, a public well-known IP in a test. That list is closed until a decision record widens it.
4. **Outage is unknown, and unknown raises.** A public endpoint disappears, rate-limits, or
   changes its auth without notice (probe 8). A connector that reads one treats every non-200,
   malformed body, or stale retrieval as `unknown`, which raises assurance and never lowers it —
   the same rule `lib/integrations/src/utils/freshness.ts` states for timestamps.
5. **Not a source of truth.** A directory row is a pointer. A claim in this repository about a
   vendor's API cites the vendor's own document, never this directory.

## Ranked registry — directory rows against the families in `docs/INTEGRATION_CATALOG.md`

Ranking is by fit to an existing family, weighted toward rows that (a) need no key,
(b) serve HTTPS, (c) return a record a fixture can hold unchanged, and (d) answered a probe.
"Row" quotes the directory at the pinned sha; "Probe" cites the numbered probe below.
Rate-limit and terms cells say *not established* unless the directory or the probe body itself
carried the fact.

| # | SignalGrid family (root path) | Directory row (category → name, Auth / HTTPS / CORS as the row reads) | Endpoint used or documented | Probe | Terms / rate limit | Fit | What it answers for a buyer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `vuln-scan` — `lib/integrations/src/integrations/vuln-scan/types.ts` carries `cveId`, `cvssScore`, `exploitAvailable` ("CISA KEV-style") | Security → **National Vulnerability Database** — `No` / Yes / Unknown (row links the JSON-feed changelog page) | `services.nvd.nist.gov/rest/json/cves/2.0?cveId=` | 1: **200**, full CVE record, `vulnStatus: Analyzed`, `lastModified` present | US-government data; rate limit *not established* by the directory (NIST publishes one on its API page — verify before any script) | **High.** A CVE id a scanner names becomes a committed fixture carrying CVSS and status; the family's evaluate path does not change | "Can SignalGrid grade a CVE the scanner reports without a Tenable/Qualys contract?" — it can *enrich* a fixture from NVD; the *finding* still comes from the scanner (`VULN_SCAN_ACCESS_TOKEN` family) |
| 2 | `vuln-scan` / `device-management-health` / `app-update` (Windows patch context) | Security → **Microsoft Security Response Center (MSRC)** — `No` / Yes / Unknown | `api.msrc.microsoft.com/cvrf/v3.0/updates` (OData) | 10: **200**, update list with `CvrfUrl` per month | Microsoft terms; rate limit *not established* | **Medium-high.** Monthly CVRF documents are a stable, keyless source for "which KBs closed which CVEs" fixtures | "Does the device's patch level cover the CVE?" — as fixture enrichment for a Windows fleet; the *installed* level still comes from Intune/UEM |
| 3 | `change-window` / `shift-context` — `lib/integrations/src/integrations/change-window/types.ts`, `.../shift-context/types.ts` grade a reference instant against a record; neither knows what a public holiday is | Calendar → **Nager.Date** — `No` / Yes / **No CORS** ("Public holidays for more than 90 countries") | `date.nager.at/api/v3/PublicHolidays/{year}/{country}` | 7: **200**, array of `{date, localName, name, countryCode, global, types}` | Open project; terms and limit *not established* by the directory | **High** as a *fixture*: one file per country-year, refreshed by a human-run script. Never live: a decision that consults a calendar at decision time is no longer deterministic | "Does the maintenance window / this punch fall on a public holiday at the site's country?" — yes, from a committed table; the holiday table is *context*, the change record and the punch remain the graded facts |
| 4 | same as 3 (UK sites) | Calendar → **UK Bank Holidays** — `No` / Yes / Unknown (`gov.uk/bank-holidays.json`) | the row's URL is the endpoint | not probed | Government data; Open Government Licence *not established from the row* | **Medium** — a government-published JSON is the better fixture source than a community mirror for UK sites | same as 3, with a primary source |
| 5 | `network-nac` — `lib/integrations/src/integrations/network-nac/types.ts` grades auth state / VLAN / freshness; `nac` resolves identity only | Geocoding → **ipapi.co** — `No` / Yes / Yes | `ipapi.co/{ip}/json/` | 3: **200**, `network`, `country`, `city`, `latitude` | free tier limit *not established* by the directory | **Low-medium.** ASN/country of an *egress* is a hint about the network a device sits on; the family's graded facts (auth state, VLAN, RADIUS freshness) come from the NAC. A device or gateway IP is a tenant identifier and never leaves the tree → fixture-only with synthetic IPs | "Can it tell a hosting/VPN egress from the corporate one without a threat-intel contract?" — coarsely, as fixture-backed context; not as a decision input |
| 6 | `network-nac` (as 5) | Geocoding → **ipwhois** — `No` / Yes / Yes | `ipwho.is/{ip}` | 4: **200**, `country`, `region`, `city`, `latitude`, `postal` | *not established* | **Low-medium** — see 5. Disagrees with probe 3 on the city for the same address | as 5 |
| 7 | `network-nac` (as 5) | Geocoding → **GeoJS** — `No` / Yes / Yes | `get.geojs.io/v1/ip/geo/{ip}.json` | 5: **200**, `asn: 13335`, `organization`, `latitude: "nil"` | *not established* | **Low-medium** — the one probed source that returned ASN only and declined to invent a city; the most honest of the four for this purpose | as 5 |
| 8 | `network-nac` (as 5) | Geocoding → **ip-api** — `No` / **HTTPS: No** / Unknown | `http://ip-api.com/json/{ip}?fields=…` | 2: **200**, `as`, `isp`, `proxy: false`, `hosting: true` | **Plaintext on the free tier per the directory row**; the vendor's page states non-commercial use for the free tier (*vendor statement, not verified here*) | **Low.** Returns the most useful fields (`proxy`, `hosting`) but over HTTP — disqualifying for anything but a synthetic test | as 5; the `hosting` flag is the buyer-relevant field, and it is the one source that cannot be used over TLS without a key |
| 9 | `location-services` — `lib/integrations/src/integrations/location-services/types.ts` prefers geofence membership and flags precise coordinates as privacy-sensitive | Geocoding → **Nominatim** — `No` / Yes / Yes | `nominatim.openstreetmap.org/reverse?lat=&lon=&format=jsonv2` (and `/search` forward) | 6: **200**, body carries `"licence":"Data © OpenStreetMap contributors, ODbL 1.0"` | **ODbL** attribution in every response; the OSM Nominatim usage policy requires an identifying `User-Agent`, forbids bulk/heavy use and states a low request rate (*vendor policy, read from the vendor's page; the directory carries none of it*) | **Medium** for a **design-time** step only: an administrator's facility address → a geofence centre in a committed fixture. **Never** a device's coordinates (that would send worker location to a public service) and never per decision | "Can a facility be geofenced without a mapping contract?" — a centre point can be minted once from OSM data under ODbL; the *membership* verdict stays platform-computed (MDM/OS), as the family already requires (a deferred family, not shipping) |
| 10 | `location-services` (as 9) | Geocoding → **LatLng**, **Geocode.xyz**, **Geokeo** (all `No` / Yes) | as the rows link | not probed | *not established* | **Low** — alternatives to 9 with less clear licensing | as 9 |
| 11 | `edr-threat` / SIEM context | Anti-Malware → **URLhaus** — `No` / Yes / Yes; Security → **URLhaus** — `` `No` `` / Yes / Unknown | `urlhaus-api.abuse.ch/v1/urls/recent/limit/2/` | 8: **401 Unauthorized** | the endpoint now requires an abuse.ch Auth-Key (the probe establishes this; the directory says `No`) | **None as listed** — a **directory-drift finding**, recorded because it is the concrete reason rule 4 exists | "Is the directory's auth column reliable?" — no; verify by probe before any script depends on a row |
| 12 | (no family consumes a user-agent string; the two `User-Agent` hits under `lib/integrations/src/integrations/` are *outbound* headers on the ITSM and SIEM webhook adapters) | Development → **ApicAgent** — `No` / Yes / Yes ("Extract device details from user-agent string") | the row links a landing page | 9: **200 text/html** — the page, not an API | *not established* | **None.** Device/browser posture in this product comes from UEM/attestation (`device-attestation`, `uem`), and a UA parse belongs in-process, not over a network hop | "Can it read device posture from a browser string?" — it should not; a UA string is claimable by anyone and the tree grades attested posture instead |
| 13 | `peripheral-control` — `lib/integrations/src/integrations/peripheral-control/types.ts` (vendor-neutral class/access records) | Development → **MAC address vendor lookup** (macaddress.io) — **`apiKey`** / Yes / Yes | key-gated | not probed | *not established* | **Low.** `macvendors.com` (named in the intake) is **not in the directory at this sha**. The IEEE OUI registry is a downloadable file and the correct fixture source for vendor-of-MAC, outside this resource | "Can it name the vendor of a plugged-in peripheral without a device-control contract?" — from a committed OUI table, yes; a real peripheral's MAC still never leaves the tree |
| 14 | `credential-exposure` — `lib/integrations/src/integrations/credential-exposure/types.ts` is about *secrets on endpoints* (GitGuardian-shape), not password breaches | Security → **HaveIBeenPwned** — **`apiKey`** / Yes / Unknown (row links the v3 API) | key-gated per the row; the k-anonymity *range* endpoint's no-key status is a **vendor statement, not verified here** and not probed (the row marks the API `apiKey`) | not probed | HIBP's current terms *not established* here | **Low for this product.** Password-breach checking is a host-app / IdP concern (golden rule 3: domain safety belongs to the host); a worker's password hash prefix leaving a device is a decision the host owns, not the Assist gate | "Does SignalGrid check breached passwords?" — no, and it should not; the IdP's risk signal (`identity-risk`) already carries the vendor's answer |
| 15 | `edr-threat` / `network-nac` (IP reputation) | Anti-Malware → **AbuseIPDB**, **AlienVault OTX**, **Google Safe Browsing**, **VirusTotal**; Security → **GreyNoise**, **Shodan**, **Censys**, **Pulsedive** — all **`apiKey`** | key-gated | not probed (rule: no key-gated endpoint) | vendor terms | **Out of the "no contract" question by construction.** If ever adopted, each is a credential-gated family like `EDR_ACCESS_TOKEN`, and a proof lands with it | "Can it enrich an IP with reputation without a contract?" — not from these rows; every reputation source in the directory is key-gated |
| 16 | `observability-integrity` / `service-lifecycle` (weak) | Development → **DownStatus** — `No` / Yes / Yes ("Real-time status for GitHub, AWS, Discord and 90+ services") | as the row links | not probed | *not established* | **Low** — third-party status pages are hearsay about an upstream; the families grade the connector's own read, not a status aggregator | "Does it know when its upstream is down?" — it knows when *its own read* fails, which is the fail-closed answer already |

**Named in the intake but not in the directory at this sha** (checked by `grep` over the clone;
recorded so nobody cites the directory for them): OSV, CIRCL CVE, CISA KEV, FIRST EPSS,
WorldTimeAPI / time-zone services, macvendors.com. Each may well exist; this resource does not (a deferred family, not shipping)
establish it, and this brief does not claim it.

## What each top candidate must never do here

- **NVD / MSRC (rows 1–2):** never queried per decision; never with a tenant's asset name or
  hostname (a CVE id is the only input); the *finding* (which device carries the CVE) is the
  scanner's, and a fixture enriched from NVD is stamped with retrieval date and sha.
- **Nager.Date / gov.uk (rows 3–4):** never live at decision time; the holiday table is a
  committed fixture per country-year; a missing table for a site's country is `unknown` and
  raises, never "no holiday".
- **IP → ASN/geo (rows 5–8):** never given a device, gateway or tenant IP; synthetic addresses in
  tests only; never treated as a location signal — the four probed sources disagreed on the city
  for one anycast address (Sydney / Brisbane / nil), which is the caveat in one line.
- **Nominatim (row 9):** never given a device's coordinates; used once, by an administrator, for a
  facility address, with an identifying `User-Agent`, attribution kept in the fixture (ODbL), and
  the result reviewed by a human before it becomes a geofence. (a deferred family, not shipping)
- **Every row:** outage, 4xx/5xx, malformed body, or a stale fixture resolves to `unknown` →
  raise. No retries that could look like bulk use. Nothing is written back anywhere.

## The probes (evaluate by use, 2026-09-02)

Ten read-only GETs through the configured proxy, synthetic inputs only, bodies trimmed to 420
bytes; the full log is in the intake evidence (`docs/agent/RESOURCE_INTAKE.md`, row 2026-09-02).

| # | Endpoint (input) | Result |
| --- | --- | --- |
| 1 | NVD CVE 2.0 (`CVE-2021-44228`) | 200; `"vulnStatus":"Analyzed"`, `"lastModified":"2026-08-11…"`, full description |
| 2 | ip-api over **http** (`1.1.1.1`) | 200; `"as":"AS13335 Cloudflare, Inc.","proxy":false,"hosting":true` |
| 3 | ipapi.co (`1.1.1.1`) | 200; `"city":"Sydney"`, `"network":"1.1.1.0/24"` |
| 4 | ipwho.is (`1.1.1.1`) | 200; `"city":"Brisbane"` |
| 5 | GeoJS (`1.1.1.1`) | 200; `"asn":13335,"latitude":"nil"` |
| 6 | Nominatim reverse (a public landmark coordinate) | 200; `"licence":"Data © OpenStreetMap contributors, ODbL 1.0"`, `"name":"Pennsylvania Avenue Northwest"` |
| 7 | Nager.Date (`2026`, `US`) | 200; `[{"date":"2026-01-01","name":"New Year's Day",…"types":["Public","Bank"]},…]` |
| 8 | URLhaus recent (no input) | **401** `{"error": "Unauthorized"}` — directory says `No` auth |
| 9 | ApicAgent (a generic iPhone UA string) | 200 **text/html** — a landing page, not an API |
| 10 | MSRC CVRF updates (no input) | 200; OData list of monthly CVRF documents with `CvrfUrl` |

Not probed on purpose: every `apiKey`/`OAuth` row, HaveIBeenPwned (row marks `apiKey`), and the
sources the directory does not list.

## What this resource does not give

- **No access to any vendor's MDM / EDR / IdP plane.** The systems of record in
  `docs/INTEGRATION_CATALOG.md` (Entra, Intune, Jamf, Fleet, ISE, CrowdStrike, ServiceNow…)
  are not public APIs, and nothing in the directory substitutes for their credentials or their
  connector families.
- **Nothing enters a decision path.** No row becomes a `lib/*` import, a live call in the core,
  or a proof's source of truth. A fixture minted from a row is evidence with a date on it.
- **Not a source of truth for claims.** The `Auth` column was wrong for at least one row at
  this sha (probe 8); a row's link may be a landing page (probe 9). A claim about a vendor's API
  cites the vendor.
- **No terms, no limits, no freshness.** The directory carries none of the three; each must be
  read from the vendor before any script depends on a row, and re-read when the fixture is
  refreshed.
- **No new family, no new proof, no dependency.** This brief changes documentation only.

## Where it sits in the stack

An evidence/research catalogue beside Firecrawl (DR-022) under the DR-024 operating model:
Firecrawl fetches what a human would read; this catalogue names which public endpoints a
fixture may be minted from and under what rule. Neither is a review lens (Ponytail, ECC) and
neither is the memory substrate (DR-026). The owner-supplied vendor catalogues under
`docs/inspiration/` (`docs/inspiration/TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md`,
`docs/inspiration/ENDPOINT_MANAGEMENT_API_CATALOG.md`) remain the map of *vendor* APIs; this
brief is the map of *public, keyless* ones, and it is much shorter because the product's
signals mostly are not public.

## Sources

- The clone at `38527bc133d839cee090fa5c44f814ed1dca3d66`: its README.md (rows quoted above by
  category), its CONTRIBUTING.md (column definitions), its LICENSE (MIT).
- `docs/INTAKE_LEDGER.md` row 97 — the prior disposition, annotated 2026-09-02.
- `docs/DECISION_RECORDS.md` DR-022 (Firecrawl, the shape of "adopted as research only"), DR-024
  (the stack), DR-026 (Neural Memory), DR-027 (this intake).
- `docs/SECURITY_REVIEW_PACKAGE.md` "The fixture/live boundary"; `scripts/check-ungated-fetch.mjs`;
  `lib/integrations/src/utils/freshness.ts`.
- Probe transcript, 2026-09-02, ten GETs, quoted above.

# Physical Access Control API & GitHub Catalog (owner-supplied, verified 2026-07-31)

> **Provenance.** Compiled and supplied by the owner as intake ledger row 26, from an
> Excel workbook ("Physical_Access_Control_API_Catalog_20260731.xlsx", five sheets:
> Summary, Vendor APIs, GitHub & OSS, Standards, SignalGrid Priorities) with markdown
> and JSON exports. Filed verbatim (markdown export) as the durable adapter-roadmap
> source. **This is reference material, not a claim**: no dependency is taken on any
> listed vendor, no partnership or certification is implied, and every listed URL and
> access classification is the owner's verification snapshot as of 2026-07-31 —
> vendors change their programs; re-verify before building against any entry. All
> future adapters remain behind connector discipline (tier + flag + credential + an
> injected transport this repository does not ship), read-only, with the PACS as the
> authoritative system of record.
>
> The owner's stated scope honesty is preserved: a literally exhaustive public list
> is not possible, because many enterprise PACS vendors provide detailed contracts
> only through customer portals, paid SDK licenses, technology-partner programs,
> certification, or NDA (e.g. Kisi's controlled SDK access, ProdataKey's partner API
> program, ASSA ABLOY Aperio's NDA-based integration path, DoorBird's
> selected-partner Cloud API).

Catalog totals: 61 vendor/API entries · 24 GitHub/open-source resources · 10
standards · 13 SignalGrid P1 vendor targets. Access classification per entry:
public docs / public docs with gated credentials / advertised API with gated
reference / partner-NDA-licensed / no detailed public contract located.

## Vendor APIs and SDKs

|Company|Product/API|Segment|Access Class|Interface|Docs URL|GitHub / OpenAPI|SignalGrid Priority|Notes / Caveats|
|---|---|---|---|---|---|---|---|---|
|Seam|Access Control Systems API|Unified access API / aggregator|Public docs|REST JSON; webhooks; SDKs|https://docs.seam.co/latest/capability-guides/access-systems|https://github.com/seamapi|P1|Best abstraction layer for rapidly prototyping multiple access-control vendors; confirm per-vendor feature coverage.|
|Brivo|Brivo Onair / Open API|Cloud PACS|Public docs + gated credentials|REST JSON; OAuth 2.0|https://apidocs.brivo.com/||P1|Mature cloud PACS; API application and tenant permissions must be approved.|
|Kisi|Kisi API, webhooks, Mobile SDK|Cloud PACS / mobile access|Public docs + gated credentials|REST JSON; webhooks; iOS/Android SDK|https://api.kisi.io/docs|https://github.com/kisi-inc|P1|Public API and webhooks are accessible; direct mobile SDK access may require approval and NDA.|
|Avigilon|Alta Access (formerly Openpath) API & webhooks|Cloud PACS|Open API advertised / docs gated|REST JSON; webhooks; marketplace integrations|https://www.avigilon.com/access-control/cloud||P1|Official product pages advertise open API and 100+ integrations; detailed developer reference generally requires account access.|
|Verkada|Access Control API|Cloud PACS|Public docs + gated credentials|REST JSON; webhooks|https://apidocs.verkada.com/reference/getting-started|https://www.postman.com/verkada|P1|Strong event and door-management surface; verify license and API entitlements for the target tenant.|
|Rhombus|Rhombus API v2 / Access Control|Cloud PACS + video|Public docs|REST JSON; webhooks; OpenAPI|https://docs.rhombus.com/reference/introduction|https://api2.rhombussystems.com/api/openapi/public.json|P1|Useful unified video/access event source with a machine-readable OpenAPI contract.|
|ProdataKey|PDK REST API, Streaming API, Mobile SDK|Cloud PACS|Public docs + gated credentials|REST JSON; streaming/WebSocket; mobile SDK|https://developer.prodatakey.com/||P1|Open API is advertised, but practical access is tied to the PDK partner/customer program.|
|Genea|Genea Access Control API / integrations|Cloud PACS|No public detailed reference|REST / webhooks / SCIM integrations|https://www.getgenea.com/access-control/integrations/||P2|Confirm current developer documentation and API terms directly with Genea.|
|Swiftlane|Swiftlane integration surface|Cloud PACS / intercom|No public detailed reference|Cloud integrations; identity provisioning|https://swiftlane.com/||P3|Treat as discovery candidate until a current API/SDK contract is provided.|
|ButterflyMX|Developer API / Grant Access|Proptech access / intercom|Public docs|REST JSON; OAuth 2.0; webhooks|https://developer.butterflymx.com/||P2|Well-suited to visitor/property access workflows rather than enterprise PACS depth.|
|Latch / DOOR|Property-management and access integrations|Smart access / multifamily|No public detailed reference|Cloud API integrations|https://www.door.com/||P3|Confirm current branding, product scope and developer access directly.|
|RemoteLock|RemoteLock API|Cloud smart-lock management|Public docs|REST JSON; OAuth 2.0|https://developer.remotelock.com/api/docs||P2|Aggregator for smart locks; validate target lock/vendor capability and event latency.|
|SALTO Systems|SALTO KS Connect API / Core API|Cloud access / wireless locks|Public docs + gated credentials|REST JSON; webhooks/integration services|https://developer.saltoks.com/||P1|Distinguish SALTO KS cloud APIs from SPACE/SHIP enterprise integration interfaces.|
|Akiles|Akiles API|Cloud access / smart locks|Public docs|REST JSON; OAuth 2.0; OpenAPI|https://developers.akiles.app/|https://github.com/akiles/openapi-specs|P2|Strong modern API posture and public machine-readable contract.|
|Tapkey|Tapkey Mobile Access SDK & Web API|Mobile credentials / smart locks|Public docs|REST/API; Android/iOS SDK|https://developers.tapkey.io/|https://github.com/tapkey|P2|Best viewed as a mobile-credential/lock platform rather than a complete enterprise PACS.|
|Spintly|Spintly API and SDK|Cloud / wireless PACS|Partner / NDA / licensed|REST API; SDKs; webhooks|https://spintly.com/developers/||P2|Confirm detailed API documentation and sandbox access with vendor.|
|acre security|Keep by Feenics API|Cloud PACS|Public docs|REST JSON|https://apidocs.feenics.com/||P2|Feenics/Keep naming may vary following acre portfolio changes; confirm current tenancy model.|
|Avigilon|Unity Access / Access Control Manager REST API|On-prem enterprise PACS|Open API advertised / docs gated|REST JSON; on-prem integration|https://www.avigilon.com/access-control/on-premise||P2|Separate from Alta cloud APIs; confirm product/version-specific API availability.|
|Gallagher Security|Command Centre REST API|On-prem enterprise PACS|Partner / NDA / licensed|REST JSON; events; command/control|https://gallaghersecurity.github.io/cc-rest-docs/|https://github.com/GallagherSecurity/cc-rest-docs|P1|One of the best publicly documented enterprise PACS REST APIs; deployed system/license still required.|
|Genetec|Security Center SDK / Web SDK|Unified physical security / PACS|Partner / NDA / licensed|.NET SDK; Web SDK; REST/streaming through supported services|https://developer.genetec.com/|https://github.com/Genetec/Security-Center-SDK-Samples|P1|Powerful but partner-program oriented; version compatibility and SDK licensing matter.|
|LenelS2|OnGuard OpenAccess / OAAP / OpenDevice|On-prem enterprise PACS|Partner / NDA / licensed|REST; SignalR/events; SDK and hardware interfaces|https://www.lenels2.com/en/us/solutions/open-integration/||P3|Detailed OpenAccess documentation is generally customer/partner gated.|
|Johnson Controls|C•CURE 9000 SDK / integration APIs|On-prem enterprise PACS|Partner / NDA / licensed|SDK; web services/integration interfaces|https://www.johnsoncontrols.com/security/physical-security/access-control/ccure-9000||P3|No comprehensive public endpoint reference located; use partner channels.|
|Honeywell|Pro-Watch HSDK / Web API|On-prem enterprise PACS|Partner / NDA / licensed|SDK; Web API|https://buildings.honeywell.com/us/en/products/by-category/software/security-software/pro-watch-integrated-security-suite||P3|HSDK and Web API access typically depend on product version and partner status.|
|Siemens|SiPass integrated / plugin integration|On-prem enterprise PACS|No public detailed reference|SDK/plugins; integration interfaces|https://www.siemens.com/global/en/products/buildings/security/access-control/sipass-integrated.html||P3|Confirm API/SDK availability and version compatibility with Siemens.|
|Bosch|Access Management System API / SDK|On-prem enterprise PACS|Partner / NDA / licensed|REST/API and SDK integration|https://www.boschsecurity.com/xc/en/solutions/management-software/access-management-system/||P3|Public product pages describe integration capability; endpoint contracts are not broadly public.|
|Schneider Electric|Security Expert API|On-prem / building security PACS|Open API advertised / docs gated|SOAP/web services; integration API|https://www.se.com/ww/en/product-range/63876-security-expert/||P3|Some deployments expose SOAP rather than modern REST; confirm edition/version.|
|AMAG Technology|Symmetry Open API / GUEST Web API|On-prem enterprise PACS|No public detailed reference|Web API; PSIA PLAI; SDK/integration services|https://www.amag.com/products/symmetry-access-control/||P3|Useful PSIA PLAI support for identity interchange; detailed endpoint reference may require customer access.|
|Nedap|AEOS integration APIs|On-prem enterprise PACS|Partner / NDA / licensed|Web services; database; socket interface; controller APIs|https://www.nedapsecurity.com/technology-partners/||P3|Official partner pages confirm API/web-service integration patterns, but contracts are partner-gated.|
|Inner Range|Integriti HLI / plugins / integrations|On-prem enterprise PACS|Partner / NDA / licensed|IP bi-directional HLI; plugins; database/event integration|https://www.innerrange.com/products/integrations||P3|Integration is commonly delivered as product-specific plugins rather than a public general REST API.|
|Integrated Control Technology (ICT)|Protege GX integration interfaces|On-prem PACS / building automation|No public detailed reference|HLI; BACnet; SDK/vendor integrations; database synchronization|https://ict.co/products-solutions/our-integrations/||P3|Strong integration ecosystem; implementation is typically app-note/version specific.|
|PACOM|Unison / VIGIL CORE integrations|Unified security / PACS|No public detailed reference|PIAM integration; imports/exports; superior-system interfaces|https://pacom.com/products/unison/||P3|Treat as partner discovery until a current integration contract is provided.|
|Paxton|Net2 SDK / Net2 Web API|On-prem PACS|No public detailed reference|.NET SDK/local API; REST JSON; Swagger|https://www.paxton-access.com/integrate/net2/||P1|Good candidate for a local/on-prem bridge; version and Web API installation requirements apply.|
|Ubiquiti|UniFi Access API|On-prem / appliance PACS|No public detailed reference|Local REST JSON; WebSocket/events|https://help.ui.com/hc/en-us/articles/30022926810135-Getting-Started-with-the-Official-UniFi-API|https://github.com/keshavdv/aiounifiaccess|P1|Official detailed Access API docs are exposed from the local controller; community libraries are useful but not vendor-supported.|
|Axis Communications|VAPIX Physical Access Control APIs|Edge/on-prem access control|Public docs|HTTP/JSON/XML VAPIX services; event stream|https://developer.axis.com/vapix/physical-access-control/||P1|Direct edge-controller integration; account for device firmware/API-version differences.|
|2N|Access Commander REST API|On-prem access management / intercom|Public docs|REST JSON; Swagger in Access Commander|https://wiki.2n.com/acc/latest/en/4-api||P2|Confirm Access Commander edition/version and API enablement.|
|Control iD|Access API|On-prem biometric/access controllers|Public docs|REST JSON|https://www.controlid.com.br/docs/access-api-en/||P2|Biometric payload handling can be sensitive; SignalGrid should consume evaluated events, not retain templates.|
|Suprema|BioStar 2 Local API|Biometric PACS|Public docs|REST JSON|https://support.supremainc.com/en/support/solutions/articles/24000072651-biostar-2-local-api-overview|https://github.com/supremainc|P2|Keep biometric templates outside SignalGrid; normalize authorization/event state only.|
|Suprema|G-SDK|Biometric device integration|No public detailed reference|gRPC; C++/C#/Java/Python/Node examples|https://supremainc.github.io/g-sdk/|https://github.com/supremainc/g-sdk|P2|Low-level device SDK can include write operations; SignalGrid integration should begin read-only.|
|ZKTeco|ZKBio CVSecurity Web API|Biometric / enterprise PACS|No public detailed reference|REST/Web API|https://www.zkteco.com/en/ZKBio_CVSecurity_API||P2|Product/version naming varies by region; confirm exact supported interfaces.|
|Anviz|CrossChex SDK / API / webhook mode|Biometric access and attendance|No public detailed reference|SDK; API; webhooks|https://www.anviz.com/download.html||P3|Confirm current API contract and avoid storing biometric templates.|
|DoorBird|LAN API / Cloud API|IP intercom / door access|Partner / NDA / licensed|HTTP API; event notifications; OpenAPI/cloud integration|https://www.doorbird.com/api||P2|Door unlock is a high-risk write operation; initial SignalGrid use should be events/status only.|
|Akuvox / akubela|akubela OpenAPI / Akuvox integrations|Intercom / smart building access|Partner / NDA / licensed|REST/OpenAPI; SIP; cloud integrations|https://openapi.akubela.com/||P3|Akuvox and akubela product/API boundaries should be confirmed per deployment.|
|Nuki|Nuki Web API|Smart locks|Public docs|REST JSON; webhooks/callbacks|https://api.nuki.io/|https://github.com/technyon/nuki_hub|P2|Consumer/prosumer roots; evaluate suitability and lock-action governance for enterprise use.|
|TTLock|TTLock Cloud API and Mobile SDK|Smart locks / OEM platform|Public docs|REST cloud API; iOS/Android SDK; Bluetooth|https://open.ttlock.com/|https://github.com/ttlock|P2|Strong OEM footprint; carefully separate cloud and local Bluetooth authority.|
|igloohome|igloodeveloper APIs and SDKs|Smart locks / offline PIN|Partner / NDA / licensed|Cloud API; SDK; offline PIN algorithms|https://www.igloocompany.co/developers||P3|Offline credential behavior is distinctive; obtain current partner documentation.|
|dormakaba|resivo Public API|Cloud residential access|Public docs|REST JSON|https://api-documentation.resivo.io/||P2|Residential focus; confirm event/webhook depth and geographic availability.|
|dormakaba|exivo integration API|Cloud access control|Partner / NDA / licensed|Cloud API|https://www.dormakaba.com/us-en/solutions/products/electronic-access-data/exivo||P3|Detailed API reference is partner-gated.|
|HID Global|HID Origo APIs|Mobile credentials / cloud identity|Public docs + gated credentials|REST JSON; mobile SDKs|https://doc.origo.hidglobal.com/api/||P2|Credential lifecycle layer, not a full PACS; useful for physical-person proof and portable credentials.|
|Allegion|ENGAGE Mobile SDK / Credentialing API|Mobile credentials / wireless locks|Public docs + gated credentials|iOS/Android SDK; cloud API|https://developer.allegion.com/en/products/engage-mobile-sdk.html||P2|Separate SDK commissioning/lock control from cloud credentialing API responsibilities.|
|ASSA ABLOY|Aperio integration SDK / protocol|Wireless lock integration|Partner / NDA / licensed|SDK/protocol via Aperio hubs|https://www.assaabloy.com/group/emeia/solutions/topics/access-control/aperio||P3|No public full protocol; integration normally occurs through an approved PACS/vendor program.|
|LEGIC|LEGIC Connect / Mobile SDK|Mobile credentials|Partner / NDA / licensed|Cloud API; mobile SDK; wallet integrations|https://www.legic.com/en/products/legic-connect||P2|Credential platform rather than full PACS; excellent candidate for portable work-context proof.|
|STid|STid Mobile ID API v3|Mobile credentials|Public docs|REST API; mobile SDK|https://stid-security.com/en/mobile-id-api/||P2|Use as a credential signal source; PACS remains the access authority.|
|rf IDEAS|Universal Enroll SDK|Credential readers / desktop enrollment|Partner / NDA / licensed|Desktop SDK; USB/BLE reader integration|https://www.rfideas.com/software/universal-enroll-sdk||P2|Reader/event integration, not a PACS; do not treat raw badge identifiers as authoritative identity without correlation.|
|Alcatraz AI|Rock / facial authentication integration API|Biometric physical access|No public detailed reference|API; Wiegand/OSDP inline integration|https://docs.alcatraz.ai/||P2|Biometric/privacy assessment is essential; consume verified result and event metadata, not raw biometric templates.|
|Safetrust|Safetrust mobile credential platform|Mobile credentials / reader upgrade|Partner / NDA / licensed|Mobile SDK / credential platform / reader integration|https://www.safetrust.com/||P3|Detailed public API reference was not located; request current integration documentation.|
|Wavelynx|Configure / mobile credential ecosystem|Readers / mobile credentials|No public detailed reference|Reader configuration and partner integrations|https://wavelynx.com/||P3|Vendor FAQ indicates no public API/SDK for Configure at time of verification.|
|Rosslare|AxTraxNG REST API / SDK|On-prem PACS|No public detailed reference|REST API; SDK; mobile credentials SDK|https://rosslaresecurity.com/software-development-kits/||P3|Confirm AxTraxNG/AxTraxPro version and licensing.|
|Sielox|Pinnacle Data Exchange / integrations|On-prem PACS|No public detailed reference|Data exchange / SDK integration|https://sielox.com/products/pinnacle/||P3|No broad public REST contract located; use vendor integration program.|
|Invixium|IXM WEB / biometric integration SDK|Biometric access and workforce|Partner / NDA / licensed|SDK/API and PACS connectors|https://www.invixium.com/||P3|Detailed public API contract was not located; avoid biometric-template storage.|
|Credence ID|Mobile biometric SDKs|Mobile identity / biometric capture|No public detailed reference|Android/mobile SDK; device APIs|https://developer.credenceid.com/|https://github.com/CredenceID|P3|Identity-capture component rather than PACS; consume verified assertion with strict privacy controls.|
|iLOQ|iLOQ digital/mobile access integrations|Digital locks / mobile credentials|No public detailed reference|Cloud/mobile integration APIs|https://www.iloq.com/||P3|Official integrations exist, including AEOS; obtain current API documentation through partner channels.|

## GitHub, OpenAPI and open-source resources

|Organization / Vendor|Repository / Resource|Status|Purpose|URL|Notes|
|---|---|---|---|---|---|
|Seam API|seamapi organization|Official|SDKs and examples for a unified access-control/smart-lock API|https://github.com/seamapi|Broad multi-vendor abstraction.|
|Gallagher Security|cc-rest-docs|Official|Command Centre REST API documentation|https://github.com/GallagherSecurity/cc-rest-docs|Public enterprise PACS docs.|
|Genetec|Security-Center-SDK-Samples|Official|Security Center SDK samples|https://github.com/Genetec/Security-Center-SDK-Samples|Requires Genetec SDK/developer context.|
|Suprema|supremainc organization|Official|BioStar/G-SDK repositories and samples|https://github.com/supremainc|Vendor-managed organization.|
|Suprema|g-sdk|Official|gRPC device integration SDK|https://github.com/supremainc/g-sdk|Includes low-level device operations.|
|Suprema|BioStar2_device_SDK|Official|BioStar 2 device SDK|https://github.com/supremainc/BioStar2_device_SDK|Device-level integration.|
|TTLock|ttlock organization|Official|Mobile SDKs and sample projects|https://github.com/ttlock|Cloud + Bluetooth lock ecosystem.|
|Akiles|openapi-specs|Official|Machine-readable OpenAPI specifications|https://github.com/akiles/openapi-specs|Excellent contract source.|
|Tapkey|tapkey organization|Official|Mobile access SDKs and examples|https://github.com/tapkey|Mobile credential/lock platform.|
|Kisi|kisi-inc organization|Official|Kisi public SDK repositories|https://github.com/kisi-inc|Some SDK use may require vendor approval.|
|Kisi|kisi-ios-st2u-framework|Official|iOS secure tap-to-unlock framework|https://github.com/kisi-inc/kisi-ios-st2u-framework|Review licensing and SDK access terms.|
|Kisi|kisi-android-st2u-sdk-public|Official|Android secure tap-to-unlock SDK|https://github.com/kisi-inc/kisi-android-st2u-sdk-public|Review licensing and SDK access terms.|
|ONVIF|specs|Official standard|ONVIF specifications including access-control profiles|https://github.com/onvif/specs|Profiles A, C, D and related schemas.|
|OSDP|libosdp|Open source|SIA OSDP implementation with Secure Channel support|https://github.com/goToMain/libosdp|Reader-controller protocol, not a cloud PACS API.|
|Ubiquiti community|aiounifiaccess|Community|Async Python client for UniFi Access|https://github.com/keshavdv/aiounifiaccess|Not vendor-supported; compare with local official API.|
|Ubiquiti community|py-unifi-access|Community|Python UniFi Access client|https://github.com/uilibs/py-unifi-access|Community reverse-engineered/observed API client.|
|Ubiquiti community|unifi-mcp|Community|MCP server for UniFi surfaces including Access|https://github.com/sirkirby/unifi-mcp|Validate scope and security before use.|
|Nuki community|nuki_hub|Community|Local ESP32/MQTT bridge for Nuki locks|https://github.com/technyon/nuki_hub|Local bridge; not official API.|
|Nuki community|pyNukiBT|Community|Python Bluetooth integration for Nuki|https://github.com/tsightler/pyNukiBT|Local Bluetooth path; not official.|
|Aliro research|aliro|Community research|Research/implementation material for CSA Aliro access credentials|https://github.com/kormax/aliro|Not an official CSA implementation.|
|Credence ID|CredenceID organization|Official|Mobile biometric device SDK examples|https://github.com/CredenceID|Identity capture rather than PACS.|
|Control iD|Access API documentation|Official docs|Vendor-published REST API documentation|https://www.controlid.com.br/docs/access-api-en/|Documentation site rather than GitHub.|
|Rhombus|Public OpenAPI JSON|Official spec|Machine-readable public API contract|https://api2.rhombussystems.com/api/openapi/public.json|Use for generated clients and drift checks.|
|Akiles|Developer Center|Official docs|API documentation and test organizations|https://developers.akiles.app/|Includes OAuth and public API guidance.|

## Standards

|Standard / Profile|Domain|What it standardizes|Availability|Official URL|SignalGrid relevance|
|---|---|---|---|---|---|
|ONVIF Profile A|Access control configuration|Standardizes retrieval/configuration of access rules, credentials and schedules for access-control clients.|Public specification|https://www.onvif.org/profiles/profile-a/|Use for vendor-neutral configuration discovery where supported.|
|ONVIF Profile C|Door control and event management|Covers site information, door access control and event/alarm management.|Public specification|https://www.onvif.org/profiles/profile-c/|Older access-control profile; verify vendor conformance.|
|ONVIF Profile D|Access-control peripherals|Standardizes peripherals such as readers, locks, sensors and door devices.|Public specification|https://www.onvif.org/profiles/profile-d/|Useful for edge hardware and peripheral interoperability.|
|ONVIF Profile M|Metadata and events|Standardizes analytics metadata and events that can complement access-control context.|Public specification|https://www.onvif.org/profiles/profile-m/|Primarily video/analytics metadata, not PACS administration.|
|SIA OSDP|Reader-controller protocol|Open Supervised Device Protocol for secure, bidirectional reader-to-controller communication.|Public standard; implementation available|https://www.securityindustry.org/industry-standards/open-supervised-device-protocol/|Prefer OSDP Secure Channel over legacy Wiegand for new deployments.|
|PSIA PLAI|Logical access interoperability|Physical-Logical Access Interoperability for identity and access information exchange across systems.|Public industry specification|https://psialliance.org/specifications/plai/|Useful for PIAM/PACS identity synchronization.|
|CSA Aliro|Mobile access credential standard|Emerging standard for interoperable mobile credentials and readers using modern device wallets.|Standards ecosystem; implementation maturity varies|https://csa-iot.org/all-solutions/aliro/|Verify current final-spec and certification status before product commitments.|
|Wiegand|Legacy reader-controller interface|Widely deployed unidirectional credential bitstream interface.|Legacy de facto interface|https://www.securityindustry.org/industry-standards/open-supervised-device-protocol/|No native encryption or bidirectional supervision; model as lower-assurance evidence.|
|BACnet|Building automation integration|Building automation protocol often used to expose or consume access-control and building states.|Public standard ecosystem|https://bacnet.org/|Not a PACS identity API; useful for room/building operational signals.|
|SCIM 2.0|Identity provisioning|Standard REST protocol for provisioning users and groups into cloud PACS platforms.|Public IETF standard|https://www.rfc-editor.org/rfc/rfc7644|Common for IdP-to-PACS user lifecycle; not door/event control.|

## Recommended SignalGrid integration order (owner's sequencing)

|Tier|Target|Role in launch path|Why prioritize|Access path|Minimum signal set|
|---|---|---|---|---|---|
|P0|Microsoft Entra ID + Intune|Identity/device foundation|Not a PACS, but establishes verified identity, assignment and managed-device posture before physical-access evidence.|Read-only Graph; sandbox first|identity state; role/group; device compliance; management; freshness; connector health|
|P1|Seam|Fast multi-vendor prototype|One API can accelerate proof across several access systems and smart-lock vendors.|Public API|users; credentials; access groups; entrances; events|
|P1|Kisi|Modern cloud PACS + mobile unlock|Public REST/webhooks plus SDK ecosystem and strong event model.|Public docs; SDK approval may apply|identity; access rights; lock/door events; mobile credential|
|P1|Brivo|Enterprise cloud PACS|Large installed base and mature cloud administration/event model.|OAuth/customer or partner app|users; credentials; groups; doors; events|
|P1|Verkada|Cloud PACS with strong events|Public Access Control APIs and cloud operational model.|API key|users; doors; access events; health|
|P1|Rhombus|Cloud access + video|Public OpenAPI provides a clean generated-client and evidence path.|API key / OpenAPI|doors; users; events; video context|
|P1|ProdataKey|Cloud PACS and streaming|REST plus streaming API can support near-real-time Grid events.|Partner credentials|people; credentials; doors; event stream|
|P1|Gallagher Command Centre|Enterprise on-prem PACS|Best-in-class public REST documentation among traditional enterprise PACS vendors.|Licensed local system|cardholders; access groups; doors; alarms; events|
|P1|Genetec Security Center|Unified enterprise security|Strong enterprise and healthcare relevance; SDK samples exist.|Developer/technology partner|entities; credentials; doors; events; alarms; video|
|P1|Paxton Net2|Accessible local/on-prem bridge|SDK and Web API make a practical local proof path.|Local credentials / integrator|users; tokens; access levels; doors; events|
|P1|Axis VAPIX PAC|Direct edge-controller signals|Public device APIs expose door/controller status without requiring a cloud PACS.|Device credentials|door state; controller state; credentials; events|
|P1|UniFi Access|Affordable lab and edge proof|Local API and community tooling make it practical for a controlled lab.|Local controller API|users; credentials; doors; access events|
|P1|SALTO KS|Wireless-lock/cloud access|Good bridge from PACS to lockers/interior doors and mobile credentials.|Customer application|users; locks; access groups; events|
|P2|HID Origo / Allegion / STid / LEGIC|Mobile credential evidence|Adds portable identity/credential assurance after the first PACS path works.|Commercial credential platforms|credential lifecycle; device binding; wallet/mobile proof|
|P2|Suprema / Control iD / ZKTeco|Biometric and reader signals|Adds physical-person verification and device events; privacy boundary must be strict.|Local API/SDK|verified identity result; reader/device state; access event|

## SignalGrid implementation boundary (owner's rules, all already fabric law)

- Start with read-only status and event collection; no door-unlock or credential-revocation writes in a first connector.
- The PACS, credential platform, reader, lock, IdP and visitor system remain the authoritative systems of record.
- Normalize identity correlation, credential type, access result, authorization, door state, anti-passback/tailgating, event time, source reference and connector health.
- Treat unknown, stale, malformed, contradictory or unreachable evidence as unresolved rather than trusted.
- Keep biometric templates, raw credential secrets and customer-sensitive payloads outside the public Review Hub.

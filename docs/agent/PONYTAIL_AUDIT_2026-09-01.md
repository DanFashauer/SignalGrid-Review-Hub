# Ponytail audit — 2026-09-01 (ultra, whole repo)

**What this is.** The first independent scan by the top layer of the review stack (DR-024):
`ponytail-audit` from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) v4.9.0
(MIT), run in `ultra` mode by three parallel auditors over `lib/**`, `artifacts/**`, and
`scripts/** + native/**`, each executing the skill's procedure verbatim. Read-only: it lists,
it does not apply. Findings are ranked biggest cut first in the skill's own one-line form:
`<tag> <what to cut>. <replacement>. [path:lines]`, tags `delete:` / `stdlib:` / `native:` /
`yagni:` / `shrink:`.

**What it is not.** A correctness or security review. Ponytail's own charter puts those out of
scope and routes them to a normal review pass; the items each auditor routed that way are
collected at the end and forwarded to the ECC lane and the independent-scan lane.

**Never cut (Ponytail's rule, and this repo's).** Trust-boundary validation, error handling that
prevents data loss, security, accessibility, anything explicitly requested, and every non-trivial
logic's one runnable check — which in this repo means the `proof:*` harnesses and gate self-tests.
No finding below proposes removing a fail-closed branch, a `default:` arm, a 401/403, a proof, or
the byte-faithful iOS ports.

**Baseline.** `ponytail-debt` on 2026-09-01: `No ponytail: debt. Clean ledger.` (no `ponytail:`
markers existed; the convention starts with the first cut that leaves a deliberate ceiling).

---

## Scope: `artifacts/**` — api-server, mcp-server, the web apps

**PONYTAIL-AUDIT (ULTRA, read-only) — `artifacts/**`: api-server, mcp-server, signalgrid-app, signalgrid-review, signalgrid-web, mockup-sandbox.** Ranked biggest cut first. Every "dead" claim was grep-verified across `src/`, `test/`, `scripts/`, `docs/` (a test or Bruno hit is noted, not counted as a consumer).

1. `delete:` the whole mockup-sandbox app — `src/components/mockups/` does not exist, the generated module map is empty, so the router can only ever render the "Component Preview Server" placeholder; nothing in the workspace imports it (launch-profile lists it as not-launch, threat_model calls it dev-only). Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/mockup-sandbox/src/App.tsx:139-284, /home/user/SignalGrid-Review-Hub/artifacts/mockup-sandbox/src/.generated/mockup-components.ts:1-5, /home/user/SignalGrid-Review-Hub/artifacts/mockup-sandbox/mockupPreviewPlugin.ts:1-188] — −5,873 lines, −52 deps.
2. `delete:` vendored shadcn `components/ui` nothing reaches (transitive graph from non-ui src, ui→ui imports followed): signalgrid-app 34 of 53 unreached (3,283 lines; 15 used directly, 19 transitively), signalgrid-review 48 of 52 (4,920 lines; only card/toast/toaster/tooltip), signalgrid-web 49 of 53 (4,997 lines; only brand-icons/toast/toaster/tooltip). 88 package.json entries are reachable ONLY through those files (24 app / 32 review / 32 web: the radix set, cmdk, embla, input-otp, vaul, next-themes, sonner, react-hook-form…). `npx shadcn add <x>` when a screen needs one. [/home/user/SignalGrid-Review-Hub/artifacts/{signalgrid-app,signalgrid-review,signalgrid-web}/src/components/ui/] — −13,200 lines, −88 deps.
3. `delete:` review + web mount three providers with zero consumers: `QueryClientProvider` (no `useQuery`/`useMutation` anywhere), `TooltipProvider` (no `Tooltip` outside App), `<Toaster/>` (no `toast()` caller). Drop the providers, then toast.tsx/toaster.tsx/use-toast.ts/tooltip.tsx go with them. Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-review/src/App.tsx:1-24, /home/user/SignalGrid-Review-Hub/artifacts/signalgrid-web/src/App.tsx:4-6,18,38-50] — −776 lines, −6 deps (@tanstack/react-query, @radix-ui/react-tooltip, @radix-ui/react-toast ×2).
4. `delete:` signalgrid-web sections nothing renders: ProblemSection (88), DifferentiatorsSection (110), ComplianceSection (204) — zero importers. Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-web/src/components/sections/ProblemSection.tsx:1-88, DifferentiatorsSection.tsx:1-110, ComplianceSection.tsx:1-204] — −402.
5. `native:` signalgrid-app carries a 351-line hand-rolled radix toast stack (use-toast reducer + toast.tsx + toaster.tsx) for ONE caller, while `sonner` is installed AND `ui/sonner.tsx` is already vendored. `import { toast } from "sonner"` in PolicyCreate + mount `ui/sonner`'s `<Toaster/>`. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/hooks/use-toast.ts:1-191, /home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/pages/policies/PolicyCreate.tsx:36,62,67] — −351, −1 dep.
6. `yagni:` deprecation middleware whose registry is EMPTY by design; the env-injection path exists only so the test can exercise it. Caveat: docs/API_VERSIONING_POLICY.md promises the headers — cutting means the doc says "added with the first deprecation" (and `pathMatcher` un-exports). [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/middlewares/deprecation.ts:1-92, /home/user/SignalGrid-Review-Hub/artifacts/api-server/src/app.ts:108-112, /home/user/SignalGrid-Review-Hub/artifacts/api-server/test/api.test.mjs:1476-1500] — −97 (+test lines).
7. `yagni:` simulator + radar routers: no web app, native, or MCP path calls them (review runs the simulator client-side from `@workspace/signalgrid-simulator`; MCP calls `scanSignals` directly). Only Bruno/Postman/docs reference them; the GA fence 404s them anyway. Scope decision — flagged, not free. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/simulator.ts:1-67, /home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/radar.ts:1-33] — −100.
8. `yagni:` monitoring fixtures with no consumer: `/decisions`, `/decisions/:id`, `/metrics/dashboard`, `/metrics/decisions/series` — the generated client exposes no hook for them and signalgrid-app reads decisions/metrics from `/v1`. Keep `/signals/latest`, `/policies`, `/integrations` (used via api-client-react). [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/monitoring.ts:29-50,68-95,147-162,172-178] — −75.
9. `delete:` unused direct deps (no import anywhere in src incl. ui): signalgrid-app framer-motion, react-icons; signalgrid-review @hookform/resolvers, date-fns, framer-motion, react-icons, recharts, wouter, zod; signalgrid-web @hookform/resolvers, date-fns, react-icons, recharts, zod; plus `@tailwindcss/typography` loaded with zero `prose` uses in app and web. Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/index.css:3, /home/user/SignalGrid-Review-Hub/artifacts/signalgrid-web/src/index.css:3] — −16 deps.
10. `delete:` `use-mobile.tsx` in review and web — importer is only `ui/sidebar`, itself unreached. Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-review/src/hooks/use-mobile.tsx:1-19, /home/user/SignalGrid-Review-Hub/artifacts/signalgrid-web/src/hooks/use-mobile.tsx:1-19] — −38.
11. `shrink:` v1.ts repeats evaluate→count→persist verbatim in `/decisions/evaluate` and `/authorize`, and pastes the same 4-line "authorizedContext, NOT context" comment + store lookup three times. One `evaluateAndPersist(req)` and one `durableDecision(req, id)`; sessions `core.context`+`authorize`+`tenant.id` trio → `authorizedCtx(req, perm)`. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/v1.ts:69-85,112-133,135-203,288-290,301-303,317-319] — −36.
12. `yagni:` the console's `evaluateV1` re-implements the generic `v1()` helper 300 lines below it. `return (await v1<{decision:V1Decision}>(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(req)},activeToken)).decision`. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/lib/v1.ts:57-80] — −18.
13. `shrink:` `rateLimit.ts bearerToken` is byte-identical to `context.ts extractBearer` (rung 2). Export one, import it. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/middlewares/rateLimit.ts:132-146, /home/user/SignalGrid-Review-Hub/artifacts/api-server/src/middlewares/context.ts:172-187] — −15.
14. `shrink:` mcp-server: `readJson` = `readText` + `JSON.parse` (−6); four inline `{isError:true,content:[…]}` literals predate the `asError` helper defined at L425 — hoist it (−8); `tokenForTenant` is the THIRD copy (api-server sim.ts:24-27, lib/room-sim/src/browser.ts:17-20) — export from room-sim, which both already import (−8). [/home/user/SignalGrid-Review-Hub/artifacts/mcp-server/src/index.ts:38-41,59-73,199-202,251,369,393, /home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/sim.ts:24-27] — −22.
15. `delete:` `normalizeRoute` — exported, zero callers (only comments name it; the middleware moved to `req.route.path`). Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/lib/metrics.ts:183-192] — −10.
16. `delete:` signalgrid-review one-line re-export shims: `lib/simulator/audit` (proposed), `routing.ts`, `data/simulatorScenarios.ts` have zero importers; `decisionEngine.ts`/`types.ts` have one, which can import `@workspace/signalgrid-simulator` directly. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-review/src/lib/simulator/{audit,routing,decisionEngine,types}.ts, /home/user/SignalGrid-Review-Hub/artifacts/signalgrid-review/src/data/simulatorScenarios.ts, /home/user/SignalGrid-Review-Hub/artifacts/signalgrid-review/src/components/sections/SignalGridSimulatorSection.tsx:2-6] — −30, 5 files.
17. `delete:` `setV1Token` — no caller; `let activeToken` becomes the constant. Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/lib/v1.ts:15-20] — −6.
18. `shrink:` `ClassifiedBodyError` carries `error` twice (top level and inside `payload`). Return `{status, body:{error,message}}`. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/middlewares/errors.ts:214-218,238-264] — −6.
19. `native:` `PROVISIONING_DEVICES` object + `hasOwnProperty` guard + prototype-pollution comment → `new Map([...])` and `.get(serial)`. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/control-plane.ts:468-472,486-489] — −5.
20. `shrink:` simulator `envelope` mints its own `randomUUID()` requestId although `requestContext` already stamped `req.requestId` on every request — use `req.requestId ?? null` like v1's envelope and drop the crypto import. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/simulator.ts:1,59-65] — −3.
21. `native:` `lib/format` (proposed) pulls date-fns for two formatters → `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` (the relative one needs an ~8-line unit picker; line count is a wash). [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/lib/format.ts:1-11] — −1 dep.
22. `delete:` `@workspace/orchestration` in api-server package.json — imported nowhere in src/test; room-sim declares it itself. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/package.json:12] — −1 dep.
23. `shrink:` `HealthCheckResponse.parse({ status: "ok" })` validates a literal. `{ status: "ok", tier, liveIntegrations }`. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/health.ts:181-183] — −1.
24. `delete:` two `.gitkeep` files in directories that are no longer empty. Nothing. [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/lib/.gitkeep, /home/user/SignalGrid-Review-Hub/artifacts/api-server/src/middlewares/.gitkeep] — 2 files.

**Webhook-endpoint duplication (verified, ranked):** inside this scope there is exactly ONE implementation reachable — `GET /v1/webhooks` and `/v1/webhooks/deliveries` read `core.listWebhookEndpoints/Deliveries` from `@workspace/signalgrid-core` [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/v1.ts:432-440]. The second (`lib/integrations/src/integrations/webhooks/{store,dispatch,emitter,sign,retry,resolve}.ts`) has no importer in any `artifacts/*` package (`@workspace/integrations` is not a dependency of any artifact). That makes the lib copy the orphan, not the route; it is the larger cut but belongs to the `lib/**` auditor.

**net: -21,000 lines, -165 deps possible** (manifest entries across four apps + api-server; ~45 distinct packages).

---

route to normal review (uncounted, out of scope here):
- monitoring.ts stamps `iso(...) as unknown as Date` into typed fixtures — the types lie about the wire shape [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/monitoring.ts:47,65,90,110].
- simulator.ts's separate `randomUUID()` requestId means a `/simulator/*` response cannot be correlated with its pino log line (same root as finding 20) [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/simulator.ts:61].
- `/cp/v1/fleet` silently truncates to 200 with `total` but no cursor [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/routes/control-plane.ts:69-72].
- idempotency replay only wraps `res.json`; a handler answering via `res.send`/`res.end` is never cached (documented scope, worth a line in the docblock) [/home/user/SignalGrid-Review-Hub/artifacts/api-server/src/middlewares/idempotency.ts:96-106].
- signalgrid-app ships demo auditor/owner bearer tokens as client-side constants — by design for the demo, but a `shared-device-gateway` build of the console would carry them too [/home/user/SignalGrid-Review-Hub/artifacts/signalgrid-app/src/lib/v1.ts:13,190,262].
---

## Scope: `lib/**` — decision core, connectors, persistence, audit, webauthn

**PONYTAIL-AUDIT — ULTRA — scope `lib/**`** (read-only; nothing applied). Ranked biggest cut first. `lib/location` is excluded from deletion on purpose: `docs/COMPANY_BUILD_PLAN.md` row 51a records an owner decision to keep it.

1. `yagni:` the per-connector copy of the report-field parsers — `oneOf` (22 byte-identical copies), `ownValue` (16), `enumMalformed` (15), `hasUnrecognizedKey` (16, five comment-only variants), `isPlainReport` (14) + `isPlainObject` (3), `boolOrNull` (9), `boolMalformed` (8), `textOf` (7), `instantOf` (5), `readableString` (4 identical), and `const MAX_PROTOTYPE_DEPTH = 64` (21 copies). One `lib/integrations/src/utils/report-fields` (proposed) next to the `posed-bound.ts` the team already started (rung 2); each connector imports. Fail-closed semantics unchanged — these are the exact same bytes. [lib/integrations/src/integrations/token-binding/token-binding-connector.ts:27-36, sse-egress/sse-egress-connector.ts:31-83, agent-identity/agent-identity-connector.ts:96-148, and 30 sibling `*-connector.ts`] ≈ -1,050
2. `yagni:` 11 hand-copied HTTP read-connector scaffolds — `XRequest`/`XHttpResponse`/`XTransport` triplets (identical shapes), `errorFor` (11, one variant), and the 11 `mock-transport.ts` files that differ only in path prefix, collection key and default base URL (plus their private `baseUrlPath`/`jsonResponse`, 1 variant each). One `ReadTransport` type + one `createMockReadTransport({ path, items, expectedToken, ... })`; each family keeps a 5-line wrapper. [lib/integrations/src/integrations/edr-threat/edr-connector.ts:18-29,126-131; edr-threat/mock-transport.ts:1-47; data-protection/mock-transport.ts:1-47; carrier, credential-exposure, graph, identity-risk, location-services, network-nac, peripheral-control, rtls-custody, vuln-scan likewise] ≈ -650 *(deferred families — design target, not shipping in the launch surface.)*
3. `delete:` `lib/integrations/src/integrations/telemetry/mde.ts` — never imported, not even by the telemetry barrel (`telemetry/index.ts:10-13` exports resolve/types/fleetdm/store only); `MDEAdapter`/`getMDEAdapter` have zero references repo-wide, and `MDE_TENANT_ID`/`MDE_CLIENT_*` are set nowhere. Nothing. [lib/integrations/src/integrations/telemetry/mde.ts:1-265] -265
4. `delete:` `itsm/store.ts` CRUD nobody calls: `createITSMConfig` (only ref is an unwired fossil test, see review list), `updateITSMConfig`, `getITSMConfigByVendor`, `deleteITSMConfig`, `updateLastTestResult`, `getTicketTemplate`, `createTicketTemplate`, `updateTicketTemplate`, `deleteTicketTemplate`, `seedTicketTemplates`. The two proofs that import this file use other exports. Nothing. [lib/integrations/src/integrations/itsm/store.ts:276-319,404-416,421-474,479-499,504-530,768-771,776-799,804-828,833-849,854-864] -240
5. `yagni:` 35 copies of `guardReadOnly`, each differing only in the error class and label. `const guardReadOnly = readOnlyGuard(XConnectorError, "x")` from one 6-line factory; keep the strict `method !== "GET"` form (see review note). [lib/integrations/src/integrations/sse-egress/sse-egress-connector.ts:23-27, carrier/reachability-connector.ts:47-54, and 33 siblings] -190
6. `native:` + `delete:` `utils/fetchWithTimeout.ts` — `fetchJsonWithTimeout`, `fetchWithValidation`, `FetchResult`, `TIMEOUT_PRESETS.long/jwks` have zero callers; `fetchWithTimeout` itself only re-labels an AbortError. `fetch(url, { signal: AbortSignal.timeout(ms) })` — five connectors already do exactly this (e.g. `sse-egress/index.ts:67`). Four callers swap one option for another. [lib/integrations/src/utils/fetchWithTimeout.ts:1-134] -134
7. `delete:` `webhooks/emitter.ts` — `emitWebhookEvent` and its nine `emitX` wrappers have no importer anywhere (the `webhooks` barrel exports resolve+dispatch only). Nothing. [lib/integrations/src/integrations/webhooks/emitter.ts:1-127] -127
8. `delete:` unreferenced webhook plumbing: `removeFromDLQ`, `deleteWebhook`, `getDLQ` in store; `getRetrySchedule`, `getNextRetryAt` in retry; `generateSecret`, `verifySignature` in sign (the Swift/docs hits are a same-named Swift function, not callers); `getWebhookSecret` in dispatch. Nothing. [lib/integrations/src/integrations/webhooks/store.ts:255-265,381-390,395-418; retry.ts:52-58,89-97; sign.ts:45-68; dispatch.ts:384-387] -85
9. `delete:` orphan singleton accessors and fixtures: `getFleetDMAdapter`, `getDeviceResolver`/`setDeviceResolver`, `evaluateUemFixture`, `outcomesCovered`, `DEFAULT_WEBAUTHN_CONFIG`, `DEMO_OBSERVABILITY_STREAM_RECORDS`, `DEMO_CREDENTIAL_ROTATION_RECORDS`, and the webauthn `createStepUp` + `deleteStepUpSession` pair (zero callers; the proof mints step-up sessions through `webauthnStore.createStepUpSession` directly). Nothing. [lib/integrations/src/integrations/telemetry/fleetdm.ts:537-543; deviceResolver.ts:288-297; uem/index.ts:208-211; lib/signalgrid-core/src/metrics.ts:40-42; lib/webauthn/src/webauthn/types.ts:122-127; observability-integrity/index.ts:112-143; credential-rotation/index.ts:97-112; lib/webauthn/src/webauthn/server.ts:560-580; lib/webauthn/src/webauthn/store.ts:527-543] -115
10. `yagni:` `custom-fetch.ts` carries an Expo/React-Native template: `setAuthTokenGetter`/`_authTokenGetter`/`AuthTokenGetter` have no caller (three web apps call only `setBaseUrl`), and `responseType` is never passed by the generated client (0 occurrences in `generated/api.ts`), so the `"blob"` branch and `inferResponseType` switch are unreachable. Drop the getter and the option; always `auto`. [lib/api-client-react/src/custom-fetch.ts:1-2,9,19,32-45,261-264,285-291,314-321,352-359] -42
11. `yagni:` `normalizeSeverity` — four identical copies. One export in the shared helper from (1). [lib/integrations/src/integrations/credential-exposure/credential-connector.ts:258-272; data-protection/dlp-connector.ts:232-246; edr-threat/edr-connector.ts; vuln-scan/vuln-connector.ts] -45
12. `yagni:` Redis client bootstrap ×7 — `getRedisClient` (webauthn/store, telemetry, uem, nac) and `getRedis` (stepUpStore, itsm, webhooks). One `utils/redis.ts`; keep the webauthn shape — it is the only one that attaches the `error` listener (edge-case-correct pick). [lib/webauthn/src/webauthn/store.ts:16-44; lib/integrations/src/integrations/telemetry/store.ts:13-25; uem/store.ts:75-80; nac/store.ts:59-64; itsm/store.ts:142-151; webhooks/store.ts:33-42] -38
13. `delete:` audit convenience recorders with no caller: `recordAuthFailure`, `recordAdminAccess`, `recordLocationObservation`. Nothing. [lib/audit/src/index.ts:343-349,358-365,375-388] -29
14. `yagni:` `deepFreeze` ×5, byte-identical. One export (e.g. from `@workspace/signalgrid-core/util`); caveat — `reliability`, `self-audit`, `iac` are zero-dep packages today and would gain a workspace dep, so the win is small. [lib/self-audit/src/types.ts:170-178; lib/reliability/src/types.ts:94-102; lib/work-context/src/assemble.ts:91-97; lib/adaptive-proposals/src/types.ts:192-200; lib/iac/src/types.ts:240-248] -28
15. `yagni:` `DecisionStore` interface has one implementation (`PostgresDecisionStore`); the proof injects that same class. Type `getDecisionStore`/`setDecisionStore` on the class. [lib/persistence/src/decision-store.ts:17-33] -17
16. `yagni:` `deriveFreshness` ×3 (carrier, location-services, network-nac) — same function, shared home in (1); see review note for the third copy. [lib/integrations/src/integrations/carrier/evaluate.ts:129-138; location-services/evaluate.ts:72-81; network-nac/evaluate.ts:151-156] -14
17. `yagni:` `StoreBackend` type + `singleton` in location store — one implementation, and the comment says the Redis one is "intentionally not wired". Export the class. [lib/location/src/store.ts:3-6,50-62] -10
18. `shrink:` `bufferToBase64url` — both branches are the same statement. `return Buffer.from(buffer).toString('base64url');` [lib/webauthn/src/webauthn/server.ts:55-60] -4
19. `native:` `uuid` (+`@types/uuid`) in `@workspace/audit` for one `uuidv4()` call. `crypto.randomUUID()` — already what seven other lib files use. [lib/audit/src/index.ts:2,154; lib/audit/package.json] -1 line, -2 deps
20. `delete:` `uuid` + `@types/uuid` declared in `@workspace/integrations` and never imported (every id there is `crypto.randomUUID()`). Nothing. [lib/integrations/package.json] -2 deps
21. `yagni:` (gated) audit's third hand-rolled canonicalizer — its own comment (lines 88-93) names `verdict-attestation/canonical.ts` and `signalgrid-core/util.ts` as the copies that got the key-escaping right first. Import `canonicalize` from verdict-attestation; **caveat**: the audit form escapes only `\` and `"`, so existing ledger rows whose strings hold control characters would re-hash — needs a ledger-version bump, not a drop-in. [lib/audit/src/index.ts:65-125] -60

**Owner call — same "deferred family, zero importers is expected" argument as row 51a; the barrel comments say "kept exported for the live path a private deployment would inject". Listed, not counted:**
- `delete:` `lib/webauthn/src/stepUpStore.ts` — 292 lines, zero code importers (barrel only), and a second step-up session store already lives in `webauthn/store.ts:481-543`; the lane message notes step-up is deferred and this file is reachable by no runner. [lib/webauthn/src/stepUpStore.ts:1-292]
- `delete:` posture adapters with no composer: `fromCustodyBeacon`, `fromBreakGlass`, `fromCredentialRotation`, `fromObservabilityIntegrity`, `fromLocalAuthority`. [lib/posture-composition/src/adapters.ts:213-223,351-366,388-437] *(deferred families — design target, not shipping in the launch surface.)*
- `delete:` ITSM vendor half — `createITSMAdapter`/`ITSMAdapterManager`/`itsmAdapterManager` and the four vendors nothing instantiates (`servicenow`, `jira`, `ivanti`, `generic-webhook`), ~1,500 lines. [lib/integrations/src/integrations/itsm/adapter.ts:31-282, servicenow.ts, jira.ts, ivanti.ts, generic-webhook.ts]
- `delete:` SIEM vendor half — `SentinelAdapter`, `SplunkAdapter`, `WebhookSIEMAdapter`, ~730 lines, zero references; carries the never-set `MSI_SECRET`/`MSI_ENDPOINT`. [lib/integrations/src/integrations/siem/sentinel.ts:32-351, splunk.ts:29-185, webhook.ts:35-191]
- `delete:` `syslog/transport.ts` — barrel-exported only, 382 lines. [lib/integrations/src/integrations/syslog/transport.ts:1-382]

Not cut on purpose: the 40 `*ConnectorError` classes (proofs `instanceof` the family class — collapsing them is the same size), `sha256` in verify.ts (3 callers, 3 lines), `constantTimeEquals` (isomorphic core, security), every `normalizeReport` (19 genuinely different), `lib/api-spec` (codegen-only by design), `FleetDMAdapter` (used by the live-fleet proofs).

**net: -3,080 lines, -4 deps possible** (a further ~2,980 lines sit behind the owner call above).

route to normal review:
- `lib/integrations/src/integrations/network-nac/evaluate.ts:151-156` — `deriveFreshness` lacks the future-skew guard its two siblings carry (`carrier/evaluate.ts:136`, `location-services/evaluate.ts:79`): a `lastAuthAt` in the future reads **fresh**. Fail-open by doctrine.
- `guardReadOnly` is inconsistent: 8 copies use `method !== "GET"`, 27 use `method.toUpperCase() !== "GET"` (e.g. `carrier/reachability-connector.ts:48` vs `sse-egress/sse-egress-connector.ts:24`); the loose form accepts `"get"`. Standardize on strict when consolidating.
- `tests/security-reference/*.test.ts` import `@/lib/integrations/webhooks/dispatch`, a path that does not exist in this repo, and no script or workflow runs them — fossil tests that still "reference" `createITSMConfig`. Out of my scope, flagged only.
- `lib/audit/src/index.ts:97-99` — `escapeJsonString` does not escape control characters, so the canonical form is not valid JSON for such strings (no collision, but worth a look alongside item 21).
---

## Scope: `scripts/** + native/**` — gates, proofs, Swift/Kotlin/Rust clients

I have everything I need; no further reads are required. Findings follow, ranked biggest cut first. Nothing was modified.

**PONYTAIL-AUDIT (ULTRA) — scope: scripts/**, native/**, firmware/** — read-only**

`shrink:` the per-proof `check`/`passed`/`failures`/summary/`Failed checks` boilerplate copied into ~131 proofs (4-line `check` in 110 files, a 1-line variant in ~23, plus `let passed`/`const failures` and the 4-line footer). One `scripts/src/lib/check` (proposed) exporting `check(name, ok)` + `finish(figures?)`; each proof imports two names (rung 2 — `scripts/src/lib/` already holds `live-gate.ts`/`grant-safety.ts` used by 38 proofs). [scripts/src/access-governance-proof.ts:51-56, scripts/src/access-governance-proof.ts:340-342, scripts/src/caep-events-proof.ts:15-16, scripts/src/caep-events-proof.ts:113-116, scripts/src/app-workflow-templates-proof.ts:28]

`delete:` `USBCBadgeReaderProvider` (317 lines) — unreachable: registered under raw key `"usbc"` but `BadgeReaderType` has no `usbc` case, so `createProvider(config:)` keys on `config.readerType.rawValue` and can never return it; the app already has an ExternalAccessory USB path (`ExternalAccessoryBadgeReaderProvider` → `BadgeReaderManager`, 336 lines). Nothing (or register it as `.usbAccessory` and delete the other). [native/ios/EnterpriseShell/Services/USBCBadgeReaderProvider.swift:1-317, native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:207-223]

`yagni:` the identity-provider plug-in registry: `MDMIdentityProvider` (`queryMDMForUser` is a `return nil` placeholder — and an app cannot read MDM identity anyway, CLAUDE.md rule 4), `MFAIdentityProvider` (`verifyMFAToken` always throws `mfaNotConfigured`), `HybridIdentityProvider` (composes those two stubs), `MFAProviderType` (7 vendors, only ever `.rawValue`-stringified), `IdentityProviderType.saml/.custom` (no implementation), `IdentityProviderFactory.registerProvider/setDefaultProvider/getDefaultProvider` (0 external callers), and the `saml*/custom*/mfa*` config fields. One `OIDCIdentityProvider` + `DemoIdentityProvider`, constructed directly. [native/ios/EnterpriseShell/Services/IdentityProvider.swift:43-50, native/ios/EnterpriseShell/Services/IdentityProvider.swift:108-120, native/ios/EnterpriseShell/Services/IdentityProvider.swift:176-200, native/ios/EnterpriseShell/Services/IdentityProvider.swift:240-270, native/ios/EnterpriseShell/Services/IdentityProvider.swift:404-660]

`yagni:` the badge-reader plug-in registry: `HTTPWebhookBadgeReaderProvider` with a no-op `HTTPServer` stub, `MDMBadgeReaderProvider` whose `queryMDMAPI` always throws, `MDMProviderConfig`/`MDMProviderType` (8 vendors), `BadgeReaderType.nfc/.serial` (no provider registered → `createProvider` returns nil), `serialPort/baudRate/webhook*` config fields, `registerProvider`/`availableReaderTypes` (0 external callers). Keep `keyboardWedge`, `bluetoothLE`, `usbAccessory`; a 3-arm `switch` replaces the factory. [native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:1-9, native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:48-56, native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:128-168, native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:213-228, native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:325-454]

`delete:` `ProviderConfigurationService` dead surface — 7 preset `AppConfiguration`s (0 callers), `getConfiguration/updateConfiguration/updateBadgeReader/updateIdentityProvider/getAvailable*Types/getCurrentSetupDescription` (0 callers), and `SecurityConfig`/`BackendConfig` plus 11 `SEC_*`/`CERT_*`/`BACKEND_TIMEOUT` env reads that feed nothing but the uncalled description string (`SecurityManager` and `BackendService` read their own config). Nothing. [native/ios/EnterpriseShell/Services/ProviderConfigurationService.swift:30-64, native/ios/EnterpriseShell/Services/ProviderConfigurationService.swift:143-158, native/ios/EnterpriseShell/Services/ProviderConfigurationService.swift:204-256, native/ios/EnterpriseShell/Services/ProviderConfigurationService.swift:265-393]

`delete:` `native/ios/run-code-analysis.sh` — a 161-line grep re-implementation of the seven `custom_rules` already in `.swiftlint.yml` (hardcoded creds, print, force unwrap, insecure URL, TODO severity, weak delegate); no invoker (not in `ios-ci.yml`, no package script). `swiftlint --config native/ios/.swiftlint.yml`. [native/ios/run-code-analysis.sh:1-161, native/ios/.swiftlint.yml:40-95]

`stdlib:` `dirname(fileURLToPath(import.meta.url))` for repo-root in 136 files (each pulling `fileURLToPath` + `dirname` imports for it alone). `import.meta.dirname` (Node ≥20.11; repo pins 22). [scripts/build-postman.mjs:15, scripts/check-assessor-package.mjs:31, scripts/lib/ci-jobs.mjs:41, scripts/mac/run-requests.mjs:31]

`yagni:` two "delete merged branches" implementations in two languages — `cleanup-merged-branches.sh` (local, which the `.mjs` header says is blocked by the sandbox's destructive-git guard) and `prune-merged-branches.mjs` (runs in Actions where the permission exists). Keep the `.mjs`; drop the `.sh` and the two `branches:*` scripts. [scripts/cleanup-merged-branches.sh:1-132, scripts/prune-merged-branches.mjs:1-20]

`delete:` `scripts/src/level-10-audit.ts` — its only runner, `level-10-audit.yml`, is gone (`docs/PRODUCT_COMPLETION_PLAN.md:379` scheduled its removal); left wired only to `level10:audit` in two package.json files. Nothing (+ remove the two script entries). [scripts/src/level-10-audit.ts:1-102, scripts/package.json:19]

`stdlib:` 13 hand-rolled recursive `walk()`s over `readdirSync`+`statSync`. `readdirSync(dir, { recursive: true })` — already the pattern in this repo. [scripts/check-api-collection.mjs:179-184, scripts/check-decision-palette.mjs:143-148, scripts/check-deployment-runbook.mjs:17-22, scripts/check-retention-claims.mjs:93-97, scripts/check-read-error-swallowing.mjs:44-49, scripts/check-doc-orphans.mjs:60-68, scripts/check-accuracy-doctrine.mjs:149-156, scripts/check-launch-claims.mjs:44-51, scripts/check-module-init-order.mjs:185-193, scripts/check-permission-enforcement.mjs:75-83, scripts/check-assist-conformance.mjs:43-51, scripts/check-verdict-tone-source.mjs:108-125, scripts/check-nan-fail-open.mjs:270-290 → reuse scripts/check-proof-counts.mjs:26]

`shrink:` `scripts/install-firecrawl.mjs` — 69 lines wrapping one `claude mcp add` invocation (the two refusals are "env var unset" and "claude not on PATH", both of which the CLI itself reports). One documented line: `claude mcp add firecrawl --scope user --env FIRECRAWL_API_KEY=$FIRECRAWL_API_KEY -- npx -y firecrawl-mcp@3.24.0`. [scripts/install-firecrawl.mjs:1-69]

`yagni:` the same 6–8 gate commands listed three times — `preflight.mjs` GATES, `build-loop.mjs` GATES, `status-summary.mjs` results — and `runGate()`/`gate()` implemented twice with the same `spawnSync` shape. Export `GATES` and one `runGate` from `preflight.mjs`; the other two `import` and filter. [scripts/build-loop.mjs:40-111, scripts/status-summary.mjs:31-41, scripts/status-summary.mjs:96-102, scripts/preflight.mjs:60-100]

`delete:` `native/ios/setup.sh` — a `brew install xcodegen && xcodegen generate` wrapper whose printed hints are stale (`open ios/EnterpriseShell.xcodeproj`, `-sdk ipados`). CLAUDE.md's `cd native/ios && xcodegen generate && xcodebuild …` one-liner. [native/ios/setup.sh:1-48]

`delete:` the committed `FILES.txt` under `native/ios/SignalGridMobile` — a `find .` listing nothing reads. Nothing. DONE 2026-09-02: deleted, so the path is deliberately not cited here; `git ls-files native/ios/SignalGridMobile` is the answer, and it cannot go stale.

`shrink:` 8 copies of `stripComments` (the 9th, in `generate-core-normalization-version.mjs`, is a real string-aware tokenizer — keep that one and export it). Import it. [scripts/check-api-collection.mjs:57-63, scripts/check-durable-path-authorization.mjs:67, scripts/check-fabricated-status.mjs:65-69, scripts/check-launch-profile.mjs:258-259, scripts/check-read-error-swallowing.mjs:62-66, scripts/check-ungated-fetch.mjs:66, scripts/generate-sync-manifest.mjs:70-72, scripts/review-invariants.mjs:145-151 → scripts/generate-core-normalization-version.mjs:83]

`yagni:` the unsafe-claim denylist maintained in four places, and already drifted: `docs-sanity.mjs` has `"available now"`/`"SOC 2 Type II certified"`, the classifier/phase-gate/phase-pr-report copies do not. One export from `unsafe-claim-classifier.ts`; `docs-sanity.mjs` and the two phase scripts import it. [scripts/docs-sanity.mjs:71-90, scripts/src/unsafe-claim-classifier.ts:55-56, scripts/src/phase-gate.ts:10-12, scripts/src/phase-pr-report.ts:7-8]

`shrink:` `scripts/lib/gate` (proposed) for the per-gate trio copied 6× (`ok`/`bad`), 6× (`read`), 4× (`die`) and the `git ls-files`→`tracked` list in 23 gates. One 12-line module. [scripts/review-invariants.mjs:34-45, scripts/safety-check.mjs:19-24, scripts/check-connector-discipline.mjs:46-47, scripts/check-container-native-base.mjs:73, scripts/check-mcp-surface.mjs:26-27, scripts/check-gate-census.mjs:38, scripts/scan-gaps.mjs:45, scripts/check-surface-ownership.mjs:130, scripts/role-work-queue.mjs:126]

`yagni:` `safety-check.mjs` check 1 (Date.now/Math.random in `lib/signalgrid-core`) is the same regex as `review-invariants.mjs`, which already derives its scope from every `lib/*/src` and only *excludes* the core to defer to this. Drop the exclusion, delete check 1. [scripts/safety-check.mjs:24-35, scripts/review-invariants.mjs:66-80]

`yagni:` `SessionStateManager` conforms to both `BadgeReaderManagerDelegate` and `BadgeReaderProviderDelegate` with identical bodies; the manager is already bridged through `ExternalAccessoryBadgeReaderProvider`. Drop the `BadgeReaderManagerDelegate` conformance (and route `LockedIdleViewController:301` / `:724` through the provider). [native/ios/EnterpriseShell/Services/SessionStateManager.swift:975-989, native/ios/EnterpriseShell/Services/BadgeReaderProvider.swift:523-539]

`shrink:` `native/ios/SignalGridMobile/scripts/generate.sh` — Makefile→sh→`xcodegen generate`. `generate:\n\txcodegen generate` in the Makefile. [native/ios/SignalGridMobile/scripts/generate.sh:1-12, native/ios/SignalGridMobile/Makefile:3-4]

`stdlib:` hand-rolled CRC-32 table + loop for the PNG chunks. `zlib.crc32` (Node ≥22.2). [native/desktop/app/icons/generate-icons.mjs:62-76]

`yagni:` `check-ci-job-timeouts.jobsIn()` re-parses `jobs:` with the same `^ {2}([A-Za-z0-9_-]+):$` scan as `lib/ci-jobs.enumerateCiJobs()`. Import `enumerateCiJobs` and test `timeout-minutes` per job slice. [scripts/check-ci-job-timeouts.mjs:34-48, scripts/lib/ci-jobs.mjs:89-105]

`yagni:` `check-status-figures.counts()` is a comment-admitted mirror of `status-summary.mjs`'s three counts. `export function counts()` from `status-summary.mjs`, import it. [scripts/check-status-figures.mjs:40-48, scripts/status-summary.mjs:86-92]

`delete:` `SecurityManager.configure(with:)` (never called) and the config fields only it could set — `signingAlgorithm`, `requestTimeout`. Nothing. [native/ios/EnterpriseShell/Services/SecurityManager.swift:25-26, native/ios/EnterpriseShell/Services/SecurityManager.swift:51-55]

`shrink:` 5 main-module guards use `import.meta.url.endsWith(process.argv[1].split("/").pop())` (basename-only compare). The `pathToFileURL(process.argv[1]).href` form already in the repo. [scripts/check-assist-wire-served.mjs:127, scripts/check-decision-palette.mjs:436, scripts/check-licence-policy.mjs:255, scripts/check-reason-codes.mjs:88, scripts/check-scheduled-routines.mjs:137 → scripts/mutation-guard.mjs:58]

`stdlib:` ~35 `JSON.stringify(a) === JSON.stringify(b)` determinism/equality checks (key-order-sensitive). `util.isDeepStrictEqual`. [scripts/src/handoff-sim-proof.ts:157-446, scripts/src/grid-coverage-proof.ts:238, scripts/src/fabric-evals-proof.ts:111, scripts/src/iac-proof.ts:89, scripts/src/provisioning-proof.ts:126]

`shrink:` `check-proof-counts` and `check-proof-figures` each `spawnSync("pnpm", ["run", proof])` for overlapping proofs, and preflight/status-summary/build-loop run both — the figure proofs run ≥2× per lane. Parse `summary=… (N/M)` from the run `check-proof-figures` already does; keep one spawner. [scripts/check-proof-counts.mjs:49, scripts/check-proof-figures.mjs:92]

`delete:` `scripts/src/hello.ts` + its `hello` script — scaffolding. Nothing. [scripts/src/hello.ts:1, scripts/package.json:18]

`delete:` (candidate) `scripts/cutover/*.sh` — one-shot Phase-6 migration, no runner; retained only because runbook docs cite the paths, so the docs move to an archive note first or `check-cited-paths` fails. Nothing. [scripts/cutover/00-triage-issues.sh:1-53, scripts/cutover/_env.sh:1-54]

`net: -3,500 lines, -0 deps possible.`

---

**route to normal review** (uncounted, out of scope here):
- `MDMIdentityProvider`/`MDMBadgeReaderProvider`/`DeviceInfo.serialNumber/udid/isSupervised` read MDM identity and supervision from env vars; CLAUDE.md rule 4 says an app cannot obtain these — platform-honesty check. [native/ios/EnterpriseShell/Utilities/DeviceInfo.swift:68-92]
- `HybridIdentityProvider.authenticate` never assigns `primaryProvider`, so `isAuthenticated`/`refreshToken`/`revokeAuthentication` are no-ops after a successful auth. [native/ios/EnterpriseShell/Services/IdentityProvider.swift:589-660]
- The unsafe-claim classifier copy lacks two of `docs-sanity`'s phrases (the availability claim and the SOC 2 certification claim) — `phase-gate`/`phase-pr-report` are weaker than `docs-sanity` on the same claims. [scripts/src/unsafe-claim-classifier.ts:55-56]
- `BadgeReaderProviderFactory.createProvider` returns `nil` for `.nfc`/`.serial`, and `SessionStateManager` proceeds with a nil provider — worth a fail-closed assertion.
- `scripts/check-role-coverage.mjs` contains a non-UTF-8 byte (grep reports it binary); tooling that greps gates will silently skip it.

---

## Execution plan (the "adjust" the owner directed)

Each cut lands as its own gate-green PR, reviewed under `ponytail-review`, in this order:
biggest-and-safest first. A cut that the auditor marked as an owner call is presented as a
decision in its PR body, never applied silently.

1. **Dead code with zero importers** (grep-verified by the auditors): web sections, providers
   with no consumers, one-line re-export shims, orphan accessors/fixtures, `mde.ts`, `emitter.ts`,
   unused ITSM CRUD and webhook plumbing, `normalizeRoute`, `setV1Token`, unused manifest deps.
2. **Unreached vendored shadcn `components/ui`** across the three web apps and the 88 manifest
   entries only they hold alive — `npx shadcn add <x>` restores any one when a screen needs it.
3. **Duplicated helpers → one shared home (rung 2):** the connector report-field parsers
   (~1,050 byte-identical lines), the mock-transport factory, `guardReadOnly` (strict form),
   the Redis bootstrap, `deriveFreshness`, `normalizeSeverity`, `deepFreeze`; in the api-server,
   `evaluateAndPersist` / `durableDecision`, `extractBearer`, the mcp-server helpers.
4. **Owner-call deletions** (presented, not applied): `mockup-sandbox`, `stepUpStore.ts`, the
   ITSM and SIEM vendor halves, `syslog/transport.ts`, the five posture adapters with no composer,
   the simulator/radar routers, the empty deprecation middleware.
5. **Hash-preimage-sensitive item** (`lib/audit` canonicalizer, item 21): needs a ledger-version
   bump, done with the tenant-scoped ledger work, not as a drop-in.

## Routed to normal review (out of Ponytail's scope; forwarded to ECC + independent scan)

Each auditor's own "route to normal review" list, verbatim, so nothing a lens saw is lost between lenses:

- FAIL-OPEN: lib/integrations/src/integrations/network-nac/evaluate.ts:151-156 deriveFreshness lacks the future-skew guard its siblings carry (carrier/evaluate.ts:136, location-services/evaluate.ts:79): a future lastAuthAt reads FRESH. Same class as the integration-bridge fix in #350. Fix: add the guard (future beyond tolerance → unknown) + a regression assertion in proof:network-nac.
- guardReadOnly inconsistency: 8 copies strict `method !== "GET"`, 27 loose `method.toUpperCase() !== "GET"` (accepts "get"). Standardize strict when consolidating (Ponytail item 5).
- Fossil tests: tests/security-reference/*.test.ts import a nonexistent path (@/lib/integrations/webhooks/dispatch); nothing runs them.
- lib/audit/src/index.ts:97-99 escapeJsonString doesn't escape control chars (canonical form not valid JSON for such strings; no collision).
- PLATFORM HONESTY (CLAUDE.md rule 4): iOS MDMIdentityProvider / MDMBadgeReaderProvider / DeviceInfo.serialNumber|udid|isSupervised read MDM identity + supervision from ENV VARS — an app cannot obtain these. [native/ios/EnterpriseShell/Utilities/DeviceInfo.swift:68-92] → native lane.
- BUG: HybridIdentityProvider.authenticate never assigns primaryProvider → isAuthenticated/refreshToken/revokeAuthentication are no-ops after success. [IdentityProvider.swift:589-660] (moot if the yagni cut removes Hybrid).
- Classifier drift: unsafe-claim-classifier.ts lacks two phrases docs-sanity.mjs has (the availability claim and the SOC 2 certification claim) → phase-gate/phase-pr-report weaker than docs-sanity on the same claims. Consolidate to ONE export (Ponytail yagni item) — and that consolidation FIXES the drift.
- Fail-closed assertion wanted: BadgeReaderProviderFactory.createProvider returns nil for .nfc/.serial and SessionStateManager proceeds with a nil provider.
- scripts/check-role-coverage.mjs contains a non-UTF-8 byte (grep treats it as binary; gate-scanning tools silently skip it).

artifacts auditor: monitoring.ts stamps `iso(...) as unknown as Date` into typed fixtures; simulator.ts mints its own requestId so `/simulator/*` responses cannot be correlated with their log line; `/cp/v1/fleet` truncates to 200 with `total` but no cursor; idempotency replay wraps only `res.json`; signalgrid-app ships demo bearer tokens as client-side constants (by design for the demo — a gateway build of the console would carry them).

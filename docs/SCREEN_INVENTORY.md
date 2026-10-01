# Screen inventory and investor demo path

**What this is.** The starting point for a design pass over SignalGrid's web
surfaces: every page file, the surface it belongs to, that surface's launch status,
and what the screen shows — then ONE demo path, written as the screens an investor
sees in order. Filed from the `docs/BUILD_BACKLOG.md` row "Screen inventory and
investor demo-path brief for the operator surfaces". No screen here has had a design
pass yet; choosing who designs is the owner's call.

**What this is not.** Not a launch claim. Status comes from
`scripts/launch-profile.mjs` (the ratified scope, DR-005), and a status here is a
copy of it, never a new decision. A `launch` surface can still hold pages that render
under the console's PREVIEW banner — the Placement column says which.

## How to read the table

- **Status** is the surface's status in `scripts/launch-profile.mjs` (app-surfaces),
  checked against launch profile v7. `launch` is the Limited GA surface; `demo_only`
  exists to demonstrate and must never be presented as shipping product; `deferred`
  and `internal` mean what the profile says they mean. The profile classifies whole
  surfaces, so an admin-console page that is not one of the launch console screens
  reads `launch surface · not a launch screen`: the surface is launch, the page is not.
- **Placement** applies to the admin console (`artifacts/signalgrid-app`) only and is
  read from its route table, `artifacts/signalgrid-app/src/App.tsx`:
  `launch route` is one of the launch console screens bound to the served `/v1` API;
  `preview route (not launch UI)` renders under the "PREVIEW — fixture-backed demo
  surface, not part of the launch console" banner; `404 fallback` is the unmatched-route page;
  `not routed` means no route renders it. Other surfaces show `—`.
- **Shows** is a one-line description written by hand. It is the only column the gate
  cannot re-derive, so it is kept short and literal.

`node scripts/check-screen-inventory.mjs` fails when a tracked
`artifacts/*/src/pages/**/*.tsx` file has no row, when a listed file is gone, when a
Status disagrees with the launch profile, when a Placement disagrees with the
route table, when the route table holds a `<Route>` shape the gate cannot read, or
when demo step 4 stops giving any of the four launch arguments the shell needs with
its exact value (the seeded refs, `sgk_demo_northwind_operator`, and an http(s) URL
written with a literal `localhost`, `127.0.0.1` or `[::1]` host — the shell compares the
host as written, so shorthand forms such as `127.1` do not count). Step 4 is checked
as it renders (markdown-it renders it, an HTML5 parser reads the text a browser
shows), because that is the text an operator copies; keep the four arguments in
their fenced block, one per line. The gate renders with markdown-it while GitHub
uses its own renderer, so the demo section may hold only what both show the same
way: paragraphs, ordered lists, fenced blocks with no language (or `sh`, `bash`,
`text`), and plain, bold, italic or code text. Anything else fails, as do footnotes,
dollar-sign math, bare URLs outside code, and any line that reads as a step number
without being a list item. The section and its step 4 must each appear once. Step 4 is the item a reader sees as 4, so the
steps must be numbered in order.

The gate runs in `scripts/preflight.mjs` and in CI. Only the admin console's route table
(`artifacts/signalgrid-app/src/App.tsx`) is parsed; a router added in another file
would not be seen, and the other surfaces make no placement claim. The gate reads route
elements, not reachability: a `<Route>` inside a branch that never renders (for example
`{false && …}`) still counts as routed.

## Inventory

<!-- screen-inventory:begin -->
| Surface | File | Status | Placement | Shows |
| --- | --- | --- | --- | --- |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/decisions/DecisionList.tsx` | launch | launch route | Sessions — the default screen (`/`, `/sessions`, and the `/decisions` alias): the `/v1` decision ledger, one row per decision with its outcome and assurance label. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/decisions/DecisionDetail.tsx` | launch | launch route | The Decision Envelope for one session: outcome, matched rules, reason codes, the evidence snapshot re-verified on request, and each signal with its source and freshness. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/policies/PolicyList.tsx` | launch | launch route | Versioned policy rule sets with their content digests. Read-only. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/policies/PolicyDetail.tsx` | launch | launch route | One policy: its rules and the pinned policy tests, run server-side. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/settings/Settings.tsx` | launch | launch route | Settings — the entry point to configuration screens (connector setup, assurance, audit). |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Status.tsx` | launch | launch route | Deployment assurance: profile, tier, signal source and engine metrics, all read from the server. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/ConnectorSetup.tsx` | launch | launch route | Microsoft connector setup: the gate checklist, the server-resolved mode, and a fixture sync run with its history. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Audit.tsx` | launch | launch route | The tamper-evident audit chain with every digest recomputed. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Dashboard.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Overview (`/overview`): fixture telemetry tiles plus the live decision panel — the console's one place to run a live `/v1` evaluation from seeded presets. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/policies/PolicyCreate.tsx` | launch surface · not a launch screen | preview route (not launch UI) | New-policy form preview; it states that no served route creates a policy. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/signals/SignalList.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Signal feed on fixture data. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/integrations/IntegrationList.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Integrations catalogue on fixture data. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/integrations/IntegrationDetail.tsx` | launch surface · not a launch screen | preview route (not launch UI) | One integration's vendor detail on fixture data. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Fleet.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Fleet and tenants — control-plane nodes and bundle targets, labelled FIXTURE. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/AppWorkflows.tsx` | launch surface · not a launch screen | preview route (not launch UI) | App workflows — pick an app and see its actions gated by a decision, labelled FIXTURE. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/GridOverview.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Grid overview — links out to the grid capability demos. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Intelligence.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Grid intelligence — exceptions-first operational findings. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Provisioning.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Device recorder — record, validate and replay a provisioning plan, labelled SIMULATED. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/AppResilience.tsx` | launch surface · not a launch screen | preview route (not launch UI) | App resilience — how staff keep working when an application degrades. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/SignalSourcing.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Signal sourcing — which sources feed the grid's coverage. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/GridConfig.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Grid config — the organization's grid expressed as code. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/SystemHealth.tsx` | launch surface · not a launch screen | preview route (not launch UI) | System health — the administrative "just works" summary. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/FacilityGraph.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Facility trust graph — click a space to inspect it. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/not-found.tsx` | launch surface · not a launch screen | 404 fallback | 404 page. |
| signalgrid-review | `artifacts/signalgrid-review/src/pages/ReviewDashboard.tsx` | demo_only | — | The review deck: runs the decision core in the browser with no network so a reviewer can inspect strengths, gaps and open questions offline. |
| signalgrid-review | `artifacts/signalgrid-review/src/pages/not-found.tsx` | demo_only | — | 404 page. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/Dashboard.tsx` | demo_only | — | Desktop overview on fixture data. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/Decisions.tsx` | demo_only | — | Desktop decisions list on fixture data. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/Handoff.tsx` | demo_only | — | Handoff between staff — a static illustrative mock plus fixture decisions; its own label says it is not from the decision core. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/Integrations.tsx` | demo_only | — | Desktop integrations list on fixture data. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/Policies.tsx` | demo_only | — | Desktop policies list on fixture data. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/Signals.tsx` | demo_only | — | Desktop signals list on fixture data. |
| signalgrid-desktop | `artifacts/signalgrid-desktop/src/pages/not-found.tsx` | demo_only | — | 404 page. |
| signalgrid-mobile-pwa | `artifacts/signalgrid-mobile-pwa/src/pages/Overview.tsx` | demo_only | — | Mobile overview tiles on fixture data. |
| signalgrid-mobile-pwa | `artifacts/signalgrid-mobile-pwa/src/pages/Decisions.tsx` | demo_only | — | Mobile decisions list, titled "(fixture)". |
| signalgrid-mobile-pwa | `artifacts/signalgrid-mobile-pwa/src/pages/Signals.tsx` | demo_only | — | Mobile signals list, titled "(fixture)". |
| signalgrid-mobile-pwa | `artifacts/signalgrid-mobile-pwa/src/pages/Integrations.tsx` | demo_only | — | Mobile integrations list, titled "(fixture)". |
| signalgrid-mobile-pwa | `artifacts/signalgrid-mobile-pwa/src/pages/AccessSupport.tsx` | demo_only | — | Access support for a help-desk operator: worker session triage and the guidance to relay. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/Home.tsx` | demo_only | — | Public site home: hero, decision flow, signal types, outcomes, integrations, verticals, deployment. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/About.tsx` | demo_only | — | Public site about page. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/Downloads.tsx` | demo_only | — | App-suite preview, labelled pre-announcement. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/Hardware.tsx` | demo_only | — | Hardware design concepts, labelled as design concepts. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/Federal.tsx` | demo_only | — | Federal posture, labelled pre-announcement; states that no contract vehicle is held. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/Pricing.tsx` | demo_only | — | Indicative pricing. |
| signalgrid-web | `artifacts/signalgrid-web/src/pages/not-found.tsx` | demo_only | — | 404 page. |
<!-- screen-inventory:end -->

Native apps are not in this table: they are not `src/pages` files. The one host app in
the launch profile is `ios:EnterpriseShell`; `ios:WardlinkDemo` is demo-only and
`ios:SignalGridOperator` is deferred.

## The demo path — one decision, console to host app

**This is a fixture demo, not a shipped claim.** It runs against a locally started
api-server on its seeded demo core (the served default is still the demo factory — see
the `non-demo-core-constructor` gap in `scripts/launch-profile.mjs`), with seeded
identities and devices. No customer estate, tenant or real worker is involved.

The embedded-UX law (`docs/EMBEDDED_UX_PRINCIPLE.md`) decides the shape: the investor
sees the admin console because they are looking at the operator's side, and then sees
the worker's side — which is the host app and nothing else. The worker never sees
SignalGrid.

1. **Sessions** (`DecisionList.tsx`, launch route). The console opens on the ledger.
   Say what the investor is looking at: the operator's view of decisions, not
   something a worker will ever open.
2. **Overview → live decision panel** (`Dashboard.tsx`, preview route — the PREVIEW
   banner stays on screen, and that is correct). Pick the "Compliant nurse" preset
   (`nurse.compliant`, `ipad-ward-01`, `med-admin`). The `/v1` core returns an outcome
   with its reason codes, decision id and evidence id. That is the decision.
3. **Decision Envelope** (`DecisionDetail.tsx`, launch route). Open the new session
   from Sessions: outcome, matched rules, reason codes, the re-verified evidence
   snapshot, and every signal with its source and freshness.
4. **The host app** (`ios:EnterpriseShell`, its `HostAppViewController`). Now the
   worker's side. Launch the shell with exactly these four arguments:

   ```
   -DemoBackendIdentity nurse.compliant
   -DemoBackendDevice ipad-ward-01
   -DemoBackendURL http://127.0.0.1:8080
   -DemoBackendToken sgk_demo_northwind_operator
   ```

   The identity and device are the refs the console preset used. The URL is the same
   local api-server, on whatever port it was started with; the shell compares the
   host as written and accepts only `localhost`, `127.0.0.1` or `::1`, ignoring any
   other. The token is the same public fixture key the console uses
   (`artifacts/signalgrid-app/src/lib/v1.ts`), so both sides act in the northwind
   tenant that owns these refs; another tenant's `sgk_demo_*` key would put the
   decision in a different tenant's ledger. All four are needed: without a loopback
   URL and a non-empty token `DecisionServiceProvider.resolve`
   (`native/ios/EnterpriseShell/Services/DecisionService.swift`) picks the on-device
   engine and the shell never calls the api-server. The investor sees the host app's
   own screens: an ordinary action runs with no friction; a sensitive action is held,
   the phone's own Face ID prompt appears, then the app's own confirmation dialog,
   then the action applies. No SignalGrid screen appears on the phone.
   `-DemoAssistAuto` walks these states unattended for a room; `-DemoAssistDecline`
   shows the fail-closed "nothing fires" ending.
5. **Back to Sessions, then Audit** (`Audit.tsx`, launch route). When step 4 reached
   the api-server, the host app's decision is in the ledger and the audit chain
   recomputes its digests. If it is not there, the shell decided on-device (no token,
   or the server did not answer) — say so rather than skip the step.

**Where the supervised iPhone fits, honestly.** The investor story is a host app on a
supervised iPhone, and that step is the one this repository cannot yet show. The
`-Demo*` flags are simulator launch arguments, and `-DemoBackendURL` accepts loopback
hosts only, so step 4 as written runs in the iOS Simulator. A simulator cannot be
MDM-enrolled, so nothing in step 4 demonstrates on-device enforcement. Running the
same step on a supervised iPhone needs the device enrolled through Apple Business
Manager into Fleet, with the control-plane address delivered as managed app
configuration rather than a launch argument — that is a lab task, not a screen, and
until it has run on real hardware the demo says "simulator" out loud.

## What a designer would take from this

The launch console is the launch-route rows above; every preview-route row is fixture
UI a partner may see but must never be told is the product. The host app's screens
belong to the host app's own design language, so a SignalGrid design pass covers the
console and the demo surfaces, not the worker's phone.

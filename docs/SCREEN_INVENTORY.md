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
route table, when the route table holds a `<Route>` shape the gate cannot read or
renders a route some other way (an aliased or namespaced `Route`, `Route` passed to a
function, a `path` or `component` prop on another tag, a page import naming no tracked
file; a directory import is read as its `index.tsx`), or
when demo step 4 stops giving any of the seven launch arguments the shell needs, inside
its fenced command, with its exact value (the demo lifecycle flags, the seeded refs,
`sgk_demo_northwind_operator`, and a plain `http` URL that is an origin only, written with a
literal `localhost`, `127.0.0.1` or `[::1]` host — the shell compares the host as
written, so shorthand forms such as `127.1` do not count). Step 4 is checked
as it renders (markdown-it renders it, an HTML5 parser reads the text a browser
shows), because that is the text an operator copies; keep the seven arguments in
step 4's one fenced block, one per line. The gate renders with markdown-it while GitHub
uses its own renderer, so the demo section may hold only what both show the same
way: paragraphs, ordered lists, fenced blocks with no language (or `sh`, `bash`,
`text`), and plain, bold, italic or code text. Anything else fails, as do footnotes,
dollar-sign math, bare URLs outside code, and any line that reads as a step number
without being a list item. Anywhere in this file, fenced blocks included, the gate
refuses any line shaped like a footnote definition (`[^label]:` after any indentation,
`>` or list marker), whatever follows it: GitHub would let one swallow the lines after
it, the inventory table included. With no definition, a `[^…]` reference renders as
plain text, so no footnote renders. Link reference definitions are refused too, as is a
carriage return that is not part of a CRLF line ending, which GitHub reads as a line
break, and any line that starts with `<` (after any indentation, `>` or list marker)
other than the two inventory markers: GitHub and the gate's renderer disagree on which
tags open an HTML block, and an open one hides every line after it up to the next blank,
the inventory table included. The file may not start with a byte-order mark either,
because GitHub drops it before reading the first line and the gate does not, nor with a
`---` line, which GitHub reads as YAML front matter and renders outside markdown.
The file must be valid UTF-8, because a decoder would otherwise replace a bad byte
unseen. No line may hold an ASCII control character other than a tab: GitHub reads a form feed
or vertical tab as a space in a table's delimiter row and the gate's renderer does not,
so GitHub could build a table the gate never counted and split a code span across its
cells.
Nor may it hold a space character outside ASCII (a no-break space, an ideographic space,
a line or paragraph separator and the like): the gate's renderer trims those off a table
row and GitHub does not, so the two can count a table's columns differently. A run of
two or more backticks is allowed only as a code fence line (three backticks alone, or
followed by a language name): an unmatched longer run elsewhere in a paragraph changes
which single backticks GitHub pairs into code spans.
A line that follows a blockquote line must itself start with `>` or be blank: GitHub
can read an unquoted (lazy) continuation line as a table header and the gate's renderer
does not.
No line outside the inventory block may hold a pipe character at all, in prose, code
spans or code blocks alike: every table GitHub builds needs one on its header row, and
rounds of review kept finding container and indentation shapes (a quote at the wrong
depth, a header indented four spaces, a list item over an indented delimiter row) where
GitHub builds a table that the gate's renderer never sees.
Between the begin and end markers the block may hold only the header row, the
delimiter row and page rows, one per line: no blank, text, comment or pipe-only line,
because GitHub may end the table at one while the gate's renderer continues it. A page
row may not contain `<` at all, even in a code span, because raw HTML in a cell such as
an end-of-table tag passes through to the browser and ends the table there. Anywhere
else in the file, `<` may appear only inside a code span written with one backtick on
each side, opened and closed on the same line, with no pipe character inside, whose opening backtick
follows an ASCII space or tab, a `(` or the start of the line and does not touch a web
address (GitHub links an address together with a backtick that touches it, through any
other kind of space); not in a code block,
not in a longer backtick run, and an entity or escape that renders as `<` counts too. A
tag in prose, mid-line included, can hide, collapse or cut the table once a browser parses
the page, and the renderers disagree on longer code spans. The inventory is the only
table in the file. Blocks may nest at most 16 levels as the gate's renderer counts them (a
list level counts twice), because past its own nesting limit it stops reading what GitHub
still shows. The
table must render as one table showing every row the source lists. The section and
its step 4 must each appear once. Step 4 is the item a reader sees as 4, so the steps
must be numbered in order.

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
| signalgrid-app | `artifacts/signalgrid-app/src/pages/policies/PolicyList.tsx` | launch | launch route | Versioned policy rule sets. Read-only. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/policies/PolicyDetail.tsx` | launch | launch route | One policy: its rules, each version's content digest, and the pinned policy tests, run server-side. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/settings/Settings.tsx` | launch | launch route | Settings — the entry point to configuration screens (connector setup, assurance, audit). |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Status.tsx` | launch | launch route | Deployment assurance: profile, tier, signal source and engine metrics, all read from the server. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/ConnectorSetup.tsx` | launch | launch route | Microsoft connector setup: the gate checklist, the server-resolved mode, and a fixture sync run with its history. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Audit.tsx` | launch | launch route | The tamper-evident audit chain with every digest recomputed. |
| signalgrid-app | `artifacts/signalgrid-app/src/pages/Dashboard.tsx` | launch surface · not a launch screen | preview route (not launch UI) | Overview (`/overview`): fixture telemetry tiles plus the live decision panel, which runs a live `/v1` evaluation from seeded presets. |
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

## The demo path — two decisions, console to host app

**This is a fixture demo, not a shipped claim.** It runs against a locally started
api-server on its seeded in-memory demo core, started without `DATABASE_URL` (the
served default is still the demo factory — see the `non-demo-core-constructor` gap in
`scripts/launch-profile.mjs`), with seeded identities and devices. No customer estate,
tenant or real worker is involved.

The embedded-UX law (`docs/EMBEDDED_UX_PRINCIPLE.md`) decides the shape: the investor
sees the admin console because they are looking at the operator's side, and then sees
the worker's side — which is the host app and nothing else. The worker never sees
SignalGrid. Two decisions are made on the way, and the demo says so: steps 2 and 3 show
the one the operator asks the console for; step 4 makes the host app's own, on its own
workflow; step 5 proves that second one reached the ledger.

1. **Sessions** (`DecisionList.tsx`, launch route). The console opens on the ledger.
   Say what the investor is looking at: the operator's view of decisions, not
   something a worker will ever open.
2. **Overview → live decision panel** (`Dashboard.tsx`, preview route — the PREVIEW
   banner stays on screen, and that is correct). Pick the "Compliant nurse" preset
   (`nurse.compliant`, `ipad-ward-01`, `med-admin`). The `/v1` core returns an outcome
   with its reason codes, decision id and evidence id. That is the console's decision.
3. **Decision Envelope** (`DecisionDetail.tsx`, launch route). Open that decision from
   Sessions: outcome, matched rules, reason codes, the re-verified evidence snapshot,
   and every signal with its source and freshness.
4. **The host app** (`ios:EnterpriseShell`, its `HostAppViewController`). Now the
   worker's side. Launch the shell in the simulator with these seven arguments:

   ```
   -DemoMode YES
   -SimulateBadge 04A3F291
   -DemoAssist YES
   -DemoBackendIdentity nurse.compliant
   -DemoBackendDevice ipad-ward-01
   -DemoBackendURL http://127.0.0.1:8080
   -DemoBackendToken sgk_demo_northwind_operator
   ```

   The first three run the shell's own session
   (`native/ios/EnterpriseShell/Services/DemoMode.swift`). `-DemoMode YES` answers
   session start from the canned demo backend, and `-SimulateBadge 04A3F291` injects
   the badge scan the simulator has no reader for; without both, the shell does not
   get past its lock screen. `-DemoAssist YES` opens the host app once the session is
   active (if it does not open, or a "Device still locked" alert is showing because a
   simulator cannot release Single App Mode, dismiss the alert and tap the Host App
   tile). Through `native/ios/run-ios.sh`, `LAUNCH_ARGS` replaces the script's
   default `-DemoMode YES -SimulateBadge 04A3F291` line, so put all seven in it.

   The last four decide where the verdict comes from. The identity and device are the
   refs the console preset used. The URL is the local api-server's origin, on
   whatever port it was started with, and nothing after it, because the shell appends
   `api/v1/app-workflows/evaluate` itself; the shell compares the host as written and accepts only
   `localhost`, `127.0.0.1` or `::1`, ignoring any other. The token is the same
   public fixture key the console uses (`artifacts/signalgrid-app/src/lib/v1.ts`), so
   both sides act in the northwind tenant that owns these refs; another tenant's
   `sgk_demo_*` key would put the decision in a different tenant's ledger. All four
   are needed: without a loopback URL and a non-empty token
   `DecisionServiceProvider.resolve`
   (`native/ios/EnterpriseShell/Services/DecisionService.swift`) picks the on-device
   engine and the shell never calls the api-server.

   With these refs the core answers allow (reason `TRUST_ESTABLISHED`), and that
   decides what the investor sees in the host app's own screens. Open chart and View
   lab results run with no friction. Place controlled med order is held for the
   app's own confirmation dialog and nothing else: no Face ID prompt and no
   simulated sheet appears, because the grid already trusts this nurse on this iPad.
   After the worker confirms, the action applies. In the manual flow no SignalGrid
   screen appears on the phone. The simulator build has one exception: a "Behind the
   glass" operator panel, which the eye button in the host app's top bar shows by hand
   and the Auto walk below reveals on its own. Both of those reveal paths are compiled
   out of device builds, so on a device the panel can never be shown.

   To show the step-up gate instead, add `-DemoSignal stale`. That injects a stale
   device check-in on the phone, and the shell takes the stricter of the control
   plane's allow and its own check, so the verdict becomes step_up
   (`LOCAL_RISK_CLAMP`) and every gated action, Open chart and View lab results
   included, is held for the phone's own authenticator: Face ID, or on a simulator
   with no passcode and no enrolled Face ID the labelled "Demo · simulated
   authenticator" sheet. For the order, the app's own confirmation follows. Say that
   the stale check-in is injected, because it is.

   `-DemoAssistAuto` walks either flow unattended for a room (in the step-up flow the
   walker satisfies the step-up, so no sheet appears); `-DemoAssistDecline` shows the
   fail-closed "nothing fires" ending.
5. **Back to Sessions, then Audit** (`Audit.tsx`, launch route). The host app's call
   is a second decision, not step 2's: workflow `clinical-session`, with its own
   decision id. In Sessions it is one more row at the bottom (rows run oldest first
   and the demo clock is fixed, so every row carries the same time). The api-server
   also mints a `clinical-session` row for this same nurse and iPad when it boots, so
   finding such a row proves nothing. Audit does prove it: read the banner's event
   count before step 4 and again after (the page refreshes every 30 seconds). When
   step 4 reached the api-server the count rises by two: the top row is a
   `decision.evaluated` event for `nurse.compliant` on `ipad-ward-01` (hover the
   Summary for the workflow), the row under it is its `evidence.captured`, and every
   digest is recomputed. If the count did not move, the shell decided on-device (no
   token, or the server did not answer; with clean local signals an unanswered call
   reads as step_up with `REMOTE_UNAVAILABLE_STEP_UP`) — say so rather than skip the
   step.

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

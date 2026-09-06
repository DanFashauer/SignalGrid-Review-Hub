# Repo presentation proposals — descriptions, topics, homepages

> **What this file is.** The estate audit (ESTATE_SYNC_REPORT.md §4) found three
> of the six repositories in that table describing themselves with their own name repeated (four, counting one that repeats "SignalGrid" inside a different string), two
> homepages pointing at replit.com, and zero topics anywhere. The App cannot
> edit repository metadata, so these are ready-to-paste proposals — one block
> per repository. Applying each takes under a minute from any browser, phone
> included: open the repo on github.com → tap the **⚙️ gear** next to "About"
> (on mobile: "About" then Edit) → paste → Save changes.
>
> Everything below follows the standing guardrails: no production claims, no
> MDM-replacement claims; connectors are described as evidence-only.

---

## SignalGrid-Review-Hub (public)

- **Description:**
  > Public review surface for SignalGrid — a deterministic, fixture-backed Assist gate for shared frontline devices. Decision core, read-only connector families, /v1 API, operator console, and the proof harness that keeps every claim measured.
- **Website:** `https://danfashauer.github.io/SignalGrid-Review-Hub/`
  (replaces the replit.com link; goes live once the Pages deployment-branch
  setting clears — open item 2 in the estate report. Until then it renders the
  README, which is still better than Replit.)
- **Topics:** `device-trust` `zero-trust` `shared-devices` `frontline`
  `mdm` `typescript` `deterministic-testing`

## signalgrid-mcp (public)

- **Description:**
  > Read-only macOS posture MCP server (Python) for SignalGrid — 22 tools reporting users, MDM enrollment, screen lock, system extensions, removable media and more as evidence. Observes only; never changes device state.
- **Website:** leave empty (or point at the Review-Hub Pages site once live).
- **Topics:** `mcp` `macos` `device-posture` `python` `read-only`

## SignalGrid (private)

- **Description:**
  > Private core for SignalGrid — the trust layer that reads MDM, identity, device, workflow, and local-authority evidence to decide whether work should continue on shared frontline devices.
- **Website:** **remove the replit.com link** (leave empty).
- **Topics:** private repos show topics only to collaborators — optional.

## signalgrid-inspiration (private)

- **Description:**
  > Intake source material for SignalGrid — posters, catalogs, and research that feed the intake ledger in SignalGrid-Review-Hub.

## DEV (public)

- **Description:**
  > Early SignalGrid alpha lineage. Historical; superseded by SignalGrid-Review-Hub.
- **Recommendation beyond the description:** this is the repo the estate report
  called "the loudest and least representative artifact" — 99 mostly-stale
  branches, public, described as "Home". The description above is the
  minimum fix; **archiving it** (Settings → scroll to Danger Zone → Archive
  this repository) is the better one: archiving is non-destructive and
  reversible, freezes it read-only with an "Archive" banner, and instantly
  stops it misrepresenting the account. Branch pruning inside it then becomes
  optional. (Making it private is the third option; archive is recommended
  because the history is honest work, just finished.)

## VaultLens (public)

- **No change.** The audit found it is the only repo whose description was
  written for a reader. Optionally add topics: `ios` `collectibles` `swift`.

## fleet (public fork)

- **Description:**
  > Fork of fleetdm/fleet — the open-source MDM SignalGrid uses as its low-cost engineering lab. Tracking upstream; no SignalGrid changes.
- Forks display "forked from fleetdm/fleet" automatically; the description
  just explains *why* it is here.

---

## Order that pays off fastest

1. **Profile README** (see `PROFILE_README_DRAFT.md`) — the account's front door.
2. **SignalGrid-Review-Hub** description/topics/homepage — the repo people
   actually land on.
3. **Archive DEV** — removes the biggest negative signal in one click.
4. The rest as convenient.

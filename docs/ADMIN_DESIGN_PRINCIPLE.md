# Design law: the admin console "just works"

The end-user experience is invisible (`docs/EMBEDDED_UX_PRINCIPLE.md`). The
**admin** experience has its own law, inspired by the Apple ecosystem — hardware
and software in harmony, nothing extraneous, it just works. Every administrative
surface (console, dashboards, reports, the flow-config UI) is measured against
it.

## The rules

1. **Progressive disclosure — if it isn't needed, don't show it.** The default
   view shows the few things that matter *now*; depth is one tap away, never in
   your face. A screen that shows everything shows nothing.

2. **Only necessary data.** Each surface earns every element. No vanity metrics,
   no duplicated numbers, no fields "just in case." If a value doesn't change a
   decision the admin is about to make, it doesn't belong on that screen.

3. **One source of truth.** The same number means the same thing everywhere. A
   flow's health, a decision's outcome, a device's posture — read once from the
   core/control-plane, shown identically on every surface. No screen recomputes
   or reinterprets; if two places could disagree, one of them is wrong.

4. **Consistency is the interface.** The same object looks and behaves the same
   across the console, mobile, and the macOS/Windows desktop. An outcome badge,
   an approval chip, a health dot — one vocabulary, learned once.

5. **Calm by default, decisive on exception.** Healthy state is quiet. The UI
   raises its voice only for the thing that needs a human — a broken flow, a
   held action, a recommendation worth acting on — and makes the next step
   obvious.

6. **The Grid does the thinking.** Admins configure signals + flows and review
   recommendations; they don't assemble dashboards or hunt through logs. The
   product surfaces the answer, not the raw material. (See
   `docs/ADMIN_FLOWS.md`, `@workspace/recommendations`.)

## The test for any admin surface

> Could a busy administrator glance at this and know, in one look, whether
> anything needs them — and if so, exactly what to do next? Is every element on
> screen load-bearing, and does every number match its single source of truth?
> If not, remove, defer, or reconcile until the answer is yes.

## Applied
- The Fleet page leads with a four-tile rollup; per-vertical, per-tenant, and
  ops-intelligence detail sit below, not on top.
- The App-workflows page shows the catalog and one live gated plan — not every
  action of every app at once.
- Recommendations arrive ranked by confidence with a one-line rationale and a
  single suggested change — the admin decides; the UI doesn't nag.

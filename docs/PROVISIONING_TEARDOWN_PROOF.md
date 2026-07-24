# Teardown-proof — prove the retreat before you trust the deploy

Anyone can push software to a fleet of Macs. Taking it cleanly back off is the hard, under-invested half — and it is where a rollout turns into a gamble.

On macOS an installed security agent is not one thing. It is a **system extension**, a **PPPC/TCC allow profile**, **launch daemons**, and an **app bundle** — coupled parts that must come apart in the *right order*. Delete the app from a script and the extension can stay active. Remove the allow profile while the extension is live and you strand a "deactivated but not removed" extension that blocks its own reinstall. Apple's `RemovableSystemExtensions` covers one deactivation step; it does not clean up the rest.

SignalGrid's zero-touch provisioning records a device setup once and replays it ([Open orchestration vision](OPEN_ORCHESTRATION_VISION.md)). **Teardown-proof** makes the *reversal* a first-class, validated artifact: a recording is not deploy-ready until its decommission path is recorded and **proven** — dependency-ordered, fail-safe, and approval-gated — so the retreat is confirmed *before* 560 Macs are waiting on it, not during an incident.

Built in `lib/flows/src/provisioning-teardown.ts`; proven fully offline by `pnpm run proof:provisioning-teardown` (20 checks).

## The deploy-readiness gate

```
deployReady(recording)  ⇔  setupRecordingValid(recording)  AND  teardownProven(recording)
```

A valid setup with no proven reversal is **not** deploy-ready. This is the thesis, expressed as a gate the pipeline enforces (like config validation blocking a merge).

## What "proven" requires (fail-safe — each is an ERROR)

- **Every setup step is reversed.** A step with no teardown would be left behind (`setup_step_unreversed`).
- **The agent/extension is *deactivated*, not merely deleted** (`extension_not_deactivated`) — deleting the app leaves the extension active — **and the restart is acknowledged** (`extension_restart_unacknowledged`), because deactivation only completes after a restart-state check.
- **Reverse-dependency order.** The authorization/allow `profile` is torn down **last** and the extension **first**; removing the allow profile before the component it authorized strands that component (`teardown_order_violation`). Enforced via a canonical `TEARDOWN_ORDER` (app_install → restriction → policy → account → cert → wifi → profile).
- **A clean-state verification** that nothing stayed registered (`teardown_no_verify`) — a leftover extension blocks reinstall, so a teardown that never checks is not proven.

## Rehearse the rollback (simulated by default)

`planTeardown(recording, device)` produces a decommission plan with the same non-negotiable safety boundary as the apply side:

- An **unproven** teardown is never executed (`proven: false`, zero steps).
- **Simulated by default** — every step is `held_simulated` (a dry-run rehearsal); nothing is removed for real.
- Real removal happens **only** when an owner sets `enforcementEnabled: true` *and* asks for `enforced` mode. Even then a **sensitive** removal is `approval_required`, never automatic.
- Steps run in the authored **dependency order**, ending with the clean-state check.

So you can rehearse the exact retreat — the extension deactivation, the restart hold, the ordered removals, the "nothing left registered" check — and see it is safe, without touching a device. Boring is the goal; boring means the failure modes were handled before they went live.

## Boundary

This is the deterministic core (record → validate → **prove reversal** → rehearse), not a live MDM/Jamf action path. SignalGrid does not enact removals here; real enforcement is owner-gated and out of scope for this review surface. No partnership, certification, or production-remediation claim. Not legal advice.

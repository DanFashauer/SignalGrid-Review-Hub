import React, { useState } from "react";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { LifeBuoy, ChevronRight } from "lucide-react";

/**
 * Access support — an OPERATOR / support-desk surface of the SignalGrid mobile
 * app (iOS/Android via PWA). A support lead or floor supervisor looks at a
 * worker's session here to see why it was allowed, stepped up, or restricted,
 * and the plain-language guidance to relay to that worker.
 *
 * This is deliberately NOT a worker destination. Per docs/EMBEDDED_UX_PRINCIPLE.md
 * the end user never opens a SignalGrid app: the worker's own resolution happens
 * invisibly inside their host app (re-dock refreshes posture, a native step-up
 * re-verifies identity). This view is the operator's window into that flow, not
 * the worker's — so it relays guidance rather than executing anything.
 *
 * Public-safe and self-contained: deterministic demo scenarios that mirror the
 * decision core's worker view. No live decision call, credential, or production
 * action is involved; every step is guidance, never an executed change.
 */

type Outcome = "allow" | "step-up" | "restrict";

interface AccessScenario {
  id: string;
  device: string;
  worker: string;
  workflow: string;
  outcome: Outcome;
  reason: string;
  /** Guidance the operator relays; the worker's host app carries it out. */
  steps: string[];
  /** True when the worker can resolve it on their device without an operator. */
  selfResolving: boolean;
}

const SCENARIOS: AccessScenario[] = [
  {
    id: "ok",
    device: "Ward iPad 01",
    worker: "Alex R. · Nurse",
    workflow: "Clinical session",
    outcome: "allow",
    reason: "Identity, device, and security baseline are all healthy and fresh.",
    steps: [],
    selfResolving: true,
  },
  {
    id: "stale",
    device: "Ward iPad 03",
    worker: "Priya S. · Nurse",
    workflow: "Clinical session",
    outcome: "step-up",
    reason: "This device's compliance check is stale, so the host app asks for extra verification first.",
    steps: [
      "Have the worker reconnect the device (or return it to its dock) to refresh its compliance check.",
      "The host app re-verifies identity with a native step-up if needed.",
      "The session continues in place — no SignalGrid screen for the worker.",
    ],
    selfResolving: true,
  },
  {
    id: "baseline",
    device: "Ward iPad 06",
    worker: "Jordan M. · Tech",
    workflow: "Clinical session",
    outcome: "step-up",
    reason: "This device has drifted from its security (CIS/hardening) baseline.",
    steps: [
      "Have the worker return the device to its dock so the hardening profile re-applies.",
      "The baseline re-aligns automatically (usually under a minute).",
      "The session continues once posture is fresh.",
    ],
    selfResolving: true,
  },
  {
    id: "overdue",
    device: "Loaner iPad 01",
    worker: "Sam T. · Nurse",
    workflow: "Clinical session",
    outcome: "restrict",
    reason: "This loaner is overdue for return, so it's restricted until it's checked back in.",
    steps: [
      "Route the worker to a checked-in device for their session.",
      "The loaner clears its restriction once it's returned to a dock or bay.",
    ],
    selfResolving: false,
  },
];

export default function AccessSupport() {
  const [openId, setOpenId] = useState<string | null>("baseline");

  return (
    <div className="h-full w-full flex flex-col scroll-area p-4 space-y-5 pt-safe">
      <header className="flex items-center gap-2 pt-2">
        <LifeBuoy className="text-primary" size={22} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Access support</h1>
          <p className="text-sm text-muted-foreground">Worker session triage · relay guidance</p>
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <p className="font-mono text-[11px] tracking-widest text-primary">SIGNAL → GUIDANCE TO RELAY</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap a worker's session to see the signal, the call, and the guidance to
          relay. The worker never opens SignalGrid — their resolution happens inside
          their own app, invisibly.
        </p>
      </div>

      <div className="space-y-3">
        {SCENARIOS.map((s) => {
          const open = openId === s.id;
          return (
            <div key={s.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenId(open ? null : s.id)}
                className="w-full flex items-center justify-between p-4 text-left active:scale-[0.99] transition-transform"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.device}</span>
                    <OutcomeBadge outcome={s.outcome} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.worker} · {s.workflow}</p>
                </div>
                <ChevronRight
                  size={18}
                  className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                />
              </button>

              {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  <p className="text-sm">{s.reason}</p>

                  {s.steps.length === 0 ? (
                    <p className="text-sm text-green-400">
                      Nothing to relay — the session is running normally.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {s.selfResolving ? "Resolves on the worker's device" : "Needs an operator"}
                      </p>
                      <ol className="space-y-2">
                        {s.steps.map((step, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">
                              {i + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 pt-1">
        Operator/support view · deterministic scenarios · no live decision call or
        production action. The worker's resolution happens in their host app.
      </p>
    </div>
  );
}

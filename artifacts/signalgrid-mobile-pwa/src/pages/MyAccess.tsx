import React, { useState } from "react";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { ShieldCheck, RotateCcw, ChevronRight } from "lucide-react";

/**
 * My Access — the end-user (frontline worker) surface of the SignalGrid mobile
 * app (iOS/Android via PWA). It shows a worker why a session was allowed,
 * stepped up, or restricted, and the plain-language self-service steps to
 * resolve a block themselves — including re-applying a drifted security
 * (CIS/hardening) baseline.
 *
 * Public-safe and self-contained: this surface renders deterministic demo
 * scenarios that mirror the SignalGrid decision core's worker view. No live
 * decision call, credential, or production action is involved; every step is a
 * self-service instruction, never an executed change.
 */

type Outcome = "allow" | "step-up" | "restrict";

interface AccessScenario {
  id: string;
  device: string;
  workflow: string;
  outcome: Outcome;
  reason: string;
  steps: string[];
  /** True when following the steps and retrying is expected to reach allow. */
  selfService: boolean;
}

const SCENARIOS: AccessScenario[] = [
  {
    id: "ok",
    device: "Ward iPad 01",
    workflow: "Clinical session",
    outcome: "allow",
    reason: "Your identity, device, and security baseline are all healthy and fresh.",
    steps: [],
    selfService: true,
  },
  {
    id: "stale",
    device: "Ward iPad 03",
    workflow: "Clinical session",
    outcome: "step-up",
    reason: "This device's compliance check is stale, so extra verification is needed first.",
    steps: [
      "Reconnect the device (or return it to its dock) to refresh its compliance check.",
      "Re-verify your identity if prompted.",
      "Retry the session.",
    ],
    selfService: true,
  },
  {
    id: "baseline",
    device: "Ward iPad 06",
    workflow: "Clinical session",
    outcome: "step-up",
    reason: "This device has drifted from its security (CIS/hardening) baseline.",
    steps: [
      "Return the device to its dock or reconnect it so the hardening profile re-applies.",
      "Wait for the baseline to re-align (usually under a minute).",
      "Retry the session.",
    ],
    selfService: true,
  },
  {
    id: "overdue",
    device: "Loaner iPad 01",
    workflow: "Clinical session",
    outcome: "restrict",
    reason: "This loaner is overdue for return, so it's restricted until it's checked back in.",
    steps: [
      "Return the device to its dock or bay to check it back in.",
      "Pick up a checked-in device for your session, or retry after check-in.",
    ],
    selfService: true,
  },
];

export default function MyAccess() {
  const [openId, setOpenId] = useState<string | null>("baseline");

  return (
    <div className="h-full w-full flex flex-col scroll-area p-4 space-y-5 pt-safe">
      <header className="flex items-center gap-2 pt-2">
        <ShieldCheck className="text-primary" size={22} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Access</h1>
          <p className="text-sm text-muted-foreground">Alex R. · Nurse</p>
        </div>
      </header>

      <p className="text-sm text-muted-foreground">
        Tap a session to see why it was allowed or held, and the steps to fix it
        yourself. Every step is self-service — nothing is changed for you.
      </p>

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
                  <p className="text-xs text-muted-foreground mt-0.5">{s.workflow}</p>
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
                      You're good to go — no action needed.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {s.selfService ? "Fix it yourself" : "Needs an operator"}
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
                      {s.selfService && (
                        <button className="mt-2 w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-primary/15 text-primary text-sm font-medium active:scale-[0.99] transition-transform">
                          <RotateCcw size={15} />
                          Retry after these steps
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 pt-1">
        Demo view · deterministic scenarios · no live decision call or production
        action.
      </p>
    </div>
  );
}

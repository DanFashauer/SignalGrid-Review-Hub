import React from "react";
import { ListDecisionsOutcome } from "@workspace/api-client-react";

export function OutcomeBadge({ outcome }: { outcome: string }) {
  let colors = "text-zinc-500 bg-zinc-500/10 border-zinc-500/20";
  
  if (outcome === ListDecisionsOutcome.allow) {
    colors = "bg-status-allow";
  } else if (outcome === ListDecisionsOutcome["step-up"]) {
    colors = "bg-status-step-up";
  } else if (outcome === ListDecisionsOutcome.restrict) {
    colors = "bg-status-restrict";
  } else if (outcome === ListDecisionsOutcome.deny) {
    colors = "bg-status-deny";
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider ${colors}`}>
      {outcome.replace("-", " ")}
    </span>
  );
}

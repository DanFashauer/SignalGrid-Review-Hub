import React from "react";
import { ListDecisionsOutcome } from "@workspace/api-client-react";

export function OutcomeBadge({ outcome }: { outcome: string }) {
  let colors = "text-zinc-500 bg-zinc-500/10 border-zinc-500/20";
  
  if (outcome === ListDecisionsOutcome.allow) {
    colors = "text-green-400 bg-green-400/10 border-green-400/20";
  } else if (outcome === ListDecisionsOutcome["step-up"]) {
    colors = "text-amber-400 bg-amber-400/10 border-amber-400/20";
  } else if (outcome === ListDecisionsOutcome.restrict) {
    colors = "text-orange-400 bg-orange-400/10 border-orange-400/20";
  } else if (outcome === ListDecisionsOutcome.deny) {
    colors = "text-red-400 bg-red-400/10 border-red-400/20";
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider ${colors}`}>
      {outcome.replace("-", " ")}
    </span>
  );
}

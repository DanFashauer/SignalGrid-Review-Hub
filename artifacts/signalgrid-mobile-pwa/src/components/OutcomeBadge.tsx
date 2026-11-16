import React from "react";
import { outcomeBadgeTone } from "@/lib/outcome-tone";

// The verdict→tone decision is made in lib/outcome-tone.ts, not here. This
// component used to seed a neutral grey and overwrite it per known verdict, so
// an unrecognised verdict rendered as the least visible badge on the page.
export function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider ${outcomeBadgeTone(outcome)}`}>
      {outcome.replace("-", " ")}
    </span>
  );
}

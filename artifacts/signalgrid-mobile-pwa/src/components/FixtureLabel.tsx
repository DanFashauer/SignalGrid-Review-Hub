import React from "react";

/**
 * The one qualifier every fixture-backed figure in this app carries (backlog row
 * 115). The control plane's monitoring routes serve synthetic fixtures, and
 * "Allow Rate 94.2%" with no qualifier reads as a claim about a deployment —
 * this is the surface most likely to be held up in a room.
 *
 * `scripts/check-pwa-fixture-labels.mjs` fails any page that reads the control
 * plane without rendering this, and any bottom sheet on such a page without it.
 */
export function FixtureLabel({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-muted-foreground ${className}`} data-fixture-label>
      Fixture data · synthetic, not from a deployment
    </p>
  );
}

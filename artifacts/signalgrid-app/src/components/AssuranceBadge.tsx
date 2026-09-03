import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { getContextV1 } from "@/lib/v1";

/**
 * The assurance label (P0: demo / pilot / production, everywhere a verdict
 * appears). Reads the deployment's own `/v1/context` posture — derived
 * server-side on every call from tier + live-integration flags — so the label
 * states what these verdicts ARE (fixture-backed vs live-signal, advisory)
 * instead of leaving the reader to assume. `assurance.ts` names unlabeled
 * consoles as an open defect; this component is the closure.
 */
export function AssuranceBadge() {
  const { data, isError } = useQuery({ queryKey: ["v1-context"], queryFn: getContextV1, staleTime: 60_000 });
  // Fail-closed rendering: a failed or still-pending /v1/context must NOT drop the
  // qualifier (returning null once removed it from six screens, leaving the verdict
  // reading as trusted). Render a distinct unverified/unknown state instead — muted,
  // never the "live signals" green — so an unread posture can never look confirmed.
  if (!data) {
    return (
      <Badge
        variant="outline"
        className="ml-2 font-mono uppercase text-[10px] align-middle bg-signal-unknown border-transparent"
        title={
          isError
            ? "GET /v1/context failed — the deployment's assurance posture could not be read"
            : "resolving assurance posture from /v1/context…"
        }
      >
        {isError ? "posture unverified" : "posture…"} · advisory
      </Badge>
    );
  }
  const a = data.assurance;
  const fixture = a.signalSource === "fixtures";
  return (
    <Badge
      variant="outline"
      className={`ml-2 font-mono uppercase text-[10px] align-middle ${fixture ? "bg-signal-unknown" : "bg-signal-nominal"} border-transparent`}
      title={`profile=${a.profile} · tier=${a.tier} · signals=${a.signalSource} · verdicts are ${a.verdictEffect}`}
    >
      {fixture ? "fixture-backed demo" : "live signals"} · advisory
    </Badge>
  );
}

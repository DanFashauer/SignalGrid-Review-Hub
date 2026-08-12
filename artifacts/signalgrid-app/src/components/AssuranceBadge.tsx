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
  const { data } = useQuery({ queryKey: ["v1-context"], queryFn: getContextV1, staleTime: 60_000 });
  if (!data) return null;
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

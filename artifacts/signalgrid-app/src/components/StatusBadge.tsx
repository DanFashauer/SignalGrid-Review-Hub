import React from "react";
import { Badge } from "@/components/ui/badge";

export function OutcomeBadge({ outcome }: { outcome: string }) {
  switch (outcome) {
    case "allow":
      return <Badge variant="outline" className="bg-status-allow border-transparent font-mono uppercase">Allow</Badge>;
    case "step-up":
    case "step_up": // the /v1 core's spelling; the fixtures client says "step-up"
      return <Badge variant="outline" className="bg-status-step-up border-transparent font-mono uppercase">Step-Up</Badge>;
    case "restrict":
      return <Badge variant="outline" className="bg-status-restrict border-transparent font-mono uppercase">Restrict</Badge>;
    case "deny":
      return <Badge variant="outline" className="bg-status-deny border-transparent font-mono uppercase">Deny</Badge>;
    default:
      return <Badge variant="outline" className="font-mono uppercase">{outcome}</Badge>;
  }
}

export function SignalStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "nominal":
      return <Badge variant="outline" className="bg-signal-nominal border-transparent font-mono uppercase">Nominal</Badge>;
    case "anomalous":
      return <Badge variant="outline" className="bg-signal-anomalous border-transparent font-mono uppercase">Anomalous</Badge>;
    case "critical":
      return <Badge variant="outline" className="bg-signal-critical border-transparent font-mono uppercase">Critical</Badge>;
    case "unknown":
    default:
      return <Badge variant="outline" className="bg-signal-unknown border-transparent font-mono uppercase">Unknown</Badge>;
  }
}

export function IntegrationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return <Badge variant="outline" className="bg-signal-nominal border-transparent font-mono uppercase">Connected</Badge>;
    case "degraded":
      return <Badge variant="outline" className="bg-signal-anomalous border-transparent font-mono uppercase">Degraded</Badge>;
    case "disconnected":
    case "not-configured":
      return <Badge variant="outline" className="bg-signal-unknown border-transparent font-mono uppercase">Not Configured</Badge>;
    default:
      return <Badge variant="outline" className="font-mono uppercase">{status}</Badge>;
  }
}

import React from "react";
import { useParams, Link } from "wouter";
import { useGetIntegration } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { IntegrationStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo, formatDate } from "@/lib/format";
import { ArrowLeft, Github, ExternalLink } from "lucide-react";

type ExtendedIntegration = {
  id: string;
  vendor: string;
  product: string;
  category: string;
  signalTypes: string[];
  status: string;
  lastSync: string | null;
  signalsIngested24h: number;
  latencyMs: number;
  errorMessage?: string;
  description?: string;
  githubUrl?: string;
  apiDocsUrl?: string;
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  "identity": "text-teal-400 bg-teal-400/10 border-teal-400/20",
  "device-posture": "text-green-400 bg-green-400/10 border-green-400/20",
  "session-context": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "operational-signals": "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "network-posture": "text-teal-400 bg-teal-400/10 border-teal-400/20",
  "physical-access": "text-orange-400 bg-orange-400/10 border-orange-400/20",
};

const SIGNAL_TYPE_DESCRIPTIONS: Record<string, string> = {
  "identity": "User identity, MFA status, role assignments, and session attributes from the IDP",
  "device-posture": "Device compliance, encryption, patch level, and enrollment status",
  "session-context": "Active session attributes, location, shift window, and behavioral context",
  "operational-signals": "ITSM incident state, agent health, kiosk mode, and operational context",
  "network-posture": "VLAN compliance, firewall policy match, subnet authorization, and traffic anomaly score",
  "physical-access": "Badge-in events, access zone authorization, credential type, and tailgating detection",
};

export function IntegrationDetail() {
  const { id } = useParams();
  const { data: integrationRaw, isLoading } = useGetIntegration(id || "");
  const integration = integrationRaw as ExtendedIntegration | undefined;

  if (isLoading || !integration) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 bg-card border border-border rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="mb-4">
        <Link href="/integrations" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 font-mono uppercase tracking-wider">
          <ArrowLeft className="w-4 h-4" /> Back to Integrations
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between border-b border-border pb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{integration.vendor}</h1>
          <p className="text-lg text-muted-foreground">{integration.product}</p>
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mt-1">{integration.category}</p>
          {integration.description && (
            <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">{integration.description}</p>
          )}
          <div className="flex gap-4 mt-3">
            {integration.githubUrl && (
              <a
                href={integration.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors"
              >
                <Github className="w-3.5 h-3.5" /> GitHub Repository
              </a>
            )}
            {integration.apiDocsUrl && (
              <a
                href={integration.apiDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> API Documentation
              </a>
            )}
          </div>
        </div>
        <IntegrationStatusBadge status={integration.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metrics */}
        <Card className="border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Connection Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="text-[10px] text-muted-foreground font-mono mb-1">SIGNALS INGESTED (24H)</div>
              <div className="font-mono text-2xl">{integration.signalsIngested24h.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-mono mb-1">AVG LATENCY</div>
              <div className={`font-mono text-2xl ${integration.latencyMs > 1000 ? "text-amber-400" : integration.latencyMs > 500 ? "text-yellow-400" : ""}`}>
                {integration.latencyMs}ms
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-mono mb-1">LAST SYNC</div>
              <div className="font-mono text-sm">{formatTimeAgo(integration.lastSync)}</div>
              <div className="text-xs text-muted-foreground">{formatDate(integration.lastSync)}</div>
            </div>
            {integration.errorMessage && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-xs font-mono break-words">
                <div className="font-bold mb-1 uppercase tracking-wider">Active Alert</div>
                {integration.errorMessage}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Signal types */}
        <Card className="border-border md:col-span-2">
          <CardHeader>
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Supported Signal Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {integration.signalTypes.map((st) => (
                <div
                  key={st}
                  className={`p-4 border rounded flex items-start gap-4 ${SIGNAL_TYPE_COLORS[st] ? `border-${SIGNAL_TYPE_COLORS[st].split(" ")[2].replace("border-", "")}` : "border-border"} bg-card/50`}
                >
                  <div className="flex-1">
                    <div className={`font-mono text-xs font-bold uppercase tracking-wider mb-1 ${SIGNAL_TYPE_COLORS[st]?.split(" ")[0] ?? "text-foreground"}`}>
                      {st}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {SIGNAL_TYPE_DESCRIPTIONS[st] ?? "Signal data ingested from this integration source."}
                    </div>
                  </div>
                  <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider shrink-0 ${SIGNAL_TYPE_COLORS[st] ?? "text-muted-foreground bg-muted/20 border-border"}`}>
                    {st}
                  </span>
                </div>
              ))}
              {integration.signalTypes.length === 0 && (
                <div className="text-muted-foreground text-sm font-mono p-4 border border-dashed border-border rounded text-center">
                  No signal types configured. Connect this integration to begin ingesting signals.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

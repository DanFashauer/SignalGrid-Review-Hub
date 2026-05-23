import React, { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useListIntegrations } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { IntegrationStatusBadge } from "@/components/StatusBadge";
import { formatTimeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ExternalLink, Github } from "lucide-react";

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

const CATEGORY_ORDER = [
  "IGA / IDP",
  "MDM / UEM",
  "EDR / XDR",
  "SIEM",
  "Networking / SDN",
  "Firewall / SASE",
  "Physical Access (PACS)",
  "Security Keys / FIDO2",
  "Mobile Credentials",
  "IoT / Smart Building",
  "Cellular / eSIM",
  "Infrastructure Monitoring",
  "SOAR / Automation",
  "ITSM",
];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "IGA / IDP": "Identity governance, administration, and authentication providers",
  "MDM / UEM": "Mobile device management and unified endpoint management",
  "EDR / XDR": "Endpoint detection, response, and extended detection & response",
  "SIEM": "Security information and event management platforms",
  "Networking / SDN": "Network infrastructure, SDN controllers, and access control",
  "Firewall / SASE": "Next-gen firewalls, SASE platforms, and SOAR orchestration",
  "Physical Access (PACS)": "Physical access control systems, biometrics, and badge credential platforms",
  "Security Keys / FIDO2": "Hardware security keys, passkeys, and phishing-resistant authenticators",
  "Mobile Credentials": "Apple Wallet, Google Wallet, and mobile badge credential platforms",
  "IoT / Smart Building": "Matter/CSA, building automation, and smart environment signal sources",
  "Cellular / eSIM": "Carrier IoT connectivity, eSIM management, and post-exit device reachability",
  "Infrastructure Monitoring": "Observability, metrics, and infrastructure health signal sources",
  "SOAR / Automation": "Security orchestration, event routing, and automated response platforms",
  "ITSM": "IT service management, incident response, and on-call platforms",
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  "identity": "text-blue-400 bg-blue-400/10 border-blue-400/20",
  "device-posture": "text-green-400 bg-green-400/10 border-green-400/20",
  "session-context": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "operational-signals": "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "network-posture": "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  "physical-access": "text-orange-400 bg-orange-400/10 border-orange-400/20",
};

export function IntegrationList() {
  const { data: integrationsData, isLoading } = useListIntegrations();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [, navigate] = useLocation();

  const allIntegrations = (integrationsData?.integrations ?? []) as ExtendedIntegration[];

  const filtered = useMemo(() => {
    return allIntegrations.filter((i) => {
      const matchesSearch =
        !search ||
        i.vendor.toLowerCase().includes(search.toLowerCase()) ||
        i.product.toLowerCase().includes(search.toLowerCase()) ||
        i.category.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = activeCategory === "all" || i.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [allIntegrations, search, activeCategory]);

  const grouped = useMemo(() => {
    const map: Record<string, ExtendedIntegration[]> = {};
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((i) => i.category === cat);
      if (items.length > 0) map[cat] = items;
    }
    return map;
  }, [filtered]);

  const totalConnected = allIntegrations.filter((i) => i.status === "connected").length;
  const totalDegraded = allIntegrations.filter((i) => i.status === "degraded").length;

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 bg-card border border-border rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">TELEMETRY SOURCES & ENFORCEMENT POINTS</p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-xs font-mono text-muted-foreground">TOTAL</div>
            <div className="text-2xl font-mono">{allIntegrations.length}</div>
          </div>
          <div>
            <div className="text-xs font-mono text-muted-foreground">CONNECTED</div>
            <div className="text-2xl font-mono text-green-400">{totalConnected}</div>
          </div>
          <div>
            <div className="text-xs font-mono text-muted-foreground">DEGRADED</div>
            <div className="text-2xl font-mono text-amber-400">{totalDegraded}</div>
          </div>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search vendors, products, categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 font-mono text-sm bg-card border-border"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", ...CATEGORY_ORDER].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider border transition-colors ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {cat === "all" ? "ALL" : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped sections */}
      {Object.entries(grouped).map(([category, items]) => (
        <section key={category} className="space-y-4">
          <div className="flex items-baseline gap-3 border-b border-border pb-2">
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest">{category}</h2>
            <span className="text-xs font-mono text-muted-foreground">{CATEGORY_DESCRIPTIONS[category]}</span>
            <span className="ml-auto text-xs font-mono text-muted-foreground">{items.length} sources</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((integration) => (
              <div key={integration.id} onClick={() => navigate(`/integrations/${integration.id}`)}>
                <Card
                  className={`border-border hover:border-primary/50 transition-colors cursor-pointer h-full group ${
                    integration.status === "degraded" ? "border-amber-500/40 bg-amber-500/5" : ""
                  } ${integration.status === "not-configured" ? "opacity-60" : ""}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base leading-tight">{integration.vendor}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{integration.product}</p>
                      </div>
                      <IntegrationStatusBadge status={integration.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Signal type pills */}
                    <div className="flex flex-wrap gap-1">
                      {integration.signalTypes.map((st) => (
                        <span
                          key={st}
                          className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${SIGNAL_TYPE_COLORS[st] ?? "text-muted-foreground bg-muted/20 border-border"}`}
                        >
                          {st}
                        </span>
                      ))}
                    </div>

                    {/* Metrics */}
                    {integration.status !== "not-configured" && (
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
                        <div>
                          <div className="text-[10px] text-muted-foreground font-mono">SIGNALS/24H</div>
                          <div className="font-mono text-sm">{integration.signalsIngested24h.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground font-mono">LATENCY</div>
                          <div className={`font-mono text-sm ${integration.latencyMs > 1000 ? "text-amber-400" : ""}`}>
                            {integration.latencyMs}ms
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Error message */}
                    {integration.errorMessage && (
                      <div className="text-[10px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-1.5 break-words">
                        {integration.errorMessage}
                      </div>
                    )}

                    {/* External links */}
                    <div className="flex gap-3 pt-1">
                      {integration.githubUrl && (
                        <a
                          href={integration.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] font-mono text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                        >
                          <Github className="w-3 h-3" /> GitHub
                        </a>
                      )}
                      {integration.apiDocsUrl && (
                        <a
                          href={integration.apiDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] font-mono text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" /> API Docs
                        </a>
                      )}
                    </div>

                    {/* Last sync footer */}
                    <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/50">
                      <span>LAST SYNC</span>
                      <span>{formatTimeAgo(integration.lastSync)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </section>
      ))}

      {Object.keys(grouped).length === 0 && (
        <div className="text-center py-16 text-muted-foreground font-mono">
          No integrations match your search.
        </div>
      )}
    </div>
  );
}

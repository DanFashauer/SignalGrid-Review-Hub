import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AssuranceBadge } from "@/components/AssuranceBadge";
import { formatDate } from "@/lib/format";
import { getContextV1, listConnectorsV1, listSyncRunsV1, triggerSyncV1 } from "@/lib/v1";

/**
 * Microsoft connector setup & health (launch wireframe screen 2): the screen
 * that makes "bring your tenant" concrete. It renders the resolution the
 * server actually computed — never a hopeful status — and the setup
 * instructions ARE the gate checklist: flip the named environment variables
 * and watch the checks go green. Every live-call gate is independently
 * required, so any missing one resolves to fixture mode.
 */
export function ConnectorSetup() {
  const qc = useQueryClient();
  const ctx = useQuery({ queryKey: ["v1-context"], queryFn: getContextV1 });
  const connectors = useQuery({ queryKey: ["v1-connectors"], queryFn: listConnectorsV1 });

  const primary = connectors.data?.find((c) => c.kind === "microsoft-entra-intune") ?? connectors.data?.[0];
  const syncs = useQuery({
    queryKey: ["v1-syncs", primary?.id],
    queryFn: () => listSyncRunsV1(primary!.id),
    enabled: !!primary,
  });
  const runSync = useMutation({
    mutationFn: () => triggerSyncV1(primary!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["v1-syncs"] });
      qc.invalidateQueries({ queryKey: ["v1-connectors"] });
    },
  });

  const a = ctx.data?.assurance;
  const liveTier = a ? a.tier === "beta" || a.tier === "prod" : false;
  const liveSignals = a?.signalSource === "live";

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Microsoft connector</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          SETUP &amp; HEALTH — THE RESOLUTION THE SERVER ACTUALLY COMPUTED <AssuranceBadge />
        </p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Live-call gates — each independently required
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 font-mono text-sm">
          <Gate
            ok={liveTier}
            label="Deployment tier is beta or prod"
            detail={a ? `SIGNALGRID_TIER=${a.tier}${liveTier ? "" : " — this tier never makes live vendor calls"}` : "…"}
          />
          <Gate
            ok={liveSignals}
            label="Live integrations switched on + credential present"
            detail={
              a
                ? liveSignals
                  ? "SIGNALGRID_LIVE_INTEGRATIONS=true with a read-only token configured"
                  : "SIGNALGRID_LIVE_INTEGRATIONS + GRAPH_ACCESS_TOKEN (read-only scopes) — set both on the server"
                : "…"
            }
          />
          <div className="pt-2 border-t border-border">
            <Badge
              variant="outline"
              className={`font-mono uppercase border-transparent ${liveSignals ? "bg-signal-nominal" : "bg-signal-unknown"}`}
            >
              resolved mode: {liveSignals ? "live" : "fixture"}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">
              {liveSignals
                ? "Reads are live and READ-ONLY: the connector refuses any non-GET request by construction."
                : "Fixture mode is a WORKING connector: synthetic devices, real paging, the same code path as live — nothing leaves this process."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* The source-agnostic declaration (owner redirect 2026-08-11): which
          sources feed the lab, and which is the enterprise connector. Declared
          facts about the shipped code, not runtime state — the resolved-mode
          card above stays the only place a live/fixture claim is made. */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Evidence sources — one contract, engine can&apos;t tell them apart
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-sm">
          <div className="border border-border rounded p-3 bg-card/50">
            <span className="font-bold">fleet</span>
            <Badge variant="outline" className="ml-2 font-mono uppercase text-[10px] bg-signal-nominal border-transparent">open-source lab</Badge>
            <p className="text-xs text-muted-foreground mt-1">
              Fleet (osquery) host posture through the proven @workspace/fleet-connector normalizer — enrollment, supervision, encryption, OS floor, screen lock, check-in freshness. Fixture lab today; self-hostable source later.
            </p>
          </div>
          <div className="border border-border rounded p-3 bg-card/50">
            <span className="font-bold">headwind</span>
            <Badge variant="outline" className="ml-2 font-mono uppercase text-[10px] bg-signal-nominal border-transparent">android lab (fixture shape)</Badge>
            <p className="text-xs text-muted-foreground mt-1">
              Headwind-shaped shared rugged Android — scanners, kiosks, dedicated devices. A fixture shape, deliberately not a new connector family.
            </p>
          </div>
          <div className="border border-border rounded p-3 bg-card/50">
            <span className="font-bold">intune</span>
            <Badge variant="outline" className="ml-2 font-mono uppercase text-[10px] bg-signal-unknown border-transparent">enterprise connector</Badge>
            <p className="text-xs text-muted-foreground mt-1">
              Microsoft Graph / Entra-Intune — the first enterprise production connector, read-only, off by default behind the gates above. Never required for the lab.
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground pt-1">
            All three enter through the DeviceManagementEvidence contract; proof:evidence-adapter fails the build unless the same device state decides identically from every source — provenance is the only difference.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Connectors · /v1/connectors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-sm">
          {connectors.error ? (
            <div className="text-muted-foreground">{String(connectors.error instanceof Error ? connectors.error.message : connectors.error)}</div>
          ) : (
            (connectors.data ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 border border-border rounded p-3 bg-card/50">
                <div className="min-w-0">
                  <span className="font-bold">{c.kind}</span>
                  <span className="text-xs text-muted-foreground block truncate" title={c.permissionScope}>{c.permissionScope}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="font-mono uppercase text-[10px] bg-signal-unknown border-transparent">{c.mode}</Badge>
                  <span className="text-xs text-muted-foreground">{c.lastSyncAt ? `synced ${formatDate(c.lastSyncAt)}` : "never synced"}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Sync history {primary ? `· ${primary.kind}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 font-mono text-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => runSync.mutate()}
              disabled={!primary || runSync.isPending}
              className="px-3 py-2 text-xs font-mono rounded border border-border bg-card hover:border-primary/50 transition-colors disabled:opacity-40"
            >
              {runSync.isPending ? "SYNCING…" : "RUN FIXTURE SYNC"}
            </button>
            <span className="text-xs text-muted-foreground">
              runs with the demo owner key (connector:sync — the operator role deliberately lacks it); the core refuses non-fixture connectors, so no source system can be touched
            </span>
          </div>
          {runSync.error && (
            <div className="text-xs text-muted-foreground">{String(runSync.error instanceof Error ? runSync.error.message : runSync.error)}</div>
          )}
          {(syncs.data ?? []).slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 border border-border rounded p-2 bg-card/50 text-xs">
              <span>{formatDate(r.completedAt)}</span>
              <span className="uppercase">{r.status}</span>
              <span>{r.recordsProcessed} records · {r.signalsNormalized} signals</span>
              <span className="text-muted-foreground truncate max-w-[260px]" title={r.note}>{r.note}</span>
            </div>
          ))}
          {primary && (syncs.data ?? []).length === 0 && !syncs.isLoading && (
            <div className="text-xs text-muted-foreground">No sync runs recorded yet — run one above.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Gate({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`font-bold ${ok ? "text-status-allow-foreground" : "text-muted-foreground"}`}>[{ok ? "✓" : "✗"}]</span>
      <div className="min-w-0">
        <div>{label}</div>
        <div className="text-xs text-muted-foreground break-all">{detail}</div>
      </div>
    </div>
  );
}

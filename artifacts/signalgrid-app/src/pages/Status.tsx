import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getContextV1, getMetricsV1, listDecisionsV1 } from "@/lib/v1";

/**
 * The Limited-GA assurance status page (launch wireframe screen 6): the honest
 * one-pager a partner opens first. Every value in the top cards is derived by
 * the SERVER on this request (`/v1/context` recomputes assurance per call;
 * `/v1/metrics` and the ledger are the engine's own records). The one block
 * that is a declaration rather than a measurement says so in its own header.
 */
export function Status() {
  const ctx = useQuery({ queryKey: ["v1-context"], queryFn: getContextV1 });
  const metrics = useQuery({ queryKey: ["v1-metrics"], queryFn: getMetricsV1, refetchInterval: 30_000 });
  const decisions = useQuery({ queryKey: ["v1-decisions"], queryFn: listDecisionsV1 });

  const a = ctx.data?.assurance;
  const coreNorm = decisions.data?.find((d) => d.coreNormalizationVersion !== undefined)?.coreNormalizationVersion;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Deployment assurance</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          WHAT THIS DEPLOYMENT IS — SERVER-DERIVED ON EVERY REQUEST
        </p>
      </div>

      {ctx.error ? (
        <Card className="border-border">
          <CardContent className="py-8 text-center font-mono text-sm text-muted-foreground">
            {String(ctx.error instanceof Error ? ctx.error.message : ctx.error)}
          </CardContent>
        </Card>
      ) : !a ? (
        <Card className="border-border">
          <CardContent className="py-8 text-center text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Posture · /v1/context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-sm">
              <Row label="PROFILE" value={a.profile} />
              <Row label="TIER" value={a.tier} />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">SIGNAL SOURCE</span>
                <Badge
                  variant="outline"
                  className={`font-mono uppercase border-transparent ${a.signalSource === "fixtures" ? "bg-signal-unknown" : "bg-signal-nominal"}`}
                >
                  {a.signalSource === "fixtures" ? "fixtures — no live vendor call possible here" : "live signals"}
                </Badge>
              </div>
              <Row label="VERDICT EFFECT" value={`${a.verdictEffect} — the gate answers; the host app acts`} />
              <Row label="STEP-UP ANSWERABLE" value={a.stepUpAnswerable ? "yes" : "no — nothing served can resolve a step_up"} />
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Engine · /v1/metrics + ledger</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-sm">
              <Row label="DECISIONS MINTED" value={metrics.data ? String(metrics.data.totalDecisions) : "…"} />
              <Row label="WITH EVIDENCE SNAPSHOT" value={metrics.data ? String(metrics.data.decisionsWithEvidence) : "…"} />
              <Row label="P95 LATENCY" value={metrics.data ? `${Math.round(metrics.data.p95LatencyMs)}ms` : "…"} />
              <Row label="CORE NORMALIZATION" value={coreNorm !== undefined ? `v${coreNorm} (stamped on the ledger's own records)` : "unstamped"} />
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Declared divergence — a declaration, not a measurement
          </CardTitle>
        </CardHeader>
        <CardContent className="font-mono text-sm text-muted-foreground space-y-2">
          <p>
            The on-device demo engine (simulator + iOS port) has no vocabulary for two categories the served core
            evaluates (<span className="text-foreground">device_management_health</span>,{" "}
            <span className="text-foreground">local_authority</span>). A device affirmatively reporting a broken
            management plane is restricted by /v1 but not by the on-device demo evaluation.
          </p>
          <p>
            This gap is pinned in both directions by the decision-port parity gate, so it cannot silently grow or
            silently claim to be closed. Fleets not emitting either signal see no divergence.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  );
}

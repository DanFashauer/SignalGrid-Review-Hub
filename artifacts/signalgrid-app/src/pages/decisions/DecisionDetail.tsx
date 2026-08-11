import React from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { OutcomeBadge } from "@/components/StatusBadge";
import { AssuranceBadge } from "@/components/AssuranceBadge";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { getDecisionV1, getEvidenceV1 } from "@/lib/v1";
import { routeOwnersFor } from "@/lib/route-owner";

/**
 * The product's trust moment: one decision, fully explained from the real /v1
 * core — outcome, reason codes, matched rules, the tamper-evident evidence
 * snapshot with its verification result, every signal the engine read (with
 * freshness and provenance), the versioned policy that decided, tenant, and
 * latency. Modeled on the iOS DecisionDetailView, which proved the rendering.
 */
export function DecisionDetail() {
  const { id } = useParams();
  const decisionQ = useQuery({ queryKey: ["v1-decision", id], queryFn: () => getDecisionV1(id || ""), enabled: !!id });
  const evidenceQ = useQuery({ queryKey: ["v1-evidence", id], queryFn: () => getEvidenceV1(id || ""), enabled: !!id });

  if (decisionQ.isLoading || !decisionQ.data) {
    return (
      <div className="p-8 text-center text-muted-foreground font-mono text-sm">
        {decisionQ.error ? String(decisionQ.error instanceof Error ? decisionQ.error.message : decisionQ.error) : "Loading..."}
      </div>
    );
  }
  const d = decisionQ.data;
  const ev = evidenceQ.data;
  // Who picks this refusal up (wireframe screen 3's last gap). The owner comes
  // from the IT-layer model's declared routing, mirrored client-side because
  // owner routing is deliberately not on the wire yet — a named gap there.
  const routing = d.outcome !== "allow" ? routeOwnersFor(d.reasonCodes) : null;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 border-b border-border pb-6">
        <OutcomeBadge outcome={d.outcome} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight font-mono truncate">{d.id}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {formatDate(d.createdAt)} • {Math.round(d.latencyMs)}ms LATENCY • {d.tenantId}
            <AssuranceBadge />
          </p>
        </div>
      </div>

      {d.explanation && <p className="text-sm text-muted-foreground font-mono">{d.explanation}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="IDENTITY" value={d.identityId} />
            <Field label="DEVICE ID" value={d.deviceId} />
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">WORKFLOW</div>
              <Badge variant="secondary" className="font-mono">{d.workflowId}</Badge>
            </div>
            <Field label="POLICY" value={`${d.policyId} · v${d.policyVersion}`} accent />
            <Field label="REVIEW STATUS" value={`${d.reviewStatus}${d.reviewable ? " · reviewable" : ""}`} />
            {d.coreNormalizationVersion !== undefined && (
              <Field label="CORE NORMALIZATION" value={`v${d.coreNormalizationVersion}`} />
            )}
            {routing && (routing.owners.length > 0 || routing.unclassified.length > 0) && (
              <div>
                <div className="text-xs text-muted-foreground font-mono mb-1">ROUTE OWNER</div>
                <div className="flex flex-wrap gap-1.5">
                  {routing.owners.map((o) => (
                    <Badge key={o.id} variant="outline" className="font-mono text-xs" title={o.covers}>
                      {o.label}
                    </Badge>
                  ))}
                  {routing.unclassified.map((c) => (
                    <Badge key={c} variant="outline" className="font-mono text-xs bg-status-deny border-transparent" title="This reason code has no owner in the IT-layer model — extend scripts/it-layer-model.mjs.">
                      {c}: UNCLASSIFIED
                    </Badge>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground font-mono mt-1">
                  who picks this up, per the declared IT-layer model
                </p>
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground font-mono mb-1">AUDIT</div>
              <Link href="/audit" className="text-xs font-mono text-primary hover:underline">
                View tamper-evident audit ledger →
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Why — matched rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {d.matchedRules.map((r) => (
                <div key={r.ruleId} className="flex items-center justify-between border border-border rounded p-3 bg-card/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <OutcomeBadge outcome={r.outcome} />
                    <span className="font-mono text-sm truncate">{r.reasonCode}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{r.ruleId} · {r.severity}</span>
                </div>
              ))}
              {d.matchedRules.length === 0 && (
                <div className="text-muted-foreground text-sm font-mono">No rules matched (default outcome).</div>
              )}
              {d.reasonCodes.length > 0 && (
                <div className="pt-2 flex flex-wrap gap-2">
                  {d.reasonCodes.map((c) => (
                    <Badge key={c} variant="outline" className="font-mono text-xs">{c}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                Evidence snapshot{" "}
                {ev && (
                  <Badge
                    variant="outline"
                    className={`ml-2 font-mono text-[10px] uppercase border-transparent ${ev.verified ? "bg-status-allow" : "bg-status-deny"}`}
                  >
                    {ev.verified ? "digest verified" : "DIGEST MISMATCH"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!ev ? (
                <div className="text-muted-foreground text-sm font-mono">Loading evidence…</div>
              ) : (
                <div className="space-y-4">
                  <div className="text-xs font-mono text-muted-foreground">
                    {ev.evidence.id} · captured {formatDate(ev.evidence.capturedAt)} · policy v{ev.evidence.policyVersion}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(ev.evidence.evidence ?? {}).map(([k, v]) => (
                      <div key={k} className="border border-border rounded p-2 bg-card/50">
                        <div className="text-[10px] text-muted-foreground font-mono uppercase">{k}</div>
                        <div className="font-mono text-xs break-all">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-2 uppercase">Signals used</div>
                    <div className="space-y-2">
                      {(ev.evidence.signalsUsed ?? []).map((s) => (
                        <div key={s.id} className="flex items-center justify-between border border-border rounded p-2 bg-card/50 gap-3">
                          <span className="font-mono text-xs font-bold">{s.category}</span>
                          <span className="font-mono text-xs break-all">{String(s.value)}</span>
                          <Badge variant="outline" className="font-mono text-[10px] uppercase">{s.freshness}</Badge>
                          <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[200px]" title={s.sourceReference}>
                            {s.sourceReference}
                          </span>
                        </div>
                      ))}
                      {(ev.evidence.signalsUsed ?? []).length === 0 && (
                        <div className="text-muted-foreground text-xs font-mono">No cached signals — evidence derived from defaults (fail-closed).</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground font-mono mb-1">{label}</div>
      <div className={`font-mono break-all text-sm ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

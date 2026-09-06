import React, { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OutcomeBadge } from "@/components/StatusBadge";
import { AssuranceBadge } from "@/components/AssuranceBadge";
import { formatDate } from "@/lib/format";
import { listPoliciesV1, listPolicyVersionsV1, runPolicyTestsV1 } from "@/lib/v1";

/**
 * "What decided this" (launch wireframe screen 5): one policy's versioned rule
 * sets with content digests, plus the pinned policy tests run on demand against
 * any version. Read-only by design — draft creation and activation are not on
 * the launch fence; policy changes ride the repository.
 */
export function PolicyDetail() {
  const { id } = useParams();
  const policies = useQuery({ queryKey: ["v1-policies"], queryFn: listPoliciesV1 });
  const versions = useQuery({ queryKey: ["v1-policy-versions", id], queryFn: () => listPolicyVersionsV1(id || ""), enabled: !!id });
  const [selected, setSelected] = useState<string | null>(null);

  const policy = policies.data?.find((p) => p.id === id);
  const ordered = (versions.data ?? []).slice().sort((a, b) => b.version - a.version);
  const current = ordered.find((v) => v.id === (selected ?? policy?.activeVersionId)) ?? ordered[0];

  const tests = useQuery({
    queryKey: ["v1-policy-tests", id, current?.id],
    queryFn: () => runPolicyTestsV1(id || "", current?.id),
    enabled: !!id && !!current,
  });

  // A failed list read is "policies unreadable", not "Policy not found" — the
  // latter is a statement about the policy, and nothing was read to make it.
  if (policies.isError) {
    return (
      <div className="p-8 text-center text-muted-foreground font-mono text-sm">
        Policies unreadable — the control plane did not answer.
        <div className="text-xs mt-1">{String(policies.error instanceof Error ? policies.error.message : policies.error)}</div>
      </div>
    );
  }
  if (!policy && !policies.isLoading) {
    return <div className="p-8 text-center text-muted-foreground font-mono text-sm">Policy not found.</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{policy?.name ?? "…"}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          {policy?.key} · binds workflows matching “{policy?.workflowPattern}” · READ-ONLY AT LAUNCH <AssuranceBadge />
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ordered.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelected(v.id)}
                className={`w-full text-left border rounded p-2 font-mono text-xs transition-colors ${
                  current?.id === v.id ? "border-primary/60 bg-card" : "border-border bg-card/50 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold">v{v.version}</span>
                  <Badge variant="outline" className={`font-mono text-[10px] uppercase border-transparent ${v.status === "active" ? "bg-status-allow" : "bg-signal-unknown"}`}>
                    {v.status}
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-1">{formatDate(v.createdAt)}</div>
                <div className="text-muted-foreground truncate" title={v.digest}>digest {v.digest.slice(0, 12)}…</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="md:col-span-3 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                Rules in v{current?.version ?? "…"} ({current?.rules.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(current?.rules ?? []).map((r) => (
                <div key={r.id} className="border border-border rounded p-3 bg-card/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <OutcomeBadge outcome={r.outcome} />
                      <span className="font-mono text-xs font-bold truncate">{r.reasonCode}</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground uppercase shrink-0">{r.id} · {r.severity}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  <div className="font-mono text-[10px] text-muted-foreground mt-1 truncate" title={JSON.stringify(r.match)}>
                    match: {JSON.stringify(r.match)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                Policy tests against v{current?.version ?? "…"}{" "}
                {tests.data ? (
                  <Badge variant="outline" className={`ml-2 font-mono text-[10px] uppercase border-transparent ${tests.data.passed ? "bg-status-allow" : "bg-status-deny"}`}>
                    {tests.data.results.filter((r) => r.passed).length}/{tests.data.results.length} {tests.data.passed ? "passed" : "FAILING"}
                  </Badge>
                ) : tests.isError ? (
                  <Badge
                    variant="outline"
                    className="ml-2 font-mono text-[10px] uppercase border-transparent bg-signal-unknown"
                    title="GET /v1/policies/:id/tests failed — the pinned tests could not be run"
                  >
                    unverified
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {(tests.data?.results ?? []).map((t) => (
                <div key={t.testId} className="flex items-center justify-between gap-3 font-mono text-xs border border-border rounded p-2 bg-card/50">
                  <span className={t.passed ? "" : "text-destructive font-bold"}>{t.passed ? "ok" : "✗"}</span>
                  <span className="flex-1 truncate" title={t.name}>{t.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    expected {t.expectedOutcome} → got {t.actualOutcome}
                  </span>
                </div>
              ))}
              {/* A failed test run is surfaced, never left blank or "running…". */}
              {tests.isError ? (
                <div className="text-muted-foreground text-xs font-mono">{String(tests.error instanceof Error ? tests.error.message : tests.error)}</div>
              ) : tests.isLoading ? (
                <div className="text-muted-foreground text-xs font-mono">Running tests server-side…</div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane, type SignalSourceRow } from "@/lib/control-plane";

// Signal sourcing (docs/SIGNAL_SOURCING.md): the Grid's coverage is only ever as
// good as how the source systems are configured. Every signal reaches the Grid by
// one of four paths — api / native (the vendor integrates, high fidelity),
// grid_collected (the Grid does the lifting, lower fidelity), or unavailable (a
// real gap, never a false "we have it"). This view makes that boundary explicit.

const METHOD: Record<string, { label: string; text: string; who: string }> = {
  api: { label: "API", text: "text-emerald-400", who: "the system" },
  native: { label: "native", text: "text-emerald-400", who: "the system" },
  grid_collected: { label: "grid-collected", text: "text-primary", who: "SignalGrid does the lifting" },
  unavailable: { label: "gap", text: "text-red-400", who: "nobody — it's a gap" },
};

const FIDELITY: Record<string, string> = {
  high: "text-emerald-400", medium: "text-amber-400", low: "text-orange-400", none: "text-red-400",
};

export function SignalSourcing() {
  const q = useQuery({ queryKey: ["cp-grid-sourcing"], queryFn: () => controlPlane.gridSourcing() });
  const s = q.data?.summary;
  const signals = q.data?.signals ?? [];
  const gaps = signals.filter((r) => r.method === "unavailable");

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Signal sourcing</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">HOW EACH SIGNAL REACHES THE GRID · FIXTURE</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Wireable" value={s ? `${s.wireable}/${s.total}` : "-"} accent={s ? (s.unavailable ? "text-amber-400" : "text-emerald-400") : undefined} sub={s ? (s.unavailable ? `${s.unavailable} gap${s.unavailable === 1 ? "" : "s"}` : "no gaps") : ""} />
        <Metric label="Vendor-integrated" value={s ? String(s.vendorIntegrated) : "-"} accent="text-emerald-400" sub="api + native · high fidelity" />
        <Metric label="Grid-lifted" value={s ? String(s.gridCollected) : "-"} accent={s && s.gridCollected ? "text-primary" : undefined} sub="the Grid does the lifting" />
        <Metric label="Gaps" value={s ? String(s.unavailable) : "-"} accent={s ? (s.unavailable ? "text-red-400" : "text-emerald-400") : undefined} sub="cannot be wired" />
      </div>

      {gaps.length > 0 && (
        <Card className="border-red-400/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-red-400">Gaps · surfaced, never hidden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {gaps.map((r) => (
              <div key={r.id} className="text-xs font-mono text-muted-foreground">
                <span className="text-foreground">{r.name}</span> · {r.system} — no API, no native hook, nothing to collect. Add an integration, stand up a collector, or accept the gap.
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Every signal · path & fidelity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-1.5 font-medium">SIGNAL</th>
                  <th className="text-left pb-1.5 font-medium">SYSTEM</th>
                  <th className="text-left pb-1.5 font-medium">PATH</th>
                  <th className="text-left pb-1.5 font-medium">FIDELITY</th>
                  <th className="text-left pb-1.5 font-medium">WHO DOES THE WORK</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {signals.map((r: SignalSourceRow) => {
                  const m = METHOD[r.method] ?? { label: r.method, text: "text-muted-foreground", who: "—" };
                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="py-1.5">{r.name}</td>
                      <td className="py-1.5 text-muted-foreground">{r.system}</td>
                      <td className={`py-1.5 uppercase ${m.text}`}>{m.label}</td>
                      <td className={`py-1.5 uppercase ${FIDELITY[r.fidelity] ?? "text-muted-foreground"}`}>{r.fidelity}</td>
                      <td className="py-1.5 text-muted-foreground">{m.who}</td>
                    </tr>
                  );
                })}
                {!q.data && <tr><td colSpan={5} className="py-2 text-muted-foreground">{q.isError ? "Signal sourcing unavailable — the control plane did not answer." : "Loading…"}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[0.68rem] text-muted-foreground font-mono pt-2">
            Where a system integrates (API/native), the Grid consumes the signal directly — highest fidelity. Where it won't, the Grid does the lifting at lower fidelity. Where even that is impossible, the gap is named, never dressed up as a signal the Grid has. The more you can source — and at what fidelity — is dictated by what your existing systems support. Read live from <span className="text-muted-foreground">/cp/v1/grid/sourcing</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl md:text-3xl font-mono font-bold tracking-tight ${accent ?? ""}`}>{value}</div>
        {sub && <div className="text-xs font-mono text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default SignalSourcing;

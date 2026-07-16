import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  listAppWorkflowIntegrations,
  evaluateAppWorkflow,
  type AppVertical,
  type V1AppIntegration,
  type V1AppActionPlan,
} from "@/lib/v1";

const VERTICAL_LABEL: Record<AppVertical, string> = {
  healthcare: "Healthcare",
  warehouse: "Warehouse",
  industrial: "Industrial",
  global_fleet: "Global fleet",
  retail: "Retail",
  data_center: "Data center / NOC",
};

// A compliant demo actor + token per live-evaluable vertical (public-safe fixtures).
const DEMO_ACTOR: Partial<Record<AppVertical, { token: string; identityRef: string; deviceRef: string }>> = {
  healthcare: { token: "sgk_demo_northwind_operator", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01" },
  warehouse: { token: "sgk_demo_atlas_owner", identityRef: "picker.compliant", deviceRef: "handheld-01" },
  global_fleet: { token: "sgk_demo_meridian_owner", identityRef: "driver.compliant", deviceRef: "vehicle-mount-01" },
};

const DISP_STYLE: Record<V1AppActionPlan["disposition"], string> = {
  auto: "text-emerald-400 border-emerald-400/30",
  applied: "text-emerald-400 border-emerald-400/30",
  assist: "text-amber-400 border-amber-400/30",
  step_up: "text-amber-400 border-amber-400/30",
  blocked: "text-red-400 border-red-400/30",
};

export function AppWorkflows() {
  const integrations = useQuery({ queryKey: ["aw-integrations"], queryFn: listAppWorkflowIntegrations });
  const list = integrations.data ?? [];
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = list.find((i) => i.id === selectedId) ?? null;

  const actor = selected ? DEMO_ACTOR[selected.vertical] : undefined;
  const plan = useQuery({
    queryKey: ["aw-eval", selectedId],
    queryFn: () =>
      evaluateAppWorkflow({ integrationId: selected!.id, identityRef: actor!.identityRef, deviceRef: actor!.deviceRef, token: actor!.token }),
    enabled: !!selected && !!actor,
  });

  const byVertical = groupByVertical(list);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">App workflows</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">TRUST GATEWAY FOR APPLICATION ACTIONS (FIXTURE)</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          The same allow / step-up / restrict / deny engine, gating the software people use all shift. An app calls
          SignalGrid before a sensitive action; sensitive actions never fire automatically — they wait for a human to
          confirm (the Assist model). Live gating below uses a compliant demo actor per vertical.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Catalog */}
        <div className="lg:col-span-2 space-y-5">
          {(Object.keys(byVertical) as AppVertical[]).map((v) => (
            <div key={v}>
              <div className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-1.5">{VERTICAL_LABEL[v]}</div>
              <div className="space-y-1.5">
                {byVertical[v].map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setSelectedId(i.id)}
                    className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                      selectedId === i.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="font-mono text-sm font-semibold">{i.name}</div>
                    <div className="font-mono text-[0.68rem] text-muted-foreground">{i.category} · {i.actions.length} actions</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!integrations.data && <div className="text-sm text-muted-foreground">Loading catalog…</div>}
        </div>

        {/* Gated plan */}
        <div className="lg:col-span-3">
          <Card className="border-border h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                {selected ? `Gated actions · ${selected.name}` : "Select an integration"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selected && <div className="text-sm text-muted-foreground">Pick an app on the left to see its actions gated by a live decision.</div>}

              {selected && !actor && (
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-3">
                    Catalog only for this vertical (no seeded demo tenant). Actions + risk tiers shown; wire a tenant to gate live.
                  </div>
                  {selected.actions.map((a) => (
                    <div key={a.key} className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-border/30 last:border-0">
                      <span>{a.label}</span>
                      <span className={`px-1.5 py-0.5 rounded border ${a.sensitive ? "border-amber-400/30 text-amber-400" : "border-border text-muted-foreground"}`}>
                        {a.riskTier}{a.sensitive ? " · sensitive" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selected && actor && (
                <div>
                  {plan.data && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded border ${DISP_STYLE[plan.data.plan.mode === "deny" ? "blocked" : plan.data.plan.mode === "proceed" ? "auto" : "assist"]}`}>
                        decision · {plan.data.decision.outcome}
                      </span>
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        {actor.identityRef} · {actor.deviceRef}
                      </span>
                    </div>
                  )}
                  {plan.data && <div className="text-xs text-muted-foreground mb-3">{plan.data.plan.summary}</div>}
                  {plan.isLoading && <div className="text-sm text-muted-foreground">Evaluating…</div>}
                  {plan.error && <div className="text-sm text-red-400">Evaluation failed.</div>}
                  {plan.data?.plan.actions.map((a) => (
                    <div key={a.key} className="flex items-center justify-between gap-3 text-xs font-mono py-1.5 border-b border-border/30 last:border-0">
                      <div className="min-w-0">
                        <div className="truncate">{a.label}{a.sensitive ? <span className="text-amber-400"> · sensitive</span> : null}</div>
                        <div className="text-[0.66rem] text-muted-foreground truncate">{a.reason}</div>
                      </div>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded border uppercase ${DISP_STYLE[a.disposition]}`}>{a.disposition.replace("_", "-")}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground font-mono">
        Generic app categories only — no real product, no PHI, no live vendor calls. Decisions come from the real core;
        high-risk actions are approval-gated and simulated. Data is deterministic public-safe fixtures.
      </p>
    </div>
  );
}

function groupByVertical(list: V1AppIntegration[]): Record<AppVertical, V1AppIntegration[]> {
  const order: AppVertical[] = ["healthcare", "warehouse", "industrial", "global_fleet", "retail", "data_center"];
  const out = {} as Record<AppVertical, V1AppIntegration[]>;
  for (const v of order) {
    const items = list.filter((i) => i.vertical === v);
    if (items.length) out[v] = items;
  }
  return out;
}

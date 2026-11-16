import React, { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FIXTURE_HOSPITAL_GRAPH_DOC, type SpaceKind } from "@workspace/facility-trust-graph";
import { layoutFacilityGraph } from "@/lib/facilityGraphLayout";

/**
 * Facility Trust Graph — a tile-less operator view over the shipped spatial
 * model (`@workspace/facility-trust-graph`).
 *
 * BUILD_BACKLOG.md asked for a maplibre-gl-js operator map, "blocked on
 * where vector tiles come from in a repository with no network calls". The
 * measurement that resolves the row: the graph carries no geography at all
 * (see `src/lib/facilityGraphLayout.ts`) — it is a spaceId hierarchy keyed
 * by `parentId`, not a floor plan with coordinates. A map renderer would
 * have nothing to draw ON. What the data actually is, is a tree, so this
 * view lays it out with plain arithmetic and renders it as inline SVG — no
 * maplibre, no tile server, no new runtime dependency, and the fixture is
 * deterministic and bundled (no live vendor call, ever).
 */
const KIND_COLOR: Record<SpaceKind, string> = {
  organization: "#64748b",
  campus: "#64748b",
  building: "#3b82f6",
  floor: "#3b82f6",
  security_zone: "#f59e0b",
  unit: "#0ea5e9",
  room: "#22c55e",
  bed: "#a855f7",
  equipment_zone: "#a855f7",
  door: "#ef4444",
};

export function FacilityGraph() {
  const doc = FIXTURE_HOSPITAL_GRAPH_DOC;
  const [selected, setSelected] = useState<string | null>(null);
  const layout = useMemo(() => layoutFacilityGraph(doc.spaces), [doc]);
  const byId = useMemo(() => new Map(doc.spaces.map((s) => [s.spaceId, s])), [doc]);
  const selectedNode = selected ? byId.get(selected) : undefined;

  const kindsPresent = [...new Set(layout.nodes.map((n) => n.kind as SpaceKind))];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Facility Trust Graph</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          map version {doc.mapVersion} · {doc.spaces.length} spaces · fixture data, tile-less rendering
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-border md:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              Space hierarchy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border border-border rounded bg-card/50">
              <svg
                role="img"
                aria-label={`Facility trust graph, ${doc.spaces.length} spaces`}
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="block"
              >
                {layout.edges.map((e) => {
                  const from = layout.nodes.find((n) => n.spaceId === e.from);
                  const to = layout.nodes.find((n) => n.spaceId === e.to);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={`${e.kind}-${e.from}-${e.to}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={e.kind === "door" ? "#ef4444" : "currentColor"}
                      strokeOpacity={e.kind === "door" ? 0.7 : 0.25}
                      strokeDasharray={e.kind === "door" ? "4 3" : undefined}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {layout.nodes.map((n) => (
                  <g
                    key={n.spaceId}
                    transform={`translate(${n.x}, ${n.y})`}
                    onClick={() => setSelected(n.spaceId)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r={selected === n.spaceId ? 9 : 6}
                      fill={KIND_COLOR[n.kind as SpaceKind] ?? "#64748b"}
                      stroke={selected === n.spaceId ? "#fff" : "none"}
                      strokeWidth={2}
                    />
                    <text x={0} y={20} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="currentColor">
                      {n.name}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {kindsPresent.map((k) => (
                <Badge key={k} variant="outline" className="font-mono text-[10px] uppercase border-transparent" style={{ backgroundColor: `${KIND_COLOR[k]}33`, color: KIND_COLOR[k] }}>
                  {k.replace("_", " ")}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              {selectedNode ? selectedNode.name : "Select a space"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {selectedNode ? (
              <>
                <div><span className="text-muted-foreground">spaceId</span> {selectedNode.spaceId}</div>
                <div><span className="text-muted-foreground">kind</span> {selectedNode.kind}</div>
                <div><span className="text-muted-foreground">parent</span> {selectedNode.parentId ?? "— (root)"}</div>
                {selectedNode.securityClassification ? (
                  <div><span className="text-muted-foreground">classification</span> {selectedNode.securityClassification}</div>
                ) : null}
                {selectedNode.connects ? (
                  <div><span className="text-muted-foreground">connects</span> {selectedNode.connects.join(", ")}</div>
                ) : null}
                {selectedNode.vendorRefs ? (
                  <div className="pt-2 space-y-1">
                    <div className="text-muted-foreground">vendor refs</div>
                    {Object.entries(selectedNode.vendorRefs).map(([ns, refs]) => (
                      <div key={ns} className="pl-2">
                        {Object.entries(refs).map(([key, id]) => (
                          <div key={key}>{ns}.{key} = {id}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-muted-foreground">Click a space in the graph.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

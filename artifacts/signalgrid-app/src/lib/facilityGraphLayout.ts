/**
 * Tile-less layout for the Facility Trust Graph console view.
 *
 * BUILD_BACKLOG.md row: "A maplibre-gl-js operator map … blocked on tiles."
 * Measured before building anything: `@workspace/facility-trust-graph`
 * (lib/facility-trust-graph/src/graph.ts) is a pure spaceId hierarchy — every
 * node's only positional fact is `parentId` (and, for a door, `connects`).
 * There is no latitude/longitude, no floor-plan pixel coordinate, no vendor
 * map reference used for placement anywhere in the type. A tile renderer has
 * nothing to project: this isn't "blocked on where tiles come from", it's
 * that the shipped data has no geography to tile. What it IS is a tree, and a
 * tree needs no map — this module lays it out with plain arithmetic, and the
 * page renders it with an inline `<svg>`. No maplibre, no tile fetch, no new
 * runtime dependency.
 */
export interface GraphNodeInput {
  readonly spaceId: string;
  readonly kind: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly connects?: readonly string[];
}

export interface LaidOutNode {
  readonly spaceId: string;
  readonly kind: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly x: number;
  readonly y: number;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "parent" | "door";
}

export interface GraphLayout {
  readonly nodes: LaidOutNode[];
  readonly edges: GraphEdge[];
  readonly width: number;
  readonly height: number;
}

const X_GAP = 150;
const Y_GAP = 100;
const MARGIN = 60;

/**
 * A classic leaf-counting tree layout: each leaf claims the next integer
 * column; each parent centers over its children's columns; depth (by
 * `parentId` chain) becomes the row. Deterministic and order-independent —
 * the fixture-backed console must render the same picture on every load.
 */
export function layoutFacilityGraph(nodes: readonly GraphNodeInput[]): GraphLayout {
  const byId = new Map(nodes.map((n) => [n.spaceId, n]));
  const childrenOf = new Map<string | null, GraphNodeInput[]>();
  for (const n of nodes) {
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }
  // Roots: parentId null, or parentId pointing outside this node set (so a
  // partial/filtered graph still lays out instead of silently dropping nodes).
  const roots = nodes.filter((n) => n.parentId === null || !byId.has(n.parentId));

  const columnOf = new Map<string, number>();
  const depthOf = new Map<string, number>();
  let nextColumn = 0;

  function place(node: GraphNodeInput, depth: number): number {
    depthOf.set(node.spaceId, depth);
    const children = childrenOf.get(node.spaceId) ?? [];
    if (children.length === 0) {
      const col = nextColumn++;
      columnOf.set(node.spaceId, col);
      return col;
    }
    const childColumns = children.map((c) => place(c, depth + 1));
    const col = (Math.min(...childColumns) + Math.max(...childColumns)) / 2;
    columnOf.set(node.spaceId, col);
    return col;
  }
  for (const root of roots) place(root, 0);

  const laidOut: LaidOutNode[] = nodes
    .filter((n) => columnOf.has(n.spaceId))
    .map((n) => ({
      spaceId: n.spaceId,
      kind: n.kind,
      name: n.name,
      parentId: n.parentId,
      x: MARGIN + (columnOf.get(n.spaceId) ?? 0) * X_GAP,
      y: MARGIN + (depthOf.get(n.spaceId) ?? 0) * Y_GAP,
    }));

  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    if (n.parentId !== null && byId.has(n.parentId)) edges.push({ from: n.parentId, to: n.spaceId, kind: "parent" });
    for (const target of n.connects ?? []) {
      if (byId.has(target)) edges.push({ from: n.spaceId, to: target, kind: "door" });
    }
  }

  const maxX = laidOut.reduce((m, n) => Math.max(m, n.x), 0);
  const maxY = laidOut.reduce((m, n) => Math.max(m, n.y), 0);
  return { nodes: laidOut, edges, width: maxX + MARGIN, height: maxY + MARGIN };
}

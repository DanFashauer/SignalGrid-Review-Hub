import test from "node:test";
import assert from "node:assert/strict";
import { layoutFacilityGraph, type GraphNodeInput } from "./facilityGraphLayout.ts";

const chain: GraphNodeInput[] = [
  { spaceId: "org", kind: "organization", name: "Org", parentId: null },
  { spaceId: "campus", kind: "campus", name: "Campus", parentId: "org" },
];

test("a root sits at depth 0, its only child one row below", () => {
  const layout = layoutFacilityGraph(chain);
  const org = layout.nodes.find((n) => n.spaceId === "org")!;
  const campus = layout.nodes.find((n) => n.spaceId === "campus")!;
  assert.ok(campus.y > org.y);
});

test("every parent→child relationship becomes a parent edge", () => {
  const layout = layoutFacilityGraph(chain);
  assert.deepEqual(
    layout.edges.filter((e) => e.kind === "parent"),
    [{ from: "org", to: "campus", kind: "parent" }],
  );
});

test("a door's connects target becomes a door edge, distinct from parent edges", () => {
  const withDoor: GraphNodeInput[] = [
    { spaceId: "room", kind: "room", name: "Room", parentId: null },
    { spaceId: "corridor", kind: "room", name: "Corridor", parentId: null },
    { spaceId: "door", kind: "door", name: "Door", parentId: "room", connects: ["corridor"] },
  ];
  const layout = layoutFacilityGraph(withDoor);
  assert.deepEqual(
    layout.edges.filter((e) => e.kind === "door"),
    [{ from: "door", to: "corridor", kind: "door" }],
  );
});

test("siblings never share a column, and a parent centers over its children", () => {
  const forked: GraphNodeInput[] = [
    { spaceId: "root", kind: "room", name: "Root", parentId: null },
    { spaceId: "a", kind: "bed", name: "A", parentId: "root" },
    { spaceId: "b", kind: "bed", name: "B", parentId: "root" },
  ];
  const layout = layoutFacilityGraph(forked);
  const [a, b, root] = ["a", "b", "root"].map((id) => layout.nodes.find((n) => n.spaceId === id)!);
  assert.notEqual(a.x, b.x);
  assert.equal(root.x, (a.x + b.x) / 2);
});

test("layout is deterministic — same input, same output, every time", () => {
  const first = layoutFacilityGraph(chain);
  const second = layoutFacilityGraph(chain);
  assert.deepEqual(first, second);
});

test("a node whose parentId points outside the given set is treated as a root, not dropped", () => {
  const orphan: GraphNodeInput[] = [{ spaceId: "x", kind: "room", name: "X", parentId: "not-in-this-set" }];
  const layout = layoutFacilityGraph(orphan);
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.nodes[0].y, 60); // MARGIN, i.e. depth 0
});

test("width and height cover every laid-out node", () => {
  const layout = layoutFacilityGraph(chain);
  for (const n of layout.nodes) {
    assert.ok(n.x <= layout.width);
    assert.ok(n.y <= layout.height);
  }
});

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

// A parentId cycle has no root to descend from. The module promises a partial graph
// "still lays out instead of silently dropping nodes": a cycle must not vanish either.
const ids = (layout: ReturnType<typeof layoutFacilityGraph>) => layout.nodes.map((n) => n.spaceId);
const finiteAndCovered = (layout: ReturnType<typeof layoutFacilityGraph>) => {
  for (const n of layout.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `finite coordinates for ${n.spaceId}`);
    assert.ok(n.x <= layout.width && n.y <= layout.height, `bounds cover ${n.spaceId}`);
  }
};

test("a node that is its own parent is kept, not dropped", () => {
  const input: GraphNodeInput[] = [{ spaceId: "x", kind: "room", name: "X", parentId: "x" }];
  const layout = layoutFacilityGraph(input);
  assert.deepEqual(ids(layout), ["x"]);
  finiteAndCovered(layout);
  assert.deepEqual(layout.edges, [{ from: "x", to: "x", kind: "parent" }]);
});

test("a two-node parent cycle keeps both nodes", () => {
  const input: GraphNodeInput[] = [
    { spaceId: "a", kind: "room", name: "A", parentId: "b" },
    { spaceId: "b", kind: "room", name: "B", parentId: "a" },
  ];
  const layout = layoutFacilityGraph(input);
  assert.deepEqual(ids(layout), ["a", "b"]);
  finiteAndCovered(layout);
  assert.notEqual(layout.nodes[0].x, layout.nodes[1].x);
});

test("a cycle's descendants are kept with it", () => {
  const input: GraphNodeInput[] = [
    { spaceId: "a", kind: "room", name: "A", parentId: "b" },
    { spaceId: "b", kind: "room", name: "B", parentId: "a" },
    { spaceId: "c", kind: "bed", name: "C", parentId: "a" },
  ];
  const layout = layoutFacilityGraph(input);
  assert.deepEqual(ids(layout), ["a", "b", "c"]);
  finiteAndCovered(layout);
  assert.equal(new Set(layout.nodes.map((n) => n.x)).size, 3);
});

test("a valid tree beside a cycle keeps its exact layout, and the cycle follows it", () => {
  const tree: GraphNodeInput[] = [
    { spaceId: "root", kind: "room", name: "Root", parentId: null },
    { spaceId: "t1", kind: "bed", name: "T1", parentId: "root" },
    { spaceId: "t2", kind: "bed", name: "T2", parentId: "root" },
  ];
  const cycle: GraphNodeInput[] = [
    { spaceId: "p", kind: "room", name: "P", parentId: "q" },
    { spaceId: "q", kind: "room", name: "Q", parentId: "p" },
  ];
  const alone = layoutFacilityGraph(tree);
  const mixed = layoutFacilityGraph([...cycle, ...tree]);
  assert.equal(mixed.nodes.length, 5);
  for (const n of alone.nodes) assert.deepEqual(mixed.nodes.find((m) => m.spaceId === n.spaceId), n, `tree node ${n.spaceId} unchanged`);
  const treeMaxX = Math.max(...alone.nodes.map((n) => n.x));
  for (const id of ["p", "q"]) assert.ok(mixed.nodes.find((m) => m.spaceId === id)!.x > treeMaxX, `${id} placed after the tree`);
  assert.deepEqual(mixed.edges, [
    { from: "q", to: "p", kind: "parent" },
    { from: "p", to: "q", kind: "parent" },
    { from: "root", to: "t1", kind: "parent" },
    { from: "root", to: "t2", kind: "parent" },
  ]);
  finiteAndCovered(mixed);
});

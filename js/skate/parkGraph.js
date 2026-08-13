// The park graph: a lightweight map of how a park's skateable features
// connect to each other.
//
// Each skateable object in a park file becomes a node carrying its kind,
// difficulty, grindability, tags and ground footprint; two nodes get an edge
// when their footprints are close enough (or overlap) that a line between
// them is plausible. That is deliberately not a path-finding graph yet — it
// is the *line* skeleton future AI can route over: a route through a park is
// a walk over these edges, and each node already describes what kind of
// feature the rideable ends and what it will take to skate it.
//
// The graph is pure data computed from the same plain object list the editor
// and the game both use, so it can never disagree with what is actually
// rideable. Nothing here touches THREE or the DOM — it is safe to run in the
// audit tools and on the server.

import { objectType, boundsOf, objectMeta, newObject } from './parkObjects.js';

/** Footprints within this many metres of each other are considered linked.
 * Bigger gaps mean a real run between features, not a connection. */
export const LINK_GAP = 3;
/** Overlap (or a near-miss) within this distance reads as a shared edge. */
export const OVERLAP_GAP = 0.5;
/** Cap links per node, so a dense cluster of pads does not produce a
 * complete graph the size of the park. */
export const MAX_LINKS = 8;

/** How far apart two footprints are: the horizontal distance between their
 * edges — 0 when they overlap. */
export function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dz = Math.max(0, Math.max(a.z0 - b.z1, b.z0 - a.z1));
  return Math.hypot(dx, dz);
}

/**
 * Build the graph for a list of park objects (the same `objects` a park file
 * carries, or a built-in map's `_objects`).
 *
 * Returns `{ nodes, edges }`:
 *   nodes[i] = { id, type, label, kind, x, z, bounds, meta }
 *   edges[j] = { from, to, kind: 'overlap' | 'adjacent', gap, length }
 */
export function buildParkGraph(objects) {
  const nodes = [];
  for (const raw of objects) {
    // Objects carry every editable param; the transform fields (sx/sy/sz, y)
    // default to their neutral values and may be absent from hand-authored
    // layouts — merge the type's defaults the same way buildObjects does.
    const o = { ...newObject(raw.type), ...raw };
    const t = objectType(o.type);
    const meta = objectMeta(o);
    // A purely decorative object (a hoop) has no rideable surface — it is
    // scenery, and a line that dead-ends into it helps nobody.
    if (meta.kind === 'deco') continue;
    const b = boundsOf(o);
    if (!Number.isFinite(b.x0) || !Number.isFinite(b.z0)) continue;
    nodes.push({
      id: o.id,
      type: t.id,
      label: t.label,
      kind: meta.kind,
      x: (b.x0 + b.x1) / 2,
      z: (b.z0 + b.z1) / 2,
      bounds: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 },
      meta: {
        kind: meta.kind,
        grindable: meta.grindable,
        difficulty: meta.difficulty,
        tags: meta.tags,
        dimensions: meta.dimensions,
      },
    });
  }

  const edges = [];
  const links = new Map(nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const gap = gapBetween(a.bounds, b.bounds);
      if (gap > LINK_GAP) continue;
      if (links.get(a.id) >= MAX_LINKS || links.get(b.id) >= MAX_LINKS) continue;
      edges.push({
        from: a.id,
        to: b.id,
        kind: gap <= OVERLAP_GAP ? 'overlap' : 'adjacent',
        gap: Math.round(gap * 100) / 100,
        length: Math.round(Math.hypot(b.x - a.x, b.z - a.z) * 100) / 100,
      });
      links.set(a.id, links.get(a.id) + 1);
      links.set(b.id, links.get(b.id) + 1);
    }
  }

  return { nodes, edges };
}

/** A short human-readable summary of a graph, for debugging and the tools. */
export function summarizeGraph(graph) {
  const kinds = {};
  for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    kinds,
  };
}

// The park graph: a lightweight, deterministic map of how a park's skateable
// features connect to each other, and of the actual skate lines that flow
// through them.
//
// Each skateable object in a park file becomes a node carrying its kind,
// difficulty, grindability, tags, dimensions, height and ground footprint;
// two nodes get a *directed* edge when their footprints are close enough (or
// overlap) that riding between them is plausible. An edge carries the distance
// of the gap, the length of the ride between centres, the height difference,
// the slope, the heading and a difficulty — plus a `flow` flag that says the
// jump between those two kinds is a recognised skate line (stair → rail →
// ledge → quarter/bank and friends).
//
// On top of the raw graph sit three helpers the future AI modes (Challenge
// Generator, Skate Crew, Tournament) are expected to route over:
//   - findLines()      — the sequences of features that read as real lines
//   - nearestSkate()   — the nearest features to a world point
//   - routesBetween()  — the flow-friendly ways to get from one feature to
//                        another
//
// The graph is pure data computed from the same plain object list the editor
// and the game both use, so it can never disagree with what is actually
// rideable. Nothing here touches THREE or the DOM — it is safe to run in the
// audit tools and on the server. Every pass is ordered, so the same park file
// always produces the same graph, node for node and edge for edge.

import { objectType, boundsOf, objectMeta, newObject } from './parkObjects.js';

/** Footprints within this many metres of each other are considered linked.
 * Bigger gaps mean a real run between features, not a connection. */
export const LINK_GAP = 3;
/** Overlap (or a near-miss) within this distance reads as a shared edge. */
export const OVERLAP_GAP = 0.5;
/** Cap links per node, so a dense cluster of pads does not produce a
 * complete graph the size of the park. */
export const MAX_LINKS = 8;
/** A line is at most this many hops long (3 hops = a 4-feature line). */
export const MAX_LINE_HOPS = 3;
/** How many lines each feature may be the start of, before the search moves on. */
export const MAX_LINES_PER_START = 4;
/** A route between two features is at most this many hops. */
export const MAX_ROUTE_HOPS = 6;
/** The most routes any one query will hand back. */
export const MAX_ROUTES = 3;

/** The feature kinds that hand off to each other to read as a real skate
 * line. Both the edge `flow` flag and findLines() are driven by this table,
 * so the graph and the line finder can never disagree about what counts as a
 * line. A transition means quarter, bank, roll-in, mini, vert, spine, bowl or
 * funbox — anything with an arc the skater launches off.
 *
 * The issue's canonical sequence stair → rail → ledge → quarter/bank is here:
 * stair flows to rail/ledge/transition, rail to ledge/transition, ledge to
 * transition. */
export const FLOW = {
  stair: ['rail', 'ledge', 'transition', 'flat', 'stair'],
  rail: ['rail', 'ledge', 'transition', 'flat'],
  ledge: ['ledge', 'rail', 'transition', 'flat'],
  transition: ['transition', 'rail', 'ledge', 'stair', 'flat'],
  flat: ['flat', 'rail', 'ledge', 'transition'],
};

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

/** How far apart two footprints are: the horizontal distance between their
 * edges — 0 when they overlap. */
export function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dz = Math.max(0, Math.max(a.z0 - b.z1, b.z0 - a.z1));
  return Math.hypot(dx, dz);
}

/** The horizontal distance from a point to a bounds rectangle — 0 when the
 * point is inside the footprint. Used by nearestSkate so a long rail counts as
 * close along its whole length, not just at its centre. */
export function distanceToBounds(b, x, z) {
  const dx = Math.max(b.x0 - x, 0, x - b.x1);
  const dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dz);
}

// The object's own local axes snapped to the world, exactly as parkObjects
// maps them. Local +z is "forward", local +x "right"; a quarter-turn of `ry`
// rotates that frame. Replicated here (rather than importing the private
// frame()) so the graph can describe a feature's ride direction without
// depending on the palette internals.
function frameOf(o) {
  const q = ((Math.round((o.ry || 0) / 90) % 4) + 4) % 4;
  return {
    fx: [0, 1, 0, -1][q],
    fz: [1, 0, -1, 0][q],
    rx: [1, 0, -1, 0][q],
    rz: [0, -1, 0, 1][q],
  };
}

/** The unit world vector a feature's primary ride runs along, or null when the
 * feature has no single direction (a slab, a bowl). A rail or ledge rides down
 * its bar (local +x); a ramp, bank or stair set rides along its length
 * (local +z). */
export function forwardOf(o) {
  const f = frameOf(o);
  switch (o.type) {
    case 'rail':
    case 'ledge':
      return { x: f.rx, z: f.rz };
    case 'bank':
    case 'stairs':
    case 'quarter':
    case 'rollin':
    case 'spine':
    case 'mini':
    case 'vert':
    case 'funbox':
      return { x: f.fx, z: f.fz };
    default:
      return null;
  }
}

/** The height of a feature's topmost rideable surface, from the same params
 * its builder reads — so the edge's `rise` between two features is the actual
 * drop/launch a skater would take, not an estimate. */
export function topOf(o) {
  const y = o.y || 0;
  const h = (v) => v * (o.sy || 1);
  switch (o.type) {
    case 'slab':
      return h(o.h) + y;
    case 'bank':
      return h(o.h) + y;
    case 'quarter':
    case 'mini':
    case 'vert':
    case 'rollin':
    case 'spine':
    case 'bowl':
      return Math.min(h(o.H), o.R - 0.05) + y;
    case 'stairs':
      return o.steps * h(o.rise) + y;
    case 'rail':
    case 'ledge':
    case 'funbox':
      return h(o.h) + y;
    default:
      return y;
  }
}

/**
 * Build the graph for a list of park objects (the same `objects` a park file
 * carries, or a built-in map's `_objects`).
 *
 * Returns `{ nodes, edges }`:
 *   nodes[i] = { id, type, label, kind, x, z, y, topY, forward, axis, bounds,
 *                meta }
 *   edges[j] = a *directed* skate-line edge:
 *                { from, to, kind: 'overlap' | 'adjacent', gap, length, rise,
 *                  grade, heading, dir, difficulty, flow }
 *
 * Two edges are emitted for every linked pair — one in each direction — so the
 * graph reads as a directed map of possible lines while keeping the same
 * connectivity (and the same LINK_GAP/MAX_LINKS behaviour) as before.
 */
export function buildParkGraph(objects) {
  const nodes = [];
  for (let index = 0; index < objects.length; index++) {
    const raw = objects[index];
    // Objects carry every editable param; the transform fields (sx/sy/sz, y)
    // default to their neutral values and may be absent from hand-authored
    // layouts — merge the type's defaults the same way buildObjects does.
    const o = { ...newObject(raw.type), ...raw };
    // The node id must be stable: a saved park keeps its own ids, and an
    // id-less authored layout (a built-in map's `_objects`) falls back to its
    // list position, so the same objects always produce the same graph. The
    // fresh uid() that newObject mints is deliberately not used here.
    const id = typeof raw.id === 'string' && raw.id ? raw.id : `#${index}`;
    const t = objectType(o.type);
    const meta = objectMeta(o);
    // A purely decorative object (a hoop) has no rideable surface — it is
    // scenery, and a line that dead-ends into it helps nobody.
    if (meta.kind === 'deco') continue;
    const b = boundsOf(o);
    if (!Number.isFinite(b.x0) || !Number.isFinite(b.z0)) continue;
    const f = forwardOf(o);
    nodes.push({
      id,
      type: t.id,
      label: t.label,
      kind: meta.kind,
      x: (b.x0 + b.x1) / 2,
      z: (b.z0 + b.z1) / 2,
      y: Math.round((o.y || 0) * 100) / 100,
      topY: r1(topOf(o)),
      forward: f ? { x: r4(f.x), z: r4(f.z) } : null,
      axis: f && f.x !== 0 ? 'x' : f && f.z !== 0 ? 'z' : null,
      bounds: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 },
      meta: {
        kind: meta.kind,
        grindable: meta.grindable,
        difficulty: meta.difficulty,
        tags: meta.tags,
        dimensions: meta.dimensions,
        transform: meta.transform,
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
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const heading = Math.atan2(b.z - a.z, b.x - a.x);
      edges.push(
        {
          from: a.id,
          to: b.id,
          kind: gap <= OVERLAP_GAP ? 'overlap' : 'adjacent',
          gap: r1(gap),
          length: r1(length),
          rise: r1(b.topY - a.topY),
          grade: r3((b.topY - a.topY) / Math.max(1, length)),
          heading: r3(heading),
          dir: { x: r4(Math.cos(heading)), z: r4(Math.sin(heading)) },
          difficulty: edgeDifficulty(a, b, gap, b.topY - a.topY),
          flow: FLOW[a.kind].includes(b.kind),
        },
        {
          from: b.id,
          to: a.id,
          kind: gap <= OVERLAP_GAP ? 'overlap' : 'adjacent',
          gap: r1(gap),
          length: r1(length),
          rise: r1(a.topY - b.topY),
          grade: r3((a.topY - b.topY) / Math.max(1, length)),
          heading: r3(Math.atan2(a.z - b.z, a.x - b.x)),
          dir: { x: r4(-Math.cos(heading)), z: r4(-Math.sin(heading)) },
          difficulty: edgeDifficulty(b, a, gap, a.topY - b.topY),
          flow: FLOW[b.kind].includes(a.kind),
        }
      );
      links.set(a.id, links.get(a.id) + 1);
      links.set(b.id, links.get(b.id) + 1);
    }
  }

  return { nodes, edges };
}

/** How hard it is to get from one feature to the next: the harder of the two
 * features, bumped for a gap that needs an air transfer and for a real drop or
 * launch. Stays in the palette's 1–5 band. */
export function edgeDifficulty(a, b, gap, rise) {
  let d = Math.max(a.meta.difficulty, b.meta.difficulty);
  if (gap > 1.5) d += 1;
  if (Math.abs(rise) > 1.2) d += 1;
  return Math.min(5, Math.max(1, Math.round(d)));
}

function nodeMapOf(graph) {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** Directed neighbour lists, ordered so flow edges come first, then shorter
 * rides, then stable ids — the order every search below walks, which is what
 * keeps their results deterministic. */
function adjacencyOf(graph) {
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) adj.get(e.from).push({ to: e.to, edge: e });
  for (const list of adj.values()) {
    list.sort(
      (p, q) =>
        (q.edge.flow - p.edge.flow) ||
        p.edge.length - q.edge.length ||
        p.edge.to.localeCompare(q.edge.to) ||
        p.edge.gap - q.edge.gap
    );
  }
  return adj;
}

/**
 * The possible lines through a park: every chain of features whose kinds hand
 * off along the FLOW table, up to `MAX_LINE_HOPS` hops long. The issue's
 * canonical line (stair → rail → ledge → quarter/bank) shows up here whenever
 * a park actually puts those features within skating distance of each other.
 *
 * Options:
 *   from      — only lines that start at this node id (default: every node)
 *   maxHops   — longest line in hops (default MAX_LINE_HOPS = 3)
 *   max       — lines per start feature (default MAX_LINES_PER_START = 4)
 *
 * Returns an array of `{ nodes, kinds, labels, length, rise, difficulty,
 * hops, desc }`, ordered deterministically.
 */
export function findLines(graph, opts = {}) {
  const maxHops = Math.max(1, opts.maxHops || MAX_LINE_HOPS);
  const maxLines = opts.max || MAX_LINES_PER_START;
  const startId = opts.from;
  const adj = adjacencyOf(graph);
  const byId = nodeMapOf(graph);
  const lines = [];
  const starts = startId ? [startId] : graph.nodes.map((n) => n.id);

  for (const id of starts) {
    if (!byId.has(id)) continue;
    const seen = new Set([id]);
    const queue = [{ path: [id], length: 0, rise: 0, difficulty: 0, hops: 0 }];
    let emitted = 0;
    while (queue.length && emitted < maxLines) {
      const cur = queue.shift();
      if (cur.hops > 0) {
        lines.push({
          nodes: [...cur.path],
          kinds: cur.path.map((nid) => byId.get(nid).kind),
          labels: cur.path.map((nid) => byId.get(nid).label),
          length: r1(cur.length),
          rise: r1(cur.rise),
          difficulty: cur.difficulty,
          hops: cur.hops,
          desc: cur.path.map((nid) => byId.get(nid).label).join(' → '),
        });
        emitted++;
        if (emitted >= maxLines) break;
      }
      if (cur.hops >= maxHops) continue;
      const last = cur.path[cur.path.length - 1];
      for (const { to, edge } of adj.get(last) || []) {
        if (!edge.flow || seen.has(to)) continue;
        seen.add(to);
        queue.push({
          path: [...cur.path, to],
          length: cur.length + edge.length,
          rise: cur.rise + edge.rise,
          difficulty: Math.max(cur.difficulty, edge.difficulty),
          hops: cur.hops + 1,
        });
      }
    }
  }
  return lines;
}

/**
 * The skateable features nearest to a world point, closest first. A feature is
 * as close as its footprint: a long rail counts as near along its whole bar.
 *
 * Options (all optional):
 *   kind    — only nodes of this kind (e.g. 'rail')
 *   kinds   — only nodes of any of these kinds
 *   tag     — only nodes carrying this tag (e.g. 'coping')
 *   max     — how many to return (default: all, sorted)
 *
 * Returns `[{ node, distance }]`.
 */
export function nearestSkate(graph, x, z, opts = {}) {
  const { kind, kinds, tag, max = Infinity } = opts;
  const out = [];
  for (const n of graph.nodes) {
    if (kind && n.kind !== kind) continue;
    if (kinds && !kinds.includes(n.kind)) continue;
    if (tag && !(n.meta.tags || []).includes(tag)) continue;
    out.push({ node: n, distance: distanceToBounds(n.bounds, x, z) });
  }
  out.sort((p, q) => p.distance - q.distance || p.node.id.localeCompare(q.node.id));
  return max === Infinity ? out : out.slice(0, max);
}

/**
 * Routes from one feature to another, flow first: neighbours that continue a
 * recognised line are walked before plain connections, so the routes a future
 * AI gets are the ones that actually make sense to skate, and the shortest of
 * those win. Lightweight by design — a bounded breadth-first walk, no
 * path-finding machinery.
 *
 * Options:
 *   maxHops — longest route in hops (default MAX_ROUTE_HOPS = 6)
 *   max     — most routes to return (default MAX_ROUTES = 3)
 *
 * Returns `{ routes: [{ nodes, length, rise, difficulty, hops, desc }] }`
 * sorted by total ride length.
 */
export function routesBetween(graph, fromId, toId, opts = {}) {
  const maxHops = opts.maxHops || MAX_ROUTE_HOPS;
  const max = opts.max || MAX_ROUTES;
  const adj = adjacencyOf(graph);
  const byId = nodeMapOf(graph);
  const routes = [];
  const best = new Map([[fromId, 0]]);
  const queue = [{ path: [fromId], length: 0, rise: 0, difficulty: 0, hops: 0 }];

  while (queue.length && routes.length < max) {
    const cur = queue.shift();
    const last = cur.path[cur.path.length - 1];
    if (last === toId) {
      routes.push({
        nodes: [...cur.path],
        length: r1(cur.length),
        rise: r1(cur.rise),
        difficulty: cur.difficulty,
        hops: cur.hops,
        desc: cur.path.map((nid) => byId.get(nid).label).join(' → '),
      });
      continue;
    }
    if (cur.hops >= maxHops) continue;
    for (const { to, edge } of adj.get(last) || []) {
      if (cur.path.includes(to)) continue;
      const hops = cur.hops + 1;
      const seen = best.get(to);
      if (to !== toId && seen !== undefined && seen <= hops) continue;
      best.set(to, hops);
      queue.push({
        path: [...cur.path, to],
        length: cur.length + edge.length,
        rise: cur.rise + edge.rise,
        difficulty: Math.max(cur.difficulty, edge.difficulty),
        hops,
      });
    }
  }

  routes.sort((p, q) => p.length - q.length || p.hops - q.hops);
  return { routes: routes.slice(0, max) };
}

/** A short human-readable summary of a graph, for debugging and the tools. */
export function summarizeGraph(graph) {
  const kinds = {};
  for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  const edgeKinds = {};
  let flows = 0;
  for (const e of graph.edges) {
    if (e.flow) flows++;
    edgeKinds[e.kind] = (edgeKinds[e.kind] || 0) + 1;
  }
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    kinds,
    edgeKinds,
    flows,
  };
}

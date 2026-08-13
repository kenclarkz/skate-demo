// Dev audit for the park graph: every rebuilt/built-in park must produce a
// valid, deterministic, directed graph of skate lines, and the line/nearest/
// route helpers must agree with what is actually in the park.
//
// Pure Node — no DOM, no THREE meshes, no server — because buildParkGraph
// reads only the plain object lists a park file or a built-in map carries.
//
//   node tools/audit-graph.mjs

import { buildParkGraph, summarizeGraph, findLines, nearestSkate, routesBetween, FLOW, LINK_GAP } from '../js/skate/parkGraph.js';
import { PARKS } from '../js/skate/parkLayouts.js';
import { newFile } from '../js/skate/parkFile.js';

let failures = 0;
let checks = 0;

function ok(cond, msg) {
  checks++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

function nodeById(g) {
  return new Map(g.nodes.map((n) => [n.id, n]));
}

// A park where the canonical stair → rail → ledge → quarter/bank line exists.
const CANON = [
  { type: 'stairs', x: 0, z: 0, ry: 0, w: 4, steps: 4, rise: 0.18, run: 0.3 },
  { type: 'rail', x: 0, z: -3, ry: 90, len: 3, h: 0.6 },
  { type: 'ledge', x: 0, z: -6, ry: 90, len: 3, h: 0.6 },
  { type: 'quarter', x: 0, z: -9.5, ry: 180, w: 4, R: 1.8, H: 1.0 },
];

console.log('\nbuilt-in parks');
for (const def of PARKS) {
  console.log(`\n${def.id} (${def.name})`);
  const g = buildParkGraph(def._objects);
  const s = summarizeGraph(g);
  const byId = nodeById(g);

  ok(g.nodes.length > 0, `${g.nodes.length} nodes`);
  ok(s.edges > 0, `${s.edges} directed edges`);

  // Directed edges come in mirrored pairs, both referencing real nodes.
  const reverse = new Map(g.edges.map((e) => [`${e.to}->${e.from}`, e]));
  let allMirrored = true;
  let allReal = true;
  for (const e of g.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) allReal = false;
    if (!reverse.has(`${e.from}->${e.to}`)) allMirrored = false;
    const sameGap = Math.abs(e.gap - reverse.get(`${e.to}->${e.from}`).gap) < 1e-6;
    if (!sameGap) allMirrored = false;
  }
  ok(allReal, 'every edge references a real node');
  ok(allMirrored, 'every edge has its reverse pair');

  // Edges carry the promised skate-line fields.
  let wellFormed = true;
  let flowConsistent = true;
  for (const e of g.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    if (
      !Number.isFinite(e.gap) ||
      !Number.isFinite(e.length) ||
      !Number.isFinite(e.rise) ||
      !Number.isFinite(e.heading) ||
      !Number.isFinite(e.difficulty) ||
      !(e.kind === 'overlap' || e.kind === 'adjacent') ||
      e.gap > LINK_GAP + 1e-6
    ) wellFormed = false;
    if (e.flow !== FLOW[from.kind].includes(to.kind)) flowConsistent = false;
  }
  ok(wellFormed, 'edges carry gap/length/rise/heading/difficulty within LINK_GAP');
  ok(flowConsistent, 'edge flow flags match the FLOW table');

  // Node shape: position, type, difficulty, dimensions, tags, height.
  let nodeShape = true;
  for (const n of g.nodes) {
    if (
      !Number.isFinite(n.x) || !Number.isFinite(n.z) || !Number.isFinite(n.topY) ||
      !n.type || !n.kind || !n.meta ||
      !Number.isFinite(n.meta.difficulty) || !Array.isArray(n.meta.tags) ||
      !n.meta.dimensions || !n.bounds
    ) nodeShape = false;
  }
  ok(nodeShape, 'nodes carry position, type, difficulty, dimensions, tags, bounds, height');

  // The whole graph must be deterministic: same objects in, same graph out.
  let deterministic = true;
  const first = JSON.stringify(g);
  for (let i = 0; i < 5; i++) {
    if (JSON.stringify(buildParkGraph(def._objects)) !== first) deterministic = false;
  }
  ok(deterministic, 'rebuilding produces the identical graph');

  // Nearest-feature queries sort by footprint distance.
  const near = nearestSkate(g, 0, 0, { max: 2 });
  ok(near.length === 2 && near[0].distance <= near[1].distance && near[0].node.id !== near[1].node.id, 'nearestSkate returns sorted unique features');
}

console.log('\ncanonical line park');
{
  const g = buildParkGraph(CANON);
  const byId = nodeById(g);
  const lines = findLines(g);
  const seq = lines.some(
    (l) => l.kinds.join(',') === 'stair,rail,ledge,transition'
  );
  ok(seq, 'stair → rail → ledge → quarter/bank is detected as a line');

  ok(lines.length >= 1 && lines.every((l) => l.nodes.length >= 2), 'findLines returns hop chains of at least two features');

  // Every edge's `flow` is honoured by findLines: only flow edges are walked.
  const flowOnly = lines.every((l) => {
    for (let i = 0; i < l.nodes.length - 1; i++) {
      const e = g.edges.find((x) => x.from === l.nodes[i] && x.to === l.nodes[i + 1]);
      if (!e || !e.flow) return false;
    }
    return true;
  });
  ok(flowOnly, 'lines only follow flow edges');

  // Routes between the ends of the line exist and are honest.
  const { routes } = routesBetween(g, byId.get('#0').id, byId.get('#3').id, { max: 5 });
  ok(
    routes.length > 0 &&
      routes.every((r) => r.nodes[0] === '#0' && r.nodes[r.nodes.length - 1] === '#3') &&
      routes[0].nodes.length >= 2,
    'routesBetween finds a route between the line endpoints'
  );
}

console.log('\nempty park file');
{
  const file = newFile();
  const g = buildParkGraph(file.objects);
  const s = summarizeGraph(g);
  ok(g.nodes.length === 0 && s.edges === 0, 'an empty park has an empty graph');
}

console.log(`\n${failures ? failures + ' problem(s) found' : 'park graph audit clean'} (${checks} checks)`);
process.exit(failures ? 1 : 0);

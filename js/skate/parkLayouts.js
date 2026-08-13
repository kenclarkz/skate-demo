// The built-in map, rebuilt out of the same Park Suite objects a player
// builds with (see parkObjects.js). The original `build(p)` was decomposed
// into a list of slabs, banks, quarters, stairs, rails and ledges authored
// directly in world units, so a def can opt out of TRACK_SCALE (`scale: 1`)
// and its layout is exactly what gets ridden — the same promise a saved
// player-built park makes.
//
// Home Park is the only built-in map; everything else on the Parks screen is
// the player's own, saved from the designer.
//
// Three kinds of original feature are deliberately not reproduced exactly:
//
//   - Sloped handrails (a rail whose two ends are at different heights) come
//     back as a level bar at the same midpoint, because a Park Suite rail is
//     always level. The audit accepts those as replacements.
//   - Grind lines sitting at y = 0 (a ledge whose edge would be on the flat
//     ground) are dropped, since a ledge object cannot be 0 m tall.
//   - A decorative hoop has no collision or grind, so it is not rebuilt.

import { buildObjects } from './parkObjects.js';
import { buildParkGraph } from './parkGraph.js';

function def(id, name, blurb, opts, objects) {
  return {
    id,
    name,
    blurb,
    ...opts,
    scale: 1,
    _objects: objects,
    // The connection graph between this map's skateable features — computed
    // once here so every Park built from the def carries it without Park
    // itself needing to know how a graph is produced.
    _graph: buildParkGraph(objects),
    build(p) {
      buildObjects(p, objects);
    },
  };
}

export const PARKS = [
  def(
    'home',
    'Home Park',
    'Flow-first design: pump the transitions, transfer the spine, carve the hip.',
    {
      seed: 0x51ed,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -28, yaw: 0 },
      patrol: [
        { x: 0, z: -32 }, { x: 20, z: -16 }, { x: 20, z: 16 }, { x: 0, z: 32 },
        { x: -20, z: 16 }, { x: -20, z: -16 },
      ],
      logos: [
        { x: 0, z: -16 }, { x: -16, z: 0 }, { x: 20, z: 0 }, { x: 0, z: 24 },
        { x: 36, z: 22 }, { x: -38, z: -8 },
      ],
    },
    [
      // North roll-in: the big quarterpipe with a deep platform behind the lip.
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 52, R: 2.9, H: 2.1, deck: 15.3, color: 'wood' },
      // Spine: two back-to-back quarters for transfers.
      { type: 'spine', x: 0, z: 4, ry: 0, w: 28, R: 2.0, H: 1.5, gap: 4, color: 'wood' },
      // Banked hip on the east: bank up, deck, carve back down.
      { type: 'bank', x: 34, z: 22, ry: 90, w: 20, len: 20, h: 1.3, color: 'wood' },
      { type: 'slab', x: 34, z: 36, ry: 0, w: 20, d: 8, h: 1.3, color: 'concrete' },
      // West bank feeding the spine.
      { type: 'bank', x: -42, z: 0, ry: 270, w: 32, len: 12, h: 1.6, color: 'wood' },
      { type: 'slab', x: -50, z: 0, ry: 0, w: 4, d: 32, h: 1.6, color: 'concrete' },
      { type: 'ledge', x: -48.6, z: 0, ry: 90, len: 32, h: 1.6, color: 'concrete' },
      // Kicker: small quarter for airs before the south transition.
      { type: 'quarter', x: -37, z: 10, ry: 180, w: 6, R: 1.8, H: 0.9, color: 'wood' },
      // South roll-in: smaller, for pumping back the other way. Sized so its
      // platform ends at z ≈ -58, mirroring the north roll-in's reach.
      { type: 'rollin', x: 0, z: -44, ry: 180, w: 40, R: 2.4, H: 1.6, deck: 11.82, color: 'wood' },
      // Funbox: bank up, flat rail and ledge edges across the top, bank down.
      { type: 'bank', x: 0, z: -13, ry: 0, w: 12.8, len: 6, h: 0.65, color: 'wood' },
      { type: 'slab', x: 0, z: -7, ry: 0, w: 12.8, d: 6, h: 0.65, color: 'concrete' },
      { type: 'bank', x: 0, z: -1, ry: 180, w: 12.8, len: 6, h: 0.65, color: 'wood' },
      { type: 'rail', x: 0, z: -10, ry: 90, len: 12.4, h: 0.97, r: 0.03, color: 'steel' },
      { type: 'ledge', x: -5.8, z: -7, ry: 270, len: 6, h: 0.65, color: 'concrete' },
      { type: 'ledge', x: 5.8, z: -7, ry: 90, len: 6, h: 0.65, color: 'concrete' },
      // East manual pad: bank up to a raised pad with grindable edges.
      { type: 'bank', x: 11, z: 0, ry: 90, w: 12, len: 6, h: 0.55, color: 'wood' },
      { type: 'slab', x: 22, z: 0, ry: 0, w: 16, d: 12, h: 0.55, color: 'concrete' },
      { type: 'ledge', x: 22, z: 5.4, ry: 0, len: 16, h: 0.55, color: 'concrete' },
      { type: 'ledge', x: 22, z: -5.4, ry: 180, len: 16, h: 0.55, color: 'concrete' },
      // Stair set: bank up to a plateau, stairs down the far side, handrail.
      { type: 'bank', x: 32, z: -20, ry: 180, w: 8, len: 8, h: 1.25, color: 'wood' },
      { type: 'slab', x: 32, z: -30, ry: 0, w: 8, d: 12, h: 1.25, color: 'concrete' },
      { type: 'stairs', x: 32, z: -38.8, ry: 0, w: 8, steps: 5, rise: 0.25, run: 1.12, color: 'dark' },
      // The original handrail sloped down the bank; a level bar at its midpoint.
      { type: 'rail', x: 30, z: -30.9, ry: 90, len: 8.2, h: 0.71, color: 'steel' },
      // Flat bars along the flow path — one north-south, one east-west.
      { type: 'rail', x: -22, z: 0, ry: 90, len: 40, h: 0.4, color: 'steel' },
      { type: 'rail', x: -24, z: 0, ry: 0, len: 16, h: 0.4, color: 'steel' },
      // Rails for the hip approach and landing.
      { type: 'rail', x: 24, z: 22, ry: 90, len: 20, h: 0.71, color: 'steel' },
      { type: 'rail', x: 44, z: -18, ry: 90, len: 44, h: 0.42, color: 'steel' },
    ]
  ),
];

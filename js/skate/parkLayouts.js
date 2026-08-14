// The built-in map, rebuilt out of the same Park Suite objects a player
// builds with (see parkObjects.js). The original `build(p)` was decomposed
// into a list of slabs, banks, quarters, stairs, rails and ledges authored
// directly in world units, so a def can opt out of TRACK_SCALE (`scale: 1`)
// and its layout is exactly what gets ridden — the same promise a saved
// player-built park makes.
//
// Home Park and RailWay are the built-in maps; everything else on the Parks
// screen is the player's own, saved from the designer.
//
// Three kinds of original feature are deliberately not reproduced exactly:
//
//   - Sloped handrails (a rail whose two ends are at different heights) come
//     back as a level bar at the same midpoint, because a Park Suite rail is
//     always level. The audit accepts those as replacements. (Park Suite rails
//     have since grown a High End prop, so new sloped rails are real slopes.)
//   - Grind lines sitting at y = 0 (a ledge whose edge would be on the flat
//     ground) are dropped, since a ledge object cannot be 0 m tall.
//   - Decorative pieces (the original hoop, and the benches and planters
//     sprinkled around Home Park today) have no collision or grind — they are
//     scenery, and the rider passes straight through them.

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
    'The Redline: pump the quarterpipes, transfer the spine, carve the hip into the pool.',
    {
      seed: 0x51ed,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#c23a2e',
      spawn: { x: 0, y: 0, z: -28, yaw: 0 },
      patrol: [
        { x: 0, z: -32 }, { x: 20, z: -16 }, { x: 20, z: 24 }, { x: 0, z: 32 },
        { x: -20, z: 26 }, { x: -20, z: -16 },
      ],
      logos: [
        { x: -14, z: -26 }, { x: 14, z: -26 }, { x: -14, z: 24 }, { x: 14, z: 24 },
        { x: -34, z: 20 }, { x: 34, z: -6 },
      ],
    },
    [
      // North roll-in: the big quarterpipe with a deep platform behind the lip.
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 52, R: 2.9, H: 2.1, deck: 15.3, color: '#2ec4b6' },
      // South roll-in: smaller, for pumping back the other way. Sized so its
      // platform ends at z ≈ -58, mirroring the north roll-in's reach.
      { type: 'rollin', x: 0, z: -44, ry: 180, w: 40, R: 2.4, H: 1.6, deck: 11.82, color: '#ffd166' },
      // Spine transfer on the west flank: pump the flat bars, hop the gap,
      // roll out onto the centre line. Kept off x = 0 so the pump line from
      // the funbox to the north quarter stays clean.
      { type: 'spine', x: -14, z: 6, ry: 90, w: 26, R: 2.0, H: 1.5, gap: 4, color: '#9b5de5' },
      // Funbox: bank up, flat rail and ledge edges across the top, bank down.
      { type: 'bank', x: 0, z: -13, ry: 0, w: 12.8, len: 6, h: 0.65, color: '#4cc9f0' },
      { type: 'slab', x: 0, z: -7, ry: 0, w: 12.8, d: 6, h: 0.65, color: '#00bbf9' },
      { type: 'bank', x: 0, z: -1, ry: 180, w: 12.8, len: 6, h: 0.65, color: '#4cc9f0' },
      { type: 'rail', x: 0, z: -10, ry: 90, len: 12.4, h: 0.97, r: 0.03, color: '#e5e7eb' },
      { type: 'ledge', x: -5.8, z: -7, ry: 270, len: 6, h: 0.65, color: '#f8e16c' },
      { type: 'ledge', x: 5.8, z: -7, ry: 90, len: 6, h: 0.65, color: '#f8e16c' },
      // Banked hip on the east: bank up, deck with grindable edges, drop into
      // the pool beyond. The approach rail runs the bank's west foot.
      { type: 'bank', x: 30, z: 24, ry: 90, w: 16, len: 14, h: 1.2, color: '#ff9f1c' },
      { type: 'slab', x: 30, z: 36, ry: 0, w: 16, d: 8, h: 1.2, color: '#ffbe0b' },
      { type: 'ledge', x: 30, z: 39.4, ry: 0, len: 16, h: 1.2, color: '#3a86ff' },
      { type: 'ledge', x: 38.6, z: 36, ry: 270, len: 8, h: 1.2, color: '#3a86ff' },
      // Approach rail running the bank's west foot, clear of the pad's flow.
      { type: 'rail', x: 22.5, z: 24, ry: 90, len: 14, h: 0.71, color: '#e5e7eb' },
      // Pool: drop in off the hip's east ledge, pump around the walls.
      { type: 'bowl', x: 43, z: 36, R: 2.4, H: 1.4, rim: 1.2, color: '#95d5b2' },
      // West bank feeding the flat bars: roll off the slab deck, gain speed
      // east into the grind plaza.
      { type: 'bank', x: -42, z: -18, ry: 270, w: 32, len: 12, h: 1.6, color: '#90be6d' },
      { type: 'slab', x: -50, z: -18, ry: 0, w: 4, d: 32, h: 1.6, color: '#e9edc9' },
      { type: 'ledge', x: -48.6, z: -18, ry: 90, len: 32, h: 1.6, color: '#d4a373' },
      // Kicker: small quarter for airs before the south transition.
      { type: 'quarter', x: -37, z: 10, ry: 180, w: 6, R: 1.8, H: 0.9, color: '#f15bb5' },
      // Stair set: bank up to a plateau, stairs down the far side, handrail.
      { type: 'bank', x: 32, z: -20, ry: 180, w: 8, len: 8, h: 1.25, color: '#b388eb' },
      { type: 'slab', x: 32, z: -30, ry: 0, w: 8, d: 12, h: 1.25, color: '#cdb4db' },
      { type: 'stairs', x: 32, z: -38.8, ry: 0, w: 8, steps: 5, rise: 0.25, run: 1.12, color: '#b388eb' },
      // The original handrail sloped down the bank; a level bar at its midpoint.
      { type: 'rail', x: 30, z: -30.9, ry: 90, len: 8.2, h: 0.71, color: '#e5e7eb' },
      // Flat bars along the flow path — one north-south, one east-west.
      { type: 'rail', x: -22, z: 0, ry: 90, len: 40, h: 0.4, color: '#ff2fa0' },
      { type: 'rail', x: -27, z: 22, ry: 0, len: 10, h: 0.4, color: '#ff2fa0' },
      // Long rail down the east run-off.
      { type: 'rail', x: 44, z: -18, ry: 90, len: 44, h: 0.42, color: '#e5e7eb' },
      // Hoops framing the spine transfer — jump the spine through the rings.
      { type: 'hoop', x: -21, y: 2.2, z: 6, ry: -Math.PI / 2, r: 2.2, tube: 0.12, color: '#e0552f' },
      { type: 'hoop', x: -7, y: 2.2, z: 6, ry: -Math.PI / 2, r: 2.2, tube: 0.12, color: '#e0552f' },
      // Spectator benches on the quiet corners of the pad.
      { type: 'bench', x: 28, z: 52, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: -54, z: -44, ry: 90, len: 3, color: '#6c757d' },
      // Planters dressing the outer edge.
      { type: 'planter', x: 52, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 52, z: -52, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -40, z: 40, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
    ]
  ),

  // Metro Plaza: the streets. A stair block with a handrail anchors the centre
  // line, twin ledges and rails grind the west flank, the funbox and pyramid
  // share the east plaza, and a pair of roll-ins frames a spine transfer at the
  // top of the pad — all within the same pad the players already know.
  def(
    'plaza',
    'Metro Plaza',
    'The streets: pop the centre gap, grind the ledges, transfer the spine.',
    {
      seed: 0xca71,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#2a6f97',
      spawn: { x: 0, y: 0, z: -28, yaw: 0 },
      patrol: [
        { x: 0, z: -32 }, { x: 36, z: 0 }, { x: 0, z: 8 }, { x: -8, z: 30 },
        { x: 0, z: 46 }, { x: -20, z: 16 },
      ],
      logos: [
        { x: -14, z: -26 }, { x: 14, z: -26 }, { x: -14, z: 24 }, { x: 14, z: 24 },
        { x: -34, z: 20 }, { x: 34, z: -6 },
      ],
    },
    [
      // Centre stair block: bank up to the plaza deck, stairs down the north
      // side with a handrail over them.
      { type: 'bank', x: 0, z: -17, ry: 0, w: 10, len: 8, h: 0.9, color: '#e9c46a' },
      { type: 'slab', x: 0, z: -8, ry: 0, w: 10, d: 10, h: 0.9, color: '#e9c46a' },
      { type: 'stairs', x: 0, z: -2.125, ry: 180, w: 10, steps: 5, rise: 0.18, run: 0.35, color: '#f4a261' },
      { type: 'rail', x: 0, z: -2.1, ry: 90, len: 5, h: 1.2, color: '#e5e7eb' },
      // West street line: two ledges with flat bars between them.
      { type: 'ledge', x: -26, z: 0, ry: 90, len: 12, w: 1.2, h: 0.6, color: '#8ab17d' },
      { type: 'ledge', x: -26, z: -16, ry: 90, len: 12, w: 1.2, h: 0.6, color: '#8ab17d' },
      { type: 'rail', x: -20, z: -4, ry: 0, len: 10, h: 0.7, color: '#e5e7eb' },
      { type: 'rail', x: -20, z: 8, ry: 0, len: 10, h: 0.4, color: '#e5e7eb' },
      // East plaza: the funbox and a pyramid, with a long rail behind them.
      { type: 'funbox', x: 26, z: 4, ry: 0, w: 8, d: 6, h: 1.0, R: 1.5, color: '#e76f51' },
      { type: 'pyramid', x: 26, z: -14, ry: 0, w: 6, d: 6, len: 3, h: 1.0, color: '#f4a261' },
      { type: 'rail', x: 26, z: 14, ry: 0, len: 10, h: 0.85, color: '#e5e7eb' },
      // North: the plaza deck — twin roll-ins framing a spine transfer.
      { type: 'rollin', x: -22, z: 34, ry: 0, w: 20, R: 2.2, H: 1.5, deck: 8, color: '#264653' },
      { type: 'rollin', x: 22, z: 34, ry: 0, w: 20, R: 2.2, H: 1.5, deck: 8, color: '#264653' },
      { type: 'spine', x: 0, z: 34, ry: 90, w: 14, R: 2.0, H: 1.4, gap: 4, color: '#8ab17d' },
      // North-west corner: bank up to a ledge deck.
      { type: 'bank', x: -42, z: 18, ry: 270, w: 32, len: 12, h: 1.6, color: '#8ab17d' },
      { type: 'slab', x: -50, z: 18, ry: 0, w: 4, d: 32, h: 1.6, color: '#e9c46a' },
      { type: 'ledge', x: -48.6, z: 18, ry: 90, len: 32, w: 1.0, h: 1.6, color: '#f4a261' },
      // Benches and planters dressing the edges.
      { type: 'bench', x: -50, z: -44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 50, z: -44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'planter', x: 50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
    ]
  ),

  // Vert Rampage: the vert house. A full vert ramp and twin minis at the south,
  // two pools flanking a spine transfer in the middle, quarterpipes on the
  // walls and a long roll-in at the top of the pad.
  def(
    'vert',
    'Vert Rampage',
    'Big walls, twin pools and a spine: the vert house.',
    {
      seed: 0xbad0,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#7f5539',
      spawn: { x: 0, y: 0, z: -28, yaw: 0 },
      patrol: [
        { x: 0, z: -32 }, { x: 0, z: -19 }, { x: 16, z: 0 }, { x: 0, z: 10 },
        { x: 0, z: 30 }, { x: 26, z: 30 }, { x: -26, z: 30 }, { x: 0, z: 56 },
      ],
      logos: [
        { x: -14, z: -26 }, { x: 14, z: -26 }, { x: -16, z: 14 }, { x: 16, z: 14 },
        { x: 0, z: 0 }, { x: 32, z: -30 },
      ],
    },
    [
      // Big-air centrepiece: a full vert ramp, rims running north-south.
      { type: 'vert', x: 0, z: -8, ry: 90, w: 14, R: 3.5, H: 3.0, flat: 6, deck: 2.5, color: '#264653' },
      // Twin mini ramps framing the big one.
      { type: 'mini', x: -24, z: -8, ry: 0, w: 12, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: '#e76f51' },
      { type: 'mini', x: 24, z: -8, ry: 0, w: 12, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: '#e76f51' },
      // Pool section: two bowls with a spine transfer between them.
      { type: 'bowl', x: -20, z: 22, R: 2.4, H: 1.4, rim: 1.2, color: '#2a9d8f' },
      { type: 'bowl', x: 20, z: 22, R: 2.4, H: 1.4, rim: 1.2, color: '#2a9d8f' },
      { type: 'spine', x: 0, z: 20, ry: 0, w: 20, R: 2.0, H: 1.4, gap: 4, color: '#8ab17d' },
      // Roll-in at the top of the pad.
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 44, R: 2.4, H: 1.6, deck: 12, color: '#e9c46a' },
      // Quarterpipes on the east and west walls.
      { type: 'quarter', x: -44, z: 6, ry: 90, w: 16, R: 2.0, H: 1.3, deck: 0, color: '#f4a261' },
      { type: 'quarter', x: 44, z: 6, ry: 270, w: 16, R: 2.0, H: 1.3, deck: 0, color: '#f4a261' },
      // Ledges down the flanks of the roll-in deck.
      { type: 'ledge', x: -32, z: 38, ry: 90, len: 14, w: 1.2, h: 0.6, color: '#8ab17d' },
      { type: 'ledge', x: 32, z: 38, ry: 90, len: 14, w: 1.2, h: 0.6, color: '#8ab17d' },
      // A rail on the jump line out of spawn.
      { type: 'rail', x: 0, z: -22, ry: 0, len: 12, h: 0.7, color: '#e5e7eb' },
      // Benches and planters dressing the edges.
      { type: 'bench', x: -50, z: -44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 50, z: -44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'planter', x: -50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
  def(
    'railway',
    'RailWay',
    'A dark rail yard of pyramids and rails — pump the main line, work the long and short bars, then take the steep climb to the tall drop.',
    {
      seed: 0x7e11,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#565a60',
      spawn: { x: 0, y: 0, z: -44, yaw: 0 },
      patrol: [
        { x: 0, z: -54 }, { x: 44, z: -54 }, { x: 44, z: -2 }, { x: 44, z: 54 },
        { x: 0, z: 54 }, { x: -44, z: 54 }, { x: -44, z: -2 }, { x: -44, z: -54 },
      ],
      logos: [
        { x: 0, z: -52 }, { x: 26, z: -54 }, { x: 43, z: 0 },
        { x: -43, z: 0 }, { x: 0, z: 52 }, { x: 26, z: 52 },
      ],
    },
    [
      // Steep climb and tall drop: pump the main line north, launch up the
      // tall transition, and drop off the platform behind the lip.
      { type: 'rollin', x: 0, z: 34, ry: 0, w: 16, R: 3, H: 2.6, deck: 10, color: '#e0552f' },
      // Pyramids flank the main line in two rows, like a rail yard's mounds.
      { type: 'pyramid', x: 16, z: -24, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: -16, z: -24, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: 16, z: -8, w: 4, d: 4, len: 3, h: 0.9, color: '#737b87' },
      { type: 'pyramid', x: -16, z: -8, w: 4, d: 4, len: 3, h: 0.9, color: '#737b87' },
      { type: 'pyramid', x: 16, z: 8, w: 4, d: 4, len: 3, h: 0.9, color: '#737b87' },
      { type: 'pyramid', x: -16, z: 8, w: 4, d: 4, len: 3, h: 0.9, color: '#737b87' },
      { type: 'pyramid', x: 16, z: 24, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: -16, z: 24, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: 34, z: -16, w: 6, d: 6, len: 4, h: 1.3, color: '#8992a0' },
      { type: 'pyramid', x: -34, z: -16, w: 6, d: 6, len: 4, h: 1.3, color: '#8992a0' },
      { type: 'pyramid', x: 34, z: 0, w: 5, d: 5, len: 3.5, h: 1.2, color: '#8992a0' },
      { type: 'pyramid', x: -34, z: 0, w: 5, d: 5, len: 3.5, h: 1.2, color: '#8992a0' },
      { type: 'pyramid', x: 34, z: 16, w: 6, d: 6, len: 4, h: 1.3, color: '#8992a0' },
      { type: 'pyramid', x: -34, z: 16, w: 6, d: 6, len: 4, h: 1.3, color: '#8992a0' },
      // Long rails running the corridors between the rows — the park's tracks.
      { type: 'rail', x: 8, z: 0, ry: 90, len: 38, h: 0.7, color: '#d7dce2' },
      { type: 'rail', x: -8, z: 0, ry: 90, len: 38, h: 0.7, color: '#d7dce2' },
      { type: 'rail', x: 23, z: 0, ry: 90, len: 26, h: 0.7, color: '#d7dce2' },
      { type: 'rail', x: -23, z: 0, ry: 90, len: 26, h: 0.7, color: '#d7dce2' },
      // Short rails in the gaps between the pyramids.
      { type: 'rail', x: 23, z: -16, ry: 90, len: 6, h: 0.6, color: '#e5e7eb' },
      { type: 'rail', x: -23, z: -16, ry: 90, len: 6, h: 0.6, color: '#e5e7eb' },
      { type: 'rail', x: 23, z: 16, ry: 90, len: 6, h: 0.6, color: '#e5e7eb' },
      { type: 'rail', x: -23, z: 16, ry: 90, len: 6, h: 0.6, color: '#e5e7eb' },
      { type: 'rail', x: 16, z: 0, ry: 0, len: 8, h: 0.65, color: '#e5e7eb' },
      { type: 'rail', x: -16, z: 0, ry: 0, len: 8, h: 0.65, color: '#e5e7eb' },
      // Signal rails flanking the approach to the roll-in.
      { type: 'rail', x: 12, z: 32, ry: 0, len: 6, h: 0.6, color: '#f4a261' },
      { type: 'rail', x: -12, z: 32, ry: 0, len: 6, h: 0.6, color: '#f4a261' },
      // Short crossings on the open corners of the pad.
      { type: 'rail', x: 20, z: -38, ry: 90, len: 4, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: -20, z: -38, ry: 90, len: 4, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: 20, z: 38, ry: 90, len: 4, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: -20, z: 38, ry: 90, len: 4, h: 0.5, color: '#e5e7eb' },
    ]
  ),
];

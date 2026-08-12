// The built-in maps, rebuilt out of the same Park Suite objects a player
// builds with (see parkObjects.js). Each original `build(p)` was decomposed
// into a list of slabs, banks, quarters, stairs, rails and ledges authored
// directly in world units, so a def can opt out of TRACK_SCALE (`scale: 1`)
// and its layout is exactly what gets ridden — the same promise a saved
// player-built park makes.
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

function def(id, name, blurb, opts, objects) {
  return {
    id,
    name,
    blurb,
    ...opts,
    scale: 1,
    _objects: objects,
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

  def(
    'bowl',
    'The Bowl',
    'A kidney bowl with coping on every wall. Pump it, never stop.',
    {
      seed: 0x9c31,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: 0, yaw: 0 },
      patrol: [
        { x: 0, z: -30 }, { x: 16, z: -16 }, { x: 16, z: 16 }, { x: 0, z: 30 },
        { x: -16, z: 16 }, { x: -16, z: -16 },
      ],
      logos: [
        { x: 0, z: -12 }, { x: 12, z: 0 }, { x: 0, z: 12 }, { x: -12, z: 0 },
        { x: 24, z: -26 }, { x: -24, z: 26 },
      ],
    },
    [
      // Four walls of one bowl, each tangent to the shared flat floor.
      { type: 'rollin', x: 0, z: 18, ry: 0, w: 36, R: 3.1, H: 2.5, deck: 4.4, color: 'wood' },
      { type: 'rollin', x: 0, z: -18, ry: 180, w: 36, R: 3.1, H: 2.5, deck: 4.4, color: 'wood' },
      { type: 'rollin', x: 18, z: 0, ry: 90, w: 36, R: 2.9, H: 2.2, deck: 3.6, color: 'wood' },
      { type: 'rollin', x: -18, z: 0, ry: 270, w: 36, R: 2.9, H: 2.2, deck: 3.6, color: 'wood' },
      // A hip in one corner, so a line can carry diagonally across the bowl.
      { type: 'bank', x: -14.5, z: -14.5, ry: 90, w: 7, len: 7, h: 1.4, color: 'wood' },
      // A flat bar down the middle, and more rails in the open floor.
      { type: 'rail', x: 0, z: 0, ry: 90, len: 16, h: 0.42, color: 'steel' },
      { type: 'rail', x: 12, z: 0, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: -12, z: 0, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: 10, ry: 0, len: 20, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'vert',
    'Vert Alley',
    'Two tall walls facing off, with a spine between them. Airs, mostly.',
    {
      seed: 0x77a4,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -36, yaw: 0 },
      patrol: [
        { x: 0, z: -40 }, { x: 20, z: -12 }, { x: 20, z: 12 }, { x: 0, z: 40 },
        { x: -20, z: 12 }, { x: -20, z: -12 },
      ],
      logos: [
        { x: 0, z: -28 }, { x: 0, z: 28 }, { x: 28, z: 0 }, { x: -28, z: 0 },
        { x: 16, z: -36 }, { x: -16, z: 36 },
      ],
    },
    [
      // A tall wall at each end of a long, narrow alley.
      { type: 'rollin', x: 0, z: 48, ry: 0, w: 44, R: 3.8, H: 3.2, deck: 6.2477, color: 'wood' },
      { type: 'rollin', x: 0, z: -48, ry: 180, w: 44, R: 3.8, H: 3.2, deck: 6.2477, color: 'wood' },
      // A spine down the middle: a transfer clears the whole width.
      { type: 'spine', x: 0, z: 0, ry: 0, w: 24, R: 1.7, H: 1.3, gap: 4.8, color: 'wood' },
      // A rail either side of the alley, and more inboard of those.
      { type: 'rail', x: -19, z: 0, ry: 90, len: 40, h: 0.4, color: 'steel' },
      { type: 'rail', x: 19, z: 0, ry: 90, len: 40, h: 0.4, color: 'steel' },
      { type: 'rail', x: -16, z: 0, ry: 90, len: 56, h: 0.4, color: 'steel' },
      { type: 'rail', x: 16, z: 0, ry: 90, len: 56, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: -22, ry: 90, len: 20, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'plaza',
    'Street Plaza',
    'Ledges, a kinked double set and a long manual pad. Technical.',
    {
      seed: 0x1e6d,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -36, yaw: 0 },
      patrol: [
        { x: 0, z: -40 }, { x: 24, z: -24 }, { x: 24, z: 8 }, { x: 0, z: 28 },
        { x: -24, z: 8 }, { x: -24, z: -24 },
      ],
      logos: [
        { x: 0, z: -20 }, { x: -20, z: -4 }, { x: 20, z: -4 }, { x: 0, z: 12 },
        { x: 30, z: 20 }, { x: -30, z: 20 },
      ],
    },
    [
      // A long, low manual pad down the centre — the plaza's spine.
      { type: 'bank', x: 0, z: -17, ry: 0, w: 10, len: 6, h: 0.36, color: 'wood' },
      { type: 'slab', x: 0, z: 2, ry: 0, w: 10, d: 32, h: 0.36, color: 'concrete' },
      { type: 'bank', x: 0, z: 21, ry: 180, w: 10, len: 6, h: 0.36, color: 'wood' },
      { type: 'ledge', x: -5.6, z: 2, ry: 90, len: 32, h: 0.36, color: 'concrete' },
      { type: 'ledge', x: 5.6, z: 2, ry: 90, len: 32, h: 0.36, color: 'concrete' },
      // A three-block ledge run down one side, each a hair taller than the last.
      { type: 'bank', x: 12.6, z: 0, ry: 90, w: 16, len: 1.2, h: 0.442, color: 'wood' },
      { type: 'slab', x: 16, z: 0, ry: 0, w: 5.6, d: 16, h: 0.442, color: 'concrete' },
      { type: 'ledge', x: 16, z: 7.4, ry: 0, len: 5.6, h: 0.442, color: 'concrete' },
      { type: 'ledge', x: 16, z: -7.4, ry: 0, len: 5.6, h: 0.442, color: 'concrete' },
      { type: 'bank', x: 21, z: 0, ry: 90, w: 16, len: 1.2, h: 0.546, color: 'wood' },
      { type: 'slab', x: 24.4, z: 0, ry: 0, w: 5.6, d: 16, h: 0.546, color: 'concrete' },
      { type: 'ledge', x: 24.4, z: 7.4, ry: 0, len: 5.6, h: 0.546, color: 'concrete' },
      { type: 'ledge', x: 24.4, z: -7.4, ry: 0, len: 5.6, h: 0.546, color: 'concrete' },
      { type: 'bank', x: 29.4, z: 0, ry: 90, w: 16, len: 1.2, h: 0.65, color: 'wood' },
      { type: 'slab', x: 32.8, z: 0, ry: 0, w: 5.6, d: 16, h: 0.65, color: 'concrete' },
      { type: 'ledge', x: 32.8, z: 7.4, ry: 0, len: 5.6, h: 0.65, color: 'concrete' },
      { type: 'ledge', x: 32.8, z: -7.4, ry: 0, len: 5.6, h: 0.65, color: 'concrete' },
      // A kinked double set: two flights side by side off a single landing.
      { type: 'slab', x: -32, z: 32, ry: 0, w: 16, d: 24, h: 1.4, color: 'concrete' },
      { type: 'stairs', x: -36, z: 17.68, ry: 0, w: 8, steps: 4, rise: 0.28, run: 1.16, color: 'dark' },
      { type: 'stairs', x: -28, z: 16.52, ry: 0, w: 8, steps: 6, rise: 0.19, run: 1.16, color: 'dark' },
      // The original rail sloped over both flights; a level bar at its midpoint.
      { type: 'rail', x: -32, z: 13.3, ry: 90, len: 15, h: 0.8, color: 'steel' },
      // Two picnic-table hips for wallride-style pop lines.
      { type: 'bank', x: 24, z: 32, ry: 90, w: 8, len: 8, h: 0.65, color: 'wood' },
      { type: 'bank', x: 24, z: 40, ry: 270, w: 8, len: 8, h: 0.65, color: 'wood' },
      // More rails, out in the ground the plaza's bigger footprint opens up.
      { type: 'rail', x: -22, z: -28, ry: 0, len: 20, h: 0.4, color: 'steel' },
      { type: 'rail', x: 32, z: -24, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: 40, ry: 90, len: 16, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'garden',
    'Mini Ramp Garden',
    'Four small ramps close together. Fast combos, forgiving pop.',
    {
      seed: 0x4b2f,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -36, yaw: 0 },
      patrol: [
        { x: 0, z: -38 }, { x: 18, z: -14 }, { x: 18, z: 14 }, { x: 0, z: 34 },
        { x: -18, z: 14 }, { x: -18, z: -14 },
      ],
      logos: [
        { x: 0, z: -22 }, { x: -14, z: -4 }, { x: 14, z: -4 }, { x: 0, z: 16 },
        { x: 14, z: 28 }, { x: -14, z: 28 },
      ],
    },
    [
      // Four small mini ramps, spaced so a roll-out feeds the next one.
      { type: 'rollin', x: -14, z: -6, ry: 0, w: 12.8, R: 1.8, H: 1.25, deck: 2.8, color: 'wood' },
      { type: 'rollin', x: 14, z: -6, ry: 180, w: 12.8, R: 1.8, H: 1.25, deck: 2.8, color: 'wood' },
      { type: 'rollin', x: -14, z: 18, ry: 0, w: 12.8, R: 1.8, H: 1.25, deck: 2.8, color: 'wood' },
      { type: 'rollin', x: 14, z: 18, ry: 180, w: 12.8, R: 1.8, H: 1.25, deck: 2.8, color: 'wood' },
      // A flat bar and a small funbox in the gap between all four.
      { type: 'rail', x: 0, z: 6, ry: 0, len: 12, h: 0.4, color: 'steel' },
      { type: 'bank', x: 0, z: -0.5, ry: 0, w: 8.8, len: 3, h: 0.42, color: 'wood' },
      { type: 'bank', x: 0, z: 2.5, ry: 180, w: 8.8, len: 3, h: 0.42, color: 'wood' },
      // More rails, one along each row of ramps and one linking the rows.
      { type: 'rail', x: 0, z: -13, ry: 0, len: 14, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: 25, ry: 0, len: 14, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: 6, ry: 90, len: 24, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'bigair',
    'Big Air',
    'One mega ramp, and a gap only a rail or a real ollie gets you across.',
    {
      seed: 0xd813,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -40, yaw: 0 },
      patrol: [
        { x: 0, z: -40 }, { x: 20, z: -16 }, { x: 20, z: 0 }, { x: 0, z: 20 },
        { x: -20, z: 0 }, { x: -20, z: -16 },
      ],
      logos: [
        { x: 0, z: -36 }, { x: -24, z: -16 }, { x: 24, z: -16 }, { x: 0, z: 8 },
        { x: 32, z: 12 }, { x: -32, z: 12 },
      ],
    },
    [
      // The mega ramp: elevated run-up, bank down, tall quarter with a deep deck.
      { type: 'slab', x: 0, z: -38, ry: 0, w: 32, d: 20, h: 3.0, color: 'concrete' },
      { type: 'bank', x: 0, z: -22, ry: 180, w: 32, len: 12, h: 3.0, color: 'wood' },
      { type: 'rollin', x: 0, z: 12, ry: 0, w: 32, R: 4.1, H: 3.5, deck: 6.8, color: 'wood' },
      // A real gap jump to one side: bank up, clean break, bank back up.
      { type: 'bank', x: -33, z: -6, ry: 90, w: 12, len: 10, h: 1.7, color: 'wood' },
      { type: 'bank', x: 33, z: -6, ry: 270, w: 12, len: 10, h: 1.7, color: 'wood' },
      { type: 'rail', x: 0, z: -6, ry: 0, len: 56.8, h: 1.75, color: 'steel' },
      // More rails: a ground bar either side of the gap and one on the run-up.
      { type: 'rail', x: -38, z: 18, ry: 90, len: 28, h: 0.4, color: 'steel' },
      { type: 'rail', x: 38, z: 18, ry: 90, len: 28, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: -40, ry: 0, len: 24, h: 3.05, color: 'steel' },
    ]
  ),

  def(
    'open',
    'Open World',
    'No fence, no edge. A whole district — bowls, mega drops, a hoop to jump through.',
    {
      seed: 0x6c17,
      extentX: 150,
      extentZ: 190,
      noFence: true,
      spawn: { x: 0, y: 0, z: -30, yaw: 0 },
      patrol: [
        { x: 0, z: -30 }, { x: 0, z: -104 }, { x: 60, z: -100 }, { x: 114, z: -160 },
        { x: 94, z: 0 }, { x: 64, z: 164 }, { x: 0, z: 130 }, { x: -70, z: 120 },
        { x: -90, z: 20 }, { x: -60, z: -116 },
      ],
      logos: [
        { x: 0, z: 16 }, { x: 0, z: 124 }, { x: -70, z: 120 }, { x: 94, z: 4 },
        { x: 64, z: 160 }, { x: 0, z: -104 },
      ],
    },
    [
      // A small manual pad right at spawn.
      { type: 'bank', x: 0, z: 3, ry: 0, w: 10, len: 6, h: 0.31, color: 'wood' },
      { type: 'slab', x: 0, z: 15, ry: 0, w: 10, d: 18, h: 0.31, color: 'concrete' },
      { type: 'bank', x: 0, z: 27, ry: 180, w: 10, len: 6, h: 0.31, color: 'wood' },
      { type: 'ledge', x: -5.6, z: 15, ry: 90, len: 18, h: 0.31, color: 'concrete' },
      { type: 'ledge', x: 5.6, z: 15, ry: 90, len: 18, h: 0.31, color: 'concrete' },
      // North: a street spot — bank up to a platform, stairs and handrail off it.
      { type: 'bank', x: 0, z: 100, ry: 0, w: 40, len: 20, h: 1.3, color: 'wood' },
      { type: 'slab', x: 0, z: 125, ry: 0, w: 40, d: 30, h: 1.3, color: 'concrete' },
      { type: 'stairs', x: 0, z: 142.8, ry: 180, w: 40, steps: 5, rise: 0.26, run: 1.12, color: 'dark' },
      { type: 'rail', x: -17.2, z: 143.1, ry: 90, len: 8.2, h: 0.71, color: 'steel' },
      // South: a deep pocket — the big south face with a wall either side.
      { type: 'rollin', x: 0, z: -120, ry: 180, w: 48, R: 3.6, H: 2.9, deck: 5.2, color: 'wood' },
      { type: 'rollin', x: -24, z: -100, ry: 270, w: 40, R: 3.0, H: 2.4, deck: 4.4, color: 'wood' },
      { type: 'rollin', x: 24, z: -100, ry: 90, w: 40, R: 3.0, H: 2.4, deck: 4.4, color: 'wood' },
      // West: a real grass hill climbing to a plateau with a rail on top.
      { type: 'bank', x: -85, z: 0, ry: 270, w: 60, len: 50, h: 4.5, color: '#7a8f5c' },
      { type: 'slab', x: -125, z: 0, ry: 0, w: 30, d: 60, h: 4.5, color: '#7a8f5c' },
      { type: 'rail', x: -136, z: 0, ry: 90, len: 32, h: 4.9, color: 'steel' },
      // Northwest: a second deep bowl, four walls, hip in one corner.
      { type: 'rollin', x: -70, z: 150, ry: 0, w: 60, R: 3.4, H: 2.8, deck: 4.8, color: 'wood' },
      { type: 'rollin', x: -70, z: 90, ry: 180, w: 60, R: 3.4, H: 2.8, deck: 4.8, color: 'wood' },
      { type: 'rollin', x: -40, z: 120, ry: 90, w: 60, R: 3.4, H: 2.8, deck: 4.8, color: 'wood' },
      { type: 'rollin', x: -100, z: 120, ry: 270, w: 60, R: 3.4, H: 2.8, deck: 4.8, color: 'wood' },
      { type: 'bank', x: -94, z: 96, ry: 90, w: 12, len: 12, h: 1.7, color: 'wood' },
      { type: 'rail', x: -70, z: 108, ry: 0, len: 24, h: 0.4, color: 'steel' },
      // East: a real gap jump with a ring hanging over it (the hoop is
      // decorative — no collision or grind — it just has to be there).
      { type: 'bank', x: 77, z: 0, ry: 90, w: 24, len: 14, h: 2.2, color: 'wood' },
      { type: 'bank', x: 111, z: 0, ry: 270, w: 24, len: 14, h: 2.2, color: 'wood' },
      { type: 'rail', x: 94, z: 0, ry: 0, len: 20, h: 2.25, color: 'steel' },
      { type: 'hoop', x: 94, y: 5.3, z: 0, r: 2.3, tube: 0.16 },
      { type: 'rail', x: 70, z: -16, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 118, z: -16, ry: 90, len: 24, h: 0.4, color: 'steel' },
      // Northeast: the first mega drop — approach ramp up onto a high deck.
      { type: 'rollin', x: 65, z: 136, ry: 0, w: 50, R: 6.5, H: 5.2, deck: 7, color: 'wood' },
      { type: 'bank', x: 65, z: 164.68, ry: 180, w: 50, len: 30.63, h: 5.2, color: 'wood' },
      { type: 'rail', x: 38.6, z: 163.18, ry: 90, len: 25.63, h: 2.7, color: 'steel' },
      // Southeast: the second mega drop, approached from the opposite edge.
      { type: 'rollin', x: 115, z: -142, ry: 180, w: 50, R: 6.0, H: 4.8, deck: 6.4, color: 'wood' },
      { type: 'bank', x: 115, z: -167.14, ry: 0, w: 50, len: 25.72, h: 4.8, color: 'wood' },
      { type: 'rail', x: 138.6, z: -165.94, ry: 90, len: 20.12, h: 2.5, color: 'steel' },
      // South-central: a compact mini-halfpipe between the two mega drops.
      { type: 'rollin', x: 56, z: -112, ry: 180, w: 40, R: 2.2, H: 1.5, deck: 2.4, color: 'wood' },
      { type: 'rollin', x: 56, z: -88, ry: 0, w: 40, R: 2.2, H: 1.5, deck: 2.4, color: 'wood' },
      { type: 'rail', x: 56, z: -100, ry: 90, len: 12, h: 0.4, color: 'steel' },
      // Southwest: a three-block ledge row, technical and low.
      { type: 'bank', x: -89.4, z: -120, ry: 90, w: 20, len: 1.2, h: 0.3, color: 'wood' },
      { type: 'slab', x: -84.4, z: -120, ry: 0, w: 8.8, d: 20, h: 0.3, color: 'concrete' },
      { type: 'ledge', x: -84.4, z: -110.6, ry: 0, len: 8.8, h: 0.3, color: 'concrete' },
      { type: 'ledge', x: -84.4, z: -130.6, ry: 0, len: 8.8, h: 0.3, color: 'concrete' },
      { type: 'bank', x: -75.4, z: -120, ry: 90, w: 20, len: 1.2, h: 0.38, color: 'wood' },
      { type: 'slab', x: -70.4, z: -120, ry: 0, w: 8.8, d: 20, h: 0.38, color: 'concrete' },
      { type: 'ledge', x: -70.4, z: -110.6, ry: 0, len: 8.8, h: 0.38, color: 'concrete' },
      { type: 'ledge', x: -70.4, z: -130.6, ry: 0, len: 8.8, h: 0.38, color: 'concrete' },
      { type: 'bank', x: -61.4, z: -120, ry: 90, w: 20, len: 1.2, h: 0.46, color: 'wood' },
      { type: 'slab', x: -56.4, z: -120, ry: 0, w: 8.8, d: 20, h: 0.46, color: 'concrete' },
      { type: 'ledge', x: -56.4, z: -110.6, ry: 0, len: 8.8, h: 0.46, color: 'concrete' },
      { type: 'ledge', x: -56.4, z: -130.6, ry: 0, len: 8.8, h: 0.46, color: 'concrete' },
      // A few more rails, scattered so one is always within reach.
      { type: 'rail', x: -48, z: 60, ry: 0, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: -70, ry: 90, len: 20, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'pool',
    'The Pool',
    'A kidney pool with a deep end and a shallow end. Pump it end to end.',
    {
      seed: 0x0af7,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -32, yaw: 0 },
      patrol: [
        { x: 0, z: -28 }, { x: 18, z: -4 }, { x: 18, z: 16 }, { x: 0, z: 32 },
        { x: -18, z: 16 }, { x: -18, z: -4 },
      ],
      logos: [
        { x: 0, z: -18 }, { x: 12, z: 4 }, { x: 0, z: 18 }, { x: -12, z: 4 },
        { x: 18, z: 28 }, { x: -18, z: 28 },
      ],
    },
    [
      // Deep end, north — full coping and a real deck behind it.
      { type: 'rollin', x: 0, z: 22, ry: 0, w: 36, R: 3.8, H: 3.1, deck: 4.0, color: 'wood' },
      // Shallow end, south — lower, but still a real deck behind the coping.
      { type: 'rollin', x: 0, z: -14, ry: 180, w: 36, R: 2.2, H: 1.2, deck: 2.0, color: 'wood' },
      // The two side walls, graduated between the ends.
      { type: 'rollin', x: 18, z: 4, ry: 90, w: 36, R: 3.1, H: 2.1, deck: 2.4, color: 'wood' },
      { type: 'rollin', x: -18, z: 4, ry: 270, w: 36, R: 3.1, H: 2.1, deck: 2.4, color: 'wood' },
      // A flat bar down the middle of the floor, end to end, plus flankers.
      { type: 'rail', x: 0, z: 4, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: -10, z: 4, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 10, z: 4, ry: 90, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: 4, ry: 0, len: 24, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'rooftop',
    'Rooftops',
    'Two rooftops and a real gap between them. Ollie it, or ride the rail.',
    {
      seed: 0x5af1,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -32, yaw: 0 },
      patrol: [
        { x: 0, z: -32 }, { x: 20, z: -12 }, { x: 32, z: 12 }, { x: 0, z: 28 },
        { x: -28, z: 8 }, { x: -16, z: -16 },
      ],
      logos: [
        { x: 0, z: -20 }, { x: 0, z: -4 }, { x: 30, z: -4 }, { x: 0, z: 16 },
        { x: -24, z: 0 }, { x: 16, z: 28 },
      ],
    },
    [
      // Roof A: a ramp straight off the spawn up onto a low rooftop.
      { type: 'bank', x: 0, z: -22, ry: 0, w: 24, len: 12, h: 1.8, color: 'wood' },
      { type: 'slab', x: 0, z: -6, ry: 0, w: 24, d: 20, h: 1.8, color: 'concrete' },
      { type: 'ledge', x: -12.6, z: -6, ry: 90, len: 20, h: 1.8, color: 'concrete' },
      { type: 'ledge', x: 12.6, z: -6, ry: 90, len: 20, h: 1.8, color: 'concrete' },
      // Roof B: taller, across a real gap — only the rail bridges it.
      { type: 'slab', x: 30, z: -6, ry: 0, w: 20, d: 20, h: 3.6, color: 'concrete' },
      { type: 'bank', x: 44, z: -6, ry: 270, w: 20, len: 8, h: 3.6, color: 'wood' },
      { type: 'rail', x: 16, z: -6, ry: 0, len: 6.8, h: 2.8, color: 'steel' },
      // A stair set and handrail off the back of Roof A.
      { type: 'stairs', x: 0, z: 7, ry: 180, w: 24, steps: 6, rise: 0.3, run: 1.0, color: 'dark' },
      { type: 'rail', x: 12.8, z: 7.2, ry: 90, len: 5.2, h: 0.98, color: 'steel' },
      // A flat bar out on open ground, well clear of both roofs.
      { type: 'rail', x: -28, z: 2, ry: 90, len: 20, h: 0.4, color: 'steel' },
      // More rails: a second gap-spanning bar, one on Roof B's deck, one behind.
      { type: 'rail', x: 16, z: -2, ry: 0, len: 6.8, h: 2.8, color: 'steel' },
      { type: 'rail', x: 30, z: -12, ry: 0, len: 12, h: 3.65, color: 'steel' },
      { type: 'rail', x: -20, z: 20, ry: 0, len: 16, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'snake',
    'Snake Run',
    'A weaving channel with a wall on alternating sides. Pure carving.',
    {
      seed: 0x3fd8,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -36, yaw: 0 },
      patrol: [
        { x: 0, z: -34 }, { x: -10, z: -20 }, { x: 10, z: 0 }, { x: -10, z: 16 },
        { x: 0, z: 30 }, { x: 10, z: -8 },
      ],
      logos: [
        { x: -10, z: -20 }, { x: 10, z: -4 }, { x: -10, z: 10 }, { x: 0, z: 24 },
        { x: 12, z: 20 }, { x: -12, z: -6 },
      ],
    },
    [
      // Three walls, alternating sides down a shared channel.
      { type: 'rollin', x: -16, z: -20, ry: 270, w: 16, R: 2.6, H: 1.4, deck: 0, color: 'wood' },
      { type: 'rollin', x: 16, z: 0, ry: 90, w: 16, R: 2.6, H: 1.4, deck: 0, color: 'wood' },
      { type: 'rollin', x: -16, z: 20, ry: 270, w: 16, R: 2.6, H: 1.4, deck: 0, color: 'wood' },
      // A small kicker at the north end to pop off.
      { type: 'quarter', x: 0, z: 28, ry: 0, w: 16, R: 1.7, H: 0.65, color: 'wood' },
      // A flat bar near the entrance, and more rails in the open channel.
      { type: 'rail', x: 0, z: -26, ry: 90, len: 12, h: 0.4, color: 'steel' },
      { type: 'rail', x: -4, z: -20, ry: 0, len: 16, h: 0.4, color: 'steel' },
      { type: 'rail', x: 10, z: 0, ry: 0, len: 8, h: 0.4, color: 'steel' },
      { type: 'rail', x: -4, z: 20, ry: 0, len: 16, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'schoolyard',
    'Schoolyard',
    'Curbs, a loading ledge and a picnic table. Tight and technical.',
    {
      seed: 0x2c9a,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -36, yaw: 0 },
      patrol: [
        { x: 0, z: -36 }, { x: 20, z: -20 }, { x: 20, z: 12 }, { x: 0, z: 28 },
        { x: -24, z: 12 }, { x: -24, z: -20 },
      ],
      logos: [
        { x: 0, z: -24 }, { x: 20, z: -4 }, { x: 0, z: 12 }, { x: -24, z: -4 },
        { x: 12, z: 24 }, { x: -12, z: 24 },
      ],
    },
    [
      // A loading-dock ledge down the west side.
      { type: 'bank', x: -33, z: 0, ry: 90, w: 36, len: 6, h: 0.44, color: 'wood' },
      { type: 'slab', x: -26, z: 0, ry: 0, w: 8, d: 36, h: 0.44, color: 'concrete' },
      { type: 'ledge', x: -22.6, z: 0, ry: 90, len: 36, h: 0.44, color: 'concrete' },
      { type: 'ledge', x: -30.6, z: 0, ry: 90, len: 36, h: 0.44, color: 'concrete' },
      // A picnic-table hip in the middle of the yard.
      { type: 'bank', x: -3, z: 22, ry: 90, w: 12, len: 6, h: 0.55, color: 'wood' },
      { type: 'bank', x: 3, z: 22, ry: 270, w: 12, len: 6, h: 0.55, color: 'wood' },
      // A short stair set with a handrail, near the spawn.
      { type: 'bank', x: 24, z: -28, ry: 0, w: 12, len: 8, h: 1.0, color: 'wood' },
      { type: 'slab', x: 24, z: -18, ry: 0, w: 12, d: 12, h: 1.0, color: 'concrete' },
      { type: 'stairs', x: 24, z: -9.92, ry: 180, w: 12, steps: 4, rise: 0.25, run: 1.04, color: 'dark' },
      { type: 'rail', x: 30.8, z: -10.3, ry: 90, len: 4.6, h: 0.58, color: 'steel' },
      // A flat bar on the east side.
      { type: 'rail', x: 22, z: 16, ry: 90, len: 16, h: 0.4, color: 'steel' },
      // More rails: one clear of the loading ledge, one by the picnic hip,
      // and one further out on the east ground.
      { type: 'rail', x: -16, z: -18, ry: 90, len: 28, h: 0.4, color: 'steel' },
      { type: 'rail', x: 0, z: 12, ry: 0, len: 24, h: 0.4, color: 'steel' },
      { type: 'rail', x: 40, z: -6, ry: 90, len: 28, h: 0.4, color: 'steel' },
    ]
  ),

  def(
    'docks',
    'The Docks',
    'Loading docks at three different heights. Gaps, not ramps, link them.',
    {
      seed: 0x88b3,
      padOnly: true,
      extentX: 52,
      extentZ: 60,
      spawn: { x: 0, y: 0, z: -40, yaw: 0 },
      patrol: [
        { x: 0, z: -40 }, { x: 24, z: -20 }, { x: 24, z: 12 }, { x: 0, z: 32 },
        { x: -24, z: 12 }, { x: -24, z: -20 },
      ],
      logos: [
        { x: 0, z: -28 }, { x: 24, z: -8 }, { x: 0, z: 8 }, { x: -24, z: -8 },
        { x: 12, z: 28 }, { x: -12, z: 28 },
      ],
    },
    [
      // Dock A: low, right off the spawn, ramped up from the ground.
      { type: 'bank', x: 0, z: -28, ry: 0, w: 32, len: 8, h: 1.2, color: 'wood' },
      { type: 'slab', x: 0, z: -16, ry: 0, w: 32, d: 16, h: 1.2, color: 'concrete' },
      { type: 'ledge', x: -16.6, z: -16, ry: 90, len: 16, h: 1.2, color: 'concrete' },
      { type: 'ledge', x: 16.6, z: -16, ry: 90, len: 16, h: 1.2, color: 'concrete' },
      // Dock B: a real gap north of A — no ramp between them, just the rail.
      { type: 'slab', x: 0, z: 8, ry: 0, w: 32, d: 16, h: 2.2, color: 'concrete' },
      { type: 'bank', x: 0, z: 20, ry: 180, w: 32, len: 8, h: 2.2, color: 'wood' },
      { type: 'rail', x: -2.8, z: -3.2, ry: 90, len: 8, h: 1.8, color: 'steel' },
      // Dock C: taller still, reached the same way.
      { type: 'slab', x: 0, z: 36, ry: 0, w: 24, d: 16, h: 3.4, color: 'concrete' },
      { type: 'bank', x: 0, z: 48, ry: 180, w: 24, len: 8, h: 3.4, color: 'wood' },
      { type: 'rail', x: -2, z: 22, ry: 90, len: 13.6, h: 2.95, color: 'steel' },
      // More rails: two flanking Dock A's ramp, one up on Dock B's deck.
      { type: 'rail', x: -16, z: -36, ry: 90, len: 8, h: 0.4, color: 'steel' },
      { type: 'rail', x: 16, z: -36, ry: 90, len: 8, h: 0.4, color: 'steel' },
      { type: 'rail', x: 6, z: 8, ry: 90, len: 12, h: 2.25, color: 'steel' },
    ]
  ),

  def(
    'yard',
    'The Yard',
    'A fenced concrete yard, twin hips and a manual box. Every wheel — yours and theirs — stays on the pad.',
    {
      seed: 0x7c31,
      padOnly: true,
      extentX: 46,
      extentZ: 52,
      spawn: { x: 0, y: 0, z: -40, yaw: 0 },
      patrol: [
        { x: 0, z: -42 }, { x: 30, z: -16 }, { x: 24, z: 20 }, { x: 0, z: 24 },
        { x: -24, z: 20 }, { x: -30, z: -16 },
      ],
      logos: [
        { x: 0, z: -28 }, { x: -28, z: -16 }, { x: 28, z: -16 },
        { x: 0, z: 8 }, { x: -26, z: 24 }, { x: 26, z: 24 },
      ],
    },
    [
      // Twin hips at the back, facing each other across a walk-through gap.
      { type: 'rollin', x: -24, z: 28, ry: 0, w: 28, R: 2.6, H: 1.8, deck: 4.8, color: 'wood' },
      { type: 'rollin', x: 24, z: 28, ry: 0, w: 28, R: 2.6, H: 1.8, deck: 4.8, color: 'wood' },
      { type: 'rail', x: 0, z: 27.2, ry: 0, len: 20, h: 0.4, color: 'steel' },
      // Centre manual box: bank up, flat, bank down, rail on top.
      { type: 'bank', x: 0, z: -7, ry: 0, w: 12, len: 6, h: 0.44, color: 'wood' },
      { type: 'slab', x: 0, z: 0, ry: 0, w: 12, d: 8, h: 0.44, color: 'concrete' },
      { type: 'bank', x: 0, z: 7, ry: 180, w: 12, len: 6, h: 0.44, color: 'wood' },
      { type: 'rail', x: 0, z: 0, ry: 90, len: 7.6, h: 0.76, color: 'steel' },
      { type: 'ledge', x: -6.6, z: 0, ry: 90, len: 8, h: 0.44, color: 'concrete' },
      { type: 'ledge', x: 6.6, z: 0, ry: 90, len: 8, h: 0.44, color: 'concrete' },
      // West wall: a real transition, not just a rail on a slope.
      { type: 'rollin', x: -18, z: -16, ry: 270, w: 24, R: 2.2, H: 1.4, deck: 3.2, color: 'wood' },
      // East side: a straight ledge for the line the west wall doesn't give you.
      { type: 'bank', x: 18.6, z: -16, ry: 90, w: 24, len: 1.2, h: 0.42, color: 'wood' },
      { type: 'slab', x: 24.6, z: -16, ry: 0, w: 10.8, d: 24, h: 0.42, color: 'concrete' },
      { type: 'ledge', x: 19.8, z: -16, ry: 90, len: 24, h: 0.42, color: 'concrete' },
    ]
  ),

  def(
    'skyline',
    'The Skyline',
    'Two towering walls face off down a run of long rails. Pick a line and fly.',
    {
      seed: 0x91e3,
      padOnly: true,
      extentX: 60,
      extentZ: 52,
      spawn: { x: 0, y: 0, z: -32, yaw: 0 },
      patrol: [
        { x: 0, z: -36 }, { x: 12, z: -12 }, { x: 12, z: 16 }, { x: 0, z: 36 },
        { x: -12, z: 16 }, { x: -12, z: -12 },
      ],
      logos: [
        { x: 0, z: -24 }, { x: -12, z: -4 }, { x: 12, z: -4 }, { x: 0, z: 20 },
        { x: -20, z: 28 }, { x: 28, z: 24 },
      ],
    },
    [
      // The two big walls, facing each other down the whole length of the park.
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 60, R: 4.2, H: 3.5, deck: 6.0, color: 'wood' },
      { type: 'rollin', x: 0, z: -40, ry: 180, w: 60, R: 4.2, H: 3.5, deck: 6.0, color: 'wood' },
      // The long rails: two bars running the full length of the park.
      { type: 'rail', x: -16, z: 0, ry: 90, len: 72, h: 0.4, color: 'steel' },
      { type: 'rail', x: 16, z: 0, ry: 90, len: 72, h: 0.4, color: 'steel' },
      // Centre manual box: bank up, flat, bank down, rail on top.
      { type: 'bank', x: 0, z: -9, ry: 0, w: 10, len: 6, h: 0.5, color: 'wood' },
      { type: 'slab', x: 0, z: 0, ry: 0, w: 10, d: 12, h: 0.5, color: 'concrete' },
      { type: 'bank', x: 0, z: 9, ry: 180, w: 10, len: 6, h: 0.5, color: 'wood' },
      { type: 'rail', x: 0, z: 0, ry: 90, len: 11.6, h: 0.81, color: 'steel' },
      { type: 'ledge', x: -5.6, z: 0, ry: 90, len: 12, h: 0.5, color: 'concrete' },
      { type: 'ledge', x: 5.6, z: 0, ry: 90, len: 12, h: 0.5, color: 'concrete' },
      // West hip: a banked ledge for carving on the way to the walls.
      { type: 'bank', x: -34, z: 22, ry: 270, w: 20, len: 20, h: 1.3, color: 'wood' },
      { type: 'slab', x: -34, z: 36, ry: 0, w: 20, d: 8, h: 1.3, color: 'concrete' },
      // East stair set and handrail: the way down off a high deck.
      { type: 'bank', x: 28, z: 12, ry: 0, w: 12, len: 8, h: 1.2, color: 'wood' },
      { type: 'slab', x: 28, z: 22, ry: 0, w: 12, d: 12, h: 1.2, color: 'concrete' },
      { type: 'stairs', x: 28, z: 30.8, ry: 180, w: 12, steps: 5, rise: 0.24, run: 1.12, color: 'dark' },
      { type: 'rail', x: 24.4, z: 29.3, ry: 90, len: 4.6, h: 0.69, color: 'steel' },
    ]
  ),
];

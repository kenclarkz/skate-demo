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

export function def(id, name, blurb, opts, objects) {
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

// The finale park (The Gauntlet) is the one night every rival shows up for, so
// its crowd is part of the scenery: a static knot of spectators packed around
// each rival's section and a wall of fans just past the curb on all four sides.
// A spectator is pure decor (see parkObjects.js), so the crowd reads on screen
// without a single extra AI bot — the touring crowd still rings whichever
// rival is nearest when the player rides up to duel.
const CROWD_COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#e63946', '#457b9d', '#6a4c93', '#f77f00'];

function spectator(x, z, color) {
  return { type: 'spectator', x, z, color };
}

/** A knot of fans around a rival's spot, with a wedge left open facing `tx/tz`
 * (the arena) so the player can skate straight in and challenge. */
function crowdCircle(cx, cz, tx, tz, count = 6, r = 3.9, colorShift = 0) {
  const out = [];
  const open = Math.atan2(cx - tx, cz - tz);
  const gap = 0.45;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const a = open + gap + (Math.PI * 2 - gap * 2) * t;
    out.push(spectator(cx + Math.sin(a) * r, cz + Math.cos(a) * r, CROWD_COLORS[(i + colorShift) % CROWD_COLORS.length]));
  }
  return out;
}

/** The wall of cheering fans packed just beyond the curb, all four sides. */
function fenceCrowd() {
  const out = [];
  const xs = [-52, -44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44, 52];
  for (let i = 0; i < xs.length; i++) {
    out.push(spectator(xs[i], 63, CROWD_COLORS[(i + 1) % CROWD_COLORS.length]));
    out.push(spectator(xs[i], -63, CROWD_COLORS[(i + 4) % CROWD_COLORS.length]));
  }
  const zs = [-52, -44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44, 52];
  for (let i = 0; i < zs.length; i++) {
    out.push(spectator(63, zs[i], CROWD_COLORS[(i + 2) % CROWD_COLORS.length]));
    out.push(spectator(-63, zs[i], CROWD_COLORS[(i + 5) % CROWD_COLORS.length]));
  }
  return out;
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
      // Trees and bushes along the fence: a landscaped green edge around the
      // whole pad, planted clear of the roll-in decks, the run-off lanes and
      // the spawn line.
      { type: 'tree', x: -52, z: 56.5, r: 1.3, h: 3.4, color: '#46764a' },
      { type: 'tree', x: -40, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 40, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 52, z: 56.5, r: 1.2, h: 2.9, color: '#46764a' },
      { type: 'tree', x: -52, z: -56.5, r: 1.2, h: 3.1, color: '#46764a' },
      { type: 'tree', x: -40, z: -56.5, r: 1.1, h: 2.8, color: '#46764a' },
      { type: 'tree', x: 40, z: -56.5, r: 1.3, h: 3.3, color: '#46764a' },
      { type: 'tree', x: 50, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -53, z: 22, r: 1.2, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -53, z: 46, r: 1.1, h: 2.9, color: '#46764a' },
      { type: 'tree', x: 53, z: 12, r: 1.2, h: 3.1, color: '#46764a' },
      { type: 'tree', x: 53, z: 30, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'bush', x: -46, z: 55.5, r: 0.9 },
      { type: 'bush', x: -34, z: 55.5, r: 0.8 },
      { type: 'bush', x: 34, z: 55.5, r: 0.85 },
      { type: 'bush', x: 46, z: 55.5, r: 0.95 },
      { type: 'bush', x: -46, z: -55.5, r: 0.85 },
      { type: 'bush', x: 44, z: -55.5, r: 0.9 },
      { type: 'bush', x: 48, z: -55.5, r: 0.8 },
      { type: 'bush', x: -52, z: 30, r: 0.9 },
      { type: 'bush', x: -52, z: 40, r: 0.85 },
      { type: 'bush', x: -52, z: 54, r: 0.9 },
      { type: 'bush', x: 52, z: 18, r: 0.9 },
      { type: 'bush', x: 52, z: 36, r: 0.85 },
      { type: 'bush', x: 52, z: 52, r: 0.9 },
      // The food-truck corner: a pedestrian hangout at the north-east corner,
      // the truck serving a little crowd of spectators under the trees.
      { type: 'foodtruck', x: 50, z: 46.5, ry: 0, len: 4.5, w: 2.1, color: '#2ec4b6' },
      { type: 'spectator', x: 47.5, z: 47.5, color: '#37506b' },
      { type: 'spectator', x: 49, z: 49, color: '#c94f3a' },
      { type: 'spectator', x: 46, z: 49.5, color: '#8ab17d' },
      { type: 'spectator', x: 49, z: 43, color: '#d6c064' },
      { type: 'bench', x: 45, z: 51.5, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 52, z: 41.5, ry: 0, len: 3, color: '#6c757d' },
      { type: 'trashcan', x: 47.5, z: 42, r: 0.35, h: 0.95, color: '#3a5a40' },
      // A car parked along the south fence by the south-east corner.
      { type: 'car', x: 48, z: -50.5, ry: 90, len: 4.2, w: 1.8, h: 0.6, color: '#3a7ca5' },
    ]
  ),

  // Flatline: Nova's own arena. A long manual pad down the middle with low
  // ledges and flatbars flanking it, elevated manual lines up both sides,
  // a funbox and pyramid on the south plaza, and twin roll-ins framing a
  // spine transfer at the top of the pad.
  def(
    'nova',
    'Flatline',
    'The manual palace: pad the long line, ride the elevated decks, transfer the spine.',
    {
      seed: 0xf1a7,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#2b3a4a',
      spawn: { x: 0, y: 0, z: -44, yaw: 0 },
      patrol: [
        { x: 0, z: -44 }, { x: 0, z: -26 }, { x: -20, z: -18 }, { x: 24, z: 8 },
        { x: 0, z: 24 }, { x: -36, z: 38 }, { x: 38, z: 4 },
      ],
      logos: [
        { x: -12, z: -18 }, { x: 12, z: -18 }, { x: -12, z: 0 }, { x: 12, z: 0 },
        { x: -38, z: 28 }, { x: 38, z: 28 },
      ],
    },
    [
      // North: twin roll-ins framing a spine transfer, pump across the flat.
      { type: 'rollin', x: -22, z: 34, ry: 0, w: 12, R: 2.0, H: 1.3, deck: 6, color: '#2a2e36' },
      { type: 'rollin', x: 22, z: 34, ry: 0, w: 12, R: 2.0, H: 1.3, deck: 6, color: '#2a2e36' },
      { type: 'spine', x: 0, z: 34, ry: 90, w: 12, R: 2.0, H: 1.3, gap: 4, color: '#4cc9f0' },
      // The long manual pad, with low grindable ledges down each side.
      { type: 'slab', x: 0, z: 0, ry: 0, w: 10, d: 44, h: 0.28, color: '#3d444e' },
      { type: 'ledge', x: -5.8, z: -6, ry: 270, len: 12, w: 1.2, h: 0.28, color: '#4cc9f0' },
      { type: 'ledge', x: 5.8, z: -6, ry: 90, len: 12, w: 1.2, h: 0.28, color: '#4cc9f0' },
      { type: 'ledge', x: -5.8, z: 10, ry: 270, len: 12, w: 1.2, h: 0.28, color: '#e76f51' },
      { type: 'ledge', x: 5.8, z: 10, ry: 90, len: 12, w: 1.2, h: 0.28, color: '#e76f51' },
      // West elevated manual line: bank up, deck, bank down.
      { type: 'bank', x: -30, z: -27, ry: 0, w: 14, len: 8, h: 1.2, color: '#e9c46a' },
      { type: 'slab', x: -30, z: -14, ry: 0, w: 14, d: 18, h: 1.2, color: '#e9c46a' },
      { type: 'bank', x: -30, z: -1, ry: 180, w: 14, len: 8, h: 1.2, color: '#e9c46a' },
      // East elevated line, a shorter run.
      { type: 'bank', x: 30, z: -29, ry: 0, w: 14, len: 8, h: 1.2, color: '#cdb4db' },
      { type: 'slab', x: 30, z: -20, ry: 0, w: 14, d: 10, h: 1.2, color: '#cdb4db' },
      { type: 'bank', x: 30, z: -11, ry: 180, w: 14, len: 8, h: 1.2, color: '#cdb4db' },
      // South plaza: a funbox and pyramids for airs off the manual line.
      { type: 'funbox', x: 0, z: -34, ry: 0, w: 8, d: 6, h: 0.9, R: 1.5, color: '#f15bb5' },
      { type: 'pyramid', x: -30, z: 10, ry: 0, w: 5, d: 5, len: 3.5, h: 1.0, color: '#7c8691' },
      { type: 'pyramid', x: 30, z: 10, ry: 0, w: 5, d: 5, len: 3, h: 1.0, color: '#8992a0' },
      // South-east roll-in for a speed line back into the pad.
      { type: 'rollin', x: 34, z: -46, ry: 180, w: 12, R: 2.2, H: 1.4, deck: 7, color: '#2a2e36' },
      // Flatbars around the flow: the classic flatground grind.
      { type: 'rail', x: -16, z: 0, ry: 90, len: 10, h: 0.4, color: '#ff2fa0' },
      { type: 'rail', x: 16, z: 0, ry: 90, len: 10, h: 0.4, color: '#ff2fa0' },
      { type: 'rail', x: 0, z: 26, ry: 0, len: 10, h: 0.4, color: '#ff2fa0' },
      { type: 'rail', x: 0, z: -28, ry: 0, len: 10, h: 0.4, color: '#ff2fa0' },
      // Planters and benches dressing the perimeter.
      { type: 'planter', x: -44, z: -36, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 44, z: -36, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -44, z: 36, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 44, z: 36, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'bench', x: -48, z: -8, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 48, z: -8, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: -48, z: 20, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 48, z: 20, ry: 90, len: 3, color: '#6c757d' },
      // Banners along the east and west fences.
      { type: 'banner', x: -52, z: 0, ry: 90, w: 6, h: 1.0, color: '#4cc9f0' },
      { type: 'banner', x: 52, z: 0, ry: 90, w: 6, h: 1.0, color: '#4cc9f0' },
      // The food-truck corner, north-west.
      { type: 'foodtruck', x: -48, z: 52, ry: 0, len: 4.5, w: 2.1, color: '#2ec4b6' },
      { type: 'spectator', x: -44, z: 48, color: '#37506b' },
      { type: 'spectator', x: -46, z: 50, color: '#c94f3a' },
      { type: 'spectator', x: -42, z: 51, color: '#8ab17d' },
      { type: 'bench', x: -46, z: 53, ry: 0, len: 3, color: '#6c757d' },
      { type: 'trashcan', x: -43, z: 53, r: 0.35, h: 0.95, color: '#3a5a40' },
      // Trees and bushes: a landscaped green edge around the pad.
      { type: 'tree', x: -52, z: 56.5, r: 1.3, h: 3.4, color: '#46764a' },
      { type: 'tree', x: -40, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 40, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 52, z: 56.5, r: 1.2, h: 2.9, color: '#46764a' },
      { type: 'tree', x: -52, z: -56.5, r: 1.2, h: 3.1, color: '#46764a' },
      { type: 'tree', x: -40, z: -56.5, r: 1.1, h: 2.8, color: '#46764a' },
      { type: 'tree', x: 40, z: -56.5, r: 1.3, h: 3.3, color: '#46764a' },
      { type: 'tree', x: 50, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -53, z: 22, r: 1.2, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -53, z: 46, r: 1.1, h: 2.9, color: '#46764a' },
      { type: 'tree', x: 53, z: 12, r: 1.2, h: 3.1, color: '#46764a' },
      { type: 'tree', x: 53, z: 30, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'bush', x: -46, z: 55.5, r: 0.9 },
      { type: 'bush', x: -34, z: 55.5, r: 0.8 },
      { type: 'bush', x: 34, z: 55.5, r: 0.85 },
      { type: 'bush', x: 46, z: 55.5, r: 0.95 },
      { type: 'bush', x: -46, z: -55.5, r: 0.85 },
      { type: 'bush', x: 44, z: -55.5, r: 0.9 },
      { type: 'bush', x: 48, z: -55.5, r: 0.8 },
      { type: 'bush', x: -52, z: 30, r: 0.9 },
      { type: 'bush', x: -52, z: 40, r: 0.85 },
      { type: 'bush', x: -52, z: 54, r: 0.9 },
      { type: 'bush', x: 52, z: 18, r: 0.9 },
      { type: 'bush', x: 52, z: 36, r: 0.85 },
      { type: 'bush', x: 52, z: 52, r: 0.9 },
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

  // Thunder Basin: Bolt's pool yard. Twin pools at the centre with a spine
  // between them, a deep vert ramp on the west flank and a mini on the east,
  // quarterpipes on the walls, and four corner bowls around two big roll-ins.
  def(
    'bolt',
    'Thunder Basin',
    'Pools, spines and a deep vert wall — the basin Bolt rides.',
    {
      seed: 0xb011,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#1d3557',
      spawn: { x: 0, y: 0, z: 38, yaw: 0 },
      patrol: [
        { x: 0, z: 38 }, { x: 0, z: -10 }, { x: -32, z: -12 }, { x: -32, z: 0 },
        { x: 0, z: 10 }, { x: 32, z: 0 }, { x: 32, z: -12 },
      ],
      logos: [
        { x: -14, z: -26 }, { x: 14, z: -26 }, { x: -14, z: 26 }, { x: 14, z: 26 },
        { x: -26, z: 30 }, { x: 26, z: 30 },
      ],
    },
    [
      // The deep end: a full vert ramp down the west flank.
      { type: 'vert', x: -22, z: 0, ry: 90, w: 12, R: 3.2, H: 2.8, flat: 5, deck: 2, color: '#264653' },
      // A mini ramp balancing it on the east.
      { type: 'mini', x: 22, z: 0, ry: 90, w: 12, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: '#e76f51' },
      // Twin pools flanking a spine transfer down the centre line.
      { type: 'bowl', x: 0, z: -16, R: 2.6, H: 1.5, rim: 1.3, color: '#2a9d8f' },
      { type: 'bowl', x: 0, z: 16, R: 2.6, H: 1.5, rim: 1.3, color: '#2a9d8f' },
      { type: 'spine', x: 0, z: 0, ry: 0, w: 18, R: 2.2, H: 1.5, gap: 4, color: '#8ab17d' },
      // Short spines north and south of the pools.
      { type: 'spine', x: 0, z: 24, ry: 0, w: 8, R: 1.8, H: 1.2, gap: 3, color: '#e9c46a' },
      { type: 'spine', x: 0, z: -24, ry: 0, w: 8, R: 1.8, H: 1.2, gap: 3, color: '#e9c46a' },
      // Quarterpipes on the east and west walls.
      { type: 'quarter', x: -40, z: -26, ry: 90, w: 14, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      { type: 'quarter', x: 40, z: -26, ry: 270, w: 14, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      { type: 'quarter', x: -40, z: 26, ry: 90, w: 14, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      { type: 'quarter', x: 40, z: 26, ry: 270, w: 14, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      // Big roll-ins at the top and bottom of the pad.
      { type: 'rollin', x: 0, z: 44, ry: 0, w: 20, R: 2.4, H: 1.6, deck: 10, color: '#e9c46a' },
      { type: 'rollin', x: 0, z: -44, ry: 180, w: 20, R: 2.4, H: 1.6, deck: 10, color: '#e9c46a' },
      // Corner bowls around the roll-in decks.
      { type: 'bowl', x: -24, z: 40, R: 2.0, H: 1.2, rim: 1.0, color: '#2a9d8f' },
      { type: 'bowl', x: 24, z: 40, R: 2.0, H: 1.2, rim: 1.0, color: '#2a9d8f' },
      { type: 'bowl', x: -24, z: -40, R: 2.0, H: 1.2, rim: 1.0, color: '#2a9d8f' },
      { type: 'bowl', x: 24, z: -40, R: 2.0, H: 1.2, rim: 1.0, color: '#2a9d8f' },
      // Floodlights on the corners, benches and planters between the pools.
      { type: 'floodlight', x: -50, z: 34, h: 4.5, color: '#e8e8e0' },
      { type: 'floodlight', x: 50, z: 34, h: 4.5, color: '#e8e8e0' },
      { type: 'floodlight', x: -50, z: -34, h: 4.5, color: '#e8e8e0' },
      { type: 'floodlight', x: 50, z: -34, h: 4.5, color: '#e8e8e0' },
      { type: 'bench', x: -46, z: -20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: 46, z: -20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: -46, z: 20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: 46, z: 20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'planter', x: -50, z: -50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: -50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'cone', x: -34, z: 34, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 34, z: 34, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: -34, z: -34, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 34, z: -34, h: 0.7, color: '#e8702c' },
      { type: 'trashcan', x: -46, z: 50, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 46, z: 50, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: -46, z: -50, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 46, z: -50, r: 0.35, h: 0.95, color: '#3a5a40' },
      // Trees and bushes on the edges.
      { type: 'tree', x: -52, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: -40, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 40, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 52, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -52, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -40, z: -56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 40, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 52, z: -56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'bush', x: -46, z: 55.5, r: 0.9 },
      { type: 'bush', x: 46, z: 55.5, r: 0.85 },
      { type: 'bush', x: -46, z: -55.5, r: 0.85 },
      { type: 'bush', x: 46, z: -55.5, r: 0.9 },
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
    ]
  ),

  // Birdland: Tony Shove's vert house. A big vert ramp at the centre, twin
  // roll-ins at the north and south for full-pipe speed lines, spine transfers
  // on the east and west flanks, quarterpipes on the walls and a funbox row
  // for popping airs in the middle.
  def(
    'shove',
    'Birdland',
    'Sky-high walls, tall roll-ins and spine transfers — big air for the Birdman.',
    {
      seed: 0xb1d0,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#4a4e69',
      spawn: { x: 0, y: 0, z: -36, yaw: 0 },
      patrol: [
        { x: 0, z: -36 }, { x: 0, z: -24 }, { x: -20, z: -8 }, { x: 20, z: -8 },
        { x: 0, z: 8 }, { x: 0, z: 32 }, { x: 16, z: 32 }, { x: -16, z: 32 },
      ],
      logos: [
        { x: -14, z: -26 }, { x: 14, z: -26 }, { x: -14, z: 26 }, { x: 14, z: 26 },
        { x: -26, z: 0 }, { x: 26, z: 0 },
      ],
    },
    [
      // The centrepiece: a full vert ramp, rims running east-west.
      { type: 'vert', x: 0, z: -10, ry: 0, w: 16, R: 3.6, H: 3.1, flat: 6, deck: 2.5, color: '#264653' },
      // Spine transfers on the flanks.
      { type: 'spine', x: -24, z: 14, ry: 90, w: 12, R: 2.0, H: 1.4, gap: 4, color: '#8ab17d' },
      { type: 'spine', x: 24, z: 14, ry: 90, w: 12, R: 2.0, H: 1.4, gap: 4, color: '#8ab17d' },
      // Quarterpipes on the four walls.
      { type: 'quarter', x: -24, z: -28, ry: 90, w: 14, R: 2.2, H: 1.5, deck: 2, color: '#f4a261' },
      { type: 'quarter', x: 24, z: -28, ry: 270, w: 14, R: 2.2, H: 1.5, deck: 2, color: '#f4a261' },
      { type: 'quarter', x: -24, z: 28, ry: 90, w: 14, R: 2.2, H: 1.5, deck: 2, color: '#f4a261' },
      { type: 'quarter', x: 24, z: 28, ry: 270, w: 14, R: 2.2, H: 1.5, deck: 2, color: '#f4a261' },
      // Tall roll-ins at the top and bottom of the pad.
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 20, R: 2.6, H: 1.8, deck: 12, color: '#e9c46a' },
      { type: 'rollin', x: 0, z: -40, ry: 180, w: 20, R: 2.6, H: 1.8, deck: 12, color: '#e9c46a' },
      // A bowl to pump on the south centre line.
      { type: 'bowl', x: 0, z: 20, R: 2.2, H: 1.3, rim: 1.1, color: '#2a9d8f' },
      // Funboxes for popping airs on the way through.
      { type: 'funbox', x: -32, z: 0, ry: 0, w: 8, d: 6, h: 1.0, R: 1.5, color: '#e76f51' },
      { type: 'funbox', x: 32, z: 0, ry: 0, w: 8, d: 6, h: 1.0, R: 1.5, color: '#e76f51' },
      // A stair block on the south-east corner with a handrail.
      { type: 'bank', x: 38, z: -23, ry: 0, w: 8, len: 8, h: 0.6, color: '#b388eb' },
      { type: 'slab', x: 38, z: -14, ry: 0, w: 8, d: 10, h: 0.6, color: '#cdb4db' },
      { type: 'stairs', x: 38, z: -8.125, ry: 180, w: 8, steps: 5, rise: 0.12, run: 0.35, color: '#b388eb' },
      { type: 'rail', x: 38, z: -8.1, ry: 90, len: 4, h: 0.8, color: '#e5e7eb' },
      // Ledges flanking the north roll-in.
      { type: 'ledge', x: -10, z: 36, ry: 0, len: 14, w: 1.0, h: 0.6, color: '#8ab17d' },
      { type: 'ledge', x: 10, z: 36, ry: 0, len: 14, w: 1.0, h: 0.6, color: '#8ab17d' },
      // Stadium lights and benches dressing the edges.
      { type: 'floodlight', x: -50, z: 40, h: 4.5, color: '#e8e8e0' },
      { type: 'floodlight', x: 50, z: 40, h: 4.5, color: '#e8e8e0' },
      { type: 'floodlight', x: -50, z: -40, h: 4.5, color: '#e8e8e0' },
      { type: 'floodlight', x: 50, z: -40, h: 4.5, color: '#e8e8e0' },
      { type: 'bench', x: -46, z: -20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: 46, z: -20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: -46, z: 20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bench', x: 46, z: 20, ry: 0, len: 3, color: '#6c757d' },
      { type: 'planter', x: -50, z: -50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: -50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'cone', x: -34, z: 34, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 34, z: 34, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: -34, z: -34, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 34, z: -34, h: 0.7, color: '#e8702c' },
      { type: 'trashcan', x: -46, z: 50, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 46, z: 50, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: -46, z: -50, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 46, z: -50, r: 0.35, h: 0.95, color: '#3a5a40' },
      // Trees and bushes on the edges.
      { type: 'tree', x: -52, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: -40, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 40, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 52, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -52, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -40, z: -56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 40, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 52, z: -56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'bush', x: -46, z: 55.5, r: 0.9 },
      { type: 'bush', x: 46, z: 55.5, r: 0.85 },
      { type: 'bush', x: -46, z: -55.5, r: 0.85 },
      { type: 'bush', x: 46, z: -55.5, r: 0.9 },
    ]
  ),

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

  // Garden Grove: Gnorbert's flatground garden. A row of pyramids and funboxes
  // down the centre line, twin minis flanking them, a raised pad with banks,
  // and planters, benches and flower beds everywhere — plenty for a garden gnome.
  def(
    'gnorbert',
    'Garden Grove',
    'Flat pads and flower beds — a tiny gnome\'s perfect flatground.',
    {
      seed: 0x9b37,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#588157',
      spawn: { x: 0, y: 0, z: -34, yaw: 0 },
      patrol: [
        { x: 0, z: -34 }, { x: -16, z: -24 }, { x: 16, z: -24 }, { x: -16, z: 8 },
        { x: 16, z: 8 }, { x: -12, z: 28 }, { x: 12, z: 28 }, { x: -12, z: 40 },
      ],
      logos: [
        { x: -14, z: -30 }, { x: 14, z: -30 }, { x: -14, z: 8 }, { x: 14, z: 8 },
        { x: 0, z: 2 }, { x: 0, z: 14 },
      ],
    },
    [
      // The garden line: a row of pyramids and funboxes down the centre.
      { type: 'pyramid', x: 0, z: -24, ry: 0, w: 6, d: 6, len: 3.5, h: 1.0, color: '#7c8691' },
      { type: 'pyramid', x: 0, z: -8, ry: 0, w: 5, d: 5, len: 3, h: 0.9, color: '#737b87' },
      { type: 'funbox', x: 0, z: 8, ry: 0, w: 8, d: 6, h: 0.9, R: 1.5, color: '#e76f51' },
      { type: 'funbox', x: 0, z: 18, ry: 0, w: 6, d: 5, h: 0.8, R: 1.4, color: '#f4a261' },
      // Twin minis flanking the garden.
      { type: 'mini', x: -18, z: 0, ry: 0, w: 10, R: 1.6, H: 1.1, flat: 3, deck: 1, color: '#2a9d8f' },
      { type: 'mini', x: 18, z: 0, ry: 0, w: 10, R: 1.6, H: 1.1, flat: 3, deck: 1, color: '#2a9d8f' },
      // A raised pad with banks up and down at the north of the line.
      { type: 'bank', x: 0, z: 24, ry: 0, w: 14, len: 6, h: 0.6, color: '#e9c46a' },
      { type: 'slab', x: 0, z: 30, ry: 0, w: 14, d: 6, h: 0.6, color: '#e9c46a' },
      { type: 'bank', x: 0, z: 36, ry: 180, w: 14, len: 6, h: 0.6, color: '#e9c46a' },
      // West stair block: bank up, plateau, stairs down.
      { type: 'bank', x: -38, z: -24, ry: 0, w: 8, len: 8, h: 0.7, color: '#b388eb' },
      { type: 'slab', x: -38, z: -14, ry: 0, w: 8, d: 12, h: 0.7, color: '#cdb4db' },
      { type: 'stairs', x: -38, z: -7.125, ry: 180, w: 8, steps: 5, rise: 0.14, run: 0.35, color: '#b388eb' },
      { type: 'rail', x: -38, z: -7, ry: 90, len: 4, h: 0.9, color: '#e5e7eb' },
      // Ledges along the flanks for grinding between the minis.
      { type: 'ledge', x: -30, z: 0, ry: 90, len: 12, w: 1.0, h: 0.5, color: '#8ab17d' },
      { type: 'ledge', x: 30, z: 0, ry: 270, len: 12, w: 1.0, h: 0.5, color: '#8ab17d' },
      // Long flatbars on the east of the garden.
      { type: 'rail', x: 18, z: 24, ry: 90, len: 16, h: 0.55, color: '#ff2fa0' },
      { type: 'rail', x: -18, z: 24, ry: 90, len: 16, h: 0.55, color: '#ff2fa0' },
      // Twin roll-ins at the south for a speed line back in.
      { type: 'rollin', x: 0, z: -40, ry: 180, w: 16, R: 2.2, H: 1.4, deck: 8, color: '#264653' },
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 16, R: 2.2, H: 1.4, deck: 8, color: '#264653' },
      // Planters: a garden's worth of beds down both sides of the line.
      { type: 'planter', x: -14, z: -38, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 14, z: -38, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -10, z: -14, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 10, z: -14, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -6, z: 14, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 6, z: 14, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -12, z: 34, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 12, z: 34, ry: 0, w: 1.6, d: 1.6, color: '#b7b7a4' },
      // A garden bench corner with bushes.
      { type: 'bench', x: 20, z: 40, ry: 0, len: 3, color: '#6c757d' },
      { type: 'bush', x: 16, z: 40, r: 0.9 },
      { type: 'bush', x: 24, z: 40, r: 0.9 },
      { type: 'bush', x: 20, z: 44, r: 0.85 },
      { type: 'bush', x: 20, z: 36, r: 0.85 },
      { type: 'bench', x: -20, z: -32, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 20, z: -32, ry: 90, len: 3, color: '#6c757d' },
      { type: 'foodtruck', x: -46, z: -46, ry: 90, len: 4.5, w: 2.1, color: '#f4a261' },
      { type: 'spectator', x: -44, z: -44, color: '#37506b' },
      { type: 'spectator', x: -42, z: -42, color: '#c94f3a' },
      { type: 'spectator', x: -46, z: -40, color: '#8ab17d' },
      { type: 'trashcan', x: -48, z: -44, r: 0.35, h: 0.95, color: '#3a5a40' },
      // Trees and bushes: a green edge around the whole garden.
      { type: 'tree', x: -52, z: 56.5, r: 1.3, h: 3.4, color: '#3a5a40' },
      { type: 'tree', x: -40, z: 56.5, r: 1.1, h: 3.0, color: '#3a5a40' },
      { type: 'tree', x: 40, z: 56.5, r: 1.2, h: 3.2, color: '#3a5a40' },
      { type: 'tree', x: 52, z: 56.5, r: 1.2, h: 2.9, color: '#3a5a40' },
      { type: 'tree', x: -52, z: -56.5, r: 1.2, h: 3.1, color: '#3a5a40' },
      { type: 'tree', x: -40, z: -56.5, r: 1.1, h: 2.8, color: '#3a5a40' },
      { type: 'tree', x: 40, z: -56.5, r: 1.3, h: 3.3, color: '#3a5a40' },
      { type: 'tree', x: 50, z: -56.5, r: 1.1, h: 3.0, color: '#3a5a40' },
      { type: 'tree', x: -53, z: 22, r: 1.2, h: 3.0, color: '#3a5a40' },
      { type: 'tree', x: 53, z: 22, r: 1.2, h: 3.0, color: '#3a5a40' },
      { type: 'bush', x: -46, z: 55.5, r: 0.9 },
      { type: 'bush', x: -34, z: 55.5, r: 0.8 },
      { type: 'bush', x: 34, z: 55.5, r: 0.85 },
      { type: 'bush', x: 46, z: 55.5, r: 0.95 },
      { type: 'bush', x: -46, z: -55.5, r: 0.85 },
      { type: 'bush', x: 44, z: -55.5, r: 0.9 },
      { type: 'bush', x: 48, z: -55.5, r: 0.8 },
      { type: 'bush', x: -52, z: 30, r: 0.9 },
      { type: 'bush', x: -52, z: 40, r: 0.85 },
      { type: 'bush', x: -52, z: 54, r: 0.9 },
      { type: 'bush', x: 52, z: 30, r: 0.9 },
      { type: 'bush', x: 52, z: 40, r: 0.85 },
      { type: 'bush', x: 52, z: 54, r: 0.9 },
    ]
  ),

  // Jungle Gym: Bananas' playground. Twin minis and a pool down the centre,
  // pyramids and funboxes around them, hoops over the flow, roll-ins at the
  // ends and a jungle of trees around the edge.
  def(
    'bananas',
    'Jungle Gym',
    'Minis, pyramids, hoops and pools — a playground for the ape of air.',
    {
      seed: 0xa91e,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#386641',
      spawn: { x: 0, y: 0, z: -34, yaw: 0 },
      patrol: [
        { x: 0, z: -34 }, { x: -14, z: -34 }, { x: 14, z: -34 }, { x: 0, z: -6 },
        { x: 0, z: 6 }, { x: -14, z: 34 }, { x: 14, z: 34 },
      ],
      logos: [
        { x: -14, z: -28 }, { x: 14, z: -28 }, { x: -14, z: 28 }, { x: 14, z: 28 },
        { x: 0, z: -12 }, { x: 0, z: 12 },
      ],
    },
    [
      // The playground line: twin minis, a pool and an a-frame each side.
      { type: 'mini', x: 0, z: -20, ry: 0, w: 12, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: '#e76f51' },
      { type: 'mini', x: 0, z: 20, ry: 0, w: 12, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: '#e76f51' },
      { type: 'bowl', x: 0, z: 0, R: 2.4, H: 1.4, rim: 1.2, color: '#2a9d8f' },
      { type: 'aframe', x: -14, z: 0, ry: 90, w: 6, d: 2, len: 3, h: 1.0, color: '#f4a261' },
      { type: 'aframe', x: 14, z: 0, ry: 90, w: 6, d: 2, len: 3, h: 1.0, color: '#f4a261' },
      // Pyramids and funboxes in the corners.
      { type: 'funbox', x: -24, z: 0, ry: 0, w: 8, d: 6, h: 1.1, R: 1.5, color: '#e76f51' },
      { type: 'funbox', x: 24, z: 0, ry: 0, w: 8, d: 6, h: 1.1, R: 1.5, color: '#e76f51' },
      { type: 'pyramid', x: -24, z: 20, ry: 0, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: 24, z: 20, ry: 0, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: -24, z: -20, ry: 0, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      { type: 'pyramid', x: 24, z: -20, ry: 0, w: 5, d: 5, len: 3.5, h: 1.1, color: '#7c8691' },
      // Spine transfers at the north and south of the pool.
      { type: 'spine', x: -36, z: 0, ry: 90, w: 10, R: 1.8, H: 1.2, gap: 3, color: '#8ab17d' },
      { type: 'spine', x: 36, z: 0, ry: 90, w: 10, R: 1.8, H: 1.2, gap: 3, color: '#8ab17d' },
      // Quarterpipes on the walls.
      { type: 'quarter', x: -40, z: -30, ry: 90, w: 12, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      { type: 'quarter', x: 40, z: -30, ry: 270, w: 12, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      { type: 'quarter', x: -40, z: 30, ry: 90, w: 12, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      { type: 'quarter', x: 40, z: 30, ry: 270, w: 12, R: 2.0, H: 1.3, deck: 1, color: '#f4a261' },
      // A raised pad with stairs at the north, and roll-ins at both ends.
      { type: 'bank', x: 0, z: 28, ry: 0, w: 8, len: 6, h: 0.6, color: '#b388eb' },
      { type: 'slab', x: 0, z: 34, ry: 0, w: 8, d: 6, h: 0.6, color: '#cdb4db' },
      { type: 'stairs', x: 0, z: 37.875, ry: 180, w: 8, steps: 5, rise: 0.12, run: 0.35, color: '#b388eb' },
      { type: 'rail', x: 0, z: 37.9, ry: 90, len: 4, h: 0.8, color: '#e5e7eb' },
      { type: 'rollin', x: 0, z: 40, ry: 0, w: 16, R: 2.4, H: 1.6, deck: 10, color: '#264653' },
      { type: 'rollin', x: 0, z: -40, ry: 180, w: 16, R: 2.4, H: 1.6, deck: 10, color: '#264653' },
      // Hoops to jump through over the flat between the minis.
      { type: 'hoop', x: 0, y: 2.4, z: -7, ry: 0, r: 2.0, tube: 0.12, color: '#e0552f' },
      { type: 'hoop', x: 0, y: 2.4, z: 7, ry: 0, r: 2.0, tube: 0.12, color: '#e0552f' },
      // Playground decor: benches and lamps.
      { type: 'bench', x: -20, z: 36, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 20, z: 36, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: -20, z: -36, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 20, z: -36, ry: 90, len: 3, color: '#6c757d' },
      { type: 'lamp', x: -50, z: 30, h: 5, color: '#8b9099' },
      { type: 'lamp', x: 50, z: 30, h: 5, color: '#8b9099' },
      { type: 'lamp', x: -50, z: -30, h: 5, color: '#8b9099' },
      { type: 'lamp', x: 50, z: -30, h: 5, color: '#8b9099' },
      { type: 'planter', x: -50, z: -50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: -50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: -50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 50, z: 50, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      // A jungle around the whole pad.
      { type: 'tree', x: -52, z: 56.5, r: 1.3, h: 3.4, color: '#3a5a40' },
      { type: 'tree', x: -40, z: 56.5, r: 1.1, h: 3.0, color: '#3a5a40' },
      { type: 'tree', x: 40, z: 56.5, r: 1.2, h: 3.2, color: '#3a5a40' },
      { type: 'tree', x: 52, z: 56.5, r: 1.2, h: 2.9, color: '#3a5a40' },
      { type: 'tree', x: -52, z: -56.5, r: 1.2, h: 3.1, color: '#3a5a40' },
      { type: 'tree', x: -40, z: -56.5, r: 1.1, h: 2.8, color: '#3a5a40' },
      { type: 'tree', x: 40, z: -56.5, r: 1.3, h: 3.3, color: '#3a5a40' },
      { type: 'tree', x: 50, z: -56.5, r: 1.1, h: 3.0, color: '#3a5a40' },
      { type: 'tree', x: -53, z: 22, r: 1.2, h: 3.0, color: '#3a5a40' },
      { type: 'tree', x: -53, z: 46, r: 1.1, h: 2.9, color: '#3a5a40' },
      { type: 'tree', x: 53, z: 22, r: 1.2, h: 3.1, color: '#3a5a40' },
      { type: 'tree', x: 53, z: 46, r: 1.1, h: 3.0, color: '#3a5a40' },
      { type: 'bush', x: -46, z: 55.5, r: 0.9 },
      { type: 'bush', x: -34, z: 55.5, r: 0.8 },
      { type: 'bush', x: 34, z: 55.5, r: 0.85 },
      { type: 'bush', x: 46, z: 55.5, r: 0.95 },
      { type: 'bush', x: -46, z: -55.5, r: 0.85 },
      { type: 'bush', x: 44, z: -55.5, r: 0.9 },
      { type: 'bush', x: 48, z: -55.5, r: 0.8 },
      { type: 'bush', x: -52, z: 30, r: 0.9 },
      { type: 'bush', x: -52, z: 40, r: 0.85 },
      { type: 'bush', x: -52, z: 54, r: 0.9 },
      { type: 'bush', x: 52, z: 30, r: 0.9 },
      { type: 'bush', x: 52, z: 40, r: 0.85 },
      { type: 'bush', x: 52, z: 54, r: 0.9 },
    ]
  ),

  // The Aviary: Raven's steel rail gauntlet. A central stair block with a long
  // handrail, twin ledge lines, long rails down both flanks, a pyramid and a
  // raised deck with grindable edges — a finale made of steel.
  def(
    'raven',
    'The Aviary',
    'A steel rail gauntlet — long bars, ledges and stairs for the finale.',
    {
      seed: 0x7ea8,
      padOnly: true,
      extentX: 56,
      extentZ: 60,
      ground: '#3a3f47',
      spawn: { x: 0, y: 0, z: -48, yaw: 0 },
      patrol: [
        { x: 0, z: -48 }, { x: -24, z: -20 }, { x: 24, z: -20 }, { x: -24, z: 20 },
        { x: 24, z: 20 }, { x: 0, z: 48 },
      ],
      logos: [
        { x: -14, z: -26 }, { x: 14, z: -26 }, { x: -30, z: 0 }, { x: 30, z: 0 },
        { x: -30, z: 30 }, { x: 30, z: 30 },
      ],
    },
    [
      // The centre stair block: bank up, plateau, stairs down, long handrail.
      { type: 'bank', x: 0, z: -20, ry: 0, w: 14, len: 8, h: 1.0, color: '#b388eb' },
      { type: 'slab', x: 0, z: -10, ry: 0, w: 14, d: 12, h: 1.0, color: '#cdb4db' },
      { type: 'stairs', x: 0, z: -3.125, ry: 180, w: 14, steps: 5, rise: 0.2, run: 0.35, color: '#b388eb' },
      { type: 'rail', x: 0, z: -3.1, ry: 90, len: 4, h: 1.1, color: '#e5e7eb' },
      // The second stair block: bank up from the south, stairs down the north.
      { type: 'bank', x: 0, z: 3, ry: 0, w: 14, len: 8, h: 1.0, color: '#b388eb' },
      { type: 'slab', x: 0, z: 12, ry: 0, w: 14, d: 10, h: 1.0, color: '#cdb4db' },
      { type: 'stairs', x: 0, z: 17.875, ry: 180, w: 14, steps: 5, rise: 0.2, run: 0.35, color: '#b388eb' },
      { type: 'rail', x: 0, z: 17.9, ry: 90, len: 4, h: 1.1, color: '#e5e7eb' },
      // Twin ledge lines grinding the corridor.
      { type: 'ledge', x: -9.5, z: 0, ry: 90, len: 24, w: 1.0, h: 0.8, color: '#8ab17d' },
      { type: 'ledge', x: 9.5, z: 0, ry: 270, len: 24, w: 1.0, h: 0.8, color: '#8ab17d' },
      // Long rails down both flanks of the yard.
      { type: 'rail', x: -20, z: 0, ry: 90, len: 48, h: 0.7, color: '#d7dce2' },
      { type: 'rail', x: 20, z: 0, ry: 90, len: 48, h: 0.7, color: '#d7dce2' },
      // A pyramid on the north line.
      { type: 'pyramid', x: 0, z: 28, ry: 0, w: 8, d: 8, len: 4, h: 1.4, color: '#8992a0' },
      // Raised decks with grindable ledges, west and east.
      { type: 'bank', x: -32, z: 6, ry: 0, w: 16, len: 8, h: 1.2, color: '#e9c46a' },
      { type: 'slab', x: -32, z: 14, ry: 0, w: 16, d: 8, h: 1.2, color: '#e9c46a' },
      { type: 'ledge', x: -32, z: 10, ry: 0, len: 16, w: 1.0, h: 1.2, color: '#3a86ff' },
      { type: 'stairs', x: -32, z: 18.7, ry: 180, w: 16, steps: 4, rise: 0.3, run: 0.35, color: '#b388eb' },
      { type: 'bank', x: 32, z: 6, ry: 0, w: 16, len: 8, h: 1.2, color: '#e9c46a' },
      { type: 'slab', x: 32, z: 14, ry: 0, w: 16, d: 8, h: 1.2, color: '#e9c46a' },
      { type: 'ledge', x: 32, z: 10, ry: 0, len: 16, w: 1.0, h: 1.2, color: '#3a86ff' },
      { type: 'stairs', x: 32, z: 18.7, ry: 180, w: 16, steps: 4, rise: 0.3, run: 0.35, color: '#b388eb' },
      // Rail garden at the south of the yard.
      { type: 'rail', x: 0, z: -40, ry: 90, len: 8, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: -14, z: -34, ry: 0, len: 8, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: 14, z: -34, ry: 0, len: 8, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: 0, z: -34, ry: 0, len: 6, h: 0.6, color: '#f4a261' },
      // Rail garden at the north.
      { type: 'rail', x: 0, z: 40, ry: 90, len: 8, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: -14, z: 34, ry: 0, len: 8, h: 0.5, color: '#e5e7eb' },
      { type: 'rail', x: 14, z: 34, ry: 0, len: 8, h: 0.5, color: '#e5e7eb' },
      // Yard decor: lamps, benches, cones and a banner.
      { type: 'lamp', x: -44, z: -20, h: 5, color: '#8b9099' },
      { type: 'lamp', x: 44, z: -20, h: 5, color: '#8b9099' },
      { type: 'lamp', x: -44, z: 20, h: 5, color: '#8b9099' },
      { type: 'lamp', x: 44, z: 20, h: 5, color: '#8b9099' },
      { type: 'bench', x: -44, z: -44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 44, z: -44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: -44, z: 44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 44, z: 44, ry: 90, len: 3, color: '#6c757d' },
      { type: 'banner', x: 0, z: 50, ry: 0, w: 8, h: 1.2, color: '#e0552f' },
      { type: 'cone', x: -30, z: -40, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 30, z: -40, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: -30, z: 40, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 30, z: 40, h: 0.7, color: '#e8702c' },
      { type: 'dumpster', x: -50, z: -6, ry: 0, w: 2.4, d: 1.3, h: 1.2, color: '#37506b' },
      { type: 'dumpster', x: 50, z: -6, ry: 0, w: 2.4, d: 1.3, h: 1.2, color: '#37506b' },
      { type: 'trashcan', x: -50, z: 30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 50, z: 30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: -50, z: -30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 50, z: -30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'graffiti', x: -50, z: 12, ry: 90, w: 2.4, h: 1.2, color: '#ff2fa0' },
      { type: 'graffiti', x: 50, z: 12, ry: 90, w: 2.4, h: 1.2, color: '#ff2fa0' },
      { type: 'graffiti', x: -50, z: -12, ry: 90, w: 2.4, h: 1.2, color: '#ff2fa0' },
      { type: 'graffiti', x: 50, z: -12, ry: 90, w: 2.4, h: 1.2, color: '#ff2fa0' },
      // Trees along the far edges only — the yard stays open.
      { type: 'tree', x: -52, z: 56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 52, z: 56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -52, z: -56.5, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 52, z: -56.5, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'bush', x: -46, z: 55.5, r: 0.85 },
      { type: 'bush', x: 46, z: 55.5, r: 0.9 },
      { type: 'bush', x: -46, z: -55.5, r: 0.9 },
      { type: 'bush', x: 46, z: -55.5, r: 0.85 },
    ]
  ),

  // ----------------------------------------------------------------------
  // The Gauntlet — the finale. Every rival shows up for this one: ten spots
  // ring the arena (see bossSpots, in the same order as BOSSES in boss.js),
  // each its own cleared section with a knot of fans, and a wall of crowd
  // lines the curb so the park never feels empty even at 5 in the morning.
  def(
    'gauntlet',
    'The Gauntlet',
    'The finale: every rival, every ramp, and a crowd to prove you came.',
    {
      seed: 0x62a7,
      padOnly: true,
      extentX: 60,
      extentZ: 60,
      ground: '#2b3242',
      spawn: { x: 0, y: 0, z: -52, yaw: 0 },
      patrol: [
        { x: 0, z: -50 }, { x: -36, z: 24 }, { x: -36, z: -24 },
        { x: 0, z: 42 }, { x: 36, z: -24 }, { x: 36, z: 24 },
      ],
      logos: [
        { x: 0, z: -46 }, { x: -34, z: 0 }, { x: 34, z: 0 },
        { x: 0, z: 46 }, { x: -20, z: -20 }, { x: 20, z: -20 },
      ],
      // The rivals' spots, one per section, in BOSSES order (boss.js): ace,
      // nova, rae, bolt, tigre, shove, briar, gnorbert, bananas, raven. All
      // sit on a ring just inside the curb, clear of every feature, so each
      // challenger can roll up to a spot and start a duel.
      bossSpots: [
        { x: 40.99, z: 20.89 },
        { x: 20.89, z: 40.99 },
        { x: -7.19, z: 45.44 },
        { x: -32.53, z: 32.53 },
        { x: -45.44, z: 7.19 },
        { x: -40.99, z: -20.89 },
        { x: -20.89, z: -40.99 },
        { x: 7.19, z: -45.44 },
        { x: 32.53, z: -32.53 },
        { x: 45.44, z: -7.19 },
      ],
    },
    [
      // The big vert wall dead north, under the lights — the arena's centerpiece.
      { type: 'vert', x: 0, z: 30, ry: 0, w: 20, R: 3.2, H: 2.8, flat: 6, deck: 4, color: '#3a86ff' },
      // Center pool: bowl, funbox with a rail over the deck, spine either side.
      { type: 'bowl', x: 0, z: 12, R: 4.5, H: 1.6, rim: 1.2, color: '#2ec4b6' },
      { type: 'funbox', x: 0, z: -6, ry: 0, w: 14, d: 10, h: 1.1, R: 1.6, color: '#3a86ff' },
      { type: 'rail', x: 0, z: -6, ry: 90, len: 12, h: 1.42, color: '#e5e7eb' },
      { type: 'spine', x: 0, z: -18, ry: 0, w: 12, R: 2.0, H: 1.5, gap: 3, color: '#e0552f' },
      { type: 'spine', x: -14, z: 14, ry: 90, w: 12, R: 2.0, H: 1.5, gap: 3, color: '#e0552f' },
      // South run: bank onto the deck, spine, then the funbox line.
      { type: 'bank', x: 0, z: -36, ry: 0, w: 12, len: 8, h: 1.0, color: '#e9c46a' },
      { type: 'slab', x: 0, z: -28, ry: 0, w: 12, d: 8, h: 1.0, color: '#e9c46a' },
      { type: 'rail', x: 0, z: -23, ry: 0, len: 10, h: 0.5, color: '#e5e7eb' },
      // West and east flanks: mini ramps, pyramids, aframes and a rail garden.
      { type: 'mini', x: -25, z: -6, ry: 90, w: 14, R: 2.2, H: 1.6, flat: 5, deck: 1.2, color: '#9b5de5' },
      { type: 'mini', x: 25, z: -6, ry: 90, w: 14, R: 2.2, H: 1.6, flat: 5, deck: 1.2, color: '#9b5de5' },
      { type: 'pyramid', x: -25, z: 16, ry: 0, w: 8, d: 8, len: 3, h: 1.2, color: '#ffd166' },
      { type: 'pyramid', x: 25, z: 16, ry: 0, w: 8, d: 8, len: 3, h: 1.2, color: '#ffd166' },
      { type: 'aframe', x: -25, z: -28, ry: 0, w: 8, d: 3, len: 4, h: 1.1, color: '#ff9e00' },
      { type: 'aframe', x: 25, z: -28, ry: 0, w: 8, d: 3, len: 4, h: 1.1, color: '#ff9e00' },
      { type: 'rail', x: -36, z: 8, ry: 0, len: 8, h: 0.5, color: '#f4a261' },
      { type: 'rail', x: 36, z: 8, ry: 0, len: 8, h: 0.5, color: '#f4a261' },
      { type: 'rail', x: -36, z: -12, ry: 0, len: 8, h: 0.5, color: '#f4a261' },
      { type: 'rail', x: 36, z: -12, ry: 0, len: 8, h: 0.5, color: '#f4a261' },
      { type: 'rail', x: 0, z: 18, ry: 0, len: 10, h: 0.5, color: '#e5e7eb' },
      // Corner bowls for pumping between the rival sections.
      { type: 'bowl', x: -16, z: 30, R: 4, H: 1.5, rim: 1.2, color: '#2ec4b6' },
      { type: 'bowl', x: 16, z: 30, R: 4, H: 1.5, rim: 1.2, color: '#2ec4b6' },
      // The west deck: bank onto the slab, a rail to grind across the top.
      { type: 'bank', x: -26, z: 40, ry: 0, w: 14, len: 8, h: 1.0, color: '#e9c46a' },
      { type: 'slab', x: -26, z: 48, ry: 0, w: 14, d: 8, h: 1.0, color: '#e9c46a' },
      { type: 'rail', x: -26, z: 48, ry: 0, len: 12, h: 1.32, color: '#e5e7eb' },
      // The east deck, mirrored on the south side between gnorbert and bananas.
      { type: 'bank', x: 26, z: -40, ry: 0, w: 12, len: 8, h: 1.0, color: '#e9c46a' },
      { type: 'slab', x: 26, z: -48, ry: 0, w: 12, d: 8, h: 1.0, color: '#e9c46a' },
      { type: 'rail', x: 26, z: -48, ry: 0, len: 10, h: 1.32, color: '#e5e7eb' },
      // Low ledges threading the open lanes between sections.
      { type: 'ledge', x: -14, z: -30, ry: 0, len: 10, w: 1.0, h: 0.6, color: '#3a86ff' },
      { type: 'ledge', x: 14, z: -30, ry: 0, len: 10, w: 1.0, h: 0.6, color: '#3a86ff' },
      { type: 'ledge', x: -16, z: 42, ry: 90, len: 8, w: 1.0, h: 0.6, color: '#3a86ff' },
      { type: 'ledge', x: 16, z: -46, ry: 90, len: 8, w: 1.0, h: 0.6, color: '#3a86ff' },
      { type: 'rail', x: -24, z: 30, ry: 90, len: 8, h: 0.5, color: '#f4a261' },
      { type: 'rail', x: 24, z: 38, ry: 90, len: 8, h: 0.5, color: '#f4a261' },
      // Night-market decor around the ring.
      { type: 'lamp', x: -44, z: -40, h: 5, color: '#8b9099' },
      { type: 'lamp', x: 44, z: -40, h: 5, color: '#8b9099' },
      { type: 'lamp', x: -44, z: 40, h: 5, color: '#8b9099' },
      { type: 'lamp', x: 44, z: 40, h: 5, color: '#8b9099' },
      { type: 'bench', x: -50, z: 0, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 50, z: 0, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: -20, z: 50, ry: 90, len: 3, color: '#6c757d' },
      { type: 'bench', x: 20, z: 50, ry: 90, len: 3, color: '#6c757d' },
      { type: 'cone', x: -30, z: 36, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 30, z: 36, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: -30, z: -36, h: 0.7, color: '#e8702c' },
      { type: 'cone', x: 30, z: -36, h: 0.7, color: '#e8702c' },
      { type: 'trashcan', x: -44, z: -30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 44, z: -30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: -44, z: 30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'trashcan', x: 44, z: 30, r: 0.35, h: 0.95, color: '#3a5a40' },
      { type: 'dumpster', x: -50, z: -44, ry: 0, w: 2.4, d: 1.3, h: 1.2, color: '#37506b' },
      { type: 'dumpster', x: 50, z: -44, ry: 0, w: 2.4, d: 1.3, h: 1.2, color: '#37506b' },
      { type: 'graffiti', x: -56, z: 0, ry: 90, w: 2.4, h: 1.2, color: '#ff2fa0' },
      { type: 'graffiti', x: 56, z: 0, ry: 90, w: 2.4, h: 1.2, color: '#ff2fa0' },
      { type: 'banner', x: 0, z: 52, ry: 0, w: 8, h: 1.2, color: '#e0552f' },
      { type: 'planter', x: -40, z: -8, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'planter', x: 40, z: -8, ry: 0, w: 2.4, d: 1.6, color: '#b7b7a4' },
      { type: 'foodtruck', x: -40, z: 28, ry: 0, len: 4.5, w: 2.1, color: '#2ec4b6' },
      { type: 'car', x: 40, z: 28, ry: 90, len: 4.2, w: 1.8, h: 0.6, color: '#3a7ca5' },
      // The crowd around each rival — one knot per section, wedge open to the
      // arena — plus the wall of fans beyond the curb.
      ...crowdCircle(40.99, 20.89, 0, 0, 6, 3.9, 0),
      ...crowdCircle(20.89, 40.99, 0, 0, 6, 3.9, 1),
      ...crowdCircle(-7.19, 45.44, 0, 0, 6, 3.9, 2),
      ...crowdCircle(-32.53, 32.53, 0, 0, 6, 3.9, 3),
      ...crowdCircle(-45.44, 7.19, 0, 0, 6, 3.9, 4),
      ...crowdCircle(-40.99, -20.89, 0, 0, 6, 3.9, 5),
      ...crowdCircle(-20.89, -40.99, 0, 0, 6, 3.9, 6),
      ...crowdCircle(7.19, -45.44, 0, 0, 6, 3.9, 7),
      ...crowdCircle(32.53, -32.53, 0, 0, 6, 3.9, 0),
      ...crowdCircle(45.44, -7.19, 0, 0, 6, 3.9, 1),
      ...fenceCrowd(),
      // Trees along the far edges, inside the curb.
      { type: 'tree', x: -56, z: 56, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 56, z: 56, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: -56, z: -56, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: 56, z: -56, r: 1.2, h: 3.2, color: '#46764a' },
      { type: 'tree', x: -56, z: 30, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 56, z: 30, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -56, z: -30, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 56, z: -30, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -30, z: 56, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 30, z: 56, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: -30, z: -56, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'tree', x: 30, z: -56, r: 1.1, h: 3.0, color: '#46764a' },
      { type: 'bush', x: -52, z: 56.5, r: 0.85 },
      { type: 'bush', x: 52, z: 56.5, r: 0.9 },
      { type: 'bush', x: -52, z: -56.5, r: 0.9 },
      { type: 'bush', x: 52, z: -56.5, r: 0.85 },
    ]
  ),
];

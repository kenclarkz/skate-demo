// The Open World: a single seamless city to roam and skate. One giant asphalt
// pad, streets at y = 0, raised sidewalks and plazas (their curbs read through
// the height field), buildings as tall slabs (collision comes from the same
// field), and rideable features — stairs, rails, ledges, banks, rollins,
// funboxes, a bowl — scattered through seven districts.
//
// This module only shapes the map. Discovering spots, local high scores, the
// minimap, fast travel and moving traffic live in city.js; the HUD wiring in
// hud.js. The layout is generated with a seeded PRNG so the map — and the
// audits and smoke tests that read it — come out identical every time.

import { def } from './parkLayouts.js';

export const CITY_HALF = 200; // 400 x 400 m world

const CELL = 50;    // street centre to street centre
const STREET = 12;  // street width
const BLOCK = CELL - STREET; // 38 m block face
const SW = 2.2;     // sidewalk width

const SIDEWALK = '#8f939c';
const CURB = '#7d828c';
const CONC = '#9ba0a8';
const STEEL = '#c0c6cf';
const WOOD = '#b98a5f';

const TOWER = ['#3f4248', '#464b55', '#4d525c', '#5a5f69', '#373a41'];
const TOWER2 = ['#353840', '#3d424b', '#424752'];
const OLD_BRICK = ['#a3523c', '#b5654a', '#9c4a34', '#c47a54'];
const UNI_BRICK = ['#9c6b4f', '#a97e63', '#b08d6e'];
const INDY = ['#6d737b', '#7a8087', '#8a9096'];
const BEACH_C = ['#e8d9c5', '#d9c6b0', '#f0e4d4'];
const HOUSE = ['#d9c9a3', '#c9b98a', '#e0d2ae'];
const HILL_EARTH = ['#8a7f6a', '#958a74'];
const CAR_COLORS = ['#3a7ca5', '#c94f3a', '#e0c341', '#8ab17d', '#6d5a94', '#d6c064'];
const CROWD_COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#e63946', '#457b9d', '#6a4c93', '#f77f00'];

// --- deterministic PRNG ---------------------------------------------------
let _seed = 0x51f15e;
function rand() {
  _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0;
  return _seed / 4294967296;
}
function between(a, b) {
  return a + rand() * (b - a);
}
function pick(arr) {
  return arr[(rand() * arr.length) | 0];
}

// --- object helpers -------------------------------------------------------
const slab = (x, z, w, d, h, color, ry = 0, y = 0) => ({ type: 'slab', x, z, w, d, h, color, ry, y });
const bank = (x, z, w, len, h, color, ry = 0, y = 0) => ({ type: 'bank', x, z, w, len, h, color, ry, y });
const stairs = (x, z, w, steps, rise, run, color, ry = 0, y = 0) => ({ type: 'stairs', x, z, w, steps, rise, run, color, ry, y });
const rail = (x, z, len, h, color, ry = 0, y = 0, r = 0.045) => ({ type: 'rail', x, z, len, h, color, ry, y, r });
const ledge = (x, z, len, w, h, color, ry = 0, y = 0) => ({ type: 'ledge', x, z, len, w, h, color, ry, y });
const rollin = (x, z, w, R, H, deck, color, ry = 0, y = 0) => ({ type: 'rollin', x, z, w, R, H, deck, color, ry, y });
const funbox = (x, z, w, d, h, R, color, ry = 0, y = 0) => ({ type: 'funbox', x, z, w, d, h, R, color, ry, y });
const pyramid = (x, z, w, d, len, h, color, ry = 0, y = 0) => ({ type: 'pyramid', x, z, w, d, len, h, color, ry, y });
const bowl = (x, z, R, H, rim, color, y = 0) => ({ type: 'bowl', x, z, R, H, rim, color, y });
const quarter = (x, z, w, R, H, deck, color, ry = 0, y = 0) => ({ type: 'quarter', x, z, w, R, H, deck, color, ry, y });
const tree = (x, z, r = 1.2, h = 3.2, color = '#46764a') => ({ type: 'tree', x, z, r, h, color });
const bush = (x, z, r = 0.85) => ({ type: 'bush', x, z, r });
const lamp = (x, z, h = 5, color = '#8b9099') => ({ type: 'lamp', x, z, h, color });
const bench = (x, z, ry = 0, len = 3, color = '#6c757d') => ({ type: 'bench', x, z, ry, len, color });
const planter = (x, z, ry = 0, w = 2.4, d = 1.6, color = '#b7b7a4') => ({ type: 'planter', x, z, ry, w, d, color });
const trashcan = (x, z, r = 0.35, h = 0.95, color = '#3a5a40') => ({ type: 'trashcan', x, z, r, h, color });
const car = (x, z, ry = 90, len = 4.2, w = 1.8, color = '#3a7ca5', h = 0.6) => ({ type: 'car', x, z, ry, len, w, h, color });
const foodtruck = (x, z, ry = 0, len = 4.5, w = 2.1, color = '#2ec4b6') => ({ type: 'foodtruck', x, z, ry, len, w, color });
const spectator = (x, z, color) => ({ type: 'spectator', x, z, color });

// --- the spots ------------------------------------------------------------
// Every discoverable spot. `i/j` name the block it lives in; `x/z` the spot
// centre (the block centre) so discovery, logos, challenges and fast travel
// all line up with the features the generator builds there. `target` is the
// combo that finishes the spot's challenge.
export const CITY_SPOTS = [
  { id: 'plaza', name: 'Market Plaza', district: 'Downtown', i: 4, j: 4, r: 16, target: 3000 },
  { id: 'garage', name: 'Garage Rooftop', district: 'Downtown', i: 5, j: 5, r: 14, target: 5000 },
  { id: 'towers', name: 'Tower Steps', district: 'Downtown', i: 3, j: 4, r: 12, target: 4500 },
  { id: 'quad', name: 'Campus Quad', district: 'University', i: 6, j: 2, r: 14, target: 4000 },
  { id: 'libsteps', name: 'Library Steps', district: 'University', i: 6, j: 3, r: 12, target: 4500 },
  { id: 'dock', name: 'Loading Dock', district: 'Industrial', i: 1, j: 4, r: 13, target: 5000 },
  { id: 'roof', name: 'Warehouse Roof', district: 'Industrial', i: 1, j: 3, r: 12, target: 5500 },
  { id: 'yard', name: 'The Yard', district: 'Industrial', i: 0, j: 3, r: 12, target: 3500 },
  { id: 'walk', name: 'Beach Boardwalk', district: 'Beach', i: 6, j: 6, r: 16, target: 4000 },
  { id: 'bowl', name: 'Beach Bowl', district: 'Beach', i: 5, j: 6, r: 13, target: 5000 },
  { id: 'alley', name: 'The Alley', district: 'Old Town', i: 1, j: 6, r: 10, target: 6000 },
  { id: 'square', name: 'Old Square', district: 'Old Town', i: 2, j: 6, r: 14, target: 4000 },
  { id: 'crest', name: 'Hillcrest', district: 'Hills', i: 3, j: 1, r: 14, target: 5500 },
  { id: 'ridge', name: 'Ridge Run', district: 'Hills', i: 4, j: 1, r: 13, target: 4500 },
  { id: 'drive', name: 'Driveway Rail', district: 'Suburbs', i: 1, j: 1, r: 12, target: 3000 },
  { id: 'deadend', name: 'Dead End Ledge', district: 'Suburbs', i: 2, j: 1, r: 12, target: 3500 },
];

const SPOT_BY_BLOCK = new Map(CITY_SPOTS.map((s) => [`${s.i},${s.j}`, s]));

// --- block geometry -------------------------------------------------------
export function blockRect(i, j) {
  const x0 = i * CELL - CITY_HALF + STREET / 2;
  const z0 = j * CELL - CITY_HALF + STREET / 2;
  return { x0, z0, x1: x0 + BLOCK, z1: z0 + BLOCK, cx: x0 + BLOCK / 2, cz: z0 + BLOCK / 2 };
}

// Every spot sits at its block's centre, so discovery, logos, challenges and
// fast travel all line up with the features the generator builds there.
for (const s of CITY_SPOTS) {
  const r = blockRect(s.i, s.j);
  s.x = r.cx;
  s.z = r.cz;
}

function inr(r) {
  return { x0: r.x0 + SW, z0: r.z0 + SW, x1: r.x1 - SW, z1: r.z1 - SW };
}

/** The raised sidewalk ring around a block — four curbs onto the street. */
function ring(o, r) {
  o.push(slab(r.cx, r.z0 + SW / 2, BLOCK, SW, 0.16, SIDEWALK));
  o.push(slab(r.cx, r.z1 - SW / 2, BLOCK, SW, 0.16, SIDEWALK));
  o.push(slab(r.x0 + SW / 2, r.cz, SW, BLOCK, 0.16, SIDEWALK));
  o.push(slab(r.x1 - SW / 2, r.cz, SW, BLOCK, 0.16, SIDEWALK));
}

// --- district layout ------------------------------------------------------
export function districtOf(i, j) {
  if (i >= 2 && i <= 5 && j >= 2 && j <= 5) return 'Downtown';
  if (j >= 5) return i >= 5 ? 'Beach' : 'Old Town';
  if (j <= 2) {
    if (i >= 5) return 'University';
    if (i >= 2) return 'Hills';
    return 'Suburbs';
  }
  if (i <= 2) return 'Industrial';
  if (i >= 5) return 'University';
  return 'Downtown';
}

// Downtown: tall towers and street-level curbs between them.
function dtTowers(o, r) {
  const a = { x: r.x1 - between(9, 12), z: r.z0 + between(6, 9), w: between(11, 14), d: between(11, 14), h: between(8, 13), c: pick(TOWER) };
  const b = { x: r.x0 + between(6, 9), z: r.z1 - between(9, 12), w: between(10, 13), d: between(10, 13), h: between(6, 9), c: pick(TOWER2) };
  o.push(slab(a.x, a.z, a.w, a.d, a.h, a.c));
  o.push(slab(b.x, b.z, b.w, b.d, b.h, b.c));
  o.push(slab(r.cx, r.cz + 1, 6, 4, 0.45, CURB));
  o.push(ledge(b.x + b.w / 2 + 1.5, b.z - b.d / 2 - 1.4, 7, 0.9, 0.55, CONC, 0));
  o.push(lamp(r.x0 + SW + 2.2, r.z0 + SW + 2.2));
  if (rand() < 0.5) o.push(tree(r.x1 - SW - 2.4, r.z1 - SW - 2.4));
  if (rand() < 0.7) o.push(trashcan(r.x1 - SW - 2, r.z0 + SW + 2));
  if (rand() < 0.7) o.push(car(r.x0 + SW + 3, r.z1 - SW - 1.2));
}

// Downtown spot "plaza": the open Market Plaza block. Elevated patio with
// stairs from the street, a funbox, ledges and a pyramid.
function dtPlaza(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0, I.z1 - I.z0, 0.54, CONC));
  o.push(stairs(r.cx, I.z1 + 1.05, 10, 3, 0.18, 0.7, CONC, 180));
  o.push(bank(r.x0 + SW + 2.5, r.cz, 8, 6, 0.54, CONC, 90));
  o.push(funbox(r.cx - 5, r.cz + 3, 6, 5, 0.8, 1.3, WOOD));
  o.push(pyramid(r.cx + 6, r.cz - 4, 5, 5, 3, 0.9, CONC));
  o.push(ledge(r.cx - 9, I.z1 - 1.5, 8, 0.9, 0.5, CONC, 0));
  o.push(ledge(r.cx + 7, I.z0 + 1.5, 6, 0.9, 0.5, CONC, 180));
  o.push(tree(r.cx - 10, I.z0 + 3, 1.4, 3.8));
  o.push(bench(r.cx + 10, I.z1 - 3, 180));
  o.push(foodtruck(r.x1 - SW - 1, I.z1 - 2, 180));
  o.push(spectator(r.cx + 4, I.z0 + 4, CROWD_COLORS[2]));
  o.push(spectator(r.cx - 2, I.z0 + 5, CROWD_COLORS[5]));
  o.push(lamp(r.x0 + SW + 2, r.cz - 3));
}

// Downtown spot "garage": a two-level parking structure with a roof deck.
function dtGarage(o, r) {
  ring(o, r);
  const I = inr(r);
  const gd = I.z1 - I.z0;
  o.push(slab(r.x0 + SW + 2, r.cz, I.x1 - I.x0 - 4, gd, 0.5, CURB)); // level 1
  o.push(slab(r.cx, r.cz + 7, 16, gd - 16, 2.2, TOWER2[0]));          // level 2 (roof)
  // entry ramps
  o.push(rollin(I.x0 + 4, r.cz + 8, 8, 0.9, 0.5, 2.5, CONC, 90));
  o.push(rollin(I.x0 + 4, r.cz - 8, 8, 0.9, 0.5, 2.5, CONC, 90));
  o.push(bank(r.cx - 2, r.cz + 7 - (gd - 16) / 2 + 3, 16, 6, 1.7, CONC, 180));
  // roof grinds
  o.push(ledge(r.cx + 3, r.cz + 7 + (gd - 16) / 2 - 1.6, 9, 0.9, 0.5, CONC, 0));
  o.push(rail(r.cx - 5, r.cz + 7 - (gd - 16) / 2 + 2.5, 8, 0.7, STEEL, 90));
  // street-level rail
  o.push(rail(I.x0 + 4, r.cz, 10, 0.85, STEEL, 90));
  // parked cars on level 1
  o.push(car(I.x0 + 6, r.cz - gd / 2 + 4, 0, 4.2, 1.8, CAR_COLORS[0]));
  o.push(car(I.x1 - 6, r.cz + gd / 2 - 4, 180, 4.2, 1.8, CAR_COLORS[1]));
  o.push(lamp(I.x1 - SW - 2, r.z0 + SW + 2));
}

// Downtown spot "towers": wide steps in front of a tower, rails and ledges.
function dtTowerSteps(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, I.z0 + 8, 26, 17, 9, pick(TOWER)));
  o.push(slab(r.cx - 4, I.z0 + 8, 8, 8, 6, TOWER2[1]));
  o.push(slab(r.cx, I.z1 - 7, 24, 14, 0.54, CONC));
  o.push(stairs(r.cx, I.z1 + 1.05, 10, 3, 0.18, 0.7, CONC, 180));
  o.push(rail(r.cx - 6, I.z1 - 4, 8, 0.8, STEEL, 90));
  o.push(rail(r.cx + 5, I.z1 - 4, 6, 0.8, STEEL, 90));
  o.push(ledge(r.cx - 8, r.cz - 1, 7, 0.9, 0.55, CONC, 90));
  o.push(tree(r.cx + 9, I.z1 - 11, 1.2, 3.4));
  o.push(bench(r.cx + 8, I.z1 - 2.5, 90));
  o.push(lamp(r.x0 + SW + 2, r.cz - 3));
}

// University: low brick buildings around an open quad plaza.
function uniQuad(o, r, withSteps) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.x0 + SW + 5, r.cz, 11, I.z1 - I.z0 - 8, 4, pick(UNI_BRICK)));
  o.push(slab(r.x1 - SW - 5, r.cz, 11, I.z1 - I.z0 - 8, 4, pick(UNI_BRICK)));
  o.push(slab(r.cx, r.cz + 1, I.x1 - I.x0 - 20, I.z1 - I.z0 - 14, 0.5, CONC));
  if (withSteps) o.push(stairs(r.cx, I.z1 + 1, 8, 3, 0.18, 0.7, CONC, 180));
  else o.push(bank(r.x0 + SW + 2, r.cz, 8, 6, 0.5, CONC, 90));
  o.push(funbox(r.cx, r.cz - 3, 6, 5, 0.85, 1.3, UNI_BRICK[0]));
  o.push(ledge(r.cx - 8, I.z1 - 2, 7, 0.9, 0.5, CONC, 0));
  o.push(planter(r.cx + 8, r.cz - 5));
  o.push(tree(r.cx - 10, I.z0 + 3, 1.3, 3.5));
  o.push(tree(r.cx + 10, I.z1 - 3, 1.3, 3.5));
  o.push(bench(r.cx - 8, I.z0 + 3, 90));
  o.push(trashcan(r.x1 - SW - 2, I.z1 - 2));
}

// University spot "libsteps": a library with a grand set of steps and rails.
function uniLibrary(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, I.z0 + 6, 26, 12, 5, pick(UNI_BRICK)));
  o.push(slab(r.cx, I.z1 - 6, 26, 12, 0.55, CONC));
  o.push(stairs(r.cx, I.z1 + 1.05, 12, 3, 0.18, 0.7, CONC, 180));
  o.push(rail(r.cx - 4, I.z1 - 4, 10, 0.85, STEEL, 90));
  o.push(rail(r.cx + 5, I.z1 - 4, 6, 0.85, STEEL, 90));
  o.push(ledge(r.cx - 5, I.z0 + 13.5, 12, 0.9, 0.55, CONC, 0));
  o.push(tree(r.cx - 10, I.z1 - 2.5, 1.4, 3.6));
  o.push(bench(r.cx - 8, I.z1 - 3, 90));
  o.push(lamp(r.x1 - SW - 2, I.z0 + 2));
}

// Industrial: a low warehouse with a roll-in onto the roof, loading-dock
// banks and a flat rail.
function indWarehouse(o, r, roofSpot) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0 - 6, I.z1 - I.z0 - 6, 2.2, pick(INDY)));
  if (roofSpot) {
    o.push(ledge(r.cx - 6, I.z0 + 3, 10, 0.9, 0.5, CONC, 90));
    o.push(rail(r.cx + 4, I.z0 + 3, 10, 0.7, STEEL, 90));
  }
  o.push(rollin(r.x0 + SW + 2, r.cz - 6, 8, 2.6, 1.4, 3, CONC, 180));
  o.push(bank(r.x0 + SW + 3, r.cz + 9, 10, 5, 0.7, CONC, 90));
  o.push(rail(r.cx - 8, r.cz + 9, 9, 0.85, STEEL, 90));
  o.push(car(r.x1 - SW - 2.5, r.cz - 8, 0, 5.2, 2, INDY[2]));
  o.push(car(r.x1 - SW - 3, r.cz + 8, 0, 5.2, 2, INDY[0]));
  if (rand() < 0.7) o.push(trashcan(r.x0 + SW + 2, I.z1 - 2));
}

// Industrial spot "dock": a loading dock — tall bank and coping line.
function indDock(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz - 6, I.x1 - I.x0 - 8, 16, 1.2, CURB));
  o.push(bank(r.cx, I.z1 - 6, 20, 8, 1.2, CONC, 180));
  o.push(ledge(r.cx, I.z0 + 2, 12, 0.9, 0.55, CONC, 90));
  o.push(rollin(r.cx, r.cz + 10, 8, 2.0, 1.2, 3, CONC, 0));
  o.push(rail(r.x0 + SW + 2, r.cz, 10, 0.85, STEEL, 90));
  o.push(car(r.x1 - SW - 2.5, r.cz, 0, 5.2, 2, INDY[1]));
  o.push(spectator(r.x0 + SW + 4, I.z1 - 4, CROWD_COLORS[0]));
}

// Industrial spot "yard": an open yard with a big bank and a pyramid.
function indYard(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(bank(r.cx - 8, I.z0 + 3, 12, 9, 1.0, CONC, 90));
  o.push(pyramid(r.cx + 7, r.cz + 4, 6, 6, 3.5, 1.1, INDY[2]));
  o.push(rail(r.cx, r.cz - 6, 12, 0.9, STEEL, 90));
  o.push(ledge(r.cx - 9, r.cz - 1, 8, 0.9, 0.55, CONC, 0));
  o.push(slab(r.cx + 6, I.z1 - 3, 10, 5, 0.4, CURB));
  o.push(car(r.x0 + SW + 2.5, r.cz + 4, 0, 4.2, 1.8, CAR_COLORS[3]));
  o.push(trashcan(r.x1 - SW - 2, r.z0 + SW + 2));
}

// Beach: a raised boardwalk running the length of the block with banks down
// to the street, palms and benches.
function beachWalk(o, r, withBowl) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz - 9, I.x1 - I.x0, 20, 1.1, WOOD));
  o.push(bank(r.cx, I.z0 - 5.7, I.x1 - I.x0 - 4, 7, 1.1, WOOD, 0));
  o.push(bank(r.cx, I.z1 - 12.3, I.x1 - I.x0 - 4, 7, 1.1, WOOD, 180));
  o.push(ledge(r.cx - 4, r.cz - 9 + 9, 8, 0.9, 0.5, CONC, 90));
  o.push(rail(r.cx + 3, r.cz - 9 + 9, 8, 0.75, STEEL, 90));
  o.push(planter(r.cx - 11, r.cz + 6));
  o.push(planter(r.cx + 11, r.cz - 2));
  o.push(bench(r.cx - 10, r.cz - 9 - 10, 0));
  o.push(foodtruck(r.cx + 10, r.cz + 11, 180));
  o.push(spectator(r.cx - 8, r.cz + 9, CROWD_COLORS[3]));
  o.push(spectator(r.cx + 6, r.cz - 8, CROWD_COLORS[6]));
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.4, 4.2));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.4, 4.2));
}

// Beach spot "bowl": a sunk pool in the pad flanked by two quarters, with the
// boardwalk kept clear so the pit's hole in the concrete is never covered.
function beachBowl(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(bowl(r.cx - 4, r.cz, 3.2, 1.8, 1.5, '#2a9d8f'));
  o.push(quarter(r.cx + 6, r.cz + 6, 8, 2.4, 1.6, 0, WOOD, 0));
  o.push(quarter(r.cx + 6, r.cz - 6, 8, 2.4, 1.6, 0, WOOD, 180));
  o.push(ledge(r.cx - 11, r.cz + 2, 9, 0.9, 0.55, CONC, 0));
  o.push(bench(r.cx + 10, r.cz + 4, 0));
  o.push(foodtruck(r.x1 - SW - 1, I.z1 - 2, 180));
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.4, 4.2));
  o.push(tree(r.x1 - SW - 3, I.z0 + 3, 1.4, 4.2));
  o.push(spectator(r.cx - 8, r.cz - 6, CROWD_COLORS[3]));
  o.push(spectator(r.cx + 8, r.cz - 8, CROWD_COLORS[2]));
  o.push(trashcan(r.x1 - SW - 2, I.z1 - 2));
}

// Old Town: dense brick buildings with a narrow alley between them.
function oldTown(o, r, alleySpot) {
  const I = inr(r);
  const c = pick(OLD_BRICK);
  const c2 = pick(OLD_BRICK);
  o.push(slab(r.x0 + SW + 5, r.cz - 4, 13, I.z1 - I.z0 - 12, 6, c));
  o.push(slab(r.x1 - SW - 5, r.cz + 2, 13, I.z1 - I.z0 - 16, 6, c2));
  o.push(slab(r.x0 + SW + 6, I.z1 - 6, 10, 8, 5, c2));
  if (alleySpot) {
    // the alley runs down the middle of the block — ride it, grind it.
    o.push(ledge(r.cx + 1, r.cz + 5, 11, 0.9, 0.6, CONC, 0));
    o.push(rail(r.cx - 1, r.cz - 5, 11, 0.9, STEEL, 90));
    o.push(trashcan(r.cx - 4, r.cz - 8));
    o.push(trashcan(r.cx + 4, r.cz + 8));
  } else {
    o.push(planter(r.cx, r.cz + 3));
    o.push(planter(r.cx, r.cz - 4));
  }
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  if (rand() < 0.6) o.push(car(r.x1 - SW - 2.5, r.cz - 6, 0, 4.2, 1.8, CAR_COLORS[4]));
}

// Old Town spot "square": a small square with a planter ring and a ledge.
function oldSquare(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, 22, 20, 0.5, CONC));
  o.push(stairs(r.cx, I.z1 - 5.75, 6, 3, 0.18, 0.7, CONC, 180));
  o.push(bank(I.x0 + 4, r.cz, 8, 6, 0.5, CONC, 90));
  o.push(planter(r.cx + 3, r.cz - 2, 0, 3, 3, '#b7b7a4'));
  o.push(ledge(r.cx - 8, r.cz + 2, 8, 0.9, 0.5, CONC, 0));
  o.push(ledge(r.cx + 2, r.cz - 6, 7, 0.9, 0.5, CONC, 90));
  o.push(tree(r.cx - 9, r.cz - 5, 1.3, 3.6));
  o.push(bench(r.cx + 8, r.cz + 6, 180));
  o.push(foodtruck(r.x0 + SW + 2, r.z0 + SW + 2, 0));
  o.push(spectator(r.cx - 4, r.cz + 7, CROWD_COLORS[1]));
  o.push(spectator(r.cx + 5, r.cz - 7, CROWD_COLORS[4]));
}

// Hills: a long bank up to a crest with a rail down the other side.
function hillCrest(o, r, big) {
  const I = inr(r);
  const c = pick(HILL_EARTH);
  const h = big ? 3.0 : 2.2;
  o.push(bank(r.cx - 4, I.z0 + 2, 20, 12, h, c, 90));
  o.push(slab(r.cx - 4, r.cz, 20, 14, h, c));
  o.push(bank(r.cx - 4, I.z1 - 2, 20, 12, h, c, 270));
  o.push(rail(r.cx + 2, r.cz - 2, 12, 0.8, STEEL, 90));
  o.push(ledge(r.cx - 6, r.cz + 2, 10, 0.9, 0.55, CONC, 90));
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.3, 3.6));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.3, 3.6));
  o.push(bush(r.x1 - SW - 2, I.z0 + 3));
  if (rand() < 0.5) o.push(bench(r.cx + 8, r.cz - 6, 90));
}

// Suburbs: houses around a shared pad, a driveway bank and a flat rail.
function suburbs(o, r, withDrive) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.x0 + SW + 4, I.z0 + 7, 17, 13, 2.8, pick(HOUSE)));
  o.push(slab(r.x1 - SW - 4, I.z0 + 7, 13, 11, 2.6, pick(HOUSE)));
  o.push(slab(r.cx - 5, I.z1 - 4, 15, 8, 2.5, pick(HOUSE)));
  if (withDrive) {
    o.push(bank(I.x1 - 8, r.cz, 7, 5, 0.35, CONC, 90));
    o.push(rail(r.cx, r.cz, 10, 0.75, STEEL, 90));
  }
  o.push(ledge(r.cx + 4, r.cz - 6, 8, 0.9, 0.5, CONC, 0));
  o.push(tree(r.x0 + SW + 3, r.cz - 4, 1.4, 3.8));
  o.push(tree(r.x1 - SW - 3, r.cz + 5, 1.2, 3.2));
  o.push(bush(r.x1 - SW - 2, I.z0 + 3));
  o.push(car(r.cx - 7, I.z1 - 2, 90, 4.2, 1.8, CAR_COLORS[5]));
  o.push(lamp(r.x0 + SW + 2, r.cz));
}

// Suburbs spot "deadend": a long ledge and a little bank near the houses.
function subDead(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.x0 + SW + 4, I.z0 + 7, 16, 12, 2.8, pick(HOUSE)));
  o.push(slab(r.x1 - SW - 4, I.z0 + 7, 12, 10, 2.6, pick(HOUSE)));
  o.push(slab(r.cx - 4, I.z1 - 4, 14, 8, 2.5, pick(HOUSE)));
  o.push(bank(I.x0 + 2, r.cz, 7, 6, 0.35, CONC, 90));
  o.push(ledge(r.cx, r.cz + 3, 12, 0.9, 0.55, CONC, 0));
  o.push(rail(r.cx - 2, r.cz - 5, 8, 0.7, STEEL, 90));
  o.push(tree(r.cx + 8, r.cz - 4, 1.4, 3.8));
  o.push(bush(r.x0 + SW + 3, I.z0 + 3));
  o.push(bench(r.cx - 9, r.cz + 5, 90));
  o.push(car(r.x1 - SW - 3, r.cz + 2, 0, 4.2, 1.8, CAR_COLORS[2]));
}

/** Build one block's worth of objects into `out`. */
function buildBlock(out, i, j) {
  const r = blockRect(i, j);
  const spot = SPOT_BY_BLOCK.get(`${i},${j}`);
  const d = districtOf(i, j);

  if (spot) {
    switch (spot.id) {
      case 'plaza': dtPlaza(out, r); return;
      case 'garage': dtGarage(out, r); return;
      case 'towers': dtTowerSteps(out, r); return;
      case 'quad': uniQuad(out, r, true); return;
      case 'libsteps': uniLibrary(out, r); return;
      case 'dock': indDock(out, r); return;
      case 'roof': indWarehouse(out, r, true); return;
      case 'yard': indYard(out, r); return;
      case 'walk': beachWalk(out, r, false); return;
      case 'bowl': beachBowl(out, r); return;
      case 'alley': oldTown(out, r, true); return;
      case 'square': oldSquare(out, r); return;
      case 'crest': hillCrest(out, r, true); return;
      case 'ridge': hillCrest(out, r, false); return;
      case 'drive': suburbs(out, r, true); return;
      case 'deadend': subDead(out, r); return;
    }
  }

  switch (d) {
    case 'Downtown': dtTowers(out, r); break;
    case 'University': uniQuad(out, r, false); break;
    case 'Industrial': indWarehouse(out, r, false); break;
    case 'Beach': beachWalk(out, r, false); break;
    case 'Old Town': oldTown(out, r, false); break;
    case 'Hills': hillCrest(out, r, false); break;
    case 'Suburbs': suburbs(out, r, false); break;
  }
}

// --- assembling the map ----------------------------------------------------
function buildCity() {
  const objects = [];
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) buildBlock(objects, i, j);
  }
  return objects;
}

const objects = buildCity();

export const CITY = def(
  'city',
  'Open World',
  'A whole city to roam: seven districts, hidden spots, traffic and skyline.',
  {
    ground: '#43454c',
    extentX: CITY_HALF,
    extentZ: CITY_HALF,
    noFence: true,
    zoneSize: 25,
    spawn: { x: 0, z: 0, yaw: 0 },
    patrol: [
      { x: -150, z: -150 },
      { x: -150, z: -50 },
      { x: 150, z: -50 },
      { x: 150, z: -150 },
      { x: -150, z: -150 },
      { x: -150, z: 150 },
      { x: 150, z: 150 },
      { x: 150, z: 50 },
      { x: -150, z: 50 },
      { x: -150, z: 150 },
    ],
    logos: CITY_SPOTS.map((s) => ({ x: s.x, z: s.z })),
    objectCount: objects.length,
  },
  objects
);

// Street-centerline loops the traffic drives. Each leg runs along a gridline
// (the asphalt streets), so a car never clips a building or a curb.
export const CITY_ROUTES = [
  [
    { x: -150, z: -150 }, { x: -50, z: -150 }, { x: 50, z: -150 }, { x: 150, z: -150 },
    { x: 150, z: -50 }, { x: 150, z: 50 }, { x: 150, z: 150 },
    { x: 50, z: 150 }, { x: -50, z: 150 }, { x: -150, z: 150 },
    { x: -150, z: 50 }, { x: -150, z: -50 },
  ],
  [
    { x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 },
  ],
];

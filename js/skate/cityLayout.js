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

export const CITY_HALF = 500; // 1000 x 1000 m world

const GRID = 20;     // 20 x 20 blocks
const CELL = 50;     // street centre to street centre
const STREET = 12;   // street width
const BLOCK = CELL - STREET; // 38 m block face
const SW = 2.2;      // sidewalk width

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
const spine = (x, z, ry, w, R, H, gap, color, y = 0) => ({ type: 'spine', x, z, ry, w, R, H, gap, color, y });
const vert = (x, z, w, R, H, color, ry = 0, y = 0) => ({ type: 'vert', x, z, w, R, H, flat: 5, deck: 2, color, ry, y });
const mini = (x, z, w, R, H, color, ry = 0, y = 0) => ({ type: 'mini', x, z, w, R, H, flat: 3, deck: 1.5, color, ry, y });
const tree = (x, z, r = 1.2, h = 3.2, color = '#46764a') => ({ type: 'tree', x, z, r, h, color });
const bush = (x, z, r = 0.85) => ({ type: 'bush', x, z, r });
const lamp = (x, z, h = 5, color = '#8b9099') => ({ type: 'lamp', x, z, h, color });
const bench = (x, z, ry = 0, len = 3, color = '#6c757d') => ({ type: 'bench', x, z, ry, len, color });
const planter = (x, z, ry = 0, w = 2.4, d = 1.6, color = '#b7b7a4') => ({ type: 'planter', x, z, ry, w, d, color });
const trashcan = (x, z, r = 0.35, h = 0.95, color = '#3a5a40') => ({ type: 'trashcan', x, z, r, h, color });
const hydrant = (x, z, color = '#c0392b') => ({ type: 'hydrant', x, z, color });
const meter = (x, z, ry = 0, color = '#7f8c8d') => ({ type: 'meter', x, z, ry, color });
const signpost = (x, z, h = 2.8, color = '#7f8c8d') => ({ type: 'signpost', x, z, h, color });
const bikeRack = (x, z, ry = 0, color = '#536878') => ({ type: 'bikerack', x, z, ry, color });
const car = (x, z, ry = 90, len = 4.2, w = 1.8, color = '#3a7ca5', h = 0.6) => ({ type: 'car', x, z, ry, len, w, h, color });
const foodtruck = (x, z, ry = 0, len = 4.5, w = 2.1, color = '#2ec4b6') => ({ type: 'foodtruck', x, z, ry, len, w, color });
const spectator = (x, z, color) => ({ type: 'spectator', x, z, color });

// --- the spots ------------------------------------------------------------
// Every discoverable spot. `i/j` name the block it lives in; `x/z` the spot
// centre (the block centre) so discovery, logos, challenges and fast travel
// all line up with the features the generator builds there. `target` is the
// combo that finishes the spot's challenge.
export const CITY_SPOTS = [
  // Downtown (centre 6-13, 6-13)
  { id: 'plaza', name: 'Market Plaza', district: 'Downtown', i: 9, j: 9, r: 16, target: 3000 },
  { id: 'garage', name: 'Garage Rooftop', district: 'Downtown', i: 10, j: 10, r: 14, target: 5000 },
  { id: 'towers', name: 'Tower Steps', district: 'Downtown', i: 8, j: 9, r: 12, target: 4500 },
  { id: 'mega', name: 'Megaramp Park', district: 'Downtown', i: 11, j: 8, r: 16, target: 7000 },
  // University (i>=14, j<=5)
  { id: 'quad', name: 'Campus Quad', district: 'University', i: 16, j: 3, r: 14, target: 4000 },
  { id: 'libsteps', name: 'Library Steps', district: 'University', i: 16, j: 4, r: 12, target: 4500 },
  { id: 'campus', name: 'Campus Rail Garden', district: 'University', i: 17, j: 2, r: 13, target: 5000 },
  // Industrial (i<=5)
  { id: 'dock', name: 'Loading Dock', district: 'Industrial', i: 3, j: 9, r: 13, target: 5000 },
  { id: 'roof', name: 'Warehouse Roof', district: 'Industrial', i: 3, j: 8, r: 12, target: 5500 },
  { id: 'yard', name: 'The Yard', district: 'Industrial', i: 2, j: 8, r: 12, target: 3500 },
  { id: 'factory', name: 'Factory Lines', district: 'Industrial', i: 1, j: 2, r: 14, target: 6000 },
  // Beach (i>=14)
  { id: 'walk', name: 'Beach Boardwalk', district: 'Beach', i: 16, j: 10, r: 16, target: 4000 },
  { id: 'bowl', name: 'Beach Bowl', district: 'Beach', i: 15, j: 10, r: 13, target: 5000 },
  { id: 'pier', name: 'Sunset Pier', district: 'Beach', i: 18, j: 14, r: 15, target: 6500 },
  { id: 'prom', name: 'Promenade Rails', district: 'Beach', i: 18, j: 8, r: 14, target: 5500 },
  // Old Town (i<=5, j>=14)
  { id: 'alley', name: 'The Alley', district: 'Old Town', i: 3, j: 16, r: 10, target: 6000 },
  { id: 'square', name: 'Old Square', district: 'Old Town', i: 4, j: 16, r: 14, target: 4000 },
  { id: 'gate', name: 'City Gate', district: 'Old Town', i: 1, j: 17, r: 13, target: 5000 },
  // Hills (i=6-13, j>=14)
  { id: 'crest', name: 'Hillcrest', district: 'Hills', i: 9, j: 16, r: 14, target: 5500 },
  { id: 'ridge', name: 'Ridge Run', district: 'Hills', i: 10, j: 16, r: 13, target: 4500 },
  { id: 'park', name: 'Hilltop Park', district: 'Hills', i: 8, j: 17, r: 15, target: 5000 },
  // Suburbs (i=6-13, j<=5)
  { id: 'drive', name: 'Driveway Rail', district: 'Suburbs', i: 9, j: 3, r: 12, target: 3000 },
  { id: 'deadend', name: 'Dead End Ledge', district: 'Suburbs', i: 10, j: 3, r: 12, target: 3500 },
  { id: 'court', name: 'Court Rails', district: 'Suburbs', i: 12, j: 2, r: 13, target: 4000 },
  // Community skateparks — built-in park features embedded in the open world
  { id: 'homepark', name: 'Home Park Skatepark', district: 'Downtown', i: 7, j: 11, r: 16, target: 6000 },
  { id: 'flatline', name: 'Flatline Plaza', district: 'Downtown', i: 12, j: 11, r: 16, target: 6000 },
  { id: 'railpark', name: 'Rail Yard', district: 'Industrial', i: 5, j: 2, r: 14, target: 6000 },
  { id: 'vertpark', name: 'Vert Ramp Park', district: 'Hills', i: 12, j: 16, r: 15, target: 6000 },
  { id: 'streetpark', name: 'Street Plaza', district: 'University', i: 14, j: 3, r: 14, target: 6000 },
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
  // Downtown: centre 8×8
  if (i >= 6 && i <= 13 && j >= 6 && j <= 13) return 'Downtown';
  // University: far north-east
  if (i >= 14 && j <= 5) return 'University';
  // Beach: east side
  if (i >= 14) return 'Beach';
  // Old Town: far north-west
  if (j >= 14 && i <= 5) return 'Old Town';
  // Hills: north-centre
  if (j >= 14) return 'Hills';
  // Industrial: west side
  if (i <= 5) return 'Industrial';
  // Suburbs: south-centre
  return 'Suburbs';
}

// Downtown: tall towers and street-level curbs between them.
function dtTowers(o, r) {
  const a = { x: r.x1 - between(9, 12), z: r.z0 + between(6, 9), w: between(11, 14), d: between(11, 14), h: between(8, 13), c: pick(TOWER) };
  const b = { x: r.x0 + between(6, 9), z: r.z1 - between(9, 12), w: between(10, 13), d: between(10, 13), h: between(6, 9), c: pick(TOWER2) };
  o.push(slab(a.x, a.z, a.w, a.d, a.h, a.c));
  o.push(slab(b.x, b.z, b.w, b.d, b.h, b.c));
  o.push(slab(r.cx, r.cz + 1, 6, 4, 0.45, CURB));
  o.push(ledge(b.x + b.w / 2 + 1.5, b.z - b.d / 2 - 1.4, 7, 0.9, 0.55, CONC, 0));
  o.push(rail(a.x - a.w / 2 - 2, a.z + 3, 10, 0.8, STEEL, 90));
  o.push(rail(r.cx + 2, r.cz - 2, 8, 0.75, STEEL, 0));
  o.push(bank(r.x0 + SW + 3, r.cz, 8, 5, 0.5, CONC, 90));
  o.push(lamp(r.x0 + SW + 2.2, r.z0 + SW + 2.2));
  o.push(lamp(r.x1 - SW - 2.2, r.z1 - SW - 2.2));
  o.push(tree(r.x1 - SW - 2.4, r.z1 - SW - 2.4));
  o.push(tree(r.x0 + SW + 2.4, r.z0 + SW + 2.4));
  o.push(bush(r.x1 - SW - 1.5, r.z0 + SW + 1.5));
  o.push(trashcan(r.x1 - SW - 2, r.z0 + SW + 2));
  o.push(trashcan(r.x0 + SW + 2, r.z1 - SW - 2));
  o.push(car(r.x0 + SW + 3, r.z1 - SW - 1.2));
  o.push(car(r.x1 - SW - 3, r.z0 + SW + 1.2, 0, 4.2, 1.8, pick(CAR_COLORS)));
  o.push(bench(r.cx - 8, r.cz + 5, 90));
  o.push(bench(r.cx + 8, r.cz - 5, 270));
  o.push(hydrant(r.x0 + SW + 1, r.cz + 8));
  o.push(meter(r.x1 - SW - 1, r.cz - 6));
  o.push(signpost(r.cx + 5, r.z0 + SW + 3));
  if (rand() < 0.6) o.push(bikeRack(r.cx - 3, r.cz - 5, 90));
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
  o.push(ledge(r.cx + 8, I.z0 + 2, 6, 0.9, 0.5, CONC, 180));
  o.push(rail(r.cx, r.cz + 6, 12, 0.8, STEEL, 90));
  o.push(rail(r.cx - 10, r.cz, 10, 0.75, STEEL, 90));
  o.push(planter(r.cx + 8, r.cz - 5));
  o.push(planter(r.cx - 6, r.cz + 5));
  o.push(tree(r.cx - 10, I.z0 + 3, 1.3, 3.5));
  o.push(tree(r.cx + 10, I.z1 - 3, 1.3, 3.5));
  o.push(tree(r.cx + 12, I.z0 + 3, 1.2, 3.2));
  o.push(bench(r.cx - 8, I.z0 + 3, 90));
  o.push(bench(r.cx + 10, I.z1 - 5, 270));
  o.push(bench(r.cx - 12, I.z1 - 3, 180));
  o.push(trashcan(r.x1 - SW - 2, I.z1 - 2));
  o.push(trashcan(r.x0 + SW + 2, I.z0 + 2));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(hydrant(r.x1 - SW - 1, r.cz + 10));
  o.push(signpost(r.cx + 3, I.z0 + 2));
  o.push(car(r.x0 + SW + 3, r.cz - 12, 90, 4.2, 1.8, pick(CAR_COLORS)));
  o.push(car(r.x1 - SW - 3, r.cz + 12, 270, 4.2, 1.8, pick(CAR_COLORS)));
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
  o.push(rail(r.cx - 8, r.cz + 9, 14, 0.85, STEEL, 90));
  o.push(rail(r.cx + 4, r.cz - 10, 12, 0.8, STEEL, 90));
  o.push(ledge(I.x0 + 3, r.cz - 5, 8, 0.9, 0.5, CONC, 90));
  o.push(car(r.x1 - SW - 2.5, r.cz - 8, 0, 5.2, 2, INDY[2]));
  o.push(car(r.x1 - SW - 3, r.cz + 8, 0, 5.2, 2, INDY[0]));
  o.push(car(r.x0 + SW + 3, r.cz - 12, 90, 4.2, 1.8, pick(CAR_COLORS)));
  o.push(trashcan(r.x0 + SW + 2, I.z1 - 2));
  o.push(trashcan(r.x1 - SW - 2, I.z0 + 2));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  if (rand() < 0.7) o.push(bench(r.cx - 10, I.z1 - 2, 0));
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
  o.push(rail(r.cx + 3, r.cz - 9 + 9, 14, 0.75, STEEL, 90));
  o.push(rail(r.cx - 8, r.cz, 12, 0.7, STEEL, 90));
  o.push(rail(r.cx + 10, r.cz - 5, 10, 0.7, STEEL, 90));
  o.push(rail(r.cx - 6, r.cz + 8, 10, 0.7, STEEL, 90));
  o.push(planter(r.cx - 11, r.cz + 6));
  o.push(planter(r.cx + 11, r.cz - 2));
  o.push(planter(r.cx + 6, r.cz + 10));
  o.push(bench(r.cx - 10, r.cz - 9 - 10, 0));
  o.push(bench(r.cx + 8, r.cz - 9 - 10, 0));
  o.push(trashcan(r.cx - 3, r.cz - 9 - 10));
  o.push(trashcan(r.cx + 14, r.cz - 9 + 6));
  o.push(foodtruck(r.cx + 10, r.cz + 11, 180));
  o.push(spectator(r.cx - 8, r.cz + 9, CROWD_COLORS[3]));
  o.push(spectator(r.cx + 6, r.cz - 8, CROWD_COLORS[6]));
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.4, 4.2));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.4, 4.2));
  o.push(tree(r.x0 + SW + 3, I.z1 - 3, 1.2, 3.6));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
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
    o.push(ledge(r.cx + 1, r.cz + 5, 14, 0.9, 0.6, CONC, 0));
    o.push(rail(r.cx - 1, r.cz - 5, 14, 0.9, STEEL, 90));
    o.push(rail(r.cx + 5, r.cz + 2, 10, 0.75, STEEL, 0));
    o.push(rail(r.cx - 4, r.cz + 8, 8, 0.7, STEEL, 90));
    o.push(trashcan(r.cx - 4, r.cz - 8));
    o.push(trashcan(r.cx + 4, r.cz + 8));
    o.push(bench(r.cx - 6, r.cz, 90));
    o.push(hydrant(r.cx + 3, r.cz - 10));
  } else {
    o.push(planter(r.cx, r.cz + 3));
    o.push(planter(r.cx, r.cz - 4));
    o.push(rail(r.cx + 2, r.cz, 10, 0.7, STEEL, 90));
    o.push(bench(r.cx - 8, r.cz + 6, 180));
    o.push(bench(r.cx + 6, r.cz - 6, 0));
    o.push(hydrant(r.x0 + SW + 1, r.cz + 4));
    o.push(meter(r.x1 - SW - 1, r.cz - 8));
  }
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(trashcan(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(trashcan(r.x1 - SW - 2, r.z1 - SW - 2));
  if (rand() < 0.6) o.push(car(r.x1 - SW - 2.5, r.cz - 6, 0, 4.2, 1.8, CAR_COLORS[4]));
  if (rand() < 0.5) o.push(car(r.x0 + SW + 3, r.cz + 10, 90, 4.2, 1.8, pick(CAR_COLORS)));
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
  o.push(rail(r.cx + 2, r.cz - 2, 16, 0.8, STEEL, 90));
  o.push(rail(r.cx - 10, r.cz + 4, 14, 0.75, STEEL, 90));
  o.push(ledge(r.cx - 6, r.cz + 2, 10, 0.9, 0.55, CONC, 90));
  o.push(bank(I.x0 + 3, r.cz, 8, 6, h, c, 90));
  o.push(quarter(I.x1 - 3, r.cz - 6, 6, 1.8, 1.4, 0, CONC, 270));
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.3, 3.6));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.3, 3.6));
  o.push(tree(r.x0 + SW + 3, I.z1 - 3, 1.1, 3.0));
  o.push(bush(r.x1 - SW - 2, I.z0 + 3));
  o.push(bush(r.x0 + SW + 2, I.z1 - 3));
  o.push(bush(r.x1 - SW - 2, I.z1 - 3));
  o.push(bench(r.cx + 8, r.cz - 6, 90));
  o.push(bench(r.cx - 12, r.cz + 8, 270));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(trashcan(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(car(r.x1 - SW - 3, r.cz + 10, 0, 4.2, 1.8, pick(CAR_COLORS)));
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
    o.push(rail(r.cx, r.cz, 14, 0.75, STEEL, 90));
  }
  o.push(ledge(r.cx + 4, r.cz - 6, 8, 0.9, 0.5, CONC, 0));
  o.push(rail(I.x0 + 4, r.cz + 3, 10, 0.7, STEEL, 0));
  o.push(tree(r.x0 + SW + 3, r.cz - 4, 1.4, 3.8));
  o.push(tree(r.x1 - SW - 3, r.cz + 5, 1.2, 3.2));
  o.push(bush(r.x1 - SW - 2, I.z0 + 3));
  o.push(bush(r.x0 + SW + 2, I.z1 - 3));
  o.push(car(r.cx - 7, I.z1 - 2, 90, 4.2, 1.8, CAR_COLORS[5]));
  o.push(car(r.cx + 7, I.z0 + 2, 270, 4.2, 1.8, pick(CAR_COLORS)));
  o.push(lamp(r.x0 + SW + 2, r.cz));
  o.push(lamp(r.x1 - SW - 2, r.cz));
  o.push(bench(r.cx - 10, r.cz - 8, 90));
  o.push(trashcan(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(trashcan(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(hydrant(r.x1 - SW - 1, r.cz + 10));
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
  o.push(tree(r.x0 + SW + 3, r.z0 + SW + 3, 1.2, 3.2));
  o.push(bush(r.x0 + SW + 3, I.z0 + 3));
  o.push(bush(r.x1 - SW - 2, I.z0 + 5));
  o.push(bench(r.cx - 9, r.cz + 5, 90));
  o.push(trashcan(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(trashcan(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(hydrant(r.x1 - SW - 1, r.cz + 6));
  o.push(lamp(r.x0 + SW + 2, r.cz));
  o.push(car(r.x1 - SW - 3, r.cz + 2, 0, 4.2, 1.8, CAR_COLORS[2]));
  o.push(car(r.x0 + SW + 3, r.z1 - SW - 2, 0, 4.2, 1.8, pick(CAR_COLORS)));
}

// Downtown spot "mega": a dedicated megaramp park — big rollins, funboxes and
// long rails across the whole block.
function dtMega(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0, I.z1 - I.z0, 0.6, CONC));
  // high rollins from both ends
  o.push(rollin(I.x0 + 4, r.cz, 10, 1.2, 2.8, 4, CONC, 180));
  o.push(rollin(I.x1 - 4, r.cz, 10, 1.2, 2.8, 4, CONC, 0));
  // centre funbox with extended hips
  o.push(funbox(r.cx, r.cz, 8, 6, 1.1, 1.8, WOOD));
  // long down-rails
  o.push(rail(r.cx - 6, r.cz - 2, 22, 0.9, STEEL, 90));
  o.push(rail(r.cx + 6, r.cz + 2, 22, 0.9, STEEL, 90));
  // high banks on the sides
  o.push(bank(I.x0 + 3, r.cz, 8, 7, 2.2, CONC, 90));
  o.push(bank(I.x1 - 3, r.cz, 8, 7, 2.2, CONC, 270));
  // quarter pipes at corners
  o.push(quarter(I.x0 + 2, I.z0 + 2, 6, 2.2, 2.0, 0, CONC, 0));
  o.push(quarter(I.x1 - 2, I.z1 - 2, 6, 2.2, 2.0, 0, CONC, 180));
  // ledges
  o.push(ledge(r.cx - 10, I.z0 + 2, 10, 0.9, 0.55, CONC, 0));
  o.push(ledge(r.cx + 10, I.z1 - 2, 10, 0.9, 0.55, CONC, 180));
  // pyramid
  o.push(pyramid(r.cx, r.cz + 10, 6, 6, 3, 1.0, CONC));
  o.push(tree(r.x0 + SW + 2.5, r.z0 + SW + 2.5));
  o.push(tree(r.x1 - SW - 2.5, r.z1 - SW - 2.5));
  o.push(spectator(r.cx + 8, I.z0 + 3, CROWD_COLORS[0]));
  o.push(spectator(r.cx - 8, I.z1 - 3, CROWD_COLORS[1]));
  o.push(lamp(r.x0 + SW + 2, r.cz));
}

// University spot "campus": a rail garden — many rails and ledges among trees.
function uniCampus(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0 - 4, I.z1 - I.z0 - 4, 0.5, CONC));
  // grid of rails
  o.push(rail(r.cx - 8, r.cz - 6, 12, 0.8, STEEL, 90));
  o.push(rail(r.cx, r.cz - 6, 12, 0.8, STEEL, 90));
  o.push(rail(r.cx + 8, r.cz - 6, 12, 0.8, STEEL, 90));
  o.push(rail(r.cx - 8, r.cz + 6, 12, 0.8, STEEL, 270));
  o.push(rail(r.cx + 8, r.cz + 6, 12, 0.8, STEEL, 270));
  // ledges between rails
  o.push(ledge(r.cx - 4, r.cz, 10, 0.9, 0.5, CONC, 90));
  o.push(ledge(r.cx + 4, r.cz, 10, 0.9, 0.5, CONC, 90));
  // small funbox
  o.push(funbox(r.cx, r.cz - 14, 6, 4, 0.7, 1.2, UNI_BRICK[0]));
  // high bank at far end
  o.push(bank(r.cx, I.z1 - 3, 14, 7, 1.8, CONC, 180));
  // planters and trees
  o.push(planter(r.cx - 12, r.cz - 2, 0, 3, 3));
  o.push(planter(r.cx + 12, r.cz + 2, 0, 3, 3));
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.3, 3.5));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.3, 3.5));
  o.push(bench(r.cx - 10, I.z1 - 3, 180));
  o.push(lamp(r.x1 - SW - 2, r.z0 + SW + 2));
}

// Industrial spot "factory": a factory yard with long flat rails and banks.
function indFactory(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0 - 4, I.z1 - I.z0 - 4, 1.0, pick(INDY)));
  // long warehouse building
  o.push(slab(r.cx, I.z1 - 7, I.x1 - I.x0 - 8, 10, 4.5, INDY[0]));
  // high rollin from warehouse roof
  o.push(rollin(r.cx, I.z1 - 12, 10, 2.8, 2.0, 3.5, CONC, 180));
  // long rails across the yard — some of the longest in the city
  o.push(rail(I.x0 + 4, r.cz - 4, 26, 0.85, STEEL, 0));
  o.push(rail(I.x0 + 4, r.cz + 4, 26, 0.85, STEEL, 0));
  o.push(rail(I.x0 + 4, r.cz, 30, 0.9, STEEL, 0));
  // loading-dock banks
  o.push(bank(r.cx - 6, I.z0 + 3, 10, 6, 1.0, CONC, 90));
  o.push(bank(r.cx + 6, I.z0 + 3, 10, 6, 1.0, CONC, 270));
  // big pyramid
  o.push(pyramid(r.cx, I.z0 + 8, 7, 7, 4, 1.3, CONC));
  // parked trucks
  o.push(car(r.x0 + SW + 3, I.z0 + 3, 0, 5.2, 2, INDY[1]));
  o.push(car(r.x1 - SW - 3, I.z0 + 3, 0, 5.2, 2, INDY[2]));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  if (rand() < 0.7) o.push(trashcan(r.x1 - SW - 2, I.z1 - 2));
}

// Beach spot "pier": a raised wooden pier with big banks and long rails.
function beachPier(o, r) {
  ring(o, r);
  const I = inr(r);
  // raised pier platform
  o.push(slab(r.cx, r.cz, I.x1 - I.x0, I.z1 - I.z0, 1.6, WOOD));
  // big banks up to pier from both street sides
  o.push(bank(r.cx, I.z0 - 2, I.x1 - I.x0 - 4, 8, 1.6, WOOD, 0));
  o.push(bank(r.cx, I.z1 + 2, I.x1 - I.x0 - 4, 8, 1.6, WOOD, 180));
  // long grind rails down the pier
  o.push(rail(r.cx - 6, r.cz, 28, 0.85, STEEL, 90));
  o.push(rail(r.cx + 6, r.cz, 28, 0.85, STEEL, 90));
  // centre rail
  o.push(rail(r.cx, r.cz - 4, 20, 0.8, WOOD, 90));
  // quarter pipes at ends
  o.push(quarter(r.cx - 8, r.cz, 6, 2.5, 2.0, 0, WOOD, 0));
  o.push(quarter(r.cx + 8, r.cz, 6, 2.5, 2.0, 0, WOOD, 180));
  // funbox
  o.push(funbox(r.cx, r.cz - 10, 6, 5, 0.9, 1.3, WOOD));
  // benches and planters
  o.push(bench(r.cx - 10, I.z0 + 4, 0));
  o.push(bench(r.cx + 10, I.z1 - 4, 180));
  o.push(planter(r.cx - 12, r.cz));
  o.push(spectator(r.cx - 4, I.z0 + 5, CROWD_COLORS[5]));
  o.push(spectator(r.cx + 4, I.z1 - 5, CROWD_COLORS[6]));
  o.push(tree(r.x0 + SW + 2, I.z0 + 2, 1.5, 4.4));
  o.push(tree(r.x1 - SW - 2, I.z1 - 2, 1.5, 4.4));
  o.push(lamp(r.x0 + SW + 2, r.cz));
}

// Beach spot "prom": the promenade — long parallel rails, banks and a pyramid.
function beachProm(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0, I.z1 - I.z0, 0.55, CONC));
  // long parallel grind rails — the longest street rails in the city
  o.push(rail(I.x0 + 4, r.cz - 8, 30, 0.8, STEEL, 0));
  o.push(rail(I.x0 + 4, r.cz, 30, 0.85, STEEL, 0));
  o.push(rail(I.x0 + 4, r.cz + 8, 30, 0.8, STEEL, 0));
  // banks from edges
  o.push(bank(r.cx, I.z0 + 2, I.x1 - I.x0 - 6, 6, 1.2, CONC, 0));
  o.push(bank(r.cx, I.z1 - 2, I.x1 - I.x0 - 6, 6, 1.2, CONC, 180));
  // pyramid in centre
  o.push(pyramid(r.cx, r.cz, 7, 6, 4, 1.0, CONC));
  // ledges
  o.push(ledge(r.cx - 12, r.cz - 3, 8, 0.9, 0.5, CONC, 90));
  o.push(ledge(r.cx + 12, r.cz + 3, 8, 0.9, 0.5, CONC, 90));
  o.push(foodtruck(r.x1 - SW - 2, I.z0 + 3, 180));
  o.push(bench(r.x0 + SW + 4, I.z1 - 3, 180));
  o.push(spectator(r.cx, I.z0 + 4, CROWD_COLORS[3]));
  o.push(spectator(r.cx + 6, I.z1 - 4, CROWD_COLORS[4]));
  o.push(tree(r.x0 + SW + 2, r.cz, 1.4, 4.0));
  o.push(lamp(r.x1 - SW - 2, r.cz));
}

// Old Town spot "gate": a grand old city gate with high walls, ledges and
// a steep bank.
function oldGate(o, r) {
  ring(o, r);
  const I = inr(r);
  const c = pick(OLD_BRICK);
  // gateway walls
  o.push(slab(r.cx - 10, r.cz, 8, I.z1 - I.z0 - 4, 6, c));
  o.push(slab(r.cx + 10, r.cz, 8, I.z1 - I.z0 - 4, 6, c));
  o.push(slab(r.cx, I.z0 + 5, 12, 8, 5, c));
  // high bank through the gate
  o.push(bank(r.cx, I.z1 - 4, 10, 8, 1.6, CONC, 180));
  // ledges along walls
  o.push(ledge(r.cx - 5.5, r.cz, 6, 0.9, 0.55, CONC, 90));
  o.push(ledge(r.cx + 5.5, r.cz, 6, 0.9, 0.55, CONC, 270));
  // long rail
  o.push(rail(r.cx, r.cz - 8, 14, 0.85, STEEL, 90));
  // quarter pipes at base of walls
  o.push(quarter(I.x0 + 2, r.cz - 4, 6, 2.0, 1.6, 0, CONC, 0));
  o.push(quarter(I.x1 - 2, r.cz + 4, 6, 2.0, 1.6, 0, CONC, 180));
  o.push(tree(r.cx - 10, I.z0 + 2, 1.2, 3.4));
  o.push(tree(r.cx + 10, I.z1 - 2, 1.2, 3.4));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(spectator(r.cx, I.z1 - 6, CROWD_COLORS[1]));
}

// Hills spot "park": hilltop park with big natural banks and a long rail line.
function hillPark(o, r) {
  const I = inr(r);
  const c = pick(HILL_EARTH);
  // wide raised pad with banks on all sides
  o.push(slab(r.cx, r.cz, 24, 16, 2.8, c));
  o.push(bank(r.cx - 12, r.cz, 10, 10, 2.8, c, 90));
  o.push(bank(r.cx + 12, r.cz, 10, 10, 2.8, c, 270));
  o.push(bank(r.cx, I.z0 + 3, 24, 8, 2.8, c, 0));
  o.push(bank(r.cx, I.z1 - 3, 24, 8, 2.8, c, 180));
  // long down-rail from the crest
  o.push(rail(r.cx, r.cz - 4, 20, 0.9, STEEL, 90));
  o.push(rail(r.cx - 8, r.cz + 2, 16, 0.8, STEEL, 90));
  // funbox on top
  o.push(funbox(r.cx, r.cz + 8, 6, 5, 0.8, 1.3, WOOD));
  // ledges
  o.push(ledge(r.cx + 6, r.cz - 8, 10, 0.9, 0.55, CONC, 90));
  // trees and bushes
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.3, 3.6));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.3, 3.6));
  o.push(bush(r.cx - 14, I.z0 + 4));
  o.push(bush(r.cx + 14, I.z1 - 4));
  o.push(bench(r.cx + 12, r.cz - 4, 90));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
}

// Suburbs spot "court": a raised court area with rails and ledges.
function subCourt(o, r) {
  ring(o, r);
  const I = inr(r);
  o.push(slab(r.cx, r.cz, I.x1 - I.x0 - 4, I.z1 - I.z0 - 4, 0.5, CONC));
  // houses around the edge
  o.push(slab(r.x0 + SW + 5, I.z0 + 6, 14, 10, 2.8, pick(HOUSE)));
  o.push(slab(r.x1 - SW - 5, I.z1 - 6, 12, 10, 2.6, pick(HOUSE)));
  // rail grid in the open area
  o.push(rail(r.cx - 6, r.cz, 14, 0.8, STEEL, 90));
  o.push(rail(r.cx + 6, r.cz, 14, 0.8, STEEL, 90));
  o.push(rail(r.cx, r.cz - 6, 14, 0.8, STEEL, 0));
  // ledges
  o.push(ledge(r.cx - 4, r.cz + 8, 10, 0.9, 0.5, CONC, 0));
  o.push(ledge(r.cx + 4, r.cz - 8, 10, 0.9, 0.5, CONC, 180));
  // bank
  o.push(bank(r.cx, I.z0 + 3, 10, 5, 0.4, CONC, 0));
  o.push(tree(r.x0 + SW + 3, I.z1 - 3, 1.3, 3.6));
  o.push(tree(r.x1 - SW - 3, I.z0 + 3, 1.2, 3.2));
  o.push(bush(r.x0 + SW + 3, I.z0 + 3));
  o.push(car(r.cx - 8, I.z1 - 2, 90, 4.2, 1.8, CAR_COLORS[3]));
  o.push(lamp(r.x1 - SW - 2, r.cz));
}

// --- Skatepark zone generators ------------------------------------------------
// Dedicated community skateparks embedded in the city that bring features from
// the built-in parks into the open world, scaled to fit within a city block.

/** Home Park inspired: rollins, spine transfer, bowl, funbox and grind bars. */
function skateHomePark(o, r) {
  ring(o, r);
  const I = inr(r);
  const cw = I.x1 - I.x0 - 8, cd = I.z1 - I.z0 - 8;
  o.push(slab(r.cx, r.cz, cw, cd, 0.6, '#c23a2e'));
  // Rollins at north and south ends
  o.push(rollin(r.cx, I.z0 + 2, cw * 0.7, 2.6, 1.8, 3.5, '#2ec4b6', 0));
  o.push(rollin(r.cx, I.z1 - 2, cw * 0.5, 2.2, 1.4, 3, '#ffd166', 180));
  // Spine transfer on west side
  o.push(spine(r.cx - cw * 0.25, r.cz, 90, cw * 0.3, 2.0, 1.3, 3.5, '#9b5de5'));
  // Funbox centre: bank-slab-bank with rail and ledges
  o.push(bank(r.cx, r.cz - 8, cw * 0.35, 5, 0.65, '#4cc9f0', 0));
  o.push(slab(r.cx, r.cz - 3, cw * 0.35, 5, 0.65, '#00bbf9'));
  o.push(bank(r.cx, r.cz + 2, cw * 0.35, 5, 0.65, '#4cc9f0', 180));
  o.push(rail(r.cx, r.cz - 5.5, cw * 0.3, 0.9, '#e5e7eb', 90));
  o.push(ledge(r.cx - cw * 0.1, r.cz - 3, 5, 0.9, 0.65, '#f8e16c', 270));
  o.push(ledge(r.cx + cw * 0.1, r.cz - 3, 5, 0.9, 0.65, '#f8e16c', 90));
  // East banked hip with pool
  o.push(bank(I.x1 - 6, r.cz + 8, 12, 10, 1.2, '#ff9f1c', 270));
  o.push(slab(I.x1 - 6, r.cz + 18, 12, 6, 1.2, '#ffbe0b'));
  o.push(ledge(I.x1 - 6, r.cz + 21, 12, 0.9, 1.2, '#3a86ff', 0));
  o.push(bowl(I.x1 - 4, r.cz + 20, 2.4, 1.4, 1.2, '#95d5b2'));
  // West bank with flat bars
  o.push(bank(I.x0 + 5, r.cz, 10, 14, 1.4, '#90be6d', 90));
  o.push(rail(r.cx - cw * 0.15, r.cz + 8, cw * 0.3, 0.4, '#ff2fa0', 0));
  o.push(rail(r.cx + cw * 0.15, r.cz - 8, cw * 0.3, 0.4, '#ff2fa0', 0));
  // Quarter kicker
  o.push(quarter(I.x0 + 3, r.cz - 8, 6, 1.8, 0.9, 0, '#f15bb5', 90));
  // Stair set east
  o.push(bank(I.x1 - 8, r.cz - 16, 8, 6, 1.0, '#b388eb', 180));
  o.push(slab(I.x1 - 8, r.cz - 24, 8, 10, 1.0, '#cdb4db'));
  o.push(stairs(I.x1 - 8, r.cz - 30, 8, 4, 0.2, 1.0, '#b388eb', 180));
  o.push(rail(I.x1 - 10, r.cz - 24, 8, 0.7, '#e5e7eb', 90));
  // Scenery
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.2, 3.2));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.2, 3.2));
  o.push(bench(r.cx + cw * 0.3, I.z1 - 3, 180));
  o.push(bench(r.cx - cw * 0.3, I.z0 + 3, 0));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(trashcan(r.x0 + SW + 2, I.z1 - 2));
  o.push(foodtruck(r.x1 - SW - 2, I.z0 + 2, 180));
}

/** Flatline inspired: long manual pad, elevated decks, twin roll-ins, spine, funbox. */
function skateFlatline(o, r) {
  ring(o, r);
  const I = inr(r);
  const cw = I.x1 - I.x0 - 6, cd = I.z1 - I.z0 - 6;
  o.push(slab(r.cx, r.cz, cw, cd, 0.6, '#2b3a4a'));
  // Twin roll-ins framing a spine at north
  o.push(rollin(r.cx - cw * 0.25, I.z0 + 4, cw * 0.18, 2.0, 1.3, 3, '#2a2e36', 0));
  o.push(rollin(r.cx + cw * 0.25, I.z0 + 4, cw * 0.18, 2.0, 1.3, 3, '#2a2e36', 0));
  o.push(spine(r.cx, I.z0 + 4, 90, cw * 0.15, 2.0, 1.3, 3.5, '#4cc9f0'));
  // Long manual pad down the centre
  o.push(slab(r.cx, r.cz, cw * 0.15, cd * 0.7, 0.28, '#3d444e'));
  o.push(ledge(r.cx - cw * 0.1, r.cz, cd * 0.2, 0.9, 0.28, '#4cc9f0', 270));
  o.push(ledge(r.cx + cw * 0.1, r.cz, cd * 0.2, 0.9, 0.28, '#4cc9f0', 90));
  o.push(ledge(r.cx - cw * 0.1, r.cz + 10, cd * 0.15, 0.9, 0.28, '#e76f51', 270));
  o.push(ledge(r.cx + cw * 0.1, r.cz + 10, cd * 0.15, 0.9, 0.28, '#e76f51', 90));
  // West elevated manual line: bank up, deck, bank down
  o.push(bank(I.x0 + 5, r.cz - 12, cw * 0.2, 6, 1.2, '#e9c46a', 0));
  o.push(slab(I.x0 + 5, r.cz - 2, cw * 0.2, 14, 1.2, '#e9c46a'));
  o.push(bank(I.x0 + 5, r.cz + 8, cw * 0.2, 6, 1.2, '#e9c46a', 180));
  // East elevated line
  o.push(bank(I.x1 - 5, r.cz - 10, cw * 0.2, 6, 1.2, '#cdb4db', 0));
  o.push(slab(I.x1 - 5, r.cz - 2, cw * 0.2, 8, 1.2, '#cdb4db'));
  o.push(bank(I.x1 - 5, r.cz + 4, cw * 0.2, 6, 1.2, '#cdb4db', 180));
  // South plaza: funbox and pyramids
  o.push(funbox(r.cx, r.cz + cd * 0.3, cw * 0.2, 5, 0.9, 1.5, '#f15bb5'));
  o.push(pyramid(I.x0 + 8, r.cz + cd * 0.3, 5, 5, 2.8, 0.9, '#e9c46a'));
  o.push(pyramid(I.x1 - 8, r.cz + cd * 0.3, 5, 5, 2.8, 0.9, '#cdb4db'));
  // Flat bars
  o.push(rail(r.cx - cw * 0.1, r.cz - 14, cd * 0.3, 0.4, '#ff2fa0', 90));
  o.push(rail(r.cx + cw * 0.1, r.cz - 14, cd * 0.3, 0.4, '#ff2fa0', 90));
  o.push(rail(r.cx - cw * 0.15, r.cz + cd * 0.15, cw * 0.2, 0.4, '#ff2fa0', 0));
  o.push(rail(r.cx + cw * 0.15, r.cz + cd * 0.15, cw * 0.2, 0.4, '#ff2fa0', 0));
  // Scenery
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.2, 3.2));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.2, 3.2));
  o.push(bench(r.cx + cw * 0.3, I.z1 - 3, 180));
  o.push(planter(r.cx - cw * 0.3, I.z0 + 3));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(trashcan(r.x1 - SW - 2, I.z1 - 2));
  o.push(foodtruck(r.cx + cw * 0.35, I.z0 + 3, 180));
}

/** RailWay inspired: pyramid field with grid of grind rails — pure rail heaven. */
function skateRailWay(o, r) {
  ring(o, r);
  const I = inr(r);
  const cw = I.x1 - I.x0 - 6, cd = I.z1 - I.z0 - 6;
  o.push(slab(r.cx, r.cz, cw, cd, 0.5, '#2d2d2d'));
  // Steep roll-in at north for speed
  o.push(rollin(r.cx, I.z0 + 3, cw * 0.3, 2.8, 2.0, 3.5, '#555', 0));
  // Pyramid rows flanking the main line — inner and outer rows
  const pySize = [5, 4, 3.5];
  const pyH = [1.0, 0.8, 0.7];
  for (let row = 0; row < 3; row++) {
    const x = r.cx + (row - 1) * (cw * 0.22);
    const zStart = r.cz - cd * 0.25;
    for (let k = 0; k < 3; k++) {
      const z = zStart + k * (cd * 0.22);
      o.push(pyramid(x, z, pySize[row], pySize[row], 2.2, pyH[row], pick(INDY)));
    }
  }
  // Long corridor rails
  o.push(rail(r.cx - cw * 0.15, r.cz, cd * 0.65, 0.85, STEEL, 90));
  o.push(rail(r.cx + cw * 0.15, r.cz, cd * 0.65, 0.85, STEEL, 90));
  o.push(rail(r.cx - cw * 0.3, r.cz, cd * 0.65, 0.8, STEEL, 90));
  o.push(rail(r.cx + cw * 0.3, r.cz, cd * 0.65, 0.8, STEEL, 90));
  // Short gap rails between pyramids
  for (let row = 0; row < 2; row++) {
    const x = r.cx + (row - 0.5) * (cw * 0.22);
    for (let k = 0; k < 2; k++) {
      const z = r.cz - cd * 0.15 + k * (cd * 0.2);
      o.push(rail(x, z, 4, 0.7, STEEL, 90));
    }
  }
  // Cross rails
  o.push(rail(r.cx - cw * 0.2, r.cz - cd * 0.15, cw * 0.4, 0.75, STEEL, 0));
  o.push(rail(r.cx + cw * 0.2, r.cz + cd * 0.15, cw * 0.4, 0.75, STEEL, 0));
  // Signal rails approaching roll-in
  o.push(rail(r.cx - 4, I.z0 + 8, 6, 0.7, '#c0392b', 90));
  o.push(rail(r.cx + 4, I.z0 + 8, 6, 0.7, '#c0392b', 90));
  // Corner crossing rails
  o.push(rail(I.x0 + 4, I.z0 + 4, 8, 0.7, STEEL, 45));
  o.push(rail(I.x1 - 4, I.z1 - 4, 8, 0.7, STEEL, 45));
  // Industrial scenery
  o.push(tree(r.x0 + SW + 3, I.z1 - 3, 1.0, 2.8));
  o.push(tree(r.x1 - SW - 3, I.z0 + 3, 1.0, 2.8));
  o.push(trashcan(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(trashcan(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
}

/** Vert Rampage inspired: big vert ramp, mini ramps, bowls, spines. */
function skateVertRamp(o, r) {
  ring(o, r);
  const I = inr(r);
  const cw = I.x1 - I.x0 - 6, cd = I.z1 - I.z0 - 6;
  o.push(slab(r.cx, r.cz, cw, cd, 0.55, '#1a1a2e'));
  // Big vert ramp centrepiece
  o.push(vert(r.cx, I.z0 + 8, cw * 0.4, 3.5, 3.0, '#e94560'));
  // Twin mini ramps flanking the vert
  o.push(mini(I.x0 + 6, r.cz - 4, cw * 0.2, 1.8, 1.2, '#533483'));
  o.push(mini(I.x1 - 6, r.cz - 4, cw * 0.2, 1.8, 1.2, '#533483'));
  // Pool bowls
  o.push(bowl(r.cx - 10, I.z1 - 8, 2.8, 1.6, 1.4, '#0f3460'));
  o.push(bowl(r.cx + 10, I.z1 - 8, 2.8, 1.6, 1.4, '#0f3460'));
  // Spine between bowls
  o.push(spine(r.cx, I.z1 - 8, 90, 8, 2.0, 1.3, 3.5, '#e94560'));
  // Roll-in at south
  o.push(rollin(r.cx, I.z1 - 2, cw * 0.5, 2.6, 1.8, 3.5, '#16213e', 180));
  // Quarterpipes on east and west walls
  o.push(quarter(I.x0 + 3, r.cz + 6, 6, 2.2, 1.5, 0, '#533483', 90));
  o.push(quarter(I.x1 - 3, r.cz + 6, 6, 2.2, 1.5, 0, '#533483', 270));
  // Ledges flanking the roll-in deck
  o.push(ledge(r.cx - cw * 0.2, I.z1 - 4, 8, 0.9, 0.55, '#e94560', 0));
  o.push(ledge(r.cx + cw * 0.2, I.z1 - 4, 8, 0.9, 0.55, '#e94560', 180));
  // Jump line rail
  o.push(rail(r.cx, r.cz + cd * 0.15, cd * 0.25, 0.8, '#e5e7eb', 90));
  // Scenery
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.2, 3.2));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.2, 3.2));
  o.push(bench(r.cx - cw * 0.3, I.z1 - 3, 180));
  o.push(bench(r.cx + cw * 0.3, I.z1 - 3, 180));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(trashcan(r.x0 + SW + 2, I.z1 - 2));
}

/** Street plaza inspired: stairs, handrails, ledges, banks — the classic street spot. */
function skateStreetPlaza(o, r) {
  ring(o, r);
  const I = inr(r);
  const cw = I.x1 - I.x0 - 6, cd = I.z1 - I.z0 - 6;
  o.push(slab(r.cx, r.cz, cw, cd, 0.5, '#8d99ae'));
  // Central stair block with handrail
  o.push(bank(r.cx, I.z0 + 4, cw * 0.2, 6, 1.0, '#adb5bd', 0));
  o.push(slab(r.cx, r.cz - 6, cw * 0.2, 8, 1.0, '#dee2e6'));
  o.push(stairs(r.cx, r.cz - 10, cw * 0.2, 5, 0.18, 0.9, '#adb5bd', 180));
  o.push(rail(r.cx - 3, r.cz - 6, 8, 0.8, '#e5e7eb', 90));
  o.push(rail(r.cx + 3, r.cz - 6, 8, 0.8, '#e5e7eb', 90));
  // West street ledges — long corridor grind
  o.push(ledge(I.x0 + 4, r.cz - 10, cd * 0.35, 0.9, 0.5, '#adb5bd', 90));
  o.push(ledge(I.x0 + 4, r.cz + 10, cd * 0.35, 0.9, 0.5, '#adb5bd', 270));
  // East funbox with pyramid
  o.push(funbox(I.x1 - 8, r.cz, cw * 0.15, 5, 0.8, 1.3, '#adb5bd'));
  o.push(pyramid(I.x1 - 8, r.cz + 12, 5, 5, 3, 0.8, '#dee2e6'));
  // Flat bars around the plaza
  o.push(rail(r.cx - cw * 0.2, r.cz + cd * 0.2, cw * 0.25, 0.4, '#495057', 90));
  o.push(rail(r.cx + cw * 0.2, r.cz - cd * 0.2, cw * 0.25, 0.4, '#495057', 90));
  // Banks on sides for transitions
  o.push(bank(I.x0 + 3, r.cz, 8, 8, 0.8, '#6c757d', 90));
  o.push(bank(I.x1 - 3, r.cz, 8, 8, 0.8, '#6c757d', 270));
  // Quarter pipes at ends for airs
  o.push(quarter(r.cx - cw * 0.3, I.z1 - 3, 6, 1.8, 1.0, 0, '#495057', 90));
  o.push(quarter(r.cx + cw * 0.3, I.z1 - 3, 6, 1.8, 1.0, 0, '#495057', 270));
  // Scenery
  o.push(tree(r.x0 + SW + 3, I.z0 + 3, 1.1, 3.0));
  o.push(tree(r.x1 - SW - 3, I.z1 - 3, 1.1, 3.0));
  o.push(bench(r.cx - cw * 0.3, I.z0 + 3, 0));
  o.push(bench(r.cx + cw * 0.3, I.z0 + 3, 0));
  o.push(planter(r.cx - cw * 0.2, I.z1 - 3));
  o.push(planter(r.cx + cw * 0.2, I.z1 - 3));
  o.push(lamp(r.x0 + SW + 2, r.z0 + SW + 2));
  o.push(lamp(r.x1 - SW - 2, r.z1 - SW - 2));
  o.push(trashcan(r.x0 + SW + 2, I.z1 - 2));
  o.push(trashcan(r.x1 - SW - 2, I.z0 + 2));
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
      case 'mega': dtMega(out, r); return;
      case 'quad': uniQuad(out, r, true); return;
      case 'libsteps': uniLibrary(out, r); return;
      case 'campus': uniCampus(out, r); return;
      case 'dock': indDock(out, r); return;
      case 'roof': indWarehouse(out, r, true); return;
      case 'yard': indYard(out, r); return;
      case 'factory': indFactory(out, r); return;
      case 'walk': beachWalk(out, r, false); return;
      case 'bowl': beachBowl(out, r); return;
      case 'pier': beachPier(out, r); return;
      case 'prom': beachProm(out, r); return;
      case 'alley': oldTown(out, r, true); return;
      case 'square': oldSquare(out, r); return;
      case 'gate': oldGate(out, r); return;
      case 'crest': hillCrest(out, r, true); return;
      case 'ridge': hillCrest(out, r, false); return;
      case 'park': hillPark(out, r); return;
      case 'drive': suburbs(out, r, true); return;
      case 'deadend': subDead(out, r); return;
      case 'court': subCourt(out, r); return;
      // Community skateparks
      case 'homepark': skateHomePark(out, r); return;
      case 'flatline': skateFlatline(out, r); return;
      case 'railpark': skateRailWay(out, r); return;
      case 'vertpark': skateVertRamp(out, r); return;
      case 'streetpark': skateStreetPlaza(out, r); return;
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
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) buildBlock(objects, i, j);
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
      { x: -400, z: -400 },
      { x: -400, z: -100 },
      { x: 400, z: -100 },
      { x: 400, z: -400 },
      { x: -400, z: -400 },
      { x: -400, z: 400 },
      { x: 400, z: 400 },
      { x: 400, z: 100 },
      { x: -400, z: 100 },
      { x: -400, z: 400 },
    ],
    logos: CITY_SPOTS.map((s) => ({ x: s.x, z: s.z })),
    objectCount: objects.length,
  },
  objects
);

// Street-centerline loops the traffic drives. Each leg runs along a gridline
// (the asphalt streets), so a car never clips a building or a curb.
// Routes are organized into rings and grid lines covering all major streets.
function gridRoute(startX, startZ, endX, endZ, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      x: startX + (endX - startX) * t,
      z: startZ + (endZ - startZ) * t,
    });
  }
  return pts;
}

export const CITY_ROUTES = [
  // outer ring
  [
    { x: -450, z: -450 }, { x: -250, z: -450 }, { x: 0, z: -450 },
    { x: 250, z: -450 }, { x: 450, z: -450 },
    { x: 450, z: -250 }, { x: 450, z: 0 },
    { x: 450, z: 250 }, { x: 450, z: 450 },
    { x: 250, z: 450 }, { x: 0, z: 450 },
    { x: -250, z: 450 }, { x: -450, z: 450 },
    { x: -450, z: 250 }, { x: -450, z: 0 },
    { x: -450, z: -250 },
  ],
  // inner ring
  [
    { x: -150, z: -150 }, { x: -50, z: -150 }, { x: 50, z: -150 }, { x: 150, z: -150 },
    { x: 150, z: -50 }, { x: 150, z: 50 }, { x: 150, z: 150 },
    { x: 50, z: 150 }, { x: -50, z: 150 }, { x: -150, z: 150 },
    { x: -150, z: 50 }, { x: -150, z: -50 },
  ],
  // cross-town east–west
  [
    { x: -450, z: 0 }, { x: -250, z: 0 }, { x: 0, z: 0 },
    { x: 250, z: 0 }, { x: 450, z: 0 },
  ],
  // cross-town north–south
  [
    { x: 0, z: -450 }, { x: 0, z: -250 }, { x: 0, z: 0 },
    { x: 0, z: 250 }, { x: 0, z: 450 },
  ],
  // --- horizontal grid lines (west–east streets at z = -450, -350, ..., 450) ---
  gridRoute(-450, -350, 450, -350, 8),
  gridRoute(-450, -250, 450, -250, 8),
  gridRoute(-450, -150, 450, -150, 8),
  gridRoute(-450, 50, 450, 50, 8),
  gridRoute(-450, 150, 450, 150, 8),
  gridRoute(-450, 250, 450, 250, 8),
  gridRoute(-450, 350, 450, 350, 8),
  // --- vertical grid lines (north–south streets at x = -450, -350, ..., 450) ---
  gridRoute(-350, -450, -350, 450, 8),
  gridRoute(-250, -450, -250, 450, 8),
  gridRoute(-150, -450, -150, 450, 8),
  gridRoute(50, -450, 50, 450, 8),
  gridRoute(150, -450, 150, 450, 8),
  gridRoute(250, -450, 250, 450, 8),
  gridRoute(350, -450, 350, 450, 8),
  // --- mid-ring for downtown traffic ---
  [
    { x: -250, z: -250 }, { x: -50, z: -250 }, { x: 50, z: -250 }, { x: 250, z: -250 },
    { x: 250, z: -50 }, { x: 250, z: 50 }, { x: 250, z: 250 },
    { x: 50, z: 250 }, { x: -50, z: 250 }, { x: -250, z: 250 },
    { x: -250, z: 50 }, { x: -250, z: -50 },
  ],
  // --- expressway loops (wider spacing, faster feel) ---
  gridRoute(-450, -450, 450, -450, 4),
  gridRoute(450, -450, 450, 450, 4),
  gridRoute(450, 450, -450, 450, 4),
  gridRoute(-450, 450, -450, -450, 4),
];

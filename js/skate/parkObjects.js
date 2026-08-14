// The palette of a player-built park. Each object knows two things: how to
// paint itself onto a real Park (the collision features, grinds, rails and
// copings that make it rideable) and how to draw a preview mesh for the
// editor. Both read the same plain object — a type, a handful of editable
// params, and a position/rotation/scale transform — so what you see while
// you build is exactly the collision you ride when you test it.
//
// Every object is authored in its own local frame: the +z axis is "forward",
// +x is to the right, the base line (or the object's footprint) is centred on
// the origin. The transform moves, spins and stretches that frame. Rotation is
// snapped to quarter turns because the game's collision features are all
// axis-aligned rectangles — a diagonal quarterpipe would need a diagonal
// height field to ride it correctly, and nothing else in the game has one.

import * as THREE from '../game/three.js';
import { Slab, Bank, Quarter, Stairs, Bowl, bowlU, bowlProfile, SMOOTH, CONCRETE, CONCRETE_DARK, RAMP, STEEL, PAINT, DIRT, COPING } from './park.js';

// --- palettes -------------------------------------------------------------

/** The pad's own surface, chosen per park in the editor. */
export const GROUNDS = [
  { id: 'concrete', label: 'Concrete', color: CONCRETE },
  { id: 'wood', label: 'Skatelite', color: RAMP },
  { id: 'dirt', label: 'Dirt', color: DIRT },
];

export function groundColor(id) {
  return (GROUNDS.find((g) => g.id === id) || GROUNDS[0]).color;
}

/** The surface an object is made of — the same swatches a slab of the pad is. */
export const SURFACES = [
  { id: 'concrete', label: 'Concrete', color: CONCRETE },
  { id: 'dark', label: 'Gunmetal', color: CONCRETE_DARK },
  { id: 'wood', label: 'Skatelite', color: RAMP },
  { id: 'steel', label: 'Steel', color: STEEL },
  { id: 'paint', label: 'Paint', color: PAINT },
  { id: 'dirt', label: 'Dirt', color: DIRT },
];

export function surfaceColor(id) {
  return (SURFACES.find((s) => s.id === id) || SURFACES[0]).color;
}

/** A hex string like `#b4afa2`, or null if it is not one. */
export function isHexColor(color) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);
}

/**
 * Resolve an object's `color` field to a real colour. The editor lets a player
 * paint an object from the surface swatches *or* dial in any colour on the
 * wheel, so the field carries either a surface id ('concrete', 'wood', ...) or
 * a `#rrggbb` hex — this turns both into a colour the builders can use.
 */
export function objectColor(color) {
  return isHexColor(color) ? color : surfaceColor(color);
}

/** A numeric colour (0xb4afa2) as a `#rrggbb` CSS string, for the editor's
 * swatches and chips — CSS cannot read a bare hex number. */
export function cssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A colour in `#rrggbb` form no matter what it arrived as — a surface id
 * ('wood'), a numeric colour, or a wheel-picked hex string — for the editor's
 * wheel and chips, which work on strings. Unknown colours fall back to
 * concrete. */
export function cssColorOf(color) {
  if (isHexColor(color)) return color;
  const c = typeof color === 'number' ? color : surfaceColor(color);
  return cssColor(c);
}

/** The pad's own colour: a custom wheel pick overrides the ground preset. */
export function padColor(file) {
  const hex = file && file.groundHex;
  if (isHexColor(hex)) return hex;
  return groundColor(file && file.ground);
}

// --- transforms -----------------------------------------------------------

const DEG = Math.PI / 180;

/** The object's own vertical stretch: every height a builder or a preview
 * uses is scaled by `sy` so the collision a player rides rises exactly as
 * far as the mesh the editor shows. A missing sy (an older saved file) reads
 * as 1, so nothing that exists today changes shape. */
export function sh(o, v) {
  return v * (o.sy || 1);
}

/** The object's frame: which way it faces and which way is right, snapped to
 * a quarter turn. `fx/fz` is the world vector one unit of local z becomes,
 * `rx/rz` the same for local x — so a plain linear map places any local point,
 * and because the axes stay axis-aligned the map stays exact. */
function frame(o) {
  const q = ((Math.round(o.ry / 90) % 4) + 4) % 4;
  const FX = [0, 1, 0, -1][q]; // local +z turns into...
  const FZ = [1, 0, -1, 0][q];
  const RX = [1, 0, -1, 0][q]; // ...and local +x into...
  const RZ = [0, -1, 0, 1][q];
  return {
    cx: o.x,
    cz: o.z,
    fx: FX * o.sz,
    fz: FZ * o.sz,
    rx: RX * o.sx,
    rz: RZ * o.sx,
  };
}

/** A local point -> world [x, z]. */
function worldPoint(o, lx, lz) {
  const f = frame(o);
  return [f.cx + f.rx * lx + f.fx * lz, f.cz + f.rz * lx + f.fz * lz];
}

/** The axis-aligned world rectangle a local rect occupies after the transform. */
function worldRect(o, lx0, lx1, lz0, lz1) {
  const f = frame(o);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const lx of [lx0, lx1]) {
    for (const lz of [lz0, lz1]) {
      const wx = f.cx + f.rx * lx + f.fx * lz;
      const wz = f.cz + f.rz * lx + f.fz * lz;
      x0 = Math.min(x0, wx);
      x1 = Math.max(x1, wx);
      z0 = Math.min(z0, wz);
      z1 = Math.max(z1, wz);
    }
  }
  return { x0, x1, z0, z1 };
}

/** Which world axis an object's forward runs along: 'x' or 'z'. */
function forwardAxis(o) {
  return frame(o).fx !== 0 ? 'x' : 'z';
}

function slabDepth(h) {
  return Math.max(0.55, h + 0.05);
}

// --- the palette ----------------------------------------------------------
// Each entry: the params the player edits, a builder that paints the object
// onto a Park, a builder for the editor's preview mesh, the footprint the
// spawn/patrol generators must keep clear, and a label for the UI.

export const OBJECTS = [
  {
    id: 'slab',
    label: 'Slab',
    hint: 'A flat pad. Lay them down for ground, platforms and manual pads.',
    defaults: { w: 8, d: 4, h: 0.25, color: 'concrete' },
    meta: {
      kind: 'flat',
      grindable: false,
      difficulty: 1,
      tags: ['flat', 'manual', 'ground', 'pad'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 24, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 0.5, max: 24, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0, max: 6, step: 0.05, unit: 'm' },
    ],
    build(p, o) {
      const r = worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
      p.add(new Slab(r.x0, r.x1, r.z0, r.z1, sh(o, o.h) + o.y, SMOOTH, objectColor(o.color), slabDepth(sh(o, o.h))));
    },
    footprint(o) {
      return worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
    },
    preview(o) {
      const h = sh(o, o.h);
      const depth = slabDepth(h);
      return box(o.w, depth, o.d, 0, h - depth / 2, 0, objectColor(o.color));
    },
  },

  {
    id: 'bank',
    label: 'Bank',
    hint: 'A straight incline from the ground up to its tall end.',
    defaults: { w: 4, len: 5, h: 1.4, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: false,
      difficulty: 2,
      tags: ['transition', 'ramp', 'bank'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'len', label: 'Length', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Rise', min: 0.1, max: 5, step: 0.05, unit: 'm' },
    ],
    build(p, o) {
      const low = worldPoint(o, 0, -o.len / 2);
      const high = worldPoint(o, 0, o.len / 2);
      const cross = worldRect(o, -o.w / 2, o.w / 2, 0, 0);
      const axis = low[0] !== high[0] ? 'x' : 'z';
      const rise = sh(o, o.h);
      let x0, x1, z0, z1, y0, y1;
      if (axis === 'x') {
        x0 = Math.min(low[0], high[0]);
        x1 = Math.max(low[0], high[0]);
        z0 = Math.min(cross.z0, cross.z1);
        z1 = Math.max(cross.z0, cross.z1);
        y0 = low[0] < high[0] ? o.y : rise + o.y;
        y1 = low[0] < high[0] ? rise + o.y : o.y;
      } else {
        x0 = Math.min(cross.x0, cross.x1);
        x1 = Math.max(cross.x0, cross.x1);
        z0 = Math.min(low[1], high[1]);
        z1 = Math.max(low[1], high[1]);
        y0 = low[1] < high[1] ? o.y : rise + o.y;
        y1 = low[1] < high[1] ? rise + o.y : o.y;
      }
      p.add(new Bank(x0, x1, z0, z1, axis, y0, y1, objectColor(o.color)));
    },
    footprint(o) {
      return worldRect(o, -o.w / 2, o.w / 2, -o.len / 2, o.len / 2);
    },
    preview(o) {
      const pts = [
        [0, -0.6],
        [o.len, -0.6],
        [o.len, sh(o, o.h)],
        [0, 0],
      ];
      // The bank's footprint is centred on the origin (low end at -len/2,
      // tall end at +len/2), so its base line sits there too — not at z=0.
      return prism(pts, o.len, o.w, -o.len / 2, objectColor(o.color));
    },
  },

  {
    id: 'quarter',
    label: 'Quarterpipe',
    hint: 'A ramp that starts flat and arcs up — the classic park wall.',
    defaults: { w: 4, R: 2.4, H: 1.8, deck: 0.6, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: false,
      difficulty: 2,
      tags: ['transition', 'ramp', 'quarterpipe'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'R', label: 'Radius', min: 0.6, max: 6, step: 0.05, unit: 'm' },
      { key: 'H', label: 'Height', min: 0.3, max: 5, step: 0.05, unit: 'm' },
      { key: 'deck', label: 'Deck', min: 0, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const base = worldPoint(o, 0, 0);
      const cross = worldRect(o, -o.w / 2, o.w / 2, 0, 0);
      const f = frame(o);
      const axis = forwardAxis(o);
      const sign = axis === 'z' ? (f.fz > 0 ? 1 : -1) : f.fx > 0 ? 1 : -1;
      const baseC = axis === 'z' ? base[1] : base[0];
      const c0 = axis === 'z' ? cross.x0 : cross.z0;
      const c1 = axis === 'z' ? cross.x1 : cross.z1;
      p.add(new Quarter(c0, c1, baseC, axis, sign, o.R, H, o.deck, objectColor(o.color), o.y));
      // Steel coping sunk into the lip — every other transition already has it,
      // and a quarterpipe without it reads as half-finished (see the roll-in,
      // mini, spine and funbox above).
      const uTop = quarterU(o.R, H);
      lineCoping(p, worldPoint(o, -o.w / 2, uTop), worldPoint(o, o.w / 2, uTop), H + o.y);
    },
    footprint(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const u = quarterU(o.R, H);
      return worldRect(o, -o.w / 2, o.w / 2, 0, u + o.deck);
    },
    preview(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const color = objectColor(o.color);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(quarterGeo(o.w, o.R, H, o.deck), mat(color)));
      previewCoping(g, o.w, H, quarterU(o.R, H), COPING);
      return g;
    },
  },

  {
    id: 'mini',
    label: 'Mini Ramp',
    hint: 'A half-pipe: two quarterpipes facing off over a flat, coping on both lips.',
    defaults: { w: 4, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: 'coping',
      difficulty: 3,
      tags: ['transition', 'ramp', 'halfpipe', 'coping'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'R', label: 'Radius', min: 0.6, max: 6, step: 0.05, unit: 'm' },
      { key: 'H', label: 'Height', min: 0.3, max: 5, step: 0.05, unit: 'm' },
      { key: 'flat', label: 'Flat', min: 0.5, max: 14, step: 0.1, unit: 'm' },
      { key: 'deck', label: 'Deck', min: 0, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      halfPipe(p, o);
    },
    footprint(o) {
      return halfPipeBounds(o);
    },
    preview(o) {
      return halfPipePreview(o);
    },
  },

  {
    id: 'rollin',
    label: 'Roll-In Ramp',
    hint: 'A tall transition up to a deep platform — stand on it and drop to the flat.',
    defaults: { w: 4, R: 2.8, H: 1.8, deck: 4, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: 'coping',
      difficulty: 2,
      tags: ['transition', 'ramp', 'deck', 'coping'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'R', label: 'Radius', min: 0.6, max: 6, step: 0.05, unit: 'm' },
      { key: 'H', label: 'Height', min: 0.3, max: 5, step: 0.05, unit: 'm' },
      { key: 'deck', label: 'Platform', min: 0, max: 10, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const uTop = quarterU(o.R, H);
      const color = objectColor(o.color);
      const base = worldPoint(o, 0, 0);
      const cross = worldRect(o, -o.w / 2, o.w / 2, 0, 0);
      const f = frame(o);
      const axis = forwardAxis(o);
      const sign = axis === 'z' ? (f.fz > 0 ? 1 : -1) : f.fx > 0 ? 1 : -1;
      p.add(new Quarter(axis === 'z' ? cross.x0 : cross.z0, axis === 'z' ? cross.x1 : cross.z1, axis === 'z' ? base[1] : base[0], axis, sign, o.R, H, 0, color, o.y));
      if (o.deck > 0) {
        const plat = worldRect(o, -o.w / 2, o.w / 2, uTop, uTop + o.deck);
        p.add(new Slab(plat.x0, plat.x1, plat.z0, plat.z1, H + o.y, SMOOTH, color, slabDepth(H)));
      }
      lineCoping(p, worldPoint(o, -o.w / 2, uTop), worldPoint(o, o.w / 2, uTop), H + o.y);
    },
    footprint(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      return worldRect(o, -o.w / 2, o.w / 2, 0, quarterU(o.R, H) + o.deck);
    },
    preview(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const uTop = quarterU(o.R, H);
      const color = objectColor(o.color);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(quarterGeo(o.w, o.R, H, 0), mat(color)));
      previewCoping(g, o.w, H, uTop, COPING);
      if (o.deck > 0) {
        const depth = slabDepth(H);
        g.add(box(o.w, depth, o.deck, 0, H - depth / 2, uTop + o.deck / 2, color));
      }
      return g;
    },
  },

  {
    id: 'spine',
    label: 'Spine Ramp',
    hint: 'Two transitions back to back — the only way across is a transfer over the top.',
    defaults: { w: 4, R: 2.0, H: 1.4, gap: 1.0, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: 'coping',
      difficulty: 4,
      tags: ['transition', 'ramp', 'spine', 'transfer', 'coping'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'R', label: 'Radius', min: 0.6, max: 6, step: 0.05, unit: 'm' },
      { key: 'H', label: 'Height', min: 0.3, max: 5, step: 0.05, unit: 'm' },
      { key: 'gap', label: 'Gap', min: 0, max: 8, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const uTop = quarterU(o.R, H);
      const half = o.gap / 2;
      const color = objectColor(o.color);
      const f = frame(o);
      const axis = forwardAxis(o);
      const dir = axis === 'z' ? f.fz : f.fx;
      const signN = dir > 0 ? 1 : -1;
      const cross = worldRect(o, -o.w / 2, o.w / 2, 0, 0);
      const c0 = axis === 'z' ? cross.x0 : cross.z0;
      const c1 = axis === 'z' ? cross.x1 : cross.z1;
      p.add(new Quarter(c0, c1, axis === 'z' ? worldPoint(o, 0, half)[1] : worldPoint(o, 0, half)[0], axis, signN, o.R, H, 0, color, o.y));
      p.add(new Quarter(c0, c1, axis === 'z' ? worldPoint(o, 0, -half)[1] : worldPoint(o, 0, -half)[0], axis, -signN, o.R, H, 0, color, o.y));
      lineCoping(p, worldPoint(o, -o.w / 2, half + uTop), worldPoint(o, o.w / 2, half + uTop), H + o.y);
      lineCoping(p, worldPoint(o, -o.w / 2, -half - uTop), worldPoint(o, o.w / 2, -half - uTop), H + o.y);
    },
    footprint(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const half = o.gap / 2 + quarterU(o.R, H);
      return worldRect(o, -o.w / 2, o.w / 2, -half, half);
    },
    preview(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const half = o.gap / 2;
      const color = objectColor(o.color);
      const g = new THREE.Group();
      const n = quarterGeo(o.w, o.R, H, 0);
      n.translate(0, 0, half);
      g.add(new THREE.Mesh(n, mat(color)));
      const s = quarterGeo(o.w, o.R, H, 0);
      s.rotateY(Math.PI);
      s.translate(0, 0, -half);
      g.add(new THREE.Mesh(s, mat(color)));
      const uTop = quarterU(o.R, H);
      previewCoping(g, o.w, H, half + uTop, COPING);
      previewCoping(g, o.w, H, -half - uTop, COPING);
      return g;
    },
  },

  {
    id: 'vert',
    label: 'Vert Ramp',
    hint: 'A big half-pipe with near-vertical walls — the classic big-air ramp.',
    defaults: { w: 6, R: 3.5, H: 3.0, flat: 5, deck: 2.5, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: 'coping',
      difficulty: 5,
      tags: ['transition', 'ramp', 'halfpipe', 'vert', 'big-air', 'coping'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'R', label: 'Radius', min: 0.6, max: 6, step: 0.05, unit: 'm' },
      { key: 'H', label: 'Height', min: 0.3, max: 5, step: 0.05, unit: 'm' },
      { key: 'flat', label: 'Flat', min: 0.5, max: 14, step: 0.1, unit: 'm' },
      { key: 'deck', label: 'Deck', min: 0, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      halfPipe(p, o);
    },
    footprint(o) {
      return halfPipeBounds(o);
    },
    preview(o) {
      return halfPipePreview(o);
    },
  },

  {
    id: 'bowl',
    label: 'Small Bowl',
    hint: 'A round pool of transition — drop in, pump around the walls, launch airs from any side.',
    defaults: { R: 2.0, H: 1.2, rim: 1.0, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: false,
      difficulty: 3,
      tags: ['transition', 'bowl', 'pool'],
    },
    props: [
      { key: 'R', label: 'Radius', min: 0.6, max: 6, step: 0.05, unit: 'm' },
      { key: 'H', label: 'Height', min: 0.3, max: 5, step: 0.05, unit: 'm' },
      { key: 'rim', label: 'Deck', min: 0.2, max: 4, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      p.add(new Bowl(o.x, o.z, o.sx, o.sz, o.R, H, o.rim, objectColor(o.color), o.y));
    },
    footprint(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const r = bowlU(o.R, H) + o.rim;
      // A quarter-turn is the only rotation that exists, so the circle's
      // axis-aligned box is the same square of corners under any of them.
      return worldRect(o, -r, r, -r, r);
    },
    preview(o) {
      const H = Math.min(sh(o, o.H), o.R - 0.05);
      const color = objectColor(o.color);
      const g = new THREE.Group();
      const pts = bowlProfile(o.R, H, o.rim).map(([u, y]) => new THREE.Vector2(u, y));
      g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat(color)));
      // The polished coping ring let into the lip, matching the real bowl's
      // mesh so the editor previews what a built park actually wears.
      const ring = new THREE.TorusGeometry(bowlU(o.R, H), 0.045, 10, 32);
      ring.rotateX(Math.PI / 2);
      const coping = new THREE.Mesh(ring, mat(COPING));
      coping.position.y = H;
      g.add(coping);
      return g;
    },
  },

  {
    id: 'stairs',
    label: 'Stairs',
    hint: 'Steps up to a deck. The tall end meets whatever you place behind it.',
    defaults: { w: 3, steps: 4, rise: 0.18, run: 0.28, color: 'dark' },
    meta: {
      kind: 'stair',
      grindable: false,
      difficulty: 3,
      tags: ['stairs', 'step', 'gap'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.5, max: 20, step: 0.1, unit: 'm' },
      { key: 'steps', label: 'Steps', min: 1, max: 10, step: 1, unit: '' },
      { key: 'rise', label: 'Rise', min: 0.1, max: 0.4, step: 0.01, unit: 'm' },
      { key: 'run', label: 'Run', min: 0.15, max: 0.6, step: 0.01, unit: 'm' },
    ],
    build(p, o) {
      const len = o.steps * o.run;
      const top = worldPoint(o, 0, len / 2);
      const cross = worldRect(o, -o.w / 2, o.w / 2, 0, 0);
      const f = frame(o);
      const axis = forwardAxis(o);
      const topC = axis === 'z' ? top[1] : top[0];
      const sign = axis === 'z' ? (f.fz > 0 ? -1 : 1) : f.fx > 0 ? -1 : 1;
      const c0 = axis === 'z' ? cross.x0 : cross.z0;
      const c1 = axis === 'z' ? cross.x1 : cross.z1;
      p.add(new Stairs(c0, c1, topC, axis, sign, Math.max(1, Math.round(o.steps)), sh(o, o.rise), o.run, o.y, objectColor(o.color)));
    },
    footprint(o) {
      const len = o.steps * o.run;
      return worldRect(o, -o.w / 2, o.w / 2, -len / 2, len / 2);
    },
    preview(o) {
      const len = o.steps * o.run;
      const rise = sh(o, o.rise);
      const yTop = o.steps * rise;
      const pts = [
        [0, -0.6],
        [0, yTop],
      ];
      for (let i = 0; i < o.steps; i++) {
        const y = yTop - (i + 1) * rise;
        pts.push([i * o.run, y], [(i + 1) * o.run, y]);
      }
      pts.push([len, -0.6]);
      // u = 0 is the tall end; the local frame keeps that end at +z.
      return prism(pts, len, o.w, len / 2, objectColor(o.color), true);
    },
  },

  {
    id: 'rail',
    label: 'Rail',
    hint: 'A round grindable bar on posts, at whatever height you set. Raise the far end to slope it down a bank.',
    defaults: { len: 4, h: 0.9, h2: 0, r: 0.045, color: 'steel' },
    hint: 'A round grindable bar on posts, at whatever height you set.',
    defaults: { len: 4, h: 0.9, r: 0.045, color: 'steel' },
    meta: {
      kind: 'rail',
      grindable: 'rail',
      difficulty: 3,
      tags: ['rail', 'grind', 'flatbar'],
    },
    props: [
      { key: 'len', label: 'Length', min: 1, max: 16, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.1, max: 3, step: 0.05, unit: 'm' },
      { key: 'h2', label: 'High End', min: 0, max: 3, step: 0.05, unit: 'm' },
      { key: 'r', label: 'Radius', min: 0.025, max: 0.12, step: 0.005, unit: 'm' },
    ],
    build(p, o) {
      const a = worldPoint(o, -o.len / 2, 0);
      const b = worldPoint(o, o.len / 2, 0);
      const h = sh(o, o.h);
      // High End is a height, so it rides on the object's own vertical scale;
      // 0 (the default) means "level" rather than "down at the ground".
      const h2 = o.h2 ? sh(o, o.h2) : h;
      p.rail(a[0], h + o.y, a[1], b[0], h2 + o.y, b[1], o.r, objectColor(o.color));
    },
    footprint(o) {
      return worldRect(o, -o.len / 2, o.len / 2, -0.4, 0.4);
    },
    preview(o) {
      const color = objectColor(o.color);
      const g = new THREE.Group();
      const h = sh(o, o.h);
      const h2 = o.h2 ? sh(o, o.h2) : h;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.len, 10), mat(color));
      // The bar runs along +x; a small rotation about z slopes it from h at
      // the near end up to h2 at the far end, exactly like the collision line.
      const ang = Math.atan2(h2 - h, o.len);
      bar.rotation.z = Math.PI / 2 - ang;
      bar.position.y = (h + h2) / 2;
      g.add(bar);
      const posts = Math.max(2, Math.round(o.len / 2.2));
      for (let i = 0; i < posts; i++) {
        const x = -o.len / 2 + (o.len * i) / (posts - 1);
        const t = (x + o.len / 2) / o.len;
        const y = h + (h2 - h) * t;
        const ph = Math.max(0.05, y - o.r);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, ph, 0.05), mat(color));
        post.position.set(x, ph / 2, 0);
        g.add(post);
      }
      return g;
    },
  },

  {
    id: 'ledge',
    label: 'Ledge',
    hint: 'A low platform with a grindable top edge down its front.',
    defaults: { len: 4, w: 1.2, h: 0.6, color: 'concrete' },
    meta: {
      kind: 'ledge',
      grindable: 'ledge',
      difficulty: 3,
      tags: ['ledge', 'grind'],
    },
    props: [
      { key: 'len', label: 'Length', min: 1, max: 16, step: 0.1, unit: 'm' },
      { key: 'w', label: 'Depth', min: 0.6, max: 6, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.2, max: 2, step: 0.05, unit: 'm' },
    ],
    build(p, o) {
      const h = sh(o, o.h);
      const r = worldRect(o, -o.len / 2, o.len / 2, -o.w / 2, o.w / 2);
      p.add(new Slab(r.x0, r.x1, r.z0, r.z1, h + o.y, SMOOTH, objectColor(o.color), slabDepth(h)));
      const a = worldPoint(o, -o.len / 2, o.w / 2);
      const b = worldPoint(o, o.len / 2, o.w / 2);
      p.ledge(a[0], h + o.y, a[1], b[0], h + o.y, b[1]);
    },
    footprint(o) {
      return worldRect(o, -o.len / 2, o.len / 2, -o.w / 2, o.w / 2);
    },
    preview(o) {
      const h = sh(o, o.h);
      const depth = slabDepth(h);
      const g = new THREE.Group();
      g.add(box(o.len, depth, o.w, 0, h - depth / 2, 0, objectColor(o.color)));
      g.add(box(o.len, 0.07, 0.07, 0, h + 0.035, o.w / 2, STEEL));
      return g;
    },
  },

  {
    id: 'hoop',
    label: 'Hoop',
    hint: 'A decorative ring to jump through — no collision or grind, just style.',
    category: 'decor',
    defaults: { r: 1.6, tube: 0.12, color: '#e0552f' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'gap', 'air'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.8, max: 5, step: 0.1, unit: 'm' },
      { key: 'tube', label: 'Tube', min: 0.05, max: 0.4, step: 0.01, unit: 'm' },
    ],
    build(p, o) {
      p.hoop(o.x, o.y, o.z, o.r, o.tube, (o.ry || 0) * DEG - Math.PI / 2);
    },
    footprint(o) {
      // The ring stands in the XY plane (its local z extent is just the tube),
      // exactly where the preview draws it — so spawn and patrol keep clear of
      // the ring, not just of a nothing where it happens to hang.
      return decorWorldRect(o, -(o.r + o.tube), o.r + o.tube, -o.tube, o.tube);
    },
    preview(o) {
      return new THREE.Mesh(new THREE.TorusGeometry(o.r, o.tube, 10, 28), mat(objectColor(o.color)));
    },
  },

  {
    id: 'bench',
    label: 'Bench',
    hint: 'A park bench for spectators — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 2.4, color: 'steel' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'seating'],
    },
    props: [
      { key: 'len', label: 'Length', min: 0.8, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      p.bench(o.x, o.y, o.z, o.len * o.sx, o.ry * DEG, objectColor(o.color));
    },
    footprint(o) {
      // The bench's length runs along local x — the seat and backrest are `len`
      // long — with its width and legs reaching about 0.1 past the foot of
      // each leg, so the clear rect is the box the preview really fills.
      return decorWorldRect(o, -o.len / 2, o.len / 2, -(o.len / 2 - 0.1), o.len / 2 - 0.1);
    },
    preview(o) {
      const color = objectColor(o.color);
      const g = new THREE.Group();
      g.add(box(o.len, 0.06, 0.34, 0, 0.46, 0, color));
      g.add(box(o.len, 0.36, 0.05, 0, 0.65, -0.18, color));
      const leg = (z) => g.add(box(0.06, 0.46, 0.4, 0, 0.23, z, 0x4a4438));
      leg(o.len / 2 - 0.3);
      leg(-(o.len / 2 - 0.3));
      return g;
    },
  },

  {
    id: 'planter',
    label: 'Planter',
    hint: 'A low bed of shrubs — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 1.6, d: 1.6, color: 'concrete' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'greenery'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.6, max: 6, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 0.6, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      p.planter(o.x, o.y, o.z, o.w * o.sx, o.d * o.sz, o.ry * DEG, objectColor(o.color));
    },
    footprint(o) {
      return decorWorldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
    },
    preview(o) {
      const g = new THREE.Group();
      g.add(box(o.w, 0.4, o.d, 0, 0.2, 0, objectColor(o.color)));
      g.add(box(o.w * 0.82, 0.5, o.d * 0.82, 0, 0.5, 0, 0x3f5a3a));
      return g;
    },
  },

  {
    id: 'funbox',
    label: 'Funbox',
    hint: 'A box of quarterpipes on every side, with a coping on each lip.',
    defaults: { w: 4, d: 4, h: 1.2, R: 1.6, color: 'wood' },
    meta: {
      kind: 'transition',
      grindable: 'coping',
      difficulty: 4,
      tags: ['funbox', 'box', 'quarterpipe', 'coping'],
    },
    props: [
      { key: 'w', label: 'Width', min: 2, max: 14, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 2, max: 14, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.4, max: 4, step: 0.05, unit: 'm' },
      { key: 'R', label: 'Radius', min: 0.6, max: 4, step: 0.05, unit: 'm' },
    ],
    build(p, o) {
      const h = sh(o, o.h);
      const H = Math.min(h, o.R - 0.05);
      const color = objectColor(o.color);
      const r = worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
      p.add(new Slab(r.x0, r.x1, r.z0, r.z1, h + o.y, SMOOTH, color, slabDepth(h)));
      const f = frame(o);
      const axis = forwardAxis(o);
      // Forward and back faces.
      const fBase = worldPoint(o, 0, o.d / 2);
      const bBase = worldPoint(o, 0, -o.d / 2);
      const fSign = axis === 'z' ? (f.fz > 0 ? 1 : -1) : f.fx > 0 ? 1 : -1;
      const fCross = worldRect(o, -o.w / 2, o.w / 2, o.d / 2, o.d / 2);
      const bCross = worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, -o.d / 2);
      p.add(
        new Quarter(
          axis === 'z' ? fCross.x0 : fCross.z0,
          axis === 'z' ? fCross.x1 : fCross.z1,
          axis === 'z' ? fBase[1] : fBase[0],
          axis,
          fSign,
          o.R,
          H,
          0,
          color,
          o.y
        )
      );
      p.add(
        new Quarter(
          axis === 'z' ? bCross.x0 : bCross.z0,
          axis === 'z' ? bCross.x1 : bCross.z1,
          axis === 'z' ? bBase[1] : bBase[0],
          axis,
          -fSign,
          o.R,
          H,
          0,
          color,
          o.y
        )
      );
      // Right and left faces run along the cross axis.
      const sideAxis = axis === 'z' ? 'x' : 'z';
      const rBase = worldPoint(o, o.w / 2, 0);
      const lBase = worldPoint(o, -o.w / 2, 0);
      const rSign = sideAxis === 'z' ? (f.rz > 0 ? 1 : -1) : f.rx > 0 ? 1 : -1;
      const rCross = worldRect(o, o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
      const lCross = worldRect(o, -o.w / 2, -o.w / 2, -o.d / 2, o.d / 2);
      p.add(
        new Quarter(
          sideAxis === 'z' ? rCross.x0 : rCross.z0,
          sideAxis === 'z' ? rCross.x1 : rCross.z1,
          sideAxis === 'z' ? rBase[1] : rBase[0],
          sideAxis,
          rSign,
          o.R,
          H,
          0,
          color,
          o.y
        )
      );
      p.add(
        new Quarter(
          sideAxis === 'z' ? lCross.x0 : lCross.z0,
          sideAxis === 'z' ? lCross.x1 : lCross.z1,
          sideAxis === 'z' ? lBase[1] : lBase[0],
          sideAxis,
          -rSign,
          o.R,
          H,
          0,
          color,
          o.y
        )
      );
      // Coping sunk into each lip, the way the real maps set theirs.
      lineCoping(p, worldPoint(o, -o.w / 2, o.d / 2), worldPoint(o, o.w / 2, o.d / 2), h + o.y);
      lineCoping(p, worldPoint(o, -o.w / 2, -o.d / 2), worldPoint(o, o.w / 2, -o.d / 2), h + o.y);
      lineCoping(p, worldPoint(o, o.w / 2, -o.d / 2), worldPoint(o, o.w / 2, o.d / 2), h + o.y);
      lineCoping(p, worldPoint(o, -o.w / 2, -o.d / 2), worldPoint(o, -o.w / 2, o.d / 2), h + o.y);
    },
    footprint(o) {
      return worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
    },
    preview(o) {
      const h = sh(o, o.h);
      const H = Math.min(h, o.R - 0.05);
      const color = objectColor(o.color);
      const g = new THREE.Group();
      const depth = slabDepth(h);
      g.add(box(o.w, depth, o.d, 0, h - depth / 2, 0, color));
      const fwd = quarterGeo(o.w, o.R, H, 0);
      const back = fwd.clone();
      // The side quarters run along the other axis, so their cross extent is
      // the funbox's depth, not its width.
      const right = quarterGeo(o.d, o.R, H, 0);
      const left = right.clone();
      fwd.translate(0, 0, o.d / 2);
      back.rotateY(Math.PI);
      back.translate(0, 0, -o.d / 2);
      right.rotateY(Math.PI / 2);
      right.translate(o.w / 2, 0, 0);
      left.rotateY(-Math.PI / 2);
      left.translate(-o.w / 2, 0, 0);
      g.add(new THREE.Mesh(fwd, mat(color)));
      g.add(new THREE.Mesh(back, mat(color)));
      g.add(new THREE.Mesh(right, mat(color)));
      g.add(new THREE.Mesh(left, mat(color)));
      const uTop = quarterU(o.R, H);
      // Coping along each of the four lips: the two along local x (the
      // funbox's width) and the two along local z (its depth).
      previewCoping(g, o.w, H, o.d / 2 + uTop, COPING);
      previewCoping(g, o.w, H, -o.d / 2 - uTop, COPING);
      const sideM = mat(COPING);
      const sideGeo = new THREE.BoxGeometry(0.09, 0.09, o.d);
      for (const sx of [o.w / 2 + uTop, -o.w / 2 - uTop]) {
        const bar = new THREE.Mesh(sideGeo, sideM);
        bar.position.set(sx, H - 0.012, 0);
        g.add(bar);
      }
      return g;
    },
  },

  {
    id: 'aframe',
    label: 'A-Frame Launch',
    hint: 'A flat deck on a bank up one side and a bank down the other — ride on, pop off the top, ride out.',
    defaults: { w: 4, d: 2, len: 4, h: 1.1, color: 'wood' },
    props: [
      { key: 'w', label: 'Width', min: 2, max: 14, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Top Depth', min: 1, max: 8, step: 0.1, unit: 'm' },
      { key: 'len', label: 'Bank', min: 1, max: 10, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.4, max: 4, step: 0.05, unit: 'm' },
    ],
    build(p, o) {
      launchDeck(p, o, false);
    },
    footprint(o) {
      const len = o.len;
      return worldRect(o, -o.w / 2, o.w / 2, -o.d / 2 - len, o.d / 2 + len);
    },
    preview(o) {
      return launchPreview(o, false);
    },
  },

  {
    id: 'pyramid',
    label: 'Pyramid',
    hint: 'A flat deck with banks on every side — the funbox built out of ramps instead of walls.',
    defaults: { w: 4, d: 4, len: 3, h: 1.2, color: 'wood' },
    props: [
      { key: 'w', label: 'Width', min: 2, max: 14, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 2, max: 14, step: 0.1, unit: 'm' },
      { key: 'len', label: 'Bank', min: 1, max: 10, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.4, max: 4, step: 0.05, unit: 'm' },
    ],
    build(p, o) {
      launchDeck(p, o, true);
    },
    footprint(o) {
      const len = o.len;
      return worldRect(o, -o.w / 2 - len, o.w / 2 + len, -o.d / 2 - len, o.d / 2 + len);
    },
    preview(o) {
      return launchPreview(o, true);
    },
  },

  {
    id: 'trashcan',
    label: 'Trash Can',
    hint: 'A roadside bin — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.35, h: 0.95, color: '#3a5a40' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.2, max: 1, step: 0.05, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.5, max: 2, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: trashcanShapes,
  },

  {
    id: 'dumpster',
    label: 'Dumpster',
    hint: 'A wheeled skip for building rubble — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 2.4, d: 1.3, h: 1.2, color: '#37506b' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'w', label: 'Width', min: 1, max: 5, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 0.8, max: 3, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.6, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: dumpsterShapes,
  },

  {
    id: 'tree',
    label: 'Tree',
    hint: 'A broadleaf shade tree — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.9, h: 2.6, color: '#415f39' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'greenery'],
    },
    props: [
      { key: 'r', label: 'Crown', min: 0.4, max: 3, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 1, max: 6, step: 0.1, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: treeShapes,
  },

  {
    id: 'bush',
    label: 'Bush',
    hint: 'A low shrub — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.85, color: '#3f5a3a' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'greenery'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.3, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: bushShapes,
  },

  {
    id: 'rock',
    label: 'Rock',
    hint: 'A lump of stone — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.6, color: '#8a8d92' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'landscape'],
    },
    props: [
      { key: 'r', label: 'Size', min: 0.2, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: rockShapes,
  },

  {
    id: 'fence',
    label: 'Fence',
    hint: 'A chain-link panel between two posts — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 4, h: 1.8, color: '#6f7580' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street', 'barrier'],
    },
    props: [
      { key: 'len', label: 'Length', min: 1, max: 12, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.6, max: 3.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: fenceShapes,
  },

  {
    id: 'wall',
    label: 'Wall',
    hint: 'A low wall — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 4, h: 1.4, d: 0.3, color: 'concrete' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'w', label: 'Length', min: 1, max: 16, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.4, max: 3, step: 0.05, unit: 'm' },
      { key: 'd', label: 'Depth', min: 0.15, max: 1.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: wallShapes,
  },

  {
    id: 'gate',
    label: 'Gate',
    hint: 'A pair of posts with a barred gate between — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 3, h: 1.3, color: '#6f7580' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street', 'barrier'],
    },
    props: [
      { key: 'w', label: 'Width', min: 1, max: 8, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.6, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: gateShapes,
  },

  {
    id: 'lamp',
    label: 'Street Lamp',
    hint: 'A light post — decorative, no collision or grind.',
    category: 'decor',
    defaults: { h: 5, color: '#8b9099' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'lighting'],
    },
    props: [
      { key: 'h', label: 'Height', min: 2, max: 9, step: 0.1, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: lampShapes,
  },

  {
    id: 'floodlight',
    label: 'Floodlight',
    hint: 'A stadium light on a pole — decorative, no collision or grind.',
    category: 'decor',
    defaults: { h: 4.5, color: '#e8e8e0' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'lighting'],
    },
    props: [
      { key: 'h', label: 'Height', min: 2, max: 9, step: 0.1, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: floodlightShapes,
  },

  {
    id: 'cone',
    label: 'Traffic Cone',
    hint: 'A road cone — decorative, no collision or grind.',
    category: 'decor',
    defaults: { h: 0.7, color: '#e8702c' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'h', label: 'Height', min: 0.3, max: 1.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: coneShapes,
  },

  {
    id: 'barrier',
    label: 'Barrier',
    hint: 'An A-frame safety barrier — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 1.8, h: 1.1, color: '#e8702c' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street', 'barrier'],
    },
    props: [
      { key: 'len', label: 'Length', min: 0.8, max: 5, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.5, max: 2, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: barrierShapes,
  },

  {
    id: 'sign',
    label: 'Sign',
    hint: 'A street sign on a post — decorative, no collision or grind.',
    category: 'decor',
    defaults: { h: 1.7, w: 0.9, color: '#37506b' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'h', label: 'Height', min: 0.8, max: 4, step: 0.05, unit: 'm' },
      { key: 'w', label: 'Panel', min: 0.4, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: signShapes,
  },

  {
    id: 'pallet',
    label: 'Pallet',
    hint: 'A wooden pallet left on the pad — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 1.2, d: 1.0, h: 0.15, color: '#9a7b4f' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.6, max: 3, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 0.6, max: 3, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.08, max: 0.4, step: 0.01, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: palletShapes,
  },

  {
    id: 'barrel',
    label: 'Barrel',
    hint: 'A steel drum — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.45, h: 0.9, color: '#c9533a' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.2, max: 1, step: 0.05, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.4, max: 1.8, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: barrelShapes,
  },

  {
    id: 'pipe',
    label: 'Pipe',
    hint: 'A concrete drainage pipe lying on the pad — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 3.2, r: 0.4, color: '#9fa5ad' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'len', label: 'Length', min: 1, max: 10, step: 0.1, unit: 'm' },
      { key: 'r', label: 'Radius', min: 0.2, max: 1.2, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: pipeShapes,
  },

  {
    id: 'graffiti',
    label: 'Graffiti Wall',
    hint: 'A spray-painted wall — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 3, h: 2.2, color: '#c94f3a' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street', 'art'],
    },
    props: [
      { key: 'w', label: 'Width', min: 1, max: 10, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.8, max: 4, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: graffitiShapes,
  },

  {
    id: 'poster',
    label: 'Poster',
    hint: 'A poster board on posts — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 1.1, h: 1.5, color: '#d6c064' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street', 'art'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.6, max: 3, step: 0.05, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.8, max: 3, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: posterShapes,
  },

  {
    id: 'banner',
    label: 'Banner',
    hint: 'A cloth banner hung between two poles — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 4.5, h: 1.0, color: '#37506b' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'event'],
    },
    props: [
      { key: 'w', label: 'Width', min: 2, max: 10, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.5, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: bannerShapes,
  },

  {
    id: 'car',
    label: 'Car',
    hint: 'A parked car — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 4.2, w: 1.8, h: 0.6, color: '#3f5a3a' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'vehicle'],
    },
    props: [
      { key: 'len', label: 'Length', min: 2.5, max: 6, step: 0.1, unit: 'm' },
      { key: 'w', label: 'Width', min: 1.2, max: 2.5, step: 0.05, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.4, max: 1.2, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: carShapes,
  },

  {
    id: 'bike',
    label: 'Bike',
    hint: 'A bicycle leaned on its stand — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 1.7, color: '#c94f3a' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'vehicle'],
    },
    props: [
      { key: 'len', label: 'Length', min: 1, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: bikeShapes,
  },

  {
    id: 'van',
    label: 'Van',
    hint: 'A parked van — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 4.8, w: 1.9, color: '#e8e4d8' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'vehicle'],
    },
    props: [
      { key: 'len', label: 'Length', min: 3, max: 8, step: 0.1, unit: 'm' },
      { key: 'w', label: 'Width', min: 1.4, max: 2.8, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: vanShapes,
  },

  {
    id: 'rack',
    label: 'Skate Rack',
    hint: 'A rail of parked boards — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 2.4, h: 0.9, color: '#8b9099' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'len', label: 'Length', min: 1, max: 6, step: 0.1, unit: 'm' },
      { key: 'h', label: 'Height', min: 0.5, max: 1.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: rackShapes,
  },

  {
    id: 'manhole',
    label: 'Manhole',
    hint: 'A round cover set in the pad — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.55, color: '#6f7580' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.25, max: 1.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: manholeShapes,
  },

  {
    id: 'drain',
    label: 'Drain',
    hint: 'A grated storm drain — decorative, no collision or grind.',
    category: 'decor',
    defaults: { w: 0.7, d: 1.3, color: '#6f7580' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'w', label: 'Width', min: 0.3, max: 2, step: 0.05, unit: 'm' },
      { key: 'd', label: 'Length', min: 0.6, max: 4, step: 0.1, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: drainShapes,
  },

  {
    id: 'puddle',
    label: 'Puddle',
    hint: 'A slick of water — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 1.1, color: '#4a5a68' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'wet'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.3, max: 3, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: puddleShapes,
  },

  {
    id: 'litter',
    label: 'Litter',
    hint: 'Scattered leaves and rubbish — decorative, no collision or grind.',
    category: 'decor',
    defaults: { r: 0.8, color: '#8a7a58' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'street'],
    },
    props: [
      { key: 'r', label: 'Radius', min: 0.3, max: 2.5, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: litterShapes,
  },

  {
    id: 'foodtruck',
    label: 'Food Truck',
    hint: 'A parked street-food van — decorative, no collision or grind.',
    category: 'decor',
    defaults: { len: 4.5, w: 2.1, color: '#d6c064' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'vehicle', 'event'],
    },
    props: [
      { key: 'len', label: 'Length', min: 3, max: 7, step: 0.1, unit: 'm' },
      { key: 'w', label: 'Width', min: 1.4, max: 2.8, step: 0.05, unit: 'm' },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: foodtruckShapes,
  },

  {
    id: 'spectator',
    label: 'Spectator',
    hint: 'A standing onlooker — decorative, no collision or grind.',
    category: 'decor',
    defaults: { color: '#37506b' },
    meta: {
      kind: 'deco',
      grindable: false,
      difficulty: 1,
      tags: ['decorative', 'crowd'],
    },
    props: [
      { key: 'color', label: 'Shirt', colors: SURFACES.map((s) => s.id) },
    ],
    build: decorBuild,
    footprint: decorFootprint,
    preview: decorPreview,
    shapes: spectatorShapes,
  },

  {
    id: 'speedpad',
    label: 'Speed Pad',
    hint: 'A painted pad that hands you a quick speed boost when you ride over it, then fades back down to your normal top speed.',
    category: 'flat',
    defaults: { w: 3, d: 2, color: '#e0552f' },
    meta: {
      kind: 'flat',
      grindable: false,
      difficulty: 1,
      tags: ['flat', 'boost', 'speed', 'ground'],
    },
    props: [
      { key: 'w', label: 'Width', min: 1, max: 12, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 1, max: 12, step: 0.1, unit: 'm' },
    ],
    build: speedpadBuild,
    footprint(o) {
      return decorWorldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
    },
    preview: decorPreview,
    shapes: speedpadShapes,
  },
];

export function objectType(id) {
  return OBJECTS.find((t) => t.id === id) || OBJECTS[0];
}

// --- decor props -----------------------------------------------------------
// A decorative prop (a trash can, a tree, a food truck) is a list of simple
// shapes in its own local frame, authored once and shared by the game's merged
// scenery and the editor's preview, so the two can never disagree. Every piece
// is a `{ kind, color, s, p, r }`: a box, cylinder, cone, sphere or rock,
// sized `s`, placed at `p` and rotated `r` (Euler XYZ, like geo.js). The
// prop's own transform (position, quarter-turn `ry`, non-uniform `sx`/`sz`)
// is applied around that frame afterwards — by the editor's group and by the
// park's buildDecor alike — which is what keeps what you see exactly what you
// get. None of it is ever part of the height field or the park graph.

/** One shape piece of a decor prop. */
const pc = (kind, color, s, p, r) => ({ kind, color, s, p, r });

/** A fixed colour darkened (`f < 1`) or lightened (`f > 1`) — for the detail
 * pieces of a prop (a bin's rim, a tree's crown) that share its palette
 * colour without being identical to it. */
function shade(color, f) {
  const c = new THREE.Color(color);
  c.multiplyScalar(f);
  return c.getHex();
}

/** The local-frame pieces of the object's type, vertically stretched by the
 * player's `sy` so a prop raised or stretched reads the same in the editor
 * and in the built park (the world transform only scales sx/sz). */
function shapesOf(o) {
  const raw = objectType(o.type).shapes(o);
  const sy = o.sy || 1;
  if (sy === 1) return raw;
  return raw.map((p) => ({
    ...p,
    s: [p.s[0], p.s[1] * sy, p.s[2]],
    p: [p.p[0], p.p[1] * sy, p.p[2]],
  }));
}

/** The unit-geometry half-extents each decor kind is drawn from, so a prop's
 * footprint is the box its pieces really fill. Boxes are ±half their size;
 * cylinders and cones are radius 1 by height 1, so their half-extents are
 * (±size, ∓size, ±size) with the height halved; spheres reach the full radius;
 * and a low-poly rock's icosahedron reaches φ/√(1 + φ²) ≈ 0.851 of its
 * circumradius, not the whole radius. The preview and the built scenery draw
 * the same unit geometries through the same scale/rotate/translate recipe, so
 * these numbers keep the footprint exactly over the mesh. */
const DECOR_HALF = {
  box: [0.5, 0.5, 0.5],
  cyl: [1, 0.5, 1],
  cone: [1, 0.5, 1],
  sphere: [1, 1, 1],
  rock: [0.85065080835204, 0.85065080835204, 0.85065080835204],
};

const _dbS = new THREE.Vector3();
const _dbE = new THREE.Euler();
const _dbQ = new THREE.Quaternion();
const _dbR = new THREE.Matrix4();
const _dbV = new THREE.Vector3();

/** The local-frame bounds of a prop's pieces, for its footprint and size. Each
 * piece is its unit geometry run through scale, rotation and position — the
 * same recipe the preview and the built park use — so the footprint is the box
 * the pieces actually fill, not a boxy guess. */
function decorBounds(o) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of shapesOf(o)) {
    const h = DECOR_HALF[p.kind] || DECOR_HALF.box;
    const s = p.s;
    const r = p.r;
    if (r && (r[0] || r[1] || r[2])) {
      _dbS.set(s[0], s[1], s[2]);
      _dbE.set(r[0], r[1], r[2]);
      _dbQ.setFromEuler(_dbE);
      _dbR.makeRotationFromQuaternion(_dbQ);
      for (let ci = 0; ci < 8; ci++) {
        _dbV.set(
          (ci & 1 ? h[0] : -h[0]) * s[0],
          (ci & 2 ? h[1] : -h[1]) * s[1],
          (ci & 4 ? h[2] : -h[2]) * s[2]
        );
        _dbV.applyMatrix4(_dbR);
        x0 = Math.min(x0, p.p[0] + _dbV.x);
        x1 = Math.max(x1, p.p[0] + _dbV.x);
        y0 = Math.min(y0, p.p[1] + _dbV.y);
        y1 = Math.max(y1, p.p[1] + _dbV.y);
        z0 = Math.min(z0, p.p[2] + _dbV.z);
        z1 = Math.max(z1, p.p[2] + _dbV.z);
      }
    } else {
      const hx = h[0] * s[0];
      const hy = h[1] * s[1];
      const hz = h[2] * s[2];
      x0 = Math.min(x0, p.p[0] - hx);
      x1 = Math.max(x1, p.p[0] + hx);
      y0 = Math.min(y0, p.p[1] - hy);
      y1 = Math.max(y1, p.p[1] + hy);
      z0 = Math.min(z0, p.p[2] - hz);
      z1 = Math.max(z1, p.p[2] + hz);
    }
  }
  return { x0, x1, y0, y1, z0, z1 };
}

/** The world footprint the spawn/patrol generators keep clear: the prop's own
 * pieces, run through the object's transform like any other footprint. A prop
 * may sit at any angle — it is scenery, so nothing stops a diagonal — so its
 * rect is taken from the exact T·Ry(ry)·S(sx, 1, sz) recipe the editor preview
 * and the park's buildDecor use, not from the quarter-turn-snapped frame the
 * collision features are confined to. */
function decorFootprint(o) {
  const b = decorBounds(o);
  return decorWorldRect(o, b.x0, b.x1, b.z0, b.z1);
}

/** The exact axis-aligned world rectangle a local rect occupies after the
 * prop's own full-precision rotation and non-uniform scale. */
function decorWorldRect(o, lx0, lx1, lz0, lz1) {
  const ry = (o.ry || 0) * DEG;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const sx = o.sx || 1;
  const sz = o.sz || 1;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const lx of [lx0, lx1]) {
    for (const lz of [lz0, lz1]) {
      const vx = sx * lx;
      const vz = sz * lz;
      const wx = o.x + vx * cos + vz * sin;
      const wz = o.z - vx * sin + vz * cos;
      x0 = Math.min(x0, wx);
      x1 = Math.max(x1, wx);
      z0 = Math.min(z0, wz);
      z1 = Math.max(z1, wz);
    }
  }
  return { x0, x1, z0, z1 };
}

/** The prop's real on-the-ground size, from the same pieces it draws. */
function decorDimensions(o) {
  const b = decorBounds(o);
  return {
    width: (b.x1 - b.x0) * (o.sx || 1),
    depth: (b.z1 - b.z0) * (o.sz || 1),
    height: Math.max(0.01, b.y1 - b.y0),
  };
}

/** The shared builder: every decor type paints its pieces through p.decor(),
 * and the park's buildDecor stamps the object's own transform on them. */
function decorBuild(p, o) {
  p.decor(objectType(o.type).label, {
    pieces: shapesOf(o),
    x: o.x,
    y: o.y || 0,
    z: o.z,
    ry: (o.ry || 0) * DEG,
    sx: o.sx || 1,
    sz: o.sz || 1,
  });
}

/** The editor's preview for a decor prop: the same pieces as the game's
 * merged scenery, as plain meshes in the local frame. */
function decorPreview(o) {
  const g = new THREE.Group();
  for (const p of shapesOf(o)) {
    const mesh = new THREE.Mesh(previewDecorGeo(p.kind), mat(p.color));
    mesh.scale.set(p.s[0], p.s[1], p.s[2]);
    mesh.position.set(p.p[0], p.p[1], p.p[2]);
    mesh.rotation.set(p.r?.[0] || 0, p.r?.[1] || 0, p.r?.[2] || 0);
    g.add(mesh);
  }
  return g;
}

function previewDecorGeo(kind) {
  switch (kind) {
    case 'cyl':
      return new THREE.CylinderGeometry(1, 1, 1, 14);
    case 'cone':
      return new THREE.ConeGeometry(1, 1, 14);
    case 'sphere':
      return new THREE.SphereGeometry(1, 10, 8);
    case 'rock':
      return new THREE.IcosahedronGeometry(1, 0);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

// Shared piece colours for the props below.
const DARK = 0x22262b;
const GREY = 0x8b9099;
const TRUNK = 0x5a4630;

function trashcanShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  const h = o.h;
  return [
    pc('cyl', c, [r, h, r], [0, h / 2, 0]),
    pc('cyl', shade(c, 0.82), [r * 1.08, 0.06, r * 1.08], [0, h - 0.04, 0]),
    pc('cyl', shade(c, 0.82), [r * 1.05, 0.09, r * 1.05], [0, h + 0.06, 0]),
    pc('cyl', DARK, [r * 0.32, 0.07, r * 0.32], [0, h + 0.14, 0]),
  ];
}

function dumpsterShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const d = o.d;
  const h = o.h;
  const wx = w / 2 - 0.2;
  return [
    pc('box', c, [w, h * 0.92, d], [0, h * 0.46, 0]),
    pc('box', shade(c, 0.82), [w * 0.96, 0.08, d * 0.96], [0, h * 0.94, 0]),
    pc('box', shade(c, 0.85), [w, 0.05, d * 1.02], [0, 0.03, 0]),
    pc('box', DARK, [0.07, 0.14, d * 0.92], [wx, h * 0.6, 0]),
    pc('box', DARK, [0.07, 0.14, d * 0.92], [-wx, h * 0.6, 0]),
    pc('cyl', DARK, [0.17, 0.18, 0.17], [wx - 0.04, 0.09, d / 2 - 0.06], [0, 0, Math.PI / 2]),
    pc('cyl', DARK, [0.17, 0.18, 0.17], [-wx + 0.04, 0.09, d / 2 - 0.06], [0, 0, Math.PI / 2]),
  ];
}

function treeShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  const h = o.h;
  const cy = 1.3 + h * 0.32;
  return [
    pc('cyl', TRUNK, [0.14, 1.3, 0.14], [0, 0.65, 0]),
    pc('sphere', c, [r, h, r], [0, cy, 0]),
    pc('sphere', shade(c, 1.14), [r * 0.55, h * 0.42, r * 0.55], [r * 0.45, cy + h * 0.12, 0]),
    pc('sphere', shade(c, 0.86), [r * 0.5, h * 0.38, r * 0.5], [-r * 0.4, cy - h * 0.16, r * 0.2]),
  ];
}

function bushShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  const base = r * 0.72;
  return [
    pc('sphere', c, [r, base, r], [0, base / 2, 0]),
    pc('sphere', shade(c, 1.15), [r * 0.6, base * 0.5, r * 0.6], [r * 0.42, base * 0.8, 0]),
    pc('sphere', shade(c, 0.85), [r * 0.5, base * 0.45, r * 0.5], [-r * 0.38, base * 0.62, r * 0.3]),
  ];
}

function rockShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  return [
    pc('rock', c, [r, r * 0.75, r * 0.85], [-r * 0.3, r * 0.36, 0]),
    pc('rock', shade(c, 0.88), [r * 0.65, r * 0.55, r * 0.6], [r * 0.4, r * 0.26, r * 0.15]),
  ];
}

function fenceShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const h = o.h;
  const diag = Math.atan2(h - 0.3, len);
  const brace = Math.hypot(len, h - 0.3);
  return [
    pc('box', c, [0.07, h, 0.07], [-len / 2, h / 2, 0]),
    pc('box', c, [0.07, h, 0.07], [len / 2, h / 2, 0]),
    pc('box', c, [len, 0.05, 0.05], [0, h - 0.03, 0]),
    pc('box', c, [len, 0.05, 0.05], [0, 0.3, 0]),
    pc('box', c, [len, 0.04, 0.04], [0, h * 0.62, 0]),
    pc('box', c, [brace, 0.04, 0.04], [0, h * 0.62, 0], [0, 0, diag]),
  ];
}

function wallShapes(o) {
  const c = objectColor(o.color);
  return [
    pc('box', c, [o.w, o.h, o.d], [0, o.h / 2, 0]),
    pc('box', shade(c, 0.82), [o.w, 0.07, o.d + 0.08], [0, o.h + 0.035, 0]),
  ];
}

function gateShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const h = o.h;
  const span = w * 0.74;
  const out = [
    pc('box', c, [0.09, h, 0.09], [-w / 2, h / 2, 0]),
    pc('box', c, [0.09, h, 0.09], [w / 2, h / 2, 0]),
    pc('box', c, [w * 0.82, 0.06, 0.06], [0, h - 0.08, 0]),
    pc('box', c, [w * 0.82, 0.06, 0.06], [0, 0.35, 0]),
  ];
  for (let i = 1; i < 5; i++) {
    const x = -span / 2 + (span * i) / 5;
    out.push(pc('box', c, [0.05, h - 0.5, 0.05], [x, (h + 0.35) / 2, 0]));
  }
  return out;
}

function lampShapes(o) {
  const c = objectColor(o.color);
  const h = o.h;
  return [
    pc('cyl', shade(c, 0.8), [0.24, 0.1, 0.24], [0, 0.05, 0]),
    pc('cyl', c, [0.07, h, 0.07], [0, h / 2, 0]),
    pc('box', c, [0.5, 0.05, 0.05], [0.24, h - 0.05, 0]),
    pc('box', 0x50545c, [0.45, 0.13, 0.2], [0.54, h - 0.14, 0]),
    pc('box', 0xfff1c4, [0.2, 0.07, 0.12], [0.54, h - 0.26, 0]),
  ];
}

function floodlightShapes(o) {
  const c = objectColor(o.color);
  const h = o.h;
  return [
    pc('cyl', 0x6f7580, [0.25, 0.12, 0.25], [0, 0.06, 0]),
    pc('cyl', GREY, [0.06, h, 0.06], [0, h / 2, 0]),
    pc('box', 0x6f7580, [0.12, 0.12, 0.5], [0, h - 0.3, 0]),
    pc('box', c, [0.9, 0.4, 0.5], [0, h - 0.22, -0.25], [0.45, 0, 0]),
  ];
}

function coneShapes(o) {
  const c = objectColor(o.color);
  const h = o.h;
  const body = h * 0.84;
  return [
    pc('cyl', shade(c, 0.85), [0.36, 0.08, 0.36], [0, 0.04, 0]),
    pc('cone', c, [0.26, body, 0.26], [0, 0.08 + body / 2, 0]),
    pc('cyl', 0xe8e8e0, [0.21, 0.05, 0.21], [0, 0.08 + body * 0.35, 0]),
  ];
}

function barrierShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const h = o.h;
  return [
    pc('box', c, [len, 0.08, 0.06], [0, h, 0]),
    pc('box', shade(c, 0.82), [0.07, h, 0.07], [-len * 0.4, h * 0.55, 0], [0, 0, -0.5]),
    pc('box', shade(c, 0.82), [0.07, h, 0.07], [len * 0.4, h * 0.55, 0], [0, 0, 0.5]),
    pc('box', DARK, [0.3, 0.06, 0.06], [-len * 0.4, 0.03, 0]),
    pc('box', DARK, [0.3, 0.06, 0.06], [len * 0.4, 0.03, 0]),
  ];
}

function signShapes(o) {
  const c = objectColor(o.color);
  const h = o.h;
  const w = o.w;
  return [
    pc('cyl', GREY, [0.05, h, 0.05], [0, h / 2, 0]),
    pc('box', shade(c, 0.85), [w, 0.55, 0.05], [0, h - 0.35, 0]),
    pc('box', c, [w * 0.9, 0.42, 0.02], [0, h - 0.35, 0.04]),
    pc('box', shade(c, 0.85), [w, 0.3, 0.05], [0, h - 1.25, 0]),
  ];
}

function palletShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const d = o.d;
  const h = o.h;
  const out = [];
  for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) {
    out.push(pc('box', c, [0.15, h * 0.2, d], [x * w, h * 0.82, 0]));
  }
  for (const z of [-d * 0.35, 0, d * 0.35]) {
    out.push(pc('box', shade(c, 0.82), [w * 0.85, h * 0.6, 0.1], [0, h * 0.45, z]));
  }
  for (const x of [-0.3, 0.3]) {
    out.push(pc('box', shade(c, 0.82), [0.15, h * 0.2, d * 0.6], [x * w, h * 0.12, 0]));
  }
  return out;
}

function barrelShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  const h = o.h;
  return [
    pc('cyl', c, [r, h, r], [0, h / 2, 0]),
    pc('cyl', shade(c, 0.82), [r * 1.04, 0.03, r * 1.04], [0, h * 0.3, 0]),
    pc('cyl', shade(c, 0.82), [r * 1.04, 0.03, r * 1.04], [0, h * 0.7, 0]),
    pc('cyl', GREY, [r * 1.07, 0.05, r * 1.07], [0, h - 0.02, 0]),
    pc('cyl', GREY, [r * 1.07, 0.05, r * 1.07], [0, 0.025, 0]),
  ];
}

function pipeShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const r = o.r;
  const up = [Math.PI / 2, 0, 0];
  return [
    pc('cyl', c, [r, len, r], [0, r, 0], up),
    pc('cyl', shade(c, 0.8), [r * 1.07, 0.06, r * 1.07], [0, r, len / 2], up),
    pc('cyl', shade(c, 0.8), [r * 1.07, 0.06, r * 1.07], [0, r, -len / 2], up),
  ];
}

function graffitiShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const h = o.h;
  return [
    pc('box', shade(c, 0.75), [w, h, 0.25], [0, h / 2, 0]),
    pc('box', c, [w * 0.5, h * 0.4, 0.02], [0, h * 0.62, 0.14]),
    pc('box', shade(c, 1.2), [w * 0.28, h * 0.26, 0.02], [w * 0.27, h * 0.34, 0.14]),
    pc('box', c, [w * 0.3, h * 0.18, 0.02], [-w * 0.28, h * 0.2, 0.14]),
  ];
}

function posterShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const h = o.h;
  return [
    pc('box', GREY, [0.05, h, 0.05], [-w / 2, h / 2, 0]),
    pc('box', GREY, [0.05, h, 0.05], [w / 2, h / 2, 0]),
    pc('box', shade(c, 0.7), [w, h * 0.7, 0.04], [0, h * 0.53, 0]),
    pc('box', c, [w * 0.9, h * 0.58, 0.02], [0, h * 0.53, 0.03]),
  ];
}

function bannerShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const h = o.h;
  const ph = 1.4 + h;
  return [
    pc('cyl', GREY, [0.04, ph, 0.04], [-w / 2, ph / 2, 0]),
    pc('cyl', GREY, [0.04, ph, 0.04], [w / 2, ph / 2, 0]),
    pc('box', c, [w * 0.92, h, 0.03], [0, 1.4 + h / 2, 0]),
    pc('box', shade(c, 0.85), [w * 0.22, h * 0.92, 0.02], [w * 0.4, 1.4 + h / 2, 0], [0, 0, 0.05]),
  ];
}

function carShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const w = o.w;
  const h = o.h;
  const wheel = (x, z) => pc('cyl', DARK, [0.24, 0.32, 0.32], [x, 0.32, z], [0, 0, Math.PI / 2]);
  return [
    pc('box', c, [w, h, len], [0, h / 2, 0]),
    pc('box', shade(c, 0.85), [w * 0.86, 0.5, len * 0.46], [0, h + 0.3, -len * 0.12]),
    pc('box', 0x3a4650, [w * 0.78, 0.34, len * 0.4], [0, h + 0.38, -len * 0.12]),
    pc('box', 0xfff1c4, [w * 0.36, 0.1, 0.02], [0, h * 0.72, len / 2 + 0.01]),
    wheel(w / 2, len * 0.3),
    wheel(-w / 2, len * 0.3),
    wheel(w / 2, -len * 0.3),
    wheel(-w / 2, -len * 0.3),
  ];
}

function bikeShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const wheel = (z) => pc('cyl', DARK, [0.05, 0.3, 0.3], [0, 0.3, z], [0, 0, Math.PI / 2]);
  return [
    wheel(len / 2),
    wheel(-len / 2),
    pc('cyl', c, [0.04, len * 0.8, 0.04], [0, 0.75, 0], [0, 0, -0.08]),
    pc('cyl', c, [0.035, len * 0.65, 0.035], [0, 0.72, 0.15], [0, 0, 0.55]),
    pc('box', c, [0.46, 0.03, 0.03], [0, 0.98, len / 2 - 0.12]),
    pc('cyl', c, [0.025, 0.3, 0.025], [0, 0.82, -len / 2 + 0.3]),
    pc('box', DARK, [0.07, 0.04, 0.24], [0, 1.0, -len / 2 + 0.32]),
  ];
}

function vanShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const w = o.w;
  const wheel = (x, z) => pc('cyl', DARK, [0.26, 0.34, 0.34], [x, 0.34, z], [0, 0, Math.PI / 2]);
  return [
    pc('box', c, [w, 1.9, len], [0, 1.05, 0]),
    pc('box', shade(c, 0.85), [w * 0.96, 0.4, len * 0.98], [0, 2.15, 0]),
    pc('box', 0x3a4650, [w * 0.88, 0.45, 0.02], [0, 1.6, -len / 2 + 0.01]),
    pc('box', 0x3a4650, [0.02, 0.45, len * 0.34], [w / 2 + 0.01, 1.6, len * 0.12]),
    pc('box', 0x3a4650, [0.02, 0.45, len * 0.34], [-w / 2 - 0.01, 1.6, len * 0.12]),
    pc('box', 0x6f7580, [w, 0.22, 0.06], [0, 0.3, len / 2 + 0.02]),
    pc('box', 0x6f7580, [w, 0.22, 0.06], [0, 0.3, -len / 2 - 0.02]),
    wheel(w / 2, len * 0.3),
    wheel(-w / 2, len * 0.3),
    wheel(w / 2, -len * 0.3),
    wheel(-w / 2, -len * 0.3),
  ];
}

function rackShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const h = o.h;
  const out = [
    pc('box', c, [0.05, h, 0.05], [-len / 2, h / 2, 0]),
    pc('box', c, [0.05, h, 0.05], [len / 2, h / 2, 0]),
    pc('box', c, [len, 0.05, 0.05], [0, h - 0.08, 0]),
    pc('box', c, [len, 0.05, 0.05], [0, 0.3, 0]),
  ];
  for (const [x, z, yaw] of [
    [-0.2, 0.1, 0.45],
    [0.12, -0.08, -0.4],
    [0.3, 0.15, 0.3],
  ]) {
    out.push(pc('box', 0xd6c064, [0.2, 0.02, 0.9], [x, 0.35, z], [0, 0, yaw]));
    out.push(pc('box', 0x4a4438, [0.05, 0.05, 0.05], [x, 0.37, z + 0.35], [0, 0, yaw]));
    out.push(pc('box', 0x4a4438, [0.05, 0.05, 0.05], [x, 0.37, z - 0.35], [0, 0, yaw]));
  }
  return out;
}

function manholeShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  return [
    pc('cyl', shade(c, 0.85), [r, 0.07, r], [0, 0.035, 0]),
    pc('cyl', c, [r * 0.88, 0.03, r * 0.88], [0, 0.08, 0]),
    pc('box', DARK, [r * 1.1, 0.02, 0.035], [0, 0.11, 0]),
    pc('box', DARK, [0.035, 0.02, r * 1.1], [0, 0.11, 0]),
  ];
}

function drainShapes(o) {
  const c = objectColor(o.color);
  const w = o.w;
  const d = o.d;
  const out = [pc('box', shade(c, 0.85), [w, 0.06, d], [0, 0.03, 0])];
  for (let i = 1; i <= 5; i++) {
    const x = -w / 2 + (w * i) / 6;
    out.push(pc('box', c, [0.07, 0.025, d * 0.86], [x, 0.07, 0]));
  }
  return out;
}

function puddleShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  return [
    pc('cyl', c, [r, 0.02, r], [0, 0.01, 0]),
    pc('cyl', shade(c, 1.25), [r * 0.68, 0.015, r * 0.68], [r * 0.1, 0.02, r * 0.08]),
  ];
}

function litterShapes(o) {
  const c = objectColor(o.color);
  const r = o.r;
  const out = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996;
    const rad = (0.2 + ((i * 7) % 10) / 10) * r;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad * 0.7;
    const w = 0.04 + ((i * 3) % 5) / 60;
    const col = i % 2 ? shade(c, 0.82) : shade(c, 1.18);
    out.push(pc('box', col, [w, 0.008, w + 0.025], [x, 0.004, z], [0, ((i * 37) % 360) * DEG, 0]));
  }
  return out;
}

function foodtruckShapes(o) {
  const c = objectColor(o.color);
  const len = o.len;
  const w = o.w;
  const wheel = (x, z) => pc('cyl', DARK, [0.26, 0.36, 0.36], [x, 0.36, z], [0, 0, Math.PI / 2]);
  return [
    pc('box', c, [w, 2.1, len], [0, 1.1, 0]),
    pc('box', shade(c, 0.82), [w * 1.06, 0.35, len * 1.03], [0, 2.3, 0]),
    pc('box', 0x3a4650, [w * 0.8, 0.7, 0.04], [0, 1.5, len / 2 + 0.01]),
    pc('box', shade(c, 0.9), [w * 0.92, 0.12, 0.16], [0, 1.06, len / 2 + 0.05]),
    pc('box', shade(c, 0.72), [w * 0.7, 0.42, 0.02], [0, 2.02, len / 2 + 0.02]),
    wheel(w / 2, len * 0.3),
    wheel(-w / 2, len * 0.3),
    wheel(w / 2, -len * 0.3),
    wheel(-w / 2, -len * 0.3),
  ];
}

function spectatorShapes(o) {
  const c = objectColor(o.color);
  return [
    pc('box', 0x2e3440, [0.12, 0.85, 0.12], [-0.1, 0.425, 0]),
    pc('box', 0x2e3440, [0.12, 0.85, 0.12], [0.1, 0.425, 0]),
    pc('box', c, [0.4, 0.55, 0.24], [0, 1.12, 0]),
    pc('box', shade(c, 0.85), [0.1, 0.5, 0.1], [-0.26, 1.12, 0]),
    pc('box', shade(c, 0.85), [0.1, 0.5, 0.1], [0.26, 1.12, 0]),
    pc('sphere', 0xe8c39a, [0.16, 0.18, 0.16], [0, 1.56, 0]),
    pc('cyl', shade(c, 0.7), [0.17, 0.09, 0.17], [0, 1.68, 0]),
  ];
}

/** A speed pad's paint: a flat coloured slab with a lighter inner panel, thin
 * enough to read as paint on the ground rather than a curb to ride over. */
function speedpadShapes(o) {
  const c = objectColor(o.color);
  return [
    pc('box', c, [o.w, 0.03, o.d], [0, 0.015, 0]),
    pc('box', shade(c, 1.22), [o.w * 0.82, 0.01, o.d * 0.82], [0, 0.028, 0]),
  ];
}

/**
 * The speed pad's shared builder: the same painted scenery every decor prop
 * gets, plus the pad's world rectangle handed to the Park as a boost zone the
 * ride model queries (park.padAt). The rect is the exact box the paint
 * occupies after the object's own transform, so what you ride matches what you
 * see; the pad sits at the object's elevation, so one raised onto a deck only
 * fires on that deck.
 */
function speedpadBuild(p, o) {
  p.decor(objectType(o.type).label, {
    pieces: shapesOf(o),
    x: o.x,
    y: o.y || 0,
    z: o.z,
    ry: (o.ry || 0) * DEG,
    sx: o.sx || 1,
    sz: o.sz || 1,
  });
  const r = decorWorldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
  p.speedpad({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y: o.y || 0 });
}

/** The axis-aligned world rectangle an object occupies after its transform,
 * straight from the palette entry's own footprint — the same bounds the
 * editor's selection outline draws and the spawn/patrol generators keep clear. */
export function boundsOf(o) {
  return objectType(o.type).footprint(o);
}

/** The object's on-the-ground size in metres, after its own transform scales.
 * Each type derives it from the same params its builder reads, so the number
 * a future AI sees is the shape it will actually have to skate. */
export function objectDimensions(o) {
  const t = objectType(o.type);
  if (t.category === 'decor' && typeof t.shapes === 'function') return decorDimensions(o);
  const sy = o.sy || 1;
  const sx = o.sx || 1;
  const sz = o.sz || 1;
  const hs = (v) => v * sy;
  switch (o.type) {
    case 'slab':
      return { width: o.w * sx, depth: o.d * sz, height: hs(o.h) };
    case 'bank':
      return { width: o.w * sx, depth: o.len * sz, height: hs(o.h) };
    case 'quarter': {
      const H = Math.min(hs(o.H), o.R - 0.05);
      return { width: o.w * sx, depth: (quarterU(o.R, H) + o.deck) * sz, height: H };
    }
    case 'mini':
    case 'vert': {
      const H = Math.min(hs(o.H), o.R - 0.05);
      const run = o.flat + 2 * (quarterU(o.R, H) + o.deck);
      return { width: o.w * sx, depth: run * sz, height: H };
    }
    case 'rollin': {
      const H = Math.min(hs(o.H), o.R - 0.05);
      return { width: o.w * sx, depth: (quarterU(o.R, H) + o.deck) * sz, height: H };
    }
    case 'spine': {
      const H = Math.min(hs(o.H), o.R - 0.05);
      return { width: o.w * sx, depth: (o.gap + 2 * quarterU(o.R, H)) * sz, height: H };
    }
    case 'bowl': {
      const H = Math.min(hs(o.H), o.R - 0.05);
      const r = (quarterU(o.R, H) + o.rim) * sx;
      const rz = (quarterU(o.R, H) + o.rim) * sz;
      return { width: r * 2, depth: rz * 2, height: H };
    }
    case 'stairs':
      return { width: o.w * sx, depth: o.steps * o.run * sz, height: o.steps * hs(o.rise) };
    case 'rail':
      return { width: o.len * sx, depth: o.r * 2, height: hs(o.h) + o.r };
    case 'ledge':
      return { width: o.len * sx, depth: o.w * sz, height: hs(o.h) };
    case 'hoop':
      return { width: o.r * 2, depth: o.r * 2, height: o.r * 2 };
    case 'bench':
      return { width: o.len * sx, depth: 0.6, height: 0.7 };
    case 'planter':
      return { width: o.w * sx, depth: o.d * sz, height: 0.65 };
    case 'funbox':
      return { width: o.w * sx, depth: o.d * sz, height: hs(o.h) };
    default:
      return { width: 0, depth: 0, height: 0 };
  }
}

/**
 * Everything a consumer (the park graph, a future AI, the editor's inspector)
 * needs to know about a placed object: its kind, how hard it is, whether and
 * how it grinds, its tags, its real dimensions, and its full transform. The
 * type's static `meta` is merged with the object's own placed state, so the
 * metadata always reflects what is actually in the park — a rail raised to
 * 2 m still reads as a rail, but a small one in the file still reads as a
 * small one.
 */
export function objectMeta(o) {
  const t = objectType(o.type);
  const m = t.meta || {};
  return {
    type: t.id,
    label: t.label,
    kind: m.kind || 'flat',
    grindable: m.grindable === undefined ? false : m.grindable,
    difficulty: Number.isFinite(m.difficulty) ? m.difficulty : 1,
    tags: Array.isArray(m.tags) ? m.tags : [],
    dimensions: objectDimensions(o),
    transform: {
      position: { x: o.x || 0, y: o.y || 0, z: o.z || 0 },
      rotation: { ry: o.ry || 0 },
      scale: { x: o.sx || 1, y: o.sy || 1, z: o.sz || 1 },
    },
  };
}

/** A fresh, fully-defaulted object of a type, ready to place. `y` is the
 * object's elevation above the pad — the vertical axis the editor exposes —
 * so a park can stack decks and raise ramps, exactly like the built-in maps. */
export function newObject(type) {
  const t = objectType(type);
  return { id: uid(), type: t.id, x: 0, y: 0, z: 0, ry: 0, sx: 1, sy: 1, sz: 1, ...t.defaults };
}

let _uid = 0;
function uid() {
  return `o${Date.now().toString(36)}${(_uid++).toString(36)}`;
}

/** Paint every object in a file onto a Park. Order matters only where two
 * surfaces overlap at the same height, which the height field resolves by
 * keeping the tallest — so drawing objects in file order is fine. */
export function buildObjects(p, objects) {
  for (const o of objects) {
    const clean = { ...newObject(o.type), ...o };
    if (!Number.isFinite(clean.y)) clean.y = 0;
    objectType(o.type).build(p, clean);
  }
}

/** Whether a point on the pad is clear of every object, for spawning and for
 * the AI patrol loop — a bot dropped inside a funbox has nowhere to go. */
export function clearAt(objects, x, z) {
  for (const o of objects) {
    const r = objectType(o.type).footprint(o);
    if (x >= r.x0 - 0.3 && x <= r.x1 + 0.3 && z >= r.z0 - 0.3 && z <= r.z1 + 0.3) return false;
  }
  return true;
}

// --- preview meshes -------------------------------------------------------

function mat(color) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.95,
    metalness: 0,
  });
}

function box(w, h, d, x, y, z, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  return mesh;
}

/** A galvanised coping bar for a preview: a slim slab laid along local x at
 * the lip, mirroring the real park's chunkier coping — and its sunk depth —
 * so what the editor shows is what a built park actually wears. */
function previewCoping(g, width, h, z, color) {
  g.add(box(width, 0.09, 0.09, 0, h - 0.012, z, color));
}

function quarterU(R, H) {
  return Math.sqrt(Math.max(0, 2 * R * H - H * H));
}

/**
 * The ramp's extruded profile. `pts` are (u, height) pairs with u from 0 at
 * the base; `len` is the profile's total run. The profile is extruded across
 * `width`, then laid down so u runs along +z and the base line sits at z=0
 * (or at `zOff` when the object's own frame asks — a funbox's side quarters,
 * for instance). `flip` mirrors the profile so u=0 lands at +z instead of -z.
 */
function prism(pts, len, width, zOff = 0, color, flip = false) {
  const mesh = new THREE.Mesh(prismGeo(pts, len, width, zOff, flip), mat(color));
  return mesh;
}

function prismGeo(pts, len, width, zOff = 0, flip = false) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  // The extrude ran along +Z; turn it so the profile's u follows +z and the
  // extrusion follows local x. `flip` mirrors it so u=0 lands at +z instead.
  // The extrusion is then centred on the frame's origin — width runs from
  // -width/2 to +width/2 — so the preview lines up with the object's own
  // axis-aligned footprint (what you see is what you ride).
  geo.rotateY(flip ? Math.PI / 2 : -Math.PI / 2);
  geo.translate(flip ? -width / 2 : width / 2, 0, zOff);
  return geo;
}

/** The quarterpipe profile used by both the object's own preview and a
 * funbox's four faces — shared so the two always agree with each other. */
function quarterGeo(width, R, H, deck) {
  const uTop = quarterU(R, H);
  const pts = [[0, -0.6]];
  const STEPS = 18;
  for (let i = 0; i <= STEPS; i++) {
    const u = (uTop * i) / STEPS;
    pts.push([u, R - Math.sqrt(Math.max(0, R * R - u * u))]);
  }
  if (deck > 0) pts.push([uTop + deck, H]);
  pts.push([uTop + deck, -0.6]);
  return prismGeo(pts, uTop + deck, width, 0);
}

/** A coping along an axis-aligned world line between two [x, z] endpoints. */
function lineCoping(p, a, b, h) {
  if (Math.abs(a[0] - b[0]) < 1e-6) {
    p.copingZ(a[0], h, Math.min(a[1], b[1]), Math.max(a[1], b[1]));
  } else {
    p.coping(Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[1], h);
  }
}

// --- launch features -------------------------------------------------------
// The A-Frame (a deck with a bank up one side and a bank down the other) and
// the pyramid (banks on all four sides) are the same idea at two strengths —
// a flat top with straight ramps climbing up to it, so they share a builder
// and a preview.

/** Paint a launch deck: a flat slab with straight banks climbing up to it —
 * two along the object's forward axis, and when `all` is set, one on each
 * side too (an A-Frame's sides are walls, a pyramid's are ramps). Each bank
 * meets the deck exactly at its edge, so a ride up pops you straight onto
 * the top, and the deck slab sits at the same height the banks rise to. */
function launchDeck(p, o, all) {
  const h = sh(o, o.h);
  const len = o.len;
  const color = objectColor(o.color);
  const axis = forwardAxis(o);
  const cross = axis === 'z' ? 'x' : 'z';
  const run = (a) => (a === 'z' ? (pt) => pt[1] : (pt) => pt[0]);
  // A bank between two world points, rising from y0 at the foot to y1 at the
  // lip. `a` is the axis the run follows — the forward axis for the up/down
  // banks, the cross axis for a pyramid's sides — `c0..c1` the span across.
  const bank = (a, foot, lip, y0, y1, c0, c1) => {
    const ra = run(a);
    const f = ra(foot);
    const l = ra(lip);
    const lo = Math.min(f, l);
    const hi = Math.max(f, l);
    const yLo = f < l ? y0 : y1;
    const yHi = f < l ? y1 : y0;
    p.add(
      new Bank(
        a === 'z' ? c0 : lo,
        a === 'z' ? c1 : hi,
        a === 'z' ? lo : c0,
        a === 'z' ? hi : c1,
        a,
        yLo,
        yHi,
        color
      )
    );
  };
  const deck = worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
  p.add(new Slab(deck.x0, deck.x1, deck.z0, deck.z1, h + o.y, SMOOTH, color, slabDepth(h)));
  const fwdCross = worldRect(o, -o.w / 2, o.w / 2, 0, 0);
  const fC0 = axis === 'z' ? fwdCross.x0 : fwdCross.z0;
  const fC1 = axis === 'z' ? fwdCross.x1 : fwdCross.z1;
  bank(axis, worldPoint(o, 0, o.d / 2 + len), worldPoint(o, 0, o.d / 2), o.y, h + o.y, fC0, fC1);
  bank(axis, worldPoint(o, 0, -(o.d / 2 + len)), worldPoint(o, 0, -o.d / 2), o.y, h + o.y, fC0, fC1);
  if (all) {
    const sideCross = worldRect(o, 0, 0, -(o.d / 2 + len), o.d / 2 + len);
    // The side banks run along the cross axis, so their span across is the
    // whole base depth — not the deck's, which is why the corners fill in.
    const sC0 = axis === 'z' ? sideCross.z0 : sideCross.x0;
    const sC1 = axis === 'z' ? sideCross.z1 : sideCross.x1;
    bank(cross, worldPoint(o, o.w / 2 + len, 0), worldPoint(o, o.w / 2, 0), o.y, h + o.y, sC0, sC1);
    bank(cross, worldPoint(o, -(o.w / 2 + len), 0), worldPoint(o, -o.w / 2, 0), o.y, h + o.y, sC0, sC1);
  }
}

/** The launch deck's shared preview: a box deck with bank prisms on two or
 * four sides, each meeting the deck exactly at its edge. */
function launchPreview(o, all) {
  const h = sh(o, o.h);
  const len = o.len;
  const color = objectColor(o.color);
  const g = new THREE.Group();
  const depth = slabDepth(h);
  g.add(box(o.w, depth, o.d, 0, h - depth / 2, 0, color));
  const pts = [
    [0, -0.6],
    [len, -0.6],
    [len, h],
    [0, 0],
  ];
  // The banks' feet sit at the object's ends, len beyond the deck's edges.
  const fwd = prism(pts, len, o.w, -(o.d / 2 + len), color, false);
  const back = prism(pts, len, o.w, o.d / 2 + len, color, true);
  g.add(fwd);
  g.add(back);
  if (all) {
    // Side banks run along x instead of z, and span the whole base depth —
    // the forward banks only cover the deck's width, so the two meet out at
    // the feet with the corners filled in. Rotating a z-run prism a quarter
    // turn is exactly the trick the funbox preview uses for its side faces.
    const right = prism(pts, len, o.d + 2 * len, o.w / 2 + len, color, true);
    right.rotation.y = Math.PI / 2;
    const left = prism(pts, len, o.d + 2 * len, -(o.w / 2 + len), color, false);
    left.rotation.y = Math.PI / 2;
    g.add(right);
    g.add(left);
  }
  return g;
}

// --- the ramp family -------------------------------------------------------
// The mini ramp and the vert ramp are the same object at different sizes — two
// quarterpipes facing each other over a flat bottom, each with a deck behind
// its lip — so they share one builder, one footprint and one preview.

/** Paint a half-pipe onto the park. The floor between the two transitions only
 * needs its own slab when the object is raised off the pad; at ground level the
 * pad itself is the floor, and it sits at exactly the transitions' base height
 * either way, so the join reads as a curve, not a kink. */
function halfPipe(p, o) {
  const H = Math.min(sh(o, o.H), o.R - 0.05);
  const uTop = quarterU(o.R, H);
  const half = o.flat / 2;
  const color = objectColor(o.color);
  const f = frame(o);
  const axis = forwardAxis(o);
  const dir = axis === 'z' ? f.fz : f.fx;
  const signN = dir > 0 ? 1 : -1;
  const cross = worldRect(o, -o.w / 2, o.w / 2, half, half);
  const c0 = axis === 'z' ? cross.x0 : cross.z0;
  const c1 = axis === 'z' ? cross.x1 : cross.z1;
  if (o.y > 0.001) {
    const flat = worldRect(o, -o.w / 2, o.w / 2, -half, half);
    p.add(new Slab(flat.x0, flat.x1, flat.z0, flat.z1, o.y, SMOOTH, color, 0.55));
  }
  p.add(new Quarter(c0, c1, axis === 'z' ? worldPoint(o, 0, half)[1] : worldPoint(o, 0, half)[0], axis, signN, o.R, H, 0, color, o.y));
  p.add(new Quarter(c0, c1, axis === 'z' ? worldPoint(o, 0, -half)[1] : worldPoint(o, 0, -half)[0], axis, -signN, o.R, H, 0, color, o.y));
  if (o.deck > 0) {
    const dN = worldRect(o, -o.w / 2, o.w / 2, half + uTop, half + uTop + o.deck);
    p.add(new Slab(dN.x0, dN.x1, dN.z0, dN.z1, H + o.y, SMOOTH, color, slabDepth(H)));
    const dS = worldRect(o, -o.w / 2, o.w / 2, -half - uTop - o.deck, -half - uTop);
    p.add(new Slab(dS.x0, dS.x1, dS.z0, dS.z1, H + o.y, SMOOTH, color, slabDepth(H)));
  }
  lineCoping(p, worldPoint(o, -o.w / 2, half + uTop), worldPoint(o, o.w / 2, half + uTop), H + o.y);
  lineCoping(p, worldPoint(o, -o.w / 2, -half - uTop), worldPoint(o, o.w / 2, -half - uTop), H + o.y);
}

function halfPipeBounds(o) {
  const H = Math.min(sh(o, o.H), o.R - 0.05);
  const half = o.flat / 2 + quarterU(o.R, H) + o.deck;
  return worldRect(o, -o.w / 2, o.w / 2, -half, half);
}

function halfPipePreview(o) {
  const H = Math.min(sh(o, o.H), o.R - 0.05);
  const uTop = quarterU(o.R, H);
  const color = objectColor(o.color);
  const g = new THREE.Group();
  g.add(box(o.w, 0.55, o.flat, 0, -0.275, 0, color));
  const n = quarterGeo(o.w, o.R, H, 0);
  n.translate(0, 0, o.flat / 2);
  g.add(new THREE.Mesh(n, mat(color)));
  const s = quarterGeo(o.w, o.R, H, 0);
  s.rotateY(Math.PI);
  s.translate(0, 0, -o.flat / 2);
  g.add(new THREE.Mesh(s, mat(color)));
  previewCoping(g, o.w, H, o.flat / 2 + uTop, COPING);
  previewCoping(g, o.w, H, -o.flat / 2 - uTop, COPING);
  if (o.deck > 0) {
    const depth = slabDepth(H);
    g.add(box(o.w, depth, o.deck, 0, H - depth / 2, o.flat / 2 + uTop, color));
    g.add(box(o.w, depth, o.deck, 0, H - depth / 2, -o.flat / 2 - uTop, color));
  }
  return g;
}

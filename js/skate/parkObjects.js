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
import { Slab, Bank, Quarter, Stairs, Bowl, bowlU, bowlProfile, SMOOTH, CONCRETE, CONCRETE_DARK, RAMP, STEEL, PAINT, DIRT } from './park.js';

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
      return new THREE.Mesh(quarterGeo(o.w, o.R, H, o.deck), mat(objectColor(o.color)));
    },
  },

  {
    id: 'mini',
    label: 'Mini Ramp',
    hint: 'A half-pipe: two quarterpipes facing off over a flat, coping on both lips.',
    defaults: { w: 4, R: 1.8, H: 1.25, flat: 4, deck: 1.2, color: 'wood' },
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
      return g;
    },
  },

  {
    id: 'vert',
    label: 'Vert Ramp',
    hint: 'A big half-pipe with near-vertical walls — the classic big-air ramp.',
    defaults: { w: 6, R: 3.5, H: 3.0, flat: 5, deck: 2.5, color: 'wood' },
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
      const pts = bowlProfile(o.R, H, o.rim).map(([u, y]) => new THREE.Vector2(u, y));
      return new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat(objectColor(o.color)));
    },
  },

  {
    id: 'stairs',
    label: 'Stairs',
    hint: 'Steps up to a deck. The tall end meets whatever you place behind it.',
    defaults: { w: 3, steps: 4, rise: 0.18, run: 0.28, color: 'dark' },
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
    defaults: { r: 1.6, tube: 0.12, color: '#e0552f' },
    props: [
      { key: 'r', label: 'Radius', min: 0.8, max: 5, step: 0.1, unit: 'm' },
      { key: 'tube', label: 'Tube', min: 0.05, max: 0.4, step: 0.01, unit: 'm' },
    ],
    build(p, o) {
      p.hoop(o.x, o.y, o.z, o.r, o.tube, o.ry || 0);
    },
    footprint() {
      return { x0: 0, x1: 0, z0: 0, z1: 0 };
    },
    preview(o) {
      return new THREE.Mesh(new THREE.TorusGeometry(o.r, o.tube, 10, 28), mat(objectColor(o.color)));
    },
  },

  {
    id: 'bench',
    label: 'Bench',
    hint: 'A park bench for spectators — decorative, no collision or grind.',
    defaults: { len: 2.4, color: 'steel' },
    props: [
      { key: 'len', label: 'Length', min: 0.8, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      p.bench(o.x, o.y, o.z, o.len * o.sz, o.ry * DEG, objectColor(o.color));
    },
    footprint(o) {
      return worldRect(o, -0.45, 0.45, -o.len / 2, o.len / 2);
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
    defaults: { w: 1.6, d: 1.6, color: 'concrete' },
    props: [
      { key: 'w', label: 'Width', min: 0.6, max: 6, step: 0.1, unit: 'm' },
      { key: 'd', label: 'Depth', min: 0.6, max: 6, step: 0.1, unit: 'm' },
    ],
    build(p, o) {
      p.planter(o.x, o.y, o.z, o.w * o.sx, o.d * o.sz, o.ry * DEG, objectColor(o.color));
    },
    footprint(o) {
      return worldRect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2);
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
];

export function objectType(id) {
  return OBJECTS.find((t) => t.id === id) || OBJECTS[0];
}

/** The axis-aligned world rectangle an object occupies after its transform,
 * straight from the palette entry's own footprint — the same bounds the
 * editor's selection outline draws and the spawn/patrol generators keep clear. */
export function boundsOf(o) {
  return objectType(o.type).footprint(o);
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
  if (o.deck > 0) {
    const depth = slabDepth(H);
    g.add(box(o.w, depth, o.deck, 0, H - depth / 2, o.flat / 2 + uTop, color));
    g.add(box(o.w, depth, o.deck, 0, H - depth / 2, -o.flat / 2 - uTop, color));
  }
  return g;
}

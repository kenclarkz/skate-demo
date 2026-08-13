// The skatepark: its geometry, and the surface query the physics rides on.
//
// Every obstacle is defined once, as a spec object, and each spec knows how to
// do two things: answer "how high is the ground at (x, z), and which way is it
// facing", and hand back merge entries for its mesh. That pairing is the whole
// design. A park drawn by one piece of code and collided against by another is a
// park where the transition you can see is not the transition you are riding,
// and there is no way to tune your way out of that.
//
// The surface query is a height field: the highest feature at (x, z) wins.
// Which means the sides of anything raised are not surfaces at all — they are a
// discontinuity, and physics.js reads a step up it cannot roll over as a wall to
// hit. That is exactly how a curb behaves.
//
// The built-in park defs live in parkLayouts.js: one spec object per map.
// Every map shares the same pad, fence and dirt — only the obstacles inside
// `build()` change — which is what lets one small file describe every park.

import * as THREE from '../game/three.js';
import { box, piece, merge } from '../game/geo.js';

// --- palette --------------------------------------------------------------
export const CONCRETE = 0xb4afa2;
export const CONCRETE_DARK = 0x9a9587;
export const RAMP = 0x8c8578;      // skatelite: darker and smoother than the flat
export const COPING = 0xc2c6cc;    // galvanised steel, polished by decades of grinds
export const STEEL = 0x9fa5ad;
export const PAINT = 0xd6c064;
export const DIRT = 0x7d6c50;
export const CURB = 0xc6c1b2;
export const HOOP = 0xe0552f;      // a landmark colour on purpose — it's meant to be seen from across the map

// Surface kinds, so physics can tell paved from dirt and flat from transition.
export const SMOOTH = 0;
export const ROUGH = 1;
export const TRANSITION = 2;

/**
 * The ground's own grain, drawn once into a canvas and shared by every park —
 * a speckle of light and dark over a near-white base, plus the faint saw-cut
 * joints a real concrete pour is scored into. It rides on top of the vertex
 * colours already telling paint from panel from steel apart (the texture is
 * multiplied against them), so it reads as wear on a surface rather than
 * recolouring it. Built pale on purpose: a texture with its own strong colour
 * would fight the CONCRETE/RAMP/PAINT palette above instead of just texturing
 * it.
 */
let _groundTexture = null;
export function groundTexture() {
  if (_groundTexture) return _groundTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f1efe7';
  g.fillRect(0, 0, 256, 256);
  let a = 0x9e3779;
  const rng = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 5000; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    const v = rng();
    const shade = v > 0.5 ? 20 : 250;
    g.fillStyle = `rgba(${shade},${shade},${shade},${0.03 + rng() * 0.06})`;
    g.fillRect(x, y, 1.3, 1.3);
  }
  g.strokeStyle = 'rgba(50,46,38,0.14)';
  g.lineWidth = 2;
  for (const p of [0, 85, 171, 256]) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(256, p);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _groundTexture = t;
  return t;
}

/** A base colour, jittered a little in hue and lightness — one call per tree
 * or clump of foliage is what stops a whole treeline reading as one colour
 * repeated forty times. */
function jitter(base, rng, hueRange = 0.03, lightRange = 0.1) {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    hsl.h + (rng() - 0.5) * hueRange,
    hsl.s,
    Math.max(0, Math.min(1, hsl.l + (rng() - 0.5) * lightRange))
  );
  return c.getHex();
}

// --- park extent ------------------------------------------------------------
// Every map shares this footprint. Six differently-shaped parks on six
// differently-sized pads would each need their own fence, camera bounds and
// AI patrol logic; one shared size means only the obstacles inside it differ.
//
// TRACK_SCALE stretches every map's own footprint out horizontally: twice the
// ground between features, twice the length of every rail, twice the run of
// every bank and stair. Heights (y, R, H, rise) are deliberately left alone —
// doubling those too would double the difficulty of every transition along
// with its size, and a wall that used to be poppable would stop being one.
// Left as a genuinely gentler slope instead: a Bank's rise is unchanged but
// its run is now twice as long, so it eases into the flat rather than
// kinking into it.
//
// Every `build(p)` below is still written in the original, un-scaled
// coordinates it was designed at — TRACK_SCALE is applied once, generically,
// after a map finishes building itself (see Park.layout()), so a park's own
// authoring never has to think about it.
export const TRACK_SCALE = 2;
export const PARK_X = 26;
export const PARK_Z = 30;

// Default edge length (metres) of a zone in the park's spatial grid. A map
// can override it with `def.zoneSize`; the grid itself just needs to stay
// coarse enough that a feature straddles few cells and fine enough that a
// sample point looks up few features.
export const ZONE_SIZE = 16;

// The dirt sits a couple of centimetres below the concrete pad. Not decoration:
// sample() resolves ties by keeping the first feature it saw, so two surfaces at
// exactly y = 0 would leave the whole park reading as dirt.
const DIRT_Y = -0.02;

// --- feature types --------------------------------------------------------
// Each has at(x, z, out) -> boolean, filling `out` only on a hit, and
// build(entries) pushing its merge entries.

export class Slab {
  /** A flat top: the ground, a platform deck, a ledge, a manual pad. */
  constructor(x0, x1, z0, z1, y, kind = SMOOTH, color = CONCRETE, depth = 0.4) {
    Object.assign(this, { x0, x1, z0, z1, y, kind, color, depth });
  }

  at(x, z, out) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return false;
    out.y = this.y;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.kind = this.kind;
    return true;
  }

  build(entries) {
    entries.push(
      box(
        this.color,
        this.x1 - this.x0,
        this.depth,
        this.z1 - this.z0,
        (this.x0 + this.x1) / 2,
        this.y - this.depth / 2,
        (this.z0 + this.z1) / 2
      )
    );
  }

  /** Stretch the flat top out horizontally. Nothing here is derived from
   * x0/x1/z0/z1, so there is nothing else to recompute. */
  scaleXZ(s) {
    this.x0 *= s;
    this.x1 *= s;
    this.z0 *= s;
    this.z1 *= s;
  }

  /** The axis-aligned rectangle this feature can ever report a hit in — a
   * conservative superset of `at()`'s coverage, so the zone grid can bucket
   * it without ever missing a sample. */
  bounds() {
    return { x0: this.x0, x1: this.x1, z0: this.z0, z1: this.z1 };
  }
}

/**
 * A straight ramp. `axis` is the one the slope runs along; the surface rises
 * linearly from y0 at the low end of that axis to y1 at the high end.
 */
export class Bank {
  constructor(x0, x1, z0, z1, axis, y0, y1, color = RAMP) {
    Object.assign(this, { x0, x1, z0, z1, axis, y0, y1, color });
    this.len = axis === 'x' ? x1 - x0 : z1 - z0;
    // Precomputed: it is the normal for every point on the ramp.
    const dy = (y1 - y0) / this.len;
    const inv = 1 / Math.hypot(dy, 1);
    this.slopeN = -dy * inv;
    this.upN = inv;
  }

  at(x, z, out) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return false;
    const t = this.axis === 'x' ? (x - this.x0) / this.len : (z - this.z0) / this.len;
    out.y = this.y0 + t * (this.y1 - this.y0);
    out.nx = this.axis === 'x' ? this.slopeN : 0;
    out.nz = this.axis === 'z' ? this.slopeN : 0;
    out.ny = this.upN;
    out.kind = SMOOTH;
    return true;
  }

  build(entries) {
    // The skirt below zero keeps the ramp looking solid where it meets ground.
    profile(
      entries,
      [[0, -0.6], [this.len, -0.6], [this.len, this.y1], [0, this.y0]],
      this.axis,
      this.axis === 'x' ? this.x0 : this.z0,
      1,
      this.axis === 'x' ? this.z0 : this.x0,
      this.axis === 'x' ? this.z1 : this.x1,
      this.color
    );
  }

  /** Stretching the run without touching y0/y1 is what makes the ramp
   * genuinely gentler, not just longer — len and the slope it feeds both
   * have to be worked out fresh from the new endpoints. */
  scaleXZ(s) {
    this.x0 *= s;
    this.x1 *= s;
    this.z0 *= s;
    this.z1 *= s;
    this.len = this.axis === 'x' ? this.x1 - this.x0 : this.z1 - this.z0;
    const dy = (this.y1 - this.y0) / this.len;
    const inv = 1 / Math.hypot(dy, 1);
    this.slopeN = -dy * inv;
    this.upN = inv;
  }

  bounds() {
    return { x0: this.x0, x1: this.x1, z0: this.z0, z1: this.z1 };
  }
}

/**
 * A quarterpipe. The transition is a circular arc tangent to the flat at its
 * base, which is what makes a real one rideable: the curve has to start at zero
 * slope, or the bottom of the ramp would be a kink that stops you dead.
 *
 * With the arc's centre directly above the base point, the surface is
 * y = R - sqrt(R² - u²) for u measured from the base into the ramp — vertical at
 * u = R, so H is kept a good way under R to stop the lip going past anything a
 * skater would actually ride up.
 */
export class Quarter {
  constructor(c0, c1, base, axis, sign, R, H, deck = 0, color = RAMP, baseY = 0) {
    Object.assign(this, { c0, c1, base, axis, sign, R, H, deck, color, baseY });
    // Where the arc reaches deck height, from y = R - sqrt(R² - u²).
    this.uTop = Math.sqrt(Math.max(0, 2 * R * H - H * H));
    // Cross extent, named as x0/x1 or z0/z1 depending on which way it runs.
    if (axis === 'z') {
      this.x0 = c0;
      this.x1 = c1;
    } else {
      this.z0 = c0;
      this.z1 = c1;
    }
  }

  at(x, z, out) {
    const c = this.axis === 'z' ? x : z;
    if (c < this.c0 || c > this.c1) return false;
    const u = this.sign * ((this.axis === 'z' ? z : x) - this.base);
    if (u < 0 || u > this.uTop) return false;
    const root = Math.sqrt(Math.max(1e-6, this.R * this.R - u * u));
    out.y = this.baseY + this.R - root;
    // The normal points from the surface back towards the arc's centre, so it
    // rolls from straight up at the base to nearly horizontal at the lip.
    const nu = (-u / this.R) * this.sign;
    out.nx = this.axis === 'x' ? nu : 0;
    out.nz = this.axis === 'z' ? nu : 0;
    out.ny = root / this.R;
    out.kind = TRANSITION;
    return true;
  }

  build(entries) {
    const p = [[0, -0.6]];
    const STEPS = 18;
    for (let i = 0; i <= STEPS; i++) {
      const u = (this.uTop * i) / STEPS;
      p.push([u, this.baseY + this.R - Math.sqrt(Math.max(0, this.R * this.R - u * u))]);
    }
    // `deck` extends the top as a platform. Kickers set it to zero, so the lip
    // is a clean edge with nothing behind it to walk on that the height field
    // does not know about.
    if (this.deck > 0) p.push([this.uTop + this.deck, this.baseY + this.H]);
    p.push([this.uTop + this.deck, -0.6]);
    profile(entries, p, this.axis, this.base, this.sign, this.c0, this.c1, this.color);
  }

  /** The arc itself (R, H, and the uTop it produces) is a real physical
   * curve and stays put — only where it sits, how wide it is, and how far
   * the flat deck behind its lip runs are stretched. */
  scaleXZ(s) {
    this.c0 *= s;
    this.c1 *= s;
    this.base *= s;
    this.deck *= s;
    if (this.axis === 'z') {
      this.x0 *= s;
      this.x1 *= s;
    } else {
      this.z0 *= s;
      this.z1 *= s;
    }
  }

  /** `at()` only covers the arc itself (a Quarter's deck is a Slab of its
   * own, laid by the object that builds it), so bounds run the cross extent
   * by the arc's reach along `base → base + sign·uTop`. */
  bounds() {
    const along0 = Math.min(this.base, this.base + this.sign * this.uTop);
    const along1 = Math.max(this.base, this.base + this.sign * this.uTop);
    return this.axis === 'z'
      ? { x0: this.x0, x1: this.x1, z0: along0, z1: along1 }
      : { x0: along0, x1: along1, z0: this.z0, z1: this.z1 };
  }
}

/** The lip radius of a bowl whose transition arc is R and whose lip is H up
 * the arc — the bowl analogue of a Quarter's uTop. */
export function bowlU(R, H) {
  return Math.sqrt(Math.max(0, 2 * R * H - H * H));
}

/** The (radius, height) profile a bowl is a surface of revolution of: the flat
 * centre, the quarterpipe arc out to the lip, the flat rim deck beyond it, then
 * down the outside skirt to a closed base. Shared by the real mesh (Bowl.build)
 * and the editor preview (parkObjects.js) so the two can never disagree. */
export function bowlProfile(R, H, rim, baseY = 0) {
  const uTop = bowlU(R, H);
  const pts = [
    [0, -0.6],
    [0, baseY],
  ];
  const STEPS = 18;
  for (let i = 0; i <= STEPS; i++) {
    const u = (uTop * i) / STEPS;
    pts.push([u, baseY + R - Math.sqrt(Math.max(0, R * R - u * u))]);
  }
  pts.push([uTop, baseY + H], [uTop + rim, baseY + H], [uTop + rim, -0.6], [0, -0.6]);
  // Returned in reverse: LatheGeometry's front face is the side its winding
  // faces, and the natural out-across-the-deck order winds the outside of the
  // solid — pool, deck and skirt all end up back-facing and invisible. Reversed,
  // the pool's concave face, the deck top and the outer skirt are the front
  // faces, which is the only way the camera sees the bowl at all.
  return pts.reverse();
}

/**
 * A bowl: a quarterpipe's transition made into a surface of revolution, so
 * every wall of a round pool climbs out of a shared flat floor. The centre is
 * flat (the arc is tangent to it, exactly as a Quarter is to the flat), the
 * surface rises as y = R - sqrt(R² - u²) with u the radius, and past the lip a
 * flat rim deck carries on at height H — the rim a skater drops in from, the
 * same job the deck behind a quarterpipe's lip does. sx/sz are the object's own
 * horizontal scale, so a non-uniform scale makes a genuinely elliptical bowl
 * whose collision is still the same surface the mesh shows.
 */
export class Bowl {
  constructor(cx, cz, sx, sz, R, H, rim, color = RAMP, baseY = 0) {
    Object.assign(this, { cx, cz, sx, sz, R, H, rim, color, baseY });
    this.uTop = bowlU(R, H);
  }

  at(x, z, out) {
    const p = x - this.cx;
    const q = z - this.cz;
    const u = Math.hypot(p / this.sx, q / this.sz);
    if (u <= this.uTop) {
      const root = Math.sqrt(Math.max(1e-6, this.R * this.R - u * u));
      out.y = this.baseY + this.R - root;
      // The normal is the surface gradient (-∂y/∂x, 1, -∂y/∂z) normalised. At
      // unit scale it collapses to the same (-u/R, root/R, ...) a Quarter gives.
      const dx = p / (this.sx * this.sx * root);
      const dz = q / (this.sz * this.sz * root);
      const inv = 1 / Math.hypot(dx, 1, dz);
      out.nx = -dx * inv;
      out.ny = inv;
      out.nz = -dz * inv;
      out.kind = TRANSITION;
      return true;
    }
    if (u <= this.uTop + this.rim) {
      out.y = this.baseY + this.H;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.kind = SMOOTH;
      return true;
    }
    return false;
  }

  build(entries) {
    const pts = bowlProfile(this.R, this.H, this.rim, this.baseY).map(([u, y]) => new THREE.Vector2(u, y));
    const geo = new THREE.LatheGeometry(pts, 32);
    entries.push(piece(geo, this.color, this.sx, 1, this.sz, this.cx, 0, this.cz));
  }

  /** The arc (R, H and the uTop it produces) is a real physical curve and
   * stays put; only where the bowl sits and how wide the rim deck runs are
   * stretched, exactly as a Quarter's deck is. */
  scaleXZ(s) {
    this.cx *= s;
    this.cz *= s;
    this.rim *= s;
  }

  /** The elliptical footprint of pool plus rim deck: the collision radius
   * (uTop + rim) stretched by each of the object's own horizontal scales. */
  bounds() {
    const r = (this.uTop + this.rim) * this.sx;
    const rz = (this.uTop + this.rim) * this.sz;
    return { x0: this.cx - r, x1: this.cx + r, z0: this.cz - rz, z1: this.cz + rz };
  }
}

/** A stair set. Riding it is a bail; the handrail beside it is the point. */
export class Stairs {
  constructor(c0, c1, top, axis, sign, steps, rise, run, baseY = 0, color = CONCRETE_DARK) {
    Object.assign(this, { c0, c1, top, axis, sign, steps, rise, run, baseY, color });
    this.yTop = steps * rise;
    this.len = steps * run;
  }

  at(x, z, out) {
    const c = this.axis === 'z' ? x : z;
    if (c < this.c0 || c > this.c1) return false;
    const u = this.sign * ((this.axis === 'z' ? z : x) - this.top);
    if (u < 0 || u > this.len) return false;
    const i = Math.min(this.steps - 1, Math.floor(u / this.run));
    out.y = this.baseY + this.yTop - (i + 1) * this.rise;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.kind = SMOOTH;
    return true;
  }

  build(entries) {
    const p = [[0, -0.6], [0, this.baseY + this.yTop]];
    for (let i = 0; i < this.steps; i++) {
      const y = this.baseY + this.yTop - (i + 1) * this.rise;
      p.push([i * this.run, y], [(i + 1) * this.run, y]);
    }
    p.push([this.len, -0.6]);
    profile(entries, p, this.axis, this.top, this.sign, this.c0, this.c1, this.color);
  }

  /** rise and steps are untouched — the same number of steps at the same
   * height, just a longer run each, since only the tread (run) is a
   * horizontal length. yTop follows from rise alone, so it needs no
   * recomputing; len is steps * run and does. */
  scaleXZ(s) {
    this.c0 *= s;
    this.c1 *= s;
    this.top *= s;
    this.run *= s;
    this.len = this.steps * this.run;
  }

  bounds() {
    const along0 = Math.min(this.top, this.top + this.sign * this.len);
    const along1 = Math.max(this.top, this.top + this.sign * this.len);
    return this.axis === 'z'
      ? { x0: this.c0, x1: this.c1, z0: along0, z1: along1 }
      : { x0: along0, x1: along1, z0: this.c0, z1: this.c1 };
  }
}

/**
 * Extrude a (distance-along-axis, height) profile across a feature's width.
 *
 * ExtrudeGeometry builds its shape in XY and pushes it along +Z, so the yaw
 * below is what maps the profile's first axis onto the world axis the feature
 * runs along, in the direction `sign` points.
 */
function profile(entries, points, axis, base, sign, c0, c1, color) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();

  const width = c1 - c0;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -width / 2); // so placement is about the feature's middle

  const yaw = axis === 'z' ? (sign > 0 ? -Math.PI / 2 : Math.PI / 2) : sign > 0 ? 0 : Math.PI;
  const cx = axis === 'z' ? (c0 + c1) / 2 : base;
  const cz = axis === 'z' ? base : (c0 + c1) / 2;
  entries.push(piece(geo, color, 1, 1, 1, cx, 0, cz, 0, yaw, 0));
}

/**
 * Free the one-off geometries an entry list was built from. Has to run after the
 * merge, not before it: merge() reads every source it is handed.
 */
function disposeSources(entries) {
  for (const e of entries) if (e.geo.type !== 'BoxGeometry') e.geo.dispose();
}

// --- grindable lines ------------------------------------------------------
/**
 * Anything you can lock onto: round rails, ledge edges, and coping. Held as a
 * segment plus a precomputed unit direction, because grind detection runs every
 * step against every line and the normalising would otherwise dominate it.
 */
export class Grind {
  constructor(ax, ay, az, bx, by, bz, kind, radius) {
    this.a = new THREE.Vector3(ax, ay, az);
    this.b = new THREE.Vector3(bx, by, bz);
    this.dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
    this.len = this.dir.length();
    this.dir.multiplyScalar(1 / this.len);
    this.kind = kind; // 'rail' | 'ledge' | 'coping'
    this.radius = radius;
  }

  /**
   * How far along the rail the closest point to p lies. Clamped to the segment,
   * so running off the end of a rail ends the grind instead of extrapolating
   * one into thin air.
   */
  project(p) {
    const t =
      (p.x - this.a.x) * this.dir.x + (p.y - this.a.y) * this.dir.y + (p.z - this.a.z) * this.dir.z;
    return t < 0 ? 0 : t > this.len ? this.len : t;
  }

  pointAt(t, out) {
    return out.set(
      this.a.x + this.dir.x * t,
      this.a.y + this.dir.y * t,
      this.a.z + this.dir.z * t
    );
  }

  /** Heights (a.y, b.y) stay put; only the horizontal ends move, so dir and
   * len — both derived from the full a-to-b vector — have to be redone
   * rather than just scaled, or a rail that wasn't level would end up
   * pointing the wrong way. */
  scaleXZ(s) {
    this.a.x *= s;
    this.a.z *= s;
    this.b.x *= s;
    this.b.z *= s;
    this.dir.set(this.b.x - this.a.x, this.b.y - this.a.y, this.b.z - this.a.z);
    this.len = this.dir.length();
    this.dir.multiplyScalar(1 / this.len);
  }
}

export class Park {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.blurb = def.blurb;
    // Built-in maps are authored at 1x and stretched to TRACK_SCALE once, here —
    // spawn, patrol and the logo spots all land in the same doubled-up world the
    // geometry below scales itself into. A map can opt out with `def.scale: 1`
    // and author its own layout directly in world units — which is what a
    // player-built park does, since its coordinates were placed in the editor
    // at the exact world positions they should be ridden at.
    const SCALE = def.scale || TRACK_SCALE;
    this.spawn = { ...def.spawn, x: def.spawn.x * SCALE, z: def.spawn.z * SCALE };
    // A spawn that forgot its yaw would hand the ride model `undefined` the
    // first time it resets — default it here so no def can corrupt the run.
    if (!Number.isFinite(this.spawn.yaw)) this.spawn.yaw = 0;
    this.patrol = def.patrol.map((pt) => ({ x: pt.x * SCALE, z: pt.z * SCALE }));
    this.logos = def.logos.map((pt) => ({ x: pt.x * SCALE, z: pt.z * SCALE }));
    // Every map shares this footprint by default; a def can ask for its own
    // (the open-world map is several times the size) and opt out of the
    // fence and curb that make sense around a bounded pad but not around
    // one you are meant to feel like you can roam past the edge of.
    this.extentX = (def.extentX || PARK_X) * SCALE;
    this.extentZ = (def.extentZ || PARK_Z) * SCALE;
    this.noFence = !!def.noFence;
    // A park can ask to keep every wheel — the player's and the AI's — on the
    // concrete itself, rather than letting the dirt run-off around it be part
    // of the ride at all. rideBoundX/Z (set once worldR exists, below) is
    // what physics.js actually clamps to.
    this.padOnly = !!def.padOnly;

    this.features = [];
    this.grinds = [];
    this.rails = [];   // mesh specs, filled by rail()
    this.copings = [];
    this.hoops = [];   // mesh specs, filled by hoop() — decorative only, no collision
    this.benches = []; // mesh specs, filled by bench() — decorative only
    this.planters = []; // mesh specs, filled by planter() — decorative only
    this.group = new THREE.Group();
    this._hit = { y: 0, nx: 0, ny: 1, nz: 0, kind: SMOOTH };
    this._probe = { y: 0, nx: 0, ny: 1, nz: 0, kind: SMOOTH };

    // The park graph (nodes/edges between skateable features) is authored
    // alongside the layout — parkLayouts.js for the built-in maps,
    // parkFile.js for a player's saved parks — and read off the def here, so
    // Park itself never has to know how a graph was produced. A def without
    // one just has no graph.
    this.graph = def.graph || def._graph || null;

    this.layout();
    this.buildZones();
    this.buildMeshes();
  }

  add(f) {
    this.features.push(f);
    return f;
  }

  /**
   * Every map starts here: dirt out to the horizon, then the paved pad on top
   * of it. Riding off the concrete is punished with friction rather than with
   * an invisible wall, unless the map is padOnly, which stops it right at the
   * curb instead. What sits on the pad is the one thing that changes between
   * maps, and that is entirely `def.build`'s job.
   */
  layout() {
    // Wide enough to stay past the treeline on any map, including one with a
    // pad several times the standard size. extentX/extentZ are already
    // TRACK_SCALE'd (see the constructor), so this pad needs no scaling of
    // its own — only what def.build() adds next does.
    const dirtR = Math.max(200, this.extentX * 3, this.extentZ * 3);
    // Nothing is sampled past the dirt itself, so this is where physics.js
    // clamps a ride to keep it from ever running off the edge of the world —
    // the dirt is still free to roam, only the void beyond it is fenced off.
    this.worldR = dirtR;
    // What physics.js actually clamps to: the dirt's run-off normally, or —
    // for a padOnly map — the concrete's own edge, so the fence around it is
    // not just decoration any more.
    this.rideBoundX = this.padOnly ? this.extentX : this.worldR;
    this.rideBoundZ = this.padOnly ? this.extentZ : this.worldR;
    this.add(new Slab(-dirtR, dirtR, -dirtR, dirtR, DIRT_Y, ROUGH, DIRT, 1.2));
    this.add(new Slab(-this.extentX, this.extentX, -this.extentZ, this.extentZ, 0, SMOOTH, this.def.ground || CONCRETE, 0.55));

    // Every def.build() below is written in 1x coordinates. Stretch just the
    // features/rails/copings it adds — not the pad above, already at full
    // size — out to TRACK_SCALE once, here, so no map's own layout ever has
    // to know the multiplier exists.
    const before = this.features.length;
    // Everything added so far is the always-present base: the dirt and the
    // pad. The zone grid (buildZones) keeps those out of the spatial index —
    // a 600 m dirt slab would land in every cell — and always samples them.
    this._baseCount = before;
    const SCALE = this.def.scale || TRACK_SCALE;
    this.def.build(this);
    if (SCALE !== 1) {
      for (let i = before; i < this.features.length; i++) this.features[i].scaleXZ(SCALE);
      for (const g of this.grinds) g.scaleXZ(SCALE);
      for (const r of this.rails) {
        r.ax *= SCALE;
        r.az *= SCALE;
        r.bx *= SCALE;
        r.bz *= SCALE;
      }
      for (const c of this.copings) {
        c.x0 *= SCALE;
        c.x1 *= SCALE;
        c.z0 *= SCALE;
        c.z1 *= SCALE;
      }
      // Radius/tube are real sizes, the same as a ramp's own R/H — only the
      // position they sit at is in the map's own stretched-out coordinates.
      for (const h of this.hoops) {
        h.cx *= SCALE;
        h.cz *= SCALE;
      }
      for (const b of this.benches) {
        b.cx *= SCALE;
        b.cz *= SCALE;
        b.len *= SCALE;
      }
      for (const p of this.planters) {
        p.cx *= SCALE;
        p.cz *= SCALE;
        p.w *= SCALE;
        p.d *= SCALE;
      }
    }
  }

  /** A round grindable bar, plus the posts that hold it up. */
  rail(ax, ay, az, bx, by, bz, radius, color = STEEL) {
    this.grinds.push(new Grind(ax, ay, az, bx, by, bz, 'rail', radius));
    this.rails.push({ ax, ay, az, bx, by, bz, radius, color });
  }

  /** Steel pipe let into a ramp's lip. Grindable, and it reads as a real park. */
  coping(x0, x1, z, y) {
    this.grinds.push(new Grind(x0, y, z, x1, y, z, 'coping', 0.032));
    this.copings.push({ x0, x1, z0: z, z1: z, y });
  }

  /** As coping(), but for a wall that runs along z instead of x. */
  copingZ(x, y, z0, z1) {
    this.grinds.push(new Grind(x, y, z0, x, y, z1, 'coping', 0.032));
    this.copings.push({ x0: x, x1: x, z0, z1, y });
  }

  /**
   * A ring hovering over a gap, `ry` radians around from facing +z — purely
   * decorative, with nothing for the height field to sample, so clearing a
   * gap "through" one is really just clearing the gap. What actually gets
   * ridden is whatever bank or rail is already doing the job underneath it.
   */
  hoop(cx, cy, cz, radius, tube, ry = 0) {
    this.hoops.push({ cx, cy, cz, radius, tube, ry });
  }

  /**
   * A spectator bench: seat, backrest and legs — decorative only, like a hoop.
   * `len` runs along the bench, `ry` radians around from facing +z, and it
   * always stands on whatever ground the map's def builds it over.
   */
  bench(cx, cy, cz, len, ry = 0, color = 0x6f7580) {
    this.benches.push({ cx, cy, cz, len, ry, color });
  }

  /** A low bed of shrubs — decorative only, like a bench or hoop. */
  planter(cx, cy, cz, w, d, ry = 0, color = 0x8a7a58) {
    this.planters.push({ cx, cy, cz, w, d, ry, color });
  }

  /** A ledge edge — the grindable line only; the platform is a Slab of its own. */
  ledge(ax, ay, az, bx, by, bz) {
    this.grinds.push(new Grind(ax, ay, az, bx, by, bz, 'ledge', 0.05));
  }

  // --- the surface query -------------------------------------------------
  /**
   * Highest surface at (x, z). Fills `out` with y, the unit normal and the
   * surface kind, and returns it.
   *
   * This is the single function the entire ride model stands on, so it
   * allocates nothing, and it does not stop at the first feature it finds — the
   * tallest has to win, or a ledge beside a ramp would put you inside the ledge.
   */
  sample(x, z, out) {
    const hit = this._hit;
    out.y = -1e9;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.kind = SMOOTH;
    // The base list (dirt, the pad, and any feature too large to bucket)
    // is always sampled first, so it wins height ties exactly as it did when
    // every feature lived in one array in add-order.
    const base = this._base;
    for (let i = 0; i < base.length; i++) {
      const f = base[i];
      if (!f.at(x, z, hit)) continue;
      if (hit.y <= out.y) continue;
      out.y = hit.y;
      out.nx = hit.nx;
      out.ny = hit.ny;
      out.nz = hit.nz;
      out.kind = hit.kind;
    }
    // Then just the features bucketed into the zone under (x, z). Each feature
    // sits in every cell its footprint overlaps, so a single cell lookup sees
    // every feature that could possibly report a hit here — no neighbour walk.
    const zones = this.zones;
    if (zones.cols > 0) {
      const c = Math.floor((x - zones.minX) / zones.size);
      const r = Math.floor((z - zones.minZ) / zones.size);
      if (c >= 0 && c < zones.cols && r >= 0 && r < zones.rows) {
        const cell = zones.cells[r * zones.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const f = cell[i];
          if (!f.at(x, z, hit)) continue;
          if (hit.y <= out.y) continue;
          out.y = hit.y;
          out.nx = hit.nx;
          out.ny = hit.ny;
          out.nz = hit.nz;
          out.kind = hit.kind;
        }
      }
    }
    return out;
  }

  /**
   * Bucket the park's obstacles into a uniform zone grid over the pad. The
   * height field then only samples the base surfaces plus the handful of
   * features in one zone, instead of every feature in the park — the first
   * step towards streaming a much larger map, where the per-query cost has to
   * stop growing with the park's size.
   *
   * The grid is public (this.zones) so a future streaming layer can cull or
   * stream whole areas: cols/rows/minX/minZ/size describe the layout, and
   * zoneBounds()/zonesOverlapping() translate between world rectangles and the
   * cells that cover them.
   */
  buildZones() {
    const size = this.def.zoneSize || ZONE_SIZE;
    // A feature too wide for the grid just stays in the always-sampled base
    // list — bucketing a 600 m slab into 40,000 cells buys nothing.
    const huge = size * 3;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = this._baseCount; i < this.features.length; i++) {
      const f = this.features[i];
      if (typeof f.bounds !== 'function') continue;
      const b = f.bounds();
      x0 = Math.min(x0, b.x0);
      x1 = Math.max(x1, b.x1);
      z0 = Math.min(z0, b.z0);
      z1 = Math.max(z1, b.z1);
    }
    const base = [];
    for (let i = 0; i < this.features.length; i++) {
      if (i < this._baseCount) {
        base.push(this.features[i]);
        continue;
      }
      const f = this.features[i];
      if (typeof f.bounds !== 'function') {
        base.push(f);
        continue;
      }
      const b = f.bounds();
      if (!Number.isFinite(b.x0) || b.x1 - b.x0 > huge || b.z1 - b.z0 > huge) {
        base.push(f);
      }
    }
    // Nothing but the base surfaces (a park with no obstacles at all).
    if (x0 === Infinity) {
      this.zones = { size, cols: 0, rows: 0, minX: 0, minZ: 0, cells: [] };
      this._base = base;
      return;
    }
    // One cell of slack around the tightest fit, so a feature sitting exactly
    // on the grid's edge can never fall outside it.
    x0 -= size;
    x1 += size;
    z0 -= size;
    z1 += size;
    const cols = Math.max(1, Math.ceil((x1 - x0) / size));
    const rows = Math.max(1, Math.ceil((z1 - z0) / size));
    const cells = new Array(cols * rows);
    for (let i = 0; i < cells.length; i++) cells[i] = [];
    for (let i = this._baseCount; i < this.features.length; i++) {
      const f = this.features[i];
      if (base.indexOf(f) >= 0) continue;
      const b = f.bounds();
      const c0 = Math.max(0, Math.min(cols - 1, Math.floor((b.x0 - x0) / size)));
      const c1 = Math.max(0, Math.min(cols - 1, Math.floor((b.x1 - x0) / size)));
      const r0 = Math.max(0, Math.min(rows - 1, Math.floor((b.z0 - z0) / size)));
      const r1 = Math.max(0, Math.min(rows - 1, Math.floor((b.z1 - z0) / size)));
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          cells[r * cols + c].push(f);
        }
      }
    }
    this.zones = { size, cols, rows, minX: x0, minZ: z0, cells };
    this._base = base;
  }

  /** The zone (col, row) a world point falls in, or null when it is off the
   * grid (which only happens past the park's own obstacles, on the pad). */
  zoneAt(x, z) {
    const zs = this.zones;
    if (!zs.cols) return null;
    const c = Math.floor((x - zs.minX) / zs.size);
    const r = Math.floor((z - zs.minZ) / zs.size);
    if (c < 0 || c >= zs.cols || r < 0 || r >= zs.rows) return null;
    return { col: c, row: r };
  }

  /** The world rectangle a zone covers — for a streaming layer deciding what
   * to load or cull. */
  zoneBounds(col, row) {
    const zs = this.zones;
    return {
      x0: zs.minX + col * zs.size,
      x1: zs.minX + (col + 1) * zs.size,
      z0: zs.minZ + row * zs.size,
      z1: zs.minZ + (row + 1) * zs.size,
    };
  }

  /** Every zone a world rectangle touches, as { col, row, bounds } — the
   * culling query for "which areas does this region belong to". */
  zonesOverlapping(b) {
    const zs = this.zones;
    const out = [];
    if (!zs.cols) return out;
    const c0 = Math.max(0, Math.min(zs.cols - 1, Math.floor((b.x0 - zs.minX) / zs.size)));
    const c1 = Math.max(0, Math.min(zs.cols - 1, Math.floor((b.x1 - zs.minX) / zs.size)));
    const r0 = Math.max(0, Math.min(zs.rows - 1, Math.floor((b.z0 - zs.minZ) / zs.size)));
    const r1 = Math.max(0, Math.min(zs.rows - 1, Math.floor((b.z1 - zs.minZ) / zs.size)));
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        out.push({ col: c, row: r, bounds: this.zoneBounds(c, r) });
      }
    }
    return out;
  }

  /** Height only, for the things that do not care which way the ground faces. */
  heightAt(x, z) {
    return this.sample(x, z, this._probe).y;
  }

  /**
   * The best grind line for a board at `pos` heading along `heading`.
   *
   * "Best" is nearest in the horizontal plane, among lines whose height is
   * within reach and whose direction is not too far off the board's — a rail you
   * are crossing at right angles is not a rail you can lock onto, it is one you
   * slam into.
   */
  findGrind(pos, heading, snapXZ, snapY, maxAlign, out) {
    let best = null;
    let bestDist = Infinity;
    for (const g of this.grinds) {
      const t = g.project(pos);
      const px = g.a.x + g.dir.x * t;
      const py = g.a.y + g.dir.y * t;
      const pz = g.a.z + g.dir.z * t;
      const dxz = Math.hypot(pos.x - px, pos.z - pz);
      if (dxz > snapXZ || dxz >= bestDist) continue;
      const dy = pos.y - py;
      // Generous from above (you drop onto rails), tight from below.
      if (dy > snapY || dy < -snapY * 0.45) continue;
      // Rails are two-way: a heading 180° off the stored direction is a
      // perfectly good grind, ridden the other way.
      const dot = Math.abs(heading.x * g.dir.x + heading.z * g.dir.z);
      if (Math.acos(Math.min(1, dot)) > maxAlign) continue;
      bestDist = dxz;
      best = g;
      out.t = t;
      out.px = px;
      out.py = py;
      out.pz = pz;
    }
    out.rail = best;
    return best;
  }

  // --- meshes ------------------------------------------------------------
  buildMeshes() {
    const entries = [];
    for (const f of this.features) f.build(entries);

    // Painted lines on the flat, purely so that speed reads. Without something
    // regular on the ground, open concrete gives the eye nothing to measure
    // motion against and 8 m/s looks like 3. Tied to the pad's own extent —
    // not a fixed size — so a map several times the standard footprint gets
    // a grid that actually spans it instead of one sitting in the middle of
    // an otherwise blank slab. The stripe spacing itself (6 m) stays fixed:
    // it is a real distance, and scaling it with the map would make the same
    // speed look slower on a bigger pad instead of reading true everywhere.
    const ex = this.extentX;
    const ez = this.extentZ;
    for (let z = -(ez - 12); z <= ez - 12; z += 6) entries.push(box(PAINT, ex * 2 - 8, 0.012, 0.09, 0, 0.006, z));
    entries.push(box(PAINT, 0.09, 0.012, ez * 2 - 20, 0, 0.006, 0));

    // Curbs around the paved edge. They read as a boundary, and the height field
    // makes them something to ollie rather than something to roll over — which
    // is exactly the wrong note for a map meant to feel like it has no edge.
    if (!this.noFence) {
      const h = 0.14;
      const ex = this.extentX;
      const ez = this.extentZ;
      entries.push(box(CURB, ex * 2 + 0.6, h, 0.3, 0, h / 2, -ez - 0.15));
      entries.push(box(CURB, ex * 2 + 0.6, h, 0.3, 0, h / 2, ez + 0.15));
      entries.push(box(CURB, 0.3, h, ez * 2, -ex - 0.15, h / 2, 0));
      entries.push(box(CURB, 0.3, h, ez * 2, ex + 0.15, h / 2, 0));
    }

    for (const r of this.rails) {
      tube(entries, r.color, r.ax, r.ay, r.az, r.bx, r.by, r.bz, r.radius);
      const dx = r.bx - r.ax;
      const dy = r.by - r.ay;
      const dz = r.bz - r.az;
      const len = Math.hypot(dx, dy, dz);
      const posts = Math.max(2, Math.round(len / 2.2));
      for (let i = 0; i < posts; i++) {
        const t = i / (posts - 1);
        const px = r.ax + dx * t;
        const py = r.ay + dy * t;
        const pz = r.az + dz * t;
        const ground = this.heightAt(px, pz);
        const ph = Math.max(0.05, py - ground - r.radius);
        entries.push(box(r.color, 0.05, ph, 0.05, px, ground + ph / 2, pz));
      }
    }

    for (const c of this.copings) {
      // Sunk a centimetre into the lip, the way coping is actually set.
      tube(entries, COPING, c.x0, c.y - 0.012, c.z0, c.x1, c.y - 0.012, c.z1, 0.032);
    }

    for (const h of this.hoops) hoop(entries, HOOP, h.cx, h.cy, h.cz, h.radius, h.tube, h.ry);

    const geo = merge(entries, 0.35);
    disposeSources(entries);
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      map: groundTexture(),
      shininess: 9,
      specular: 0x222428,
    });
    const mesh = new THREE.Mesh(geo, this.material);
    // One draw call for the whole park; deciding whether to cull it is more
    // expensive than the chance of ever being able to.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.mesh = mesh;

    this.buildScenery();
  }

  /**
   * Fences, trees and lamp posts. None of it is collided against, and none
   * of it wants the ground's concrete grain — a tree trunk textured like a
   * slab of pavement is worse than a flat-coloured one — so it gets its own
   * untextured material rather than sharing `this.material`.
   *
   * The repeated boxes (fence posts and rails, every tree's trunk and crown)
   * are instances of a single unit box, not merged geometry: the fence and
   * the treeline each become one InstancedMesh, so a park's whole scenery
   * budget stays a handful of draw calls no matter how many trees it plants.
   * The unit box is built per park (never the shared module geometry), so a
   * disposed park can always dispose its own geometry.
   */
  buildScenery() {
    const entries = [];
    const instances = [];
    const ex = this.extentX;
    const ez = this.extentZ;
    const FENCE = 0x6f7580;
    const lamps = [];
    if (!this.noFence) {
      for (const side of [-1, 1]) {
        for (let x = -ex; x <= ex; x += 2.4) {
          this._addInstance(instances, FENCE, 0.06, 2.2, 0.06, x, 1.1, side * (ez + 1.2));
        }
        for (const y of [1.1, 2.15]) {
          this._addInstance(instances, FENCE, ex * 2, 0.05, 0.05, 0, y, side * (ez + 1.2));
        }
        for (let z = -ez; z <= ez; z += 2.4) {
          this._addInstance(instances, FENCE, 0.06, 2.2, 0.06, side * (ex + 1.2), 1.1, z);
        }
        for (const y of [1.1, 2.15]) {
          this._addInstance(instances, FENCE, 0.05, 0.05, ez * 2, side * (ex + 1.2), y, 0);
        }
      }
      for (const x of [-ex - 2.4, ex + 2.4]) {
        for (const z of [-16, 0, 16]) {
          buildLamp(entries, x, z);
          const armSign = -Math.sign(x);
          lamps.push([x + armSign * 0.46, 6.4, z]);
        }
      }
    }

    // Trees beyond the fence (or, on a map with no fence, beyond the pad).
    // They give the horizon a scale and the camera something to sweep past on
    // a spin. Seeded per park, so the treeline is the same shape every time
    // you load a given map but different across every one of them, and
    // jittered per tree so forty of them do not read as four shapes
    // copy-pasted ten times each. The ring scales with the pad, so a map
    // several times the usual size still has its treeline sit past the edge
    // of it rather than standing in the middle of the open ground.
    let a = this.def.seed || 0x51ed;
    const rng = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const treeNear = Math.max(ex, ez) + 12;
    for (let i = 0; i < 44; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = treeNear + rng() * 48;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad * 0.85;
      buildTree(instances, x, z, rng, rng() < 0.3 ? 'pine' : 'broadleaf', this);
    }

    // Benches and planters: the one decoration that lives *inside* the pad
    // rather than beyond the fence. Like the trees, none of it is collided
    // against — it is scenery, deliberately placed by the map's def (or by a
    // player in the designer) and never part of the height field.
    for (const b of this.benches) buildBench(entries, b);
    for (const pt of this.planters) buildPlanter(entries, pt);

    this.sceneryMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 5 });
    const mesh = new THREE.Mesh(merge(entries, 0.4), this.sceneryMaterial);
    disposeSources(entries);
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // The scenery instances share one unit box, one material and one draw
    // call; colour per instance is carried by an instance-colour attribute
    // (trees get a per-box jitter, the fence is uniform) exactly as merged
    // geometry used to carry it per vertex.
    if (instances.length) {
      this.sceneryInstanceMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 5 });
      const inst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        this.sceneryInstanceMaterial,
        instances.length,
      );
      const c = new THREE.Color();
      for (let i = 0; i < instances.length; i++) {
        const it = instances[i];
        it.matrix.toArray(inst.instanceMatrix.array, i * 16);
        inst.setColorAt(i, c.set(it.color));
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;
      // Culling a park-wide treeline per instance costs more than the chance
      // of ever dropping one; the whole scenery is either on screen or not.
      inst.frustumCulled = false;
      this.group.add(inst);
      this.sceneryInstances = inst;
    }

    // The lamp heads' own glow: a lit-looking bulb needs an unlit material of
    // its own, which the single merged, lit scenery mesh above cannot give
    // any one part of itself without giving it to the whole thing.
    const bulbGeo = new THREE.SphereGeometry(0.085, 8, 6);
    // Shared and kept on the Park itself — LightingManager repaints this one
    // material between an unlit daytime grey and a warm night glow, rather
    // than every bulb needing a material (and a lighting.js import) of its
    // own.
    this.bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
    for (const [x, y, z] of lamps) {
      const bulb = new THREE.Mesh(bulbGeo, this.bulbMaterial);
      bulb.position.set(x, y, z);
      bulb.frustumCulled = false;
      this.group.add(bulb);
    }
    // Exposed so LightingManager can drop a glow sprite (and, in future, a
    // real point light) at every lamp this park placed, without it needing
    // to know how a park lays its own lamps out.
    this.lampPositions = lamps;
  }

  /**
   * Record one box in the instanced scenery: the same Euler-XYZ rotation
   * order geo.js' `box` uses, so the fences and treelines hold exactly the
   * shape the merged versions did.
   */
  _addInstance(instances, color, sx, sy, sz, px, py, pz, rx, ry, rz) {
    _ip.set(px, py, pz);
    _ie.set(rx || 0, ry || 0, rz || 0);
    _iq.setFromEuler(_ie);
    _is.set(sx, sy, sz);
    instances.push({
      color,
      matrix: new THREE.Matrix4().compose(_ip, _iq, _is),
    });
  }
}

/** One tree: a tapered trunk, then either a conifer's stacked tiers or a
 * broadleaf's cluster of offset lobes — three boxes reading as one rounder
 * crown than a single box ever does. Every box is an instanced scenery
 * entry, so a whole treeline costs one draw call. */
function buildTree(instances, x, z, rng, kind, park) {
  const th = 3.6 + rng() * 4.2;
  const trunkW = 0.3 + rng() * 0.16;
  const trunkColor = jitter(0x5a4630, rng, 0.02, 0.12);
  for (let i = 0; i < 3; i++) {
    const seg = th / 3;
    const w = trunkW * (1 - i * 0.22);
    park._addInstance(instances, trunkColor, w, seg + 0.02, w, x, seg * (i + 0.5), z);
  }

  if (kind === 'pine') {
    const tiers = 4;
    const span = 3.4 + rng() * 2.2;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const w = 2.0 - t * 1.4 + rng() * 0.2;
      const y = th + t * span * 0.85 + w * 0.3;
      const yaw = (i % 2) * (Math.PI / 4);
      park._addInstance(instances, jitter(0x2f4a33, rng, 0.02, 0.09), w, 1.05, w, x, y, z, 0, yaw, 0);
    }
  } else {
    const base = 2.3 + rng() * 2.0;
    const cy = th + base * 0.34;
    park._addInstance(instances, jitter(0x415f39, rng, 0.03, 0.1), base, base * 0.85, base, x, cy, z);
    for (let i = 0; i < 2; i++) {
      const s = base * (0.55 + rng() * 0.22);
      const ox = (rng() - 0.5) * base * 0.7;
      const oz = (rng() - 0.5) * base * 0.7;
      const oy = cy + (rng() - 0.5) * base * 0.28;
      park._addInstance(instances, jitter(0x466a42, rng, 0.03, 0.12), s, s * 0.8, s, x + ox, oy, z + oz);
    }
  }
}

/** A park lamp: a post, a bracket arm, and a housing. The bulb itself is
 * added separately, in a material that can actually look lit. */
function buildLamp(entries, x, z) {
  const armSign = -Math.sign(x);
  entries.push(box(0x8b9099, 0.16, 6.4, 0.16, x, 3.2, z));
  entries.push(box(0x8b9099, 0.5, 0.14, 0.14, x + armSign * 0.25, 6.35, z));
  entries.push(box(0x50545c, 0.62, 0.22, 0.4, x + armSign * 0.46, 6.42, z));
}

/** A bench: a seat slat, a backrest and two legs — a few boxes that read as
 * "somewhere to sit" from the pad without adding more than an entry each. */
function buildBench(entries, b) {
  const ry = b.ry || 0;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  // Local (lx, lz) -> world, rotated about y the way box() itself rotates.
  const at = (lx, lz) => [b.cx + lx * cos + lz * sin, b.cz - lx * sin + lz * cos];
  const seatY = b.cy + 0.46;
  const [sx, sz] = at(0, 0);
  entries.push(box(b.color, b.len, 0.06, 0.34, sx, seatY, sz, 0, ry, 0));
  const [bx, bz] = at(0, -0.18);
  entries.push(box(b.color, b.len, 0.36, 0.05, bx, seatY + 0.19, bz, 0, ry, 0));
  const leg = (lz) => {
    const [lx, lz2] = at(0, lz);
    entries.push(box(0x4a4438, 0.06, seatY - b.cy, 0.4, lx, (seatY + b.cy) / 2, lz2, 0, ry, 0));
  };
  leg(b.len / 2 - 0.3);
  leg(-(b.len / 2 - 0.3));
}

/** A planter: a low box with a green mound of shrubs on top. */
function buildPlanter(entries, pt) {
  const ry = pt.ry || 0;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const at = (lx, lz) => [pt.cx + lx * cos + lz * sin, pt.cz - lx * sin + lz * cos];
  const h = pt.cy + 0.4;
  const [px, pz] = at(0, 0);
  entries.push(box(pt.color, pt.w, 0.4, pt.d, px, h - 0.2, pz, 0, ry, 0));
  entries.push(box(0x3f5a3a, pt.w * 0.82, 0.5, pt.d * 0.82, px, h + 0.1, pz, 0, ry, 0));
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mid = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

// Scratch values for the instanced-scenery transform (park._addInstance) —
// the same compose/Euler recipe geo.js' box() uses, so ported shapes keep
// their exact layout.
const _ip = new THREE.Vector3();
const _ie = new THREE.Euler();
const _iq = new THREE.Quaternion();
const _is = new THREE.Vector3();

/**
 * A cylinder between two points. CylinderGeometry is built along +Y, so the
 * quaternion that takes +Y onto the segment's direction is the whole job —
 * cheaper to reason about than an Euler triple, and it cannot gimbal on a rail
 * that happens to be vertical.
 */
function tube(entries, color, ax, ay, az, bx, by, bz, radius) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length();
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(_up, _dir);
  _mid.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  const geo = new THREE.CylinderGeometry(radius, radius, len, 9, 1);
  entries.push({ geo, color, matrix: new THREE.Matrix4().compose(_mid, _q, _one) });
}

const _hq = new THREE.Quaternion();
const _he = new THREE.Euler();
const _hp = new THREE.Vector3();

/**
 * A ring, hole facing +x by default (`ry` turns it further around y, for a
 * gap that runs some other way) — the one smooth shape in an otherwise
 * all-flat-faced world, which is exactly what makes it read as a landmark
 * rather than more architecture. No feature backs it; the bank or rail
 * actually underneath it is what a skater really lands on.
 */
function hoop(entries, color, cx, cy, cz, radius, tube, ry) {
  _he.set(0, Math.PI / 2 + (ry || 0), 0);
  _hq.setFromEuler(_he);
  _hp.set(cx, cy, cz);
  const geo = new THREE.TorusGeometry(radius, tube, 10, 24);
  entries.push({ geo, color, matrix: new THREE.Matrix4().compose(_hp, _hq, _one) });
}

// ===========================================================================
// the six maps
// ===========================================================================
// Each `build(p)` only ever calls p.add / p.rail / p.coping / p.ledge — the pad,
// the fence, the dirt and the mesh assembly above are common to all of them.
// `spawn` is where a run and a respawn put you; `patrol` is the loop the AI
// skaters tour, chosen by hand for each layout so it stays clear of the
// obstacles below rather than clipping through them; `logos` are the six
// collectible spots.


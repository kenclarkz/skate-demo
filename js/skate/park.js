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
// Below the primitives sits `PARKS`: one spec object per map. Every map shares
// the same pad, fence and dirt — only the obstacles inside `build()` change —
// which is what lets six very different-feeling parks stay one small file.

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
  return pts;
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
    this.group = new THREE.Group();
    this._hit = { y: 0, nx: 0, ny: 1, nz: 0, kind: SMOOTH };
    this._probe = { y: 0, nx: 0, ny: 1, nz: 0, kind: SMOOTH };

    this.layout();
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
    const fs = this.features;
    for (let i = 0; i < fs.length; i++) {
      if (!fs[i].at(x, z, hit)) continue;
      if (hit.y <= out.y) continue;
      out.y = hit.y;
      out.nx = hit.nx;
      out.ny = hit.ny;
      out.nz = hit.nz;
      out.kind = hit.kind;
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
   */
  buildScenery() {
    const entries = [];
    const ex = this.extentX;
    const ez = this.extentZ;
    const FENCE = 0x6f7580;
    const lamps = [];
    if (!this.noFence) {
      for (const side of [-1, 1]) {
        for (let x = -ex; x <= ex; x += 2.4) {
          entries.push(box(FENCE, 0.06, 2.2, 0.06, x, 1.1, side * (ez + 1.2)));
        }
        for (const y of [1.1, 2.15]) {
          entries.push(box(FENCE, ex * 2, 0.05, 0.05, 0, y, side * (ez + 1.2)));
        }
        for (let z = -ez; z <= ez; z += 2.4) {
          entries.push(box(FENCE, 0.06, 2.2, 0.06, side * (ex + 1.2), 1.1, z));
        }
        for (const y of [1.1, 2.15]) {
          entries.push(box(FENCE, 0.05, 0.05, ez * 2, side * (ex + 1.2), y, 0));
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
      buildTree(entries, x, z, rng, rng() < 0.3 ? 'pine' : 'broadleaf');
    }

    this.sceneryMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 5 });
    const mesh = new THREE.Mesh(merge(entries, 0.4), this.sceneryMaterial);
    disposeSources(entries);
    mesh.frustumCulled = false;
    this.group.add(mesh);

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
}

/** One tree: a tapered trunk, then either a conifer's stacked tiers or a
 * broadleaf's cluster of offset lobes — three boxes reading as one rounder
 * crown than a single box ever does. */
function buildTree(entries, x, z, rng, kind) {
  const th = 3.6 + rng() * 4.2;
  const trunkW = 0.3 + rng() * 0.16;
  const trunkColor = jitter(0x5a4630, rng, 0.02, 0.12);
  for (let i = 0; i < 3; i++) {
    const seg = th / 3;
    const w = trunkW * (1 - i * 0.22);
    entries.push(box(trunkColor, w, seg + 0.02, w, x, seg * (i + 0.5), z));
  }

  if (kind === 'pine') {
    const tiers = 4;
    const span = 3.4 + rng() * 2.2;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const w = 2.0 - t * 1.4 + rng() * 0.2;
      const y = th + t * span * 0.85 + w * 0.3;
      const yaw = (i % 2) * (Math.PI / 4);
      entries.push(box(jitter(0x2f4a33, rng, 0.02, 0.09), w, 1.05, w, x, y, z, 0, yaw, 0));
    }
  } else {
    const base = 2.3 + rng() * 2.0;
    const cy = th + base * 0.34;
    entries.push(box(jitter(0x415f39, rng, 0.03, 0.1), base, base * 0.85, base, x, cy, z));
    for (let i = 0; i < 2; i++) {
      const s = base * (0.55 + rng() * 0.22);
      const ox = (rng() - 0.5) * base * 0.7;
      const oz = (rng() - 0.5) * base * 0.7;
      const oy = cy + (rng() - 0.5) * base * 0.28;
      entries.push(box(jitter(0x466a42, rng, 0.03, 0.12), s, s * 0.8, s, x + ox, oy, z + oz));
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

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mid = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

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

export const PARKS = [
  {
    id: 'home',
    name: 'Home Park',
    blurb: 'Flow-first design: pump the transitions, transfer the spine, carve the hip.',
    seed: 0x51ed,
    padOnly: true,
    extentX: 28,
    spawn: { x: 0, y: 0, z: -14, yaw: 0 },
    patrol: [
      { x: 0, z: -16 }, { x: 10, z: -8 }, { x: 10, z: 8 }, { x: 0, z: 16 },
      { x: -10, z: 8 }, { x: -10, z: -8 },
    ],
    logos: [
      { x: 0, z: -8 }, { x: -8, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 12 },
      { x: 18, z: 11 }, { x: -19, z: -4 },
    ],
    build(p) {
      // --- north transition: the big quarterpipe ---------------------------
      // uTop / TRACK_SCALE below: uTop is a real arc length that must not be
      // doubled a second time when the generic post-build scale-up (see
      // Park.layout()) doubles this whole expression along with every other
      // literal in it — see the TRACK_SCALE comment up top.
      const qpN = p.add(new Quarter(-13, 13, 20, 'z', 1, 2.9, 2.1, 3.0));
      p.add(new Slab(-13, 13, 20 + qpN.uTop / TRACK_SCALE, 29, 2.1, SMOOTH, CONCRETE, 2.2));
      p.coping(-13, 13, 20 + qpN.uTop / TRACK_SCALE, 2.1);

      // --- spine: two back-to-back quarters for transfers -------------------
      // Back-to-back quarters with no deck between them — the only way across
      // is a transfer, which keeps the flow alive instead of stopping it.
      const spineN = p.add(new Quarter(-7, 7, 3, 'z', 1, 2.0, 1.5));
      const spineS = p.add(new Quarter(-7, 7, 1, 'z', -1, 2.0, 1.5));
      p.coping(-7, 7, 3 + spineN.uTop / TRACK_SCALE, 1.5);
      p.coping(-7, 7, 1 - spineS.uTop / TRACK_SCALE, 1.5);

      // --- banked hip: diagonal bank for turning and carving ----------------
      // A raised hip on the east side — carve up from the flat, turn, and
      // pump back down with speed for the next line.
      p.add(new Bank(12, 22, 6, 16, 'x', 0, 1.3));
      p.add(new Slab(12, 22, 16, 20, 1.3, SMOOTH, CONCRETE, 1.4));
      p.ledge(12, 0.0, 6, 12, 0.0, 16);

      // --- west bank: approach to the spine ----------------------------------
      // A wide bank on the west side that feeds into the spine — roll up it,
      // transfer over the spine, and land on the other side for a line.
      p.add(new Bank(-24, -18, -8, 8, 'x', 1.6, 0));
      p.add(new Slab(-26, -24, -8, 8, 1.6, SMOOTH, CONCRETE, 1.7));
      p.ledge(-24, 1.6, -8, -24, 1.6, 8);

      // --- kicker: small quarter for airs on the way to the south transition -
      p.add(new Quarter(-20, -17, 5, 'z', -1, 1.8, 0.9));

      // --- south transition: smaller, for pumping back the other way -------
      const qpS = p.add(new Quarter(-10, 10, -22, 'z', -1, 2.4, 1.6, 3.0));
      p.add(new Slab(-10, 10, -31, -22 - qpS.uTop / TRACK_SCALE, 1.6, SMOOTH, CONCRETE, 1.7));
      p.coping(-10, 10, -22 - qpS.uTop / TRACK_SCALE, 1.6);

      // --- funbox: bank up, flat rail across the top, bank down -------------
      // Positioned between the spine and south quarter for linking lines.
      p.add(new Bank(-3.2, 3.2, -8, -5, 'z', 0, 0.65));
      p.add(new Slab(-3.2, 3.2, -5, -2, 0.65, SMOOTH, CONCRETE, 0.7));
      p.add(new Bank(-3.2, 3.2, -2, 1, 'z', 0.65, 0));
      p.rail(0, 0.97, -8.1, 0, 0.97, -1.9, 0.03);
      p.ledge(-3.2, 0.65, -5, -3.2, 0.65, -2);
      p.ledge(3.2, 0.65, -5, 3.2, 0.65, -2);

      // --- east manual pad ---------------------------------------------------
      // A raised pad for manuals and ledge grinds, feeding into the banked hip.
      p.add(new Bank(4, 7, -3, 3, 'x', 0, 0.55));
      p.add(new Slab(7, 15, -3, 3, 0.55, SMOOTH, CONCRETE, 0.6));
      p.ledge(7, 0.55, 3, 15, 0.55, 3);
      p.ledge(7, 0.55, -3, 15, 0.55, -3);

      // --- small stair set and handrail --------------------------------------
      // A short set on the east side for technical lines — the handrail is the
      // point, same as every other park's stairs.
      p.add(new Bank(14, 18, -12, -8, 'z', 1.25, 0));
      p.add(new Slab(14, 18, -18, -12, 1.25, SMOOTH, CONCRETE, 1.35));
      p.add(new Stairs(14, 18, -18, 'z', -1, 5, 0.25, 0.56));
      p.rail(15, 1.36, -17.5, 15, 0.06, -13.4, 0.028);

      // --- flat bars --------------------------------------------------------
      // Two flat bars along the flow path — one north-south, one east-west.
      p.rail(-11, 0.4, -10, -11, 0.4, 10, 0.028);
      p.rail(-16, 0.4, 0, -8, 0.4, 0, 0.028);

      // --- rails for the hip approach and landing ----------------------------
      p.rail(12, 1.35, 16, 12, 0.06, 6, 0.028);
      p.rail(22, 0.42, -20, 22, 0.42, 2, 0.028);
    },
  },

  {
    id: 'bowl',
    name: 'The Bowl',
    blurb: 'A kidney bowl with coping on every wall. Pump it, never stop.',
    seed: 0x9c31,
    padOnly: true,
    // Dead centre of the flat floor, not out on the approach to a wall —
    // every wall's deck is only tangent to the *inside*, so rolling in from
    // outside one hits a cliff, not a ramp. The middle is open in all four
    // directions.
    spawn: { x: 0, y: 0, z: 0, yaw: 0 },
    patrol: [
      { x: 0, z: -15 }, { x: 8, z: -8 }, { x: 8, z: 8 }, { x: 0, z: 15 },
      { x: -8, z: 8 }, { x: -8, z: -8 },
    ],
    logos: [
      { x: 0, z: -6 }, { x: 6, z: 0 }, { x: 0, z: 6 }, { x: -6, z: 0 },
      { x: 12, z: -13 }, { x: -12, z: 13 },
    ],
    build(p) {
      // Four walls of one bowl, each a quarterpipe tangent to a shared flat
      // floor at y = 0 — so a line can be carried from any wall to any other.
      const n = p.add(new Quarter(-9, 9, 9, 'z', 1, 3.1, 2.5, 2.2));
      p.add(new Slab(-9, 9, 9 + n.uTop / TRACK_SCALE, 9 + n.uTop / TRACK_SCALE + 2.2, 2.5, SMOOTH, CONCRETE, 2.5));
      p.coping(-9, 9, 9 + n.uTop / TRACK_SCALE, 2.5);

      const s = p.add(new Quarter(-9, 9, -9, 'z', -1, 3.1, 2.5, 2.2));
      p.add(new Slab(-9, 9, -9 - s.uTop / TRACK_SCALE - 2.2, -9 - s.uTop / TRACK_SCALE, 2.5, SMOOTH, CONCRETE, 2.5));
      p.coping(-9, 9, -9 - s.uTop / TRACK_SCALE, 2.5);

      const e = p.add(new Quarter(-9, 9, 9, 'x', 1, 2.9, 2.2, 1.8));
      p.add(new Slab(9 + e.uTop / TRACK_SCALE, 9 + e.uTop / TRACK_SCALE + 1.8, -9, 9, 2.2, SMOOTH, CONCRETE, 2.2));
      p.copingZ(9 + e.uTop / TRACK_SCALE, 2.2, -9, 9);

      const w = p.add(new Quarter(-9, 9, -9, 'x', -1, 2.9, 2.2, 1.8));
      p.add(new Slab(-9 - w.uTop / TRACK_SCALE - 1.8, -9 - w.uTop / TRACK_SCALE, -9, 9, 2.2, SMOOTH, CONCRETE, 2.2));
      p.copingZ(-9 - w.uTop / TRACK_SCALE, 2.2, -9, 9);

      // A hip in one corner, so a line can carry diagonally across the bowl
      // instead of only wall to wall.
      p.add(new Bank(-9, -5.5, -9, -5.5, 'x', 0, 1.4));

      // The shallow end and a flat bar down the middle, so there is somewhere
      // to grind between pumps.
      p.rail(0, 0.42, -4, 0, 0.42, 4, 0.03);

      // More rails, in the floor space the bigger bowl now has to spare.
      p.rail(6, 0.4, -6, 6, 0.4, 6, 0.03);
      p.rail(-6, 0.4, -6, -6, 0.4, 6, 0.03);
      p.rail(-5, 0.4, -5, 5, 0.4, 5, 0.03);
    },
  },

  {
    id: 'vert',
    name: 'Vert Alley',
    blurb: 'Two tall walls facing off, with a spine between them. Airs, mostly.',
    seed: 0x77a4,
    padOnly: true,
    // Far enough south of the spine's own cliff edge (it has no deck behind
    // it — it is meant to be popped over, not rolled into) to have real
    // open runway before reaching it, not just a couple of metres' warning.
    spawn: { x: 0, y: 0, z: -18, yaw: 0 },
    patrol: [
      { x: 0, z: -20 }, { x: 10, z: -6 }, { x: 10, z: 6 }, { x: 0, z: 20 },
      { x: -10, z: 6 }, { x: -10, z: -6 },
    ],
    logos: [
      { x: 0, z: -14 }, { x: 0, z: 14 }, { x: 14, z: 0 }, { x: -14, z: 0 },
      { x: 8, z: -18 }, { x: -8, z: 18 },
    ],
    build(p) {
      // A tall wall at each end of a long, narrow alley — the closest thing a
      // skateboard has to a halfpipe.
      const n = p.add(new Quarter(-11, 11, 24, 'z', 1, 3.8, 3.2, 2.6));
      p.add(new Slab(-11, 11, 24 + n.uTop / TRACK_SCALE, 29, 3.2, SMOOTH, CONCRETE, 3.2));
      p.coping(-11, 11, 24 + n.uTop / TRACK_SCALE, 3.2);

      const s = p.add(new Quarter(-11, 11, -24, 'z', -1, 3.8, 3.2, 2.6));
      p.add(new Slab(-11, 11, -29, -24 - s.uTop / TRACK_SCALE, 3.2, SMOOTH, CONCRETE, 3.2));
      p.coping(-11, 11, -24 - s.uTop / TRACK_SCALE, 3.2);

      // A spine down the middle: two small quarters back to back, sharing no
      // deck at all, so a transfer means clearing the whole width in the air.
      const spineR = 1.7, spineH = 1.3;
      const spN = p.add(new Quarter(-6, 6, 1.2, 'z', 1, spineR, spineH));
      const spS = p.add(new Quarter(-6, 6, -1.2, 'z', -1, spineR, spineH));
      p.coping(-6, 6, 1.2 + spN.uTop / TRACK_SCALE, spineH);
      p.coping(-6, 6, -1.2 - spS.uTop / TRACK_SCALE, spineH);

      // A rail either side of the alley for the runs that stay on the ground.
      p.rail(-9.5, 0.4, -10, -9.5, 0.4, 10, 0.028);
      p.rail(9.5, 0.4, -10, 9.5, 0.4, 10, 0.028);

      // More rails, inboard of those two, for a line that stays clear of the
      // spine down the middle.
      p.rail(-8, 0.4, -14, -8, 0.4, 14, 0.028);
      p.rail(8, 0.4, -14, 8, 0.4, 14, 0.028);
      p.rail(0, 0.4, -16, 0, 0.4, -6, 0.028);
    },
  },

  {
    id: 'plaza',
    name: 'Street Plaza',
    blurb: 'Ledges, a kinked double set and a long manual pad. Technical.',
    seed: 0x1e6d,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -18, yaw: 0 },
    patrol: [
      { x: 0, z: -20 }, { x: 12, z: -12 }, { x: 12, z: 4 }, { x: 0, z: 14 },
      { x: -12, z: 4 }, { x: -12, z: -12 },
    ],
    logos: [
      { x: 0, z: -10 }, { x: -10, z: -2 }, { x: 10, z: -2 }, { x: 0, z: 6 },
      { x: 15, z: 10 }, { x: -15, z: 10 },
    ],
    build(p) {
      // A long, low manual pad down the centre — the plaza's spine.
      p.add(new Bank(-2.5, 2.5, -10, -7, 'z', 0, 0.36));
      p.add(new Slab(-2.5, 2.5, -7, 9, 0.36, SMOOTH, CONCRETE, 0.4));
      p.add(new Bank(-2.5, 2.5, 9, 12, 'z', 0.36, 0));
      p.ledge(-2.5, 0.36, -7, -2.5, 0.36, 9);
      p.ledge(2.5, 0.36, -7, 2.5, 0.36, 9);

      // A three-block ledge run down one side, each a hair taller than the last.
      for (let i = 0; i < 3; i++) {
        const x0 = 6 + i * 4.2, x1 = x0 + 3.4, y = (0.34 + i * 0.08) * 1.3;
        p.add(new Bank(x0, x0 + 0.6, -4, 4, 'x', 0, y));
        p.add(new Slab(x0 + 0.6, x1, -4, 4, y, SMOOTH, CONCRETE, 0.3 + y));
        p.ledge(x0 + 0.6, y, -4, x1, y, -4);
        p.ledge(x0 + 0.6, y, 4, x1, y, 4);
      }

      // A kinked double set: two flights at an angle, one long rail running
      // over both, off a single flat landing at the top.
      p.add(new Slab(-20, -12, 10, 22, 1.4, SMOOTH, CONCRETE, 1.5));
      p.add(new Stairs(-20, -16, 10, 'z', -1, 4, 0.28, 0.58));
      p.add(new Stairs(-16, -12, 10, 'z', -1, 6, 0.19, 0.58));
      p.rail(-18, 1.5, 10.4, -14, 0.1, 2.9, 0.028);

      // Two picnic-table hips for wallride-style pop lines.
      p.add(new Bank(10, 14, 14, 18, 'x', 0, 0.65));
      p.add(new Bank(10, 14, 18, 22, 'x', 0.65, 0));

      // More rails, out in the ground the plaza's bigger footprint opens up.
      p.rail(-16, 0.4, -14, -6, 0.4, -14, 0.028);
      p.rail(16, 0.4, -18, 16, 0.4, -6, 0.028);
      p.rail(0, 0.4, 16, 0, 0.4, 24, 0.028);
    },
  },

  {
    id: 'garden',
    name: 'Mini Ramp Garden',
    blurb: 'Four small ramps close together. Fast combos, forgiving pop.',
    seed: 0x4b2f,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -18, yaw: 0 },
    patrol: [
      { x: 0, z: -19 }, { x: 9, z: -7 }, { x: 9, z: 7 }, { x: 0, z: 17 },
      { x: -9, z: 7 }, { x: -9, z: -7 },
    ],
    logos: [
      { x: 0, z: -11 }, { x: -7, z: -2 }, { x: 7, z: -2 }, { x: 0, z: 8 },
      { x: 7, z: 14 }, { x: -7, z: 14 },
    ],
    build(p) {
      // Four small mini ramps, each just big enough for real air, spaced so a
      // roll-out of one feeds straight into the next.
      const specs = [
        { cx: -7, cz: -3, sign: 1 },
        { cx: 7, cz: -3, sign: -1 },
        { cx: -7, cz: 9, sign: 1 },
        { cx: 7, cz: 9, sign: -1 },
      ];
      for (const { cx, cz, sign } of specs) {
        const half = 3.2;
        const q = p.add(new Quarter(cx - half, cx + half, cz, 'z', sign, 1.8, 1.25, 1.4));
        const back = cz + sign * (q.uTop / TRACK_SCALE + 1.4);
        p.add(
          sign > 0
            ? new Slab(cx - half, cx + half, cz + q.uTop / TRACK_SCALE, back, 1.25, SMOOTH, CONCRETE, 1.3)
            : new Slab(cx - half, cx + half, back, cz - q.uTop / TRACK_SCALE, 1.25, SMOOTH, CONCRETE, 1.3)
        );
        p.coping(cx - half, cx + half, cz + sign * (q.uTop / TRACK_SCALE), 1.25);
      }

      // A flat bar and a small funbox in the gap between all four, so there is
      // somewhere to link a trick between ramps.
      p.rail(-3, 0.4, 3, 3, 0.4, 3, 0.028);
      p.add(new Bank(-2.2, 2.2, -1, 0.5, 'z', 0, 0.42));
      p.add(new Bank(-2.2, 2.2, 0.5, 2, 'z', 0.42, 0));

      // More rails, one along each row of ramps and one linking the rows.
      p.rail(-3.5, 0.4, -6.5, 3.5, 0.4, -6.5, 0.028);
      p.rail(-3.5, 0.4, 12.5, 3.5, 0.4, 12.5, 0.028);
      p.rail(0, 0.4, -3, 0, 0.4, 9, 0.028);
    },
  },

  {
    id: 'bigair',
    name: 'Big Air',
    blurb: 'One mega ramp, and a gap only a rail or a real ollie gets you across.',
    seed: 0xd813,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -20, yaw: 0 },
    patrol: [
      { x: 0, z: -20 }, { x: 10, z: -8 }, { x: 10, z: 0 }, { x: 0, z: 10 },
      { x: -10, z: 0 }, { x: -10, z: -8 },
    ],
    logos: [
      { x: 0, z: -18 }, { x: -12, z: -8 }, { x: 12, z: -8 }, { x: 0, z: 4 },
      { x: 16, z: 6 }, { x: -16, z: 6 },
    ],
    build(p) {
      // The mega ramp: an elevated run-up (so a spawn can stand on it rather
      // than floating over a cliff), a bank down to the flat, then straight
      // into a tall quarter with a deep platform, so there is room to land
      // the air on top as well as to fly clean off the lip.
      p.add(new Slab(-8, 8, -24, -14, 3.0, SMOOTH, CONCRETE, 3.0));
      p.add(new Bank(-8, 8, -14, -8, 'z', 3.0, 0));
      const q = p.add(new Quarter(-8, 8, 6, 'z', 1, 4.1, 3.5, 3.4));
      p.add(new Slab(-8, 8, 6 + q.uTop / TRACK_SCALE, 6 + q.uTop / TRACK_SCALE + 3.4, 3.5, SMOOTH, CONCRETE, 3.5));
      p.coping(-8, 8, 6 + q.uTop / TRACK_SCALE, 3.5);

      // A real gap jump off to one side: bank up, a clean break, flat below,
      // bank back up on the far side. There is no way across it that is not
      // either an ollie or a grind on the rail that spans it.
      p.add(new Bank(-19, -14, -6, 0, 'x', 0, 1.7));
      p.add(new Bank(14, 19, -6, 0, 'x', 1.7, 0));
      p.rail(-14.2, 1.75, -3, 14.2, 1.75, -3, 0.028);

      // More rails: a ground bar either side of the gap for a lower line,
      // and one right up on the mega ramp's own run-up.
      p.rail(-19, 0.4, 2, -19, 0.4, 16, 0.028);
      p.rail(19, 0.4, 2, 19, 0.4, 16, 0.028);
      p.rail(-6, 3.05, -20, 6, 3.05, -20, 0.028);
    },
  },

  {
    id: 'open',
    name: 'Open World',
    blurb: 'No fence, no edge. A whole district — bowls, mega drops, a hoop to jump through.',
    seed: 0x6c17,
    extentX: 75,
    extentZ: 95,
    noFence: true,
    spawn: { x: 0, y: 0, z: -15, yaw: 0 },
    patrol: [
      { x: 0, z: -15 }, { x: 0, z: -52 }, { x: 30, z: -50 }, { x: 57, z: -80 },
      { x: 47, z: 0 }, { x: 32, z: 82 }, { x: 0, z: 65 }, { x: -35, z: 60 },
      { x: -45, z: 10 }, { x: -30, z: -58 },
    ],
    logos: [
      { x: 0, z: 8 }, { x: 0, z: 62 }, { x: -35, z: 60 }, { x: 47, z: 2 },
      { x: 32, z: 80 }, { x: 0, z: -52 },
    ],
    build(p) {
      const GRASS = 0x7a8f5c;

      // A small manual pad right at spawn, so there is something to do
      // before setting off to find anything else.
      p.add(new Bank(-2.5, 2.5, 0, 3, 'z', 0, 0.31));
      p.add(new Slab(-2.5, 2.5, 3, 12, 0.31, SMOOTH, CONCRETE, 0.35));
      p.add(new Bank(-2.5, 2.5, 12, 15, 'z', 0.31, 0));
      p.ledge(-2.5, 0.31, 3, -2.5, 0.31, 12);
      p.ledge(2.5, 0.31, 3, 2.5, 0.31, 12);

      // North: a street spot, a long way off across open ground. A platform
      // with two ways off it — a bank on the near side, so the natural line
      // in from spawn is a smooth roll up rather than a stair set in the
      // face, and stairs with a handrail on the far side — the same shape
      // as Home Park's, because it is a shape that works.
      p.add(new Bank(-10, 10, 45, 55, 'z', 0, 1.3));
      p.add(new Slab(-10, 10, 55, 70, 1.3, SMOOTH, CONCRETE, 1.4));
      p.add(new Stairs(-10, 10, 70, 'z', 1, 5, 0.26, 0.56));
      p.rail(-8.6, 1.36, 69.5, -8.6, 0.06, 73.6, 0.028);

      // South: a proper pocket now, not just one wall — the same big south
      // face, with a wall either side turning the approach into a real deep
      // bowl instead of a single quarter to pump.
      const bowl = p.add(new Quarter(-12, 12, -60, 'z', -1, 3.6, 2.9, 2.6));
      p.add(new Slab(-12, 12, -60 - bowl.uTop / TRACK_SCALE - 2.6, -60 - bowl.uTop / TRACK_SCALE, 2.9, SMOOTH, CONCRETE, 2.9));
      p.coping(-12, 12, -60 - bowl.uTop / TRACK_SCALE, 2.9);
      const bowlW = p.add(new Quarter(-60, -40, -12, 'x', -1, 3.0, 2.4, 2.2));
      p.add(new Slab(-12 - bowlW.uTop / TRACK_SCALE - 2.2, -12 - bowlW.uTop / TRACK_SCALE, -60, -40, 2.4, SMOOTH, CONCRETE, 2.4));
      p.copingZ(-12 - bowlW.uTop / TRACK_SCALE, 2.4, -60, -40);
      const bowlE = p.add(new Quarter(-60, -40, 12, 'x', 1, 3.0, 2.4, 2.2));
      p.add(new Slab(12 + bowlE.uTop / TRACK_SCALE, 12 + bowlE.uTop / TRACK_SCALE + 2.2, -60, -40, 2.4, SMOOTH, CONCRETE, 2.4));
      p.copingZ(12 + bowlE.uTop / TRACK_SCALE, 2.4, -60, -40);

      // West: a real hill — grass-coloured, still rideable — climbing to a
      // plateau with a rail waiting on top of it for anyone who bothers to
      // pump all the way up.
      p.add(new Bank(-55, -30, -15, 15, 'x', 4.5, 0, GRASS));
      p.add(new Slab(-70, -55, -15, 15, 4.5, SMOOTH, GRASS, 4.5));
      p.rail(-68, 4.9, -8, -68, 4.9, 8, 0.028);

      // Northwest: a second deep bowl, four walls this time — bigger and
      // deeper than the one back at The Bowl, with a hip in one corner for a
      // line that carries diagonally across it.
      {
        const cx = -35, cz = 60, half = 15, R = 3.4, H = 2.8, deck = 2.4;
        const n = p.add(new Quarter(cx - half, cx + half, cz + half, 'z', 1, R, H, deck));
        p.add(new Slab(cx - half, cx + half, cz + half + n.uTop / TRACK_SCALE, cz + half + n.uTop / TRACK_SCALE + deck, H, SMOOTH, CONCRETE, H));
        p.coping(cx - half, cx + half, cz + half + n.uTop / TRACK_SCALE, H);
        const s = p.add(new Quarter(cx - half, cx + half, cz - half, 'z', -1, R, H, deck));
        p.add(new Slab(cx - half, cx + half, cz - half - s.uTop / TRACK_SCALE - deck, cz - half - s.uTop / TRACK_SCALE, H, SMOOTH, CONCRETE, H));
        p.coping(cx - half, cx + half, cz - half - s.uTop / TRACK_SCALE, H);
        const e = p.add(new Quarter(cz - half, cz + half, cx + half, 'x', 1, R, H, deck));
        p.add(new Slab(cx + half + e.uTop / TRACK_SCALE, cx + half + e.uTop / TRACK_SCALE + deck, cz - half, cz + half, H, SMOOTH, CONCRETE, H));
        p.copingZ(cx + half + e.uTop / TRACK_SCALE, H, cz - half, cz + half);
        const w = p.add(new Quarter(cz - half, cz + half, cx - half, 'x', -1, R, H, deck));
        p.add(new Slab(cx - half - w.uTop / TRACK_SCALE - deck, cx - half - w.uTop / TRACK_SCALE, cz - half, cz + half, H, SMOOTH, CONCRETE, H));
        p.copingZ(cx - half - w.uTop / TRACK_SCALE, H, cz - half, cz + half);
        p.add(new Bank(cx - half, cx - half + 6, cz - half, cz - half + 6, 'x', 0, 1.7));
        p.rail(cx - 6, 0.4, cz - 6, cx + 6, 0.4, cz - 6, 0.03);
      }

      // East: a real gap jump with a ring hanging over it — clear the gap
      // and you clear the hoop, since it hangs exactly where the flight path
      // already has to go. Nothing about the hoop is collided against; the
      // bank and the rail underneath it are what actually gets ridden.
      p.add(new Bank(35, 42, -6, 6, 'x', 0, 2.2));
      p.add(new Bank(52, 59, -6, 6, 'x', 2.2, 0));
      p.rail(42, 2.25, 0, 52, 2.25, 0, 0.03);
      // hoop()'s default already faces +x, the direction this gap runs.
      p.hoop(47, 5.3, 0, 2.3, 0.16);
      p.rail(35, 0.4, -14, 35, 0.4, -2, 0.028);
      p.rail(59, 0.4, -14, 59, 0.4, -2, 0.028);

      // Northeast: the first mega drop. A long approach ramp climbs from the
      // far edge of the map up onto a high deck; the lip is the very next
      // step off it, straight into the tallest transition here — the same
      // drop-in a real vert ramp gives you, just scaled up for a map with
      // the room to spare.
      {
        const base = 68;
        const q = p.add(new Quarter(20, 45, base, 'z', 1, 6.5, 5.2, 3.5));
        const lip = base + q.uTop / TRACK_SCALE;
        p.add(new Slab(20, 45, lip, lip + 3.5, 5.2, SMOOTH, CONCRETE, 5.2));
        p.coping(20, 45, lip, 5.2);
        p.add(new Bank(20, 45, lip + 3.5, 90, 'z', 5.2, 0));
        p.rail(19.3, 0.3, 88, 19.3, 5.1, lip + 4, 0.03);
      }

      // Southeast: the second mega drop — approached from the opposite edge
      // of the map, so the two tall drops here do not read as the same
      // feature copy-pasted.
      {
        const base = -71;
        const q = p.add(new Quarter(45, 70, base, 'z', -1, 6.0, 4.8, 3.2));
        const lip = base - q.uTop / TRACK_SCALE;
        p.add(new Slab(45, 70, lip - 3.2, lip, 4.8, SMOOTH, CONCRETE, 4.8));
        p.coping(45, 70, lip, 4.8);
        p.add(new Bank(45, 70, -90, lip - 3.2, 'z', 0, 4.8));
        p.rail(69.3, 0.3, -88, 69.3, 4.7, lip - 4, 0.03);
      }

      // South-central: a compact mini-halfpipe between the two mega drops —
      // two facing walls and a channel between them, for fast combos on the
      // way from one big feature to the next.
      {
        const a = p.add(new Quarter(18, 38, -56, 'z', -1, 2.2, 1.5, 1.2));
        p.add(new Slab(18, 38, -56 - a.uTop / TRACK_SCALE - 1.2, -56 - a.uTop / TRACK_SCALE, 1.5, SMOOTH, CONCRETE, 1.5));
        p.coping(18, 38, -56 - a.uTop / TRACK_SCALE, 1.5);
        const b = p.add(new Quarter(18, 38, -44, 'z', 1, 2.2, 1.5, 1.2));
        p.add(new Slab(18, 38, -44 + b.uTop / TRACK_SCALE, -44 + b.uTop / TRACK_SCALE + 1.2, 1.5, SMOOTH, CONCRETE, 1.5));
        p.coping(18, 38, -44 + b.uTop / TRACK_SCALE, 1.5);
        p.rail(28, 0.4, -53, 28, 0.4, -47, 0.028);
      }

      // Southwest: a three-block ledge row, technical and low, so not every
      // corner of the map is about airtime.
      for (let i = 0; i < 3; i++) {
        const x0 = -45 + i * 7, x1 = x0 + 5, y = 0.3 + i * 0.08;
        p.add(new Bank(x0, x0 + 0.6, -65, -55, 'x', 0, y));
        p.add(new Slab(x0 + 0.6, x1, -65, -55, y, SMOOTH, CONCRETE, 0.3 + y));
        p.ledge(x0 + 0.6, y, -65, x1, y, -65);
        p.ledge(x0 + 0.6, y, -55, x1, y, -55);
      }

      // A few more, scattered further out, so there is always one within
      // reach of wherever a line through the district happens to run.
      p.rail(-30, 0.4, 30, -18, 0.4, 30, 0.028);
      p.rail(0, 0.4, -30, 0, 0.4, -40, 0.028);
    },
  },

  {
    id: 'pool',
    name: 'The Pool',
    blurb: 'A kidney pool with a deep end and a shallow end. Pump it end to end.',
    seed: 0x0af7,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -16, yaw: 0 },
    patrol: [
      { x: 0, z: -14 }, { x: 9, z: -2 }, { x: 9, z: 8 }, { x: 0, z: 16 },
      { x: -9, z: 8 }, { x: -9, z: -2 },
    ],
    logos: [
      { x: 0, z: -9 }, { x: 6, z: 2 }, { x: 0, z: 9 }, { x: -6, z: 2 },
      { x: 9, z: 14 }, { x: -9, z: 14 },
    ],
    build(p) {
      // Deep end, north — full coping, a real deck behind it to drop in from.
      const n = p.add(new Quarter(-9, 9, 11, 'z', 1, 3.8, 3.1, 2.0));
      p.add(new Slab(-9, 9, 11 + n.uTop / TRACK_SCALE, 11 + n.uTop / TRACK_SCALE + 2.0, 3.1, SMOOTH, CONCRETE, 3.1));
      p.coping(-9, 9, 11 + n.uTop / TRACK_SCALE, 3.1);

      // Shallow end, south — lower than the deep end, but still a real deck
      // behind the coping: a wall with nothing behind it is a cliff, not a
      // shallow end, and rolling straight in from the flat outside it would
      // hit that cliff rather than ride up it.
      const s = p.add(new Quarter(-9, 9, -7, 'z', -1, 2.2, 1.2, 1.0));
      p.add(new Slab(-9, 9, -7 - s.uTop / TRACK_SCALE - 1.0, -7 - s.uTop / TRACK_SCALE, 1.2, SMOOTH, CONCRETE, 1.25));
      p.coping(-9, 9, -7 - s.uTop / TRACK_SCALE, 1.2);

      // The two side walls, graduated between the two ends so a line carries
      // smoothly from the shallow side into the deep one.
      const e = p.add(new Quarter(-7, 11, 9, 'x', 1, 3.1, 2.1, 1.2));
      p.add(new Slab(9 + e.uTop / TRACK_SCALE, 9 + e.uTop / TRACK_SCALE + 1.2, -7, 11, 2.1, SMOOTH, CONCRETE, 2.1));
      p.copingZ(9 + e.uTop / TRACK_SCALE, 2.1, -7, 11);

      const w = p.add(new Quarter(-7, 11, -9, 'x', -1, 3.1, 2.1, 1.2));
      p.add(new Slab(-9 - w.uTop / TRACK_SCALE - 1.2, -9 - w.uTop / TRACK_SCALE, -7, 11, 2.1, SMOOTH, CONCRETE, 2.1));
      p.copingZ(-9 - w.uTop / TRACK_SCALE, 2.1, -7, 11);

      // A flat bar down the middle of the floor, end to end.
      p.rail(0, 0.4, -4, 0, 0.4, 8, 0.03);

      // More rails, either side of it and one crossing between them.
      p.rail(-5, 0.4, -4, -5, 0.4, 8, 0.03);
      p.rail(5, 0.4, -4, 5, 0.4, 8, 0.03);
      p.rail(-6, 0.4, 2, 6, 0.4, 2, 0.03);
    },
  },

  {
    id: 'rooftop',
    name: 'Rooftops',
    blurb: 'Two rooftops and a real gap between them. Ollie it, or ride the rail.',
    seed: 0x5af1,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -16, yaw: 0 },
    patrol: [
      { x: 0, z: -16 }, { x: 10, z: -6 }, { x: 16, z: 6 }, { x: 0, z: 14 },
      { x: -14, z: 4 }, { x: -8, z: -8 },
    ],
    logos: [
      { x: 0, z: -10 }, { x: 0, z: -2 }, { x: 15, z: -2 }, { x: 0, z: 8 },
      { x: -12, z: 0 }, { x: 8, z: 14 },
    ],
    build(p) {
      // Roof A: a ramp straight off the spawn, up onto a low rooftop.
      p.add(new Bank(-6, 6, -14, -8, 'z', 0, 1.8));
      p.add(new Slab(-6, 6, -8, 2, 1.8, SMOOTH, CONCRETE, 1.9));
      p.ledge(-6, 1.8, -8, -6, 1.8, 2);
      p.ledge(6, 1.8, -8, 6, 1.8, 2);

      // Roof B: taller, across a real gap. Nothing bridges it but the rail —
      // clearing it clean with an ollie is the other way over.
      p.add(new Slab(10, 20, -8, 2, 3.6, SMOOTH, CONCRETE, 3.7));
      p.add(new Bank(20, 24, -8, 2, 'x', 3.6, 0));
      p.rail(6.3, 1.9, -3, 9.7, 3.7, -3, 0.03);

      // A stair set and handrail off the back of Roof A, so there is a way
      // down that is not the gap.
      p.add(new Stairs(-6, 6, 2, 'z', 1, 6, 0.3, 0.5));
      p.rail(6.4, 1.9, 2.3, 6.4, 0.06, 4.9, 0.028);

      // A flat bar out on open ground, well clear of both roofs.
      p.rail(-14, 0.4, -4, -14, 0.4, 6, 0.028);

      // More rails: a second gap-spanning bar, one up on Roof B's own deck,
      // and one further out on the ground behind the roofs.
      p.rail(6.3, 1.9, -1, 9.7, 3.7, -1, 0.03);
      p.rail(12, 3.65, -6, 18, 3.65, -6, 0.028);
      p.rail(-14, 0.4, 10, -6, 0.4, 10, 0.028);
    },
  },

  {
    id: 'snake',
    name: 'Snake Run',
    blurb: 'A weaving channel with a wall on alternating sides. Pure carving.',
    seed: 0x3fd8,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -18, yaw: 0 },
    patrol: [
      { x: 0, z: -17 }, { x: -5, z: -10 }, { x: 5, z: 0 }, { x: -5, z: 8 },
      { x: 0, z: 15 }, { x: 5, z: -4 },
    ],
    logos: [
      { x: -5, z: -10 }, { x: 5, z: -2 }, { x: -5, z: 5 }, { x: 0, z: 12 },
      { x: 6, z: 10 }, { x: -6, z: -3 },
    ],
    build(p) {
      // Three walls, alternating sides down a shared channel — carve one,
      // cross to the next, carve the other way. No flat line down the middle
      // works; the S-turn is the ride.
      const a = p.add(new Quarter(-14, -6, -8, 'x', -1, 2.6, 1.4));
      p.copingZ(-8 - a.uTop / TRACK_SCALE, 1.4, -14, -6);

      const b = p.add(new Quarter(-4, 4, 8, 'x', 1, 2.6, 1.4));
      p.copingZ(8 + b.uTop / TRACK_SCALE, 1.4, -4, 4);

      const c = p.add(new Quarter(6, 14, -8, 'x', -1, 2.6, 1.4));
      p.copingZ(-8 - c.uTop / TRACK_SCALE, 1.4, 6, 14);

      // A small kicker at the north end to pop off, and one flat bar near the
      // entrance for a grind on the way in.
      p.add(new Quarter(-4, 4, 14, 'z', 1, 1.7, 0.65));
      p.rail(0, 0.4, -16, 0, 0.4, -10, 0.028);

      // More rails, tucked into the open channel beside each wall in turn.
      p.rail(-6, 0.4, -10, 2, 0.4, -10, 0.028);
      p.rail(3, 0.4, 0, 7, 0.4, 0, 0.028);
      p.rail(-6, 0.4, 10, 2, 0.4, 10, 0.028);
    },
  },

  {
    id: 'schoolyard',
    name: 'Schoolyard',
    blurb: 'Curbs, a loading ledge and a picnic table. Tight and technical.',
    seed: 0x2c9a,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -18, yaw: 0 },
    patrol: [
      { x: 0, z: -18 }, { x: 10, z: -10 }, { x: 10, z: 6 }, { x: 0, z: 14 },
      { x: -12, z: 6 }, { x: -12, z: -10 },
    ],
    logos: [
      { x: 0, z: -12 }, { x: 10, z: -2 }, { x: 0, z: 6 }, { x: -12, z: -2 },
      { x: 6, z: 12 }, { x: -6, z: 12 },
    ],
    build(p) {
      // A loading-dock ledge down the west side.
      p.add(new Bank(-18, -15, -9, 9, 'x', 0, 0.44));
      p.add(new Slab(-15, -11, -9, 9, 0.44, SMOOTH, CONCRETE, 0.5));
      p.ledge(-11, 0.44, -9, -11, 0.44, 9);
      p.ledge(-15, 0.44, -9, -15, 0.44, 9);

      // A picnic-table hip in the middle of the yard.
      p.add(new Bank(-3, 0, 8, 14, 'x', 0, 0.55));
      p.add(new Bank(0, 3, 8, 14, 'x', 0.55, 0));

      // A short stair set with a handrail, near the spawn.
      p.add(new Bank(9, 15, -16, -12, 'z', 0, 1.0));
      p.add(new Slab(9, 15, -12, -6, 1.0, SMOOTH, CONCRETE, 1.05));
      p.add(new Stairs(9, 15, -6, 'z', 1, 4, 0.25, 0.52));
      p.rail(15.4, 1.1, -6.3, 15.4, 0.06, -4.0, 0.028);

      // A flat bar on the east side.
      p.rail(11, 0.4, 4, 11, 0.4, 12, 0.028);

      // More rails: one clear of the loading ledge, one by the picnic hip,
      // and one further out on the newly open east ground.
      p.rail(-8, 0.4, -16, -8, 0.4, -2, 0.028);
      p.rail(-6, 0.4, 6, 6, 0.4, 6, 0.028);
      p.rail(20, 0.4, -10, 20, 0.4, 4, 0.028);
    },
  },

  {
    id: 'docks',
    name: 'The Docks',
    blurb: 'Loading docks at three different heights. Gaps, not ramps, link them.',
    seed: 0x88b3,
    padOnly: true,
    spawn: { x: 0, y: 0, z: -20, yaw: 0 },
    patrol: [
      { x: 0, z: -20 }, { x: 12, z: -10 }, { x: 12, z: 6 }, { x: 0, z: 16 },
      { x: -12, z: 6 }, { x: -12, z: -10 },
    ],
    logos: [
      { x: 0, z: -14 }, { x: 12, z: -4 }, { x: 0, z: 4 }, { x: -12, z: -4 },
      { x: 6, z: 14 }, { x: -6, z: 14 },
    ],
    build(p) {
      // Dock A: low, right off the spawn, ramped up from the ground.
      p.add(new Bank(-8, 8, -16, -12, 'z', 0, 1.2));
      p.add(new Slab(-8, 8, -12, -4, 1.2, SMOOTH, CONCRETE, 1.25));
      p.ledge(-8, 1.2, -12, -8, 1.2, -4);
      p.ledge(8, 1.2, -12, 8, 1.2, -4);

      // Dock B: a real gap north of A — no ramp between them, just air, or
      // the rail spanning it.
      p.add(new Slab(-8, 8, 0, 8, 2.2, SMOOTH, CONCRETE, 2.3));
      p.add(new Bank(-8, 8, 8, 12, 'z', 2.2, 0));
      p.rail(-1.4, 1.3, -3.6, -1.4, 2.3, 0.4, 0.03);

      // Dock C: taller still, reached the same way — jump the second gap, or
      // ride the long way round on the ground and up its own ramp.
      p.add(new Slab(-6, 6, 14, 22, 3.4, SMOOTH, CONCRETE, 3.5));
      p.add(new Bank(-6, 6, 22, 26, 'z', 3.4, 0));
      p.rail(-1, 2.4, 7.6, -1, 3.5, 14.4, 0.03);

      // More rails: two flanking Dock A's own ramp, and one up on Dock B's
      // deck for a line that stays up top instead of dropping to the gap.
      p.rail(-8, 0.4, -20, -8, 0.4, -16, 0.028);
      p.rail(8, 0.4, -20, 8, 0.4, -16, 0.028);
      p.rail(3, 2.25, 1, 3, 2.25, 7, 0.028);
    },
  },

  {
    id: 'yard',
    name: 'The Yard',
    blurb: 'A fenced concrete yard, twin hips and a manual box. Every wheel — yours and theirs — stays on the pad.',
    seed: 0x7c31,
    // The one map that keeps the player and every AI skater off the dirt
    // entirely — see Park.padOnly. The fence is not just for show here.
    padOnly: true,
    extentX: 23,
    extentZ: 26,
    spawn: { x: 0, y: 0, z: -20, yaw: 0 },
    patrol: [
      { x: 0, z: -21 }, { x: 15, z: -8 }, { x: 12, z: 10 }, { x: 0, z: 12 },
      { x: -12, z: 10 }, { x: -15, z: -8 },
    ],
    logos: [
      { x: 0, z: -14 }, { x: -14, z: -8 }, { x: 14, z: -8 },
      { x: 0, z: 4 }, { x: -13, z: 12 }, { x: 13, z: 12 },
    ],
    build(p) {
      // --- twin hips at the back, facing each other across a walk-through
      // gap — a rail spans the gap for a line that crosses between them. ---
      const qpL = p.add(new Quarter(-19, -5, 14, 'z', 1, 2.6, 1.8, 2.4));
      const deckL = 14 + qpL.uTop / TRACK_SCALE;
      p.add(new Slab(-19, -5, deckL, deckL + 2.4, 1.8, SMOOTH, CONCRETE, 1.9));
      p.coping(-19, -5, deckL, 1.8);

      const qpR = p.add(new Quarter(5, 19, 14, 'z', 1, 2.6, 1.8, 2.4));
      const deckR = 14 + qpR.uTop / TRACK_SCALE;
      p.add(new Slab(5, 19, deckR, deckR + 2.4, 1.8, SMOOTH, CONCRETE, 1.9));
      p.coping(5, 19, deckR, 1.8);

      p.rail(-5, 0.4, 13.6, 5, 0.4, 13.6, 0.03);

      // --- centre manual box: bank up, flat, bank down, rail on top --------
      p.add(new Bank(-3, 3, -5, -2, 'z', 0, 0.44));
      p.add(new Slab(-3, 3, -2, 2, 0.44, SMOOTH, CONCRETE, 0.5));
      p.add(new Bank(-3, 3, 2, 5, 'z', 0.44, 0));
      p.rail(0, 0.76, -1.9, 0, 0.76, 1.9, 0.028);
      p.ledge(-3, 0.44, -2, -3, 0.44, 2);
      p.ledge(3, 0.44, -2, 3, 0.44, 2);

      // --- west wall: a real transition, not just a rail on a slope --------
      const qpW = p.add(new Quarter(-14, -2, -9, 'x', -1, 2.2, 1.4, 1.6));
      const deckW = -9 - qpW.uTop / TRACK_SCALE;
      p.add(new Slab(deckW - 1.6, deckW, -14, -2, 1.4, SMOOTH, CONCRETE, 1.5));
      p.copingZ(deckW, 1.4, -14, -2);

      // --- east side: a straight ledge, for the line the west wall doesn't
      // give you ------------------------------------------------------------
      p.add(new Bank(9, 9.6, -14, -2, 'x', 0, 0.42));
      p.add(new Slab(9.6, 15, -14, -2, 0.42, SMOOTH, CONCRETE, 0.46));
      p.ledge(9.6, 0.42, -14, 9.6, 0.42, -2);
    },
  },

  {
    id: 'skyline',
    name: 'The Skyline',
    blurb: 'Two towering walls face off down a run of long rails. Pick a line and fly.',
    seed: 0x91e3,
    padOnly: true,
    extentX: 30,
    extentZ: 26,
    spawn: { x: 0, y: 0, z: -16, yaw: 0 },
    patrol: [
      { x: 0, z: -18 }, { x: 6, z: -6 }, { x: 6, z: 8 }, { x: 0, z: 18 },
      { x: -6, z: 8 }, { x: -6, z: -6 },
    ],
    logos: [
      { x: 0, z: -12 }, { x: -6, z: -2 }, { x: 6, z: -2 }, { x: 0, z: 10 },
      { x: -10, z: 14 }, { x: 14, z: 12 },
    ],
    build(p) {
      // --- the two big walls: the tallest transitions here, facing each
      // other down the whole length of the park -----------------------------
      const n = p.add(new Quarter(-15, 15, 20, 'z', 1, 4.2, 3.5, 3.0));
      p.add(new Slab(-15, 15, 20 + n.uTop / TRACK_SCALE, 20 + n.uTop / TRACK_SCALE + 3.0, 3.5, SMOOTH, CONCRETE, 3.5));
      p.coping(-15, 15, 20 + n.uTop / TRACK_SCALE, 3.5);

      const s = p.add(new Quarter(-15, 15, -20, 'z', -1, 4.2, 3.5, 3.0));
      p.add(new Slab(-15, 15, -20 - s.uTop / TRACK_SCALE - 3.0, -20 - s.uTop / TRACK_SCALE, 3.5, SMOOTH, CONCRETE, 3.5));
      p.coping(-15, 15, -20 - s.uTop / TRACK_SCALE, 3.5);

      // --- the long rails: two bars running the full length of the park,
      // so a single grind carries from one wall all the way to the other ----
      p.rail(-8, 0.4, -18, -8, 0.4, 18, 0.028);
      p.rail(8, 0.4, -18, 8, 0.4, 18, 0.028);

      // --- centre manual box: the one thing between the walls to link a
      // line, roll over, or pop off -----------------------------------------
      p.add(new Bank(-2.5, 2.5, -6, -3, 'z', 0, 0.5));
      p.add(new Slab(-2.5, 2.5, -3, 3, 0.5, SMOOTH, CONCRETE, 0.55));
      p.add(new Bank(-2.5, 2.5, 3, 6, 'z', 0.5, 0));
      p.rail(0, 0.81, -2.9, 0, 0.81, 2.9, 0.028);
      p.ledge(-2.5, 0.5, -3, -2.5, 0.5, 3);
      p.ledge(2.5, 0.5, -3, 2.5, 0.5, 3);

      // --- west hip: a banked ledge for carving on the way to the walls ----
      p.add(new Bank(-22, -12, 6, 16, 'x', 1.3, 0));
      p.add(new Slab(-22, -12, 16, 20, 1.3, SMOOTH, CONCRETE, 1.4));
      p.ledge(-12, 0, 6, -12, 0, 16);

      // --- east stair set and handrail: the way down off a high deck ------
      p.add(new Bank(11, 17, 4, 8, 'z', 0, 1.2));
      p.add(new Slab(11, 17, 8, 14, 1.2, SMOOTH, CONCRETE, 1.3));
      p.add(new Stairs(11, 17, 14, 'z', 1, 5, 0.24, 0.56));
      p.rail(12.2, 1.31, 13.5, 12.2, 0.06, 15.8, 0.028);
    },
  },
];

export const DEFAULT_PARK = PARKS[0];

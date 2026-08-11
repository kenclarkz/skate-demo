// The board: a 32" deck with real kicks, two trucks, and four wheels that spin
// at the speed the board is actually travelling.
//
// Board-local axes, used by every other module and worth memorising:
//
//   +Z  the nose            -Z  the tail
//   +Y  up through the grip tape
//   +X  the rider's heel side       -X  the toe side
//
// The heel/toe assignment follows from the stance rather than being a choice:
// with the nose at +Z and up at +Y, a regular-footed rider (left foot forward)
// ends up facing -X, so their toes hang over -X and their heels over +X. Every
// trick that has a direction — kickflips, heelflips, shuvits — is signed off
// that fact.
//
// Every colour on the board comes from a palette (see boards.js for the
// catalogue), so a skin is nothing more than a different set of seven colours
// plus one accent stripe down the grip tape — there is no texture anywhere on
// it, the same way there is nowhere else in this game. The one thing a
// palette does not own is the neon under glow, which comes from the board
// maker's design and is drawn as its own self-lit emissive strips.

import * as THREE from '../game/three.js';
import { box, piece, merge } from '../game/geo.js';
import * as C from './config.js';
import { buildDesignBlocks } from './board-design.js';

export const DEFAULT_PALETTE = {
  deck: 0x9b6a3f,   // maple plys, seen from below
  grip: 0x1b1b1e,   // grip tape
  accent: 0xd6c064, // the stripe down the middle of the grip
  ply: 0xd8b183,    // the light edge of the laminate
  truck: 0xb9bec6,
  wheel: 0xe6e2d8,
  bearing: 0x8d8f93,
  bolt: 0x6e7378,
};

/**
 * A board's shape: everything about the deck's own silhouette that a skin
 * does not touch. The trucks and wheels stay exactly where physics puts
 * them — at ±WHEELBASE/2, at WHEEL_R off the ground — on every one of these;
 * only the deck built around that fixed contact patch changes size and kick,
 * the way a longboard's deck really does overhang its trucks a lot more than
 * a penny board's tiny one does. Riding one is identical to riding any other:
 * this is the same "no shape reaches the physics" rule the palette already
 * follows, just for length and width instead of colour.
 */
export const DEFAULT_SHAPE = {
  deckLen: C.DECK_LEN, // nose to tail
  deckW: C.DECK_W,
  kickStart: C.KICK_START, // half the flat middle; where the kick begins
};

/**
 * One end of the deck, kicked up by NOSE_KICK.
 *
 * A rotation about +X takes +Z towards -Y, so the tail (at -Z) is kicked with a
 * positive angle and the nose (at +Z) with a negative one.
 */
function kickEnd(entries, sign, color, w, t, dy, flat, kickL) {
  const kick = C.NOSE_KICK;
  const cz = sign * (flat + (Math.cos(kick) * kickL) / 2);
  const cy = (Math.sin(kick) * kickL) / 2 + dy;
  entries.push(box(color, w, t, kickL, 0, cy, cz, -sign * kick, 0, 0));
}

// Deck top above the art blocks: the art is a thin printed layer sitting proud
// of the grip tape, drawn as its own set of boxes so a deck can carry a whole
// block-letter logo, a checkerboard or a pixel drawing at zero texture cost.
export const ART_H = 0.0035;

function buildDeck(p, shape, design) {
  const entries = [];
  const W = shape.deckW;
  const T = C.DECK_T;
  const flat = shape.kickStart;
  const kickL = (shape.deckLen - 2 * flat) / 2;

  // Underside: the maple, flat middle plus both kicks.
  entries.push(box(p.deck, W, T, flat * 2, 0, 0, 0));
  kickEnd(entries, 1, p.deck, W, T, 0, flat, kickL);
  kickEnd(entries, -1, p.deck, W, T, 0, flat, kickL);

  // Grip tape sits on top, a hair proud of the deck and a hair narrower, so the
  // pale laminate edge shows all the way round — which is what makes a board
  // read as a board from the camera's low angle rather than as a dark plank.
  const g = T * 0.34;
  entries.push(box(p.grip, W - 0.008, g, flat * 2, 0, T / 2 + g / 2, 0));
  kickEnd(entries, 1, p.grip, W - 0.008, g, T / 2 + g / 2, flat, kickL);
  kickEnd(entries, -1, p.grip, W - 0.008, g, T / 2 + g / 2, flat, kickL);

  // A pale stripe along each edge, standing in for the visible ply lines.
  for (const s of [-1, 1]) {
    entries.push(box(p.ply, 0.006, T * 0.9, flat * 2, (s * (W - 0.006)) / 2, 0, 0));
  }

  // Board art. With no design every skin gets the one accent stripe down the
  // middle of the grip; a design replaces that stripe with its own blocks —
  // chunky coloured boxes proud of the tape, merged into the same draw call
  // as the deck, never a texture.
  const art = buildDesignBlocks(shape, design);
  if (art.skipStripe) {
    const y = T / 2 + g + ART_H / 2;
    for (const b of art.top) {
      entries.push(box(b.color, b.w, ART_H, b.d, b.x, y, b.z, 0, b.rot || 0, 0));
    }
  } else {
    entries.push(box(p.accent, W * 0.32, g * 0.7, flat * 1.9, 0, T / 2 + g + 0.0005, 0));
  }

  // The back of the deck: the underside carries its own design, blocks hanging
  // a hair below the maple so the deck reads painted from underneath too —
  // flip the board in the maker and the back pattern is there. Same flat
  // mid-area as the grip art, same zero-texture merged draw call.
  const by = -T / 2 - ART_H / 2;
  for (const b of art.back) {
    entries.push(box(b.color, b.w, ART_H, b.d, b.x, by, b.z, 0, b.rot || 0, 0));
  }

  return entries;
}

function buildTruck(entries, z, p) {
  const T = C.DECK_T;
  const under = -T / 2;
  // Baseplate, hanger, axle, kingpin. Small pieces, but the silhouette of a
  // skateboard from behind is mostly trucks and wheels.
  entries.push(box(p.truck, 0.075, 0.008, 0.055, 0, under - 0.004, z));
  entries.push(box(p.truck, 0.10, 0.026, 0.042, 0, under - 0.024, z + Math.sign(z) * -0.012));
  const axle = new THREE.CylinderGeometry(0.0045, 0.0045, 0.196, 6, 1);
  entries.push(piece(axle, p.truck, 1, 1, 1, 0, under - C.TRUCK_H + 0.008, z, 0, 0, Math.PI / 2));
  entries.push(box(p.bolt, 0.012, 0.03, 0.012, 0, under - 0.02, z + Math.sign(z) * 0.026));
  // Mounting bolts through the deck.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      entries.push(box(p.bolt, 0.008, T * 1.9, 0.008, sx * 0.026, 0, z + sz * 0.019));
    }
  }
  return axle;
}

/** One axle's pair of wheels, merged so the pair spins as a single mesh. */
function buildWheels(p) {
  const entries = [];
  const cyl = new THREE.CylinderGeometry(C.WHEEL_R, C.WHEEL_R, C.WHEEL_W, 12, 1);
  const core = new THREE.CylinderGeometry(C.WHEEL_R * 0.42, C.WHEEL_R * 0.42, C.WHEEL_W + 0.004, 8, 1);
  for (const s of [-1, 1]) {
    const x = s * 0.088;
    entries.push(piece(cyl, p.wheel, 1, 1, 1, x, 0, 0, 0, 0, Math.PI / 2));
    // The dark core is what makes the spin visible at all: a plain urethane
    // cylinder rotating about its own axis looks completely static.
    entries.push(piece(core, p.bearing, 1, 1, 1, x, 0, 0, 0, 0, Math.PI / 2));
  }
  const geo = merge(entries, 6);
  cyl.dispose();
  core.dispose();
  return geo;
}

// --- neon under glow -------------------------------------------------------
// A neon tube hugs the underside edge of the deck all the way round — along
// both long sides, over the kicks, and across the nose and tail tips. It is
// drawn as two layers, a wide dim halo under a narrow hot core, both emissive
// and self-lit so it reads as neon at any hour of the day or night. Like every
// other part of the board it is plain geometry, no texture.
const GLOW_GAP = 0.004; // how far the tube hangs below the deck's underside
const GLOW_CORE_H = 0.006; // the bright core's height (thickness in y)
const GLOW_HALO_H = 0.011; // the dim halo's height
const GLOW_HALO_PAD = 0.012; // how much wider the halo is than the core, each side
const GLOW_EDGE = 0.004; // the tube's inset from the deck's outer edge
const GLOW_CORE_W = 0.005; // the core's width along the deck
const GLOW_TIP_W = 0.006; // the tip bars' thickness along the kick

/**
 * The under-glow geometry, in the same deck-local space buildDeck uses (the
 * deck's origin at its centre, +Y up through the grip tape). Returns the
 * boxes for the halo and the core separately, because they need different
 * emissive intensities and therefore different materials.
 */
function buildGlow(shape, glowColor) {
  const halo = [];
  const core = [];
  const W = shape.deckW;
  const flat = shape.kickStart;
  const kickL = (shape.deckLen - 2 * flat) / 2;
  const edge = W / 2 - GLOW_EDGE;
  const ly = -C.DECK_T / 2 - GLOW_GAP;
  // One run of tube: a dim halo sitting a hair above the hot core, so their
  // faces never coincide and there is no z-fighting in the overlap.
  const tube = (cx, cy, cz, rx, span, d) => {
    halo.push(box(glowColor, span + GLOW_HALO_PAD, GLOW_HALO_H, d, cx, cy + 0.0015, cz, rx, 0, 0));
    core.push(box(glowColor, span, GLOW_CORE_H, d, cx, cy - 0.0015, cz, rx, 0, 0));
  };
  // The flat middle and both kicked ends, down each long edge.
  for (const s of [-1, 1]) {
    tube(s * edge, ly, 0, 0, GLOW_CORE_W, flat * 2);
    for (const sign of [1, -1]) {
      // Mirror kickEnd(): the kick is a box rotated about +X and parked at the
      // end of the flat; the tube rides the same rotation, offset below it.
      const kick = C.NOSE_KICK;
      const cz = sign * (flat + (Math.cos(kick) * kickL) / 2);
      const cy = (Math.sin(kick) * kickL) / 2;
      const rx = -sign * kick;
      tube(s * edge, cy + ly * Math.cos(rx), cz + ly * Math.sin(rx), rx, GLOW_CORE_W, kickL);
    }
  }
  // A bar across each kick tip, closing the perimeter.
  for (const sign of [1, -1]) {
    const kick = C.NOSE_KICK;
    const cz = sign * (flat + (Math.cos(kick) * kickL) / 2);
    const cy = (Math.sin(kick) * kickL) / 2;
    const rx = -sign * kick;
    const lz = (sign * kickL) / 2;
    tube(
      0,
      cy + ly * Math.cos(rx) - lz * Math.sin(rx),
      cz + ly * Math.sin(rx) + lz * Math.cos(rx),
      rx,
      W * 0.9,
      GLOW_TIP_W
    );
  }
  return { halo, core };
}

export class Board {
  constructor(palette = DEFAULT_PALETTE, shape = DEFAULT_SHAPE, design = null) {
    this.group = new THREE.Group();
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 40,
      specular: 0x3a3d42,
    });
    this.spin = 0;
    this.build(palette, shape, design);
  }

  /** (Re)builds the deck and wheel meshes from a palette, a shape and an
   * optional board-maker design. Safe to call again on a live board — the
   * store re-skins the one instance in place rather than handing the ride
   * model a new one to track. */
  build(palette, shape = this.shape || DEFAULT_SHAPE, design = null) {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry.dispose();
    }
    // The glow tubes carry their own per-board materials (each design can pick
    // a different colour), so they are disposed here rather than reused like
    // the shared deck material.
    if (this._glowMats) {
      for (const m of this._glowMats) m.dispose();
      this._glowMats = null;
    }
    this.palette = palette;
    this.shape = shape;
    this.design = design;

    const entries = buildDeck(palette, shape, design);
    const a1 = buildTruck(entries, C.WHEELBASE / 2, palette);
    const a2 = buildTruck(entries, -C.WHEELBASE / 2, palette);
    // uvScale 8: the deck is 20 cm across, so a texture repeating every three
    // metres — the park's scale — would not vary across it at all.
    const deckGeo = merge(entries, 8);
    a1.dispose();
    a2.dispose();

    this.deck = new THREE.Mesh(deckGeo, this.material);
    // The deck's origin is the middle of the board at deck level; lifting it by
    // the axle height puts the wheels' contact patch at the group's own origin,
    // which is the point physics tracks along the ground.
    this.deck.position.y = C.WHEEL_R + C.TRUCK_H;
    this.group.add(this.deck);

    const wheelGeo = buildWheels(palette);
    this.axles = [];
    for (const z of [C.WHEELBASE / 2, -C.WHEELBASE / 2]) {
      const m = new THREE.Mesh(wheelGeo, this.material);
      m.position.set(0, C.WHEEL_R, z);
      this.group.add(m);
      this.axles.push(m);
    }

    // The neon under glow, if the design asks for one. Self-lit emissive
    // strips under the deck edges; two meshes so the halo can be a dim wash
    // under the hot core.
    this.glow = [];
    const glowColor = design && design.underGlow != null ? design.underGlow : null;
    if (glowColor != null) {
      const { halo, core } = buildGlow(shape, glowColor);
      this._glowMats = [
        new THREE.MeshPhongMaterial({ color: 0x05070b, emissive: glowColor, emissiveIntensity: 0.55 }),
        new THREE.MeshPhongMaterial({ color: 0x05070b, emissive: glowColor, emissiveIntensity: 2.2 }),
      ];
      const y = C.WHEEL_R + C.TRUCK_H;
      const haloMesh = new THREE.Mesh(merge(halo, 8), this._glowMats[0]);
      const coreMesh = new THREE.Mesh(merge(core, 8), this._glowMats[1]);
      haloMesh.position.y = y;
      coreMesh.position.y = y;
      this.group.add(haloMesh, coreMesh);
      this.glow = [haloMesh, coreMesh];
    }
  }

  /**
   * Roll the wheels. ω = v / r, which at 8 m/s on 54 mm wheels is 296 rad/s —
   * genuinely 47 revolutions a second, so the dark bearing core smears into a
   * grey ring exactly as it does on a real board.
   *
   * `speed` is signed by the direction of travel, so rolling fakie spins the
   * wheels back the way they came instead of forwards — a board moving
   * tail-first does not spin its wheels the way one moving nose-first does.
   */
  roll(dt, speed) {
    this.spin = (this.spin + (speed / C.WHEEL_R) * dt) % (Math.PI * 2);
    // The axles are mounted across the board, so the spin is about local X.
    for (const a of this.axles) a.rotation.x = this.spin;
  }
}

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();

/**
 * Place the board from three loose ragdoll points, in world space.
 *
 * Three points are exactly enough to pin down a full orientation: the nose and
 * tail give the length, and the third — out to the heel side — gives the roll, so
 * a kicked-out board tumbles end over end *and* spins about its own length. Only
 * valid while the group is parented to the scene rather than to the ride frame.
 */
Board.prototype.poseFree = function poseFree(nose, tail, side) {
  _bz.subVectors(nose.p, tail.p).normalize();
  // Measured from the middle of the deck, then squared up against the length, so
  // the roll axis stays perpendicular however far the constraints have drifted.
  _bx.copy(nose.p).add(tail.p).multiplyScalar(0.5);
  _bx.subVectors(side.p, _bx);
  _bx.addScaledVector(_bz, -_bx.dot(_bz));
  if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0);
  else _bx.normalize();
  _by.crossVectors(_bz, _bx);
  _bm.makeBasis(_bx, _by, _bz);
  this.group.quaternion.setFromRotationMatrix(_bm);
  // The points were sampled at deck height, and the group's origin is the wheels'
  // contact plane, so it hangs that far below the middle of the deck.
  this.group.position
    .copy(nose.p)
    .add(tail.p)
    .multiplyScalar(0.5)
    .addScaledVector(_by, -(C.WHEEL_R + C.TRUCK_H));
};

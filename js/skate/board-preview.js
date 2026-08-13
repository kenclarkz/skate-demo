// The Board Maker's own window: a little block-built skate shop, and the
// shopkeeper who runs it.
//
// Where the old preview was a board on a plinth, this is a counter in a shop.
// The deck under construction sits on the counter in front of you, and a
// block-built shopkeeper behind the counter swaps it the moment you pick a
// different saved board: they reach down behind the counter, set the new deck
// down in front of you, and carry the old one back the same way. Customising
// the deck updates it live where it stands, so every stroke of the paint grid
// lands on the board you are actually building — and every tap of a saved card
// is answered with the take-and-place, never with a board simply popping into
// existence.
//
// Like CharacterPreview, it is a second tiny WebGL scene rendering only this
// room — a separate renderer drawing the real Board (same geometry builder,
// same merged draw call), so what the maker shows is exactly the deck the
// player will ride. The room is built from the same merged-box primitives as
// the park: one draw call for the whole shop, one for the shopkeeper's torso,
// one for their head, and one each for the six arm segments.

import * as THREE from '../game/three.js';
import { box, merge } from '../game/geo.js';
import { Board } from './board.js';
import { DECK_Y } from './config.js';

// --- the room ----------------------------------------------------------------
// All dimensions in metres, the same units the board itself is built in. The
// counter is a slab from z -0.22 to -0.58 with its top at 0.55; the board
// stands on it at DISPLAY (its origin is the wheel-contact plane, so it meets
// the counter the way it meets the concrete). STOCK is a hiding spot just
// behind the counter's back edge, below the sightline over the top — a board
// parked there is out of view until the shopkeeper lifts it above the edge.
const DISPLAY_X = 0;
const DISPLAY_Y = 0.55;
const DISPLAY_Z = -0.40;
const STOCK_Y = 0.34;
const STOCK_Z = -0.66;
const SHOP_Z = -0.90;      // the shopkeeper's feet

// The board is shown with its long axis across the counter (length along X),
// so the nose-to-tail art reads at a glance.
const DISPLAY_YAW = Math.PI / 2;

// The deck rocks gently on the counter like a board being shown off, instead
// of spinning a full turn — on a counter of this size a full rotation would
// tip the ends over the edges, and a careful shopkeeper does not let their
// stock hang off the front. The rock is bounded to the angle where the board's
// own diagonal still clears the counter top, and a grab-the-board drag turns
// it within the same bound.
const SWAY_AMP = 0.15;
const SWAY_SPEED = 0.8;    // radians of phase per second — a lazy, slow rock
const DRAG_MAX = 0.19;     // the widest turn that keeps the deck on the counter

// --- the swap animation ------------------------------------------------------
// PLACE: reach down (hidden behind the counter) while the board waits at
// STOCK, lift it up past the counter's edge, bring it forward over the top and
// settle it on the counter. TAKE mirrors it: lift, carry back, lower out of
// sight. A new board that arrives while a place is still fully hidden simply
// swaps in — the hand comes up holding the deck that was actually picked.
const PLACE_TIME = 1.05;
const TAKE_TIME = 0.95;
const PLACE_SWAP_T = 0.28; // until here the board is still behind the counter
const SPIN_FADE = 0.15;    // the board slows to a stop as the hand reaches for it

// Where the hand holds the deck while carrying it: at the board's back edge,
// a hair proud of the grip tape, so the hand reads as holding the near rim
// rather than hovering over the middle of the art.
const GRIP_Z = -0.10;
const GRIP_Y = DECK_Y + 0.02;

// --- the shopkeeper ----------------------------------------------------------
const PIVOT_Y = 0.62;          // waist: the torso leans forward about here
const SHOULDER_X = 0.19;       // half the shoulder width, off the torso sides
const SHOULDER_Y = 0.38;       // shoulder height above the waist pivot
const UPPER_ARM = 0.34;
const FOREARM = 0.32;
const REST_ACTIVE = new THREE.Vector3(0.24, 0.38, -0.85);   // hidden at the side
const REST_INACTIVE = new THREE.Vector3(-0.24, 0.38, -0.85);
const ELBOW_POLE = new THREE.Vector3(0, -1, -0.2);

// --- helpers -----------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (s) => {
  s = clamp01(s);
  return s * s * (3 - 2 * s);
};

/** Progress of `t` within the window [a, b], clamped to 0..1. */
const seg = (t, a, b) => clamp01((t - a) / (b - a));

/** Where the board's wheel-contact point sits during a place, in world space. */
function placePos(t) {
  let y;
  let z;
  if (t < 0.22) {
    y = STOCK_Y;
    z = STOCK_Z;
  } else if (t < 0.55) {
    y = lerp(STOCK_Y, 0.60, smooth(seg(t, 0.22, 0.55)));   // rise out of hiding
    z = STOCK_Z;
  } else if (t < 0.80) {
    y = 0.60;
    z = lerp(STOCK_Z, DISPLAY_Z, smooth(seg(t, 0.55, 0.80))); // over the counter
  } else {
    y = lerp(0.60, DISPLAY_Y, smooth(seg(t, 0.80, PLACE_TIME))); // settle down
    z = DISPLAY_Z;
  }
  return { x: 0, y, z };
}

/** Where the board's wheel-contact point sits during a take, in world space. */
function takePos(t) {
  let y;
  let z;
  if (t < 0.20) {
    y = DISPLAY_Y;
    z = DISPLAY_Z;
  } else if (t < 0.45) {
    y = lerp(DISPLAY_Y, 0.60, smooth(seg(t, 0.20, 0.45)));    // lift off
    z = DISPLAY_Z;
  } else if (t < 0.68) {
    y = 0.60;
    z = lerp(DISPLAY_Z, STOCK_Z, smooth(seg(t, 0.45, 0.68))); // carry back
  } else {
    y = lerp(0.60, STOCK_Y, smooth(seg(t, 0.68, TAKE_TIME))); // sink out of sight
    z = STOCK_Z;
  }
  return { x: 0, y, z };
}

// --- rig helpers, the same two-bone IK the skater uses ------------------------
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
// The pose loop's own scratch — kept separate from the vectors the helpers
// (bone/solveJoint) use internally, so calling them cannot clobber them.
const _sh = new THREE.Vector3();
const _hd = new THREE.Vector3();
const _elb = new THREE.Vector3();

/** Point a bone from `from` to `to`, its geometry running up its own +Y. */
function bone(obj, from, to, twistRef) {
  _y.subVectors(to, from);
  const len = _y.length();
  if (len < 1e-6) return;
  _y.multiplyScalar(1 / len);
  _x.crossVectors(twistRef, _y);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  else _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from).addScaledVector(_y, len / 2);
}

/**
 * Two-bone inverse kinematics: where does the elbow sit? The joint is on a
 * circle around the shoulder-to-hand line, and `pole` picks which point on it.
 */
function solveJoint(root, target, a, b, pole, out) {
  _u.subVectors(target, root);
  let d = _u.length();
  const min = Math.abs(a - b) + 1e-3;
  const max = a + b - 1e-3;
  if (d < min) d = min;
  else if (d > max) d = max;
  if (_u.lengthSq() < 1e-9) _u.set(0, -1, 0);
  else _u.normalize();

  const x = (d * d + a * a - b * b) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  _p.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1).addScaledVector(_u, -_u.z);
  _p.normalize();
  return out.copy(root).addScaledVector(_u, x).addScaledVector(_p, h);
}

/** Exponential approach towards a target, in one dimension. */
class Spring {
  constructor(value = 0, rate = 8) {
    this.v = value;
    this.rate = rate;
  }

  step(dt, target, rate = this.rate) {
    this.v += (target - this.v) * (1 - Math.exp(-rate * dt));
    return this.v;
  }
}

/** A spring with momentum, so a hand reaches and settles instead of teleporting. */
class Spring3 {
  constructor(k = 220, c = 20) {
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.k = k;
    this.c = c;
  }

  step(dt, target) {
    _s3.subVectors(target, this.p).multiplyScalar(this.k).addScaledVector(this.v, -this.c);
    this.v.addScaledVector(_s3, dt);
    this.p.addScaledVector(this.v, dt);
    return this.p;
  }

  set(target) {
    this.p.copy(target);
    this.v.set(0, 0, 0);
  }
}

export class BoardPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x171c23, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 30);
    this.camera.position.set(0, 0.9, 1.9);
    this.camera.lookAt(0, 0.55, -0.6);

    this.scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x33302a, 2.0));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.9);
    key.position.set(-4, 6, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8aa5d0, 0.7);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);

    // The shop itself, all merged into a single draw call: floor, back wall
    // with a shelf of deck boxes above the shopkeeper, the counter with its
    // maple top, and the dark mat the board stands on.
    this.scene.add(buildShop());

    // The shopkeeper: a merged torso+apron and a merged head, posed in the
    // loop with the same two-bone arm IK the skater rides on. The torso leans
    // forward over the counter from a waist pivot; the head rides its own
    // pivot so it can nod down at the board it is carrying.
    this.shop = new THREE.Group();
    this.shop.position.set(0, 0, SHOP_Z);
    this.scene.add(this.shop);

    this.lean = new THREE.Group();
    this.lean.position.set(0, PIVOT_Y, 0);
    this.shop.add(this.lean);

    const shopMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 14,
      specular: 0x14181f,
    });
    this.lean.add(new THREE.Mesh(
      merge([
        box(0xe8573a, 0.42, 0.46, 0.24, 0, 0.83, 0),      // the shop tee
        box(0x3a4a5c, 0.44, 0.34, 0.26, 0, 0.77, 0.006),   // the apron over it
      ], 6),
      shopMat
    ));

    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 1.06, 0);
    this.lean.add(this.headPivot);
    this.headPivot.add(new THREE.Mesh(
      merge([
        box(0xc98d62, 0.20, 0.24, 0.20, 0, 0.08, 0),        // head
        box(0x1a1a1c, 0.03, 0.02, 0.02, 0.045, 0.11, 0.106), // eyes
        box(0x1a1a1c, 0.03, 0.02, 0.02, -0.045, 0.11, 0.106),
        box(0x33383f, 0.22, 0.07, 0.22, 0, 0.23, 0.005),     // cap
        box(0x2c3138, 0.16, 0.035, 0.10, 0, 0.20, 0.11),     // the brim
      ], 6),
      shopMat
    ));

    // The arms, three boxes each, parented to the lean group so the IK drives
    // them in the torso's own frame and the lean carries the whole rig.
    const teeMat = new THREE.MeshPhongMaterial({ color: 0xe8573a, shininess: 14, specular: 0x14181f });
    const skinMat = new THREE.MeshPhongMaterial({ color: 0xc98d62, shininess: 14, specular: 0x14181f });
    const upperGeo = new THREE.BoxGeometry(0.10, UPPER_ARM, 0.10);
    const foreGeo = new THREE.BoxGeometry(0.085, FOREARM, 0.085);
    const handGeo = new THREE.BoxGeometry(0.075, 0.07, 0.075);
    this.arms = [];
    for (let i = 0; i < 2; i++) {
      const arm = {
        upper: new THREE.Mesh(upperGeo, teeMat),
        fore: new THREE.Mesh(foreGeo, skinMat),
        hand: new THREE.Mesh(handGeo, skinMat),
      };
      this.lean.add(arm.upper, arm.fore, arm.hand);
      this.arms.push(arm);
    }

    // The real Board, standing on the counter. Same instance the whole maker
    // session uses, rebuilt in place by Board.build() on every change.
    this.board = new Board();
    this.board.group.position.set(DISPLAY_X, DISPLAY_Y, DISPLAY_Z);
    this.scene.add(this.board.group);

    // Drag to turn the deck on the counter (yaw only, and only while it is
    // resting — a hand on the board pauses the display rock).
    this._dragging = false;
    this._px = 0;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._px = e.clientX;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this._px;
      this._px = e.clientX;
      if (!this._dragging || this._state !== 'idle') return;
      this._spin = clamp(this._spin + dx * 0.012, -DRAG_MAX, DRAG_MAX);
    });
    const up = () => {
      this._dragging = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    // --- the swap state machine --------------------------------------------
    // `_in` is the board currently built into `this.board` (on the counter or
    // in the shopkeeper's hands); `_pending` is the newest board the player
    // picked, applied when the current animation reaches a rest.
    this._in = null;
    this._pending = null;
    this._state = 'idle'; // 'idle' | 'place' | 'take'
    this._at = 0;
    this._spin = 0;

    // The hand springs: one per arm, resting hidden below the counter top so
    // a spinning board never clips them. The +X hand (index 1) is the one that
    // carries the boards.
    this._hands = [new Spring3(220, 20), new Spring3(220, 20)];
    this._hands[0].set(REST_INACTIVE);
    this._hands[1].set(REST_ACTIVE);
    this._grip = new THREE.Vector3();
    this._leanSpring = new Spring(0.07, 8);
    this._headSpring = new Spring(-0.02, 8);

    this.t = 0;
    this._raf = 0;
    this._last = 0;
  }

  /** Match the canvas's own laid-out size, so the render is never scaled. */
  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Show a deck: palette, shape and the whole design draft.
   *
   * Two very different things arrive here. The draft the player is building —
   * the object with no `id` — changes on every rack tap, and the Board Maker
   * clones it through cleanBoardDraft each time, so no two calls ever pass the
   * same object. The answer for the draft is simple: rebuild it where it
   * stands, every time. A saved deck is different — it carries an `id` from
   * the rack — and a tap on one of those means "put THAT deck in front of
   * me": the shopkeeper takes the current one down and brings the new one up.
   * Either way the design lands on the board immediately, so the answer to
   * "which board is this?" is right from the moment the deck is picked, even
   * while the take-and-place is still catching up.
   */
  setBoard(palette, shape, design) {
    const isSavedDeck = !!(design && design.id != null);
    if (!isSavedDeck) {
      if (this._in) {
        this._apply(palette, shape, design);
        return;
      }
      // The first board of the session: queue it for the entrance place that
      // the first frame will run, instead of popping into existence.
      this._pending = { palette, shape, design };
      this.board.palette = palette;
      this.board.shape = shape;
      this.board.design = design;
      return;
    }
    if (this._in && design === this._in.design) {
      this._apply(palette, shape, design);
      return;
    }
    // Mid-place and still hidden behind the counter: swap in the deck the hand
    // is actually holding — the shopkeeper comes up carrying the new pick.
    if (this._state === 'place' && this._at < PLACE_SWAP_T && !this._pending) {
      this._apply(palette, shape, design);
      return;
    }
    this._pending = { palette, shape, design };
    this.board.palette = palette;
    this.board.shape = shape;
    this.board.design = design;
  }

  /** Rebuild the board in place and record it as the current deck. */
  _apply(palette, shape, design) {
    this._in = { palette, shape, design };
    this.board.build(palette, shape, design);
  }

  /** Start placing a queued deck: rebuild it (already parked at STOCK from the
   * take that just ended) and run the place. */
  _beginPlace(spec) {
    this._apply(spec.palette, spec.shape, spec.design);
    this._pending = null;
    this._spin = 0;
    this._state = 'place';
    this._at = 0;
  }

  /** Advance the swap state machine and move the board through the scene. */
  _advance(dt) {
    if (this._state === 'idle' && this._pending) {
      if (this._in) {
        this._state = 'take'; // take the deck off the counter first
        this._at = 0;
      } else {
        this._beginPlace(this._pending); // first board: nothing to take
      }
    }

    if (this._state === 'take') {
      this._at += dt;
      if (this._at >= TAKE_TIME) {
        if (this._pending) this._beginPlace(this._pending);
        else this._state = 'idle';
      }
    } else if (this._state === 'place') {
      this._at += dt;
      if (this._at >= PLACE_TIME) {
        this._state = 'idle';
        this._at = 0;
      }
    }

    const pos =
      this._state === 'take' ? takePos(this._at) :
      this._state === 'place' ? placePos(this._at) :
      { x: DISPLAY_X, y: DISPLAY_Y, z: DISPLAY_Z };
    this.board.group.position.set(pos.x, pos.y, pos.z);

    // The display rock; while the hand is reaching for a board, the deck slows
    // to a stop so the grab lands on a still board.
    if (this._state === 'idle' && !this._dragging) {
      const target = SWAY_AMP * Math.sin(this.t * SWAY_SPEED);
      this._spin += (target - this._spin) * (1 - Math.exp(-3 * dt));
    }
    let yaw = DISPLAY_YAW + this._spin;
    if (this._state === 'take') {
      yaw = DISPLAY_YAW + this._spin * Math.max(0, 1 - this._at / SPIN_FADE);
    }
    this.board.group.rotation.set(0, yaw, 0);
  }

  /** Pose the shopkeeper: lean, head nod, and both arms. */
  _animate(dt) {
    const working = this._state !== 'idle';
    this.shop.position.y = Math.sin(this.t * 2.2) * 0.004; // a slow breathing bob
    this.lean.rotation.x = this._leanSpring.step(dt, working ? 0.26 : 0.07);
    this.headPivot.rotation.x = this._headSpring.step(dt, working ? 0.10 : -0.02);

    this.lean.updateWorldMatrix(true, false);
    _inv.copy(this.lean.matrixWorld).invert();

    // Where the carrying hand should be: at the board's back edge, above the
    // grip tape. As a place finishes the hand pulls back to its resting place
    // while the board settles, so it reads as letting go rather than hanging
    // over the deck forever.
    const p = this.board.group.position;
    if (working) {
      let gx = 0;
      let gy = p.y + GRIP_Y;
      let gz = p.z + GRIP_Z;
      if (this._state === 'place' && this._at > PLACE_TIME - 0.14) {
        const k = smooth((this._at - (PLACE_TIME - 0.14)) / 0.14);
        gx = lerp(0, REST_ACTIVE.x, k);
        gy = lerp(gy, REST_ACTIVE.y, k);
        gz = lerp(gz, REST_ACTIVE.z, k);
      }
      this._grip.set(gx, gy, gz);
    } else {
      this._grip.copy(REST_ACTIVE);
    }

    for (let i = 0; i < 2; i++) {
      const target = i === 1 ? this._grip : REST_INACTIVE;
      const hand = this._hands[i].step(dt, target);
      _hd.copy(hand).applyMatrix4(_inv); // world → the torso's own frame
      _sh.set(i === 1 ? SHOULDER_X : -SHOULDER_X, SHOULDER_Y, 0);
      solveJoint(_sh, _hd, UPPER_ARM, FOREARM, ELBOW_POLE, _elb);
      bone(this.arms[i].upper, _sh, _elb, ELBOW_POLE);
      bone(this.arms[i].fore, _elb, _hd, ELBOW_POLE);
      this.arms[i].hand.position.copy(_hd);
      this.arms[i].hand.quaternion.copy(this.arms[i].fore.quaternion);
    }
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.t += dt;
      this._advance(dt);
      this._animate(dt);
      this.resize();
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}

/** The whole shop in one merged draw call: room, shelf stock and counter. */
function buildShop() {
  const e = [];
  // Floor and back wall.
  e.push(box(0x2e333b, 3.0, 0.08, 2.1, 0, -0.04, -0.6));
  e.push(box(0x272d36, 3.0, 2.0, 0.08, 0, 1.0, -1.46));
  e.push(box(0x333a44, 3.02, 0.16, 0.1, 0, 0.08, -1.43)); // wall base trim
  // A shelf of deck boxes high on the back wall, above the shopkeeper's head.
  e.push(box(0x3d4651, 1.7, 0.06, 0.18, 0, 1.5, -1.38));
  const stock = [0xc65a3a, 0x3a9aa8, 0xd6c064];
  for (let i = 0; i < stock.length; i++) {
    e.push(box(stock[i], 0.36, 0.045, 0.09, (i - 1) * 0.55, 1.55, -1.36, -0.16, 0, 0));
  }
  // The counter: maple top, dark base and toe, and a pale front lip.
  e.push(box(0x8a6a48, 1.9, 0.06, 0.36, 0, 0.52, -0.4));
  e.push(box(0x5a4632, 1.8, 0.44, 0.3, 0, 0.28, -0.4));
  e.push(box(0x3c2f22, 1.86, 0.06, 0.34, 0, 0.03, -0.4));
  e.push(box(0xd8b183, 1.84, 0.016, 0.016, 0, 0.552, -0.22));
  // The dark mat the board rests on.
  e.push(box(0x1b1b1e, 0.88, 0.012, 0.24, 0, 0.544, -0.4));
  return new THREE.Mesh(
    merge(e, 0.5),
    new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 12, specular: 0x14181f })
  );
}

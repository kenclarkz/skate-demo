// The tutorial's own demonstration: a small second scene, with its own tiny
// renderer, that plays the actual trick a guide step is teaching — driven by
// the same Ride physics the real game runs, not a canned animation. A canned
// clip looks right once and wrong forever if the physics ever changes; this
// cannot drift out of sync with the game it is demonstrating, because it is
// the game.
//
// No video, no recording, no binary asset anywhere: the same reason the rest
// of this game has none. A few boxes' worth of scenery and one Ride is
// cheaper than a single frame of encoded video, and it never goes stale.

import * as THREE from '../game/three.js';
import { Park } from './park.js';
import { Board } from './board.js';
import { Skater } from './skater.js';
import { Ride } from './physics.js';
import { Walker } from './walk.js';

const FIXED_DT = 1 / 120;

/**
 * Every demo but the on-foot one is a Ride, scripted rather than played: a
 * spawn speed, how long to hold the charge, when (if ever) to fire a trick,
 * and where to put the camera for it. `loop` is how long one pass runs
 * before it resets and plays again — long enough to land and settle, short
 * enough that a glance at the card catches the whole thing.
 */
const PROGRAMS = {
  carve: { loop: 3.2, close: [2.6, 1.2, 2.0, 0.85], speed: 4.5, steerFn: (t) => Math.sin(t * 1.6) * 0.8 },
  // Held for the whole loop now, matching what holding the real key does —
  // physics.js's own cooldown is what paces the repeats, not this.
  push: { loop: 2.4, close: [-2.4, 1.4, 1.0, 0.5], speed: 2.0, pushHeld: true },
  // Rolling in, then holding the brake scrubs the run down to a standstill and
  // holds it there — a brake is a hold, not a tap, exactly like the push above.
  brake: { loop: 2.6, close: [2.6, 1.2, 1.6, 0.85], speed: 6.0, brakeFrom: 0.15, brakeTo: 1.9 },
  slide: { loop: 2.6, close: [2.2, 1.1, 1.4, 0.7], speed: 6.0, slideFrom: 0.6, slideTo: 1.3 },
  manual: { loop: 2.8, close: [2.2, 1.0, 1.2, 0.8], speed: 4.0, chargeUntil: 1.9 },
  // Land backwards on purpose: spin the body round in the air (the same steer
  // that spins a 180 for real), come down pointed the wrong way, and the
  // wheels' revert pivot does the rest — the whole point of the step. Spawned
  // off the rail line (the preview pad's one feature) so the spin lands on
  // flat concrete rather than locking back onto it.
  revert: {
    loop: 3.2,
    close: [2.6, 1.1, 1.8, 0.85],
    speed: 6.5,
    spawnX: -1.4,
    chargeUntil: 0.4,
    trickAt: 0.4,
    trickId: 'ollie',
    spinFrom: 0.4,
    spinTo: 0.7,
  },
  ollie: { loop: 2.4, close: [2.2, 1.1, 1.2, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'ollie' },
  kickflip: { loop: 2.4, close: [1.8, 1.0, 1.6, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'kickflip' },
  heelflip: { loop: 2.4, close: [2.0, 1.0, 1.4, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'heelflip' },
  shuvit: { loop: 2.4, close: [2.0, 1.0, 1.4, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'shuvit' },
  fsshuvit: { loop: 2.4, close: [2.0, 1.0, 1.4, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'fsshuvit' },
  shuv360: { loop: 2.4, close: [2.0, 1.0, 1.4, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'shuv360' },
  varial: { loop: 2.4, close: [1.8, 1.0, 1.6, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'varial' },
  hardflip: { loop: 2.4, close: [1.8, 1.0, 1.6, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'hardflip' },
  impossible: { loop: 2.4, close: [2.0, 1.0, 1.3, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'impossible' },
  treflip: { loop: 2.7, close: [1.8, 1.1, 1.7, 0.9], speed: 4.5, chargeUntil: 0.46, trickAt: 0.46, trickId: 'treflip' },
  varialheel: { loop: 2.7, close: [1.8, 1.1, 1.7, 0.9], speed: 4.5, chargeUntil: 0.46, trickAt: 0.46, trickId: 'varialheel' },
  inheel: { loop: 2.7, close: [1.8, 1.1, 1.7, 0.9], speed: 4.5, chargeUntil: 0.46, trickAt: 0.46, trickId: 'inheel' },
  nightmare: { loop: 2.7, close: [1.8, 1.1, 1.7, 0.9], speed: 4.5, chargeUntil: 0.46, trickAt: 0.46, trickId: 'nightmare' },
  heel360: { loop: 2.7, close: [1.8, 1.1, 1.7, 0.9], speed: 4.5, chargeUntil: 0.46, trickAt: 0.46, trickId: 'heel360' },
  gazelle: { loop: 2.7, close: [1.8, 1.1, 1.7, 0.9], speed: 4.5, chargeUntil: 0.46, trickAt: 0.46, trickId: 'gazelle' },
  fsshuv360: { loop: 2.4, close: [2.0, 1.0, 1.4, 0.85], speed: 4.5, chargeUntil: 0.4, trickAt: 0.4, trickId: 'fsshuv360' },
  grind: {
    loop: 2.8,
    close: [2.4, 1.1, 1.6, 0.85],
    speed: 6.5,
    spawnZ: -8,
    chargeUntil: 0.26,
    trickAt: 0.26,
    trickId: 'ollie',
  },
  walk: { close: [2.4, 1.3, 2.2, 0.9] },
  // Grabs: pop an ollie for the height, then hold the grab through the meat of
  // the air rather than at the trick's own moment — there is no "moment" for
  // one of these, which is most of the point being taught.
  indy: { loop: 2.6, close: [1.9, 1.0, 1.6, 0.85], speed: 4.8, chargeUntil: 0.42, trickAt: 0.42, trickId: 'ollie', grabId: 'indy', grabFrom: 0.5, grabTo: 1.05 },
  mute: { loop: 2.6, close: [1.9, 1.0, 1.6, 0.85], speed: 4.8, chargeUntil: 0.42, trickAt: 0.42, trickId: 'ollie', grabId: 'mute', grabFrom: 0.5, grabTo: 1.05 },
  nosegrab: { loop: 2.6, close: [1.9, 1.0, 1.6, 0.85], speed: 4.8, chargeUntil: 0.42, trickAt: 0.42, trickId: 'ollie', grabId: 'nosegrab', grabFrom: 0.5, grabTo: 1.05 },
  tailgrab: { loop: 2.6, close: [1.9, 1.0, 1.6, 0.85], speed: 4.8, chargeUntil: 0.42, trickAt: 0.42, trickId: 'ollie', grabId: 'tailgrab', grabFrom: 0.5, grabTo: 1.05 },
  method: { loop: 2.6, close: [1.9, 1.0, 1.6, 0.85], speed: 4.8, chargeUntil: 0.42, trickAt: 0.42, trickId: 'ollie', grabId: 'method', grabFrom: 0.5, grabTo: 1.05 },
};

export class TrickPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x1a1e25, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30);
    this.scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x33302a, 2.1));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    sun.position.set(-4, 6, 3);
    this.scene.add(sun);

    // A minimal pad — flat, unfenced, one rail for the grind demo. Everything
    // else about it comes from Park for free: the surface query, the ground
    // texture, the scattered trees past the edge (harmlessly out of frame at
    // this size).
    this.park = new Park({
      id: 'preview',
      name: '',
      spawn: { x: 0, y: 0, z: 0, yaw: 0 },
      patrol: [],
      logos: [],
      extentX: 6,
      extentZ: 10,
      noFence: true,
      seed: 0x9d41,
      build(p) {
        p.rail(0, 0.4, -3, 0, 0.4, 4, 0.028);
      },
    });
    this.scene.add(this.park.group);

    this.board = new Board();
    this.skater = new Skater();
    this.ride = new Ride(this.park, this.board, this.skater);
    this.scene.add(this.ride.frame);
    this.walker = new Walker(this.park);

    this.mode = null;
    this.program = null;
    this.t = 0;
    this.fired = false;
    this.accum = 0;
    this.running = false;
  }

  /** Match the canvas's own on-screen size, so the render is never scaled. */
  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Switch the demo to `mode` (a key of PROGRAMS), from a clean start. */
  play(mode) {
    if (!PROGRAMS[mode]) mode = null;
    this.mode = mode;
    this.program = mode ? PROGRAMS[mode] : null;
    this.running = !!mode;
    this.accum = 0;
    this.reset();
    if (this.running) this.render();
  }

  stop() {
    this.running = false;
  }

  reset() {
    this.t = 0;
    this.fired = false;
    if (this.mode === 'walk') {
      this.walker.reset(0, 0, 0);
    } else if (this.program) {
      this.ride.reset({ x: this.program.spawnX || 0, y: 0, z: this.program.spawnZ || 0, yaw: 0 });
      this.ride.speed = this.program.speed || 0;
      this.ride.vel.set(0, 0, this.ride.speed);
    }
  }

  update(dt) {
    if (!this.running || !this.program) return;
    this.accum = Math.min(this.accum + dt, 0.2); // never chase a huge stall
    let steps = 0;
    while (this.accum >= FIXED_DT && steps < 8) {
      this.step(FIXED_DT);
      this.accum -= FIXED_DT;
      steps++;
    }
    this.render();
  }

  step(dt) {
    if (this.mode === 'walk') {
      this.walker.update(dt, { x: 0, y: 1 });
      this.skater.poseWalk(this.walker, dt);
      return;
    }

    const p = this.program;
    this.t += dt;
    if (this.t > p.loop) {
      this.reset();
      return;
    }
    const input = {
      steer: 0,
      charge: false,
      slide: false,
      push: false,
      brake: false,
      trick: null,
      trickCharge: undefined,
      grab: null,
    };
    if (p.steerFn) input.steer = p.steerFn(this.t);
    // Otherwise a dedicated air-spin window: held steering while airborne is
    // what turns a pop into a backwards landing, which is the revert demo's
    // whole script — no steering on the ground before or after it.
    else if (p.spinFrom != null && this.t >= p.spinFrom && this.t < p.spinTo) input.steer = -1;
    if (p.chargeUntil != null && this.t < p.chargeUntil) input.charge = true;
    if (p.pushHeld) input.push = true;
    if (p.brakeFrom != null && this.t >= p.brakeFrom && this.t < p.brakeTo) input.brake = true;
    if (p.slideFrom != null && this.t >= p.slideFrom && this.t <= p.slideTo) input.slide = true;
    if (p.trickAt != null && !this.fired && this.t >= p.trickAt) {
      input.trick = p.trickId;
      input.trickCharge = 1;
      this.fired = true;
    }
    // A grab is a hold: named for the whole [grabFrom, grabTo) window rather
    // than fired once, the same way a real hold looks to physics.js.
    if (p.grabFrom != null && this.t >= p.grabFrom && this.t < p.grabTo) input.grab = p.grabId;
    this.ride.update(dt, input);
  }

  render() {
    this.resize();
    const pos = this.mode === 'walk' ? this.walker.pos : this.ride.pos;
    const [dx, dy, dz, look] = this.program.close;
    this.camera.position.set(pos.x + dx, pos.y + dy, pos.z + dz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(pos.x, pos.y + look, pos.z);
    this.renderer.render(this.scene, this.camera);
  }
}

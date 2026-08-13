// Ambient AI skaters.
//
// Two kinds share the park. Touring bots get exactly the rig the player
// gets — their own Board, their own Skater, their own Ride — driven not by
// Input but by a pursuit controller a few lines long: steer at the next
// waypoint, push to keep the speed up, and pop a trick every few seconds
// when the ground underfoot allows it. Every ollie a bot lands is landed by
// the same physics the player's tricks are, so a bystander at the top of the
// ramp is proof the model works, not a fake.
//
// Social bots are the rest of the crowd: on foot, wandering near a hangout
// spot and pausing to face each other — the closest a low-poly skater gets
// to talking — until a shared timer calls everyone in for a group ride, at
// which point they mount up and tour the same patrol loop the touring bots
// do (tricks included) before dismounting and going back to hanging out.
//
// What neither kind gets is a ragdoll. A bail freezes the last posed frame
// for a moment — a wipeout, held — and then the bot reappears at its next
// waypoint. Cheap, and in a park with real skaters in it, someone eating it
// and getting back up is exactly the right note.

import * as THREE from '../game/three.js';
import * as C from './config.js';
import { Board } from './board.js';
import { Skater, PALETTE } from './skater.js';
import { Ride, GROUND, AIR, BAIL } from './physics.js';
import { Walker } from './walk.js';

const TRICKS = ['ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit'];

/** A handful of outfits, so a park full of bots does not look like one clone. */
const PALETTES = [
  { ...PALETTE, shirt: 0xc65b4a, sleeve: 0x9a4638, pants: 0x2b2f38, cap: 0x7a2e22 },
  { ...PALETTE, shirt: 0x3f7fb0, sleeve: 0x33648c, pants: 0x22242c, cap: 0x244a63 },
  { ...PALETTE, shirt: 0x5aa15c, sleeve: 0x477e49, pants: 0x2a3324, cap: 0x35502f },
  { ...PALETTE, shirt: 0xcf9c3e, sleeve: 0xa87c30, pants: 0x33291a, cap: 0x7a5a20 },
  { ...PALETTE, shirt: 0x8a5ac6, sleeve: 0x6d47a0, pants: 0x24222c, cap: 0x4a2e7a },
  { ...PALETTE, shirt: 0x3fb8b0, sleeve: 0x338f89, pants: 0x1f2b2a, cap: 0x1f5a56 },
  { ...PALETTE, shirt: 0xd65a9a, sleeve: 0xa8407a, pants: 0x2c222a, cap: 0x7a2e5a },
];

/**
 * Headwear, cycled against the palettes above. Seven palettes and four styles
 * are coprime, so the pairing walks all 28 combinations before it repeats and
 * two bots in the same park never land on the same look.
 */
const STYLES = [
  { head: 'cap', sleeves: 'short' },
  { head: 'beanie', sleeves: 'long' },
  { head: 'hair', sleeves: 'short' },
  { head: 'helmet', sleeves: 'long' },
];

const BAIL_WAIT = 1.6;      // seconds a wipeout is held before the reset
const ARRIVE_R = 2.2;       // metres from a ride waypoint that counts as "there"
const CRUISE_SPEED = 5.2;   // m/s a bot tries to hold on the flat
const BOUND_MARGIN = 12;    // metres from the park's curb a riding bot keeps clear of
const BOUND_AIR_PUSH = 6;   // m/s² an airborne bot gets steered back by, near the curb

// --- carrying the board on foot --------------------------------------------
// The held half of main.js's own poseCarriedBoard — a social bot never sits
// down, so there is no sit-blend to reproduce, just the standing carry.
const _sFwd = new THREE.Vector3();
const _sRight = new THREE.Vector3();
const _sUp = new THREE.Vector3(0, 1, 0);
const _sLen = new THREE.Vector3();
const _sWide = new THREE.Vector3();
const _sMid = new THREE.Vector3();
const _sNose = { p: new THREE.Vector3() };
const _sTail = { p: new THREE.Vector3() };
const _sSide = { p: new THREE.Vector3() };

/** Put a carried board where a walking bot is holding it. Must run after
 * skater.poseWalk(), which is what puts the hand where this reads it from. */
function poseCarriedBoard(walker, skater, board) {
  _sFwd.set(Math.sin(walker.yaw), 0, Math.cos(walker.yaw));
  _sRight.crossVectors(_sFwd, _sUp).normalize();
  _sLen.copy(_sUp).addScaledVector(_sFwd, -0.16).normalize();
  _sWide.copy(_sRight).negate().cross(_sLen).normalize();
  const hand = skater.joints.hand[1];
  _sMid.copy(hand).addScaledVector(_sUp, -0.1).addScaledVector(_sRight, 0.055);
  _sNose.p.copy(_sMid).addScaledVector(_sLen, C.DECK_LEN / 2);
  _sTail.p.copy(_sMid).addScaledVector(_sLen, -C.DECK_LEN / 2);
  _sSide.p.copy(_sMid).addScaledVector(_sWide, C.DECK_W / 2);
  board.poseFree(_sNose, _sTail, _sSide);
}

/** Whichever patrol point a bot is currently nearest, so mounting up starts
 * touring from wherever it happens to be standing rather than teleporting to
 * point zero or opening with a U-turn back to it. */
function nearestPatrolIndex(pos, patrol) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < patrol.length; i++) {
    const dx = patrol[i].x - pos.x;
    const dz = patrol[i].z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * The patrol-seeking behaviour every riding bot shares, touring or social:
 * steer at the next waypoint, push to hold cruise speed, pop a trick once in
 * a while. `bot` just needs `ride`, `patrol`, `target`, `bailWait`,
 * `trickCool` and `pushCool` — both AiSkater and SocialSkater carry exactly
 * those, which is what lets this one function drive either.
 */
function stepPatrol(ride, bot, dt) {
  if (ride.mode === BAIL) {
    bot.bailWait += dt;
    if (bot.bailWait > BAIL_WAIT) {
      bot.bailWait = 0;
      bot.target = (bot.target + 1) % bot.patrol.length;
      const wp = bot.patrol[bot.target];
      const next = bot.patrol[(bot.target + 1) % bot.patrol.length];
      const yaw = Math.atan2(next.x - wp.x, next.z - wp.z);
      ride.reset({ x: wp.x, y: 0, z: wp.z, yaw });
    }
    return;
  }

  const wp = bot.patrol[bot.target];
  const dx = wp.x - ride.pos.x;
  const dz = wp.z - ride.pos.z;
  if (dx * dx + dz * dz < ARRIVE_R * ARRIVE_R) {
    bot.target = (bot.target + 1) % bot.patrol.length;
  }

  let wantYaw = Math.atan2(dx, dz);

  // The curb around the pad is a boundary, not a wall — a bot that reaches it
  // is pinned there by the physics clamp and bails in place, so turn back to
  // open ground while there is still room to. Blended in progressively as the
  // edge closes rather than as a hard line, so a patrol running parallel to a
  // fence reads as an easy carve, not a swerve. The concrete's edge is what
  // the padOnly park clamps to; far bigger than the patrol loop, so the same
  // rule is harmlessly inactive for most of the ride.
  const ex = ride.park.extentX;
  const ez = ride.park.extentZ;
  const cx = ex - Math.abs(ride.pos.x);
  const cz = ez - Math.abs(ride.pos.z);
  const clear = Math.min(cx, cz);
  const nearEdge = clear < BOUND_MARGIN;
  if (nearEdge) {
    const w = 1 - Math.max(0, clear) / BOUND_MARGIN;
    const away = cx <= cz ? -Math.sign(ride.pos.x) * Math.PI / 2 : (ride.pos.z >= 0 ? Math.PI : 0);
    wantYaw += C.angleDelta(wantYaw, away) * w;
  }

  // Steering sign: positive steer carves the board towards -X (see stepGround's
  // lean), so closing a positive angleDelta — the board needs to turn the
  // *other* way — takes a negated steer, exactly as Walker does on foot.
  const steer = C.clamp(-C.angleDelta(ride.yaw, wantYaw) / 1.1, -1, 1);
  const input = { steer, charge: false, slide: false, push: false, trick: null, trickCharge: undefined };

  if (bot.pushCool > 0) bot.pushCool -= dt;
  if (ride.mode === GROUND && Math.abs(ride.speed) < CRUISE_SPEED && bot.pushCool <= 0) {
    input.push = true;
    bot.pushCool = 0.5;
  }

  // No tricks near the curb: an ollie carries the bot a few metres further in
  // the air, and a trick popped this close would be the very launch that puts
  // it over the edge it is steering away from.
  if (ride.mode === GROUND && !ride.grind && !ride.manual && !nearEdge) {
    bot.trickCool -= dt;
    if (bot.trickCool <= 0 && Math.abs(ride.speed) > 2.4) {
      input.trick = TRICKS[(Math.random() * TRICKS.length) | 0];
      input.trickCharge = 0.5 + Math.random() * 0.4;
      bot.trickCool = 3 + Math.random() * 4;
    }
  }

  ride.update(dt, input);

  // Once airborne there is no carve to steer back with — the same stick only
  // spins the body — so a bot launched towards the curb is nudged straight
  // back to open ground instead of clamping at the edge and hanging there.
  // Applied after the step, so the frame that takes off keeps its launch
  // velocity untouched.
  if (ride.mode === AIR) {
    if (cx < BOUND_MARGIN && Math.sign(ride.pos.x) * ride.vel.x > 0.2) {
      ride.vel.x -= Math.sign(ride.pos.x) * BOUND_AIR_PUSH * dt;
    }
    if (cz < BOUND_MARGIN && Math.sign(ride.pos.z) * ride.vel.z > 0.2) {
      ride.vel.z -= Math.sign(ride.pos.z) * BOUND_AIR_PUSH * dt;
    }
  }
}

/** A bot that tours the patrol loop the whole time it is in the park. */
export class AiSkater {
  constructor(park, paletteIndex, patrol, startIdx) {
    this.board = new Board();
    this.skater = new Skater(PALETTES[paletteIndex % PALETTES.length], {
      glow: false,
      style: STYLES[paletteIndex % STYLES.length],
    });
    this.ride = new Ride(park, this.board, this.skater);
    this.patrol = patrol;
    this.target = startIdx % patrol.length;
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.pushCool = Math.random() * 0.4;
    this.toStart();
  }

  /** Drop onto the patrol loop, facing the next point along it. */
  toStart() {
    const wp = this.patrol[this.target];
    const next = this.patrol[(this.target + 1) % this.patrol.length];
    const yaw = Math.atan2(next.x - wp.x, next.z - wp.z);
    this.ride.reset({ x: wp.x, y: 0, z: wp.z, yaw });
  }

  /** Hand the bot a new park to tour — a fresh patrol loop, a fresh spawn. */
  setPark(park, paletteIndex) {
    this.ride.park = park;
    this.patrol = park.patrol;
    this.target = paletteIndex % this.patrol.length;
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.toStart();
  }

  step(dt) {
    stepPatrol(this.ride, this, dt);
  }
}

// --- the social crowd --------------------------------------------------
const TALK_MIN = 7, TALK_MAX = 13;       // seconds hanging out before mounting up
const RIDE_MIN = 11, RIDE_MAX = 17;      // seconds riding together before dismounting
const WANDER_R = 3.4;                    // metres a walking bot roams from the hangout spot
const ARRIVE_WALK_R = 0.6;               // close enough to a wander target to call it arrived
const PAUSE_MIN = 1.6, PAUSE_MAX = 3.6;  // seconds spent "talking" at a stop
const WALK_TURN = 1.4;                   // how sharply a walking bot steers towards its target
const WALK_ALIGN = 0.6;                  // rad of heading error still close enough to start walking

/** The shared clock a whole social crowd follows, so they mount up and
 * dismount together instead of each bot deciding on its own — a session,
 * not eight strangers who all happen to skate at once. */
class SocialGroup {
  constructor() {
    this.riding = false;
    this.timer = TALK_MIN + Math.random() * (TALK_MAX - TALK_MIN);
  }

  step(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.riding = !this.riding;
      this.timer = this.riding
        ? RIDE_MIN + Math.random() * (RIDE_MAX - RIDE_MIN)
        : TALK_MIN + Math.random() * (TALK_MAX - TALK_MIN);
    }
  }

  /** A fresh park means a fresh session — everyone walks in chatting, not
   * mid-ride on ground they have never seen. */
  reset() {
    this.riding = false;
    this.timer = TALK_MIN + Math.random() * (TALK_MAX - TALK_MIN);
  }
}

/**
 * A bot that spends most of its time on foot near a hangout spot — wandering
 * a few metres, pausing to face the group (the nearest thing to talking a
 * low-poly skater can do) — and periodically mounts up with the rest of its
 * group to tour the patrol loop for a while before dismounting again.
 */
export class SocialSkater {
  constructor(park, paletteIndex, hangout, group, scene) {
    this.board = new Board();
    this.skater = new Skater(PALETTES[paletteIndex % PALETTES.length], {
      glow: false,
      style: STYLES[paletteIndex % STYLES.length],
    });
    this.ride = new Ride(park, this.board, this.skater);
    this.walker = new Walker(park);
    this.patrol = park.patrol;
    this.scene = scene;
    this.group = group;
    this.hangout = hangout;
    this.riding = false;
    this.target = 0;
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.pushCool = Math.random() * 0.4;
    this.wanderTarget = null;
    this.pauseTimer = 0;
    // The Ride constructor parents the rig to its own frame by default —
    // this one starts on foot instead, board in hand.
    this.ride.frame.remove(this.board.group);
    this.ride.frame.remove(this.skater.group);
    this.dropAtHangout();
  }

  /** Stand near the hangout spot, on foot, facing any which way. */
  dropAtHangout() {
    const yaw = Math.random() * Math.PI * 2;
    this.walker.reset(this.hangout.x, this.hangout.z, yaw);
    this.scene.add(this.board.group);
    this.scene.add(this.skater.group);
    this.skater.settle();
    this.skater.poseWalk(this.walker, 1 / 60);
    poseCarriedBoard(this.walker, this.skater, this.board);
    this.wanderTarget = null;
    this.pauseTimer = 0;
  }

  /** Board and skater leave the walker's world and rejoin the ride frame,
   * the same reparenting main.js's own mount() does for the player. */
  mount() {
    this.scene.remove(this.board.group);
    this.scene.remove(this.skater.group);
    this.ride.frame.add(this.board.group);
    this.ride.frame.add(this.skater.group);
    this.board.group.position.set(0, 0, 0);
    this.board.group.quaternion.identity();
    this.skater.settle();
    this.ride.reset({ x: this.walker.pos.x, y: 0, z: this.walker.pos.z, yaw: this.walker.yaw });
    this.target = nearestPatrolIndex(this.ride.pos, this.patrol);
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.riding = true;
  }

  /** Step off wherever the ride left it and pick the board back up. */
  dismount() {
    this.scene.add(this.board.group);
    this.scene.add(this.skater.group);
    this.skater.settle();
    this.walker.reset(this.ride.pos.x, this.ride.pos.z, this.ride.yaw);
    this.skater.poseWalk(this.walker, 1 / 60);
    poseCarriedBoard(this.walker, this.skater, this.board);
    this.riding = false;
    this.wanderTarget = null;
    // A beat before wandering off again, the way anyone actually would.
    this.pauseTimer = 0.6 + Math.random() * 1.5;
  }

  pickWanderTarget() {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * WANDER_R;
    this.wanderTarget = { x: this.hangout.x + Math.cos(ang) * r, z: this.hangout.z + Math.sin(ang) * r };
  }

  /** On foot: wander near the hangout spot, and pause now and then facing
   * back towards it, the way people milling around actually cluster. */
  stepWalk(dt) {
    const w = this.walker;
    let move;
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      const wantYaw = Math.atan2(this.hangout.x - w.pos.x, this.hangout.z - w.pos.z);
      // Negated: Walker.update() turns yaw by -move.x*TURN_RATE*dt, so
      // closing a positive angleDelta (yaw needs to increase) takes a
      // negative move.x, not a positive one.
      move = { x: -C.clamp(C.angleDelta(w.yaw, wantYaw) / WALK_TURN, -1, 1), y: 0 };
    } else {
      if (!this.wanderTarget) this.pickWanderTarget();
      const dx = this.wanderTarget.x - w.pos.x;
      const dz = this.wanderTarget.z - w.pos.z;
      if (Math.hypot(dx, dz) < ARRIVE_WALK_R) {
        this.wanderTarget = null;
        this.pauseTimer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
        move = { x: 0, y: 0 };
      } else {
        const wantYaw = Math.atan2(dx, dz);
        const delta = C.angleDelta(w.yaw, wantYaw);
        // Turn to face before walking forward — moving while badly misaligned
        // lets position drift flip which way is shorter to turn, frame to
        // frame, and stall the bot oscillating exactly opposite the target
        // instead of ever completing the turn.
        move = { x: -C.clamp(delta / WALK_TURN, -1, 1), y: Math.abs(delta) < WALK_ALIGN ? 1 : 0 };
      }
    }
    w.update(dt, move);
    this.skater.poseWalk(w, dt);
    poseCarriedBoard(w, this.skater, this.board);
  }

  /** Hand the bot a new park — a fresh hangout spot, a fresh patrol loop,
   * and back on foot regardless of whatever it was doing on the old one.
   * Takes the same (park, index) shape AiSkater.setPark does, since both
   * are driven from the same bots.forEach — the index is unused here, since
   * every social bot in a park shares the one hangout spot. */
  setPark(park) {
    this.ride.park = park;
    this.walker.park = park;
    this.patrol = park.patrol;
    this.hangout = park.patrol[0];
    this.dropAtHangout();
    this.riding = false;
  }

  step(dt) {
    if (this.group.riding && !this.riding) this.mount();
    else if (!this.group.riding && this.riding) this.dismount();

    if (this.riding) stepPatrol(this.ride, this, dt);
    else this.stepWalk(dt);
  }
}

/**
 * A small crowd: some tour the patrol loop the whole time, spread evenly
 * around it so they start apart, and the rest spend most of their time on
 * foot near its first point — wandering, pausing to face each other — until
 * a shared timer calls them in for a group ride together, tricks included,
 * before they dismount and go back to hanging out. The way an actual session
 * looks: some people skating, some people leaning on their boards talking.
 */
export function makeAiSkaters(park, scene, count = 13, socialCount = 8) {
  const bots = [];
  const touringCount = Math.max(0, count - socialCount);
  for (let i = 0; i < touringCount; i++) {
    const startIdx = Math.round((i * park.patrol.length) / touringCount);
    bots.push(new AiSkater(park, i, park.patrol, startIdx));
  }
  const group = new SocialGroup();
  const hangout = park.patrol[0];
  for (let i = 0; i < socialCount; i++) {
    bots.push(new SocialSkater(park, touringCount + i, hangout, group, scene));
  }
  return { bots, group };
}

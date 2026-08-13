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
// What the pursuit controller steers at is the park graph — the same
// node/edge map buildParkGraph computes for every park (parkGraph.js). A bot
// spawns near whatever feature it happens to stand nearest, routes between
// real features with routesBetween(), and rides node to node instead of a
// flat patrol loop, so the crowd skates actual lines: bars, ledges, stairs,
// quarters and banks, with tryGrind() locking the rails the steering happens
// to line up with. There is still a flat patrol loop underneath for a park
// with no graph (a saved park that never got one), but it is the fallback,
// not the point.
//
// The controller also reads the terrain a couple of metres ahead of the
// wheels. A lip or a curb ahead is popped over or steered around before it
// can slam into it, so "avoid crashing by doing a trick" is not a promise —
// it is the same height field the physics bails against, read early.
//
// Social bots are the rest of the crowd: on foot, wandering near a hangout
// spot — picked from a real feature when the park has one, a funbox or a
// ledge rather than a bare corner — and pausing to face each other, until a
// shared timer calls everyone in for a group ride, at which point they mount
// up and ride the graph's own lines (findLines) before dismounting and going
// back to hanging out.
//
// What neither kind gets is a ragdoll. A bail freezes the last posed frame
// for a moment — a wipeout, held — and then the bot routes itself back onto
// the graph and appears up near the nearest feature, facing its next line. A
// skater eating it and getting back up to carry on is exactly the right
// note, and the graph is what tells it where "carrying on" goes.

import * as THREE from '../game/three.js';
import * as C from './config.js';
import { Board } from './board.js';
import { Skater, PALETTE } from './skater.js';
import { Ride, GROUND, AIR, GRIND, BAIL } from './physics.js';
import { Walker } from './walk.js';
import { byId as TRICK_BY_ID } from './tricks.js';
import { nearestSkate, routesBetween, findLines } from './parkGraph.js';

const BAIL_WAIT = 1.6;      // seconds a wipeout is held before the reset
const ARRIVE_R = 2.2;       // metres from a ride waypoint that counts as "there"
const CRUISE_SPEED = 5.2;   // m/s a mid-skill bot tries to hold on the flat
const BOUND_MARGIN = 12;    // metres from the park's curb a riding bot keeps clear of
const BOUND_AIR_PUSH = 6;   // m/s² an airborne bot gets steered back by, near the curb
const RAIL_APPROACH = 5.5;  // within this of a rail's line a bot switches to riding the line
const STALL_TIME = 7;       // seconds on one waypoint before a bot gives up and moves on
const SHOW_OFF_R = 7;       // metres of a player that earns a show-off trick
const YIELD_R = 2.8;        // metres of a player that makes a riding bot give way
const LIP_DROP = 0.32;      // a drop this deep ahead reads as a lip worth launching off
const AVOID_STEP = 0.38;    // a step-up this tall ahead reads as a wall to steer around
const CURB_POP_MIN = 0.09;  // a step-up this tall ahead is popped over...
const CURB_POP_MAX = 0.36;  // ...up to this tall; taller gets steered around instead

// The trick catalogue per skill band. Skill runs 1–4: a beginner's legs only
// reliably produce the pops and the basic flips, a pro can throw the whole
// catalogue. The gate is real — every trick's rotation time has to fit the
// air the bot's pop will actually give it (see pickTrick), and the board
// still has to finish the rotation before the wheels land or the physics
// refuses the landing exactly as it does for the player.
const SKILL_TRICKS = [
  // 1 — the original five.
  ['ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit'],
  // 2 — adds the 360 shove-its and the varials.
  ['ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit', 'shuv360', 'varial', 'varialheel'],
  // 3 — adds the harder flips and an impossible.
  ['ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit', 'shuv360', 'varial', 'varialheel', 'hardflip', 'inheel', 'impossible'],
  // 4 — everything a board can do.
  ['ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit', 'shuv360', 'varial', 'varialheel', 'hardflip', 'inheel', 'impossible', 'treflip', 'gazelle', 'heel360', 'nightmare', 'fsshuv360'],
];
/** The hardest graph edge (difficulty 1–5) a bot of a given skill will route over. */
const SKILL_MAX_DIFF = [2, 3, 4, 5];
/** Cruise speed per skill band — beginners roll slower, pros push on. */
const SKILL_CRUISE = [4.4, 5.0, 5.6, 6.2];

const skillIndex = (skill) => C.clamp((skill | 0) - 1, 0, SKILL_TRICKS.length - 1);

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

// --- the park graph --------------------------------------------------------
// A bot's route is a list of waypoints, each either a real feature (a graph
// node: it carries x/z plus the node itself, so the controller can line up on
// a rail or hop off a lip) or a plain patrol point ({ node: null }) when the
// park has no graph. The patrol loop underneath stays in case routing has
// nothing to work with.

function nodeById(graph) {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** The patrol loop, in the same waypoint shape a graph route is. */
function patrolRoute(bot) {
  const pts = bot.patrol || [];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(bot.target + i) % pts.length];
    out.push({ x: p.x, z: p.z, node: null });
  }
  return out;
}

/**
 * Build a fresh ride for the bot: route from the nearest feature (or a given
 * node id) to a random feature whose difficulty the bot's skill allows, along
 * the graph's flow-friendly lines. Returns null when the graph cannot produce
 * one, which is when the caller falls back to the patrol loop.
 */
function buildRoute(bot, g, fromId) {
  if (!g || g.nodes.length < 2) return null;
  const byId = nodeById(g);
  const maxDiff = SKILL_MAX_DIFF[skillIndex(bot.skill)] ?? 5;
  const from = fromId ? byId.get(fromId) : nearestSkate(g, bot.ride.pos.x, bot.ride.pos.z, { max: 1 })[0]?.node;
  if (!from) return null;
  // Stair sets are obstacles, not destinations — riding the treads is a bail
  // by design (see Stairs in park.js), so they never start or end a line.
  const pool = g.nodes.filter(
    (n) => n.id !== from.id && n.kind !== 'stair' && (n.meta.difficulty ?? 1) <= maxDiff
  );
  for (let attempt = 0; attempt < 8 && pool.length; attempt++) {
    const target = pool[(Math.random() * pool.length) | 0];
    const { routes } = routesBetween(g, from.id, target.id, { max: 1 });
    if (!routes.length) continue;
    const path = routes[0].nodes.map((id) => {
      const n = byId.get(id);
      return { x: n.x, z: n.z, node: n };
    });
    if (path.length < 2) continue;
    // A route that drags the bot over a stair set is a bail waiting to happen;
    // keep looking for a clean one, but take what exists rather than nothing.
    if (path.some((w) => w.node && w.node.kind === 'stair') && attempt < 6) continue;
    return path;
  }
  return null;
}

/** Route the bot over the graph when it can, the patrol loop when it cannot. */
function refreshRoute(bot, fromId) {
  const r = buildRoute(bot, bot.ride.park.graph, fromId);
  bot.route = r || patrolRoute(bot);
  bot.routeIndex = 0;
  bot.stalled = 0;
}

/** The same, but for a social group ride: lead with the park's real lines. */
function refreshSocialRoute(bot) {
  const g = bot.ride.park.graph;
  if (!g || !g.nodes.length) {
    refreshRoute(bot, null);
    return;
  }
  const byId = nodeById(g);
  const from = (bot.hangout && bot.hangout.node) || nearestSkate(g, bot.ride.pos.x, bot.ride.pos.z, { max: 1 })[0]?.node;
  if (from) {
    const lines = findLines(g, { from: from.id, max: 1, maxHops: 3 });
    if (lines.length && lines[0].nodes.length >= 2) {
      bot.route = lines[0].nodes.map((id) => {
        const n = byId.get(id);
        return { x: n.x, z: n.z, node: n };
      });
      bot.routeIndex = 0;
      bot.stalled = 0;
      return;
    }
  }
  refreshRoute(bot, null);
}

/** Steer a riding bot onto a graph line that runs away from the player. */
function rerouteAwayFromPlayer(bot, playerPos) {
  const g = bot.ride.park.graph;
  if (!g || g.nodes.length < 2) return;
  const near = nearestSkate(g, bot.ride.pos.x, bot.ride.pos.z, { max: 1 })[0];
  if (!near) return;
  const byId = nodeById(g);
  const maxDiff = SKILL_MAX_DIFF[skillIndex(bot.skill)] ?? 5;
  const far = (n) => {
    const dx = n.x - playerPos.x;
    const dz = n.z - playerPos.z;
    return dx * dx + dz * dz;
  };
  const pool = g.nodes.filter(
    (n) => n.id !== near.node.id && n.kind !== 'stair' && (n.meta.difficulty ?? 1) <= maxDiff
  );
  pool.sort((a, b) => far(b) - far(a));
  for (const target of pool.slice(0, 4)) {
    const { routes } = routesBetween(g, near.node.id, target.id, { max: 1 });
    if (routes.length && routes[0].nodes.length >= 2) {
      bot.route = routes[0].nodes.map((id) => {
        const n = byId.get(id);
        return { x: n.x, z: n.z, node: n };
      });
      bot.routeIndex = 0;
      bot.stalled = 0;
      return;
    }
  }
}

/** A hangout spot the social crowd can lean on: a real feature when the park
 * has one, the first patrol point otherwise. */
function pickHangout(park) {
  const g = park.graph;
  if (!g || !g.nodes.length) return null;
  const wanted = g.nodes.filter(
    (n) => (n.meta.tags || []).includes('funbox') || n.kind === 'ledge' || n.kind === 'rail'
  );
  const pool = wanted.length ? wanted : g.nodes;
  const n = pool[(Math.random() * pool.length) | 0];
  return { x: n.x, z: n.z, node: n };
}

/** The straight line a feature rides along, through its centre. */
function lineOf(node) {
  return { x: node.x, z: node.z, vx: node.forward.x, vz: node.forward.z };
}

/** Horizontal distance from a point to a line (nodes are axis-aligned-ish). */
function distanceToLine(px, pz, line) {
  const dx = px - line.x;
  const dz = pz - line.z;
  const t = dx * line.vx + dz * line.vz;
  const cx = line.x + line.vx * t;
  const cz = line.z + line.vz * t;
  return Math.hypot(px - cx, pz - cz);
}

// --- air and tricks --------------------------------------------------------
/** The seconds a pop at `charge` stays up on the flat: t = 2·√(2h/g). */
function airTimeFor(charge) {
  const h = C.OLLIE_H_MIN + (C.OLLIE_H_MAX - C.OLLIE_H_MIN) * Math.min(1, charge);
  const vy = Math.sqrt(2 * -C.GRAVITY * h);
  return (2 * vy) / -C.GRAVITY;
}

/** The rotation time a trick needs, from the same flick speeds physics uses. */
function trickTimeNeeded(def) {
  const flipT = (Math.abs(def.flip) * Math.PI * 2) / C.FLIP_RATE;
  const shuvT = (Math.abs(def.shuv) * Math.PI * 2) / C.SHUV_RATE;
  const pitchT = (Math.abs(def.pitch) * Math.PI * 2) / C.PITCH_RATE;
  return Math.max(flipT, shuvT, pitchT);
}

/**
 * A trick the bot can actually finish. The rotation time has to fit the air
 * the chosen charge will buy, plus any extra air a lip launch is about to
 * hand it — so a bot dropping a stair set pops a tre flip or a hardflip, and
 * a bot just hopping off a pad pops an ollie, instead of either rolling
 * dice across the whole catalogue.
 */
function pickTrick(bot, charge, extraAir = 0) {
  const pool = SKILL_TRICKS[skillIndex(bot.skill)] || SKILL_TRICKS[0];
  const air = airTimeFor(charge) + extraAir;
  const fits = pool.filter((id) => {
    const def = TRICK_BY_ID[id];
    return def && trickTimeNeeded(def) < air * 0.7 + 0.06;
  });
  const list = fits.length ? fits : pool;
  return list[(Math.random() * list.length) | 0] || 'ollie';
}

/**
 * The steer that holds a grind or a manual up. The balance meter is an
 * inverted pendulum with a constant bias (see stepBalance in physics.js):
 * leaving the stick alone is never an option, so the bot drives the stick
 * against the pendulum exactly as a player would. Weaker corrections for
 * beginners — a pro holds a rail, a novice wobbles off it.
 */
function balanceSteer(ride, skill) {
  const bc =
    -(ride.balance * C.BALANCE_FALL + ride.balanceBias * 0.5 - ride.balanceVel * C.BALANCE_DAMP) /
    C.BALANCE_CORRECT;
  return C.clamp(bc * (0.55 + skill * 0.15), -1, 1);
}

// --- the ride controller ---------------------------------------------------
/**
 * The pursuit behaviour every riding bot shares, touring or social: steer at
 * the next waypoint (or along a rail's line), push to hold cruise speed, brake
 * into tight turns, pop a trick now and then — and read the ground a couple of
 * metres ahead so a lip is launched off and a wall is steered around instead
 * of slammed into. `bot` just needs `ride`, `route`, `routeIndex`, `bailWait`,
 * `trickCool`, `pushCool` and the skill fields — both AiSkater and SocialSkater
 * carry exactly those, which is what lets this one function drive either.
 * `playerPos` is optional; without it the player-reactive behaviour sleeps.
 */
function stepPatrol(ride, bot, dt, playerPos) {
  // A wipeout is held a beat, then the bot routes itself back onto the graph
  // from wherever it went down and reappears up near the nearest feature,
  // facing the line it is about to ride — "got back up and carried on".
  if (ride.mode === BAIL) {
    bot.bailWait += dt;
    if (bot.bailWait > BAIL_WAIT) {
      bot.bailWait = 0;
      bot.route = null;
      bot.wantManual = false;
      bot.manualT = 0;
      refreshRoute(bot, null);
      const wp = bot.route[0];
      const next = bot.route[1] || bot.route[0];
      const yaw = Math.atan2(next.x - wp.x, next.z - wp.z);
      ride.reset({ x: wp.x, y: 0, z: wp.z, yaw });
      bot.bailCool = 4 + Math.random() * 3;
    }
    return;
  }
  if (bot.bailCool > 0) bot.bailCool -= dt;
  if (bot.yieldCool > 0) bot.yieldCool -= dt;
  if (bot.manualCool > 0) bot.manualCool -= dt;
  if (bot.curbPopCool > 0) bot.curbPopCool -= dt;

  // --- route ---------------------------------------------------------------
  if (!bot.route) refreshRoute(bot, null);
  if (bot.routeIndex >= bot.route.length) {
    const last = bot.route[bot.route.length - 1];
    refreshRoute(bot, last && last.node ? last.node.id : null);
  }
  const wp = bot.route[bot.routeIndex] || bot.route[bot.route.length - 1];

  if (arrivedAt(ride, wp)) {
    bot.routeIndex++;
    bot.stalled = 0;
    if (bot.routeIndex >= bot.route.length) {
      const last = bot.route[bot.route.length - 1];
      refreshRoute(bot, last && last.node ? last.node.id : null);
    }
  } else {
    // A rail a bot cannot line up on, a waypoint behind a wall — give up after
    // a beat and let the next waypoint (or the next route) sort it out.
    bot.stalled += dt;
    if (bot.stalled > STALL_TIME) {
      bot.stalled = 0;
      bot.routeIndex++;
    }
  }
  const cur = bot.route[Math.min(bot.routeIndex, bot.route.length - 1)];

  // --- the pad's own boundary ----------------------------------------------
  // The curb around the pad is a boundary, not a wall — a bot that reaches it
  // is pinned there by the physics clamp and bails in place, so turn back to
  // open ground while there is still room to. Blended in progressively as the
  // edge closes rather than as a hard line, so a line running parallel to a
  // fence reads as an easy carve, not a swerve.
  const ex = ride.park.extentX;
  const ez = ride.park.extentZ;
  const cx = ex - Math.abs(ride.pos.x);
  const cz = ez - Math.abs(ride.pos.z);
  const clear = Math.min(cx, cz);
  const nearEdge = clear < BOUND_MARGIN;
  const edgeW = nearEdge ? 1 - Math.max(0, clear) / BOUND_MARGIN : 0;

  // --- terrain ahead -------------------------------------------------------
  // Sample the height field a couple of metres out, the same field the
  // physics bails against. `dropAhead` is a lip worth launching off; `stepAhead`
  // is a wall — a curb or a feature side — worth popping over or steering
  // around, before the wheel ever reaches it.
  let dropAhead = 0;
  let stepAhead = 0;
  let avoidYaw = null;
  if (ride.mode === GROUND) {
    const look = 1.1 + Math.abs(ride.speed) * 0.2;
    const fwdX = Math.sin(ride.yaw);
    const fwdZ = Math.cos(ride.yaw);
    const ax = ride.pos.x + fwdX * look;
    const az = ride.pos.z + fwdZ * look;
    const hereY = ride.park.heightAt(ride.pos.x, ride.pos.z);
    const aheadY = ride.park.heightAt(ax, az);
    dropAhead = hereY - aheadY;
    stepAhead = aheadY - hereY;
    if (stepAhead > CURB_POP_MAX) {
      // Which way is clear? Probe left and right of the obstacle and turn
      // toward the side that stays closest to the ground underfoot.
      const spread = 1.2;
      const lX = ax - fwdZ * spread;
      const lZ = az + fwdX * spread;
      const rX = ax + fwdZ * spread;
      const rZ = az - fwdX * spread;
      const lStep = Math.max(0, ride.park.heightAt(lX, lZ) - hereY);
      const rStep = Math.max(0, ride.park.heightAt(rX, rZ) - hereY);
      const side = lStep <= rStep ? -1 : 1;
      avoidYaw = ride.yaw + side * (Math.PI / 2);
    }
  }

  // --- the steering target -------------------------------------------------
  // Head at the next waypoint — unless it is a rail and the bot has reached
  // its line, in which case steer along the rail a few metres ahead. The
  // approach brings the wheels to within tryGrind's snap window lined up with
  // the bar, and the physics locks the grind itself.
  let wantYaw;
  const node = cur.node;
  const rail =
    node && node.kind === 'rail' && node.forward ? lineOf(node) : null;
  const followRail =
    !!rail && distanceToLine(ride.pos.x, ride.pos.z, rail) < RAIL_APPROACH;
  if (followRail) {
    const t = (ride.pos.x - rail.x) * rail.vx + (ride.pos.z - rail.z) * rail.vz;
    const ahead = Math.max(2.5, t + 3.5 + Math.abs(ride.speed) * 0.3);
    wantYaw = Math.atan2(
      rail.x + rail.vx * ahead - ride.pos.x,
      rail.z + rail.vz * ahead - ride.pos.z
    );
  } else {
    wantYaw = Math.atan2(cur.x - ride.pos.x, cur.z - ride.pos.z);
  }

  if (nearEdge) {
    const away = cx <= cz ? -Math.sign(ride.pos.x) * Math.PI / 2 : (ride.pos.z >= 0 ? Math.PI : 0);
    wantYaw += C.angleDelta(wantYaw, away) * edgeW;
  }
  if (avoidYaw !== null && !followRail) {
    const w = C.clamp(0.45 + (stepAhead - AVOID_STEP) * 1.1, 0, 1);
    wantYaw += C.angleDelta(wantYaw, avoidYaw) * w;
  }

  // --- the player ----------------------------------------------------------
  // A crowd with a shredder in it: within showing-off range a bot pops a
  // trick on purpose, and right on top of it a riding bot turns aside and
  // re-routes onto a line running the other way.
  let playerDist = Infinity;
  if (playerPos) {
    const pdx = playerPos.x - ride.pos.x;
    const pdz = playerPos.z - ride.pos.z;
    playerDist = Math.hypot(pdx, pdz);
    if (playerDist < YIELD_R && ride.mode === GROUND) {
      const awayYaw = Math.atan2(-pdx, -pdz);
      wantYaw += C.angleDelta(wantYaw, awayYaw) * 0.8;
      if (bot.yieldCool <= 0 && ride.park.graph) {
        bot.yieldCool = 5 + Math.random() * 4;
        rerouteAwayFromPlayer(bot, playerPos);
      }
    }
  }

  // Steering sign: positive steer carves the board towards -X (see stepGround's
  // lean), so closing a positive angleDelta — the board needs to turn the
  // *other* way — takes a negated steer, exactly as Walker does on foot.
  let steer = C.clamp(-C.angleDelta(ride.yaw, wantYaw) / 1.1, -1, 1);

  // A rail already being ridden is not a steering problem at all — it is a
  // balance one. stepBalance reads the smoothed stick (this.steer) during
  // update, so the correction has to ride the input the frame the grind
  // holds, not be scribbled onto the pose afterwards.
  if (ride.mode === GRIND) steer = balanceSteer(ride, bot.skill);

  // --- speed ---------------------------------------------------------------
  // Push toward the skill's own cruise speed on the flat; brake instead into
  // a turn too tight to carve, or with a wall or the player closing. Downhill
  // the slope carries the board (SLOPE_BOOST), so a bot heading down a bank
  // stops pushing and lets it roll.
  let push = false;
  let brake = false;
  if (ride.mode === GROUND && !ride.grind) {
    if (bot.pushCool > 0) bot.pushCool -= dt;
    const turnNeed = Math.abs(C.angleDelta(ride.yaw, wantYaw));
    const cornering = turnNeed > 0.85;
    if (cornering && Math.abs(ride.speed) > bot.cruise - 0.8) brake = true;
    else if (stepAhead > 0.3 && Math.abs(ride.speed) > 3.6) brake = true;
    else if (playerDist < YIELD_R && Math.abs(ride.speed) > 2.5) brake = true;
    else if (
      bot.manualT <= 0 &&
      Math.abs(ride.speed) < bot.cruise &&
      bot.pushCool <= 0 &&
      !nearEdge &&
      !cornering &&
      dropAhead < 0.25 &&
      stepAhead < 0.12
    ) {
      push = true;
      bot.pushCool = 0.5;
    }
  }

  // --- manuals -------------------------------------------------------------
  // Holding the charge key past CHARGE_TIME tips the board into a manual (see
  // readInput in physics.js), and it stays up as long as the charge is held —
  // so a manual is a matter of sending `charge` and then balancing, exactly
  // what the bot does after a landed trick when the ground ahead is clear.
  let charge = false;
  if (ride.mode === GROUND) {
    // Conditions that end a manual, now or mid-charge-up: the curb, a wall
    // ahead, a lip, or the run bleeding out from under the board.
    const manualBad =
      nearEdge || stepAhead > 0.3 || dropAhead > 0.3 || Math.abs(ride.speed) < 1.4;
    if (ride.manual) {
      bot.manualT -= dt;
      if (manualBad || bot.manualT <= 0) {
        bot.manualT = 0;
        bot.wantManual = false;
      } else {
        charge = true;
        push = false;
        brake = false;
        steer = C.clamp(balanceSteer(ride, bot.skill) * 0.6 + steer * 0.4, -1, 1);
      }
    } else if (
      bot.wantManual &&
      !ride.grind &&
      !manualBad &&
      Math.abs(ride.speed) > 2.4 &&
      stepAhead < 0.2 &&
      bot.manualCool <= 0
    ) {
      bot.manualT = 1.2 + Math.random() * 1.8;
      bot.wantManual = false;
      bot.manualCool = 7 + Math.random() * 7;
    }
    // The charge that becomes the manual is held from the decision onwards.
    // If the way ahead goes bad mid-charge, give up on it — rolling into a
    // wall with the nose up is a slam nobody wanted.
    if (bot.manualT > 0 && !ride.manual) {
      if (manualBad) {
        bot.manualT = 0;
        bot.wantManual = false;
      } else {
        charge = true;
      }
    }
  }

  // --- tricks --------------------------------------------------------------
  // No tricks near the curb, and none while the legs are committed to a
  // manual. Otherwise: a lip ahead earns a launch (with the drop's extra air
  // folded into the trick choice), the player close by earns a show-off pop,
  // and every few seconds a random trick fires for the sheer joy of it. A
  // low curb ahead is not a trick at all — it is a panic ollie to get over.
  let trick = null;
  let trickCharge = undefined;
  if (ride.mode === GROUND && !ride.grind && !ride.manual && bot.manualT <= 0 && !nearEdge) {
    bot.trickCool -= dt;
    const speedOk = Math.abs(ride.speed) > 2.4;
    const curbPop = stepAhead > CURB_POP_MIN && stepAhead <= CURB_POP_MAX;
    const lip = dropAhead > LIP_DROP;
    const show = playerDist < SHOW_OFF_R;
    const rand = bot.randomTrickCool <= 0;
    if (curbPop && speedOk && bot.curbPopCool <= 0) {
      trick = 'ollie';
      trickCharge = 0.7 + Math.random() * 0.25;
      bot.curbPopCool = 1.5;
      bot.wantManual = false;
    } else if (bot.trickCool <= 0 && speedOk && bot.bailCool <= 0 && (lip || show || rand)) {
      const ch = 0.5 + Math.random() * 0.4;
      const extra = lip ? Math.sqrt((2 * Math.min(2.5, dropAhead)) / -C.GRAVITY) : 0;
      trick = pickTrick(bot, ch, extra);
      trickCharge = ch;
      bot.trickCool = 3 + Math.random() * 4;
      bot.randomTrickCool = 3 + Math.random() * 4;
      bot.wantManual = bot.skill >= 2 && Math.random() < (bot.skill >= 3 ? 0.55 : 0.3);
    }
  }

  const input = { steer, charge, slide: false, push, brake, trick, trickCharge };
  ride.update(dt, input);

  // A grind is a balance problem like a manual — hold it with the same
  // correction, applied after the step so the frame that locks is untouched.
  if (ride.mode === GRIND) {
    ride.steer = balanceSteer(ride, bot.skill);
  }

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

/** Has the bot reached the current waypoint? A rail has to be ridden along
 * past its middle before the bot moves on, so the follow-the-line steering
 * has actually delivered a grind line rather than a drive-by. */
function arrivedAt(ride, wp) {
  const node = wp.node;
  if (node && node.kind === 'rail' && node.forward) {
    const along = (ride.pos.x - node.x) * node.forward.x + (ride.pos.z - node.z) * node.forward.z;
    if (along > 0.8) {
      return distanceToLine(ride.pos.x, ride.pos.z, lineOf(node)) < ARRIVE_R;
    }
    return false;
  }
  const dx = wp.x - ride.pos.x;
  const dz = wp.z - ride.pos.z;
  return dx * dx + dz * dz < ARRIVE_R * ARRIVE_R;
}

/** A bot that tours the park's lines the whole time it is in the park. */
export class AiSkater {
  constructor(park, paletteIndex, patrol, startIdx, skill) {
    this.board = new Board();
    this.skater = new Skater(PALETTES[paletteIndex % PALETTES.length], {
      glow: false,
      style: STYLES[paletteIndex % STYLES.length],
    });
    this.ride = new Ride(park, this.board, this.skater);
    this.patrol = patrol;
    this.target = startIdx % patrol.length;
    this.skill = skill ?? 1 + ((Math.random() * 4) | 0);
    this.cruise = SKILL_CRUISE[skillIndex(this.skill)] ?? CRUISE_SPEED;
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.randomTrickCool = 0;
    this.pushCool = Math.random() * 0.4;
    this.bailCool = 0;
    this.yieldCool = 0;
    this.manualCool = 0;
    this.curbPopCool = 0;
    this.stalled = 0;
    this.wantManual = false;
    this.manualT = 0;
    this.route = null;
    this.routeIndex = 0;
    this.toStart();
  }

  /** Drop onto the park, then route up from the nearest feature. */
  toStart() {
    const wp = this.patrol[this.target];
    const next = this.patrol[(this.target + 1) % this.patrol.length];
    const yaw = Math.atan2(next.x - wp.x, next.z - wp.z);
    this.ride.reset({ x: wp.x, y: 0, z: wp.z, yaw });
    this.route = null;
    refreshRoute(this, null);
  }

  /** Hand the bot a new park to tour — a fresh graph, a fresh spawn. */
  setPark(park, paletteIndex) {
    this.ride.park = park;
    this.patrol = park.patrol;
    this.target = paletteIndex % this.patrol.length;
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.route = null;
    this.toStart();
  }

  step(dt, playerPos) {
    stepPatrol(this.ride, this, dt, playerPos);
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
 * A bot that spends most of its time on foot near a hangout spot — picked
 * from a real feature (a funbox, a ledge, a rail) when the park has one,
 * the way people actually gather around the good stuff — wandering a few
 * metres, pausing to face the group, and periodically mounting up with the
 * rest of its group to ride the park's own lines for a while before
 * dismounting again.
 */
export class SocialSkater {
  constructor(park, paletteIndex, hangout, group, scene, skill) {
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
    this.skill = skill ?? 2;
    this.cruise = SKILL_CRUISE[skillIndex(this.skill)] ?? CRUISE_SPEED;
    this.riding = false;
    this.target = 0;
    this.bailWait = 0;
    this.trickCool = 1.5 + Math.random() * 3;
    this.randomTrickCool = 0;
    this.pushCool = Math.random() * 0.4;
    this.bailCool = 0;
    this.yieldCool = 0;
    this.manualCool = 0;
    this.curbPopCool = 0;
    this.stalled = 0;
    this.wantManual = false;
    this.manualT = 0;
    this.route = null;
    this.routeIndex = 0;
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
    this.route = null;
    refreshSocialRoute(this);
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

  /** Hand the bot a new park — a fresh hangout spot, a fresh graph, and back
   * on foot regardless of whatever it was doing on the old one. Takes the
   * same (park, index) shape AiSkater.setPark does, since both are driven
   * from the same bots.forEach — the index is unused here, since every
   * social bot in a park shares the one hangout spot. */
  setPark(park) {
    this.ride.park = park;
    this.walker.park = park;
    this.patrol = park.patrol;
    this.hangout = pickHangout(park) || park.patrol[0];
    this.dropAtHangout();
    this.riding = false;
    this.route = null;
    this.routeIndex = 0;
  }

  step(dt, playerPos) {
    if (this.group.riding && !this.riding) this.mount();
    else if (!this.group.riding && this.riding) this.dismount();

    if (this.riding) stepPatrol(this.ride, this, dt, playerPos);
    else this.stepWalk(dt);
  }
}

/**
 * A small crowd: some tour the park's graph lines the whole time, spread
 * evenly across the park so they start apart and given a spread of skill so
 * beginners roll easy lines and pros push the whole park, and the rest spend
 * most of their time on foot near a real feature — wandering, pausing to
 * face each other — until a shared timer calls them in for a group ride of
 * the park's own lines, tricks included, before they dismount and go back to
 * hanging out. The way an actual session looks: some people skating, some
 * people leaning on their boards talking.
 */
export function makeAiSkaters(park, scene, count = 13, socialCount = 8) {
  const bots = [];
  const touringCount = Math.max(0, count - socialCount);
  for (let i = 0; i < touringCount; i++) {
    const startIdx = Math.round((i * park.patrol.length) / touringCount);
    // Skills 1..4 spread across the touring crew, beginner to pro.
    const skill = 1 + Math.round((i / Math.max(1, touringCount - 1)) * 3);
    bots.push(new AiSkater(park, i, park.patrol, startIdx, skill));
  }
  const group = new SocialGroup();
  const hangout = pickHangout(park) || park.patrol[0];
  for (let i = 0; i < socialCount; i++) {
    const skill = 2 + (i % 3);
    bots.push(new SocialSkater(park, touringCount + i, hangout, group, scene, skill));
  }
  return { bots, group };
}

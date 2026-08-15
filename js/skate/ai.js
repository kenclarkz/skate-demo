// Ambient AI skaters.
//
// Three kinds share the park. Touring bots get exactly the rig the player
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
// Pro bots session the park. Where the touring and social bots treat a ride
// as a way to be there, a pro plans real lines off the graph's flow — rails,
// ledges, transitions, stairs and bowls — rides them feature to feature with
// deliberate, style-appropriate tricks that never repeat too soon, and steps
// off between sessions to take an actual break by a feature before mounting
// back up. Each pro has its own personality (street, air, freestyle,
// all-round, bomber), so a park with pros in it looks like five skaters with
// five different bags of tricks instead of one looped clip.
//
// What none of the three kinds gets is a ragdoll. A bail freezes the last
// posed frame for a moment — a wipeout, held — and then the bot routes itself
// back onto the graph and appears up near the nearest feature, facing its next
// line. A skater eating it and getting back up to carry on is exactly the
// right note, and the graph is what tells it where "carrying on" goes.

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
const BOSS_LEG_UP = 0.2;    // a step-up taller than this on a planned leg reads as a wall
const BOSS_LEG_DOWN = 0.2;  // a drop deeper than this on a planned leg reads as a cliff
const BOSS_LEG_STEP = 0.4;  // metres between terrain samples along a planned leg
const BOSS_GRID_STEP = 14;  // metres between the flat-ground cells sampled for a rival's loop
const BOSS_GRID_MARGIN = 6; // metres of curb the sampling stays clear of
const BOSS_FLAT_PROBE = 2.4; // metres out from a cell the ground is checked across
const BOSS_FLAT_RANGE = 0.18; // a wider ground spread than this reads as a slope, not a pad
const BOSS_LOOP_MIN = 4;    // the shortest circuit worth riding — a triangle of
                            // waypoints is a U-turn with an extra corner, not a line
const BOSS_LOOP_MAX = 8;    // the longest circuit the route search bothers with
const BOSS_PTS_MAX = 14;    // the most waypoints the circuit search will consider
const BOSS_LOOP_WORK = 300000; // the most paths the circuit search will explore
const BOSS_GRIND_CLEAR = 1.5; // metres a planned line keeps clear of any rail, ledge or coping

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
/** Nudge a point that sits within the near-edge keep-clear band in to the
 * margin line. Patrol loops can hug the curb (railway parks ride the fence),
 * but the edge-repel keeps a bot clear of it — a waypoint on the fence is a
 * target a bot can circle forever without reaching. Projected, it becomes a
 * point the bot can actually arrive at. */
function projectIn(park, x, z) {
  const limX = Math.max(0, park.extentX - BOUND_MARGIN);
  const limZ = Math.max(0, park.extentZ - BOUND_MARGIN);
  return {
    x: limX > 0 ? Math.min(limX, Math.max(x, -limX)) : x,
    z: limZ > 0 ? Math.min(limZ, Math.max(z, -limZ)) : z,
  };
}

function patrolRoute(bot) {
  const pts = bot.patrol || [];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(bot.target + i) % pts.length];
    const { x, z } = projectIn(bot.ride.park, p.x, p.z);
    out.push({ x, z, node: null });
  }
  return out;
}

/** Sample the ground along a straight leg and judge whether a rival can ride it
 * flat: nothing to slam (a step-up beyond the pop range) and no lip to drop
 * off into. Probes a band around the line too — a rival does not hold the
 * centreline while it is popping tricks, so a wall sitting a metre off the
 * line is a wall it will still find. Rails, ledges and copings do not show up
 * in the ground field (they hang above it), so every grind line near the band
 * is a grind the rival would drift into — the band stays clear of those too.
 * Feeds the boss's flat-loop router. */
function legProfile(park, ax, az, bx, bz, band) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return { safe: true, maxUp: 0, maxDown: 0, len };
  const px = -dz / len;
  const pz = dx / len;
  let maxUp = 0;
  let maxDown = 0;
  let climb = 0;
  let drop = 0;
  // The band is deliberately wider than the board: a rival rides within a
  // couple of metres of its line (corner cuts, the carve before a trick), so
  // a leg is only a clear one when that drift can't reach a feature's edge.
  // The band widens after a loop keeps putting the boss on the ground: a leg
  // that rides flat but clips a feature two metres off-line is a leg to shed.
  for (const off of [0, band, -band]) {
    const ox = px * off;
    const oz = pz * off;
    let lastY = park.heightAt(ax + ox, az + oz);
    const n = Math.max(2, Math.ceil(len / BOSS_LEG_STEP));
    let lineUp = 0;
    let lineDown = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = ax + dx * t + ox;
      const z = az + dz * t + oz;
      const y = park.heightAt(x, z);
      const up = y - lastY;
      const down = lastY - y;
      if (up > maxUp) maxUp = up;
      if (down > maxDown) maxDown = down;
      if (up > 0) lineUp += up;
      if (down > 0) lineDown += down;
      lastY = y;
      if (grindNear(park, x, z)) return { safe: false, maxUp, maxDown, len };
    }
    // A leg that steadily climbs or sheds more than a small step is a bank,
    // not a pad — each 0.4 m sample is a shallow step a rival would roll over,
    // but strung across the park it rides the board up a slope it cannot pop
    // cleanly off of. Only the centreline's total matters; the band offsets
    // are just clearance.
    if (off === 0) {
      climb = lineUp;
      drop = lineDown;
    }
  }
  return {
    safe: maxUp <= BOSS_LEG_UP && maxDown <= BOSS_LEG_DOWN && climb <= 0.4 && drop <= 0.4,
    maxUp,
    maxDown,
    len,
  };
}

/** Whether a point rides within the grind-clear band of any rail, ledge or
 * coping. The ground field does not include them — a rail hangs above the pad
 * a metre away from a line the ground probe calls flat — so the flat router
 * asks the park's own grind lines whether it would be drifting into one. */
function grindNear(park, x, z) {
  for (const g of park.grinds) {
    const hlen = Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z);
    if (hlen < 0.01) continue;
    const hx = (g.b.x - g.a.x) / hlen;
    const hz = (g.b.z - g.a.z) / hlen;
    const t = Math.min(hlen, Math.max(0, (x - g.a.x) * hx + (z - g.a.z) * hz));
    const d = Math.hypot(x - (g.a.x + hx * t), z - (g.a.z + hz * t));
    if (d < BOSS_GRIND_CLEAR) return true;
  }
  return false;
}

/** Whether the pad around a spot is open flatground: the ground spread across
 * the probe radius stays under the flat range, so there is no lip, step or
 * slope for a flatground line to trip over. */
function flatSpot(park, x, z) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const y = park.heightAt(x + (i * BOSS_FLAT_PROBE) / 2, z + (j * BOSS_FLAT_PROBE) / 2);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxY - minY < BOSS_FLAT_RANGE;
}

/** The longest safe closed circuit through a set of waypoints, each leg probed
 * by band for a step-up or a drop, ties broken toward a start near the boss so
 * the first leg is not a detour across the park. Returns the waypoints, or
 * null when the set has no rideable circuit. */
function flatLoopFrom(bot, pts, band) {
  const park = bot.ride.park;
  const n = pts.length;
  if (n < BOSS_LOOP_MIN) return null;
  const safe = Array.from({ length: n }, () => new Array(n).fill(false));
  const tight = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = legProfile(park, pts[i].x, pts[i].z, pts[j].x, pts[j].z, band);
      safe[i][j] = safe[j][i] = p.safe;
      tight[i][j] = tight[j][i] = Math.max(p.maxUp, p.maxDown);
    }
  }
  const toRoute = (idx) => idx.map((i) => ({ x: pts[i].x, z: pts[i].z, node: null }));
  // A cycle is scored by how tight its tightest leg is before its length: two
  // loops may both be flat enough to ride, but the one whose closest pass to a
  // feature is the farthest away is the one a rival bails off the least. Node
  // count still matters once the clearance is comparable. The score has no
  // dependence on where the rival happens to be standing: a bail replans from
  // a new spot, and a loop that changes with the spot churns the whole line
  // mid-duel. One best circuit per park, ridden every time.
  const cycleWorst = (idx) => {
    let worst = 0;
    for (let i = 0; i < idx.length; i++) {
      const t = tight[idx[i]][idx[(i + 1) % idx.length]];
      if (t > worst) worst = t;
    }
    return worst;
  };
  let work = 0;
  let exhausted = false;
  let best = null;
  let bestScore = -1;
  for (let s = 0; s < n && !exhausted; s++) {
    const path = [s];
    const seen = new Set([s]);
    const walk = () => {
      if (exhausted) return;
      const last = path[path.length - 1];
      for (let k = 0; k < n; k++) {
        if (k === s) {
          // The leg that closes the circuit (back to the start) is a leg the
          // boss rides every lap, so it is held to the same standard as the
          // rest — an unprobed return leg is a wall the boss slams into on the
          // last stretch of every loop (nova's loop closed across a raised
          // box, and the rival bounced off its banks a couple of times a lap).
          if (path.length >= BOSS_LOOP_MIN && safe[last][s]) {
            const score = -cycleWorst(path) * 10000 + path.length * 1000;
            if (score > bestScore) {
              bestScore = score;
              best = path.slice();
            }
          }
        } else if (!seen.has(k) && safe[last][k] && path.length < BOSS_LOOP_MAX) {
          if (++work > BOSS_LOOP_WORK) {
            exhausted = true;
            return;
          }
          seen.add(k);
          path.push(k);
          walk();
          path.pop();
          seen.delete(k);
        }
      }
    };
    walk();
  }
  if (best) return toRoute(best);
  // No closed circuit — take the longest safe line and double it back so the
  // boss rides it end to end without teleporting.
  let bestPath = null;
  let bestPathScore = -1;
  const path = [];
  const seen = new Set();
  const walkPath = () => {
    if (exhausted) return;
    const last = path[path.length - 1];
    for (let k = 0; k < n; k++) {
      if (path.length < BOSS_LOOP_MAX && !seen.has(k) && (path.length === 0 || safe[last][k])) {
        if (++work > BOSS_LOOP_WORK) {
          exhausted = true;
          return;
        }
        seen.add(k);
        path.push(k);
        const dx = pts[k].x - bot.ride.pos.x;
        const dz = pts[k].z - bot.ride.pos.z;
        const score = path.length * 1000 - Math.hypot(dx, dz);
        if (score > bestPathScore) {
          bestPathScore = score;
          bestPath = path.slice();
        }
        walkPath();
        path.pop();
        seen.delete(k);
      }
    }
  };
  walkPath();
  if (!bestPath || bestPath.length < BOSS_LOOP_MIN) return null;
  return toRoute(bestPath.concat(bestPath.slice(1, -1).reverse()));
}

/** The rival's own flatground circuit. A duel is scored on flatground tricks,
 * so the boss rides open pads and leaves the rails and transitions to the
 * crowd: the patrol loop's waypoints are pruned of any leg that crosses
 * something worth slamming — a bowl rim, a vert face, a bank — and joined into
 * the longest safe closed loop the park allows. When the patrol loop has no
 * clean circuit, the pad's open flat ground is sampled into the pool so the
 * boss can still build a loop around the features instead of over them.
 * Returns the waypoints, or null when the park has no rideable circuit (which
 * is when the patrol loop is taken). */
function bossFlatLoop(bot) {
  const park = bot.ride.park;
  const pts = (bot.patrol || []).map((p) => projectIn(park, p.x, p.z));
  // Sample the pad for open flat ground and add it to the pool, kept clear of
  // the patrol line so the loop does not hug the features that blocked it. The
  // grid always joins the pool, not just when the patrol loop fails — a park
  // whose patrol happens to form a circuit might still have a safer line out
  // on the open pad, and a rival rides the flattest open ground it can find.
  const pCount = pts.length;
  for (let z = -park.extentZ + BOSS_GRID_MARGIN; z <= park.extentZ - BOSS_GRID_MARGIN; z += BOSS_GRID_STEP) {
    for (let x = -park.extentX + BOSS_GRID_MARGIN; x <= park.extentX - BOSS_GRID_MARGIN; x += BOSS_GRID_STEP) {
      if (!flatSpot(park, x, z)) continue;
      if (pts.some((q) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < 64)) continue;
      pts.push({ x, z });
    }
  }
  // Keep the search small: a rival only needs the park's flattest few cells,
  // so the grid points that bunch up closest are the first to go.
  while (pts.length > BOSS_PTS_MAX) {
    let drop = -1;
    let dropNear = Infinity;
    for (let i = pCount; i < pts.length; i++) {
      let near = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const d = (pts[i].x - pts[j].x) * (pts[i].x - pts[j].x) + (pts[i].z - pts[j].z) * (pts[i].z - pts[j].z);
        if (d < near) near = d;
      }
      if (near < dropNear) {
        dropNear = near;
        drop = i;
      }
    }
    if (drop < 0) break;
    pts.splice(drop, 1);
  }
  const loop13 = flatLoopFrom(bot, pts, 1.3);
  if (!loop13) return flatLoopFrom(bot, pts, 2.3) || patrolRoute(bot);
  // A loop that rides clear of the ground two metres from its line can still
  // hug a wall it passes a metre off. Most of those walls are pads a rival
  // rolls by without touching, but a step tall enough that the board would be
  // climbing onto it (a pool deck, a high pad) is a leg that a wider clear
  // band would have ruled out — so if any leg of the tight loop runs within
  // that wider band of one, rebuild the line with the wider clearance.
  const TALL = 2.0;
  for (let i = 0; i < loop13.length; i++) {
    const wp = loop13[i];
    const next = loop13[(i + 1) % loop13.length];
    if (legProfile(park, wp.x, wp.z, next.x, next.z, 2.3).maxUp > TALL) {
      return flatLoopFrom(bot, pts, 2.3) || loop13;
    }
  }
  return loop13;
}

/**
 * Build a fresh ride for the bot: route from the nearest feature (or a given
 * node id) to a random feature whose difficulty the bot's skill allows, along
 * the graph's flow-friendly lines. Returns null when the graph cannot produce
 * one, which is when the caller falls back to the patrol loop.
 */
function buildRoute(bot, g, fromId, prefKinds) {
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
  // A rival's focus leans the route toward the kind of feature it is known
  // for: rails and ledges for the grinders, transitions (quarters, bowls,
  // funboxes) for the airs, flat pads for the flatground and manual heads.
  // It is a bias, not a lock — a random good line is taken over nothing.
  if (!prefKinds) {
    prefKinds =
      bot.focus === 'rail' || bot.focus === 'grind'
        ? ['rail', 'ledge']
        : bot.focus === 'air'
          ? ['transition']
          : bot.focus === 'flat' || bot.focus === 'manual'
            ? ['flat']
            : null;
  }
  for (let attempt = 0; attempt < 8 && pool.length; attempt++) {
    let target;
    if (prefKinds) {
      const pref = pool.filter((n) => prefKinds.includes(n.kind));
      target = pref.length && Math.random() < 0.7
        ? pref[(Math.random() * pref.length) | 0]
        : pool[(Math.random() * pool.length) | 0];
    } else {
      target = pool[(Math.random() * pool.length) | 0];
    }
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

/** Hand a bot a fresh route. A bot with its own `planRoute` — a pro skater
 * sessioning its lines — plans where it goes; everyone else gets the shared
 * tour/patrol routing. */
function giveRoute(bot, fromId) {
  if (bot.planRoute) bot.planRoute(fromId);
  else refreshRoute(bot, fromId);
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
 * has one, the first patrol point otherwise. The spot itself is set a stride
 * or two off the feature, on its flank, so someone leaning on it — and later
 * mounting from it — starts on open ground rather than on top of the rail. */
function pickHangout(park) {
  const g = park.graph;
  if (!g || !g.nodes.length) return null;
  const wanted = g.nodes.filter(
    (n) => (n.meta.tags || []).includes('funbox') || n.kind === 'ledge' || n.kind === 'rail'
  );
  const pool = wanted.length ? wanted : g.nodes;
  const n = pool[(Math.random() * pool.length) | 0];
  const off = n.forward
    ? { x: n.x - n.forward.z * 1.5, z: n.z + n.forward.x * 1.5 }
    : { x: n.x + 1.5, z: n.z + 1.5 };
  return { x: off.x, z: off.z, node: n };
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
  // A rival's trick bag is its identity — pick from it when it exists, the
  // skill band's own catalogue otherwise.
  const pool =
    (bot.trickBag && bot.trickBag.length ? bot.trickBag : SKILL_TRICKS[skillIndex(bot.skill)]) ||
    SKILL_TRICKS[0];
  const air = airTimeFor(charge) + extraAir;
  const fits = pool.filter((id) => {
    const def = TRICK_BY_ID[id];
    return def && trickTimeNeeded(def) < air * 0.7 + 0.06;
  });
  const list = fits.length ? fits : pool;
  return list[(Math.random() * list.length) | 0] || 'ollie';
}

/**
 * A rival's trick: weighted toward the big-value moves in its own bag, so a
 * boss on pace for a duel throws the points the player has to beat rather
 * than rolling the same ten-ounce catalogue as everyone else. The bag stays
 * the character's identity; the weighting only changes how often each trick
 * comes out — a tre flip, for example, seven times as often as an ollie.
 * Same air-fit gate the touring bots use.
 */
function bossPickTrick(bot, charge, extraAir = 0) {
  const pool =
    (bot.trickBag && bot.trickBag.length ? bot.trickBag : SKILL_TRICKS[skillIndex(bot.skill)]) ||
    SKILL_TRICKS[0];
  const air = airTimeFor(charge) + extraAir;
  const fits = pool.filter((id) => {
    const def = TRICK_BY_ID[id];
    return def && trickTimeNeeded(def) < air * 0.7 + 0.06;
  });
  const list = fits.length ? fits : pool;
  let total = 0;
  const weights = list.map((id) => {
    const v = Math.max(50, (TRICK_BY_ID[id] && TRICK_BY_ID[id].points) || 0);
    total += v;
    return v;
  });
  let roll = Math.random() * total;
  let pick = list[0] || 'ollie';
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      pick = list[i];
      break;
    }
  }
  return pick;
}

/**
 * A rival's own trick decision, consulted by stepPatrol the way a pro's is —
 * fast cadence, chained off the landing, throwing the bag's biggest moves and
 * tipping into a manual flourish when the character is known for one. The
 * pace knob (rival identity) tightens the gap between tricks.
 */
export function bossChooseTrick(bot, { ride, speedOk, curbPop, lip, show, stepAhead, dropAhead, nearEdge }) {
  if (!speedOk) return null;
  if (curbPop && bot.curbPopCool <= 0) {
    bot.curbPopCool = 1.4;
    return { trick: 'ollie', charge: 0.7 + Math.random() * 0.2, manual: false };
  }
  if (bot.trickCool > 0 || bot.bailCool > 0) return null;
  // A combo that is on its way to the bank is not ready for a third trick. The
  // bank is a calm 1.35 s of rolling with nothing happening, so a trick popped
  // into a live combo just re-arms the clock and hands the run to the next
  // bail. Two tricks a combo is the rival's pace — a tight chain that still
  // banks before a bail can wipe it — so the second trick pops while the
  // first is fresh, and the third waits for the points to hit the bank. The
  // cadence paces itself off the landings instead of a fixed timer.
  if (ride.combo?.live && ride.combo.names.length >= 2) {
    bot.randomTrickCool = 0.3;
    return null;
  }
  // A board mid-carve is not a board to pop off. The trick lands pointing the
  // way the board was already pointing, so popping into a turn lands still
  // facing sideways at speed — a slide-out. Wait for the line to straighten.
  if (Math.abs(C.angleDelta(ride.yaw, Math.atan2(ride.vel.x, ride.vel.z))) > 0.3) return null;
  const ch = lip ? 0.7 + Math.random() * 0.3 : 0.55 + Math.random() * 0.35;
  const extra = lip ? Math.sqrt((2 * Math.min(2.5, dropAhead)) / -C.GRAVITY) : 0;
  const trick = bossPickTrick(bot, ch, extra);
  // The gap a rival leaves on the ground between tricks is the combo bank
  // itself (see the live-combo gate above), so each landed trick banks what it
  // is worth before the next one arms a fresh combo — a duel is a score to
  // beat, not a highlight reel, and a dropped combo is a duel lost. The tiny
  // window here is just so the same frame's pop cannot fire twice.
  bot.trickCool = 0.3;
  bot.randomTrickCool = bot.trickCool;
  // A fresh landing deserves a fresh manual when the character leans that way,
  // but only after the bank has cleared (the manual gate waits on it).
  bot.manualCool = 0;
  const manualChance = bot.manualFocus ? 0.12 : bot.skill >= 3 ? 0.08 : 0.04;
  return { trick, charge: ch, manual: Math.random() < manualChance };
}

/**
 * A rival's route: the park's open flatground circuit, found by probing the
 * ground between the patrol loop's waypoints and keeping only legs that ride
 * flat — a bowl rim, vert face or bank would end the duel, so the boss skates
 * around them. Falls back to the raw patrol loop when the park has no clean
 * circuit. Sets the boss's own route fields, the way a pro's planRoute does.
 */
export function bossPlanRoute(bot, fromId) {
  bot.route = bossFlatLoop(bot) || patrolRoute(bot);
  bot.routeIndex = 0;
  bot.stalled = 0;
}

/** A clean spawn for a rival: its own patrol loop keeps the clear line, and a
 * rival that stands on a spot the ride cannot get going from (boxed in by the
 * curb) starts on the nearest loop point instead — pointed at the next one,
 * so it is rolling the moment the duel drops. */
export function bossSpawn(park, x, z, yaw) {
  const clear = Math.min(park.extentX - Math.abs(x), park.extentZ - Math.abs(z));
  if (clear > 8 && park.heightAt(x, z) < 0.4) return { x, z, yaw };
  let best = park.patrol[0];
  let bestDist = Infinity;
  for (const p of park.patrol) {
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  const limX = Math.max(0, park.extentX - BOUND_MARGIN);
  const limZ = Math.max(0, park.extentZ - BOUND_MARGIN);
  const bx = limX > 0 ? Math.min(limX, Math.max(best.x, -limX)) : best.x;
  const bz = limZ > 0 ? Math.min(limZ, Math.max(best.z, -limZ)) : best.z;
  const next = park.patrol[(park.patrol.indexOf(best) + 1) % park.patrol.length];
  const wantYaw = Math.atan2(next.x - bx, next.z - bz);
  return { x: bx, z: bz, yaw: wantYaw };
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

// A rival steers at the route's polyline instead of the waypoint under it: a
// point a few metres ahead of its own projection. Waypoint-to-waypoint aiming
// whips the corner — the board swings past the turn's inside and can dip into
// a feature that sits a couple of metres off the leg (nova's pads sit exactly
// there), while a lookahead point rounds the corner along the line itself and
// hauls a drifted board back onto its leg much harder than a far-away
// waypoint does. The projection also keeps the aim continuous across a
// waypoint, so there is no steered snap when the index advances. A boss's
// route is always a closed circuit (a flat loop or a patrol loop), so the
// polyline wraps: the last point connects back to the first.
function bossProjection(r, x, z) {
  const n = r.length;
  let bestD = Infinity;
  let seg = 0;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-6) continue;
    let f = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    f = Math.max(0, Math.min(1, f));
    const px = a.x + abx * f;
    const pz = a.z + abz * f;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      seg = i;
      t = f;
    }
  }
  return { seg, t };
}

/** The rival's continuous progress around its closed loop, in waypoint units:
 * the route's own indices carry a wrap at both ends of the range, so the
 * crossing of a waypoint is read off the projection instead of a 2 m arrival
 * circle — a lookahead-steered board rounds the corner rather than whipping
 * around it, and passes the waypoint a few metres off without ever "arriving".
 * Progress is travelled distance along the loop, not a nearest-point sample:
 * at a corner the nearest leg flips back and forth between the two lines, so a
 * projection-based count would dither the index at every waypoint. Instead the
 * board's movement is integrated along the tangent of the leg it is on, and
 * only ever forwards, so the count crosses each waypoint exactly once a lap.
 */
function bossPathProg(bot, ride) {
  const r = bot.route;
  const n = r.length;
  if (bot.routeSig !== r) {
    bot.routeSig = r;
    const p = bossProjection(r, ride.pos.x, ride.pos.z);
    bot.pathProg = p.seg + p.t;
    bot.lastPosX = ride.pos.x;
    bot.lastPosZ = ride.pos.z;
    return bot.pathProg;
  }
  const s = Math.floor(bot.pathProg) % n;
  const a = r[s];
  const b = r[(s + 1) % n];
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len = Math.hypot(abx, abz) || 1;
  const tx = abx / len;
  const tz = abz / len;
  const dx = ride.pos.x - (bot.lastPosX ?? ride.pos.x);
  const dz = ride.pos.z - (bot.lastPosZ ?? ride.pos.z);
  bot.lastPosX = ride.pos.x;
  bot.lastPosZ = ride.pos.z;
  const adv = (dx * tx + dz * tz) / len;
  if (adv > 0) bot.pathProg += adv;
  return bot.pathProg;
}

function bossLookaheadYaw(bot, ride) {
  const r = bot.route;
  const n = r.length;
  const p = bossProjection(r, ride.pos.x, ride.pos.z);
  let rem = 3.2 + Math.abs(ride.speed) * 0.4;
  let s = p.seg;
  let u = p.t;
  for (let k = 0; k <= n; k++) {
    const a = r[s];
    const b = r[(s + 1) % n];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len = Math.hypot(abx, abz);
    if (len < 1e-6) {
      return Math.atan2(b.x - ride.pos.x, b.z - ride.pos.z);
    }
    const along = (1 - u) * len;
    if (rem <= along) {
      const f = u + rem / len;
      return Math.atan2(a.x + abx * f - ride.pos.x, a.z + abz * f - ride.pos.z);
    }
    rem -= along;
    s = (s + 1) % n;
    u = 0;
  }
  const b = r[(p.seg + 1) % n];
  return Math.atan2(b.x - ride.pos.x, b.z - ride.pos.z);
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
    if (bot.bailWait > (bot.bailDelay ?? BAIL_WAIT)) {
      bot.bailWait = 0;
      bot.route = null;
      bot.wantManual = false;
      bot.manualT = 0;
      giveRoute(bot, null);
      const wp = bot.route[0];
      const next = bot.route[1] || bot.route[0];
      const yaw = Math.atan2(next.x - wp.x, next.z - wp.z);
      ride.reset({ x: wp.x, y: 0, z: wp.z, yaw });
      // A rival in a duel is back on the gas fast — a tourist can take its
      // time getting up, a boss on the clock cannot.
      bot.bailCool = (bot.bailLockout ?? 4 + Math.random() * 3);
    }
    return;
  }
  if (bot.bailCool > 0) bot.bailCool -= dt;
  if (bot.yieldCool > 0) bot.yieldCool -= dt;
  if (bot.manualCool > 0) bot.manualCool -= dt;
  if (bot.curbPopCool > 0) bot.curbPopCool -= dt;

  // --- route ---------------------------------------------------------------
  if (!bot.route) giveRoute(bot, null);
  if (bot.routeIndex >= bot.route.length) {
    const last = bot.route[bot.route.length - 1];
    giveRoute(bot, last && last.node ? last.node.id : null);
  }
  const wp = bot.route[bot.routeIndex] || bot.route[bot.route.length - 1];

  // A rival rounds a corner with a lookahead aim, which passes the waypoint a
  // few metres off the line — the arrival circle below would never close. Its
  // progress is the projection's crossing of the waypoint instead, read as a
  // continuous coordinate around the loop so a lap wraps without replanning.
  const bossProg =
    bot.isBoss && bot.route && bot.route.length > 1 ? bossPathProg(bot, ride) : null;
  if (bossProg !== null) {
    const ri = Math.floor(bossProg + 1) % bot.route.length;
    if (ri !== bot.routeIndex) {
      bot.routeIndex = ri;
      bot.stalled = 0;
      bot.wpDist = Infinity;
    }
  }

  if (bossProg === null && arrivedAt(ride, wp)) {
    bot.routeIndex++;
    bot.stalled = 0;
    if (bot.routeIndex >= bot.route.length) {
      // The line is done. A bot with a session of its own — a pro skater —
      // hears about it here so it can decide whether to keep going or step off.
      bot.onLineDone?.();
      const last = bot.route[bot.route.length - 1];
      giveRoute(bot, last && last.node ? last.node.id : null);
    }
  } else {
    // Stuck means no progress, not slow progress: a leg across the park takes
    // seconds, and a rival has no time to throw it away just because it has
    // not *arrived* yet. Only count time spent not closing on the waypoint —
    // measured as a closing speed, so the check holds at any step rate (a
    // rival closing at full speed clears far more than half a metre a second).
    // A rival advances its waypoint by projection instead, so "stalled" is a
    // projection that is not moving: the distance to the waypoint it rides at
    // closes as the lookahead rounds the corner, and only stops closing when
    // the board has genuinely stopped. The projection's own advance would have
    // already moved the waypoint on — a waypoint that stays put while the boss
    // is near it means it rounded the corner or rode past and keeps going.
    const ddx = wp.x - ride.pos.x;
    const ddz = wp.z - ride.pos.z;
    const d = Math.hypot(ddx, ddz);
    const closing = (bot.wpDist ?? d) - d;
    if (closing < dt * 0.6) bot.stalled += dt;
    else bot.stalled = Math.max(0, bot.stalled - dt);
    bot.wpDist = d;
    if (bot.stalled > (bot.stallTime ?? STALL_TIME)) {
      bot.stalled = 0;
      bot.wpDist = Infinity;
      // A rival has no time to orbit a waypoint it cannot reach — drop the
      // route and replan from where it actually is instead of coasting the
      // rest of a line it is stuck on. A rival that has stopped entirely
      // (boxed in, or stood on a spot it cannot push off from) reappears on
      // the new line the way it does after a bail, so the clock keeps moving.
      if (bot.isBoss) {
        giveRoute(bot, null);
        if (ride.mode === GROUND && bot.route && bot.route.length > 1) {
          const wp = bot.route[0];
          const next = bot.route[1];
          const yaw = Math.atan2(next.x - wp.x, next.z - wp.z);
          ride.reset({ x: wp.x, y: 0, z: wp.z, yaw });
          bot.bailCool = 0.5;
        }
      } else bot.routeIndex++;
    }
  }
  const cur = bot.route[Math.min(bot.routeIndex, bot.route.length - 1)];

  // A rival that cannot reach the waypoint it is on has no time to orbit it —
  // steer at the one after instead, so the board keeps rolling through the
  // line rather than circling a target sat behind a wall.
  let steerAt = cur;
  if (bot.isBoss && bot.stalled > 1.2) {
    steerAt = bot.route[Math.min(bot.routeIndex + 1, bot.route.length - 1)];
  }
  const node = steerAt.node;
  const rail =
    node && node.kind === 'rail' && node.forward ? lineOf(node) : null;
  const followRail =
    !!rail && distanceToLine(ride.pos.x, ride.pos.z, rail) < RAIL_APPROACH;
  let wantYaw;
  if (followRail) {
    const t = (ride.pos.x - rail.x) * rail.vx + (ride.pos.z - rail.z) * rail.vz;
    const ahead = Math.max(2.5, t + 3.5 + Math.abs(ride.speed) * 0.3);
    wantYaw = Math.atan2(
      rail.x + rail.vx * ahead - ride.pos.x,
      rail.z + rail.vz * ahead - ride.pos.z
    );
  } else if (bot.isBoss && bot.route && bot.route.length > 1) {
    wantYaw = bossLookaheadYaw(bot, ride);
  } else {
    wantYaw = Math.atan2(steerAt.x - ride.pos.x, steerAt.z - ride.pos.z);
  }
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
  // The edge band that actually parks a bot's tricks and manuals. A rival can
  // keep skating closer to the curb than the crowd — the physical edge-repel
  // below still uses BOUND_MARGIN, this is only how brave it gets with its feet.
  const trickEdge = clear < (bot.edgeMargin ?? BOUND_MARGIN);
  // Whether the board is actually carrying the bot towards the curb on the
  // axis that is itself near the curb — the thing the near-edge push gate is
  // really guarding against. A bot standing still, or riding parallel to or
  // away from the boundary, is free to push: railway parks run their patrol
  // loops right along the fence, and a bot that may not push while it is near
  // the edge never gets going at all.
  const headingIntoBoundary =
    (Math.sign(ride.pos.x) !== 0 && Math.sign(ride.vel.x) === Math.sign(ride.pos.x) && cx < BOUND_MARGIN) ||
    (Math.sign(ride.pos.z) !== 0 && Math.sign(ride.vel.z) === Math.sign(ride.pos.z) && cz < BOUND_MARGIN);

  // --- terrain ahead -------------------------------------------------------
  // Sample the height field a couple of metres out, the same field the
  // physics bails against. `dropAhead` is a lip worth launching off; `stepAhead`
  // is a wall — a curb or a feature side — worth popping over or steering
  // around, before the wheel ever reaches it.
  let dropAhead = 0;
  let stepAhead = 0;
  let avoidYaw = null;
  if (ride.mode === GROUND) {
    // A rival on the clock reads the park further ahead than a tourist — a
    // wall a tourist might clip is a duel a rival loses, so the probe reaches
    // out early enough that there is still room to steer around it.
    const look = (bot.isBoss ? 2.6 : 1.1) + Math.abs(ride.speed) * 0.25;
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

  if (nearEdge) {
    // Steer away only along the axis the bot is actually closing on — a bot
    // riding parallel to a fence (a patrol loop that hugs the boundary, say)
    // has nothing to dodge and should just keep riding it.
    const outX = Math.sign(ride.pos.x) !== 0 && Math.sign(ride.vel.x) === Math.sign(ride.pos.x) && cx < BOUND_MARGIN;
    const outZ = Math.sign(ride.pos.z) !== 0 && Math.sign(ride.vel.z) === Math.sign(ride.pos.z) && cz < BOUND_MARGIN;
    let away = null;
    if (outX) away = -Math.sign(ride.pos.x) * Math.PI / 2;
    if (outZ) away = ride.pos.z >= 0 ? Math.PI : 0;
    if (away !== null) wantYaw += C.angleDelta(wantYaw, away) * edgeW;
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
  // A trick popped into a corner lands sideways: the air stick spins the
  // board toward the next leg while the velocity holds the incoming line, and
  // a slip past LAND_SLIP_SKETCH is a slide-out. The board keeps the yaw it
  // popped with for the whole air, landing straight, and the corner is taken
  // on the wheels after touchdown where the carve is in charge.
  if (bot.isBoss && ride.mode === AIR) steer = 0;

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
    // A corner already being swung is braked above; a corner *coming up* is
    // braked here, but only a near-reversal of it: a waypoint the line doubles
    // back through past ~143 degrees is one the board cannot take at cruise
    // speed, so the boss sheds speed before it gets there. Any gentler corner
    // is left alone — braking the whole line for a corner the board takes fine
    // just costs the clock.
    let cornerAhead = false;
    let toWaypoint = Infinity;
    if (bot.isBoss && bot.route && bot.routeIndex > 0 && bot.routeIndex < bot.route.length) {
      const wp = bot.route[bot.routeIndex];
      const nw = bot.route[bot.routeIndex + 1];
      const pw = bot.route[bot.routeIndex - 1];
      if (nw && wp && pw) {
        const dA = Math.hypot(wp.x - pw.x, wp.z - pw.z);
        const dB = Math.hypot(nw.x - wp.x, nw.z - wp.z);
        if (dA > 1e-4 && dB > 1e-4) {
          const ux = (wp.x - pw.x) / dA;
          const uz = (wp.z - pw.z) / dA;
          const vx = (nw.x - wp.x) / dB;
          const vz = (nw.z - wp.z) / dB;
          const dot = Math.max(-1, Math.min(1, ux * vx + uz * vz));
          cornerAhead = Math.acos(dot) > 2.5;
        }
        toWaypoint = Math.hypot(wp.x - ride.pos.x, wp.z - ride.pos.z);
      }
    }
    if (cornering && Math.abs(ride.speed) > bot.cruise - 0.8) brake = true;
    else if (cornerAhead && toWaypoint < 6 && Math.abs(ride.speed) > 3.0) brake = true;
    else if (stepAhead > 0.3 && Math.abs(ride.speed) > 3.6) brake = true;
    else if (playerDist < YIELD_R && Math.abs(ride.speed) > 2.5) brake = true;
    // Rolling backwards is a state the carve cannot steer out of: the physics
    // inverts the lean against travel, so corrective steering just holds the
    // board 180° off and a "fakie push" keeps the roll alive. Shed the speed
    // instead — at a crawl the pivot turns the board round and the run carries
    // on the right way up.
    else if (ride.speed < -0.5) brake = true;
    else if (
      bot.manualT <= 0 &&
      // A push drives the way the board is already rolling — a slightly
      // backward board pushes backwards, which keeps a slow fakie roll alive
      // forever (brake to a crawl, push it back under, brake again). Only push
      // once the roll is actually forward; friction and the brake above handle
      // the rest, and the pivot at a standstill turns the board the right way.
      ride.speed >= 0 &&
      Math.abs(ride.speed) < bot.cruise &&
      bot.pushCool <= 0 &&
      !headingIntoBoundary &&
      (!cornering || Math.abs(ride.speed) < 0.8 || (bot.isBoss && Math.abs(ride.speed) < 3)) &&
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
      trickEdge || stepAhead > 0.3 || dropAhead > 0.3 || Math.abs(ride.speed) < 1.4;
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
      bot.manualCool <= 0 &&
      // A manual resets the combo's bank clock, so it waits until the combo
      // has banked what it is worth — a manual mid-bank is a dropped run.
      !ride.combo?.live
    ) {
      // A manual-focused rival (manualFocus) balances far longer and much
      // sooner between attempts than a bot that just happens to manual.
      bot.manualT =
        (bot.manualHold ?? (bot.manualFocus ? 2.2 : 1.2)) +
        Math.random() * (bot.manualFocus ? 2.4 : 1.8);
      bot.wantManual = false;
      bot.manualCool = bot.manualFocus ? 2 + Math.random() * 2 : 7 + Math.random() * 7;
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
  if (ride.mode === GROUND && !ride.grind && !ride.manual && bot.manualT <= 0 && !trickEdge) {
    bot.trickCool -= dt;
    bot.randomTrickCool -= dt;
    const speedOk = Math.abs(ride.speed) > 2.4;
    const curbPop = stepAhead > CURB_POP_MIN && stepAhead <= CURB_POP_MAX;
    const lip = dropAhead > LIP_DROP;
    const show = playerDist < SHOW_OFF_R;
    const rand = bot.randomTrickCool <= 0;
    // A pro decides its own trick — feature-targeted, chained onto whatever it
    // just landed, and never repeating a recent one (see ProSkater). Absent a
    // pro, the touring behaviour below carries the bot. A rival's decision is
    // its own too (see bossChooseTrick) — the touring fallback never fires for
    // it, or a show-off pop would leapfrog the rival's banked-combo gating.
    const pro = bot.chooseTrick
      ? bot.chooseTrick({ ride, speedOk, curbPop, lip, show, rand, stepAhead, dropAhead, nearEdge })
      : null;
    if (pro) {
      trick = pro.trick;
      trickCharge = pro.charge;
      bot.wantManual = !!pro.manual;
    } else if (!bot.isBoss && curbPop && speedOk && bot.curbPopCool <= 0) {
      trick = 'ollie';
      trickCharge = 0.7 + Math.random() * 0.25;
      bot.curbPopCool = 1.5;
      bot.wantManual = false;
    } else if (!bot.isBoss && bot.trickCool <= 0 && speedOk && bot.bailCool <= 0 && (lip || show || rand)) {
      const ch = 0.5 + Math.random() * 0.4;
      const extra = lip ? Math.sqrt((2 * Math.min(2.5, dropAhead)) / -C.GRAVITY) : 0;
      trick = pickTrick(bot, ch, extra);
      trickCharge = ch;
      // Pace (rival identity) tightens the gap between tricks: a fast rival
      // is popping before the last one has cooled down.
      bot.trickCool = (3 + Math.random() * 4) / (bot.pace || 1);
      bot.randomTrickCool = (3 + Math.random() * 4) / (bot.pace || 1);
      bot.wantManual =
        bot.skill >= 2 &&
        Math.random() < (bot.manualFocus ? 0.9 : bot.skill >= 3 ? 0.55 : 0.3);
    }
  }

  // --- grabs ---------------------------------------------------------------
  // Rivals can grab in the air: once the pop has cleared, hold a grab from
  // the rival's own grab bag for a beat, then let it go before the landing.
  // The input stays truthy for the whole hold, exactly like a player holding
  // the grab key, so physics scores it as a landed grab-trick on the way down.
  let grab = null;
  if (ride.mode === AIR && bot.grabBag && bot.grabBag.length) {
    if (bot.grabCool > 0) bot.grabCool -= dt;
    if (bot.heldGrab) {
      bot.heldGrabT -= dt;
      if (bot.heldGrabT <= 0) bot.heldGrab = null;
      else grab = bot.heldGrab;
    } else if (!ride.grab && bot.grabCool <= 0 && ride.airTime > 0.25) {
      bot.heldGrab = bot.grabBag[(Math.random() * bot.grabBag.length) | 0];
      bot.heldGrabT = 0.45 + Math.random() * 0.4;
      bot.grabCool = 2.5 + Math.random() * 2.5;
      grab = bot.heldGrab;
    }
  }

  const input = { steer, charge, slide: false, push, brake, trick, trickCharge, grab };
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

// --- the rival's crowd ----------------------------------------------------
// When a park's rival is on show, part of the social crowd huddles around
// him: on foot, board in hand, pacing a ring that circles the star — hopping
// off-beat, the way a hyped crowd actually bounces — with a wedge of the
// ring left open so the player can skate straight in and challenge. The
// moment the rival rides again or leaves, they go back to being a normal
// crowd.
const CROWD_COUNT = 7;     // how many skaters form the ring
const CROWD_RING_R = 4.4;  // metres out the ring stands from the rival
const CROWD_GAP = 1.2;     // radians of the ring left open for the player
const CROWD_PACE = 2.0;    // m/s a crowd skater paces along its slice
const CROWD_HOP_UP = 0.3;  // metres a full-frisk hop lifts off the ground
const CROWD_SETTLE_R = 1.5; // close enough to its slot that a crowd skater starts pacing

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

  /** Join the ring around a rival who is on show: drop whatever the social
   * crowd was doing and pace a slice of the ring that circles him. `slot`
   * fixes this bot's place in the ring — its angular offset from the open
   * wedge, the width of its slice, which way it paces and how frisky its
   * hops are — so the seven bots spread around the star instead of piling
   * up. */
  startCrowd(boss, slot) {
    this.crowd = { boss, ...slot, angle: slot.offset, hopT: Math.random() * 6 };
    if (this.riding) this.dismount();
    this.wanderTarget = null;
    this.pauseTimer = 0;
  }

  /** Back to the normal social routine — wandering, chatting, group rides. */
  endCrowd() {
    this.crowd = null;
    this.wanderTarget = null;
  }

  /**
   * The hyped ring around a rival: pace along this bot's own slice of a ring
   * that circles him, on foot and board in hand, bouncing off the slice's
   * ends so the wedge open for the player stays clear — while hopping
   * off-beat, the way an excited crowd actually bounces. A crowd skater
   * joining from across the park walks straight to its slot first — a still
   * point, so the ring forms cleanly instead of a bot chasing a point that
   * is already pacing round the rival. Tracks the rival wherever he stands,
   * so the ring holds through his skate-in and closes in around him the
   * moment he steps off.
   */
  stepCrowd(dt) {
    if (this.riding) this.dismount();
    const c = this.crowd;
    if (!c || !c.boss) return;
    const cx = c.boss.pos.x;
    const cz = c.boss.pos.z;
    const w = this.walker;

    let move;
    if (!c.settled) {
      const sx = cx + Math.cos(c.offset) * CROWD_RING_R;
      const sz = cz + Math.sin(c.offset) * CROWD_RING_R;
      const dx = sx - w.pos.x;
      const dz = sz - w.pos.z;
      if (dx * dx + dz * dz < CROWD_SETTLE_R * CROWD_SETTLE_R) {
        c.settled = true;
      } else {
        const wantYaw = Math.atan2(dx, dz);
        const delta = C.angleDelta(w.yaw, wantYaw);
        move = { x: -C.clamp(delta / WALK_TURN, -1, 1), y: Math.abs(delta) < WALK_ALIGN ? 1 : 0 };
      }
    }

    if (!move) {
      // On the ring: pace the slice, bouncing off its ends. Every bot stays
      // inside its own arc, so the ring keeps moving while the wedge never
      // fills.
      c.angle += c.dir * (CROWD_PACE / CROWD_RING_R) * dt * (0.6 + c.frisk * 0.4);
      const lo = c.offset - c.sector / 2;
      const hi = c.offset + c.sector / 2;
      if (c.angle > hi) { c.angle = hi; c.dir = -1; }
      if (c.angle < lo) { c.angle = lo; c.dir = 1; }
      const tx = cx + Math.cos(c.angle) * CROWD_RING_R;
      const tz = cz + Math.sin(c.angle) * CROWD_RING_R;
      const dx = tx - w.pos.x;
      const dz = tz - w.pos.z;
      const wantYaw = Math.atan2(dx, dz);
      const delta = C.angleDelta(w.yaw, wantYaw);
      // Turn to face before moving forward, the same guard stepWalk uses, so
      // a bot stepping onto the ring does not shuttle back and forth along it.
      move = { x: -C.clamp(delta / WALK_TURN, -1, 1), y: Math.abs(delta) < WALK_ALIGN ? 1 : 0 };
    }
    w.update(dt, move);

    // Excitement: a per-bot bouncy hop. The hop rides w.pos.y for the single
    // frame poseWalk reads it, so the whole rig — carried board included —
    // lifts together and the ring jumps rather than strolls.
    c.hopT += dt;
    const hop = Math.max(0, Math.sin(c.hopT * (5 + c.frisk * 3))) * CROWD_HOP_UP * c.frisk;
    w.pos.y = w.park.heightAt(w.pos.x, w.pos.z) + hop;
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
    this.crowd = null;
    this.dropAtHangout();
    this.riding = false;
    this.route = null;
    this.routeIndex = 0;
  }

  step(dt, playerPos) {
    // A ring around a rival is just this crowd's "hanging out" state with a
    // target: it stands down the moment the shared timer calls everyone in
    // for a group ride, and comes back the moment the ride ends.
    if (this.group.riding) {
      if (!this.riding) this.mount();
    } else if (this.riding) {
      this.dismount();
    }

    if (this.riding) stepPatrol(this.ride, this, dt, playerPos);
    else if (this.crowd) this.stepCrowd(dt);
    else this.stepWalk(dt);
  }
}

/**
 * Point the walkable bots of the crowd at a rival who is on show: hand each
 * a slot on a ring that circles him — its slice of the circle, which way it
 * paces, how frisky its hops are — and start them huddling. A wedge
 * (CROWD_GAP radians) is left open, and the whole ring sits well back of the
 * rival, so the player can always skate in and challenge. Returns the bots
 * chosen: the social crowd, the ones already on foot with boards in hand.
 */
export function assignBossCrowd(bots, boss, count = CROWD_COUNT) {
  const walkers = bots.filter((b) => b.group);
  const pick = walkers.slice(0, count);
  const occupied = Math.PI * 2 - CROWD_GAP;
  const sector = occupied / Math.max(1, pick.length);
  pick.forEach((b, i) => {
    b.startCrowd(boss, {
      offset: CROWD_GAP / 2 + sector * (i + 0.5),
      sector,
      dir: i % 2 === 0 ? 1 : -1,
      frisk: 0.55 + (i / Math.max(1, pick.length - 1)) * 0.45,
    });
  });
  return pick;
}

// --- the pro crowd ------------------------------------------------------
// Five pros share the park, but they are not tourists: they session it. Where
// a touring bot rides a route to a random feature and pops whatever happens to
// fit, a pro plans a *line* — a flow of real features (rail → ledge →
// transition and friends, straight off findLines) — routes onto it, and rides
// it feature to feature throwing deliberate tricks: a bigger air off a lip, a
// manual chained off the landing, a grind when the line runs a bar. Each pro
// has its own style — which features it hunts, which tricks it favours, how
// much it rides rails, airs or manuals — and none of them repeats a recent
// trick, so a park full of pros looks like five skaters with five different
// bags of tricks instead of one looped clip. After a few lines it steps off
// and takes a real break by a feature, then remounts and sessions again. It
// is the same ride, graph, terrain reading, grinding, manual and trick physics
// every other bot (and the player) uses — driven through the same stepPatrol,
// with only the planning and the trick choice owned by the pro.
const PRO_SESSION_LINES_MIN = 3, PRO_SESSION_LINES_MAX = 6; // lines before a break
const PRO_BREAK_MIN = 7, PRO_BREAK_MAX = 15;                 // seconds hanging out
const PRO_AVOID = 4;          // how many recent tricks a pro never immediately repeats
const PRO_BREAK_ARRIVE_R = 1.5; // close enough to the break spot to count as arrived

/** The five pros' personalities. `pool` is the tricks they favour (all of
 * skill 4's catalogue, weighted per style), `kinds` the features they hunt,
 * and air/grind/manual how much of each the style leans on. */
const PRO_STYLES = [
  {
    name: 'street',
    pool: ['kickflip', 'heelflip', 'varial', 'varialheel', 'hardflip', 'inheel', 'treflip', 'gazelle', 'nightmare', 'fsshuv360'],
    kinds: ['rail', 'ledge', 'stair'],
    air: 0.4, grind: 1.0, manual: 0.75,
  },
  {
    name: 'air',
    pool: ['kickflip', 'heelflip', 'shuv360', 'varial', 'treflip', 'hardflip', 'impossible', 'gazelle', 'heel360', 'nightmare'],
    kinds: ['transition', 'stair'],
    air: 1.0, grind: 0.3, manual: 0.35,
  },
  {
    name: 'freestyle',
    pool: ['ollie', 'shuvit', 'fsshuvit', 'shuv360', 'varial', 'varialheel', 'hardflip', 'inheel', 'impossible', 'treflip', 'fsshuv360'],
    kinds: ['flat', 'stair'],
    air: 0.35, grind: 0.2, manual: 1.0,
  },
  {
    name: 'allround',
    pool: ['kickflip', 'heelflip', 'shuv360', 'varial', 'varialheel', 'hardflip', 'inheel', 'treflip', 'impossible', 'gazelle', 'heel360', 'nightmare'],
    kinds: ['rail', 'ledge', 'transition', 'stair', 'flat'],
    air: 0.7, grind: 0.7, manual: 0.55,
  },
  {
    name: 'bomber',
    pool: ['ollie', 'kickflip', 'heelflip', 'shuv360', 'varial', 'treflip', 'hardflip', 'gazelle'],
    kinds: ['rail', 'ledge', 'stair'],
    air: 0.6, grind: 1.0, manual: 0.3,
  },
];

/** A trick the pro can actually finish, drawn from its style's pool, that it
 * has not thrown in the last `PRO_AVOID` tries. Same rotation-time gate the
 * touring bots use, so a small hop on the flat gets a shuvit, not a tre flip. */
function proPickTrick(bot, charge, extraAir) {
  const style = bot.style;
  const air = airTimeFor(charge) + extraAir;
  const fits = (id) => {
    const def = TRICK_BY_ID[id];
    return def && trickTimeNeeded(def) < air * 0.7 + 0.06;
  };
  const fresh = style.pool.filter((id) => fits(id) && !bot.recentTricks.includes(id));
  const pool = (fresh.length ? fresh : style.pool.filter(fits));
  const list = pool.length ? pool : ['ollie', 'kickflip', 'heelflip'];
  const trick = list[(Math.random() * list.length) | 0];
  bot.recentTricks.push(trick);
  if (bot.recentTricks.length > PRO_AVOID) bot.recentTricks.shift();
  return trick;
}

/**
 * A bot that sessions the park: plans real lines off the graph's flow (rails,
 * ledges, transitions, stairs and bowls), rides them feature to feature, and
 * decides its own tricks — deliberate, style-appropriate, chained and never
 * repeated too soon. After a few lines it steps off and takes a break near a
 * feature, then remounts and goes again. Everything the ride itself does runs
 * through the same stepPatrol as the touring crew; the pro only owns where it
 * goes, when it tricks, and when it sits one out.
 */
export class ProSkater {
  constructor(park, paletteIndex, styleIndex, scene) {
    this.board = new Board();
    this.skater = new Skater(PALETTES[paletteIndex % PALETTES.length], {
      glow: false,
      style: STYLES[paletteIndex % STYLES.length],
    });
    this.ride = new Ride(park, this.board, this.skater);
    this.walker = new Walker(park);
    this.patrol = park.patrol;
    this.scene = scene;
    this.style = PRO_STYLES[styleIndex % PRO_STYLES.length];
    this.skill = 4;
    this.cruise = SKILL_CRUISE[skillIndex(this.skill)] ?? CRUISE_SPEED;
    this.bailWait = 0;
    this.trickCool = 0.8 + Math.random() * 0.6;
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
    this.recentTricks = [];
    this.isPro = true;
    this.onBreak = false;
    this.wantBreak = false;
    this.breakT = 0;
    this.lineCount = 0;
    this.linesToBreak = PRO_SESSION_LINES_MIN + ((Math.random() * (PRO_SESSION_LINES_MAX - PRO_SESSION_LINES_MIN + 1)) | 0);
    this.hangout = pickHangout(park) || park.patrol[0];
    this.target = (Math.random() * park.patrol.length) | 0;
    this.planRoute = this.planRoute.bind(this);
    this.chooseTrick = this.chooseTrick.bind(this);
    this.onLineDone = this.onLineDone.bind(this);
    this.toStart();
  }

  /** Drop onto the park at a patrol point, on the board and ready to session. */
  toStart() {
    this.scene.remove(this.board.group);
    this.scene.remove(this.skater.group);
    this.ride.frame.add(this.board.group);
    this.ride.frame.add(this.skater.group);
    this.board.group.position.set(0, 0, 0);
    this.board.group.quaternion.identity();
    this.skater.settle();
    this.route = null;
    this.planRoute(null);
  }

  /**
   * Plan the next session: a line off the graph's real flow lines, routed onto
   * from wherever the bot happens to be standing. Falls back to the shared
   * tour routing when the park has no lines worth planning.
   */
  planRoute(fromId) {
    const g = this.ride.park.graph;
    if (!g || g.nodes.length < 2) {
      refreshRoute(this, fromId);
      return;
    }
    const byId = nodeById(g);
    const maxDiff = SKILL_MAX_DIFF[skillIndex(this.skill)] ?? 5;
    const lines = findLines(g, { maxHops: 3, max: 60 });
    const favored = [];
    const feasible = [];
    for (const l of lines) {
      if (l.nodes.length < 2 || l.difficulty > maxDiff) continue;
      if (l.kinds.some((k) => this.style.kinds.includes(k))) favored.push(l);
      else feasible.push(l);
    }
    const pool = favored.length ? favored : feasible;
    if (!pool.length) {
      refreshRoute(this, fromId);
      return;
    }
    // Score toward the longer lines so a session is a session, with a little
    // randomness so a pro does not ride the exact same route every time.
    let best = pool[0];
    let bestScore = -Infinity;
    for (const l of pool) {
      const s = l.hops + Math.random();
      if (s > bestScore) {
        bestScore = s;
        best = l;
      }
    }
    const waypoints = best.nodes.map((id) => {
      const n = byId.get(id);
      return { x: n.x, z: n.z, node: n };
    });
    // Route onto the line from the nearest feature, so the bot opens with a
    // real approach instead of teleporting to the line's first bar.
    const near = nearestSkate(g, this.ride.pos.x, this.ride.pos.z, { max: 1 })[0];
    const pts = [];
    if (near && near.node.id !== best.nodes[0]) {
      const { routes } = routesBetween(g, near.node.id, best.nodes[0], { max: 1 });
      if (routes.length) {
        for (const id of routes[0].nodes) {
          if (id === best.nodes[0]) break;
          const n = byId.get(id);
          pts.push({ x: n.x, z: n.z, node: n });
        }
      }
    }
    this.route = [...pts, ...waypoints];
    this.routeIndex = 0;
    this.stalled = 0;
  }

  /** The line is done — decide whether to keep sessioning or take a break. */
  onLineDone() {
    this.lineCount++;
    if (this.lineCount >= this.linesToBreak) this.wantBreak = true;
  }

  /**
   * The pro's own trick decision, consulted by stepPatrol in place of the
   * touring bots' random pops. A lip ahead earns the biggest trick the style
   * throws; open ground earns regular sessioning; and the pro's own cool keeps
   * a trick from stacking on a trick it has barely landed. `manual` chains a
   * manual off the landing when the style leans that way.
   */
  chooseTrick({ ride, speedOk, curbPop, lip, show, stepAhead, dropAhead, nearEdge }) {
    if (nearEdge || !speedOk) return null;
    if (curbPop && this.curbPopCool <= 0) {
      this.curbPopCool = 1.4;
      return { trick: 'ollie', charge: 0.7 + Math.random() * 0.2, manual: false };
    }
    const ready = this.trickCool <= 0 && this.bailCool <= 0;
    if ((lip || show) && ready) {
      const ch = 0.7 + Math.random() * 0.3;
      const extra = lip ? Math.sqrt((2 * Math.min(2.5, dropAhead)) / -C.GRAVITY) : 0;
      const trick = proPickTrick(this, ch, extra);
      this.afterTrick();
      return { trick, charge: ch, manual: this.style.manual > Math.random() };
    }
    if (ready) {
      const ch = 0.5 + Math.random() * 0.45;
      const trick = proPickTrick(this, ch, 0);
      this.afterTrick();
      return { trick, charge: ch, manual: this.style.manual > Math.random() };
    }
    return null;
  }

  /** Pace the next trick — air-heads and street pros keep the feet busy. */
  afterTrick() {
    this.trickCool = (1.2 + Math.random() * 1.2) / (0.7 + this.style.air * 0.6);
    // A fresh landing deserves a fresh manual when the style wants one — clear
    // the residual cool from the last one so trick → manual → trick reads as
    // one continuous line rather than three separate moments.
    this.manualCool = 0;
  }

  /** Step off the board and take a real break by a feature. */
  startBreak() {
    this.onBreak = true;
    this.wantBreak = false;
    this.scene.add(this.board.group);
    this.scene.add(this.skater.group);
    this.ride.frame.remove(this.board.group);
    this.ride.frame.remove(this.skater.group);
    this.skater.settle();
    this.walker.reset(this.ride.pos.x, this.ride.pos.z, this.ride.yaw);
    this.skater.poseWalk(this.walker, 1 / 60);
    poseCarriedBoard(this.walker, this.skater, this.board);
    this.breakSpot = this.hangout || this.patrol[(Math.random() * this.patrol.length) | 0];
    this.breakT = PRO_BREAK_MIN + Math.random() * (PRO_BREAK_MAX - PRO_BREAK_MIN);
  }

  /** Walking it out: head to the break spot, hang there, then ride again. */
  stepBreak(dt) {
    const w = this.walker;
    this.breakT -= dt;
    const dx = this.breakSpot.x - w.pos.x;
    const dz = this.breakSpot.z - w.pos.z;
    if (Math.hypot(dx, dz) > PRO_BREAK_ARRIVE_R) {
      const wantYaw = Math.atan2(dx, dz);
      const delta = C.angleDelta(w.yaw, wantYaw);
      const move = { x: -C.clamp(delta / WALK_TURN, -1, 1), y: Math.abs(delta) < WALK_ALIGN ? 1 : 0 };
      w.update(dt, move);
    } else {
      // Hanging out: turn to face the park.
      const wantYaw = Math.atan2(this.ride.park.spawn.z - w.pos.z, this.ride.park.spawn.x - w.pos.x);
      w.update(dt, { x: -C.clamp(C.angleDelta(w.yaw, wantYaw) / WALK_TURN, -1, 1), y: 0 });
    }
    this.skater.poseWalk(w, dt);
    poseCarriedBoard(w, this.skater, this.board);
    if (this.breakT <= 0) this.endBreak();
  }

  /** Mount up and start a fresh session. */
  endBreak() {
    this.scene.remove(this.board.group);
    this.scene.remove(this.skater.group);
    this.ride.frame.add(this.board.group);
    this.ride.frame.add(this.skater.group);
    this.board.group.position.set(0, 0, 0);
    this.board.group.quaternion.identity();
    this.skater.settle();
    this.ride.reset({ x: this.walker.pos.x, y: 0, z: this.walker.pos.z, yaw: this.walker.yaw });
    this.onBreak = false;
    this.lineCount = 0;
    this.linesToBreak = PRO_SESSION_LINES_MIN + ((Math.random() * (PRO_SESSION_LINES_MAX - PRO_SESSION_LINES_MIN + 1)) | 0);
    this.route = null;
    this.routeIndex = 0;
    this.stalled = 0;
    this.trickCool = 0.6 + Math.random() * 0.6;
    this.planRoute(null);
  }

  /** Hand the bot a new park — a fresh graph, a fresh session, back on the board. */
  setPark(park) {
    this.ride.park = park;
    this.walker.park = park;
    this.patrol = park.patrol;
    this.hangout = pickHangout(park) || park.patrol[0];
    this.scene.remove(this.board.group);
    this.scene.remove(this.skater.group);
    this.ride.frame.add(this.board.group);
    this.ride.frame.add(this.skater.group);
    this.board.group.position.set(0, 0, 0);
    this.board.group.quaternion.identity();
    this.skater.settle();
    this.onBreak = false;
    this.wantBreak = false;
    this.breakT = 0;
    this.lineCount = 0;
    this.linesToBreak = PRO_SESSION_LINES_MIN + ((Math.random() * (PRO_SESSION_LINES_MAX - PRO_SESSION_LINES_MIN + 1)) | 0);
    this.recentTricks.length = 0;
    this.bailWait = 0;
    this.route = null;
    this.routeIndex = 0;
    this.target = (Math.random() * park.patrol.length) | 0;
    const i = (Math.random() * park.patrol.length) | 0;
    const wp = park.patrol[i];
    const next = park.patrol[(i + 1) % park.patrol.length];
    this.ride.reset({ x: wp.x, y: 0, z: wp.z, yaw: Math.atan2(next.x - wp.x, next.z - wp.z) });
    this.planRoute(null);
  }

  step(dt, playerPos) {
    if (this.wantBreak && this.ride.mode === GROUND) this.startBreak();
    if (this.onBreak) {
      this.stepBreak(dt);
      return;
    }
    stepPatrol(this.ride, this, dt, playerPos);
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
 *
 * On top of the crowd, a few pros session the park: each plans its own flow
 * lines off the graph, rides them feature to feature with deliberate,
 * non-repeating tricks, and steps off for a break between sessions.
 */
export function makeAiSkaters(park, scene, total = 20, socialCount = 8, proCount = 5) {
  const bots = [];
  const touringCount = Math.max(0, total - socialCount - proCount);
  for (let i = 0; i < touringCount; i++) {
    const startIdx = Math.round((i * park.patrol.length) / Math.max(1, touringCount));
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
  // The pros: one of each style, so the park has a street pro, an air pro, a
  // freestyler, an all-rounder and a bomber rather than five of the same guy.
  for (let i = 0; i < proCount; i++) {
    bots.push(new ProSkater(park, touringCount + socialCount + i, i, scene));
  }
  return { bots, group };
}

// The pieces a rival (boss.js) reuses: the ride controller, the carried-board
// pose, and a hangout pick — everything that lets a park's boss skate the same
// physics as the crowd while standing apart from it.
export { stepPatrol, poseCarriedBoard, pickHangout };

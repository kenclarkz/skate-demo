// The park rivals: a ladder of ten bosses, one per character, each with its
// own dedicated park.
//
// A rival is the player's own rig in disguise. It carries a Board, a Skater
// and a Ride exactly like the touring bots in ai.js, and it is driven by the
// very same pursuit controller (stepPatrol) — only its identity is authored
// instead of rolled: a skill band, a cruise speed, a pace that tightens the
// gaps between tricks, a focus that leans its routed lines toward the features
// it is known for, and a trick bag (and grab bag) hand-picked to match the
// character. On foot it stands at a hangout spot carrying its board, the same
// pose a social bot wears; when the cutscene or a challenge starts it mounts
// up and skates the park's own lines, scored by the same physics as the player.
//
// The ladder's order and its reveals are decided here; whether a boss is still
// standing is save's business (bossesDefeated), and when one steps out is
// main.js's (the park's best clearing BOSS_REVEAL_SCORE).

import * as C from './config.js';
import { Board } from './board.js';
import { Skater } from './skater.js';
import { Ride } from './physics.js';
import { Walker } from './walk.js';
import { stepPatrol, poseCarriedBoard, pickHangout } from './ai.js';
import { byId as charById } from './characters.js';

const IDLE_TURN = 1.4; // how sharply a standing rival turns in place
const IDLE_TURN_MIN = 1.5; // seconds between a rival deciding to look elsewhere
const IDLE_TURN_MAX = 4;

/** The ten bosses, in challenge order. */
export const BOSSES = [
  {
    id: 'ace',
    parkId: 'home',
    characterId: 'ace',
    name: 'Ace',
    title: 'The Flatground Boss',
    tagline: 'Cap, tee, and a lifetime of flat ground.',
    skill: 2,
    cruise: 5.0,
    pace: 1.0,
    focus: 'flat',
    tricks: ['ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit', 'shuv360', 'varial'],
  },
  {
    id: 'nova',
    parkId: 'nova',
    characterId: 'nova',
    name: 'Nova',
    title: 'The Manual Master',
    tagline: 'Nose up for days. Beat the balance meter, not the board.',
    skill: 2,
    cruise: 5.0,
    pace: 0.9,
    focus: 'manual',
    tricks: ['ollie', 'shuvit', 'fsshuvit', 'kickflip', 'heelflip'],
  },
  {
    id: 'rae',
    parkId: 'plaza',
    characterId: 'rae',
    name: 'Rae',
    title: 'The Deep-End Diver',
    tagline: 'Pumps the bowl, floats impossibles over the coping.',
    skill: 3,
    cruise: 5.6,
    pace: 1.1,
    focus: 'air',
    tricks: ['ollie', 'kickflip', 'heelflip', 'hardflip', 'inheel', 'impossible'],
  },
  {
    id: 'bolt',
    parkId: 'bolt',
    characterId: 'bolt',
    name: 'Bolt',
    title: 'The Bowl Storm',
    tagline: 'Helmet on, head first into the deep end, grabs in mid-air.',
    skill: 3,
    cruise: 5.6,
    pace: 1.15,
    focus: 'air',
    tricks: ['ollie', 'kickflip', 'treflip', 'gazelle', 'fsshuv360'],
    grabs: ['indy', 'mute'],
  },
  {
    id: 'tigre',
    parkId: 'vert',
    characterId: 'tigre',
    name: 'Tigre',
    title: 'The Rail Tiger',
    tagline: 'Locks rails like nothing else and holds them forever.',
    skill: 3,
    cruise: 5.6,
    pace: 1.05,
    focus: 'grind',
    tricks: ['ollie', 'kickflip', 'heelflip', 'shuv360', 'hardflip'],
    grabs: ['indy', 'method'],
  },
  {
    id: 'shove',
    parkId: 'shove',
    characterId: 'shove',
    name: 'Tony Shove',
    title: 'The Birdman',
    tagline: 'The legend of vert: airs so high the horizon drops away.',
    skill: 4,
    cruise: 6.2,
    pace: 1.2,
    focus: 'air',
    tricks: ['ollie', 'kickflip', 'heelflip', 'shuv360', 'treflip', 'gazelle', 'heel360', 'impossible'],
    grabs: ['method', 'mute'],
  },
  {
    id: 'briar',
    parkId: 'railway',
    characterId: 'briar',
    name: 'Briar',
    title: 'The Rail-Hopper',
    tagline: 'Locks the ledges, then rides the rails like they owe her money.',
    skill: 4,
    cruise: 6.2,
    pace: 1.15,
    focus: 'rail',
    tricks: ['ollie', 'kickflip', 'heelflip', 'varial', 'varialheel', 'hardflip', 'inheel'],
  },
  {
    id: 'gnorbert',
    parkId: 'gnorbert',
    characterId: 'gnorbert',
    name: 'Gnorbert',
    title: 'The Garden Legend',
    tagline: 'Flat-ground perfection from a very small rider.',
    skill: 3,
    cruise: 5.0,
    pace: 0.95,
    focus: 'flat',
    tricks: ['ollie', 'shuvit', 'fsshuvit', 'shuv360', 'fsshuv360', 'kickflip', 'heelflip'],
  },
  {
    id: 'bananas',
    parkId: 'bananas',
    characterId: 'bananas',
    name: 'Bananas',
    title: 'The Ape of Air',
    tagline: 'A monkey costume with no fear of heights — grabs every way up.',
    skill: 4,
    cruise: 6.2,
    pace: 1.2,
    focus: 'air',
    tricks: ['ollie', 'kickflip', 'heelflip', 'treflip', 'gazelle', 'nightmare', 'fsshuv360'],
    grabs: ['indy', 'tailgrab', 'nosegrab'],
  },
  {
    id: 'raven',
    parkId: 'raven',
    characterId: 'raven',
    name: 'Raven',
    title: 'The Bird-Man Finale',
    tagline: 'Glides over every rail. The last boss — the whole book.',
    skill: 4,
    cruise: 6.2,
    pace: 1.3,
    focus: 'grind',
    tricks: [
      'ollie', 'kickflip', 'heelflip', 'shuvit', 'fsshuvit', 'shuv360',
      'varial', 'varialheel', 'hardflip', 'impossible', 'inheel', 'fsshuv360',
      'gazelle', 'nightmare', 'heel360', 'treflip',
    ],
    grabs: ['method', 'mute', 'indy'],
  },
];

/** @returns the bosses whose park is the given one, in challenge order. */
export function bossLadder(parkId) {
  return BOSSES.filter((b) => b.parkId === parkId);
}

/**
 * What the current run must have banked to beat a rival: the points and
 * (cumulative, non-consecutive) trick totals. Position in the ladder is
 * global — Ace is the first rival, Raven the tenth — so the bar climbs all
 * the way through the ten parks rather than resetting on each one.
 * @returns {{ points: number, tricks: number }}
 */
export function bossRequirement(def) {
  const idx = BOSSES.findIndex((b) => b.id === def.id);
  const n = Math.max(1, idx + 1);
  return {
    points: C.BOSS_BASE_SCORE + (n - 1) * C.BOSS_SCORE_STEP,
    tricks: C.BOSS_BASE_TRICKS + (n - 1) * C.BOSS_TRICKS_STEP,
  };
}

/**
 * A rival on the ground. `mode` is 'idle' (on foot, carrying its board at a
 * hangout spot) or 'riding' (mounted, driving its own lines through the same
 * pursuit controller the crowd uses). Stepping it only needs the mode — the
 * challenge/cutscene states decide when to call toRide/toIdle.
 */
export class BossSkater {
  constructor(park, scene, def) {
    const character = charById[def.characterId];
    this.def = def;
    this.board = new Board();
    this.skater = new Skater(character.palette, { glow: false, style: character.style });
    this.ride = new Ride(park, this.board, this.skater);
    this.walker = new Walker(park);
    this.patrol = park.patrol;
    this.scene = scene;
    this.skill = def.skill;
    this.cruise = def.cruise;
    this.pace = def.pace || 1;
    this.trickBag = def.tricks || null;
    this.grabBag = def.grabs || null;
    this.focus = def.focus || null;
    this.manualFocus = def.focus === 'manual';
    // The pursuit controller's state, seeded the way a riding bot's is.
    this.target = 0;
    this.bailWait = 0;
    this.trickCool = 2 + Math.random() * 2;
    this.randomTrickCool = 0;
    this.pushCool = Math.random() * 0.4;
    this.bailCool = 0;
    this.yieldCool = 0;
    this.manualCool = 0;
    this.curbPopCool = 0;
    this.stalled = 0;
    this.wantManual = false;
    this.manualT = 0;
    this.grabCool = 0;
    this.heldGrab = null;
    this.heldGrabT = 0;
    this.route = null;
    this.routeIndex = 0;
    this.mode = 'idle';
    // The Ride constructor parents the rig to its own frame; a rival starts on
    // foot instead, board in hand, with the frame itself parked in the scene so
    // mounting up is only ever a reparent.
    this.ride.frame.remove(this.board.group);
    this.ride.frame.remove(this.skater.group);
    scene.add(this.ride.frame);
    this.hangout = pickHangout(park) || park.patrol[0];
    this.dropAtHangout();
  }

  get pos() {
    return this.mode === 'idle' ? this.walker.pos : this.ride.pos;
  }

  /** Stand at the hangout spot, on foot, facing any which way. */
  dropAtHangout() {
    const yaw = Math.random() * Math.PI * 2;
    this.walker.reset(this.hangout.x, this.hangout.z, yaw);
    this.scene.add(this.board.group);
    this.scene.add(this.skater.group);
    this.skater.settle();
    this.skater.poseWalk(this.walker, 1 / 60);
    poseCarriedBoard(this.walker, this.skater, this.board);
    this.idleYaw = yaw;
    this.idleTimer = IDLE_TURN_MIN + Math.random() * (IDLE_TURN_MAX - IDLE_TURN_MIN);
    this.mode = 'idle';
  }

  /** Mount up wherever it stands and start driving its own lines. */
  toRide() {
    this.scene.remove(this.board.group);
    this.scene.remove(this.skater.group);
    this.ride.frame.add(this.board.group);
    this.ride.frame.add(this.skater.group);
    this.board.group.position.set(0, 0, 0);
    this.board.group.quaternion.identity();
    this.skater.settle();
    this.ride.reset({ x: this.walker.pos.x, y: 0, z: this.walker.pos.z, yaw: this.walker.yaw });
    this.bailWait = 0;
    this.trickCool = 2 + Math.random() * 2;
    this.route = null;
    this.mode = 'riding';
  }

  /** Step off wherever the ride left it and pick the board back up. */
  toIdle() {
    this.scene.add(this.board.group);
    this.scene.add(this.skater.group);
    this.skater.settle();
    this.walker.reset(this.ride.pos.x, this.ride.pos.z, this.ride.yaw);
    this.skater.poseWalk(this.walker, 1 / 60);
    poseCarriedBoard(this.walker, this.skater, this.board);
    this.idleYaw = this.walker.yaw;
    this.idleTimer = IDLE_TURN_MIN + Math.random() * (IDLE_TURN_MAX - IDLE_TURN_MIN);
    this.mode = 'idle';
  }

  /** On foot: stand at the hangout spot, turning to face a new way every so
   * often, the way someone waiting around actually shifts their weight. */
  stepIdle(dt) {
    const w = this.walker;
    let move;
    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      move = { x: -C.clamp(C.angleDelta(w.yaw, this.idleYaw) / IDLE_TURN, -1, 1), y: 0 };
    } else {
      this.idleYaw = Math.random() * Math.PI * 2;
      this.idleTimer = IDLE_TURN_MIN + Math.random() * (IDLE_TURN_MAX - IDLE_TURN_MIN);
      move = { x: 0, y: 0 };
    }
    w.update(dt, move);
    this.skater.poseWalk(w, dt);
    poseCarriedBoard(w, this.skater, this.board);
  }

  step(dt, playerPos) {
    if (this.mode === 'riding') stepPatrol(this.ride, this, dt, playerPos);
    else this.stepIdle(dt);
  }

  /** Pull the whole rig out of the scene, for a park that loses its rival. */
  dispose() {
    this.scene.remove(this.board.group);
    this.scene.remove(this.skater.group);
    this.scene.remove(this.ride.frame);
  }
}

// Every tunable for the skate game, in real units: metres, seconds, radians,
// kilograms. No imports, so the Node harness in tools/ can read these too.
//
// The units are not a stylistic choice. The whole point of this build is that
// the skater moves like a skater, and the only way to keep a hundred separate
// numbers honest about that is to make each one a quantity you can check
// against the real thing: a 32-inch deck is 0.81 m, a 54 mm wheel is 0.027 m,
// gravity is 9.81 m/s², a good ollie clears about 0.6 m, and a pushing skater
// tops out around 6.5 m/s. When something feels wrong, it is nearly always
// because a number here has drifted away from its physical counterpart.

// --- the board ------------------------------------------------------------
export const DECK_LEN = 0.81;        // 32"
export const DECK_W = 0.205;         // 8.06"
export const DECK_T = 0.013;
export const WHEELBASE = 0.36;       // bolt-to-bolt, so the trucks sit at ±0.18
export const WHEEL_R = 0.027;        // 54 mm
export const WHEEL_W = 0.031;
export const TRUCK_H = 0.053;        // axle to deck underside
// Deck top above flat ground: wheel + truck + deck. Everything the rider
// stands on is measured from here.
export const DECK_Y = WHEEL_R + TRUCK_H + DECK_T;   // ≈ 0.093
export const NOSE_KICK = 0.35;       // radians of upturn at nose and tail
export const KICK_START = 0.145;     // where the kick begins, from centre

// --- the rider ------------------------------------------------------------
export const THIGH = 0.44;
export const SHIN = 0.44;
export const FOOT_H = 0.075;         // ankle to sole
export const FOOT_L = 0.27;
export const HIP_W = 0.095;          // half-distance between the hip joints
export const SPINE = 0.27;           // pelvis centre to chest centre
export const CHEST = 0.34;           // length of the torso block
export const SHOULDER_UP = 0.13;     // chest centre up to the shoulder joints
export const NECK = 0.33;            // chest centre to the middle of the head
export const SHOULDER_W = 0.185;     // half-distance between the shoulders
export const UPPER_ARM = 0.30;
export const FOREARM = 0.28;

// Stance: where each foot sits along the deck, measured from the centre in
// metres, and how far it is turned off the board's long axis in radians.
// A real ride stance has the back foot on the tail pocket, angled almost
// across the deck, and the front foot behind the front bolts at about 45°.
export const FOOT_BACK_Z = -0.235;
export const FOOT_FRONT_Z = 0.155;
export const FOOT_BACK_YAW = 1.15;
export const FOOT_FRONT_YAW = 0.72;
// Hip height above the deck when relaxed. Skaters ride with a permanent bend
// in the knees — standing straight is what a non-skater does on a board.
export const HIP_H = 0.80;
export const CROUCH_MAX = 0.30;      // how far the hips can drop from HIP_H

// --- world ----------------------------------------------------------------
export const GRAVITY = -9.81;
export const AIR_DRAG = 0.013;       // per (m/s)², on the whole rider+board mass

// --- rolling --------------------------------------------------------------
// Coasting deceleration: bearing and urethane losses are near-constant, air
// resistance grows with the square. Eased off well below a real board's
// numbers — this is a game about speed, and a run that bleeds it as fast as
// the real thing spends too much of it pushing rather than skating.
export const ROLL_FRICTION = 0.07;   // m/s², constant term
export const ROLL_DRAG = 0.0048;     // m/s² per (m/s)²
export const ROUGH_FRICTION = 1.9;   // m/s² extra on grass/dirt outside the park

// A slope's own pull (gravity resolved along the surface) is real physics and
// applies both ways — it costs you speed riding up, same as it hands speed
// back riding down. This only amplifies the downhill half of that, so a
// steep transition or a bank genuinely picks you up rather than just failing
// to slow you down.
export const SLOPE_BOOST = 2.0;

// --- pushing --------------------------------------------------------------
export const PUSH_TIME = 0.5;        // one full push cycle, foot down to foot back
export const PUSH_KICK_START = 0.14; // when in the cycle the foot is driving
export const PUSH_KICK_END = 0.40;
export const PUSH_IMPULSE = 13.5;    // m/s² while driving
export const PUSH_TOP_SPEED = 16;    // pushes stop helping here — legs run out
export const PUSH_MIN_INTERVAL = 0.22;

// How much of a lean the deck itself takes. A skateboard's trucks only tilt
// ten or fifteen degrees before the bushings bottom out and the wheels touch —
// the other three quarters of a hard carve is the rider's body hanging off the
// inside of the turn, which is why a carving skater looks like they are falling
// and a carving board looks nearly flat.
export const DECK_TILT_SHARE = 0.26;

// --- speed pads ------------------------------------------------------------
// A painted pad in the park maker that hands a ride a short burst above the
// push ceiling when ridden over. The boost pushes at full strength right up to
// BOOST_SPEED — no taper, so crossing a pad reads as a surge — then the board
// cruises at the cap until BOOST_TIME runs out, and the ordinary push cap and
// rolling losses bring the speed back down to the normal top on their own.
export const BOOST_SPEED = 20;   // m/s a boost carries you to, 1.25x the push ceiling
export const BOOST_ACCEL = 14;   // m/s² of thrust while the boost is running
export const BOOST_TIME = 2.5;   // seconds a boost lasts once a pad is hit

// --- steering -------------------------------------------------------------
// Turning is a balance problem, not a steering-wheel problem. Leaning the board
// by θ commits the rider to a lateral acceleration of g·tanθ, and the radius
// that follows is whatever the current speed makes it: r = v²/(g·tanθ). That
// single relation is why a skateboard carves wide at speed and pivots on the
// spot when it is barely moving.
export const LEAN_MAX = 0.52;        // radians (30°) — past this the wheels lose it
export const LEAN_RATE = 6.4;        // how fast weight shifts, rad/s
export const TURN_R_MIN = 0.95;      // truck geometry floor on the radius, metres
export const YAW_RATE_MAX = 4.2;     // rad/s, the low-speed pivot ceiling
export const CARVE_SCRUB = 0.085;    // speed lost to tyre scrub, per m/s² of lateral
export const GRAVITY_STEER = 0.32;   // how strongly a cross-slope turns you downhill

// --- powerslide -----------------------------------------------------------
export const SLIDE_FRICTION = 7.2;   // m/s² of scrub while sideways
export const SLIDE_YAW_RATE = 5.0;   // how fast the board swings out
export const SLIDE_MIN_SPEED = 2.4;  // below this it just grips and stops

// --- braking --------------------------------------------------------------
// Dragging the back foot: scrubs speed fast without the scrape of a slide, so
// it reads the instant the key goes down. Sized under the push impulse so a
// slope can still carry you once you let go.
export const BRAKE_DECEL = 9.0;      // m/s² while held, opposing travel
export const BRAKE_STOP = 0.35;      // m/s below which braking stops the board dead

// --- ollies and pops ------------------------------------------------------
// Pop height is set by how deep the crouch was, and the launch speed follows
// from it exactly: v = sqrt(2·g·h). A 0.60 m ollie is 3.43 m/s and 0.70 s of
// air, which is what a real one looks like on video.
export const OLLIE_H_MIN = 0.24;
export const OLLIE_H_MAX = 0.68;
export const CHARGE_TIME = 0.42;     // crouch to full load
export const CHARGE_DECAY = 1.4;     // hold too long and the legs tire, 1/s
// The pop itself, as a timeline in seconds from the tail snapping down.
export const POP_SNAP = 0.075;       // tail hits, board pitches nose-up hard
export const POP_LEVEL = 0.20;       // front foot has dragged the board level
export const POP_PITCH = 0.62;       // radians of nose-up at the snap

// --- grabs ------------------------------------------------------------------
// The one family of trick that happens entirely in the air rather than being
// decided at the pop: nothing rotates the board, so there is no target angle
// and no landing check for it — just a hand held against the deck for long
// enough to read as a grab, worth more the longer (up to a point) and the
// higher it was held.
export const GRAB_MIN_HOLD = 0.12;   // shorter than this is a brush, not a grab
export const GRAB_MAX_HOLD = 1.1;    // holding past this pays no further bonus
export const GRAB_HOLD_BONUS = 220;  // points per second held, up to the max

// --- landing --------------------------------------------------------------
// What the board will forgive. Beyond the sketchy band it is a bail, which is
// the whole reason a trick has stakes.
export const LAND_ROLL_CLEAN = 0.30; // radians of board roll off the surface
export const LAND_PITCH_OK = 0.55;   // nose- or tail-first beyond this digs in
export const LAND_SLIP_CLEAN = 0.45; // radians between heading and velocity
export const LAND_SLIP_SKETCH = 1.0;
export const LAND_FLIP_OK = 0.55;    // radians short of finishing a flip
export const LAND_VY_BAIL = 9.4;     // ~4.5 m drop; the legs stop absorbing
export const LAND_COMPRESS = 0.055;  // metres of knee dip per m/s of impact
export const COMPRESS_RECOVER = 7.0; // spring rate back to the ride stance
export const SKETCH_SPEED_LOSS = 0.68;
export const SKETCH_TIME = 0.55;     // how long the wobble lasts

// --- revert ---------------------------------------------------------------
// A backwards landing — the board comes down pointed back the way it came —
// is normally a slam. A revert catches it instead: the rider holds the line
// for REVERT_DELAY seconds, then the wheels pivot the board round under the
// rider to face the direction of travel, so the run keeps going — at the cost
// of a little speed scrubbed by the pivot. Sideways landings are not saved:
// they wobble sketchy or slide out as before.
export const REVERT_TRIGGER = 0.35;   // rad of board-vs-travel mismatch that earns a revert
export const REVERT_MIN_SPEED = 1.6;  // below this the wheels just grip and stop
export const REVERT_DELAY = 0.5;      // seconds the board holds its line before the save
export const REVERT_DONE = 0.035;     // rad left at which the pivot is finished
export const REVERT_RATE = 6.2;       // rad/s of pivot at full rate
export const REVERT_EASE_IN = 0.05;   // s to build up to full rate — no snap
export const REVERT_SCRUB = 1.15;     // m/s of speed lost per radian pivoted
export const REVERT_CROUCH = 0.05;    // extra knee bend through the pivot, m
export const REVERT_TWIST = 0.6;      // max rad the body leads the board by
export const REVERT_TWIST_GAIN = 0.65; // how much of the remaining angle the body leads with

// --- grinds ---------------------------------------------------------------
export const GRIND_SNAP_XZ = 0.34;   // how close the board must pass the rail
export const GRIND_SNAP_Y = 0.30;    // vertical window, generous on the way down
// How far off a rail's line the board can be pointing and still lock on. A
// boardslide comes in nearly sideways, so it needs a far wider window than the
// angle a 50-50 accepts — and the angle it locks on at is what decides which
// grind it turns out to be.
export const GRIND_ALIGN = 1.42;
export const GRIND_FRICTION = 1.35;  // m/s² of speed scrubbed while grinding
export const SLIDE_GRIND_FRICTION = 2.6; // boardslides scrub harder than 50-50s
export const GRIND_POINTS_PER_M = 12;
// How hard a sideways hop off a grind throws the board across the rail, as a
// fraction of the pop's own vertical speed — the same crouch that buys height
// buys reach, so a bigger pop also lands further off the rail.
export const HOP_OFF_LATERAL = 0.9;

// --- balance (grinds and manuals) ----------------------------------------
// A balance meter is not decoration here: it is an inverted pendulum with a
// bias, so it always falls somewhere and holding it needs constant correction.
export const BALANCE_FALL = 2.6;     // rad/s² away from centre, per rad of tilt
export const BALANCE_CORRECT = 3.4;  // rad/s² the rider can apply
export const BALANCE_LIMIT = 1.0;    // past this the trick is lost
export const BALANCE_DAMP = 1.5;
export const MANUAL_PITCH = 0.30;    // radians of nose-up in a manual
export const MANUAL_POINTS_PER_M = 7;

// --- flips and spins ------------------------------------------------------
// Flip speeds are what the foot can actually impart: a kickflip is one full
// revolution in about 0.34 s, a tre flip needs the same flick plus a scoop.
export const FLIP_RATE = 18.5;       // rad/s about the board's long axis
export const SHUV_RATE = 15.0;       // rad/s about vertical
export const PITCH_RATE = 13.0;      // rad/s end over end, for impossibles
export const SPIN_RATE = 7.4;        // rad/s of rider body spin

// --- bail -----------------------------------------------------------------
export const BAIL_SETTLE = 1.5;      // seconds of ragdoll before the reset offer

// --- scoring --------------------------------------------------------------
export const COMBO_WINDOW = 1.35;    // seconds on the ground before a combo banks

// --- camera ---------------------------------------------------------------
export const CAM_DIST = 4.0;
export const CAM_HEIGHT = 1.5;       // raised a little — roughly the rider's head height
export const CAM_LOOK_H = 1.2;       // aim at the rider, not the deck
export const CAM_LAG = 3.4;          // position spring, 1/s
export const CAM_YAW_LAG = 2.9;      // heading spring, 1/s
export const CAM_FOV = 62;
// 0 on purpose: widening the lens with speed shrinks the rider on screen, and
// the eye cannot tell that apart from the camera backing off. Raise to ~13 for
// the old speed rush, at the cost of the rider drifting away as they push.
export const CAM_FOV_GAIN = 0;
export const CAM_SPEED_REF = 14.0;   // m/s that counts as flat out
// How far below the horizon the first-person lens sits, in radians. From eye
// height the front arm hangs ~50° below the horizon and the nose of the deck
// ~65°, while the ground a few metres ahead is only ~12° below — so a level
// aim frames nothing but the far bank. ~0.74 rad puts the front arm and the
// nose of the board in the lower half of the shot with the ground ahead still
// clearing the top.
export const CAM_FIRST_DOWN = 0.74;

// --- rendering ------------------------------------------------------------
export const SKY_TOP = 0x2f6ba8;
export const SKY_HORIZON = 0xd8d3c4;
export const FOG_NEAR = 60;
export const FOG_FAR = 600;
export const CAMERA_NEAR = 0.08;
export const CAMERA_FAR = 700;

// --- loop -----------------------------------------------------------------
// 120 Hz, not 60. Every hard case in here — the tail snapping in an ollie, a
// wheel catching a rail edge, a flip landing — resolves inside a couple of
// hundredths of a second, and at 60 Hz those land on the wrong side of a step
// often enough to be visible as luck.
export let FIXED_DT = 1 / 120;
export const MAX_FRAME_DT = 0.05;

/** Reduce the physics rate for low-end devices — halves the per-frame work. */
export function setFixedDt(v) {
  FIXED_DT = v;
}


/** Frame-rate independent exponential approach: how far to move this step. */
export function ease(dt, rate) {
  return 1 - Math.exp(-rate * dt);
}

/** Shortest signed angle from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --- the one runtime setting -----------------------------------------------
// Everything else here is a fixed number tuned once; this is the exception —
// a player-adjustable top speed, in the same m/s every other constant here
// is written in. Read live by every Ride (the player's and every AI skater's
// alike), so one setting changes the whole park at once. How hard a push
// drives and how much a downhill slope helps both scale with it, relative to
// PUSH_TOP_SPEED above — the speed the rest of this file was tuned around —
// so turning it down feels like weaker legs, not just a lower ceiling.
export let TOP_SPEED = PUSH_TOP_SPEED;
export function setTopSpeed(v) {
  TOP_SPEED = clamp(v, 8, 50);
}

// A player-adjustable chase distance, as a fraction of the tuned default —
// 1 is where the camera already sits, and turning it down pulls the camera
// in toward the rider without needing a second number for height too:
// camera.js multiplies both CAM_DIST and CAM_HEIGHT by this at once, the
// same way it already does for the landscape-aspect zoom, so a closer camera
// stays proportioned rather than sitting low and far, or high and close.
export let CAM_ZOOM = 1;
export function setCamZoom(v) {
  CAM_ZOOM = clamp(v, 0.5, 1);
}

// Whether holding the push key/thumb/button keeps pushing on its own (input.js
// reads this directly — see read()'s push section) or asks for a fresh press
// every single kick, the way the game originally shipped. Off by default: a
// new player gets the press-per-kick behaviour until they opt in via Settings.
// A boolean rather than a number, but the same player-adjustable-live pattern
// as the two above.
export let HOLD_TO_PUSH = false;
export function setHoldToPush(v) {
  HOLD_TO_PUSH = !!v;
}

// --- park progression ------------------------------------------------------
// The current-run score at which a park opens the next one in the grid. It is
// deliberately not the only condition: the park before it must also have its
// whole rival roster beaten in the same run's bank — reaching the score alone
// (or clearing the roster alone) opens nothing. Both are tracked live by
// main.js's maybeUnlockNextPark(); see boss.js and save.recordBossWin().
export const PARK_UNLOCK_SCORE = 1000000;

// --- rivals -----------------------------------------------------------------
// The current-run score at which the park's own rival steps out mid-run —
// 500k deliberately below the park-unlock milestone, so a park earns its
// rival well before it can open the next one. The reveal rides the live run's
// banked score, never the saved park best: start a fresh run and the rival
// is nowhere to be found until the run itself crosses this.
export const BOSS_REVEAL_SCORE = 500000;

// What beating a rival asks of the run: the first rival needs BOSS_BASE_*
// points and tricks banked during the current run, and every rival after him
// in the ladder asks for one more step of each. Tricks count cumulatively
// across the run — they never need to land in one combo. See
// boss.js's bossRequirement().
export const BOSS_BASE_SCORE = 20000;    // points the first rival requires
export const BOSS_SCORE_STEP = 10000;    // extra points each later rival adds
export const BOSS_BASE_TRICKS = 50;      // tricks the first rival requires
export const BOSS_TRICKS_STEP = 10;      // extra tricks each later rival adds

// A rival skate-in: the boss rides its own lines for this long, with the
// camera following it, before it steps off and idles where the player can
// find it.
export const BOSS_CUTSCENE_SECONDS = 5;

// The duel: both skaters ride at once, and the player must be ahead on both
// score and landed tricks when the clock runs out to take the win.
export const CHALLENGE_TIME = 120;

// How close the player has to get to a standing rival before the challenge
// prompt appears.
export const BOSS_PROMPT_R = 7;

// --- camera mode -----------------------------------------------------------
// Which gameplay camera is live: the original chase camera, a first-person
// lens bolted to the rider's head, or a close board-only view. camera.js reads
// this directly in its update() dispatch; main.js is what turns a player
// choice into the setting below and back into the save.
export const CAMERA_CHASE = 'chase';   // third person — the camera this game shipped with
export const CAMERA_FIRST = 'first';   // attached to the rider's head, which stays hidden — the rest of the rider and the deck stay in shot
export const CAMERA_BOARD = 'board';   // the board alone, rider hidden

export let CAMERA_MODE = CAMERA_CHASE;
export function setCameraMode(v) {
  CAMERA_MODE = v === CAMERA_FIRST || v === CAMERA_BOARD ? v : CAMERA_CHASE;
}

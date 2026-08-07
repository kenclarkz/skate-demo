// Flick-It: the control scheme the game this copies is built around.
//
// The idea is that you do not press a button labelled "kickflip". You pull the
// stick back to load your legs, then flick it the way your front foot would go —
// straight up for an ollie, up and across the toe side for a kickflip, sideways
// for a shove-it. The gesture is the trick, and how far you pulled back is how
// much pop you get.
//
// All three input devices land on the same recogniser. A touch drag, a mouse drag
// and a real right thumbstick all produce a pull depth and an exit direction, and
// the classifier below only ever sees those two things — which also means the
// headless test harness can drive the exact code path that ships by dragging the
// mouse.

import * as C from './config.js';

// --- gesture thresholds, in pixels for pointers and in stick units elsewhere ---
const PULL_MIN = 18;      // downward travel that counts as loading the legs
const PULL_FULL = 96;     // ...and where the charge is at maximum
const FLICK_MIN = 24;     // travel out of the pull that counts as a flick
const CURL_MIN = 52;      // sideways excursion that turns a flick into its curled variant
const PUSH_SLIDE = 30;    // downward travel on the steering side that pushes
// A bigger scoop still, into the full-360 member of whichever family the
// flick's own direction already picked. Expressed as a multiple of CURL_MIN
// (or of the gamepad's own curl threshold) rather than a second absolute
// number, so both callers can normalise their own units onto the same scale
// before classify() ever sees it — see up() and readPad() below.
const CURL_FULL = 1.35;

/**
 * Which trick a flick is, from where it went.
 *
 * `angle` is measured with up as +90° and right as 0°. `curl` says how far the
 * path swung out sideways before it left, normalised so that 1.0 is the
 * minimum scoop that counts and CURL_FULL is a bigger one still — the
 * difference between a varial and a full 360, or a kickflip and a gazelle
 * flip. Every one of the fifteen board tricks lives somewhere in this: the
 * flick's own direction fixes which flip family it is (or none, for the two
 * shove-it directions), and how far it curls on the way out — not at all,
 * a scoop, or a full one — fixes how much shove-it comes with it. Impossible
 * is the one trick with no flip or shove-it in it at all, and gets the one
 * direction nothing else uses: straight down.
 */
export function classify(angle, curl) {
  // Normalised into (-180, 180] so the sectors below can be written once and
  // cannot be reached by two different spellings of the same direction.
  let deg = ((((angle * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
  if (deg <= -180) deg += 360;

  const mag = Math.abs(curl);
  const curled = mag >= 1 ? Math.sign(curl) : 0; // a real scoop, either way
  const full = mag >= CURL_FULL ? Math.sign(curl) : 0; // a full one

  if (deg > 55 && deg <= 125) {
    // Straight up is an ollie; a quarter circle into it is the 360 family,
    // because the scoop that makes those tricks work is a real movement.
    if (curled < 0) return 'treflip';
    if (curled > 0) return 'varialheel';
    return 'ollie';
  }
  if (deg > 125 && deg <= 168) {
    // Up and over the toe side: a kickflip, curled further into the rest of
    // its own family — the same shove-it direction as the up sector's curl
    // does, just building from a kickflip instead of from nothing.
    if (curled < 0) return full < 0 ? 'treflip' : 'varial';
    if (curled > 0) return full > 0 ? 'gazelle' : 'hardflip';
    return 'kickflip';
  }
  if (deg > 168 || deg <= -168) {
    // Straight across, heel side: a shove-it, scooped into its own 360.
    return curled ? 'shuv360' : 'shuvit';
  }
  if (deg > 10 && deg <= 55) {
    // Up and over the heel side: a heelflip, with the same curled family a
    // kickflip gets, mirrored.
    if (curled < 0) return full < 0 ? 'heel360' : 'inheel';
    if (curled > 0) return full > 0 ? 'nightmare' : 'varialheel';
    return 'heelflip';
  }
  if (deg > -40 && deg <= 10) {
    // Straight across, toe side: a frontside shove-it, scooped into its own 360.
    return curled ? 'fsshuv360' : 'fsshuvit';
  }
  return 'impossible'; // the one direction nothing else uses: straight down
}

/** Keys that fire a trick outright, for anyone who would rather not flick. */
const TRICK_KEYS = {
  KeyJ: 'kickflip',
  KeyK: 'heelflip',
  KeyU: 'shuvit',
  KeyI: 'fsshuvit',
  KeyO: 'shuv360',
  KeyN: 'varial',
  KeyM: 'treflip',
  Comma: 'hardflip',
  Period: 'impossible',
  KeyH: 'inheel',
  KeyL: 'fsshuv360',
  KeyG: 'gazelle',
  KeyB: 'nightmare',
  KeyV: 'heel360',
  KeyF: 'varialheel',
};

/**
 * Grabs, held rather than flicked: the number row, one grab per key. Unlike
 * TRICK_KEYS these are not one-shot triggers — holding the key down is what
 * holds the grab, and letting go is what lets go of it, so key() tracks these
 * with keydown/keyup rather than pushing them onto the trick queue.
 */
const GRAB_KEYS = {
  Digit1: 'indy',
  Digit2: 'mute',
  Digit3: 'nosegrab',
  Digit4: 'tailgrab',
  Digit5: 'method',
};

/**
 * The same five, on whichever gamepad buttons are not already claimed by
 * push (0, 7) or slide (4, 6): B, X, Y, right bumper, right-stick click.
 * Standard-mapping index order, so this is Xbox-shaped but reads the same on
 * anything the browser normalises to the standard layout.
 */
const PAD_GRABS = [
  [1, 'indy'],
  [2, 'mute'],
  [3, 'nosegrab'],
  [5, 'tailgrab'],
  [11, 'method'],
];

export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pointers = new Map();
    this.steerTouch = 0;
    this.stickY = 0;           // the same left stick's forward/back, for walking
    this.flickCharge = 0;      // 0..1 while a pull is being held
    this.flickActive = false;
    this.queue = [];           // pending tricks, drained by read()
    // Held, not queued: true for as long as the steering thumb stays pulled
    // down past the threshold, so holding it pushes over and over on its own
    // the same way holding a forward key does (read() checks this.keys
    // directly for those). physics.js's own PUSH_MIN_INTERVAL cooldown is
    // what paces the repeats — this only has to report whether the player is
    // still asking to push right now.
    this.pushHeld = false;
    // The mirror image on the same thumb: pulled up past the threshold it is a
    // brake, held, the same way holding a key is — read() ORs the two together.
    this.brakeHeld = false;
    // The previous frame's held-push signal, so read() can tell a rising edge
    // from a key still being held down when C.HOLD_TO_PUSH is off.
    this.wasPushHeld = false;
    // Three sources for the same held-grab signal — a keyboard number key, an
    // on-screen grab button, one of a gamepad's face buttons — collapsed into
    // one in read(), the same way steer collapses touch, keys and a stick.
    this.grabKey = null;
    this.touchGrab = null;
    // Every flick pointer's own path, for the on-screen gesture trail —
    // purely visual, read by trail.js and never by the recogniser itself.
    // A finished flick's path lives on here for a moment so its trail can
    // fade out rather than vanishing the instant the finger lifts.
    this.recentTrails = [];
    this.enabled = true;
    // Set from outside so a paused game stops steering itself.
    this.onPause = null;

    this.joyBase = document.getElementById('joystick-base');
    this.joyThumb = document.getElementById('joystick-thumb');

    this.padCharge = 0;
    this.padPulled = false;
    this.padCurl = 0;
    this.chargedFor = 0;

    this.bind();
  }

  bind() {
    const opts = { passive: false };
    this.el.addEventListener('pointerdown', (e) => this.down(e), opts);
    this.el.addEventListener('pointermove', (e) => this.move(e), opts);
    this.el.addEventListener('pointerup', (e) => this.up(e), opts);
    this.el.addEventListener('pointercancel', (e) => this.cancel(e), opts);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // iOS turns a swipe into a scroll or a pull-to-refresh without these, even
    // with touch-action set in CSS — except inside the menus, where a swipe
    // has to stay a scroll: the shop and the park picker are both taller
    // than the screen on a lot of phones, and this is the only way down to
    // the card past the fold.
    const block = (e) => {
      if (e.target.closest?.('#overlay')) return;
      e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    document.addEventListener('gesturestart', block, { passive: false });
  }

  // --- pointers ----------------------------------------------------------
  /**
   * Which half of the screen a pointer started in decides what it is for: left
   * steers, right flicks. Tracking them in a map rather than as one active
   * pointer is what lets a thumb on each side work at the same time.
   */
  down(e) {
    if (!this.enabled) return;
    // A tap on a HUD button (pause, action buttons) must reach that button's own
    // click handler, not become a steer/flick gesture. Capturing the pointer here
    // moves subsequent pointer events — including the synthesised click — to this
    // element, bypassing the button. Skip capture for any touch starting on a
    // button so the browser's normal hit-test delivers the click correctly.
    if (e.target.closest?.('button')) return;
    const left = e.clientX < window.innerWidth * 0.42;
    this.pointers.set(e.pointerId, {
      left,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      lowY: e.clientY,
      lowX: e.clientX,
      curl: 0,
      pulled: false,
      // Only the flick side draws a trail — the steering side already has
      // the joystick thumb to show where it is.
      path: left ? null : [{ x: e.clientX, y: e.clientY }],
    });
    if (this.el.setPointerCapture) {
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
    }
    if (left && this.joyBase) {
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyBase.hidden = false;
      if (this.joyThumb) this.joyThumb.style.transform = 'translate(0, 0)';
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.left) {
      const dx = p.x - p.x0;
      const dy = p.y - p.y0;
      // A steering stick with a dead zone, so resting a thumb does not carve.
      // The same drag doubles as forward/back while walking — up is forward,
      // the way pulling a joystick towards you never is on a stick that also
      // has to lean a board.
      const R = 74;
      this.steerTouch = C.clamp(dx / R, -1, 1);
      this.stickY = C.clamp(-dy / R, -1, 1);
      if (this.joyThumb) {
        const VIS_R = 40;
        const mag = Math.hypot(dx, dy);
        const s = mag > VIS_R ? VIS_R / mag : 1;
        this.joyThumb.style.transform = `translate(${dx * s}px, ${dy * s}px)`;
      }
      // Sliding the thumb down is a push — the same downward pull the flick
      // side uses to charge. Holding it down keeps pushing on its own, the
      // same way holding the forward key does; a little hysteresis on the way
      // back up (0.4× rather than the same threshold) is what stops a thumb
      // trembling right on the line from chattering on and off every frame.
      const down = dy;
      if (down > PUSH_SLIDE) this.pushHeld = true;
      else if (down < PUSH_SLIDE * 0.4) this.pushHeld = false;
      // And the pull the other way is a brake — holding the thumb up keeps
      // scrubbing, with the same hysteresis so it cannot chatter on the line.
      const up = -dy;
      if (up > PUSH_SLIDE) this.brakeHeld = true;
      else if (up < PUSH_SLIDE * 0.4) this.brakeHeld = false;
      return;
    }
    // The pull: how far below the deepest point we have been, and how far the
    // path wandered sideways on the way — the scoop, for the 360 family.
    if (p.y > p.lowY) {
      p.lowY = p.y;
      p.lowX = p.x;
      p.curl = 0;
    } else {
      const side = p.x - p.lowX;
      if (Math.abs(side) > Math.abs(p.curl)) p.curl = side;
    }
    const pull = p.lowY - p.y0;
    if (pull > PULL_MIN) {
      p.pulled = true;
      this.flickActive = true;
      this.flickCharge = C.clamp((pull - PULL_MIN) / (PULL_FULL - PULL_MIN), 0, 1);
    }
    if (p.path) {
      p.path.push({ x: p.x, y: p.y });
      // A gesture is a couple of seconds at most; this is only ever hit if a
      // pointer is somehow held for far longer, and it is cheaper to drop
      // the oldest point than to let the array grow without bound.
      if (p.path.length > 240) p.path.shift();
    }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);

    if (p.left) {
      this.steerTouch = 0;
      this.stickY = 0;
      this.pushHeld = false;
      this.brakeHeld = false;
      this.hideJoystick();
      return;
    }

    if (p.pulled) {
      const dx = p.x - p.lowX;
      const dy = p.y - p.lowY;
      if (Math.hypot(dx, dy) > FLICK_MIN) {
        const angle = Math.atan2(-dy, dx);
        // Normalised so 1.0 is exactly the old on/off threshold and further
        // out is a bigger scoop still — classify() reads magnitude now, not
        // just which side it came from.
        const trick = classify(angle, p.curl / CURL_MIN);
        // The charge at the bottom of the pull is what the pop is worth: flicking
        // out of it does not un-load your legs.
        if (trick) this.queue.push({ trick, charge: this.flickCharge });
      }
    }
    this.stashTrail(p);
    this.flickActive = false;
    this.flickCharge = 0;
  }

  /** Hand a finished flick's own path off to fade out on screen, rather than
   * have it vanish the instant the finger lifts. */
  stashTrail(p) {
    if (!p.path || p.path.length < 2) return;
    this.recentTrails.push({ path: p.path, endedAt: performance.now() });
    if (this.recentTrails.length > 3) this.recentTrails.shift();
  }

  cancel(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.left) {
      this.steerTouch = 0;
      this.stickY = 0;
      this.pushHeld = false;
      this.brakeHeld = false;
      this.hideJoystick();
    } else {
      this.stashTrail(p);
      this.flickActive = false;
      this.flickCharge = 0;
    }
  }

  /**
   * The on-screen grab buttons call these directly rather than going through
   * the generic pointer machinery above: they are fixed elements with a fixed
   * id each, not a drag surface to classify, so there is nothing for down()/
   * move()/up() to do that a plain pointerdown/pointerup on the button itself
   * does not already say more simply.
   */
  beginGrab(id) {
    this.touchGrab = id;
  }
  endGrab(id) {
    if (this.touchGrab === id) this.touchGrab = null;
  }

  /** Snaps the visual stick back to the centre and hides it until next touch. */
  hideJoystick() {
    if (this.joyBase) this.joyBase.hidden = true;
    if (this.joyThumb) this.joyThumb.style.transform = 'translate(0, 0)';
  }

  // --- keyboard ----------------------------------------------------------
  key(e, downNow) {
    if (e.repeat) return;
    const code = e.code;
    if (code === 'Escape' || code === 'KeyP') {
      if (downNow) this.onPause?.();
      return;
    }
    if (
      code.startsWith('Arrow') ||
      code === 'Space' ||
      TRICK_KEYS[code] ||
      GRAB_KEYS[code] ||
      ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyC', 'ShiftLeft', 'ShiftRight'].includes(code)
    ) {
      e.preventDefault();
    }
    if (downNow) {
      this.keys.add(code);
      if (!this.enabled) return;
      if (TRICK_KEYS[code]) {
        // A trick key with no charge behind it still needs some pop, or a
        // keyboard player could never land anything.
        const charge = this.charging() ? undefined : 0.55;
        this.queue.push({ trick: TRICK_KEYS[code], charge });
      }
      // Whichever grab key is pressed most recently wins; physics.js ignores a
      // second one arriving while the first is still held (see startGrab()),
      // so there is no need to guard against overlap here.
      if (GRAB_KEYS[code]) this.grabKey = GRAB_KEYS[code];
    } else {
      this.keys.delete(code);
      // Releasing the charge with nothing else asked for is an ollie, exactly as
      // letting the stick spring back up is.
      if (code === 'Space' && !this.charging()) {
        if (this.enabled && this.chargedFor > 0.05) this.queue.push({ trick: 'ollie' });
      }
      // Only clear it if this was the key that started it — letting go of a
      // key that was never the active grab must not cancel someone else's.
      if (GRAB_KEYS[code] && this.grabKey === GRAB_KEYS[code]) this.grabKey = null;
    }
  }

  charging() {
    return this.keys.has('Space');
  }

  // --- gamepad -----------------------------------------------------------
  /**
   * A real right stick, recognised the same way as a drag: pulled back past a
   * threshold to charge, and classified when it comes back through the middle.
   */
  readPad(out) {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let pad = null;
    for (const p of pads) if (p && p.connected) pad = p;
    if (!pad) return;

    const lx = pad.axes[0] || 0;
    if (Math.abs(lx) > 0.14) out.steer = C.clamp(lx, -1, 1);
    const ly = pad.axes[1] || 0;
    // Pulling the left stick up is the brake, the mirror of the on-screen
    // joystick's own up-drag and the S key.
    if (ly < -0.45) out.brake = true;
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;

    if (ry > 0.55) {
      this.padPulled = true;
      this.padCharge = Math.max(this.padCharge, C.clamp((ry - 0.55) / 0.4, 0, 1));
      if (Math.abs(rx) > Math.abs(this.padCurl)) this.padCurl = rx;
    } else if (this.padPulled && Math.hypot(rx, ry) < 0.75) {
      // Back through the middle: the direction it came out at is the trick.
      const angle = Math.atan2(-ry, rx);
      // Normalised the same way the touch path is: 1.0 at the old threshold,
      // so a stick shoved to somewhere near its own physical limit is what a
      // full 360-family scoop takes here — a stick has far less travel than
      // a thumb has room to swipe, and that is a real difference, not a bug.
      const curl = this.padCurl / 0.7;
      const trick = ry < -0.35 || Math.abs(rx) > 0.35 ? classify(angle, curl) : null;
      if (trick) this.queue.push({ trick, charge: this.padCharge });
      this.padPulled = false;
      this.padCharge = 0;
      this.padCurl = 0;
    }
    if (this.padPulled) out.charge = true;
    if (pad.buttons[6]?.pressed || pad.buttons[4]?.pressed) out.slide = true;
    if (pad.buttons[0]?.pressed || pad.buttons[7]?.pressed) out.push = true;

    // Grabs: read live and continuously, the same as slide/push above rather
    // than through the queue — a grab is a hold, not a flick. Only fills in if
    // a keyboard or touch grab has not already claimed out.grab this frame.
    if (!out.grab) {
      for (const [btn, id] of PAD_GRABS) {
        if (pad.buttons[btn]?.pressed) {
          out.grab = id;
          break;
        }
      }
    }
  }

  // --- the frame's worth of input -----------------------------------------
  /**
   * Collapse every device into the one object physics reads. Called once per
   * frame; draining the queues here is what makes a flick fire exactly once
   * however many simulation steps that frame turns into.
   */
  read() {
    const out = {
      steer: 0,
      charge: false,
      slide: false,
      push: false,
      brake: false,
      trick: null,
      trickCharge: undefined,
      grab: null,
    };
    if (!this.enabled) return out;

    let steer = this.steerTouch;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) steer -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) steer += 1;
    out.steer = C.clamp(steer, -1, 1);

    out.charge = this.flickActive || this.charging();
    out.slide = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    // Whether the key/thumb is being pressed right now — from all three
    // devices at once, since readPad() below ORs its own push into the same
    // flag rather than tracking one separately.
    out.push =
      this.pushHeld || this.keys.has('KeyW') || this.keys.has('KeyC') || this.keys.has('ArrowUp');
    out.brake = this.brakeHeld || this.keys.has('KeyS') || this.keys.has('ArrowDown');
    // Keyboard wins over touch if somehow both are held at once — an arbitrary
    // but harmless tie-break, since physics.js only ever looks at the one
    // string this collapses to.
    out.grab = this.grabKey || this.touchGrab || null;

    this.readPad(out);

    // Hold-to-push settles here, after every device has had a say: held, it
    // repeats on its own and physics.js's own cooldown paces the repeats; off,
    // out.push only reports the rising edge, so a press held past one push
    // cycle just sits there instead of firing again on its own — the game's
    // original one-kick-per-press feel, for anyone who preferred it.
    const pushHeldNow = out.push;
    if (!C.HOLD_TO_PUSH) out.push = pushHeldNow && !this.wasPushHeld;
    this.wasPushHeld = pushHeldNow;

    if (this.queue.length) {
      const next = this.queue.shift();
      out.trick = next.trick;
      out.trickCharge = next.charge;
    }

    // How long the keyboard charge has been held, so releasing it can tell the
    // difference between an ollie and a key that was never pressed.
    this.chargedFor = out.charge ? (this.chargedFor || 0) + 1 / 60 : 0;
    return out;
  }

  /**
   * The walking equivalent of read(): a plain 2D move vector, x = strafe/turn,
   * y = forward/back. Same left stick as steering, plus WASD/arrows and a
   * gamepad's left stick, so whichever device someone is already holding
   * keeps working the moment they step off the board.
   */
  readMove() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = this.steerTouch;
    let y = this.stickY;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y -= 1;
    const pads = navigator.getGamepads?.();
    if (pads) {
      for (const pad of pads) {
        if (!pad || !pad.connected) continue;
        const lx = pad.axes[0] || 0;
        const ly = pad.axes[1] || 0;
        if (Math.abs(lx) > 0.14) x += lx;
        if (Math.abs(ly) > 0.14) y -= ly;
      }
    }
    return { x: C.clamp(x, -1, 1), y: C.clamp(y, -1, 1) };
  }

  /** Drop everything held down. Used when the game is paused or reset. */
  clear() {
    this.keys.clear();
    this.pointers.clear();
    this.steerTouch = 0;
    this.stickY = 0;
    this.hideJoystick();
    this.flickActive = false;
    this.flickCharge = 0;
    this.queue.length = 0;
    this.pushHeld = false;
    this.brakeHeld = false;
    this.wasPushHeld = false;
    this.padPulled = false;
    this.padCharge = 0;
    this.grabKey = null;
    this.touchGrab = null;
    this.recentTrails.length = 0;
  }
}

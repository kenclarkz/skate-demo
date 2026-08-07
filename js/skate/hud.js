// The DOM overlay: readouts, trick call-outs, the balance meter, and the menus.
//
// Kept out of WebGL entirely. Text, buttons and lists are what the DOM is good at,
// and a menu made of real elements gets focus rings, tap targets and text scaling
// for nothing.

import { TrickPreview } from './preview.js';
import { drawPortrait } from './character-portrait.js';
import { drawGestureDiagram } from './gesture-diagram.js';

const SCREENS = ['start', 'paused', 'guide', 'parks', 'store', 'settings'];

/** Reasons a bail can happen, in the words a skater would use. */
const BAIL_TEXT = {
  hit: 'Rolled straight into it',
  primo: 'Landed on the side of the board',
  'slide-out': 'Landed sideways',
  nose: 'Nosedived',
  flat: 'Too far to flat',
  balance: 'Lost it on the rail',
  manual: 'Lost the manual',
};

/**
 * The tutorial, one move per step. Every step names its keyboard, touch and
 * gamepad input so the same walkthrough works whichever the player showed up
 * with — nobody is told to go check a different section for their device.
 */
export const TUTORIAL = [
  {
    title: 'Move & steer',
    body: 'Turning is a lean, not a wheel: at speed you carve wide, and at walking pace you can pivot on the spot.',
    keys: 'A / D  or  ← / →',
    touch: 'Left half — drag to steer',
    pad: 'Left stick',
    demo: 'carve',
  },
  {
    title: 'Push',
    body: 'Builds your speed. Hold it down and you keep pushing on your own — legs only move so fast, so there is still a ceiling.',
    keys: 'Hold W',
    touch: 'Left half — hold pulled down',
    pad: 'A  or  right trigger',
    demo: 'push',
  },
  {
    title: 'Brake',
    body: 'Drag your back foot to scrub speed, and hold it and the board stops dead without you getting off — let go and you can roll again.',
    keys: 'Hold S',
    touch: 'Left half — hold pulled up',
    pad: 'Left stick — hold pulled up',
    demo: 'brake',
  },
  {
    title: 'Charge & ollie',
    body: 'Pull back to load your legs, then let go straight up. How far you pulled is how much pop you get.',
    keys: 'Space — hold, then release',
    touch: 'Right half — pull down, then flick up',
    pad: 'Right stick — pull down, then flick up',
    demo: 'ollie',
    gesture: { angle: 90, curl: 0 },
  },
  {
    title: 'Kickflip',
    body: 'Flick up and across the toe side and the board flips a full turn beneath your feet.',
    keys: 'J',
    touch: 'Flick up-left',
    pad: 'Flick up-left',
    demo: 'kickflip',
    gesture: { angle: 146, curl: 0 },
  },
  {
    title: 'Heelflip',
    body: 'The same flick off the heel side instead, and the board spins the other way round.',
    keys: 'K',
    touch: 'Flick up-right',
    pad: 'Flick up-right',
    demo: 'heelflip',
    gesture: { angle: 34, curl: 0 },
  },
  {
    title: 'Pop Shuvit',
    body: 'Flick straight to the heel side and the board spins out flat underneath you — no flip at all.',
    keys: 'U',
    touch: 'Flick left',
    pad: 'Flick left',
    demo: 'shuvit',
    gesture: { angle: 180, curl: 0 },
  },
  {
    title: 'Frontside Shuvit',
    body: 'The same flat spin off the toe side, coming around the other way.',
    keys: 'I',
    touch: 'Flick right',
    pad: 'Flick right',
    demo: 'fsshuvit',
    gesture: { angle: -15, curl: 0 },
  },
  {
    title: 'Varial Kickflip',
    body: 'Curl a kickflip’s flick a little as you release and a shuvit comes with it — the board flips and spins together.',
    keys: 'N',
    touch: 'Flick up-left, curling the pull a little as you release',
    pad: 'Flick up-left, curling the stick a little as you release',
    demo: 'varial',
    gesture: { angle: 146, curl: -1.15 },
  },
  {
    title: 'Hardflip',
    body: 'The same curl, the other way — flip and spin together again, headed the opposite way round.',
    keys: ',',
    touch: 'Flick up-left, curling the pull the other way as you release',
    pad: 'Flick up-left, curling the stick the other way as you release',
    demo: 'hardflip',
    gesture: { angle: 146, curl: 1.15 },
  },
  {
    title: 'Gazelle Flip',
    body: 'Push a hardflip’s curl further still and the board keeps spinning a full 360 while it flips.',
    keys: 'G',
    touch: 'Flick up-left, curling the pull hard as you release',
    pad: 'Flick up-left, curling the stick hard as you release',
    demo: 'gazelle',
    gesture: { angle: 146, curl: 1.6 },
  },
  {
    title: '360 Flip',
    body: 'Curl an ollie’s flick hard to one side as you release and the board spins a full 360 while it flips end over end.',
    keys: 'M',
    touch: 'Flick up, curling the pull hard as you release',
    pad: 'Flick up, curling the stick hard as you release',
    demo: 'treflip',
    gesture: { angle: 90, curl: -1.2 },
  },
  {
    title: 'Varial Heelflip',
    body: 'The same curl off an ollie, the other way — a half-spin with a heelflip riding along with it.',
    keys: 'F',
    touch: 'Flick up, curling the pull the other way as you release',
    pad: 'Flick up, curling the stick the other way as you release',
    demo: 'varialheel',
    gesture: { angle: 90, curl: 1.2 },
  },
  {
    title: 'Inward Heelflip',
    body: 'Curl a heelflip’s flick a little as you release and it scoops back around into an inward heel.',
    keys: 'H',
    touch: 'Flick up-right, curling the pull a little as you release',
    pad: 'Flick up-right, curling the stick a little as you release',
    demo: 'inheel',
    gesture: { angle: 34, curl: -1.15 },
  },
  {
    title: '360 Heelflip',
    body: 'Push that same curl further and the board keeps spinning all the way for a full 360 heelflip.',
    keys: 'V',
    touch: 'Flick up-right, curling the pull hard as you release',
    pad: 'Flick up-right, curling the stick hard as you release',
    demo: 'heel360',
    gesture: { angle: 34, curl: -1.6 },
  },
  {
    title: 'Nightmare Flip',
    body: 'Curl a heelflip’s flick hard the other way and the board spins a full 360 while it flips.',
    keys: 'B',
    touch: 'Flick up-right, curling the pull hard the other way as you release',
    pad: 'Flick up-right, curling the stick hard the other way as you release',
    demo: 'nightmare',
    gesture: { angle: 34, curl: 1.6 },
  },
  {
    title: '360 Shuvit',
    body: 'Curl a pop shuvit’s flick as you release and the board keeps spinning all the way round instead of stopping at halfway.',
    keys: 'O',
    touch: 'Flick left, curling the pull as you release',
    pad: 'Flick left, curling the stick as you release',
    demo: 'shuv360',
    gesture: { angle: 180, curl: 1.2 },
  },
  {
    title: 'Frontside 360 Shuvit',
    body: 'The same full turn off the toe side, curling a frontside shuvit’s flick instead.',
    keys: 'L',
    touch: 'Flick right, curling the pull as you release',
    pad: 'Flick right, curling the stick as you release',
    demo: 'fsshuv360',
    gesture: { angle: -15, curl: 1.2 },
  },
  {
    title: 'Impossible',
    body: 'Straight down, and the board wraps all the way around your back foot — no shuvit, no flip, just the one direction nothing else uses.',
    keys: '.',
    touch: 'Flick straight down',
    pad: 'Flick straight down',
    demo: 'impossible',
    gesture: { angle: -90, curl: 0 },
  },
  {
    title: 'Indy',
    body: 'A grab is not popped, it is held: once you are in the air, grab and let go whenever you like. The longer you hold it, and the higher, the more it pays.',
    keys: 'Hold 1',
    touch: 'Hold Indy',
    pad: 'Hold B',
    demo: 'indy',
  },
  {
    title: 'Mute',
    body: 'The other hand, the same toe-side edge, further up towards the nose.',
    keys: 'Hold 2',
    touch: 'Hold Mute',
    pad: 'Hold X',
    demo: 'mute',
  },
  {
    title: 'Nose Grab',
    body: 'Straight down the middle at the very front of the board — no rail to catch, just the tip of it.',
    keys: 'Hold 3',
    touch: 'Hold Nose',
    pad: 'Hold Y',
    demo: 'nosegrab',
  },
  {
    title: 'Tail Grab',
    body: 'The same grab, the other end of the board.',
    keys: 'Hold 4',
    touch: 'Hold Tail',
    pad: 'Hold right bumper',
    demo: 'tailgrab',
  },
  {
    title: 'Method',
    body: 'The heel-side edge, pulled up high behind your back leg — the one that gets held the longest, because it looks like it is worth holding.',
    keys: 'Hold 5',
    touch: 'Hold Method',
    pad: 'Hold right-stick click',
    demo: 'method',
  },
  {
    title: 'Grinds',
    body: 'Ollie onto a rail or a ledge and the board locks on. It always wants to fall one way — hold the balance until you roll off the end.',
    keys: 'Steer to correct the balance',
    touch: 'Drag the steering side to correct',
    pad: 'Left stick to correct',
    demo: 'grind',
  },
  {
    title: 'Manuals',
    body: 'Hold the charge without ever flicking it, and your legs give out into a nose-up manual. Let go to drop it back down.',
    keys: 'Hold Space',
    touch: 'Hold the pull, do not flick',
    pad: 'Hold the pull, do not flick',
    demo: 'manual',
  },
  {
    title: 'Powerslide',
    body: 'Kicks the board sideways at speed, scrubbing it off fast — useful before a tight landing, or just for style.',
    keys: 'Shift',
    touch: 'Two-finger hold',
    pad: 'Shoulder buttons',
    demo: 'slide',
  },
  {
    title: 'Land it — or don’t',
    body: 'The board has to be level, pointing roughly where it is going, and finished with whatever it started. Miss any of that and it is a slam — get up and roll again.',
    keys: '',
    touch: '',
    pad: '',
    demo: 'ollie',
  },
  {
    title: 'On foot',
    body: 'Step off and explore — the board comes with you, tucked under your arm. Sit down and you will set it on the floor beside you. Get back on wherever you are standing.',
    keys: 'X to get off, E to get back on',
    touch: 'Tap Get off / Get on board',
    pad: 'Y button',
    demo: 'walk',
  },
  {
    title: 'Coins',
    body: 'Every trick you land pays out, and a banked combo pays out for the whole chain. Spend it in the shop on the start screen — a different board, a different shirt. Picking a different skater is free. None of it changes how you ride.',
    keys: '',
    touch: '',
    pad: '',
    demo: null,
  },
];

export class Hud {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.bestEl = document.getElementById('best');
    this.comboEl = document.getElementById('combo');
    this.comboList = document.getElementById('combo-list');
    this.comboMult = document.getElementById('combo-mult');
    this.callout = document.getElementById('callout');
    this.speedEl = document.getElementById('speed');
    this.airEl = document.getElementById('air');
    this.balance = document.getElementById('balance');
    this.balancePip = document.getElementById('balance-pip');
    this.chargeEl = document.getElementById('charge');
    this.chargeBar = document.getElementById('charge-bar');
    this.debugEl = document.getElementById('debug');
    this.stats = document.getElementById('stats');
    this.logosEl = document.getElementById('logos-readout');
    this.logosCount = document.getElementById('logos-count');
    this.coinsEl = document.getElementById('coins');
    this.storeCoinsEl = document.getElementById('store-coins');

    this.overlay = document.getElementById('overlay');
    this.screens = {};
    for (const n of SCREENS) this.screens[n] = document.getElementById(`screen-${n}`);
    this.soundBtn = document.getElementById('opt-sound');
    this.holdPushBtn = document.getElementById('opt-holdpush');
    this.pauseBtn = document.getElementById('btn-pause');
    this.statLines = document.getElementById('stat-lines');
    this.parkNow = document.getElementById('park-now');
    this.parkGrid = document.getElementById('park-grid');
    this.boardGrid = document.getElementById('board-grid');
    this.outfitGrid = document.getElementById('outfit-grid');
    this.charGrid = document.getElementById('char-grid');

    this.dismountBtn = document.getElementById('btn-dismount');
    this.mountBtn = document.getElementById('btn-mount');
    this.sitBtn = document.getElementById('btn-sit');
    this.grabButtons = document.getElementById('grab-buttons');

    this.tutTitle = document.getElementById('tut-title');
    this.tutBody = document.getElementById('tut-body');
    this.tutKeys = document.getElementById('tut-keys');
    this.tutTouch = document.getElementById('tut-touch');
    this.tutPad = document.getElementById('tut-pad');
    this.tutDots = document.getElementById('tut-dots');
    this.tutPrev = document.getElementById('btn-tut-prev');
    this.tutNext = document.getElementById('btn-tut-next');
    this.tutStep = 0;

    // The tutorial's own live demo — a second tiny scene, not a screenshot.
    this.demoCanvas = document.getElementById('tut-demo');
    this.preview = this.demoCanvas ? new TrickPreview(this.demoCanvas) : null;

    // The gesture diagram overlaid on the demo's own corner — a 2D trace of
    // the swipe, not a 3D scene, so it gets a plain canvas of its own.
    this.gestureCanvas = document.getElementById('tut-gesture');
    this.gestureCtx = this.gestureCanvas?.getContext('2d');
    this.gestureT = 0;

    this.speedRange = document.getElementById('speed-range');
    this.speedValueEl = document.getElementById('speed-value');
    this.camZoomRange = document.getElementById('camzoom-range');
    this.camZoomValueEl = document.getElementById('camzoom-value');
    this.musicRange = document.getElementById('music-range');
    this.musicValueEl = document.getElementById('music-value');

    this.on = {
      play: null,
      resume: null,
      guide: null,
      back: null,
      sound: null,
      reset: null,
      parks: null,
      selectPark: null,
      speed: null,
      camZoom: null,
      musicVolume: null,
      holdToPush: null,
      pause: null,
      settings: null,
      lighting: null,
      store: null,
      board: null,
      outfit: null,
      character: null,
      dismount: null,
      mount: null,
      sit: null,
      grabStart: null,
      grabEnd: null,
    };
    this._score = -1;
    this._best = -1;
    this._coins = -1;
    this.calloutTimer = 0;
    this.bind();
    this.buildTutDots();
  }

  bind() {
    const click = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    click('btn-play', () => this.on.play?.());
    click('btn-guide', () => this.on.guide?.());
    click('btn-guide-back', () => this.on.back?.());
    click('btn-parks', () => this.on.parks?.());
    click('btn-parks-back', () => this.on.back?.());
    click('btn-store', () => this.on.store?.());
    click('btn-store-back', () => this.on.back?.());
    click('btn-settings', () => this.on.settings?.());
    click('btn-settings-back', () => this.on.back?.());
    click('btn-pause', () => this.on.pause?.());
    click('btn-dismount', () => this.on.dismount?.());
    click('btn-mount', () => this.on.mount?.());
    click('btn-sit', () => this.on.sit?.());
    // Hold, not click: a grab lasts exactly as long as the button is pressed,
    // so it is pointerdown/pointerup rather than a single tap event. pointerup
    // fires outside the button too once setPointerCapture claims the pointer,
    // which is what stops a thumb sliding off the button mid-grab from leaving
    // it stuck on; pointercancel is the same guard against an interrupted
    // touch (an incoming call, the OS swallowing the gesture) never letting go.
    for (const btn of this.grabButtons ? [...this.grabButtons.querySelectorAll('[data-grab]')] : []) {
      const id = btn.dataset.grab;
      const start = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this.on.grabStart?.(id);
      };
      const end = () => this.on.grabEnd?.(id);
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
    }
    click('btn-resume', () => this.on.resume?.());
    click('btn-pause-menu', () => this.on.back?.());
    click('opt-sound', () => this.on.sound?.());
    click('opt-holdpush', () => this.on.holdToPush?.());
    click('opt-reset', () => this.on.reset?.());
    click('btn-tut-prev', () => this.showTutStep(this.tutStep - 1));
    click('btn-tut-next', () => {
      if (this.tutStep >= TUTORIAL.length - 1) this.on.play?.();
      else this.showTutStep(this.tutStep + 1);
    });
    this.parkGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-park]');
      if (card) this.on.selectPark?.(card.dataset.park);
    });
    this.lightingToggle = document.getElementById('lighting-toggle');
    this.lightingToggle?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lighting]');
      if (btn) this.on.lighting?.(btn.dataset.lighting);
    });
    this.speedRange?.addEventListener('input', () => {
      const v = Number(this.speedRange.value);
      this.setSpeedValue(v);
      this.on.speed?.(v);
    });
    this.camZoomRange?.addEventListener('input', () => {
      const v = Number(this.camZoomRange.value) / 100;
      this.setCamZoomValue(v);
      this.on.camZoom?.(v);
    });
    this.musicRange?.addEventListener('input', () => {
      const v = Number(this.musicRange.value) / 100;
      this.setMusicVolumeValue(v);
      this.on.musicVolume?.(v);
    });
    this.boardGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-board]');
      if (card) this.on.board?.(card.dataset.board);
    });
    this.outfitGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-outfit]');
      if (card) this.on.outfit?.(card.dataset.outfit);
    });
    this.charGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-character]');
      if (card) this.on.character?.(card.dataset.character);
    });
  }

  // --- readouts ----------------------------------------------------------
  setScore(v) {
    const n = Math.floor(v);
    if (n === this._score) return;
    this._score = n;
    this.scoreEl.textContent = n.toLocaleString();
  }

  setBest(v) {
    const n = Math.floor(v);
    if (n === this._best) return;
    this._best = n;
    this.bestEl.textContent = n.toLocaleString();
  }

  /** Speed in km/h: metres per second means nothing to most people. */
  setSpeed(ms) {
    const kmh = Math.round(ms * 3.6);
    if (kmh === this._speed) return;
    this._speed = kmh;
    this.speedEl.textContent = `${kmh}`;
  }

  /** Height off the ground, shown only while it is worth showing. */
  setAir(metres) {
    const show = metres > 0.25;
    if (show !== this._airShown) {
      this._airShown = show;
      this.airEl.hidden = !show;
    }
    if (show) this.airEl.textContent = `${metres.toFixed(2)} m`;
  }

  /** How many of this park's six logos are in, so far this run. */
  setLogos(count, total) {
    if (!this.logosEl) return;
    this.logosEl.hidden = false;
    const key = `${count}/${total}`;
    if (key === this._logosKey) return;
    this._logosKey = key;
    this.logosCount.textContent = key;
  }

  /** The coin balance — shown in the run HUD and, live, in the shop. */
  setCoins(v) {
    const n = Math.floor(v);
    if (n === this._coins) return;
    this._coins = n;
    if (this.coinsEl) this.coinsEl.textContent = n.toLocaleString();
    if (this.storeCoinsEl) this.storeCoinsEl.textContent = n.toLocaleString();
  }

  /** Which of the walk/skate action buttons are showing right now. Only ever
   * one of dismount/mount is true — you cannot be both on the board and off
   * it — but that is the caller's rule to keep, not this one's to enforce. */
  setActionButtons({ dismount = false, mount = false, sit = false }) {
    if (this.dismountBtn) this.dismountBtn.hidden = !dismount;
    if (this.mountBtn) this.mountBtn.hidden = !mount;
    if (this.sitBtn) this.sitBtn.hidden = !sit;
  }

  /** The grab row: shown exactly while airborne, hidden the rest of the time. */
  setGrabButtonsVisible(visible) {
    if (this.grabButtons) this.grabButtons.hidden = !visible;
  }

  /**
   * The live combo. Rebuilt only when the chain changes, since this is the one
   * readout that can update several times a second.
   */
  setCombo(names, points, multiplier) {
    const live = names.length > 0;
    if (live !== this._comboLive) {
      this._comboLive = live;
      this.comboEl.hidden = !live;
    }
    if (!live) return;
    const key = `${names.join('+')}|${Math.floor(points)}`;
    if (key === this._comboKey) return;
    this._comboKey = key;
    this.comboList.textContent = names.join('  +  ');
    this.comboMult.textContent = `${Math.floor(points).toLocaleString()} × ${multiplier}`;
  }

  /** A trick's name, thrown up over the action and left to fade. */
  say(text, kind = '') {
    this.callout.textContent = text;
    this.callout.className = kind;
    this.callout.hidden = false;
    // Restarting the animation needs the class off for a frame, and reading
    // offsetWidth is what forces that reflow.
    this.callout.classList.remove('pop');
    void this.callout.offsetWidth;
    this.callout.classList.add('pop');
    this.calloutTimer = 1.6;
  }

  tick(dt) {
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) this.callout.hidden = true;
    }
  }

  /**
   * The balance meter. Shown whenever a grind or a manual is live, because
   * without it the drift is invisible and the trick stops being playable.
   */
  setBalance(active, value, limit) {
    if (active !== this._balanceOn) {
      this._balanceOn = active;
      this.balance.hidden = !active;
    }
    if (!active) return;
    const t = Math.max(-1, Math.min(1, value / limit));
    // The pip is half the width of the track, so ±100% of its own width is the
    // full range and the ends line up with losing it.
    this.balancePip.style.transform = `translateX(${t * 100}%)`;
    this.balance.classList.toggle('warn', Math.abs(t) > 0.62);
  }

  /** How loaded the legs are, so a flick's pop is something you can aim. */
  setCharge(v) {
    const show = v > 0.01;
    if (show !== this._chargeOn) {
      this._chargeOn = show;
      this.chargeEl.hidden = !show;
    }
    if (!show) return;
    this.chargeBar.style.transform = `scaleX(${Math.min(1, v)})`;
    this.chargeEl.classList.toggle('full', v > 0.92);
  }

  setDebug(text) {
    if (this.debugEl.hidden) return;
    this.debugEl.textContent = text;
  }

  enableDebug() {
    this.debugEl.hidden = false;
  }

  // --- screens -----------------------------------------------------------
  show(name) {
    for (const n of SCREENS) this.screens[n].hidden = n !== name;
    this.overlay.hidden = false;
    this.current = name;
    this.stats.hidden = true;
    if (name === 'guide') this.showTutStep(0);
    else this.preview?.stop(); // no sense rendering a second scene nobody can see
  }

  hide() {
    this.overlay.hidden = true;
    this.stats.hidden = false;
    this.current = null;
    this.preview?.stop();
  }

  get visible() {
    return !this.overlay.hidden;
  }

  /**
   * Why they went down, as a callout over the game.
   *
   * There is no Slam screen any more — the rider gets straight back up — so this
   * is the only place the reason gets told, and it has to not interrupt anything
   * to do it.
   */
  sayBail(reason) {
    this.say(BAIL_TEXT[reason] || 'Slam', 'sketchy');
  }

  setSound(on) {
    if (this.soundBtn) {
      this.soundBtn.textContent = `Sound: ${on ? 'On' : 'Off'}`;
      this.soundBtn.classList.toggle('off', !on);
    }
  }

  /** Whether holding the push key/thumb keeps pushing on its own, or a fresh
   * press is needed for every kick. Same on/off button styling as Sound. */
  setHoldToPush(on) {
    if (this.holdPushBtn) {
      this.holdPushBtn.textContent = `Hold to push: ${on ? 'On' : 'Off'}`;
      this.holdPushBtn.classList.toggle('off', !on);
    }
  }

  /** The pause button only makes sense mid-run — shown while playing or
   * walking, hidden the rest of the time (menus already have their own way
   * back, and there is nothing to pause from them). */
  setPauseButtonVisible(visible) {
    if (this.pauseBtn) this.pauseBtn.hidden = !visible;
  }

  /** The speed slider and its live label — set from outside on boot and reset,
   * and read back by the slider's own input handler as the player drags it. */
  setSpeedValue(v) {
    if (this.speedRange) this.speedRange.value = v;
    if (this.speedValueEl) this.speedValueEl.textContent = `${Math.round(Number(v))} m/s`;
  }

  /** The camera-distance slider and its live label. `v` is 0.5 (really
   * close) .. 1 (where the chase camera already sits, untouched). */
  setCamZoomValue(v) {
    const pct = Math.round(Number(v) * 100);
    if (this.camZoomRange) this.camZoomRange.value = pct;
    if (this.camZoomValueEl) {
      this.camZoomValueEl.textContent = pct >= 100 ? 'Default' : pct <= 50 ? 'Very close' : `${pct}%`;
    }
  }

  /** The music-volume slider and its live label. `v` is 0..1. Independent of
   * the Sound on/off toggle — that one silences everything at once. */
  setMusicVolumeValue(v) {
    const pct = Math.round(Number(v) * 100);
    if (this.musicRange) this.musicRange.value = pct;
    if (this.musicValueEl) this.musicValueEl.textContent = pct === 0 ? 'Off' : `${pct}%`;
  }

  /** The career numbers, on the start screen. */
  setStats(save) {
    if (!this.statLines) return;
    this.statLines.innerHTML =
      `<span>Best combo <b>${save.best.toLocaleString()}</b></span>` +
      `<span>Best single trick <b>${save.bestTrick.toLocaleString()}</b></span>` +
      `<span>Tricks landed <b>${save.tricks.toLocaleString()}</b></span>` +
      `<span>Biggest air <b>${save.bestAir.toFixed(2)} m</b></span>` +
      `<span>Logos found <b>${save.logos.toLocaleString()}</b></span>` +
      `<span>Slams <b>${save.bails.toLocaleString()}</b></span>`;
  }

  /** Which park is loaded, named on the start screen. */
  setCurrentPark(name) {
    if (this.parkNow) this.parkNow.textContent = `Skating: ${name}`;
  }

  // --- park picker ---------------------------------------------------------
  /** Build the choice of maps, once — `parks` is the PARKS array from park.js. */
  renderParks(parks, currentId) {
    if (!this.parkGrid) return;
    this.parkGrid.innerHTML = parks
      .map(
        (p) =>
          `<button type="button" class="park-card${p.id === currentId ? ' current' : ''}" data-park="${p.id}">` +
          `<b>${p.name}</b><span>${p.blurb}</span></button>`
      )
      .join('');
  }

  /** Reflect the day/night preference in the two-way toggle above the grid. */
  setLightingMode(mode) {
    if (!this.lightingToggle) return;
    for (const btn of this.lightingToggle.querySelectorAll('[data-lighting]')) {
      btn.classList.toggle('active', btn.dataset.lighting === mode);
    }
  }

  // --- board shop ------------------------------------------------------------
  /**
   * The full shop: every real board type in its own row, each in the couple
   * of skins it comes in — a longboard and a penny board are shaped
   * differently in the grid the same way they are on the ground, not just
   * coloured differently. `save` is read fresh each call so a purchase or an
   * equip can just re-render rather than patch one card by hand.
   */
  renderBoards(types, boards, save) {
    if (!this.boardGrid) return;
    const owned = save.boards;
    const equipped = save.boardId;
    this.setCoins(save.coins);
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    this.boardGrid.innerHTML = types
      .map((t) => {
        const cards = boards
          .filter((b) => b.type === t.id)
          .map((b) => {
            const has = owned.includes(b.id);
            const isEquipped = b.id === equipped;
            const status = isEquipped ? 'Equipped' : has ? 'Owned — tap to equip' : `${b.price} coins`;
            const locked = !has && save.coins < b.price;
            return (
              `<button type="button" class="board-card${isEquipped ? ' current' : ''}${locked ? ' locked' : ''}" data-board="${b.id}">` +
              `<span class="board-swatch board-swatch--${t.id}" style="background:${hex(b.palette.deck)};box-shadow:inset 0 0 0 4px ${hex(b.palette.accent)}"></span>` +
              `<b>${b.name}</b><span class="board-status">${status}</span></button>`
            );
          })
          .join('');
        return (
          `<div class="board-type"><h3>${t.name}</h3><p class="board-type-blurb">${t.blurb}</p>` +
          `<div class="board-type-grid">${cards}</div></div>`
        );
      })
      .join('');
  }

  /**
   * The shirt rack: one flat row, no types to group by — just a colour and
   * a price. Same card language as the boards above it.
   *
   * `charPalette` is the equipped character's own colours, which is what the
   * "Original" card has to show: that outfit overrides nothing, so its swatch
   * is whatever the current rider already has on, not a fixed colour.
   */
  renderOutfits(outfits, save, charPalette) {
    if (!this.outfitGrid) return;
    const owned = save.outfits;
    const equipped = save.outfitId;
    this.setCoins(save.coins);
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    this.outfitGrid.innerHTML =
      '<div class="board-type-grid">' +
      outfits
        .map((o) => {
          const has = owned.includes(o.id);
          const isEquipped = o.id === equipped;
          const status = isEquipped ? 'Equipped' : has ? 'Owned — tap to equip' : `${o.price} coins`;
          const locked = !has && save.coins < o.price;
          const look = o.shirt || charPalette;
          return (
            `<button type="button" class="board-card${isEquipped ? ' current' : ''}${locked ? ' locked' : ''}" data-outfit="${o.id}">` +
            `<span class="board-swatch board-swatch--shirt" style="background:${hex(look.shirt)};box-shadow:inset 0 0 0 4px ${hex(look.sleeve)}"></span>` +
            `<b>${o.name}</b><span class="board-status">${status}</span></button>`
          );
        })
        .join('') +
      '</div>';
  }

  /**
   * Re-skin the tutorial's demo rider to match the one being skated. Without
   * this, picking Nova and then opening How to play shows Ace doing the tricks,
   * which reads as a bug the first time anyone notices it.
   */
  setPreviewLook(palette, style) {
    this.preview?.skater.rebuild(palette, style);
  }

  /**
   * The skater rack, at the top of the shop. One card each, with a drawn
   * portrait rather than a colour swatch — a character is a whole figure, and
   * two riders can easily share a shirt colour while looking nothing like each
   * other. Free, so the cards say "pick" rather than carrying a price.
   *
   * The portraits are drawn after the cards are in the document, because
   * drawPortrait() sizes itself from the canvas's laid-out box.
   */
  renderCharacters(characters, equippedId) {
    if (!this.charGrid) return;
    this.charGrid.innerHTML = characters
      .map((c) => {
        const isEquipped = c.id === equippedId;
        return (
          `<button type="button" class="char-card${isEquipped ? ' current' : ''}" data-character="${c.id}">` +
          `<canvas class="char-portrait" data-portrait="${c.id}"></canvas>` +
          `<b>${c.name}</b><span class="char-blurb">${c.blurb}</span>` +
          `<span class="board-status">${isEquipped ? 'Skating' : 'Tap to pick'}</span></button>`
        );
      })
      .join('');
    for (const c of characters) {
      const canvas = this.charGrid.querySelector(`[data-portrait="${c.id}"]`);
      if (canvas) drawPortrait(canvas, c);
    }
  }

  // --- tutorial --------------------------------------------------------------
  buildTutDots() {
    if (!this.tutDots) return;
    this.tutDots.innerHTML = TUTORIAL.map(() => '<i></i>').join('');
    this.tutDotEls = [...this.tutDots.children];
  }

  showTutStep(i) {
    const n = TUTORIAL.length;
    this.tutStep = Math.max(0, Math.min(n - 1, i));
    const step = TUTORIAL[this.tutStep];
    if (this.tutTitle) this.tutTitle.textContent = step.title;
    if (this.tutBody) this.tutBody.textContent = step.body;
    if (this.tutKeys) this.tutKeys.textContent = step.keys;
    if (this.tutTouch) this.tutTouch.textContent = step.touch;
    if (this.tutPad) this.tutPad.textContent = step.pad;
    this.tutDotEls?.forEach((el, idx) => el.classList.toggle('on', idx === this.tutStep));
    if (this.tutPrev) this.tutPrev.disabled = this.tutStep === 0;
    if (this.tutNext) this.tutNext.textContent = this.tutStep === n - 1 ? "Let's ride" : 'Next';
    if (this.demoCanvas) this.demoCanvas.hidden = !step.demo;
    this.preview?.play(step.demo);
    if (this.gestureCanvas) this.gestureCanvas.hidden = !step.gesture;
    this.gestureT = 0;
  }

  /** Redraws the current step's gesture diagram, if it has one. A no-op the
   * rest of the time, same as preview.update() — safe to call every frame
   * regardless of which screen is showing. */
  updateGestureDiagram(dt) {
    if (!this.gestureCtx || this.gestureCanvas.hidden) return;
    const step = TUTORIAL[this.tutStep];
    if (!step?.gesture) return;
    this.gestureT += dt;
    const w = this.gestureCanvas.clientWidth;
    const h = this.gestureCanvas.clientHeight;
    if (!w || !h) return;
    if (this.gestureCanvas.width !== w || this.gestureCanvas.height !== h) {
      this.gestureCanvas.width = w;
      this.gestureCanvas.height = h;
    }
    drawGestureDiagram(this.gestureCtx, w, h, step.gesture, this.gestureT);
  }
}

// The DOM overlay: readouts, trick call-outs, the balance meter, and the menus.
//
// Kept out of WebGL entirely. Text, buttons and lists are what the DOM is good at,
// and a menu made of real elements gets focus rings, tap targets and text scaling
// for nothing.

import { TrickPreview } from './preview.js';
import { CharacterPreview } from './character-preview.js';
import { BoardPreview } from './board-preview.js';
import { drawPortrait } from './character-portrait.js';
import { drawGestureDiagram } from './gesture-diagram.js';
import { summarize, customLook } from './custom.js';
import {
  SKIN_TONES,
  HEIGHTS,
  BUILDS,
  HAIRS,
  PANTS,
  SHOES,
  SHIRTS,
  HATS,
  SHADES,
} from './custom.js';
import { TYPES } from './boards.js';
import { byId as outfitById, colorKeys as outfitColorKeys, defaultColors as outfitDefaults } from './outfits.js';
import { byId as pantsById, colorKeys as pantsColorKeys, defaultColors as pantsDefaults } from './pants.js';
import {
  byId as accessoryById,
  colorKeys as accessoryColorKeys,
  defaultColors as accessoryDefaults,
  ACCESSORY_CATEGORIES,
} from './accessories.js';
import { drawWheel, hexToHsv, hsvToHex } from './parkDesigner.js';
import {
  STYLES,
  ICON_LIST,
  PIXEL_PAINT,
  PIXEL_PALETTE,
  BLOCKART_COLS,
  BLOCKART_ROWS,
  summarizeDesign,
  colorHex,
} from './board-design.js';

const SCREENS = ['start', 'paused', 'guide', 'parks', 'store', 'charselect', 'maker', 'boardmaker', 'settings'];

/** A two-colour hint of each style, drawn in CSS for its chip. */
const STYLE_SWATCH = {
  plain: 'repeating-linear-gradient(45deg,#9b6a3f,#9b6a3f 6px,#d8b183 6px,#d8b183 12px)',
  pixel: 'linear-gradient(#2f7fd1,#35ffe0,#ffc93f,#ff2fa0)',
  graffiti: 'linear-gradient(#d3323f,#8a1f2a)',
  flame: 'linear-gradient(#ffc93f,#e6392e,#ff2fa0)',
  lightning: 'linear-gradient(#35ffe0,#12141a)',
  camo: 'repeating-linear-gradient(45deg,#3f7a3f,#3f7a3f 6px,#12141a 6px,#12141a 12px)',
  checker: 'repeating-conic-gradient(#ffffff 0 25%,#12141a 0 50%) 0 0 / 10px 10px',
  stickers: 'radial-gradient(#ffc93f 30%,#ff2fa0 70%)',
  arcade: 'linear-gradient(#9a5cf6,#12141a)',
  shop: 'repeating-linear-gradient(45deg,#e6392e,#e6392e 5px,#12141a 5px,#12141a 10px)',
  retro: 'linear-gradient(#ff2fa0,#ffc93f,#12141a)',
  tiger: 'repeating-linear-gradient(90deg,#12141a 0 8px,#e6392e 8px 16px)',
  space: 'radial-gradient(circle at 35% 40%,#2f7fd1 0 9px,#0d1020 10px)',
  argyle: 'repeating-linear-gradient(45deg,#ffffff 0 6px,#12141a 6px 12px), repeating-linear-gradient(-45deg,#12141a 0 6px,#ffffff 6px 12px)',
  splat: 'radial-gradient(#ff2fa0 35%,#35ffe0 70%)',
  circuit: 'repeating-linear-gradient(0deg,#39e75f 0 2px,#0a1f12 2px 8px)',
  sunburst: 'conic-gradient(#ffc93f 0 15%,#12141a 15% 30%,#ffc93f 30% 45%,#12141a 45% 60%,#ffc93f 60% 75%,#12141a 75% 90%,#ffc93f 90% 100%)',
  chevron: 'repeating-linear-gradient(-45deg,#2f7fd1 0 8px,#35ffe0 8px 16px)',
  shield: 'linear-gradient(#d3323f,#8a1f2a)',
  darts: 'radial-gradient(circle,#ffc93f 0 18%,#e6392e 18% 38%,#ffc93f 38% 58%,#e6392e 58% 78%,#ffc93f 78% 100%)',
  blockart: 'conic-gradient(#ff2fa0,#35ffe0,#ffc93f,#9a5cf6,#ff2fa0)',
};

/** A palette hex as the `#rrggbb` string the DOM paints with. */
function hexCss(v) {
  return `#${v.toString(16).padStart(6, '0')}`;
}

/** A readable glyph per sticker icon, for the rack and the layer chips. */
const STICKER_GLYPH = {
  star: '★',
  heart: '♥',
  coin: '◉',
  bolt: '⚡',
  skull: '☠',
  diamond: '◆',
  ring: '○',
  ghost: '👻',
  pac: '◐',
  cross: '✕',
  arrow: '➤',
  invader: '👾',
  crown: '♛',
};

/** Which block-art cell sits under a pointer on the scaled paint canvas. */
function cellFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 0.9999);
  const y = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 0.9999);
  return {
    row: Math.floor(y * BLOCKART_ROWS),
    col: Math.floor(x * BLOCKART_COLS),
  };
}

/** The saved-board card inserts a user-typed name into innerHTML. */
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * The maker's racks, in display order. Each role's name is the draft key it
 * reads and the save.js owned-list it asks about — one word, no translation.
 */
const MAKER_ROLES = [
  ['skin', SKIN_TONES],
  ['height', HEIGHTS],
  ['build', BUILDS],
  ['hair', HAIRS],
  ['pants', PANTS],
  ['shoes', SHOES],
  ['shirt', SHIRTS],
  ['hat', HATS],
  ['shades', SHADES],
];

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
    this.cameraModeBtn = document.getElementById('opt-cameramode');
    this.pauseBtn = document.getElementById('btn-pause');
    this.camcycleBtn = document.getElementById('btn-camcycle');
    this.hideUiBtn = document.getElementById('btn-hideui');
    this.statLines = document.getElementById('stat-lines');
    this.parkNow = document.getElementById('park-now');
    this.parkGrid = document.getElementById('park-grid');
    this.myParkGrid = document.getElementById('mypark-grid');
    this.myParkNewBtn = document.getElementById('btn-mypark-new');
    this.boardGrid = document.getElementById('board-grid');
    this.outfitGrid = document.getElementById('outfit-grid');
    this.pantsGrid = document.getElementById('pants-grid');
    this.accessoryGrid = document.getElementById('accessory-grid');
    // The Riders screen carries the same shirt, pants and accessory racks as
    // the shop, so a rider can be dressed where they are picked — same
    // catalogue, same purchase, just a second copy of each rack in the DOM.
    this.csOutfitGrid = document.getElementById('cs-outfit-grid');
    this.csPantsGrid = document.getElementById('cs-pants-grid');
    this.csAccessoryGrid = document.getElementById('cs-accessory-grid');
    this.csCoinsEl = document.getElementById('cs-coins');
    // The repaint wheels under the shirt, pants and accessory racks — one per
    // copy of each rack, the shop's and the Riders'. Each is a small colour
    // wheel for the currently equipped owned item — see renderRepaint(). The
    // per-kind selected colour key and last wheel hue/sat live on the Hud so a
    // re-render does not lose what the panel was showing.
    this.repaintEls = {
      outfit: [document.getElementById('repaint-outfit'), document.getElementById('repaint-cs-outfit')],
      pants: [document.getElementById('repaint-pants'), document.getElementById('repaint-cs-pants')],
      accessory: [document.getElementById('repaint-accessory'), document.getElementById('repaint-cs-accessory')],
    };
    this._repaintKey = {};
    this._repaintHsv = {};
    // With up to three accessories worn at once, the repaint panel tabs between
    // the equipped items — this remembers which one each panel is showing.
    this._repaintSelected = {};
    this.csCharGrid = document.getElementById('cs-char-grid');
    this.csMakerBtn = document.getElementById('btn-charselect-maker');

    // The Character Maker's own window. A separate mini-scene like the
    // tutorial's, so the figure can turn while every rack around it re-renders.
    this.makerPreviewEl = document.getElementById('maker-preview');
    this.makerPreview = this.makerPreviewEl ? new CharacterPreview(this.makerPreviewEl) : null;
    this.makerPreviewWrapEl = document.getElementById('maker-preview-wrap');
    this.makerFullscreenEl = document.getElementById('maker-fullscreen');
    this.makerFullscreenTitleEl = document.getElementById('maker-fullscreen-title');
    this.makerCoinsEl = document.getElementById('maker-coins');
    this.makerSummaryEl = document.getElementById('maker-summary');
    this.makerNameEl = document.getElementById('maker-name');
    this.makerSavedEl = document.getElementById('maker-saved');
    this.makerGrids = {};
    for (const id of ['skin', 'height', 'build', 'hair', 'pants', 'shoes', 'shirt', 'hat', 'shades']) {
      this.makerGrids[id] = document.getElementById(`maker-${id}`);
    }

    // The Board Maker's own window: the same trick as the Character Maker —
    // a second mini-scene for the deck, and plain DOM racks around it.
    this.bmPreviewEl = document.getElementById('bm-preview');
    this.bmPreview = this.bmPreviewEl ? new BoardPreview(this.bmPreviewEl) : null;
    this.bmCoinsEl = document.getElementById('bm-coins');
    this.bmNameEl = document.getElementById('bm-name');
    this.bmSummaryEl = document.getElementById('bm-summary');
    this.bmSavedEl = document.getElementById('bm-saved');
    this.bmStyleEl = document.getElementById('bm-style');
    this.bmTypeEl = document.getElementById('bm-type');
    this.bmColorsEl = document.getElementById('bm-colors');
    this.bmOptionsEl = document.getElementById('bm-options-body');
    this.bmSaveBtn = document.getElementById('btn-bm-save');
    this._bmPainting = false;

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
    this.pauseSpeedEl = document.getElementById('pause-speed');
    this.pauseMusicRange = document.getElementById('pause-music-range');
    this.pauseMusicValueEl = document.getElementById('pause-music-value');
    this.pauseSpotifyRange = document.getElementById('pause-spotify-range');
    this.pauseSpotifyValueEl = document.getElementById('pause-spotify-value');

    this.on = {
      play: null,
      resume: null,
      guide: null,
      back: null,
      sound: null,
      reset: null,
      parks: null,
      selectPark: null,
      newPark: null,
      playPark: null,
      editPark: null,
      deletePark: null,
      speed: null,
      camZoom: null,
      musicVolume: null,
      spotifyVolume: null,
      holdToPush: null,
      cameraMode: null,
      camcycle: null,
      pause: null,
      settings: null,
      lighting: null,
      store: null,
      board: null,
      outfit: null,
      pants: null,
      accessory: null,
      character: null,
      // The shop's repaint wheels: `repaint(kind, id, key, hex)` fires as the
      // wheel or its brightness slider moves (live preview), `repaintCommit(kind, id)`
      // when the gesture lets go, and `repaintReset(kind, id)` on Reset. `kind`
      // is one of outfit/pants/accessory.
      repaint: null,
      repaintCommit: null,
      repaintReset: null,
      riders: null,
      maker: null,
      // A part picked in the maker: `(role, id)`, where role is one of
      // skin/height/build/hair/pants/shoes/shirt/hat/shades.
      makePart: null,
      // The maker's name field typed with the current draft's name.
      makerName: null,
      // The maker's Save pressed with the current draft.
      makeSave: null,
      // One of the saved custom characters' cards: equip/edit/delete.
      makerSavedAction: null,
      // The Board Maker's rack events. Style/type pick by id; colour picks by
      // role name and hex; the block-art grid paints one cell at a time.
      // The under-glow toggle turns the neon strip on and off, and its colour
      // pick is a plain hex.
      boardMaker: null,
      bmStyle: null,
      bmType: null,
      bmColor: null,
      bmName: null,
      bmText: null,
      bmPixel: null,
      bmBrush: null,
      bmAddSticker: null,
      bmLayer: null,
      bmLayerChange: null,
      bmLayerDelete: null,
      bmGlowToggle: null,
      bmGlowColor: null,
      bmFace: null,
      bmPlace: null,
      bmSave: null,
      bmSavedAction: null,
      dismount: null,
      mount: null,
      sit: null,
      grabStart: null,
      grabEnd: null,
      // Fired on every menu transition: the menu name on show(), null on hide().
      // The radio uses it to know when a run is on screen — see main.js.
      screenChanged: null,
    };
    this._score = -1;
    this._best = -1;
    this._coins = -1;
    this.calloutTimer = 0;
    this._uiHidden = false;
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
    click('btn-mypark-new', () => this.on.newPark?.());
    click('btn-store', () => this.on.store?.());
    click('btn-store-back', () => this.on.back?.());
    click('btn-riders', () => this.on.riders?.());
    click('btn-charselect-back', () => this.on.back?.());
    click('btn-charselect-maker', () => this.on.maker?.());
    click('btn-maker-save', () => this.on.makeSave?.());
    click('btn-maker-back', () => this.on.back?.());
    click('btn-maker-expand', () => this.setMakerFullscreen(true));
    click('btn-maker-expand-back', () => this.setMakerFullscreen(false));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.makerFullscreenEl && !this.makerFullscreenEl.hidden) {
        e.preventDefault();
        this.setMakerFullscreen(false);
      }
    });
    click('btn-boardmaker', () => this.on.boardMaker?.());
    click('btn-store-boardmaker', () => this.on.boardMaker?.());
    click('btn-bm-save', () => this.on.bmSave?.());
    click('btn-bm-back', () => this.on.back?.());
    this.bmNameEl?.addEventListener('input', (e) => this.on.bmName?.(e.target.value));

    // The Board Maker's racks are rebuilt on every render, so their events
    // hang off the two persistent containers instead of the rebuilt buttons.
    const bmScreen = document.getElementById('screen-boardmaker');
    bmScreen?.addEventListener('click', (e) => {
      const style = e.target.closest('[data-bmstyle]');
      if (style) { this.on.bmStyle?.(style.dataset.bmstyle); return; }
      const type = e.target.closest('[data-bmtype]');
      if (type) { this.on.bmType?.(type.dataset.bmtype); return; }
      const saved = e.target.closest('[data-bmsaved]');
      if (saved) {
        const act = e.target.closest('[data-bmaction]');
        this.on.bmSavedAction?.(saved.dataset.bmsaved, act ? act.dataset.bmaction : 'equip');
        return;
      }
      const brush = e.target.closest('[data-bmbrush]');
      if (brush) { this.on.bmBrush?.(Number(brush.dataset.bmbrush)); return; }
      const icon = e.target.closest('[data-bmicon]');
      if (icon) { this.on.bmAddSticker?.(icon.dataset.bmicon); return; }
      const layer = e.target.closest('[data-bmlayer]');
      if (layer) { this.on.bmLayer?.(Number(layer.dataset.bmlayer)); return; }
      const del = e.target.closest('[data-bmldel]');
      if (del) { this.on.bmLayerDelete?.(Number(del.dataset.bmldel)); return; }
      const glow = e.target.closest('[data-bmglowtoggle]');
      if (glow) { this.on.bmGlowToggle?.(); return; }
      const face = e.target.closest('[data-bmface]');
      if (face) { this.on.bmFace?.(face.dataset.bmface); return; }
    });
    // Paint the block-art grid on pointer-down and keep painting while the
    // pointer is held down and drags across — a tap paints one cell, a swipe
    // paints a stroke. The cell under the pointer is found from the scaled
    // canvas's own box, so it lines up at any CSS size.
    bmScreen?.addEventListener('pointerdown', (e) => {
      const pixel = e.target.closest('[data-bmpixel]');
      if (!pixel) return;
      this._bmPainting = true;
      pixel.setPointerCapture?.(e.pointerId);
      const rc = cellFromEvent(e, pixel);
      this.on.bmPixel?.(rc.row, rc.col);
    });
    bmScreen?.addEventListener('pointermove', (e) => {
      if (!this._bmPainting) return;
      const pixel = e.target.closest('[data-bmpixel]');
      if (!pixel) return;
      const rc = cellFromEvent(e, pixel);
      this.on.bmPixel?.(rc.row, rc.col);
    });
    bmScreen?.addEventListener('pointerup', () => { this._bmPainting = false; });
    bmScreen?.addEventListener('pointercancel', () => { this._bmPainting = false; });
    this.bmOptionsEl?.addEventListener('input', (e) => {
      const color = e.target.closest('[data-bmcolor]');
      if (color) { this.on.bmColor?.(color.dataset.bmcolor, color.value); return; }
      const text = e.target.closest('[data-bmtext]');
      if (text) { this.on.bmText?.(text.value); return; }
      const lx = e.target.closest('[data-bmlx]');
      if (lx) { this.on.bmLayerChange?.(Number(lx.dataset.bmlx), 'x', Number(lx.value)); return; }
      const lz = e.target.closest('[data-bmlz]');
      if (lz) { this.on.bmLayerChange?.(Number(lz.dataset.bmlz), 'z', Number(lz.value)); return; }
      const lr = e.target.closest('[data-bmlr]');
      if (lr) { this.on.bmLayerChange?.(Number(lr.dataset.bmlr), 'rot', Number(lr.value)); return; }
      const ls = e.target.closest('[data-bmls]');
      if (ls) { this.on.bmLayerChange?.(Number(ls.dataset.bmls), 'scale', Number(ls.value)); return; }
      const glow = e.target.closest('[data-bmglowcolor]');
      if (glow) { this.on.bmGlowColor?.(glow.value); return; }
      const ppx = e.target.closest('[data-bmpx]');
      if (ppx) { this.on.bmPlace?.('px', Number(ppx.value)); return; }
      const ppz = e.target.closest('[data-bmpz]');
      if (ppz) { this.on.bmPlace?.('pz', Number(ppz.value)); return; }
      const ppr = e.target.closest('[data-bmpr]');
      if (ppr) { this.on.bmPlace?.('prot', Number(ppr.value)); return; }
      const pps = e.target.closest('[data-bmps]');
      if (pps) { this.on.bmPlace?.('pscale', Number(pps.value)); return; }
    });
    // The main colour rack lives in its own container, so the same delegation
    // hangs off it too.
    this.bmColorsEl?.addEventListener('input', (e) => {
      const color = e.target.closest('[data-bmcolor]');
      if (color) this.on.bmColor?.(color.dataset.bmcolor, color.value);
    });
    click('btn-settings', () => this.on.settings?.());
    click('btn-settings-back', () => this.on.back?.());
    click('btn-pause', () => this.on.pause?.());
    click('btn-hideui', () => this.setHideUi(!this._uiHidden));
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
    click('opt-cameramode', () => this.on.cameraMode?.());
    click('btn-camcycle', () => this.on.camcycle?.());
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
    this.myParkGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      const act = e.target.closest('[data-act]');
      if (act) {
        const id = card.dataset.id;
        if (act.dataset.act === 'play') this.on.playPark?.(id);
        if (act.dataset.act === 'edit') this.on.editPark?.(id);
        if (act.dataset.act === 'delete') this.on.deletePark?.(id);
      } else {
        this.on.editPark?.(card.dataset.id);
      }
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
    this.pauseMusicRange?.addEventListener('input', () => {
      const v = Number(this.pauseMusicRange.value) / 100;
      this.setMusicVolumeValue(v);
      this.on.musicVolume?.(v);
    });
    this.pauseSpotifyRange?.addEventListener('input', () => {
      const v = Number(this.pauseSpotifyRange.value) / 100;
      this.setSpotifyVolumeValue(v);
      this.on.spotifyVolume?.(v);
    });
    this.boardGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-board]');
      if (card) this.on.board?.(card.dataset.board);
    });
    // The shop and the Riders screen each carry their own copy of the shirt,
    // pants and accessory racks, so each copy needs the same delegated click.
    for (const grid of [this.outfitGrid, this.csOutfitGrid]) {
      grid?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-outfit]');
        if (card) this.on.outfit?.(card.dataset.outfit);
      });
    }
    for (const grid of [this.pantsGrid, this.csPantsGrid]) {
      grid?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-pants]');
        if (card) this.on.pants?.(card.dataset.pants);
      });
    }
    for (const grid of [this.accessoryGrid, this.csAccessoryGrid]) {
      grid?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-accessory]');
        if (card) this.on.accessory?.(card.dataset.accessory);
      });
    }
    // The repaint panels are rebuilt on every render, so their events hang off
    // the persistent containers instead of the rebuilt buttons — the same
    // trick the Board Maker's racks use. The wheel canvas only exists after a
    // render, so its pointer gestures are delegated too. There is one panel
    // per copy of each rack, so every panel of a kind gets the same wiring.
    for (const kind of ['outfit', 'pants', 'accessory']) {
      for (const el of this.repaintEls[kind] || []) {
        if (!el) continue;
        el.addEventListener('click', (e) => {
          const tab = e.target.closest('[data-repaintitem]');
          if (tab) {
            this._repaintSelected[kind] = tab.dataset.repaintitem;
            this.renderRepaint(kind);
            return;
          }
          const part = e.target.closest('[data-repaintpart]');
          if (part) {
            this._repaintKey[kind] = part.dataset.repaintpart;
            this.renderRepaint(kind);
            return;
          }
          if (e.target.closest('.repaint-reset')) {
            this.on.repaintReset?.(kind, el.dataset.repaintid);
          }
        });
        el.addEventListener('input', (e) => {
          const slider = e.target.closest('[data-repaintbright]');
          if (!slider) return;
          const { h, s } = this._repaintHsv[kind] || { h: 0, s: 0 };
          this._repaintLive(kind, hsvToHex(h, s, Number(slider.value) / 100), el);
        });
        el.addEventListener('pointerdown', (e) => {
          const wheel = e.target.closest('[data-repaintwheel]');
          if (!wheel) return;
          e.preventDefault();
          wheel.setPointerCapture?.(e.pointerId);
          this._pickRepaint(kind, wheel, e);
        });
        el.addEventListener('pointermove', (e) => {
          const wheel = e.target.closest('[data-repaintwheel]');
          if (!wheel || !wheel.hasPointerCapture?.(e.pointerId)) return;
          this._pickRepaint(kind, wheel, e);
        });
        el.addEventListener('pointerup', (e) => {
          const wheel = e.target.closest('[data-repaintwheel]');
          if (!wheel || !wheel.hasPointerCapture?.(e.pointerId)) return;
          wheel.releasePointerCapture?.(e.pointerId);
          this.on.repaintCommit?.(kind, el.dataset.repaintid);
        });
      }
    }
    this.csCharGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-character]');
      if (card) this.on.character?.(card.dataset.character);
    });
    // One delegated listener for every rack in the maker: each option button
    // carries its own role and part, so the maker only needs a single wire
    // whatever a future rack is added.
    const makerEl = document.getElementById('screen-maker');
    makerEl?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-part]');
      if (card) this.on.makePart?.(card.dataset.role, card.dataset.part);
      const saved = e.target.closest('[data-makersaved]');
      if (saved) {
        const act = e.target.closest('[data-makeraction]');
        this.on.makerSavedAction?.(saved.dataset.makersaved, act ? act.dataset.makeraction : 'equip');
        return;
      }
    });
    this.makerNameEl?.addEventListener('input', (e) => this.on.makerName?.(e.target.value));
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
    // The pause menu's own readout shows the speed the player stopped at.
    if (this.pauseSpeedEl) this.pauseSpeedEl.textContent = `${kmh} km/h`;
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

  /** The coin balance — shown in the run HUD and, live, in the shop and the
   * Riders screen. */
  setCoins(v) {
    const n = Math.floor(v);
    if (n === this._coins) return;
    this._coins = n;
    if (this.coinsEl) this.coinsEl.textContent = n.toLocaleString();
    if (this.storeCoinsEl) this.storeCoinsEl.textContent = n.toLocaleString();
    if (this.csCoinsEl) this.csCoinsEl.textContent = n.toLocaleString();
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
    this.setMakerFullscreen(false);
    for (const n of SCREENS) this.screens[n].hidden = n !== name;
    this.overlay.hidden = false;
    this.current = name;
    this.stats.hidden = true;
    if (name === 'guide') this.showTutStep(0);
    else this.preview?.stop(); // no sense rendering a second scene nobody can see
    // The maker's turntable is its own tiny scene with its own loop; keep it
    // spinning only while its screen is the one in front.
    if (name === 'maker') this.makerPreview?.start();
    else this.makerPreview?.stop();
    if (name === 'boardmaker') this.bmPreview?.start();
    else this.bmPreview?.stop();
    this.on.screenChanged?.(name);
  }

  hide() {
    this.setMakerFullscreen(false);
    this.overlay.hidden = true;
    this.stats.hidden = false;
    this.current = null;
    this.preview?.stop();
    this.makerPreview?.stop();
    this.bmPreview?.stop();
    this.on.screenChanged?.(null);
  }

  get visible() {
    return !this.overlay.hidden;
  }

  /**
   * The maker preview's full-screen view: the same live canvas, moved to an
   * overlay that covers the whole screen, with a bar up top to get back.
   * Moving the canvas keeps the WebGL scene alive — the renderer holds the
   * element, so it just re-sizes itself to wherever it now sits, exactly like
   * a window resize.
   */
  setMakerFullscreen(on) {
    if (!this.makerFullscreenEl || !this.makerPreviewEl || !this.makerPreviewWrapEl) return;
    if (on && this.makerFullscreenEl.hidden) {
      if (this.makerFullscreenTitleEl && this.makerSummaryEl) {
        this.makerFullscreenTitleEl.textContent = this.makerSummaryEl.textContent || 'Character preview';
      }
      this.makerFullscreenEl.appendChild(this.makerPreviewEl);
      this.makerFullscreenEl.hidden = false;
    } else if (!on && !this.makerFullscreenEl.hidden) {
      this.makerFullscreenEl.hidden = true;
      this.makerPreviewWrapEl.insertBefore(this.makerPreviewEl, this.makerSummaryEl);
    }
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

  /** The live camera: chase, first person or board. The settings button names
   * it and the in-game camcycle button announces what it is — cycling is
   * self-explanatory, but the mode it lands on should never be a secret. */
  setCameraMode(mode) {
    const label = { chase: 'Chase', first: 'First', board: 'Board' }[mode] || 'Chase';
    if (this.cameraModeBtn) {
      this.cameraModeBtn.textContent = `Camera: ${label}`;
      this.cameraModeBtn.classList.toggle('off', mode !== 'chase');
    }
    if (this.camcycleBtn) {
      this.camcycleBtn.textContent = `Cam: ${label}`;
      this.camcycleBtn.classList.toggle('off', mode !== 'chase');
    }
  }

  /** The pause button only makes sense mid-run — shown while playing or
   * walking, hidden the rest of the time (menus already have their own way
   * back, and there is nothing to pause from them). */
  setPauseButtonVisible(visible) {
    if (this.pauseBtn) this.pauseBtn.hidden = !visible;
  }

  /** The camera-cycle button only makes sense mid-run too, and rides along
   * with the pause button's visibility. */
  setCamcycleVisible(visible) {
    if (this.camcycleBtn) this.camcycleBtn.hidden = !visible;
  }

  /**
   * Hide every in-run control and just watch the park. The button that does it
   * stays on screen so the same tap brings it all back — nothing else survives,
   * including the gesture trail over the canvas. Audio is deliberately
   * untouched: hiding the chrome is not pausing the game.
   */
  setHideUi(on) {
    if (on === this._uiHidden) return;
    this._uiHidden = on;
    document.getElementById('app').classList.toggle('hide-ui', on);
    if (this.hideUiBtn) {
      this.hideUiBtn.textContent = on ? 'Show UI' : 'Hide UI';
      this.hideUiBtn.classList.toggle('off', on);
    }
  }

  /** Same mid-run rhythm as the pause button, and leaving a run restores
   * everything — no UI left hidden behind a menu. */
  setHideUiVisible(visible) {
    if (!this.hideUiBtn) return;
    this.hideUiBtn.hidden = !visible;
    if (!visible) this.setHideUi(false);
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
    // The pause menu carries the same slider, so both stay in lockstep.
    if (this.pauseMusicRange) this.pauseMusicRange.value = pct;
    if (this.pauseMusicValueEl) this.pauseMusicValueEl.textContent = pct === 0 ? 'Off' : `${pct}%`;
  }

  /** The Spotify-volume slider on the pause menu and its live label. `v` is
   * 0..1, straight through to the SDK player. */
  setSpotifyVolumeValue(v) {
    const pct = Math.round(Number(v) * 100);
    if (this.pauseSpotifyRange) this.pauseSpotifyRange.value = pct;
    if (this.pauseSpotifyValueEl) this.pauseSpotifyValueEl.textContent = pct === 0 ? 'Off' : `${pct}%`;
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
  /** Build the choice of maps, once — `parks` is the PARKS array from parkLayouts.js. */
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

  // --- my parks ------------------------------------------------------------
  /** Every park the player built, with Play/Edit/Delete actions. */
  renderMyParks(parks, currentId) {
    if (!this.myParkGrid) return;
    this.myParkGrid.innerHTML =
      parks
        .map((p) => {
          const current = p.id === currentId ? ' (now)' : '';
          return (
            `<div class="mypark-card" data-id="${p.id}">` +
            `<b>${p.name}${current}</b>` +
            `<span class="meta">${p.objects} object${p.objects === 1 ? '' : 's'}</span>` +
            `<span class="mypark-actions">` +
            `<button type="button" data-act="play">Play</button>` +
            `<button type="button" data-act="edit">Edit</button>` +
            `<button type="button" class="mypark-del" data-act="delete">Delete</button>` +
            `</span></div>`
          );
        })
        .join('') || `<p class="tag">Nothing here yet — build your first park.</p>`;
  }

  // --- board shop ------------------------------------------------------------
  /**
   * The full shop: one card per real board type, since a type is now the whole
   * of the catalogue — the palette it ships in is what the shop advertises,
   * and buying it unlocks that shape in the Board Maker. The shape-hinted
   * swatches still apply, because the card's own id is the type it hints at.
   * `save` is read fresh each call so a purchase or an equip can just
   * re-render rather than patch one card by hand.
   */
  renderBoards(types, boards, save) {
    if (!this.boardGrid) return;
    const owned = save.boards;
    const equipped = save.boardId;
    this.setCoins(save.coins);
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    this.boardGrid.innerHTML =
      '<div class="board-type-grid">' +
      boards
        .map((b) => {
          const has = owned.includes(b.id);
          const isEquipped = b.id === equipped;
          const status = isEquipped ? 'Equipped' : has ? 'Owned — tap to equip' : `${b.price} coins`;
          const locked = !has && save.coins < b.price;
          return (
            `<button type="button" class="board-card${isEquipped ? ' current' : ''}${locked ? ' locked' : ''}" data-board="${b.id}">` +
            `<span class="board-swatch board-swatch--${b.id}" style="background:${hex(b.palette.deck)};box-shadow:inset 0 0 0 4px ${hex(b.palette.accent)}"></span>` +
            `<b>${b.name}</b><span class="board-status">${status}</span></button>`
          );
        })
        .join('') +
      '</div>';
  }

  /**
   * The shirt rack: one flat row, no types to group by — just a colour and
   * a price. Same card language as the boards above it.
   *
   * `charPalette` is the equipped character's own colours, which is what the
   * "Original" card has to show: that outfit overrides nothing, so its swatch
   * is whatever the current rider already has on, not a fixed colour.
   *
   * The rack appears twice — the shop's copy and the Riders screen's — and
   * both get the same cards.
   */
  renderOutfits(outfits, save, charPalette) {
    if (!this.outfitGrid && !this.csOutfitGrid) return;
    const owned = save.outfits;
    const equipped = save.outfitId;
    this.setCoins(save.coins);
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    const cards =
      '<div class="board-type-grid">' +
      outfits
        .map((o) => {
          const has = owned.includes(o.id);
          const isEquipped = o.id === equipped;
          const status = isEquipped ? 'Equipped' : has ? 'Owned — tap to equip' : `${o.price} coins`;
          const locked = !has && save.coins < o.price;
          const repaint = save.outfitColors[o.id] || {};
          const look = { ...(o.shirt || charPalette), ...repaint };
          return (
            `<button type="button" class="board-card${isEquipped ? ' current' : ''}${locked ? ' locked' : ''}" data-outfit="${o.id}">` +
            `<span class="board-swatch board-swatch--shirt" style="background:${hex(look.shirt)};box-shadow:inset 0 0 0 4px ${hex(look.sleeve)}"></span>` +
            `<b>${o.name}</b><span class="board-status">${status}</span></button>`
          );
        })
        .join('') +
      '</div>';
    for (const grid of [this.outfitGrid, this.csOutfitGrid]) {
      if (grid) grid.innerHTML = cards;
    }
    this.renderRepaint('outfit', save);
  }

  /**
   * The trouser rack: one flat row, same card language as the shirts above.
   * A card's swatch is the pair's own two colours — or, when the player has
   * repainted that pair, the repaint wins and the swatch shows the customised
   * pair, so the shop always advertises what you would actually put on.
   */
  renderPants(pants, save) {
    if (!this.pantsGrid && !this.csPantsGrid) return;
    const owned = save.pants;
    const equipped = save.pantsId;
    this.setCoins(save.coins);
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    const repaint = save.pantsColors;
    const cards =
      '<div class="board-type-grid">' +
      pants
        .map((p) => {
          const has = owned.includes(p.id);
          const isEquipped = p.id === equipped;
          const status = isEquipped ? 'Equipped' : has ? 'Owned — tap to equip' : `${p.price} coins`;
          const locked = !has && save.coins < p.price;
          const colors = repaint[p.id] || p.colors || { pants: 0x3a3f4a, pantsDark: 0x2a2e38 };
          return (
            `<button type="button" class="board-card${isEquipped ? ' current' : ''}${locked ? ' locked' : ''}" data-pants="${p.id}">` +
            `<span class="board-swatch board-swatch--pants" style="background:${hex(colors.pants)};box-shadow:inset 0 0 0 4px ${hex(colors.pantsDark)}"></span>` +
            `<b>${p.name}</b><span class="board-status">${status}</span></button>`
          );
        })
        .join('') +
      '</div>';
    for (const grid of [this.pantsGrid, this.csPantsGrid]) {
      if (grid) grid.innerHTML = cards;
    }
    this.renderRepaint('pants', save);
  }

  /**
   * The haberdashery: one card per hat, pair of shades or backpack, carrying a
   * portrait of the equipped rider wearing it — so a card reads as "this on
   * you" rather than as a colour, which is what a row of hats and glasses
   * needs.
   *
   * `look` is the equipped character's own palette and style; each card draws
   * that figure wearing the currently equipped accessories, with the
   * candidate's own category swapped for the candidate — so a bucket hat
   * advertises what it would look like on the person currently in the shop,
   * over whatever else they already have on. "Original" shows the rider
   * stripped back to just the character.
   */
  renderAccessories(accessories, save, look) {
    if (!this.accessoryGrid && !this.csAccessoryGrid) return;
    const owned = save.accessories;
    const ids = save.accessoryIds;
    this.setCoins(save.coins);
    // The equipped rider without any shop accessories: the character's own head
    // and colours, with the shirt and pants still on. `look` already wears the
    // accessories, so stripping restores the colour keys they own to the
    // character's own values.
    const base = {
      palette: { ...look.palette },
      style: {
        ...look.style,
        head: look.character?.style?.head ?? look.style.head,
        shades: false,
        pack: false,
      },
    };
    for (const k of ['cap', 'band', 'shades', 'lens', 'pack', 'strap']) {
      if (look.character?.palette && k in look.character.palette) base.palette[k] = look.character.palette[k];
    }
    // The set currently being worn, skipping the empty "Original" slots.
    const worn = ACCESSORY_CATEGORIES.map((c) => accessoryById[ids[c]]).filter((a) => a && a.category !== 'none');
    // Paint one accessory onto a look. An owner's repaint of the accessory wins
    // over the catalogue's own colours, exactly as it does on the rider — the
    // rack advertises what would actually be worn.
    const putOn = (target, a) => {
      const repaint = save.accessoryColors[a.id] || {};
      if (a.hat) {
        target.palette.cap = a.hat.cap;
        target.palette.band = a.hat.band;
        target.style.head = a.hat.style;
      }
      if (a.shades) {
        target.palette.shades = a.shades.frame;
        target.palette.lens = a.shades.lens;
        target.style.shades = true;
      }
      if (a.pack) {
        target.palette.pack = a.pack.pack;
        target.palette.strap = a.pack.strap;
        target.style.pack = true;
      }
      Object.assign(target.palette, repaint);
    };
    // A card advertises the currently worn set with the candidate's category
    // swapped for the candidate, so a hat card shows the rider with their
    // current shades and pack and *this* hat.
    const wearing = (a) => {
      const target = { palette: { ...base.palette }, style: { ...base.style } };
      for (const acc of worn) putOn(target, acc);
      if (a.category !== 'none') putOn(target, a);
      return target;
    };
    const equippedIn = (a) =>
      a.category === 'none'
        ? ACCESSORY_CATEGORIES.every((c) => ids[c] === 'none')
        : ids[a.category] === a.id;
    const cards =
      '<div class="board-type-grid">' +
      accessories
        .map((a) => {
          const has = owned.includes(a.id);
          const isEquipped = equippedIn(a);
          const status = isEquipped ? 'Equipped' : has ? 'Owned — tap to equip' : `${a.price} coins`;
          const locked = !has && save.coins < a.price;
          return (
            `<button type="button" class="board-card accessory-card${isEquipped ? ' current' : ''}${locked ? ' locked' : ''}" data-accessory="${a.id}">` +
            `<canvas class="char-portrait" data-accessory-portrait="${a.id}"></canvas>` +
            `<b>${a.name}</b><span class="board-status">${status}</span></button>`
          );
        })
        .join('') +
      '</div>';
    for (const grid of [this.accessoryGrid, this.csAccessoryGrid]) {
      if (!grid) continue;
      grid.innerHTML = cards;
      for (const a of accessories) {
        const canvas = grid.querySelector(`[data-accessory-portrait="${a.id}"]`);
        if (canvas) drawPortrait(canvas, wearing(a));
      }
    }
    this.renderRepaint('accessory', save);
  }

  /**
   * The repaint wheels. Each rack owns a small wheel under its grid for the
   * equipped, owned item — a shirt's body and sleeves, a pair of pants' legs
   * and shins, a hat's cap and band (or a backpack's shell and straps) — so a
   * purchase can be made exactly the colour the rider will wear, rather than
   * only the shade the catalogue shipped. One key at a time: the part buttons
   * pick which key the wheel edits, the wheel and its brightness slider paint
   * it, and Reset throws the repaint away back to the item's own colours.
   * A rider can wear three accessories at once, so the accessory panel tabs
   * between the equipped items before showing a chosen one's keys. Every copy
   * of the rack gets its own wheel — the shop's and the Riders'.
   */
  renderRepaint(kind, save) {
    for (const el of this.repaintEls[kind] || []) {
      if (!el) continue;
      this._save = save;
      const items = this._repaintItems(kind, save);
      if (!items.length) {
        el.hidden = true;
        el.innerHTML = '';
        continue;
      }
      el.hidden = false;
      if (!items.some((it) => it.id === this._repaintSelected[kind])) this._repaintSelected[kind] = items[0].id;
      const item = items.find((it) => it.id === this._repaintSelected[kind]);
      el.dataset.repaintid = item.id;
      if (!this._repaintKey[kind] || !item.keyList.includes(this._repaintKey[kind])) {
        this._repaintKey[kind] = item.keyList[0];
      }
      const key = this._repaintKey[kind];
      const hex = this._colorOf(item, key);
      const { v } = hexToHsv(hexCss(hex));
      el.innerHTML =
        (items.length > 1
          ? `<div class="repaint-tabs">` +
            items
              .map(
                (it) =>
                  `<button type="button" class="repaint-tab${it.id === item.id ? ' on' : ''}" data-repaintitem="${it.id}">` +
                  `${it.def.name}</button>`
              )
              .join('') +
            `</div>`
          : '') +
        `<div class="repaint-parts">` +
        item.keyList
          .map(
            (k) =>
              `<button type="button" class="repaint-part${k === key ? ' on' : ''}" data-repaintpart="${k}">` +
              `${item.labels[k]}<span class="repaint-chip" style="--chip:${hexCss(this._colorOf(item, k))}"></span></button>`
          )
          .join('') +
        `</div>` +
        `<div class="dg-color">` +
        `<canvas class="dg-wheel" data-repaintwheel aria-label="Colour wheel"></canvas>` +
        `<label class="dg-field dg-brightness">Brightness` +
        `<input type="range" data-repaintbright min="0" max="100" step="1" value="${Math.round(v * 100)}">` +
        `<output data-repaintbrightout>${Math.round(v * 100)}</output></label>` +
        `<div class="dg-hexrow"><span class="dg-hex-chip" style="--chip:${hexCss(hex)}"></span>` +
        `<output class="dg-hex" data-repainthex>${hexCss(hex).toUpperCase()}</output></div>` +
        `</div>` +
        `<button type="button" class="repaint-reset">Reset to original</button>`;
      drawWheel(el.querySelector('[data-repaintwheel]'), hexCss(hex));
    }
  }

  /** The equipped, owned items a repaint panel can edit. The accessory rack is
   * the one with more than one candidate: a hat, shades and a backpack can be
   * worn at once, so the panel tabs between them; outfit and pants each have
   * the single equipped item as before. */
  _repaintItems(kind, save) {
    const meta = {
      outfit: {
        def: outfitById[save.outfitId],
        owned: save.outfits,
        colors: save.outfitColors,
        keys: outfitColorKeys,
        defaults: outfitDefaults,
        labels: { shirt: 'Shirt', sleeve: 'Sleeves' },
      },
      pants: {
        def: pantsById[save.pantsId],
        owned: save.pants,
        colors: save.pantsColors,
        keys: pantsColorKeys,
        defaults: pantsDefaults,
        labels: { pants: 'Legs', pantsDark: 'Shins' },
      },
      accessory: {
        owned: save.accessories,
        colors: save.accessoryColors,
        keys: accessoryColorKeys,
        defaults: accessoryDefaults,
        labels: { cap: 'Cap', band: 'Band', shades: 'Frame', lens: 'Lenses', pack: 'Pack', strap: 'Straps' },
      },
    }[kind];
    if (!meta) return [];
    if (kind === 'accessory') {
      const ids = save.accessoryIds;
      const out = [];
      for (const c of ACCESSORY_CATEGORIES) {
        const id = ids[c];
        if (!id || id === 'none') continue;
        const def = accessoryById[id];
        if (!def || !meta.owned.includes(id)) continue;
        const keyList = meta.keys(def);
        if (!keyList.length) continue;
        out.push({ ...meta, def, id, keyList });
      }
      return out;
    }
    if (!meta.def || !meta.owned.includes(meta.def.id)) return [];
    const keyList = meta.keys(meta.def);
    if (!keyList.length) return [];
    return [{ ...meta, id: meta.def.id, keyList }];
  }

  /** The equipped, owned item a repaint panel currently points at — or null
   * when nothing equipped is repaintable ("Original" shirt, no accessory).
   * `save` is read fresh each call, so a purchase or an equip re-renders it. */
  _repaintItem(kind, save) {
    const items = this._repaintItems(kind, save);
    if (!items.length) return null;
    const sel = this._repaintSelected?.[kind];
    return items.find((it) => it.id === sel) || items[0];
  }

  /** The colour a key currently stands at: the player's repaint wins, else the
   * item's own default — the same two-tier truth the rack swatches use. */
  _colorOf(item, key) {
    const row = item.colors[item.id];
    if (row && typeof row[key] === 'number') return row[key];
    return item.defaults(item.def)[key];
  }

  /** A wheel gesture: compute the picked hex, then live-apply it to the panel's
   * own DOM before the caller's `repaint` hook does the same to the rig. The
   * panel is found from the wheel itself, so either copy of the rack works. */
  _pickRepaint(kind, wheel, e) {
    const el = wheel.closest('.repaint');
    if (!el) return;
    const r = wheel.getBoundingClientRect();
    const size = r.width || 140;
    const R = size / 2 - 3;
    const dx = e.clientX - (r.left + size / 2);
    const dy = e.clientY - (r.top + size / 2);
    const hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / R);
    this._repaintHsv[kind] = { h: hue, s: sat };
    const slider = el.querySelector('[data-repaintbright]');
    const v = slider ? Number(slider.value) / 100 : 1;
    this._repaintLive(kind, hsvToHex(hue, sat, v), el);
  }

  /** Update a repaint panel in place while a gesture is live, without tearing
   * the wheel down — the same trick the Park Designer uses. The `repaint` hook
   * then rebuilds the rig, so the rider on screen changes as you drag. `el` is
   * the specific panel being dragged, whichever copy of the rack it lives in. */
  _repaintLive(kind, hex, el) {
    if (!el) return;
    const item = this._repaintItem(kind, this._save);
    if (!item) return;
    const key = this._repaintKey[kind];
    const chip = el.querySelector(`[data-repaintpart="${key}"] .repaint-chip`);
    const out = el.querySelector('[data-repainthex]');
    const brightOut = el.querySelector('[data-repaintbrightout]');
    const slider = el.querySelector('[data-repaintbright]');
    const wheel = el.querySelector('[data-repaintwheel]');
    const v = Math.round(hexToHsv(hex).v * 100);
    if (chip) chip.style.setProperty('--chip', hex);
    if (out) out.textContent = hex.toUpperCase();
    if (brightOut) brightOut.textContent = String(v);
    if (slider) slider.value = String(v);
    if (wheel) drawWheel(wheel, hex);
    this.on.repaint?.(kind, item.id, key, hex);
  }

  /**
   * Re-skin the tutorial's demo rider to match the one being skated. Without
   * this, picking Nova and then opening How to play shows Ace doing the tricks,
   * which reads as a bug the first time anyone notices it. `scale` is the
   * maker's height+width body, passed through so a made character's demo is
   * the same silhouette as the one on the start screen.
   */
  setPreviewLook(palette, style, scale) {
    this.preview?.skater.rebuild(palette, style, scale);
  }

  /**
   * The Riders screen: the prebuilt characters, with the made characters
   * leading the grid when any exist. It is a picker, not a shop, so a made
   * card is the player's own figure — drawn from that character's saved
   * draft — rather than a price.
   */
  renderCharSelect(characters, equippedId, customCharacters) {
    if (!this.csCharGrid) return;
    const cards = [];
    for (const c of customCharacters) {
      const isEquipped = equippedId === `custom:${c.id}`;
      cards.push(
        `<button type="button" class="char-card${isEquipped ? ' current' : ''}" data-character="custom:${c.id}">` +
        `<canvas class="char-portrait" data-portrait="custom:${c.id}"></canvas>` +
        `<b>${escapeHtml(c.name)}</b><span class="char-blurb">Built in the Character Maker.</span>` +
        `<span class="board-status">${isEquipped ? 'Skating' : 'Tap to pick'}</span></button>`
      );
    }
    cards.push(
      characters
        .map((c) => {
          const isEquipped = c.id === equippedId;
          return (
            `<button type="button" class="char-card${isEquipped ? ' current' : ''}" data-character="${c.id}">` +
            `<canvas class="char-portrait" data-portrait="${c.id}"></canvas>` +
            `<b>${c.name}</b><span class="char-blurb">${c.blurb}</span>` +
            `<span class="board-status">${isEquipped ? 'Skating' : 'Tap to pick'}</span></button>`
          );
        })
        .join('')
    );
    this.csCharGrid.innerHTML = cards.join('');
    for (const c of customCharacters) {
      const canvas = this.csCharGrid.querySelector(`[data-portrait="custom:${c.id}"]`);
      if (canvas) drawPortrait(canvas, customLook(c));
    }
    for (const c of characters) {
      const canvas = this.csCharGrid.querySelector(`[data-portrait="${c.id}"]`);
      if (canvas) drawPortrait(canvas, c);
    }
  }

  /**
   * The Character Maker's racks. One grid per role, drawn as small chips —
   * a body swatch over a name over a status — so a full wardrobe fits in a
   * column without scrolling forever. `config` is the draft being edited and
   * `save` answers every "do I own it" question, exactly as it does for the
   * shop's racks.
   */
  renderMaker(config, save) {
    if (this.makerCoinsEl) this.makerCoinsEl.textContent = save.coins.toLocaleString();
    if (this.makerSummaryEl) this.makerSummaryEl.textContent = summarize(config);
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    const status = (role, part, isCur, owned) => {
      if (role === 'skin' || role === 'height' || role === 'build' || role === 'hair') {
        return isCur ? 'Selected' : 'Free';
      }
      if (isCur) return 'Wearing';
      return owned ? 'Owned' : `${part.price} coins`;
    };
    // The body glyphs: a disc of skin, a bar whose height hints at the pick's,
    // three bars whose girth hints at the build's, and a circle for hair.
    const glyph = (part, role) => {
      if (role === 'skin') {
        return `<span class="maker-swatch maker-swatch--glyph skin"><i style="background:${hex(part.color)}"></i></span>`;
      }
      if (role === 'height') {
        const h = { short: '7px', average: '12px', tall: '17px' }[part.id] || '12px';
        return `<span class="maker-swatch maker-swatch--glyph"><i style="height:${h}"></i></span>`;
      }
      if (role === 'build') {
        const w = { slim: '3px', regular: '5px', stocky: '8px' }[part.id] || '5px';
        return `<span class="maker-swatch maker-swatch--glyph"><i style="width:${w}"></i><i style="width:${w}"></i><i style="width:${w}"></i></span>`;
      }
      return `<span class="maker-swatch maker-swatch--glyph"><b></b></span>`;
    };
    const swatch = (part, role) => {
      if (role === 'skin' || role === 'height' || role === 'build' || role === 'hair') return glyph(part, role);
      const col =
        role === 'pants'
          ? part.colors.pants
          : role === 'shoes'
            ? part.colors.shoe
            : role === 'shirt'
              ? part.colors.shirt
              : role === 'shades'
                ? part.colors
                  ? part.colors.shades
                  : null
                : part.colors
                  ? part.colors.cap
                  : null;
      return col !== null
        ? `<span class="maker-swatch" style="background:${hex(col)}"></span>`
        : `<span class="maker-swatch maker-swatch--empty"></span>`;
    };
    for (const [role, list] of MAKER_ROLES) {
      const grid = this.makerGrids[role];
      if (!grid) continue;
      grid.innerHTML = list
        .map((part) => {
          const isCur = config[role] === part.id;
          const owned = save.hasPart(role, part.id);
          const locked = !owned && save.coins < part.price;
          return (
            `<button type="button" class="maker-option${isCur ? ' current' : ''}${locked ? ' locked' : ''}" data-role="${role}" data-part="${part.id}">` +
            swatch(part, role) +
            `<span class="name">${part.name}</span><span class="status">${status(role, part, isCur, owned)}</span></button>`
          );
        })
        .join('');
    }
    // Never clobber the name field while the player is typing in it — the
    // render runs on every keystroke, and resetting .value here would fight
    // the field and make spaces and a fully-deleted field impossible.
    if (this.makerNameEl && document.activeElement !== this.makerNameEl) this.makerNameEl.value = config.name;

    // Saved characters: equip, re-open for editing, or delete. Each card shows
    // the figure from that character's own saved draft, so editing one never
    // repaints another, and the meta line summarises the build.
    if (this.makerSavedEl) {
      this.makerSavedEl.innerHTML = save.customCharacters.length
        ? save.customCharacters
            .map((c) => {
              const equipped = save.characterId === `custom:${c.id}`;
              return (
                `<div class="bm-saved-card maker-saved-card${equipped ? ' current' : ''}" data-makersaved="${c.id}">` +
                `<canvas class="char-portrait" data-maker-portrait="${c.id}"></canvas>` +
                `<b>${escapeHtml(c.name)}</b>` +
                `<span class="bm-saved-meta">${summarize(c)}</span>` +
                `<span class="bm-saved-actions">` +
                `<button type="button" data-makeraction="equip">${equipped ? 'On now' : 'Equip'}</button>` +
                `<button type="button" data-makeraction="edit">Edit</button>` +
                `<button type="button" class="bm-saved-del" data-makeraction="delete">Delete</button>` +
                `</span></div>`
              );
            })
            .join('')
        : `<p class="tag">No characters saved yet — build one and press Save &amp; skate.</p>`;
      for (const c of save.customCharacters) {
        const canvas = this.makerSavedEl.querySelector(`[data-maker-portrait="${c.id}"]`);
        if (canvas) drawPortrait(canvas, customLook(c));
      }
    }
  }

  /** Rebuilds every rack of the Board Maker from the working draft. Called on
   * every change, so the preview, the swatches and the options stay in step;
   * the racks are cheap to rebuild, the WebGL deck is not, so the deck just
   * gets a `.set(draft)` from main.js instead of being recreated here.
   * `face` is the face the racks are editing — 'top' or 'back' — and every
   * per-design rack (style, pattern colours, lettering, pixels, stickers)
   * reads that face's own design, so the two faces never share a stroke. */
  renderBoardMaker(config, save, selectedLayer = null, face = 'top') {
    const hex = colorHex;
    // The top of the deck is the draft itself; the back lives in draft.back.
    const faceDesign = face === 'back' && config.back ? config.back : config;
    if (this.bmCoinsEl) this.bmCoinsEl.textContent = save.coins.toLocaleString();
    // Never clobber the name field while the player is typing in it — the
    // render runs on every keystroke, and resetting .value here would fight
    // the field and make spaces and a fully-deleted field impossible.
    if (this.bmNameEl && document.activeElement !== this.bmNameEl) this.bmNameEl.value = config.name;
    if (this.bmSummaryEl) this.bmSummaryEl.textContent = summarizeDesign(config);

    // Saved boards: equip, re-open for editing, or delete. The card shows the
    // deck colour with a stripe of the accent, plus the one-line summary.
    if (this.bmSavedEl) {
      this.bmSavedEl.innerHTML = save.customBoards.length
        ? save.customBoards
            .map((b) => {
              const equipped = save.boardId === `custom:${b.id}`;
              return (
                `<div class="bm-saved-card${equipped ? ' current' : ''}" data-bmsaved="${b.id}">` +
                `<span class="bm-saved-swatch" style="background:${hex(b.colors.deck)};box-shadow:inset 0 0 0 4px ${hex(b.colors.accent)}"></span>` +
                `<b>${escapeHtml(b.name)}</b>` +
                `<span class="bm-saved-meta">${summarizeDesign(b)}</span>` +
                `<span class="bm-saved-actions">` +
                `<button type="button" data-bmaction="equip">${equipped ? 'On now' : 'Equip'}</button>` +
                `<button type="button" data-bmaction="edit">Edit</button>` +
                `<button type="button" class="bm-saved-del" data-bmaction="delete">Delete</button>` +
                `</span></div>`
              );
            })
            .join('')
        : `<p class="tag">No custom boards saved yet — build one and press Save.</p>`;
    }

    // Style rack. The chip swatch is a CSS gradient hint, not the real deck —
    // that lives in the preview. It shows the active face's style, so the same
    // rack edits whichever side the toggle is pointed at.
    if (this.bmStyleEl) {
      this.bmStyleEl.innerHTML = STYLES.map((s) => {
        const cur = faceDesign.style === s.id;
        const glyph = STYLE_SWATCH[s.id] || STYLE_SWATCH.plain;
        return (
          `<button type="button" class="maker-option${cur ? ' current' : ''}" data-bmstyle="${s.id}">` +
          `<span class="maker-swatch" style="background:${glyph}"></span>` +
          `<span class="name">${s.name}</span><span class="status">${cur ? 'On' : 'Pick'}</span></button>`
        );
      }).join('');
    }

    // Deck-type rack. The glyph is a bar whose length hints at the deck's.
    if (this.bmTypeEl) {
      this.bmTypeEl.innerHTML = TYPES.map((t) => {
        const cur = config.type === t.id;
        const w = Math.round(55 + ((t.shape.deckLen - 0.56) / (1.05 - 0.56)) * 40);
        return (
          `<button type="button" class="maker-option${cur ? ' current' : ''}" data-bmtype="${t.id}">` +
          `<span class="maker-swatch maker-swatch--glyph"><i style="width:${w}%;height:8px;border-radius:3px"></i></span>` +
          `<span class="name">${t.name}</span><span class="status">${cur ? 'On' : 'Pick'}</span></button>`
        );
      }).join('');
    }

    // The colour rack: one native colour input per role, labels from the
    // deck's own palette so a swap of deck type (a different shop deck, a
    // wider cruiser) still reads correctly.
    const colorRows = [
      ['deck', 'Deck'],
      ['grip', 'Grip'],
      ['accent', 'Stripe'],
      ['truck', 'Trucks'],
      ['wheel', 'Wheels'],
      ['bearing', 'Bearings'],
    ];
    if (this.bmColorsEl) {
      this.bmColorsEl.innerHTML = colorRows
        .map(
          ([k, label]) =>
            `<div class="bm-color-row"><label for="bmc-${k}">${label}</label>` +
            `<input type="color" id="bmc-${k}" data-bmcolor="${k}" value="${hex(config.colors[k])}"></div>`
        )
        .join('');
    }

    // The per-style options panel: the face toggle, pattern colours, block
    // lettering, the pixel editor, the sticker rack and the base-pattern
    // placement. Only the parts that apply to the active face's style.
    if (this.bmOptionsEl) {
      // Rebuilding this body on every keystroke would destroy the lettering
      // box while the player is typing in it — the field would lose focus
      // after the first character and every key after that would go to the
      // game instead. While the lettering box is focused, leave the body in
      // place (its value is already in the draft) and let the preview's own
      // redraw from main.js do the live update.
      const typingText = this.bmOptionsEl.querySelector('[data-bmtext]') === document.activeElement;
      let html = '';
      // The top/back switch: which face every rack below is editing. Each face
      // keeps its own complete design, so this just repoints the racks.
      html +=
        `<div class="bm-face-toggle">` +
        `<span class="bm-face-label">Designing</span>` +
        `<button type="button" class="bm-face-btn${face === 'top' ? ' on' : ''}" data-bmface="top">Top of deck</button>` +
        `<button type="button" class="bm-face-btn${face === 'back' ? ' on' : ''}" data-bmface="back">Back of deck</button>` +
        `</div>`;
      if (faceDesign.style !== 'plain') {
        html +=
          `<div class="bm-color-rows">` +
          `<div class="bm-color-row"><label for="bmc-sa">Pattern A</label><input type="color" id="bmc-sa" data-bmcolor="styleColor" value="${hex(faceDesign.styleColor)}"></div>` +
          `<div class="bm-color-row"><label for="bmc-sb">Pattern B</label><input type="color" id="bmc-sb" data-bmcolor="styleColor2" value="${hex(faceDesign.styleColor2)}"></div>` +
          `</div>`;
      }
      if (faceDesign.style === 'graffiti' || faceDesign.style === 'shop' || faceDesign.style === 'shield') {
        html +=
          `<div class="bm-text-field"><label for="bm-text">Block lettering</label>` +
          `<input type="text" id="bm-text" data-bmtext value="${escapeHtml(faceDesign.text)}" maxlength="12" spellcheck="false" placeholder="SKATE"></div>`;
      }
      if (faceDesign.style === 'blockart') {
        html +=
          `<div class="bm-pixel-wrap">` +
          `<canvas class="bm-pixel" data-bmpixel width="${BLOCKART_COLS * 16}" height="${BLOCKART_ROWS * 16}"></canvas>` +
          `<div class="bm-brushes">` +
          `<button type="button" class="bm-brush bm-brush--eraser${faceDesign.pixelBrush === 0 ? ' current' : ''}" data-bmbrush="0" title="Erase">⌫</button>` +
          PIXEL_PAINT.map(
            (c, i) =>
              `<button type="button" class="bm-brush${faceDesign.pixelBrush === i + 1 ? ' current' : ''}" data-bmbrush="${i + 1}" style="background:${hex(c)}" title="Paint"></button>`
          ).join('') +
          `</div></div>`;
      }
      html +=
        `<div class="bm-glow">` +
        `<div class="bm-glow-head">` +
        `<label for="bm-glow">Neon under glow</label>` +
        `<button type="button" class="bm-glow-toggle${config.underGlow != null ? ' on' : ''}" data-bmglowtoggle aria-pressed="${config.underGlow != null}">${config.underGlow != null ? 'On' : 'Off'}</button>` +
        `</div>` +
        `<div class="bm-glow-body">` +
        `<input type="color" id="bm-glow" class="bm-glow-color" data-bmglowcolor value="${hex(config.underGlow ?? 0x35ffe0)}"${config.underGlow != null ? '' : ' disabled'}>` +
        `<span class="bm-glow-hint">Pick a colour on the wheel — the deck glows neon underneath.</span>` +
        `</div>` +
        `</div>` +
        `<div class="bm-sticker-bar">` +
        `<span class="bm-sticker-label">Stickers — tap one to stick it on the deck</span>` +
        `<div class="bm-sticker-icons">` +
        ICON_LIST.map(
          (id) => `<button type="button" class="bm-sticker-btn" data-bmicon="${id}" title="${id}">${STICKER_GLYPH[id] || '✳'}</button>`
        ).join('') +
        `</div>` +
        (faceDesign.layers.length
          ? `<div class="bm-layers">` +
            faceDesign.layers
              .map(
                (l, i) =>
                  `<button type="button" class="bm-layer-chip${i === selectedLayer ? ' current' : ''}" data-bmlayer="${i}">${STICKER_GLYPH[l.icon] || '✳'} ${i + 1}</button>`
              )
              .join('') +
            `</div>`
          : '') +
        `</div>`;
      const layer = selectedLayer != null ? faceDesign.layers[selectedLayer] : null;
      if (layer) {
        html +=
          `<div class="bm-layer-inspector">` +
          `<label>Across<input type="range" data-bmlx="${selectedLayer}" min="-0.18" max="0.18" step="0.005" value="${layer.x}"></label>` +
          `<label>Along<input type="range" data-bmlz="${selectedLayer}" min="-0.3" max="0.3" step="0.005" value="${layer.z}"></label>` +
          `<label>Spin<input type="range" data-bmlr="${selectedLayer}" min="-180" max="180" step="5" value="${Math.round((layer.rot * 180) / Math.PI)}"></label>` +
          `<label>Size<input type="range" data-bmls="${selectedLayer}" min="0.5" max="2" step="0.05" value="${layer.scale}"></label>` +
          `<button type="button" class="bm-layer-del" data-bmldel="${selectedLayer}">Delete sticker</button>` +
          `</div>`;
      }
      // Move the whole base design, the way the sticker inspector moves a
      // single sticker. Only meaningful once there is a pattern to move.
      if (faceDesign.style !== 'plain') {
        html +=
          `<div class="bm-placement">` +
          `<span class="bm-placement-label">Move the design</span>` +
          `<label>Across<input type="range" data-bmpx min="-0.18" max="0.18" step="0.005" value="${faceDesign.px ?? 0}"></label>` +
          `<label>Along<input type="range" data-bmpz min="-0.3" max="0.3" step="0.005" value="${faceDesign.pz ?? 0}"></label>` +
          `<label>Spin<input type="range" data-bmpr min="-180" max="180" step="5" value="${Math.round(((faceDesign.prot ?? 0) * 180) / Math.PI)}"></label>` +
          `<label>Size<input type="range" data-bmps min="0.5" max="2" step="0.05" value="${faceDesign.pscale ?? 1}"></label>` +
          `</div>`;
      }
      if (!typingText) this.bmOptionsEl.innerHTML = html;
    }

    // Redraw the block-art grid (only exists when the block-art style is on).
    const pixel = this.bmOptionsEl?.querySelector('[data-bmpixel]');
    if (pixel) this.drawPixelGrid(pixel, faceDesign.pixels);
  }

  /** Paints the block-art grid into its canvas — a full redraw each time a
   * cell changes; the grid is small, so redrawing beats patching. */
  drawPixelGrid(canvas, pixels) {
    const g = canvas.getContext('2d');
    const cw = canvas.width / BLOCKART_COLS;
    const ch = canvas.height / BLOCKART_ROWS;
    for (let r = 0; r < BLOCKART_ROWS; r++) {
      for (let c = 0; c < BLOCKART_COLS; c++) {
        const idx = pixels && pixels[r] && pixels[r][c] ? pixels[r][c] : 0;
        g.fillStyle = idx ? colorHex(PIXEL_PALETTE[idx]) : '#12151b';
        g.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (let c = 0; c <= BLOCKART_COLS; c++) {
      g.beginPath();
      g.moveTo(c * cw, 0);
      g.lineTo(c * cw, canvas.height);
      g.stroke();
    }
    for (let r = 0; r <= BLOCKART_ROWS; r++) {
      g.beginPath();
      g.moveTo(0, r * ch);
      g.lineTo(canvas.width, r * ch);
      g.stroke();
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

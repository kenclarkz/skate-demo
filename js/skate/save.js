// Everything that outlives a session: the best combo, a lifetime trick count,
// the sound setting, and the coins, boards, outfits and accessories the store
// spends and sells.
//
// localStorage throws outright in iOS private browsing, so every access is
// wrapped. Losing a high score is bad; crashing the game over one is worse.

import { byId, DEFAULT_BOARD_ID } from './boards.js';
import { byId as outfitById, DEFAULT_OUTFIT_ID } from './outfits.js';
import { byId as accessoryById, DEFAULT_ACCESSORY_ID } from './accessories.js';
import { byId as charById, DEFAULT_CHARACTER_ID } from './characters.js';

const KEY = 'skate.save';

const DEFAULTS = {
  best: 0,
  bestTrick: 0,
  tricks: 0,
  bails: 0,
  bestAir: 0,
  logos: 0,
  coins: 0,
  boardId: DEFAULT_BOARD_ID,
  outfitId: DEFAULT_OUTFIT_ID,
  accessoryId: DEFAULT_ACCESSORY_ID,
  // Characters are picked, not bought — there is no `characters` owned-list to
  // go with this the way boards and outfits have one.
  characterId: DEFAULT_CHARACTER_ID,
  sound: true,
  seenGuide: false,
  park: 'home',
  lighting: 'day', // 'day' or 'night' — see js/skate/lighting.js
  speed: 16, // top speed, in m/s — see config.js's TOP_SPEED
  camZoom: 1, // chase camera distance, 0.5 (close) .. 1 (default) — see CAM_ZOOM
  musicVolume: 0.5, // 0..1, independent of the sound on/off toggle
  holdToPush: true, // holding the push key/thumb repeats pushes — see HOLD_TO_PUSH
  cameraMode: 'chase', // 'chase', 'first' or 'board' — see CAMERA_MODE
  radioPlaylistId: 'builtin', // the last station picked — see js/skate/radio.js
  radioVisible: true, // whether the in-game radio bar shows at all
  radioEnabled: true, // master switch for the whole Skate Radio — see js/skate/radio.js
};

// `boards`, `outfits` and `accessories` (which ones are owned) are arrays and
// so cannot live in DEFAULTS itself — spreading DEFAULTS only copies the
// reference, and the first purchase would then push onto (and permanently
// mutate) that shared default.
const freshBoards = () => [DEFAULT_BOARD_ID];
const freshOutfits = () => [DEFAULT_OUTFIT_ID];
const freshAccessories = () => [DEFAULT_ACCESSORY_ID];

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, boards: freshBoards(), outfits: freshOutfits(), accessories: freshAccessories() };
    const parsed = JSON.parse(raw);
    const s = {
      ...DEFAULTS,
      boards: freshBoards(),
      outfits: freshOutfits(),
      accessories: freshAccessories(),
      ...parsed,
    };
    // A hand-edited or half-written record must not be able to break the game.
    for (const k of ['best', 'bestTrick', 'tricks', 'bails', 'logos', 'coins']) {
      s[k] = Math.max(0, Math.floor(Number(s[k]) || 0));
    }
    s.bestAir = Math.max(0, Number(s.bestAir) || 0);
    s.sound = s.sound !== false;
    s.seenGuide = s.seenGuide === true;
    s.park = typeof s.park === 'string' ? s.park : 'home';
    s.lighting = s.lighting === 'night' ? 'night' : 'day';
    s.speed = Math.min(50, Math.max(8, Number(s.speed) || DEFAULTS.speed));
    s.camZoom = Math.min(1, Math.max(0.5, Number(s.camZoom) || DEFAULTS.camZoom));
    // Not the `|| DEFAULTS` shorthand the others use: 0 is a real, meaningful
    // volume (music off, sound effects still on) and `||` treats it as falsy,
    // which would silently bounce a saved "muted" back up to 0.5 on reload.
    const mv = Number(s.musicVolume);
    s.musicVolume = Number.isFinite(mv) ? Math.min(1, Math.max(0, mv)) : DEFAULTS.musicVolume;
    s.holdToPush = s.holdToPush !== false;
    s.cameraMode = s.cameraMode === 'first' || s.cameraMode === 'board' ? s.cameraMode : DEFAULTS.cameraMode;
    s.radioPlaylistId = typeof s.radioPlaylistId === 'string' ? s.radioPlaylistId : 'builtin';
    s.radioVisible = s.radioVisible !== false;
    s.radioEnabled = s.radioEnabled !== false;
    // The starter board and the starter outfit are always owned, whatever a
    // hand-edited save says.
    s.boards = Array.isArray(parsed.boards)
      ? [...new Set([DEFAULT_BOARD_ID, ...parsed.boards.filter((id) => byId[id])])]
      : freshBoards();
    s.boardId = typeof s.boardId === 'string' && s.boards.includes(s.boardId) ? s.boardId : DEFAULT_BOARD_ID;
    s.outfits = Array.isArray(parsed.outfits)
      ? [...new Set([DEFAULT_OUTFIT_ID, ...parsed.outfits.filter((id) => outfitById[id])])]
      : freshOutfits();
    s.outfitId =
      typeof s.outfitId === 'string' && s.outfits.includes(s.outfitId) ? s.outfitId : DEFAULT_OUTFIT_ID;
    s.accessories = Array.isArray(parsed.accessories)
      ? [...new Set([DEFAULT_ACCESSORY_ID, ...parsed.accessories.filter((id) => accessoryById[id])])]
      : freshAccessories();
    s.accessoryId =
      typeof s.accessoryId === 'string' && s.accessories.includes(s.accessoryId)
        ? s.accessoryId
        : DEFAULT_ACCESSORY_ID;
    s.characterId = typeof s.characterId === 'string' && charById[s.characterId] ? s.characterId : DEFAULT_CHARACTER_ID;
    return s;
  } catch {
    return { ...DEFAULTS, boards: freshBoards(), outfits: freshOutfits(), accessories: freshAccessories() };
  }
}

const state = read();

function flush() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* nothing to be done, and nothing worth telling the player about */
  }
}

export const save = {
  get best() {
    return state.best;
  },
  get bestTrick() {
    return state.bestTrick;
  },
  get tricks() {
    return state.tricks;
  },
  get bails() {
    return state.bails;
  },
  get bestAir() {
    return state.bestAir;
  },
  get logos() {
    return state.logos;
  },
  get coins() {
    return state.coins;
  },
  get boardId() {
    return state.boardId;
  },
  get boards() {
    return [...state.boards];
  },
  get outfitId() {
    return state.outfitId;
  },
  get outfits() {
    return [...state.outfits];
  },
  get accessoryId() {
    return state.accessoryId;
  },
  get accessories() {
    return [...state.accessories];
  },
  get characterId() {
    return state.characterId;
  },
  get sound() {
    return state.sound;
  },
  get seenGuide() {
    return state.seenGuide;
  },
  get park() {
    return state.park;
  },
  get lighting() {
    return state.lighting;
  },
  get speed() {
    return state.speed;
  },
  get camZoom() {
    return state.camZoom;
  },
  get musicVolume() {
    return state.musicVolume;
  },
  get holdToPush() {
    return state.holdToPush;
  },
  get radioPlaylistId() {
    return state.radioPlaylistId;
  },
  get radioVisible() {
    return state.radioVisible;
  },
  get radioEnabled() {
    return state.radioEnabled;
  },

  /** @returns true if this beat the previous best combo. */
  recordCombo(points) {
    const n = Math.floor(points);
    if (n <= state.best) return false;
    state.best = n;
    flush();
    return true;
  },

  recordTrick(points) {
    state.tricks++;
    if (points > state.bestTrick) state.bestTrick = Math.floor(points);
    flush();
  },

  recordBail() {
    state.bails++;
    flush();
  },

  recordAir(metres) {
    if (metres <= state.bestAir) return false;
    state.bestAir = Math.round(metres * 100) / 100;
    flush();
    return true;
  },

  recordLogo() {
    state.logos++;
    flush();
  },

  addCoins(n) {
    state.coins = Math.max(0, state.coins + Math.floor(n));
    flush();
  },

  /** @returns true if the purchase actually went through. */
  buyBoard(id) {
    const board = byId[id];
    if (!board || state.boards.includes(id) || state.coins < board.price) return false;
    state.coins -= board.price;
    state.boards.push(id);
    flush();
    return true;
  },

  /** @returns true if the board is owned and is now equipped. */
  setBoard(id) {
    if (!byId[id] || !state.boards.includes(id)) return false;
    state.boardId = id;
    flush();
    return true;
  },

  /** @returns true if the purchase actually went through. */
  buyOutfit(id) {
    const outfit = outfitById[id];
    if (!outfit || state.outfits.includes(id) || state.coins < outfit.price) return false;
    state.coins -= outfit.price;
    state.outfits.push(id);
    flush();
    return true;
  },

  /** @returns true if the outfit is owned and is now equipped. */
  setOutfit(id) {
    if (!outfitById[id] || !state.outfits.includes(id)) return false;
    state.outfitId = id;
    flush();
    return true;
  },

  /** @returns true if the purchase actually went through. */
  buyAccessory(id) {
    const accessory = accessoryById[id];
    if (!accessory || state.accessories.includes(id) || state.coins < accessory.price) return false;
    state.coins -= accessory.price;
    state.accessories.push(id);
    flush();
    return true;
  },

  /** @returns true if the accessory is owned and is now equipped. */
  setAccessory(id) {
    if (!accessoryById[id] || !state.accessories.includes(id)) return false;
    state.accessoryId = id;
    flush();
    return true;
  },

  /** @returns true if that is a real character and it is now equipped. */
  setCharacter(id) {
    if (!charById[id]) return false;
    state.characterId = id;
    flush();
    return true;
  },

  setPark(id) {
    state.park = id;
    flush();
  },

  setLighting(mode) {
    state.lighting = mode === 'night' ? 'night' : 'day';
    flush();
  },

  setSound(on) {
    state.sound = !!on;
    flush();
  },

  setSpeed(v) {
    state.speed = Math.min(50, Math.max(8, Number(v) || DEFAULTS.speed));
    flush();
  },

  setCamZoom(v) {
    state.camZoom = Math.min(1, Math.max(0.5, Number(v) || DEFAULTS.camZoom));
    flush();
  },

  /** Same 0-is-valid reasoning as the read() side: no `|| DEFAULTS` here. */
  setMusicVolume(v) {
    const n = Number(v);
    state.musicVolume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULTS.musicVolume;
    flush();
  },

  setHoldToPush(on) {
    state.holdToPush = !!on;
    flush();
  },

  setCameraMode(mode) {
    state.cameraMode = mode === 'first' || mode === 'board' ? mode : DEFAULTS.cameraMode;
    flush();
  },

  /** Remember which station the player last picked, so a reload lands on it. */
  setRadioPlaylistId(id) {
    state.radioPlaylistId = typeof id === 'string' ? id : 'builtin';
    flush();
  },

  /** Whether the in-game radio bar is shown. `false` hides it mid-run too. */
  setRadioVisible(on) {
    state.radioVisible = on !== false;
    flush();
  },

  /** Master switch for the whole Skate Radio. `false` stops Spotify and
   *  stands every radio control down — see js/skate/radio.js. */
  setRadioEnabled(on) {
    state.radioEnabled = on !== false;
    flush();
  },

  markGuideSeen() {
    state.seenGuide = true;
    flush();
  },

  reset() {
    Object.assign(state, DEFAULTS, {
      boards: freshBoards(),
      outfits: freshOutfits(),
      accessories: freshAccessories(),
    });
    flush();
  },
};

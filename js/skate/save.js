// Everything that outlives a session: the best combo, a lifetime trick count,
// the sound setting, and the coins, boards, outfits and accessories the store
// spends and sells.
//
// localStorage throws outright in iOS private browsing, so every access is
// wrapped. Losing a high score is bad; crashing the game over one is worse.

import { byId, DEFAULT_BOARD_ID } from './boards.js';
import { byId as outfitById, DEFAULT_OUTFIT_ID, colorKeys as outfitColorKeys } from './outfits.js';
import { byId as accessoryById, DEFAULT_ACCESSORY_ID, colorKeys as accessoryColorKeys } from './accessories.js';
import { byId as pantsCatalogById, DEFAULT_PANTS_ID, colorKeys as pantsColorKeys } from './pants.js';
import { byId as charById, DEFAULT_CHARACTER_ID } from './characters.js';
import { DEFAULT_CUSTOM, skinById, heightById, buildById, pantsById, shoeById, hairById, shirtById, hatById, shadeById, PART_BY_ID } from './custom.js';
import {
  DEFAULT_BOARD_DRAFT,
  STYLES,
  styleById,
  ICONS,
  PIXEL_PALETTE,
  BLOCKART_COLS,
  BLOCKART_ROWS,
  freshFaceDesign,
} from './board-design.js';
import { TYPES, typeById } from './boards.js';

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
  pantsId: DEFAULT_PANTS_ID,
  // Per-item repaints for the shop's colour wheels. Each map is keyed by the
  // bought item's id and holds a partial override of that item's own colour
  // keys — a hat holds cap/band, a shirt holds shirt/sleeve, pants hold
  // pants/pantsDark — so an owner can repaint a thing they bought without
  // touching any other item's colours.
  accessoryColors: {},
  outfitColors: {},
  pantsColors: {},
  // Characters are picked, not bought — there is no `characters` owned-list to
  // go with this the way boards and outfits have one.
  characterId: DEFAULT_CHARACTER_ID,
  // The Character Maker's draft: the part ids a made character is built from.
  // It lives here so half-finished edits survive a reload. `customSaved` is
  // what lets characterId be 'custom' — the maker's Save button is the only
  // thing that sets it, and without it the picker has no custom rider to show.
  custom: {},
  customSaved: false,
  // The Board Maker's working draft and its saved decks. `customBoards` is the
  // rack the shop and the maker's own saved-grid read; `boardMakerSaved` just
  // records that at least one custom board exists. A custom board's id in
  // boardId is 'custom:<id>', so it can never collide with the catalogue.
  customBoards: [],
  boardDraft: null,
  boardMakerSaved: false,
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
// mutate) that shared default. `custom` and the maker's per-part owned-lists
// are the same story.
const freshBoards = () => [DEFAULT_BOARD_ID];
const freshOutfits = () => [DEFAULT_OUTFIT_ID];
const freshAccessories = () => [DEFAULT_ACCESSORY_ID];
const freshPants = () => [DEFAULT_PANTS_ID];
const freshCustom = () => ({ ...DEFAULT_CUSTOM });
const freshCustomBoards = () => [];
const freshColorMap = () => ({});
const freshBoardDraft = () => ({
  ...DEFAULT_BOARD_DRAFT,
  colors: { ...DEFAULT_BOARD_DRAFT.colors },
  pixels: DEFAULT_BOARD_DRAFT.pixels.map((r) => [...r]),
  layers: [],
  back: freshFaceDesign(),
});
/** The palette keys a board draft carries; every one is a hex number. */
const PALETTE_KEYS = ['deck', 'grip', 'accent', 'ply', 'truck', 'wheel', 'bearing', 'bolt'];

/**
 * A per-item colour-customisation map, cleaned: only ids the player owns, only
 * colour keys the item actually paints, only integer hexes. `keysFor` answers
 * which keys an id owns, so the same pass works for accessories, outfits and
 * pants without each catalogue hand-writing its own loop.
 */
function cleanColorMap(raw, ownedIds, keysFor) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, colors] of Object.entries(raw)) {
    if (!ownedIds.includes(id) || !colors || typeof colors !== 'object') continue;
    const keys = keysFor(id);
    if (!keys || !keys.length) continue;
    const row = {};
    for (const k of keys) {
      const v = Number(colors[k]);
      if (Number.isInteger(v)) row[k] = (v >>> 0) & 0xffffff;
    }
    if (Object.keys(row).length) out[id] = row;
  }
  return out;
}

const outfitKeysFor = (id) => outfitColorKeys(outfitById[id]);
const pantsKeysFor = (id) => pantsColorKeys(pantsCatalogById[id]);
const accKeysFor = (id) => accessoryColorKeys(accessoryById[id]);

const clampNum = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
};

/**
 * The per-face design fields — style, colours, lettering, pixel art, sticker
 * layers and the base-pattern placement. Shared by the top of the deck (which
 * lives directly on the draft) and the back (draft.back), so a hand-edited
 * save cannot invent a style, a sticker icon or a placement on either face.
 */
function cleanFaceFields(raw, f = freshFaceDesign()) {
  if (!raw || typeof raw !== 'object') return f;
  if (typeof raw.style === 'string' && styleById[raw.style]) f.style = raw.style;
  if (typeof raw.text === 'string') f.text = raw.text.slice(0, 12);
  const sc = Number(raw.styleColor);
  if (Number.isInteger(sc)) f.styleColor = (sc >>> 0) & 0xffffff;
  const sc2 = Number(raw.styleColor2);
  if (Number.isInteger(sc2)) f.styleColor2 = (sc2 >>> 0) & 0xffffff;
  if (Array.isArray(raw.pixels)) {
    for (let r = 0; r < BLOCKART_ROWS; r++) {
      const row = raw.pixels[r];
      for (let c = 0; c < BLOCKART_COLS; c++) {
        const v = row && row[c];
        if (Number.isInteger(v)) {
          f.pixels[r][c] = Math.max(0, Math.min(PIXEL_PALETTE.length - 1, v));
        }
      }
    }
  }
  if (Number.isInteger(raw.pixelBrush)) {
    f.pixelBrush = Math.max(0, Math.min(PIXEL_PALETTE.length - 1, raw.pixelBrush));
  }
  if (Array.isArray(raw.layers)) {
    f.layers = raw.layers
      .filter((l) => l && typeof l.icon === 'string' && ICONS[l.icon])
      .map((l) => ({
        icon: l.icon,
        x: clampNum(l.x, -0.3, 0.3),
        z: clampNum(l.z, -0.4, 0.4),
        rot: clampNum(l.rot, -Math.PI, Math.PI),
        scale: clampNum(l.scale, 0.4, 2.5),
        color: Number.isInteger(Number(l.color)) ? (Number(l.color) >>> 0) & 0xffffff : f.styleColor,
      }));
  }
  f.px = clampNum(raw.px, -0.3, 0.3);
  f.pz = clampNum(raw.pz, -0.4, 0.4);
  f.prot = clampNum(raw.prot, -Math.PI * 2, Math.PI * 2);
  f.pscale = clampNum(raw.pscale, 0.4, 2.5);
  return f;
}

/**
 * Only ids and numbers the board maker knows about, and only for their own
 * slots — a hand-edited save must not be able to invent a style, a sticker
 * icon or a palette colour out of thin air.
 */
function cleanBoardDraft(raw) {
  const d = freshBoardDraft();
  if (!raw || typeof raw !== 'object') return d;
  if (typeof raw.name === 'string') d.name = raw.name.trim().slice(0, 40);
  if (typeof raw.type === 'string' && typeById[raw.type]) d.type = raw.type;
  if (raw.colors && typeof raw.colors === 'object') {
    for (const k of PALETTE_KEYS) {
      const v = Number(raw.colors[k]);
      if (Number.isInteger(v)) d.colors[k] = (v >>> 0) & 0xffffff;
    }
  }
  cleanFaceFields(raw, d);
  // Under glow is off (null) or a single hex colour.
  if (raw.underGlow == null) {
    d.underGlow = null;
  } else {
    const ug = Number(raw.underGlow);
    d.underGlow = Number.isInteger(ug) ? (ug >>> 0) & 0xffffff : null;
  }
  d.back = cleanFaceFields(raw.back);
  return d;
}
/** The maker's owned-clothes lists, seeded with each role's free default. */
const freshOwned = () => ({
  pants: [DEFAULT_CUSTOM.pants],
  shoes: [DEFAULT_CUSTOM.shoes],
  shirt: [DEFAULT_CUSTOM.shirt],
  hat: [DEFAULT_CUSTOM.hat],
  shades: [DEFAULT_CUSTOM.shades],
});
// Role names are the maker's own draft keys (config.shirt, config.hat, ...),
// so the maker's renderer can hand the same word to both the draft lookup and
// save.js and never translate between the two.
const OWNED_ROLES = ['pants', 'shoes', 'shirt', 'hat', 'shades'];

/** Only ids the maker knows about, and only for their own slots. */
function cleanCustom(raw) {
  const c = freshCustom();
  if (!raw || typeof raw !== 'object') return c;
  const slot = (key, byId) => (typeof raw[key] === 'string' && byId[raw[key]] ? raw[key] : c[key]);
  c.skin = slot('skin', skinById);
  c.height = slot('height', heightById);
  c.build = slot('build', buildById);
  c.hair = slot('hair', hairById);
  c.pants = slot('pants', pantsById);
  c.shoes = slot('shoes', shoeById);
  c.shirt = slot('shirt', shirtById);
  c.hat = slot('hat', hatById);
  c.shades = slot('shades', shadeById);
  return c;
}

/** The maker's owned-lists, cleaned so a hand-edited save cannot invent parts. */
function cleanOwned(raw) {
  const owned = freshOwned();
  if (!raw || typeof raw !== 'object') return owned;
  for (const role of OWNED_ROLES) {
    const list = raw[role];
    if (!Array.isArray(list)) continue;
    owned[role] = [...new Set([owned[role][0], ...list.filter((id) => PART_BY_ID[role][id])])];
  }
  return owned;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw)
      return {
        ...DEFAULTS,
        boards: freshBoards(),
        outfits: freshOutfits(),
        accessories: freshAccessories(),
        pants: freshPants(),
        custom: freshCustom(),
        owned: freshOwned(),
        customBoards: freshCustomBoards(),
        boardDraft: freshBoardDraft(),
        accessoryColors: freshColorMap(),
        outfitColors: freshColorMap(),
        pantsColors: freshColorMap(),
      };
    const parsed = JSON.parse(raw);
    const s = {
      ...DEFAULTS,
      boards: freshBoards(),
      outfits: freshOutfits(),
      accessories: freshAccessories(),
      pants: freshPants(),
      custom: freshCustom(),
      owned: freshOwned(),
      customBoards: freshCustomBoards(),
      boardDraft: freshBoardDraft(),
      accessoryColors: freshColorMap(),
      outfitColors: freshColorMap(),
      pantsColors: freshColorMap(),
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
    // boardId is checked *after* the custom boards are parsed, so a
    // 'custom:<id>' value can be matched against them — validated against the
    // catalogue only, an equipped made board would silently fall back to the
    // starter on every reload. Each saved board keeps its own id (or is given
    // one), so boardId can point at 'custom:<id>' without colliding with the
    // catalogue.
    s.customBoards = Array.isArray(parsed.customBoards)
      ? parsed.customBoards
          .map((raw, i) => {
            const b = cleanBoardDraft(raw);
            b.id =
              raw && typeof raw.id === 'string' && raw.id
                ? raw.id.slice(0, 40)
                : `b${Date.now().toString(36)}${i.toString(36)}`;
            return b;
          })
          .filter((b) => b.id)
      : freshCustomBoards();
    s.boardDraft = cleanBoardDraft(parsed.boardDraft);
    s.boardMakerSaved = parsed.boardMakerSaved === true;
    const customEquipped =
      typeof s.boardId === 'string' &&
      s.boardId.startsWith('custom:') &&
      s.customBoards.some((b) => b.id === s.boardId.slice(7));
    const catalogueEquipped = typeof s.boardId === 'string' && s.boards.includes(s.boardId);
    if (!customEquipped && !catalogueEquipped) s.boardId = DEFAULT_BOARD_ID;
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
    // Pants are their own slot: owned list, equipped id, and the repaints.
    s.pants = Array.isArray(parsed.pants)
      ? [...new Set([DEFAULT_PANTS_ID, ...parsed.pants.filter((id) => pantsCatalogById[id])])]
      : freshPants();
    s.pantsId = typeof s.pantsId === 'string' && s.pants.includes(s.pantsId) ? s.pantsId : DEFAULT_PANTS_ID;
    s.accessoryColors = cleanColorMap(parsed.accessoryColors, s.accessories, accKeysFor);
    s.outfitColors = cleanColorMap(parsed.outfitColors, s.outfits, outfitKeysFor);
    s.pantsColors = cleanColorMap(parsed.pantsColors, s.pants, pantsKeysFor);
    // The maker's draft is cleaned field by field, and the owned-lists only
    // hold ids the maker actually sells. 'custom' as a character choice is
    // only legitimate once the maker's Save has actually been pressed.
    s.custom = cleanCustom(parsed.custom);
    s.customSaved = parsed.customSaved === true;
    s.owned = cleanOwned(parsed.owned);
    if (s.characterId === 'custom' && !s.customSaved) s.characterId = DEFAULT_CHARACTER_ID;
    return s;
  } catch {
    return {
      ...DEFAULTS,
      boards: freshBoards(),
      outfits: freshOutfits(),
      accessories: freshAccessories(),
      pants: freshPants(),
      custom: freshCustom(),
      owned: freshOwned(),
      customBoards: freshCustomBoards(),
      boardDraft: freshBoardDraft(),
      accessoryColors: freshColorMap(),
      outfitColors: freshColorMap(),
      pantsColors: freshColorMap(),
    };
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
  get pantsId() {
    return state.pantsId;
  },
  get pants() {
    return [...state.pants];
  },
  /** The per-item repaints, as copies. */
  get accessoryColors() {
    return Object.fromEntries(Object.entries(state.accessoryColors).map(([id, c]) => [id, { ...c }]));
  },
  get outfitColors() {
    return Object.fromEntries(Object.entries(state.outfitColors).map(([id, c]) => [id, { ...c }]));
  },
  get pantsColors() {
    return Object.fromEntries(Object.entries(state.pantsColors).map(([id, c]) => [id, { ...c }]));
  },
  get characterId() {
    return state.characterId;
  },
  /** The maker's draft config, as a copy so callers cannot mutate state. */
  get custom() {
    return { ...state.custom };
  },
  get customSaved() {
    return state.customSaved;
  },
  /** The Board Maker's saved decks, as copies. */
  get customBoards() {
    return state.customBoards.map((b) => ({
      ...b,
      colors: { ...b.colors },
      pixels: b.pixels.map((r) => [...r]),
      layers: b.layers.map((l) => ({ ...l })),
      back: {
        ...b.back,
        pixels: b.back.pixels.map((r) => [...r]),
        layers: b.back.layers.map((l) => ({ ...l })),
      },
    }));
  },
  /** The Board Maker's working draft, as a fresh deep-ish copy. */
  get boardDraft() {
    return cleanBoardDraft(state.boardDraft);
  },
  get boardMakerSaved() {
    return state.boardMakerSaved;
  },
  /** @returns true if the given id is one of the player's saved custom boards. */
  hasCustomBoard(id) {
    return state.customBoards.some((b) => b.id === id);
  },
  /** The maker's owned-clothes lists, as copies. */
  get owned() {
    return Object.fromEntries(OWNED_ROLES.map((r) => [r, [...state.owned[r]]]));
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
  get cameraMode() {
    return state.cameraMode;
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

  /** @returns true if the purchase actually went through. */
  buyPants(id) {
    const pants = pantsCatalogById[id];
    if (!pants || state.pants.includes(id) || state.coins < pants.price) return false;
    state.coins -= pants.price;
    state.pants.push(id);
    flush();
    return true;
  },

  /** @returns true if the pants are owned and are now equipped. */
  setPants(id) {
    if (!pantsCatalogById[id] || !state.pants.includes(id)) return false;
    state.pantsId = id;
    flush();
    return true;
  },

  /** Repaint one colour key of a bought accessory (hat/shades/backpack). */
  setAccessoryColor(id, key, hex) {
    const a = accessoryById[id];
    if (!a || !state.accessories.includes(id)) return false;
    if (!accKeysFor(id).includes(key)) return false;
    const n = Number(hex);
    if (!Number.isInteger(n)) return false;
    state.accessoryColors[id] = { ...(state.accessoryColors[id] || {}), [key]: (n >>> 0) & 0xffffff };
    flush();
    return true;
  },

  /** Throw away the repaint on a bought accessory, back to its own colours. */
  resetAccessoryColors(id) {
    if (!accessoryById[id] || !state.accessories.includes(id)) return false;
    delete state.accessoryColors[id];
    flush();
    return true;
  },

  /** Repaint one colour key of a bought shirt. */
  setOutfitColor(id, key, hex) {
    const o = outfitById[id];
    if (!o || !o.shirt || !state.outfits.includes(id) || !outfitKeysFor(id).includes(key)) return false;
    const n = Number(hex);
    if (!Number.isInteger(n)) return false;
    state.outfitColors[id] = { ...(state.outfitColors[id] || {}), [key]: (n >>> 0) & 0xffffff };
    flush();
    return true;
  },

  /** Throw away the repaint on a bought shirt, back to its own colours. */
  resetOutfitColors(id) {
    if (!outfitById[id] || !state.outfits.includes(id)) return false;
    delete state.outfitColors[id];
    flush();
    return true;
  },

  /** Repaint one colour key of a bought pair of pants. */
  setPantsColor(id, key, hex) {
    const p = pantsCatalogById[id];
    if (!p || !state.pants.includes(id) || !pantsKeysFor(id).includes(key)) return false;
    const n = Number(hex);
    if (!Number.isInteger(n)) return false;
    state.pantsColors[id] = { ...(state.pantsColors[id] || {}), [key]: (n >>> 0) & 0xffffff };
    flush();
    return true;
  },

  /** Throw away the repaint on a bought pair of pants, back to its own colours. */
  resetPantsColors(id) {
    if (!pantsCatalogById[id] || !state.pants.includes(id)) return false;
    delete state.pantsColors[id];
    flush();
    return true;
  },

  /** @returns true if that is a real character and it is now equipped. */
  setCharacter(id) {
    if (!charById[id] && !(id === 'custom' && state.customSaved)) return false;
    state.characterId = id;
    flush();
    return true;
  },

  /** Store the maker's draft as it changes; a reload must not lose it. */
  setCustom(config) {
    state.custom = cleanCustom(config);
    flush();
  },

  /** The maker's Save: the draft becomes the custom character and is equipped. */
  saveCustom(config) {
    state.custom = cleanCustom(config);
    state.customSaved = true;
    state.characterId = 'custom';
    flush();
  },

  /** @returns true if the maker has ever saved a custom character. */
  hasCustom() {
    return state.customSaved;
  },

  /** Store the Board Maker's draft as it changes; a reload must not lose it. */
  setBoardDraft(draft) {
    state.boardDraft = cleanBoardDraft(draft);
    flush();
  },

  /**
   * Save the draft as a new custom board and equip it on the spot. A fresh id
   * each save — saving twice makes two decks, the way the character maker's
   * save makes one custom rider that gets overwritten. Editing a saved board
   * and saving again is meant to be "save a new one", not "overwrite mine".
   */
  saveCustomBoard(draft) {
    const d = cleanBoardDraft(draft);
    // The draft may legitimately have an empty name mid-edit; a saved deck
    // needs a label, so give it the default here — not while the player is
    // typing in the field.
    if (!d.name.trim()) d.name = 'My Board';
    const id = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const board = { id, ...d };
    state.customBoards.push(board);
    state.boardId = `custom:${id}`;
    state.boardMakerSaved = true;
    // The saved deck is on the rack now; the working draft goes back to a
    // fresh board so the next visit to the maker starts blank instead of
    // still holding the deck that was just saved — otherwise "make another
    // one" re-opens the last board and saving again just keeps the same deck.
    state.boardDraft = freshBoardDraft();
    flush();
    return id;
  },

  /** Overwrite an existing saved board with the draft, keeping its id. */
  updateCustomBoard(id, draft) {
    const i = state.customBoards.findIndex((b) => b.id === id);
    if (i === -1) return false;
    const d = cleanBoardDraft(draft);
    if (!d.name.trim()) d.name = 'My Board';
    state.customBoards[i] = { id, ...d };
    state.boardId = `custom:${id}`;
    state.boardMakerSaved = true;
    flush();
    return true;
  },

  /** @returns true if the custom board exists and is now equipped. */
  setCustomBoard(id) {
    if (!state.customBoards.some((b) => b.id === id)) return false;
    state.boardId = `custom:${id}`;
    flush();
    return true;
  },

  /** Remove a saved custom board; equipping falls back to the starter. */
  deleteCustomBoard(id) {
    state.customBoards = state.customBoards.filter((b) => b.id !== id);
    if (state.boardId === `custom:${id}`) state.boardId = DEFAULT_BOARD_ID;
    flush();
    return true;
  },

  /**
   * The maker's owned-lists. `role` is one of pants/shoes/shirts/hats/shades;
   * free parts are always treated as owned by the maker and never recorded
   * here, which is why only paid ones show up after their purchase.
   */
  ownedParts(role) {
    return state.owned[role] ? [...state.owned[role]] : [];
  },

  /** @returns true if the part is bought or priced nothing. */
  hasPart(role, id) {
    const by = PART_BY_ID[role];
    if (!by || !by[id]) return false;
    return !by[id].price || state.owned[role].includes(id);
  },

  /** @returns true if the purchase actually went through. */
  buyPart(role, id) {
    const by = PART_BY_ID[role];
    const part = by && by[id];
    if (!part || !part.price || state.owned[role].includes(id) || state.coins < part.price) return false;
    state.coins -= part.price;
    state.owned[role].push(id);
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
      pants: freshPants(),
      customBoards: freshCustomBoards(),
      boardDraft: freshBoardDraft(),
      accessoryColors: freshColorMap(),
      outfitColors: freshColorMap(),
      pantsColors: freshColorMap(),
    });
    flush();
  },
};

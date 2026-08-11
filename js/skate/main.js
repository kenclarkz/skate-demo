// Entry point: renderer, lights, the fixed-timestep loop, and the glue between
// the park, the ride model, the camera and the HUD.

import * as THREE from '../game/three.js';
import * as C from './config.js';
import { Park, ROUGH } from './park.js';
import { PARKS } from './parkLayouts.js';
import { ParkDesigner } from './parkDesigner.js';
import { newFile, buildDef } from './parkFile.js';
import { listFiles, removeFile } from './parkStorage.js';
import { Board } from './board.js';
import { Skater } from './skater.js';
import { Ride, GROUND, GRIND, AIR } from './physics.js';
import { Ragdoll } from './ragdoll.js';
import { Walker } from './walk.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { GestureTrail } from './trail.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { save } from './save.js';
import { BOARDS, TYPES as BOARD_TYPES, byId as boardById, typeById as boardTypeById } from './boards.js';
import { OUTFITS, byId as outfitById } from './outfits.js';
import { ACCESSORIES, byId as accessoryById } from './accessories.js';
import { CHARACTERS, byId as charById, lookOf, styleOf } from './characters.js';
import { customLook, heightById, buildById } from './custom.js';
import { designPalette, sanitizeText } from './board-design.js';
import { GRABS } from './tricks.js';
import { makeAiSkaters } from './ai.js';
import { makeBirds } from './bird.js';
import { makeLogos, checkPickup } from './collectible.js';
import { registerServiceWorker, setupInstall } from '../game/pwa.js';
import { LightingManager, DAY, NIGHT } from './lighting.js';
import { boot as bootRadio } from './radio.js';

const START = 'start';
const PLAYING = 'playing';
const PAUSED = 'paused';
const GUIDE = 'guide';
const PARKMENU = 'parks';
const MYPARKSMENU = 'myparks';
const STOREMENU = 'store';
const CHARSELECT = 'charselect';
const MAKER = 'maker';
const BOARDMAKER = 'boardmaker';
const SETTINGSMENU = 'settings';
const WALKING = 'walking';
const DESIGNER = 'designer';
const BAILED = 'bail';

const AI_COUNT = 13;
const BIRD_COUNT = 3;

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

// --- renderer -------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  stencil: false,
  powerPreference: 'high-performance',
});
// The concrete is a big flat mid-grey under a bright sky, which is exactly the
// case that clips to white without a filmic curve on the highlights.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(C.CAM_FOV, 1, C.CAMERA_NEAR, C.CAMERA_FAR);

// --- lighting ---------------------------------------------------------------
// Sky, fog, sun/moon, floodlights, street-lamp glow, signage and the distant
// skyline all live in one place — see lighting.js for why, and for how a
// future weather or sunset preset would slot in beside DAY and NIGHT.
const lighting = new LightingManager(scene, renderer);
lighting.setMode(save.lighting === NIGHT ? NIGHT : DAY, true);

// --- world ----------------------------------------------------------------
// The player's own parks, from localStorage. They ride alongside the built-in
// ones everywhere a park is chosen; `allParks()` is the single source for the
// combined picker, and `buildDef` turns a saved file into a real `Park` def.
let userParks = listFiles();
function allParks() {
  return [...PARKS, ...userParks.map((f) => buildDef(f))];
}

let park = new Park(allParks().find((p) => p.id === save.park) || PARKS[0]);
scene.add(park.group);
lighting.setPark(park);

const setup = boardSetup();
const board = new Board(setup.palette, setup.shape, setup.design);

/**
 * The palette, shape and (for a custom deck) design the currently equipped
 * board is built from. A 'custom:<id>' board resolves from the maker's saved
 * decks; anything else is straight from the catalogue.
 */
function boardSetup() {
  const id = save.boardId;
  if (typeof id === 'string' && id.startsWith('custom:')) {
    const draft = save.customBoards.find((b) => b.id === id.slice(7));
    if (draft) return { palette: designPalette(draft), shape: boardTypeById[draft.type]?.shape, design: draft };
  }
  const def = boardById[id];
  return { palette: def?.palette, shape: boardTypeById[def?.type]?.shape, design: null };
}

/** Rebuild the in-game board to match whatever save.boardId now points at. */
function applyBoard() {
  const setup = boardSetup();
  board.build(setup.palette, setup.shape, setup.design);
}

/**
 * The look the rig is built from. A made character is resolved straight from
 * the maker's draft — skin, height, build, clothes and all — instead of from
 * a character with an outfit painted over it, which is the whole point of the
 * Character Maker. Every path also carries `scale` (the height and width the
 * body is drawn at), so the caller can hand the same figure to the builder.
 */
function currentLook() {
  if (save.characterId === 'custom') {
    const c = save.custom;
    const look = customLook(c);
    return {
      ...look,
      character: { palette: look.palette },
      scale: { height: heightById[c.height].scale, width: buildById[c.build].width },
    };
  }
  const character = charById[save.characterId] ?? CHARACTERS[0];
  const outfit = outfitById[save.outfitId];
  const accessory = accessoryById[save.accessoryId];
  return {
    character,
    palette: lookOf(character, outfit, accessory),
    style: styleOf(character, accessory),
    scale: { height: 1, width: 1 },
  };
}

const startLook = currentLook();
const skater = new Skater(startLook.palette, { style: startLook.style, scale: startLook.scale });
const ride = new Ride(park, board, skater);
scene.add(ride.frame);

const ragdoll = new Ragdoll(park);
const chase = new ChaseCamera(camera, park);

// On foot: its own tiny model, and a stand-in shaped like `ride` so the same
// chase camera can follow either one without a second code path.
const walker = new Walker(park);
const walkRide = {
  bailed: false,
  pos: walker.pos,
  vel: new THREE.Vector3(),
  yaw: 0,
  grounded: true,
  speed: 0,
  groundSpeed: 0,
  airHeight: 0,
  up: new THREE.Vector3(0, 1, 0),
  lean: 0,
};

const { bots, group: socialGroup } = makeAiSkaters(park, scene, AI_COUNT);
for (const b of bots) scene.add(b.ride.frame);

// The one shadow map this scene affords is spent on riders, not the park —
// see LightingManager.setShadowCasters(). castShadow only actually turns on
// once night has faded in; this just collects who is eligible.
function collectMeshes(root, out = []) {
  root.traverse((o) => {
    if (o.isMesh) out.push(o);
  });
  return out;
}
lighting.setShadowCasters([
  ...collectMeshes(ride.frame),
  ...bots.flatMap((b) => collectMeshes(b.ride.frame)),
]);
park.mesh.receiveShadow = true;

const birds = makeBirds(BIRD_COUNT);
for (const b of birds) scene.add(b.group);

let logos = makeLogos(park);
let logosCollected = 0;

/** Release every geometry a group owns. Only ever called on a group that is
 * about to be dropped for good — the park being replaced by another one. */
function disposeGroup(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
}

/**
 * Swap the whole map out from under the player. The ride, the camera and the
 * ragdoll do not need rebuilding — they only ever read `.park` when they need
 * it, so handing them the new one is the entire hand-off. The AI tours a new
 * patrol loop, the logos are fresh, and the old park's geometry is freed
 * rather than left for the GC to eventually notice.
 */
function loadPark(def) {
  disposeGroup(park.group);
  scene.remove(park.group);
  park = new Park(def);
  scene.add(park.group);
  park.mesh.receiveShadow = true;
  ride.park = park;
  chase.park = park;
  ragdoll.park = park;
  walker.park = park;
  lighting.setPark(park);
  logos = makeLogos(park);
  logosCollected = 0;
  bots.forEach((b, i) => b.setPark(park, i));
  socialGroup.reset();
  save.setPark(def.id);
  hud.setCurrentPark(def.name);
}

/**
 * A soft blob, laid on the surface under the board.
 *
 * A real shadow map would cost a whole extra pass over the park for one small
 * object, and this carries the only information anybody needs from a shadow
 * here: where the board is, and how far above the ground it is. The gradient
 * matters — a hard-edged disc reads as a sticker rather than as a shadow.
 */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(20,24,30,0.85)');
  grad.addColorStop(0.55, 'rgba(20,24,30,0.45)');
  grad.addColorStop(1, 'rgba(20,24,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const shadowGeo = new THREE.PlaneGeometry(1.15, 1.15);
shadowGeo.rotateX(-Math.PI / 2);
const shadow = new THREE.Mesh(
  shadowGeo,
  new THREE.MeshBasicMaterial({
    map: shadowTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
);
shadow.renderOrder = 1;
scene.add(shadow);
const shadowSurf = { y: 0, nx: 0, ny: 1, nz: 0, kind: 0 };
const _sn = new THREE.Vector3();
const _sq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function updateShadow() {
  const s = park.sample(ride.pos.x, ride.pos.z, shadowSurf);
  const h = Math.max(0, ride.pos.y - s.y);
  shadow.position.set(ride.pos.x, s.y + 0.012, ride.pos.z);
  _sn.set(s.nx, s.ny, s.nz);
  _sq.setFromUnitVectors(UP, _sn);
  shadow.quaternion.copy(_sq);
  // Bigger and fainter with height, which is what sells an ollie's air.
  const spread = 1 + h * 0.5;
  shadow.scale.set(spread, 1, spread);
  shadow.material.opacity = Math.max(0, 0.85 * (1 - h / 3.4));
}

// --- systems --------------------------------------------------------------
const hud = new Hud();
if (DEBUG) hud.enableDebug();
// The park editor is a second scene on the same canvas. It stays dormant until
// the player opens My Parks — nothing about the play scene is touched while it
// is closed, and while it is open it is the only thing being rendered.
const designer = new ParkDesigner(renderer, camera);
const audio = new Audio(save.sound);
// The radio is an optional extra: it needs Spotify's provider, and a broken
// login must never take the game down, so a null back from bootRadio just
// means the in-game radio stays hidden.
const radio = bootRadio(save, audio);
const input = new Input(document.getElementById('app'));
const gestureTrail = new GestureTrail(document.getElementById('gesture-trail'));

let state = START;
let score = 0;           // banked this session
let frames = 0;
let worldTime = 0;       // unconditional clock, for birds and the logos' spin
let liveCombo = { names: [], points: 0 };

hud.setBest(save.best);
hud.setSound(save.sound);
hud.setSpeedValue(save.speed);
hud.setCamZoomValue(save.camZoom);
hud.setMusicVolumeValue(save.musicVolume);
hud.setHoldToPush(save.holdToPush);
hud.setCameraMode(save.cameraMode);
hud.setStats(save);
hud.setCurrentPark(park.name);
hud.setCoins(save.coins);
hud.setPreviewLook(startLook.palette, startLook.style, startLook.scale);
C.setTopSpeed(save.speed);
C.setCamZoom(save.camZoom);
C.setHoldToPush(save.holdToPush);
C.setCameraMode(save.cameraMode);
chase.setMode(save.cameraMode);
// audio.musicGain does not exist until the first unlock() — setMusicVolume()
// stores the number on the Audio instance regardless, and startMusic() reads
// it back when the track actually starts, so the saved level still applies to
// the very first playthrough rather than only from the second load onward.
audio.setMusicVolume(save.musicVolume);

// --- state changes --------------------------------------------------------
function respawn() {
  if (ragdoll.active) ragdoll.stop();
  if (skater.group.parent !== ride.frame) {
    // The rider and the board are put back under the frame they were taken
    // from, whether that was a bail or a walk off the board.
    ride.frame.add(skater.group);
    ride.frame.add(board.group);
    board.group.position.set(0, 0, 0);
    board.group.quaternion.identity();
    skater.settle();
  }
  ride.reset();
  chase.snap(ride);
  liveCombo = { names: [], points: 0 };
  hud.setCombo([], 0, 1);
  input.clear();
}

function startGame() {
  respawn();
  score = 0;
  hud.setScore(0);
  state = PLAYING;
  input.enabled = true;
  hud.hide();
}

function showStart() {
  state = START;
  input.enabled = false;
  audio.hush();
  hud.setStats(save);
  hud.show('start');
}

function showGuide() {
  state = GUIDE;
  input.enabled = false;
  save.markGuideSeen();
  hud.show('guide');
}

function showParks() {
  state = PARKMENU;
  input.enabled = false;
  hud.renderParks(allParks(), park.id);
  hud.setLightingMode(save.lighting);
  hud.show('parks');
}

function showMyParks() {
  state = MYPARKSMENU;
  input.enabled = false;
  hud.renderMyParks(userParks, park.id);
  hud.show('myparks');
}

/** The freshest saved copy of every user park, from storage. */
function refreshUserParks() {
  userParks = listFiles();
}

/**
 * Into the editor. The overlay is put away and the whole screen becomes the
 * design canvas; the editor owns rendering and input from here until Back or
 * Save & Test hands the screen back.
 */
function openDesigner(file) {
  designer.open(file);
  state = DESIGNER;
  input.enabled = false;
  hud.hide();
  hud.stats.hidden = true;
}

/** Persist the working file, then leave the editor. `file` is `designer.file`
 * after a save — the live working copy. */
function leaveDesigner() {
  designer.close();
  refreshUserParks();
  hud.stats.hidden = false;
}

function showStore() {
  state = STOREMENU;
  input.enabled = false;
  const look = currentLook();
  hud.renderCharacters(CHARACTERS, save.characterId);
  hud.renderBoards(BOARD_TYPES, BOARDS, save);
  hud.renderOutfits(OUTFITS, save, look.character.palette);
  hud.renderAccessories(ACCESSORIES, save, look);
  hud.show('store');
}

function showRiders() {
  state = CHARSELECT;
  input.enabled = false;
  hud.renderCharSelect(CHARACTERS, save.characterId, save.hasCustom(), save.custom);
  hud.show('charselect');
}

/** The maker's whole working state, in one place, so it cannot drift. */
function makeDraft() {
  return save.custom;
}

/** Re-render the maker and its turntable from the current draft. */
function renderMaker() {
  const c = makeDraft();
  hud.renderMaker(c, save);
  const look = customLook(c);
  hud.makerPreview?.setLook(
    look.palette,
    look.style,
    { height: heightById[c.height].scale, width: buildById[c.build].width }
  );
}

function showMaker() {
  state = MAKER;
  input.enabled = false;
  renderMaker();
  hud.show('maker');
}

/**
 * A part picked in the maker. Paid parts are bought the moment they are picked,
 * exactly like the shop's own buy-then-equip flow, and then they are owned for
 * ever — there is no own/equip split in the maker. A part that cannot be
 * afforded is simply not picked.
 */
function pickMakerPart(role, id) {
  const c = makeDraft();
  if (!save.hasPart(role, id) && !save.buyPart(role, id)) return;
  c[role] = id;
  save.setCustom(c);
  renderMaker();
}

/**
 * The maker's Save: the draft becomes the custom character and is equipped on
 * the spot. Re-saving an existing custom character just re-skins it in place —
 * it is one slot, not a collection, so there is no second price to pay for
 * going back to tweak it.
 */
function saveMadeCharacter() {
  save.saveCustom(makeDraft());
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  showStart();
}

// --- the Board Maker -------------------------------------------------------
/** Which sticker layer in the draft the inspector is pointed at. A draft's own
 * state, so it does not live in the draft itself (and so cannot be saved). */
let boardSelectedLayer = null;

/** The last colour the under-glow was set to, kept so toggling it back on
 * resumes the player's own pick instead of resetting to the default. */
let boardGlowColor = 0x35ffe0;

/** The Board Maker's whole working state, in one place, so it cannot drift. */
function boardDraft() {
  return save.boardDraft;
}

/** Re-render the Board Maker's racks and its turntable from the draft. An
 * optional `preview` board (a saved deck) is shown on the turntable instead of
 * the draft while the racks still describe the deck under construction — so
 * tapping a saved card answers "what does that look like?" without discarding
 * the work in progress. */
function renderBoardMaker(preview = null) {
  const d = boardDraft();
  hud.renderBoardMaker(d, save, boardSelectedLayer);
  const show = preview || d;
  hud.bmPreview?.setBoard(designPalette(show), boardTypeById[show.type]?.shape, show);
}

function showBoardMaker() {
  state = BOARDMAKER;
  input.enabled = false;
  renderBoardMaker();
  hud.show('boardmaker');
}

/** Mutate the draft, persist it, then re-render everything that reads it. */
function updateBoardDraft(mutate) {
  const d = boardDraft();
  mutate(d);
  save.setBoardDraft(d);
  renderBoardMaker();
}

function pickBoardStyle(id) {
  updateBoardDraft((d) => {
    d.style = id;
    boardSelectedLayer = null;
  });
}

function pickBoardType(id) {
  updateBoardDraft((d) => {
    d.type = id;
  });
}

function pickBoardColor(role, hex) {
  updateBoardDraft((d) => {
    const value = parseInt(hex.slice(1), 16);
    if (role === 'styleColor' || role === 'styleColor2') {
      d[role] = value;
    } else {
      d.colors[role] = value;
    }
  });
}

/** The under-glow's colour wheel: remember the pick and paint the deck with it. */
function pickBoardGlowColor(hex) {
  boardGlowColor = parseInt(hex.slice(1), 16);
  updateBoardDraft((d) => {
    d.underGlow = boardGlowColor;
  });
}

/** Flip the neon strip on and off; turning it on resumes the last pick. */
function toggleBoardGlow() {
  updateBoardDraft((d) => {
    d.underGlow = d.underGlow != null ? null : boardGlowColor;
  });
}

function setBoardName(name) {
  updateBoardDraft((d) => {
    // Keep the name exactly as typed — spaces, case, even empty. Cleaning
    // (trim, a default name) happens when the board is saved, not while the
    // player is still typing, or they can never delete the field or use a
    // space in the middle of a name.
    d.name = name.slice(0, 40);
  });
}

function setBoardText(text) {
  updateBoardDraft((d) => {
    d.text = sanitizeText(text);
  });
}

/** Paint one block-art cell with the current brush (brush 0 erases). */
function paintBoardPixel(row, col) {
  updateBoardDraft((d) => {
    if (!d.pixels[row]) d.pixels[row] = [];
    d.pixels[row][col] = d.pixelBrush;
  });
}

function pickBoardBrush(idx) {
  updateBoardDraft((d) => {
    d.pixelBrush = idx;
  });
}

function addBoardSticker(icon) {
  updateBoardDraft((d) => {
    d.layers.push({ icon, x: 0, z: 0, rot: 0, scale: 1 });
    boardSelectedLayer = d.layers.length - 1;
  });
}

function selectBoardLayer(i) {
  boardSelectedLayer = i;
  renderBoardMaker();
}

/** One knob of the selected sticker's inspector: position, spin, size. */
function changeBoardLayer(i, key, value) {
  updateBoardDraft((d) => {
    const l = d.layers[i];
    if (!l) return;
    l[key] = key === 'rot' ? (value * Math.PI) / 180 : value;
  });
}

function deleteBoardLayer(i) {
  updateBoardDraft((d) => {
    d.layers.splice(i, 1);
    boardSelectedLayer = d.layers.length ? Math.min(boardSelectedLayer ?? 0, d.layers.length - 1) : null;
  });
}

/** The maker's Save: the draft becomes a new saved board and is equipped. */
function saveMadeBoard() {
  const d = boardDraft();
  save.saveCustomBoard(d);
  applyBoard();
  boardSelectedLayer = null;
  showStart();
}

/** Equip, edit or delete one of the player's saved custom boards. */
function boardSavedAction(id, action) {
  if (action === 'delete') {
    save.deleteCustomBoard(id);
    applyBoard();
    renderBoardMaker();
  } else if (action === 'edit') {
    const b = save.customBoards.find((x) => x.id === id);
    if (b) {
      save.setBoardDraft({
        ...b,
        colors: { ...b.colors },
        pixels: b.pixels.map((r) => [...r]),
        layers: b.layers.map((l) => ({ ...l })),
      });
      boardSelectedLayer = null;
      renderBoardMaker();
    }
  } else if (save.setCustomBoard(id)) {
    applyBoard();
    // Put the just-equipped saved deck on the turntable so tapping a saved card
    // shows what it looks like; the working draft is left untouched.
    const b = save.customBoards.find((x) => x.id === id);
    renderBoardMaker(b);
  }
}

function showSettings() {
  state = SETTINGSMENU;
  input.enabled = false;
  hud.show('settings');
}

// Which on-foot-or-riding state to fall back into when a pause is lifted —
// pausing must not itself decide whether the player was walking or rolling.
let prePauseState = PLAYING;

function togglePause() {
  if (state === PLAYING || state === WALKING) {
    prePauseState = state;
    state = PAUSED;
    input.enabled = false;
    audio.hush();
    hud.show('paused');
  } else if (state === PAUSED) {
    state = prePauseState;
    input.enabled = true;
    hud.hide();
  }
}

hud.on.play = () => startGame();
hud.on.resume = () => togglePause();
hud.on.guide = () => showGuide();
hud.on.back = () => showStart();
hud.on.parks = () => showParks();
hud.on.selectPark = (id) => {
  const def = allParks().find((p) => p.id === id);
  if (def && def.id !== park.id) {
    loadPark(def);
    respawn();
  }
  showStart();
};
hud.on.myParks = () => showMyParks();
hud.on.newPark = () => openDesigner(newFile());
hud.on.editPark = (id) => {
  const file = userParks.find((f) => f.id === id);
  if (file) openDesigner(file);
};
hud.on.playPark = (id) => {
  const file = userParks.find((f) => f.id === id);
  if (!file) return;
  if (park.id !== id) {
    loadPark(buildDef(file));
    respawn();
  }
  startGame();
};
hud.on.deletePark = (id) => {
  removeFile(id);
  refreshUserParks();
  hud.renderMyParks(userParks, park.id);
};
// The editor's chrome calls back into the app: Back returns to My Parks with
// whatever was autosaved, Save & Test loads the park it just wrote and starts
// the run from a clear spawn.
designer.on.back = () => {
  leaveDesigner();
  showMyParks();
};
designer.on.test = () => {
  designer.save();
  const def = buildDef(designer.file);
  leaveDesigner();
  // Always rebuild: testing a park that is already loaded must still pick up
  // the edits made since it was last built — `park.id === def.id` alone is no
  // reason to keep the stale geometry up.
  loadPark(def);
  respawn();
  startGame();
};
hud.on.lighting = (mode) => {
  save.setLighting(mode);
  lighting.setMode(mode);
  hud.setLightingMode(mode);
};
hud.on.store = () => showStore();
hud.on.settings = () => showSettings();
hud.on.riders = () => showRiders();
hud.on.maker = () => showMaker();
hud.on.makePart = (role, id) => pickMakerPart(role, id);
hud.on.makeSave = () => saveMadeCharacter();
hud.on.boardMaker = () => showBoardMaker();
hud.on.bmStyle = (id) => pickBoardStyle(id);
hud.on.bmType = (id) => pickBoardType(id);
hud.on.bmColor = (role, hex) => pickBoardColor(role, hex);
hud.on.bmName = (name) => setBoardName(name);
hud.on.bmText = (text) => setBoardText(text);
hud.on.bmPixel = (row, col) => paintBoardPixel(row, col);
hud.on.bmBrush = (idx) => pickBoardBrush(idx);
hud.on.bmAddSticker = (icon) => addBoardSticker(icon);
hud.on.bmLayer = (i) => selectBoardLayer(i);
hud.on.bmLayerChange = (i, key, value) => changeBoardLayer(i, key, value);
hud.on.bmLayerDelete = (i) => deleteBoardLayer(i);
hud.on.bmGlowToggle = () => toggleBoardGlow();
hud.on.bmGlowColor = (hex) => pickBoardGlowColor(hex);
hud.on.bmSave = () => saveMadeBoard();
hud.on.bmSavedAction = (id, action) => boardSavedAction(id, action);
hud.on.pause = () => togglePause();
hud.on.board = (id) => selectBoard(id);
hud.on.outfit = (id) => selectOutfit(id);
hud.on.accessory = (id) => selectAccessory(id);
hud.on.character = (id) => selectCharacter(id);
hud.on.dismount = () => dismount();
hud.on.mount = () => mount();
hud.on.sit = () => walker.toggleSit();
hud.on.grabStart = (id) => input.beginGrab(id);
hud.on.grabEnd = (id) => input.endGrab(id);
// The radio's corner bar only exists mid-run: a menu name hides it, null
// (the overlay coming down) shows it. Opening Settings also refreshes the
// playlist list, since that is where a logged-in player goes to pick one.
if (radio) hud.on.screenChanged = (name) => radio.onScreen(name);
// A Spotify login redirect lands back on a fresh page load; the radio asks for
// the settings screen again so the freshly-loaded playlists are in front of
// the player instead of hidden behind a tap. Whatever screen the reload landed
// on — start, the guide, a menu — settings is where those playlists live.
document.addEventListener('radio:open-settings', () => {
  showSettings();
});

/** Buy the board if it is not owned yet, then equip it either way. */
function selectBoard(id) {
  const def = boardById[id];
  if (!def) return false;
  if (!save.boards.includes(id) && !save.buyBoard(id)) return false; // can't afford it
  save.setBoard(id);
  board.build(def.palette, boardTypeById[def.type].shape);
  hud.renderBoards(BOARD_TYPES, BOARDS, save);
  return true;
}

/** Buy the outfit if it is not owned yet, then wear it either way. */
function selectOutfit(id) {
  const def = outfitById[id];
  if (!def) return false;
  if (!save.outfits.includes(id) && !save.buyOutfit(id)) return false; // can't afford it
  save.setOutfit(id);
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  hud.renderOutfits(OUTFITS, save, look.character.palette);
  // The accessory portraits are drawn on the equipped rider, so a new shirt
  // repaints them just like it repaints the "Original" outfit swatch.
  hud.renderAccessories(ACCESSORIES, save, look);
  return true;
}

/**
 * Swap rider. Free — this is a picker, not a shop, so there is no owned-list
 * and nothing to afford. 'custom' is the made character, which resolves from
 * the maker's draft; the shirt stays as it was and re-applies over whichever
 * rider, which is why the rebuild goes through currentLook().
 */
function selectCharacter(id) {
  if (!save.setCharacter(id)) return false;
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  hud.renderCharacters(CHARACTERS, save.characterId);
  // The Riders screen carries the made character too, so it gets repainted
  // alongside the shop's rack when a pick happens there.
  hud.renderCharSelect(CHARACTERS, save.characterId, save.hasCustom(), save.custom);
  // The shirt rack sits under the skaters in the same screen, and its "Original"
  // swatch is whatever the equipped rider wears — so swapping rider has to
  // repaint that too, or the card goes on advertising the old one's colours.
  // The accessory portraits are drawn on the equipped rider as well, so they
  // get repainted for the same reason.
  hud.renderOutfits(OUTFITS, save, look.character.palette);
  hud.renderAccessories(ACCESSORIES, save, look);
  return true;
}

/** Buy the accessory if it is not owned yet, then wear it either way. */
function selectAccessory(id) {
  const def = accessoryById[id];
  if (!def) return false;
  if (!save.accessories.includes(id) && !save.buyAccessory(id)) return false; // can't afford it
  save.setAccessory(id);
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  hud.renderAccessories(ACCESSORIES, save, look);
  return true;
}
hud.on.sound = () => {
  save.setSound(!save.sound);
  audio.setEnabled(save.sound);
  hud.setSound(save.sound);
};
hud.on.speed = (v) => {
  save.setSpeed(v);
  C.setTopSpeed(v);
};
hud.on.camZoom = (v) => {
  save.setCamZoom(v);
  C.setCamZoom(v);
};
hud.on.musicVolume = (v) => {
  save.setMusicVolume(v);
  audio.setMusicVolume(v);
};
hud.on.holdToPush = () => {
  save.setHoldToPush(!save.holdToPush);
  C.setHoldToPush(save.holdToPush);
  hud.setHoldToPush(save.holdToPush);
};
// The settings button and the in-game camcycle button share this cycling. The
// next mode after board loops back to chase, which is the camera the game
// shipped with and the one the camera setting in the same menu describes.
const nextCameraMode = (mode) => (mode === 'chase' ? 'first' : mode === 'first' ? 'board' : 'chase');
const setCameraMode = (mode) => {
  save.setCameraMode(mode);
  C.setCameraMode(mode);
  chase.setMode(mode);
  hud.setCameraMode(mode);
};
hud.on.cameraMode = () => setCameraMode(nextCameraMode(save.cameraMode));
hud.on.camcycle = () => setCameraMode(nextCameraMode(save.cameraMode));
hud.on.reset = () => {
  save.reset();
  hud.setBest(save.best);
  hud.setStats(save);
  hud.setSound(save.sound);
  audio.setEnabled(save.sound);
  hud.setSpeedValue(save.speed);
  hud.setCamZoomValue(save.camZoom);
  hud.setMusicVolumeValue(save.musicVolume);
  audio.setMusicVolume(save.musicVolume);
  hud.setHoldToPush(save.holdToPush);
  C.setHoldToPush(save.holdToPush);
  hud.setCameraMode(save.cameraMode);
  C.setCameraMode(save.cameraMode);
  chase.setMode(save.cameraMode);
  hud.setCoins(save.coins);
  applyBoard();
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  C.setTopSpeed(save.speed);
  C.setCamZoom(save.camZoom);
  radio?.resetSettings();
};
input.onPause = () => {
  if (state === PLAYING || state === WALKING || state === PAUSED) togglePause();
};

// --- events from the ride model -------------------------------------------
/**
 * Everything the player hears and reads comes from here. The ride model raises
 * events and knows nothing about the HUD or the audio graph, which is what lets
 * the physics be tested on its own.
 */
function handleEvents(events) {
  for (const e of events) {
    switch (e.name) {
      case 'pop':
        audio.pop(e.height);
        break;
      case 'push':
        audio.push();
        break;
      case 'land':
        audio.land(e.impact);
        if (e.height > 0.4 && save.recordAir(e.height)) hud.say(`${e.height.toFixed(2)} m air`, 'small');
        break;
      case 'grindStart':
        audio.lock();
        break;
      case 'grabStart':
        audio.grab();
        break;
      case 'trick':
        hud.say(e.sketchy ? `${e.label} (sketchy)` : e.label, e.sketchy ? 'sketchy' : '');
        save.recordTrick(e.points);
        // A sketchy landing already pays less in points; it does not also
        // need to pay less in coins on top of that.
        save.addCoins(Math.max(1, Math.round(e.points / 25)));
        hud.setCoins(save.coins);
        liveCombo = { names: ride.combo.names.slice(), points: ride.combo.points };
        break;
      case 'combo': {
        score += e.total;
        hud.setScore(score);
        const best = save.recordCombo(e.total);
        hud.setBest(save.best);
        // The chain pays a bonus on top of what each trick already paid, so
        // stringing tricks together is worth more than landing them apart.
        const bonus = Math.round(e.total / 40);
        if (bonus > 0) {
          save.addCoins(bonus);
          hud.setCoins(save.coins);
        }
        if (e.multiplier > 1 || e.total > 400) {
          const coinText = bonus > 0 ? `  +${bonus}c` : '';
          hud.say(`${e.total.toLocaleString()}${coinText}${best ? '  new best' : ''}`, 'banked');
        }
        audio.chime(e.multiplier > 2);
        liveCombo = { names: [], points: 0 };
        break;
      }
      case 'comboLost':
        liveCombo = { names: [], points: 0 };
        break;
      case 'bail':
        audio.bail();
        save.recordBail();
        // Said now, while it is happening, rather than on the way back up — the
        // reason is only useful next to the mistake that caused it.
        hud.sayBail(e.reason);
        startBail();
        break;
    }
  }
}

// Which way they were facing when it went wrong, so getting up faces the same
// way rather than snapping to whatever the ragdoll's last tumble left behind.
let bailYaw = 0;
const _getUp = new THREE.Vector3();

/** Hand the rider and the board over to the ragdoll. */
function startBail() {
  // Both come out of the ride frame and into the world, because from here they
  // are two independent objects that happen to have been travelling together.
  bailYaw = ride.yaw;
  ragdoll.start(skater, ride.frame, ride.vel, ride.airYaw ? C.SPIN_RATE * Math.sign(ride.airYaw) : 0);
  scene.add(skater.group);
  scene.add(board.group);
  state = BAILED;
  input.enabled = false;
  hud.setBalance(false, 0, 1);
  hud.setCharge(0);
}

/**
 * Get up and carry on, from wherever the slam left them.
 *
 * Not respawn(): a slam ends a combo, not a run. The score stays, the park stays,
 * and the rider stands up where they came down rather than being teleported back
 * to the spawn — which is the whole difference between falling over and being
 * sent back to the start.
 *
 * Two details matter for it to look like standing up rather than a cut. The
 * position comes from the ragdoll's chest, read *before* stop() throws its points
 * away. And the camera is deliberately not snapped: respawn() does that because a
 * fresh spawn has no history to ease from, but here the lens is already looking
 * at the body on the floor, so letting the spring carry it up is what sells the
 * rider getting to their feet.
 */
function recover() {
  ragdoll.centre(_getUp);
  // A tumble can slide a long way, and off the edge of the world is not somewhere
  // to stand up. Same margin the walker keeps.
  const ex = park.extentX - 1;
  const ez = park.extentZ - 1;
  const x = Math.max(-ex, Math.min(ex, _getUp.x));
  const z = Math.max(-ez, Math.min(ez, _getUp.z));
  ragdoll.stop();

  ride.frame.add(skater.group);
  ride.frame.add(board.group);
  board.group.position.set(0, 0, 0);
  board.group.quaternion.identity();
  skater.settle();
  ride.reset({ x, z, yaw: bailYaw });

  liveCombo = { names: [], points: 0 };
  hud.setCombo([], 0, 1);
  input.clear();
  state = PLAYING;
  input.enabled = true;
}

// Scratch for the carried board's three defining points, and the bases they are
// built from. poseFree() wants points rather than a matrix, which suits this:
// three points can be crossfaded between "held at the hand" and "flat on the
// floor" by plain lerping, and the basis comes back out the other side rotated.
const _cNose = { p: new THREE.Vector3() };
const _cTail = { p: new THREE.Vector3() };
const _cSide = { p: new THREE.Vector3() };
const _cMid = new THREE.Vector3();
const _cFwd = new THREE.Vector3();
const _cRight = new THREE.Vector3();
const _cUp = new THREE.Vector3(0, 1, 0);
const _cLen = new THREE.Vector3();
const _cWide = new THREE.Vector3();
const _cFlat = new THREE.Vector3();
const _cTo = new THREE.Vector3();

/**
 * Put the board where the walking rider is holding it.
 *
 * Standing: tucked at the right side, deck vertical with the nose up, griptape
 * turned in towards the body so the wheels face out and clear the leg. Seated:
 * laid flat on the floor alongside. `walker.sit` eases between the two, and
 * because the three points are lerped rather than the finished transform, the
 * board rotates from upright to flat on the way down instead of sliding there.
 *
 * Must run after skater.poseWalk(), which is what puts the hand where this reads
 * it from.
 */
function poseCarriedBoard() {
  _cFwd.set(Math.sin(walker.yaw), 0, Math.cos(walker.yaw));
  _cRight.crossVectors(_cFwd, _cUp).normalize();

  // --- held: length axis just off vertical, tipped back a touch ------------
  _cLen.copy(_cUp).addScaledVector(_cFwd, -0.16).normalize();
  // The deck's own up (griptape side) faces the body; poseFree recovers it as
  // bz x bx, so the width axis has to be the one that makes that come out right.
  _cWide.copy(_cRight).negate().cross(_cLen).normalize();
  const hand = skater.joints.hand[1];
  _cMid.copy(hand).addScaledVector(_cUp, -0.1).addScaledVector(_cRight, 0.055);

  _cNose.p.copy(_cMid).addScaledVector(_cLen, C.DECK_LEN / 2);
  _cTail.p.copy(_cMid).addScaledVector(_cLen, -C.DECK_LEN / 2);
  _cSide.p.copy(_cMid).addScaledVector(_cWide, C.DECK_W / 2);

  // --- and where it goes once they sit down --------------------------------
  const sit = walker.sit;
  if (sit > 0.001) {
    _cFlat.copy(walker.pos).addScaledVector(_cRight, 0.5);
    _cFlat.y = park.heightAt(_cFlat.x, _cFlat.z) + C.WHEEL_R + C.TRUCK_H;
    _cNose.p.lerp(_cTo.copy(_cFlat).addScaledVector(_cFwd, C.DECK_LEN / 2), sit);
    _cTail.p.lerp(_cTo.copy(_cFlat).addScaledVector(_cFwd, -C.DECK_LEN / 2), sit);
    _cSide.p.lerp(_cTo.copy(_cFlat).addScaledVector(_cRight, -C.DECK_W / 2), sit);
  }

  board.poseFree(_cNose, _cTail, _cSide);
}

/** Step off the board, picking it up to carry rather than leaving it behind. */
function dismount() {
  if (state !== PLAYING || ride.mode !== GROUND) return;
  scene.add(board.group);
  scene.add(skater.group);
  skater.settle();
  walker.reset(ride.pos.x, ride.pos.z, ride.yaw);
  state = WALKING;
  // Pose once here rather than waiting for the next step, or the board spends a
  // frame still sat under the ride frame's old transform.
  skater.poseWalk(walker, 1 / 60);
  poseCarriedBoard();
}

/** Get back on, anywhere — the board is in hand, so there is nowhere to walk to. */
function mount() {
  if (state !== WALKING) return;
  scene.remove(board.group);
  scene.remove(skater.group);
  ride.frame.add(board.group);
  ride.frame.add(skater.group);
  board.group.position.set(0, 0, 0);
  board.group.quaternion.identity();
  skater.settle();
  ride.reset({ x: walker.pos.x, y: 0, z: walker.pos.z, yaw: walker.yaw });
  state = PLAYING;
}

// --- the step -------------------------------------------------------------
let bailWait = 0;

/**
 * A frame's worth of doing nothing.
 *
 * The loop reads input once per frame, before it works out how many fixed steps
 * that frame is worth — so a step that switches *into* PLAYING has no input read
 * for it. Getting up from a slam does exactly that: the frame started in the
 * ragdoll, so frameInput is null, and the next sub-step in the same frame would
 * hand the ride model nothing. Standing up with the controls neutral for one step
 * is also just correct — nobody is steering in the instant they get to their feet.
 */
const IDLE_INPUT = Object.freeze({
  steer: 0,
  charge: false,
  slide: false,
  push: false,
  brake: false,
  trick: null,
  trickCharge: undefined,
  grab: null,
});

function step(dt, frameInput) {
  // The park's own crowd keeps moving whatever the player is doing — paused at
  // the menu is exactly when a skatepark should still look alive.
  socialGroup.step(dt); // ticked once here, not once per bot that shares it
  for (const b of bots) b.step(dt);

  if (state === PLAYING) {
    handleEvents(ride.update(dt, frameInput || IDLE_INPUT));
    if (ride.combo.live) liveCombo = { names: ride.combo.names, points: ride.combo.points };
    const got = checkPickup(logos, ride.pos);
    if (got) {
      audio.collect();
      save.recordLogo();
      logosCollected++;
      hud.say('Logo found', 'small');
    }
  } else if (state === WALKING) {
    walker.update(dt, input.readMove());
    skater.poseWalk(walker, dt);
    poseCarriedBoard();
  } else if (state === BAILED) {
    ragdoll.step(dt);
    skater.poseRagdoll(ragdoll.named);
    const b = ragdoll.board.points;
    if (b.length === 3) board.poseFree(b[0], b[1], b[2]);
    bailWait += dt;
    // Wait for the body to stop moving, or for long enough that it clearly is not
    // going to, and then just get up. This used to stop the game and put a Slam
    // screen in the way, which turned every fall into a menu.
    if (bailWait > C.BAIL_SETTLE && (ragdoll.settled > 0.25 || bailWait > 4)) {
      recover();
    }
  } else if (
    state === PAUSED ||
    state === START ||
    state === GUIDE ||
    state === PARKMENU ||
    state === MYPARKSMENU ||
    state === STOREMENU ||
    state === SETTINGSMENU ||
    state === DESIGNER
  ) {
    // Nothing moves, but the camera still eases into place behind a fresh spawn.
  }

  if (state !== BAILED) bailWait = 0;
}

// --- render ---------------------------------------------------------------
// Set by the test hook's inspect(), so a screenshot can be framed by hand.
let cameraLocked = false;

function render(dt) {
  worldTime += dt;
  for (const b of birds) b.update(worldTime);
  for (const l of logos) l.update(dt, worldTime);
  if (!cameraLocked) {
    if (state === WALKING) {
      // A stand-in shaped like `ride`, so the chase camera needs no walking
      // code path of its own — just something that looks like what it reads.
      walkRide.yaw = walker.yaw;
      walkRide.speed = walker.speed;
      walkRide.groundSpeed = Math.abs(walker.speed);
      walkRide.vel.set(Math.sin(walker.yaw) * walker.speed, 0, Math.cos(walker.yaw) * walker.speed);
      chase.update(walkRide, null, dt);
    } else {
      chase.update(ride, ragdoll, dt);
    }
  }
  if (state !== BAILED) updateShadow();
  else shadow.material.opacity = Math.max(0, shadow.material.opacity - dt);
  lighting.update(dt, ride.pos);
  renderer.render(scene, camera);
}

function updateHud(dt) {
  hud.tick(dt);
  hud.setCoins(save.coins);
  const dismountReady = state === PLAYING && ride.mode === GROUND;
  // No distance test any more: the board is in the rider's hand, so getting back
  // on is always available the moment they are on foot.
  hud.setActionButtons({ dismount: dismountReady, mount: state === WALKING, sit: state === WALKING });
  // Grabs only mean anything in the air — showing the row the rest of the time
  // would just be five buttons that do nothing.
  hud.setGrabButtonsVisible(state === PLAYING && ride.mode === AIR);
  // Keyboard already has Escape/P for this — the button exists for mobile,
  // where a pause has no key to fall back on.
  hud.setPauseButtonVisible(state === PLAYING || state === WALKING);
  // The camera-cycle button has the same rhythm: pointless on menus, useful
  // the moment there is a camera to cycle.
  hud.setCamcycleVisible(state === PLAYING || state === WALKING);

  if (state === PLAYING) {
    hud.setSpeed(ride.groundSpeed);
    hud.setAir(ride.airHeight);
    hud.setCombo(liveCombo.names, liveCombo.points, Math.max(1, liveCombo.names.length));
    const balancing = !!ride.grind || ride.manual;
    hud.setBalance(balancing, ride.balance, C.BALANCE_LIMIT);
    hud.setCharge(input.flickActive || input.charging() ? ride.charge : 0);
    hud.setLogos(logosCollected, logos.length);
    audio.follow(
      ride.groundSpeed,
      ride.mode === GROUND,
      ride.mode === GRIND,
      ride.surf.kind === ROUGH,
      ride.sliding,
      ride.revertK
    );
  } else if (state === WALKING) {
    hud.setSpeed(Math.abs(walker.speed));
    hud.setAir(0);
    hud.setCombo([], 0, 1);
    hud.setBalance(false, 0, 1);
    hud.setCharge(0);
    audio.follow(0, false, false, false);
  } else {
    audio.follow(0, false, false, false);
  }
}

// --- adaptive resolution --------------------------------------------------
// devicePixelRatio is 3 on a phone, and 3× is nine times the fragment work of 1×.
// Start capped and step down, never up, so it cannot oscillate.
const DPR_STEPS = [1.75, 1.5, 1.25, 1];
let dprIdx = 0;
let frameAccum = 0;
let frameCount = 0;
let slowSeconds = 0;

function applyDpr() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprIdx]));
}

function trackFrameTime(ms) {
  frameAccum += ms;
  frameCount++;
  if (frameCount < 60) return;
  const avg = frameAccum / frameCount;
  frameAccum = 0;
  frameCount = 0;
  if (avg > 20 && dprIdx < DPR_STEPS.length - 1) {
    if (++slowSeconds >= 2) {
      dprIdx++;
      applyDpr();
      slowSeconds = 0;
    }
  } else slowSeconds = 0;
}

// --- resize ---------------------------------------------------------------
let resizeTimer = 0;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 100);
});
window.visualViewport?.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 100);
});

// Audio has to be created inside a gesture, and can be suspended again at any
// point, so every gesture routes here.
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === PLAYING || state === WALKING)) togglePause();
});

// The overlay swallows its own pointer events, so a tap on a button does not also
// count as a flick.
const overlayEl = document.getElementById('overlay');
overlayEl.style.pointerEvents = 'auto';
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
  overlayEl.addEventListener(type, (e) => e.stopPropagation());
}

// --- loop -----------------------------------------------------------------
let last = performance.now();
let acc = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const raw = (now - last) / 1000;
  last = now;
  // Clamped, so a backgrounded tab cannot teleport the skater across the park the
  // instant it comes back.
  const dt = Math.min(raw, C.MAX_FRAME_DT);
  acc += dt;

  const t0 = performance.now();
  // One input read per frame, not per step: a flick must fire once however many
  // simulation steps this frame turns into.
  const frameInput = state === PLAYING ? input.read() : null;
  let steps = 0;
  while (acc >= C.FIXED_DT && steps < 8) {
    step(C.FIXED_DT, frameInput);
    acc -= C.FIXED_DT;
    steps++;
  }
  if (steps === 8) acc = 0; // give up rather than fall further behind

  updateHud(dt);
  // While the editor is open it owns the whole canvas — the play scene is
  // neither stepped visually nor rendered, so a design session never has a
  // ghost of the park drifting behind it.
  if (designer.active) designer.tick(dt);
  else render(dt);
  hud.preview?.update(dt); // no-ops unless the guide screen actually asked for one
  hud.updateGestureDiagram(dt); // no-ops unless the current tutorial step has one
  gestureTrail.draw(input);
  frames++;
  trackFrameTime(performance.now() - t0);

  if (DEBUG) {
    const info = renderer.info.render;
    const modes = ['ground', 'air', 'grind', 'bail'];
    hud.setDebug(
      `${(1 / Math.max(raw, 1e-4)).toFixed(0)} fps  dpr ${renderer.getPixelRatio().toFixed(2)}  calls ${info.calls}\n` +
        `${modes[ride.mode]}  v ${ride.speed.toFixed(2)} m/s  side ${ride.side.toFixed(2)}\n` +
        `pos ${ride.pos.x.toFixed(1)} ${ride.pos.y.toFixed(2)} ${ride.pos.z.toFixed(1)}  yaw ${ride.yaw.toFixed(2)}\n` +
        `lean ${ride.lean.toFixed(2)}  charge ${ride.charge.toFixed(2)}  bal ${ride.balance.toFixed(2)}\n` +
        `air ${ride.airHeight.toFixed(2)} m  combo ${ride.combo.points}×${ride.combo.names.length}  park ${park.id}`
    );
  }
}

// --- boot -----------------------------------------------------------------
applyDpr();
resize();
respawn();
chase.snap(ride);
if (save.seenGuide) showStart();
else showGuide();
requestAnimationFrame(loop);

registerServiceWorker();
setupInstall(
  document.getElementById('install'),
  document.getElementById('ios-hint'),
  document.getElementById('ios-dismiss')
);

// Test hook for tools/skate-smoke.mjs. Exposes no more than the debug overlay
// already does, and drives the same code paths the player does.
window.__skate = {
  get state() {
    return state;
  },
  get score() {
    return score;
  },
  get frames() {
    return frames;
  },
  get park() {
    return park;
  },
  get logos() {
    return logos;
  },
  parks: PARKS,
  config: C,
  bots,
  socialGroup,
  birds,
  ride,
  board,
  boards: BOARDS,
  boardTypes: BOARD_TYPES,
  outfits: OUTFITS,
  accessories: ACCESSORIES,
  characters: CHARACTERS,
  grabs: GRABS,
  skater,
  ragdoll,
  walker,
  input,
  hud,
  audio,
  radio,
  save,
  chase,
  scene,
  camera,
  renderer,
  lighting,
  designer,
  get userParks() {
    return userParks;
  },
  allParks,
  showMyParks,
  openDesigner,
  showStart,
  start: startGame,
  respawn,
  selectBoard,
  selectOutfit,
  selectAccessory,
  selectCharacter,
  showStore,
  showRiders,
  showMaker,
  pickMakerPart,
  saveMadeCharacter,
  /** Step off the board, the way the on-screen button does. */
  dismount,
  /** Hop back on, the way the on-screen button does — possible from anywhere. */
  mount,
  /**
   * One walking step, exactly as the loop runs it: move the walker, solve the
   * on-foot pose, then place the board in the hand that pose just put there.
   * Assembling those three by hand in a test would let them drift out of the
   * order the real loop uses, which is the order the carry depends on.
   */
  walkStep(dt = 1 / 60, move = { x: 0, y: 1 }) {
    walker.update(dt, move);
    skater.poseWalk(walker, dt);
    poseCarriedBoard();
    return walker;
  },
  sit() {
    walker.toggleSit();
    return walker.sitting;
  },
  /** Load a different map by id, the way the park picker does. */
  switchPark(id) {
    const def = PARKS.find((p) => p.id === id);
    if (def) {
      loadPark(def);
      respawn();
    }
    return park;
  },
  /** Drive one simulation step with a synthetic input, for deterministic tests. */
  drive(dt, over = {}) {
    handleEvents(ride.update(dt, { ...IDLE_INPUT, ...over }));
    return ride;
  },
  /** Run the model for `seconds` with a fixed input, at the real step size. */
  hold(seconds, over = {}) {
    const n = Math.round(seconds / C.FIXED_DT);
    for (let i = 0; i < n; i++) this.drive(C.FIXED_DT, over);
    return ride;
  },
  /** Put the board somewhere, at a speed, pointing a way. */
  place(x, z, yaw = 0, speed = 0) {
    if (skater.group.parent !== ride.frame) {
      // A bail or a walk off the board leaves the rider and board posed loose
      // in the world; the cameras that attach to them read their world position
      // (head, deck), so "place the board somewhere" has to bring the whole rig
      // back under the frame the way respawn() does, or the lens goes looking
      // for bodies where the previous fall threw them.
      ride.frame.add(skater.group);
      ride.frame.add(board.group);
      board.group.position.set(0, 0, 0);
      board.group.quaternion.identity();
      skater.settle();
    }
    ride.reset({ x, y: 0, z, yaw });
    ride.speed = speed;
    // The velocity has to be set too, not just the rolling speed: it is what a
    // pop launches with and what a ragdoll is thrown by.
    ride.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    chase.snap(ride);
    return ride;
  },
  /**
   * Stop the loop from stepping the simulation, while still rendering.
   *
   * Without this a screenshot taken a few hundred milliseconds after posing the
   * skater would catch them mid-landing, because the game does not stop just
   * because a test stopped driving it.
   */
  freeze() {
    state = PAUSED;
    hud.hide();
    // Put the camera on its mark immediately: the chase spring needs a couple of
    // dozen frames to settle, and a headless renderer does not have them.
    chase.snap(ride);
  },
  unfreeze() {
    state = PLAYING;
    cameraLocked = false;
    // Input is switched off by a slam and switched back on when the rider gets
    // up, so resuming from a test has to do that itself.
    input.enabled = true;
    hud.hide();
  },
  /** Park the camera by hand, relative to the board, for close-up captures. */
  inspect(dx, dy, dz, lookAt = 0.85) {
    cameraLocked = true;
    camera.position.set(ride.pos.x + dx, ride.pos.y + dy, ride.pos.z + dz);
    camera.up.set(0, 1, 0);
    camera.lookAt(ride.pos.x, ride.pos.y + lookAt, ride.pos.z);
    camera.fov = 40;
    camera.updateProjectionMatrix();
  },
  /** Slam on demand, through the same path a refused landing takes. */
  slam(reason = 'slide-out') {
    ride.bail(reason);
    audio.bail();
    startBail();
    return ride;
  },
};

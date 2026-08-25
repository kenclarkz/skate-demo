// Entry point: renderer, lights, the fixed-timestep loop, and the glue between
// the park, the ride model, the camera and the HUD.

import * as THREE from '../game/three.js';
import * as C from './config.js';
import { Park, ROUGH } from './park.js';
import { PARKS } from './parkLayouts.js';
import { CITY, CITY_SPOTS, CITY_ROUTES } from './cityLayout.js';
import { CityManager, CITY_CHALLENGE_COINS } from './city.js';
import { ParkDesigner } from './parkDesigner.js';
import { newFile, buildDef } from './parkFile.js';
import { listFiles, removeFile } from './parkStorage.js';
import { Board } from './board.js';
import { Skater } from './skater.js';
import { Ride, GROUND, GRIND, AIR } from './physics.js';
import { Ragdoll, setRagdollIterations } from './ragdoll.js';
import { Walker } from './walk.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { GestureTrail } from './trail.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { save } from './save.js';
import { TYPES as BOARD_TYPES, byId as boardById, typeById as boardTypeById } from './boards.js';
import { OUTFITS, byId as outfitById } from './outfits.js';
import { ACCESSORIES, byId as accessoryById } from './accessories.js';
import { PANTS, byId as pantsById } from './pants.js';
import { CHARACTERS, byId as charById, lookOf, styleOf } from './characters.js';
import { customLook, heightById, buildById } from './custom.js';
import { designPalette, sanitizeText } from './board-design.js';
import { GRABS } from './tricks.js';
import { makeAiSkaters, assignBossCrowd } from './ai.js';
import { bossLadder, BossSkater, bossRequirement, FINALE_PARK_ID } from './boss.js';
import { makeBirds } from './bird.js';
import { makeLogos, checkPickup } from './collectible.js';
import { registerServiceWorker, setupInstall } from '../game/pwa.js';
import { LightingManager, DAY, NIGHT, SUNSET } from './lighting.js';
import { boot as bootRadio } from './radio.js';

const START = 'start';
const PLAYING = 'playing';
const PAUSED = 'paused';
const GUIDE = 'guide';
const PARKMENU = 'parks';
const STOREMENU = 'store';
const CHARSELECT = 'charselect';
const MAKER = 'maker';
const BOARDMAKER = 'boardmaker';
const SETTINGSMENU = 'settings';
const WALKING = 'walking';
const DESIGNER = 'designer';
const BAILED = 'bail';
// The rival states: a rival skates its own lines with the camera following it
// (BOSSCUT), a two-minute head-to-head where both skaters ride at once
// (CHALLENGE), and the result screen a duel ends on (BOSSRESULT).
const BOSSCUT = 'bosscut';
const CHALLENGE = 'challenge';
const BOSSRESULT = 'bossresult';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

// --- device capability detection -------------------------------------------
// iPad 7th gen (A10 Fusion, 3 GB RAM, DPR 2) and similar low-end tablets/
// phones get a lighter render path: smaller shadow maps, fewer AI skaters,
// lower physics rate and a lower starting DPR so the frame budget has room.
const _isLowEnd = (() => {
  const dpr = window.devicePixelRatio || 1;
  const ua = navigator.userAgent || '';
  const cores = navigator.hardwareConcurrency || 8;
  // Heuristic: old iPad/iPhone (A10 or earlier), low-DPR screens, or very few
  // cores.  iPad 7th gen is DPR 2 + 4 cores + iPad UA string.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return (isIOS && cores <= 4) || (dpr <= 2 && cores <= 4);
})();

const AI_COUNT = _isLowEnd ? 10 : 20;
const CROWD_SKATER_COUNT = _isLowEnd ? 300 : 980; // simplified skaters positioned along routes for the 1000 total
const BIRD_COUNT = _isLowEnd ? 1 : 3;
if (_isLowEnd) C.setFixedDt(1 / 60);
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
renderer.toneMapping = _isLowEnd ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !_isLowEnd;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(C.CAM_FOV, 1, C.CAMERA_NEAR, C.CAMERA_FAR);

// --- lighting ---------------------------------------------------------------
// Sky, fog, sun/moon, floodlights, street-lamp glow, signage and the distant
// skyline all live in one place — see lighting.js for why, and for how a
// future weather or sunset preset would slot in beside DAY and NIGHT.
const lighting = new LightingManager(scene, renderer, _isLowEnd);
lighting.setMode([DAY, NIGHT, SUNSET].includes(save.lighting) ? save.lighting : DAY, true);

// --- world ----------------------------------------------------------------
// The player's own parks, from localStorage. They ride alongside the built-in
// ones everywhere a park is loaded — a saved file becomes a real `Park` def
// through `buildDef`, and `allParks()` is the single source for the combined
// lookup (selecting one, resuming the saved one).
let userParks = listFiles();
function allParks() {
  return [...PARKS, CITY, ...userParks.map((f) => buildDef(f))];
}

/**
 * The park the game boots into. The saved park wins when it is unlocked — or
 * when it is a player-built park, which are never gated by progression; a
 * saved pick pointing at a locked built-in park falls back to the first
 * unlocked one so nobody can boot straight past the ladder.
 */
function initialParkDef() {
  const saved = allParks().find((p) => p.id === save.park);
  if (saved && (save.isParkUnlocked(saved.id) || !PARKS.some((p) => p.id === saved.id))) return saved;
  return PARKS.find((p) => save.isParkUnlocked(p.id)) || PARKS[0];
}

let park = new Park(initialParkDef());
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
  return { palette: def?.palette, shape: def?.shape, design: null };
}

/** Rebuild the in-game board to match whatever save.boardId now points at. */
function applyBoard() {
  const setup = boardSetup();
  board.build(setup.palette, setup.shape, setup.design);
}

/**
 * The accessories currently worn: one item per category slot — hat, shades,
 * pack — so up to three different kinds ride at once and two of the same never
 * can. "Original" slots resolve to nothing. `ids` is the three slots to read —
 * default the shop's global ones, but a made rider hands over its own.
 */
function equippedAccessories(ids = save.accessoryIds) {
  return ['hat', 'shades', 'pack']
    .map((c) => accessoryById[ids[c]])
    .filter((a) => a && a.category !== 'none');
}

/**
 * The look the rig is built from. A made character is resolved straight from
 * the maker's draft — skin, height, build, clothes and all — instead of from
 * a character with an outfit painted over it, which is the whole point of the
 * Character Maker. Every path also carries `scale` (the height and width the
 * body is drawn at), so the caller can hand the same figure to the builder.
 */
function currentLook() {
  if (save.characterId.startsWith('custom:')) {
    const c = save.customCharacters.find((x) => x.id === save.characterId.slice(7)) ?? save.custom;
    const base = customLook(c);
    // A made rider's bought accessories live on the character, not in the
    // shop's global slots — paint the ones this rider wears over the base,
    // exactly as lookOf() paints them over a prebuilt character.
    const accessories = equippedAccessories(c.accessoryIds);
    const character = { palette: base.palette, style: base.style };
    return {
      palette: lookOf(character, null, accessories, null, { accessory: save.accessoryColors }),
      style: styleOf(character, accessories),
      character,
      scale: { height: heightById[c.height].scale, width: buildById[c.build].width },
    };
  }
  const character = charById[save.characterId] ?? CHARACTERS[0];
  const outfit = outfitById[save.outfitId];
  const accessories = equippedAccessories();
  const pants = pantsById[save.pantsId];
  return {
    character,
    palette: lookOf(character, outfit, accessories, pants, {
      accessory: save.accessoryColors,
      outfit: save.outfitColors,
      pants: save.pantsColors,
    }),
    style: styleOf(character, accessories),
    scale: { height: 1, width: 1 },
  };
}

const startLook = currentLook();
const skater = new Skater(startLook.palette, { style: startLook.style, scale: startLook.scale });
const ride = new Ride(park, board, skater);
scene.add(ride.frame);

const ragdoll = new Ragdoll(park);
if (_isLowEnd) setRagdollIterations(4);
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
// once night has faded in; this just collects who is eligible. Kept as an
// array (not a throwaway literal) so a rival's meshes can join the list the
// moment one steps out, and the night pass picks them up without a rebuild.
function collectMeshes(root, out = []) {
  root.traverse((o) => {
    if (o.isMesh) out.push(o);
  });
  return out;
}
const shadowCasters = [
  ...collectMeshes(ride.frame),
  ...bots.flatMap((b) => collectMeshes(b.ride.frame)),
];
lighting.setShadowCasters(shadowCasters);
park.mesh.receiveShadow = true;

const birds = makeBirds(BIRD_COUNT);
for (const b of birds) scene.add(b.group);

// --- crowd skaters -----------------------------------------------------------
// Simplified skaters (no full physics rig) positioned along city routes to
// create the 1000-skater open-world feel. Uses InstancedMesh for performance:
// each skater is a simple cylinder "body" with a sphere "head", animated along
// the same street routes the traffic uses, bobbing gently to suggest pushing.
let crowdSkaters = null;
const CROWD_COLORS = [
  0xc65b4a, 0x3f7fb0, 0x5aa15c, 0xcf9c3e, 0x8a5ac6, 0x3fb8b0, 0xd65a9a,
  0xe76f51, 0x457b9d, 0x6a4c93, 0xf77f00, 0x2a9d8f, 0xe63946, 0xf4a261,
];
function buildCrowdSkaters() {
  if (park.id !== 'city') return;
  const geoBody = new THREE.CylinderGeometry(0.25, 0.25, 1.4, 6);
  const geoHead = new THREE.SphereGeometry(0.18, 6, 4);
  const routeCount = CITY_ROUTES.length;
  const positions = [];
  for (let i = 0; i < CROWD_SKATER_COUNT; i++) {
    const route = CITY_ROUTES[i % routeCount];
    let routeLen = 0;
    for (let k = 0; k < route.length - 1; k++) {
      routeLen += Math.hypot(route[k + 1].x - route[k].x, route[k + 1].z - route[k].z);
    }
    positions.push({ route, dist: (i / CROWD_SKATER_COUNT) * routeLen, speed: 1.8 + Math.random() * 1.4 });
  }
  // One InstancedMesh body+head pair per colour keeps draw calls low.
  const buckets = [];
  for (let i = 0; i < CROWD_COLORS.length; i++) buckets.push({ col: CROWD_COLORS[i], items: [] });
  for (let i = 0; i < positions.length; i++) {
    buckets[i % buckets.length].items.push(positions[i]);
  }
  const meshPairs = [];
  const dummy = new THREE.Object3D();
  for (const b of buckets) {
    if (!b.items.length) continue;
    const bodyMat = new THREE.MeshLambertMaterial({ color: b.col });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 });
    const bodyMesh = new THREE.InstancedMesh(geoBody, bodyMat, b.items.length);
    const headMesh = new THREE.InstancedMesh(geoHead, headMat, b.items.length);
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bodyMesh.frustumCulled = false;
    headMesh.frustumCulled = false;
    for (let j = 0; j < b.items.length; j++) {
      dummy.position.set(0, -100, 0);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(j, dummy.matrix);
      headMesh.setMatrixAt(j, dummy.matrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    scene.add(bodyMesh);
    scene.add(headMesh);
    meshPairs.push({ body: bodyMesh, head: headMesh, items: b.items });
  }
  crowdSkaters = { meshPairs, positions };
}
function stepCrowdSkaters(dt, worldTime) {
  if (!crowdSkaters || park.id !== 'city') return;
  const dummy = new THREE.Object3D();
  const routeLens = new Map();
  const getRouteLen = (route) => {
    if (routeLens.has(route)) return routeLens.get(route);
    let len = 0;
    for (let k = 0; k < route.length - 1; k++) {
      len += Math.hypot(route[k + 1].x - route[k].x, route[k + 1].z - route[k].z);
    }
    routeLens.set(route, len);
    return len;
  };
  for (const bucket of crowdSkaters.meshPairs) {
    let idx = 0;
    for (const pos of bucket.items) {
      const len = getRouteLen(pos.route);
      pos.dist = (pos.dist + pos.speed * dt) % len;
      let rem = pos.dist;
      let x = pos.route[0].x, z = pos.route[0].z, a = 0;
      for (let k = 0; k < pos.route.length - 1; k++) {
        const dx = pos.route[k + 1].x - pos.route[k].x;
        const dz = pos.route[k + 1].z - pos.route[k].z;
        const seg = Math.hypot(dx, dz);
        if (rem <= seg) {
          const t = rem / seg;
          x = pos.route[k].x + dx * t;
          z = pos.route[k].z + dz * t;
          a = Math.atan2(dx, dz);
          break;
        }
        rem -= seg;
      }
      const y = park.heightAt(x, z);
      const bob = Math.sin(worldTime * 3 + pos.dist * 0.7) * 0.04;
      dummy.position.set(x, y + 0.7 + bob, z);
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      bucket.body.setMatrixAt(idx, dummy.matrix);
      dummy.position.set(x, y + 1.55 + bob, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bucket.head.setMatrixAt(idx, dummy.matrix);
      idx++;
    }
    bucket.body.instanceMatrix.needsUpdate = true;
    bucket.head.instanceMatrix.needsUpdate = true;
  }
}

let logos = makeLogos(park);
let logosCollected = 0;

// Open World runtime: spot discovery, minimap + fast travel, traffic. Built
// and torn down with every park swap — it is a no-op on every park but the
// city, but it is cheaper to just own one instance than to special-case it.
let cityManager = null;

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

// --- the park's rival(s) ---------------------------------------------------
/**
 * The rival currently owed by this park, or null. Reveal is derived, never
 * saved: the first boss of the park's roster that has not been beaten, and
 * only once the park is unlocked and the *current run* has banked the reveal
 * milestone — the saved park best plays no part in who steps out. The finale
 * park is the exception: its whole roster is owed on sight, reveal or not, so
 * it owes the first undefeated rival the moment the park loads.
 */
function currentBossDef() {
  const active = bossLadder(park.id).find((b) => !save.isBossDefeated(b.id));
  if (!active) return null;
  if (park.id !== FINALE_PARK_ID && !save.isParkUnlocked(park.id)) return null;
  if (park.id !== FINALE_PARK_ID && score < C.BOSS_REVEAL_SCORE) return null;
  return active;
}

/**
 * Make the park's rivals real: tear down whoever was standing and put the
 * current ones up, or none when the park owes none. Safe to call any time the
 * park or the beaten-list changes. The finale stands every undefeated rival at
 * once — one per section, on the spot the layout marked for it — everywhere
 * else the park owes at most the one the reveal milestone has earned.
 */
function setupBosses() {
  for (const b of bosses) b.dispose();
  bosses = [];
  if (park.id === FINALE_PARK_ID) {
    const defs = bossLadder(park.id);
    const spots = park.def.bossSpots || [];
    for (let i = 0; i < defs.length; i++) {
      if (save.isBossDefeated(defs[i].id)) continue;
      bosses.push(new BossSkater(park, scene, defs[i], spots[i] || null));
    }
  } else {
    const def = currentBossDef();
    if (!def) {
      hud.setBossPromptVisible(false);
      return;
    }
    bosses = [new BossSkater(park, scene, def)];
  }
  for (const b of bosses) shadowCasters.push(...collectMeshes(b.ride.frame));
}

/** The boss the crowd should ring, or a prompt/challenge should target: the
 * standing rival nearest the rider, so in the finale the ring and the "walk up
 * and challenge" prompt track whichever section the player has rolled up to. */
function nearestStandingBoss() {
  let best = null;
  let bestD = Infinity;
  for (const b of bosses) {
    if (b.mode !== 'idle') continue;
    const dx = b.pos.x - ride.pos.x;
    const dz = b.pos.z - ride.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best || bosses[0] || null;
}

// --- the rival's crowd ----------------------------------------------------
// Seven of the social crowd huddle around a rival who is on show: on foot,
// pacing an excited ring around him with a wedge left open so the player can
// skate up and challenge. Released the moment a duel starts or the rival
// leaves, so the ring only ever forms around a rival standing his ground.
let bossCrowd = [];

function releaseBossCrowd() {
  for (const b of bossCrowd) b.endCrowd();
  bossCrowd = [];
}

/** Reconcile the rival's ring with what is actually on show. Called every
 *  frame so a reveal, a remount, a defeat or a park swap all sort themselves
 *  out — cheap, because it no-ops while the ring is already right. */
function refreshBossCrowd() {
  const target = state === CHALLENGE ? null : state === BOSSCUT ? (bosses[0] || null) : nearestStandingBoss();
  if (!target) {
    releaseBossCrowd();
    return;
  }
  if (bossCrowd.length && bossCrowd[0].crowd?.boss === target) return;
  releaseBossCrowd();
  bossCrowd = assignBossCrowd(bots, target);
}

/**
 * A rival whose reveal milestone just got crossed steps out mid-run, and the
 * crossing is the introduction: the same skate-in a loaded park uses at boot,
 * playing right now while the player is riding. Because the milestone is the
 * live run's score, it can only be crossed by a combo banking inside a run,
 * so the cutscene always has a camera to cut to. The finale owes no reveal —
 * its rivals are already standing — so nothing ever crosses here.
 */
function maybeRevealBoss() {
  if (park.id === FINALE_PARK_ID) return;
  if (currentBossDef() && !bosses.length) {
    setupBosses();
    if (state === PLAYING) beginBossCutscene();
  }
}

/**
 * The skate-in: the rival rides its own lines while the camera follows it,
 * then steps off and idles where the player can find it. The player cannot
 * move for the duration — this is the boss's introduction, not a race.
 */
function beginBossCutscene() {
  const target = bosses[0];
  target.toRide();
  bossCut = C.BOSS_CUTSCENE_SECONDS;
  state = BOSSCUT;
  input.enabled = false;
  hud.showBossCutscene(target.def);
}

function endBossCutscene() {
  if (state !== BOSSCUT) return;
  bosses[0].toIdle();
  state = PLAYING;
  input.enabled = true;
  hud.hideBossCutscene();
  hud.hide();
}

/** The duel: both skaters ride at once, scored by the same physics. Takes the
 *  rival to take on — defaults to whichever standing boss is nearest, which is
 *  what the finale wants: the player rolls up to a section and duels that one. */
function startChallenge(target) {
  if (!target) target = nearestStandingBoss();
  if (!target || target.mode !== 'idle' || state === CHALLENGE) return;
  hud.hideBossResult();
  hud.setBossPromptVisible(false);
  hud.hideBossCutscene();
  challenge = {
    time: C.CHALLENGE_TIME,
    boss: target,
    playerScore: 0,
    playerTricks: 0,
    bossScore: 0,
    bossTricks: 0,
  };
  target.toRide();
  state = CHALLENGE;
  input.enabled = true;
  hud.hide();
  hud.showBossChallenge(target.def, challenge);
}

/** The rival's own events from its last step, added to the duel's tally. */
function tallyBossEvents() {
  for (const e of challenge.boss.ride.events) {
    if (e.name === 'trick') challenge.bossTricks++;
    else if (e.name === 'combo') challenge.bossScore += e.total;
  }
}

/**
 * The duel is over: compare tallies, and a win needs the run to have cleared
 * the rival's own bar as well — out-skating them on both counts is not enough
 * on its own, any more than reaching the bar alone is. A win banks the rival
 * and may, with the run past the park-unlock score, open the next park. On the
 * finale a win over the last standing rival is the whole game beaten.
 */
function endChallenge() {
  if (!challenge) return;
  const target = challenge.boss;
  const def = target.def;
  const result = { ...challenge };
  const req = bossRequirement(def);
  const reqMet = score >= req.points && runTricks >= req.tricks;
  const win =
    result.playerScore > result.bossScore &&
    result.playerTricks > result.bossTricks &&
    reqMet;
  let newPark = null;
  if (win) {
    save.recordBossWin(def.id);
    const nxt = maybeUnlockNextPark();
    newPark = nxt ? nxt.name : null;
  }
  const finaleCleared =
    win &&
    park.id === FINALE_PARK_ID &&
    bossLadder(park.id).every((b) => save.isBossDefeated(b.id));
  target.toIdle();
  challenge = null;
  hud.setBossChallengeVisible(false);
  state = BOSSRESULT;
  input.enabled = false;
  hud.showBossResult({ win, def, ...result, reqMet, req, newPark, finaleCleared });
  // A win steps the ladder: the next rival on this park (or none) takes over
  // the scene now, so the player can see what is waiting when they remount.
  if (win) setupBosses();
}

/**
 * The park-unlock gate. A park opens only when *both* halves are satisfied at
 * once: the park before it has had its whole rival roster beaten, and the
 * current run has banked PARK_UNLOCK_SCORE. Reaching the score alone, or
 * clearing the roster alone, opens nothing — main.js owns the run, so the
 * pair is only ever checked here. @returns the park def this unlocked, or null.
 */
function maybeUnlockNextPark() {
  const idx = PARKS.findIndex((p) => p.id === park.id);
  const next = PARKS[idx + 1];
  if (!next) return null;
  if (!save.isParkUnlocked(park.id) || save.isParkUnlocked(next.id)) return null;
  if (!bossLadder(park.id).every((b) => save.isBossDefeated(b.id))) return null;
  if (score < C.PARK_UNLOCK_SCORE) return null;
  save.unlockPark(next.id);
  return next;
}

/**
 * Swap the whole map out from under the player. The ride, the camera and the
 * ragdoll do not need rebuilding — they only ever read `.park` when they need
 * it, so handing them the new one is the entire hand-off. The AI tours a new
 * patrol loop, the logos are fresh, and the old park's geometry is freed
 * rather than left for the GC to eventually notice.
 */
function loadPark(def) {
  const oldPark = park;
  park = new Park(def);
  scene.add(park.group);
  scene.remove(oldPark.group);
  disposeGroup(oldPark.group);
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
  // A fresh park means a fresh run: the current-run score and trick counters
  // belong to the map they were earned on, and a rival's reveal rides the live
  // run, so neither survives a move — setupBosses below reads them at zero and
  // owes the park no rival until the run itself earns one. (The finale is the
  // exception: its whole roster is on show from the moment the park loads,
  // and its score gate is skipped, so the move hands every rival its spot.)
  score = 0;
  runTricks = 0;
  hud.setScore(0);
  hud.setRunTricks(0);
  // Any duel or cutscene in flight dies with the park it belonged to.
  challenge = null;
  hud.hideBossChallenge();
  hud.setBossPromptVisible(false);
  hud.hideBossCutscene();
  hud.hideBossResult();
  setupBosses();
  save.setPark(def.id);
  hud.setCurrentPark(def.name);
  // The city runtime (spots, minimap, traffic) is rebuilt with the park. The
  // map button and canvas only exist for the city; leaving it closes the map
  // so the button cannot dangle open over another park.
  rebuildCityRuntime();
}

/**
 * Build (or rebuild) the Open World runtime for the park currently loaded. The
 * manager is a cheap no-op on every park but the city, but it is cheaper to
 * just own one instance than to special-case it — and it is rebuilt with every
 * park swap so its traffic and spots can never outlive the park they sit on.
 */
function rebuildCityRuntime() {
  // Tear down old crowd skaters before rebuilding.
  if (crowdSkaters) {
    for (const { body, head } of crowdSkaters.meshPairs) {
      scene.remove(body);
      scene.remove(head);
      body.geometry.dispose();
      body.material.dispose();
      head.geometry.dispose();
      head.material.dispose();
    }
    crowdSkaters = null;
  }
  cityManager = new CityManager(park, scene, save, {
    mapCanvas: document.getElementById('citymap'),
    onDiscover: (spot) => {
      hud.say(`NEW SPOT DISCOVERED!  ${spot.name.toUpperCase()}`, 'unlock');
      if (cityManager.isMapVisible()) {
        cityManager.toggleMap();
        hud.setCityMapOpen(false);
      }
    },
    onChallenge: (spot, res) => {
      if (res.done) {
        save.addCoins(CITY_CHALLENGE_COINS);
        hud.setCoins(save.coins);
        hud.say(`SPOT COMPLETE  ${spot.name.toUpperCase()}  +${CITY_CHALLENGE_COINS}c`, 'unlock');
      } else if (res.newBest) {
        hud.say(`NEW SPOT BEST  ${spot.name.toUpperCase()}`, 'banked');
      }
    },
  }, _isLowEnd);
  hud.setCityMapVisible(cityManager.active);
  if (!cityManager.active) hud.setCityMapOpen(false);
  buildCrowdSkaters();
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
let score = 0;           // banked this session — the current run's score
let runTricks = 0;       // tricks landed this session — the current run's count
let frames = 0;
let worldTime = 0;       // unconditional clock, for birds and the logos' spin
let liveCombo = { names: [], points: 0 };

// The park's rivals, when any are standing. The finale stands the whole
// undefeated roster at once, one per section; everywhere else there is at most
// the one the reveal milestone has earned. The skate-in cutscene plays at the
// moment a rival is revealed mid-run; after that the rival just stands there,
// cutscene or not.
let bosses = [];
let bossCut = 0;
let challenge = null;    // the duel's tally, while one is running

hud.setBest(save.best);
hud.setSound(save.sound);
hud.setSpeedValue(save.speed);
hud.setCamZoomValue(save.camZoom);
hud.setMusicVolumeValue(save.musicVolume);
hud.setSpotifyVolumeValue(save.radioVolume);
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
  runTricks = 0;
  hud.setScore(0);
  hud.setRunTricks(0);
  // The rival's skate-in plays when it is revealed mid-run, not on every run
  // start — a fresh run starts at zero, so nobody is standing until the run
  // itself banks the reveal milestone.
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
  hud.renderParks(PARKS, park.id, save);
  hud.renderMyParks(userParks, park.id);
  hud.setLightingMode(save.lighting);
  hud.show('parks');
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

/** Which made rider the Riders screen's ACCESSORIES panel is styling, or null
 * when the panel is closed. UI state, not a save value — it never persists. */
let accessoryCharacterId = null;

function showStore() {
  state = STOREMENU;
  input.enabled = false;
  // The rider accessory panel only lives on the Riders screen; make sure its
  // repaint override is not still in place when the shop re-renders.
  accessoryCharacterId = null;
  hud.setRiderAccessoryIds(null);
  const look = currentLook();
  hud.renderBoards(BOARD_TYPES, BOARD_TYPES, save);
  hud.renderOutfits(OUTFITS, save, look.character.palette);
  hud.renderPants(PANTS, save);
  hud.renderAccessories(ACCESSORIES, save, look);
  hud.show('store');
}

/** The Riders screen: who you skate as, and what they wear. Characters live
 * here and nowhere else — the shop is boards, and the clothes. The prebuilt
 * rack is locked: the make-character card is the way a rider gets picked, and
 * a made rider's own accessory rack opens from the ACCESSORIES option. */
function showRiders() {
  state = CHARSELECT;
  input.enabled = false;
  accessoryCharacterId = null;
  hud.closeAccessoryPanel();
  hud.setRiderAccessoryIds(null);
  hud.renderCharSelect(CHARACTERS, save.characterId, save.customCharacters);
  hud.setRiderAccessoriesVisible(save.characterId.startsWith('custom:'));
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

function setMakerName(name) {
  const c = makeDraft();
  // Keep the name exactly as typed — spaces, case, even empty. Cleaning (trim,
  // a default name) happens when the character is saved, not while the player
  // is still typing, or they can never delete the field or use a space in the
  // middle of a name.
  c.name = name.slice(0, 40);
  save.setCustom(c);
}

/**
 * The maker's Save: the draft becomes a new saved character and is equipped on
 * the spot. Saving again makes a second rider, the way the Board Maker makes a
 * second deck — the rack in the maker is where the old ones go to be edited or
 * deleted, not for saving twice to mean overwriting. The player lands back on
 * the Riders screen with their new rider in front of them, ready to be picked
 * or dressed.
 */
function saveMadeCharacter() {
  save.saveCustomCharacter(makeDraft());
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  showRiders();
}

/** Equip, edit or delete one of the player's saved custom characters. */
function characterSavedAction(id, action) {
  if (action === 'delete') {
    save.deleteCustomCharacter(id);
    const look = currentLook();
    skater.rebuild(look.palette, look.style, look.scale);
    hud.setPreviewLook(look.palette, look.style, look.scale);
    renderMaker();
  } else if (action === 'edit') {
    const c = save.customCharacters.find((x) => x.id === id);
    if (c) {
      save.setCustom(c);
      renderMaker();
    }
  } else if (save.setCustomCharacter(id)) {
    const look = currentLook();
    skater.rebuild(look.palette, look.style, look.scale);
    hud.setPreviewLook(look.palette, look.style, look.scale);
    renderMaker();
  }
}

// --- the Board Maker -------------------------------------------------------
/** Which sticker layer in the draft the inspector is pointed at. A draft's own
 * state, so it does not live in the draft itself (and so cannot be saved). */
let boardSelectedLayer = null;

/** Which face of the deck the maker is editing: the grip ('top') or the
 * underside ('back'). Like boardSelectedLayer, this is where the player is
 * looking rather than a property of the board, so it is UI state, not part of
 * the draft — the two faces each keep their own full design in the draft. */
let boardFace = 'top';

/** The last colour the under-glow was set to, kept so toggling it back on
 * resumes the player's own pick instead of resetting to the default. */
let boardGlowColor = 0x35ffe0;

/** The Board Maker's whole working state, in one place, so it cannot drift. */
function boardDraft() {
  return save.boardDraft;
}

/** The face the maker is currently editing inside a draft: the top of the deck
 * is the draft itself, the underside is draft.back. */
function faceOf(d) {
  return boardFace === 'back' ? d.back : d;
}

/** Re-render the Board Maker's racks and its turntable from the draft. An
 * optional `preview` board (a saved deck) is shown on the turntable instead of
 * the draft while the racks still describe the deck under construction — so
 * tapping a saved card answers "what does that look like?" without discarding
 * the work in progress. `swap` asks the turntable for a take-and-place
 * instead of a live rebuild — the shopkeeper carries the old deck away and
 * brings the new one out — which is how a change of deck shape lands. */
function renderBoardMaker(preview = null, swap = false) {
  const d = boardDraft();
  hud.renderBoardMaker(d, save, boardSelectedLayer, boardFace);
  const show = preview || d;
  hud.bmPreview?.setBoard(designPalette(show), boardTypeById[show.type]?.shape, show, swap);
}

function showBoardMaker() {
  state = BOARDMAKER;
  input.enabled = false;
  boardFace = 'top';
  boardSelectedLayer = null;
  renderBoardMaker();
  hud.bmPreview?.setFace('top');
  hud.show('boardmaker');
}

/** Mutate the draft, persist it, then re-render everything that reads it. A
 * `swap` renders the change as the shopkeeper taking the old deck off the
 * counter and bringing out the new one, instead of rebuilding it in place. */
function updateBoardDraft(mutate, swap = false) {
  const d = boardDraft();
  mutate(d);
  save.setBoardDraft(d);
  renderBoardMaker(null, swap);
}

function pickBoardStyle(id) {
  updateBoardDraft((d) => {
    faceOf(d).style = id;
    boardSelectedLayer = null;
  });
}

/** Pick a deck shape. A new shape is a whole new board — the shopkeeper takes
 * the old one off the counter and brings the new one out — so it goes through
 * the swap render rather than a live rebuild. Picking the shape that is
 * already on the deck is a no-op. */
function pickBoardType(id) {
  const d = boardDraft();
  if (d.type === id) return;
  updateBoardDraft((d) => {
    d.type = id;
  }, true);
}

function pickBoardColor(role, hex) {
  updateBoardDraft((d) => {
    const value = parseInt(hex.slice(1), 16);
    if (role === 'styleColor' || role === 'styleColor2') {
      faceOf(d)[role] = value;
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
    faceOf(d).text = sanitizeText(text);
  });
}

/** Paint one block-art cell with the current brush (brush 0 erases). */
function paintBoardPixel(row, col) {
  updateBoardDraft((d) => {
    const f = faceOf(d);
    if (!f.pixels[row]) f.pixels[row] = [];
    f.pixels[row][col] = f.pixelBrush;
  });
}

function pickBoardBrush(idx) {
  updateBoardDraft((d) => {
    faceOf(d).pixelBrush = idx;
  });
}

function addBoardSticker(icon) {
  updateBoardDraft((d) => {
    const f = faceOf(d);
    f.layers.push({ icon, x: 0, z: 0, rot: 0, scale: 1 });
    boardSelectedLayer = f.layers.length - 1;
  });
}

function selectBoardLayer(i) {
  boardSelectedLayer = i;
  renderBoardMaker();
}

/** One knob of the selected sticker's inspector: position, spin, size. */
function changeBoardLayer(i, key, value) {
  updateBoardDraft((d) => {
    const l = faceOf(d).layers[i];
    if (!l) return;
    l[key] = key === 'rot' ? (value * Math.PI) / 180 : value;
  });
}

function deleteBoardLayer(i) {
  updateBoardDraft((d) => {
    const f = faceOf(d);
    f.layers.splice(i, 1);
    boardSelectedLayer = f.layers.length ? Math.min(boardSelectedLayer ?? 0, f.layers.length - 1) : null;
  });
}

/** Flip the maker between the top of the deck and its underside. Each face has
 * its own style, colours, lettering, pixels and stickers, so switching just
 * points every rack at the other face's design — and the preview tips the deck
 * over so the side being designed faces the camera. */
function pickBoardFace(face) {
  if (face !== 'top' && face !== 'back') return;
  boardFace = face;
  boardSelectedLayer = null;
  renderBoardMaker();
  hud.bmPreview?.setFace(face);
}

/** One knob of the active face's base-pattern placement: move, spin or scale
 * the whole design on the deck, not just a single sticker. */
function changeBoardPlacement(key, value) {
  updateBoardDraft((d) => {
    const f = faceOf(d);
    f[key] = key === 'prot' ? (value * Math.PI) / 180 : value;
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
        back: {
          ...b.back,
          pixels: b.back.pixels.map((r) => [...r]),
          layers: b.back.layers.map((l) => ({ ...l })),
        },
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
  if (state === PLAYING || state === WALKING || state === CHALLENGE) {
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
  // A locked park is not selectable from the grid; the guard is belt-and-
  // braces for anything that reaches here around the locked card's click.
  if (def && save.isParkUnlocked(id) && def.id !== park.id) {
    loadPark(def);
    respawn();
  }
  showStart();
};
// Open World: the start menu's own button loads the city, then hands the run
// over the same way hitting Skate does.
hud.on.openWorld = () => {
  if (park.id !== CITY.id) {
    loadPark(CITY);
    respawn();
  }
  startGame();
};
// The minimap's toggle button. Opening it pauses nothing — it is an overlay —
// and discovering a new spot flips it shut so the reveal can be seen.
hud.on.cityMap = () => {
  if (!cityManager.active) return;
  const open = cityManager.toggleMap();
  hud.setCityMapOpen(open);
};
// A tap on the minimap: canvas px → world coords → the nearest discovered spot.
hud.on.cityTravel = (x, y, scale) => {
  if (!cityManager.active) return;
  const at = cityManager.worldFromMap(x * scale, y * scale);
  const spot = cityManager.spotAtWorld(at.x, at.z, 45);
  if (spot && cityManager.travelTo(spot.id, ride)) {
    chase.snap(ride); // land the camera on the new spot, no drift-in
    input.clear();
  }
};
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
  showParks();
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
hud.on.makerName = (name) => setMakerName(name);
hud.on.makeSave = () => saveMadeCharacter();
hud.on.makerSavedAction = (id, action) => characterSavedAction(id, action);
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
hud.on.bmFace = (face) => pickBoardFace(face);
hud.on.bmPlace = (key, value) => changeBoardPlacement(key, value);
hud.on.bmSave = () => saveMadeBoard();
hud.on.bmSavedAction = (id, action) => boardSavedAction(id, action);
hud.on.pause = () => togglePause();
// The duel's result screen: rematch the same rival, or step back into the run.
hud.on.bossResultRematch = () => {
  hud.hideBossResult();
  startChallenge();
};
hud.on.bossResultDone = () => {
  hud.hideBossResult();
  state = PLAYING;
  input.enabled = true;
  hud.hide();
};
// The challenge prompt: walk up to a standing rival and take them on.
hud.on.bossChallenge = () => startChallenge();
hud.on.board = (id) => selectBoard(id);
hud.on.outfit = (id) => selectOutfit(id);
hud.on.pants = (id) => selectPants(id);
hud.on.accessory = (id, forRider) => (forRider ? selectRiderAccessory(id) : selectAccessory(id));
hud.on.character = (id) => selectCharacter(id);
hud.on.csAccessories = () => openAccessoryPanel();
hud.on.csAccessoriesSave = () => closeAccessoryPanel();
hud.on.csAccessoriesBack = () => closeAccessoryPanel();

// The shop's repaint wheels. `repaint` fires as a wheel drags or its slider
// moves — repaint the save and rebuild the rig live, so the rider on screen
// (and the tutorial's demo rider) change as you pick. `repaintCommit` fires
// when the gesture lets go and re-renders the whole store, which is the one
// point it is worth drawing every portrait again. `repaintReset` throws the
// repaint away the same way, and always re-renders.
const repaintSetter = (kind) =>
  kind === 'outfit' ? save.setOutfitColor : kind === 'pants' ? save.setPantsColor : save.setAccessoryColor;
const repaintResetter = (kind) =>
  kind === 'outfit' ? save.resetOutfitColors : kind === 'pants' ? save.resetPantsColors : save.resetAccessoryColors;
hud.on.repaint = (kind, id, key, hex) => {
  // The wheel hands over a '#rrggbb' string; the save layer stores numbers.
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isInteger(n)) return;
  if (!repaintSetter(kind).call(save, id, key, n)) return;
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
};
hud.on.repaintCommit = () => {
  // A repaint that happened on the Riders screen's own accessory panel must
  // re-render that panel with the rider's slots, not the shop's.
  if (accessoryCharacterId) {
    renderRiderAccessories();
    return;
  }
  const look = currentLook();
  hud.renderOutfits(OUTFITS, save, look.character.palette);
  hud.renderPants(PANTS, save);
  hud.renderAccessories(ACCESSORIES, save, look);
};
hud.on.repaintReset = (kind, id) => {
  if (!repaintResetter(kind).call(save, id)) return;
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  if (accessoryCharacterId) {
    renderRiderAccessories();
    return;
  }
  hud.renderOutfits(OUTFITS, save, look.character.palette);
  hud.renderPants(PANTS, save);
  hud.renderAccessories(ACCESSORIES, save, look);
};
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

// The boot park is built directly (not through loadPark), so give it its own
// city runtime — a boot straight into the city still gets spots and a map.
rebuildCityRuntime();

/** Buy the board if it is not owned yet, then equip it either way. */
function selectBoard(id) {
  const def = boardById[id];
  if (!def) return false;
  if (!save.boards.includes(id) && !save.buyBoard(id)) return false; // can't afford it
  save.setBoard(id);
  board.build(def.palette, def.shape);
  hud.renderBoards(BOARD_TYPES, BOARD_TYPES, save);
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
 * and nothing to afford. Only a made character can be picked: the prebuilt
 * rack is locked until the maker is used, which is why those cards render
 * disabled. 'custom:<id>' resolves from its saved draft; the shirt stays as
 * it was and re-applies over whichever rider, which is why the rebuild goes
 * through currentLook().
 */
function selectCharacter(id) {
  if (!id.startsWith('custom:')) return false; // the prebuilt rack is locked
  if (!save.setCharacter(id)) return false;
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  // The Riders screen carries the made characters too, so they get repainted
  // alongside the prebuilt rack when a pick happens there.
  hud.renderCharSelect(CHARACTERS, save.characterId, save.customCharacters);
  // A made rider is equipped: the ACCESSORIES option that opens their own
  // rack is now worth showing.
  hud.setRiderAccessoriesVisible(true);
  return true;
}

/**
 * Buy the accessory if it is not owned yet, then wear it either way. Wearing
 * fills the item's own category slot (a hat the hat slot, shades the shades
 * slot, a backpack the pack slot), so up to three different kinds can be worn
 * at once — "Original" empties them all.
 */
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

/** Re-render the Riders screen's accessory panel for the rider being styled.
 * `currentLook()` is that rider (only the equipped one can be styled), so the
 * portraits draw the right figure; `renderAccessories` gets the rider's own
 * slots so the worn marks and the repaint panel match them. */
function renderRiderAccessories() {
  const c = save.customCharacters.find((x) => x.id === accessoryCharacterId);
  if (!c) return;
  hud.setRiderAccessoryIds(c.accessoryIds);
  hud.renderAccessories(ACCESSORIES, save, currentLook(), c.accessoryIds);
}

/**
 * The ACCESSORIES option on the Riders screen: swap the grid for the equipped
 * made rider's own accessory rack. Nothing is bought or worn until a card is
 * tapped — this is just the dressing-room door.
 */
function openAccessoryPanel() {
  if (!save.characterId.startsWith('custom:')) return;
  const c = save.customCharacters.find((x) => x.id === save.characterId.slice(7));
  if (!c) return;
  accessoryCharacterId = c.id;
  hud.openAccessoryPanel();
  renderRiderAccessories();
}

/** Save or Back on the accessory panel: put the character grid back, with the
 * ACCESSORIES option still in place while a made rider is equipped. */
function closeAccessoryPanel() {
  accessoryCharacterId = null;
  hud.setRiderAccessoryIds(null);
  hud.closeAccessoryPanel();
  hud.renderCharSelect(CHARACTERS, save.characterId, save.customCharacters);
  hud.setRiderAccessoriesVisible(save.characterId.startsWith('custom:'));
}

/**
 * A card tapped in a made rider's own accessory rack. Same buy-then-wear flow
 * as the shop, but the slots it fills live on the rider: a hat goes in that
 * rider's hat slot, and the next rider you make wears none of it. Repaints
 * stay global — they are about the bought item, not who is wearing it.
 */
function selectRiderAccessory(id) {
  if (!accessoryCharacterId) return false;
  if (!save.accessories.includes(id) && !save.buyAccessory(id)) return false; // can't afford it
  if (!save.setCharacterAccessory(accessoryCharacterId, id)) return false;
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  renderRiderAccessories();
  return true;
}

/** Buy the pants if they are not owned yet, then wear them either way. */
function selectPants(id) {
  const def = pantsById[id];
  if (!def) return false;
  if (!save.pants.includes(id) && !save.buyPants(id)) return false; // can't afford it
  save.setPants(id);
  const look = currentLook();
  skater.rebuild(look.palette, look.style, look.scale);
  hud.setPreviewLook(look.palette, look.style, look.scale);
  hud.renderPants(PANTS, save);
  // The rider is drawn wearing the pants, so the accessory portraits and the
  // outfit rack both get repainted along with the pants rack itself.
  hud.renderOutfits(OUTFITS, save, look.character.palette);
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
hud.on.spotifyVolume = (v) => {
  save.setRadioVolume(v);
  radio?.setVolume(v);
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
  hud.setSpotifyVolumeValue(save.radioVolume);
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
  if (state === PLAYING || state === WALKING || state === CHALLENGE || state === PAUSED) togglePause();
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
      case 'boost':
        audio.boost();
        hud.say('BOOST!', 'small');
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
        // The current run's trick count — cumulative across the whole run,
        // never tied to one combo. It is what a rival's requirements ask for.
        runTricks++;
        hud.setRunTricks(runTricks);
        liveCombo = { names: ride.combo.names.slice(), points: ride.combo.points };
        if (challenge) challenge.playerTricks++;
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
        // Park progression: the combo counts towards the park's own best.
        save.recordParkScore(park.id, e.total);
        // Open World: a combo landed inside a spot ring feeds that spot's
        // local best and challenge (the manager toasts what changed).
        if (cityManager) cityManager.noteCombo(e.total, ride.pos);
        // Crossing the reveal milestone mid-run is when the park's own boss
        // steps out. With the roster beaten and the run past the unlock
        // score, the same banked combo can open the next park.
        maybeRevealBoss();
        const unlocked = maybeUnlockNextPark();
        if (unlocked) hud.say(`NEW PARK UNLOCKED!  ${unlocked.name.toUpperCase()}`, 'unlock');
        audio.chime(e.multiplier > 2);
        liveCombo = { names: [], points: 0 };
        if (challenge) challenge.playerScore += e.total;
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
// `preBailState` is the run state to fall back into on recovery: getting up
// mid-duel resumes the duel, not plain free skate.
let bailYaw = 0;
let preBailState = PLAYING;
const _getUp = new THREE.Vector3();

/** Hand the rider and the board over to the ragdoll. */
function startBail() {
  // Both come out of the ride frame and into the world, because from here they
  // are two independent objects that happen to have been travelling together.
  bailYaw = ride.yaw;
  preBailState = state === CHALLENGE ? CHALLENGE : PLAYING;
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
  state = preBailState;
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
  // The rival's ring reconciles before anything steps, so a reveal or a park
  // swap never leaves a crowd bot circling a rival that is no longer there.
  refreshBossCrowd();
  // The park's own crowd keeps moving whatever the player is doing — paused at
  // the menu is exactly when a skatepark should still look alive.
  socialGroup.step(dt); // ticked once here, not once per bot that shares it
  for (const b of bots) b.step(dt, ride.pos);
  // A rival waiting around does the same thing a social bot does: shifts its
  // weight, turns to look, carries its board. It only skates its lines while a
  // cutscene or a duel is actually running.
  for (const b of bosses) if (b.mode === 'idle') b.step(dt, ride.pos);

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
  } else if (state === BOSSCUT) {
    bosses[0].step(dt, ride.pos);
    bossCut -= dt;
    if (bossCut <= 0) endBossCutscene();
  } else if (state === CHALLENGE) {
    handleEvents(ride.update(dt, frameInput || IDLE_INPUT));
    if (ride.combo.live) liveCombo = { names: ride.combo.names, points: ride.combo.points };
    const got = checkPickup(logos, ride.pos);
    if (got) {
      audio.collect();
      save.recordLogo();
      logosCollected++;
      hud.say('Logo found', 'small');
    }
    challenge.boss.step(dt, ride.pos);
    tallyBossEvents();
    challenge.time -= dt;
    if (challenge.time <= 0) endChallenge();
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
    state === STOREMENU ||
    state === SETTINGSMENU ||
    state === DESIGNER
  ) {
    // Nothing moves, but the camera still eases into place behind a fresh spawn.
  }

  // Open World runtime, every frame: spot discovery, ghost traffic and the
  // minimap. It is a cheap no-op on every park but the city, and runs even at
  // the menus so the city keeps breathing behind the overlay.
  cityManager?.step(dt, ride);

  if (state !== BAILED) bailWait = 0;
}

// --- render ---------------------------------------------------------------
// Set by the test hook's inspect(), so a screenshot can be framed by hand.
let cameraLocked = false;

function render(dt) {
  worldTime += dt;
  for (const b of birds) b.update(worldTime);
  for (const l of logos) l.update(dt, worldTime);
  stepCrowdSkaters(dt, worldTime);
  if (!cameraLocked) {
    if (state === WALKING) {
      // A stand-in shaped like `ride`, so the chase camera needs no walking
      // code path of its own — just something that looks like what it reads.
      walkRide.yaw = walker.yaw;
      walkRide.speed = walker.speed;
      walkRide.groundSpeed = Math.abs(walker.speed);
      walkRide.vel.set(Math.sin(walker.yaw) * walker.speed, 0, Math.cos(walker.yaw) * walker.speed);
      chase.update(walkRide, null, dt);
    } else if (state === BOSSCUT && bosses[0] && bosses[0].mode === 'riding') {
      // The skate-in is about the rival: the lens rides their lines while the
      // player's run is on hold.
      chase.update(bosses[0].ride, null, dt);
    } else {
      chase.update(ride, ragdoll, dt);
    }
  }
  if (state !== BAILED) updateShadow();
  else shadow.material.opacity = Math.max(0, shadow.material.opacity - dt);
  lighting.update(dt, ride.pos, chase.pos);
  renderer.render(scene, camera);
}

function updateHud(dt) {
  hud.tick(dt);
  hud.setCoins(save.coins);
  const inRun = state === PLAYING || state === CHALLENGE;
  const dismountReady = state === PLAYING && ride.mode === GROUND;
  // No distance test any more: the board is in the rider's hand, so getting back
  // on is always available the moment they are on foot.
  hud.setActionButtons({ dismount: dismountReady, mount: state === WALKING, sit: state === WALKING });
  // Grabs only mean anything in the air — showing the row the rest of the time
  // would just be five buttons that do nothing. A duel is still a run.
  hud.setGrabButtonsVisible(inRun && ride.mode === AIR);
  // Keyboard already has Escape/P for this — the button exists for mobile,
  // where a pause has no key to fall back on.
  hud.setPauseButtonVisible(inRun || state === WALKING);
  // The camera-cycle button has the same rhythm: pointless on menus, useful
  // the moment there is a camera to cycle.
  hud.setCamcycleVisible(inRun || state === WALKING);
  // And the hide-the-HUD button rides with them: only mid-run is there a
  // screenful of chrome worth hiding, and leaving the run brings it back. A
  // bail is still mid-run — the rider gets straight back up and carries on, so
  // the HUD stays off through a crash rather than flashing back on screen.
  hud.setHideUiVisible(inRun || state === WALKING || state === BAILED);
  // The city map button rides with the same in-run rhythm, but only where the
  // city is loaded — nowhere else is there anything worth a map.
  hud.setCityMapVisible(cityManager?.active && (inRun || state === WALKING));

  if (state === PLAYING) {
    hud.setSpeed(ride.groundSpeed);
    hud.setAir(ride.airHeight);
    hud.setCombo(liveCombo.names, liveCombo.points, Math.max(1, 1 + Math.floor((liveCombo.names.length - 1) / 3) * 0.1));
    const balancing = !!ride.grind || ride.manual;
    hud.setBalance(balancing, ride.balance, C.BALANCE_LIMIT);
    hud.setCharge(input.flickActive || input.charging() ? ride.charge : 0);
    hud.setLogos(logosCollected, logos.length);
    hud.setRunTricks(runTricks);
    hud.setProgression(progressionGate());
    audio.follow(
      ride.groundSpeed,
      ride.mode === GROUND,
      ride.mode === GRIND,
      ride.surf.kind === ROUGH,
      ride.sliding,
      ride.revertK
    );
    // The rival's prompt: a standing boss close enough to take on. With the
    // whole roster standing in the finale, the prompt tracks the nearest one,
    // so it always reads the section the player has actually rolled up to.
    const target = nearestStandingBoss();
    const nearBoss =
      target &&
      (() => {
        const dx = target.pos.x - ride.pos.x;
        const dz = target.pos.z - ride.pos.z;
        return dx * dx + dz * dz < C.BOSS_PROMPT_R * C.BOSS_PROMPT_R;
      })();
    hud.setBossPromptVisible(!!nearBoss, nearBoss ? target.def : null);
  } else if (state === CHALLENGE) {
    hud.setSpeed(ride.groundSpeed);
    hud.setAir(ride.airHeight);
    hud.setCombo(liveCombo.names, liveCombo.points, Math.max(1, liveCombo.names.length));
    const balancing = !!ride.grind || ride.manual;
    hud.setBalance(balancing, ride.balance, C.BALANCE_LIMIT);
    hud.setCharge(input.flickActive || input.charging() ? ride.charge : 0);
    hud.setLogos(logosCollected, logos.length);
    hud.setRunTricks(runTricks);
    hud.setProgression(progressionGate());
    audio.follow(
      ride.groundSpeed,
      ride.mode === GROUND,
      ride.mode === GRIND,
      ride.surf.kind === ROUGH,
      ride.sliding,
      ride.revertK
    );
    hud.setBossPromptVisible(false);
    hud.setBossChallenge(challenge.boss.def, challenge);
  } else if (state === WALKING) {
    hud.setSpeed(Math.abs(walker.speed));
    hud.setAir(0);
    hud.setCombo([], 0, 1);
    hud.setBalance(false, 0, 1);
    hud.setCharge(0);
    hud.setBossPromptVisible(false);
    hud.setProgression(null);
    audio.follow(0, false, false, false);
  } else {
    hud.setBossPromptVisible(false);
    hud.setProgression(null);
    audio.follow(0, false, false, false);
  }
}

/**
 * The current run's progression, as the HUD draws it: where the park's rival
 * gate stands and how far the next park is. Both gates read the live run's
 * score and trick totals — the reveal milestone, the standing rival's own
 * requirement, and the park-unlock pair of roster plus 1,000,000 points.
 */
function progressionGate() {
  const roster = bossLadder(park.id);
  const active = roster.find((b) => !save.isBossDefeated(b.id));
  const gate = {
    runScore: score,
    runTricks,
    cleared: roster.length > 0 && !active,
    reveal: null,
    boss: null,
    next: null,
  };
  if (active) {
    const req = bossRequirement(active);
    // The finale skips the reveal milestone: its rivals are standing from the
    // moment the park loads, so the run's bar reads the next rival's duel bar
    // instead of the score gate that summoned the one before it.
    if (park.id !== FINALE_PARK_ID && score < C.BOSS_REVEAL_SCORE) {
      gate.reveal = {
        name: active.name,
        score,
        target: C.BOSS_REVEAL_SCORE,
        pct: Math.min(100, Math.max(0, Math.round((score / C.BOSS_REVEAL_SCORE) * 100))),
      };
    } else {
      gate.boss = {
        name: active.name,
        reqPoints: req.points,
        reqTricks: req.tricks,
      };
    }
  }
  const idx = PARKS.findIndex((p) => p.id === park.id);
  const next = PARKS[idx + 1];
  if (next && save.isParkUnlocked(park.id) && !save.isParkUnlocked(next.id)) {
    gate.next = {
      name: next.name,
      score,
      target: C.PARK_UNLOCK_SCORE,
      scorePct: Math.min(100, Math.max(0, Math.round((score / C.PARK_UNLOCK_SCORE) * 100))),
      rivals: roster.filter((b) => save.isBossDefeated(b.id)).length,
      rivalsTotal: roster.length,
    };
  }
  return gate;
}

// --- adaptive resolution --------------------------------------------------
// devicePixelRatio is 3 on a phone, and 3× is nine times the fragment work of 1×.
// Start capped and step down, never up, so it cannot oscillate.
const DPR_STEPS = _isLowEnd ? [1.25, 1] : [1.75, 1.5, 1.25, 1];
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
  if (document.hidden && (state === PLAYING || state === WALKING || state === CHALLENGE)) togglePause();
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
  // simulation steps this frame turns into. A duel reads the same as a run.
  const frameInput = state === PLAYING || state === CHALLENGE ? input.read() : null;
  let steps = 0;
  const maxSteps = _isLowEnd ? 4 : 8;
  while (acc >= C.FIXED_DT && steps < maxSteps) {
    step(C.FIXED_DT, frameInput);
    acc -= C.FIXED_DT;
    steps++;
  }
  if (steps === maxSteps) acc = 0; // give up rather than fall further behind

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
setupBosses();
if (save.seenGuide) showStart();
else showGuide();
lighting.startCycle();
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
  get runTricks() {
    return runTricks;
  },
  /** Pretend a combo just banked, for tests — feeds every progression gate. */
  setRunScore(n) {
    score = Math.max(0, Math.floor(n));
    hud.setScore(score);
    maybeRevealBoss();
    const unlocked = maybeUnlockNextPark();
    if (unlocked) hud.say(`NEW PARK UNLOCKED!  ${unlocked.name.toUpperCase()}`, 'unlock');
    return { score, unlocked: unlocked ? unlocked.id : null };
  },
  /** Pretend tricks just landed, for tests — feeds the rival requirements. */
  setRunTricks(n) {
    runTricks = Math.max(0, Math.floor(n));
    hud.setRunTricks(runTricks);
    return runTricks;
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
  city: CITY,
  citySpots: CITY_SPOTS,
  get cityManager() {
    return cityManager;
  },
  bots,
  socialGroup,
  birds,
  ride,
  board,
  boards: BOARD_TYPES,
  boardTypes: BOARD_TYPES,
  outfits: OUTFITS,
  pants: PANTS,
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
  openDesigner,
  showParks,
  showStart,
  start: startGame,
  respawn,
  get boss() {
    // The rival a test should be driving: the duel's target while one runs,
    // the cutscene's rider while one plays, and the nearest standing rival
    // otherwise — so a test (or the crowd) always gets one concrete boss.
    if (state === CHALLENGE) return challenge?.boss || null;
    if (state === BOSSCUT) return bosses[0] || null;
    return nearestStandingBoss();
  },
  get challenge() {
    return challenge;
  },
  currentBossDef,
  setupBosses,
  startChallenge,
  beginBossCutscene,
  endBossCutscene,
  endChallenge,
  selectBoard,
  selectOutfit,
  selectPants,
  selectAccessory,
  selectCharacter,
  showStore,
  showRiders,
  showMaker,
  pickMakerPart,
  saveMadeCharacter,
  characterSavedAction,
  openAccessoryPanel,
  closeAccessoryPanel,
  selectRiderAccessory,
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
    const def = allParks().find((p) => p.id === id);
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

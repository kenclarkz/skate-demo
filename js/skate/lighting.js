// LightingManager: everything about what time of day the park is lit at.
//
// One manager owns every light-adjacent thing in the scene — the sky, the fog,
// the sun (or moon), the hemisphere fill, the floodlights, the street-lamp
// glow, the illuminated signage and the distant building windows — so that
// "what does night look like" lives in one place instead of being smeared
// across main.js and park.js. Today there are three presets — DAY, NIGHT and
// SUNSET — and everything is written as a named bag of numbers precisely so a
// future RAIN or DUSK preset is another entry in `PRESETS`, not a new code
// path.
//
// Nothing here changes what the ride model reads: physics.js never looks at
// any of this. It is lighting, sky and atmosphere, full stop — see main.js's
// loop, where `lighting.update()` runs in `render()`, never in `step()`.

import * as THREE from '../game/three.js';

export const DAY = 'day';
export const NIGHT = 'night';
export const SUNSET = 'sunset';

// How long a crossfade takes. The brief asks for 2-3 seconds; 2.4s is the
// middle of that and reads as deliberate rather than either snappy or slow.
const FADE_SECONDS = 2.4;

// Automatic day/night cycle: DAY → SUNSET → NIGHT → DAY over 600s (10 min).
const CYCLE_SECONDS = 600;
const CYCLE_SEQUENCE = [DAY, SUNSET, NIGHT, DAY];

// The player's personal fill light hangs behind and above the rider, on the
// side the chase camera sits, rather than directly overhead — see update().
// BACK is how far behind the rider, UP is how far above the ground it rides.
const PLAYER_FILL_BACK = 1.5;
const PLAYER_FILL_UP = 1.0;

// Every tunable that differs between times of day, gathered in one place so
// adding a third preset is "copy one of these and change the numbers," not a
// hunt through the rest of the file for every place day and night diverge.
const PRESETS = {
  [DAY]: {
    skyTop: 0x2f6ba8,
    skyMid: 0x8fb4d6,
    skyHorizon: 0xd8d3c4,
    fogColor: 0xd8d3c4,
    fogNear: 60,
    fogFar: 280,
    hemiSky: 0xbcd6f0,
    hemiGround: 0x6b6455,
    hemiIntensity: 2.1,
    keyColor: 0xfff2d8,
    keyIntensity: 2.3,
    keyPos: [-6, 9, 4],
    exposure: 0.92,
    starOpacity: 0,
    moonOpacity: 0,
    floodIntensity: 0,
    lampIntensity: 0,
    ambientIntensity: 0,
    playerLightIntensity: 0,
    bulbColor: 0xa79a76,     // an unlit bulb, dull in daylight
    bulbEmissive: 0.0,
    signOpacity: 0.08,       // a sign in daylight is just a dark panel
    buildingOpacity: 0,
    windowOpacity: 0,
    specular: 0x222428,
    shininess: 9,
    // Daytime shadows: on, but soft. The 1024px map is tight (follows the
    // rider) and the casters are only the skaters, so the cost is a fraction
    // of a frame — and the extra depth it buys the whole park is worth more
    // than the old all-flat daylight read.
    shadowStrength: 0.4,
    sunColor: 0xfff3dc,      // the sun disc's tint — invisible by day, the disc is off
    haloColor: 0xcfe0ff,
    cloudOpacity: 0.7,
  },
  [NIGHT]: {
    skyTop: 0x01030a,
    skyMid: 0x0a1730,
    skyHorizon: 0x131f36,
    fogColor: 0x0a1226,
    fogNear: 34,
    fogFar: 170,
    hemiSky: 0x33538c,
    hemiGround: 0x171b26,
    hemiIntensity: 1.6,
    keyColor: 0xb7c6f0,      // moonlight: cool next to the sun, but no longer dim
    keyIntensity: 1.5,
    keyPos: [11, 15, -7],
    exposure: 1.15,
    starOpacity: 1,
    moonOpacity: 1,
    floodIntensity: 1,
    lampIntensity: 1,
    // A flat, from-everywhere fill so the rider and every AI skater read
    // clearly wherever they are on the pad — the moon (a DirectionalLight)
    // only lights one side of a body, and the floodlights/lamps are fixed in
    // place and cannot reach the whole park. An AmbientLight is the cheapest
    // light three.js has (one constant added per fragment, no direction or
    // falloff math at all), which is what makes it the right tool for
    // "everyone stays visible" rather than another positioned light.
    ambientIntensity: 0.9,
    // On top of the ambient fill, a small light rides along with the player
    // specifically, so the one skater the camera is actually behind is never
    // just a silhouette even in the darkest corner of a map.
    playerLightIntensity: 1,
    bulbColor: 0xffdfa0,
    bulbEmissive: 1.4,
    signOpacity: 1,
    buildingOpacity: 1,
    windowOpacity: 1,
    // A wet-looking, hot specular response is what reads as "metal catching
    // a floodlight" on a MeshPhongMaterial — there is no real environment
    // map here, on purpose: rails live inside the park's one merged mesh,
    // and a cubemap reflection on that whole mesh would cost a lot of frame
    // time to buy a shine that is only visible on a fraction of its
    // vertices. This buys the same read cheaply.
    specular: 0x8fa2c9,
    shininess: 90,
    shadowStrength: 1,
    sunColor: 0xf3f1e8,      // the moon's own tint
    haloColor: 0xcfe0ff,
    cloudOpacity: 0.06,      // clouds all but gone — a moonlit wisp or two
  },
  [SUNSET]: {
    // The sun dropping low and the sky heating up: deep blue overhead, burnt
    // orange around the horizon. Sits between DAY and NIGHT — the floodlights
    // are just coming on and the street-lamp bulbs are starting to glow, but
    // it is the low sun that does the work.
    skyTop: 0x2c4468,
    skyMid: 0xc96f4a,
    skyHorizon: 0xffc08a,
    fogColor: 0xe0a67c,
    fogNear: 60,
    fogFar: 280,
    hemiSky: 0xffc9a3,
    hemiGround: 0x5a4636,
    hemiIntensity: 1.9,
    keyColor: 0xffb066,
    keyIntensity: 2.0,
    keyPos: [-10, 4, 3],
    exposure: 0.92,
    starOpacity: 0,
    moonOpacity: 0.3,        // the same disc doubles as the low sun, tinted by sunColor
    floodIntensity: 0.4,
    lampIntensity: 0.55,
    ambientIntensity: 0.25,
    playerLightIntensity: 0.25,
    bulbColor: 0xffd9a0,
    bulbEmissive: 0.6,
    signOpacity: 0.55,
    buildingOpacity: 0.6,
    windowOpacity: 0.6,
    // A warm, low sun throws the longest shadows in the game.
    specular: 0x8a7050,
    shininess: 55,
    shadowStrength: 0.6,
    sunColor: 0xffa05a,
    haloColor: 0xffc37a,
    cloudOpacity: 0.85,      // lit from below, the clouds are at their warmest
  },
};

const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

// Which preset keys are colours rather than plain numbers — hex colours are
// stored as ordinary JS numbers (0x2f6ba8), so lerping them the same way as
// an intensity would blend the raw 24-bit integer instead of the RGB
// channels it packs, which carries between channels and comes out as noise
// rather than a colour partway between the two. These get a proper
// THREE.Color.lerpColors() instead — see update().
const COLOR_KEYS = new Set(['skyTop', 'skyMid', 'skyHorizon', 'fogColor', 'hemiSky', 'hemiGround', 'keyColor', 'bulbColor', 'specular', 'sunColor', 'haloColor']);
const _lerpA = new THREE.Color();
const _lerpB = new THREE.Color();
const _lerpOut = new THREE.Color();

/** A vertical two-stop-plus-horizon sky gradient, the same technique main.js
 * used to draw a static one — just parameterised so it can be redrawn as the
 * two stops move during a fade. Tiny canvas: this is cheap enough to redraw
 * every frame a fade is actually in progress. */
function drawSky(canvas, top, mid, horizon) {
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, canvas.height);
  const hex = (c) => `#${c.getHexString()}`;
  grad.addColorStop(0, hex(top));
  grad.addColorStop(0.55, hex(mid));
  grad.addColorStop(1, hex(horizon));
  g.fillStyle = grad;
  g.fillRect(0, 0, canvas.width, canvas.height);
}

/** A soft radial glow, reused for the moon's halo, the floodlight cones' hot
 * spot and every street-lamp/sign glow sprite — one texture, many sprites. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** A soft irregular cloud: a handful of overlapping glow lobes so a flat
 * billboard reads as a cumulus puff instead of a disc. White with alpha — the
 * sprite's own opacity, set per preset, is what fades clouds out at night. */
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let a = 0x9e3779b9 >>> 0;
  const rng = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 7; i++) {
    const x = 64 + (rng() - 0.5) * 46;
    const y = 64 + (rng() - 0.5) * 26;
    const r = 20 + rng() * 24;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

/** A small tiled window-lights texture for the distant building silhouettes —
 * bright squares scattered on a dark field, so a single flat-shaded box reads
 * as "an office block with its lights on" instead of a lit slab. */
function windowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#050810';
  g.fillRect(0, 0, 64, 64);
  let a = 0x27d4eb;
  const rng = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 4; y < 64; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      if (rng() < 0.4) continue; // most windows are dark even at night
      const warm = rng() < 0.7;
      g.fillStyle = warm ? 'rgba(255,214,140,0.9)' : 'rgba(190,215,255,0.85)';
      g.fillRect(x, y, 3, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class LightingManager {
  constructor(scene, renderer, lowEnd = false) {
    this.scene = scene;
    this.renderer = renderer;
    this.lowEnd = lowEnd;
    this.mode = DAY;
    this._from = { ...PRESETS[DAY] };
    this._to = { ...PRESETS[DAY] };
    this._cur = { ...PRESETS[DAY] };
    this._t = 1; // fade progress, 1 = settled on `_to`
    // Automatic day/night cycle state.
    this._cycleActive = false;
    this._cycleElapsed = 0;

    // --- sky --------------------------------------------------------------
    this._skyCanvas = document.createElement('canvas');
    this._skyCanvas.width = 2;
    this._skyCanvas.height = 256;
    this._skyTex = new THREE.CanvasTexture(this._skyCanvas);
    this._skyTex.colorSpace = THREE.SRGBColorSpace;
    this._skyDirty = true;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, lowEnd ? 8 : 16, lowEnd ? 6 : 12),
      new THREE.MeshBasicMaterial({ map: this._skyTex, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false })
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // --- stars --------------------------------------------------------------
    // A shell of points well outside the fog and the treeline. Fixed once —
    // stars do not move relative to the sky dome — and faded by opacity only.
    const STAR_COUNT = lowEnd ? 300 : 700;
    const starPos = new Float32Array(STAR_COUNT * 3);
    let s = 0x9e3779b9 >>> 0;
    const srng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Bias toward the upper hemisphere — no point spending stars on the
      // half of the sky the ground is standing in front of.
      const u = srng();
      const v = srng() * 0.62;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v);
      const r = 390;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this._starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this._starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    scene.add(this.stars);

    // --- moon (and sun-disc reused for the same slot) ------------------------
    const glow = glowTexture();
    this._moonMat = new THREE.MeshBasicMaterial({ color: 0xf3f1e8, fog: false, transparent: true, opacity: 0 });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), this._moonMat);
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -1;
    scene.add(this.moon);
    this._haloMat = new THREE.SpriteMaterial({ map: glow, color: 0xcfe0ff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.halo = new THREE.Sprite(this._haloMat);
    this.halo.scale.set(46, 46, 1);
    this.halo.renderOrder = -1;
    scene.add(this.halo);

    // --- clouds --------------------------------------------------------------
    // A ring of soft billboards drifting slowly around the sky — sprites on one
    // shared texture, the cheapest thing that reads as weather instead of a bare
    // gradient. They sit well inside the sky dome and outside the fog's reach,
    // fade out almost entirely at night, and cost one sprite per cloud.
    this.clouds = [];
    const cloudTex = cloudTexture();
    let ca = 0x27182818 >>> 0;
    const crng = () => ((ca = (ca * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < (lowEnd ? 6 : 12); i++) {
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: cloudTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
          rotation: crng() * Math.PI,
        })
      );
      const rad = 130 + crng() * 130;
      const w = 50 + crng() * 70;
      spr.position.set(Math.cos(i * 2.399) * rad, 14 + crng() * 66, Math.sin(i * 2.399) * rad);
      spr.scale.set(w, w * (0.3 + crng() * 0.18), 1);
      spr.renderOrder = -1;
      spr.frustumCulled = false;
      this.clouds.push({ spr, rad, alpha: 0.55 + crng() * 0.35, phase: i * 2.399, speed: 0.6 + crng() * 1.4 });
      scene.add(spr);
    }

    // --- hemisphere + key light (the sun by day, the moon by night) ---------
    this.hemi = new THREE.HemisphereLight(PRESETS[DAY].hemiSky, PRESETS[DAY].hemiGround, PRESETS[DAY].hemiIntensity);
    scene.add(this.hemi);
    // A flat fill with no position or direction of its own — see
    // PRESETS.night.ambientIntensity for why this exists. Zero by day: the
    // sun and hemisphere light already do that job without it.
    this.ambient = new THREE.AmbientLight(0x9fb0d9, 0);
    scene.add(this.ambient);
    this.key = new THREE.DirectionalLight(PRESETS[DAY].keyColor, PRESETS[DAY].keyIntensity);
    this.key.position.set(...PRESETS[DAY].keyPos);
    scene.add(this.key);
    // The key light's shadow follows the player rather than covering the
    // whole park — a tight frustum stays crisp at a resolution any phone can
    // afford, and nothing sits still long enough for a fixed one's edges to
    // matter. Shadows are opted into per-object in setShadowCasters(), and
    // castShadow itself only turns on once the night fade has actually begun
    // (see update()), so daytime pays nothing extra at all.
    this.key.castShadow = false;
    this.key.shadow.mapSize.set(lowEnd ? 512 : 1024, lowEnd ? 512 : 1024);
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = lowEnd ? 40 : 60;
    const shadowExtent = lowEnd ? 12 : 18;
    this.key.shadow.camera.left = -shadowExtent;
    this.key.shadow.camera.right = shadowExtent;
    this.key.shadow.camera.top = shadowExtent;
    this.key.shadow.camera.bottom = -shadowExtent;
    this.key.shadow.camera.updateProjectionMatrix();
    this.key.shadow.bias = -0.0025;
    this.key.target.position.set(0, 0, 0);
    scene.add(this.key.target);
    this._keyOffset = new THREE.Vector3(...PRESETS[DAY].keyPos);

    // --- a small light that rides along with the player ---------------------
    // Not attached to the rider's own frame — following its world position
    // each frame instead means it survives dismounting, bailing and walking
    // without needing to be re-parented through every one of those states.
    // It hangs *behind* the rider, on the camera's side (see update()), and
    // stays short-range — a tight fill for the one skater the camera is
    // behind, not a broad overhead wash that hides the board's neon under glow.
    this.playerLight = new THREE.PointLight(0xdfe8ff, 0, 6, 1.6);
    scene.add(this.playerLight);

    // --- floodlights ----------------------------------------------------------
    // Two is enough to sell "the lights are on" over the whole pad without
    // paying for a light per corner — every extra light in the scene is
    // extra per-fragment cost on every lit material, park mesh included.
    this.floodlights = [0, 1].map(() => {
      const light = new THREE.SpotLight(0xdff0ff, 0, 90, Math.PI / 4.4, 0.55, 1.4);
      light.castShadow = false; // the key light already owns the one shadow map this scene affords
      scene.add(light);
      scene.add(light.target);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 1, 6),
        new THREE.MeshBasicMaterial({ color: 0x2b2f36, fog: false })
      );
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xdff0ff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      head.scale.set(3.2, 3.2, 1);
      scene.add(pole);
      scene.add(head);
      return { light, pole, head };
    });

    // --- distant building silhouettes, lit windows only at night -------------
    this._winTex = windowTexture();
    this._buildingMat = new THREE.MeshBasicMaterial({ map: this._winTex, color: 0x0b1220, fog: true, transparent: true, opacity: 0 });
    this.buildings = new THREE.Mesh(new THREE.BufferGeometry(), this._buildingMat);
    this.buildings.frustumCulled = false;
    this.buildings.renderOrder = -1;
    scene.add(this.buildings);

    // --- an illuminated entrance sign -----------------------------------------
    this._signTex = null; // built per park, in setPark(), once its name is known
    this._signMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: false });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), this._signMat);
    this.sign.frustumCulled = false;
    scene.add(this.sign);

    // Set by setPark(): the lamp bulb material each park already builds for
    // its street-lamp heads, so night can light them up and day can leave
    // them dark instead of the same flat cream at every hour. Also every
    // glow sprite standing in for the lamps' actual light — see setPark().
    this.parkMaterials = [];
    this._lampGlows = [];
    this._lampLights = [];

    this._applyImmediate(PRESETS[DAY]);
  }

  /**
   * Re-anchor everything that depends on a park's own footprint: the
   * floodlight poles at two opposite corners, the building ring beyond the
   * treeline, the entrance sign, and a lit-up copy of every street lamp the
   * park itself already placed. Called once per `loadPark()`.
   */
  setPark(park) {
    this.park = park;
    const ex = park.extentX;
    const ez = park.extentZ;

    // Floodlights: opposite corners, angled in and down at the pad centre.
    const corners = [
      [-ex - 3, ez + 3],
      [ex + 3, -ez - 3],
    ];
    this.floodlights.forEach(({ light, pole, head }, i) => {
      const [x, z] = corners[i];
      const y = 8.5;
      light.position.set(x, y, z);
      light.target.position.set(x * 0.35, 0, z * 0.35);
      pole.position.set(x, y / 2, z);
      pole.scale.set(1, y, 1);
      head.position.set(x, y + 0.3, z);
    });

    // Distant buildings: a handful of boxes on a ring past the treeline,
    // deterministic per park (same seed the treeline itself uses) so the
    // skyline does not reshuffle every time night fades in.
    const entries = [];
    let a = (park.def.seed || 0x51ed) ^ 0xb17e;
    const rng = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ring = Math.max(ex, ez) + 46;
    const count = this.lowEnd ? 4 : 8;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rng() * 0.4;
      const rad = ring + rng() * 40;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad * 0.85;
      const w = 6 + rng() * 8;
      const h = 12 + rng() * 34;
      const d = 6 + rng() * 8;
      entries.push({
        geo: BOX,
        color: 0xffffff,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, h / 2, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0)),
          new THREE.Vector3(w, h, d)
        ),
      });
    }
    this.buildings.geometry.dispose();
    this.buildings.geometry = mergeSimple(entries);

    // Entrance sign, lettered with the park's own name, hung on the fence
    // nearest its spawn point.
    this._signTex?.dispose();
    this._signTex = signTexture(park.name);
    this._signMat.map = this._signTex;
    this._signMat.color.set(0xffffff);
    const sx = Math.sign(park.spawn.x) || 1;
    const signX = park.noFence ? 0 : sx * ex * 0.55;
    const signZ = park.noFence ? -ez * 0.4 : -ez - 1.1;
    this.sign.position.set(signX, 3.4, signZ);
    this.sign.rotation.y = park.noFence ? 0 : Math.PI;

    // Light up the park's own street-lamp bulbs at night: each one gets a
    // small downward spotlight of its own, on top of the glow sprite that
    // sells the bulb itself. More real lights than the two floodlights
    // alone, so if this park has more than a handful of lamps only the
    // nearest LAMP_LIGHT_CAP get a real light — the rest keep their glow
    // sprite, which is still visibly "on" without adding to the per-fragment
    // light count everything in the scene pays for.
    this.parkMaterials = [park.material, park.sceneryMaterial, park.sceneryInstanceMaterial].filter(Boolean);
    this._bulbMaterial = park.bulbMaterial || null;
    for (const g of this._lampGlows) this.scene.remove(g);
    for (const l of this._lampLights) {
      this.scene.remove(l.target);
      this.scene.remove(l);
    }
    const lampSpots = park.lampPositions || [];
    this._lampGlows = lampSpots.map(([x, y, z]) => {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTextureCache(), color: 0xffdfa0, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      spr.scale.set(1.4, 1.4, 1);
      spr.position.set(x, y - 0.1, z);
      this.scene.add(spr);
      return spr;
    });
    const LAMP_LIGHT_CAP = this.lowEnd ? 3 : 8;
    this._lampLights = lampSpots.slice(0, LAMP_LIGHT_CAP).map(([x, y, z]) => {
      const light = new THREE.SpotLight(0xffdfa0, 0, 11, Math.PI / 3.4, 0.65, 1.6);
      light.position.set(x, y, z);
      light.target.position.set(x, park.heightAt(x, z), z);
      this.scene.add(light);
      this.scene.add(light.target);
      return light;
    });

    this._applyToMaterials(this._cur);
  }

  /** Which objects actually draw into the one shadow map this scene affords —
   * the rider and every AI skater, not the park itself. A park's concrete is
   * flat and unoccluded from directly above at the angle the moon sits at, so
   * it would receive a shadow but almost never cast one worth the draw call. */
  setShadowCasters(meshes) {
    this._casters = meshes;
  }

  /** Begin a crossfade to `mode` ('day' | 'sunset' | 'night'). `instant` skips
   * the fade — used only for the very first frame, so the game does not
   * visibly brighten or dim on load depending on the saved preference. */
  setMode(mode, instant = false) {
    if (!PRESETS[mode]) return;
    if (mode === this.mode && this._t >= 1 && !instant) return;
    this.mode = mode;
    this._from = { ...this._cur };
    this._to = PRESETS[mode];
    this._t = instant ? 1 : 0;
    if (instant) this._applyImmediate(this._to);
  }

  _applyImmediate(preset) {
    Object.assign(this._cur, preset);
    this._skyDirty = true;
    this._applyAll(this._cur);
  }

  /** Start the automatic day/night cycle. DAY→SUNSET→NIGHT→DAY over
   *  CYCLE_SECONDS (10 min), repeating forever. */
  startCycle() {
    this._cycleActive = true;
    this._cycleElapsed = 0;
    this.setMode(DAY, true);
  }

  /** Stop the cycle, freezing at whatever preset is current. */
  stopCycle() {
    this._cycleActive = false;
  }

  update(dt, followPos, cameraPos) {
    // Automatic cycle: advance the timer and switch presets at boundaries.
    if (this._cycleActive) {
      this._cycleElapsed += dt;
      const t = (this._cycleElapsed % CYCLE_SECONDS) / CYCLE_SECONDS;
      // 0–0.33 → DAY, 0.33–0.66 → SUNSET, 0.66–1.0 → NIGHT
      let next;
      if (t < 1 / 3) next = DAY;
      else if (t < 2 / 3) next = SUNSET;
      else next = NIGHT;
      if (next !== this.mode) this.setMode(next);
    }

    if (this._t < 1) {
      this._t = Math.min(1, this._t + dt / FADE_SECONDS);
      const k = smoothstep(this._t);
      for (const key in this._to) {
        const a = this._from[key];
        const b = this._to[key];
        if (COLOR_KEYS.has(key)) {
          _lerpA.set(a);
          _lerpB.set(b);
          _lerpOut.copy(_lerpA).lerp(_lerpB, k);
          this._cur[key] = _lerpOut.getHex();
        } else if (Array.isArray(b)) {
          this._cur[key] = a.map((v, i) => lerp(v, b[i], k));
        } else if (typeof b === 'number') {
          this._cur[key] = lerp(a, b, k);
        } else {
          this._cur[key] = b;
        }
      }
      this._skyDirty = true;
      this._applyAll(this._cur, this._from, k);
    }

    // The key light (sun/moon) and its shadow frustum stay centred on
    // wherever the player actually is, so a 36 m-wide shadow camera reads as
    // sharp everywhere instead of soft everywhere over a park several times
    // that size.
    if (followPos) {
      this.key.target.position.copy(followPos);
      this.key.position.set(
        followPos.x + this._keyOffset.x,
        followPos.y + this._keyOffset.y,
        followPos.z + this._keyOffset.z
      );
      // The player's fill hangs behind and above the rider instead of straight
      // on top of them — a light sitting directly over the skater washes the
      // character out and drowns the pool of neon the board throws onto the
      // ground beneath it. Filling from the camera's side still does the job
      // the light exists for (the rider never reads as a silhouette in a dark
      // corner) while the deck and its under glow stay out of the brightest
      // part of the falloff.
      const fillDir = this._fillDir || (this._fillDir = new THREE.Vector3());
      if (cameraPos && cameraPos.distanceToSquared(followPos) > 1e-6) {
        fillDir.subVectors(followPos, cameraPos).setY(0).normalize();
      } else {
        fillDir.set(0, 0, 1); // no camera info (e.g. a test-locked camera): fixed direction
      }
      this.playerLight.position.set(
        followPos.x + fillDir.x * PLAYER_FILL_BACK,
        followPos.y + PLAYER_FILL_UP,
        followPos.z + fillDir.z * PLAYER_FILL_BACK
      );
      const wantShadow = this._cur.shadowStrength > 0.02;
      if (this.key.castShadow !== wantShadow) this.key.castShadow = wantShadow;
      if (this._casters) {
        for (const m of this._casters) if (m.castShadow !== wantShadow) m.castShadow = wantShadow;
      }
    }

    // The moon (and its halo) sit in the direction the key light comes from,
    // far enough out to clear the sky dome's own radius.
    const dir = this._tmpDir || (this._tmpDir = new THREE.Vector3());
    dir.set(this._cur.keyPos[0], this._cur.keyPos[1], this._cur.keyPos[2]).normalize().multiplyScalar(380);
    this.moon.position.copy(dir);
    this.halo.position.copy(dir);

    // Clouds drift slowly around the sky on their own ring — fast enough to
    // notice on a long run, slow enough to feel like weather.
    for (const c of this.clouds) {
      c.phase -= c.speed * dt * 0.005;
      c.spr.position.x = Math.cos(c.phase) * c.rad;
      c.spr.position.z = Math.sin(c.phase) * c.rad;
    }

    if (this._skyDirty) {
      drawSky(this._skyCanvas, colorOf(this._cur.skyTop), colorOf(this._cur.skyMid), colorOf(this._cur.skyHorizon));
      this._skyTex.needsUpdate = true;
      this._skyDirty = this._t < 1; // keep redrawing only while actually mid-fade
    }
  }

  _applyAll(cur) {
    this.renderer.setClearColor(colorOf(cur.skyHorizon), 1);
    this.renderer.toneMappingExposure = cur.exposure;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(cur.fogColor, cur.fogNear, cur.fogFar);
    this.scene.fog.color.copy(colorOf(cur.fogColor));
    this.scene.fog.near = cur.fogNear;
    this.scene.fog.far = cur.fogFar;

    this.hemi.color.copy(colorOf(cur.hemiSky));
    this.hemi.groundColor.copy(colorOf(cur.hemiGround));
    this.hemi.intensity = cur.hemiIntensity;
    this.ambient.intensity = cur.ambientIntensity;

    this.key.color.copy(colorOf(cur.keyColor));
    this.key.intensity = cur.keyIntensity;
    this._keyOffset.set(cur.keyPos[0], cur.keyPos[1], cur.keyPos[2]);
    this.playerLight.intensity = cur.playerLightIntensity * 8;

    this._starMat.opacity = cur.starOpacity;
    this._moonMat.color.copy(colorOf(cur.sunColor));
    this._moonMat.opacity = cur.moonOpacity;
    this._haloMat.color.copy(colorOf(cur.haloColor));
    this._haloMat.opacity = cur.moonOpacity * 0.8;
    for (const c of this.clouds) c.spr.material.opacity = cur.cloudOpacity * c.alpha;

    this.floodlights.forEach(({ light, head }) => {
      const intensityMul = this.lowEnd ? 0.6 : 1;
      light.intensity = cur.floodIntensity * 55 * intensityMul;
      head.material.opacity = cur.floodIntensity * 0.9;
    });

    this._buildingMat.opacity = cur.buildingOpacity * 0.92;
    this._signMat.opacity = Math.max(cur.signOpacity, 0.08);

    for (const g of this._lampGlows) g.material.opacity = cur.floodIntensity;
    for (const l of this._lampLights) l.intensity = cur.lampIntensity * 9;
    if (this._bulbMaterial) this._bulbMaterial.color.copy(colorOf(cur.bulbColor));

    this._applyToMaterials(cur);
  }

  /** The subtle "wet metal" specular bump described at PRESETS.night.specular —
   * applied to whichever park is currently loaded, since rails live inside
   * that park's one shared, merged material rather than owning one each. */
  _applyToMaterials(cur) {
    for (const mat of this.parkMaterials) {
      if (!mat) continue;
      mat.specular.copy(colorOf(cur.specular));
      mat.shininess = cur.shininess;
    }
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
let _glowCache = null;
function glowTextureCache() {
  if (!_glowCache) _glowCache = glowTexture();
  return _glowCache;
}

const _colorScratch = new THREE.Color();
function colorOf(v) {
  return _colorScratch.set(v);
}

/** A minimal stand-in for geo.js's merge() — building boxes need no vertex
 * colour (their texture carries all of it), so this skips the colour
 * attribute entirely rather than pulling in the ground-mesh machinery. */
function mergeSimple(entries) {
  let total = 0;
  const parts = entries.map((e) => {
    const g = e.geo.toNonIndexed();
    g.applyMatrix4(e.matrix);
    total += g.attributes.position.count;
    return g;
  });
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    // Planar-ish UVs are unnecessary here — box UVs are fine at building
    // scale, where one face is one wall and one wall gets one texture tile.
    uv.set(g.attributes.uv.array, o * 2);
    o += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** The entrance sign's own texture: the park's name, glowing, on a dark panel. */
function signTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0d12';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,220,150,0.7)';
  g.lineWidth = 6;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#ffdc96';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,214,140,0.9)';
  g.shadowBlur = 18;
  g.fillText(name.toUpperCase(), c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

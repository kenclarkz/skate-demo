// Fast visual iteration for the skate game: load it once, pose the skater at a
// few moments that matter, and save a screenshot of each.
//
//   npx http-server /workspace -p 8080 -c-1 &
//   node tools/skate-shot.mjs
//
// The poses here are chosen to be the ones that break: a ride stance (is the
// stance right?), mid-ollie (does the board pitch under the feet?), mid-kickflip
// (has the rider's body stayed put while the board goes round?), a grind (is the
// deck on the rail?), a push (is the foot on the ground?) and a slam.

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, GL_ARGS } from './pw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE || 'http://localhost:8080/skate';
const OUT = join(ROOT, '.smoke');
const only = process.argv[2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const chromium = await loadChromium();
const browser = await chromium.launch({ args: GL_ARGS });
const context = await browser.newContext({
  viewport: { width: 900, height: 560 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  console: ${m.text()}`));

await page.goto(`${BASE}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
await page.evaluate(() => window.__skate.start());

/** Each shot: a name, and a function run in the page to set the moment up. */
const shots = {
  'ride': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 5.5);
    g.hold(1.2);
  },
  'carve': () => {
    const g = window.__skate;
    g.place(0, -16, 0, 7);
    g.hold(1.4, { steer: 1 });
  },
  'push': () => {
    const g = window.__skate;
    g.place(0, -16, 0, 2.4);
    g.drive(1 / 120, { push: true });
    g.hold(0.26);
  },
  'charge': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 5);
    g.hold(0.42, { charge: true });
  },
  'ollie': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 5);
    g.hold(0.4, { charge: true });
    g.drive(1 / 120, { trick: 'ollie' });
    g.hold(0.14);
  },
  'kickflip': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 5);
    g.hold(0.4, { charge: true });
    g.drive(1 / 120, { trick: 'kickflip' });
    g.hold(0.2);
  },
  'manual': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 4);
    g.hold(0.9, { charge: true });
  },
  'grind': () => {
    const g = window.__skate;
    // Roll at the flat bar, ollie, and let the board find it. (The park is
    // 2x scale — see TRACK_SCALE in park.js — so the bar itself now sits at
    // x = -20.)
    g.place(-20, -14, 0, 6.5);
    g.hold(0.3, { charge: true });
    g.drive(1 / 120, { trick: 'ollie' });
    g.hold(1.1);
  },
  'transition': () => {
    const g = window.__skate;
    // The transition's own base is at z = 40 now (TRACK_SCALE); keep the
    // same 6 m runway into it.
    g.place(0, 34, 0, 8.5);
    g.hold(1.0);
  },
  'air': () => {
    const g = window.__skate;
    // Straight at the big quarterpipe, fast enough to fly out of the lip —
    // same 10 m runway, out from the ramp's new base at z = 40.
    g.place(0, 30, 0, 11);
    g.hold(1.5);
  },
  'bail': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 8);
    g.slam('slide-out');
  },
  // A slam out of the air, caught while the rider is still coming down.
  'bail-air': () => {
    const g = window.__skate;
    g.place(0, -14, 0, 8);
    g.drive(1 / 120, { trick: 'treflip', trickCharge: 1 });
    g.hold(0.25);
    g.slam('primo');
  },
  'menu': () => {
    window.__skate.hud.show('start');
  },
  'guide': () => {
    window.__skate.hud.show('guide');
  },
  // The tutorial's own live demo, mid-trick — a second scene, not a
  // screenshot, so it has to stay live rather than being frozen like the
  // shots that pose the main rig.
  'guide-kickflip': () => {
    const g = window.__skate;
    g.hud.show('guide');
    g.hud.showTutStep(3); // Kickflip
  },
  'guide-grind': () => {
    const g = window.__skate;
    g.hud.show('guide');
    g.hud.showTutStep(18); // Grinds
  },
  'parks': () => {
    const g = window.__skate;
    g.hud.renderParks(g.parks, g.park.id);
    g.hud.show('parks');
  },
  // A wide shot of the home park with its ambient cast in frame: the AI
  // skaters, a bird overhead, and a logo waiting to be picked up.
  'crowd': () => {
    const g = window.__skate;
    g.switchPark('home');
    g.place(0, -10, 0, 0);
    g.hold(0.1);
  },
  'bowl': () => {
    const g = window.__skate;
    g.switchPark('bowl');
    g.place(0, -12, 0, 6);
    g.hold(1.2);
  },
  'bigair': () => {
    const g = window.__skate;
    g.switchPark('bigair');
    g.place(0, -18, 0, 9);
    g.hold(1.4);
  },
  'pool': () => {
    const g = window.__skate;
    g.switchPark('pool');
    // Placed inside the bowl's own flat interior, not out on the approach —
    // the walls' decks are only tangent on their inward face, same as bowl's.
    g.place(0, 0, 0, 6);
    g.hold(1.2);
  },
  'rooftop': () => {
    const g = window.__skate;
    g.switchPark('rooftop');
    g.place(0, -14, 0, 7);
    g.hold(1.1);
  },
  'snake': () => {
    const g = window.__skate;
    g.switchPark('snake');
    g.place(0, -16, 0, 6);
    g.hold(1.4);
  },
  'schoolyard': () => {
    const g = window.__skate;
    g.switchPark('schoolyard');
    g.place(0, -16, 0, 6);
    g.hold(1.2);
  },
  'docks': () => {
    const g = window.__skate;
    g.switchPark('docks');
    g.place(0, -18, 0, 7);
    g.hold(1.2);
  },
  // Off the board: the walk cycle mid-stride, and the standard freeze() below
  // would snap the camera onto the parked board's `ride` rather than the
  // walker, so these stay live instead.
  'walk': () => {
    const g = window.__skate;
    g.switchPark('home');
    g.unfreeze();
    g.place(0, -14, 0, 0);
    g.dismount();
    for (let i = 0; i < 60; i++) {
      g.walker.update(1 / 60, { x: 0, y: 1 });
      g.skater.poseWalk(g.walker, 1 / 60);
    }
    // The live loop's own chase camera has not seen the walker yet — snap it
    // straight there instead of easing over from wherever the last shot left it.
    g.chase.ready = false;
  },
  'sit': () => {
    const g = window.__skate;
    g.switchPark('home');
    g.unfreeze();
    g.place(0, -14, 0, 0);
    g.dismount();
    // Step clear of the parked board first, or its mesh sits right where the
    // sitting pose's legs go and the two overlap in frame.
    for (let i = 0; i < 45; i++) {
      g.walker.update(1 / 60, { x: 0, y: 1 });
      g.skater.poseWalk(g.walker, 1 / 60);
    }
    g.sit();
    for (let i = 0; i < 90; i++) {
      g.walker.update(1 / 60, { x: 0, y: 0 });
      g.skater.poseWalk(g.walker, 1 / 60);
    }
    g.chase.ready = false;
  },
  'store': () => {
    const g = window.__skate;
    g.save.addCoins(600);
    g.hud.renderBoards(g.boardTypes, g.boards, g.save);
    g.hud.renderOutfits(g.outfits, g.save);
    g.hud.show('store');
  },
  'glow': () => {
    const g = window.__skate;
    g.save.addCoins(500);
    g.selectOutfit('neon'); // the brightest shirt, so the effect is obvious
    g.place(0, -16, 0, 12);
    g.hold(0.4);
  },
};

/** Shots that want the sim left running after they are set up. */
const LIVE = new Set(['bail', 'bail-air', 'walk', 'sit', 'guide-kickflip', 'guide-grind']);
/** ...and shots that must not be frozen, because freezing hides the overlay. */
const NO_FREEZE = new Set([...LIVE, 'menu', 'guide', 'parks', 'store']);

/**
 * Close-up framings, for reading the rig rather than the park. The offsets are
 * relative to the board, and the pose was already frozen by the time they apply.
 */
const CLOSE = {
  ride: [2.0, 1.0, 1.3, 0.85],
  carve: [2.2, 1.0, 1.2, 0.85],
  // From the toe side, because that is the side the pushing foot goes down on,
  // and framed low so the planted foot is not behind the debug panel.
  push: [-2.4, 1.5, 0.9, 0.45],
  charge: [2.0, 0.9, 1.2, 0.8],
  ollie: [2.2, 1.1, 1.2, 0.85],
  kickflip: [1.8, 1.0, 1.6, 0.85],
  manual: [2.2, 1.0, 1.2, 0.8],
  grind: [2.4, 1.1, 1.4, 0.85],
  feet: [-1.5, 1.2, 0.5, 0.3],
  glow: [1.6, 0.95, 1.0, 0.95],
};

for (const [name, fn] of Object.entries(shots)) {
  if (only && name !== only) continue;
  await page.evaluate(() => window.__skate.unfreeze());
  await page.evaluate(fn);
  // Freeze first, or the game's own loop carries on for the whole of the sleep
  // below and every shot ends up being of a skater rolling along the flat.
  if (!NO_FREEZE.has(name)) await page.evaluate(() => window.__skate.freeze());
  // Let the render loop and the camera spring catch up with the new pose.
  await sleep(LIVE.has(name) ? (name === 'bail-air' ? 380 : 900) : 300);
  await page.screenshot({ path: join(OUT, `skate-${name}.png`) });
  if (CLOSE[name]) {
    await page.evaluate((o) => window.__skate.inspect(o[0], o[1], o[2], o[3]), CLOSE[name]);
    await sleep(140);
    await page.screenshot({ path: join(OUT, `skate-${name}-close.png`) });
  }
  const info = await page.evaluate(() => {
    const r = window.__skate.ride;
    return `${['ground', 'air', 'grind', 'bail'][r.mode]} v=${r.speed.toFixed(2)} y=${r.pos.y.toFixed(2)}`;
  });
  console.log(`  ${name.padEnd(12)} ${info}`);
}

await browser.close();

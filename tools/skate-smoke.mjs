// Headless smoke test for the skate game.
//
//   npx http-server /workspace -p 8080 -c-1 &
//   node tools/skate-smoke.mjs
//
// Note the server root: the site is served from the /skate/ subpath in
// production, so it has to be served that way here too. Serving the repo root at
// / lets every absolute-path bug pass locally and 404 on GitHub Pages.
//
// Most of what follows checks physics rather than pixels, and it checks it against
// arithmetic done here in the test rather than against numbers recorded from the
// game. A ballistic apex really is v²/2g and a carve radius really is v²/g·tanθ,
// so if the model has drifted away from those the test says so — which is the
// only way a claim like "the movement is realistic" can be kept honest as the code
// changes.

import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, GL_ARGS } from './pw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE || 'http://localhost:8080/skate';
const SHOTS = process.env.SMOKE_SHOTS || join(ROOT, '.smoke');

let failures = 0;
let checks = 0;

function ok(cond, msg) {
  checks++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

/** Within `tol` as a fraction of the expected value. */
function near(actual, expected, tol, msg) {
  const off = Math.abs(actual - expected) / Math.max(1e-6, Math.abs(expected));
  ok(off <= tol, `${msg} (got ${actual.toFixed(3)}, expected ${expected.toFixed(3)}, ${(off * 100).toFixed(1)}% off)`);
}

function section(name) {
  console.log(`\n${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
section('Absolute-path audit');
{
  // A leading slash works locally under a naive server and 404s on a project
  // site. This is the cheapest high-value check in the file.
  const files = [
    'index.html',
    'sw.js',
    'css/skate.css',
    ...readdirSync(join(ROOT, 'js/skate')).map((f) => `js/skate/${f}`),
  ];
  const BAD = [/src\s*=\s*["']\//, /href\s*=\s*["']\//, /"\/[a-z]/i, /'\/[a-z]/i, /url\(\s*\//];
  const offenders = [];
  for (const f of files) {
    readFileSync(join(ROOT, f), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const code = line
          .replace(/https?:\/\/\S*/g, '')
          // this.api(...) carries Spotify REST paths like '/me/player' — real
          // API routes, not page assets, so they must not trip the asset audit.
          .replace(/this\.api\([^)]*\)/g, '')
          .replace(/\/\/.*$/, '');
        if (BAD.some((re) => re.test(code))) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  ok(offenders.length === 0, `no absolute paths${offenders.length ? `\n       ${offenders.join('\n       ')}` : ''}`);
}

// --------------------------------------------------------------------------
const chromium = await loadChromium();
const browser = await chromium.launch({ args: GL_ARGS });
mkdirSync(SHOTS, { recursive: true });
const context = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.goto(`${BASE}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });

/** Run a function inside the page with the simulation under our control. */
const run = (fn, arg) => page.evaluate(fn, arg);

await run(() => {
  window.__skate.start();
  window.__skate.freeze(); // the test drives every step itself
});

// --------------------------------------------------------------------------
section('Boot');
{
  const info = await run(() => ({
    tris: window.__skate.renderer.info.render.triangles,
    calls: window.__skate.renderer.info.render.calls,
    grinds: window.__skate.park.grinds.length,
    features: window.__skate.park.features.length,
  }));
  ok(info.tris > 2000, `the park is drawing (${info.tris} triangles)`);
  // The park itself is still two merged draw calls; the rest of the count is
  // the AI skaters, the birds and the six logos, none of which are merged
  // because each one needs its own transform every frame.
  ok(info.calls <= 220, `and in a bounded number of draw calls (${info.calls})`);
  ok(info.features >= 14, `the park has its obstacles (${info.features} surfaces)`);
  ok(info.grinds >= 8, `and its grindable lines (${info.grinds})`);
}

// --------------------------------------------------------------------------
section('The surface');
{
  // A transition has to be tangent to the flat where it starts, or the bottom of
  // the ramp is a kink that stops you dead. Walk a line into the big
  // quarterpipe and check both the height and the slope stay continuous.
  const walk = await run(() => {
    const g = window.__skate;
    const out = [];
    // 1 cm samples from the flat, up the whole transition, and onto the deck.
    // The transition's own base sits at z = 40 now (TRACK_SCALE doubled it
    // along with everything else horizontal), but its curve — and the deck's
    // own length behind the lip — is unchanged, so the window just follows
    // the base out rather than growing to match.
    for (let z = 39; z <= 49; z += 0.01) out.push(+g.park.heightAt(0, z).toFixed(6));
    return out;
  });
  let maxStep = 0;
  for (let i = 1; i < walk.length; i++) maxStep = Math.max(maxStep, Math.abs(walk[i] - walk[i - 1]));
  // The lip is about 70°, which is 0.028 m per centimetre. Anything much over
  // that is a wall, not a ramp — including the join onto the deck behind it.
  ok(maxStep < 0.05, `no step anywhere up the transition or onto its deck (biggest ${maxStep.toFixed(4)} m per cm)`);

  // Tangency at the base: the first centimetre of a circular transition is
  // essentially flat, and a ramp that starts at an angle is a ramp you hit.
  const base = await run(() => {
    const g = window.__skate;
    return [g.park.heightAt(0, 39.99), g.park.heightAt(0, 40.01), g.park.heightAt(0, 40.1)];
  });
  ok(base[0] === 0, 'the flat in front of the ramp is flat');
  ok(base[1] < 0.0005, `and the ramp leaves it tangentially (${base[1].toFixed(5)} m after 1 cm)`);
  ok(base[2] > 0 && base[2] < 0.01, `and only then starts to climb (${base[2].toFixed(4)} m after 10 cm)`);
}

// --------------------------------------------------------------------------
section('Rolling');
{
  // Coasting: a skateboard on smooth concrete keeps going a long way. The check
  // is that it decays smoothly and never gains energy on the flat.
  const roll = await run(() => {
    const g = window.__skate;
    // x = -33 is a clear lane: east of the kicker and the west bank, west of
    // the north-south flat bar, and clear of the east-west flat bar, the
    // spine, the funbox and both quarterpipes right down the pad — the park's
    // own footprint is 2x scale (see TRACK_SCALE in park.js), so every
    // feature sits twice as far out as its name alone would suggest, and the
    // spine alone blocks x = -10 where this test used to run.
    g.place(-33,-18, 0, 8);
    const samples = [];
    for (let i = 0; i < 4; i++) {
      g.hold(1);
      samples.push(g.ride.speed);
    }
    return samples;
  });
  ok(roll.every((v, i) => i === 0 || v < roll[i - 1]), `coasting only ever slows (${roll.map((v) => v.toFixed(2)).join(' → ')})`);
  ok(roll[0] < 8 && roll[0] > 7, 'and loses less than a metre per second in the first one');
  ok(roll[3] > 4, 'and still rolls after four seconds');

  // Four pushes should already feel fast, and pushing still has a ceiling:
  // legs only move so fast.
  const early = await run(() => {
    const g = window.__skate;
    g.place(-33,-18, 0, 0);
    for (let i = 0; i < 4; i++) {
      g.drive(1 / 120, { push: true });
      g.hold(0.5);
    }
    return g.ride.speed;
  });
  ok(early > 8, `four pushes is already fast (${early.toFixed(2)} m/s)`);

  const pushed = await run(() => {
    const g = window.__skate;
    g.place(-33,-18, 0, 0);
    // Eleven pushes, each started the moment the last cycle ends.
    for (let i = 0; i < 11; i++) {
      g.drive(1 / 120, { push: true });
      g.hold(0.5);
    }
    return g.ride.speed;
  });
  ok(pushed > early, `and more pushes keep building speed (${pushed.toFixed(2)} m/s)`);
  ok(pushed < 16, 'and cannot push past what a leg can do');

  const rough = await run(() => {
    const g = window.__skate;
    g.place(-10,-18, 0, 6);
    const before = g.ride.speed;
    g.hold(1.5);
    const paved = g.ride.speed;
    // Well outside the park, on the dirt.
    g.place(0, 40, 0, 6);
    g.hold(1.5);
    return { paved: before - paved, dirt: before - g.ride.speed };
  });
  ok(rough.dirt > rough.paved * 2, `dirt is much slower than concrete (${rough.dirt.toFixed(2)} vs ${rough.paved.toFixed(2)} m/s lost)`);
}

// --------------------------------------------------------------------------
section('Braking');
{
  // Dragging the back foot scrubs the run down and stops the board dead,
  // without the sideways scrape of a slide.
  const stopped = await run(() => {
    const g = window.__skate;
    g.place(-10, -18, 0, 10);
    g.hold(0.2);
    const before = g.ride.speed;
    for (let i = 0; i < 240; i++) g.drive(1 / 120, { brake: true });
    return { before, after: g.ride.speed };
  });
  ok(stopped.before > 9, `rolling at speed (${stopped.before.toFixed(2)} m/s)`);
  ok(stopped.after === 0, `and braking stops the board dead (${stopped.before.toFixed(2)} → ${stopped.after.toFixed(2)})`);

  // The brake is signed off travel, so riding fakie it bites the same way.
  const back = await run(() => {
    const g = window.__skate;
    g.place(-10, -16, 0, -6);
    g.hold(0.2);
    const before = g.ride.speed;
    for (let i = 0; i < 240; i++) g.drive(1 / 120, { brake: true });
    return { before, after: g.ride.speed };
  });
  ok(back.before < -5, `rolling fakie (${back.before.toFixed(2)} m/s)`);
  ok(back.after === 0, `and braking stops it the same way (${back.before.toFixed(2)} → ${back.after.toFixed(2)})`);

  // A brake that also tries to push cannot win — the push is refused while
  // the back foot is dragging.
  const noPush = await run(() => {
    const g = window.__skate;
    g.place(-10, -18, 0, 2);
    const before = g.ride.speed;
    for (let i = 0; i < 40; i++) g.drive(1 / 120, { brake: true, push: true });
    return { before, after: g.ride.speed };
  });
  ok(noPush.after < noPush.before, `and pushing while braking does not help (${noPush.before.toFixed(2)} → ${noPush.after.toFixed(2)})`);

  // Releasing the brake lets the run roll away again — a stop is not a lock.
  const rollAgain = await run(() => {
    const g = window.__skate;
    g.place(-10, -18, 0, 8);
    for (let i = 0; i < 240; i++) g.drive(1 / 120, { brake: true });
    const stopped = g.ride.speed;
    for (let i = 0; i < 60; i++) g.drive(1 / 120, { push: true });
    return { stopped, after: g.ride.speed };
  });
  ok(rollAgain.stopped === 0, 'the board comes to a dead stop');
  ok(rollAgain.after > 0.5, `and rolls away again once the brake lets go (${rollAgain.after.toFixed(2)} m/s)`);
}

// --------------------------------------------------------------------------
section('Carving');
{
  // The claim being tested: a lean of θ commits the rider to a lateral
  // acceleration of g·tanθ, so the turn radius is v²/(g·tanθ). That relation is
  // the whole steering model, and this is the check that it is still true.
  const carve = await run(() => {
    const g = window.__skate;
    const out = [];
    for (const speed of [4, 7, 10]) {
      g.place(-10,-18, 0, speed);
      g.hold(1.2, { steer: 1 }); // let the lean settle first
      const yaw0 = g.ride.yaw;
      const v = g.ride.speed;
      const lean = g.ride.lean;
      g.hold(0.5, { steer: 1 });
      const rate = Math.abs(g.ride.yaw - yaw0) / 0.5;
      out.push({ v, lean, radius: v / rate });
    }
    return out;
  });
  for (const c of carve) {
    const ideal = (c.v * c.v) / (9.81 * Math.abs(Math.tan(c.lean)));
    near(c.radius, ideal, 0.22, `at ${c.v.toFixed(1)} m/s the radius follows v²/g·tanθ`);
  }
  ok(
    carve[0].radius < carve[1].radius && carve[1].radius < carve[2].radius,
    `and a faster carve is a wider one (${carve.map((c) => c.radius.toFixed(1)).join(' < ')} m)`
  );

  // A hard carve scrubs speed. Without this, turning would be free.
  const scrub = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 8);
    g.hold(1.5);
    const straight = g.ride.speed;
    g.place(-10,-20, 0, 8);
    g.hold(1.5, { steer: 1 });
    return { straight, carved: g.ride.speed };
  });
  ok(scrub.carved < scrub.straight - 0.2, `carving costs speed (${scrub.carved.toFixed(2)} vs ${scrub.straight.toFixed(2)} m/s)`);

  // A powerslide: the board is kicked across the direction of travel, so it has
  // to end up with real sideways velocity and to have scrubbed off much more
  // speed than the same turn taken on grip.
  const slide = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 9);
    g.hold(0.7, { steer: 1 });
    const gripped = Math.abs(g.ride.speed);
    g.place(-10,-20, 0, 9);
    // Sampled while it is still sliding: a powerslide ends by gripping again, and
    // by then the sideways velocity it was made of has gone into the concrete.
    let side = 0;
    let slip = 0;
    for (let i = 0; i < 84; i++) {
      g.drive(1 / 120, { steer: 1, slide: true });
      side = Math.max(side, Math.abs(g.ride.side));
      const velYaw = Math.atan2(g.ride.vel.x, g.ride.vel.z);
      slip = Math.max(slip, Math.abs(velYaw - g.ride.yaw));
    }
    g.hold(0.7, { steer: 1, slide: true });
    return { gripped, slid: Math.abs(g.ride.speed), side, slip };
  });
  ok(slide.side > 0.4, `a powerslide breaks the wheels loose sideways (${slide.side.toFixed(2)} m/s)`);
  ok(slide.slid < slide.gripped - 1, `and scrubs far more speed than a carve (${slide.slid.toFixed(2)} vs ${slide.gripped.toFixed(2)} m/s)`);
  ok(slide.slip > 0.15, `with the board no longer pointing where it is going (${slide.slip.toFixed(2)} rad)`);

  // Steering right has to turn right. Screen-right is -X when travelling +Z, so
  // a right-hand steer must reduce the yaw.
  const dir = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 6);
    g.hold(1.0, { steer: 1 });
    return g.ride.yaw;
  });
  ok(dir < -0.1, `steering right turns right (yaw ${dir.toFixed(2)})`);
}

// --------------------------------------------------------------------------
section('Slopes');
{
  // A steeper bank has to speed you up more than a shallow one, and both
  // have to speed you up more than coasting the same time on the flat does —
  // the whole point of SLOPE_BOOST.
  const runs = await run(() => {
    const g = window.__skate;
    const flat = (() => {
      g.place(-10,-18, 0, 5);
      g.hold(0.6);
      return g.ride.speed;
    })();
    // The funbox's downhill bank: z -2 → 1 now (the new funbox sits at
    // z = -8 to 1), rising over twice the distance, so ~4.8° instead
    // of the original ~9.5° — still a real slope, just a gentler one.
    const shallow = (() => {
      g.place(0, -1.5, 0, 5);
      g.hold(0.6);
      return g.ride.speed;
    })();
    // The home park's south quarterpipe wall, well up into the transition
    // (z = -44 is the flat join now, z = -45.83 the lip — the join moved
    // out with TRACK_SCALE but the curve itself, and so the distance from
    // join to lip, did not) where the slope is much steeper than the
    // funbox's bank.
    const steep = (() => {
      g.place(0, -45, 0, 5);
      g.hold(0.4);
      return g.ride.speed;
    })();
    return { flat, shallow, steep };
  });
  ok(runs.shallow > runs.flat, `a bank picks up speed a flat coast does not (${runs.shallow.toFixed(2)} vs ${runs.flat.toFixed(2)} m/s)`);
  ok(runs.steep > runs.shallow, `and a steeper wall picks up more of it (${runs.steep.toFixed(2)} vs ${runs.shallow.toFixed(2)} m/s)`);
}

// --------------------------------------------------------------------------
section('Ollies');
{
  // Pop height is set by the charge, and the launch speed by the height:
  // v = sqrt(2gh). So the apex has to come back out as h, and the air time as
  // 2v/g. If any of those three drift apart, the ollie has stopped being physics.
  const pops = await run(() => {
    const g = window.__skate;
    const out = [];
    for (const charge of [0, 0.5, 1]) {
      g.place(-10,-20, 0, 5);
      g.drive(1 / 120, { trick: 'ollie', trickCharge: charge });
      const vy = g.ride.vel.y;
      let air = 0;
      let apex = 0;
      for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
        g.drive(1 / 120, {});
        air += 1 / 120;
        apex = Math.max(apex, g.ride.pos.y);
      }
      out.push({ charge, vy, apex, air, mode: g.ride.mode });
    }
    return out;
  });
  for (const p of pops) {
    near(p.apex, (p.vy * p.vy) / (2 * 9.81), 0.1, `a ${p.charge} charge reaches its ballistic apex`);
    near(p.air, (2 * p.vy) / 9.81, 0.12, `and stays up for 2v/g`);
    ok(p.mode === 0, 'and lands back on the ground');
  }
  ok(pops[2].apex > pops[0].apex * 2, `a full charge pops far higher than none (${pops[2].apex.toFixed(2)} vs ${pops[0].apex.toFixed(2)} m)`);
  ok(pops[2].apex > 0.5 && pops[2].apex < 0.8, `and a full one is a believable ollie (${pops[2].apex.toFixed(2)} m)`);

  // Holding the charge past what the legs can take costs you the pop, and tips
  // the board into a manual.
  const held = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 5);
    g.hold(0.42, { charge: true });
    const atFull = g.ride.charge;
    g.hold(1.2, { charge: true });
    return { atFull, tired: g.ride.charge, manual: g.ride.manual };
  });
  ok(held.atFull > 0.9, 'the charge fills in CHARGE_TIME');
  ok(held.tired < held.atFull, `holding it too long loses it (${held.tired.toFixed(2)} vs ${held.atFull.toFixed(2)})`);
  ok(held.manual, 'and the nose comes up into a manual');
}

// --------------------------------------------------------------------------
section('Flip tricks');
{
  const flips = await run(() => {
    const g = window.__skate;
    const out = [];
    for (const id of [
      'kickflip',
      'heelflip',
      'treflip',
      'shuvit',
      'impossible',
      'inheel',
      'fsshuv360',
      'gazelle',
      'nightmare',
      'heel360',
    ]) {
      g.place(-10,-20, 0, 6);
      const events = [];
      g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false, trick: id, trickCharge: 1 });
      let landed = null;
      for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
        for (const e of g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false })) {
          events.push(e);
        }
      }
      landed = events.find((e) => e.name === 'trick');
      const flip = events.find((e) => e.name === 'land');
      out.push({ id, name: landed?.label, points: landed?.points || 0, mode: g.ride.mode, sketchy: flip?.sketchy });
    }
    return out;
  });
  for (const f of flips) {
    ok(f.mode === 0, `a ${f.id} off a full charge lands (${f.name || 'nothing scored'})`);
    ok(f.points > 0, `and scores (${f.points})`);
    ok(!f.sketchy, 'and lands clean, not sketchy');
  }
  ok(flips.find((f) => f.id === 'treflip').points > flips.find((f) => f.id === 'kickflip').points, 'a tre flip is worth more than a kickflip');

  // Not enough air to finish the rotation has to be a slam. This is the stake
  // that makes the trick a trick.
  const short = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 6);
    g.drive(1 / 120, { trick: 'treflip', trickCharge: 0 });
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) g.drive(1 / 120, {});
    return { mode: g.ride.mode, reason: g.ride.bailReason };
  });
  ok(short.mode === 3, `a tre flip with no pop cannot come round in time (${short.reason})`);
  ok(short.reason === 'primo', 'and lands on the side of the board');
}

// --------------------------------------------------------------------------
section('Spins and stance');
{
  const spun = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 7);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    // Hold the stick over for the whole flight: about 180° at SPIN_RATE.
    const events = [];
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
      for (const e of g.ride.update(1 / 120, { steer: -1, charge: false, slide: false, push: false })) events.push(e);
    }
    const t = events.find((e) => e.name === 'trick');
    return { mode: g.ride.mode, name: t?.label, fakie: g.ride.fakie, speed: g.ride.speed };
  });
  ok(spun.mode === 0, `a spin lands (${spun.name || 'nothing'})`);
  ok(/180|360/.test(spun.name || ''), 'and is named for how far it went round');
  ok(spun.fakie === spun.speed < 0, 'and a half turn leaves the rider rolling fakie');
}

// --------------------------------------------------------------------------
section('Reverts');
{
  // Only a backwards landing earns the save: the board comes down pointed back
  // the way it came, holds its line for REVERT_DELAY, then pivots round to
  // face the direction of travel. It costs a little speed for the pivot, and
  // never bails. Sideways landings are not saved — they wobble sketchy or,
  // far enough off, slide out.
  const reverted = await run(() => {
    const g = window.__skate;
    g.place(-10, -20, 0, 7);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    const events = [];
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
      const steer = Math.abs(g.ride.airYaw) < 2.1 ? -1 : 0; // ~120° round: backwards
      g.drive(1 / 120, { steer, charge: false, slide: false, push: false });
      for (const e of g.ride.events) events.push(e);
    }
    const land = events.find((e) => e.name === 'land');
    const start = events.find((e) => e.name === 'revertStart');
    const speedAtLand = g.ride.groundSpeed;
    const velYaw = Math.atan2(g.ride.vel.x, g.ride.vel.z);
    const yawAtLand = g.ride.yaw;
    // The delay: the board must hold its line for the full REVERT_DELAY.
    let earlyMoves = 0;
    for (let i = 0; i < 50 && g.ride.revert; i++) {
      g.drive(1 / 120, {});
      if (Math.abs(g.ride.yaw - yawAtLand) > 1e-4) earlyMoves++;
    }
    const yawAfterWait = g.ride.yaw;
    // Ride out the ~120° pivot and read where the heading ends.
    for (let i = 0; i < 240 && g.ride.revert; i++) g.drive(1 / 120, {});
    const dv = Math.abs(g.ride.yaw - velYaw) % (2 * Math.PI);
    return {
      reverted: !!start,
      slip: start?.angle || 0,
      clean: land?.sketchy === false,
      mode: g.ride.mode,
      speedAtLand,
      earlyMoves,
      yawAtLand,
      yawAfterWait,
      yaw: g.ride.yaw,
      off: dv > Math.PI ? 2 * Math.PI - dv : dv,
      speed: g.ride.groundSpeed,
    };
  });
  ok(reverted.reverted, 'a backwards landing starts a revert');
  ok(reverted.slip > 0.35, `with real misalignment to fix (${reverted.slip.toFixed(2)} rad)`);
  ok(reverted.clean, 'and it lands clean — the wobble is replaced by a pivot');
  ok(reverted.mode === 0, 'and does not bail');
  ok(
    reverted.earlyMoves === 0 && Math.abs(reverted.yawAfterWait - reverted.yawAtLand) < 1e-4,
    'and the board holds its line through the 0.5s delay'
  );
  ok(
    Math.abs(reverted.yawAfterWait - reverted.yaw) > 0.2,
    'before the pivot turns it back round'
  );
  ok(reverted.off < 0.12, `and ends facing the direction of travel (off by ${reverted.off.toFixed(3)} rad)`);
  ok(
    reverted.speed < reverted.speedAtLand,
    `and the pivot costs a little speed (${reverted.speedAtLand.toFixed(2)} → ${reverted.speed.toFixed(2)} m/s)`
  );
  ok(reverted.speed > 4, 'without killing the run');

  // A clean landing — board pointing where it is going — does not trigger one.
  const clean = await run(() => {
    const g = window.__skate;
    g.place(-10, -20, 0, 7);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    const events = [];
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
      g.drive(1 / 120, { steer: 0, charge: false, slide: false, push: false });
      for (const e of g.ride.events) events.push(e);
    }
    return { reverted: events.some((e) => e.name === 'revertStart') };
  });
  ok(!clean.reverted, 'and a straight landing does not');

  // A sideways landing is not saved: it wobbles sketchy but keeps rolling.
  const side = await run(() => {
    const g = window.__skate;
    g.place(-10, -20, 0, 7);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    for (let i = 0; i < 8; i++) g.drive(1 / 120, { steer: -1 }); // ~0.49 rad off
    const events = [];
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
      g.drive(1 / 120, { steer: 0, charge: false, slide: false, push: false });
      for (const e of g.ride.events) events.push(e);
    }
    const land = events.find((e) => e.name === 'land');
    return {
      mode: g.ride.mode,
      reverted: events.some((e) => e.name === 'revertStart'),
      sketchy: land?.sketchy === true,
    };
  });
  ok(side.mode === 0, 'and a sideways landing is not saved');
  ok(!side.reverted, 'it gets no revert');
  ok(side.sketchy, 'and wobbles sketchy instead');

  // Far sideways still slides out — no revert for it.
  const far = await run(() => {
    const g = window.__skate;
    g.place(-10, -20, 0, 7);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    for (let i = 0; i < 20; i++) g.drive(1 / 120, { steer: -1 }); // > 1.0 rad off
    const events = [];
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
      g.drive(1 / 120, { steer: 0, charge: false, slide: false, push: false });
      for (const e of g.ride.events) events.push(e);
    }
    return {
      mode: g.ride.mode,
      reason: g.ride.bailReason,
      reverted: events.some((e) => e.name === 'revertStart'),
    };
  });
  ok(
    far.mode === 3 && far.reason === 'slide-out',
    'and landing far too sideways still slides out'
  );
  ok(!far.reverted, 'with no revert for it');
}

// --------------------------------------------------------------------------
section('Transitions');
{
  // Riding a quarterpipe: up costs speed, and down gives it back with
  // SLOPE_BOOST's help — real pumping technique, exaggerated on purpose, so
  // rocking a transition genuinely earns you speed the way a push does.
  // Entered gently enough that it pumps back rather than cresting onto the
  // flat deck behind the lip, which is its own — separately fine — outcome.
  const pump = await run(() => {
    const g = window.__skate;
    g.place(0, 12, 0, 5);
    let apex = 0;
    for (let i = 0; i < 1200; i++) {
      g.drive(1 / 120, {});
      apex = Math.max(apex, g.ride.pos.y);
      if (g.ride.pos.z < 12 && g.ride.pos.y < 0.02 && i > 200) break;
    }
    return { apex, back: Math.abs(g.ride.speed), mode: g.ride.mode, z: g.ride.pos.z };
  });
  ok(pump.apex > 0.55, `the ramp is rideable (up to ${pump.apex.toFixed(2)} m)`);
  ok(pump.back > 5, `pumping the transition gains speed back (${pump.back.toFixed(2)} of 5 m/s in)`);
  ok(pump.back < 12, 'without gaining an unreasonable amount of it');

  // Fast enough into it and you fly out of the lip, which should be a real
  // launch rather than a hop: the board should get well above the coping.
  const launch = await run(() => {
    const g = window.__skate;
    g.place(0, 8, 0, 11);
    let apex = 0;
    let air = 0;
    let wasAir = false;
    let onLanding = null;
    for (let i = 0; i < 900; i++) {
      g.drive(1 / 120, {});
      if (g.ride.mode === 1) {
        air += 1 / 120;
        wasAir = true;
      } else if (wasAir && onLanding === null && g.ride.mode === 0) {
        onLanding = { speed: Math.abs(g.ride.speed), y: g.ride.pos.y, z: g.ride.pos.z };
      }
      apex = Math.max(apex, g.ride.pos.y);
    }
    return { apex, air, mode: g.ride.mode, onLanding };
  });
  ok(launch.apex > 2.0, `speed into the lip becomes air (${launch.apex.toFixed(2)} m up)`);
  ok(launch.air > 0.4, `with real time in it (${launch.air.toFixed(2)} s)`);
  // A lip that steep throws you out over the deck rather than back into the
  // ramp, so the deck has to be deep enough to come down on.
  ok(
    launch.onLanding && launch.onLanding.y > 1.4,
    `and comes down on the deck, not in the dirt behind it (y ${(launch.onLanding?.y || 0).toFixed(2)} at z ${(launch.onLanding?.z || 0).toFixed(1)})`
  );
  // Two and a half metres to flat concrete is a sketchy landing and is supposed
  // to cost speed — but it is a landing, not a slam.
  ok(launch.mode !== 3, 'and the landing is not refused');
  ok(launch.onLanding && launch.onLanding.speed > 1.2, `though it costs most of the speed (${(launch.onLanding?.speed || 0).toFixed(2)} m/s left)`);

  // Dropping in off the deck: a fall onto a steep surface, which is the case a
  // vertical-impact test would wrongly call a slam.
  const dropIn = await run(() => {
    const g = window.__skate;
    // Off the deck of the south quarterpipe, which is a 1.6 m drop.
    // The south quarter sits at z = -22 (1x), so after TRACK_SCALE the deck
    // is at z = -44, and we roll north toward the ramp.
    g.place(0, -48, Math.PI * 0, 1.5);
    let bailed = false;
    let fastest = 0;
    for (let i = 0; i < 700; i++) {
      g.drive(1 / 120, {});
      if (g.ride.mode === 3) bailed = true;
      if (g.ride.mode === 0) fastest = Math.max(fastest, Math.abs(g.ride.speed));
    }
    return { bailed, fastest, reason: g.ride.bailReason };
  });
  ok(!dropIn.bailed, `dropping in off the deck is not a slam (${dropIn.reason || 'rode away'})`);
  ok(dropIn.fastest > 4, `and the drop becomes speed (${dropIn.fastest.toFixed(2)} m/s at the bottom)`);
}

// --------------------------------------------------------------------------
section('Grinds and manuals');
{
  const grind = await run(() => {
    const g = window.__skate;
    // Straight down the flat bar, ollie onto it. The new flat bar sits at
    // x = -11, z = -10..10 (1x), so after TRACK_SCALE the approach starts
    // at x = -22, z = -22 (just south of the bar).
    g.place(-22, -22, 0, 6.5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 0.55 });
    let locked = null;
    for (let i = 0; i < 240 && !locked; i++) {
      for (const e of g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false })) {
        if (e.name === 'grindStart') locked = e.name;
      }
    }
    const before = g.ride.speed;
    // Hold the balance with a correction against the drift.
    let bailed = false;
    for (let i = 0; i < 120; i++) {
      const steer = -Math.sign(g.ride.balance + g.ride.balanceVel * 0.3) * 0.8;
      g.drive(1 / 120, { steer });
      if (g.ride.mode === 3) bailed = true;
    }
    return {
      locked: !!locked,
      mode: g.ride.mode,
      name: g.ride.grind?.label,
      points: g.ride.grind?.points || 0,
      slowed: before - Math.abs(g.ride.speed),
      bailed,
      y: g.ride.pos.y,
    };
  });
  ok(grind.locked, 'an ollie into a rail locks on');
  ok(grind.mode === 2, `and stays on it (${grind.name})`);
  ok(grind.y > 0.3, `at the height of the rail (${grind.y.toFixed(2)} m)`);
  ok(grind.slowed > 0.5, `and grinding scrubs speed (${grind.slowed.toFixed(2)} m/s)`);
  ok(grind.points > 20, `and pays by the metre (${Math.round(grind.points)})`);

  // Left alone, balance always goes. That is what makes it a balance meter and
  // not an ornament.
  const dropped = await run(() => {
    const g = window.__skate;
    g.place(-22, -22, 0, 6.5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 0.55 });
    for (let i = 0; i < 240 && g.ride.mode !== 2; i++) g.drive(1 / 120, {});
    const on = g.ride.mode === 2;
    let steps = 0;
    while (g.ride.mode === 2 && steps < 1200) {
      g.drive(1 / 120, {});
      steps++;
    }
    return { on, mode: g.ride.mode, reason: g.ride.bailReason, seconds: steps / 120 };
  });
  ok(dropped.on, 'a grind with no correction at all');
  ok(dropped.mode !== 2, `does not last (${dropped.seconds.toFixed(2)} s, ${dropped.reason || 'ran off the end'})`);

  const manual = await run(() => {
    const g = window.__skate;
    g.place(-10,-20, 0, 5);
    g.hold(0.7, { charge: true });
    const started = g.ride.manual;
    let dist = 0;
    let pitch = 0;
    let lift = 0;
    for (let i = 0; i < 300 && g.ride.manual; i++) {
      const steer = -Math.sign(g.ride.balance + g.ride.balanceVel * 0.3) * 0.7;
      g.drive(1 / 120, { steer, charge: true });
      dist = g.ride.manualDist;
      // Read while the tail is actually down: letting go puts the nose back.
      pitch = g.ride.state.deckPitch;
      lift = g.ride.state.deckLift;
    }
    const events = g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false });
    return { started, dist, pitch, lift, banked: events.find((e) => e.name === 'manualEnd') };
  });
  ok(manual.started, 'holding the charge presses the tail into a manual');
  // A nose-up deck pivots on its back axle, so it has to rise by half a wheelbase
  // of that angle or the rear wheels end up inside the concrete.
  near(
    manual.lift,
    Math.sin(manual.pitch) * 0.18,
    0.06,
    'and the deck rises by what pivoting on the back axle costs'
  );
  ok(manual.dist > 1, `and it can be held (${manual.dist.toFixed(1)} m)`);
  ok(!!manual.banked, `and letting go scores it (${manual.banked?.points || 0})`);
}

// --------------------------------------------------------------------------
section('Slams');
{
  const wall = await run(() => {
    const g = window.__skate;
    // Straight into the bottom step of the stair set — the new set sits at
    // x = 14..18, z = -18..-12 (1x), so after TRACK_SCALE the approach
    // starts at x = 30, z = -44 (just south of the stairs).
    g.place(30, -44, 0, 7);
    for (let i = 0; i < 600 && g.ride.mode !== 3; i++) g.drive(1 / 120, {});
    return { mode: g.ride.mode, reason: g.ride.bailReason };
  });
  ok(wall.mode === 3, `rolling into a step at speed is a slam (${wall.reason})`);

  const kerb = await run(() => {
    const g = window.__skate;
    g.place(30, -44, 0, 1.0);
    for (let i = 0; i < 600; i++) g.drive(1 / 120, {});
    return { mode: g.ride.mode, speed: g.ride.speed };
  });
  ok(kerb.mode === 0 && Math.abs(kerb.speed) < 0.2, 'but rolling into one slowly just stops you');

  const drop = await run(() => {
    const g = window.__skate;
    // Off the top of the stair-set platform, which is a 1.25 m drop.
    g.place(30, -16, Math.PI, 9);
    let bailed = false;
    for (let i = 0; i < 900; i++) {
      g.drive(1 / 120, {});
      if (g.ride.mode === 3) bailed = true;
    }
    return { bailed, mode: g.ride.mode };
  });
  ok(!drop.bailed, 'a 1.25 m drop taken straight is landable');

  const ragdoll = await run(() => {
    const g = window.__skate;
    g.place(0, -14, 0, 8);
    g.slam('slide-out');
    for (let i = 0; i < 400; i++) g.ragdoll.step(1 / 120);
    const pts = g.ragdoll.points;
    let lowest = Infinity;
    let spread = 0;
    for (const p of pts) {
      lowest = Math.min(lowest, p.p.y);
      spread = Math.max(spread, p.p.distanceTo(g.ragdoll.named.pelvis.p));
    }
    return { lowest, spread, settled: g.ragdoll.settled, n: pts.length };
  });
  ok(ragdoll.n === 15, `the ragdoll has its joints (${ragdoll.n})`);
  ok(ragdoll.lowest > -0.02, `and none of them ends up under the concrete (${ragdoll.lowest.toFixed(3)} m)`);
  ok(ragdoll.spread < 1.3, `and it still holds together (${ragdoll.spread.toFixed(2)} m from the hips)`);
  ok(ragdoll.settled > 0.2, 'and it comes to rest');
}

// --------------------------------------------------------------------------
section('After a slam, the rider gets up rather than resetting');
{
  // The loop has to be live for this: getting up is gated on the ragdoll coming
  // to rest, which happens in step() over real frames rather than on demand.
  const fell = await run(() => {
    const g = window.__skate;
    g.unfreeze();
    // Deliberately nowhere near the spawn, so "got up where it fell" and "was
    // sent back to the start" cannot possibly look the same.
    g.place(20, 10, 0, 8);
    const at = { x: g.ride.pos.x, z: g.ride.pos.z };
    g.slam('slide-out');
    return {
      at,
      spawn: { x: g.park.spawn.x, z: g.park.spawn.z },
      state: g.state,
      score: g.score,
    };
  });
  ok(fell.state === 'bail', 'a slam drops into the ragdoll');

  const up = await page
    .waitForFunction(() => window.__skate.state === 'playing', null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  ok(up, 'and the rider gets back up on their own, with nothing to press');

  const after = await run(() => {
    const g = window.__skate;
    return {
      state: g.state,
      pos: { x: g.ride.pos.x, z: g.ride.pos.z },
      mode: g.ride.mode,
      score: g.score,
      onFrame: g.skater.group.parent === g.ride.frame && g.board.group.parent === g.ride.frame,
      ragdollActive: g.ragdoll.active,
      inputOn: g.input.enabled,
      // Nothing may be covering the game — the whole point is that it does not
      // stop. Read off the overlay rather than the individual screens: hide()
      // only hides the overlay, so the last screen shown keeps hidden=false
      // inside it and every section after a menu would look like it was open.
      overlayShown: !document.getElementById('overlay').hidden,
      current: g.hud.current,
      hasBailScreen: !!document.getElementById('screen-bail'),
    };
  });
  const distFell = Math.hypot(after.pos.x - fell.at.x, after.pos.z - fell.at.z);
  const distSpawn = Math.hypot(after.pos.x - fell.spawn.x, after.pos.z - fell.spawn.z);
  ok(after.mode === 0 && after.onFrame, 'back on the board, on the ground');
  ok(!after.ragdollActive, 'with the ragdoll released');
  ok(after.inputOn, 'and the controls live again');
  ok(!after.overlayShown && after.current === null, 'no screen appears over the game');
  ok(!after.hasBailScreen, 'and there is no slam screen left in the page at all');
  ok(
    distFell < distSpawn,
    `they stand up where they fell, not back at the spawn (${distFell.toFixed(1)} m from the fall, ${distSpawn.toFixed(1)} m from spawn)`
  );
  ok(distFell < 12, `and within a tumble's reach of it (${distFell.toFixed(1)} m)`);
  ok(after.score === fell.score, `the run continues — score is kept (${after.score})`);

  await run(() => window.__skate.freeze());
}

// --------------------------------------------------------------------------
section('Grabs: an air-only trick');
{
  const cat = await run(() => {
    const g = window.__skate;
    return {
      count: g.grabs.length,
      ids: g.grabs.map((x) => x.id),
      uniqueIds: new Set(g.grabs.map((x) => x.id)).size,
      uniqueNames: new Set(g.grabs.map((x) => x.name)).size,
      handsOk: g.grabs.every((x) => x.hand === 0 || x.hand === 1),
      pointsOk: g.grabs.every((x) => x.points > 0),
    };
  });
  ok(cat.count === 5, `there are five grabs (${cat.ids.join(', ')})`);
  ok(cat.uniqueIds === 5 && cat.uniqueNames === 5, 'each with its own id and name');
  ok(cat.handsOk, 'each naming a real hand (0 or 1)');
  ok(cat.pointsOk, 'and each worth real points');

  // On the ground, holding the key does nothing at all — a grab only exists
  // once there is air to hold it in.
  const grounded = await run(() => {
    const g = window.__skate;
    g.place(-10, -22, 0, 4);
    g.drive(1 / 120, { grab: 'indy' });
    return { mode: g.ride.mode, grab: g.ride.grab };
  });
  ok(grounded.mode === 0 && grounded.grab === null, 'a grab key does nothing while still on the ground');

  // Each check below runs entirely inside page.evaluate(), which serialises
  // the callback and runs it in the browser — a Node-side closure like a
  // shared toAir() helper would not exist over there, so popping the ollie is
  // inlined into every callback that needs the air instead of factored out.

  // Held, then let go while still in the air: scored immediately on release,
  // not held over until landing.
  const releasedInAir = await run(() => {
    const g = window.__skate;
    g.place(-10, -22, 0, 5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    for (let i = 0; i < 30; i++) g.drive(1 / 120, { grab: 'indy' }); // 0.25 s — past GRAB_MIN_HOLD
    const midAirMode = g.ride.mode;
    const before = g.save.tricks;
    g.drive(1 / 120, {}); // grab: null — let go
    // drive() returns the ride model, not its events — read those off
    // ride.events, which update() repopulates in place on every step.
    return {
      midAirMode,
      grabAfter: g.ride.grab,
      trick: g.ride.events.find((e) => e.name === 'trick'),
      tricksGained: g.save.tricks - before,
    };
  });
  ok(releasedInAir.midAirMode === 1, 'holding it keeps the rider airborne, mid-grab');
  ok(releasedInAir.grabAfter === null, 'letting go ends it');
  ok(
    releasedInAir.trick?.label === 'Indy' && releasedInAir.trick.points > 0,
    `and scores it the instant it is let go, in the air (${releasedInAir.trick?.label}, ${releasedInAir.trick?.points} pts)`
  );
  ok(releasedInAir.tricksGained === 1, 'and it counts as a landed trick');

  // Too brief to read as anything — a tap, not a grab.
  const tooBrief = await run(() => {
    const g = window.__skate;
    g.place(-10, -22, 0, 5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    const before = g.save.tricks;
    g.drive(1 / 120, { grab: 'mute' }); // one frame: 1/120 s, well under GRAB_MIN_HOLD
    g.drive(1 / 120, {});
    return { trick: g.ride.events.find((e) => e.name === 'trick'), tricksGained: g.save.tricks - before };
  });
  ok(!tooBrief.trick && tooBrief.tricksGained === 0, 'a brush too brief to read as a grab scores nothing');

  // Never released: still scored, at the moment the wheels touch down.
  const heldToLanding = await run(() => {
    const g = window.__skate;
    g.place(-10, -22, 0, 5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    const before = g.save.tricks;
    let landedTrick = null;
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
      g.drive(1 / 120, { grab: 'method' }); // held the whole way down
      const t = g.ride.events.find((e) => e.name === 'trick');
      if (t) landedTrick = t;
    }
    return { grounded: g.ride.mode === 0, trick: landedTrick, tricksGained: g.save.tricks - before };
  });
  ok(heldToLanding.grounded, 'holding it all the way down still lands cleanly');
  ok(
    heldToLanding.trick?.label === 'Method' && heldToLanding.tricksGained === 1,
    `and it is scored right at touchdown, not lost for never letting go (${heldToLanding.trick?.label})`
  );

  // A bail is not a landing: no score for a grab whose air ended on the floor.
  const bailed = await run(() => {
    const g = window.__skate;
    g.place(-10, -22, 0, 5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    for (let i = 0; i < 20; i++) g.drive(1 / 120, { grab: 'tailgrab' });
    const before = g.save.tricks;
    g.ride.bail('flat');
    return { grab: g.ride.grab, tricksGained: g.save.tricks - before };
  });
  ok(bailed.grab === null && bailed.tricksGained === 0, 'and bailing drops a held grab with no score for it');

  // Caught into a rail rather than landed: also no score, same rule.
  const caughtByRail = await run(() => {
    const g = window.__skate;
    g.place(-10, -22, 0, 5);
    g.drive(1 / 120, { trick: 'ollie', trickCharge: 1 });
    for (let i = 0; i < 20; i++) g.drive(1 / 120, { grab: 'nosegrab' });
    const before = g.save.tricks;
    g.ride.enterGrind({ dir: { x: 0, y: 0, z: 1 }, radius: 0.02, kind: 'rail' });
    return { mode: g.ride.mode, grab: g.ride.grab, tricksGained: g.save.tricks - before };
  });
  ok(
    caughtByRail.mode === 2 && caughtByRail.grab === null && caughtByRail.tricksGained === 0,
    'and catching a rail mid-grab drops it too, rather than scoring a grab that never landed'
  );

  // The real key binding, end to end — the same shape as the Gazelle Flip
  // check earlier in this file, but for a hold instead of a flick. Real
  // frames throughout: the game's own loop has to be running, not driven by
  // hand, or there is no updateHud() tick to show the grab row in the first
  // place — which this same run also checks, since it needs the row visible
  // to find the button.
  //
  // Every wait below polls the game's own *simulated* state rather than
  // sleeping a fixed real-world duration. This far into the suite the page
  // has already run dozens of tutorial demos through hundreds of thousands of
  // steps, and under software GL a slow machine can fall well behind real
  // time — a fixed sleep(500) is not reliably 500ms of simulated charge, but
  // waitForFunction(() => ride.charge >= …) is exactly that however long it
  // actually takes.
  await run(() => {
    const g = window.__skate;
    g.unfreeze();
    g.place(-10, -24, 0, 5);
    g.input.clear();
  });
  const hiddenOnGround = await run(() => document.getElementById('grab-buttons').hidden);
  ok(hiddenOnGround, 'the grab row is hidden while on the ground');

  const beforeKey = await run(() => window.__skate.save.tricks);
  await page.keyboard.down('Space');
  await page
    .waitForFunction(() => window.__skate.ride.charge >= 0.85, null, { timeout: 10000 })
    .catch(() => {}); // best-effort — even a partial charge still pops an ollie
  await page.keyboard.up('Space'); // released with no flick queued: a plain ollie
  const airborne = await page
    .waitForFunction(() => window.__skate.ride.mode === 1, null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok(airborne, 'the ollie actually leaves the ground');
  const shownInAir = await run(() => document.getElementById('grab-buttons').hidden);
  ok(!shownInAir, 'and the grab row shows itself once it does');

  await page.keyboard.down('Digit1'); // Indy
  const grabbedByKey = await page
    .waitForFunction(() => window.__skate.ride.grab?.def.id === 'indy', null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok(grabbedByKey, 'and pressing 1 actually holds it');
  // Past GRAB_MIN_HOLD in simulated time, however long that takes in real time.
  await page
    .waitForFunction(() => (window.__skate.ride.grab?.held ?? 0) >= 0.2, null, { timeout: 5000 })
    .catch(() => {});
  await page.keyboard.up('Digit1');
  const landed = await page
    .waitForFunction(() => window.__skate.save.tricks > 0 && window.__skate.ride.mode === 0, null, {
      timeout: 15000,
    })
    .then(() => true)
    .catch(() => false);
  const afterKey = await run(() => window.__skate.save.tricks);
  ok(landed && afterKey > beforeKey, `holding 1 through the real keyboard path lands an Indy (tricks ${beforeKey} → ${afterKey})`);
  const hiddenAfterLanding = await run(() => document.getElementById('grab-buttons').hidden);
  ok(hiddenAfterLanding, 'and the row hides itself again once back on the ground');

  // The on-screen button: a real pointerdown/pointerup on it drives the same
  // beginGrab()/endGrab() path a keyboard hold does. Pop another ollie for it.
  await run(() => {
    const g = window.__skate;
    g.place(-10, -26, 0, 5);
  });
  await page.keyboard.down('Space');
  await page
    .waitForFunction(() => window.__skate.ride.charge >= 0.85, null, { timeout: 10000 })
    .catch(() => {});
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__skate.ride.mode === 1, null, { timeout: 5000 });

  const btn = await page.$('[data-grab="method"]');
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const heldViaTouch = await page
    .waitForFunction(() => window.__skate.ride.grab?.def.id === 'method', null, { timeout: 5000 })
    .then(() => run(() => window.__skate.ride.grab?.def.id))
    .catch(() => null);
  await page.mouse.up();
  const releasedViaTouch = await page
    .waitForFunction(() => window.__skate.ride.grab === null, null, { timeout: 5000 })
    .then(() => null)
    .catch(() => run(() => window.__skate.ride.grab));
  ok(heldViaTouch === 'method', `pressing the on-screen button holds that grab (${heldViaTouch})`);
  ok(releasedViaTouch === null, 'and releasing the pointer lets go of it');

  await run(() => window.__skate.freeze());
}

// --------------------------------------------------------------------------
section('Scoring');
{
  const combo = await run(() => {
    const g = window.__skate;
    g.place(-10,-22, 0, 7);
    const events = [];
    const push = (list) => {
      for (const e of list) events.push(e);
    };
    // Two flips in a row, then roll away and let the combo bank.
    for (const id of ['kickflip', 'heelflip']) {
      push(g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false, trick: id, trickCharge: 1 }));
      for (let i = 0; i < 400 && g.ride.mode === 1; i++) {
        push(g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false }));
      }
      // Land, then straight into the next one.
      for (let i = 0; i < 30; i++) push(g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false }));
    }
    for (let i = 0; i < 300; i++) push(g.ride.update(1 / 120, { steer: 0, charge: false, slide: false, push: false }));
    const tricks = events.filter((e) => e.name === 'trick');
    const banked = events.find((e) => e.name === 'combo');
    return { tricks: tricks.map((t) => t.label), banked };
  });
  ok(combo.tricks.length === 2, `two tricks link into one combo (${combo.tricks.join(' + ')})`);
  ok(!!combo.banked, 'and the combo banks once the skater rolls away');
  ok(combo.banked?.multiplier === 2, `with a multiplier for the chain (×${combo.banked?.multiplier})`);
  ok(
    combo.banked && combo.banked.total === combo.banked.points * combo.banked.multiplier,
    'and the total is the chain times the multiplier'
  );

  const lost = await run(() => {
    const g = window.__skate;
    g.place(-10,-22, 0, 7);
    g.drive(1 / 120, { trick: 'kickflip', trickCharge: 1 });
    for (let i = 0; i < 400 && g.ride.mode === 1; i++) g.drive(1 / 120, {});
    const live = g.ride.combo.points;
    const events = [];
    g.ride.bail('slide-out');
    return { live, points: g.ride.combo.points, lost: g.ride.events.some((e) => e.name === 'comboLost'), events };
  });
  ok(lost.live > 0 && lost.points === 0, 'and a slam takes the whole thing away');
}

// --------------------------------------------------------------------------
section('Flick-It');
{
  // The gesture classifier, exercised directly: these are the angles a thumb
  // actually leaves at, and the mapping has to be stable.
  const map = await run(async () => {
    const { classify } = await import('./js/skate/input.js');
    const at = (deg, curl = 0) => classify((deg * Math.PI) / 180, curl);
    return {
      up: at(90),
      upLeft: at(150),
      upRight: at(30),
      left: at(185),
      leftNeg: at(-178),
      right: at(0),
      down: at(-100),
      curlLeft: at(90, -1),
      curlRight: at(90, 1),
      // Every one of the five newest tricks, reached by scooping further out
      // of a flick that already has a plain, uncurled meaning.
      kickflipScoopIn: at(150, -1),
      kickflipScoopOut: at(150, -1.4),
      kickflipScoopIn2: at(150, 1),
      kickflipScoopOut2: at(150, 1.4),
      heelflipScoopIn: at(30, -1),
      heelflipScoopOut: at(30, -1.4),
      heelflipScoopIn2: at(30, 1),
      heelflipScoopOut2: at(30, 1.4),
      shuvitScoop: at(185, 1),
      fsshuvitScoop: at(0, -1),
    };
  });
  ok(map.up === 'ollie', 'flick up is an ollie');
  ok(map.upLeft === 'kickflip', 'up and left is a kickflip');
  ok(map.upRight === 'heelflip', 'up and right is a heelflip');
  ok(map.left === 'shuvit' && map.leftNeg === 'shuvit', 'straight left is a shove-it, from either side of 180°');
  ok(map.right === 'fsshuvit', 'straight right is a frontside shove-it');
  ok(map.curlLeft === 'treflip', 'a quarter circle into up is a 360 flip');
  ok(map.curlRight === 'varialheel', 'and the other way is a varial heelflip');
  ok(map.down === 'impossible', 'and flicking straight down is an impossible — the one direction nothing else used');

  // The five newest tricks were keyboard-only until now: every one of them
  // has to actually be reachable by scooping a flick that already means
  // something plainer, or a phone (no keyboard at all) can still not do them.
  ok(map.kickflipScoopIn === 'varial', 'scooping a kickflip a little one way is a varial');
  ok(map.kickflipScoopOut === 'treflip', 'and further the same way is a full tre flip');
  ok(map.kickflipScoopIn2 === 'hardflip', 'scooping it the other way a little is a hardflip');
  ok(map.kickflipScoopOut2 === 'gazelle', 'and further that way is a gazelle flip');
  ok(map.heelflipScoopIn === 'inheel', 'scooping a heelflip a little one way is an inward heelflip');
  ok(map.heelflipScoopOut === 'heel360', 'and further the same way is a full 360 heelflip');
  ok(map.heelflipScoopIn2 === 'varialheel', 'scooping it the other way a little is a varial heelflip');
  ok(map.heelflipScoopOut2 === 'nightmare', 'and further that way is a nightmare flip');
  ok(map.shuvitScoop === 'shuv360', 'scooping a shove-it is a full 360 shuvit');
  ok(map.fsshuvitScoop === 'fsshuv360', 'and the same for its frontside twin');

  // Then the same thing through a real drag, on the element that ships.
  const dragged = await run(() => {
    // respawn(), not place(): the slam section left the rider parented to the
    // scene behind a live ragdoll, and only respawn puts them back on the board.
    window.__skate.respawn();
    window.__skate.unfreeze();
    window.__skate.place(-10,-18, 0, 6);
    window.__skate.input.clear();
    return true;
  });
  ok(dragged, 'the game is live for a real gesture');
  const w = 900;
  await page.mouse.move(w * 0.7, 300);
  await page.mouse.down();
  await page.mouse.move(w * 0.7, 380, { steps: 6 }); // pull back
  await sleep(120);
  await page.mouse.move(w * 0.62, 300, { steps: 6 }); // flick up and left
  await page.mouse.up();
  await sleep(500);
  const flicked = await run(() => ({
    tricks: window.__skate.save.tricks,
    mode: window.__skate.ride.mode,
    best: window.__skate.save.bestTrick,
  }));
  ok(flicked.mode !== 0 || flicked.tricks > 0, `a mouse drag pops a trick (mode ${flicked.mode}, ${flicked.tricks} landed)`);

  // The five newest tricks have no flick at all — a real key press is the
  // only way to reach them, so that path needs its own end-to-end check,
  // not just the trick catalogue's physics tested directly.
  const before = await run(() => {
    window.__skate.respawn();
    window.__skate.unfreeze();
    window.__skate.place(-10,-20, 0, 6);
    window.__skate.input.clear();
    return window.__skate.save.tricks;
  });
  await page.keyboard.press('KeyG'); // Gazelle Flip
  // Waited for, not slept through. Under software GL this renderer runs at about
  // twelve frames a second, so a fixed 900ms was sometimes only eleven frames —
  // not enough simulated time for the flip to come back down — and the check
  // then failed on how loaded the machine was rather than on anything to do with
  // the trick or the key binding it is meant to be testing.
  const landed = await page
    .waitForFunction((n) => window.__skate.save.tricks > n && window.__skate.ride.mode === 0, before, {
      timeout: 15000,
    })
    .then(() => true)
    .catch(() => false);
  const keyed = await run(() => ({ mode: window.__skate.ride.mode, tricks: window.__skate.save.tricks }));
  ok(
    landed,
    `pressing G lands a Gazelle Flip through the real key binding (mode ${keyed.mode}, ${keyed.tricks} landed)`
  );
}

// --------------------------------------------------------------------------
section('Parks');
{
  const info = await run(() => {
    const g = window.__skate;
    return { count: g.parks.length, ids: g.parks.map((p) => p.id), current: g.park.id };
  });
  ok(info.count === 14, `there are fourteen parks (${info.count})`);
  ok(new Set(info.ids).size === info.count, 'each with a distinct id');
  ok(info.current === 'home', 'and the game boots into Home Park');

  // Every map needs a rideable spawn, a patrol loop the AI can actually
  // follow, and six logos — checked by actually loading each of the six in
  // turn, since `parks` is the raw list of definitions and only the live
  // `park` — the one switchPark just built — has a height field to query.
  const shapes = await run(() =>
    window.__skate.parks.map((def) => {
      const p = window.__skate.switchPark(def.id);
      // A wall's deck is only tangent to its *inside* — rolling in from
      // outside one is a cliff, not a ramp (see park.js's Quarter). Sampled
      // straight ahead of the spawn, since that is the one direction a
      // player takes with no input at all beyond a push.
      const { x, z, yaw } = p.spawn;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      let maxStep = 0;
      let prevY = p.heightAt(x, z);
      for (let d = 0.1; d <= 5; d += 0.1) {
        const y = p.heightAt(x + fx * d, z + fz * d);
        maxStep = Math.max(maxStep, Math.abs(y - prevY));
        prevY = y;
      }
      return {
        id: p.id,
        onSurface: Math.abs(p.heightAt(p.spawn.x, p.spawn.z)) < 5,
        clearAhead: maxStep < 0.15,
        patrol: p.patrol.length,
        logos: p.logos.length,
        grinds: p.grinds.length,
      };
    })
  );
  for (const s of shapes) {
    ok(s.onSurface, `${s.id}: the spawn sits on a real surface`);
    ok(s.clearAhead, `${s.id}: the first 5 m straight ahead has no wall to roll into blind`);
    ok(s.patrol >= 4, `${s.id}: a patrol loop with real waypoints (${s.patrol})`);
    ok(s.logos === 6, `${s.id}: six logos (${s.logos})`);
    ok(s.grinds >= 1, `${s.id}: at least one grindable line (${s.grinds})`);
  }

  // Switching parks has to move the live ride onto the new map's spawn, not
  // just swap the object reference out from under it.
  const switched = await run(() => {
    const g = window.__skate;
    g.switchPark('bowl');
    return { id: g.park.id, y: g.ride.pos.y, spawnY: g.park.heightAt(g.park.spawn.x, g.park.spawn.z) };
  });
  ok(switched.id === 'bowl', 'switchPark loads the requested map');
  near(switched.y, switched.spawnY, 0.02, 'and drops the rider on its own spawn');

  // Open World's hoop: decorative, not a feature, so nothing above checks it —
  // confirm it actually exists and sits somewhere sane (above the ground it
  // hangs over, not buried in it or floating off in the void).
  const hoop = await run(() => {
    const g = window.__skate;
    const p = g.switchPark('open');
    const h = p.hoops[0];
    return h && { count: p.hoops.length, y: h.cy, groundY: p.heightAt(h.cx, h.cz), radius: h.radius };
  });
  ok(hoop && hoop.count >= 1, `Open World has a hoop to jump through (${hoop?.count ?? 0})`);
  ok(hoop && hoop.y - hoop.radius > hoop.groundY + 0.3, `and it hangs clear above the ground beneath it (${hoop?.y} vs ${hoop?.groundY})`);

  await run(() => window.__skate.switchPark('home'));
}

// --------------------------------------------------------------------------
section('Park boundary: nowhere to fall off the edge of the world');
{
  // Nothing is sampled past the dirt around each pad, so before rideBoundZ
  // existed, riding far enough off the edge would fall forever, chasing
  // ground that was never there. Every park gets checked, since the bound
  // scales with each one's own extent — including the deliberately
  // oversized, fenceless Open World map.
  const results = await run(() => {
    const g = window.__skate;
    return g.parks.map((def) => {
      const p = g.switchPark(def.id);
      const r = p.rideBoundZ;
      // Placed 5 m inside the edge, aimed straight out along it, and pushed
      // hard for 5 s — if the clamp did not hold this crosses into the void
      // well within that time and pos.y runs away to nothing.
      g.place(0, r - 5, 0, 12);
      for (let i = 0; i < 600; i++) g.drive(1 / 120, { push: true });
      return {
        id: p.id,
        bound: r,
        withinX: Math.abs(g.ride.pos.x) <= p.rideBoundX + 0.5,
        withinZ: Math.abs(g.ride.pos.z) <= r + 0.5,
        finite: Number.isFinite(g.ride.pos.y) && g.ride.pos.y > -50 && g.ride.pos.y < 200,
      };
    });
  });
  for (const r of results) {
    ok(r.bound > 0, `${r.id}: has a real world boundary (${r.bound.toFixed(0)} m)`);
    ok(r.withinX && r.withinZ, `${r.id}: pushing straight at the edge never crosses it`);
    ok(r.finite, `${r.id}: and never falls into the void chasing ground that was never there`);
  }

  // padOnly is the stricter claim: the bound has to be the concrete's own
  // edge, not the much wider dirt run-off a map without it gets — that is
  // the whole difference between "cannot fall off the world" and "cannot
  // leave the pad at all." Every map is padOnly now except Open World,
  // which is deliberately built to be roamed past its own pad.
  const padOnly = await run(() => {
    const g = window.__skate;
    const padded = g.parks.filter((def) => def.id !== 'open').map((def) => g.switchPark(def.id));
    const open = g.switchPark('open');
    return {
      allConfined: padded.every((p) => p.rideBoundX === p.extentX && p.rideBoundZ === p.extentZ),
      allTighterThanDirt: padded.every((p) => p.rideBoundZ < p.worldR),
      openNotConfined: open.rideBoundZ === open.worldR && open.rideBoundZ > open.extentZ,
    };
  });
  ok(padOnly.allConfined, 'every padOnly map clamps to its own concrete edge, not the dirt past it');
  ok(padOnly.allTighterThanDirt, "and that edge is well inside where the dirt's own run-off would allow");
  ok(padOnly.openNotConfined, 'while Open World is untouched — roaming past its own pad is still free');
  await run(() => window.__skate.switchPark('home'));
}

// --------------------------------------------------------------------------
section('AI skaters');
{
  const count = await run(() => window.__skate.bots.length);
  ok(count === 13, `thirteen AI skaters populate the park (${count})`);

  // A SocialSkater is the only kind carrying a Walker — the cheapest way to
  // tell the two roles apart from outside the module.
  const roster = await run(() => window.__skate.bots.map((b) => b.walker != null));
  const touringCount = roster.filter((social) => !social).length;
  const socialCount = roster.filter((social) => social).length;
  ok(touringCount === 5, `five of them tour the patrol loop the whole time (${touringCount})`);
  ok(socialCount === 8, `and eight are the social crowd (${socialCount})`);

  // Touring bots never stop — real simulated time, and they have to actually
  // cover ground, not idle on their spawn point or get stuck against the
  // first thing they roll into.
  const toured = await run(() => {
    const g = window.__skate;
    const touring = g.bots.filter((b) => b.walker == null);
    const before = touring.map((b) => ({ x: b.ride.pos.x, z: b.ride.pos.z }));
    for (let i = 0; i < 600; i++) for (const b of touring) b.step(1 / 120);
    return touring.map((b, i) => Math.hypot(b.ride.pos.x - before[i].x, b.ride.pos.z - before[i].z));
  });
  ok(toured.every((d) => d > 1), `every touring bot covers real ground in 5 s (${toured.map((d) => d.toFixed(1)).join(', ')} m)`);

  // Fresh into a park, the social crowd starts out walking, not mid-ride.
  const freshState = await run(() => ({
    groupRiding: window.__skate.socialGroup.riding,
    riding: window.__skate.bots.filter((b) => b.walker != null).map((b) => b.riding),
  }));
  ok(!freshState.groupRiding, 'the social crowd starts out walking, not riding');
  ok(freshState.riding.every((r) => !r), 'and none of them are mounted up yet');

  // On foot, they wander near the hangout spot rather than standing frozen —
  // but never far from it, so a knot of people milling around reads as one
  // group, not eight strangers drifting off on their own.
  const wandered = await run(() => {
    const g = window.__skate;
    const socials = g.bots.filter((b) => b.walker != null);
    const before = socials.map((b) => ({ x: b.walker.pos.x, z: b.walker.pos.z }));
    for (let i = 0; i < 600; i++) for (const b of socials) b.stepWalk(1 / 60);
    return socials.map((b, i) => ({
      moved: Math.hypot(b.walker.pos.x - before[i].x, b.walker.pos.z - before[i].z),
      fromHangout: Math.hypot(b.walker.pos.x - b.hangout.x, b.walker.pos.z - b.hangout.z),
    }));
  });
  ok(
    wandered.some((w) => w.moved > 0.3),
    `walking bots actually wander (${wandered.map((w) => w.moved.toFixed(2)).join(', ')} m)`
  );
  ok(
    wandered.every((w) => w.fromHangout < 6),
    `and never far from the hangout spot (${wandered.map((w) => w.fromHangout.toFixed(2)).join(', ')} m away)`
  );

  // The shared timer calling everyone in for a group ride: forced here
  // rather than waited out, since it is seconds of real time by design.
  const mounted = await run(() => {
    const g = window.__skate;
    g.socialGroup.riding = true;
    const socials = g.bots.filter((b) => b.walker != null);
    for (const b of socials) b.step(1 / 60);
    return socials.map((b) => b.riding);
  });
  ok(mounted.every((r) => r), `the whole social crowd mounts up together for the group ride (${mounted.filter(Boolean).length}/8)`);

  // Riding together: real ground covered, on the same patrol loop and
  // through the same stepPatrol() the touring bots use — including
  // whatever trick chance that code path already gives them.
  const rode = await run(() => {
    const g = window.__skate;
    const socials = g.bots.filter((b) => b.walker != null);
    const before = socials.map((b) => ({ x: b.ride.pos.x, z: b.ride.pos.z }));
    for (let i = 0; i < 600; i++) for (const b of socials) b.step(1 / 120);
    return socials.map((b, i) => Math.hypot(b.ride.pos.x - before[i].x, b.ride.pos.z - before[i].z));
  });
  ok(rode.every((d) => d > 1), `and actually cover ground doing it (${rode.map((d) => d.toFixed(1)).join(', ')} m)`);

  // The timer calling them back out of it: forced the other way, and the
  // whole crowd dismounts and picks its boards back up together.
  const dismounted = await run(() => {
    const g = window.__skate;
    g.socialGroup.riding = false;
    const socials = g.bots.filter((b) => b.walker != null);
    for (const b of socials) b.step(1 / 60);
    return socials.map((b) => b.riding);
  });
  ok(dismounted.every((r) => !r), 'and the whole crowd dismounts together when the ride is over');
}

// --------------------------------------------------------------------------
section('AI skaters navigate, and stay off the park boundary');
{
  // The patrol-seeking behaviour is supposed to steer at the next waypoint —
  // so a bot dropped on a waypoint should close right in on it, not spiral
  // away the way a wrong-signed steer does until the boundary stops it.
  const arrived = await run(() => {
    const g = window.__skate;
    g.switchPark('home');
    const bot = g.bots.find((b) => b.walker == null);
    bot.toStart();
    const from = bot.target;
    const wp = bot.patrol[from];
    let best = Infinity;
    for (let i = 0; i < 360; i++) {
      bot.step(1 / 60);
      const dx = wp.x - bot.ride.pos.x;
      const dz = wp.z - bot.ride.pos.z;
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return { best, from, to: bot.target };
  });
  ok(arrived.best < 3, `a fresh touring bot closes right in on its waypoint (closest ${arrived.best.toFixed(2)} m)`);
  ok(arrived.to !== arrived.from, `and gets there to move on to the next one (waypoint ${arrived.from} → ${arrived.to})`);

  // The curb around the pad is a boundary, not a wall — a bot that reaches it
  // is pinned there by the physics clamp and bails in place. Launch one from
  // just inside the edge, straight at it, and it must steer back (or bail and
  // reset) rather than grind along the fence for the whole sim.
  const keptIn = await run(() => {
    const g = window.__skate;
    g.switchPark('home');
    const bot = g.bots.find((b) => b.walker == null);
    const ride = bot.ride;
    const ex = ride.park.extentX;
    const ez = ride.park.extentZ;
    ride.reset({ x: ex - 12, y: 0, z: 0, yaw: Math.PI / 2 });
    ride.speed = 6;
    bot.trickCool = 0; // give it a launch to carry towards the curb
    let worst = Infinity;
    let lastClear = Infinity;
    for (let i = 0; i < 600; i++) {
      bot.step(1 / 60);
      const cl = Math.min(ex - Math.abs(ride.pos.x), ez - Math.abs(ride.pos.z));
      worst = Math.min(worst, cl);
      lastClear = cl;
    }
    return { worst, lastClear };
  });
  ok(keptIn.worst >= 0, `a bot launched straight at the curb never crosses the pad edge (worst ${keptIn.worst.toFixed(2)} m)`);
  ok(keptIn.lastClear > 5, `and is back rolling on the pad by the end, not pinned against the fence (${keptIn.lastClear.toFixed(1)} m inside)`);
}

// --------------------------------------------------------------------------
section('Birds');
{
  const count = await run(() => window.__skate.birds.length);
  ok(count === 3, `three birds circle the park (${count})`);

  const flight = await run(() => {
    const g = window.__skate;
    const b = g.birds[0];
    b.update(0);
    const y0 = b.group.position.y;
    const p0 = b.group.position.clone();
    b.update(3);
    return { dist: p0.distanceTo(b.group.position), y0, y1: b.group.position.y };
  });
  ok(flight.dist > 1, `a bird moves along its circuit (${flight.dist.toFixed(2)} m in 3 s)`);
  ok(flight.y0 > 3 && flight.y1 > 3, 'and stays well above the park throughout');
}

// --------------------------------------------------------------------------
section('Collectibles');
{
  const before = await run(() => {
    const g = window.__skate;
    g.switchPark('home');
    g.start();
    return { logos: g.logos.length, saved: g.save.logos };
  });
  ok(before.logos === 6, `home park has six logos to find (${before.logos})`);

  await run(() => {
    const g = window.__skate;
    const l = g.logos[0];
    g.place(l.x, l.z, 0, 0);
  });
  await sleep(1500); // real time, so the live loop's own pickup check runs it
  const picked = await run(() => ({
    collected: window.__skate.logos[0].collected,
    saved: window.__skate.save.logos,
  }));
  ok(picked.collected, 'rolling onto a logo collects it');
  ok(picked.saved === before.saved + 1, 'and it is recorded for good');

  const cleared = await run(() => {
    const g = window.__skate;
    g.switchPark('bowl');
    g.switchPark('home');
    return g.logos.every((l) => !l.collected);
  });
  ok(cleared, 'and a fresh load of the park puts them all back');
}

// --------------------------------------------------------------------------
section('Push gesture (touch and mouse)');
{
  const before = await run(() => {
    const g = window.__skate;
    g.unfreeze();
    g.place(-10,-18, 0, 0);
    return g.ride.speed;
  });
  const w = 900;
  const h = 560;
  // Left half of the screen, dragged straight down — the gesture that replaced
  // a tap, so pushing off does not need lifting the thumb between kicks.
  await page.mouse.move(w * 0.25, h * 0.4);
  await page.mouse.down();
  await page.mouse.move(w * 0.25, h * 0.4 + 60, { steps: 6 });
  // A bigger AI roster means more physics work sharing every real frame, so a
  // fixed sleep here is at the mercy of exactly how many frames land in it —
  // poll for the actual result instead.
  await page.waitForFunction(() => window.__skate.ride.speed > 0.3, null, { timeout: 4000 }).catch(() => {});
  await page.mouse.up();
  const after = await run(() => window.__skate.ride.speed);
  ok(before === 0 && after > 0.3, `sliding down the steering side pushes (0 → ${after.toFixed(2)} m/s)`);

  // Holding the thumb down, rather than lifting and pulling again each time, is
  // the actual point of the change: it has to keep pushing on its own. Each
  // stage is waited for as real speed rather than slept through — the frame
  // rate here is at the mercy of how many AI skaters are being simulated, and
  // a fixed 650ms is not reliably a full push cycle.
  await page.mouse.move(w * 0.25, h * 0.4);
  await page.mouse.down();
  await page.mouse.move(w * 0.25, h * 0.4 + 60, { steps: 6 }); // past the threshold, then just held
  await page
    .waitForFunction((a) => window.__skate.ride.speed > a + 1, after, { timeout: 10000 })
    .catch(() => {});
  const mid = await run(() => window.__skate.ride.speed);
  await page
    .waitForFunction((m) => window.__skate.ride.speed > m, mid, { timeout: 10000 })
    .catch(() => {});
  const held = await run(() => window.__skate.ride.speed);
  await page.mouse.up();
  ok(
    held > mid && mid > after,
    `holding it down keeps pushing without lifting the thumb (${after.toFixed(2)} → ${mid.toFixed(2)} → ${held.toFixed(2)} m/s)`
  );

  // And the same holds for a keyboard held down rather than tapped repeatedly.
  // Same polling: each sample is waited for as actual speed gained, since a
  // push begins before it imparts any, and a pushCount tick is not a metre.
  const before2 = await run(() => {
    const g = window.__skate;
    g.place(-10, -18, 0, 0);
    return g.ride.speed;
  });
  await page.keyboard.down('KeyW');
  await page
    .waitForFunction(() => window.__skate.ride.speed > 1, null, { timeout: 10000 })
    .catch(() => {});
  const kMid = await run(() => window.__skate.ride.speed);
  await page
    .waitForFunction((m) => window.__skate.ride.speed > m, kMid, { timeout: 10000 })
    .catch(() => {});
  const kHeld = await run(() => window.__skate.ride.speed);
  await page.keyboard.up('KeyW');
  ok(
    kHeld > kMid && kMid > before2,
    `holding W keeps pushing too (${before2.toFixed(2)} → ${kMid.toFixed(2)} → ${kHeld.toFixed(2)} m/s)`
  );
}

// --------------------------------------------------------------------------
section('Push: hold-to-push toggle');
{
  // Every test above ran with the default — on, the same always-repeating
  // behaviour the game already had before this setting existed.
  const initial = await run(() => ({
    save: window.__skate.save.holdToPush,
    cfg: window.__skate.config.HOLD_TO_PUSH,
  }));
  ok(initial.save === true && initial.cfg === true, 'defaults to on');

  // The Settings-screen button: a real click, the same as a thumb would give
  // it — flips the live config, the save, and its own label together.
  await run(() => window.__skate.hud.show('settings'));
  await page.click('#opt-holdpush', { timeout: 4000 });
  const toggled = await run(() => ({
    save: window.__skate.save.holdToPush,
    cfg: window.__skate.config.HOLD_TO_PUSH,
    label: document.getElementById('opt-holdpush').textContent,
    off: document.getElementById('opt-holdpush').classList.contains('off'),
  }));
  ok(toggled.save === false && toggled.cfg === false, 'clicking it turns hold-to-push off, live and saved');
  ok(toggled.label === 'Hold to push: Off', `and relabels itself (${toggled.label})`);
  ok(toggled.off, 'with the same dimmed styling the Sound toggle uses when off');

  // With it off, holding the key down has to get exactly the one push a
  // single press always gave — not the repeating one above. Counted via
  // ride.pushCount rather than a speed delta: at the software-GL frame rates
  // this suite hits by now (occasionally single digits), a speed comparison
  // across wall-clock sleeps is at the mercy of exactly how many real frames
  // land in each window, where an exact push count is not.
  await run(() => {
    const g = window.__skate;
    g.unfreeze();
    g.place(-10, -18, 0, 0);
  });
  const before = await run(() => window.__skate.ride.pushCount);
  await page.keyboard.down('KeyW');
  // The one push a fresh press still triggers.
  await page
    .waitForFunction((n) => window.__skate.ride.pushCount > n, before, { timeout: 10000 })
    .catch(() => {});
  const afterOnePush = await run(() => window.__skate.ride.pushCount);
  // Key still held throughout — real wall-clock time, generous on purpose so
  // there is no ambiguity about whether enough real frames landed to give a
  // wrongful second push a chance to happen.
  await sleep(1500);
  const stillHeld = await run(() => window.__skate.ride.pushCount);
  await page.keyboard.up('KeyW');
  ok(afterOnePush === before + 1, `the single push still happens (${before} → ${afterOnePush})`);
  ok(
    stillHeld === afterOnePush,
    `but holding past it does not trigger another (push count stayed at ${stillHeld})`
  );

  // Flip it back: same button, the other direction.  unfreeze() hid all screens,
  // so show settings again before Playwright tries to click the button inside it.
  await run(() => window.__skate.hud.show('settings'));
  await page.click('#opt-holdpush', { timeout: 4000 });
  const backOn = await run(() => ({
    save: window.__skate.save.holdToPush,
    cfg: window.__skate.config.HOLD_TO_PUSH,
    label: document.getElementById('opt-holdpush').textContent,
  }));
  ok(backOn.save === true && backOn.cfg === true, 'clicking it again turns hold-to-push back on');
  ok(backOn.label === 'Hold to push: On', `and its label follows (${backOn.label})`);

  await run(() => window.__skate.hud.show('start'));
}

// --------------------------------------------------------------------------
section('Audio: music starts on the first gesture');
{
  // The mouse-down in the Push gesture section above already counts as a
  // real user gesture, so by now the context should be unlocked and
  // startMusic() already kicked off — on mobile, that first tap is the
  // "start" button itself, so this is the same path a phone takes.
  const state = await run(() => {
    const a = window.__skate.audio;
    return { ready: a.ready, musicStarted: a.musicStarted, hasMusicGain: !!a.musicGain };
  });
  ok(state.ready, 'the audio context is running after a real user gesture');
  ok(state.musicStarted && state.hasMusicGain, 'and startMusic() has been kicked off');

  // startMusic() is async — it has to fetch and decode a real 5MB file — so
  // this waits for that to actually land rather than assuming it has by now.
  const loaded = await page
    .waitForFunction(() => !!window.__skate.audio.musicSource, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  ok(loaded, 'and the real track finishes loading and starts playing');
  const track = await run(() => {
    const g = window.__skate;
    const a = g.audio;
    return {
      loop: a.musicSource.loop,
      duration: a.musicSource.buffer?.duration ?? 0,
      volume: a.musicGain.gain.value,
      saved: g.save.musicVolume,
    };
  });
  ok(track.loop, 'set to loop — no scheduling here to get a seam wrong');
  ok(track.duration > 5, `and it is a real recording, not a stub (${track.duration.toFixed(1)}s)`);
  ok(
    Math.abs(track.volume - track.saved) < 0.05,
    `and it starts at the saved volume (${track.volume.toFixed(2)} vs saved ${track.saved})`
  );

  // Calling unlock() again — every pointerdown on the page does — must not
  // fetch, decode, and start a second copy of the track playing out of phase
  // with the first.
  const restarted = await run(() => {
    const a = window.__skate.audio;
    const src0 = a.musicSource;
    a.unlock();
    a.unlock();
    return a.musicSource === src0;
  });
  ok(restarted, 'and unlocking again does not start a second copy of it');
}

// --------------------------------------------------------------------------
section('Audio: the music-volume slider');
{
  // save.js's read()/setMusicVolume() both have to treat 0 as a real, valid
  // volume rather than as "unset" — the naive `Number(v) || DEFAULT` shorthand
  // every other numeric setting in save.js uses would quietly bounce a saved
  // "muted" back up to the 0.5 default on the next reload, which is exactly
  // the bug worth a dedicated check.
  const zero = await run(() => {
    const g = window.__skate;
    g.save.setMusicVolume(0);
    return g.save.musicVolume;
  });
  ok(zero === 0, `a volume of exactly 0 is accepted and kept, not treated as unset (${zero})`);

  const clamped = await run(() => {
    const g = window.__skate;
    g.save.setMusicVolume(1.4);
    const hi = g.save.musicVolume;
    g.save.setMusicVolume(-0.3);
    const lo = g.save.musicVolume;
    g.save.setMusicVolume(0.5);
    return { hi, lo };
  });
  ok(clamped.hi === 1 && clamped.lo === 0, `out-of-range values clamp to 0..1 (${clamped.lo}, ${clamped.hi})`);

  // The live node: setMusicVolume() has to reach the actual gain, not just
  // the saved number. It gets there through setTargetAtTime rather than a
  // snap, so gain.value does not reflect it on the very same synchronous
  // tick — this gives the ramp real time to settle before reading it, the
  // same as the output-level checks earlier in this file do.
  await run(() => window.__skate.audio.setMusicVolume(0.2));
  await sleep(250);
  const applied = await run(() => window.__skate.audio.musicGain.gain.value);
  ok(Math.abs(applied - 0.2) < 0.02, `setMusicVolume() reaches the live gain node (${applied.toFixed(2)})`);

  // The real slider, dragged, the way the store's other settings are already
  // tested — moving it has to update the label, save the number, and reach
  // the audio graph, all three, not just one of them.
  await run(() => window.__skate.hud.show('start'));
  const dragged = await run(() => {
    const g = window.__skate;
    const el = document.getElementById('music-range');
    el.value = 80;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { label: document.getElementById('music-value').textContent, saved: g.save.musicVolume };
  });
  ok(dragged.label === '80%', `dragging the slider updates its own label (${dragged.label})`);
  ok(Math.abs(dragged.saved - 0.8) < 0.01, `and persists to save (${dragged.saved})`);
  await sleep(250); // let the gain's own ramp settle before reading it
  const draggedLive = await run(() => window.__skate.audio.musicGain.gain.value);
  ok(Math.abs(draggedLive - 0.8) < 0.02, `and reaches the live gain node (${draggedLive.toFixed(2)})`);

  // Dragged to zero, the label reads as a word rather than "0%" — the same
  // small courtesy "Default" gets on the camera-distance slider next to it.
  const mutedLabel = await run(() => {
    const el = document.getElementById('music-range');
    el.value = 0;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('music-value').textContent;
  });
  ok(mutedLabel === 'Off', `and at zero it says so in words (${mutedLabel})`);

  // Reset restores it, the same as the speed and camera-distance sliders.
  await run(() => window.__skate.hud.on.reset());
  const afterReset = await run(() => ({
    saved: window.__skate.save.musicVolume,
    label: document.getElementById('music-value').textContent,
  }));
  ok(
    Math.abs(afterReset.saved - 0.5) < 0.01 && afterReset.label === '50%',
    `Reset stats puts the music volume back to its default too (${afterReset.saved}, "${afterReset.label}")`
  );
}

// --------------------------------------------------------------------------
section('Audio: the skate mix, measured at the output');
{
  // Every other check in this file can be read off the game's own state. Sound
  // cannot: a graph that is wired wrong, silent, or twice as loud as it should be
  // looks identical from the outside and is completely obvious the moment anyone
  // plays it. So this taps the end of the chain with an analyser and measures
  // what would actually reach the speakers.
  // Measured on a second Audio of its own rather than the game's. The running
  // loop calls follow() with the live ride state every single frame, so anything
  // this section set on the shared instance was being overwritten between the
  // setting and the reading — the menu-silence check picked up the roll the
  // skater was still doing behind it. A dedicated instance is the same class
  // driven the same way, with nothing else touching it.
  await run(async () => {
    const g = window.__skate;
    const A = g.audio.constructor;
    const a = new A(true);
    a.unlock();
    if (a.ctx.state === 'suspended') await a.ctx.resume();
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    a.limiter.connect(an); // after the limiter — what is heard, not what is sent
    a.musicGain.gain.value = 0; // or the riff is measured as a skate sound
    window.__mix = a;
    window.__an = an;
    window.__td = new Float32Array(an.fftSize);
    return a.ready;
  });

  /**
   * Hold one ride state and report the peak level it settles at.
   *
   * The states are measured quietest-first on purpose. A 0.9s reverb tail means
   * each measurement can carry the end of the one before it, and going upwards in
   * level makes that bleed negligible instead of having to wait out a full tail
   * between every reading.
   */
  const level = async (args, ms = 420) => {
    await run((a) => {
      window.__mix.hush();
      window.__hold = a;
    }, args);
    await sleep(260);
    // follow() has to keep being called: it is a per-frame call, and its gain
    // ramps only move while something is driving them.
    const pump = setInterval(() => run((a) => window.__mix.follow(...a), args).catch(() => {}), 30);
    await sleep(320); // let the ramps settle before looking
    const peak = await run(async (dur) => {
      const an = window.__an, td = window.__td;
      let p = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < dur) {
        an.getFloatTimeDomainData(td);
        for (let i = 0; i < td.length; i++) p = Math.max(p, Math.abs(td[i]));
        await new Promise((r) => setTimeout(r, 16));
      }
      return p;
    }, ms);
    clearInterval(pump);
    return peak;
  };

  const quiet = await level([0, false, false, false, false], 700);
  ok(quiet < 0.01, `nothing drones in the menus (peak ${quiet.toFixed(4)})`);

  const slow = await level([2, true, false, false, false]);
  const fast = await level([12, true, false, false, false]);
  ok(slow > 0.004, `rolling slowly is audible (${slow.toFixed(4)})`);
  ok(fast > slow * 2.5, `and rolling fast is much louder than rolling slowly (${slow.toFixed(3)} → ${fast.toFixed(3)})`);

  const rough = await level([12, true, false, true, false]);
  ok(rough > fast, `rough ground is louder than smooth at the same speed (${fast.toFixed(3)} → ${rough.toFixed(3)})`);

  // The powerslide had no sound at all before — slide() existed and nothing ever
  // called it — so this one is guarding a feature, not just a level.
  const sliding = await level([8, true, false, false, true]);
  ok(sliding > 0.05, `a powerslide actually makes a sound (${sliding.toFixed(3)})`);

  const grind = await level([8, false, true, false, false]);
  ok(grind > 0.05, `a grind makes a sound (${grind.toFixed(3)})`);
  // The one that actually bit: two stacked peaking filters made this the loudest
  // thing in the game by a factor of two, which clips once music sits under it.
  ok(grind < rough * 1.6, `and does not tower over the roll (grind ${grind.toFixed(3)} vs rough roll ${rough.toFixed(3)})`);

  // In the air the roll must stop dead — only wind, and quietly.
  const air = await level([12, false, false, false, false]);
  ok(air < fast * 0.25, `the roll cuts out in the air, leaving only wind (${air.toFixed(4)} vs ${fast.toFixed(3)})`);

  // One-shots, into silence, in the order of how big an event each one is.
  const shot = async (name, arg) => {
    await run(() => window.__mix.hush());
    await sleep(1100); // a full tail, since these are measured absolutely
    const p = run(async () => {
      const an = window.__an, td = window.__td;
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 650) {
        an.getFloatTimeDomainData(td);
        for (let i = 0; i < td.length; i++) peak = Math.max(peak, Math.abs(td[i]));
        await new Promise((r) => setTimeout(r, 16));
      }
      return peak;
    });
    await run(([n, a]) => window.__mix[n](a), [name, arg]);
    return p;
  };

  const pop = await shot('pop', 1);
  const land = await shot('land', 6);
  const lock = await shot('lock');
  const bail = await shot('bail');
  for (const [name, v] of [['pop', pop], ['land', land], ['lock', lock], ['bail', bail]]) {
    ok(v > 0.05, `${name} is clearly audible (${v.toFixed(3)})`);
    ok(v < 0.95, `and ${name} stays clear of full scale (${v.toFixed(3)})`);
  }
  ok(land > pop, `a landing lands harder than a pop (${pop.toFixed(3)} → ${land.toFixed(3)})`);
  ok(bail > land, `and a slam is the loudest thing in the game (${bail.toFixed(3)})`);

  // Done with it: shut the extra context down rather than leaving a second one
  // running for the rest of the suite.
  await run(() => {
    window.__mix.hush();
    window.__mix.ctx.close();
    window.__mix = null;
  });
}

// --------------------------------------------------------------------------
section('Camera: closer on a landscape phone');
{
  // A phone on its side keeps the same vertical field of view but has far
  // fewer vertical pixels to show it in, so the rider reads smaller from the
  // aspect change alone — nothing in the 3D scene is actually different.
  const cam = await run(() => {
    const g = window.__skate;
    g.place(0, -14, 0, 5);
    g.camera.aspect = 900 / 560; // the window this was tuned in
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const normal = { dist: g.chase.dist, height: g.chase.height };

    g.camera.aspect = 19.5 / 9; // a phone rotated into landscape
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const landscape = { dist: g.chase.dist, height: g.chase.height };

    g.camera.aspect = 900 / 560; // leave it as the real viewport actually is
    g.camera.updateProjectionMatrix();
    return { normal, landscape };
  });
  ok(
    cam.landscape.dist < cam.normal.dist * 0.9,
    `the camera sits closer in landscape (${cam.normal.dist.toFixed(2)} → ${cam.landscape.dist.toFixed(2)} m)`
  );
  ok(cam.landscape.height < cam.normal.height, 'and lower with it, along the same sightline');

  // A normal-ish window — a laptop, this test's own viewport — must not
  // change at all: only a frame meaningfully wider than that pulls in.
  const unaffected = await run(() => {
    const g = window.__skate;
    g.camera.aspect = 4 / 3;
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const at43 = g.chase.dist;
    g.camera.aspect = 900 / 560;
    g.camera.updateProjectionMatrix();
    return at43;
  });
  near(unaffected, cam.normal.dist, 0.01, 'and a normal window is not pulled in at all');
}

// --------------------------------------------------------------------------
section('Camera: distance does not grow with ground speed');
{
  // Pushing up to top speed used to walk the camera right off the back of the
  // rider. First an old speed term in wantDist, then the far bigger one: a
  // spring chasing a target that moves at a steady v settles a *permanent* v/k
  // behind it, and there are two of them stacked, which put the lens 12m back
  // on a 16 m/s push. A push, however hard, is not what moves the camera away.
  //
  // This measures camera-to-RIDER rather than chase.dist, because dist is
  // anchored on the aim point and that point deliberately leads the rider at
  // speed — dist is *supposed* to grow by exactly that lead while the rider's
  // own distance from the lens stays put.
  const runs = await run(() => {
    const g = window.__skate;
    const at = (speed) => {
      // A clean flat stretch. z = -14 sits on the funbox's ramp, and the glide
      // below never re-samples the terrain — pos.y stays at the 0.22 m it
      // spawns at, so a long fast glide onto the flat reads as a phantom 0.2 m
      // of air and lifts the camera with it. z = -28 is clear concrete, so
      // pos.y is a flat 0 all the way out.
      g.place(0, -28, 0, speed);
      // The rider has to actually travel, not just hold a velocity: the whole
      // question is where the camera settles relative to a skater in steady
      // motion, and a frozen position with 40 m/s on the clock is a state the
      // game never produces. Carrying pos forward by vel keeps it a clean
      // straight glide — no ramp to launch off, no friction to decay it.
      for (let i = 0; i < 240; i++) {
        g.ride.pos.addScaledVector(g.ride.vel, 1 / 60);
        g.chase.update(g.ride, null, 1 / 60);
      }
      return {
        dist: Math.hypot(g.camera.position.x - g.ride.pos.x,
                         g.camera.position.z - g.ride.pos.z),
        height: g.chase.height,
      };
    };
    const slow = at(2);
    const fast = at(40);
    return { slow, fast };
  });
  near(runs.fast.dist, runs.slow.dist, 0.02, `ground speed leaves the camera-to-rider distance alone (${runs.slow.dist.toFixed(2)} vs ${runs.fast.dist.toFixed(2)} m)`);
  near(runs.fast.height, runs.slow.height, 0.02, 'and the chase height too');

  // Air still has to back the camera off, or a big jump would fly out of
  // frame — this is the one case wantDist is still allowed to grow for.
  const air = await run(() => {
    const g = window.__skate;
    g.place(0, -14, 0, 6);
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const grounded = g.chase.dist;
    g.ride.pos.y = 3.0; // airHeight is derived from this, not settable directly
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const airborne = g.chase.dist;
    g.ride.pos.y = 0;
    return { grounded, airborne };
  });
  ok(air.airborne > air.grounded, `but a big air still does (${air.grounded.toFixed(2)} → ${air.airborne.toFixed(2)} m)`);
}

// --------------------------------------------------------------------------
section('Speed setting');
{
  // The setter clamps, and TOP_SPEED is what every Ride reads live — it is a
  // literal m/s ceiling now, not an abstract multiplier, so the player sets
  // the number they actually see on the HUD.
  const clamp = await run(() => {
    const g = window.__skate;
    g.config.setTopSpeed(90);
    const hi = g.config.TOP_SPEED;
    g.config.setTopSpeed(2);
    const lo = g.config.TOP_SPEED;
    g.config.setTopSpeed(16);
    return { hi, lo };
  });
  ok(clamp.hi === 50, `the top speed clamps at 50 (90 → ${clamp.hi})`);
  ok(clamp.lo === 8, `and at 8 (2 → ${clamp.lo})`);

  // The same four-push drill as the Rolling section, at two different
  // settings — a lower ceiling has to leave you slower, not just different.
  const pushAt = async (top) =>
    run((t) => {
      const g = window.__skate;
      g.config.setTopSpeed(t);
      g.place(-10,-18, 0, 0);
      for (let i = 0; i < 4; i++) {
        g.drive(1 / 120, { push: true });
        g.hold(0.5);
      }
      return g.ride.speed;
    }, top);
  const slow = await pushAt(9);
  const fast = await pushAt(28);
  await run(() => window.__skate.config.setTopSpeed(16)); // leave it as found
  ok(fast > slow * 1.5, `the setting actually changes how fast pushing gets you (${slow.toFixed(2)} vs ${fast.toFixed(2)} m/s)`);

  // The slider itself: dragging it has to reach the live ceiling and the save
  // file, and the setting has to survive being read back.
  const slider = await run(() => {
    const g = window.__skate;
    const el = g.hud.speedRange;
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      top: g.config.TOP_SPEED,
      saved: g.save.speed,
      label: g.hud.speedValueEl.textContent,
      min: el.min,
      max: el.max,
    };
  });
  ok(slider.top === 30, `dragging the slider sets the live top speed (${slider.top})`);
  ok(slider.saved === 30, 'and saves it');
  ok(slider.label === '30 m/s', `and updates its own label (${slider.label})`);
  ok(slider.min === '8' && slider.max === '50', 'over the same range the setter clamps to');

  // Leave everything as the rest of the suite expects to find it.
  await run(() => {
    const g = window.__skate;
    g.config.setTopSpeed(16);
    g.save.setSpeed(16);
    g.hud.setSpeedValue(16);
  });
}

// --------------------------------------------------------------------------
section('Camera distance setting');
{
  // The setter clamps to the same 0.5..1 range the slider itself covers —
  // 1 is where the camera already sat before this setting existed, so a
  // fresh save (or a slid-all-the-way-out slider) has to reproduce that
  // exactly, not something merely close to it.
  const clamp = await run(() => {
    const g = window.__skate;
    g.config.setCamZoom(3);
    const hi = g.config.CAM_ZOOM;
    g.config.setCamZoom(0.1);
    const lo = g.config.CAM_ZOOM;
    g.config.setCamZoom(1);
    return { hi, lo };
  });
  ok(clamp.hi === 1, `the camera-zoom setting clamps at 1 (3 → ${clamp.hi})`);
  ok(clamp.lo === 0.5, `and at 0.5 (0.1 → ${clamp.lo})`);

  // The setting itself: pulling it down has to actually sit the chase
  // camera closer, the same way the landscape-aspect correction above does
  // — and the two have to combine rather than one overriding the other.
  const dist = await run(() => {
    const g = window.__skate;
    g.place(0, -14, 0, 5);
    g.config.setCamZoom(1);
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const far = { dist: g.chase.dist, height: g.chase.height };

    g.config.setCamZoom(0.5);
    for (let i = 0; i < 90; i++) g.chase.update(g.ride, null, 1 / 60);
    const close = { dist: g.chase.dist, height: g.chase.height };

    g.config.setCamZoom(1);
    return { far, close };
  });
  ok(
    dist.close.dist < dist.far.dist * 0.65,
    `really close pulls the camera in a lot (${dist.far.dist.toFixed(2)} → ${dist.close.dist.toFixed(2)} m)`
  );
  ok(dist.close.height < dist.far.height, 'and lowers it along the same sightline');

  // The slider itself, the same way the speed one above is checked.
  const slider = await run(() => {
    const g = window.__skate;
    const el = g.hud.camZoomRange;
    el.value = '75';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      zoom: g.config.CAM_ZOOM,
      saved: g.save.camZoom,
      label: g.hud.camZoomValueEl.textContent,
      min: el.min,
      max: el.max,
    };
  });
  ok(slider.zoom === 0.75, `dragging the slider sets the live camera zoom (${slider.zoom})`);
  ok(slider.saved === 0.75, 'and saves it');
  ok(slider.label === '75%', `and updates its own label (${slider.label})`);
  ok(slider.min === '50' && slider.max === '100', 'over the same range the setter clamps to');

  // The two labelled ends read as the two things this was actually built
  // for — a really close camera, and the one that was already there.
  const ends = await run(() => {
    const g = window.__skate;
    g.hud.setCamZoomValue(1);
    const atDefault = g.hud.camZoomValueEl.textContent;
    g.hud.setCamZoomValue(0.5);
    const atClose = g.hud.camZoomValueEl.textContent;
    g.hud.setCamZoomValue(1);
    return { atDefault, atClose };
  });
  ok(ends.atDefault === 'Default', `the far end reads as where the camera already was (${ends.atDefault})`);
  ok(ends.atClose === 'Very close', `and the near end reads as a really close camera (${ends.atClose})`);

  // Leave everything as the rest of the suite expects to find it.
  await run(() => {
    const g = window.__skate;
    g.config.setCamZoom(1);
    g.save.setCamZoom(1);
    g.hud.setCamZoomValue(1);
  });
}

// --------------------------------------------------------------------------
section('Board shop and coins');
{
  const initial = await run(() => {
    const g = window.__skate;
    g.hud.on.reset();
    return { boards: g.save.boards, boardId: g.save.boardId, coins: g.save.coins };
  });
  ok(
    initial.boards.length === 1 && initial.boards[0] === 'maple',
    `a fresh save owns only the starter board (${initial.boards.join(', ')})`
  );
  ok(initial.boardId === 'maple', 'and has it equipped');
  ok(initial.coins === 0, 'with no coins yet');

  const catalogue = await run(() => window.__skate.boards.map((b) => ({ id: b.id, type: b.type, price: b.price })));
  ok(catalogue.length === 9, `the shop stocks nine boards (${catalogue.length})`);
  ok(catalogue[0].price === 0, 'the starter board is free');
  ok(catalogue.slice(1).every((b) => b.price > 0), 'and every other one costs coins');
  const types = await run(() => window.__skate.boardTypes.map((t) => t.id));
  ok(types.length === 4, `across four real board types (${types.join(', ')})`);
  ok(
    catalogue.every((b) => types.includes(b.type)),
    'and every board in the shop is one of them'
  );

  const denied = await run(() => window.__skate.selectBoard('cruiser-chrome')); // 300 coins, none yet
  ok(denied === false, 'buying a board with no coins is refused');

  const bought = await run(() => {
    const g = window.__skate;
    g.save.addCoins(500);
    const deckBefore = g.board.palette.deck;
    const lenBefore = g.board.shape.deckLen;
    const bought1 = g.selectBoard('cruiser-chrome');
    return {
      bought1,
      paletteChanged: g.board.palette.deck !== deckBefore,
      shapeChanged: g.board.shape.deckLen !== lenBefore,
      coins: g.save.coins,
      boardId: g.save.boardId,
      owned: g.save.boards,
    };
  });
  ok(bought.bought1, 'buying it with enough coins succeeds');
  ok(bought.paletteChanged, "and the board's own palette actually changes");
  ok(bought.coins === 200, `and the price is deducted (500 → ${bought.coins})`);
  ok(bought.boardId === 'cruiser-chrome', 'the bought board is equipped immediately');
  ok(
    bought.owned.includes('cruiser-chrome') && bought.owned.includes('maple'),
    'and it joins the owned list without losing the starter'
  );

  // A longboard is not just a recoloured shortboard: buying into a different
  // type has to change the deck's own shape, not only its palette.
  const shapeSwap = await run(() => {
    const g = window.__skate;
    g.save.addCoins(500);
    const lenBefore = g.board.shape.deckLen;
    g.selectBoard('longboard-ocean');
    const lenAfter = g.board.shape.deckLen;
    return { lenBefore, lenAfter };
  });
  ok(
    shapeSwap.lenAfter > shapeSwap.lenBefore + 0.1,
    `switching to a longboard actually lengthens the deck (${shapeSwap.lenBefore.toFixed(2)} → ${shapeSwap.lenAfter.toFixed(2)} m)`
  );
  const backToMaple = await run(() => {
    const g = window.__skate;
    g.selectBoard('maple');
    return g.board.shape.deckLen;
  });
  ok(backToMaple < shapeSwap.lenAfter, 'and back to the shortboard shortens it again');

  const reequip = await run(() => {
    const g = window.__skate;
    const before = g.save.coins;
    const reequipped = g.selectBoard('maple'); // already owned — no charge
    return { reequipped, coins: g.save.coins, before, boardId: g.save.boardId };
  });
  ok(reequip.reequipped, 'switching back to an owned skin succeeds');
  ok(reequip.coins === reequip.before, 'without spending anything');
  ok(reequip.boardId === 'maple', 'and it is equipped');

  // Coins from actually playing: a landed trick pays, and a banked combo pays
  // a bonus on top of what its tricks already paid — through handleEvents(),
  // the same path a real landing takes, not the save API called by hand.
  const earned = await run(() => {
    const g = window.__skate;
    g.hud.on.reset();
    g.place(-10,-22, 0, 7);
    const before = g.save.coins;
    for (const id of ['kickflip', 'heelflip']) {
      g.drive(1 / 120, { trick: id, trickCharge: 1 });
      for (let i = 0; i < 400 && g.ride.mode === 1; i++) g.drive(1 / 120, {});
      for (let i = 0; i < 30; i++) g.drive(1 / 120, {});
    }
    const afterTricks = g.save.coins;
    for (let i = 0; i < 300; i++) g.drive(1 / 120, {});
    return { before, afterTricks, afterCombo: g.save.coins };
  });
  ok(earned.afterTricks > earned.before, `landing tricks pays coins (${earned.before} → ${earned.afterTricks})`);
  ok(earned.afterCombo > earned.afterTricks, `and banking the combo pays a further bonus (→ ${earned.afterCombo})`);

  // Leave the save the way the rest of the suite expects to find it.
  await run(() => window.__skate.hud.on.reset());
}

// --------------------------------------------------------------------------
section('Outfit shop and the wind glow');
{
  const initial = await run(() => {
    const g = window.__skate;
    g.hud.on.reset();
    return { outfits: g.save.outfits, outfitId: g.save.outfitId };
  });
  ok(
    initial.outfits.length === 1 && initial.outfits[0] === 'street',
    `a fresh save owns only the starter shirt (${initial.outfits.join(', ')})`
  );
  ok(initial.outfitId === 'street', 'and has it equipped');

  const catalogue = await run(() => window.__skate.outfits.map((o) => ({ id: o.id, price: o.price })));
  ok(catalogue.length === 7, `the shop stocks seven shirts (${catalogue.length})`);
  ok(catalogue[0].price === 0, 'the starter shirt is free');
  ok(catalogue.slice(1).every((o) => o.price > 0), 'and every other one costs coins');

  const denied = await run(() => window.__skate.selectOutfit('neon')); // 300 coins, none yet
  ok(denied === false, 'buying a shirt with no coins is refused');

  const bought = await run(() => {
    const g = window.__skate;
    g.save.addCoins(500);
    const shirtBefore = g.skater.palette.shirt;
    const bought1 = g.selectOutfit('neon');
    return {
      bought1,
      changed: g.skater.palette.shirt !== shirtBefore,
      glowColorMatches: g.skater.glowMat.color.getHex() === g.outfits.find((o) => o.id === 'neon').shirt.shirt,
      coins: g.save.coins,
      outfitId: g.save.outfitId,
      owned: g.save.outfits,
    };
  });
  ok(bought.bought1, 'buying it with enough coins succeeds');
  ok(bought.changed, "and the rider's own shirt colour actually changes");
  ok(bought.glowColorMatches, 'and the wind glow re-tints to match the new shirt, not the old one');
  ok(bought.coins === 200, `and the price is deducted (500 → ${bought.coins})`);
  ok(bought.outfitId === 'neon', 'the bought shirt is worn immediately');
  ok(
    bought.owned.includes('neon') && bought.owned.includes('street'),
    'and it joins the owned list without losing the starter'
  );

  // The glow itself: invisible standing still, lit up at speed, and dark
  // again the moment the rider is off the board — a bail or a walk should
  // not leave a shirt lit up with nothing driving it.
  const glow = await run(() => {
    const g = window.__skate;
    g.place(-10,-18, 0, 0);
    g.hold(0.3);
    const atRest = g.skater.glowMat.opacity;
    g.place(-10,-18, 0, 9);
    g.hold(0.3);
    const atSpeed = g.skater.glowMat.opacity;
    g.dismount();
    g.skater.poseWalk(g.walker, 1 / 60);
    const whileWalking = g.skater.glowMat.opacity;
    return { atRest, atSpeed, whileWalking };
  });
  ok(glow.atRest < 0.05, `standing still, the shirt does not glow (${glow.atRest.toFixed(2)})`);
  ok(glow.atSpeed > glow.atRest, `moving, it does (${glow.atRest.toFixed(2)} → ${glow.atSpeed.toFixed(2)})`);
  ok(glow.whileWalking === 0, 'and it goes dark the moment the rider steps off the board');

  // AI bots skip the glow mesh entirely — it is a per-skater unique
  // material, and a park full of them is not worth the draw calls.
  const botGlow = await run(() => window.__skate.bots.every((b) => !b.skater.hasGlow));
  ok(botGlow, 'AI skaters do not carry the glow mesh at all');

  // The shirt's hem actually moves: real motion driven by speed, not a
  // static mesh sitting there for decoration. Every rider gets this one
  // (unlike the glow), bots included.
  const hem = await run(() => {
    const g = window.__skate;
    g.place(-10,-18, 0, 0);
    g.hold(0.3);
    const stillQuat = g.skater.hem.quaternion.clone();
    const stillVisible = g.skater.hem.visible;
    g.place(-10,-18, 0, 9);
    let moved = false;
    let lastQuat = g.skater.hem.quaternion.clone();
    for (let i = 0; i < 30; i++) {
      g.drive(1 / 60, {});
      if (g.skater.hem.quaternion.angleTo(lastQuat) > 0.001) moved = true;
      lastQuat.copy(g.skater.hem.quaternion);
    }
    const botHasHem = g.bots.every((b) => b.skater.hem);
    return { stillVisible, movedAtSpeed: moved, botHasHem };
  });
  ok(hem.stillVisible, 'the hem is there even standing still');
  ok(hem.movedAtSpeed, 'and actually flaps once the rider picks up speed, frame to frame');
  ok(hem.botHasHem, 'and AI skaters get it too — it costs no extra material, unlike the glow');

  // Leave the game the way the rest of the suite expects to find it.
  await run(() => {
    const g = window.__skate;
    g.hud.on.reset();
    if (g.state === 'walking') {
      g.walker.pos.set(g.board.group.position.x, g.walker.pos.y, g.board.group.position.z);
      g.mount();
    }
    g.respawn();
  });
}

// --------------------------------------------------------------------------
section('Accessory shop');
{
  const initial = await run(() => {
    const g = window.__skate;
    g.hud.on.reset();
    return { accessories: g.save.accessories, accessoryId: g.save.accessoryId };
  });
  ok(
    initial.accessories.length === 1 && initial.accessories[0] === 'none',
    `a fresh save owns only the starter accessory (${initial.accessories.join(', ')})`
  );
  ok(initial.accessoryId === 'none', 'and has it equipped');

  const catalogue = await run(() =>
    window.__skate.accessories.map((a) => ({ id: a.id, price: a.price }))
  );
  ok(catalogue.length === 7, `the shop stocks seven accessories (${catalogue.length})`);
  ok(catalogue[0].price === 0, 'the starter accessory is free');
  ok(catalogue.slice(1).every((a) => a.price > 0), 'and every other one costs coins');

  const denied = await run(() => window.__skate.selectAccessory('tophat')); // 350 coins, none yet
  ok(denied === false, 'buying a hat with no coins is refused');

  const bought = await run(() => {
    const g = window.__skate;
    g.save.addCoins(500);
    const capBefore = g.skater.palette.cap;
    const headBefore = g.skater.style.head;
    const ok1 = g.selectAccessory('tophat');
    return {
      ok1,
      headChanged: g.skater.style.head !== headBefore,
      capChanged: g.skater.palette.cap !== capBefore,
      head: g.skater.style.head,
      cap: g.skater.palette.cap,
      coins: g.save.coins,
      accessoryId: g.save.accessoryId,
      owned: g.save.accessories,
    };
  });
  ok(bought.ok1, 'buying it with enough coins succeeds');
  ok(bought.headChanged && bought.head === 'tophat', "and the rider's headwear actually changes");
  ok(bought.capChanged && bought.cap === 0x1c1c20, 'and re-colours to match the hat');
  ok(bought.coins === 150, `and the price is deducted (500 → ${bought.coins})`);
  ok(bought.accessoryId === 'tophat', 'the bought hat is worn immediately');
  ok(
    bought.owned.includes('tophat') && bought.owned.includes('none'),
    'and it joins the owned list without losing the starter'
  );

  // One head-slot, like the one shirt: buying shades puts the character's own
  // headwear back and layers the glasses over that, rather than stacking on
  // top of the hat that was there a moment ago.
  const layered = await run(() => {
    const g = window.__skate;
    g.save.addCoins(200);
    const ok2 = g.selectAccessory('gold-shades');
    return {
      ok2,
      head: g.skater.style.head,
      shades: g.skater.style.shades,
      frame: g.skater.palette.shades,
      coins: g.save.coins,
    };
  });
  ok(layered.ok2, 'buying shades on top also succeeds');
  ok(layered.head === 'cap', 'and swaps back to the character\'s own headwear');
  ok(layered.shades === true && layered.frame === 0xc9a04e, 'with the glasses added over that');
  ok(layered.coins === 50, `and the shades cost their own price (350 → ${layered.coins})`);

  // Back to "Original" takes everything off again.
  const undone = await run(() => {
    const g = window.__skate;
    g.selectAccessory('none');
    return { head: g.skater.style.head, shades: g.skater.style.shades };
  });
  ok(undone.head === 'cap' && undone.shades === false, '"Original" takes the hat and glasses back off');

  // The tutorial's demo rider wears it too, and the shop draws a portrait of
  // the equipped rider with the accessory on — not a generic swatch.
  const screen = await run(() => {
    const g = window.__skate;
    g.save.addCoins(500);
    g.selectAccessory('bucket');
    const demo = g.hud.preview?.skater;
    g.showStore();
    const grid = document.getElementById('accessory-grid');
    const cards = [...grid.querySelectorAll('[data-accessory]')];
    const canvases = [...grid.querySelectorAll('canvas.char-portrait')];
    const painted = canvases.map((c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    const bucketCard = grid.querySelector('[data-accessory="bucket"]');
    return {
      demoHead: demo?.style.head,
      demoCap: demo?.palette.cap,
      cards: cards.length,
      current: grid.querySelectorAll('.accessory-card.current').length,
      currentId: grid.querySelector('.accessory-card.current')?.dataset.accessory,
      painted,
      bucketPainted: bucketCard
        ? (() => {
            const c = bucketCard.querySelector('canvas');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
            return n;
          })()
        : 0,
      state: g.state,
    };
  });
  ok(screen.demoHead === 'bucket' && screen.demoCap === 0x8a9a5c, "and the tutorial's demo rider changes to match");
  ok(screen.cards === 7, 'with a card per accessory');
  ok(screen.current === 1 && screen.currentId === 'bucket', 'and exactly one marked as the one being worn');
  ok(
    screen.painted.length === 7 && screen.painted.every((n) => n > 400),
    `and a portrait actually drawn on every card (${screen.painted.join(', ')} pixels)`
  );

  // Leave the game the way the rest of the suite expects to find it.
  await run(() => {
    const g = window.__skate;
    g.hud.on.reset();
    if (g.state === 'walking') {
      g.walker.pos.set(g.board.group.position.x, g.walker.pos.y, g.board.group.position.z);
      g.mount();
    }
    g.respawn();
  });
}

// --------------------------------------------------------------------------
section('Menu scrolling and back buttons, on a short screen');
{
  // A phone-shaped viewport, short enough that the shop's four board types
  // and the park picker's fourteen cards cannot possibly fit without
  // scrolling — the exact case a laptop-sized test window never exercises.
  await page.setViewportSize({ width: 380, height: 640 });

  const store = await run(() => {
    const g = window.__skate;
    g.save.addCoins(600);
    g.hud.renderBoards(g.boardTypes, g.boards, g.save);
    g.hud.renderOutfits(g.outfits, g.save, g.characters[0].palette);
    g.hud.show('store');
    const el = document.getElementById('screen-store');
    return {
      overflows: el.scrollHeight > el.clientHeight,
      touchAction: getComputedStyle(el).touchAction,
      hasBack: !!document.getElementById('btn-store-back'),
    };
  });
  ok(store.overflows, 'the shop is taller than a phone screen, with this many boards in it');
  ok(store.touchAction.includes('pan-y'), 'and its touch-action allows a vertical swipe to scroll it');
  ok(store.hasBack, 'and it has a back button');

  // The actual regression: a touchmove starting inside a menu must not be
  // swallowed by the same document-level guard that stops a swipe on the
  // game canvas from becoming a page scroll or a pull-to-refresh. Real
  // Touch objects are not needed — the guard only ever looks at the
  // event's target and calls preventDefault(), so a plain cancelable event
  // exercises the exact branch that changed, deterministically, with no
  // dependency on Chromium's own wheel/touch scroll-latching behaviour.
  const guard = await run(() => {
    const inMenu = document.getElementById('board-grid');
    const evMenu = new Event('touchmove', { cancelable: true, bubbles: true });
    inMenu.dispatchEvent(evMenu);
    const onCanvas = document.getElementById('view');
    const evCanvas = new Event('touchmove', { cancelable: true, bubbles: true });
    onCanvas.dispatchEvent(evCanvas);
    return { menuBlocked: evMenu.defaultPrevented, canvasBlocked: evCanvas.defaultPrevented };
  });
  ok(!guard.menuBlocked, 'a touch-scroll starting inside a menu is not swallowed by the canvas-swipe guard');
  ok(guard.canvasBlocked, 'but a swipe on the game canvas itself still cannot become a page scroll');

  // And the element really is scrollable — overflow-y plus real content
  // taller than the viewport, not just the CSS property sitting unused.
  const scrolled = await run(() => {
    const el = document.getElementById('screen-store');
    const back = document.getElementById('btn-store-back');
    el.scrollTop = el.scrollHeight;
    const r = back.getBoundingClientRect();
    return { scrollTop: el.scrollTop, backOnScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  ok(scrolled.scrollTop > 0, `scrolling the shop actually moves it (scrollTop ${scrolled.scrollTop})`);
  ok(scrolled.backOnScreen, 'and the back button scrolls into view rather than staying stranded below the fold');

  // The park picker gets the same treatment — fourteen cards is a lot more
  // than the seven this screen was designed around.
  const parks = await run(() => {
    const g = window.__skate;
    g.hud.renderParks(g.parks, g.park.id);
    g.hud.show('parks');
    const el = document.getElementById('screen-parks');
    const overflows = el.scrollHeight > el.clientHeight;
    el.scrollTop = el.scrollHeight;
    return { overflows, hasBack: !!document.getElementById('btn-parks-back'), scrollTop: el.scrollTop };
  });
  ok(parks.overflows, 'the park picker is also taller than a phone screen with fourteen maps in it');
  ok(parks.hasBack, 'and it has a back button too');
  ok(parks.scrollTop > 0, `and it scrolls the same way (scrollTop ${parks.scrollTop})`);

  await page.setViewportSize({ width: 900, height: 560 });
  await run(() => window.__skate.hud.show('start'));
}

// --------------------------------------------------------------------------
section('Skater picker');
{
  const cat = await run(() => {
    const g = window.__skate;
    return {
      count: g.characters.length,
      ids: g.characters.map((c) => c.id),
      heads: g.characters.map((c) => c.style.head),
      named: g.characters.every((c) => !!c.name && !!c.blurb),
      // Every character has to carry a full palette, or the rig would build a
      // mesh with an undefined colour in it and fail silently to black.
      keys: g.characters.every((c) =>
        ['skin', 'hair', 'cap', 'shirt', 'sleeve', 'pants', 'pantsDark', 'shoe', 'sole', 'band', 'shades', 'lens'].every(
          (k) => typeof c.palette[k] === 'number'
        )
      ),
    };
  });
  ok(cat.count === 8, `there are eight skaters to choose between (${cat.ids.join(', ')})`);
  ok(cat.named, 'each with a name and a line describing them');
  ok(cat.keys, 'and a complete palette');
  ok(new Set(cat.heads).size === 7, `and each with their own headwear (${cat.heads.join(', ')})`);

  // Picking one rebuilds the live rig, and the pick survives a reload the same
  // way the board and the shirt do.
  const picked = await run(() => {
    const g = window.__skate;
    const before = g.save.characterId;
    const ok3 = g.selectCharacter('bolt');
    const head = g.skater.style.head;
    const capHex = g.skater.palette.cap;
    g.selectCharacter('rae');
    return { before, ok3, head, capHex, nowHead: g.skater.style.head, nowId: g.save.characterId };
  });
  ok(picked.ok3 === true, 'selectCharacter() equips one');
  ok(picked.head === 'helmet', "and rebuilds the rig with that character's own headwear");
  ok(picked.capHex === 0xc4433a, 'and their own colours');
  ok(picked.nowHead === 'hair' && picked.nowId === 'rae', 'and swapping again takes effect immediately');

  // The shirt rack layers over whichever skater is equipped, rather than
  // replacing them — the whole reason outfits are overrides now.
  const layered = await run(() => {
    const g = window.__skate;
    g.selectCharacter('nova');
    const own = g.skater.palette;
    const ownSkin = own.skin;
    g.save.addCoins(500);
    g.selectOutfit('crimson');
    const dressed = g.skater.palette;
    g.selectOutfit('street');
    return {
      ownSkin,
      ownShirt: 0x3d444e,
      dressedShirt: dressed.shirt,
      dressedSkin: dressed.skin,
      backToOwn: g.skater.palette.shirt,
    };
  });
  ok(layered.dressedShirt === 0xc65b4a, 'a bought shirt paints over the character');
  ok(layered.dressedSkin === layered.ownSkin, 'without touching their skin');
  ok(layered.backToOwn === layered.ownShirt, '"Original" puts them back in their own clothes');

  // The rack itself, which lives at the top of the shop: a card each, and a
  // portrait actually drawn on each.
  const screen = await run(() => {
    const g = window.__skate;
    g.showStore();
    const grid = document.getElementById('char-grid');
    const cards = [...grid.querySelectorAll('[data-character]')];
    const canvases = [...grid.querySelectorAll('canvas.char-portrait')];
    // A portrait that drew nothing would still be a canvas of the right size, so
    // check actual pixels landed on it.
    const painted = canvases.map((c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    return {
      state: g.state,
      cards: cards.length,
      current: grid.querySelectorAll('.char-card.current').length,
      currentId: grid.querySelector('.char-card.current')?.dataset.character,
      painted,
      hasBack: !!document.getElementById('btn-store-back'),
      visible: !document.getElementById('screen-store').hidden,
      // The rack has to sit above the boards and shirts it layers with, not
      // below them, or picking a rider means scrolling past the whole shop.
      aboveBoards:
        grid.compareDocumentPosition(document.getElementById('board-grid')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    };
  });
  ok(screen.state === 'store', 'the skater rack lives in the shop');
  ok(screen.visible && screen.hasBack, 'which shows, and has a back button');
  ok(!!screen.aboveBoards, 'with the skaters above the boards');
  ok(screen.cards === 8, 'and a card per skater');
  ok(screen.current === 1 && screen.currentId === 'nova', 'and exactly one marked as the one being skated');
  ok(
    screen.painted.length === 8 && screen.painted.every((n) => n > 400),
    `and a portrait actually drawn on every card (${screen.painted.join(', ')} pixels)`
  );

  // Tapping a card goes through the same click path the player's finger does.
  const tapped = await run(() => {
    const g = window.__skate;
    document.querySelector('[data-character="ace"]').click();
    return { id: g.save.characterId, head: g.skater.style.head };
  });
  ok(tapped.id === 'ace' && tapped.head === 'cap', 'and tapping a card picks that skater');

  // The tutorial's demo rider is a second, separate rig — it has to follow the
  // pick too, or How to play shows somebody else doing the tricks.
  const demoFollows = await run(() => {
    const g = window.__skate;
    g.selectCharacter('bolt');
    const demo = g.hud.preview?.skater;
    return demo ? { head: demo.style.head, cap: demo.palette.cap } : null;
  });
  ok(
    demoFollows && demoFollows.head === 'helmet' && demoFollows.cap === 0xc4433a,
    "and the tutorial's demo rider changes to match"
  );

  await run(() => window.__skate.hud.show('start'));
}

// --------------------------------------------------------------------------
section('Start menu: every button opens what it says');
{
  // Driven with real Playwright clicks rather than el.click(), so a button that
  // is present but not actually hittable — zero-sized, covered, inside a hidden
  // parent — fails here instead of passing on a synthetic event. Every one of
  // these screens is reachable only through its menu button, so an unwired
  // button is a screen nobody can get to.
  await run(() => {
    const g = window.__skate;
    g.save.markGuideSeen(); // a first-run save opens the guide over the top
    g.hud.show('start');
  });

  const openings = [
    ['btn-store', 'screen-store', 'store', 'btn-store-back'],
    ['btn-parks', 'screen-parks', 'parks', 'btn-parks-back'],
    ['btn-guide', 'screen-guide', 'guide', 'btn-guide-back'],
    ['btn-settings', 'screen-settings', 'settings', 'btn-settings-back'],
  ];
  for (const [button, screen, state, back] of openings) {
    let failed = '';
    await page.click(`#${button}`, { timeout: 4000 }).catch((e) => {
      failed = e.message.split('\n')[0];
    });
    const got = failed
      ? null
      : await run((s) => ({ state: window.__skate.state, hidden: document.getElementById(s).hidden }), screen);
    ok(!failed && got && !got.hidden && got.state === state, failed || `#${button} opens ${screen} (state ${got?.state})`);
    // And back out again, so the next button is clicked from the start screen.
    await page.click(`#${back}`, { timeout: 4000 }).catch(() => {});
    const home = await run(() => ({ state: window.__skate.state, hidden: document.getElementById('screen-start').hidden }));
    ok(!home.hidden && home.state === 'start', `and #${back} returns to the start screen`);
  }

  // The skaters are in the shop now, so the shop button is the only way to them.
  await page.click('#btn-store', { timeout: 4000 });
  const reachable = await run(() => {
    const grid = document.getElementById('char-grid');
    const card = grid?.querySelector('[data-character]');
    const r = card?.getBoundingClientRect();
    return { cards: grid ? grid.querySelectorAll('[data-character]').length : 0, sized: !!r && r.width > 40 && r.height > 40 };
  });
  ok(reachable.cards === 8 && reachable.sized, 'and the eight skaters are laid out inside it');
  await page.click('#btn-store-back', { timeout: 4000 });
}

// --------------------------------------------------------------------------
section('Settings screen: every control moved in together');
{
  // The four settings that used to sit loose on the start screen, plus the
  // new hold-to-push toggle, all live under one roof now — checked by DOM
  // containment rather than by re-testing what each control does, since the
  // Speed/Camera-distance/Music-volume sections above already cover that.
  await run(() => window.__skate.hud.show('settings'));
  const settings = await run(() => {
    const screen = document.getElementById('screen-settings');
    const ids = ['speed-range', 'camzoom-range', 'music-range', 'opt-sound', 'opt-holdpush'];
    return {
      containsAll: ids.every((id) => screen.contains(document.getElementById(id))),
      onStart: ids.some((id) => document.getElementById('screen-start').contains(document.getElementById(id))),
      visible: !screen.hidden,
    };
  });
  ok(settings.visible, 'the Settings screen opens');
  ok(settings.containsAll, 'and holds all five controls: speed, camera distance, music, sound, hold-to-push');
  ok(!settings.onStart, 'none of which are still duplicated on the start screen');

  await run(() => window.__skate.hud.show('start'));
}

// --------------------------------------------------------------------------
section('Pause: mobile button and Home Screen');
{
  // Nothing to pause from a menu — hidden until a run actually starts.
  const atStart = await run(() => document.getElementById('btn-pause').hidden);
  ok(atStart, 'the pause button stays hidden on the start screen');

  await run(() => {
    const g = window.__skate;
    g.unfreeze();
    g.start();
  });
  // At ~2fps the next frame can be >500ms away. Wait for updateHud() to run
  // and expose the button instead of assuming 100ms is a full frame.
  await page.waitForFunction(() => !document.getElementById('btn-pause').hidden, null, { timeout: 6000 });
  const playing = await run(() => ({
    state: window.__skate.state,
    pauseHidden: document.getElementById('btn-pause').hidden,
  }));
  ok(playing.state === 'playing', 'starting a run leaves the game in the playing state');
  ok(!playing.pauseHidden, 'and the pause button shows once mid-run');

  // A real click, the same as a thumb: pauses the game and swaps screens.
  // The button is already confirmed visible above; click it and wait for the
  // pause state to land (togglePause is synchronous so one tick is enough).
  await page.click('#btn-pause', { timeout: 4000 });
  // Wait for state to update — at 2fps one frame may elapse before updateHud
  // hides the button, so poll for state rather than sleeping a fixed delay.
  await page.waitForFunction(() => window.__skate.state === 'paused', null, { timeout: 4000 })
    .catch(() => {});
  const paused = await run(() => ({
    state: window.__skate.state,
    screenHidden: document.getElementById('screen-paused').hidden,
    inputEnabled: window.__skate.input.enabled,
    pauseHidden: document.getElementById('btn-pause').hidden,
  }));
  ok(paused.state === 'paused', 'clicking it pauses the game');
  ok(!paused.screenHidden, 'and shows the Paused screen');
  ok(!paused.inputEnabled, 'with input turned off while paused');
  // The pause button hides itself one frame after togglePause — wait for it.
  await page.waitForFunction(() => document.getElementById('btn-pause').hidden, null, { timeout: 4000 })
    .catch(() => {});
  const pauseHiddenAfterPause = await run(() => document.getElementById('btn-pause').hidden);
  ok(pauseHiddenAfterPause, 'and the pause button itself hides behind the menu');

  // Keep skating: resumes exactly where it paused.
  await page.click('#btn-resume', { timeout: 4000 });
  const resumed = await run(() => ({
    state: window.__skate.state,
    inputEnabled: window.__skate.input.enabled,
  }));
  ok(resumed.state === 'playing', 'Keep skating resumes the run');
  ok(resumed.inputEnabled, 'and input is back on');

  // The other option on that screen: leave the run entirely.
  // Wait for the button to be visible again after resuming.
  await page.waitForFunction(() => !document.getElementById('btn-pause').hidden, null, { timeout: 4000 });
  await page.click('#btn-pause', { timeout: 4000 });
  const label = await run(() => document.getElementById('btn-pause-menu').textContent);
  ok(label === 'Home Screen', `the paused screen's other button reads "Home Screen" (${label})`);
  await page.click('#btn-pause-menu', { timeout: 4000 });
  const home = await run(() => ({
    state: window.__skate.state,
    screenHidden: document.getElementById('screen-start').hidden,
    pauseHidden: document.getElementById('btn-pause').hidden,
  }));
  ok(home.state === 'start', 'Home Screen actually leaves the run, back to the start state');
  ok(!home.screenHidden, 'and shows the start screen');
  ok(home.pauseHidden, 'with the pause button hidden again now that nothing is running');
}

// --------------------------------------------------------------------------
section('Walking: dismount, mount, sit');
{
  const off = await run(() => {
    const g = window.__skate;
    g.unfreeze();
    g.place(-10,-18, 0, 0); // flat ground, standing still — reset() leaves it GROUND
    const before = { state: g.state, onFrame: g.skater.group.parent === g.ride.frame };
    g.dismount();
    return {
      before,
      after: g.state,
      skaterInScene: g.skater.group.parent === g.scene,
      boardInScene: g.board.group.parent === g.scene,
      boardPos: { x: g.board.group.position.x, z: g.board.group.position.z },
      walkerPos: { x: g.walker.pos.x, z: g.walker.pos.z },
      // Held, not parked: the deck should be up off the floor at hip-to-shoulder
      // height, not lying at the walker's feet.
      boardY: g.board.group.position.y,
      handY: g.skater.joints.hand[1].y,
      carry: g.walker.carry,
    };
  });
  ok(off.before.state === 'playing' && off.before.onFrame, 'starts on the board, riding');
  ok(off.after === 'walking', 'dismount() switches to walking');
  ok(off.skaterInScene && off.boardInScene, 'and both the rider and the board leave the ride frame for the scene');
  ok(off.carry === true, 'and the board is carried rather than left behind');
  near(off.boardPos.x, off.walkerPos.x, 0.5, 'the board travels with the walker (x)');
  near(off.boardPos.z, off.walkerPos.z, 0.5, 'and (z)');
  ok(
    off.boardY > 0.35,
    `and it is held up off the ground, not parked on it (deck at ${off.boardY.toFixed(2)} m)`
  );
  near(off.boardY, off.handY, 0.45, 'at about the height of the hand holding it');

  // Walking itself: drive the walker directly, the way input.readMove() would
  // feed it, and check it actually covers ground. Straight ahead, not turning
  // at the same time — a constant turn plus a constant forward speed traces a
  // circle, and four seconds of that is most of the way back to where it started.
  const walked = await run(() => {
    const g = window.__skate;
    const p0 = g.walker.pos.clone();
    for (let i = 0; i < 240; i++) {
      g.walker.update(1 / 60, { x: 0, y: 1 });
      g.skater.poseWalk(g.walker, 1 / 60);
    }
    return { dist: p0.distanceTo(g.walker.pos), speed: g.walker.speed };
  });
  ok(walked.dist > 1, `walking forward covers real ground in 4 s (${walked.dist.toFixed(2)} m)`);
  ok(Math.abs(walked.speed) <= 3.5, `speed stays within the walker's own ceiling (${walked.speed.toFixed(2)} m/s)`);

  // Steering: a short turn, with no forward speed to trace a circle with.
  const turned = await run(() => {
    const g = window.__skate;
    const yaw0 = g.walker.yaw;
    for (let i = 0; i < 30; i++) g.walker.update(1 / 60, { x: 0.6, y: 0 });
    return Math.abs(g.walker.yaw - yaw0);
  });
  ok(turned > 0.1, `steering the same stick turns the walker (${turned.toFixed(2)} rad in 0.5 s)`);

  // Direction, not just magnitude: a positive x on this stick has to turn the
  // walker the same way a positive steer turns the board, or getting off and
  // walking flips which way "turn right" means.
  const directions = await run(() => {
    const g = window.__skate;
    // Slow, so the pivot-turn term (not the carve) dominates — and flat, clear
    // of the funbox's own approach slope a few metres further in, whose
    // cross-slope steering would otherwise fight the pivot term at a crawl.
    g.place(0, -18, 0, 0.3);
    const yaw0 = g.ride.yaw;
    for (let i = 0; i < 30; i++) g.drive(1 / 60, { steer: 0.6 });
    const rideDelta = g.ride.yaw - yaw0;

    const wYaw0 = g.walker.yaw;
    for (let i = 0; i < 30; i++) g.walker.update(1 / 60, { x: 0.6, y: 0 });
    const walkDelta = g.walker.yaw - wYaw0;
    return { rideDelta, walkDelta };
  });
  ok(
    Math.sign(directions.rideDelta) === Math.sign(directions.walkDelta),
    `steering right turns the walker the same way it turns the board (ride ${directions.rideDelta.toFixed(2)}, walk ${directions.walkDelta.toFixed(2)})`
  );

  // The board travels with the rider, so it stays within arm's reach however far
  // they walk — there is no walking away from it any more, and nothing to walk
  // back to. This used to be the case that proved mount() refuses from far away.
  const followed = await run(() => {
    const g = window.__skate;
    for (let i = 0; i < 400; i++) g.walkStep(1 / 60, { x: 0, y: 1 });
    return Math.hypot(g.walker.pos.x - g.board.group.position.x, g.walker.pos.z - g.board.group.position.z);
  });
  ok(followed < 1.0, `the board stays in hand across a long walk (${followed.toFixed(2)} m away after 400 steps)`);

  // And getting back on works wherever they happen to be standing.
  const on = await run(() => {
    const g = window.__skate;
    g.mount();
    return {
      state: g.state,
      skaterOnFrame: g.skater.group.parent === g.ride.frame,
      boardOnFrame: g.board.group.parent === g.ride.frame,
      mode: g.ride.mode,
    };
  });
  ok(on.state === 'playing', 'mount() gets back on wherever the rider happens to be');
  ok(on.skaterOnFrame && on.boardOnFrame, 'and both are back under the ride frame');
  ok(on.mode === 0, 'ready to roll again, on the ground');

  // Sit: toggles, eases in, and a firm push stands the player back up.
  const sit = await run(() => {
    const g = window.__skate;
    g.dismount();
    const toggledOn = g.sit();
    for (let i = 0; i < 60; i++) g.walker.update(1 / 60, { x: 0, y: 0 });
    const settled = g.walker.sit;
    g.walker.update(1 / 60, { x: 0, y: 1 }); // a firm push
    const stoodUp = !g.walker.sitting;
    return { toggledOn, settled, stoodUp };
  });
  ok(sit.toggledOn, 'sit() toggles the walker into sitting');
  ok(sit.settled > 0.8, `and the pose eases into it (${sit.settled.toFixed(2)})`);
  ok(sit.stoodUp, 'a firm push while seated stands the player back up');

  // Leave the game the way the rest of the suite expects: on the board, playing.
  await run(() => {
    const g = window.__skate;
    if (g.state === 'walking') {
      g.walker.pos.set(g.board.group.position.x, g.walker.pos.y, g.board.group.position.z);
      g.mount();
    }
    g.respawn();
  });
}

// --------------------------------------------------------------------------
section('Joystick');
{
  await run(() => {
    const g = window.__skate;
    g.respawn();
    g.unfreeze();
    g.place(-10,-18, 0, 0);
    g.input.clear();
  });
  const w = 900;
  const h = 560;
  const startX = w * 0.2;
  const startY = h * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await sleep(50);
  const shown = await run(() => {
    const el = document.getElementById('joystick-base');
    return { hidden: el.hidden, left: el.style.left, top: el.style.top };
  });
  ok(!shown.hidden, 'pressing the left half of the screen shows the joystick');
  ok(shown.left === `${startX}px` && shown.top === `${startY}px`, `centred on where the thumb came down (${shown.left}, ${shown.top})`);

  await page.mouse.move(startX + 40, startY - 20, { steps: 4 }); // right and up
  await sleep(30);
  const dragged = await run(() => ({
    steer: window.__skate.input.steerTouch,
    stickY: window.__skate.input.stickY,
    transform: document.getElementById('joystick-thumb').style.transform,
  }));
  ok(dragged.steer > 0, `dragging right sets a positive steer (${dragged.steer.toFixed(2)})`);
  ok(dragged.stickY > 0, `and dragging up sets a positive forward stick (${dragged.stickY.toFixed(2)})`);
  ok(dragged.transform.includes('translate'), 'and the thumb visibly follows');

  await page.mouse.up();
  await sleep(30);
  const released = await run(() => ({
    hidden: document.getElementById('joystick-base').hidden,
    steer: window.__skate.input.steerTouch,
    stickY: window.__skate.input.stickY,
  }));
  ok(released.hidden, 'releasing hides the joystick again');
  ok(released.steer === 0 && released.stickY === 0, 'and the stick snaps back to centre');

  // readMove() combines the same stick with the keyboard, clamped to ±1.
  const combined = await run(() => {
    const g = window.__skate;
    g.input.steerTouch = 0.5;
    g.input.stickY = 0.5;
    g.input.keys.add('KeyD');
    g.input.keys.add('KeyW');
    const move = g.input.readMove();
    g.input.keys.clear();
    g.input.steerTouch = 0;
    g.input.stickY = 0;
    return move;
  });
  ok(combined.x === 1 && combined.y === 1, `readMove() combines stick and keys, clamped to ±1 (${combined.x}, ${combined.y})`);
}

// --------------------------------------------------------------------------
section('Gesture trail');
{
  await run(() => {
    const g = window.__skate;
    g.respawn();
    g.unfreeze();
    g.place(-10, -18, 0, 0);
    g.input.clear();
  });
  const w = 900;
  const h = 560;
  const startX = w * 0.7; // the flick side, not the joystick side
  const startY = h * 0.4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 70, { steps: 6 }); // the pull
  await page.mouse.move(startX + 10, startY + 66, { steps: 3 }); // a little curl
  await sleep(20);
  const live = await run(() => {
    const g = window.__skate;
    let p = null;
    for (const pt of g.input.pointers.values()) if (!pt.left) p = pt;
    return { hasPointer: !!p, pathLen: p?.path?.length || 0 };
  });
  ok(live.hasPointer, 'a flick pointer is tracked while it is down');
  ok(live.pathLen > 2, `and it is recording its own path as it moves (${live.pathLen} points)`);

  await page.mouse.move(startX - 60, startY - 40, { steps: 6 }); // the flick out
  await page.mouse.up();
  await sleep(20);
  const stashed = await run(() => {
    const t = window.__skate.input.recentTrails;
    return { count: t.length, pathLen: t[0]?.path?.length || 0 };
  });
  ok(stashed.count === 1, 'releasing it stashes the finished path for its trail to fade');
  ok(stashed.pathLen > 4, `with the whole gesture in it (${stashed.pathLen} points)`);

  // The live render loop (running because unfreeze() above started it) both
  // draws and prunes this every frame — the fade itself is measured in real
  // wall-clock time, but under software GL the frame that does the pruning can
  // land anywhere in the 350ms window, so wait for the result rather than
  // sleeping past it.
  const faded = await page
    .waitForFunction(() => window.__skate.input.recentTrails.length === 0, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  ok(faded, 'and it is gone again once its fade has finished');

  await run(() => window.__skate.freeze());
}

// --------------------------------------------------------------------------
section('Tutorial and menus');
{
  const tut = await run(() => {
    const g = window.__skate;
    g.hud.show('guide');
    const first = { step: g.hud.tutStep, prevDisabled: g.hud.tutPrev.disabled, nextLabel: g.hud.tutNext.textContent };
    for (let i = 0; i < 30; i++) g.hud.showTutStep(g.hud.tutStep + 1); // walk well past the end
    const last = { step: g.hud.tutStep, nextLabel: g.hud.tutNext.textContent };
    g.hud.showTutStep(0);
    return { first, last, dots: g.hud.tutDotEls.length };
  });
  ok(tut.first.step === 0, 'the tutorial opens on its first step');
  ok(tut.first.prevDisabled, 'with no way to go back further than that');
  ok(tut.dots >= 8, `and covers every move in its own step (${tut.dots} steps)`);
  ok(tut.last.step === tut.dots - 1, 'stepping past the end just holds on the last one');
  ok(tut.last.nextLabel.toLowerCase().includes('ride'), 'which offers to start the run instead of another step');

  const picker = await run(() => {
    const g = window.__skate;
    g.hud.renderParks(g.parks, g.park.id);
    const cards = [...g.hud.parkGrid.querySelectorAll('[data-park]')];
    return { count: cards.length, ids: cards.map((c) => c.dataset.park) };
  });
  ok(picker.count === 14, `the park picker lists all fourteen maps (${picker.count})`);
  const known = await run(() => window.__skate.parks.map((p) => p.id));
  ok(
    picker.ids.every((id) => known.includes(id)),
    'and every card points at a real map'
  );
}

// --------------------------------------------------------------------------
section('Gesture diagrams');
{
  // Every gesture diagram is drawn from the same (angle, curl) pair fed
  // straight to classify() — so the only way it could ever show a gesture
  // that does not actually work is if this pair does not classify to the
  // step's own demo trick. Checking that directly means the diagram cannot
  // silently drift out of sync with the recogniser it is meant to depict.
  const check = await run(async () => {
    const { TUTORIAL } = await import('./js/skate/hud.js');
    const { classify } = await import('./js/skate/input.js');
    const steps = TUTORIAL.filter((s) => s.gesture);
    const results = steps.map((s) => ({
      title: s.title,
      demo: s.demo,
      got: classify((s.gesture.angle * Math.PI) / 180, s.gesture.curl),
    }));
    return { results, count: steps.length };
  });
  ok(check.count === 16, `every one of the sixteen tricks has its own gesture diagram (${check.count})`);
  const mismatches = check.results.filter((r) => r.got !== r.demo);
  ok(
    mismatches.length === 0,
    mismatches.length === 0
      ? 'and every diagram classifies to exactly the trick it demos'
      : `but ${mismatches.map((m) => `${m.title}: got ${m.got}, wanted ${m.demo}`).join('; ')}`
  );
  const demoIds = check.results.map((r) => r.demo);
  ok(new Set(demoIds).size === demoIds.length, 'and no two tricks share the same gesture');

  // The diagram itself has to actually draw something, on a plain 2D canvas
  // rather than the demo's WebGL one — a smoke test for the drawing code
  // itself, not just the numbers that feed it.
  const drew = await run(async () => {
    const { drawGestureDiagram } = await import('./js/skate/gesture-diagram.js');
    const c = document.createElement('canvas');
    c.width = 90;
    c.height = 120;
    const ctx = c.getContext('2d');
    drawGestureDiagram(ctx, 90, 120, { angle: 146, curl: -1.6 }, 0.5);
    const data = ctx.getImageData(0, 0, 90, 120).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
    return lit;
  });
  ok(drew > 50, `and drawing one actually paints pixels (${drew} touched)`);
}

// --------------------------------------------------------------------------
section('Tutorial demos');
{
  // Every step with a demo actually shows the canvas; the one step with none
  // (Coins) leaves it hidden rather than showing a stale frame of whatever
  // played last.
  const wiring = await run(() => {
    const g = window.__skate;
    g.hud.show('guide');
    const out = [];
    for (let i = 0; i < g.hud.tutDotEls.length; i++) {
      g.hud.showTutStep(i);
      out.push({ hasDemo: !!g.hud.preview?.mode, canvasHidden: g.hud.demoCanvas.hidden });
    }
    return out;
  });
  ok(
    wiring.every((s) => s.hasDemo !== s.canvasHidden),
    'every step shows the canvas exactly when it has a demo running'
  );
  ok(wiring.some((s) => !s.hasDemo), 'and at least one step (Coins) has none');

  // Each demo is real physics, not a loop of pre-baked poses — running it
  // forward has to actually put the ride through the mode the step teaches.
  // The lookup from title to step index comes from the same array the HUD
  // itself steps through, not a hand-kept copy that could drift from it.
  const byTitle = await run(() => {
    const g = window.__skate;
    // showTutStep only exposes state by index, so walk every index once and
    // read the title straight back off the rendered card.
    const map = {};
    for (let i = 0; i < g.hud.tutDotEls.length; i++) {
      g.hud.showTutStep(i);
      map[g.hud.tutTitle.textContent] = i;
    }
    return map;
  });

  const checkDemo = async (title, frames, assertFn, label) => {
    const outcome = await run(
      ({ i, frames }) => {
        const g = window.__skate;
        g.hud.showTutStep(i);
        const p = g.hud.preview;
        const seen = { air: false, grind: false, manual: false, sliding: false, grab: false };
        // step(), not update(): the real loop renders once per animation
        // frame, but hundreds of synchronous WebGL draws back to back (what
        // update() would do here) is enough to bog the page down for the
        // checks that run right after this one — the physics is all this
        // needs, so skip the render entirely.
        for (let f = 0; f < frames; f++) {
          p.step(1 / 120);
          if (p.mode === 'walk') continue;
          if (p.ride.mode === 1) seen.air = true;
          if (p.ride.mode === 2) seen.grind = true;
          if (p.ride.manual) seen.manual = true;
          if (p.ride.sliding) seen.sliding = true;
          if (p.ride.grab) seen.grab = true;
        }
        const walkerMoved = p.mode === 'walk' ? p.walker.stride > 0.5 : null;
        return { seen, walkerMoved, mode: p.mode };
      },
      { i: byTitle[title], frames }
    );
    ok(assertFn(outcome), `${label} (mode ${outcome.mode})`);
  };

  await checkDemo('Charge & ollie', 400, (o) => o.seen.air, "the ollie demo actually leaves the ground");
  await checkDemo('Kickflip', 400, (o) => o.seen.air, 'the kickflip demo leaves the ground');
  await checkDemo('Heelflip', 400, (o) => o.seen.air, 'the heelflip demo leaves the ground');
  await checkDemo('Pop Shuvit', 400, (o) => o.seen.air, 'the pop shuvit demo leaves the ground');
  await checkDemo('Frontside Shuvit', 400, (o) => o.seen.air, 'the frontside shuvit demo leaves the ground');
  await checkDemo('Varial Kickflip', 400, (o) => o.seen.air, 'the varial kickflip demo leaves the ground');
  await checkDemo('Hardflip', 400, (o) => o.seen.air, 'the hardflip demo leaves the ground');
  await checkDemo('Gazelle Flip', 450, (o) => o.seen.air, 'the gazelle flip demo leaves the ground');
  await checkDemo('360 Flip', 450, (o) => o.seen.air, 'the 360 flip demo leaves the ground');
  await checkDemo('Varial Heelflip', 450, (o) => o.seen.air, 'the varial heelflip demo leaves the ground');
  await checkDemo('Inward Heelflip', 450, (o) => o.seen.air, 'the inward heelflip demo leaves the ground');
  await checkDemo('360 Heelflip', 450, (o) => o.seen.air, 'the 360 heelflip demo leaves the ground');
  await checkDemo('Nightmare Flip', 450, (o) => o.seen.air, 'the nightmare flip demo leaves the ground');
  await checkDemo('360 Shuvit', 400, (o) => o.seen.air, 'the 360 shuvit demo leaves the ground');
  await checkDemo('Frontside 360 Shuvit', 400, (o) => o.seen.air, 'the frontside 360 shuvit demo leaves the ground');
  await checkDemo('Impossible', 400, (o) => o.seen.air, 'the impossible demo leaves the ground');
  // The grab demos: real air AND a real grab, not just an ollie that happens
  // to share the same setup — a demo that popped but never actually grabbed
  // would be teaching the wrong half of the trick.
  await checkDemo('Indy', 450, (o) => o.seen.air && o.seen.grab, 'the indy demo actually grabs mid-air');
  await checkDemo('Mute', 450, (o) => o.seen.air && o.seen.grab, 'the mute demo actually grabs mid-air');
  await checkDemo('Nose Grab', 450, (o) => o.seen.air && o.seen.grab, 'the nose grab demo actually grabs mid-air');
  await checkDemo('Tail Grab', 450, (o) => o.seen.air && o.seen.grab, 'the tail grab demo actually grabs mid-air');
  await checkDemo('Method', 450, (o) => o.seen.air && o.seen.grab, 'the method demo actually grabs mid-air');
  await checkDemo('Grinds', 450, (o) => o.seen.grind, 'the grind demo actually locks onto the rail');
  await checkDemo('Manuals', 450, (o) => o.seen.manual, 'the manual demo actually drops into a manual');
  await checkDemo('Powerslide', 400, (o) => o.seen.sliding, 'the powerslide demo actually slides');
  await checkDemo('On foot', 200, (o) => o.walkerMoved, 'the on-foot demo actually walks');

  await run(() => window.__skate.hud.showTutStep(0));
}

// --------------------------------------------------------------------------
section('The loop and the page');
{
  await run(() => {
    window.__skate.unfreeze();
    window.__skate.respawn();
  });
  const before = await run(() => window.__skate.frames);
  // Generous on purpose, the same way the space-bar check below is: by this
  // point the suite has driven dozens of tutorial demos through thousands of
  // synchronous physics steps, and a slow machine's real frame rate can be
  // well under 60 here. The point of this check is that the loop is alive
  // at all, not how fast it is.
  await sleep(2000);
  const after = await run(() => window.__skate.frames);
  ok(after > before, `the render loop runs (${after - before} frames in 2 s)`);

  // Keyboard: hold the charge, release, and expect to be off the ground.
  // The charge is waited for, not slept through — the same pattern as the grab
  // section: a park full of AI skaters can push a slow machine's real frame
  // rate well under 60, and a fixed 900ms of real time is not reliably a
  // useful charge, where waiting for ride.charge is exactly that however long
  // it actually takes.
  await run(() => {
    window.__skate.place(-10,-18, 0, 6);
  });
  await page.keyboard.down('Space');
  await page
    .waitForFunction(() => window.__skate.ride.charge >= 0.85, null, { timeout: 10000 })
    .catch(() => {});
  await page.keyboard.up('Space');
  const airborne = await page
    .waitForFunction(() => window.__skate.ride.mode === 1, null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok(airborne, 'space bar loads and releases into an ollie');

  const hudText = await page.evaluate(() => document.getElementById('score')?.textContent);
  ok(typeof hudText === 'string', 'the HUD is wired up');

  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const missing = readdirSync(join(ROOT, 'js/skate'))
    .map((f) => `js/skate/${f}`)
    .filter((f) => !sw.includes(f));
  ok(missing.length === 0, `every skate module is precached${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  ok(sw.includes('index.html') && sw.includes('css/skate.css'), 'and so are the page and its stylesheet');
  ok(
    sw.includes('audio/theme.mp3') && existsSync(join(ROOT, 'audio/theme.mp3')),
    'and the music track is both on disk and named in the service worker'
  );
}

// --------------------------------------------------------------------------
section('The park editor');
{
  // Open the editor on a hand-built file — the same shape parkFile.js writes
  // and validate() would accept on the way back in.
  const open = await run(() => {
    const g = window.__skate;
    g.openDesigner({
      v: 1,
      id: 'user-smoke',
      name: 'Smoke ramp',
      blurb: 'Built by the smoke test.',
      extent: 20,
      ground: 'wood',
      spawn: { x: 0, z: -17 },
      objects: [
        { id: 's1', type: 'slab', x: 0, z: 0, ry: 0, sx: 1, sz: 1, w: 8, d: 4, h: 0.25, color: 'concrete' },
        { id: 's2', type: 'quarter', x: 0, z: -9, ry: 0, sx: 1, sz: 1, w: 4, R: 2.4, H: 1.8, deck: 0.6, color: 'wood' },
      ],
    });
    return {
      active: g.designer.active,
      objects: g.designer.file.objects.length,
      pickables: g.designer.pickables.length,
      chromeShown: !document.getElementById('designer').hidden,
      overlayShown: !document.getElementById('overlay').hidden,
      state: g.state,
    };
  });
  ok(open.active && open.chromeShown && !open.overlayShown, 'opening the editor shows its chrome and hides the overlay');
  ok(open.state === 'designer', 'and puts the app in the designer state');
  ok(open.objects === 2 && open.pickables === 2, `with both objects live in the editor scene (${open.objects} objects, ${open.pickables} pickables)`);

  // The palette path: add a third object, then select and inspect one.
  const added = await run(() => {
    const g = window.__skate;
    g.designer.addObject('stairs');
    g.designer.select('s2');
    return {
      objects: g.designer.file.objects.length,
      pickables: g.designer.pickables.length,
      sel: g.designer.sel,
      panelText: document.getElementById('dg-panel')?.textContent.length || 0,
    };
  });
  ok(added.objects === 3 && added.pickables === 3, 'the palette adds an object to the file and the scene');
  ok(added.sel === 's2', 'selecting an object marks it');
  ok(added.panelText > 40, 'and fills the properties panel');

  // Every palette type has to actually build its preview and paint its
  // collision — a crash or a missing builder here shows up only when a player
  // picks that object, so try them all rather than trusting a representative.
  const palette = await run(() => {
    const g = window.__skate;
    const results = [];
    for (const type of ['bank', 'rail', 'ledge', 'funbox']) {
      let ok = true;
      try {
        g.designer.addObject(type);
      } catch {
        ok = false;
      }
      results.push(`${type}:${ok ? 'ok' : 'THREW'}`);
    }
    return {
      results,
      objects: g.designer.file.objects.length,
      pickables: g.designer.pickables.length,
    };
  });
  ok(palette.results.every((r) => r.endsWith(':ok')), `every palette type builds its preview (${palette.results.join(', ')})`);
  ok(palette.objects === 7 && palette.pickables === 7, `and each one lands in the file and the scene (${palette.objects} objects)`);

  // Save writes the file to storage.
  const saved = await run(() => {
    window.__skate.designer.save();
    return JSON.parse(localStorage.getItem('skate.parks') || '[]').map((f) => f.id);
  });
  ok(saved.includes('user-smoke'), 'Save persists the file to storage');

  // Save & Test loads the park and starts the run.
  const tested = await run(() => {
    const g = window.__skate;
    g.designer.on.test();
    return {
      state: g.state,
      park: g.park.id,
      active: g.designer.active,
      chromeShown: !document.getElementById('designer').hidden,
      spawnX: g.park.spawn.x,
      spawnZ: g.park.spawn.z,
    };
  });
  ok(tested.state === 'playing' && !tested.active && !tested.chromeShown, 'Save & Test leaves the editor and starts the run');
  ok(tested.park === 'user-smoke', `on the park just built (${tested.park})`);
  ok(tested.spawnX === 0 && tested.spawnZ === -17, 'from the file\'s own clear spawn');

  // The My Parks screen lists the saved park, and Delete removes it.
  await run(() => {
    const g = window.__skate;
    g.freeze();
    g.showMyParks();
  });
  const listed = await run(() => document.getElementById('mypark-grid')?.textContent || '');
  ok(listed.includes('Smoke ramp'), 'My Parks lists the park just built');
  await run(() => document.querySelector('[data-act="delete"]')?.click());
  const afterDelete = await run(() => ({
    grid: document.getElementById('mypark-grid')?.textContent || '',
    files: JSON.parse(localStorage.getItem('skate.parks') || '[]').length,
    current: window.__skate.state,
  }));
  ok(!afterDelete.grid.includes('Smoke ramp') && afterDelete.files === 0, 'Delete removes it from the grid and from storage');
  ok(afterDelete.current === 'myparks', 'and the screen stays put');

  await run(() => window.__skate.showStart());
}

await page.goto(`${BASE}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
await run(() => {
  window.__skate.start();
  window.__skate.place(0, -16, 0, 6);
});
await sleep(600);
await page.screenshot({ path: join(SHOTS, 'skate-smoke.png') });

ok(errors.length === 0, `no page errors${errors.length ? `\n       ${errors.join('\n       ')}` : ''}`);

await browser.close();

console.log('');
if (failures) {
  console.error(`${failures} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`all ${checks} checks passed  (screenshots in ${relative(ROOT, SHOTS) || SHOTS})`);

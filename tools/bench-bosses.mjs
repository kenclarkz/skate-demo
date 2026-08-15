// Measure each boss's trick/score rate over a simulated 2-minute ride.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'js/skate/boss.js'), 'utf8');
const bosses = [...src.matchAll(/\{\s*id: '(\w+)',\s*parkId: '(\w+)',[\s\S]*?skill: (\d),[\s\S]*?pace: ([0-9.]+),/g)].map((m) => ({
  id: m[1], parkId: m[2], skill: parseInt(m[3], 10), pace: parseFloat(m[4]),
}));

const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
let chromium;
try { chromium = pick(await import('playwright')); } catch { chromium = null; }
if (!chromium) throw new Error('no playwright');

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
const browser = await chromium.launch({ args: GL_ARGS, executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 })).newPage();
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });

for (const b of bosses) {
  const res = await page.evaluate(async ({ parkId }) => {
    const g = window.__skate;
    const C = g.config;
    g.save.unlockPark(parkId);
    g.switchPark(parkId);
    g.start();
    g.setRunScore(500000);          // reveals the park's first boss (skate-in)
    g.endBossCutscene();            // put the boss back on foot
    g.freeze();
    g.startChallenge();             // both boards down
    let tricks = 0, score = 0, bails = 0, t50 = null;
    let trickPts = 0, sketchy = 0, comboLost = 0, combos = 0;
    const labels = {};
    const bailReasons = {};
    const steps = Math.round(120 / C.FIXED_DT);
    const far = { x: 99999, y: 0, z: 99999 };
    const modeT = {};
    let nearEdgeT = 0, minClear = Infinity;
    let slowT = 0, stalledT = 0, lastX = 0, lastZ = 0, stationaryT = 0;
    const speedBuckets = {};
    for (let i = 0; i < steps; i++) {
      g.boss.step(C.FIXED_DT, far);
      const r = g.boss.ride;
      const m = r.mode;
      modeT[m] = (modeT[m] || 0) + C.FIXED_DT;
      const sp = Math.abs(r.speed);
      const bucket = sp < 1 ? 's<1' : sp < 2.4 ? 's1-2.4' : sp < 4 ? 's2.4-4' : 's>4';
      speedBuckets[bucket] = (speedBuckets[bucket] || 0) + C.FIXED_DT;
      if (sp < 2.4) slowT += C.FIXED_DT;
      if (i % 60 === 0) {
        const dx = r.pos.x - lastX, dz = r.pos.z - lastZ;
        if (dx * dx + dz * dz < 1) stationaryT += C.FIXED_DT;
        lastX = r.pos.x; lastZ = r.pos.z;
      }
      const cx = r.park.extentX - Math.abs(r.pos.x);
      const cz = r.park.extentZ - Math.abs(r.pos.z);
      const clear = Math.min(cx, cz);
      minClear = Math.min(minClear, clear);
      if (clear < 12) nearEdgeT += C.FIXED_DT;
      for (const e of g.boss.ride.events) {
        if (e.name === 'trick') {
          tricks++;
          trickPts += e.points;
          if (e.sketchy) sketchy++;
          labels[e.label] = (labels[e.label] || 0) + 1;
          if (tricks === 50) t50 = i * C.FIXED_DT;
        } else if (e.name === 'combo') { score += e.total; combos++; }
        else if (e.name === 'bail') { bails++; bailReasons[e.reason] = (bailReasons[e.reason] || 0) + 1; }
        else if (e.name === 'comboLost') comboLost++;
      }
      g.boss.ride.events.length = 0;
    }
    return { tricks, score, bails, t50, trickPts, sketchy, comboLost, combos, labels, bailReasons, modeT, nearEdgeT, minClear, slowT, stationaryT, speedBuckets };
  }, { parkId: b.parkId });
  const top = Object.entries(res.labels).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(' ');
  const br = Object.entries(res.bailReasons).map(([k, v]) => `${k}×${v}`).join(' ');
  const mT = [0, 1, 2, 3].map((m) => `${Math.round((res.modeT[m] || 0))}s`).join('/');
  const sb = Object.entries(res.speedBuckets).map(([k, v]) => `${k}=${Math.round(v)}s`).join(' ');
  console.log(
    `${b.id.padEnd(9)} skill=${b.skill} pace=${b.pace.toFixed(2)} tricks=${String(res.tricks).padStart(3)} ` +
    `pts=${String(Math.round(res.score)).padStart(6)} tPts=${String(Math.round(res.trickPts)).padStart(6)} ` +
    `bails=${String(res.bails).padStart(3)} sk=${String(res.sketchy).padStart(3)} lost=${String(res.comboLost).padStart(4)} ` +
    `cb=${String(res.combos).padStart(3)} t50=${res.t50 === null ? '—' : res.t50.toFixed(1) + 's'} g/a/k/b=${mT} ` +
    `edge=${Math.round(res.nearEdgeT)}s/${res.minClear.toFixed(1)}m slow=${Math.round(res.slowT)}s still=${Math.round(res.stationaryT)}s ${sb}  ${top}  [${br}]`
  );
}

await browser.close();

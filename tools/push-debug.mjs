import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, GL_ARGS } from './pw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE || 'http://localhost:8080';
const OUT = join(ROOT, '.smoke', 'push-debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const chromium = await loadChromium();
const browser = await chromium.launch({ args: GL_ARGS });
const context = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
await page.goto(`${BASE}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
await page.evaluate(() => window.__skate.start());
await page.evaluate(() => {
  const g = window.__skate;
  g.place(0, -16, 0, 2.4);
  g.hold(0.05);
  g.ride.push = 0.001;
  g.ride.updatePose(1/120);
  g.skater.pose(g.ride.state, 1/120);
  g.freeze();
});
await page.evaluate(async () => {
  const THREE = await import('/js/game/three.js');
  const g = window.__skate;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const mat2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const s = () => new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat);
  const s2 = () => new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat2);
  const j = g.skater.joints;
  const markers = [];
  const at = (m, p) => { m.position.copy(p); return m; };
  for (let i = 0; i < 2; i++) {
    markers.push(at(s(), j.hip[i]));
    markers.push(at(s2(), j.knee[i]));
    markers.push(at(s(), j.foot[i]));
  }
  markers.push(at(s2(), j.pelvis));
  g.ride.frame.add(...markers);
  window.__markers = markers;
  // give one marker a distinct color for the back leg foot
  const big = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0x0000ff }));
  big.position.copy(j.foot[1]);
  g.ride.frame.add(big);
});
const phases = [0.28, 0.5];
for (const p of phases) {
  await page.evaluate((pp) => {
    const g = window.__skate;
    g.ride.push = pp;
    g.ride.updatePose(1/120);
    g.skater.pose(g.ride.state, 1/120);
    const j = g.skater.joints;
    for (let i = 0; i < 2; i++) {
      window.__markers[i*3].position.copy(j.hip[i]);
      window.__markers[i*3+1].position.copy(j.knee[i]);
      window.__markers[i*3+2].position.copy(j.foot[i]);
    }
    window.__markers[6].position.copy(j.pelvis);
    g.chase.snap(g.ride);
  }, p);
  await sleep(120);
  await page.screenshot({ path: join(OUT, `j-p${p}-chase.png`) });
  await page.evaluate(() => {
    const g = window.__skate;
    g.inspect(2.4, 1.5, 0.9, 0.45);
  });
  await sleep(120);
  await page.screenshot({ path: join(OUT, `j-p${p}-heel.png`) });
  await page.evaluate(() => {
    const g = window.__skate;
    g.inspect(-2.4, 1.5, 0.9, 0.45);
  });
  await sleep(120);
  await page.screenshot({ path: join(OUT, `j-p${p}-toe.png`) });
}
await browser.close();
console.log('done');

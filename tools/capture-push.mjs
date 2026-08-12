import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, GL_ARGS } from './pw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE || 'http://localhost:8080';
const OUT = join(ROOT, '.smoke', 'push');
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

const phases = [0.05, 0.15, 0.25, 0.30, 0.40, 0.55, 0.70, 0.82, 0.90, 0.97];
for (const p of phases) {
  await page.evaluate((pp) => {
    const g = window.__skate;
    g.ride.push = pp;
    g.ride.updatePose(1/120);
    g.skater.pose(g.ride.state, 1/120);
    g.chase.snap(g.ride);
  }, p);
  await sleep(120);
  await page.screenshot({ path: join(OUT, `push-p${String(p).replace('.', '-')}-chase.png`) });
  // toe side close
  await page.evaluate(() => {
    const g = window.__skate;
    g.inspect(-2.4, 1.5, 0.9, 0.45);
  });
  await sleep(120);
  await page.screenshot({ path: join(OUT, `push-p${String(p).replace('.', '-')}-toe.png`) });
  // heel side close
  await page.evaluate(() => {
    const g = window.__skate;
    g.inspect(2.4, 1.5, 0.9, 0.45);
  });
  await sleep(120);
  await page.screenshot({ path: join(OUT, `push-p${String(p).replace('.', '-')}-heel.png`) });
}
await browser.close();
console.log('done');

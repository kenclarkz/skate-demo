// One-off diagnostic: for every park, sample the ground height along the
// spawn's own forward direction and flag any step that looks like a wall —
// a discontinuity you'd roll straight into within the first few metres,
// before a player has any chance to react.
import { loadChromium, GL_ARGS } from './pw.mjs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:8090/skate';
const chromium = await loadChromium();
const browser = await chromium.launch({ args: GL_ARGS });
const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
const page = await context.newPage();
await page.goto(`${BASE}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });

const report = await page.evaluate(() => {
  const g = window.__skate;
  const out = [];
  for (const def of g.parks) {
    const p = g.switchPark(def.id);
    const { x, z, yaw } = p.spawn;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const spawnY = p.heightAt(x, z);
    const samples = [];
    let maxStep = 0;
    let maxStepAt = 0;
    let prevY = spawnY;
    for (let d = 0; d <= 5; d += 0.1) {
      const y = p.heightAt(x + fx * d, z + fz * d);
      samples.push(+y.toFixed(3));
      const step = Math.abs(y - prevY);
      if (step > maxStep) {
        maxStep = step;
        maxStepAt = d;
      }
      prevY = y;
    }
    // Also check immediately behind and to both sides, in case the spawn
    // itself sits right at a feature's edge.
    const around = {
      behind: p.heightAt(x - fx * 0.3, z - fz * 0.3),
      left: p.heightAt(x - fz * 0.5, z + fx * 0.5),
      right: p.heightAt(x + fz * 0.5, z - fx * 0.5),
    };
    out.push({ id: def.id, spawnY: +spawnY.toFixed(3), maxStep: +maxStep.toFixed(3), maxStepAt, around, samples });
  }
  return out;
});

for (const r of report) {
  const bad = r.maxStep > 0.15;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${r.id.padEnd(12)} spawnY=${r.spawnY}  maxStep=${r.maxStep} at ${r.maxStepAt.toFixed(1)}m  around=${JSON.stringify(r.around)}`);
  if (bad) console.log(`       samples: ${r.samples.join(' ')}`);
}
await browser.close();

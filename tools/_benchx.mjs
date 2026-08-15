import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'js/skate/boss.js'), 'utf8');
const bosses = [...src.matchAll(/\{\s*id: '(\w+)',\s*parkId: '(\w+)',[\s\S]*?skill: (\d),[\s\S]*?pace: ([0-9.]+),/g)].map((m) => ({ id: m[1], parkId: m[2] }));
const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 })).newPage();
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const runs = 3;
for (const b of bosses) {
  const res = await page.evaluate(async ({ parkId, runs }) => {
    const g = window.__skate;
    const C = g.config;
    const far = { x: 99999, y: 0, z: 99999 };
    const out = [];
    for (let r = 0; r < runs; r++) {
      g.save.unlockPark(parkId);
      g.switchPark(parkId);
      g.start();
      g.setRunScore(500000);
      g.endBossCutscene();
      g.freeze();
      g.startChallenge();
      let tricks = 0, score = 0, bails = 0;
      const steps = Math.round(120 / C.FIXED_DT);
      for (let i = 0; i < steps; i++) {
        g.boss.step(C.FIXED_DT, far);
        for (const e of g.boss.ride.events) {
          if (e.name === 'trick') tricks++;
          else if (e.name === 'combo') score += e.total;
          else if (e.name === 'bail') bails++;
        }
        g.boss.ride.events.length = 0;
      }
      out.push({ tricks, score: Math.round(score), bails });
    }
    return out;
  }, { parkId: b.parkId, runs });
  const ok = res.filter((x) => x.tricks >= 50 && x.score >= 20000).length;
  const all = res.map((x) => `${x.tricks}/${x.score}`).join(' ');
  console.log(`${b.id.padEnd(9)} ${ok}/${runs} pass  ${all}  (bails: ${res.map((x) => x.bails).join(',')})`);
}
await browser.close();

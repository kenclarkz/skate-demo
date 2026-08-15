const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const g = window.__skate;
  const C = g.config;
  const res = {};
  for (const id of ['home', 'nova', 'plaza', 'bolt', 'vert', 'shove', 'railway', 'gnorbert', 'bananas', 'raven']) {
    g.save.unlockPark(id);
    g.switchPark(id);
    g.start();
    g.setRunScore(500000);
    g.endBossCutscene();
    g.freeze();
    g.startChallenge();
    const park = g.ride.park;
    const b = g.boss;
    b.planRoute(null);
    const bp = b.ride.park;
    const pts = b.patrol.map((p) => ({ x: Math.max(-(bp.extentX - 12), Math.min(bp.extentX - 12, p.x)), z: Math.max(-(bp.extentZ - 12), Math.min(bp.extentZ - 12, p.z)) }));
    const mat = [];
    for (let i = 0; i < pts.length; i++) {
      const row = [];
      for (let j = 0; j < pts.length; j++) {
        if (i === j) { row.push('.'); continue; }
        const dx = pts[j].x - pts[i].x, dz = pts[j].z - pts[i].z;
        const len = Math.hypot(dx, dz);
        const n = Math.max(2, Math.ceil(len / 0.4));
        let up = 0, down = 0;
        for (const off of [0, 1.3, -1.3]) {
          const px = -dz / len, pz = dx / len;
          const ox = px * off, oz = pz * off;
          let ly = bp.heightAt(pts[i].x + ox, pts[i].z + oz);
          for (let k = 1; k <= n; k++) {
            const t = k / n;
            const y = bp.heightAt(pts[i].x + dx * t + ox, pts[i].z + dz * t + oz);
            if (y - ly > up) up = y - ly;
            if (ly - y > down) down = ly - y;
            ly = y;
          }
        }
        row.push(up <= 0.2 && down <= 0.2 ? 's' : `${up.toFixed(1)}`);
      }
      mat.push(row.join(' '));
    }
    res[id] = {
      patrol: pts.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`),
      route: (b.route || []).map((w) => `${w.x.toFixed(0)},${w.z.toFixed(0)}`),
      mat,
    };
  }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

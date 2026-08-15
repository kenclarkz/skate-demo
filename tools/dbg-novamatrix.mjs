const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const g = window.__skate;
  g.save.unlockPark('nova');
  g.switchPark('nova');
  g.start();
  const park = g.ride.park;
  const pts = park.patrol.map((p) => {
    const m = 12;
    const extX = park.extentX, extZ = park.extentZ;
    return { x: Math.max(-extX + m, Math.min(extX - m, p.x)), z: Math.max(-extZ + m, Math.min(extZ - m, p.z)) };
  });
  const rows = [];
  for (let i = 0; i < pts.length; i++) {
    const line = [];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) { line.push('.'); continue; }
      const dx = pts[j].x - pts[i].x, dz = pts[j].z - pts[i].z;
      const len = Math.hypot(dx, dz);
      const n = Math.max(2, Math.ceil(len / 0.4));
      let up = 0, down = 0;
      for (const off of [0, 1.3, -1.3]) {
        const px = -dz / len, pz = dx / len;
        const ox = px * off, oz = pz * off;
        let ly = park.heightAt(pts[i].x + ox, pts[i].z + oz);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const y = park.heightAt(pts[i].x + dx * t + ox, pts[i].z + dz * t + oz);
          if (y - ly > up) up = y - ly;
          if (ly - y > down) down = ly - y;
          ly = y;
        }
      }
      line.push((up <= 0.2 && down <= 0.2) ? `${up.toFixed(1)}s` : `${up.toFixed(1)}u`);
    }
    rows.push(`${i}:${pts[i].x},${pts[i].z}  ${line.join(' ')}`);
  }
  return { patrol: pts, rows };
});
for (const r of out.rows) console.log(r);
await browser.close();

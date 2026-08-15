const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const g = window.__skate;
  const res = {};
  const probe = (id, pts) => {
    g.save.unlockPark(id);
    g.switchPark(id);
    g.start();
    const p = g.ride.park;
    res[id] = { id: p.id, points: pts.map(([x, z]) => {
      const s = p.sample(x, z, { y: 0, nx: 0, ny: 1, nz: 0 });
      return { x, z, y: +s.y.toFixed(3), ny: +s.ny.toFixed(3), kind: s.kind };
    }) };
  };
  probe('bolt', [[0, -16], [0, 0], [0, 10], [-22, 0], [-39, -26], [0, 24], [0, -10], [0, 38], [-32, -12], [32, 0]]);
  probe('shove', [[0, -10], [0, -8], [-8, -10], [0, -24], [-20, -8], [20, -8], [0, 8], [0, 32], [-24, 14]]);
  probe('nova', [[0, -26], [0, 24], [0, 0], [-20, -18], [24, 8], [-30, -14], [30, -20], [0, 34]]);
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

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
  g.save.unlockPark('nova');
  g.switchPark('nova');
  g.start();
  g.setRunScore(500000);
  g.endBossCutscene();
  g.freeze();
  g.startChallenge();
  const b = g.boss;
  const far = { x: 99999, y: 0, z: 99999 };
  const samples = [];
  for (let i = 0; i < 6000; i++) {
    b.step(C.FIXED_DT, far);
    b.ride.events.length = 0;
    if (i % 60 === 0) {
      const r = b.route || [];
      const wp = r[b.routeIndex] || null;
      const dist = wp ? Math.hypot(wp.x - b.ride.pos.x, wp.z - b.ride.pos.z) : -1;
      samples.push({
        t: (i * C.FIXED_DT).toFixed(1),
        mode: b.ride.mode === C.GROUND ? 'g' : b.ride.mode === C.AIR ? 'a' : 'b',
        speed: Math.abs(b.ride.speed).toFixed(2),
        pos: `${b.ride.pos.x.toFixed(1)},${b.ride.pos.z.toFixed(1)}`,
        stalled: b.stalled ? b.stalled.toFixed(1) : '0',
        rIdx: b.routeIndex, rLen: r.length,
        wp: wp ? `${wp.x.toFixed(0)},${wp.z.toFixed(0)}` : '-', dist: dist.toFixed(1),
      });
    }
  }
  return { samples };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

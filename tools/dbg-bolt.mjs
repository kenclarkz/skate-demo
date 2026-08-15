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
  g.save.unlockPark('bolt');
  g.switchPark('bolt');
  g.start();
  g.setRunScore(500000);
  g.endBossCutscene();
  g.freeze();
  g.startChallenge();
  const b = g.boss;
  const far = { x: 99999, y: 0, z: 99999 };
  const samples = [];
  for (let i = 0; i < 1800; i++) {
    b.step(C.FIXED_DT, far);
    b.ride.events.length = 0;
    if (i % 60 === 0) {
      const r = b.route || [];
      const wp = r[b.routeIndex] || r[r.length - 1] || null;
      samples.push({
        t: (i * C.FIXED_DT).toFixed(1),
        mode: b.ride.mode === C.GROUND ? 'g' : b.ride.mode === C.AIR ? 'a' : '?',
        speed: Math.abs(b.ride.speed).toFixed(2),
        x: b.ride.pos.x.toFixed(1), z: b.ride.pos.z.toFixed(1),
        stalled: b.stalled ? b.stalled.toFixed(1) : '0',
        rIdx: b.routeIndex, rLen: r.length,
        wp: wp ? `${wp.x.toFixed(0)},${wp.z.toFixed(0)}` : '-',
      });
    }
  }
  const graph = b.ride.park.graph && b.ride.park.graph.nodes || [];
  const patrol = b.ride.park.patrol || [];
  return {
    samples,
    patrol: patrol.map((p) => ({ x: +p.x.toFixed(0), z: +p.z.toFixed(0) })),
    graph: graph.map((n) => ({ x: +n.x.toFixed(0), z: +n.z.toFixed(0), kind: n.kind })),
    pool: b.ride.park.features && b.ride.park.features.filter((f) => f.kind === 'pool' || f.kind === 'bowl').length,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

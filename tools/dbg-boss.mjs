const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', (m) => console.log('console:', m.text().slice(0, 200)));
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
  const info = [];
  const far = { x: 99999, y: 0, z: 99999 };
  for (let i = 0; i < 600; i++) {
    try {
      b.step(C.FIXED_DT, far);
    } catch (err) {
      info.push({ i, err: String(err).slice(0, 200), routeNull: b.route === null, routeLen: b.route ? b.route.length : -1, routeIdx: b.routeIndex, patrol: b.patrol && b.patrol.length, graphNodes: b.ride.park.graph && b.ride.park.graph.nodes.length });
      break;
    }
    b.ride.events.length = 0;
    if (i === 5 || i === 60) {
      info.push({ i, routeLen: b.route ? b.route.length : -1, routeIdx: b.routeIndex, mode: b.ride.mode, speed: Math.abs(b.ride.speed).toFixed(2), x: b.ride.pos.x.toFixed(1), z: b.ride.pos.z.toFixed(1) });
    }
  }
  return { info, hasPlanRoute: !!b.planRoute };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

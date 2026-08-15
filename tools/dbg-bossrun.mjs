const id = process.argv[2] || 'rae';
const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate((bossId) => {
  const g = window.__skate;
  const C = g.config;
  const def = { parkId: { ace: 'home', nova: 'nova', rae: 'plaza', bolt: 'bolt', tigre: 'vert', shove: 'shove', briar: 'railway', gnorbert: 'gnorbert', bananas: 'bananas', raven: 'raven' }[bossId] };
  g.save.unlockPark(def.parkId);
  g.switchPark(def.parkId);
  g.start();
  g.setRunScore(500000);
  g.endBossCutscene();
  g.freeze();
  g.startChallenge();
  const b = g.boss;
  const far = { x: 99999, y: 0, z: 99999 };
  const samples = [];
  const bails = [];
  for (let i = 0; i < 6000; i++) {
    b.step(C.FIXED_DT, far);
    for (const e of b.ride.events) if (e.type === 'bail') bails.push(e.reason);
    b.ride.events.length = 0;
    if (i % 60 === 0) {
      const r = b.route || [];
      const wp = r[b.routeIndex] || null;
      samples.push({
        t: (i * C.FIXED_DT).toFixed(1),
        y: b.ride.pos.y.toFixed(2),
        speed: Math.abs(b.ride.speed).toFixed(2),
        pos: `${b.ride.pos.x.toFixed(1)},${b.ride.pos.z.toFixed(1)}`,
        stalled: b.stalled ? b.stalled.toFixed(1) : '0',
        rIdx: b.routeIndex, rLen: r.length,
        wp: wp ? `${wp.x.toFixed(0)},${wp.z.toFixed(0)}` : '-',
      });
    }
  }
  return { parkId: def.parkId, patrol: g.ride.park.patrol.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`), route: (b.route || []).map((w) => `${w.x.toFixed(0)},${w.z.toFixed(0)}`), samples, bails };
}, id);
const cnt = {};
for (const r of out.bails) cnt[r] = (cnt[r] || 0) + 1;
console.log(JSON.stringify({ parkId: out.parkId, patrol: out.patrol, route: out.route, bailCounts: cnt }, null, 2));
for (const s of out.samples) console.log(`${s.t}s y=${s.y} v=${s.speed} @${s.pos} stall=${s.stalled} r=${s.rIdx}/${s.rLen}->${s.wp}`);
await browser.close();

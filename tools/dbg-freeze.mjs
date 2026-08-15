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
  const M = ['G', 'A', 'r', 'B'];
  const rows = [];
  let frozen = 0;
  for (let i = 0; i < 12000; i++) {
    b.step(C.FIXED_DT, far);
    const ev = b.ride.events.splice(0);
    if (i % 12 === 0) {
      const hs = Math.abs(C.angleDelta(b.ride.yaw, Math.atan2(b.ride.vel.x, b.ride.vel.z)));
      rows.push({
        t: (i * C.FIXED_DT).toFixed(1),
        m: M[b.ride.mode],
        v: Math.abs(b.ride.speed).toFixed(2),
        p: `${b.ride.pos.x.toFixed(1)},${b.ride.pos.z.toFixed(1)}`,
        y: b.ride.pos.y.toFixed(2),
        e: ev.map((x) => `${x.name}:${x.trick || x.reason || x.label || ''}`).join(','),
        s: b.stalled ? b.stalled.toFixed(1) : '0',
        c: b.ride.combo.live ? `L${b.ride.combo.idle.toFixed(2)}` : '-',
        h: hs.toFixed(2),
      });
    } else if (ev.length) {
      const px = `${b.ride.pos.x.toFixed(1)},${b.ride.pos.z.toFixed(1)}`;
      rows.push({ t: `+${(i * C.FIXED_DT).toFixed(1)}`, m: '!', v: '', p: px, y: b.ride.pos.y.toFixed(2), e: ev.map((x) => `${x.name}:${x.trick || x.reason || x.label || ''}`).join(','), s: '' });
    }
  }
  return rows;
}, id);
for (const r of out) {
  console.log(`${r.t}s ${r.m} v=${r.v} @${r.p} y=${r.y} stall=${r.s} cb=${r.c} hs=${r.h} ${r.e}`);
}
await browser.close();

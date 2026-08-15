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
  const log = [];
  let lastTrick = 0;
  for (let i = 0; i < 14400; i++) {
    b.step(C.FIXED_DT, far);
    const ev = b.ride.events.splice(0);
    for (const x of ev) {
      const t = (i * C.FIXED_DT).toFixed(1);
      if (x.name === 'trick') {
        const gap = (i / 120 - lastTrick).toFixed(1);
        lastTrick = i / 120;
        log.push(`t=${t} trick ${x.label} @${b.ride.pos.x.toFixed(0)},${b.ride.pos.z.toFixed(0)} gap=${gap} sketchy=${x.sketchy}`);
      } else if (x.name === 'combo') log.push(`t=${t}   BANK ${x.total}`);
      else if (x.name === 'bail') log.push(`t=${t}   BAIL ${x.reason} @${b.ride.pos.x.toFixed(0)},${b.ride.pos.z.toFixed(0)}`);
      else if (x.name === 'comboLost') log.push(`t=${t}   LOST combo`);
    }
  }
  return log;
}, id);
for (const l of out) console.log(l);
await browser.close();

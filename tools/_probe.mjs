const id = process.argv[2] || 'gnorbert';
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
  const orig = b.chooseTrick;
  b.chooseTrick = (args) => {
    const res = orig(args);
    if (res) log.push(`POP ${b.ride.combo.names.length} -> ${res.trick}`);
    else log.push(`null names=${b.ride.combo.names.length} live=${b.ride.combo.live} tCool=${b.trickCool.toFixed(2)} rCool=${b.randomTrickCool.toFixed(2)} curb=${args.curbPop}`);
    return res;
  };
  for (let i = 0; i < 6000; i++) {
    b.step(C.FIXED_DT, far);
    const ev = b.ride.events.splice(0);
    for (const x of ev) {
      if (x.name === 'trick') log.push(`  land ${x.label} -> combo=[${b.ride.combo.names.join(',')}] live=${b.ride.combo.live}`);
      if (x.name === 'combo') log.push(`  BANK total=${x.total}`);
    }
  }
  return log.slice(0, 120);
}, id);
for (const l of out) console.log(l);
await browser.close();

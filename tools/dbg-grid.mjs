const id = process.argv[2] || 'nova';
const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate((parkId) => {
  const g = window.__skate;
  const dbg = [];
  dbg.push(['before', g.park.id, 'arg=' + JSON.stringify(parkId)]);
  const un = g.save.unlockPark(parkId);
  const sw = g.switchPark(parkId);
  dbg.push(['unlock', un, 'switch-ret', sw ? sw.id : null, 'after switch', g.park.id]);
  g.start();
  dbg.push(['after start', g.park.id]);
  g.setRunScore(500000);
  dbg.push(['after score', g.park.id]);
  g.endBossCutscene();
  g.freeze();
  g.startChallenge();
  const p = g.ride.park;
  const extX = p.extentX, extZ = p.extentZ;
  const rows = [];
  for (let z = -extZ + 1; z <= extZ - 1; z += 4) {
    let cells = [];
    for (let x = -extX + 1; x <= extX - 1; x += 4) {
      let min = Infinity, max = -Infinity, n = 0;
      for (let dz = -1.2; dz <= 1.2; dz += 0.8) {
        for (let dx = -1.2; dx <= 1.2; dx += 0.8) {
          const y = p.heightAt(x + dx, z + dz);
          if (y < min) min = y;
          if (y > max) max = y;
          n++;
        }
      }
      cells.push((max - min) < 0.15 ? '.' : (max - min) < 0.3 ? '~' : '#');
    }
    rows.push(`${String(z).padStart(3)} ${cells.join('')}`);
  }
  return { dbg, id: p.id, parkId: g.park.id, boss: g.boss ? g.boss.def.id : 'none', extX, extZ, patrol: p.patrol.map((pp) => `${pp.x},${pp.z}`), rows };
}, id);
console.log(JSON.stringify(out.dbg));
console.log('patrol:', out.patrol.join('  '));
for (const r of out.rows) console.log(r);
await browser.close();

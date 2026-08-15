const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const g = window.__skate;
  const parks = ['bolt', 'shove', 'nova', 'ravend'];
  const res = {};
  for (const id of parks) {
    g.save.unlockPark(id);
    g.switchPark(id);
    g.start();
    const p = g.ride.park;
    if (!p || p.id !== id) { res[id] = 'switch failed'; continue; }
    const h = (x, z) => { try { return +p.heightAt(x, z).toFixed(2); } catch (e) { return 'err'; } };
    res[id] = {
      graph: (p.graph && p.graph.nodes || []).map((n) => ({
        x: n.x, z: n.z, kind: n.kind, h: h(n.x, n.z),
      })),
      patrol: (p.patrol || []).map((pt) => ({ x: pt.x, z: pt.z, h: h(pt.x, pt.z) })),
    };
    g.start();
  }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

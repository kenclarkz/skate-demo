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
  for (const p of g.parks) {
    const patrol = (p.patrol || []).map((pt) => ({ x: pt.x, z: pt.z }));
    const graph = (p.graph && p.graph.nodes || []).map((n) => ({ x: n.x, z: n.z, kind: n.kind }));
    const inside = (x, z) => Math.min(p.extentX - Math.abs(x), p.extentZ - Math.abs(z));
    const flat = (x, z) => { try { return p.heightAt(x, z); } catch (e) { return NaN; } };
    const interiorPatrol = patrol.filter((pt) => inside(pt.x, pt.z) > 6);
    const ringPatrol = patrol.filter((pt) => inside(pt.x, pt.z) <= 12);
    const interiorGraph = graph.filter((n) => inside(n.x, n.z) > 6);
    res[p.id] = {
      ext: [p.extentX, p.extentZ],
      patrolN: patrol.length, interiorPatrol: interiorPatrol.length, ringPatrol: ringPatrol.length,
      graphN: graph.length, interiorGraph: interiorGraph.length,
      kinds: graph.reduce((a, n) => { a[n.kind] = (a[n.kind] || 0) + 1; return a; }, {}),
      patrolH: patrol.map((pt) => +flat(pt.x, pt.z).toFixed(2)),
      patrol: patrol.slice(0, 3),
      graph: graph.slice(0, 3),
    };
  }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

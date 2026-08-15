const pick = (mod) => (mod.chromium ?? mod.default?.chromium);
const chromium = pick(await import('playwright'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium' });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto('http://localhost:8081/skate/index.html?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__skate, null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const g = window.__skate;
  const legs = (id, pairs) => {
    g.save.unlockPark(id);
    g.switchPark(id);
    g.start();
    const p = g.ride.park;
    const res = [];
    for (const [a, b] of pairs) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const n = Math.max(2, Math.ceil(len / 0.6));
      let maxUp = 0, maxDown = 0;
      let lastY = p.heightAt(a[0], a[1]);
      const h = [];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = a[0] + dx * t, z = a[1] + dz * t;
        const y = p.heightAt(x, z);
        const up = y - lastY, down = lastY - y;
        if (up > maxUp) maxUp = up;
        if (down > maxDown) maxDown = down;
        if (Math.abs(y - lastY) > 0.05) h.push([x, z, +y.toFixed(2)]);
        lastY = y;
      }
      res.push({ leg: `${a}->${b}`, len: +len.toFixed(1), maxUp: +maxUp.toFixed(2), maxDown: +maxDown.toFixed(2), bumps: h.slice(0, 5) });
    }
    return res;
  };
  return {
    bolt: legs('bolt', [[[0, 38], [0, -10]], [[0, -10], [-32, -12]], [[-32, -12], [-32, 0]], [[0, 10], [32, 0]], [[32, 0], [32, -12]], [[-32, 0], [0, 10]]]),
    shove: legs('shove', [[[0, -36], [0, -24]], [[0, -24], [-20, -8]], [[-20, -8], [20, -8]], [[20, -8], [0, 8]], [[0, 8], [0, 32]]]),
    nova: legs('nova', [[[0, -44], [0, -26]], [[0, -26], [-20, -18]], [[-20, -18], [24, 8]], [[24, 8], [0, 24]], [[0, 24], [-36, 38]], [[-36, 38], [38, 4]]]),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

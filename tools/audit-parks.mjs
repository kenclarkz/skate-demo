// Dev audit: compare every rebuilt map's ride surface against the original
// hand-authored one. Runs headless in Node (no DOM needed beyond a canvas
// stub for the ground texture) and reports the biggest height-field difference
// per park, plus how the spawn/patrol/grind list moved.
//
// The rebuilt maps live in parkLayouts.js and must preserve spawn points,
// boundaries and the rideable surfaces the smoke tests depend on; anything
// this tool flags is a regression to fix before running the smoke suite.
//
//   node tools/audit-parks.mjs

const fake2d = new Proxy(
  {},
  {
    get(t, k) {
      if (
        k === 'fillRect' ||
        k === 'beginPath' ||
        k === 'moveTo' ||
        k === 'lineTo' ||
        k === 'stroke' ||
        k === 'setTransform'
      ) {
        return () => {};
      }
      return undefined;
    },
    set() {
      return true;
    },
  }
);
globalThis.document = {
  createElement() {
    return { width: 256, height: 256, getContext: () => fake2d };
  },
};

const { Park } = await import('../js/skate/park.js');
const { PARKS: REBUILT } = await import('../js/skate/parkLayouts.js');

// The original defs are still exported from park.js while the rebuild lands;
// if they are gone the audit cannot compare anything.
let ORIG = null;
try {
  const m = await import('../js/skate/park.js');
  ORIG = m.PARKS || null;
} catch {
  ORIG = null;
}
if (!ORIG) {
  console.log('original PARKS no longer live in park.js — nothing to compare against');
  process.exit(0);
}

let failures = 0;

function near(actual, expected, tol, msg) {
  const off = Math.abs(actual - expected);
  const bad = off > tol;
  if (bad) failures++;
  console.log(`  ${bad ? 'FAIL' : 'ok  '} ${msg} (${actual.toFixed(3)} vs ${expected.toFixed(3)})`);
  return bad;
}

function heightDiff(a, b, x, z) {
  return Math.abs(a.heightAt(x, z) - b.heightAt(x, z));
}

for (const def of REBUILT) {
  const orig = ORIG.find((o) => o.id === def.id);
  if (!orig) {
    failures++;
    console.log(`FAIL ${def.id}: no original def to compare against`);
    continue;
  }
  const a = new Park(orig);
  const b = new Park(def);
  console.log(`\n${def.id} (${def.name})`);

  near(b.extentX, a.extentX, 0.01, 'extentX preserved');
  near(b.extentZ, a.extentZ, 0.01, 'extentZ preserved');
  near(b.spawn.x, a.spawn.x, 0.01, 'spawn.x preserved');
  near(b.spawn.z, a.spawn.z, 0.01, 'spawn.z preserved');

  // Surface audit on a grid over the whole pad. The rebuilt maps are allowed
  // to add fill objects, so any difference must be *above* the original —
  // something placed on previously open ground — never a missing surface.
  let maxGain = 0;
  let maxLoss = 0;
  let lossAt = null;
  let gainAt = null;
  const step = 1;
  for (let x = -b.extentX + 0.5; x <= b.extentX - 0.5; x += step) {
    for (let z = -b.extentZ + 0.5; z <= b.extentZ - 0.5; z += step) {
      const ya = a.heightAt(x, z);
      const yb = b.heightAt(x, z);
      const d = yb - ya;
      if (d > maxGain) {
        maxGain = d;
        gainAt = [x, z];
      }
      if (d < maxLoss) {
        maxLoss = d;
        lossAt = [x, z];
      }
    }
  }
  if (maxLoss < -0.001) failures++;
  console.log(`  ${maxLoss < -0.001 ? 'FAIL' : 'ok  '} no surface is lost anywhere (worst loss ${maxLoss.toFixed(3)} m${lossAt ? ` at ${lossAt[0]},${lossAt[1]}` : ''})`);
  console.log(`  ${maxGain < 0.001 ? 'ok  ' : 'note'} highest new surface above original: ${maxGain.toFixed(3)} m${gainAt ? ` at ${gainAt[0]},${gainAt[1]}` : ''}`);

  // The smoke-test home-park spots, checked exactly.
  if (def.id === 'home') {
    near(b.heightAt(0, 39.99), a.heightAt(0, 39.99), 1e-4, 'flat before the north quarter');
    near(b.heightAt(0, 40.01), a.heightAt(0, 40.01), 1e-4, 'tangent at the north quarter base');
    near(b.heightAt(0, 45), a.heightAt(0, 45), 1e-3, 'north quarter mid-transition');
    near(b.heightAt(0, 44), a.heightAt(0, 44), 1e-3, 'north deck behind the lip');
    near(b.heightAt(0, -45), a.heightAt(0, -45), 1e-3, 'south quarter transition');
    near(b.heightAt(0, -1.5), a.heightAt(0, -1.5), 1e-3, 'funbox downhill bank');
    near(b.heightAt(-22, 0), a.heightAt(-22, 0), 1e-3, 'flat bar lane');
  }

  // Grind lines: the rebuilt map should still be able to lock onto every line
  // the original offered, near the same spot. A few originals were not
  // expressible as Park Suite objects and are deliberately replaced or dropped
  // (a y=0 ledge, a sloped handrail); they are listed per park below.
  const DROPPED = {
    // (midpoint-key, reason)
    home: new Set(['24.0,0.0,22.0']), // a grind line on the flat ground — the ledge object cannot be 0 m tall
    bowl: new Set(['0.0,0.4,0.0']), // the floor diagonal — a Park Suite rail is axis-aligned only
    skyline: new Set(['-24.0,0.0,22.0']), // a grind line on the flat ground — the ledge object cannot be 0 m tall
  };
  for (const g of a.grinds) {
    const mid = {
      x: (g.a.x + g.b.x) / 2,
      y: (g.a.y + g.b.y) / 2,
      z: (g.a.z + g.b.z) / 2,
    };
    const key = `${mid.x.toFixed(1)},${mid.y.toFixed(1)},${mid.z.toFixed(1)}`;
    // A sloped original (a handrail that runs down a bank) is deliberately
    // rebuilt as a level bar at the same midpoint — Park Suite rails cannot
    // slope — so only its kind and position are compared, never its direction.
    const sloped = Math.abs(g.a.y - g.b.y) > 0.2;
    let found = null;
    for (const h of b.grinds) {
      const hm = { x: (h.a.x + h.b.x) / 2, y: (h.a.y + h.b.y) / 2, z: (h.a.z + h.b.z) / 2 };
      if (Math.hypot(hm.x - mid.x, hm.z - mid.z) > 2) continue;
      if (h.kind !== g.kind) continue;
      const dot = Math.abs(g.dir.x * h.dir.x + g.dir.y * h.dir.y + g.dir.z * h.dir.z);
      if (!sloped && dot < 0.9) continue;
      found = h;
      break;
    }
    if (!found && !(DROPPED[def.id] && DROPPED[def.id].has(key))) {
      failures++;
      console.log(`  FAIL original grind at ${mid.x.toFixed(1)},${mid.y.toFixed(1)},${mid.z.toFixed(1)} (${g.kind}) has no rebuilt counterpart`);
    }
  }
}

console.log(`\n${failures ? failures + ' problem(s) found' : 'all parks match their originals on the audited points'}`);
process.exit(failures ? 1 : 0);

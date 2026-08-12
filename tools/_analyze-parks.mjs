import { PARKS } from '../js/skate/parkLayouts.js';
import { boundsOf, newObject } from '../js/skate/parkObjects.js';

for (const def of PARKS) {
  const objs = def._objects;
  if (!objs) { console.log(def.id, 'no objects exposed'); continue; }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const o of objs) {
    const clean = { ...newObject(o.type), ...o };
    const r = boundsOf(clean);
    if (!Number.isFinite(r.x0)) { console.log('  bad bounds', def.id, o.type); continue; }
    x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1);
    z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1);
  }
  const ex = def.extentX, ez = def.extentZ;
  console.log(`${def.id.padEnd(11)} ex=${String(ex).padEnd(5)} ez=${String(ez).padEnd(5)} objX=[${x0.toFixed(1)},${x1.toFixed(1)}] objZ=[${z0.toFixed(1)},${z1.toFixed(1)}] insidePad=${x0>-ex+1&&x1<ex-1&&z0>-ez+1&&z1<ez-1} n=${objs.length}`);
}

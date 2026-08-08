// A park file: the plain, saved description of a player-built park, and the
// bridge to the game's own `Park` — a file becomes a def, and a def is what
// `new Park(def)` is handed, exactly like the hand-authored maps in park.js.
//
// A file is deliberately small and editable: a name, a pad size and surface,
// a spawn, and a list of objects from the palette. Patrol loops and logo
// spots are *derived* when the def is built, so a player never has to place
// them — they re-generate around whatever the park actually contains.

import { buildObjects, clearAt, groundColor, newObject, objectType } from './parkObjects.js';

export const PARK_FILE_VERSION = 1;
export const DEFAULT_EXTENT = 20;
export const MAX_OBJECTS = 64;

function fileId() {
  return `user-${Math.random().toString(36).slice(2, 8)}`;
}

/** A brand-new, empty park, ready for the editor. */
export function newFile() {
  return {
    v: PARK_FILE_VERSION,
    id: fileId(),
    name: 'My park',
    blurb: 'Built by you.',
    extent: DEFAULT_EXTENT,
    ground: 'concrete',
    spawn: { x: 0, z: -(DEFAULT_EXTENT - 3) },
    objects: [],
  };
}

/**
 * A whole park into one string, for storage. The id is part of the file, so a
 * loaded park keeps the same identity (and the same save slot) across reloads.
 */
export function serialize(file) {
  return JSON.stringify(file);
}

export function deserialize(json) {
  try {
    return validate(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Clamp every field a file can carry to something the game can build, and
 * drop anything that is not a known object type. Runs on every load so a
 * corrupted or hand-edited file can never take the game down with it.
 */
export function validate(raw) {
  const file = newFile();
  if (!raw || typeof raw !== 'object') return file;
  file.id = typeof raw.id === 'string' ? raw.id : file.id;
  file.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : file.name;
  file.blurb = typeof raw.blurb === 'string' ? raw.blurb.trim().slice(0, 120) : file.blurb;
  file.extent = clampNum(raw.extent, 12, 60, DEFAULT_EXTENT);
  file.ground = ['concrete', 'wood', 'dirt'].includes(raw.ground) ? raw.ground : 'concrete';
  if (raw.spawn && Number.isFinite(raw.spawn.x) && Number.isFinite(raw.spawn.z)) {
    const m = file.extent - 1.5;
    file.spawn = {
      x: clampNum(raw.spawn.x, -m, m, 0),
      z: clampNum(raw.spawn.z, -m, m, -(file.extent - 3)),
    };
  }
  if (Array.isArray(raw.objects)) {
    for (const o of raw.objects.slice(0, MAX_OBJECTS)) {
      if (!o || typeof o !== 'object') continue;
      const type = objectType(o.type);
      const clean = newObject(type.id);
      clean.id = typeof o.id === 'string' ? o.id : clean.id;
      for (const key of ['x', 'z']) clean[key] = clampNum(o[key], -200, 200, clean[key]);
      clean.ry = clampNum(o.ry, -10000, 10000, 0);
      clean.sx = clampNum(o.sx, 0.05, 10, 1);
      clean.sz = clampNum(o.sz, 0.05, 10, 1);
      for (const prop of type.props) {
        clean[prop.key] = clampNum(o[prop.key], prop.min, prop.max, clean[prop.key]);
      }
      if (type.id === 'slab' || type.id === 'bank' || type.id === 'quarter' || type.id === 'ledge' || type.id === 'funbox') {
        clean.color = SURFACE_IDS.includes(o.color) ? o.color : clean.color;
      }
      file.objects.push(clean);
    }
  }
  return file;
}

const SURFACE_IDS = ['concrete', 'dark', 'wood', 'paint', 'dirt'];

function clampNum(v, min, max, fallback) {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

// --- from file to def -----------------------------------------------------

/** The def handed to `new Park(...)` — the same shape the maps in park.js are. */
export function buildDef(file) {
  const spawn = spawnFor(file);
  return {
    id: file.id,
    name: file.name,
    blurb: file.blurb,
    scale: 1,
    spawn: { ...spawn },
    patrol: patrolFor(file, spawn),
    logos: logosFor(file),
    extentX: file.extent,
    extentZ: file.extent,
    ground: groundColor(file.ground),
    build(p) {
      buildObjects(p, file.objects);
    },
  };
}

/** The player's spawn: the file's choice if it is clear of objects and on the
 * pad, otherwise the nearest clear point in an expanding spiral around it. */
export function spawnFor(file) {
  const want = file.spawn || { x: 0, z: -(file.extent - 3) };
  const m = file.extent - 1.5;
  if (clearAt(file.objects, want.x, want.z)) return { x: want.x, z: want.z };
  for (let ring = 1; ring < 20; ring++) {
    for (let i = 0; i < ring * 8; i++) {
      const a = (i / (ring * 8)) * Math.PI * 2;
      const x = want.x + Math.cos(a) * ring * 0.75;
      const z = want.z + Math.sin(a) * ring * 0.75;
      if (x < -m || x > m || z < -m || z > m) continue;
      if (clearAt(file.objects, x, z)) return { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20 };
    }
  }
  return { x: want.x, z: want.z };
}

/**
 * The AI's tour loop: points around the pad edge that are clear of objects,
 * so a bot never drops into a funbox. The corners and edges of a pad are
 * usually the clear parts of a skatepark, so those are tried first, with a
 * ring around the spawn as the fallback — and the spawn itself as the last
 * resort, since a player can always be trusted to keep near it rideable.
 */
function patrolFor(file, spawn) {
  const pts = [];
  const m = file.extent - 2;
  const seen = new Set();
  const push = (x, z) => {
    const k = `${x.toFixed(1)},${z.toFixed(1)}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (clearAt(file.objects, x, z)) pts.push({ x, z });
  };
  push(m, m);
  push(-m, m);
  push(m, -m);
  push(-m, -m);
  push(0, m);
  push(0, -m);
  push(m, 0);
  push(-m, 0);
  if (pts.length < 3) {
    for (const r of [5, 9]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        push(spawn.x + Math.cos(a) * r, spawn.z + Math.sin(a) * r);
      }
    }
  }
  if (pts.length < 2) {
    pts.push({ x: spawn.x, z: spawn.z });
    if (!seen.has(`${spawn.x.toFixed(1)},${spawn.z.toFixed(1)}`)) {
      pts.push({ x: spawn.x + 3, z: spawn.z });
    }
  }
  return pts.slice(0, 6);
}

/** Six logo spots, floating on a ring over the pad so they are spread out. */
function logosFor(file) {
  const r = file.extent * 0.58;
  const spots = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2 + Math.PI / 6;
    spots.push({ x: Math.round(Math.cos(a) * r * 10) / 10, z: Math.round(Math.sin(a) * r * 10) / 10 });
  }
  return spots;
}

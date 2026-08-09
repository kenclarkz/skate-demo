// A park file: the plain, saved description of a player-built park, and the
// bridge to the game's own `Park` — a file becomes a def, and a def is what
// `new Park(def)` is handed, exactly like the hand-authored maps in park.js.
//
// A file is deliberately small and editable: a name, a boundary, a pad surface,
// a spawn, and a list of objects from the palette. Patrol loops and logo
// spots are *derived* when the def is built, so a player never has to place
// them — they re-generate around whatever the park actually contains.
//
// The boundary is the park's single source of truth for footprint: the pad,
// the fence, the playable area, the spawn limits, the AI patrol and the
// environment all derive from it. A brand-new park inherits the same boundary
// the standard parks are drawn on (PARK_X × PARK_Z in park.js), so an empty
// custom park is exactly the same 52 × 60 m site as Home Park or The Bowl.

import { buildObjects, clearAt, groundColor, newObject, objectType } from './parkObjects.js';
import { PARK_X, PARK_Z } from './park.js';

export { PARK_X, PARK_Z };

export const PARK_FILE_VERSION = 1;
export const MAX_OBJECTS = 64;

// The footprint a fresh park starts with — the standard parks' half-extents,
// in world units. A player park builds at def.scale = 1, so these numbers land
// directly in the world: the pad is (PARK_X*2) × (PARK_Z*2) metres, exactly as
// the built-in maps are (their authoring coords get stretched by TRACK_SCALE,
// these are already at the final size).
export const DEFAULT_BOUNDARY = {
  minX: -PARK_X,
  maxX: PARK_X,
  minZ: -PARK_Z,
  maxZ: PARK_Z,
};

// The default spawn sits a third of the way down the pad from the north edge,
// the same quarter of the site the hand-authored maps favour, and safely clear
// of the fence line that sits a little past the boundary itself.
const SPAWN_Z = -(PARK_Z - 12);

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
    boundary: { ...DEFAULT_BOUNDARY },
    ground: 'concrete',
    padOnly: true,
    spawn: { x: 0, z: SPAWN_Z, yaw: 0 },
    objects: [],
  };
}

/** The park's boundary — every consumer reads the same rectangle from here. */
export function boundaryOf(file) {
  const b = file && file.boundary;
  if (b && Number.isFinite(b.maxX) && Number.isFinite(b.maxZ)) return b;
  // A legacy in-memory file (or a test that builds one by hand) may still carry
  // only the old square `extent` — square it off into a boundary before any
  // consumer that needs the footprint sees it.
  if (file && Number.isFinite(file.extent)) {
    const e = clampNum(file.extent, 6, 60, 20);
    return { minX: -e, maxX: e, minZ: -e, maxZ: e };
  }
  return { ...DEFAULT_BOUNDARY };
}

/** The pad's half-extents, derived from the boundary — the shape the Park def
 * consumes (`extentX`/`extentZ`) and the scale the editor's pad is drawn at. */
export function extentOf(file) {
  const b = boundaryOf(file);
  return { x: (b.maxX - b.minX) / 2, z: (b.maxZ - b.minZ) / 2 };
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
  // The boundary is the footprint: new files carry it outright, older files
  // carried only a square `extent`, which becomes the boundary here. It is
  // stored centred and mirrored, the shape the Park's own pad slab expects.
  const isNewShape = !!(raw.boundary && typeof raw.boundary === 'object');
  const halfX = clampNum(isNewShape ? raw.boundary.maxX : raw.extent, 6, 60, PARK_X);
  const halfZ = clampNum(isNewShape ? raw.boundary.maxZ : raw.extent, 6, 60, PARK_Z);
  file.boundary = { minX: -halfX, maxX: halfX, minZ: -halfZ, maxZ: halfZ };
  file.ground = ['concrete', 'wood', 'dirt'].includes(raw.ground) ? raw.ground : 'concrete';
  // New parks get the padOnly treatment the built-in parks have — the fence is
  // the playable edge, not decoration. Old square parks keep their original
  // roam-past-the-pad behaviour so existing parks do not change underfoot.
  file.padOnly = raw.padOnly === undefined ? isNewShape : !!raw.padOnly;
  if (raw.spawn && Number.isFinite(raw.spawn.x) && Number.isFinite(raw.spawn.z)) {
    const m = Math.min(halfX, halfZ) - 1.5;
    file.spawn = {
      x: clampNum(raw.spawn.x, -m, m, 0),
      z: clampNum(raw.spawn.z, -m, m, -(halfZ - 12)),
      yaw: clampNum(raw.spawn.yaw, -Math.PI * 4, Math.PI * 4, 0),
    };
  }
  if (Array.isArray(raw.objects)) {
    for (const o of raw.objects.slice(0, MAX_OBJECTS)) {
      if (!o || typeof o !== 'object') continue;
      const type = objectType(o.type);
      const clean = newObject(type.id);
      clean.id = typeof o.id === 'string' ? o.id : clean.id;
      for (const key of ['x', 'z']) clean[key] = clampNum(o[key], -200, 200, clean[key]);
      clean.y = clampNum(o.y, 0, 12, 0);
      clean.ry = clampNum(o.ry, -10000, 10000, 0);
      clean.sx = clampNum(o.sx, 0.05, 10, 1);
      clean.sz = clampNum(o.sz, 0.05, 10, 1);
      for (const prop of type.props) {
        clean[prop.key] = clampNum(o[prop.key], prop.min, prop.max, clean[prop.key]);
      }
      // The surface color lives in each object type's defaults (it is picked
      // from the paint swatches, not the property sliders), so a type that
      // carries one keeps it across a save/load round trip.
      if ('color' in type.defaults) {
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
  const { x: ex, z: ez } = extentOf(file);
  return {
    id: file.id,
    name: file.name,
    blurb: file.blurb,
    scale: 1,
    spawn: { ...spawn },
    patrol: patrolFor(file, spawn),
    logos: logosFor(file),
    extentX: ex,
    extentZ: ez,
    // The fence is the playable edge for a new park, exactly as it is for the
    // built-in padOnly maps; legacy square parks stay roamable by default.
    padOnly: !!file.padOnly,
    ground: groundColor(file.ground),
    build(p) {
      buildObjects(p, file.objects);
    },
  };
}

/** The player's spawn: the file's choice if it is clear of objects and inside
 * the boundary, otherwise the nearest clear point in an expanding spiral around
 * it. Always carries a yaw — the ride model reads it straight off the spawn, and
 * `undefined` would corrupt the heading the first step it is used. */
export function spawnFor(file) {
  const { x: ex, z: ez } = extentOf(file);
  const want = file.spawn || { x: 0, z: -(ez - 12) };
  const yaw = Number.isFinite(want.yaw) ? want.yaw : 0;
  const m = Math.min(ex, ez) - 1.5;
  if (clearAt(file.objects, want.x, want.z)) return { x: want.x, z: want.z, yaw };
  for (let ring = 1; ring < 20; ring++) {
    for (let i = 0; i < ring * 8; i++) {
      const a = (i / (ring * 8)) * Math.PI * 2;
      const x = want.x + Math.cos(a) * ring * 0.75;
      const z = want.z + Math.sin(a) * ring * 0.75;
      if (x < -m || x > m || z < -m || z > m) continue;
      if (clearAt(file.objects, x, z)) return { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20, yaw };
    }
  }
  return { x: want.x, z: want.z, yaw };
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
  const { x: ex, z: ez } = extentOf(file);
  const m = Math.min(ex, ez) - 2;
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
  const { x: ex, z: ez } = extentOf(file);
  const r = Math.min(ex, ez) * 0.58;
  const spots = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2 + Math.PI / 6;
    spots.push({ x: Math.round(Math.cos(a) * r * 10) / 10, z: Math.round(Math.sin(a) * r * 10) / 10 });
  }
  return spots;
}

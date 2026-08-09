// The park editor: a second, self-contained scene where a park file is built
// and previewed before it ever touches the real game. It owns its own lights,
// its own camera orbit, and its own scene — the play scene is never disturbed
// while a park is being designed, and leaving the editor is a plain swap back.
//
// What you see is what you ride: every object's preview is built from the same
// shapes and the same transform math as the collision it produces, so a ramp
// that looks wrong to ride will be wrong to ride, and vice versa.
//
// The editor is fully responsive: desktop keeps the always-on side rail (the
// palette over the properties panel), while a narrow viewport folds the rail
// into a bottom sheet (or a side drawer on tablet/landscape widths), adds a
// compact action bar for touch transforms, and tucks everything else behind a
// slide-in menu. The park data itself is identical on every device — only the
// chrome around the 3D view changes.

import * as THREE from '../game/three.js';
import { box, merge } from '../game/geo.js';
import { OBJECTS, SURFACES, GROUNDS, newObject, objectType, boundsOf, objectColor, padColor, cssColor, cssColorOf } from './parkObjects.js';
import { newFile, serialize, deserialize, validate, buildDef, spawnFor, boundaryOf, extentOf, PARK_X, PARK_Z, MAX_OBJECTS } from './parkFile.js';
import { putFile } from './parkStorage.js';

const DEG = Math.PI / 180;

// Day lighting, matching the game's own PRESETS[DAY] so the editor shows a
// park the way it will look under the sun.
const SKY = 0x8fb4d6;
const FOG = 0xd8d3c4;

// The layout switches from the desktop rail to a sheet/drawer UI below this
// width — a viewport dimension, not a device sniff, so a short landscape phone
// and a tall portrait tablet each get what suits them.
const NARROW = 1000;
const BOUNDARY_COLOR = 0x4cc3ff;

export class ParkDesigner {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.active = false;
    this.file = null;
    this.sel = null;
    this.snapOn = true;
    this.snap = 0.25;
    this.gridOn = true;
    this.mode = 'move'; // 'move' | 'rotate' | 'scale'
    this.past = [];
    this.future = [];

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(FOG, 40, 240);
    this.hemi = new THREE.HemisphereLight(0xbcd6f0, 0x6b6455, 2.1);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff2d8, 2.3);
    this.key.position.set(-6, 9, 4);
    this.scene.add(this.key);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.orbit = { yaw: -0.55, pitch: 0.45, dist: 34, tx: 0, tz: 0 };
    this._drag = null;
    this._pointers = new Map();

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this._saveTimer = 0;

    this.on = { back: null, test: null };

    this.chrome = document.getElementById('designer');
    this.canvas = document.getElementById('view');
    this.nameInput = document.getElementById('dg-name');
    this.countEl = document.getElementById('dg-count');
    this.undoBtn = document.getElementById('dg-undo');
    this.redoBtn = document.getElementById('dg-redo');
    this.paletteEl = document.getElementById('dg-palette');
    this.panelEl = document.getElementById('dg-panel');
    this.railEl = document.getElementById('dg-rail');
    this.drawerEl = document.getElementById('dg-drawer');
    this.scrimEl = document.getElementById('dg-scrim');
    this.actionsEl = document.getElementById('dg-actions');
    this.modeBtns = [...document.querySelectorAll('#dg-modes [data-mode]')];
    this.tabBtns = [...document.querySelectorAll('#dg-rail-head [data-dgtab]')];

    this._bind();
  }

  _isNarrow() {
    return window.innerWidth < NARROW;
  }

  _bind() {
    document.getElementById('dg-back')?.addEventListener('click', () => this.on.back?.());
    document.getElementById('dg-save')?.addEventListener('click', () => this.save());
    document.getElementById('dg-test')?.addEventListener('click', () => this.on.test?.());
    document.getElementById('dg-menu')?.addEventListener('click', () => this._toggleDrawer());
    document.getElementById('dg-add')?.addEventListener('click', () => this._openRail('palette'));
    document.getElementById('dg-props')?.addEventListener('click', () => {
      this._renderPanel();
      this._openRail('panel');
    });
    this.undoBtn?.addEventListener('click', () => this.undo());
    this.redoBtn?.addEventListener('click', () => this.redo());
    this.nameInput?.addEventListener('change', () => {
      if (!this.file) return;
      this.file.name = this.nameInput.value.trim().slice(0, 40) || 'My park';
      this._scheduleSave();
    });
    this.scrimEl?.addEventListener('click', () => {
      this._closeDrawer();
      this._closeRail();
    });

    for (const btn of this.modeBtns) {
      btn.addEventListener('click', () => this._setMode(btn.dataset.mode));
    }
    for (const tab of this.tabBtns) {
      tab.addEventListener('click', () => this._setRailTab(tab.dataset.dgtab));
    }
    document.getElementById('dg-rail-close')?.addEventListener('click', () => this._closeRail());
    this.drawerEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dgmenu]');
      if (btn) this._drawerAction(btn.dataset.dgmenu);
    });

    // Build the palette rail once — the object types never change.
    if (this.paletteEl) {
      this.paletteEl.innerHTML = OBJECTS.map(
        (t) => `<button type="button" class="dg-palette-btn" data-type="${t.id}" title="${t.hint}"><b>${t.label}</b><span>${t.hint}</span></button>`
      ).join('');
      this.paletteEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-type]');
        if (btn) {
          this.addObject(btn.dataset.type);
          // A narrow viewport wants to see the park again right away, not hold
          // the sheet open over the object that was just dropped.
          if (this._isNarrow()) this._closeRail();
        }
      });
    }

    // Pointer handling lives on the canvas: drag an object to transform it,
    // drag empty ground to orbit, pinch to zoom, and two fingers together to
    // pan the camera. A second finger always takes over from whatever a single
    // finger was doing, so two-finger movement can never transform a prop.
    const canvas = this.canvas;
    canvas?.addEventListener('pointerdown', (e) => this._down(e));
    canvas?.addEventListener('pointermove', (e) => this._move(e));
    canvas?.addEventListener('pointerup', (e) => this._up(e));
    canvas?.addEventListener('pointercancel', (e) => this._up(e));
    canvas?.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.orbit.dist = clamp(this.orbit.dist * Math.exp(e.deltaY * 0.0012), 4, 120);
      this._applyCamera();
    }, { passive: false });

    window.addEventListener('keydown', (e) => this._key(e));
  }

  /** Enter the editor for `file` (a fresh or existing park file). */
  open(file) {
    this.file = file;
    this.sel = null;
    this.past = [];
    this.future = [];
    if (this.nameInput) this.nameInput.value = file.name;
    this._savedFov = this.camera.fov;
    this.orbit.tx = 0;
    this.orbit.tz = 0;
    const { x: ex, z: ez } = extentOf(file);
    this.orbit.dist = clamp(Math.max(ex, ez) * 2.1, 14, 80);
    this.orbit.yaw = -0.55;
    this.orbit.pitch = 0.45;
    this.active = true;
    this.chrome.hidden = false;
    this._closeDrawer();
    this._closeRail();
    this._rebuild();
    this._renderPanel();
    this._applyCamera();
    this._updateCount();
    this._updateUndoButtons();
    this._renderModeButtons();
  }

  /** Leave the editor without touching the file — the caller decides where to go. */
  close() {
    this.active = false;
    this._save();
    this.chrome.hidden = true;
    this.camera.fov = this._savedFov ?? this.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Persist the current file, for the explicit Save button and on exit. */
  save() {
    this._save();
  }

  _save() {
    if (!this.file) return;
    this.file.name = this.nameInput?.value.trim().slice(0, 40) || this.file.name;
    putFile(validate(this.file));
  }

  _scheduleSave() {
    this._saveTimer = 0.45;
  }

  /** Per-frame drive from main's loop — render the editor scene, autosave. */
  tick(dt) {
    if (!this.active) return;
    if (this._saveTimer > 0) {
      this._saveTimer -= dt;
      if (this._saveTimer <= 0) this._save();
    }
    this.renderer.render(this.scene, this.camera);
  }

  // --- the scene ----------------------------------------------------------

  _rebuild() {
    if (!this.file) return;
    this._disposeGroup(this.root);
    this.root.clear();
    const { x: ex, z: ez } = extentOf(this.file);
    this._pad = new THREE.Mesh(new THREE.BoxGeometry(ex * 2, 0.55, ez * 2), this._mat(padColor(this.file)));
    this._pad.position.y = -0.275;
    this.root.add(this._pad);

    if (this.gridOn) {
      const gridSize = Math.max(ex, ez) * 2;
      const grid = new THREE.GridHelper(gridSize, Math.max(8, Math.round(gridSize / 2)), 0x7a7f88, 0x636872);
      grid.position.y = 0.012;
      grid.material.transparent = true;
      grid.material.opacity = 0.45;
      grid.raycast = () => null;
      this.root.add(grid);
    }

    const spawn = spawnFor(this.file);
    this._spawnMarker = this._spawnMesh();
    this._spawnMarker.position.set(spawn.x, 0.015, spawn.z);
    this.root.add(this._spawnMarker);

    // The boundary is drawn first and always: it is the park's footprint, and
    // a player building a fresh park has to see that it matches the built-in
    // parks' 52 × 60 m site.
    this.root.add(this._buildBoundary(ex, ez));
    // The fence preview mirrors the real game's fence (park.js buildScenery),
    // generated from the boundary's four edges rather than hand-placed posts.
    this.root.add(this._buildFence(ex, ez));

    this.pickables = [];
    for (const o of this.file.objects) this.root.add(this._buildObject(o));
    this._updateOutline();
    this._updateCount();
  }

  /** The boundary's own edges: a bright wire rectangle on the ground plus a
   * corner peg at each end, so the playable area reads at a glance. */
  _buildBoundary(ex, ez) {
    const g = new THREE.Group();
    const corners = [
      [-ex, -ez],
      [ex, -ez],
      [ex, ez],
      [-ex, ez],
    ];
    const pts = new Float32Array([
      ...corners.flatMap(([x, z]) => [x, 0.02, z]),
      corners[0][0], 0.02, corners[0][1],
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: BOUNDARY_COLOR, transparent: true, opacity: 0.9 }));
    g.add(line);
    const pegMat = new THREE.MeshStandardMaterial({ color: BOUNDARY_COLOR, roughness: 0.6, emissive: BOUNDARY_COLOR, emissiveIntensity: 0.35 });
    for (const [x, z] of corners) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.55, 10), pegMat);
      peg.position.set(x, 0.275, z);
      g.add(peg);
    }
    return g;
  }

  /** The fence preview: posts and rails generated from the boundary, at the
   * same offsets and spacing the real park's fence uses (park.js buildScenery),
   * merged into a single mesh so the editor stays cheap to render. */
  _buildFence(ex, ez) {
    const FENCE = 0x6f7580;
    const entries = [];
    for (const side of [-1, 1]) {
      for (let x = -ex; x <= ex; x += 2.4) {
        entries.push(box(FENCE, 0.06, 2.2, 0.06, x, 1.1, side * (ez + 1.2)));
      }
      for (let z = -ez; z <= ez; z += 2.4) {
        entries.push(box(FENCE, 0.06, 2.2, 0.06, side * (ex + 1.2), 1.1, z));
      }
    }
    for (const side of [-1, 1]) {
      for (const y of [1.1, 2.15]) {
        entries.push(box(FENCE, ex * 2, 0.05, 0.05, 0, y, side * (ez + 1.2)));
        entries.push(box(FENCE, 0.05, 0.05, ez * 2, side * (ex + 1.2), y, 0));
      }
    }
    const mesh = new THREE.Mesh(merge(entries, 0.3), this._mat(FENCE));
    return mesh;
  }

  _buildObject(o) {
    const g = new THREE.Group();
    g.userData.parkObjId = o.id;
    const preview = objectType(o.type).preview(o);
    g.add(preview);
    this._applyTransform(g, o);
    this.pickables.push(g);
    return g;
  }

  _applyTransform(g, o) {
    g.position.set(o.x, o.y || 0, o.z);
    g.rotation.y = o.ry * DEG;
    g.scale.set(o.sx, 1, o.sz);
  }

  /** Rebuild a single object's preview after it is edited — cheap enough to
   * run on every pointermove during a drag. */
  _updateObjectPreview(o) {
    const old = this._objectGroup(o.id);
    if (old) {
      this._disposeGroup(old);
      this.root.remove(old);
      const i = this.pickables.indexOf(old);
      if (i >= 0) this.pickables.splice(i, 1);
    }
    this.root.add(this._buildObject(o));
    this._updateOutline();
  }

  _objectGroup(id) {
    return this.pickables.find((g) => g.userData.parkObjId === id) || null;
  }

  _spawnMesh() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.5, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 20),
      new THREE.MeshBasicMaterial({ color: 0xff3d6e, side: THREE.DoubleSide })
    );
    dot.rotation.x = -Math.PI / 2;
    g.add(ring);
    g.add(dot);
    return g;
  }

  _updateOutline() {
    if (this._outline) {
      this.root.remove(this._outline);
      this._disposeGroup(this._outline);
      this._outline = null;
    }
    if (!this.sel) return;
    const o = this.file?.objects.find((x) => x.id === this.sel);
    if (!o) return;
    const b = boundsOf(o);
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const h = Math.max(0.25, this._objectHeight(o));
    const box = new THREE.BoxGeometry(w + 0.12, h + 0.12, d + 0.12);
    const edges = new THREE.EdgesGeometry(box);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xff3d6e, transparent: true, opacity: 0.9 })
    );
    line.position.set((b.x0 + b.x1) / 2, (h + 0.12) / 2 + (o.y || 0), (b.z0 + b.z1) / 2);
    line.raycast = () => null;
    this._outline = line;
    this.root.add(line);
  }

  _objectHeight(o) {
    const t = objectType(o.type);
    switch (o.type) {
      case 'slab':
      case 'ledge':
        return o.h;
      case 'bank':
        return o.h;
      case 'quarter':
        return Math.min(o.H, o.R - 0.05);
      case 'bowl':
        return Math.min(o.H, o.R - 0.05);
      case 'stairs':
        return o.steps * o.rise;
      case 'rail':
        return o.h + o.r;
      case 'funbox':
        return o.h;
      default:
        return 1;
    }
  }

  _disposeGroup(g) {
    g.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
  }

  _mat(color) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95, metalness: 0 });
  }

  // --- camera -------------------------------------------------------------

  _applyCamera() {
    const cp = Math.cos(this.orbit.pitch);
    this.camera.position.set(
      this.orbit.tx + this.orbit.dist * cp * Math.sin(this.orbit.yaw),
      this.orbit.dist * Math.sin(this.orbit.pitch),
      this.orbit.tz + this.orbit.dist * cp * Math.cos(this.orbit.yaw)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.orbit.tx, 0.7, this.orbit.tz);
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
  }

  // --- picking and dragging -----------------------------------------------

  _ndcPoint(clientX, clientY, out = this._ndc) {
    const r = this.canvas.getBoundingClientRect();
    out.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    return out;
  }

  _groundPoint(clientX, clientY) {
    this._ray.setFromCamera(this._ndcPoint(clientX, clientY), this.camera);
    return this._ray.ray.intersectPlane(this._plane, this._hit) ? this._hit.clone() : null;
  }

  _pick(clientX, clientY) {
    this._ray.setFromCamera(this._ndcPoint(clientX, clientY), this.camera);
    const hits = this._ray.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let node = h.object;
      while (node && !node.userData.parkObjId) node = node.parent;
      if (node) return node.userData.parkObjId;
    }
    return null;
  }

  _down(e) {
    if (!this.active) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const entry = { x: e.clientX, y: e.clientY };
    this._pointers.set(e.pointerId, entry);
    if (this._pointers.size === 2) {
      // A second finger lands: stop whatever the first was doing and take over
      // the camera. Pinch zooms, and the two fingers moving together pan.
      this._drag = null;
      this._pinch = this._pointerDist();
      this._pan = this._pointerMid();
      return;
    }
    const hit = this._pick(e.clientX, e.clientY);
    if (hit) {
      this.select(hit);
      const pt = this._groundPoint(e.clientX, e.clientY);
      const o = this._selected();
      if (!o) return;
      // The drag that follows depends on the active transform mode — move,
      // rotate and scale each read a different thing off the pointer, and only
      // one is armed at a time, so a stray drag can never turn into the wrong
      // transform.
      if (this.mode === 'move') {
        this._drag = pt ? { kind: 'move', id: o.id, sx: o.x, sz: o.z, gx: pt.x, gz: pt.z, moved: false } : null;
      } else if (this.mode === 'rotate') {
        this._drag = pt
          ? { kind: 'rotate', id: o.id, sx: o.x, sz: o.z, base: o.ry, a0: Math.atan2(pt.x - o.x, pt.z - o.z), moved: false }
          : null;
      } else {
        this._drag = { kind: 'scale', id: o.id, base: o.sx, y0: e.clientY, moved: false };
      }
    } else {
      this._drag = { kind: 'orbit', lastX: e.clientX, lastY: e.clientY };
    }
  }

  _move(e) {
    if (!this.active) return;
    const entry = this._pointers.get(e.pointerId);
    if (entry) {
      entry.x = e.clientX;
      entry.y = e.clientY;
    }
    if (this._pointers.size === 2) {
      const d = this._pointerDist();
      if (this._pinch) {
        this.orbit.dist = clamp(this.orbit.dist * (this._pinch / Math.max(1, d)), 4, 120);
      }
      this._pinch = d;
      // The two fingers moving together pan the camera target. The pinch's
      // own distance change contributes nothing to the midpoint, so zoom and
      // pan never fight each other.
      const mid = this._pointerMid();
      if (this._pan) {
        this._panCamera(mid.x - this._pan.x, mid.y - this._pan.y);
      }
      this._pan = mid;
      this._applyCamera();
      return;
    }
    if (!this._drag) return;
    if (this._drag.kind === 'orbit') {
      this.orbit.yaw += (e.clientX - this._drag.lastX) * 0.006;
      this.orbit.pitch = clamp(this.orbit.pitch + (e.clientY - this._drag.lastY) * 0.006, 0.06, 1.45);
      this._drag.lastX = e.clientX;
      this._drag.lastY = e.clientY;
      this._applyCamera();
      return;
    }
    const o = this._selected();
    if (!o) return;
    if (this._drag.kind === 'move') {
      const pt = this._groundPoint(e.clientX, e.clientY);
      if (!pt) return;
      const dx = pt.x - this._drag.gx;
      const dz = pt.z - this._drag.gz;
      if (!this._drag.moved && Math.hypot(dx, dz) < 0.02) return;
      this._drag.moved = true;
      o.x = this._snap(this._drag.sx + dx);
      o.z = this._snap(this._drag.sz + dz);
      this._updateObjectPreview(o);
    } else if (this._drag.kind === 'rotate') {
      const pt = this._groundPoint(e.clientX, e.clientY);
      if (!pt) return;
      let d = Math.atan2(pt.x - this._drag.sx, pt.z - this._drag.sz) - this._drag.a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (!this._drag.moved && Math.abs(d) < 0.04) return;
      this._drag.moved = true;
      o.ry = this._snapAngle(this._drag.base + d);
      this._updateObjectPreview(o);
    } else if (this._drag.kind === 'scale') {
      const s = clamp(this._drag.base * Math.exp((this._drag.y0 - e.clientY) * 0.004), 0.5, 3);
      o.sx = Math.round(s * 20) / 20;
      o.sz = o.sx;
      this._updateObjectPreview(o);
    }
  }

  _up(e) {
    if (!this.active) return;
    if (this._pointers.has(e.pointerId)) {
      this._pointers.delete(e.pointerId);
    }
    if (this._pointers.size < 2) {
      this._pinch = null;
      this._pan = null;
    }
    if (this._drag && this._drag.kind !== 'orbit' && this._drag.moved) this.commit();
    if (this._pointers.size === 0) this._drag = null;
  }

  _pointerDist() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  _pointerMid() {
    const pts = [...this._pointers.values()];
    return {
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    };
  }

  /** Pan the orbit target so the ground follows the fingers. A screen delta
   * is scaled into world units at the target depth, then applied along the
   * camera's own right and screen-up axes (kept to the ground plane) — the
   * same view-relative feel as a one-finger orbit, but a translation instead
   * of a turn. */
  _panCamera(dx, dy) {
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const worldPerPx = (2 * this.orbit.dist * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, rect.height);
    this.orbit.tx += (-dx * right.x + dy * up.x) * worldPerPx;
    this.orbit.tz += (-dx * right.z + dy * up.z) * worldPerPx;
  }

  _snap(v) {
    return this.snapOn ? Math.round(v / this.snap) * this.snap : Math.round(v * 100) / 100;
  }

  /** Rotation is quarter-turn snapped everywhere in the game, so the drag
   * gesture snaps to the same grid the keyboard and the panel use. */
  _snapAngle(deg) {
    return ((Math.round(deg / 90) % 4) + 4) % 4 * 90;
  }

  // --- selection and editing ----------------------------------------------

  select(id) {
    this.sel = id;
    this._updateOutline();
    this._renderPanel();
    this._renderModeButtons();
  }

  _selected() {
    return this.file?.objects.find((o) => o.id === this.sel) || null;
  }

  addObject(type) {
    if (!this.file) return;
    if (this.file.objects.length >= MAX_OBJECTS) return;
    const o = newObject(type);
    const pt = this._groundPoint(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    if (pt) {
      o.x = this._snap(pt.x);
      o.z = this._snap(pt.z);
    }
    this.file.objects.push(o);
    this.sel = o.id;
    this._rebuild();
    this._renderPanel();
    this.commit();
  }

  duplicateSelected() {
    const o = this._selected();
    if (!o || this.file.objects.length >= MAX_OBJECTS) return;
    const copy = { ...o, id: newObject(o.type).id, x: this._snap(o.x + 1.5), z: this._snap(o.z + 1.5) };
    this.file.objects.push(copy);
    this.sel = copy.id;
    this._rebuild();
    this._renderPanel();
    this.commit();
  }

  deleteSelected() {
    const o = this._selected();
    if (!o) return;
    this.file.objects = this.file.objects.filter((x) => x.id !== o.id);
    this.sel = null;
    this._rebuild();
    this._renderPanel();
    this.commit();
  }

  rotateSelected(dir = 1) {
    const o = this._selected();
    if (!o) return;
    o.ry = this._snapAngle(o.ry + dir * 90);
    this._updateObjectPreview(o);
    this._renderPanel();
    this.commit();
  }

  nudge(dx, dz) {
    const o = this._selected();
    if (!o) return;
    o.x = this._snap(o.x + dx);
    o.z = this._snap(o.z + dz);
    this._updateObjectPreview(o);
    this.commit();
  }

  /** Raise or lower the selected object — the editor's vertical axis. */
  nudgeY(dy) {
    const o = this._selected();
    if (!o) return;
    o.y = Math.min(12, Math.max(0, (o.y || 0) + dy));
    o.y = Math.round(o.y * 100) / 100;
    this._updateObjectPreview(o);
    this.commit();
  }

  // --- history ------------------------------------------------------------

  commit() {
    if (!this.file) return;
    this.past.push(serialize(this.file));
    if (this.past.length > 60) this.past.shift();
    this.future = [];
    this._updateUndoButtons();
    this._scheduleSave();
  }

  undo() {
    if (!this.past.length) return;
    this.future.push(serialize(this.file));
    this.file = deserialize(this.past.pop());
    this._restore();
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(serialize(this.file));
    this.file = deserialize(this.future.pop());
    this._restore();
  }

  _restore() {
    this.sel = null;
    this._rebuild();
    this._renderPanel();
    this._updateUndoButtons();
    this._renderModeButtons();
    this._scheduleSave();
  }

  _updateUndoButtons() {
    if (this.undoBtn) this.undoBtn.disabled = this.past.length === 0;
    if (this.redoBtn) this.redoBtn.disabled = this.future.length === 0;
  }

  _updateCount() {
    if (!this.countEl || !this.file) return;
    this.countEl.textContent = `${this.file.objects.length} / ${MAX_OBJECTS} objects`;
  }

  // --- transform modes -----------------------------------------------------

  _setMode(m) {
    this.mode = m;
    this._drag = null;
    this._renderModeButtons();
  }

  _renderModeButtons() {
    for (const btn of this.modeBtns) {
      btn.classList.toggle('on', btn.dataset.mode === this.mode);
      btn.disabled = !this.sel;
    }
  }

  // --- the rail, the drawer, the scrim -------------------------------------

  _openRail(tab = this.railTab || 'palette') {
    this.railTab = tab;
    this._setRailTab();
    this.chrome?.classList.add('dg-rail-open');
    this._setScrimState();
  }

  _closeRail() {
    this.chrome?.classList.remove('dg-rail-open');
    this._setScrimState();
  }

  _setRailTab(tab) {
    if (tab) this.railTab = tab;
    if (this.railEl) this.railEl.classList.toggle('dg-tab-panel', this.railTab === 'panel');
    for (const t of this.tabBtns) t.classList.toggle('on', t.dataset.dgtab === this.railTab);
  }

  _toggleDrawer() {
    if (this.chrome?.classList.contains('dg-drawer-open')) this._closeDrawer();
    else this._openDrawer();
  }

  _openDrawer() {
    if (this.drawerEl) {
      this.drawerEl.hidden = false;
      this.drawerEl.setAttribute('aria-hidden', 'false');
    }
    this.chrome?.classList.add('dg-drawer-open');
    this._updateDrawerLabels();
    this._setScrimState();
  }

  _closeDrawer() {
    this.chrome?.classList.remove('dg-drawer-open');
    if (this.drawerEl) {
      this.drawerEl.hidden = true;
      this.drawerEl.setAttribute('aria-hidden', 'true');
    }
    this._setScrimState();
  }

  /** The scrim only ever covers a narrow screen, and only while a sheet or the
   * drawer is up. Recomputing it from the open states also clears a scrim that
   * a resize from phone to desktop would otherwise leave behind. */
  _setScrimState() {
    if (!this.scrimEl) return;
    const on =
      this._isNarrow() &&
      (this.chrome?.classList.contains('dg-rail-open') || this.chrome?.classList.contains('dg-drawer-open'));
    this.scrimEl.hidden = !on;
  }

  _updateDrawerLabels() {
    this.drawerEl?.querySelectorAll('[data-dgmenu]').forEach((btn) => {
      const key = btn.dataset.dgmenu;
      if (key === 'grid') btn.textContent = `Grid: ${this.gridOn ? 'on' : 'off'}`;
      else if (key === 'snap') btn.textContent = `Snap: ${this.snapOn ? 'on' : 'off'}`;
    });
  }

  _drawerAction(name) {
    switch (name) {
      case 'objects':
        this._closeDrawer();
        this._openRail('palette');
        break;
      case 'props':
        this._closeDrawer();
        this._renderPanel();
        this._openRail('panel');
        break;
      case 'park':
      case 'boundary':
      case 'spawn':
        this._closeDrawer();
        this.sel = null;
        this._updateOutline();
        this._renderPanel();
        this._openRail('panel');
        if (name === 'boundary') {
          requestAnimationFrame(() => this.panelEl?.querySelector('#dg-boundary')?.scrollIntoView({ block: 'nearest' }));
        }
        break;
      case 'grid':
        this.gridOn = !this.gridOn;
        this._rebuild();
        this._updateDrawerLabels();
        break;
      case 'snap':
        this.snapOn = !this.snapOn;
        this._updateDrawerLabels();
        break;
      case 'test':
        this._closeDrawer();
        this.on.test?.();
        break;
      case 'save':
        this._closeDrawer();
        this.save();
        break;
      case 'exit':
        this._closeDrawer();
        this.on.back?.();
        break;
    }
  }

  // --- the panel ----------------------------------------------------------

  _renderPanel() {
    if (!this.panelEl) return;
    const o = this._selected();
    this.panelEl.innerHTML = o ? this._objectPanel(o) : this._parkPanel();
    this._bindPanel(o);
    this._drawPanelWheels();
  }

  /** The swatches plus the colour wheel: the swatches are the quick presets,
   * the wheel (with its brightness slider) is the "any colour at all" escape
   * hatch. `data` is the preset buttons' own attribute, so the object panel
   * and the park panel can each use their own without colliding. */
  _colorPicker(data, presets, curHex) {
    curHex = cssColorOf(curHex);
    const { v } = hexToHsv(curHex);
    const cur = curHex.toLowerCase();
    const activeId = presets.find((s) => cssColor(s.color).toLowerCase() === cur)?.id || '';
    const swatches = presets
      .map(
        (s) =>
          `<button type="button" data-${data}="${s.id}" class="dg-swatch${s.id === activeId ? ' on' : ''}" style="--sw:${cssColor(s.color)}" title="${s.label}" aria-label="${s.label}"></button>`
      )
      .join('');
    return (
      `<div class="dg-group"><span>Surface</span><div class="dg-swatches">${swatches}</div></div>` +
      `<div class="dg-color">` +
      `<canvas data-wheel="${data}" class="dg-wheel" width="140" height="140" aria-label="Colour wheel"></canvas>` +
      `<label class="dg-field dg-brightness">Brightness` +
      `<input type="range" data-brightness="${data}" min="0" max="100" step="1" value="${Math.round(v * 100)}">` +
      `<output data-brightout="${data}">${Math.round(v * 100)}</output></label>` +
      `<div class="dg-hexrow"><span class="dg-hex-chip" style="--chip:${curHex}"></span><output class="dg-hex" data-hexout="${data}">${curHex.toUpperCase()}</output></div>` +
      `</div>`
    );
  }

  /** Paint every wheel in the panel to match the colour it currently stands
   * for — run whenever the panel (re)renders. */
  _drawPanelWheels() {
    if (!this.panelEl) return;
    this.panelEl.querySelectorAll('[data-wheel]').forEach((canvas) => {
      const target = canvas.dataset.wheel;
      const hex = target === 'ground' ? padColor(this.file) : objectColor(this._selected()?.color);
      drawWheel(canvas, cssColorOf(hex));
    });
  }

  _parkPanel() {
    const { x: ex, z: ez } = extentOf(this.file);
    const spawn = spawnFor(this.file);
    const b = boundaryOf(this.file);
    return (
      `<h3>Park</h3>` +
      `<div id="dg-boundary" class="dg-note dg-boundary">` +
      `Boundary: ${Math.round((b.maxX - b.minX))} × ${Math.round((b.maxZ - b.minZ))} m — the same footprint as the built-in parks (${PARK_X * 2} × ${PARK_Z * 2} m). The fence follows this line and the pad fills it.` +
      `</div>` +
      `<label class="dg-field">Width` +
      `<input type="range" data-park="width" min="12" max="120" step="1" value="${Math.round(ex * 2)}">` +
      `<output>${Math.round(ex * 2)} m</output></label>` +
      `<label class="dg-field">Depth` +
      `<input type="range" data-park="depth" min="12" max="120" step="1" value="${Math.round(ez * 2)}">` +
      `<output>${Math.round(ez * 2)} m</output></label>` +
      this._colorPicker('ground', GROUNDS, padColor(this.file)) +
      `<p class="dg-note">Spawn sits at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}) — inside the boundary, clear of the fence — and moves itself if an object blocks it. The AI patrol keeps clear of your objects.</p>` +
      `<button type="button" data-rename class="dg-btn">Rename park…</button>`
    );
  }

  _objectPanel(o) {
    const t = objectType(o.type);
    const { x: ex, z: ez } = extentOf(this.file);
    const maxR = Math.max(ex, ez);
    const range = (label, value, { min, max, step, unit }, data) => {
      const v = Number(value);
      const text = unit === '' ? Math.round(v) : v.toFixed(step >= 0.1 ? 1 : 2);
      return (
        `<label class="dg-field">${label}` +
        `<input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-${data}="1">` +
        `<output>${text}${unit ? ` ${unit}` : ''}</output></label>`
      );
    };
    let html = `<h3>${t.label}</h3><p class="dg-note">${t.hint}</p>`;
    html += `<div class="dg-field dg-pos">X<input type="range" min="${-maxR - 8}" max="${maxR + 8}" step="0.1" value="${o.x}" data-pos="x"><output>${o.x.toFixed(2)}</output></div>`;
    html += `<div class="dg-field dg-pos">Z<input type="range" min="${-maxR - 8}" max="${maxR + 8}" step="0.1" value="${o.z}" data-pos="z"><output>${o.z.toFixed(2)}</output></div>`;
    html += `<div class="dg-field dg-pos dg-elev">Y<input type="range" min="0" max="12" step="0.1" value="${o.y || 0}" data-pos="y"><output>${(o.y || 0).toFixed(2)}</output></div>`;
    html +=
      `<div class="dg-row"><button type="button" data-rot="-1" class="dg-btn">⟲ 90°</button>` +
      `<button type="button" data-rot="1" class="dg-btn">⟳ 90°</button>` +
      `<span class="dg-yaw">${this._snapAngle(Math.round(o.ry / 90) * 90)}°</span></div>`;
    for (const prop of t.props) html += range(prop.label, o[prop.key], prop, `prop`);
    html += `<div class="dg-row"><span>Scale X</span>` + range('', o.sx, { min: 0.5, max: 3, step: 0.05, unit: '' }, 'sx') + `</div>`;
    html += `<div class="dg-row"><span>Scale Z</span>` + range('', o.sz, { min: 0.5, max: 3, step: 0.05, unit: '' }, 'sz') + `</div>`;
    html +=
      `<label class="dg-switch dg-uniform">Uniform scale ` +
      `<input type="checkbox" data-uniform ${o.sx === o.sz ? 'checked' : ''}></label>` +
      `<div class="dg-field dg-pos">Scale<input type="range" min="0.5" max="3" step="0.05" value="${o.sx}" data-scale="1"><output>${o.sx.toFixed(2)}</output></div>`;
    if ('color' in t.defaults) {
      html += this._colorPicker('color', SURFACES, objectColor(o.color));
    }
    html +=
      `<div class="dg-row">` +
      `<button type="button" data-dup class="dg-btn">Duplicate</button>` +
      `<button type="button" data-del class="dg-btn danger">Delete</button>` +
      `</div>`;
    return html;
  }

  _bindPanel(o) {
    if (!this.panelEl) return;
    const uniform = () => this.panelEl.querySelector('[data-uniform]')?.checked === true;
    // Park-level controls (shown when nothing is selected).
    this.panelEl.querySelector('[data-park="width"]')?.addEventListener('input', (e) => {
      const w = Number(e.target.value) / 2;
      this._setBoundary({ minX: -w, maxX: w });
      e.target.nextElementSibling.textContent = `${Number(e.target.value)} m`;
      this._rebuild();
      this._scheduleSave();
    });
    this.panelEl.querySelector('[data-park="width"]')?.addEventListener('change', () => this.commit());
    this.panelEl.querySelector('[data-park="depth"]')?.addEventListener('input', (e) => {
      const d = Number(e.target.value) / 2;
      this._setBoundary({ minZ: -d, maxZ: d });
      e.target.nextElementSibling.textContent = `${Number(e.target.value)} m`;
      this._rebuild();
      this._scheduleSave();
    });
    this.panelEl.querySelector('[data-park="depth"]')?.addEventListener('change', () => this.commit());
    this.panelEl.querySelectorAll('[data-ground]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.file.ground = btn.dataset.ground;
        this.file.groundHex = undefined;
        this._rebuild();
        this._renderPanel();
        this.commit();
      });
    });
    // The colour wheels (the selected object's surface, or the pad) and their
    // brightness sliders. Dragging a wheel picks hue and saturation together;
    // the slider then keeps the chosen brightness. Both update the preview
    // live and commit when the gesture lets go.
    const wheelApply = (target) => (hex) => {
      if (target === 'ground') {
        this.file.groundHex = hex;
        if (this._pad) this._pad.material.color.set(hex);
      } else {
        const sel = this._selected();
        if (!sel) return;
        sel.color = hex;
        this._updateObjectPreview(sel);
      }
      const canvas = this.panelEl.querySelector(`[data-wheel="${target}"]`);
      const slider = this.panelEl.querySelector(`[data-brightness="${target}"]`);
      const out = this.panelEl.querySelector(`[data-hexout="${target}"]`);
      if (canvas) drawWheel(canvas, hex);
      if (slider) slider.value = String(Math.round(hexToHsv(hex).v * 100));
      if (out) out.textContent = hex.toUpperCase();
      this._scheduleSave();
    };
    this.panelEl.querySelectorAll('[data-wheel]').forEach((canvas) => {
      const target = canvas.dataset.wheel;
      const apply = wheelApply(target);
      const pick = (e) => {
        const r = canvas.getBoundingClientRect();
        const size = r.width || 140;
        const R = size / 2 - 3;
        const dx = e.clientX - (r.left + size / 2);
        const dy = e.clientY - (r.top + size / 2);
        const hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
        const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / R);
        const slider = this.panelEl.querySelector(`[data-brightness="${target}"]`);
        const v = slider ? Number(slider.value) / 100 : 1;
        apply(hsvToHex(hue, sat, v));
      };
      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        canvas.setPointerCapture?.(e.pointerId);
        pick(e);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (canvas.hasPointerCapture?.(e.pointerId)) pick(e);
      });
      canvas.addEventListener('pointerup', (e) => {
        if (!canvas.hasPointerCapture?.(e.pointerId)) return;
        canvas.releasePointerCapture?.(e.pointerId);
        this.commit();
        this._renderPanel();
      });
    });
    this.panelEl.querySelectorAll('[data-brightness]').forEach((slider) => {
      const target = slider.dataset.brightness;
      slider.addEventListener('input', () => {
        const cur = target === 'ground' ? padColor(this.file) : objectColor(this._selected()?.color);
        const { h, s } = hexToHsv(cssColorOf(cur));
        wheelApply(target)(hsvToHex(h, s, Number(slider.value) / 100));
        const out = this.panelEl.querySelector(`[data-brightout="${target}"]`);
        if (out) out.textContent = slider.value;
      });
      slider.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelector('[data-rename]')?.addEventListener('click', () => this.nameInput?.select());
    // Object controls.
    if (!o) return;
    this.panelEl.querySelectorAll('[data-pos]').forEach((el) => {
      el.addEventListener('input', (e) => {
        o[el.dataset.pos] = this._snap(Number(e.target.value));
        e.target.nextElementSibling.textContent = o[el.dataset.pos].toFixed(2);
        this._updateObjectPreview(o);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelectorAll('[data-prop]').forEach((el) => {
      el.addEventListener('input', (e) => {
        o[el.dataset.prop] = Number(e.target.value);
        e.target.nextElementSibling.textContent =
          el.step >= 0.1 ? Number(e.target.value).toFixed(1) : Number(e.target.value).toFixed(2);
        this._updateObjectPreview(o);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelectorAll('[data-sx]').forEach((el) => {
      el.addEventListener('input', (e) => {
        o.sx = Number(e.target.value);
        if (uniform()) o.sz = o.sx;
        this._applyTransform(this._objectGroup(o.id), o);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelectorAll('[data-sz]').forEach((el) => {
      el.addEventListener('input', (e) => {
        o.sz = Number(e.target.value);
        if (uniform()) o.sx = o.sz;
        this._applyTransform(this._objectGroup(o.id), o);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelectorAll('[data-scale]').forEach((el) => {
      el.addEventListener('input', (e) => {
        o.sx = Number(e.target.value);
        o.sz = o.sx;
        this._applyTransform(this._objectGroup(o.id), o);
        e.target.nextElementSibling.textContent = o.sx.toFixed(2);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelector('[data-uniform]')?.addEventListener('change', () => {
      if (uniform()) {
        o.sz = o.sx;
        this._applyTransform(this._objectGroup(o.id), o);
      }
      this._renderPanel();
      this.commit();
    });
    this.panelEl.querySelectorAll('[data-rot]').forEach((el) => {
      el.addEventListener('click', () => this.rotateSelected(Number(el.dataset.rot)));
    });
    this.panelEl.querySelectorAll('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        o.color = btn.dataset.color;
        this._updateObjectPreview(o);
        this._renderPanel();
        this.commit();
      });
    });
    this.panelEl.querySelector('[data-dup]')?.addEventListener('click', () => this.duplicateSelected());
    this.panelEl.querySelector('[data-del]')?.addEventListener('click', () => this.deleteSelected());
  }

  _setBoundary(part) {
    const b = { ...boundaryOf(this.file), ...part };
    // Keep the boundary mirrored about the origin — the Park's pad slab is a
    // centred rectangle, so any off-centre boundary would disagree with it.
    b.minX = -b.maxX;
    b.minZ = -b.maxZ;
    this.file.boundary = b;
  }

  _key(e) {
    if (!this.active) return;
    if (e.key === 'Escape') {
      if (this.chrome?.classList.contains('dg-drawer-open')) {
        this._closeDrawer();
        e.preventDefault();
      } else if (this.chrome?.classList.contains('dg-rail-open') && this._isNarrow()) {
        this._closeRail();
        e.preventDefault();
      }
      return;
    }
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') {
      this.rotateSelected(e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
      e.preventDefault();
    } else if (e.key.startsWith('Arrow')) {
      const d = e.shiftKey ? 0.5 : 2;
      const dx = e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0;
      const dz = e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0;
      this.nudge(dx, dz);
      e.preventDefault();
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      this.nudgeY((e.key === 'PageUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.25));
      e.preventDefault();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) this.redo();
      else this.undo();
      e.preventDefault();
    }
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// --- the colour wheel -------------------------------------------------------
// Painting a park is not limited to the surface swatches any more: the wheel
// picks hue and saturation in one drag and a brightness slider sets the value,
// so every object (and the pad itself) can be any colour at all. The wheel's
// full-colour face is drawn once into a shared offscreen canvas and cheaply
// composited on each redraw, so dragging stays smooth.

function hsvRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = v;
  let g = t;
  let b = p;
  switch (i % 6) {
    case 0: break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hsvToHex(h, s, v) {
  const [r, g, b] = hsvRgb(h, s, v);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** The wheel's face, drawn once per resolution: hue around the rim, saturation
 * toward the centre, at full brightness. Brightness is applied on top per draw
 * because a value change should not have to recompute the whole disc. */
let _wheelSource = null;
function wheelSource(px) {
  if (_wheelSource && _wheelSource.width === px) return _wheelSource;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(px, px);
  const R = px / 2 - 3;
  const cx = px / 2;
  const cy = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * px + x) * 4;
      if (dist > R) continue;
      const hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
      const [r, g, b] = hsvRgb(hue, dist / R, 1);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _wheelSource = c;
  return c;
}

/** Paint `canvas` as the colour wheel for `hex`, with a handle at the colour
 * and a darkened disc if the brightness is below full. */
function drawWheel(canvas, hex) {
  const { h, s, v } = hexToHsv(hex);
  const size = canvas.clientWidth || 140;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(size * dpr);
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(wheelSource(px), 0, 0);
  if (v < 1) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0, 0, 0, ${(1 - v).toFixed(4)})`;
    ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = size / 2 - 3;
  const cx = size / 2;
  const cy = size / 2;
  const ang = h * Math.PI * 2;
  const rad = s * R;
  const hx = cx + Math.cos(ang) * rad;
  const hy = cy + Math.sin(ang) * rad;
  ctx.beginPath();
  ctx.arc(hx, hy, 7, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hx, hy, 4, 0, Math.PI * 2);
  ctx.fillStyle = hex;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
}

export { newFile, buildDef, MAX_OBJECTS };

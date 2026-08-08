// The park editor: a second, self-contained scene where a park file is built
// and previewed before it ever touches the real game. It owns its own lights,
// its own camera orbit, and its own scene — the play scene is never disturbed
// while a park is being designed, and leaving the editor is a plain swap back.
//
// What you see is what you ride: every object's preview is built from the same
// shapes and the same transform math as the collision it produces, so a ramp
// that looks wrong to ride will be wrong to ride, and vice versa.

import * as THREE from '../game/three.js';
import { OBJECTS, SURFACES, GROUNDS, newObject, objectType, boundsOf, groundColor } from './parkObjects.js';
import { newFile, serialize, deserialize, validate, buildDef, spawnFor, MAX_OBJECTS } from './parkFile.js';
import { putFile } from './parkStorage.js';

const DEG = Math.PI / 180;

// Day lighting, matching the game's own PRESETS[DAY] so the editor shows a
// park the way it will look under the sun.
const SKY = 0x8fb4d6;
const FOG = 0xd8d3c4;

export class ParkDesigner {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.active = false;
    this.file = null;
    this.sel = null;
    this.snapOn = true;
    this.snap = 0.25;
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

    this._bind();
  }

  _bind() {
    document.getElementById('dg-back')?.addEventListener('click', () => this.on.back?.());
    document.getElementById('dg-save')?.addEventListener('click', () => this.save());
    document.getElementById('dg-test')?.addEventListener('click', () => this.on.test?.());
    this.undoBtn?.addEventListener('click', () => this.undo());
    this.redoBtn?.addEventListener('click', () => this.redo());
    this.nameInput?.addEventListener('change', () => {
      if (!this.file) return;
      this.file.name = this.nameInput.value.trim().slice(0, 40) || 'My park';
      this._scheduleSave();
    });

    // Build the palette rail once — the object types never change.
    if (this.paletteEl) {
      this.paletteEl.innerHTML = OBJECTS.map(
        (t) => `<button type="button" class="dg-palette-btn" data-type="${t.id}" title="${t.hint}"><b>${t.label}</b><span>${t.hint}</span></button>`
      ).join('');
      this.paletteEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-type]');
        if (btn) this.addObject(btn.dataset.type);
      });
    }

    // Pointer handling lives on the canvas: drag an object to move it, drag
    // empty ground to orbit, pinch or wheel to zoom.
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
    this.orbit.dist = clamp(file.extent * 2.1, 14, 80);
    this.orbit.yaw = -0.55;
    this.orbit.pitch = 0.45;
    this.active = true;
    this.chrome.hidden = false;
    this._rebuild();
    this._renderPanel();
    this._applyCamera();
    this._updateCount();
    this._updateUndoButtons();
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
    const ex = this.file.extent;
    this._pad = new THREE.Mesh(new THREE.BoxGeometry(ex * 2, 0.55, ex * 2), this._mat(groundColor(this.file.ground)));
    this._pad.position.y = -0.275;
    this.root.add(this._pad);

    const grid = new THREE.GridHelper(ex * 2, Math.max(8, Math.round((ex * 2) / 2)), 0x7a7f88, 0x636872);
    grid.position.y = 0.012;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    grid.raycast = () => null;
    this.root.add(grid);

    const spawn = spawnFor(this.file);
    this._spawnMarker = this._spawnMesh();
    this._spawnMarker.position.set(spawn.x, 0.015, spawn.z);
    this.root.add(this._spawnMarker);

    this.pickables = [];
    for (const o of this.file.objects) this.root.add(this._buildObject(o));
    this._updateOutline();
    this._updateCount();
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
    g.position.set(o.x, 0, o.z);
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
    line.position.set((b.x0 + b.x1) / 2, (h + 0.12) / 2, (b.z0 + b.z1) / 2);
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
      // A second finger lands: stop whatever the first was doing and zoom.
      this._drag = null;
      this._pinch = this._pointerDist();
      return;
    }
    const hit = this._pick(e.clientX, e.clientY);
    if (hit) {
      this.select(hit);
      const pt = this._groundPoint(e.clientX, e.clientY);
      const o = this._selected();
      this._drag = pt
        ? { kind: 'move', id: o.id, sx: o.x, sz: o.z, gx: pt.x, gz: pt.z, moved: false }
        : null;
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
        this._applyCamera();
      }
      this._pinch = d;
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
    if (this._drag.kind === 'move') {
      const pt = this._groundPoint(e.clientX, e.clientY);
      if (!pt) return;
      const dx = pt.x - this._drag.gx;
      const dz = pt.z - this._drag.gz;
      if (!this._drag.moved && Math.hypot(dx, dz) < 0.02) return;
      this._drag.moved = true;
      const o = this._selected();
      if (!o) return;
      o.x = this._snap(this._drag.sx + dx);
      o.z = this._snap(this._drag.sz + dz);
      this._updateObjectPreview(o);
    }
  }

  _up(e) {
    if (!this.active) return;
    if (this._pointers.has(e.pointerId)) {
      this._pointers.delete(e.pointerId);
    }
    if (this._pointers.size < 2) this._pinch = null;
    if (this._drag?.kind === 'move' && this._drag.moved) this.commit();
    if (this._pointers.size === 0) this._drag = null;
  }

  _pointerDist() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  _snap(v) {
    return this.snapOn ? Math.round(v / this.snap) * this.snap : Math.round(v * 100) / 100;
  }

  // --- selection and editing ----------------------------------------------

  select(id) {
    this.sel = id;
    this._updateOutline();
    this._renderPanel();
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
    o.ry = (((Math.round(o.ry / 90) + dir) % 4) + 4) % 4 * 90;
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

  // --- the panel ----------------------------------------------------------

  _renderPanel() {
    if (!this.panelEl) return;
    const o = this._selected();
    this.panelEl.innerHTML = o ? this._objectPanel(o) : this._parkPanel();
    this._bindPanel(o);
  }

  _parkPanel() {
    const ex = this.file.extent;
    const ground = this.file.ground;
    return (
      `<h3>Park</h3>` +
      `<label class="dg-field">Pad size` +
      `<input type="range" data-park="extent" min="12" max="60" step="1" value="${ex}">` +
      `<output>${ex} m</output></label>` +
      `<div class="dg-group"><span>Surface</span><div class="dg-swatches">` +
      GROUNDS.map((g) => `<button type="button" data-ground="${g.id}" class="dg-swatch${g.id === ground ? ' on' : ''}" style="--sw:${g.color}" title="${g.label}" aria-label="${g.label}"></button>`).join('') +
      `</div></div>` +
      `<p class="dg-note">Spawn is placed automatically where the pad is clear, and the AI patrol keeps clear of your objects.</p>` +
      `<button type="button" data-rename class="dg-btn">Rename park…</button>`
    );
  }

  _objectPanel(o) {
    const t = objectType(o.type);
    const ex = this.file.extent;
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
    html += `<div class="dg-field dg-pos">X<input type="range" min="${-ex - 8}" max="${ex + 8}" step="0.1" value="${o.x}" data-pos="x"><output>${o.x.toFixed(2)}</output></div>`;
    html += `<div class="dg-field dg-pos">Z<input type="range" min="${-ex - 8}" max="${ex + 8}" step="0.1" value="${o.z}" data-pos="z"><output>${o.z.toFixed(2)}</output></div>`;
    html +=
      `<div class="dg-row"><button type="button" data-rot="-1" class="dg-btn">⟲ 90°</button>` +
      `<button type="button" data-rot="1" class="dg-btn">⟳ 90°</button>` +
      `<span class="dg-yaw">${((Math.round(o.ry / 90) % 4) + 4) % 4 * 90}°</span></div>`;
    for (const prop of t.props) html += range(prop.label, o[prop.key], prop, `prop`);
    html += `<div class="dg-row"><span>Scale X</span>` + range('', o.sx, { min: 0.5, max: 3, step: 0.05, unit: '' }, 'sx') + `</div>`;
    html += `<div class="dg-row"><span>Scale Z</span>` + range('', o.sz, { min: 0.5, max: 3, step: 0.05, unit: '' }, 'sz') + `</div>`;
    if (t.id === 'slab' || t.id === 'bank' || t.id === 'quarter' || t.id === 'ledge' || t.id === 'funbox') {
      html +=
        `<div class="dg-group"><span>Surface</span><div class="dg-swatches">` +
        SURFACES.map((s) => `<button type="button" data-color="${s.id}" class="dg-swatch${s.id === o.color ? ' on' : ''}" style="--sw:${s.color}" title="${s.label}" aria-label="${s.label}"></button>`).join('') +
        `</div></div>`;
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
    // Park-level controls (shown when nothing is selected).
    this.panelEl.querySelector('[data-park="extent"]')?.addEventListener('input', (e) => {
      this.file.extent = Number(e.target.value);
      e.target.nextElementSibling.textContent = `${this.file.extent} m`;
      this._rebuild();
      this._scheduleSave();
    });
    this.panelEl.querySelector('[data-park="extent"]')?.addEventListener('change', () => this.commit());
    this.panelEl.querySelectorAll('[data-ground]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.file.ground = btn.dataset.ground;
        this._rebuild();
        this._renderPanel();
        this.commit();
      });
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
        this._applyTransform(this._objectGroup(o.id), o);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
    });
    this.panelEl.querySelectorAll('[data-sz]').forEach((el) => {
      el.addEventListener('input', (e) => {
        o.sz = Number(e.target.value);
        this._applyTransform(this._objectGroup(o.id), o);
        this._scheduleSave();
      });
      el.addEventListener('change', () => this.commit());
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

  _key(e) {
    if (!this.active) return;
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

export { newFile, buildDef, MAX_OBJECTS };

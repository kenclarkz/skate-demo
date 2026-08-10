// The Board Maker's own window: the deck being put together, turning slowly on
// a plinth — and grabbable, so the player can spin it round to look at the art
// from every side the way a real deck gets checked over in a shop.
//
// It is the same second-tiny-scene trick as CharacterPreview: a separate WebGL
// renderer drawing only the board, because the skater's live board is out in
// the park where there is no stand to look at it from. The board is the real
// Board — same geometry builder, same merged single draw call — so what the
// maker shows is exactly the deck the player will ride.

import * as THREE from '../game/three.js';
import { Board } from './board.js';

const TURN_RATE = 0.55; // radians per second, while nobody is dragging

export class BoardPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x171c23, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
    this.camera.position.set(0, 0.5, 1.35);
    this.camera.lookAt(0, 0.06, 0);

    this.scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x33302a, 2.0));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.9);
    key.position.set(-4, 6, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8aa5d0, 0.7);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);

    // The plinth, same slate disc and hot ring the character maker uses — the
    // two dressing rooms read as one shop.
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.95, 0.09, 48),
      new THREE.MeshPhongMaterial({ color: 0x2b3442, shininess: 6, specular: 0x14181f })
    );
    plinth.position.y = -0.045;
    this.scene.add(plinth);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.012, 12, 48),
      new THREE.MeshPhongMaterial({ color: 0xffc93f, emissive: 0xffc93f, emissiveIntensity: 0.35 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.001;
    this.scene.add(ring);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.board = new Board();
    // The board's group origin is the wheel contact plane, so it stands on the
    // plinth exactly the way it stands on the concrete.
    this.turntable.add(this.board.group);

    // Drag to spin: pointer down stops the auto-turn and hands the rotation to
    // the pointer, pointer up hands it back to the clock. Horizontal drag yaws,
    // vertical drag tilts the deck toward the lens a little.
    this._dragging = false;
    this._px = 0;
    this._py = 0;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._px = e.clientX;
      this._py = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._px;
      const dy = e.clientY - this._py;
      this._px = e.clientX;
      this._py = e.clientY;
      this.turntable.rotation.y += dx * 0.012;
      this.turntable.rotation.x = Math.max(-0.6, Math.min(0.6, this.turntable.rotation.x + dy * 0.006));
    });
    const up = () => {
      this._dragging = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    this.t = 0;
    this._raf = 0;
    this._last = 0;
  }

  /** Match the canvas's own laid-out size, so the render is never scaled. */
  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Show a new deck: palette, shape and the whole design draft. */
  setBoard(palette, shape, design) {
    this.board.build(palette, shape, design);
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.t += dt;
      // Only the clock turns it; a hand on it has paused the auto-spin.
      if (!this._dragging) this.turntable.rotation.y = this.t * TURN_RATE;
      this.resize();
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}

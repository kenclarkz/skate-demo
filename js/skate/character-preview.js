// The Character Maker's own window: a three-dimensional look at the figure
// being put together, turning slowly on a plinth.
//
// It shares the two-draw-call trick the tutorial's TrickPreview uses — a
// second, tiny WebGL scene that only ever renders the rig itself — because
// the live skater is out in the park and not somewhere a designer can stand
// to look at them. The figure is the real Skater: same geometry, same pose
// solver, same colours, so a "short + stocky" setting is not a paragraph of
// text but the actual body the maker will build. It turns so the silhouette —
// the one thing a height or a build actually changes — is readable from every
// side instead of just front-on.

import * as THREE from '../game/three.js';
import { Skater } from './skater.js';

const TURN_RATE = 0.7; // radians per second

export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x171c23, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
    this.camera.position.set(0, 1.05, 2.1);
    this.camera.lookAt(0, 1.0, 0);

    this.scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x33302a, 2.0));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.9);
    key.position.set(-4, 6, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8aa5d0, 0.7);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);

    // The plinth. A slate disc so the figure reads as standing on something
    // rather than floating in the dark, sized to clear the widest stance the
    // maker can build (stocky) without ever reaching the frame edge.
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

    // The rig itself. The glow is off — this is a look in a dressing room,
    // not a run down the street, and a neon tee glowing in the mirror would
    // be the preview lying about what it shows.
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.skater = new Skater(undefined, { glow: false });
    this.turntable.add(this.skater.group);

    // poseWalk() only reads this — a still rider on the plinth, feet planted,
    // hands hanging, no stride and no board. The maker does not need the walk
    // cycle; the pose just needs to be a person standing.
    this.stance = {
      pos: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      phase: 0,
      stride: 0,
      sit: 0,
      carry: false,
    };

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

  /**
   * Show a new look. `scale` is the maker's height+width body; pass it every
   * time, because switching body from Tall to Short must swap the actual rig.
   */
  setLook(palette, style, scale) {
    this.skater.rebuild(palette, style, scale);
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.t += dt;
      this.turntable.rotation.y = this.t * TURN_RATE;
      // Re-pose every frame: the Skater eases its springs, so a still rider
      // needs the steady-state call or it never settles into standing.
      this.skater.poseWalk(this.stance, dt);
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

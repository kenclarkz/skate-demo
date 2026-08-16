// Open World runtime: spot discovery, the minimap + fast travel, and ghost
// traffic. The city's geometry and street layout live in cityLayout.js — this
// module is the part that *runs* while the player is riding around, and it is
// only active while the current park is the city.
import * as THREE from '../game/three.js';
import {
  CITY_SPOTS,
  CITY_ROUTES,
  blockRect,
  districtOf,
  CITY_HALF,
} from './cityLayout.js';

// Combo points a spot challenge's "target" must clear before the challenge
// counts as done. The challenge lives in the save (isCitySpotDone) and the
// reward is handed out by main.js — the manager only reports the result.
export const CITY_CHALLENGE_COINS = 500;

// How many ghost cars share the two traffic loops (outer ring vs downtown).
const TRAFFIC_CARS = 6;
const TRAFFIC_SPEED = 7; // m/s
const MAP_CSS = 200; // minimap canvas, CSS px (square)
const MAP_WORLD = CITY_HALF * 2; // world metres the map covers

const CAR_COLORS = ['#c94f3a', '#e0c341', '#3a7ca5', '#8ab17d', '#6d5a94', '#d6c064'];

const DISTRICT_TINTS = {
  Downtown: 'rgba(130, 150, 180, 0.4)',
  University: 'rgba(140, 185, 150, 0.4)',
  Industrial: 'rgba(165, 160, 150, 0.4)',
  Beach: 'rgba(140, 185, 200, 0.45)',
  'Old Town': 'rgba(200, 155, 115, 0.45)',
  Hills: 'rgba(145, 155, 125, 0.45)',
  Suburbs: 'rgba(180, 170, 120, 0.4)',
};

export class CityManager {
  /**
   * @param {object} park the loaded city Park
   * @param {object} scene the THREE scene (cars parent into park.group, so they
   *   are disposed for free with the park)
   * @param {object} save the global save
   * @param {{ mapCanvas?: HTMLCanvasElement, onDiscover?: (spot) => void,
   *   onChallenge?: (spot, {newBest, done}) => void }} refs optional wiring
   */
  constructor(park, scene, save, refs = {}) {
    this.park = park;
    this.scene = scene;
    this.save = save;
    this.refs = refs;
    this.active = park.id === 'city';
    this.mapVisible = false;
    this.spots = CITY_SPOTS;
    this._cars = [];
    this._mapCtx = refs.mapCanvas ? refs.mapCanvas.getContext('2d') : null;
    this._mapBase = null;
    if (this.active) {
      this._buildTraffic();
      this._mapBase = this._drawMapBase();
    }
  }

  _routeLen(route) {
    let len = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      len += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return len;
  }

  /** World position + heading at `dist` metres along a (closed) route. */
  _pointAt(route, dist) {
    const pts = route;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const seg = Math.hypot(dx, dz);
      if (dist <= seg) {
        const t = seg === 0 ? 0 : dist / seg;
        return {
          x: a.x + dx * t,
          z: a.z + dz * t,
          a: Math.atan2(dx, dz),
        };
      }
      dist -= seg;
    }
    return { x: pts[0].x, z: pts[0].z, a: 0 };
  }

  _buildTraffic() {
    const geo = new THREE.BoxGeometry(1.8, 0.62, 4.2);
    let colorIdx = 0;
    for (let r = 0; r < CITY_ROUTES.length; r++) {
      const route = CITY_ROUTES[r];
      const len = this._routeLen(route);
      const count = r === 0 ? 4 : 2; // the ring road is busier than downtown
      for (let c = 0; c < count; c++) {
        const mat = new THREE.MeshLambertMaterial({
          color: CAR_COLORS[colorIdx++ % CAR_COLORS.length],
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        this.park.group.add(mesh);
        this._cars.push({ mesh, route, dist: ((colorIdx * len) / 6) % len });
      }
    }
  }

  _stepTraffic(dt) {
    const park = this.park;
    for (const car of this._cars) {
      const len = this._routeLen(car.route);
      car.dist = (car.dist + TRAFFIC_SPEED * dt) % len;
      const at = this._pointAt(car.route, car.dist);
      const y = park.heightAt(at.x, at.z);
      car.mesh.position.set(at.x, y + 0.32, at.z);
      car.mesh.rotation.y = at.a;
    }
  }

  // --- discovery ----------------------------------------------------------

  _checkDiscovery(ride) {
    for (const s of this.spots) {
      if (this.save.isCitySpotFound(s.id)) continue;
      const dx = ride.pos.x - s.x;
      const dz = ride.pos.z - s.z;
      if (dx * dx + dz * dz <= s.r * s.r) {
        if (this.save.recordCitySpotFound(s.id) && this.refs.onDiscover) {
          this.refs.onDiscover(s);
        }
      }
    }
  }

  _nearestSpot(pos) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /**
   * Called by main.js when a combo banks while the city is live. Returns the
   * changed-state report ({ newBest, done }) when the combo landed inside a
   * spot and changed something, or null when it did not.
   */
  noteCombo(points, pos) {
    if (!this.active) return null;
    const spot = this._nearestSpot(pos);
    if (!spot) return null;
    const dx = pos.x - spot.x;
    const dz = pos.z - spot.z;
    if (dx * dx + dz * dz > spot.r * spot.r) return null;
    const res = this.save.recordCitySpotScore(spot.id, points);
    if ((res.newBest || res.done) && this.refs.onChallenge) {
      this.refs.onChallenge(spot, res);
    }
    return res;
  }

  // --- minimap ------------------------------------------------------------

  toggleMap() {
    this.mapVisible = !this.mapVisible;
    return this.mapVisible;
  }

  isMapVisible() {
    return this.mapVisible;
  }

  /** The minimap's canvas size in CSS px (square). */
  mapSize() {
    return MAP_CSS;
  }

  /** Map-canvas pixel coordinates → world coordinates. */
  worldFromMap(px, py) {
    return {
      x: (px / MAP_CSS) * MAP_WORLD - CITY_HALF,
      z: (py / MAP_CSS) * MAP_WORLD - CITY_HALF,
    };
  }

  _drawMapBase() {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = MAP_CSS;
    c.height = MAP_CSS;
    const g = c.getContext('2d');
    const S = MAP_CSS / MAP_WORLD;
    g.fillStyle = '#20222a';
    g.fillRect(0, 0, MAP_CSS, MAP_CSS);
    // District tints: one tint per city block, read from the layout so the map
    // can never drift out of sync with the actual streets.
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 20; i++) {
        const r = blockRect(i, j);
        g.fillStyle = DISTRICT_TINTS[districtOf(i, j)] || 'rgba(255,255,255,0.12)';
        g.fillRect((r.x0 + CITY_HALF) * S, (r.z0 + CITY_HALF) * S, (r.x1 - r.x0) * S, (r.z1 - r.z0) * S);
      }
    }
    // Street gridlines.
    g.strokeStyle = 'rgba(200, 205, 215, 0.85)';
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k <= 20; k++) {
      const p = k * 50 * S;
      g.moveTo(p, 0);
      g.lineTo(p, MAP_CSS);
      g.moveTo(0, p);
      g.lineTo(MAP_CSS, p);
    }
    g.stroke();
    return c;
  }

  /** Render the live map (static base + spots + player) every frame it is open. */
  drawMap(ride) {
    if (!this.active || !this.mapVisible || !this._mapCtx || !this._mapBase) return;
    const S = MAP_CSS / MAP_WORLD;
    const g = this._mapCtx;
    g.clearRect(0, 0, MAP_CSS, MAP_CSS);
    g.drawImage(this._mapBase, 0, 0);
    for (const s of this.spots) {
      const px = (s.x + CITY_HALF) * S;
      const py = (s.z + CITY_HALF) * S;
      const found = this.save.isCitySpotFound(s.id);
      const done = this.save.isCitySpotDone(s.id);
      g.beginPath();
      g.arc(px, py, done ? 3.4 : 2.6, 0, Math.PI * 2);
      g.fillStyle = found ? (done ? '#6ee06e' : '#ffd166') : 'rgba(255,255,255,0.35)';
      g.fill();
      if (found) {
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
    const px = (ride.pos.x + CITY_HALF) * S;
    const py = (ride.pos.z + CITY_HALF) * S;
    g.save();
    g.translate(px, py);
    // yaw 0 faces +z, which is down on the map, so the heading arrow needs a
    // half turn before the rider's own rotation is applied.
    g.rotate(Math.PI + ride.yaw);
    g.fillStyle = '#ff5d5d';
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(2.6, 3);
    g.lineTo(-2.6, 3);
    g.closePath();
    g.fill();
    g.restore();
  }

  /** The discovered spot under a world coordinate, or null (for fast travel). */
  spotAtWorld(x, z, maxDist) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      if (!this.save.isCitySpotFound(s.id)) continue;
      const dx = x - s.x;
      const dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best && bestD <= maxDist ? best : null;
  }

  /**
   * Teleport the rider to a discovered spot's centre, facing +z. Returns true
   * when the jump happened.
   */
  travelTo(spotId, ride) {
    if (!this.active) return false;
    const spot = this.spots.find((s) => s.id === spotId);
    if (!spot || !this.save.isCitySpotFound(spotId)) return false;
    ride.reset({ x: spot.x, z: spot.z, yaw: 0 });
    return true;
  }

  /**
   * Per-frame driver. Returns a report of what happened this frame so main.js
   * can react (e.g. the frame a spot is first discovered).
   */
  step(dt, ride) {
    if (!this.active) return null;
    this._checkDiscovery(ride);
    this._stepTraffic(dt);
    this.drawMap(ride);
    return null;
  }
}

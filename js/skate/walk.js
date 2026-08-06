// On-foot movement, for once the rider has stepped off the board.
//
// Deliberately the simplest model in the game: no gravity, no jumping, no air
// state. Height is snapped straight to the ground every frame, because walking
// exists to get around a park and look at it, not to reproduce the board's own
// physics on two legs. Turning and moving share the same stick the board uses
// for carving — x turns, y drives forward or back — so a thumb already resting
// on the steering side needs nothing new to learn.

import * as THREE from '../game/three.js';

const WALK_SPEED = 3.4;   // m/s, top speed either forward or back
const TURN_RATE = 2.6;    // rad/s at full stick — a pivot-in-place turn, not a carve
const ACCEL = 9;          // how fast ground speed eases towards its target
const STRIDE_EASE = 9;    // how fast the walk-cycle's amplitude eases with speed
const SIT_EASE = 8;
const CYCLE_RATE = 1.9;   // radians of walk-cycle phase per metre walked

export class Walker {
  constructor(park) {
    this.park = park;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;      // current ground speed, m/s — signed, negative is backward
    this.stride = 0;     // 0..1, how much of the walk cycle to show
    this.phase = 0;       // radians, the walk cycle's own clock
    this.sit = 0;          // 0 standing, 1 seated — eased, for the pose to ease into
    this.sitting = false;  // the toggle the player controls
    // The board comes too. Stepping off does not mean leaving it behind: the
    // rider picks it up, which is why there is no walking back to a parked deck
    // and no radius on getting back on. Sitting down puts it flat on the floor
    // beside them, and `sit` is what crossfades between the two.
    this.carry = true;
  }

  /** Drop the walker at a spot, facing `yaw`, with no residual motion. */
  reset(x, z, yaw) {
    this.pos.set(x, this.park.heightAt(x, z), z);
    this.yaw = yaw;
    this.speed = 0;
    this.stride = 0;
    this.phase = 0;
    this.sit = 0;
    this.sitting = false;
    this.carry = true;
  }

  toggleSit() {
    this.sitting = !this.sitting;
  }

  /** `move` is {x, y} from Input.readMove(): x turns, y drives forward/back. */
  update(dt, move) {
    // A firm push while seated stands the player back up, rather than trapping
    // them until they find the sit button again.
    if (this.sitting && Math.hypot(move.x, move.y) > 0.6) this.sitting = false;

    if (this.sitting) {
      this.speed += (0 - this.speed) * Math.min(1, ACCEL * dt);
    } else {
      // Negative, to match the board's own steer convention (physics.js turns
      // yaw the opposite way from a positive steer input) — riding and walking
      // read the same stick, and it has to turn the same way for both.
      this.yaw += -move.x * TURN_RATE * dt;
      const target = move.y * WALK_SPEED;
      this.speed += (target - this.speed) * Math.min(1, ACCEL * dt);
    }

    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    this.pos.x += fwdX * this.speed * dt;
    this.pos.z += fwdZ * this.speed * dt;

    // Walking never leaves the park, whether it is fenced or not.
    const ex = this.park.extentX - 1;
    const ez = this.park.extentZ - 1;
    this.pos.x = Math.max(-ex, Math.min(ex, this.pos.x));
    this.pos.z = Math.max(-ez, Math.min(ez, this.pos.z));
    this.pos.y = this.park.heightAt(this.pos.x, this.pos.z);

    const moving = Math.min(1, Math.abs(this.speed) / WALK_SPEED);
    this.stride += (moving - this.stride) * Math.min(1, STRIDE_EASE * dt);
    this.phase += this.speed * CYCLE_RATE * dt;
    this.sit += ((this.sitting ? 1 : 0) - this.sit) * Math.min(1, SIT_EASE * dt);
  }
}

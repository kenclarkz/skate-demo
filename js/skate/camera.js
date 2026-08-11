// The gameplay camera: the chase camera it shipped with, plus a first-person
// lens on the rider's head and a close board-only view. All three share one
// class — one spring-set, one mode switch — because the two extra views are
// the same problem (put the lens somewhere, point it at the board) with a
// different anchor.
//
// The chase camera is close and behind, sitting a little higher than it used
// to — roughly the rider's head height now — so the rider reads head to toe
// while the board's rotation stays readable and an ollie still looks like it
// left the ground.
//
// Two rules make it feel like a camera rather than a boom arm. It follows the
// direction of *travel* rather than the direction the board is pointing, so a
// spin whips the board round in front of the lens instead of dragging the whole
// world with it. And it springs towards where it wants to be, so it always
// arrives late — which is the only reason speed is legible at all.

import * as THREE from '../game/three.js';
import * as C from './config.js';

const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
// The board's up eased back to the world: what a first-person or board-view
// lens actually rides on. Full strength on the flat, gone the moment the deck
// stops being upright, so a flip turns the board and not the horizon.
const _upv = new THREE.Vector3(0, 1, 0);

/**
 * How far ahead to aim a first-order spring so it settles *on* a target moving
 * at `v` m/s instead of trailing behind it.
 *
 * `x += (target - x) * (1 - exp(-k*dt))` never catches a moving target: it
 * settles a constant distance back, and that distance grows with speed without
 * limit. Adding this to the target cancels exactly that standing error and
 * nothing else — a sudden change still lags, which is the part that makes the
 * camera feel like a camera. The discrete form (rather than the textbook v/k)
 * matters twice over: it is right to the metre at speed, and it holds at any
 * frame rate, so the camera sits in the same place at 30fps as at 144.
 */
function springLead(v, k, dt) {
  const a = 1 - Math.exp(-k * dt);
  return a > 1e-6 ? (v * dt * (1 - a)) / a : 0;
}

export class ChaseCamera {
  constructor(camera, park) {
    this.cam = camera;
    this.park = park;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.roll = 0;
    this.dist = C.CAM_DIST;
    this.height = C.CAM_HEIGHT;
    this.ready = false;
    this.mode = C.CAMERA_CHASE;
  }

  /** Which camera is live: chase (third person), first person, or board view. */
  setMode(mode) {
    C.setCameraMode(mode);
    this.mode = C.CAMERA_MODE;
    this.ready = false;
  }

  /** Drop the camera straight onto its mark, for a respawn or the first frame. */
  snap(ride) {
    this.yaw = ride.yaw;
    this.roll = 0;
    this.ready = false;
    this.update(ride, null, 1 / 60);
  }

  update(ride, ragdoll, dt, mode = this.mode) {
    // The walking stand-in has no skater or board to attach to — if a caller
    // ever asks for first person or board view against it, fall back to the
    // chase camera rather than dereferencing nothing.
    if ((mode === C.CAMERA_FIRST || mode === C.CAMERA_BOARD) && (!ride.skater || !ride.board)) {
      mode = C.CAMERA_CHASE;
    }
    if (ride.skater) {
      // In first person the lens rides the head, so the head is the only
      // part that has to come off the rig (it would fill the lens from here) —
      // the arms, the chest and the nose of the deck stay in shot, which is
      // what makes the view read as "on a skateboard".
      // Board view takes the whole rider out of frame so the deck has the
      // shot to itself.
      ride.skater.head.visible = mode !== C.CAMERA_FIRST;
      ride.skater.group.visible = mode !== C.CAMERA_BOARD;
    }
    switch (mode) {
      case C.CAMERA_FIRST:
        this.updateFirst(ride, ragdoll, dt);
        break;
      case C.CAMERA_BOARD:
        this.updateBoard(ride, ragdoll, dt);
        break;
      default:
        this.updateChase(ride, ragdoll, dt);
        break;
    }
    this.ready = true;
  }

  /**
   * The up vector these two lens-on-the-rider cameras ride on: the board's own
   * up while it is upright, eased back to the world the moment it is not.
   *
   * Following the board's up is what tilts the view onto a transition the way
   * riding up a ramp really feels. But the deck rolls all the way round on a
   * kickflip and flips over on an air, and a camera whose up is the board's up
   * on those turns the whole world upside down. Clamping the blend weight to
   * `up.y >= 0` keeps the ramp tilt while locking the horizon the instant the
   * board stops being right-side up — the deck spins, the view does not.
   *
   * Returns the shared scratch `_upv`, so it must be used before any other
   * camera scratch is written — the callers both do.
   */
  camUp(ride, bailing) {
    _upv.set(0, 1, 0);
    if (!bailing) _upv.lerp(ride.up, C.clamp(ride.up.y, 0, 1)).normalize();
    return _upv;
  }

  /**
   * First person: the lens sits on the rider's head and looks where the board
   * is going, so every jump, trick, carve and slam happens in front of it.
   *
   * The eye is read off the posed head mesh rather than computed, which is
   * what makes it follow a ragdoll too: after a bail the head is posed in
   * world space and this reads exactly where it ended up. The head mesh
   * itself is hidden (update() decides that) so it never ends up inside the
   * near plane — but the rest of the rider stays, so the shot shows the front
   * arm and the nose of the deck the way a real first-person ride would.
   */
  updateFirst(ride, ragdoll, dt) {
    const bailing = ride.bailed && ragdoll && ragdoll.active;
    ride.skater.head.getWorldPosition(_eye);
    const upv = this.camUp(ride, bailing);

    // Look along the board's heading in the camera's own plane — the rider's
    // own facing would point over the shoulder (that is what the rider does),
    // which is not where a first-person lens should aim.
    _dir.set(Math.sin(ride.yaw), 0, Math.cos(ride.yaw));
    _dir.addScaledVector(upv, -_dir.dot(upv));
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
    _dir.normalize();

    // A touch of pitch off the vertical velocity, so a launch reads as looking
    // up its arc and a drop as looking down it. On the flat there is none.
    const pitch = bailing ? 0 : C.clamp(ride.vel.y * 0.05, -0.5, 0.5);
    // Aim down into the shot, in the camera's own plane. From eye height the
    // front arm hangs ~50° below the horizon and the nose of the deck ~65° —
    // both underneath a level lens's bottom edge — while the ground a few
    // metres ahead is only ~12° below. The base look-down is what puts the
    // front arm and the nose of the deck in the lower half of the frame with
    // the ground ahead still in the upper half, and the velocity pitch rides
    // on top of it: a launch reads as looking up its arc, a drop as looking
    // down it. Clamped so neither extreme turns the view into a stare at the
    // deck or the sky.
    const down = C.clamp(C.CAM_FIRST_DOWN - pitch, 0.2, 1.05);
    _look.copy(_eye)
      .addScaledVector(_dir, Math.cos(down) * 3)
      .addScaledVector(upv, -Math.sin(down) * 3);

    // Never under the concrete: a camera that clips through a deck is the one
    // bug nobody forgives, and a ragdoll head can easily be mid-floor.
    const floor = this.park.heightAt(_eye.x, _eye.z) + 0.3;
    if (_eye.y < floor) _eye.y = floor;

    this.cam.position.copy(_eye);
    this.cam.up.copy(upv);
    this.cam.lookAt(_look);
    this.cam.rotation.z = 0;
    this.setFov(ride, dt);
  }

  /**
   * Board view: the lens rides a fixed offset behind the board, following its
   * position exactly and looking at the deck. The target is read off the
   * board's own group, so it stays on the board through a ragdoll toss as
   * well as through a flip.
   *
   * What the lens does *not* follow is the board's rotation. Which way is
   * behind is the direction of travel rather than the board's heading, so a
   * spin whips the deck round in front of the lens instead of swinging the
   * camera around it, and the up is the eased world up — the perspective
   * stays fixed like the game that inspired it (Touch Grind), with the deck
   * doing the moving.
   */
  updateBoard(ride, ragdoll, dt) {
    const bailing = ride.bailed && ragdoll && ragdoll.active;
    ride.board.group.getWorldPosition(_want);
    this.target.copy(_want);
    _want.y += 0.05; // aim at the deck, not the wheels
    const upv = this.camUp(ride, bailing);

    // Which way is "behind": the direction of travel, so a spin turns the
    // board in front of the lens rather than rotating the camera with it.
    let want = this.yaw;
    const planar = Math.hypot(ride.vel.x, ride.vel.z);
    if (planar > 1.1) want = Math.atan2(ride.vel.x, ride.vel.z);
    // Too slow for the velocity to mean anything: sit behind the board, and
    // behind whichever end of it is leading if the rider is rolling fakie.
    else if (ride.grounded) want = ride.yaw + (ride.speed < -0.2 ? Math.PI : 0);
    const delta = C.angleDelta(this.yaw, want);
    this.yaw += delta * (this.ready ? 1 - Math.exp(-C.CAM_YAW_LAG * dt) : 1);

    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _dir.addScaledVector(upv, -_dir.dot(upv));
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
    _dir.normalize();

    // Very close and low: this is a board shot, not a chase shot — the lens
    // sits right behind the deck so the board fills the frame and the rolling
    // wheels read at the bottom of it.
    _eye.copy(this.target).addScaledVector(_dir, -0.9).addScaledVector(upv, 0.35);
    const floor = this.park.heightAt(_eye.x, _eye.z) + 0.45;
    if (_eye.y < floor) _eye.y = floor;

    this.cam.position.copy(_eye);
    this.cam.up.copy(upv);
    this.cam.lookAt(this.target);

    // No roll into the carve here: any camera roll during a trick reads as
    // the camera doing the trick, and this shot is meant to be the steady
    // hand holding the deck in frame.
    this.setFov(ride, dt);
  }

  /** The one piece of fov behaviour every mode shares. */
  setFov(ride, dt) {
    const t = Math.min(1, ride.groundSpeed / C.CAM_SPEED_REF);
    const fov = C.CAM_FOV + t * C.CAM_FOV_GAIN;
    if (Math.abs(this.cam.fov - fov) > 0.02) {
      this.cam.fov += (fov - this.cam.fov) * (1 - Math.exp(-2.2 * dt));
      this.cam.updateProjectionMatrix();
    }
  }

  updateChase(ride, ragdoll, dt) {
    const bailing = ride.bailed && ragdoll && ragdoll.active;

    // --- where to look ----------------------------------------------------
    // How far ahead of the rider the aim point sits this frame. The distance
    // spring below subtracts it back off, so remember it rather than throwing
    // it away.
    let aimAhead = 0;
    if (bailing) {
      ragdoll.centre(_look);
      _look.y += 0.35;
    } else {
      _look.copy(ride.pos);
      _look.y += C.CAM_LOOK_H;
      // A little lookahead, along the ground only. Taking the vertical part of the
      // velocity too was tried and is wrong: on a ramp it lifts the aim by the
      // same amount it lifts the camera, and the skater slides off the bottom of
      // the frame. Seeing further up a transition is the *camera's* job, and the
      // tilt term below is what does it.
      const planarV = Math.hypot(ride.vel.x, ride.vel.z);
      if (planarV > 0.5) {
        aimAhead = Math.min(1.0, planarV * 0.12);
        const k = aimAhead / planarV;
        _look.x += ride.vel.x * k;
        _look.z += ride.vel.z * k;
      }
    }
    const lag = bailing ? 3.4 : C.CAM_LAG;
    // Cancel this spring's standing error. Left alone it sat ~4.7m back at a
    // 16 m/s push, and the position spring below added the same again — 12m of
    // camera-to-rider where the distance term asked for 4, which is what made
    // the rider shrink into the distance on a long push. Planar only, for the
    // same reason the lookahead above is planar.
    if (!bailing) {
      _look.x += springLead(ride.vel.x, lag, dt);
      _look.z += springLead(ride.vel.z, lag, dt);
    }
    this.target.lerp(_look, this.ready ? 1 - Math.exp(-lag * dt) : 1);

    // --- which way to sit -------------------------------------------------
    // The direction of travel, not the board's heading: on a 180 the board turns
    // and the camera does not, which is exactly what makes the trick visible.
    let want = this.yaw;
    const v = ride.vel;
    const planar = Math.hypot(v.x, v.z);
    if (planar > 1.1) want = Math.atan2(v.x, v.z);
    // Too slow for the velocity to mean anything: sit behind the board, and
    // behind whichever end of it is leading if the rider is rolling fakie.
    else if (ride.grounded) want = ride.yaw + (ride.speed < -0.2 ? Math.PI : 0);
    // Shortest way round, so passing through south does not spin the world.
    const delta = C.angleDelta(this.yaw, want);
    this.yaw += delta * (this.ready ? 1 - Math.exp(-C.CAM_YAW_LAG * dt) : 1);

    // --- how far back -----------------------------------------------------
    const air = Math.max(0, ride.airHeight);
    // On a transition the board is tipped back towards the coping, and a camera
    // that stays at hip height ends up staring at the ramp. Lifting with the
    // tilt is what lets you see over the lip on the way up to it.
    const tilt = Math.max(0, 1 - ride.up.y);
    // A phone turned on its side keeps the same vertical field of view but
    // has far fewer vertical pixels to show it in, so the rider reads
    // smaller — visually farther away — purely from the aspect change, with
    // nothing in the 3D scene actually different. Pulling the camera in once
    // the frame gets meaningfully wider than the window this was tuned in
    // compensates, without touching anything at a normal-ish aspect.
    const aspect = this.cam.aspect || 1;
    const aspectZoom = aspect <= 1.65 ? 1 : C.clamp(1 - (aspect - 1.65) * 0.45, 0.68, 1);
    // The player's own camera-distance setting multiplies in on top of the
    // aspect correction rather than replacing it — a phone in landscape and
    // a "really close" setting both want to pull the camera in, and either
    // reason on its own already floors out sensibly.
    const zoom = aspectZoom * C.CAM_ZOOM;
    // Lift and back off with height, not with ground speed — a big air still
    // needs the extra room so the whole arc stays in frame, but a push down
    // the flat should not be the thing that shoves the camera away from the
    // rider. (It used to: an old speed * 0.085 term here meant topping out a
    // push could nearly double the distance on its own.)
    //
    // The `+ aimAhead` is the other half of holding the distance still. `dist` is
    // measured back from the *aim point*, and that point leads the rider by up to
    // a metre at speed — so the rider sits between the lens and the aim, and
    // camera-to-rider is dist *minus* the lead. Adding the lead back here is what
    // makes camera-to-*rider* land on CAM_DIST at every speed, while the aim
    // itself still leads and keeps the framing intent intact.
    const wantDist = Math.max(0.8,
      (C.CAM_DIST + air * 0.16 + tilt * 0.9 + (bailing ? 0.5 : 0)) * zoom + aimAhead);
    const wantHeight = (C.CAM_HEIGHT + air * 0.30 + tilt * 1.9 + (bailing ? 0.5 : 0)) * zoom;
    this.dist += (wantDist - this.dist) * (1 - Math.exp(-2.4 * dt));
    this.height += (wantHeight - this.height) * (1 - Math.exp(-3.0 * dt));

    _dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _want.copy(this.target).addScaledVector(_dir, -this.dist);
    _want.y = this.target.y + this.height - C.CAM_LOOK_H + 0.28;

    // The same cancellation for the position spring at the bottom of this
    // function, which otherwise keeps a second helping of droop all of its own.
    if (!bailing) {
      _want.x += springLead(ride.vel.x, C.CAM_LAG, dt);
      _want.z += springLead(ride.vel.z, C.CAM_LAG, dt);
    }

    // Never inside the concrete: a camera that clips through a quarterpipe deck
    // is the one bug in a chase camera nobody forgives.
    const floor = this.park.heightAt(_want.x, _want.z) + 0.45;
    if (_want.y < floor) _want.y = floor;

    this.pos.lerp(_want, this.ready ? 1 - Math.exp(-C.CAM_LAG * dt) : 1);
    this.cam.position.copy(this.pos);
    this.cam.up.copy(_up);
    this.cam.lookAt(this.target);

    // A little roll into the carve. Small on purpose — enough to feel the lean,
    // not enough to make anyone seasick.
    const wantRoll = bailing ? 0 : -ride.lean * 0.16;
    this.roll += (wantRoll - this.roll) * (1 - Math.exp(-5 * dt));
    this.cam.rotateZ(this.roll);

    // Field of view used to carry the speed the position spring cannot, but a
    // wider lens shrinks the rider on screen just as surely as moving the camera
    // back does — the eye cannot tell the two apart. With CAM_FOV_GAIN at 0 this
    // holds still; raise it there if the speed rush is ever wanted back.
    this.setFov(ride, dt);
  }
}

// A character's card portrait: a front-on view of the rider, drawn as flat
// rectangles in 2D.
//
// Not a screenshot and not a WebGL scene. The rig is boxes already, so a front
// elevation of it *is* the character — and drawing it on a 2D canvas costs no
// GL context, which matters when there are four of these on screen at once and
// the tutorial is already holding a context of its own. Every rectangle is
// placed in the rig's own metres, from the same config constants the 3D figure
// is built and posed from, so a proportion can never drift between the card and
// the skater it is advertising.

import * as C from './config.js';

const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;

/**
 * Heights, in metres up from the soles, of everything the portrait needs. Read
 * straight off the same constants skater.js measures with.
 */
function levels() {
  const ankle = C.FOOT_H;
  const knee = ankle + C.SHIN;
  const hip = ankle + C.SHIN + C.THIGH;
  const chest = hip + C.SPINE;
  return {
    ankle,
    knee,
    hip,
    chest,
    shoulder: chest + C.SHOULDER_UP,
    head: chest + C.NECK,
    top: chest + C.NECK + 0.22, // crown, with room for the tallest headwear
  };
}

/**
 * Draw `character` front-on, filling `canvas`.
 *
 * Rectangles go down the page in back-to-front order: legs, torso, arms, then
 * the head and whatever is on it.
 */
export function drawPortrait(canvas, character) {
  const cssW = canvas.clientWidth || 96;
  const cssH = canvas.clientHeight || 132;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const p = character.palette;
  const style = character.style || {};
  const L = levels();

  // One scale for both axes, so nothing is stretched: fit the full figure
  // height into the canvas with a little air top and bottom.
  const pad = h * 0.06;
  const scale = (h - pad * 2) / L.top;
  const midX = w / 2;
  const floorY = h - pad;

  // World metres -> canvas pixels. `bx` is a centred box: x is its middle.
  const rect = (colour, cx, yBottom, bw, bh) => {
    ctx.fillStyle = hex(colour);
    ctx.fillRect(
      Math.round(midX + cx * scale - (bw * scale) / 2),
      Math.round(floorY - (yBottom + bh) * scale),
      Math.max(1, Math.round(bw * scale)),
      Math.max(1, Math.round(bh * scale))
    );
  };

  const hipX = C.HIP_W;
  const shoulderX = C.SHOULDER_W;

  // --- legs: shins, thighs, shoes -----------------------------------------
  for (const side of [-1, 1]) {
    rect(p.pantsDark, side * hipX, L.ankle, 0.125, C.SHIN);
    rect(p.pants, side * hipX, L.knee, 0.15, C.THIGH);
    rect(p.sole, side * hipX, 0, 0.1, 0.022);
    rect(p.shoe, side * hipX, 0.022, 0.095, 0.053);
  }

  // --- pelvis and belt ----------------------------------------------------
  rect(p.pants, 0, L.hip - 0.078, C.HIP_W * 2 + 0.1, 0.155);
  rect(p.band, 0, L.hip - 0.006, C.HIP_W * 2 + 0.105, 0.032);

  // --- torso: body block, then the shoulder yoke across the top -----------
  rect(p.shirt, 0, L.chest - C.CHEST / 2, 0.3, C.CHEST);
  rect(p.shirt, 0, L.shoulder - 0.06, shoulderX * 2, 0.12);

  // --- arms: hanging straight down from the shoulders ----------------------
  const longSleeves = style.sleeves === 'long';
  for (const side of [-1, 1]) {
    const x = side * (shoulderX + 0.02);
    rect(p.sleeve, x, L.shoulder - 0.09, 0.1, 0.12);
    rect(longSleeves ? p.sleeve : p.skin, x, L.shoulder - 0.09 - C.UPPER_ARM, 0.085, C.UPPER_ARM);
    rect(longSleeves ? p.sleeve : p.skin, x, L.shoulder - 0.09 - C.UPPER_ARM - C.FOREARM, 0.075, C.FOREARM);
    // The hand is always skin, even under a hoodie.
    rect(p.skin, x, L.shoulder - 0.11 - C.UPPER_ARM - C.FOREARM - 0.05, 0.075, 0.09);
  }

  // --- neck and head -------------------------------------------------------
  rect(p.skin, 0, L.shoulder - 0.005, 0.09, 0.11);
  rect(p.skin, 0, L.head - 0.1, 0.165, 0.2);
  rect(p.skin, 0, L.head - 0.093, 0.09, 0.04); // jaw

  // Eyes, at the same height off the head's middle as the rig puts them.
  const eyeY = L.head + 0.005;
  rect(0x1a1a1c, 0.042, eyeY, 0.026, 0.02);
  rect(0x1a1a1c, -0.042, eyeY, 0.026, 0.02);

  // --- headwear: the thing that actually tells them apart ------------------
  if (style.head === 'beanie') {
    rect(p.hair, 0, L.head + 0.075, 0.168, 0.05);
    rect(p.cap, 0, L.head + 0.043, 0.182, 0.115);
    rect(p.cap, 0, L.head + 0.029, 0.188, 0.038); // turned-up brim
  } else if (style.head === 'hair') {
    rect(p.hair, 0, L.head + 0.048, 0.175, 0.075);
    for (const side of [-1, 1]) rect(p.hair, side * 0.087, L.head - 0.125, 0.028, 0.19);
  } else if (style.head === 'helmet') {
    rect(p.cap, 0, L.head + 0.033, 0.19, 0.125);
    rect(p.cap, 0, L.head + 0.023, 0.196, 0.03); // front lip
    for (const side of [-1, 1]) rect(p.band, side * 0.083, L.head - 0.11, 0.026, 0.14);
  } else {
    rect(p.hair, 0, L.head + 0.05, 0.17, 0.06);
    rect(p.cap, 0, L.head + 0.078, 0.176, 0.075);
    rect(p.cap, 0, L.head + 0.077, 0.176, 0.022); // peak, seen edge-on from the front
  }
}

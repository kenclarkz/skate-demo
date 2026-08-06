// A 2D diagram of a Flick-It gesture: the exact route a thumb (or a mouse, or
// a stick) has to trace to produce one particular trick, drawn from the same
// two numbers classify() itself reads — an angle and a curl — so this can
// never show a gesture the recogniser would not actually accept.
//
// The route is always the same three-part shape the real gesture is: pull
// straight down to load the legs, curl sideways if the trick wants a scoop,
// then flick out toward the trick's own direction. A static dim line traces
// the whole route so it can be read at a glance; a bright comet loops along
// it so the motion — not just the shape — is what a glance actually catches.

/** The three (or two, with no curl) waypoints of one gesture's route. */
function pathFor(gesture, w, h) {
  const start = { x: w / 2, y: h * 0.12 };
  const pull = { x: start.x, y: h * 0.5 };
  const mag = Math.abs(gesture.curl);
  const curlLen = mag <= 0 ? 0 : mag >= 1.35 ? w * 0.3 : w * 0.17;
  const rad = (gesture.angle * Math.PI) / 180;
  const flickLen = h * 0.36;
  if (mag <= 0) {
    const end = { x: pull.x + Math.cos(rad) * flickLen, y: pull.y - Math.sin(rad) * flickLen };
    return [start, pull, end];
  }
  const curlPt = { x: pull.x + Math.sign(gesture.curl) * curlLen, y: pull.y };
  const end = { x: curlPt.x + Math.cos(rad) * flickLen, y: curlPt.y - Math.sin(rad) * flickLen };
  return [start, pull, curlPt, end];
}

function segLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point a fraction `frac` (0..1) of the way along a polyline's own length. */
function pointAlong(pts, frac) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += segLength(pts[i - 1], pts[i]);
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 1; i < pts.length; i++) {
    const len = segLength(pts[i - 1], pts[i]);
    if (target <= len || i === pts.length - 1) {
      const t = len === 0 ? 0 : target / len;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    target -= len;
  }
  return pts[pts.length - 1];
}

/**
 * Draw one loop of the gesture's animation into a 2D canvas context sized
 * w×h. `t` is a free-running clock in the same seconds `dt` accumulates —
 * the loop period is baked in here so callers never have to know it.
 */
export function drawGestureDiagram(ctx, w, h, gesture, t) {
  ctx.clearRect(0, 0, w, h);
  const pts = pathFor(gesture, w, h);

  // The whole route, dim — read in one glance before the comet ever moves.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = Math.max(2, w * 0.026);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // The arrowhead at the very end: which way it finally left.
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
  const ah = Math.max(7, w * 0.09);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(ang - 0.42) * ah, end.y - Math.sin(ang - 0.42) * ah);
  ctx.lineTo(end.x - Math.cos(ang + 0.42) * ah, end.y - Math.sin(ang + 0.42) * ah);
  ctx.closePath();
  ctx.fill();

  // The start point.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(pts[0].x, pts[0].y, Math.max(3, w * 0.035), 0, Math.PI * 2);
  ctx.fill();

  // A comet loops the route once every 1.6s (a pause at the end reads as the
  // flick landing, before it resets to trace the pull again), with a short
  // glowing tail so the direction of travel is unmistakable even on a still
  // frame from a screenshot.
  const LOOP = 1.6;
  const HOLD = 0.35; // fraction of the loop spent paused at the end
  const cycle = (t % LOOP) / LOOP;
  const frac = cycle > 1 - HOLD ? 1 : cycle / (1 - HOLD);
  const tailFrac = Math.max(0, frac - 0.22);
  ctx.strokeStyle = '#ffd65a';
  ctx.lineWidth = Math.max(3, w * 0.05);
  ctx.beginPath();
  const STEPS = 10;
  for (let i = 0; i <= STEPS; i++) {
    const f = tailFrac + (frac - tailFrac) * (i / STEPS);
    const pt = pointAlong(pts, f);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
  const head = pointAlong(pts, frac);
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(head.x, head.y, Math.max(4, w * 0.06), 0, Math.PI * 2);
  ctx.fill();
}

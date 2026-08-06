// The live swipe trail: a line that follows a flick as it happens, so the
// gesture a player is making is something they can actually see on screen
// rather than something they have to trust blind. Reads straight off
// Input's own pointer tracking — nothing here decides what counts as a
// gesture, it only draws the one Input is already recording.

export class GestureTrail {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.hadContent = false;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  /**
   * Called once a frame; draws every live flick pointer plus the fading tail
   * of any that just let go. A flick is a rare, brief event next to a whole
   * run's worth of frames, so the common case — nothing to show — has to
   * cost as close to nothing as possible: no clear, no resize check, no
   * touching the canvas at all, until the one frame that actually needs to
   * erase whatever the last gesture left behind.
   */
  draw(input) {
    const now = performance.now();
    const FADE_MS = 350;
    if (input.recentTrails.length) {
      input.recentTrails = input.recentTrails.filter((r) => now - r.endedAt < FADE_MS);
    }
    let hasLive = false;
    for (const p of input.pointers.values()) {
      if (!p.left && p.path && p.path.length > 1) {
        hasLive = true;
        break;
      }
    }
    const hasFading = input.recentTrails.length > 0;
    if (!hasLive && !hasFading) {
      if (this.hadContent) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hadContent = false;
      }
      return;
    }
    this.hadContent = true;

    const ctx = this.ctx;
    if (this.canvas.width !== Math.round(window.innerWidth * this.dpr)) this.resize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const r of input.recentTrails) this.stroke(r.path, 1 - (now - r.endedAt) / FADE_MS);
    for (const p of input.pointers.values()) {
      if (p.left || !p.path || p.path.length < 2) continue;
      this.stroke(p.path, 1);
    }
  }

  /** One trail, tapered thin-and-dim at the tail to thick-and-bright at the
   * head — the part of the swipe that just happened matters more than the
   * part that happened half a second ago. */
  stroke(path, alpha) {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const n = path.length;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.beginPath();
      ctx.moveTo(path[i - 1].x, path[i - 1].y);
      ctx.lineTo(path[i].x, path[i].y);
      ctx.strokeStyle = `rgba(255, 214, 90, ${(alpha * (0.12 + 0.7 * t)).toFixed(3)})`;
      ctx.lineWidth = 2 + 7 * t;
      ctx.stroke();
    }
  }
}

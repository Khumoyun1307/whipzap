// Rope simulation for whip mode. Pure: no DOM or window references at module level, so it runs in
// Node for unit tests. Written from first principles (position-based Verlet with distance and bend
// constraints). See docs/ARCHITECTURE.md section 7.1.

export const STEP_MS = 1000 / 120;
const MAX_FRAME_MS = 100;
const CONSTRAINT_ITERATIONS = 12;
const DAMPING = 0.975; // settles a free swing in about a second so the rope does not crack on its own
const RESTITUTION = 0.4;
const UNFURL_MS = 300;
const BEND_MIN_DEG = 20;
const BEND_MAX_DEG = 140;
const DROP_GRAVITY_SCALE = 3;
// Deviation from the architecture text (0.35 * segmentLength per step^2): that value makes the rope
// fall at tens of thousands of px/s and every swing exceeds the crack threshold. 0.02 * segmentLength
// per step^2 at 120 steps/s is close to real gravity at roughly 1000 px per metre.
const GRAVITY_FACTOR = 0.02;
// Architecture text proposed 0.9 * 28 / 4 = 6.3 segment lengths per step (about 18,000 px/s at 1080p),
// which a 400 px cursor jump cannot reach through 28 constrained segments. 2.5 segment lengths per step
// (about 7,200 px/s tip speed at 1080p) is reachable by a confident wrist flick and not by slow waving.
// [ASSUMED, tune in M4]
const DEFAULT_CRACK_FACTOR = 3.5;

/**
 * @param {{x:number,y:number,segments?:number,segmentLength:number,width:number,height:number,crackFactor?:number}} opts
 */
export function createRope({ x, y, segments = 28, segmentLength, width, height, crackFactor = DEFAULT_CRACK_FACTOR }) {
  if (!(segmentLength > 0)) throw new Error('segmentLength must be positive');
  const points = [];
  for (let i = 0; i <= segments; i++) points.push({ x, y, px: x, py: y });
  return {
    n: segments,
    segLen: segmentLength,
    width,
    height,
    points,
    pinned: true,
    accumulator: 0,
    elapsed: 0,
    unfurl: 0,
    tipHistory: [0, 0, 0],
    burstAt: null,
    crackFactor,
    dropped: false,
    lastHead: { x, y },
  };
}

/**
 * Advance the rope by dtMs of wall time, in fixed 120 Hz substeps.
 * @param {object} rope
 * @param {{x:number,y:number}|null} head pinned handle position, or null to drop the rope
 * @param {number} dtMs
 */
export function stepRope(rope, head, dtMs) {
  if (head === null) rope.dropped = true;
  rope.accumulator += Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
  const steps = Math.floor(rope.accumulator / STEP_MS);
  rope.accumulator -= steps * STEP_MS;
  const from = rope.lastHead;
  for (let k = 1; k <= steps; k++) {
    // Interpolate the head across the substeps of this frame so the result does not depend on
    // how wall time is sliced into frames.
    const f = k / steps;
    const h = rope.dropped || !head ? null : { x: from.x + (head.x - from.x) * f, y: from.y + (head.y - from.y) * f };
    substep(rope, h);
  }
  if (head && !rope.dropped) rope.lastHead = { x: head.x, y: head.y };
  return steps;
}

function substep(rope, head) {
  const { points, n } = rope;
  rope.elapsed += STEP_MS;
  rope.unfurl = Math.min(1, rope.elapsed / UNFURL_MS);
  const effLen = rope.segLen * Math.max(rope.unfurl, 0.05);
  const gravity = GRAVITY_FACTOR * rope.segLen * (head ? 1 : DROP_GRAVITY_SCALE);
  const pinned = head !== null;
  const tip = points[n];
  const tipBefore = { x: tip.x, y: tip.y };

  if (pinned) {
    const h = points[0];
    h.px = h.x;
    h.py = h.y;
    h.x = head.x;
    h.y = head.y;
  }
  for (let i = pinned ? 1 : 0; i <= n; i++) {
    const p = points[i];
    const vx = (p.x - p.px) * DAMPING;
    const vy = (p.y - p.py) * DAMPING;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy + gravity;
  }

  for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
    // Bend limits and walls first, distance last, so segment lengths are exact at the end of each pass.
    for (let i = 1; i < n; i++) limitBend(points[i - 1], points[i], points[i + 1], bendLimitRad(i, n));
    if (!rope.dropped) clampWalls(rope, pinned);
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1e-6) {
        dx = 0;
        dy = 1e-3;
        dist = 1e-3;
      }
      const diff = (dist - effLen) / dist;
      if (i === 0 && pinned) {
        b.x -= dx * diff;
        b.y -= dy * diff;
      } else {
        a.x += dx * diff * 0.5;
        a.y += dy * diff * 0.5;
        b.x -= dx * diff * 0.5;
        b.y -= dy * diff * 0.5;
      }
    }
  }

  // Final exact pass from the head outward: every segment ends at exactly effLen, so the rope never
  // stretches under gravity, and corrections flow to the tip, which is what makes a whip snap.
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[i + 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 1e-6) {
      dx = 0;
      dy = 1e-3;
      dist = 1e-3;
    }
    const s = effLen / dist;
    b.x = a.x + dx * s;
    b.y = a.y + dy * s;
  }

  const moved = Math.hypot(tip.x - tipBefore.x, tip.y - tipBefore.y);
  rope.tipHistory.push(moved);
  if (rope.tipHistory.length > 3) rope.tipHistory.shift();
}

function bendLimitRad(i, n) {
  const t = n > 2 ? (i - 1) / (n - 2) : 1;
  return ((BEND_MIN_DEG + (BEND_MAX_DEG - BEND_MIN_DEG) * t) * Math.PI) / 180;
}

function limitBend(a, b, c, limit) {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  const ang = Math.atan2(cross, dot);
  if (Math.abs(ang) <= limit) return;
  const target = Math.sign(ang) * limit;
  const rot = (target - ang) * 0.5;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  c.x = b.x + v2x * cos - v2y * sin;
  c.y = b.y + v2x * sin + v2y * cos;
}

function clampWalls(rope, pinned) {
  const { points, n, width, height } = rope;
  for (let i = pinned ? 1 : 0; i <= n; i++) {
    const p = points[i];
    if (p.x < 0) {
      const vx = p.x - p.px;
      p.x = 0;
      p.px = p.x + vx * RESTITUTION;
    } else if (p.x > width) {
      const vx = p.x - p.px;
      p.x = width;
      p.px = p.x + vx * RESTITUTION;
    }
    if (p.y < 0) {
      const vy = p.y - p.py;
      p.y = 0;
      p.py = p.y + vy * RESTITUTION;
    } else if (p.y > height) {
      const vy = p.y - p.py;
      p.y = height;
      p.py = p.y + vy * RESTITUTION;
    }
  }
}

/** Tip speed in px per substep, averaged over the last 3 substeps. */
export function tipSpeed(rope) {
  const h = rope.tipHistory;
  return h.reduce((s, v) => s + v, 0) / h.length;
}

/** Tip speed above which a crack fires, in px per substep. */
export function crackThreshold(rope) {
  return rope.crackFactor * rope.segLen;
}

export function isOffscreen(rope) {
  const limit = rope.height + rope.segLen;
  return rope.points.every((p) => p.y > limit);
}

export function ropeLength(rope) {
  let total = 0;
  for (let i = 0; i < rope.n; i++) {
    total += Math.hypot(rope.points[i + 1].x - rope.points[i].x, rope.points[i + 1].y - rope.points[i].y);
  }
  return total;
}

const BURST_MS = 120;
const BURST_RADIUS = 60;

/**
 * Draw the rope on a 2D canvas context (logical pixels).
 * @param {object} rope
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawRope(rope, ctx) {
  const pts = rope.points;
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeSpline(ctx, pts, 7, 'rgba(255,255,255,0.55)');
  strokeSpline(ctx, pts, 3, '#15110c');

  // Handle at the head, aligned with the first segment.
  const head = pts[0];
  const next = pts[1];
  const angle = Math.atan2(next.y - head.y, next.x - head.x) - Math.PI / 2;
  ctx.translate(head.x, head.y);
  ctx.rotate(angle);
  roundRect(ctx, -5, -13, 10, 26, 4);
  ctx.fillStyle = '#3a2a1a';
  ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(-5, -4, 10, 4);
  ctx.restore();

  if (rope.burstAt !== null) {
    const age = rope.elapsed - rope.burstAt;
    if (age >= 0 && age < BURST_MS) {
      const tip = pts[pts.length - 1];
      const t = age / BURST_MS;
      const r = BURST_RADIUS * (0.3 + 0.7 * t);
      const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
      g.addColorStop(0, `rgba(255,255,255,${(1 - t) * 0.95})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function strokeSpline(ctx, pts, width, style) {
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

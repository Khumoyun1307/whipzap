// Strike flash for hotkey, tray, and auto cracks. Pure state + draw, testable in Node.
// Spec: docs/UX.md section 6.1, docs/ARCHITECTURE.md section 7.2 and 7.3.

export const STRIKE_MS = 600;
export const REDUCED_MS = 200;
const DRAW_MS = 180;
const BURST_MS = 160;
const BURST_RADIUS = 90;
const WIDTH_START = 14;
const WIDTH_END = 3;
const VIGNETTE_IN = 120;
const VIGNETTE_OUT = 300;

/** Small seeded PRNG (mulberry32), duplicated here because the overlay cannot import from src/main. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{seed:number,width:number,height:number,reduceMotion?:boolean}} opts
 */
export function createStrike({ seed, width, height, reduceMotion = false }) {
  const rng = mulberry32(Number.isFinite(seed) ? seed : 0);
  const angleDeg = 25 + rng() * 40;
  const direction = rng() < 0.5 ? 'tlbr' : 'trbl';
  const a = (angleDeg * Math.PI) / 180;
  const dx = direction === 'tlbr' ? Math.cos(a) : -Math.cos(a);
  const dy = Math.sin(a);
  const cx = width / 2;
  const cy = height / 2;
  const t = Math.min(cx / Math.abs(dx), cy / Math.abs(dy));
  return {
    seed,
    width,
    height,
    reduceMotion,
    angleDeg,
    direction,
    start: { x: cx - dx * t, y: cy - dy * t },
    end: { x: cx + dx * t, y: cy + dy * t },
    t: 0,
    duration: reduceMotion ? REDUCED_MS : STRIKE_MS,
    active: true,
  };
}

/** Advance by dtMs. Returns true while the strike is still animating. */
export function stepStrike(state, dtMs) {
  state.t += Math.max(0, dtMs);
  state.active = state.t < state.duration;
  return state.active;
}

/**
 * @param {object} state
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawStrike(state, ctx) {
  if (!state.active) return;
  const { t, width, height } = state;
  if (state.reduceMotion) {
    const alpha = 0.12 * Math.sin(Math.PI * Math.min(1, t / REDUCED_MS));
    ctx.save();
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(4)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }

  // Edge vignette pulse: 120 ms in, 300 ms out.
  if (t < VIGNETTE_IN + VIGNETTE_OUT) {
    const v = t < VIGNETTE_IN ? t / VIGNETTE_IN : 1 - (t - VIGNETTE_IN) / VIGNETTE_OUT;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${(0.25 * v).toFixed(4)})`;
    ctx.lineWidth = 12;
    ctx.shadowColor = 'rgba(255,255,255,0.6)';
    ctx.shadowBlur = 24;
    ctx.strokeRect(6, 6, width - 12, height - 12);
    ctx.restore();
  }

  // Lash: progressive tapered stroke over 180 ms, then fade until 600 ms.
  const progress = Math.min(1, t / DRAW_MS);
  const lineAlpha = t <= DRAW_MS ? 1 : Math.max(0, 1 - (t - DRAW_MS) / (STRIKE_MS - DRAW_MS));
  if (lineAlpha > 0 && progress > 0) {
    const segments = 40;
    const drawn = Math.max(1, Math.round(segments * progress));
    ctx.save();
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < drawn; i++) {
        const s0 = i / segments;
        const s1 = (i + 1) / segments;
        const w = WIDTH_START + (WIDTH_END - WIDTH_START) * s1;
        ctx.beginPath();
        ctx.moveTo(lerp(state.start.x, state.end.x, s0), lerp(state.start.y, state.end.y, s0));
        ctx.lineTo(lerp(state.start.x, state.end.x, s1), lerp(state.start.y, state.end.y, s1));
        if (pass === 0) {
          ctx.lineWidth = w + 6;
          ctx.strokeStyle = `rgba(0,0,0,${(0.4 * lineAlpha).toFixed(4)})`;
        } else {
          ctx.lineWidth = w;
          ctx.strokeStyle = `rgba(255,255,255,${lineAlpha.toFixed(4)})`;
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Radial burst at the far edge from 180 ms for 160 ms.
  if (t >= DRAW_MS && t < DRAW_MS + BURST_MS) {
    const b = (t - DRAW_MS) / BURST_MS;
    const r = BURST_RADIUS * (0.4 + 0.6 * b);
    const g = ctx.createRadialGradient(state.end.x, state.end.y, 0, state.end.x, state.end.y, r);
    g.addColorStop(0, `rgba(255,255,255,${((1 - b) * 0.95).toFixed(4)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(state.end.x, state.end.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

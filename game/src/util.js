// Small math and formatting helpers shared by the whole game.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp01((v - a) / (b - a)));
export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const approach = (a, b, step) => (a < b ? Math.min(a + step, b) : Math.max(a - step, b));

export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleLerp = (a, b, t) => a + wrapAngle(b - a) * clamp01(t);
export const angleDamp = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const headingTo = (dx, dz) => Math.atan2(dx, dz);

// Deterministic PRNG so a seed always builds the same city.
export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const money = (n) =>
  '$' + Math.max(0, Math.round(n)).toLocaleString('en-US');

export const clockString = (hours) => {
  const h24 = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  const ap = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
};

export const roman = (n) => ['0', 'I', 'II', 'III', 'IV', 'V'][n] || String(n);

// Distance from point to axis-aligned rectangle (0 when inside).
export function pointRectDist(px, pz, r) {
  const dx = Math.max(r.minX - px, 0, px - r.maxX);
  const dz = Math.max(r.minZ - pz, 0, pz - r.maxZ);
  return Math.hypot(dx, dz);
}

// Does segment a->b hit the rectangle (slab test)?
export function segmentRect(ax, az, bx, bz, r) {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis === 0 ? ax : az;
    const d = axis === 0 ? dx : dz;
    const lo = axis === 0 ? r.minX : r.minZ;
    const hi = axis === 0 ? r.maxX : r.maxZ;
    if (Math.abs(d) < 1e-6) {
      if (p < lo || p > hi) return false;
    } else {
      let tn = (lo - p) / d;
      let tf = (hi - p) / d;
      if (tn > tf) [tn, tf] = [tf, tn];
      t0 = Math.max(t0, tn);
      t1 = Math.min(t1, tf);
      if (t0 > t1) return false;
    }
  }
  return true;
}

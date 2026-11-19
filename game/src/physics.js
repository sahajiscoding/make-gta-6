// Cheap 2D collision helpers: everything in Solara Bay moves on a flat plane, so
// circles against axis-aligned boxes cover the buildings, props and other cars.
import { clamp, segmentRect } from './util.js';

// Push a circle out of every collider it overlaps. Returns the number of hits.
export function collideCity(px, pz, radius, colliders, out) {
  let hits = 0;
  let nx = 0;
  let nz = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (px < c.minX - radius || px > c.maxX + radius) continue;
    if (pz < c.minZ - radius || pz > c.maxZ + radius) continue;
    const cx = clamp(px, c.minX, c.maxX);
    const cz = clamp(pz, c.minZ, c.maxZ);
    let dx = px - cx;
    let dz = pz - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-4) {
      // Deep inside: escape along the nearest face.
      const left = px - c.minX;
      const right = c.maxX - px;
      const near = pz - c.minZ;
      const far = c.maxZ - pz;
      const m = Math.min(left, right, near, far);
      if (m === left) {
        dx = -1;
        dz = 0;
      } else if (m === right) {
        dx = 1;
        dz = 0;
      } else if (m === near) {
        dx = 0;
        dz = -1;
      } else {
        dx = 0;
        dz = 1;
      }
      d = 1;
    }
    const pen = radius - d;
    px += (dx / d) * pen;
    pz += (dz / d) * pen;
    nx += dx / d;
    nz += dz / d;
    hits++;
  }
  if (out) {
    out.x = px;
    out.z = pz;
    out.nx = nx;
    out.nz = nz;
    out.hits = hits;
  }
  return hits;
}

// Keep a body inside the island.
export function clampToLand(px, pz, limit, out) {
  out.x = clamp(px, -limit, limit);
  out.z = clamp(pz, -limit, limit);
  return out;
}

// Two circles: pushes `a` out of `b` (a is the mover).
export function separateCircles(ax, az, ar, bx, bz, br) {
  const dx = ax - bx;
  const dz = az - bz;
  const r = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r || d2 < 1e-6) return null;
  const d = Math.sqrt(d2);
  const pen = r - d;
  return { x: (dx / d) * pen, z: (dz / d) * pen, nx: dx / d, nz: dz / d, pen };
}

export function losBlocked(colliders, ax, az, bx, bz, minHeight = 3) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if ((c.height ?? 10) < minHeight) continue;
    if (segmentRect(ax, az, bx, bz, c)) return true;
  }
  return false;
}

// Ray from a point in a direction, stopping at the first building face.
export function rayWorld(colliders, ox, oz, dx, dz, maxDist) {
  const ex = ox + dx * maxDist;
  const ez = oz + dz * maxDist;
  let best = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    // march coarsely: sample along the ray
    for (let t = 0; t <= 1; t += 0.04) {
      const x = ox + (ex - ox) * t * (maxDist / maxDist);
      const z = oz + (ez - oz) * t;
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) {
        best = Math.min(best, maxDist * t);
        break;
      }
    }
  }
  return best;
}

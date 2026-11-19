// Gunplay: hitscan shots from the crosshair, melee, damage falloff, tracers and
// the crime reports that follow gunfire.
import * as THREE from 'three';
import { clamp, clamp01 } from './util.js';
import { rayWorld } from './physics.js';

export function createCombat(G) {
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const start = new THREE.Vector3();

  function cameraRay() {
    G.camera.getWorldDirection(camDir);
    start.copy(G.camera.position);
  }

  // Where a shot from the camera lands, ignoring bodies.
  function wallDistance(maxRange) {
    const dist = rayWorld(G.city.colliders, start.x, start.z, camDir.x, camDir.z, maxRange);
    return dist;
  }

  function pickTarget(range) {
    let best = null;
    let bestT = range;
    // pedestrians and cops
    for (const ped of G.peds.list) {
      if (!ped.alive) continue;
      const dx = ped.pos.x - start.x;
      const dy = 1.05 - start.y;
      const dz = ped.pos.z - start.z;
      const t = dx * camDir.x + dy * camDir.y + dz * camDir.z;
      if (t < 0.5 || t > bestT) continue;
      const px = start.x + camDir.x * t;
      const py = start.y + camDir.y * t;
      const pz = start.z + camDir.z * t;
      const d = Math.hypot(px - ped.pos.x, py - (ped.pos.y + 1.05), pz - ped.pos.z);
      if (d < 0.62) {
        bestT = t;
        best = { kind: 'ped', ped, t };
      }
    }
    // vehicles
    for (const v of G.vehicles.vehicles) {
      if (v.health <= 0) continue;
      const dx = v.pos.x - start.x;
      const dz = v.pos.z - start.z;
      const t = dx * camDir.x + dz * camDir.z;
      if (t < 0.8 || t > bestT) continue;
      const px = start.x + camDir.x * t;
      const pz = start.z + camDir.z * t;
      const d = Math.hypot(px - v.pos.x, pz - v.pos.z);
      if (d < v.spec.wid * 0.55) {
        bestT = t;
        best = { kind: 'vehicle', vehicle: v, t };
      }
    }
    return best;
  }

  function hitPoint(t) {
    return tmpA.copy(start).addScaledVector(camDir, t);
  }

  function shootOnce(weapon, damageScale = 1) {
    // A little spread so sustained fire sprays.
    const spread = weapon.spread ?? 0.03;
    if (spread > 0) {
      camDir.x += (Math.random() - 0.5) * spread * 2;
      camDir.y += (Math.random() - 0.5) * spread * 2;
      camDir.z += (Math.random() - 0.5) * spread * 2;
      camDir.normalize();
    }
    const range = weapon.range ?? 60;
    const wall = wallDistance(range);
    const target = pickTarget(wall);
    const endT = target ? target.t : Math.min(wall, range);
    const end = hitPoint(endT);
    const muzzle = G.player.getMuzzle();
    G.effects.tracer(muzzle.clone(), end.clone());
    G.effects.muzzle(muzzle, { x: camDir.x, z: camDir.z });

    if (target?.kind === 'ped') {
      const dmg = (weapon.damage ?? 20) * damageScale;
      G.effects.blood(end, { x: camDir.x, z: camDir.z });
      target.ped.hit(dmg, G.player);
      G.hud.hitMarker();
      G.audio.hitMarker();
    } else if (target?.kind === 'vehicle') {
      const v = target.vehicle;
      const dmg = (weapon.damage ?? 20) * damageScale * 0.8;
      v.damage(dmg);
      G.effects.sparks(end, { x: camDir.x, z: camDir.z }, 6);
      if (v.driver && v.driver !== 'player' && Math.random() < 0.3) {
        // drivers can be hit through the door
        const ped = G.peds.list.find((p) => p.pos.distanceToSquared(v.pos) < 4 && p.alive && p.vehicleRef === v);
        if (ped) ped.hit(dmg * 0.4, G.player);
      }
      G.hud.hitMarker();
    } else {
      G.effects.sparks(end, { x: camDir.x, z: camDir.z }, 3);
    }
    return true;
  }

  function melee() {
    const p = G.player;
    const f = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
    G.audio.punch();
    let hit = false;
    const cx = p.pos.x + f.x * 1.2;
    const cz = p.pos.z + f.z * 1.2;
    for (const ped of G.peds.list) {
      if (!ped.alive) continue;
      if (Math.hypot(ped.pos.x - cx, ped.pos.z - cz) < 1.5) {
        ped.hit(20 + Math.random() * 10, p);
        hit = true;
        G.effects.blood(new THREE.Vector3(ped.pos.x, 1.1, ped.pos.z), f);
      }
    }
    for (const v of G.vehicles.vehicles) {
      if (Math.hypot(v.pos.x - cx, v.pos.z - cz) < v.spec.len * 0.5) {
        v.damage(3);
        hit = true;
        G.audio.impact(0.4);
      }
    }
    if (hit) G.effects.shake(0.15);
    return hit;
  }

  return {
    playerShoot(weapon) {
      cameraRay();
      if (weapon.kind === 'melee') {
        melee();
        return;
      }
      G.audio.gunshot(weapon.kind);
      G.effects.shake(weapon.kind === 'shotgun' ? 0.5 : weapon.kind === 'smg' ? 0.12 : 0.22);
      const pellets = weapon.pellets ?? 1;
      for (let i = 0; i < pellets; i++) shootOnce(weapon, pellets > 1 ? 0.55 : 1);
      if (G.police) G.police.reportCrime('gunfire', { x: G.player.pos.x, z: G.player.pos.z });
      G.noise.emit(G.player.pos.x, G.player.pos.z, 60);
    },
    // Cops and enemies fire back at the player.
    npcShoot(shooter, accuracy = 0.45) {
      const p = G.player;
      if (!p.alive) return false;
      const dist = Math.hypot(p.pos.x - shooter.pos.x, p.pos.z - shooter.pos.z);
      G.audio.gunshot('pistol');
      const chance = clamp01(accuracy * (1 - clamp01(dist / 55)));
      if (Math.random() < chance) {
        p.applyDamage(7 + Math.random() * 6, 'cop');
        G.effects.blood(new THREE.Vector3(p.pos.x, 1.1, p.pos.z), { x: 0, z: 0 });
        return true;
      }
      G.effects.sparks(new THREE.Vector3(p.pos.x + (Math.random() - 0.5) * 3, 1, p.pos.z + (Math.random() - 0.5) * 3), { x: 0, z: 0 }, 2);
      return false;
    },
    explosionAt(x, z, radius = 8, damage = 90) {
      G.effects.explosion(new THREE.Vector3(x, 1.2, z));
      G.audio.impact(1);
      const p = G.player;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < radius) p.applyDamage(damage * (1 - d / radius), 'explosion');
      for (const ped of G.peds.list) {
        if (!ped.alive) continue;
        const dd = Math.hypot(ped.pos.x - x, ped.pos.z - z);
        if (dd < radius) ped.hit(damage * (1 - dd / radius), p);
      }
      for (const v of G.vehicles.vehicles) {
        const dd = Math.hypot(v.pos.x - x, v.pos.z - z);
        if (dd < radius * 1.2) {
          v.damage(damage * (1 - dd / (radius * 1.2)));
          v.speed += 6;
        }
      }
      if (G.police) G.police.reportCrime('explosion', { x, z });
    },
  };
}

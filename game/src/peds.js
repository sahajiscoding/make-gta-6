// The people of Solara Bay: tourists on the strip, locals in Little Habana,
// dockhands, cops on foot and everybody's reaction to gunfire.
import * as THREE from 'three';
import { RNG, TAU, clamp, clamp01, damp, angleDamp, lerp, wrapAngle } from './util.js';
import { collideCity } from './physics.js';

const SKIN = ['#c98d63', '#8d5a3b', '#5c3a26', '#e0b48c', '#a8703f', '#3f2a1e'];
const SHIRT = ['#e9e4d8', '#c0392b', '#2a6f97', '#e9c46a', '#6a8d73', '#8e54e9', '#ef7c8e', '#1d3557'];
const PANTS = ['#2f3a4a', '#1f2933', '#4a4238', '#2b2b2e', '#6b7280'];

function buildPed(seed) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: r.pick(SKIN) });
  const shirtMat = new THREE.MeshLambertMaterial({ color: r.pick(SHIRT) });
  const pantsMat = new THREE.MeshLambertMaterial({ color: r.pick(PANTS) });

  const hips = new THREE.Group();
  hips.position.y = 0.9;
  g.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.28), shirtMat);
  torso.position.y = 0.34;
  torso.castShadow = true;
  hips.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skinMat);
  head.position.y = 0.82;
  head.castShadow = true;
  hips.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.168, 10, 6, 0, TAU, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: r.pick(['#241a16', '#111114', '#6b4a2a', '#d9c9a3']) })
  );
  hair.position.y = 0.855;
  hips.add(hair);

  function limb(material, w, h, x, y) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 1.05), material);
    m.position.y = -h / 2;
    m.castShadow = true;
    pivot.add(m);
    hips.add(pivot);
    return pivot;
  }

  const armL = limb(shirtMat, 0.14, 0.46, -0.32, 0.58);
  const armR = limb(shirtMat, 0.14, 0.46, 0.32, 0.58);
  const legL = limb(pantsMat, 0.18, 0.78, -0.13, 0.0);
  const legR = limb(pantsMat, 0.18, 0.78, 0.13, 0.0);

  return { group: g, hips, torso, head, armL, armR, legL, legR, shirtMat, pantsMat };
}

export function createPeds(G) {
  const list = [];
  const rng = new RNG(90210);
  const scene = G.scene;
  const MAX_CIVILIANS = 20;

  function spawnCivilian(x, z) {
    const p = {
      kind: 'ped',
      pos: new THREE.Vector3(x, 0, z),
      heading: rng.range(0, TAU),
      vel: { x: 0, z: 0 },
      health: 60,
      alive: true,
      state: 'walk',
      stateTimer: rng.range(1, 5),
      target: null,
      speed: rng.range(1.1, 1.9),
      phase: rng.range(0, TAU),
      waving: 0,
      downTimer: 0,
      armed: false,
      accuracy: 0,
      vehicleRef: null,
      panicFrom: null,
      screamCooldown: 0,
      rig: null,
      deadTimer: 0,
    };
    p.hit = (dmg, from, opts = {}) => hit(p, dmg, from, opts);
    const rig = buildPed(Math.floor(rng.next() * 100000));
    p.rig = rig;
    scene.add(rig.group);
    rig.group.position.copy(p.pos);
    list.push(p);
    return p;
  }

  function spawnCop(x, z) {
    const p = spawnCivilian(x, z);
    p.kind = 'cop';
    p.health = 100;
    p.armed = true;
    p.accuracy = 0.35;
    p.speed = 2.4;
    p.rig.shirtMat.color.set('#2c4a7c');
    p.rig.pantsMat.color.set('#1b2432');
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.04),
      new THREE.MeshBasicMaterial({ color: '#ffd35c' })
    );
    badge.position.set(-0.12, 1.3, 0.16);
    p.rig.group.add(badge);
    return p;
  }

  // Cartel muscle used by the story missions: they hunt the player on sight.
  function spawnGang(x, z, armed = true) {
    const p = spawnCivilian(x, z);
    p.kind = 'gang';
    p.hostile = true;
    p.health = 80;
    p.armed = armed;
    p.accuracy = 0.3;
    p.speed = 2.5;
    p.rig.shirtMat.color.set(rng.chance(0.5) ? '#2b2b30' : '#5a3b2a');
    p.rig.pantsMat.color.set('#22242a');
    return p;
  }

  function removePed(p) {
    const i = list.indexOf(p);
    if (i >= 0) list.splice(i, 1);
    scene.remove(p.rig.group);
  }

  function chooseTarget(p) {
    for (let i = 0; i < 14; i++) {
      const ang = rng.range(0, TAU);
      const dist = rng.range(10, 40);
      const x = p.pos.x + Math.cos(ang) * dist;
      const z = p.pos.z + Math.sin(ang) * dist;
      if (G.city.isOnSidewalk(x, z) && G.city.isFree(x, z, 0.9)) {
        p.target = { x, z };
        return;
      }
    }
    p.target = null;
    p.state = 'idle';
    p.stateTimer = rng.range(1, 3);
  }

  function hit(p, dmg, from, opts = {}) {
    if (!p.alive) return;
    p.health -= dmg;
    p.state = p.health > 0 ? 'flee' : 'down';
    p.panicFrom = from && from.pos ? { x: from.pos.x, z: from.pos.z } : p.pos.clone();
    if (p.health <= 0) {
      p.alive = false;
      p.state = 'down';
      p.deadTimer = 0;
      p.rig.group.rotation.x = -Math.PI / 2.05;
      p.rig.group.position.y = 0.16;
      if (G.pickups && rng.chance(0.45)) {
        G.pickups.spawn('cash', p.pos.x, p.pos.z, rng.int(8, 60));
      }
      if (p.kind !== 'gang' && G.police) G.police.reportCrime(opts.silent ? 'assault' : 'kill', { x: p.pos.x, z: p.pos.z });
      if (p.kind === 'cop' && G.hud) G.hud.notify('Officer down', 0.8);
    } else if (G.police && p.kind === 'ped') {
      G.police.reportCrime('assault', { x: p.pos.x, z: p.pos.z });
    }
    p.stateTimer = 0;
  }

  function startle(x, z, radius, strength = 1) {
    for (const p of list) {
      if (!p.alive || p.kind === 'cop') continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d > radius) continue;
      p.state = 'flee';
      p.stateTimer = 0;
      p.panicFrom = { x, z };
      p.screamCooldown = rng.range(0, 0.3);
      if (strength > 0.5 && rng.chance(0.25)) {
        // terrified bystanders call the police
        if (G.police) G.police.reportCrime('call', { x: p.pos.x, z: p.pos.z });
      }
    }
  }

  function updatePed(p, dt) {
    const rig = p.rig;
    if (!p.alive) {
      p.deadTimer += dt;
      if (p.deadTimer > 45) removePed(p);
      return;
    }
    const player = G.player;
    const distToPlayer = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);

    // React to the player aiming a weapon at them.
    if (p.kind === 'ped' && player.aiming && distToPlayer < 14 && !player.inVehicle) {
      const dx = player.pos.x - p.pos.x;
      const dz = player.pos.z - p.pos.z;
      const facing = Math.abs(wrapAngle(Math.atan2(dx, dz) - player.heading)) < 0.6;
      if (facing && p.state !== 'flee') {
        p.state = 'panic';
        p.stateTimer = 1.2;
      }
    }

    p.stateTimer -= dt;
    p.screamCooldown -= dt;
    let wishX = 0;
    let wishZ = 0;
    let speed = p.speed;

    if (p.state === 'walk') {
      if (!p.target) chooseTarget(p);
      if (p.target) {
        const dx = p.target.x - p.pos.x;
        const dz = p.target.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          p.state = 'idle';
          p.stateTimer = rng.range(1.5, 5);
          p.target = null;
        } else {
          wishX = dx / d;
          wishZ = dz / d;
        }
      }
    } else if (p.state === 'idle') {
      if (p.stateTimer <= 0) {
        p.state = 'walk';
        chooseTarget(p);
      }
    } else if (p.state === 'panic') {
      if (p.stateTimer <= 0) p.state = 'idle';
      // shuffle away slowly with hands up
      if (p.panicFrom) {
        const dx = p.pos.x - p.panicFrom.x;
        const dz = p.pos.z - p.panicFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        wishX = dx / d * 0.4;
        wishZ = dz / d * 0.4;
        speed = 1.2;
      }
    } else if (p.state === 'flee') {
      speed = p.kind === 'cop' ? 2.6 : 4.6;
      if (p.panicFrom) {
        const dx = p.pos.x - p.panicFrom.x;
        const dz = p.pos.z - p.panicFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        wishX = dx / d;
        wishZ = dz / d;
      } else {
        p.state = 'idle';
      }
      if (p.stateTimer <= 0) {
        p.stateTimer = rng.range(4, 9);
        if (p.stateTimer > 4.5 && p.panicFrom) p.state = rng.chance(0.7) ? 'flee' : 'idle';
      }
      if (p.screamCooldown <= 0) {
        p.screamCooldown = rng.range(1.4, 3);
        if (G.audio) G.audio.footstep(true);
      }
    }

    // Cartel soldiers chase whoever the mission points them at.
    if (p.hostile && p.alive) {
      const dx = player.pos.x - p.pos.x;
      const dz = player.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 55) {
        if (d > 10) {
          wishX = dx / d;
          wishZ = dz / d;
          speed = 3.4;
          p.state = 'hunt';
          p.heading = angleDamp(p.heading, Math.atan2(dx, dz), 8, dt);
        } else {
          wishX = 0;
          wishZ = 0;
          p.state = 'aim';
          p.heading = angleDamp(p.heading, Math.atan2(dx, dz), 10, dt);
          p.fireTimer = (p.fireTimer ?? rng.range(0.5, 1.6)) - dt;
          if (p.fireTimer <= 0 && p.armed && !player.inVehicle) {
            p.fireTimer = rng.range(0.9, 1.8);
            if (G.combat) G.combat.npcShoot(p, 0.34);
          }
        }
      } else if (p.state === 'hunt' || p.state === 'aim') {
        p.state = 'idle';
      }
    }

    // Cops with a wanted level hunt the player.
    if (p.kind === 'cop') {
      const wanted = G.state.wanted;
      if (wanted > 0 && distToPlayer < 90) {
        const dx = player.pos.x - p.pos.x;
        const dz = player.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 9) {
          wishX = dx / d;
          wishZ = dz / d;
          speed = 3.1;
          p.state = 'hunt';
        } else {
          wishX = 0;
          wishZ = 0;
          p.state = 'aim';
          // shoot the player
          p.fireTimer = (p.fireTimer ?? rng.range(0.4, 1.4)) - dt;
          if (p.fireTimer <= 0 && !player.inVehicle) {
            p.fireTimer = rng.range(0.7, 1.5);
            if (G.combat) G.combat.npcShoot(p, 0.42);
          }
          p.heading = angleDamp(p.heading, Math.atan2(dx, dz), 10, dt);
        }
        if (p.state === 'hunt') p.heading = angleDamp(p.heading, Math.atan2(dx, dz), 8, dt);
      } else if (p.state === 'hunt' || p.state === 'aim') {
        p.state = 'walk';
      }
    }

    // move
    const len = Math.hypot(wishX, wishZ);
    if (len > 0.01) {
      wishX /= len;
      wishZ /= len;
      p.vel.x = damp(p.vel.x, wishX * speed, 9, dt);
      p.vel.z = damp(p.vel.z, wishZ * speed, 9, dt);
      if (p.state === 'walk' || p.state === 'hunt' || p.state === 'flee') {
        p.heading = angleDamp(p.heading, Math.atan2(p.vel.x, p.vel.z), 7, dt);
      }
    } else {
      p.vel.x = damp(p.vel.x, 0, 12, dt);
      p.vel.z = damp(p.vel.z, 0, 12, dt);
    }
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;

    const res = { x: 0, z: 0, nx: 0, nz: 0, hits: 0 };
    const hits = collideCity(p.pos.x, p.pos.z, 0.36, G.city.colliders, res);
    if (hits > 0) {
      p.pos.x = res.x;
      p.pos.z = res.z;
      p.vel.x *= 0.4;
      p.vel.z *= 0.4;
      if (p.state === 'walk' || p.state === 'flee') p.target = null;
    }
    const lim = G.city.landHalf - 5;
    p.pos.x = clamp(p.pos.x, -lim, lim);
    p.pos.z = clamp(p.pos.z, -lim, lim);

    // stay out of the player's body
    const dxp = p.pos.x - player.pos.x;
    const dzp = p.pos.z - player.pos.z;
    const dp = Math.hypot(dxp, dzp);
    if (dp < 0.85 && dp > 0.001 && !player.inVehicle) {
      p.pos.x += (dxp / dp) * (0.85 - dp);
      p.pos.z += (dzp / dp) * (0.85 - dp);
    }

    // animation
    rig.group.position.set(p.pos.x, 0, p.pos.z);
    rig.group.rotation.y = p.heading;
    const moving = Math.hypot(p.vel.x, p.vel.z);
    p.phase += dt * (4 + moving * 2.4);
    const swing = moving > 0.4 ? Math.sin(p.phase) * clamp(0.25 + moving * 0.12, 0.2, 0.85) : 0;
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    if (p.state === 'panic') {
      rig.armL.rotation.x = -2.4;
      rig.armR.rotation.x = -2.4;
      rig.armL.rotation.z = 0.5;
      rig.armR.rotation.z = -0.5;
    } else if (p.state === 'aim') {
      rig.armR.rotation.x = -1.5;
      rig.armL.rotation.x = -1.2;
      rig.armL.rotation.z = 0.4;
    } else {
      rig.armL.rotation.x = -swing * 0.8;
      rig.armR.rotation.x = swing * 0.8;
      rig.armL.rotation.z = 0.06;
      rig.armR.rotation.z = -0.06;
    }
    rig.hips.position.y = 0.9 + Math.abs(Math.sin(p.phase)) * (moving > 0.4 ? 0.035 : 0);

    // despawn far civilians so the city keeps a steady population
    if (stats) {
      if (distToPlayer > 170 && p.kind === 'ped' && (!p.vehicleRef || p.vehicleRef.ai !== 'traffic')) removePed(p);
    }
  }

  let spawnTimer = 0;
  const stats = { spawned: 0, killed: 0 };

  function maintainPopulation(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = 0.5;
    let civilians = 0;
    for (const p of list) if (p.kind === 'ped' && p.alive) civilians++;
    if (civilians >= MAX_CIVILIANS) return;
    const pt = G.city.randomSidewalkPoint(rng, G.player.pos.x, G.player.pos.z, 110);
    if (!pt) return;
    const d = Math.hypot(pt.x - G.player.pos.x, pt.z - G.player.pos.z);
    if (d < 26) return;
    // do not pop into view
    if (G.camera && G.camera.position.distanceTo(new THREE.Vector3(pt.x, 1, pt.z)) < 16) return;
    spawnCivilian(pt.x, pt.z);
    stats.spawned++;
  }

  return {
    list,
    stats,
    spawnCivilian,
    spawnCop,
    spawnGang,
    removePed,
    startle,
    hit,
    update(dt) {
      maintainPopulation(dt);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        updatePed(p, dt);
        if (!list.includes(p)) continue;
      }
    },
    livingCops() {
      return list.filter((p) => p.kind === 'cop' && p.alive);
    },
    livingCiviliansNear(x, z, radius) {
      return list.filter((p) => p.kind === 'ped' && p.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < radius);
    },
    clear() {
      for (const p of list.slice()) removePed(p);
    },
  };
}

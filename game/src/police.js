// The PCPD: a five-star wanted system with patrol cruisers that chase and pit,
// officers who bail out and shoot, roadblocks at four stars and an air unit.
import * as THREE from 'three';
import { RNG, TAU, clamp, clamp01, damp, angleDamp, lerp, wrapAngle } from './util.js';
import { MODELS } from './vehicles.js';

const STAR_HEAT = [0, 0.9, 1.9, 2.9, 3.9, 4.9];

export function createPolice(G) {
  const rng = new RNG(1337);
  const cruisers = [];
  let heli = null;
  let spawnCooldown = 0;
  let bustedProgress = 0;
  let lastCrime = null;
  let heat = 0; // 0..5 float, drives the star count
  let escapeTimer = 0;
  let lastSeenTimer = 0;

  function wantedLevel() {
    if (heat <= 0.05) return 0;
    return clamp(Math.ceil(heat), 1, 5);
  }

  function reportCrime(kind, pos) {
    const player = G.player;
    if (!player.alive) return;
    const table = { gunfire: 0.35, assault: 0.9, kill: 1.7, explosion: 2.2, carjack: 0.7, hit: 0.5, call: 0.5, ram: 0.4 };
    let amount = table[kind] ?? 0.4;
    const before = wantedLevel();
    // repeated petty crimes do not stack forever
    if (kind === 'gunfire' && heat > 1) amount *= 0.4;
    if (kind === 'call' && heat > 1.4) amount = 0;
    heat = clamp(heat + amount, 0, 5);
    escapeTimer = 0;
    lastCrime = { kind, pos, t: G.worldTime };
    const after = wantedLevel();
    if (after > before) {
      G.audio.wanted();
      if (G.hud) G.hud.wantedUp(after);
      if (after >= 3 && !heli) spawnHeli();
    }
    if (G.hud) G.hud.setWanted(after);
  }

  function clearWanted() {
    heat = 0;
    escapeTimer = 0;
    if (G.hud) G.hud.setWanted(0);
    for (const c of cruisers.slice()) despawnCruiser(c);
    despawnHeli();
  }

  // ------------------------------------------------------------- cruisers
  function spawnCruiser() {
    const p = G.player;
    // find a road node 90-160 m away so cars arrive from off screen
    let best = null;
    for (let i = 0; i < 24; i++) {
      const i2 = rng.int(0, G.city.roads.xs.length - 1);
      const j2 = rng.int(0, G.city.roads.zs.length - 1);
      const n = G.city.nodeAt(i2, j2);
      const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      if (d > 85 && d < 175) {
        best = n;
        break;
      }
    }
    if (!best) return null;
    const heading = Math.atan2(p.pos.x - best.x, p.pos.z - best.z);
    const car = G.vehicles.spawnVehicle(wantedLevel() >= 4 && rng.chance(0.35) ? 'fbi' : 'police', {
      x: best.x + rng.range(-4, 4),
      z: best.z + rng.range(-4, 4),
      heading,
      ai: 'police',
      role: wantedLevel() >= 4 && rng.chance(0.35) ? 'fbi' : 'police',
    });
    car.health = 100;
    const entry = { car, cops: [], bailAt: 14, shootTimer: 0, stuck: 0 };
    cruisers.push(entry);
    // two officers inside
    for (let i = 0; i < 2; i++) {
      const cop = G.peds.spawnCop(car.pos.x, car.pos.z);
      cop.vehicleRef = car;
      cop.inCar = true;
      cop.rig.group.visible = false;
      entry.cops.push(cop);
    }
    return entry;
  }

  function despawnCruiser(entry) {
    const i = cruisers.indexOf(entry);
    if (i >= 0) cruisers.splice(i, 1);
    for (const cop of entry.cops) {
      if (cop.alive) G.peds.removePed(cop);
    }
    G.vehicles.remove(entry.car);
  }

  function bailOut(entry) {
    const car = entry.car;
    for (const cop of entry.cops) {
      if (!cop.alive) continue;
      cop.inCar = false;
      cop.vehicleRef = null;
      const side = rng.chance(0.5) ? 1 : -1;
      const rx = Math.cos(car.heading) * side * 1.7;
      const rz = -Math.sin(car.heading) * side * 1.7;
      cop.pos.set(car.pos.x + rx, 0, car.pos.z + rz);
      cop.rig.group.visible = true;
      cop.state = 'hunt';
      cop.health = 100;
      if (G.peds) G.peds.list.includes(cop) || G.peds.list.push(cop);
    }
    car.ai = 'abandoned';
    car.driver = null;
    car.speed *= 0.3;
  }

  function driveCruiser(entry, dt) {
    const car = entry.car;
    if (car.ai !== 'police') return;
    const p = G.player;
    const dx = p.pos.x - car.pos.x;
    const dz = p.pos.z - car.pos.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const diff = wrapAngle(desired - car.heading);
    const steer = clamp(diff * 2.2, -1, 1);

    // unstick: reverse if we have barely moved while trying to drive
    const speedAbs = Math.abs(car.speed);
    if (speedAbs < 1.2 && dist > 20) entry.stuck += dt;
    else entry.stuck = Math.max(0, entry.stuck - dt * 0.5);
    const reverse = entry.stuck > 1.1;

    const throttle = reverse ? 0 : dist > 16 ? 1 : clamp01(dist / 22);
    const brake = reverse ? 0 : dist < 9 ? 1 : 0;
    car.update(
      dt,
      {
        throttle: reverse ? 0 : throttle,
        brake: reverse ? 1 : brake,
        steer: reverse ? -steer : steer,
        handbrake: dist < 6 && speedAbs > 12,
      },
      { onSmoke: (v) => G.effects.smoke(v.pos, 1.2, true), onFire: (v) => G.effects.fire(v) }
    );

    // push the player's car on contact
    if (p.inVehicle && dist < 4.2) {
      const other = p.inVehicle;
      const push = car.speed * 0.25;
      other.speed += push * dt * 4;
      other.drift += (Math.random() - 0.5) * 2;
      if (Math.abs(car.speed) > 14 && Math.random() < 0.3) reportCrime('ram', p.pos);
    }

    if (dist < entry.bailAt) bailOut(entry);
    if (car.health <= 0) {
      if (car.fire > 1.2) {
        G.combat?.explosionAt(car.pos.x, car.pos.z, 7, 70);
        despawnCruiser(entry);
      }
    }
  }

  // ------------------------------------------------------------- helicopter
  function spawnHeli() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#26303d', roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 4.6), bodyMat);
    body.position.y = 0;
    g.add(body);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), bodyMat);
    nose.position.set(0, 0.2, 2.3);
    nose.scale.set(1, 0.9, 1.3);
    g.add(nose);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.6), bodyMat);
    tail.position.set(0, 0.3, -3.6);
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.9), bodyMat);
    fin.position.set(0, 1.1, -5.2);
    g.add(fin);
    const skidMat = new THREE.MeshLambertMaterial({ color: '#14181e' });
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 3.4), skidMat);
      skid.position.set(s * 1.1, -1.2, 0);
      g.add(skid);
    }
    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(11, 0.06, 0.4),
      new THREE.MeshLambertMaterial({ color: '#1b222a', transparent: true, opacity: 0.85 })
    );
    rotor.position.y = 1.15;
    g.add(rotor);
    const rotor2 = rotor.clone();
    rotor2.rotation.y = Math.PI / 2;
    g.add(rotor2);
    const tailRotor = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 2.2, 0.16),
      new THREE.MeshLambertMaterial({ color: '#1b222a' })
    );
    tailRotor.position.set(0, 1.1, -5.2);
    g.add(tailRotor);
    const light = new THREE.PointLight(0xfff2cf, 2.4, 90, 2);
    light.position.set(0, -1.4, 1);
    g.add(light);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ff3b30' })
    );
    beacon.position.set(0, -0.9, 3.1);
    g.add(beacon);
    g.position.set(G.player.pos.x + 30, 42, G.player.pos.z + 30);
    G.scene.add(g);
    heli = { group: g, rotor, rotor2, tailRotor, light, beacon, shootTimer: 3, orbit: 0 };
  }

  function despawnHeli() {
    if (!heli) return;
    G.scene.remove(heli.group);
    heli.group.traverse((o) => o.geometry?.dispose?.());
    heli = null;
  }

  function updateHeli(dt) {
    if (!heli) return;
    const p = G.player;
    heli.orbit += dt * 0.34;
    const radius = 26;
    const tx = p.pos.x + Math.cos(heli.orbit) * radius;
    const tz = p.pos.z + Math.sin(heli.orbit) * radius;
    const ty = 30 + Math.sin(heli.orbit * 2) * 2.5;
    const g = heli.group;
    g.position.x = damp(g.position.x, tx, 1.6, dt);
    g.position.z = damp(g.position.z, tz, 1.6, dt);
    g.position.y = damp(g.position.y, ty, 1.4, dt);
    g.lookAt(p.pos.x, 1.2, p.pos.z);
    heli.rotor.rotation.y += dt * 32;
    heli.rotor2.rotation.y += dt * 32;
    heli.tailRotor.rotation.x += dt * 30;
    heli.beacon.material.color.setHex(Math.floor(g.position.x * 3) % 2 ? 0xff3b30 : 0x330b08);
    heli.light.intensity = 2.2 + Math.sin(G.worldTime * 7) * 0.35;
    if (wantedLevel() >= 5) {
      heli.shootTimer -= dt;
      if (heli.shootTimer <= 0) {
        heli.shootTimer = rng.range(1.6, 3.4);
        G.combat.npcShoot({ pos: { x: g.position.x, z: g.position.z }, heading: 0 }, 0.5);
        G.effects.sparks(new THREE.Vector3(p.pos.x + 0.6, 0.2, p.pos.z + 0.4), { x: 0, z: 0 }, 4);
      }
    }
    if (G.audio && Math.random() < dt * 2) G.audio.heli(true);
  }

  // ------------------------------------------------------------- update
  const api = {
    reportCrime,
    clearWanted,
    get heat() {
      return heat;
    },
    get wanted() {
      return wantedLevel();
    },
    setWanted(n) {
      heat = clamp(n, 0, 5);
      if (heat === 0) api.clearWanted();
      else if (G.hud) G.hud.setWanted(wantedLevel());
    },
    addHeat(n) {
      heat = clamp(heat + n, 0, 5);
      G.hud?.setWanted(wantedLevel());
    },
    // Called when the player is caught on foot: clears the stars and costs cash.
    busted() {
      api.clearWanted();
      G.player.weapons.forEach((w) => {
        if (w.kind !== 'melee') {
          w.ammo = 0;
          w.clipAmmo = 0;
        }
      });
      const fine = Math.min(G.state.money, 250);
      G.state.money -= fine;
      G.hud?.notify(`Busted — fine $${fine}`, 3);
      G.player.bustedTimer = 0;
    },
    update(dt) {
      const p = G.player;
      const level = wantedLevel();
      if (G.hud) G.hud.setWanted(level);

      // find the nearest active officer for the busted check
      let nearestCop = Infinity;
      for (const ped of G.peds.list) {
        if (ped.kind !== 'cop' || !ped.alive) continue;
        const d = Math.hypot(ped.pos.x - p.pos.x, ped.pos.z - p.pos.z);
        if (d < nearestCop) nearestCop = d;
      }

      if (level > 0) {
        // lose the cops by staying out of sight
        if (nearestCop > 55 && !heli) {
          escapeTimer += dt;
          if (escapeTimer > 9) {
            heat = Math.max(0, heat - 0.8);
            escapeTimer = 0;
            if (heat < 0.1 && G.hud) G.hud.notify('You lost the cops', 2.4);
            if (G.hud) G.hud.setWanted(wantedLevel());
          }
        } else {
          escapeTimer = 0;
        }

        // keep the pursuit staffed
        spawnCooldown -= dt;
        const wantedCount = Math.min(5, 1 + level);
        const active = cruisers.filter((c) => c.car.ai === 'police').length;
        if (spawnCooldown <= 0 && active < wantedCount) {
          spawnCooldown = Math.max(1.4, 5 - level);
          const entry = spawnCruiser();
          if (entry && level >= 4 && rng.chance(0.35)) {
            // roadblock: park a second cruiser across the road ahead
            const pAhead = { x: p.pos.x + Math.sin(p.heading) * 60, z: p.pos.z + Math.cos(p.heading) * 60 };
            const car = G.vehicles.spawnVehicle('police', {
              x: pAhead.x,
              z: pAhead.z,
              heading: p.heading + Math.PI / 2,
              ai: 'abandoned',
              role: 'police',
            });
            const cop = G.peds.spawnCop(pAhead.x + 2, pAhead.z);
            cop.state = 'hunt';
          }
        }

        // foot officers near the player
        if (nearestCop > 34 && level >= 2 && rng.chance(dt * (0.6 + level * 0.3))) {
          const ang = rng.range(0, TAU);
          const d = rng.range(26, 40);
          const x = p.pos.x + Math.cos(ang) * d;
          const z = p.pos.z + Math.sin(ang) * d;
          if (G.city.isFree(x, z, 1)) {
            const cop = G.peds.spawnCop(x, z);
            cop.state = 'hunt';
          }
        }

        // busted
        if (!p.inVehicle && p.alive && nearestCop < 2.6 && level <= 2) {
          bustedProgress += dt;
          if (bustedProgress > 2.2) {
            bustedProgress = 0;
            api.busted();
            G.onBusted?.();
          }
        } else {
          bustedProgress = Math.max(0, bustedProgress - dt * 0.6);
        }
        if (G.hud) G.hud.setBustedProgress(clamp01(bustedProgress / 2.2));
      } else {
        despawnHeli();
      }

      for (const entry of cruisers.slice()) {
        driveCruiser(entry, dt);
        const d = Math.hypot(entry.car.pos.x - p.pos.x, entry.car.pos.z - p.pos.z);
        if (d > 230 || entry.car.health <= 0) {
          if (entry.car.health <= 0) G.effects.smoke(entry.car.pos, 2, true);
          if (d > 230 || (entry.car.ai === 'abandoned' && d > 90)) despawnCruiser(entry);
        }
        // officers inside the car keep it company until they bail
        for (const cop of entry.cops) {
          if (!cop.inCar || !cop.alive) continue;
          cop.pos.set(entry.car.pos.x, 0, entry.car.pos.z);
          cop.heading = entry.car.heading;
        }
      }

      if (level >= 3 && !heli) spawnHeli();
      updateHeli(dt);
    },
    get heliActive() {
      return !!heli;
    },
    get heli() {
      return heli;
    },
  };
  return api;
}

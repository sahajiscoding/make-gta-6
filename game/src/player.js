// Rico Salas: the player on foot and behind the wheel, plus the third-person
// camera that follows him. Movement is camera-relative, the camera never clips
// through a building, and the walk cycle is animated by hand.
import * as THREE from 'three';
import { TAU, clamp, clamp01, damp, angleDamp, angleLerp, wrapAngle, lerp } from './util.js';
import { collideCity, separateCircles } from './physics.js';

const GRAVITY = 24;
const WALK = 3.3;
const RUN = 6.1;
const SPRINT = 8.6;

function buildRig(colors) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: colors.shirt, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: colors.pants, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.9 });
  const shoe = new THREE.MeshStandardMaterial({ color: colors.shoe, roughness: 0.95 });

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  g.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirt);
  torso.position.y = 0.36;
  torso.castShadow = true;
  hips.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.32), shirt);
  chest.position.y = 0.58;
  chest.castShadow = true;
  hips.add(chest);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 8), skin);
  neck.position.y = 0.7;
  hips.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
  head.position.y = 0.86;
  head.scale.set(0.92, 1.06, 0.95);
  head.castShadow = true;
  hips.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 8, 0, TAU, 0, Math.PI / 2), hair);
  cap.position.y = 0.9;
  cap.scale.set(0.95, 0.85, 0.98);
  hips.add(cap);

  const eyes = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.03, 0.02),
    new THREE.MeshBasicMaterial({ color: '#1b1b1f' })
  );
  eyes.position.set(0, 0.875, 0.165);
  hips.add(eyes);

  function arm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.33, 0.62, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.44, 0.16), shirt);
    upper.position.y = -0.2;
    upper.castShadow = true;
    pivot.add(upper);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.14), skin);
    fore.position.y = -0.54;
    fore.castShadow = true;
    pivot.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.15), skin);
    hand.position.y = -0.74;
    pivot.add(hand);
    hips.add(pivot);
    return { pivot, hand };
  }

  function leg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.14, 0, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.46, 0.2), pants);
    thigh.position.y = -0.23;
    thigh.castShadow = true;
    pivot.add(thigh);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.18), pants);
    shin.position.y = -0.66;
    shin.castShadow = true;
    pivot.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.28), shoe);
    foot.position.set(0, -0.9, 0.05);
    foot.castShadow = true;
    pivot.add(foot);
    hips.add(pivot);
    return pivot;
  }

  const leftArm = arm(-1);
  const rightArm = arm(1);
  const leftLeg = leg(-1);
  const rightLeg = leg(1);

  return {
    group: g,
    hips,
    torso,
    head,
    arms: { left: leftArm, right: rightArm },
    legs: { left: leftLeg, right: rightLeg },
  };
}

export function createPlayer(G) {
  const city = G.city;
  const scene = G.scene;

  const rig = buildRig({
    skin: '#c98d63',
    shirt: '#2b3340', // a dark jacket: Rico reads against sunlight and neon
    pants: '#3d4a5e',
    hair: '#1d1512',
    shoe: '#17171a',
  });
  scene.add(rig.group);
  // a soft bounce light tied to Rico keeps him readable after dark
  const heroLight = new THREE.PointLight(0xffd9a8, 0.0, 7.5, 2.2);
  heroLight.position.set(0, 1.9, 0.9);
  rig.group.add(heroLight);

  const p = {
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(),
    velY: 0,
    heading: 0,
    onGround: true,
    health: 100,
    armor: 0,
    alive: true,
    inVehicle: null,
    speed: 0,
    moving: false,
    sprint: false,
    aiming: false,
    shooting: false,
    crouch: false,
    footPhase: 0,
    camYaw: 0,
    camPitch: 0.06,
    camDist: 4.4,
    camShake: 0,
    invuln: 0,
    deathTimer: 0,
    bustedTimer: 0,
    hitFlash: 0,
    lastDamageSource: null,
    weapon: 0,
    weapons: [
      { id: 'fists', name: 'Fists', ammo: Infinity, clip: Infinity, rate: 0.42, damage: 18, range: 2.2, spread: 0.1, kind: 'melee' },
      { id: 'pistol', name: 'Pistol', ammo: 34, clip: 12, clipAmmo: 12, rate: 0.26, damage: 26, range: 90, spread: 0.028, kind: 'pistol' },
      { id: 'smg', name: 'S.M.G.', ammo: 60, clip: 30, clipAmmo: 30, rate: 0.09, damage: 15, range: 65, spread: 0.05, kind: 'smg' },
      { id: 'shotgun', name: 'Shotgun', ammo: 12, clip: 6, clipAmmo: 6, rate: 0.85, damage: 12, range: 32, spread: 0.13, kind: 'shotgun', pellets: 6 },
    ],
    fireCooldown: 0,
    rig,
    cameraShakeOffset: new THREE.Vector3(),
  };

  // ------------------------------------------------------------- position api
  function teleport(x, z, heading = 0) {
    p.pos.set(x, 0, z);
    p.vel.set(0, 0, 0);
    p.velY = 0;
    p.heading = heading;
    p.camYaw = heading + Math.PI;
    p.onGround = true;
    rig.group.position.set(x, 0, z);
  }

  const spawn = city.spots.motel;
  p.pos.set(spawn.x, 0, spawn.z);
  p.camYaw = Math.PI * 0.5;
  p.heading = Math.PI * 0.5;

  // ------------------------------------------------------------- vehicles
  function tryEnterVehicle() {
    if (p.inVehicle) return exitVehicle();
    const car = G.vehicles.nearest(p.pos.x, p.pos.z, 4.6, (v) => v.health > 0);
    if (!car) return false;
    enterVehicle(car);
    return true;
  }

  function enterVehicle(car) {
    p.inVehicle = car;
    car.driver = 'player';
    car.ai = 'player';
    car.speed = Math.max(car.speed, 0);
    rig.group.visible = false;
    p.aiming = false;
    p.camDist = 7.2;
    if (G.audio) {
      G.audio.resume();
      G.audio.setStation(car.radioStation ?? 0);
      G.audio.engine(true, 0.1, 0);
    }
    if (G.onEnterVehicle) G.onEnterVehicle(car);
  }

  function exitVehicle() {
    const car = p.inVehicle;
    if (!car) return false;
    const side = car.right;
    let x = car.pos.x + side.x * (car.spec.wid * 0.5 + 1.1);
    let z = car.pos.z + side.z * (car.spec.wid * 0.5 + 1.1);
    if (!city.isFree(x, z, 0.5)) {
      const alt = { x: car.pos.x - side.x * (car.spec.wid * 0.5 + 1.4), z: car.pos.z - side.z * (car.spec.wid * 0.5 + 1.4) };
      if (city.isFree(alt.x, alt.z, 0.5)) {
        x = alt.x;
        z = alt.z;
      } else {
        x = car.pos.x;
        z = car.pos.z;
      }
    }
    teleport(x, z, car.heading);
    rig.group.visible = true;
    car.driver = null;
    car.ai = 'parked';
    car.speed *= 0.2;
    car.siren = false;
    p.inVehicle = null;
    p.camDist = 4.4;
    if (G.audio) G.audio.engine(false);
    if (G.onExitVehicle) G.onExitVehicle(car);
    return true;
  }

  // ------------------------------------------------------------- damage
  function applyDamage(amount, source = 'unknown') {
    if (!p.alive || p.invuln > 0) return;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, amount * 0.6);
      p.armor -= absorbed;
      amount -= absorbed;
    }
    p.health = Math.max(0, p.health - amount);
    p.hitFlash = Math.min(1, p.hitFlash + amount / 45);
    p.lastDamageSource = source;
    if (G.audio) G.audio.damage();
    if (G.hud) G.hud.flashDamage(source);
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      p.deathTimer = 0;
      if (G.onDeath) G.onDeath(source);
      if (G.audio) G.audio.death();
    }
  }

  function heal(n) {
    if (!p.alive) return;
    p.health = Math.min(100, p.health + n);
  }

  function giveArmor(n) {
    p.armor = Math.min(100, p.armor + n);
  }

  function respawn(kind = 'wasted') {
    const spot = kind === 'busted' ? city.spots.motel : city.spots.motel;
    p.alive = true;
    p.health = 100;
    p.armor = 0;
    p.deathTimer = 0;
    p.bustedTimer = 0;
    p.invuln = 2.5;
    teleport(spot.x + 6, spot.z + 4, Math.PI * 0.5);
    rig.group.visible = !p.inVehicle;
    if (G.onRespawn) G.onRespawn(kind);
  }

  // ------------------------------------------------------------- weapons
  function currentWeapon() {
    return p.weapons[p.weapon];
  }

  function switchWeapon(dir) {
    p.weapon = (p.weapon + dir + p.weapons.length) % p.weapons.length;
    if (G.audio) G.audio.ui();
    if (G.hud) G.hud.notify(`${currentWeapon().name}`, 0.9);
  }

  function selectWeapon(i) {
    if (i >= 0 && i < p.weapons.length) {
      p.weapon = i;
      if (G.hud) G.hud.notify(currentWeapon().name, 0.9);
    }
  }

  function reload() {
    const w = currentWeapon();
    if (w.kind === 'melee' || w.ammo === Infinity) return;
    if (w.clipAmmo >= w.clip || w.ammo <= 0) return;
    const need = w.clip - w.clipAmmo;
    const take = Math.min(need, w.ammo);
    w.clipAmmo += take;
    w.ammo -= take;
    if (G.audio) G.audio.ui(false);
  }

  function addAmmo(id, n) {
    const w = p.weapons.find((x) => x.id === id);
    if (w) w.ammo += n;
  }

  function tryShoot() {
    if (p.fireCooldown > 0 || !p.alive) return false;
    const w = currentWeapon();
    if (w.kind !== 'melee') {
      if (w.clipAmmo <= 0) {
        reload();
        return false;
      }
      w.clipAmmo--;
      p.fireCooldown = w.rate;
    } else {
      p.fireCooldown = w.rate;
    }
    if (G.combat) G.combat.playerShoot(w);
    return true;
  }

  // ------------------------------------------------------------- update
  const tmp = { x: 0, z: 0, nx: 0, nz: 0, hits: 0 };
  const input = G.input;

  function updateOnFoot(dt) {
    const sensitivity = G.settings?.sensitivity ?? 1;
    p.camYaw -= input.mouse.dx * 0.0022 * sensitivity;
    p.camPitch = clamp(p.camPitch + input.mouse.dy * 0.0018 * sensitivity, -0.65, 1.02);

    let mx = 0;
    let mz = 0;
    if (input.down('KeyW', 'ArrowUp')) mz -= 1;
    if (input.down('KeyS', 'ArrowDown')) mz += 1;
    if (input.down('KeyA', 'ArrowLeft')) mx -= 1;
    if (input.down('KeyD', 'ArrowRight')) mx += 1;

    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }

    p.aiming = input.mouse.right || G.forceAim;
    p.sprint = input.down('ShiftLeft', 'ShiftRight') && !p.aiming;
    p.crouch = input.down('KeyC');
    const speedTarget = p.aiming ? WALK * 0.72 : p.crouch ? WALK * 0.55 : p.sprint ? SPRINT : len > 0 ? RUN : 0;

    // camera-relative direction
    const sinY = Math.sin(p.camYaw);
    const cosY = Math.cos(p.camYaw);
    const wishX = mx * cosY - mz * sinY;
    const wishZ = -mx * sinY - mz * cosY;
    const wishLen = Math.hypot(wishX, wishZ);

    const accel = p.onGround ? 42 : 8;
    if (wishLen > 0.01) {
      p.vel.x = damp(p.vel.x, (wishX / wishLen) * speedTarget, accel * 0.35, dt);
      p.vel.z = damp(p.vel.z, (wishZ / wishLen) * speedTarget, accel * 0.35, dt);
    } else {
      const drag = p.onGround ? 14 : 1.2;
      p.vel.x = damp(p.vel.x, 0, drag, dt);
      p.vel.z = damp(p.vel.z, 0, drag, dt);
    }

    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;

    // jump + gravity
    if (input.hit('Space') && p.onGround) {
      p.velY = 7.4;
      p.onGround = false;
    }
    p.velY -= GRAVITY * dt;
    p.pos.y = Math.max(0, p.pos.y + p.velY * dt);
    if (p.pos.y <= 0) {
      if (!p.onGround && p.velY < -6) if (G.audio) G.audio.footstep(true);
      p.pos.y = 0;
      p.velY = 0;
      p.onGround = true;
    }

    const hits = collideCity(p.pos.x, p.pos.z, 0.42, city.colliders, tmp);
    if (hits > 0) {
      p.pos.x = tmp.x;
      p.pos.z = tmp.z;
    }
    const lim = city.landHalf - 4;
    p.pos.x = clamp(p.pos.x, -lim, lim);
    p.pos.z = clamp(p.pos.z, -lim, lim);

    // heading follows aim or movement
    const aimHeading = p.camYaw + Math.PI;
    if (p.aiming || p.shooting) p.heading = angleDamp(p.heading, aimHeading, 16, dt);
    else if (wishLen > 0.01) p.heading = angleDamp(p.heading, Math.atan2(wishX, wishZ), 12, dt);

    p.speed = Math.hypot(p.vel.x, p.vel.z);
    p.moving = p.speed > 0.4;
    if (p.moving) {
      const before = p.footPhase;
      p.footPhase += dt * (p.sprint ? 13 : p.aiming ? 6 : 9.2);
      if (Math.floor(before / Math.PI) !== Math.floor(p.footPhase / Math.PI)) {
        if (G.audio && p.onGround) G.audio.footstep(p.sprint);
      }
    }

    // got hit by a car?
    for (const v of G.vehicles.vehicles) {
      if (Math.abs(v.speed) < 3) continue;
      const sep = separateCircles(p.pos.x, p.pos.z, 0.5, v.pos.x, v.pos.z, v.spec.len * 0.34);
      if (sep) {
        p.pos.x += sep.x * 1.4;
        p.pos.z += sep.z * 1.4;
        p.vel.x += sep.nx * Math.abs(v.speed) * 0.35;
        p.vel.z += sep.nz * Math.abs(v.speed) * 0.35;
        if (Math.abs(v.speed) > 8) applyDamage(Math.min(45, Math.abs(v.speed) * 1.1), 'car');
        if (G.onPlayerHitByCar) G.onPlayerHitByCar(v);
      }
    }

    // actions
    if (input.hit('KeyF', 'Enter')) tryEnterVehicle();
    if (input.hit('KeyR')) reload();
    if (input.hit('Digit1')) selectWeapon(0);
    if (input.hit('Digit2')) selectWeapon(1);
    if (input.hit('Digit3')) selectWeapon(2);
    if (input.hit('Digit4')) selectWeapon(3);
    if (input.mouse.wheel !== 0) switchWeapon(input.mouse.wheel > 0 ? 1 : -1);
    if (input.hit('KeyQ')) switchWeapon(-1);

    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.shooting = false;
    const w = currentWeapon();
    if (input.mouse.left || G.forceShoot) {
      if (w.kind === 'melee' ? input.mouse.leftPressed || G.forceShoot : true) {
        if (tryShoot()) p.shooting = true;
      }
    }

    animateRig(dt);
    updateCamera(dt, false);
  }

  function animateRig(dt) {
    const r = rig;
    r.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    r.group.rotation.y = p.heading;

    const cycle = p.footPhase;
    const swing = p.moving ? Math.sin(cycle) * (p.sprint ? 0.95 : 0.6) : 0;
    r.legs.left.rotation.x = swing;
    r.legs.right.rotation.x = -swing;

    if (p.aiming || p.shooting) {
      r.arms.right.pivot.rotation.x = -1.45;
      r.arms.right.pivot.rotation.z = -0.14;
      r.arms.left.pivot.rotation.x = -1.15;
      r.arms.left.pivot.rotation.z = 0.5;
    } else {
      r.arms.right.pivot.rotation.x = -swing * 0.8;
      r.arms.left.pivot.rotation.x = swing * 0.8;
      r.arms.right.pivot.rotation.z = -0.08;
      r.arms.left.pivot.rotation.z = 0.08;
    }
    const bob = p.moving ? Math.abs(Math.sin(cycle)) * 0.045 : 0;
    r.hips.position.y = 0.92 + bob - (p.crouch ? 0.22 : 0);
    r.hips.rotation.x = p.sprint ? 0.12 : 0;
    r.hips.rotation.z = p.moving ? Math.sin(cycle) * 0.03 : 0;
  }

  function updateVehicle(dt) {
    const car = p.inVehicle;
    let throttle = 0;
    let brake = 0;
    if (input.down('KeyW', 'ArrowUp')) throttle = 1;
    if (input.down('KeyS', 'ArrowDown')) brake = 1;
    const steer = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
    const handbrake = input.down('Space');

    car.update(dt, { throttle, brake, steer, handbrake }, {
      onSmoke: (v) => G.effects && G.effects.smoke(v),
      onFire: (v) => G.effects && G.effects.fire(v),
    });

    if (Math.abs(car.speed) > 1) car.stolen = true;
    const f = car.forward;
    p.pos.set(car.pos.x, 0, car.pos.z);
    p.heading = car.heading;
    p.speed = Math.abs(car.speed);

    if (G.audio) {
      G.audio.engine(true, clamp01(Math.abs(car.speed) / car.spec.maxSpeed), throttle);
      G.audio.skid(Math.abs(car.drift) > 3 || (handbrake && Math.abs(car.speed) > 6), clamp01(Math.abs(car.drift) / 10));
      G.audio.siren(car.role === 'police' && G.state.wanted > 0);
    }

    if (input.hit('KeyF', 'Enter')) exitVehicle();
    if (input.hit('KeyE')) {
      const name = G.audio ? G.audio.nextStation() : '';
      car.radioStation = (car.radioStation ?? 0) + 1;
      if (G.hud) G.hud.notify(name, 1.6);
    }
    if (input.hit('KeyH')) G.audio && G.audio.horn();
    if (input.hit('KeyR')) {
      if (G.audio) G.audio.radioOff();
      if (G.hud) G.hud.notify('Radio off', 1.2);
    }
    updateCamera(dt, true);
  }

  function updateCamera(dt, inCar) {
    const cam = G.camera;
    const shakeX = (Math.random() - 0.5) * p.camShake;
    const shakeY = (Math.random() - 0.5) * p.camShake;
    p.camShake = damp(p.camShake, 0, 6, dt);

    if (inCar && p.inVehicle) {
      const car = p.inVehicle;
      const f = car.forward;
      const speedK = clamp01(Math.abs(car.speed) / car.spec.maxSpeed);
      const back = 7.4 + speedK * 1.8;
      const height = 3.0 + speedK * 0.35;
      const driftOffset = -car.drift * 0.22;
      const targetX = car.pos.x - f.x * back + car.right.x * driftOffset;
      const targetZ = car.pos.z - f.z * back + car.right.z * driftOffset;
      const targetY = height;
      const lam = Math.abs(car.speed) > 2 ? 7 : 3.4;
      cam.position.x = damp(cam.position.x, targetX, lam, dt);
      cam.position.z = damp(cam.position.z, targetZ, lam, dt);
      cam.position.y = damp(cam.position.y, targetY, 6, dt);
      cam.position.x += shakeX;
      cam.position.y += shakeY + car.speed > 0 ? 0 : 0;
      const lookX = car.pos.x + f.x * 6;
      const lookZ = car.pos.z + f.z * 6;
      const lookY = 1.6;
      if (!G.freeLook) cameraLook(cam, lookX, lookY, lookZ, dt);
      const fov = 62 + speedK * 14;
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov = damp(cam.fov, fov, 3, dt);
        cam.updateProjectionMatrix();
      }
    } else {
      const sens = G.settings?.sensitivity ?? 1;
      if (G.freeLook) {
        p.camYaw -= input.mouse.dx * 0.0022 * sens;
        p.camPitch = clamp(p.camPitch + input.mouse.dy * 0.0018 * sens, -0.65, 1.02);
      }
      const aiming = p.aiming;
      const dist = aiming ? 2.05 : 4.4;
      p.camDist = damp(p.camDist, dist, 8, dt);
      const pivotY = p.pos.y + (p.crouch ? 1.15 : 1.58);
      const yaw = p.camYaw;
      const pitch = p.camPitch;
      const dirX = Math.sin(yaw) * Math.cos(pitch);
      const dirY = Math.sin(pitch);
      const dirZ = Math.cos(yaw) * Math.cos(pitch);
      let desired = p.camDist;
      const sideOff = aiming ? 0.62 : 0.25;
      const px = p.pos.x + Math.cos(yaw) * sideOff;
      const pz = p.pos.z - Math.sin(yaw) * sideOff;
      // keep the camera out of walls
      const step = 0.35;
      for (let d = 0.4; d < desired; d += step) {
        const cx = px + dirX * d;
        const cz = pz + dirZ * d;
        let blocked = false;
        for (const c of city.colliders) {
          if (cx > c.minX - 0.3 && cx < c.maxX + 0.3 && cz > c.minZ - 0.3 && cz < c.maxZ + 0.3) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
          desired = Math.max(0.9, d - 0.25);
          break;
        }
      }
      const targetX = px + dirX * desired;
      const targetY = pivotY + dirY * desired + 0.25;
      const targetZ = pz + dirZ * desired;
      const lam = aiming ? 18 : 12;
      cam.position.x = damp(cam.position.x, targetX, lam, dt);
      cam.position.y = damp(cam.position.y, targetY, lam, dt);
      cam.position.z = damp(cam.position.z, targetZ, lam, dt);
      cam.position.x += shakeX;
      cam.position.y += shakeY;
      const lookY = pivotY + dirY * 6;
      cameraLook(cam, px + dirX * 12, lookY, pz + dirZ * 12, dt, aiming);
      const fov = aiming ? 52 : 68;
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov = damp(cam.fov, fov, 6, dt);
        cam.updateProjectionMatrix();
      }
    }
  }

  const lookTarget = new THREE.Vector3();
  let lookInit = false;
  function cameraLook(cam, x, y, z, dt, aiming = false) {
    if (!lookInit) {
      lookTarget.set(x, y, z);
      lookInit = true;
    }
    lookTarget.x = damp(lookTarget.x, x, aiming ? 24 : 16, dt);
    lookTarget.y = damp(lookTarget.y, y, aiming ? 24 : 16, dt);
    lookTarget.z = damp(lookTarget.z, z, aiming ? 24 : 16, dt);
    cam.lookAt(lookTarget);
  }

  function update(dt) {
    p.invuln = Math.max(0, p.invuln - dt);
    if (heroLight) heroLight.intensity = (G.settings.night ?? 0) * 0.85;
    p.hitFlash = damp(p.hitFlash, 0, 3, dt);

    if (!p.alive) {
      p.deathTimer += dt;
      const cam = G.camera;
      cam.position.y = damp(cam.position.y, 8.5, 1.6, dt);
      cam.lookAt(p.pos.x, 0.6, p.pos.z);
      return;
    }
    if (p.inVehicle) {
      if (p.inVehicle.health <= 0) {
        // wreck catches fire; player is thrown clear
        if (p.inVehicle.fire > 1.6) {
          exitVehicle();
          applyDamage(40, 'explosion');
        }
      }
      updateVehicle(dt);
    } else {
      updateOnFoot(dt);
    }
  }

  p.update = update;
  p.teleport = teleport;
  p.enterVehicle = enterVehicle;
  p.exitVehicle = exitVehicle;
  p.tryEnterVehicle = tryEnterVehicle;
  p.applyDamage = applyDamage;
  p.heal = heal;
  p.giveArmor = giveArmor;
  p.respawn = respawn;
  p.tryShoot = tryShoot;
  p.reload = reload;
  p.addAmmo = addAmmo;
  p.currentWeapon = currentWeapon;
  p.selectWeapon = selectWeapon;
  p.switchWeapon = switchWeapon;
  p.updateCamera = updateCamera;
  p.animateRig = animateRig;
  p.muzzleWorld = new THREE.Vector3();
  p.getMuzzle = () => {
    const w = rig.arms.right.pivot;
    w.updateWorldMatrix(true, false);
    p.muzzleWorld.set(0, -0.82, 0.12).applyMatrix4(w.matrixWorld);
    return p.muzzleWorld;
  };
  return p;
}

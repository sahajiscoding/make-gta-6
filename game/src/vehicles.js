// Cars you can steal: arcade physics with a little drift, visible damage, lights,
// sirens for the PCPD and a hand-built low-poly body for every model.
import * as THREE from 'three';
import { RNG, TAU, clamp, clamp01, damp, lerp, wrapAngle } from './util.js';
import { collideCity } from './physics.js';

export const MODELS = {
  sedan: { len: 4.5, wid: 1.9, hgt: 1.42, mass: 1, maxSpeed: 44, accel: 12.5, brake: 22, grip: 5.2, steer: 1.9, colors: ['#c9c9cc', '#3b4a63', '#8c2f39', '#20524a', '#e0d6c2', '#2f3238'] },
  sport: { len: 4.4, wid: 1.95, hgt: 1.19, mass: 0.9, maxSpeed: 58, accel: 17, brake: 26, grip: 5.8, steer: 2.1, colors: ['#e2452f', '#f5c518', '#1a9bd8', '#111418', '#eaeaea'] },
  suv: { len: 4.9, wid: 2.05, hgt: 1.78, mass: 1.25, maxSpeed: 39, accel: 10.5, brake: 19, grip: 4.6, steer: 1.7, colors: ['#4b5b52', '#2b2f33', '#7b6a55', '#9aa3a8'] },
  taxi: { len: 4.6, wid: 1.92, hgt: 1.5, mass: 1, maxSpeed: 42, accel: 12, brake: 21, grip: 5, steer: 1.9, colors: ['#f2c12e'] },
  van: { len: 5.4, wid: 2.1, hgt: 2.2, mass: 1.5, maxSpeed: 34, accel: 9, brake: 16, grip: 4.1, steer: 1.5, colors: ['#d8d8d2', '#4a6fa5', '#8a8f7a'] },
  truck: { len: 7.2, wid: 2.4, hgt: 2.9, mass: 2.2, maxSpeed: 29, accel: 7.4, brake: 13, grip: 3.6, steer: 1.25, colors: ['#b7b2a6', '#6b4a3a', '#39505f'] },
  police: { len: 4.7, wid: 1.95, hgt: 1.5, mass: 1.1, maxSpeed: 50, accel: 15, brake: 24, grip: 5.4, steer: 2, colors: ['#f2f4f7'] },
  fbi: { len: 4.8, wid: 2, hgt: 1.55, mass: 1.15, maxSpeed: 54, accel: 16.5, brake: 25, grip: 5.6, steer: 2.05, colors: ['#171a1f'] },
};

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
const wheelMat = new THREE.MeshLambertMaterial({ color: '#1b1b1e' });
const glassMat = new THREE.MeshLambertMaterial({ color: '#1c2b33', transparent: true, opacity: 0.86 });
const lightMatOn = new THREE.MeshBasicMaterial({ color: '#fff6d5' });
const tailMat = new THREE.MeshBasicMaterial({ color: '#8c1f1f' });
const tailMatOn = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
const headlightMat = new THREE.MeshBasicMaterial({ color: '#ffeec2' });

let carId = 0;

export class Vehicle {
  constructor(scene, city, modelName, color, opts = {}) {
    this.id = ++carId;
    this.type = modelName;
    this.spec = MODELS[modelName] || MODELS.sedan;
    this.city = city;
    this.scene = scene;
    this.color = color || this.spec.colors[0];
    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.heading = opts.heading || 0;
    this.speed = 0;
    this.drift = 0;
    this.steer = 0;
    this.health = 100;
    this.fire = 0;
    this.rpm = 0;
    this.braking = false;
    this.driver = null; // 'player' | ped object | null
    this.ai = opts.ai || 'parked';
    this.role = opts.role || 'civilian'; // civilian | police | fbi
    this.color2 = opts.color2 || '#111';
    this.locked = false;
    this.stolen = false;
    this.radioStation = 0;
    this.smokeTimer = 0;
    this.wheelSpin = 0;
    this.collisionCooldown = 0;
    this.mesh = this.build();
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
    scene.add(this.mesh);
  }

  build() {
    const s = this.spec;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.45, metalness: 0.25 });
    const L = s.len;
    const W = s.wid;
    const H = s.hgt;
    // Each model gets its own silhouette: a low two-door coupe, a tall boxy van,
    // a long-bed truck, a wagon-ish SUV, and the sedans in between.
    const sport = this.type === 'sport';
    const tall = this.type === 'van' || this.type === 'truck';
    const lowerH = H * (sport ? 0.46 : tall ? 0.62 : 0.52);
    const ride = sport ? 0.44 : 0.52;
    const cabH = H * (sport ? 0.3 : tall ? 0.5 : 0.42);
    const cabLen = L * (sport ? 0.38 : this.type === 'van' ? 0.68 : 0.52);
    const cabZ = -L * (sport ? 0.05 : 0.04);

    // Main hull with a slightly tapered nose.
    const hull = new THREE.Mesh(new THREE.BoxGeometry(W, lowerH, L), bodyMat);
    hull.position.y = ride + lowerH / 2;
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, lowerH * 0.6, L * 0.16), bodyMat);
    nose.position.set(0, ride + lowerH * 0.3, L * 0.46);
    g.add(nose);

    // Cabin/roof: a box plus slanted glass.
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W * (sport ? 0.8 : 0.86), cabH, cabLen), bodyMat);
    cab.position.set(0, ride + lowerH + cabH / 2 - 0.05, cabZ);
    cab.castShadow = true;
    g.add(cab);

    if (sport) {
      // rear deck and a small lip spoiler so the coupe reads at a glance
      const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, lowerH * 0.5, L * 0.2), bodyMat);
      deck.position.set(0, ride + lowerH * 1.15, -L * 0.38);
      g.add(deck);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.06, 0.3), bodyMat);
      wing.position.set(0, ride + lowerH * 1.55, -L * 0.46);
      g.add(wing);
    }
    if (this.type === 'truck') {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, lowerH * 0.9, L * 0.42), bodyMat);
      bed.position.set(0, ride + lowerH * 0.55, -L * 0.3);
      g.add(bed);
    }

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, cabH * 0.8, 0.1), glassMat);
    windshield.position.set(0, ride + lowerH + cabH * 0.46, cabZ + cabLen * 0.5);
    windshield.rotation.x = -0.32;
    g.add(windshield);

    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, cabH * 0.72, 0.1), glassMat);
    rearGlass.position.set(0, ride + lowerH + cabH * 0.46, cabZ - cabLen * 0.5);
    rearGlass.rotation.x = 0.3;
    g.add(rearGlass);

    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, cabH * 0.7, cabLen * 0.84), glassMat);
      win.position.set(side * W * 0.44, ride + lowerH + cabH * 0.48, cabZ);
      g.add(win);
    }

    // Wheels
    this.wheels = [];
    const wx = W * 0.5 + 0.02;
    const wz = L * 0.32;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * wx, 0.36, sz * wz);
        w.castShadow = true;
        g.add(w);
        this.wheels.push(w);
      }
    }

    // Lights
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headlightMat);
      hl.position.set(sx * W * 0.32, ride + 0.2, L * 0.5 + 0.01);
      g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.08), tailMat);
      tl.position.set(sx * W * 0.34, ride + 0.2, -L * 0.5 - 0.01);
      g.add(tl);
      if (!this.tailLights) this.tailLights = [];
      this.tailLights.push(tl);
    }

    if (this.role === 'police' || this.role === 'fbi') {
      const stripeMat = new THREE.MeshStandardMaterial({
        color: this.role === 'police' ? '#1f4d8f' : '#0c0d10',
        roughness: 0.6,
      });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 1.01, lowerH * 0.45, L * 0.9), stripeMat);
      stripe.position.y = ride + lowerH * 0.4;
      g.add(stripe);
      const barMat = new THREE.MeshBasicMaterial({ color: '#ff2b2b' });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.16, 0.3), barMat);
      bar.position.set(0, ride + lowerH + cabH + 0.08, cabZ);
      g.add(bar);
      this.lightBar = bar;
      const blueMat = new THREE.MeshBasicMaterial({ color: '#2233ff' });
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.16, 0.3), blueMat);
      bar2.position.set(0, ride + lowerH + cabH + 0.08, cabZ);
      bar2.scale.z = 0.55;
      bar2.position.z += 0.24;
      g.add(bar2);
      this.lightBar2 = bar2;
    }

    if (this.type === 'taxi') {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.24, 0.3),
        new THREE.MeshBasicMaterial({ color: '#ffe066' })
      );
      sign.position.set(0, ride + lowerH + cabH + 0.14, cabZ);
      g.add(sign);
    }

    // Damage smoke anchor and a bullet-hole decal group.
    this.smokeAnchor = new THREE.Object3D();
    this.smokeAnchor.position.set(0, H * 0.7, L * 0.3);
    g.add(this.smokeAnchor);

    this.bodyMats = [bodyMat];
    return g;
  }

  setColor(color) {
    this.color = color;
    this.bodyMats[0].color.set(color);
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  get right() {
    return { x: Math.cos(this.heading), z: -Math.sin(this.heading) };
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  // ctrl = { throttle 0..1, brake 0..1, steer -1..1, handbrake bool, siren bool }
  update(dt, ctrl, opts = {}) {
    const s = this.spec;
    const throttle = clamp01(ctrl.throttle || 0);
    const brake = clamp01(ctrl.brake || 0);
    const steerIn = clamp(ctrl.steer || 0, -1, 1);
    const handbrake = !!ctrl.handbrake;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    // engine / brakes
    const maxF = s.maxSpeed;
    if (throttle > 0) {
      this.speed += s.accel * throttle * dt * (this.speed < 0 ? 2 : 1);
    }
    if (brake > 0) {
      if (this.speed > 0.2) this.speed -= s.brake * brake * dt;
      else this.speed -= s.accel * 0.55 * brake * dt; // reverse
    }
    this.braking = brake > 0.05;
    // drag and rolling resistance
    const drag = 0.32 + Math.abs(this.speed) * 0.012;
    this.speed -= Math.sign(this.speed) * drag * dt * (throttle > 0 ? 0.35 : 1.4);
    if (handbrake) this.speed -= Math.sign(this.speed) * 9 * dt;
    this.speed = clamp(this.speed, -maxF * 0.35, maxF);
    if (Math.abs(this.speed) < 0.15 && throttle === 0) this.speed = 0;

    // steering: sharper at low speed, gentler at top speed
    const speedFactor = clamp01(Math.abs(this.speed) / 7);
    const highSpeedEase = lerp(1, 0.45, clamp01(Math.abs(this.speed) / maxF));
    const targetSteer = steerIn * s.steer * speedFactor * highSpeedEase;
    this.steer = damp(this.steer, targetSteer, 9, dt);
    const yawRate = this.steer * Math.sign(this.speed || 1) * (handbrake ? 1.5 : 1);
    this.heading = wrapAngle(this.heading + yawRate * dt);

    // lateral slip for a bit of drift
    const slip = handbrake ? 0.75 : 0.18;
    this.drift += yawRate * Math.abs(this.speed) * slip * dt;
    this.drift = damp(this.drift, 0, handbrake ? 1.1 : s.grip, dt);
    this.drift = clamp(this.drift, -14, 14);

    const f = this.forward;
    const r = this.right;
    const vx = f.x * this.speed + r.x * this.drift;
    const vz = f.z * this.speed + r.z * this.drift;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    // world collision (circle approximating the hull)
    const radius = s.len * 0.34;
    const res = { x: 0, z: 0, nx: 0, nz: 0, hits: 0 };
    const hits = collideCity(this.pos.x, this.pos.z, radius, this.city.colliders, res);
    if (hits > 0) {
      this.pos.x = res.x;
      this.pos.z = res.z;
      this.crash(Math.abs(this.speed) * 0.12 + 0.6, res.nx, res.nz);
    }
    const lim = this.city.landHalf - 6;
    if (this.pos.x < -lim || this.pos.x > lim || this.pos.z < -lim || this.pos.z > lim) {
      this.pos.x = clamp(this.pos.x, -lim, lim);
      this.pos.z = clamp(this.pos.z, -lim, lim);
      this.crash(Math.abs(this.speed) * 0.1, -res.nx, -res.nz);
    }

    // wheels and lights
    this.wheelSpin += this.speed * dt * 2.4;
    for (const w of this.wheels) {
      w.rotation.x = this.wheelSpin;
      w.rotation.z = Math.PI / 2 + this.steer * 0.3;
    }
    const brakingLight = this.braking || (this.speed < -0.2 && throttle === 0);
    for (const tl of this.tailLights || []) tl.material = brakingLight ? tailMatOn : tailMat;

    this.rpm = clamp01(Math.abs(this.speed) / maxF) * (0.65 + throttle * 0.35);

    // damage: fire and smoke when wrecked
    if (this.health < 32) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0 && opts.onSmoke) {
        this.smokeTimer = lerp(0.5, 0.12, 1 - this.health / 32);
        opts.onSmoke(this);
      }
    }
    if (this.health <= 0) {
      this.fire += dt;
      this.health = 0;
      if (opts.onFire && Math.random() < dt * 6) opts.onFire(this);
    }
    this.speed = this.health <= 0 ? damp(this.speed, 0, 3, dt) : this.speed;

    // sirens blink
    if (this.lightBar) {
      const blink = (performance.now() * 0.006) % 2 < 1;
      this.lightBar.material.color.setHex(blink ? 0xff2b2b : 0x441010);
      if (this.lightBar2) this.lightBar2.material.color.setHex(blink ? 0x2222ff : 0x101044);
    }

    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.z = clamp(-this.steer * 0.03, -0.05, 0.05);
    return this;
  }

  crash(strength, nx, nz) {
    if (this.collisionCooldown > 0) return 0;
    const impact = Math.min(30, strength * 12);
    if (impact < 0.4) return 0;
    this.collisionCooldown = 0.25;
    this.health = Math.max(0, this.health - impact);
    this.speed *= -0.16;
    this.drift *= 0.3;
    return impact;
  }

  damage(n) {
    this.health = Math.max(0, this.health - n);
    return this.health;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
  }
}

// Owns every car in the city: spawning, pool management, hit tests and the
// player's enter/exit hand-off.
export function createVehicleSystem(scene, city) {
  const vehicles = [];
  const rng = new RNG(4242);

  function spawnVehicle(model, opts = {}) {
    const color = opts.color || (MODELS[model]?.colors || ['#888888'])[Math.floor(rng.next() * 5) % (MODELS[model]?.colors.length || 1)];
    const v = new Vehicle(scene, city, model, color, opts);
    vehicles.push(v);
    return v;
  }

  function randomModel(r2) {
    const roll = r2.next();
    if (roll < 0.42) return 'sedan';
    if (roll < 0.56) return 'suv';
    if (roll < 0.68) return 'sport';
    if (roll < 0.78) return 'taxi';
    if (roll < 0.88) return 'van';
    return 'truck';
  }

  function nearest(x, z, maxDist = 4, filter = null) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const v of vehicles) {
      if (filter && !filter(v)) continue;
      const d = (v.pos.x - x) ** 2 + (v.pos.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  function remove(v) {
    const i = vehicles.indexOf(v);
    if (i >= 0) vehicles.splice(i, 1);
    v.dispose();
  }

  // Place parked cars along the curbs near a point.
  function populateAround(cx, cz, radius, count) {
    const r2 = new RNG(Math.floor(cx * 31 + cz * 17) + 7);
    let placed = 0;
    for (let tries = 0; tries < count * 6 && placed < count; tries++) {
      const x = cx + r2.range(-radius, radius);
      const z = cz + r2.range(-radius, radius);
      const roadX = city.roads.xs.reduce((a, v) => (Math.abs(v - x) < Math.abs(a - x) ? v : a), 1e9);
      const roadZ = city.roads.zs.reduce((a, v) => (Math.abs(v - z) < Math.abs(a - z) ? v : a), 1e9);
      const onX = Math.abs(x - roadX) < city.roadHalf - 1.2 && Math.abs(z - roadZ) > city.roadHalf + 1;
      const onZ = Math.abs(z - roadZ) < city.roadHalf - 1.2 && Math.abs(x - roadX) > city.roadHalf + 1;
      if (!onX && !onZ) continue;
      if (nearest(x, z, 8)) continue;
      const heading = onX ? (r2.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : r2.chance(0.5) ? 0 : Math.PI;
      // park against the curb
      const off = city.roadHalf - 2.4;
      const px = onX ? roadX + (r2.chance(0.5) ? off : -off) : x;
      const pz = onZ ? roadZ + (r2.chance(0.5) ? off : -off) : z;
      spawnVehicle(randomModel(r2), { x: px, z: pz, heading, ai: 'parked' });
      placed++;
    }
    return placed;
  }

  for (const v of vehicles) v.health = 100;

  return {
    vehicles,
    spawnVehicle,
    remove,
    nearest,
    populateAround,
    randomModel,
    clampOut(v) {
      const lim = city.landHalf - 6;
      v.pos.x = clamp(v.pos.x, -lim, lim);
      v.pos.z = clamp(v.pos.z, -lim, lim);
    },
  };
}

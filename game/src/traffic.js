// Traffic: cars that actually drive the grid, keep right, queue behind each
// other, brake for pedestrians and honk when you block the road.
import * as THREE from 'three';
import { RNG, clamp, clamp01, wrapAngle, damp } from './util.js';

const LANE = 3.9;

export function createTraffic(G) {
  const rng = new RNG(777);
  const cars = [];
  const MAX_CARS = 16;
  let spawnTimer = 0;

  function nodeKey(n) {
    return `${n.i},${n.j}`;
  }

  function lanePoint(from, to) {
    // aim a few metres before the target node, on the right-hand lane
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const rx = -uz;
    const rz = ux;
    return {
      x: to.x - ux * 6 + rx * LANE,
      z: to.z - uz * 6 + rz * LANE,
    };
  }

  function chooseNext(from, to) {
    const opts = [];
    const di = to.i - from.i;
    const dj = to.j - from.j;
    const maxI = G.city.roads.xs.length - 1;
    const maxJ = G.city.roads.zs.length - 1;
    // straight
    const si = to.i + di;
    const sj = to.j + dj;
    if (si >= 0 && si <= maxI && sj >= 0 && sj <= maxJ) opts.push({ i: si, j: sj, w: 5 });
    // turns
    for (const turn of [
      { i: to.i + dj, j: to.j + di },
      { i: to.i - dj, j: to.j - di },
    ]) {
      if (turn.i >= 0 && turn.i <= maxI && turn.j >= 0 && turn.j <= maxJ) opts.push({ ...turn, w: 2 });
    }
    // dead end: go back the way we came
    if (opts.length === 0) opts.push({ i: from.i, j: from.j, w: 1 });
    let total = opts.reduce((a, o) => a + o.w, 0);
    let roll = rng.next() * total;
    for (const o of opts) {
      roll -= o.w;
      if (roll <= 0) return G.city.nodeAt(o.i, o.j);
    }
    return G.city.nodeAt(opts[0].i, opts[0].j);
  }

  function spawnCar() {
    const p = G.player;
    for (let tries = 0; tries < 26; tries++) {
      const i = rng.int(0, G.city.roads.xs.length - 2);
      const j = rng.int(0, G.city.roads.zs.length - 1);
      const from = G.city.nodeAt(i, j);
      const to = G.city.nodeAt(i + 1, j);
      const t = rng.range(0.25, 0.85);
      const x = from.x + (to.x - from.x) * t + rng.range(-3.2, 3.2);
      const z = from.z + rng.range(-0.8, 0.8) + LANE * (rng.chance(0.5) ? 1 : -1);
      const dPlayer = Math.hypot(x - p.pos.x, z - p.pos.z);
      if (dPlayer < 22 || dPlayer > 150) continue;
      // do not spawn right on top of another car
      let blocked = false;
      for (const c of cars) if (Math.hypot(c.car.pos.x - x, c.car.pos.z - z) < 9) blocked = true;
      if (blocked) continue;
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      const model = G.vehicles.randomModel(rng);
      const car = G.vehicles.spawnVehicle(model, { x, z, heading, ai: 'traffic' });
      car.ai = 'traffic';
      cars.push({ car, from, to, target: lanePoint(from, to), honk: 0, stuck: 0, lastPos: { x, z } });
      return true;
    }
    return false;
  }

  // Is something in front of this car, within `dist`?
  function obstacleAhead(car, dist) {
    const f = car.forward;
    let blocked = null;
    const check = (x, z, radius) => {
      const dx = x - car.pos.x;
      const dz = z - car.pos.z;
      const along = dx * f.x + dz * f.z;
      if (along < 0.5 || along > dist) return;
      const side = Math.abs(dx * -f.z + dz * f.x);
      if (side < radius + car.spec.wid * 0.5) {
        if (!blocked || along < blocked.along) blocked = { along, x, z };
      }
    };
    for (const other of G.vehicles.vehicles) {
      if (other === car) continue;
      check(other.pos.x, other.pos.z, other.spec.wid * 0.6);
    }
    const p = G.player;
    if (!p.inVehicle) check(p.pos.x, p.pos.z, 0.6);
    for (const ped of G.peds.list) {
      if (!ped.alive) continue;
      check(ped.pos.x, ped.pos.z, 0.45);
    }
    return blocked;
  }

  function updateCar(entry, dt) {
    const car = entry.car;
    if (car.ai !== 'traffic') return;
    const target = entry.target;
    const dx = target.x - car.pos.x;
    const dz = target.z - car.pos.z;
    const distToTarget = Math.hypot(dx, dz);

    if (distToTarget < 7) {
      entry.from = entry.to;
      entry.to = chooseNext(entry.from, entry.to);
      entry.target = lanePoint(entry.from, entry.to);
    }

    const desired = Math.atan2(entry.target.x - car.pos.x, entry.target.z - car.pos.z);
    const diff = wrapAngle(desired - car.heading);
    let steer = clamp(diff * 1.9, -1, 1);

    const ahead = obstacleAhead(car, 12);
    let throttle = 0.55;
    let brake = 0;
    if (ahead) {
      const gap = ahead.along;
      if (gap < 3.2) {
        throttle = 0;
        brake = 1;
      } else {
        throttle = clamp01((gap - 3) / 8) * 0.5;
        brake = gap < 7 ? 0.6 : 0;
      }
      if (brake > 0.4) {
        entry.honk += dt;
        if (entry.honk > 3.2 && Math.random() < dt * 2) {
          entry.honk = 0;
          if (Math.hypot(car.pos.x - G.player.pos.x, car.pos.z - G.player.pos.z) < 45) G.audio.horn();
        }
      }
    } else {
      entry.honk = 0;
    }
    // corners: slow down
    if (Math.abs(diff) > 0.7) throttle = Math.min(throttle, 0.22);

    // stuck detection: back up a touch if we have not moved
    const moved = Math.hypot(car.pos.x - entry.lastPos.x, car.pos.z - entry.lastPos.z);
    entry.lastPos.x = car.pos.x;
    entry.lastPos.z = car.pos.z;
    if (moved < 0.06 && ahead) entry.stuck += dt;
    else entry.stuck = Math.max(0, entry.stuck - dt);
    if (entry.stuck > 2.6) {
      entry.stuck = 0;
      entry.from = entry.to;
      entry.to = chooseNext(entry.from, entry.to);
      entry.target = lanePoint(entry.from, entry.to);
      car.speed = -2;
      return;
    }

    car.update(dt, { throttle, brake, steer, handbrake: false }, {
      onSmoke: (v) => G.effects.smoke(v.pos, 1, true),
      onFire: (v) => G.effects.fire(v),
    });
  }

  return {
    cars,
    update(dt) {
      spawnTimer -= dt;
      const p = G.player;
      // drop traffic that fell behind or got wrecked
      for (let i = cars.length - 1; i >= 0; i--) {
        const entry = cars[i];
        const car = entry.car;
        const d = Math.hypot(car.pos.x - p.pos.x, car.pos.z - p.pos.z);
        if (car.ai !== 'traffic') {
          cars.splice(i, 1); // stolen by the player
          continue;
        }
        if (d > 210 || car.health <= 0) {
          if (car.health <= 0 && d > 40) {
            cars.splice(i, 1);
            G.vehicles.remove(car);
            continue;
          }
          if (d > 210) {
            cars.splice(i, 1);
            G.vehicles.remove(car);
            continue;
          }
        }
        updateCar(entry, dt);
      }
      if (cars.length < MAX_CARS && spawnTimer <= 0) {
        spawnTimer = 0.35;
        spawnCar();
      }
    },
    // Simple AI-driven car used by missions.
    spawnScriptedCar(model, x, z, heading) {
      const car = G.vehicles.spawnVehicle(model, { x, z, heading, ai: 'scripted' });
      car.ai = 'scripted';
      return car;
    },
    clear() {
      for (const entry of cars) G.vehicles.remove(entry.car);
      cars.length = 0;
    },
  };
}

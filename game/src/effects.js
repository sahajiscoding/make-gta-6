// Pooled sprites for smoke, fire, sparks, blood, dust and water splashes, plus
// muzzle flashes, tracers and screen shake. Everything is recycled, so a long
// chase does not churn memory.
import * as THREE from 'three';
import { TEX_RADIAL } from './texrefs.js';

let softTexture = null;

function tex() {
  if (!softTexture) softTexture = TEX_RADIAL();
  return softTexture;
}

export function createEffects(G) {
  const scene = G.scene;
  const pool = [];
  const active = [];
  const MAX = 220;

  const mats = {
    smoke: new THREE.SpriteMaterial({ map: tex(), color: '#c9c9c9', transparent: true, opacity: 0.5, depthWrite: false }),
    darkSmoke: new THREE.SpriteMaterial({ map: tex(), color: '#3a3a3a', transparent: true, opacity: 0.55, depthWrite: false }),
    fire: new THREE.SpriteMaterial({
      map: tex(),
      color: '#ff8a2b',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    spark: new THREE.SpriteMaterial({
      map: tex(),
      color: '#ffd479',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    blood: new THREE.SpriteMaterial({ map: tex(), color: '#8c1f1f', transparent: true, opacity: 0.7, depthWrite: false }),
    dust: new THREE.SpriteMaterial({ map: tex(), color: '#cfc4a8', transparent: true, opacity: 0.35, depthWrite: false }),
    splash: new THREE.SpriteMaterial({ map: tex(), color: '#cdf3ff', transparent: true, opacity: 0.6, depthWrite: false }),
  };

  function get(matKey) {
    let s = pool.pop();
    if (!s) {
      s = new THREE.Sprite(mats[matKey].clone());
      scene.add(s);
    }
    s.material = mats[matKey].clone();
    s.visible = true;
    return s;
  }

  function spawn(opts) {
    if (active.length >= MAX) {
      const old = active.shift();
      if (old) recycle(old);
    }
    const key = opts.kind || 'smoke';
    const sprite = get(key);
    sprite.position.copy(opts.pos);
    const size = opts.size ?? 1;
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = opts.opacity ?? 0.6;
    sprite.material.rotation = Math.random() * Math.PI * 2;
    active.push({
      sprite,
      life: 0,
      ttl: opts.ttl ?? 1,
      vel: opts.vel || new THREE.Vector3(),
      growth: opts.growth ?? 1.6,
      gravity: opts.gravity ?? 0,
      fade: opts.fade ?? 1,
      kind: key,
      baseOpacity: opts.opacity ?? 0.6,
      baseSize: size,
    });
  }

  function recycle(p) {
    p.sprite.visible = false;
    p.sprite.material.dispose();
    pool.push(p.sprite);
  }

  const api = {
    smoke(pos, size = 1.4, dark = false) {
      spawn({
        pos,
        kind: dark ? 'darkSmoke' : 'smoke',
        size,
        growth: 2.4,
        ttl: 1.6,
        opacity: 0.45,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.2, (Math.random() - 0.5) * 1.4),
      });
    },
    fire(p) {
      const pos = new THREE.Vector3(
        p.pos.x + (Math.random() - 0.5) * 0.8,
        p.spec.hgt * 0.8,
        p.pos.z + (Math.random() - 0.5) * 0.8
      );
      spawn({ pos, kind: 'fire', size: 1.5, growth: 2.2, ttl: 0.55, opacity: 0.85, vel: new THREE.Vector3(0, 1.8, 0) });
    },
    sparks(pos, dir, count = 8) {
      for (let i = 0; i < count; i++) {
        spawn({
          pos: pos.clone(),
          kind: 'spark',
          size: 0.28,
          growth: 0.4,
          ttl: 0.28 + Math.random() * 0.2,
          opacity: 0.9,
          vel: new THREE.Vector3(
            dir.x * 4 + (Math.random() - 0.5) * 5,
            1 + Math.random() * 3,
            dir.z * 4 + (Math.random() - 0.5) * 5
          ),
          gravity: -9,
        });
      }
    },
    blood(pos, dir) {
      for (let i = 0; i < 5; i++) {
        spawn({
          pos: pos.clone(),
          kind: 'blood',
          size: 0.3 + Math.random() * 0.25,
          growth: 1.4,
          ttl: 0.5,
          opacity: 0.65,
          vel: new THREE.Vector3(dir.x * 2 + (Math.random() - 0.5) * 2, Math.random() * 1.6, dir.z * 2 + (Math.random() - 0.5) * 2),
          gravity: -6,
        });
      }
    },
    dust(pos) {
      spawn({ pos, kind: 'dust', size: 0.9, growth: 2, ttl: 0.7, opacity: 0.3, vel: new THREE.Vector3(0, 0.4, 0) });
    },
    explosion(pos) {
      for (let i = 0; i < 26; i++) {
        spawn({
          pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)),
          kind: 'fire',
          size: 1.6 + Math.random() * 2.6,
          growth: 3.4,
          ttl: 0.5 + Math.random() * 0.5,
          opacity: 0.95,
          vel: new THREE.Vector3((Math.random() - 0.5) * 9, 3 + Math.random() * 7, (Math.random() - 0.5) * 9),
        });
      }
      for (let i = 0; i < 14; i++) {
        spawn({
          pos: pos.clone(),
          kind: 'darkSmoke',
          size: 2 + Math.random() * 3,
          growth: 4,
          ttl: 2.2,
          opacity: 0.6,
          vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1.6 + Math.random() * 2, (Math.random() - 0.5) * 4),
        });
      }
      api.shake(1.4);
    },
    muzzle(pos, dir) {
      spawn({
        pos: pos.clone(),
        kind: 'spark',
        size: 0.7,
        growth: 0.4,
        ttl: 0.08,
        opacity: 1,
        vel: new THREE.Vector3(dir.x * 2, 0, dir.z * 2),
      });
    },
    shake(amount) {
      if (G.player) G.player.camShake = Math.min(1.6, G.player.camShake + amount);
    },
    tracer(from, to) {
      const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
      const mat = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.75 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      active.push({
        sprite: line,
        life: 0,
        ttl: 0.06,
        kind: 'tracer',
        vel: new THREE.Vector3(),
        growth: 0,
        gravity: 0,
        fade: 1,
        baseOpacity: 0.75,
        baseSize: 1,
      });
    },
    update(dt) {
      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i];
        p.life += dt;
        const t = p.life / p.ttl;
        if (t >= 1) {
          if (p.kind === 'tracer') {
            scene.remove(p.sprite);
            p.sprite.geometry.dispose();
            p.sprite.material.dispose();
          } else {
            recycle(p);
          }
          active.splice(i, 1);
          continue;
        }
        p.vel.y += p.gravity * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
        if (p.kind === 'tracer') {
          p.sprite.material.opacity = 0.75 * (1 - t);
          continue;
        }
        const s = p.baseSize * (1 + p.growth * t);
        p.sprite.scale.set(s, s, 1);
        p.sprite.material.opacity = p.baseOpacity * (1 - t) * (p.fade ? 1 : 0.5);
        if (p.kind === 'spark' || p.kind === 'fire') {
          p.sprite.material.rotation += dt * 2;
        }
      }
    },
    clear() {
      for (const p of active) {
        if (p.kind === 'tracer') scene.remove(p.sprite);
        else recycle(p);
      }
      active.length = 0;
    },
  };
  return api;
}

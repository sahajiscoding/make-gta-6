// Floating pickups: cash dropped by people, health vests, armour and ammo.
import * as THREE from 'three';
import { TEX_RADIAL } from './texrefs.js';

const COLORS = { cash: '#5ad07a', health: '#ff6b6b', armor: '#5aa8ff', ammo: '#ffd166' };

export function createPickups(G) {
  const items = [];
  const spriteTex = TEX_RADIAL();

  function spawn(kind, x, z, amount = 10) {
    const color = COLORS[kind] ?? '#ffffff';
    const group = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 })
    );
    box.position.y = 0.9;
    group.add(box);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: spriteTex,
        color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.set(1.6, 1.6, 1);
    glow.position.y = 0.9;
    group.add(glow);
    group.position.set(x, 0, z);
    G.scene.add(group);
    const item = { kind, amount, group, box, ttl: 45, x, z, phase: Math.random() * 6 };
    items.push(item);
    return item;
  }

  return {
    items,
    spawn,
    spawnAmmoCache(x, z) {
      spawn('ammo', x - 0.8, z, 20);
      spawn('health', x + 0.8, z, 35);
    },
    update(dt) {
      const p = G.player;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.ttl -= dt;
        it.phase += dt * 2;
        it.box.rotation.y += dt * 1.6;
        it.group.position.y = Math.sin(it.phase) * 0.12;
        const d = Math.hypot(p.pos.x - it.x, p.pos.z - it.z);
        if (p.alive && !p.inVehicle && d < 1.5) {
          if (it.kind === 'cash') {
            G.state.money += it.amount;
            G.audio.cash();
            G.hud.notify(`+$${it.amount}`, 1.4);
          } else if (it.kind === 'health') {
            p.heal(it.amount);
            G.audio.pickup();
            G.hud.notify('Health', 1.2);
          } else if (it.kind === 'armor') {
            p.giveArmor(it.amount);
            G.audio.pickup();
            G.hud.notify('Armour', 1.2);
          } else if (it.kind === 'ammo') {
            p.addAmmo('pistol', 12);
            p.addAmmo('smg', 24);
            p.addAmmo('shotgun', 4);
            G.audio.pickup();
            G.hud.notify('Ammo', 1.2);
          }
          G.scene.remove(it.group);
          items.splice(i, 1);
          continue;
        }
        if (it.ttl <= 0) {
          G.scene.remove(it.group);
          items.splice(i, 1);
        }
      }
    },
    clear() {
      for (const it of items) G.scene.remove(it.group);
      items.length = 0;
    },
  };
}

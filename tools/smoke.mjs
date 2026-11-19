#!/usr/bin/env node
// Headless smoke test for Solara Bay.
//
// It runs the real game modules in Node with a tiny DOM stub and a stand-in for
// THREE.WebGLRenderer (everything else is the actual three.js), then drives a
// few hundred simulated frames: title screen, new game, walking, stealing a
// car, driving, shooting, a wanted level with cruisers, and the first mission.
// Rendering itself is not exercised (there is no GPU here), but every system
// update, collision, AI, mission step, HUD write and save round-trip is.
//
//   node tools/smoke.mjs [frames]
//
// Requires three installed somewhere resolvable: `npm i` in this folder.
import { cpSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const tmp = '/tmp/solara-smoke';

// ---------------------------------------------------------------- DOM stub
function makeCtx() {
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: null,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {},
    ellipse() {},
    fill() {},
    stroke() {},
    clip() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    drawImage() {},
    fillText() {},
    strokeText() {},
    measureText: () => ({ width: 10 }),
  };
  return ctx;
}

function makeElement(tag = 'div', id = '') {
  const classes = new Set();
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    id,
    style: {},
    dataset: {},
    width: 372,
    height: 372,
    children: [],
    value: '',
    disabled: false,
    textContent: '',
    innerHTML: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    get className() {
      return [...classes].join(' ');
    },
    set className(v) {
      classes.clear();
      for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (arr) arr.splice(arr.indexOf(fn) >>> 0, 1);
    },
    dispatch(type, ev = {}) {
      for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, target: el, button: 0, movementX: 0, movementY: 0, ...ev });
    },
    click() {
      el.dispatch('click');
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
    },
    remove() {},
    getContext: () => ctxSingleton,
    requestPointerLock() {},
    focus() {},
    animate() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 480 }),
  };
  return el;
}

const ctxSingleton = makeCtx();

function installDOM() {
  const ids = new Map();
  const byId = (id) => {
    if (!ids.has(id)) {
      const el = makeElement(id === 'view' || id === 'minimap' ? 'canvas' : 'div', id);
      ids.set(id, el);
    }
    return ids.get(id);
  };
  // the HUD needs a fixed number of star and crosshair children
  byId('stars');
  const stars = byId('stars');
  for (let i = 0; i < 5; i++) stars.appendChild(makeElement('span'));
  const cross = byId('crosshair');
  for (let i = 0; i < 5; i++) cross.appendChild(makeElement('i'));

  const qualityButtons = ['low', 'medium', 'high'].map((q) => {
    const b = makeElement('button');
    b.dataset.quality = q;
    return b;
  });

  global.document = {
    getElementById: byId,
    createElement: (tag) => makeElement(tag),
    querySelectorAll: (sel) => (sel === '[data-quality]' ? qualityButtons : []),
    addEventListener() {},
    body: makeElement('body'),
    documentElement: makeElement('html'),
    pointerLockElement: null,
    exitPointerLock() {},
  };
  global.window = {
    innerWidth: 1280,
    innerHeight: 480,
    devicePixelRatio: 1,
    addEventListener() {},
    requestAnimationFrame: () => 0,
    AudioContext: class {
      constructor() {
        this.sampleRate = 44100;
        this.currentTime = 0;
        this.state = 'running';
        this.destination = {};
      }
      createGain() {
        const param = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} };
        return { gain: param, connect: (n) => n, disconnect() {} };
      }
      createOscillator() {
        const param = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
        return { type: 'sine', frequency: param, detune: param, connect: (n) => n, start() {}, stop() {} };
      }
      createBiquadFilter() {
        const param = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
        return { type: 'lowpass', frequency: param, Q: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n };
      }
      createBuffer(ch, len) {
        return { getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        return { buffer: null, loop: false, connect: (n) => n, start() {}, stop() {} };
      }
      resume() {}
    },
  };
  global.location = { search: process.env.SOLARA_QUERY || '' };
  global.performance = global.performance || { now: () => Date.now() };
  global.requestAnimationFrame = (fn) => {
    global.__raf = fn;
    return 1;
  };
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  } catch {
    /* node already provides one */
  }
}

// ---------------------------------------------------------------- three shim
function prepareTree() {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  cpSync(join(repo, 'game'), join(tmp, 'game'), {
    recursive: true,
    filter: (src) => !src.includes('vendor'),
  });
  // resolve `three` from the repo's own node_modules (or a fallback path)
  const require = createRequire(import.meta.url);
  let threePath = null;
  for (const candidate of ['three', '/tmp/tools/node_modules/three/package.json']) {
    try {
      const resolved = candidate.startsWith('/') ? candidate : require.resolve(candidate);
      const p = resolved.endsWith('package.json') ? resolved : join(dirname(resolved), 'package.json');
      const pkg = require(p);
      threePath = join(dirname(p), pkg.module || pkg.exports?.['.']?.import || 'build/three.module.js');
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!threePath) throw new Error('three is not installed: run `npm i` in tools/ or set one up in /tmp/tools');

  const shim = `
export * from '${threePath}';
import * as THREE from '${threePath}';
export class WebGLRenderer {
  constructor(opts = {}) {
    this.domElement = opts.canvas || { addEventListener() {}, style: {} };
    this.shadowMap = { enabled: false, type: 0, needsUpdate: false };
    this.capabilities = { getMaxAnisotropy: () => 8, isWebGL2: true };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.outputColorSpace = '';
    this.info = { render: {} };
    this.frames = 0;
  }
  setPixelRatio() {}
  setSize() {}
  render() { this.frames++; }
  dispose() {}
  compile() {}
}
`;
  writeFileSync(join(tmp, 'three-shim.mjs'), shim);

  // rewrite the bare "three" specifier in every module
  for (const dir of ['src']) {
    const files = (function walk(p) {
      const out = [];
      const { readdirSync } = require('node:fs');
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.js')) out.push(full);
      }
      return out;
    })(join(tmp, 'game', dir));
    for (const f of files) {
      const { readFileSync } = require('node:fs');
      const src = readFileSync(f, 'utf8').replace(/from 'three'/g, `from '${join(tmp, 'three-shim.mjs')}'`);
      writeFileSync(f, src);
    }
  }
  return join(tmp, 'game', 'src', 'main.js');
}

// ---------------------------------------------------------------- run
const FRAMES = parseInt(process.argv[2] || '900', 10);
const errors = [];
process.on('uncaughtException', (e) => {
  errors.push(e);
  console.error('UNCAUGHT:', e.stack);
  process.exit(1);
});

installDOM();
const mainPath = prepareTree();
// keep main.js's import map irrelevant: it imports "three", rewritten above
await import(mainPath);
const G = global.window.__SOLARA__ || global.__SOLARA__;
if (!G) throw new Error('game context missing');
console.log('boot ok — world built:', {
  colliders: G.city.colliders.length,
  vehicles: G.vehicles.vehicles.length,
  peds: G.peds.list.length,
});

let t = 0;
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    t += 16.7;
    if (typeof global.__raf === 'function') global.__raf(t);
  }
};

// title screen drift
step(30);
console.log('title frames ok');

// start a new game through the real button
global.document.getElementById('btnNew').click();
step(10);
console.log('new game:', { mode: G.state.mode, money: G.state.money, pos: G.player.pos.toArray().map((v) => +v.toFixed(1)) });

// walk forward
G.input.keys.add('KeyW');
step(60);
G.input.keys.delete('KeyW');
const walked = Math.hypot(G.player.pos.x - G.city.spots.motel.x, G.player.pos.z - (G.city.spots.motel.z + 12));

// steal a car
G.player.teleport(G.city.spots.motel.x, G.city.spots.motel.z + 12, 0);
step(5);
let car = G.vehicles.nearest(G.player.pos.x, G.player.pos.z, 60, (v) => v.ai === 'parked');
if (car) {
  G.player.teleport(car.pos.x + 1.4, car.pos.z, 0);
  G.player.tryEnterVehicle();
}
step(5);
const inCar = !!G.player.inVehicle;
G.input.keys.add('KeyW');
G.input.keys.add('KeyA');
step(90);
G.input.keys.delete('KeyA');
step(40);
G.input.keys.delete('KeyW');
console.log('driving:', { inCar, speed: +(G.player.inVehicle?.speed ?? 0).toFixed(1), moved: inCar });

// shoot
if (G.player.inVehicle) G.player.exitVehicle();
step(4);
G.player.weapon = 1;
G.forceShoot = true;
step(20);
G.forceShoot = false;
console.log('weapons:', { ammo: G.player.weapons[1].clipAmmo, wanted: G.police.wanted });

// wanted level and cops
G.police.setWanted(3);
step(240);
const cruisers = G.vehicles.vehicles.filter((v) => v.role === 'police').length;
const cops = G.peds.list.filter((p) => p.kind === 'cop').length;
console.log('police:', { cruisers, cops, wanted: G.police.wanted });

// walk into the first mission marker and finish the job
G.police.clearWanted();
const m0 = G.missions.defs[0];
G.player.teleport(m0.startAt.x, m0.startAt.z, 0);
step(40);
console.log('mission started:', { active: G.missions.active?.name ?? null });
step(800); // listen to the intro chatter
console.log('mission step:', { step: G.missions.state.step, marker: G.missions.activeMarker });
const s0 = m0.steps[0];
G.player.teleport(s0.x, s0.z, 0);
step(120);
console.log('mission:', {
  active: G.missions.active?.name ?? null,
  completed: G.missions.completed,
  money: G.state.money,
  fail: G.missions.state.lastFailReason,
  pos: G.player.pos.toArray().map((v) => +v.toFixed(1)),
  stepDef: G.missions.active?.steps[G.missions.state.step],
});

// ---------------------------------------------------------------- all missions
// Drive every job in the story end to end with the player teleported onto each
// objective, so all eight scripts and their spawners get exercised.
function startCarNear(x, z) {
  const car = G.vehicles.spawnVehicle('sedan', { x, z, heading: 0, ai: 'parked' });
  return car;
}

for (const def of G.missions.defs.slice(1)) {
  const target = def.startAt;
  G.player.teleport(target.x, target.z, 0);
  step(30);
  if (G.missions.active !== def) {
    console.log(`  ! ${def.id} did not start`);
    continue;
  }
  let guard = 0;
  while (G.missions.active === def && guard < 8000) {
    const stepDef = def.steps[G.missions.state.step];
    if (!stepDef) break;
    if (stepDef.type === 'goto') {
      G.player.teleport(stepDef.x + stepDef.r * 0.3, stepDef.z, 0);
      step(30);
    } else if (stepDef.type === 'drive') {
      G.player.teleport(stepDef.x - 40, stepDef.z, 0);
      const car = startCarNear(stepDef.x - 40, stepDef.z);
      G.player.teleport(car.pos.x + 1.2, car.pos.z, 0);
      G.player.enterVehicle(car);
      car.pos.x = stepDef.x;
      car.pos.z = stepDef.z;
      step(30);
    } else if (stepDef.type === 'steal') {
      const car = G.missions.state.data.car;
      if (car) {
        G.player.teleport(car.pos.x + 1.2, car.pos.z, 0);
        G.player.enterVehicle(car);
      }
      step(30);
    } else if (stepDef.type === 'kill') {
      for (const e of G.missions.state.data.enemies || []) e.hit(999, G.player);
      step(30);
    } else if (stepDef.type === 'collect') {
      for (const pt of stepDef.points) {
        G.player.teleport(pt.x, pt.z, 0);
        step(20);
      }
    } else if (stepDef.type === 'escape') {
      G.police.setWanted(0);
      step(60);
    } else if (stepDef.type === 'survive') {
      step(Math.round((stepDef.seconds + 6) * 60));
    } else {
      step(60);
    }
    step(20);
    guard += 100;
    if (G.player.inVehicle) G.player.exitVehicle();
  }
  console.log(
    `  ${def.id}:`,
    G.missions.completed.includes(def.id) ? 'passed' : `FAILED (${G.missions.state.lastFailReason || 'unknown'})`,
    `money $${G.state.money}`
  );
  G.player.respawn('wasted');
  step(5);
}

// save and load round-trip
G.save.save(true);
const loaded = G.save.load();
console.log('save/load:', { loaded, money: G.state.money });

// long soak
G.input.keys.add('KeyW');
step(Math.max(200, FRAMES - 1200));
G.input.keys.delete('KeyW');
console.log('soak:', {
  peds: G.peds.list.length,
  vehicles: G.vehicles.vehicles.length,
  traffic: G.traffic.cars.length,
  pickups: G.pickups.items.length,
  health: +G.player.health.toFixed(1),
  pos: G.player.pos.toArray().map((v) => +v.toFixed(1)),
  nan: [G.player.pos.x, G.player.pos.z].some((v) => !Number.isFinite(v)),
});
step(20);

console.log(`frames simulated: ${Math.round(t / 16.7)}`);
if (errors.length) {
  console.error('errors:', errors);
  process.exit(1);
}
console.log('SMOKE OK');
process.exit(0);

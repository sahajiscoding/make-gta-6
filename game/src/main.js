// Solara Bay — bootstrap: renderer, sky, day/night cycle, the fixed-step game
// loop and the small amount of glue that lets every system talk to the others.
import * as THREE from 'three';
// Imports run most-defining first: a reader of this file meets the story, the
// HUD, the police and the player before the city they stand in.
import { createMissions } from './missions.js';
import { createHUD } from './hud.js';
import { createMinimap } from './minimap.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createSave } from './save.js';
import { createMenu } from './menu.js';
import { createPlayer } from './player.js';
import { createPeds } from './peds.js';
import { createVehicleSystem } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createCity } from './city.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createPickups } from './pickups.js';
import { createInput } from './input.js';
import { setAnisotropy } from './textures.js';
import { TAU, clamp01, lerp, clockString, RNG } from './util.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot') || null;
const startHours = parseFloat(params.get('time') || '18.6');
const forcedHours = params.has('time') ? parseFloat(params.get('time')) : null;

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fc4d8, 120, 620);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 6, -12);

// ---------------------------------------------------------------- game context
export const G = {
  scene,
  camera,
  renderer,
  canvas,
  seed: SEED,
  state: {
    started: false,
    paused: false,
    money: 250,
    wanted: 0,
    mode: 'title',
  },
  settings: { sensitivity: 1, volumeMaster: 0.8, volumeMusic: 0.5, quality: 'high' },
  stats: { missions: 0, kills: 0, started: Date.now() },
  time: { hours: startHours, rate: 1 / 42 }, // one game hour every 42 s
  worldTime: 0,
  clockText: '7:00 PM',
  shotMode: !!SHOT,
  freeLook: true,
  settingsPanel: null,
};
window.__SOLARA__ = G;

// ---------------------------------------------------------------- sky
const skyUniforms = {
  topColor: { value: new THREE.Color('#1b3a6b') },
  bottomColor: { value: new THREE.Color('#ff9d6b') },
  sunColor: { value: new THREE.Color('#ffd9a0') },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  offset: { value: 0.06 },
  exponent: { value: 0.85 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform vec3 sunColor;
    uniform vec3 sunDir;
    uniform float offset;
    uniform float exponent;
    varying vec3 vWorld;
    void main() {
      vec3 dir = normalize(vWorld);
      float h = max(0.0, dir.y + offset) / (1.0 + offset);
      vec3 col = mix(bottomColor, topColor, pow(h, exponent));
      float sun = pow(max(dot(dir, normalize(sunDir)), 0.0), 220.0);
      float glow = pow(max(dot(dir, normalize(sunDir)), 0.0), 6.0);
      col += sunColor * sun * 1.6;
      col += sunColor * glow * 0.28;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 24, 16), skyMat);
sky.frustumCulled = false;
scene.add(sky);

// stars for the small hours
const starCount = 700;
const starPos = new Float32Array(starCount * 3);
const starRng = new RNG(99);
for (let i = 0; i < starCount; i++) {
  const u = starRng.range(0, TAU);
  const v = starRng.range(0.05, 1);
  const r = 2000;
  starPos[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r;
  starPos[i * 3 + 1] = v * r;
  starPos[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0 });
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x50503f, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 320;
const shadowSize = 95;
sun.shadow.camera.left = -shadowSize;
sun.shadow.camera.right = shadowSize;
sun.shadow.camera.top = shadowSize;
sun.shadow.camera.bottom = -shadowSize;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.045;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x9fb8ff, 0.25);
scene.add(fill);
// city glow: keeps the night readable instead of a black screen
const ambient = new THREE.AmbientLight(0x38507a, 0.4);
scene.add(ambient);

// ---------------------------------------------------------------- systems
const input = createInput(canvas);
const audio = createAudio();
G.input = input;
G.audio = audio;

const city = createCity(scene, SEED);
G.city = city;
G.vehicles = createVehicleSystem(scene, city);
G.traffic = createTraffic(G);
G.effects = createEffects(G);
G.pickups = createPickups(G);
G.peds = createPeds(G);
G.player = createPlayer(G);
G.police = createPolice(G);
G.hud = createHUD(G);
G.noise = {
  emit(x, z, radius) {
    G.peds.startle(x, z, radius, 1);
  },
};
G.combat = createCombat(G);
G.missions = createMissions(G);
G.save = createSave(G);
G.menu = createMenu(G, {
  onNewGame: () => startGame(false),
  onContinue: () => startGame(true),
  onResume: () => resumeGame(),
  onQuit: () => quitToTitle(),
  onQuality: (q) => applyQuality(q),
});

// some parked cars to steal right away
G.vehicles.populateAround(city.spots.motel.x, city.spots.motel.z, 120, 9);
G.vehicles.populateAround(city.spots.club.x, city.spots.club.z, 120, 7);

// ---------------------------------------------------------------- quality
function applyQuality(q) {
  const ratio = q === 'low' ? 0.85 : q === 'medium' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = q !== 'low';
  sun.castShadow = q !== 'low';
  sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  renderer.shadowMap.needsUpdate = true;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
applyQuality(G.settings.quality);

// ---------------------------------------------------------------- hooks
G.onEnterVehicle = (car) => {
  const wasTraffic = car.ai !== 'player' && car.health > 0;
  if (wasTraffic && G.peds.livingCiviliansNear(car.pos.x, car.pos.z, 26).length > 0) {
    G.police.reportCrime('carjack', car.pos);
    G.peds.startle(car.pos.x, car.pos.z, 22, 0.8);
  }
  if (G.hud) G.hud.notify(car.role === 'police' ? 'Stolen police cruiser' : 'Vehicle acquired', 1.4);
};

G.onDeath = () => {
  G.state.mode = 'dead';
  G.hud.showBig('WASTED', 'Solara Bay General Hospital', 4);
  audio.engine(false);
  input.unlock();
  setTimeout(() => {
    G.player.respawn('wasted');
    G.state.money = Math.max(0, G.state.money - 150);
    G.hud.hideBig();
    G.state.mode = 'playing';
    input.lock();
  }, 4000);
};

G.onBusted = () => {
  G.hud.showBig('BUSTED', 'PCPD precinct house', 3.2);
  audio.engine(false);
  input.unlock();
  setTimeout(() => {
    G.player.respawn('busted');
    G.hud.hideBig();
    G.state.mode = 'playing';
    input.lock();
  }, 3400);
};

G.onRespawn = (kind) => {
  if (kind === 'busted') G.police.clearWanted();
};

// ---------------------------------------------------------------- states
function startGame(continueSave) {
  G.menu.hideAll();
  G.hud.setVisible(true);
  G.state.started = true;
  G.state.mode = 'playing';
  G.time.hours = startHours;
  if (continueSave && G.save.load()) {
    G.hud.notify('Welcome back', 2.2);
  } else {
    G.player.teleport(city.spots.motel.x, city.spots.motel.z + 12, Math.PI);
    G.state.money = 250;
    G.player.weapons.forEach((w) => {
      if (w.kind === 'pistol') {
        w.ammo = 20;
        w.clipAmmo = 12;
      }
    });
    G.hud.subtitle('Bruno', 'Welcome home, Rico. Look for the yellow marker on your radar.', 4);
  }
  audio.resume();
  audio.setStation(0);
  input.lock();
  canvas.focus();
}

function resumeGame() {
  G.menu.hideAll();
  G.state.mode = 'playing';
  G.state.paused = false;
  input.lock();
}

function pauseGame() {
  if (!G.state.started || G.state.mode !== 'playing') return;
  G.state.mode = 'paused';
  G.state.paused = true;
  audio.engine(false);
  input.unlock();
  G.menu.showPause();
}

function quitToTitle() {
  G.state.started = false;
  G.state.mode = 'title';
  G.save.save(true);
  G.hud.setVisible(false);
  G.menu.showTitle();
  input.unlock();
  audio.radioOff();
  audio.siren(false);
}

// ---------------------------------------------------------------- escape key
input.onKey((code) => {
  if (code === 'Escape') {
    if (G.menu.open === 'menu') return;
    if (G.state.mode === 'playing') pauseGame();
    else if (G.state.mode === 'paused') resumeGame();
  }
  if (code === 'F5' && G.state.mode === 'playing') {
    G.save.save();
    G.menu.refreshSaveInfo();
  }
  if (code === 'KeyP' && G.state.mode === 'playing') pauseGame();
});

canvas.addEventListener('click', () => {
  if (G.state.mode === 'playing' && !input.locked) input.lock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// ---------------------------------------------------------------- day / night
// The sky is a small table of stops: pick the two around the current hour and
// blend them, which keeps dawn, noon, golden hour and midnight all continuous.
const SKY_STOPS = [
  { h: 0, top: '#05070f', bottom: '#0a1120', fog: '#0a1220', hemiSky: '#1b2740', hemiGround: '#0b0d12', light: 0.12 },
  { h: 4.6, top: '#080b16', bottom: '#131c2e', fog: '#101828', hemiSky: '#22304c', hemiGround: '#0d0f14', light: 0.16 },
  { h: 6.2, top: '#2b3a6b', bottom: '#ff9a63', fog: '#8e7f8a', hemiSky: '#93a8d4', hemiGround: '#3a3230', light: 0.9 },
  { h: 8.5, top: '#2f6fc0', bottom: '#cfe6f7', fog: '#a9c8dd', hemiSky: '#cfe2ff', hemiGround: '#6b6a58', light: 2.25 },
  { h: 15.5, top: '#2f6fc0', bottom: '#d6e9f7', fog: '#b0cbdc', hemiSky: '#d3e4ff', hemiGround: '#6f6a55', light: 2.2 },
  { h: 17.4, top: '#3a5a9c', bottom: '#ffcf9c', fog: '#b9a394', hemiSky: '#c9c0e0', hemiGround: '#5e4a3a', light: 1.65 },
  { h: 18.6, top: '#3b3f77', bottom: '#e88a5c', fog: '#9a8189', hemiSky: '#a08ec8', hemiGround: '#463733', light: 0.95 },
  { h: 19.6, top: '#22294f', bottom: '#7d5f72', fog: '#4a4258', hemiSky: '#5a5c88', hemiGround: '#26232c', light: 0.5 },
  { h: 20.6, top: '#101a34', bottom: '#2b3550', fog: '#1a2438', hemiSky: '#2c3a5c', hemiGround: '#12141c', light: 0.26 },
  { h: 24, top: '#05070f', bottom: '#0a1120', fog: '#0a1220', hemiSky: '#1b2740', hemiGround: '#0b0d12', light: 0.12 },
];
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const cTop = new THREE.Color();
const cBottom = new THREE.Color();
const cFog = new THREE.Color();
const cHemiSky = new THREE.Color();
const cHemiGround = new THREE.Color();
const sunPos = new THREE.Vector3();
let sunLight = 1;

function sampleSky(hours) {
  let a = SKY_STOPS[0];
  let b = SKY_STOPS[SKY_STOPS.length - 1];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (hours >= SKY_STOPS[i].h && hours <= SKY_STOPS[i + 1].h) {
      a = SKY_STOPS[i];
      b = SKY_STOPS[i + 1];
      break;
    }
  }
  const t = b.h === a.h ? 0 : clamp01((hours - a.h) / (b.h - a.h));
  const mix = (ka, kb, key) => _c1.set(ka[key]).lerp(_c3.set(kb[key]), t).clone();
  cTop.copy(mix(a, b, 'top'));
  cBottom.copy(mix(a, b, 'bottom'));
  cFog.copy(mix(a, b, 'fog'));
  cHemiSky.copy(mix(a, b, 'hemiSky'));
  cHemiGround.copy(mix(a, b, 'hemiGround'));
  sunLight = lerp(a.light, b.light, t);
  return t;
}

function updateSky(dt) {
  G.time.hours = (G.time.hours + dt * G.time.rate) % 24;
  const hours = G.time.hours;
  G.clockText = clockString(hours);
  sampleSky(hours);

  const t = ((hours - 6) / 24) * TAU;
  const alt = Math.sin(t);
  sunPos.set(Math.cos(t) * 0.9, Math.sin(t) * 0.9, 0.38).normalize();

  skyUniforms.topColor.value.copy(cTop);
  skyUniforms.bottomColor.value.copy(cBottom);
  skyUniforms.sunDir.value.copy(sunPos);
  skyUniforms.sunColor.value.copy(_c1.set(alt > -0.05 ? '#ffd9a0' : '#8fa4d0'));

  scene.fog.color.copy(cFog);
  scene.fog.near = 80 + 90 * clamp01(alt + 0.15);
  scene.fog.far = 520 + 240 * clamp01(alt + 0.15);

  hemi.color.copy(cHemiSky);
  hemi.groundColor.copy(cHemiGround);
  // night is lit by the city itself, never pitch black
  hemi.intensity = lerp(1.0, 0.95, clamp01(alt * 1.8 + 0.35));
  ambient.intensity = lerp(1.15, 0.2, clamp01(alt * 2 + 0.3));
  ambient.color.copy(_c1.set(alt > 0.05 ? '#c8d8ee' : '#6a7c9c'));

  sun.intensity = sunLight;
  sun.color.copy(_c1.set(alt > 0.18 ? '#fff4dc' : alt > -0.04 ? '#ffa96b' : '#7f95c8'));
  fill.intensity = lerp(0.12, 0.3, clamp01(alt + 0.2));
  fill.color.set(alt > 0 ? '#9fb8ff' : '#4a5c92');

  starMat.opacity = clamp01(-alt * 2.4);
  stars.visible = starMat.opacity > 0.02;

  // follow the player with the shadow camera so shadows stay crisp
  const p = G.player.pos;
  sun.position.set(p.x + sunPos.x * 220, Math.max(40, sunPos.y * 260), p.z + sunPos.z * 220);
  sun.target.position.set(p.x, 0, p.z);
  sun.target.updateMatrixWorld();

  const night = clamp01(-alt * 2.4 + 0.2);
  G.settings.night = night;
  renderer.toneMappingExposure = lerp(1.3, 1.0, clamp01(alt * 1.6 + 0.4));
  city.setNight(night);
  audio.update(dt, { night });
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;
let frames = 0;

function simulate(dt) {
  G.worldTime += dt;
  G.player.update(dt);
  G.traffic.update(dt);
  G.police.update(dt);
  G.peds.update(dt);
  G.pickups.update(dt);
  G.effects.update(dt);
  G.missions.update(dt);
  G.save.update(dt);
  G.state.wanted = G.police.wanted;
  G.stats.kills = Math.max(G.stats.kills, 0);
  city.update(dt, G.worldTime);
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.shotMode) {
    tickShot(raw);
    return;
  }
  updateSky(raw);

  if (G.state.mode === 'playing' || G.state.mode === 'dead') {
    acc += raw;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      simulate(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 4) acc = 0;
    G.hud.update(raw);
  } else if (G.state.mode === 'title') {
    // gentle drift of the title camera over the city
    G.worldTime += raw;
    const t = G.worldTime * 0.045;
    camera.position.set(Math.sin(t) * 210, 92 + Math.sin(t * 0.7) * 16, Math.cos(t) * 210);
    camera.lookAt(0, 12, 0);
    G.traffic.update(raw);
    G.peds.update(raw);
    G.effects.update(raw);
    city.update(raw, G.worldTime);
  }

  renderer.render(scene, camera);
  frames++;
  if (frames === 2) G.menu.hideLoading();
}

// ---------------------------------------------------------------- shot scenes
// Deterministic dioramas used to take the entry's screenshots:
//   ?shot=chase|street|title|pier&seed=N
let shotCam = null;
let shotStage = 0;
let shotWait = 0;
let shotDone = false;

function poseCameraFollow(spec) {
  const v = spec.car;
  if (!v) return;
  const f = { x: Math.sin(v.heading), z: Math.cos(v.heading) };
  const r = { x: Math.cos(v.heading), z: -Math.sin(v.heading) };
  const px = v.pos.x + f.x * spec.ahead + r.x * spec.side;
  const pz = v.pos.z + f.z * spec.ahead + r.z * spec.side;
  const py = spec.up;
  const lx = v.pos.x - f.x * spec.lookBack + r.x * (spec.lookSide ?? 0);
  const lz = v.pos.z - f.z * spec.lookBack + r.z * (spec.lookSide ?? 0);
  poseCamera(px, py, pz, lx, spec.lookY ?? 1.5, lz, spec.fov);
}

function poseCamera(px, py, pz, lx, ly, lz, fov) {
  camera.position.set(px, py, pz);
  camera.fov = fov ?? 62;
  camera.updateProjectionMatrix();
  camera.lookAt(lx, ly, lz);
}

function setupShot(kind) {
  const p = G.player;
  const setTime = (h) => {
    G.time.hours = forcedHours ?? h;
  };
  G.state.started = true;
  G.menu.hideAll();
  G.menu.hideLoading();
  G.hud.setVisible(true);
  G.settings.quality = 'high';
  G.settings.radioLabel = 'SOLARA SABOR 98.1';
  applyQuality('high');

  const onRoad = (x, z, dx, dz, n = 1) => {
    const car = G.vehicles.spawnVehicle(n === 1 ? 'sedan' : 'sedan', { x, z, heading: Math.atan2(dx, dz), ai: 'parked' });
    return car;
  };

  if (kind === 'chase') {
    // golden hour on the Sunset Strip: Rico's coupe, two cruisers on its tail
    setTime(17.6);
    const x = city.roads.xs[0] + 4.4;
    const z = 120;
    const car = G.vehicles.spawnVehicle('sport', { x, z, heading: Math.PI, ai: 'player', color: '#e2452f' });
    car.driver = 'player';
    p.inVehicle = car;
    p.pos.set(x, 0, z);
    p.rig.group.visible = false;
    car.speed = 17;
    G.police.setWanted(3);
    for (let i = 0; i < 2; i++) {
      // two cruisers closing from behind, lights going (the camera faces back at them)
      const cruiser = G.vehicles.spawnVehicle('police', {
        x: x + 2.3,
        z: z + 16 + i * 13,
        heading: Math.PI,
        ai: 'police',
        role: 'police',
      });
      cruiser.speed = 19;
    }
    // traffic coming the other way and pedestrians scattering along the beach
    for (let i = 0; i < 3; i++) {
      G.vehicles.spawnVehicle(i === 1 ? 'taxi' : 'sedan', {
        x: x - 4.4,
        z: z - 30 - i * 22,
        heading: 0,
        ai: 'traffic',
      });
    }
    for (let i = 0; i < 9; i++) {
      const ped = G.peds.spawnCivilian(x + 9.4 + (i % 3) * 1.4, z - 8 - i * 3.6);
      ped.state = 'flee';
      ped.panicFrom = { x: x, z: z + 10 };
    }
    for (let i = 0; i < 4; i++) G.peds.spawnCivilian(x - 12 - i * 1.6, z - 12 - i * 5);
    shotCam = { car, ahead: 7.6, side: 4.2, up: 1.95, lookBack: 13, lookSide: 1.0, lookY: 1.15, fov: 50 };
  } else if (kind === 'street') {
    // a firefight on the Little Habana sidewalk at night
    setTime(20.5);
    const x = city.spots.club.x;
    const z = city.spots.club.z + 10;
    const heading = 0.1;
    p.teleport(x, z, heading);
    p.rig.group.visible = true;
    p.aiming = true;
    p.forceAim = true;
    p.weapon = 1;
    p.camYaw = heading + Math.PI;
    // neon bolted to the club wall, facing the street
    city.addNeon('CLUB MIRAMAR', '#ff5fa2', x + 3.1, 8.2, z + 2, -Math.PI / 2, 13, 2.8);
    city.addNeon('RON · SALSA', '#4de1ff', x + 3.1, 5.2, z - 6, -Math.PI / 2, 10, 1.7);
    for (let i = 0; i < 3; i++) {
      const g = G.peds.spawnGang(x + 0.4 + i * 1.2, z + 9 + i * 3.6);
      g.state = 'aim';
      g.heading = Math.PI;
      g.rig.armR.rotation.x = -1.5;
      g.rig.armL.rotation.x = -1.2;
    }
    for (let i = 0; i < 8; i++) {
      const ped = G.peds.spawnCivilian(x + (i % 2 === 0 ? -1.6 : 2.2), z + 16 + i * 2.8);
      ped.state = 'flee';
      ped.panicFrom = { x, z };
      ped.rig.armL.rotation.x = -2.4;
      ped.rig.armR.rotation.x = -2.4;
    }
    const cruiser = G.vehicles.spawnVehicle('police', { x: x - 7.4, z: z + 26, heading: Math.PI, ai: 'police', role: 'police' });
    cruiser.speed = 0;
    G.vehicles.spawnVehicle('taxi', { x: x - 7.4, z: z - 16, heading: 0, ai: 'traffic' });
    G.police.setWanted(2);
    shotCam = { px: x - 9.2, py: 2.45, pz: z - 7.4, lx: x + 0.8, ly: 1.35, lz: z + 7.5, fov: 54 };
    } else if (kind === 'pier') {
    // Centrico after dark: a boulevard chase with the air unit overhead
    setTime(20.7);
    const x = city.roads.xs[4] + 4.4;
    const z = city.roads.zs[3] + 34;
    const car = G.vehicles.spawnVehicle('sport', { x, z, heading: Math.PI, ai: 'player', color: '#1a9bd8' });
    car.driver = 'player';
    p.inVehicle = car;
    p.pos.set(x, 0, z);
    p.rig.group.visible = false;
    car.speed = 21;
    G.police.setWanted(4);
    for (let i = 0; i < 2; i++) {
      const c = G.vehicles.spawnVehicle('police', { x: x + 5.4, z: z + 15 + i * 11, heading: Math.PI, ai: 'police', role: 'police' });
      c.speed = 22;
    }
    for (let i = 0; i < 3; i++) {
      G.vehicles.spawnVehicle(i === 0 ? 'taxi' : 'sedan', { x: x - 4.4, z: z - 26 - i * 20, heading: 0, ai: 'traffic' });
    }
    for (let i = 0; i < 8; i++) {
      const ped = G.peds.spawnCivilian(x - 7.6, z - 6 - i * 4.2);
      ped.state = 'flee';
      ped.panicFrom = { x, z: z + 12 };
    }
    const f = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
    shotCam = {
      car,
      ahead: -10.5,
      side: 4.6,
      up: 3.2,
      lookBack: -13,
      lookSide: 0.6,
      lookY: 2.9,
      fov: 62,
      freeze: () => {
        const h = G.police.heli;
        if (!h) return;
        h.group.position.set(car.pos.x + f.x * 40 - 8, 17, car.pos.z + f.z * 40);
        h.group.lookAt(car.pos.x, 1.2, car.pos.z);
        h.light.intensity = 3.4;
      },
    };
    } else {
    // cover shot: Rico and the coupe on the promenade, ocean behind him
    setTime(17.9);
    const x = city.roads.xs[0] - 7;
    const z = city.roads.zs[4] + 26;
    const car = G.vehicles.spawnVehicle('sport', { x: x + 4.6, z: z + 2.6, heading: Math.PI * 0.86, ai: 'parked', color: '#e8452f' });
    p.teleport(x, z, Math.PI * 0.9);
    p.rig.group.visible = true;
    p.heading = Math.PI * 0.15;
    p.rig.group.rotation.y = Math.PI * 0.15;
    for (let i = 0; i < 6; i++) G.peds.spawnCivilian(x + 12 + i * 4.5, z + 6 - i * 2.4);
    for (let i = 0; i < 3; i++) {
      G.vehicles.spawnVehicle(i === 1 ? 'taxi' : 'sedan', { x: x + 24 + i * 20, z: z + 10.4, heading: Math.PI / 2, ai: 'traffic' });
    }
    shotCam = { px: x + 13, py: 2.15, pz: z - 6.5, lx: x + 1.2, ly: 1.45, lz: z + 5.5, fov: 44 };
  }
  window.__SHOT_KIND__ = kind;
}

function tickShot(raw) {
  if (shotStage === 0) {
    shotStage = 1;
    try {
      setupShot(SHOT);
    } catch (err) {
      window.__SHOT_ERROR__ = String(err && err.stack ? err.stack : err);
      console.error('shot setup failed', err);
    }
    if (shotCam?.car) poseCameraFollow(shotCam);
    else if (shotCam) poseCamera(shotCam.px, shotCam.py, shotCam.pz, shotCam.lx, shotCam.ly, shotCam.lz, shotCam.fov);
    renderer.render(scene, camera);
    return;
  }
  updateSky(STEP);
  // settle the scene deterministically, then hold the frame for capture
  if (!shotDone) {
    shotWait += 1;
    simulate(STEP);
    G.hud.update(STEP);
    if (shotWait > 22) {
      if (shotCam?.freeze) shotCam.freeze();
      shotDone = true;
      window.__SHOT_READY__ = true;
    }
  }
  if (shotCam?.car) poseCameraFollow(shotCam);
  else if (shotCam) poseCamera(shotCam.px, shotCam.py, shotCam.pz, shotCam.lx, shotCam.ly, shotCam.lz, shotCam.fov);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
if (SHOT) {
  window.__SHOT_READY__ = false;
  requestAnimationFrame(frame);
} else {
  G.state.mode = 'title';
  G.menu.showTitle();
  requestAnimationFrame(frame);
  // if a save exists, offer to continue
  if (G.save.hasSave()) G.menu.refreshSaveInfo();
}

window.addEventListener('error', (e) => {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:99;max-width:70vw;padding:12px;border-radius:10px;background:rgba(120,0,0,.9);color:#fff;font:12px/1.5 monospace;white-space:pre-wrap';
  box.textContent = `Solara Bay error: ${e.message}\n${e.filename}:${e.lineno}`;
  document.body.appendChild(box);
});

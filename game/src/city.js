// Solara Bay: a procedurally generated coastal city. Everything here is built
// from arithmetic, canvas textures and three.js primitives, so the whole city
// arrives with no downloads, no image files and no randomness at run time
// beyond the seed in the URL.
import * as THREE from 'three';
import { RNG, TAU, clamp, lerp } from './util.js';
import * as TEX from './textures.js';

export const ROAD_HALF = 8;

// One physical surface helper. Everything the player's eye spends time on — the
// road, the walk, the plaster, the containers — goes through this so the whole
// city shares one shading model, one roughness language and one normal scale.
function surface(map, opts = {}) {
  const { rough = 0.9, metal = 0.0, normal = null, env = 0.85, normalScale = 1, color = 0xffffff, emissive, emissiveMap, emissiveIntensity = 0, ...rest } = opts;
  const mat = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: rough,
    metalness: metal,
    envMapIntensity: env,
    ...rest,
  });
  if (normal) {
    mat.normalMap = normal;
    mat.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  if (emissive !== undefined) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = emissiveIntensity;
    if (emissiveMap) mat.emissiveMap = emissiveMap;
  }
  return mat;
}

// Stretch a geometry's UVs so a shared tiling material keeps the same texel
// density on a 6 m slab and a 90 m road, with no extra texture uploads.
function scaleUV(geometry, sx, sy) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
  return geometry;
}
export const SIDEWALK_W = 3.6;
export const CURB = ROAD_HALF + SIDEWALK_W;
export const ROAD_STEP = 90;
export const LAND_HALF = 430;

const HABANA_COLORS = ['#e9a85c', '#d96a5c', '#7fc3a5', '#e8d07a', '#c98fc0', '#7fb2d9', '#e3b7a0'];
const HOTEL_COLORS = ['#f2e6d0', '#e7cfc0', '#dfeee8', '#f5dcc8', '#cfe3ea', '#f0d9e6'];
const NEON = ['#ff5fa2', '#4de1ff', '#ffd24d', '#a76bff', '#5cffb1'];
const SIGN_WORDS = ['SOLARA', 'CLUB MIRAMAR', 'TIKI', 'HOTEL AZUL', 'EL PULPO', 'RON & RUM', 'PALMAS', 'LA REINA'];

export function createCity(scene, seed = 1) {
  const rng = new RNG(seed);
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const xs = [];
  for (let v = -360; v <= 360; v += ROAD_STEP) xs.push(v);
  const colliders = [];
  const blocks = []; // used by the minimap and by AI spawners
  const lamps = [];
  const palms = [];
  const lots = [];
  const signs = [];

  // Roughness values follow the art bible: nothing shiny except paint, glass
  // and water. The asphalt sits low enough that the sky and every lamp land on
  // it as a sheen — a wet-looking street without a single reflection pass.
  const asphaltMat = surface(TEX.asphalt(), { rough: 0.78, normal: TEX.asphaltNormal(), normalScale: 0.17, env: 0.3 });
  const walkMat = surface(TEX.sidewalk(), { rough: 0.88, normal: TEX.sidewalkNormal(), normalScale: 0.75, env: 0.12 });
  const sandMat = surface(TEX.sand(), { rough: 0.97, env: 0.5 });
  const grassMat = surface(TEX.grass(), { rough: 0.95, env: 0.55 });
  const concreteMat = surface(TEX.concrete('#b0aca2'), { rough: 0.88, normal: TEX.concreteNormal(), normalScale: 0.6 });

  const paintMat = new THREE.MeshBasicMaterial({
    map: TEX.paintTexture('dash'),
    transparent: true,
    depthWrite: false,
  });

  // road centrelines, shared by every query below (and by the furniture pass)
  const roadXs = xs.slice();
  const roadZs = xs.slice();
  const pick2 = (r2, arr) => arr[r2.int(0, arr.length - 1)];
  const SHOP_NAMES = [
    'CAFE', 'BODEGA', 'PELUQUERIA', 'FARMACIA', 'TACOS', 'MARISCOS', 'LICORES',
    'LAVANDERIA', 'FLORES', 'DISCOS', 'ROPA', 'PANADERIA', 'TALLER', 'BAR',
  ];

  // ---------------------------------------------------------------- ground
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 1, 1),
    new THREE.MeshStandardMaterial({
      map: TEX.water(),
      color: '#8fe3ef',
      roughness: 0.08,
      metalness: 0.45,
      envMapIntensity: 1.6,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.9;
  ocean.receiveShadow = false;
  group.add(ocean);

  const landGeo = new THREE.PlaneGeometry(LAND_HALF * 2, LAND_HALF * 2);
  const land = new THREE.Mesh(landGeo, surface(TEX.concrete('#8f8c84'), { rough: 0.92, normal: TEX.concreteNormal(), normalScale: 0.5 }));
  land.rotation.x = -Math.PI / 2;
  land.position.y = -0.02;
  land.receiveShadow = true;
  group.add(land);

  // Beach strip along the west shore.
  const BEACH_X0 = -LAND_HALF + 6;
  const BEACH_X1 = xs[0] - CURB - 6;
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(BEACH_X1 - BEACH_X0, LAND_HALF * 1.4),
    sandMat.clone()
  );
  beach.material.map = TEX.sand().clone();
  beach.material.map.repeat.set((BEACH_X1 - BEACH_X0) / 12, LAND_HALF / 12);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set((BEACH_X0 + BEACH_X1) / 2, 0.01, 0);
  beach.receiveShadow = true;
  group.add(beach);

  // ---------------------------------------------------------------- roads
  const dashTexCache = new Map();
  function dashTexture(len) {
    const key = Math.round(len);
    if (!dashTexCache.has(key)) {
      const t = TEX.paintTexture('dash').clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      dashTexCache.set(key, t);
    }
    const t = dashTexCache.get(key);
    t.repeat.set(1, Math.max(1, Math.round(len / 9)));
    return t;
  }

  const roadLen = (xs[xs.length - 1] - xs[0]) + ROAD_HALF * 2;
  for (const x of xs) {
    const geo = scaleUV(new THREE.PlaneGeometry(ROAD_HALF * 2, roadLen), 2, roadLen / 16);
    const m = new THREE.Mesh(geo, asphaltMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0, 0);
    m.receiveShadow = true;
    group.add(m);
    // center dashes
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, roadLen),
      new THREE.MeshBasicMaterial({ map: dashTexture(roadLen), transparent: true, depthWrite: false })
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.012, 0);
    group.add(dash);
  }
  for (const z of xs) {
    const geo = scaleUV(new THREE.PlaneGeometry(roadLen, ROAD_HALF * 2), roadLen / 16, 2);
    const m = new THREE.Mesh(geo, asphaltMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0, z);
    m.receiveShadow = true;
    group.add(m);
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(roadLen, 0.55),
      new THREE.MeshBasicMaterial({ map: dashTexture(roadLen), transparent: true, depthWrite: false })
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.012, z);
    group.add(dash);
  }

  // Sidewalk slabs + curbs around every block cell.
  const curbMat = surface(TEX.concrete('#cac6bb'), { rough: 0.8, normal: TEX.concreteNormal(), normalScale: 0.7 });

  // Shared prop materials: the same street furniture kit everywhere in the city,
  // so a bench in Centrico and a bench on the boardwalk are the same bench.
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#2f343a', roughness: 0.55, metalness: 0.65, envMapIntensity: 0.9 });
  const paintedMetal = new THREE.MeshStandardMaterial({ color: '#3d4a45', roughness: 0.5, metalness: 0.35 });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.8 });
  const hydrantMat = new THREE.MeshStandardMaterial({ color: '#b3392f', roughness: 0.55, metalness: 0.25 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#9d978c', roughness: 0.9, normalMap: TEX.concreteNormal(), envMapIntensity: 0.5 });

  const crosswalkMat = new THREE.MeshBasicMaterial({
    map: TEX.paintTexture('bar'),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,

    
  });

  // Four bands make the sidewalk around a block, leaving the road open.
  function sidewalkBlock(x0, x1, z0, z1) {
    const w = x1 - x0 + CURB * 2;
    const d = z1 - z0 + CURB * 2;
    const bands = [
      { cx: (x0 + x1) / 2, cz: z0 - SIDEWALK_W / 2, w, d: SIDEWALK_W }, // north
      { cx: (x0 + x1) / 2, cz: z1 + SIDEWALK_W / 2, w, d: SIDEWALK_W }, // south
      { cx: x0 - SIDEWALK_W / 2, cz: (z0 + z1) / 2, w: SIDEWALK_W, d }, // west
      { cx: x1 + SIDEWALK_W / 2, cz: (z0 + z1) / 2, w: SIDEWALK_W, d }, // east
    ];
    for (const b of bands) {
      const geo = scaleUV(new THREE.BoxGeometry(b.w, 0.18, b.d), b.w / 4, b.d / 4);
      const slab = new THREE.Mesh(geo, walkMat);
      slab.position.set(b.cx, 0.09, b.cz);
      slab.receiveShadow = true;
      group.add(slab);
    }
    // the block's own ground, so the lot is not bare land
    const lotGeo = scaleUV(new THREE.PlaneGeometry(x1 - x0, z1 - z0), (x1 - x0) / 9, (z1 - z0) / 9);
    const lot = new THREE.Mesh(lotGeo, concreteMat);
    lot.rotation.x = -Math.PI / 2;
    lot.position.set((x0 + x1) / 2, 0.04, (z0 + z1) / 2);
    lot.receiveShadow = true;
    group.add(lot);
  }

  // ---------------------------------------------------------------- districts
  function districtOf(x, z) {
    if (x < -300) return 'beach';
    if (z < -260) return 'docks';
    if (z > 300) return 'park';
    if (x > 240) return 'habana';
    return 'centrico';
  }

  // ---------------------------------------------------------------- helpers
  function addCollider(minX, maxX, minZ, maxZ, height = 40) {
    colliders.push({ minX, maxX, minZ, maxZ, height });
  }

  function facadeMaterial(kind, seed2) {
    let opts;
    if (kind === 'centrico') {
      const palettes = [
        ['#b9c4cc', '#2c3a48', '#ffe0a8'],
        ['#cfd6d2', '#33424c', '#cfe9ff'],
        ['#aeb7c4', '#28323e', '#ffeec2'],
        ['#d8d2c4', '#38414a', '#ffd9a8'],
      ];
      const p = rng.pick(palettes);
      opts = {
        key: `c${seed2 % 4}`,
        body: p[0],
        windowColor: p[1],
        litColor: p[2],
        cols: 6,
        rows: 8,
        lit: 0.5,
        seed: seed2,
      };
    } else if (kind === 'beach') {
      opts = {
        key: `b${seed2 % 6}`,
        body: HOTEL_COLORS[seed2 % HOTEL_COLORS.length],
        windowColor: '#3a4a52',
        litColor: '#ffe4b0',
        cols: 5,
        rows: 5,
        lit: 0.42,
        seed: seed2,
        trim: false,
      };
    } else {
      opts = {
        key: `h${seed2 % 7}`,
        body: HABANA_COLORS[seed2 % HABANA_COLORS.length],
        windowColor: '#3b4650',
        litColor: '#ffd9a0',
        cols: 3,
        rows: 3,
        lit: 0.5,
        seed: seed2,
      };
    }
    const f = TEX.facade(opts);
    const map = f.map.clone();
    const emi = f.emissive.clone();
    map.needsUpdate = true;
    emi.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map,
      color: 0xdedad2,
      emissiveMap: emi,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.78,
      metalness: 0.02,
      envMapIntensity: 0.8,
      normalMap: TEX.concreteNormal(),
      normalScale: new THREE.Vector2(0.45, 0.45),
    });
    mat.userData.nightGlow = 1.0;
    return { mat, map, emi };
  }

  function rooftop(cx, cz, top, w, d, r2) {
    const roofMat = surface(TEX.concrete('#8d8a82'), { rough: 0.9, normal: TEX.concreteNormal(), normalScale: 0.5 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), roofMat);
    roof.position.set(cx, top + 0.25, cz);
    roof.receiveShadow = true;
    group.add(roof);
    const units = r2.int(0, 3);
    for (let i = 0; i < units; i++) {
      const uw = r2.range(2, 5);
      const ud = r2.range(2, 5);
      const uh = r2.range(1, 2.6);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(uw, uh, ud),
        surface(TEX.concrete('#a9a49a'), { rough: 0.88, normal: TEX.concreteNormal(), normalScale: 0.5 })
      );
      box.position.set(
        cx + r2.range(-w / 2 + uw, w / 2 - uw),
        top + uh / 2 + 0.4,
        cz + r2.range(-d / 2 + ud, d / 2 - ud)
      );
      box.castShadow = true;
      group.add(box);
    }
  }

  // A single building box with a tiled facade.
  function building(cx, cz, w, h, d, kind, r2, opts = {}) {
    const { mat, map, emi } = facadeMaterial(kind, Math.floor(r2.next() * 997) + (opts.tintSeed || 0));
    const tileW = kind === 'habana' ? 13 : kind === 'beach' ? 20 : 24;
    const tileH = kind === 'habana' ? 11 : kind === 'beach' ? 17 : 27;
    map.repeat.set(Math.max(1, Math.round(w / tileW)), Math.max(1, Math.round(h / tileH)));
    emi.repeat.copy(map.repeat);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Ground floor: a band of shopfronts wrapped around the base, so the street
    // level of every building reads as retail instead of a blank wall.
    if (opts.shops !== false && h > 4) {
      const shopTex = TEX.storefrontSkin(Math.floor(r2.next() * 4000) + 7, r2.pick(['#2a2f38', '#33262a', '#22343a', '#302e24']));
      shopTex.repeat.set(Math.max(1, Math.round((w + d) / 14)), 1);
      const shopMat = new THREE.MeshLambertMaterial({
        map: shopTex,
        emissive: 0xffffff,
        emissiveMap: shopTex,
        emissiveIntensity: 0,
      });
      shopMat.userData.nightGlow = 0.85;
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, 3.5, d + 0.34), shopMat);
      band.position.set(cx, 1.75, cz);
      band.receiveShadow = true;
      group.add(band);
      // a plinth under the glass, and a cornice over it
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5), curbMat);
      plinth.position.set(cx, 0.17, cz);
      group.add(plinth);
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.62, 0.24, d + 0.62), curbMat);
      cornice.position.set(cx, 3.62, cz);
      cornice.castShadow = true;
      group.add(cornice);
    }
    addCollider(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, h);
    if (opts.roof !== false) rooftop(cx, cz, h, w, d, r2);
    return mesh;
  }

  function storefronts(minX, maxX, minZ, maxZ, facesX, r2) {
    // A strip of shopfronts hugging the block edge.
    const len = facesX ? maxZ - minZ : maxX - minX;
    const count = Math.max(1, Math.floor(len / 9));
    const seg = len / count;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const tex = TEX.storefrontSkin(r2.int(1, 999), r2.pick(['#2a2f38', '#3a2b2b', '#26343a', '#33312a']));
      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0,
      });
      mat.userData.nightGlow = 1.0;
      let mesh;
      if (facesX) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.2, seg * 0.94), mat);
        mesh.position.set(minX, 2.1, lerp(minZ, maxZ, t));
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.94, 4.2, 0.5), mat);
        mesh.position.set(lerp(minX, maxX, t), 2.1, minZ);
      }
      group.add(mesh);

      // A shop is a shop because of the awning and the sign above the glass.
      const zc = lerp(minZ, maxZ, t);
      const xc = lerp(minX, maxX, t);
      const stripeColors = [['#c9473f', '#efe6d2'], ['#2f6f5e', '#f1ead7'], ['#2b4f7a', '#e8e3d4'], ['#c08a2e', '#f3e9d2']];
      const [ca, cb] = pick2(r2, stripeColors);
      const awnMat = surface(TEX.awningStripe(ca, cb), { rough: 0.86, env: 0.25 });
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(facesX ? 1.7 : seg * 0.9, 0.12, facesX ? seg * 0.9 : 1.7),
        awnMat
      );
      const outX = facesX ? Math.sign(minX) || 1 : 0;
      if (facesX) {
        awning.position.set(minX + (minX < 0 ? 0.85 : -0.85), 3.3, zc);
        awning.rotation.z = minX < 0 ? -0.12 : 0.12;
      } else {
        awning.position.set(xc, 3.3, minZ + (minZ < 0 ? 0.85 : -0.85));
        awning.rotation.x = minZ < 0 ? 0.12 : -0.12;
      }
      awning.castShadow = true;
      group.add(awning);

      // hanging sign, lit at dusk
      const shopName = pick2(r2, SHOP_NAMES);
      const signTex = TEX.neonSign(shopName, pick2(r2, ['#ffd166', '#7cf2d0', '#ff8ab5', '#9ad0ff']));
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, opacity: 0.35 });
      signMat.userData.nightGlow = 1;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(facesX ? 3.2 : 2.6, facesX ? 3.2 : 0.8), signMat);
      if (facesX) {
        sign.geometry = new THREE.PlaneGeometry(2.8, 0.7);
        sign.position.set(minX + (minX < 0 ? -0.28 : 0.28), 4.5, zc);
        sign.rotation.y = minX < 0 ? -Math.PI / 2 : Math.PI / 2;
      } else {
        sign.geometry = new THREE.PlaneGeometry(2.8, 0.7);
        sign.position.set(xc, 4.5, minZ + (minZ < 0 ? -0.28 : 0.28));
        sign.rotation.y = minZ < 0 ? Math.PI : 0;
      }
      group.add(sign);
    }
  }

  // ---------------------------------------------------------------- blocks
  function developBlock(i, j) {
    const x0 = xs[i] + CURB;
    const x1 = xs[i + 1] - CURB;
    const z0 = xs[j] + CURB;
    const z1 = xs[j + 1] - CURB;
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const district = districtOf(cx, cz);
    const r2 = new RNG(Math.floor(r2seed(x0, z0)));

    sidewalkBlock(x0, x1, z0, z1);
    blocks.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, district });

    if (district === 'park') {
      // Parque Rojo: lawns, paths, a pond and trees.
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(w - 2, d - 2), grassMat);
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.set(cx, 0.19, cz);
      lawn.receiveShadow = true;
      group.add(lawn);
      const pondR = r2.range(5, 11);
      if (r2.chance(0.6)) {
        const pond = new THREE.Mesh(
          new THREE.CircleGeometry(pondR, 28),
          new THREE.MeshLambertMaterial({ map: TEX.water(), color: '#9fe6f2' })
        );
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(cx + r2.range(-w * 0.2, w * 0.2), 0.21, cz + r2.range(-d * 0.2, d * 0.2));
        group.add(pond);
      }
      for (let k = 0; k < 10; k++) {
        const px = r2.range(x0 + 3, x1 - 3);
        const pz = r2.range(z0 + 3, z1 - 3);
        palms.push({ x: px, z: pz, h: r2.range(7, 11), r: r2.range(0.22, 0.34) });
      }
      for (let k = 0; k < 4; k++) {
        const bx = r2.range(x0 + 4, x1 - 4);
        const bz = r2.range(z0 + 4, z1 - 4);
        const bench = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 0.5, 0.7),
          new THREE.MeshLambertMaterial({ color: '#7a5a3a' })
        );
        bench.position.set(bx, 0.45, bz);
        bench.castShadow = true;
        group.add(bench);
      }
      lamps.push({ x: x0 + 1.5, z: z0 + 1.5 }, { x: x1 - 1.5, z: z1 - 1.5 });
      return;
    }

    if (district === 'docks') {
      // Warehouses, container stacks and a rail spur.
      const whW = w * r2.range(0.55, 0.85);
      const whD = d * r2.range(0.5, 0.8);
      const whH = r2.range(7, 12);
      const wh = new THREE.Mesh(
        new THREE.BoxGeometry(whW, whH, whD),
        surface(TEX.containerSkin(r2.pick(['#8a8f96', '#6f7d86', '#94897a'])), { rough: 0.55, metal: 0.35, env: 1.0 })
      );
      wh.position.set(cx + r2.range(-4, 4), whH / 2, cz + r2.range(-4, 4));
      wh.castShadow = true;
      wh.receiveShadow = true;
      group.add(wh);
      addCollider(wh.position.x - whW / 2, wh.position.x + whW / 2, wh.position.z - whD / 2, wh.position.z + whD / 2, whH);
      const stackColors = ['#b8483f', '#2f6f9e', '#3f8a5c', '#c08a2a', '#7a5a9e'];
      for (let s = 0; s < r2.int(2, 6); s++) {
        const sx = r2.range(x0 + 6, x1 - 6);
        const sz = r2.range(z0 + 6, z1 - 6);
        const levels = r2.int(1, 3);
        const col = r2.pick(stackColors);
        for (let l = 0; l < levels; l++) {
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(12, 2.6, 2.6),
            new THREE.MeshLambertMaterial({ map: TEX.containerSkin(col) })
          );
          box.position.set(sx, 1.3 + l * 2.62, sz);
          box.rotation.y = r2.chance(0.5) ? 0 : Math.PI / 2;
          box.castShadow = true;
          group.add(box);
        }
        addCollider(sx - 6.5, sx + 6.5, sz - 6.5, sz + 6.5, 8);
      }
      lamps.push({ x: x0 + 1.5, z: z1 - 1.5 }, { x: x0 + 1.5, z: z0 + 1.5 }, { x: x1 - 1.5, z: cz }, { x: cx, z: z0 + 1.5 });
      if (r2.chance(0.5)) {
        signs.push({
          x: x0 + 2.4,
          y: whH + 1.8,
          z: cz,
          text: r2.pick(['PUERTO', 'MUELLES', 'ADUANA', 'PESCA', 'NO.7', 'CARGAS']),
          color: r2.pick(NEON),
          ry: Math.PI / 2,
        });
      }
      return;
    }

    if (district === 'beach') {
      // Art-deco hotels facing the ocean, with rooftop neon.
      const lotsCount = r2.int(1, 2);
      const lotD = d / lotsCount;
      for (let l = 0; l < lotsCount; l++) {
        const lz = z0 + lotD * (l + 0.5);
        const bw = w * r2.range(0.7, 0.95);
        const bd = lotD * r2.range(0.72, 0.92);
        const bh = r2.range(12, 30);
        const bx = x0 + bw / 2 + 1;
        building(bx, lz, bw, bh, bd, 'beach', r2, { tintSeed: l * 13 });
        // rounded corner tower cap
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(bw * 0.16, bw * 0.16, bh * 0.5, 12),
          surface(TEX.concrete(HOTEL_COLORS[Math.floor(r2.next() * HOTEL_COLORS.length)]), { rough: 0.84, normal: TEX.concreteNormal(), normalScale: 0.55 })
        );
        cap.position.set(bx + bw / 2 - bw * 0.1, bh * 0.75, lz);
        cap.castShadow = true;
        group.add(cap);
        if (r2.chance(0.8)) {
          signs.push({ x: bx, y: bh + 3.2, z: lz, text: r2.pick(SIGN_WORDS), color: r2.pick(NEON), ry: Math.PI / 2 });
        }
        storefronts(bx - bw / 2, bx + bw / 2, lz - bd / 2, lz + bd / 2, true, r2);
        for (let p = 0; p < 3; p++) {
          palms.push({ x: x1 - 2, z: lz + r2.range(-bd / 2, bd / 2), h: r2.range(8, 12), r: r2.range(0.22, 0.32) });
        }
      }
      lamps.push({ x: x0 + 1.6, z: z0 + 1.6 }, { x: x0 + 1.6, z: z1 - 1.6 }, { x: x0 + 1.6, z: cz });
      return;
    }

    if (district === 'habana') {
      // Dense colourful low-rise with balconies and shopfronts.
      const cols = r2.int(2, 3);
      const rows = r2.int(2, 3);
      const bw = w / cols;
      const bd = d / rows;
      for (let a = 0; a < cols; a++) {
        for (let b = 0; b < rows; b++) {
          if (r2.chance(0.12)) continue;
          const bx = x0 + bw * (a + 0.5);
          const bz = z0 + bd * (b + 0.5);
          const hh = r2.range(6, 16);
          building(bx, bz, bw * 0.94, hh, bd * 0.94, 'habana', r2, { roof: r2.chance(0.7) });
          if (b === 0) storefronts(x0, x0, bz - bd / 2, bz + bd / 2, false, r2);
          if (a === 0) storefronts(bx - bw / 2, bx + bw / 2, z0, z0, true, r2);
          if (r2.chance(0.22)) {
            signs.push({
              x: bx,
              y: hh * 0.72,
              z: bz - bd / 2 - 0.4,
              text: r2.pick(['BODEGA', 'TABACO', 'RON', 'CAFÉ', 'SALSA', 'PELUQUERÍA', 'DOMINÓ']),
              color: r2.pick(NEON),
              ry: Math.PI,
            });
          }
        }
      }
      lamps.push({ x: x0 + 1.4, z: cz - 16 }, { x: x0 + 1.4, z: cz + 16 }, { x: x1 - 1.4, z: cz }, { x: cx, z: z0 + 1.4 });
      return;
    }

    // Centrico: towers with setbacks, some plazas.
    if (r2.chance(0.14)) {
      // public plaza with a fountain
      const plaza = new THREE.Mesh(new THREE.PlaneGeometry(w - 4, d - 4), concreteMat);
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set(cx, 0.19, cz);
      plaza.receiveShadow = true;
      group.add(plaza);
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(4, 4.4, 0.7, 20),
        surface(TEX.concrete('#d2cec2'), { rough: 0.85, normal: TEX.concreteNormal(), normalScale: 0.55 })
      );
      basin.position.set(cx, 0.55, cz);
      group.add(basin);
      addCollider(cx - 4, cx + 4, cz - 4, cz + 4, 1);
      for (let k = 0; k < 6; k++) {
        palms.push({ x: cx + r2.range(-w / 2 + 4, w / 2 - 4), z: cz + r2.range(-d / 2 + 4, d / 2 - 4), h: 9, r: 0.28 });
      }
      lamps.push({ x: x0 + 2, z: z0 + 2 }, { x: x1 - 2, z: z1 - 2 });
      return;
    }
    const towers = r2.int(1, 3);
    const spanW = w / towers;
    for (let t = 0; t < towers; t++) {
      const tx = x0 + spanW * (t + 0.5);
      const bw = spanW * r2.range(0.66, 0.9);
      const bd = d * r2.range(0.55, 0.86);
      const bh = r2.range(18, 78);
      building(tx, cz, bh * 0.14 + bw * 0.7, bh, bd, 'centrico', r2);
      // setback tower on top of the low ones
      if (bh < 40 && r2.chance(0.5)) {
        const h2 = bh * r2.range(0.4, 0.9);
        building(tx, cz, bw * 0.55, h2, bd * 0.55, 'centrico', r2);
      }
      storefronts(tx - bw / 2, tx + bw / 2, cz - bd / 2, cz - bd / 2, false, r2);
    }
    lamps.push({ x: x0 + 1.5, z: cz }, { x: x1 - 1.5, z: cz + 7 });
  }

  function r2seed(x, z) {
    return ((x + 1000) * 73856093) ^ ((z + 1000) * 19349663) ^ (seed * 83492791);
  }

  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < xs.length - 1; j++) developBlock(i, j);
  }

  // ---------------------------------------------------------------- beach props
  for (let z = -LAND_HALF + 30; z < LAND_HALF - 20; z += 26) {
    palms.push({ x: BEACH_X1 - 3 + rng.range(-1.5, 1.5), z: z + rng.range(-4, 4), h: rng.range(8, 13), r: 0.3 });
    if (rng.chance(0.35)) {
      palms.push({ x: BEACH_X0 + rng.range(20, 70), z: z + rng.range(-8, 8), h: rng.range(7, 12), r: 0.26 });
    }
  }
  // Lifeguard huts and umbrellas on the sand.
  for (let i = 0; i < 7; i++) {
    const hx = BEACH_X1 - rng.range(20, 55);
    const hz = rng.range(-LAND_HALF + 60, LAND_HALF - 60);
    const hut = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 2.6, 3.4),
      new THREE.MeshLambertMaterial({ color: rng.pick(['#e8e2d2', '#e9c46a', '#d98a8a']) })
    );
    hut.position.set(hx, 1.6, hz);
    hut.castShadow = true;
    group.add(hut);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 1.6, 4),
      new THREE.MeshLambertMaterial({ color: '#c0563f' })
    );
    roof.position.set(hx, 3.6, hz);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    for (let u = 0; u < 4; u++) {
      const um = new THREE.Mesh(
        new THREE.ConeGeometry(1.9, 0.7, 10),
        new THREE.MeshLambertMaterial({ color: rng.pick(['#e94f37', '#3a86ff', '#ffd166', '#06d6a0']) })
      );
      um.position.set(hx + rng.range(-14, 14), 2.2, hz + rng.range(-14, 14));
      group.add(um);
    }
  }

  // Boardwalk along the sand edge: planks, a rail and planters.
  const plankMat = surface(TEX.concrete('#8a7a63'), { rough: 0.84, normal: TEX.concreteNormal(), normalScale: 0.8 });
  const boardwalk = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(7, 0.22, LAND_HALF * 2), 2, LAND_HALF / 2), plankMat);
  boardwalk.position.set(BEACH_X1 - 3.6, 0.11, 0);
  boardwalk.receiveShadow = true;
  group.add(boardwalk);
  const railMat = new THREE.MeshLambertMaterial({ color: '#cfc6b0' });
  const railTop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, LAND_HALF * 2), railMat);
  railTop.position.set(BEACH_X1 - 0.2, 1.05, 0);
  group.add(railTop);
  const railMid = railTop.clone();
  railMid.position.y = 0.62;
  group.add(railMid);
  for (let z = -LAND_HALF; z < LAND_HALF; z += 6) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), railMat);
    post.position.set(BEACH_X1 - 0.2, 0.6, z);
    group.add(post);
  }
  // furniture along the boardwalk: benches facing the water, bins, lamps, and
  // the odd planter, so the promenade is not an empty deck
  {
    const bwRng = new RNG(seed * 13 + 91);
    const bwX = BEACH_X1 - 4.6;
    for (let z = -LAND_HALF + 30; z < LAND_HALF - 30; z += 24) {
      const bench = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 1.9), woodMat);
      seat.position.set(0, 0.46, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 1.9), woodMat);
      back.position.set(-0.22, 0.72, 0);
      const legA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.1), darkMetal);
      legA.position.set(0, 0.23, 0.7);
      const legB = legA.clone();
      legB.position.z = -0.7;
      bench.add(seat, back, legA, legB);
      bench.position.set(bwX, 0.22, z + bwRng.range(-3, 3));
      group.add(bench);
      if (bwRng.chance(0.6)) {
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 10), paintedMetal);
        bin.position.set(bwX + 0.6, 0.56, z + 2.6);
        bin.castShadow = true;
        group.add(bin);
      }
    }
    // promenade lamps, taller and warmer than the street ones
    const bwPole = new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6);
    const bwPoleMat = new THREE.MeshStandardMaterial({ color: '#3a4046', roughness: 0.5, metalness: 0.6 });
    const bwGlobe = new THREE.SphereGeometry(0.28, 10, 8);
    const bwGlobeMat = new THREE.MeshBasicMaterial({ color: '#ffe6b0' });
    for (let z = -LAND_HALF + 20; z < LAND_HALF - 20; z += 46) {
      const pole = new THREE.Mesh(bwPole, bwPoleMat);
      pole.position.set(bwX - 1.4, 2.3, z);
      pole.castShadow = true;
      group.add(pole);
      const globe = new THREE.Mesh(bwGlobe, bwGlobeMat);
      globe.position.set(bwX - 1.4, 4.7, z);
      group.add(globe);
    }
  }

  // ---------------------------------------------------------------- instanced trees
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#907253', roughness: 0.85 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palms.length);
  trunks.castShadow = true;

  const frondMat = new THREE.MeshStandardMaterial({
    map: TEX.palmFrond(),
    color: '#c8e0a8',
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.8,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  });
  const crownGeo = new THREE.SphereGeometry(0.85, 8, 6);
  const crownMat = new THREE.MeshStandardMaterial({ color: '#5f9440', roughness: 0.75, envMapIntensity: 0.9 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palms.length);
  const frondGeo = new THREE.PlaneGeometry(11, 11);
  const frondCount = palms.length * 6;
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, frondCount);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  palms.forEach((p, idx) => {
    e.set(0, 0, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(p.x, p.h / 2, p.z), q, new THREE.Vector3(1, p.h, 1));
    trunks.setMatrixAt(idx, m4);
    m4.compose(new THREE.Vector3(p.x, p.h + 0.35, p.z), q, new THREE.Vector3(1, 0.75, 1));
    crowns.setMatrixAt(idx, m4);
    for (let f = 0; f < 6; f++) {
      const ang = (f / 6) * TAU + (idx % 7) * 0.35;
      e.set(-0.62 - (f % 3) * 0.16, ang, 0);
      q.setFromEuler(e);
      v3.set(p.x, p.h + 0.7, p.z);
      m4.compose(v3, q, one);
      fronds.setMatrixAt(idx * 6 + f, m4);
    }
  });
  trunks.frustumCulled = false;
  fronds.frustumCulled = false;
  crowns.frustumCulled = false;
  crowns.castShadow = true;
  trunks.instanceMatrix.needsUpdate = true;
  fronds.instanceMatrix.needsUpdate = true;
  group.add(trunks, fronds, crowns);

  // ---------------------------------------------------------------- street lamps
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 6.2, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#4b5259' });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff0c4' });
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
  lamps.forEach((l, idx) => {
    m4.makeTranslation(l.x, 3.1, l.z);
    poleMesh.setMatrixAt(idx, m4);
    m4.makeTranslation(l.x, 6.3, l.z);
    headMesh.setMatrixAt(idx, m4);
  });
  poleMesh.castShadow = true;
  poleMesh.frustumCulled = false;
  headMesh.frustumCulled = false;
  group.add(poleMesh, headMesh);

  const poolMat = new THREE.MeshBasicMaterial({
    map: TEX.radialSprite('rgba(255,225,170,0.85)', 'rgba(255,225,170,0)'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const poolGeo = new THREE.PlaneGeometry(21, 21);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
  const flat = new THREE.Euler(-Math.PI / 2, 0, 0);
  const fq = new THREE.Quaternion().setFromEuler(flat);
  lamps.forEach((l, idx) => {
    m4.compose(new THREE.Vector3(l.x, 0.26, l.z), fq, one);
    pools.setMatrixAt(idx, m4);
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.frustumCulled = false;
  pools.renderOrder = 1;
  group.add(pools);

  // ---------------------------------------------------------------- neon signs
  for (const s of signs) {
    const tex = TEX.neonSign(s.text, s.color);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.ry ?? 0;
    group.add(mesh);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 6),
      new THREE.MeshBasicMaterial({
        map: TEX.radialSprite(`rgba(255,255,255,0.5)`, 'rgba(255,255,255,0)'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.5,
      })
    );
    glow.position.set(s.x - Math.sin((s.ry ?? 0)) * 0.3, s.y, s.z - Math.cos((s.ry ?? 0)) * 0.3);
    glow.rotation.y = s.ry ?? 0;
    group.add(glow);
  }

  // ---------------------------------------------------------------- street furniture
  // What makes a sidewalk feel lived in: meters, bins, hydrants, benches,
  // planters, bus shelters, traffic lights at every crossing and manholes in the
  // tarmac. Repeated props are instanced, so this whole layer is a handful of
  // draw calls.
  const furnRng = new RNG(seed * 7919 + 11);

  const bins = [];
  const meters = [];
  const hydrants = [];
  const benches = [];
  const planters = [];
  const manholes = [];

  for (const rx of xs) {
    for (let z = -LAND_HALF + 26; z < LAND_HALF - 26; z += 15.5) {
      for (const side of [-1, 1]) {
        const x = rx + side * (ROAD_HALF + 1.35);
        if (!isOnSidewalk(x, z) || !isFree(x, z, 1.0)) continue;
        const roll = furnRng.next();
        const face = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (roll < 0.22) {
          benches.push({ x: x + side * 0.25, z, ry: face });
          bins.push({ x, z: z + 1.5, ry: 0 });
        } else if (roll < 0.52) {
          meters.push({ x, z, ry: 0 });
        } else if (roll < 0.68) {
          hydrants.push({ x, z, ry: 0 });
        } else if (roll < 0.9) {
          planters.push({ x: x + side * 0.2, z, ry: 0 });
        }
      }
    }
  }
  for (const rz of xs) {
    for (let x = -LAND_HALF + 26; x < LAND_HALF - 26; x += 15.5) {
      for (const side of [-1, 1]) {
        const z = rz + side * (ROAD_HALF + 1.35);
        if (!isOnSidewalk(x, z) || !isFree(x, z, 1.0)) continue;
        const roll = furnRng.next();
        if (roll < 0.2) {
          benches.push({ x, z: z + side * 0.25, ry: 0 });
          bins.push({ x: x + 1.5, z, ry: 0 });
        } else if (roll < 0.5) {
          meters.push({ x, z, ry: 0 });
        } else if (roll < 0.66) {
          hydrants.push({ x, z, ry: 0 });
        } else if (roll < 0.9) {
          planters.push({ x, z: z + side * 0.2, ry: 0 });
        }
      }
    }
  }
  // manholes: one on the crown of the road every block or so
  for (const rx of xs) {
    for (const rz of xs) {
      manholes.push({ x: rx + furnRng.range(-3, 3), z: rz + furnRng.range(11, 24) });
      manholes.push({ x: rx + furnRng.range(11, 24), z: rz + furnRng.range(-3, 3) });
    }
  }

  function placeInstances(geo, mat, list, y, ryOffset = 0, yOffset = 0) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const rot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    list.forEach((p, i) => {
      rot.setFromEuler(new THREE.Euler(0, (p.ry || 0) + ryOffset, 0));
      pos.set(p.x, y + yOffset, p.z);
      m4.compose(pos, rot, scl);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  // bins: a drum with a lid
  placeInstances(new THREE.CylinderGeometry(0.34, 0.3, 0.95, 10), paintedMetal, bins, 0.48);
  placeInstances(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 10), darkMetal, bins, 0.98);
  // parking meters: a post and a head
  placeInstances(new THREE.CylinderGeometry(0.055, 0.06, 1.3, 6), darkMetal, meters, 0.65);
  placeInstances(new THREE.BoxGeometry(0.2, 0.3, 0.16), darkMetal, meters, 1.42);
  // hydrants
  placeInstances(new THREE.CylinderGeometry(0.15, 0.18, 0.62, 8), hydrantMat, hydrants, 0.31);
  placeInstances(new THREE.SphereGeometry(0.16, 8, 6), hydrantMat, hydrants, 0.68);
  // benches: seat, back and legs
  placeInstances(new THREE.BoxGeometry(1.9, 0.09, 0.55), woodMat, benches, 0.46);
  placeInstances(new THREE.BoxGeometry(1.9, 0.5, 0.09), woodMat, benches, 0.72, 0, 0.22);
  placeInstances(new THREE.BoxGeometry(0.1, 0.45, 0.5), darkMetal, benches, 0.23);
  // planters with a shrub in them
  placeInstances(new THREE.BoxGeometry(1.3, 0.62, 1.3), stoneMat, planters, 0.31);
  placeInstances(new THREE.SphereGeometry(0.62, 8, 6), crownMat, planters, 1.0);
  // manholes
  const manholeGeo = new THREE.CircleGeometry(0.55, 12);
  manholeGeo.rotateX(-Math.PI / 2);
  const manholeMat = new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.7, metalness: 0.4 });
  const manholeMesh = placeInstances(manholeGeo, manholeMat, manholes, 0.025);

  // traffic lights: a pole and an arm over the road at every crossing, ganged
  const signalGeo = new THREE.BoxGeometry(0.28, 0.78, 0.24);
  const lensRed = new THREE.MeshBasicMaterial({ color: '#ff2f2a' });
  const lensGreen = new THREE.MeshBasicMaterial({ color: '#37ff7a' });
  const lensGeo = new THREE.SphereGeometry(0.07, 8, 6);
  let signalCount = 0;
  for (const rx of xs) {
    for (const rz of xs) {
      for (const [sx, sz] of [[1, 1], [-1, -1]]) {
        const px = rx + sx * (ROAD_HALF + 1.6);
        const pz = rz + sz * (ROAD_HALF + 1.6);
        if (!isOnSidewalk(px, pz) || !isFree(px, pz, 0.8)) continue;
        if (signalCount > 44) break;
        signalCount++;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.4, 6), darkMetal);
        pole.position.set(px, 2.7, pz);
        pole.castShadow = true;
        group.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 0.1), darkMetal);
        arm.position.set(px - sx * 1.7, 5.3, pz);
        group.add(arm);
        const head = new THREE.Mesh(signalGeo, darkMetal);
        head.position.set(px - sx * 3.2, 4.9, pz);
        group.add(head);
        const red = new THREE.Mesh(lensGeo, lensRed);
        red.position.set(px - sx * 3.2, 5.12, pz + 0.13);
        group.add(red);
        const green = new THREE.Mesh(lensGeo, lensGreen);
        green.position.set(px - sx * 3.2, 4.68, pz + 0.13);
        group.add(green);
      }
    }
  }

  // bus shelters where a block is big enough to hold one
  const shelterRng = new RNG(seed * 31 + 5);
  for (const rx of xs) {
    for (let z = -LAND_HALF + 40; z < LAND_HALF - 40; z += 120) {
      if (!shelterRng.chance(0.55)) continue;
      const x = rx + (shelterRng.chance(0.5) ? 1 : -1) * (ROAD_HALF + 2.2);
      if (!isOnSidewalk(x, z) || !isFree(x, z, 2.2)) continue;
      const glass = new THREE.MeshStandardMaterial({
        color: '#9fc4d8',
        transparent: true,
        opacity: 0.28,
        roughness: 0.05,
        metalness: 0.4,
        envMapIntensity: 1.2,
      });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.6), darkMetal);
      roof.position.set(x, 2.5, z);
      roof.castShadow = true;
      group.add(roof);
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.9, 0.08), glass);
      back.position.set(x, 1.5, z + 0.75);
      group.add(back);
      for (const ex of [-1.6, 1.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.5, 0.09), darkMetal);
        post.position.set(x + ex, 1.25, z + 0.7);
        group.add(post);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.4), woodMat);
      seat.position.set(x, 0.55, z + 0.55);
      group.add(seat);
    }
  }

  // ---------------------------------------------------------------- queries

  function nodeAt(i, j) {
    return { x: roadXs[clamp(i, 0, roadXs.length - 1)], z: roadZs[clamp(j, 0, roadZs.length - 1)], i, j };
  }

  function nearestNode(x, z) {
    let bi = 0;
    let bj = 0;
    let best = Infinity;
    for (let i = 0; i < roadXs.length; i++) {
      for (let j = 0; j < roadZs.length; j++) {
        const d = (roadXs[i] - x) ** 2 + (roadZs[j] - z) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    return { i: bi, j: bj };
  }

  function isOnRoad(x, z) {
    for (const rx of roadXs) if (Math.abs(x - rx) <= ROAD_HALF) return true;
    for (const rz of roadZs) if (Math.abs(z - rz) <= ROAD_HALF) return true;
    return false;
  }

  function isOnSidewalk(x, z) {
    for (const rx of roadXs) if (Math.abs(x - rx) > ROAD_HALF && Math.abs(x - rx) < CURB) return true;
    for (const rz of roadZs) if (Math.abs(z - rz) > ROAD_HALF && Math.abs(z - rz) < CURB) return true;
    return false;
  }

  function isFree(x, z, pad = 0.8) {
    if (x < -LAND_HALF + 8 || x > LAND_HALF - 8 || z < -LAND_HALF + 8 || z > LAND_HALF - 8) return false;
    for (const c of colliders) {
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return false;
    }
    return true;
  }

  // A random point on a sidewalk, used to spawn pedestrians near the player.
  function randomSidewalkPoint(r2, cx, cz, radius) {
    for (let tries = 0; tries < 24; tries++) {
      const x = cx + r2.range(-radius, radius);
      const z = cz + r2.range(-radius, radius);
      if (isOnSidewalk(x, z) && isFree(x, z, 1.2)) return { x, z };
    }
    return null;
  }

  // Named places the story uses.
  // Everything the story needs sits on a sidewalk, so a marker never lands
  // inside a building.
  const WALK = ROAD_HALF + SIDEWALK_W * 0.5;
  const spots = {
    motel: { x: xs[6] + WALK, z: xs[6] + 22 },
    docks: { x: xs[2] + WALK, z: -300 },
    club: { x: xs[7] + WALK, z: xs[4] + 40 },
    marina: { x: xs[7] + WALK, z: xs[7] + 28 },
    park: { x: xs[4] + WALK, z: 330 },
    tower: { x: xs[4] - WALK, z: xs[3] + 30 },
    garage: { x: xs[5] + WALK, z: xs[6] + 66 },
    pier: { x: xs[0] - WALK, z: xs[4] + 26 },
    habana: { x: xs[7] + WALK, z: xs[5] + 44 },
    strip: { x: xs[0] + WALK, z: xs[4] + 40 },
  };

  // Road segments for the minimap.
  const mapRoads = [];
  for (const x of roadXs) mapRoads.push({ x0: x, z0: -LAND_HALF, x1: x, z1: LAND_HALF, w: ROAD_HALF * 2 });
  for (const z of roadZs) mapRoads.push({ x0: -LAND_HALF, z0: z, x1: LAND_HALF, z1: z, w: ROAD_HALF * 2 });

  const api = {
    group,
    seed,
    colliders,
    blocks,
    roads: { xs: roadXs, zs: roadZs },
    mapRoads,
    spots,
    beach: { x0: BEACH_X0, x1: BEACH_X1 },
    landHalf: LAND_HALF,
    roadHalf: ROAD_HALF,
    nodeAt,
    nearestNode,
    isOnRoad,
    isOnSidewalk,
    isFree,
    randomSidewalkPoint,
    districtOf,
    addNeon(text, color, x, y, z, ry = 0, w = 10, h = 2.5) {
      const tex = TEX.neonSign(text, color);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
      );
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      group.add(mesh);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 1.6, h * 3),
        new THREE.MeshBasicMaterial({
          map: TEX.radialSprite('rgba(255,255,255,0.45)', 'rgba(255,255,255,0)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.35,
        })
      );
      glow.position.set(x - Math.sin(ry) * 0.25, y, z - Math.cos(ry) * 0.25);
      glow.rotation.y = ry;
      group.add(glow);
      return mesh;
    },
    // Lights come alive at dusk; walk the city materials once a frame.
    setNight(f) {
      for (const child of group.children) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.userData && m.userData.nightGlow) m.emissiveIntensity = f * m.userData.nightGlow;
          else if (m.isMeshBasicMaterial && m.map && m.blending === THREE.AdditiveBlending) m.opacity = f * 0.8;
        }
      }
    },
    update(dt, time) {
      const t = TEX.water();
      t.offset.y = (time * 0.004) % 1;
      t.offset.x = Math.sin(time * 0.03) * 0.01;
    },
  };
  return api;
}

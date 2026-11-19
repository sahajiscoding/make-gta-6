// Every texture in Solara Bay is painted here with the 2D canvas API, so the game
// ships with no image files at all and nothing is ever fetched over the network.
import * as THREE from 'three';
import { RNG, clamp01, lerp } from './util.js';

const cache = new Map();
let aniso = 4;

export function setAnisotropy(n) {
  aniso = n;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function speckle(ctx, w, h, rng, count, alpha, size) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const v = rng.range(-alpha, alpha);
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(x, y, size, size);
  }
}

export function asphalt() {
  return cached('asphalt', () => {
    const w = 256;
    const c = canvas(w, w);
    const ctx = c.getContext('2d');
    const rng = new RNG(11);
    ctx.fillStyle = '#6b6e73';
    ctx.fillRect(0, 0, w, w);
    // patched tar seams
    ctx.strokeStyle = 'rgba(28,28,32,0.28)';
    for (let i = 0; i < 5; i++) {
      ctx.lineWidth = rng.range(0.8, 1.8);
      ctx.beginPath();
      let x = rng.range(0, w);
      let y = 0;
      ctx.moveTo(x, y);
      while (y < w) {
        y += rng.range(10, 30);
        x += rng.range(-8, 8);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    speckle(ctx, w, w, rng, 3000, 0.1, 1.5);
    return toTexture(c, { repeat: [1, 1] });
  });
}

// ---------------------------------------------------------------- surface relief
// A height field turned into a tangent-space normal map. Everything here is
// authored as a little canvas, so relief costs no download and tiles with the
// colour map it belongs to — which is what stops a flat plane reading as paper.
function normalFromHeight(hc, strength) {
  const w = hc.width;
  const h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function gravelHeight(seed, tint = 128, count = 9000, grain = 1.7) {
  const w = 256;
  const hc = canvas(w, w);
  const ctx = hc.getContext('2d');
  const rng = new RNG(seed);
  ctx.fillStyle = `rgb(${tint},${tint},${tint})`;
  ctx.fillRect(0, 0, w, w);
  for (let i = 0; i < count; i++) {
    const v = Math.round(rng.range(-70, 70));
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, w), grain, grain);
  }
  return hc;
}

export function asphaltNormal() {
  return cached('asphalt.n', () => {
    const hc = gravelHeight(17, 128, 12000, 1.8);
    const ctx = hc.getContext('2d');
    const rng = new RNG(19);
    // coarse aggregate and old tar seams cut into the surface
    ctx.strokeStyle = 'rgba(40,40,40,0.9)';
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = rng.range(1.5, 3.5);
      ctx.beginPath();
      let x = rng.range(0, 256);
      let y = 0;
      ctx.moveTo(x, y);
      while (y < 256) {
        y += rng.range(12, 34);
        x += rng.range(-10, 10);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return normalFromHeight(hc, 2.4);
  });
}

export function sidewalkNormal() {
  return cached('sidewalk.n', () => {
    const hc = gravelHeight(29, 150, 5000, 1.5);
    const ctx = hc.getContext('2d');
    // the grooves between slabs
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * 256;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 256);
      ctx.moveTo(0, p);
      ctx.lineTo(256, p);
      ctx.stroke();
    }
    return normalFromHeight(hc, 2.0);
  });
}

export function concreteNormal() {
  return cached('concrete.n', () => normalFromHeight(gravelHeight(37, 140, 7000, 1.6), 1.2));
}

export function sidewalk() {
  return cached('sidewalk', () => {
    const w = 256;
    const c = canvas(w, w);
    const ctx = c.getContext('2d');
    const rng = new RNG(23);
    ctx.fillStyle = '#9c9a92';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(60,60,58,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * w;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, w);
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }
    speckle(ctx, w, w, rng, 2600, 0.1, 1.4);
    return toTexture(c, { repeat: [1, 1] });
  });
}

export function sand() {
  return cached('sand', () => {
    const w = 256;
    const c = canvas(w, w);
    const ctx = c.getContext('2d');
    const rng = new RNG(31);
    ctx.fillStyle = '#e3cfa2';
    ctx.fillRect(0, 0, w, w);
    speckle(ctx, w, w, rng, 6000, 0.12, 1.5);
    return toTexture(c, { repeat: [1, 1] });
  });
}

export function grass() {
  return cached('grass', () => {
    const w = 256;
    const c = canvas(w, w);
    const ctx = c.getContext('2d');
    const rng = new RNG(37);
    ctx.fillStyle = '#4d7a3a';
    ctx.fillRect(0, 0, w, w);
    for (let i = 0; i < 4000; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, w);
      ctx.strokeStyle = `rgba(${rng.int(60, 120)},${rng.int(110, 170)},${rng.int(50, 90)},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-2, 2), y - rng.range(2, 6));
      ctx.stroke();
    }
    return toTexture(c, { repeat: [1, 1] });
  });
}

export function concrete(tint = '#b9b6ad') {
  return cached('concrete' + tint, () => {
    const w = 256;
    const c = canvas(w, w);
    const ctx = c.getContext('2d');
    const rng = new RNG(41 + tint.length);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, w);
    speckle(ctx, w, w, rng, 3000, 0.08, 2);
    return toTexture(c, { repeat: [1, 1] });
  });
}

export function water() {
  return cached('water', () => {
    const w = 512;
    const c = canvas(w, w);
    const ctx = c.getContext('2d');
    const rng = new RNG(53);
    const g = ctx.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, '#1d7f96');
    g.addColorStop(0.5, '#17708a');
    g.addColorStop(1, '#1a7d94');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    ctx.lineWidth = 2;
    for (let i = 0; i < 260; i++) {
      const y = rng.range(0, w);
      const x = rng.range(0, w);
      const len = rng.range(8, 46);
      ctx.strokeStyle = `rgba(200,245,255,${rng.range(0.03, 0.13)})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len * 0.5, y - rng.range(1, 4), x + len, y);
      ctx.stroke();
    }
    return toTexture(c, { repeat: [12, 12] });
  });
}

// Building facades: a tinted body with a grid of windows, plus a matching
// emissive map so the same building lights up after sunset.
export function facade(opts) {
  const {
    key,
    body = '#c9c3b4',
    windowColor = '#38424e',
    litColor = '#ffd9a0',
    cols = 6,
    rows = 8,
    lit = 0.45,
    seed = 7,
    frames = true,
    trim = true,
  } = opts;
  return cached('facade' + key, () => {
    // 512 rather than 256: a facade covers several storeys, so the texel
    // density on a wall the player walks past has to match the road's.
    const S = 512;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const e = canvas(S, S);
    const ectx = e.getContext('2d');
    const rng = new RNG(seed);
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, S, S);

    // weather and grime, concentrated near the sills where water runs
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.01, 0.05)})`;
      ctx.fillRect(x, y, rng.range(2, 16), rng.range(2, 12));
    }
    for (let i = 0; i < 26; i++) {
      const x = rng.range(0, S);
      const w = rng.range(2, 9);
      const g = ctx.createLinearGradient(0, 0, 0, rng.range(60, 240));
      g.addColorStop(0, 'rgba(0,0,0,0.13)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, S);
    }

    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, S, S);
    const cw = S / cols;
    const ch = S / rows;

    for (let r = 0; r < rows; r++) {
      // storey band: a lit edge and a shadow line read as a floor slab
      if (trim) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(0, r * ch + 1, S, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, r * ch + ch - 4, S, 4);
      }
      for (let col = 0; col < cols; col++) {
        const w = cw * 0.6;
        const h = ch * 0.58;
        const x = col * cw + (cw - w) / 2;
        const y = r * ch + ch * 0.2;
        // reveal: the wall is thicker than the glass, so the frame casts a lip
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x - 4, y - 5, w + 8, 2);

        const glass = ctx.createLinearGradient(0, y, 0, y + h);
        glass.addColorStop(0, '#9db6c9');
        glass.addColorStop(0.45, windowColor);
        glass.addColorStop(1, '#1d2530');
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, w, h);
        // the sky catching the pane
        const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
        sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0.03)');
        sheen.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = sheen;
        ctx.fillRect(x, y, w, h);
        if (frames) {
          ctx.strokeStyle = 'rgba(24,26,30,0.65)';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
          // mullion
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x + w / 2, y);
          ctx.lineTo(x + w / 2, y + h);
          ctx.stroke();
        }
        // sill
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(x - 6, y + h + 2, w + 12, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x - 6, y + h + 5, w + 12, 2);

        // the odd balcony with a railing, drawn into the wall itself
        if (r % 3 === 1 && rng.chance(0.5)) {
          ctx.fillStyle = 'rgba(40,42,46,0.5)';
          ctx.fillRect(x - 10, y + h + 8, w + 20, 4);
          ctx.strokeStyle = 'rgba(30,32,36,0.45)';
          ctx.lineWidth = 1.5;
          for (let b = 0; b < 6; b++) {
            const bx = x - 10 + ((w + 20) / 6) * b;
            ctx.beginPath();
            ctx.moveTo(bx, y + h + 12);
            ctx.lineTo(bx, y + h + 28);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(x - 10, y + h + 28);
          ctx.lineTo(x + w + 10, y + h + 28);
          ctx.stroke();
        }

        if (rng.chance(lit)) {
          ectx.fillStyle = litColor;
          ectx.globalAlpha = rng.range(0.4, 1);
          ectx.fillRect(x, y, w, h);
          // interior shapes: a lamp, a curtain, a person at the window
          ectx.globalAlpha = rng.range(0.15, 0.5);
          ectx.fillStyle = rng.chance(0.5) ? '#ffbf7a' : '#ffe9c4';
          ectx.fillRect(x + w * rng.range(0.05, 0.6), y + h * rng.range(0.05, 0.5), w * 0.3, h * 0.35);
          ectx.globalAlpha = 1;
        }
      }
    }
    return {
      map: toTexture(c, { repeat: [1, 1] }),
      emissive: toTexture(e, { repeat: [1, 1] }),
    };
  });
}

export function stucco(color, seed) {
  return cached('stucco' + color + seed, () => {
    const S = 128;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const rng = new RNG(seed);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rng.range(0, 0.05)})`;
      ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(2, 8), rng.range(2, 8));
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, S - 6, S - 6);
    return toTexture(c, { repeat: [1, 1] });
  });
}

export function palmFrond() {
  return cached('palmFrond', () => {
    const S = 256;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    // one big frond: a solid spine with filled leaflets fanning out from it
    const baseX = S / 2;
    const baseY = S - 6;
    const tipX = S / 2 + 12;
    const tipY = 14;
    const g = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
    g.addColorStop(0, '#24501f');
    g.addColorStop(0.55, '#3c7a2e');
    g.addColorStop(1, '#7db83f');
    ctx.fillStyle = g;
    const leaves = 26;
    for (let i = 0; i < leaves; i++) {
      const t = i / leaves;
      const y = baseY - t * (baseY - tipY);
      const len = 118 * (1 - t * 0.62);
      const droop = 26 * t;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(baseX, y);
        ctx.quadraticCurveTo(baseX + side * len * 0.55, y - 22 - droop * 0.2, baseX + side * len, y - 34 + droop);
        ctx.quadraticCurveTo(baseX + side * len * 0.5, y - 6, baseX, y);
        ctx.closePath();
        ctx.fill();
      }
    }
    // spine
    ctx.strokeStyle = '#2e5a24';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX + 8, (baseY + tipY) / 2, tipX, tipY);
    ctx.stroke();
    return toTexture(c);
  });
}

export function neonSign(text, color, bg = '#12061c') {
  return cached('neon' + text + color, () => {
    const w = 512;
    const h = 128;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 74px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 4);
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.65;
    ctx.fillText(text, w / 2, h / 2 + 4);
    ctx.globalAlpha = 1;
    return toTexture(c);
  });
}

export function containerSkin(color) {
  return cached('container' + color, () => {
    const S = 128;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, 0, 3, S);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 4, 0, 2, S);
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(90,50,30,${Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 6, 6);
    }
    return toTexture(c);
  });
}

export function storefrontSkin(seed, tint) {
  return cached('store' + seed, () => {
    const S = 128;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const rng = new RNG(seed);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(20,26,34,0.85)';
    ctx.fillRect(8, 40, S - 16, S - 56);
    ctx.fillStyle = 'rgba(180,220,255,0.25)';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(10 + i * 18, 44, 6, S - 64);
    }
    ctx.fillStyle = rng.pick(['#5e3230', '#2b4d3c', '#6b5628', '#2f3f5c', '#42354a']);
    ctx.fillRect(0, 0, S, 26);
    ctx.fillStyle = 'rgba(240,238,225,0.55)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(12 + i * 26, 10, rng.range(10, 18), 5);
    }
    return toTexture(c);
  });
}

// Soft round sprite used for shadows, smoke, dust and headlight glows.
// A soft blob laid on the ground under anything that stands on it. Real shadow
// maps handle the sun; this is the contact darkening that stops a car floating
// on the asphalt and keeps characters readable after dark.
export function shadowBlob() {
  return cached('shadow.blob', () => {
    const S = 128;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function contactShadow(w, l, opacity = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshBasicMaterial({ map: shadowBlob(), transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.035;
  m.renderOrder = 2;
  return m;
}

export function radialSprite(inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)') {
  return cached('radial' + inner + outer, () => {
    const S = 128;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.28)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c);
  });
}

// Tileable road paint used as decals (dashes, crosswalks, arrows).
export function paintTexture(kind = 'dash') {
  return cached('paint' + kind, () => {
    const S = 64;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(240,238,225,0.85)';
    if (kind === 'dash') {
      ctx.fillRect(S * 0.42, 0, S * 0.16, S * 0.55);
    } else {
      ctx.fillRect(0, S * 0.35, S, S * 0.3);
    }
    const t = toTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, clamp01(t)));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, clamp01(t)));
  const bl = Math.round(lerp(pa & 255, pb & 255, clamp01(t)));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

export function disposeTextureCache() {
  for (const v of cache.values()) {
    if (v && v.dispose) v.dispose();
    else if (v && v.map) {
      v.map.dispose();
      v.emissive.dispose();
    }
  }
  cache.clear();
}

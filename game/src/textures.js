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
    ctx.fillStyle = '#33343a';
    ctx.fillRect(0, 0, w, w);
    // patched tar seams
    ctx.strokeStyle = 'rgba(18,18,22,0.55)';
    for (let i = 0; i < 5; i++) {
      ctx.lineWidth = rng.range(1, 3);
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
    speckle(ctx, w, w, rng, 5200, 0.14, 1.6);
    return toTexture(c, { repeat: [1, 1] });
  });
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
    const S = 256;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    const e = canvas(S, S);
    const ectx = e.getContext('2d');
    const rng = new RNG(seed);
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, S, S);
    // subtle grime so big walls do not read as flat color
    for (let i = 0; i < 900; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.01, 0.06)})`;
      ctx.fillRect(x, y, rng.range(2, 14), rng.range(2, 10));
    }
    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, S, S);
    const cw = S / cols;
    const ch = S / rows;
    const pad = Math.min(cw, ch) * 0.22;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = col * cw + pad * 0.6;
        const y = r * ch + pad;
        const w = cw - pad * 1.2;
        const h = ch - pad * 1.8;
        ctx.fillStyle = windowColor;
        ctx.fillRect(x, y, w, h);
        // glass sheen
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, 'rgba(255,255,255,0.18)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.02)');
        g.addColorStop(1, 'rgba(0,0,0,0.16)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        if (frames) {
          ctx.strokeStyle = 'rgba(30,30,32,0.5)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, w, h);
        }
        if (rng.chance(lit)) {
          ectx.fillStyle = litColor;
          ectx.globalAlpha = rng.range(0.45, 1);
          ectx.fillRect(x, y, w, h);
          ectx.globalAlpha = 1;
        }
      }
      if (trim) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, (r + 1) * ch - 2, S, 2);
      }
    }
    return {
      map: toTexture(c, { repeat: [1, 1] }),
      emissive: toTexture(e, { repeat: [1, 1] }),
    };
  });
}

// Little Habana style stucco: warm pastel with painted trim and small windows.
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

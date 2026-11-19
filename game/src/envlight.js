// Solara Bay — sky light.
//
// A flat hemisphere of ambient plus one directional sun gives you lit geometry,
// never a world. So every sky preset here is also baked, once per change, into
// an equirectangular panorama (gradient + sun disc + haze band) and filtered by
// PMREM into a real environment map. That single map is what puts city colour in
// car paint, sky in chrome, a warm bounce in the underside of an awning, and it
// is the cheapest large step toward a physical look.
import * as THREE from 'three';

const W = 512;
const H = 256;

export function createEnvLight(renderer, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  let target = null;
  let broken = false;
  let since = 99;
  let lastKey = '';

  function paint(sky) {
    const top = sky.top;
    const bottom = sky.bottom;
    const fog = sky.fog;

    // vertical gradient: zenith to horizon haze to the ground bounce
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, `#${top.getHexString()}`);
    g.addColorStop(0.42, `#${top.clone().lerp(fog, 0.55).getHexString()}`);
    g.addColorStop(0.5, `#${fog.getHexString()}`);
    g.addColorStop(0.62, `#${fog.clone().lerp(bottom, 0.75).getHexString()}`);
    g.addColorStop(1.0, `#${bottom.getHexString()}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun disc, an equirect blob at the sun's real bearing and height
    const d = sky.sunDir;
    const u = 0.5 + Math.atan2(d.z, d.x) / (Math.PI * 2);
    const v = 0.5 + Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI;
    const sx = u * W;
    const sy = (1 - v) * H;
    const warm = sky.sunColor.getHexString();
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.42);
    const disc = Math.max(0, d.y) * 0.9 + 0.1;
    glow.addColorStop(0.0, `rgba(255,255,255,${0.95 * disc})`);
    glow.addColorStop(0.06, `rgba(${hexToRgb(warm)},${0.85 * disc})`);
    glow.addColorStop(0.28, `rgba(${hexToRgb(warm)},${0.28 * disc})`);
    glow.addColorStop(1.0, `rgba(${hexToRgb(warm)},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // street light spill low on the horizon at night, so the city still glows
    if (sky.night > 0.02) {
      const spill = ctx.createLinearGradient(0, H * 0.62, 0, H);
      spill.addColorStop(0, 'rgba(0,0,0,0)');
      spill.addColorStop(1, `rgba(255,196,140,${0.22 * sky.night})`);
      ctx.fillStyle = spill;
      ctx.fillRect(0, 0, W, H);
    }

    // pull the panorama toward its own luminance: a saturated sky is right
    // overhead and wrong as ambient light (it turns grey asphalt violet)
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(128,128,128,0.8)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    tex.needsUpdate = true;
    if (target) target.dispose();
    target = pmrem.fromEquirectangular(tex);
    scene.environment = target.texture;
    scene.environmentIntensity = sky.envIntensity ?? 1.0;
  }

  const api = {
    // sky = { top, bottom, fog, sunDir, sunColor, night, envIntensity }
    update(sky, force = false) {
      const key = [
        sky.top.getHexString(),
        sky.bottom.getHexString(),
        sky.fog.getHexString(),
        sky.sunColor.getHexString(),
        (sky.night ?? 0).toFixed(2),
        sky.sunDir.x.toFixed(2),
        sky.sunDir.y.toFixed(2),
      ].join('|');
      since += 1;
      // filtering a panorama is not free: never twice in the same three frames,
      // and only when the sky actually moved
      if (!force) {
        if (since < 3) return;
        if (key === lastKey) return;
      }
      since = 0;
      lastKey = key;
      if (broken) return;
      try {
        paint(sky);
      } catch (err) {
        // no float targets or no GL at all (headless tests): keep the lights
        // that do work and stop trying
        broken = true;
        console.warn('Solara Bay: environment map unavailable', err);
      }
    },
    dispose() {
      if (target) target.dispose();
      pmrem.dispose();
      tex.dispose();
    },
  };
  return api;
}

function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

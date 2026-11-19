// Solara Bay — the frame pipeline.
//
// The scene is rendered into a half-float target (with multisampling, so edges
// stay clean), the bright parts are pulled out and blurred for bloom, and a
// single composite pass does the ACES tonemap, the split-tone grade, the
// vignette and a little grain. Materials never tonemap themselves: every frame
// leaves through this pass, which is what keeps day, dusk and night looking
// like one film rather than three settings.
import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform float threshold;
  uniform float knee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float w = smoothstep(threshold, threshold + knee, l);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tScene, vUv).rgb * 0.2270270270;
    s += texture2D(tScene, vUv + dir * 1.3846153846).rgb * 0.3162162162;
    s += texture2D(tScene, vUv - dir * 1.3846153846).rgb * 0.3162162162;
    s += texture2D(tScene, vUv + dir * 3.2307692308).rgb * 0.0702702703;
    s += texture2D(tScene, vUv - dir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float exposure;
  uniform float bloomStrength;
  uniform float vignette;
  uniform float grain;
  uniform float saturation;
  uniform float contrast;
  uniform float time;
  varying vec2 vUv;

  // Narkowicz's ACES fit: cheap, and it rolls highlights off instead of clipping.
  vec3 aces(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    c += texture2D(tBloom, vUv).rgb * bloomStrength;
    c *= exposure;
    c = aces(c);

    // split-tone: cool the shadows, keep the highlights warm
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c += 0.050 * smoothstep(0.34, 0.0, l) * vec3(-0.10, 0.03, 0.15);
    c += 0.045 * smoothstep(0.55, 1.0, l) * vec3(0.16, 0.06, -0.11);

    c = mix(vec3(l), c, saturation);
    c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);

    vec2 q = vUv - 0.5;
    float vig = smoothstep(0.98, 0.34, length(q) * 1.26);
    c *= mix(1.0, vig, vignette);

    float n = hash(vUv * vec2(1281.0, 719.0) + fract(time) * 91.7);
    c += (n - 0.5) * grain;

    // linear -> sRGB, because a raw ShaderMaterial gets no automatic conversion
    c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export function createPost(renderer, scene, camera) {
  const size = new THREE.Vector2(1, 1);
  const halfFloat = renderer.capabilities.isWebGL2;
  const type = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const maxSamples = renderer.capabilities.maxSamples ?? 0;

  const rtScene = new THREE.WebGLRenderTarget(1, 1, {
    type,
    samples: Math.min(4, maxSamples),
    depthBuffer: true,
    stencilBuffer: false,
    colorSpace: THREE.NoColorSpace,
  });
  const rtBloomA = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, colorSpace: THREE.NoColorSpace });
  const rtBloomB = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, colorSpace: THREE.NoColorSpace });

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: rtScene.texture }, threshold: { value: 1.25 }, knee: { value: 0.9 } },
    vertexShader: VERT,
    fragmentShader: BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, dir: { value: new THREE.Vector2() } },
    vertexShader: VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: rtScene.texture },
      tBloom: { value: rtBloomB.texture },
      exposure: { value: 1.0 },
      bloomStrength: { value: 0.34 },
      vignette: { value: 0.6 },
      grain: { value: 0.011 },
      saturation: { value: 1.05 },
      contrast: { value: 1.11 },
      time: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  const api = {
    uniforms: compMat.uniforms,
    enabled: true,
    setSize(w, h, pixelRatio = 1) {
      const W = Math.max(1, Math.floor(w * pixelRatio));
      const H = Math.max(1, Math.floor(h * pixelRatio));
      size.set(W, H);
      rtScene.setSize(W, H);
      const bw = Math.max(1, Math.floor(W / 4));
      const bh = Math.max(1, Math.floor(H / 4));
      rtBloomA.setSize(bw, bh);
      rtBloomB.setSize(bw, bh);
      blurMat.uniforms.dir.value.set(1 / bw, 0);
    },
    render(dt = 1 / 60) {
      compMat.uniforms.time.value += dt;
      if (!api.enabled) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      // 1. the world, in linear half-float
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);

      // 2. bright pass at quarter resolution
      pass(brightMat, rtBloomA);

      // 3. two separable blurs (a wide, soft glow for the same cost as one tap)
      blurMat.uniforms.tScene.value = rtBloomA.texture;
      blurMat.uniforms.dir.value.set(1.4 / rtBloomA.width, 0);
      pass(blurMat, rtBloomB);
      blurMat.uniforms.tScene.value = rtBloomB.texture;
      blurMat.uniforms.dir.value.set(0, 1.4 / rtBloomA.height);
      pass(blurMat, rtBloomA);
      blurMat.uniforms.tScene.value = rtBloomA.texture;
      blurMat.uniforms.dir.value.set(2.6 / rtBloomA.width, 0);
      pass(blurMat, rtBloomB);

      // 4. tonemap, grade, vignette, grain, to the canvas
      pass(compMat, null);
    },
  };
  return api;
}

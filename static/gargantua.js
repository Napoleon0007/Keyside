// gargantua.js — a real-time, gravitationally-lensed black hole (Schwarzschild).
// A single full-screen quad runs a raymarching fragment shader that bends photon
// paths around the event horizon: the starfield warps, and the accretion disk's far
// side is lensed up and over the void — the Interstellar "halo". Drag to orbit the
// disk, scroll/pinch to fall toward the horizon, idle = slow cinematic auto-orbit.
//
// Self-contained + defensive: if WebGL can't start, or the framerate collapses on a
// weak device, it reveals the static fallback image and stops — it never crashes the
// page. Pauses when the tab is hidden. Remove by deleting this file, gargantua.css and
// templates/gargantua.html.

import * as THREE from 'three';

const slot = document.getElementById('hole');
const fallback = document.getElementById('ggFallback');

function showFallback() {
  if (fallback) fallback.hidden = false;
}

function boot(canvas, renderer) {
  'use strict';
  if (location.search.indexOf('ggdebug') >= 0) {
    window.__ggGL = renderer.getContext();
    window.__ggDraw = () => { updateCamera(); renderer.render(scene, cam); };   // synchronous draw for headless readback
    window.__ggSet = (o) => {
      if (o.theta != null) theta = o.theta;
      if (o.phi != null) phi = o.phi;
      if (o.dist != null) dist = o.dist;
      if (o.fall != null) uniforms.uFall.value = o.fall;
      if (o.time != null) uniforms.uTime.value = o.time;
    };
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.matchMedia('(max-width: 820px)').matches
    || (('ontouchstart' in window) && Math.min(screen.width, screen.height) < 820);

  // Raymarch step count — the single biggest perf lever. Fewer steps on phones.
  const STEPS = isMobile ? 160 : 320;
  // Internal render scale: a raymarcher is fill-rate bound, so we render small and let
  // CSS stretch the canvas. Tuned down further by the adaptive watchdog if needed.
  let renderScale = isMobile ? 0.55 : Math.min(window.devicePixelRatio, 1.4) * 0.85;

  renderer.setPixelRatio(1);              // we manage internal resolution ourselves
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const cam = new THREE.Camera();          // full-screen quad: no projection needed
  const geo = new THREE.PlaneGeometry(2, 2);

  const uniforms = {
    uTime:     { value: 0 },
    uRes:      { value: new THREE.Vector2(1, 1) },
    uCamPos:   { value: new THREE.Vector3() },
    uForward:  { value: new THREE.Vector3() },
    uRight:    { value: new THREE.Vector3() },
    uUp:       { value: new THREE.Vector3() },
    uTanHalf:  { value: Math.tan((58 * Math.PI / 180) / 2) },
    uDiskIn:   { value: 2.6 },
    uDiskOut:  { value: 11.5 },
    uFall:     { value: 0 },              // 0..1 fall-in intensity (redshift + vignette)
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: FRAG.replace(/__STEPS__/g, String(STEPS)),
  });
  scene.add(new THREE.Mesh(geo, mat));

  // ── Camera orbit state ──────────────────────────────────────────────────────
  let theta = 0.6;          // azimuth
  let phi = 0.16;           // elevation — small, so we see the disk nearly edge-on
  let dist = 12.0;          // distance from the hole
  const DIST_MIN = 2.6, DIST_MAX = 24.0;
  let lastInput = -999;     // time of last user interaction (for idle auto-orbit)

  function updateCamera() {
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const ct = Math.cos(theta), st = Math.sin(theta);
    const pos = uniforms.uCamPos.value.set(dist * cp * ct, dist * sp, dist * cp * st);
    const fwd = uniforms.uForward.value.copy(pos).multiplyScalar(-1).normalize();
    const right = uniforms.uRight.value.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    uniforms.uUp.value.crossVectors(right, fwd).normalize();
  }

  function resize() {
    const w = Math.max(1, Math.floor(window.innerWidth * renderScale));
    const h = Math.max(1, Math.floor(window.innerHeight * renderScale));
    renderer.setSize(w, h, false);          // false = don't touch CSS size; CSS stretches it
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    uniforms.uRes.value.set(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Interaction — drag to orbit, wheel/pinch to fall in/out ─────────────────
  const pointers = new Map();
  let pinchPrev = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInput = uniforms.uTime.value;
    cancelFall();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    lastInput = uniforms.uTime.value;
    if (pointers.size >= 2) {
      // pinch-zoom
      p.x = e.clientX; p.y = e.clientY;
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchPrev) dist *= Math.pow(pinchPrev / d, 1.0);
      dist = Math.min(DIST_MAX, Math.max(DIST_MIN, dist));
      pinchPrev = d;
    } else {
      theta -= (e.clientX - p.x) * 0.006;
      phi += (e.clientY - p.y) * 0.006;
      phi = Math.max(-1.45, Math.min(1.45, phi));   // clamp shy of the poles
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchPrev = 0; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dist *= (1 + e.deltaY * 0.0012);
    dist = Math.min(DIST_MAX, Math.max(DIST_MIN, dist));
    lastInput = uniforms.uTime.value;
    cancelFall();
  }, { passive: false });

  // ── "Fall in" — a guided dive to the horizon and back ───────────────────────
  let fallState = null;   // { phase: 'in'|'hold'|'out', t0, fromDist }
  const fallBtn = document.getElementById('fallBtn');
  function cancelFall() { fallState = null; uniforms.uFall.value *= 0.0; }
  fallBtn && fallBtn.addEventListener('click', () => {
    if (fallState) { cancelFall(); return; }
    fallState = { phase: 'in', t0: uniforms.uTime.value, fromDist: dist, toDist: DIST_MIN + 0.4 };
    lastInput = -999;   // let the dive take over
  });
  function stepFall(t, dt) {
    if (!fallState) {
      if (uniforms.uFall.value > 0.001) uniforms.uFall.value *= Math.pow(0.06, dt);
      else uniforms.uFall.value = 0;
      return;
    }
    const el = t - fallState.t0;
    if (fallState.phase === 'in') {
      const k = Math.min(1, el / 3.2);
      const e = k * k * (3 - 2 * k);                 // smoothstep
      dist = fallState.fromDist + (fallState.toDist - fallState.fromDist) * e;
      uniforms.uFall.value = e * 0.85;
      if (k >= 1) { fallState.phase = 'hold'; fallState.t0 = t; }
    } else if (fallState.phase === 'hold') {
      uniforms.uFall.value = 0.85 + 0.15 * Math.sin((t) * 1.4);
      if (t - fallState.t0 > 1.8) { fallState.phase = 'out'; fallState.t0 = t; fallState.fromDist = dist; }
    } else {
      const k = Math.min(1, (t - fallState.t0) / 3.0);
      const e = k * k * (3 - 2 * k);
      dist = fallState.fromDist + (12.0 - fallState.fromDist) * e;
      uniforms.uFall.value = 0.85 * (1 - e);
      if (k >= 1) { fallState = null; lastInput = t; }
    }
  }

  // ── Render loop with an adaptive-perf watchdog ──────────────────────────────
  let raf = 0, running = true, prevT = 0;
  const frameTimes = [];
  let scaleStep = 0;          // how many times we've dropped resolution

  function frame(ms) {
    if (!running) return;
    const t = ms / 1000;
    const rawDt = prevT ? t - prevT : 0.016;       // unclamped — the watchdog needs to see real stalls
    const dt = Math.min(0.05, rawDt);
    prevT = t;
    uniforms.uTime.value = t;

    // idle cinematic auto-orbit (unless reduced-motion or mid-dive)
    if (!reduced && !fallState && (t - lastInput) > 4.0) {
      theta += 0.035 * dt * 1.0;
      phi = 0.16 + Math.sin(t * 0.13) * 0.12;
    }
    stepFall(t, dt);
    updateCamera();
    renderer.render(scene, cam);

    // watchdog: sample frame time, step down resolution (then fall back) if it tanks
    frameTimes.push(rawDt);
    if (frameTimes.length >= 90) {
      const sorted = frameTimes.slice().sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      frameTimes.length = 0;
      if (median > 0.040 && scaleStep < 2) {           // < ~25fps
        scaleStep++; renderScale *= 0.7; resize();
      } else if (median > 0.055 && scaleStep >= 2) {   // still hopeless → static image
        running = false; cancelAnimationFrame(raf); showFallback();
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // pause when hidden (saves battery, avoids GPU stalls on resume)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!fallback || fallback.hidden) { running = true; prevT = 0; raf = requestAnimationFrame(frame); }
  });

  // fade the hint after a few seconds / first interaction
  const hint = document.getElementById('hint');
  if (hint) {
    const hide = () => hint.classList.add('gone');
    setTimeout(hide, 7000);
    canvas.addEventListener('pointerdown', hide, { once: true });
  }
}

// ── The shader ────────────────────────────────────────────────────────────────
const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform vec2  uRes;
uniform vec3  uCamPos;
uniform vec3  uForward;
uniform vec3  uRight;
uniform vec3  uUp;
uniform float uTanHalf;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uFall;

const float HORIZON = 1.0;     // Schwarzschild radius (event horizon) in shader units
const float ESCAPE  = 32.0;    // ray has left the scene
const float DT      = 0.16;    // base integration step

float hash1(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0)), c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

// Procedural starfield in a view direction (a few layers of sparse twinkling points).
vec3 starField(vec3 dir){
  vec3 col = vec3(0.0);
  for (int k = 0; k < 3; k++){
    float sc = 90.0 * pow(1.9, float(k));
    vec3 g = dir * sc;
    vec3 id = floor(g);
    vec3 fp = fract(g) - 0.5;
    float h = hash1(id + float(k) * 19.7);
    float present = step(0.93, h);
    vec3 off = (vec3(hash1(id + 1.3), hash1(id + 2.7), hash1(id + 5.1)) - 0.5) * 0.7;
    float d = length(fp - off);
    float b = present * smoothstep(0.16, 0.0, d);
    b *= 0.55 + 0.45 * sin(uTime * 1.5 + h * 30.0);
    vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.92, 0.82), hash1(id + 8.2));
    col += tint * b * (0.7 / float(k + 1));
  }
  // faint electric-blue haze so the void is never dead-flat
  col += vec3(0.012, 0.016, 0.032);
  return col;
}

// Emission from the accretion disk at a plane-crossing point 'hit', seen along 'rd'.
vec3 diskEmission(vec3 hit, vec3 rd){
  float rr = length(hit.xz);
  float t = (rr - uDiskIn) / (uDiskOut - uDiskIn);     // 0 inner .. 1 outer
  // temperature ramp: white-hot inner → Rex orange → deep red outer
  vec3 hot  = vec3(1.0, 0.96, 0.88);
  vec3 mid  = vec3(1.0, 0.42, 0.10);
  vec3 cool = vec3(0.5, 0.10, 0.02);
  vec3 base = mix(hot, mid, smoothstep(0.0, 0.4, t));
  base = mix(base, cool, smoothstep(0.4, 1.0, t));
  // spiral turbulence — arms winding inward, drifting in time
  float ang = atan(hit.z, hit.x);
  float spiral = ang * 2.0 - uTime * 0.9 - 7.0 / max(rr, 0.6);
  float arms = 0.55 + 0.45 * sin(spiral * 3.0);
  float turb = 0.6 + 0.5 * fbm(vec2(ang * 2.4 + uTime * 0.15, rr * 0.7));
  float bright = pow(1.0 - t, 1.5) * 2.4 + 0.18;       // brighter toward the inner edge
  // relativistic beaming — the orbital side sweeping toward us is brighter
  vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
  float beam = dot(tang, normalize(rd));
  float doppler = clamp(1.0 + 0.7 * beam, 0.35, 1.9);
  // soft inner/outer edges so the disk fades rather than hard-clips
  float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.86, 1.0, t));
  return base * bright * arms * turb * doppler * edge;
}

void main(){
  // ray direction for this pixel from the camera basis
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uRes.x / uRes.y;
  vec3 rd = normalize(uForward + uv.x * uTanHalf * uRight + uv.y * uTanHalf * uUp);

  // integrate the photon path under Schwarzschild deflection (rossning92 method):
  // acceleration toward the hole = -1.5 * h^2 * p / r^5, where h = |p x v| is conserved.
  vec3 p = uCamPos;
  vec3 v = rd;
  vec3 hvec = cross(p, v);
  float h2 = dot(hvec, hvec);

  vec3 col = vec3(0.0);
  bool captured = false;
  vec3 prevP = p;

  for (int i = 0; i < __STEPS__; i++){
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r < HORIZON) { captured = true; break; }
    if (r2 > ESCAPE * ESCAPE) break;

    vec3 acc = -1.5 * h2 * p / (r2 * r2 * r);          // p / r^5
    float dt = DT * (0.35 + 0.65 * clamp((r - HORIZON) / 6.0, 0.0, 1.0));   // smaller steps near the hole
    prevP = p;
    v += acc * dt;
    p += v * dt;

    // disk lives in the y = 0 plane — accumulate emission on every crossing
    // (the lensing makes a ray cross 2–3 times → the iconic top + bottom arcs)
    if (prevP.y * p.y < 0.0){
      float f = prevP.y / (prevP.y - p.y);
      vec3 hit = mix(prevP, p, f);
      float rr = length(hit.xz);
      if (rr > uDiskIn && rr < uDiskOut){
        col += diskEmission(hit, normalize(v));
      }
    }
  }

  // background stars only if the photon escaped (not swallowed)
  if (!captured) col += starField(normalize(v));

  // a thin bright photon ring hugging the shadow's edge (purely cosmetic lift)
  // — emphasises the silhouette where rays graze the photon sphere.
  // (handled implicitly by the disk lensing; left subtle on purpose)

  // fall-in grade: redshift + closing vignette as you approach the horizon
  if (uFall > 0.0){
    float vig = smoothstep(1.2, 0.2, length(vUv * 2.0 - 1.0));
    col *= mix(1.0, vig, uFall * 0.9);
    col = mix(col, col * vec3(1.25, 0.5, 0.28), uFall * 0.7);   // shift hot toward deep red
    col *= (1.0 - 0.35 * uFall);
  }

  // tone-map (Reinhard) so bright disk overlaps roll off instead of clipping flat white
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(0.85));                 // gentle lift in the mids
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Bootstrap (runs last, so FRAG above is initialised) ─────────────────────────
// Robust renderer creation — try a few option sets, each on a fresh canvas (a canvas
// caches a failed context, so a retry needs a new one). Mirrors the Three-Body page.
(function start() {
  let renderer = null;
  for (const o of [
    { antialias: false, powerPreference: 'high-performance' },
    { antialias: false, powerPreference: 'default' },
    { antialias: false },
    {},
  ]) {
    try { renderer = new THREE.WebGLRenderer(o); break; } catch (e) { renderer = null; }
  }
  if (!renderer) { showFallback(); return; }
  const canvas = renderer.domElement;
  canvas.id = 'hole';
  if (slot && slot.parentNode) slot.parentNode.replaceChild(canvas, slot);
  boot(canvas, renderer);
})();

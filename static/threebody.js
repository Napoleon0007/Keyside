// threebody.js — interactive 3D three-body gravity sandbox (Three.js).
// Drag a planet to place it, flick to throw it (sets its launch velocity), scroll
// on it to change its mass. Drag empty space to orbit the camera, scroll to zoom,
// double-click a planet to ride along. Press Run and watch full 3D Newtonian
// mutual gravity play out with glowing trails. Symplectic velocity-Verlet (dt 0.001).

import * as THREE from 'three';

const COLORS = [0xff5500, 0x33b6ff, 0xb06bff];
const NAMES  = ['Body I', 'Body II', 'Body III'];

const canvas = document.getElementById('sim');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('glfail')?.removeAttribute('hidden');
}

if (renderer) boot();

function boot() {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x03040a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03040a, 0.012);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 4000);

  scene.add(new THREE.AmbientLight(0x4060a0, 0.7));
  const ambient = new THREE.Group();
  ambient.add(makeStars(6000, 1.5, 0.9, 240, 1800));   // far, dense field
  ambient.add(makeStars(1800, 3.0, 1.0, 90, 700));     // nearer, brighter stars
  ambient.add(makeNebula());
  ambient.add(makeGalaxies());
  const dust = makeDust();                              // floaty motes near the action
  ambient.add(dust);
  scene.add(ambient);

  // Real bloom for that sharp neon-in-space glow (loaded lazily; falls back if it fails).
  let composer = null;
  (async () => {
    try {
      const base = 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/';
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import(base + 'EffectComposer.js'), import(base + 'RenderPass.js'), import(base + 'UnrealBloomPass.js'),
      ]);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.85, 0.65, 0.8));
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(canvas.clientWidth, canvas.clientHeight);
    } catch (e) { composer = null; }
  })();

  // ── simulation state ────────────────────────────────────────────────────────
  let G = 1.0, softening = 0.03, speed = 0.4, showTrails = true;
  let mode = 'setup';                     // 'setup' | 'running' | 'paused'
  let bodies = [];
  let manualEdited = false;               // user moved/resized a planet → auto-orbit on Run
  const TRAIL_MAX = 700;
  const glowTex = makeGlowTexture();

  function visRadius(m) { return Math.max(0.18, Math.cbrt(m) * 0.2); }

  function makeBody(x, y, z, vx, vy, vz, m, i) {
    const color = COLORS[i];
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.45, metalness: 0.1 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), mat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const light = new THREE.PointLight(color, 1.5, 60, 2);
    mesh.add(light);
    scene.add(mesh); scene.add(glow);

    const line = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(line);

    // generous invisible hit-sphere so the planet is easy to grab/drag
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(hit);

    return { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz), m, color: new THREE.Color(color), name: NAMES[i], mesh, glow, line, hit, trail: [] };
  }

  function clearBodies() { bodies.forEach(b => { scene.remove(b.mesh, b.glow, b.line, b.hit); }); bodies = []; }

  function applyVisual(b) {
    const r = visRadius(b.m);
    b.mesh.position.copy(b.pos); b.mesh.scale.setScalar(r);
    b.glow.position.copy(b.pos); b.glow.scale.setScalar(r * 7);
    b.hit.position.copy(b.pos); b.hit.scale.setScalar(Math.max(r * 2.8, 0.55));
  }

  // ── presets: the infinite symmetric family + free-form ──────────────────────
  function symmetric(p1, p2) {
    G = 1; softening = 0.0;
    clearBodies();
    bodies = [
      makeBody(-1, 0, 0, p1, p2, 0, 1, 0),
      makeBody( 1, 0, 0, p1, p2, 0, 1, 1),
      makeBody( 0, 0, 0, -2 * p1, -2 * p2, 0, 1, 2),
    ];
    camOrbit.radius = 4.6;
  }
  const SYM = {
    'figure-8':    [0.3471128135672417, 0.532726851767674],
    'butterfly':   [0.30689, 0.12551],
    'butterfly-2': [0.39295, 0.09758],
    'bumblebee':   [0.18428, 0.58719],
    'moth':        [0.46444, 0.39606],
    'moth-2':      [0.43917, 0.45297],
    'goggles':     [0.08330, 0.12789],
    'dragonfly':   [0.08058, 0.58884],
    'yin-yang':    [0.51394, 0.30474],
    'yarn':        [0.55906, 0.34919],
  };
  const PRESETS = {
    'orbit': () => { G = 1; softening = 0.02; clearBodies(); bodies = [
      makeBody(0, 0, 0, 0, 0, 0, 12, 0),
      makeBody(1.1, 0, 0, 0, 3.3, 0, 1, 1),
      makeBody(-1.7, 0, 0, 0, -2.6, 0.3, 1, 2),
    ]; camOrbit.radius = 6; },
    'chaos': () => { G = 1; softening = 0.03; clearBodies(); bodies = [
      makeBody(-1.0, 0.3, 0.2, 0.2, 0.25, -0.1, 4, 0),
      makeBody( 1.0, 0.0, -0.3, -0.1, -0.35, 0.15, 4, 1),
      makeBody( 0.1, -1.0, 0.1, 0.05, 0.15, 0.05, 4, 2),
    ]; camOrbit.radius = 6; },
    'random': () => { G = 1; softening = 0.03; clearBodies(); const r = () => (Math.random() * 2 - 1);
      bodies = [0, 1, 2].map(i => makeBody(r() * 1.2, r() * 1.2, r() * 1.2, r() * 0.6, r() * 0.6, r() * 0.6, 2 + Math.random() * 6, i));
      camOrbit.radius = 6; },
  };

  let currentPreset = 'figure-8';
  function loadPreset(name) {
    if (name === 'explore') symmetric(+$('vx').value, +$('vy').value);
    else if (SYM[name]) { symmetric(SYM[name][0], SYM[name][1]); if ($('vx')) { $('vx').value = SYM[name][0]; $('vy').value = SYM[name][1]; readout(); } }
    else PRESETS[name]();
    mode = 'setup';
    camOrbit.follow = -1; camTarget.set(0, 0, 0);
    bodies.forEach(b => { b.trail.length = 0; applyVisual(b); });
    updateRun();
  }

  // ── physics ──────────────────────────────────────────────────────────────────
  const _a = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function accel() {
    for (let i = 0; i < 3; i++) _a[i].set(0, 0, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const dx = bodies[j].pos.x - bodies[i].pos.x, dy = bodies[j].pos.y - bodies[i].pos.y, dz = bodies[j].pos.z - bodies[i].pos.z;
      const r2 = dx * dx + dy * dy + dz * dz + softening * softening;
      const inv = G * bodies[j].m / (r2 * Math.sqrt(r2));
      _a[i].x += inv * dx; _a[i].y += inv * dy; _a[i].z += inv * dz;
    }
  }
  function integrate(dt) {
    accel();
    for (let i = 0; i < 3; i++) { bodies[i].vel.addScaledVector(_a[i], 0.5 * dt); bodies[i].pos.addScaledVector(bodies[i].vel, dt); }
    accel();
    for (let i = 0; i < 3; i++) bodies[i].vel.addScaledVector(_a[i], 0.5 * dt);
  }

  // Auto-orbit: from any placement, hand each body a balanced tangential velocity
  // so the system swirls into a pleasing bound orbit — no physics knowledge needed.
  function autoOrbit() {
    const C = new THREE.Vector3(); let M = 0;
    bodies.forEach(b => { C.addScaledVector(b.pos, b.m); M += b.m; });
    C.multiplyScalar(1 / M);
    // spin axis = normal of the plane through the three bodies (fallback: up)
    let axis = new THREE.Vector3().subVectors(bodies[1].pos, bodies[0].pos)
      .cross(new THREE.Vector3().subVectors(bodies[2].pos, bodies[0].pos));
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0); else axis.normalize();
    bodies.forEach(b => {
      const r = new THREE.Vector3().subVectors(b.pos, C);
      const dist = Math.max(r.length(), 0.25);
      const tang = new THREE.Vector3().crossVectors(axis, r);
      if (tang.lengthSq() < 1e-6) tang.set(1, 0, 0);
      tang.normalize();
      b.vel.copy(tang).multiplyScalar(Math.sqrt(G * M / dist) * 0.55);  // sub-circular → bound ellipses
    });
    // zero the net momentum so the whole system stays centred on screen
    const P = new THREE.Vector3(); bodies.forEach(b => P.addScaledVector(b.vel, b.m));
    P.multiplyScalar(1 / M); bodies.forEach(b => b.vel.sub(P));
  }

  // ── camera (custom orbit) ─────────────────────────────────────────────────────
  const camOrbit = { theta: 0.6, phi: 1.15, radius: 5, follow: -1 };
  const camTarget = new THREE.Vector3();
  function updateCamera() {
    // target eases to followed body, else to the system's centre of mass
    const t = new THREE.Vector3();
    if (camOrbit.follow >= 0 && bodies[camOrbit.follow]) t.copy(bodies[camOrbit.follow].pos);
    else { let M = 0; bodies.forEach(b => { t.addScaledVector(b.pos, b.m); M += b.m; }); if (M) t.multiplyScalar(1 / M); }
    camTarget.lerp(t, 0.06);
    const sp = camOrbit.phi, st = camOrbit.theta, r = camOrbit.radius;
    camera.position.set(
      camTarget.x + r * Math.sin(sp) * Math.sin(st),
      camTarget.y + r * Math.cos(sp),
      camTarget.z + r * Math.sin(sp) * Math.cos(st),
    );
    camera.lookAt(camTarget);
  }

  // ── trails ─────────────────────────────────────────────────────────────────────
  function updateTrail(b) {
    const t = b.trail, n = t.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      pos[k * 3] = t[k].x; pos[k * 3 + 1] = t[k].y; pos[k * 3 + 2] = t[k].z;
      const a = (k / n) * 0.9;                  // older → dimmer (additive: dark = invisible)
      col[k * 3] = b.color.r * a; col[k * 3 + 1] = b.color.g * a; col[k * 3 + 2] = b.color.b * a;
    }
    b.line.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    b.line.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.line.geometry.setDrawRange(0, n);
    b.line.visible = showTrails && n > 1;
  }

  // ── render loop ────────────────────────────────────────────────────────────────
  function frame() {
    if (mode === 'running') {
      const dt = 0.001, sub = Math.max(1, Math.round(speed * 12));
      for (let s = 0; s < sub; s++) integrate(dt);
      for (const b of bodies) { b.trail.push(b.pos.clone()); if (b.trail.length > TRAIL_MAX) b.trail.shift(); }
    }
    bodies.forEach(b => { applyVisual(b); updateTrail(b); });
    updateCamera();
    ambient.rotation.y += 0.00018;          // whole cosmos drifts → floaty parallax
    dust.rotation.x += 0.0001;
    if (composer) composer.render(); else renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ── interaction ────────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  let dragBody = null, orbiting = false, lastX = 0, lastY = 0;

  function setNDC(e) { const r = canvas.getBoundingClientRect(); ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1; ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1; }
  function pickBody(e) { setNDC(e); raycaster.setFromCamera(ndc, camera); const hit = raycaster.intersectObjects(bodies.map(b => b.hit), false)[0]; return hit ? bodies.find(b => b.hit === hit.object) : null; }

  canvas.addEventListener('pointerdown', (e) => {
    const b = pickBody(e);                       // grab a planet anytime
    if (b) {
      if (mode === 'running') { mode = 'paused'; updateRun(); }   // grabbing pauses, so you can rearrange
      dragBody = b; manualEdited = true;
      const n = camera.getWorldDirection(new THREE.Vector3()).negate();
      dragPlane.setFromNormalAndCoplanarPoint(n, b.pos);
    } else { orbiting = true; lastX = e.clientX; lastY = e.clientY; }
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragBody) {
      setNDC(e); raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, hit)) { dragBody.pos.copy(hit); dragBody.vel.set(0, 0, 0); }
    } else if (orbiting) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      camOrbit.theta -= dx * 0.005;
      camOrbit.phi = Math.max(0.08, Math.min(Math.PI - 0.08, camOrbit.phi - dy * 0.005));
    } else {
      canvas.style.cursor = pickBody(e) ? 'grab' : 'default';
    }
  });
  function endPointer(e) {
    dragBody = null; orbiting = false; canvas.style.cursor = 'default';
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = pickBody(e);
    if (b) { b.m = Math.max(0.2, Math.min(40, b.m * (e.deltaY < 0 ? 1.12 : 0.89))); manualEdited = true; applyVisual(b); }
    else { camOrbit.radius = Math.max(1.2, Math.min(120, camOrbit.radius * (e.deltaY < 0 ? 0.9 : 1.1))); }
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const b = pickBody(e);
    camOrbit.follow = b ? bodies.indexOf(b) : -1;
  });

  // ── resize ───────────────────────────────────────────────────────────────────
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (composer) composer.setSize(w, h); }
  window.addEventListener('resize', resize);

  // ── UI ──────────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  function updateRun() { const r = $('run'); if (!r) return; r.textContent = (mode === 'running') ? '❚❚ Pause' : '▶ Run'; r.classList.toggle('is-running', mode === 'running'); }
  function readout() { const el = $('exploreReadout'); if (el && $('vx')) el.textContent = `v = (${(+$('vx').value).toFixed(3)}, ${(+$('vy').value).toFixed(3)})`; }

  $('run').addEventListener('click', () => {
    if (mode === 'running') { mode = 'paused'; }
    else { if (manualEdited) { autoOrbit(); manualEdited = false; } mode = 'running'; }
    updateRun();
  });
  $('reset').addEventListener('click', () => loadPreset(currentPreset));
  // "New orbit" → scatter three planets and auto-orbit them into a fresh dance.
  $('newOrbit') && $('newOrbit').addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    currentPreset = 'random'; PRESETS['random']();
    autoOrbit();
    camOrbit.follow = -1; camTarget.set(0, 0, 0);
    bodies.forEach(b => { b.trail.length = 0; applyVisual(b); });
    manualEdited = false; mode = 'running'; updateRun();
  });
  $('clear').addEventListener('click', () => bodies.forEach(b => b.trail.length = 0));
  $('speed').addEventListener('input', (e) => { speed = +e.target.value; $('speedVal').textContent = speed.toFixed(1) + '×'; });
  $('grav').addEventListener('input', (e) => { G = +e.target.value; $('gravVal').textContent = G.toFixed(2); });
  $('trails').addEventListener('change', (e) => { showTrails = e.target.checked; });

  document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentPreset = btn.dataset.preset; loadPreset(currentPreset);
  }));
  function explore() {
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    currentPreset = 'explore'; readout(); loadPreset('explore');
  }
  ['vx', 'vy'].forEach(id => $(id) && $(id).addEventListener('input', explore));
  $('surprise') && $('surprise').addEventListener('click', () => {
    $('vx').value = (Math.random() * 0.62 + 0.02).toFixed(3);
    $('vy').value = (Math.random() * 0.62 + 0.02).toFixed(3);
    explore();
  });

  // ── boot ──────────────────────────────────────────────────────────────────────
  resize();
  $('grav').value = G; $('gravVal').textContent = G.toFixed(2);
  $('speed').value = speed; $('speedVal').textContent = speed.toFixed(1) + '×';
  loadPreset('figure-8');
  mode = 'running'; updateRun();             // greet the user with motion, not a still frame
  requestAnimationFrame(frame);

  // ── scene assets ───────────────────────────────────────────────────────────────
  const starTex = starSprite();
  function makeStars(count, size, opacity, rMin, rMax) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const tint = [new THREE.Color(0xbfd4ff), new THREE.Color(0xffffff), new THREE.Color(0xffe6c0), new THREE.Color(0x9fc4ff)];
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.random() * (rMax - rMin), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); pos[i * 3 + 2] = r * Math.cos(ph);
      const c = tint[(Math.random() * tint.length) | 0], b = 0.6 + Math.random() * 0.4;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: starTex, transparent: true, opacity, depthWrite: false }));
  }
  function makeDust() {                              // soft motes drifting near the action
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = 6 + Math.random() * 44, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); pos[i * 3 + 2] = r * Math.cos(ph); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7fb0e0, size: 0.07, sizeAttenuation: true, map: starTex, transparent: true, opacity: 0.55, depthWrite: false }));
  }
  function makeNebula() {
    const grp = new THREE.Group();
    const cols = [0x2a1a4a, 0x10314f, 0x3a1530, 0x1a2c52, 0x2e1840];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexFor(cols[i]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45 }));
      const r = 90 + Math.random() * 120, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      s.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph) - 60);
      s.scale.setScalar(150 + Math.random() * 130); grp.add(s);
    }
    return grp;
  }
  function makeGalaxies() {                          // distant spiral galaxies for depth
    const grp = new THREE.Group();
    const cols = [0x6fa8ff, 0xff9ad1, 0xffd28a, 0x9d7bff, 0x7fe0c0];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: galaxyTex(cols[i % cols.length]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
      const r = 650 + Math.random() * 750, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      s.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph));
      s.material.rotation = Math.random() * Math.PI * 2; s.scale.setScalar(130 + Math.random() * 180); grp.add(s);
    }
    return grp;
  }
  function starSprite() {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.28, 'rgba(255,255,255,0.75)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function galaxyTex(colorInt) {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const col = new THREE.Color(colorInt), R = col.r * 255 | 0, G2 = col.g * 255 | 0, B = col.b * 255 | 0;
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.18, `rgba(${R},${G2},${B},0.6)`); rg.addColorStop(1, `rgba(${R},${G2},${B},0)`);
    g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(${R},${G2},${B},0.5)`; g.lineWidth = 2;
    for (let a = 0; a < 3; a++) { g.beginPath(); for (let t = 0; t < 6; t += 0.1) { const rad = t * 8, ang = t + a * 2.09; g.lineTo(s / 2 + Math.cos(ang) * rad, s / 2 + Math.sin(ang) * rad * 0.6); } g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function makeGlowTexture() { return glowTexFor(0xffffff); }
  function glowTexFor(colorInt) {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const col = new THREE.Color(colorInt), R = Math.round(col.r * 255), G2 = Math.round(col.g * 255), B = Math.round(col.b * 255);
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, `rgba(${R},${G2},${B},1)`); rg.addColorStop(0.4, `rgba(${R},${G2},${B},0.45)`); rg.addColorStop(1, `rgba(${R},${G2},${B},0)`);
    g.fillStyle = rg; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
}

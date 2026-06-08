// trinity.js — "The Trinity": a calm, never-ending three-body dance for the
// landing page (sits under Rex's World). Locked to the famous figure-8 — the one
// three-body configuration that is provably STABLE, so three glowing worlds chase
// each other forever with no chaos. Self-contained three.js, lazy (nothing spins up
// until it scrolls into view), pauses off-screen, honours reduced-motion, degrades
// silently without WebGL. A divergence guard re-seeds if numerics ever drift, so it
// can run indefinitely. Remove by deleting this file, its <script> tag in index.html,
// the #section-trinity block, and the .trinity rules in landing.css.

import * as THREE from 'three';

(function () {
  const canvas = document.getElementById('trinityCanvas');
  const section = document.getElementById('section-trinity');
  if (!canvas || !section) return;

  try { if (!document.createElement('canvas').getContext('webgl')) return; }
  catch (e) { return; }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLORS = [0xff7a2d, 0x33d6ff, 0xff3da5];   // orange · cyan · magenta
  const SCALE = 82;                                 // normalised units → world units
  const TRAIL = 240;

  // figure-8 initial conditions (G = 1, equal masses = 1) — the stable solution.
  const P1 = 0.3471128135672417, P2 = 0.532726851767674;
  const IC = [
    { p: [-1, 0, 0], v: [P1, P2, 0] },
    { p: [ 1, 0, 0], v: [P1, P2, 0] },
    { p: [ 0, 0, 0], v: [-2 * P1, -2 * P2, 0] },
  ];
  const G = 1, SOFT = 0.02, DT = 0.0022, SUBSTEPS = 4;

  let renderer, scene, camera, root, raf = 0, running = false, inited = false;
  const bodies = [];

  function init() {
    inited = true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 4000);
    camera.position.set(0, 40, 300);
    camera.lookAt(0, 0, 0);

    root = new THREE.Group();
    root.rotation.x = -0.35;          // tilt the plane of the dance toward us
    scene.add(root);
    scene.add(makeStars());

    const glow = glowSprite();
    for (let i = 0; i < 3; i++) {
      const color = COLORS[i];
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(5.4, 24, 24),
        new THREE.MeshBasicMaterial({ color })
      );
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.set(46, 46, 1);
      core.add(halo);
      root.add(core);

      // trail
      const tgeo = new THREE.BufferGeometry();
      tgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      tgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      tgeo.setDrawRange(0, 0);
      const line = new THREE.Line(tgeo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      root.add(line);

      bodies.push({
        mesh: core, color: new THREE.Color(color),
        pos: new THREE.Vector3(...IC[i].p),
        vel: new THREE.Vector3(...IC[i].v),
        acc: new THREE.Vector3(),
        trail: [], tgeo,
      });
    }
    place();
    bindDrag();
    resize();
    window.addEventListener('resize', resize);
    start();
  }

  // ── physics: velocity-Verlet on the figure-8 ────────────────────────────────
  function accelerations() {
    for (const b of bodies) b.acc.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = bodies[i], c = bodies[j];
        const dx = c.pos.x - a.pos.x, dy = c.pos.y - a.pos.y, dz = c.pos.z - a.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz + SOFT * SOFT;
        const inv = G / (d2 * Math.sqrt(d2));
        a.acc.x += dx * inv; a.acc.y += dy * inv; a.acc.z += dz * inv;
        c.acc.x -= dx * inv; c.acc.y -= dy * inv; c.acc.z -= dz * inv;
      }
    }
  }
  function step(dt) {
    accelerations();
    for (const b of bodies) { b.vel.addScaledVector(b.acc, dt * 0.5); b.pos.addScaledVector(b.vel, dt); }
    accelerations();
    for (const b of bodies) b.vel.addScaledVector(b.acc, dt * 0.5);
  }
  function diverged() {
    for (const b of bodies) if (b.pos.lengthSq() > 9) return true;   // figure-8 stays within ~1.2
    return false;
  }
  function reseed() {
    for (let i = 0; i < 3; i++) {
      bodies[i].pos.set(...IC[i].p); bodies[i].vel.set(...IC[i].v); bodies[i].trail.length = 0;
    }
  }

  function place() {
    for (const b of bodies) {
      b.mesh.position.set(b.pos.x * SCALE, b.pos.y * SCALE, b.pos.z * SCALE);
      b.trail.push(b.mesh.position.clone());
      if (b.trail.length > TRAIL) b.trail.shift();
      const n = b.trail.length;
      const pos = b.tgeo.getAttribute('position'), col = b.tgeo.getAttribute('color');
      for (let k = 0; k < n; k++) {
        const p = b.trail[k]; pos.setXYZ(k, p.x, p.y, p.z);
        const f = k / n;                          // fade tail→head (additive: dim ≈ transparent)
        col.setXYZ(k, b.color.r * f, b.color.g * f, b.color.b * f);
      }
      pos.needsUpdate = true; col.needsUpdate = true; b.tgeo.setDrawRange(0, n);
    }
  }

  // ── camera drag + idle spin ─────────────────────────────────────────────────
  let dragging = false, lastX = 0, lastY = 0, velY = 0;
  function bindDrag() {
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      velY = dx * 0.005;
      root.rotation.y += velY;
      root.rotation.x = Math.max(-1.2, Math.min(0.6, root.rotation.x + dy * 0.004));
    });
    const up = (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { dragging = false; });
  }

  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (!reduced) {
      for (let s = 0; s < SUBSTEPS; s++) step(DT);
      if (diverged()) reseed();
    }
    place();
    if (!dragging) { root.rotation.y += (reduced ? 0 : 0.0011) + velY; velY *= 0.95; }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || Math.round(window.innerHeight * 0.86);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  function makeStars() {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 900 + Math.random() * 1500;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fc0ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.6 }));
  }
  function glowSprite() {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // boot when scrolled into view; pause when it leaves
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      const vis = entries[0].isIntersecting;
      if (vis) { if (!inited) init(); else start(); }
      else if (inited) stop();
    }, { threshold: 0.05 }).observe(section);
  } else {
    init();
  }
})();

// trinity.js — "The Trinity": a PLAYABLE three-body sandbox for the landing page
// (sits under Rex's World). It opens in the famous figure-8 — the one provably
// STABLE three-body orbit, so three glowing worlds chase each other with no chaos —
// then it's yours: grab a world and fling it, scroll on one to grow its mass, and
// hit reset to snap back to the perfect dance. Self-contained three.js, lazy (spins
// up on scroll), pauses off-screen, honours reduced-motion, degrades without WebGL.
// Remove by deleting this file, its <script> tag, the #section-trinity block, and the
// .trinity rules in landing.css.

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
  const BASE_R = 5.4;

  // figure-8 initial conditions (G = 1, equal masses = 1) — the stable solution.
  const P1 = 0.3471128135672417, P2 = 0.532726851767674;
  const IC = [
    { p: [-1, 0, 0], v: [P1, P2, 0] },
    { p: [ 1, 0, 0], v: [P1, P2, 0] },
    { p: [ 0, 0, 0], v: [-2 * P1, -2 * P2, 0] },
  ];
  const G = 1, SOFT = 0.02, DT = 0.0022, SUBSTEPS = 4;

  let renderer, scene, camera, root, raf = 0, running = false, inited = false;
  let raycaster, ndc, dragPlane, hitPoint, planeNormal;
  const bodies = [], bodyMeshes = [];

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

    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();
    dragPlane = new THREE.Plane();
    hitPoint = new THREE.Vector3();
    planeNormal = new THREE.Vector3();

    const glow = glowSprite();
    for (let i = 0; i < 3; i++) {
      const color = COLORS[i];
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(BASE_R, 24, 24),
        new THREE.MeshBasicMaterial({ color })
      );
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.set(46, 46, 1);
      core.add(halo);
      root.add(core);
      bodyMeshes.push(core);

      const tgeo = new THREE.BufferGeometry();
      tgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      tgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      tgeo.setDrawRange(0, 0);
      const line = new THREE.Line(tgeo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      root.add(line);

      const b = {
        mesh: core, color: new THREE.Color(color), mass: 1, pinned: false,
        pos: new THREE.Vector3(...IC[i].p),
        vel: new THREE.Vector3(...IC[i].v),
        acc: new THREE.Vector3(), trail: [], tgeo,
      };
      core.userData.body = b;
      bodies.push(b);
    }
    place();
    bindControls();
    const resetBtn = document.getElementById('trinityReset');
    if (resetBtn) resetBtn.addEventListener('click', reseed);
    resize();
    window.addEventListener('resize', resize);
    start();
  }

  // ── physics: velocity-Verlet, mass-weighted gravity ─────────────────────────
  function accelerations() {
    for (const b of bodies) b.acc.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = bodies[i], c = bodies[j];
        const dx = c.pos.x - a.pos.x, dy = c.pos.y - a.pos.y, dz = c.pos.z - a.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz + SOFT * SOFT;
        const base = G / (d2 * Math.sqrt(d2));
        a.acc.x += dx * base * c.mass; a.acc.y += dy * base * c.mass; a.acc.z += dz * base * c.mass;
        c.acc.x -= dx * base * a.mass; c.acc.y -= dy * base * a.mass; c.acc.z -= dz * base * a.mass;
      }
    }
  }
  function step(dt) {
    accelerations();
    for (const b of bodies) { if (b.pinned) continue; b.vel.addScaledVector(b.acc, dt * 0.5); b.pos.addScaledVector(b.vel, dt); }
    accelerations();
    for (const b of bodies) { if (b.pinned) continue; b.vel.addScaledVector(b.acc, dt * 0.5); }
  }
  function blewUp() {
    for (const b of bodies) {
      if (!isFinite(b.pos.x) || !isFinite(b.pos.y) || !isFinite(b.pos.z)) return true;
      if (b.pos.lengthSq() > 64) return true;          // wandered far past the view → clean up
    }
    return false;
  }
  function reseed() {
    for (let i = 0; i < 3; i++) {
      const b = bodies[i];
      b.pos.set(...IC[i].p); b.vel.set(...IC[i].v); b.acc.set(0, 0, 0);
      b.mass = 1; b.pinned = false; b.trail.length = 0; b.mesh.scale.setScalar(1);
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
        const f = k / n;
        col.setXYZ(k, b.color.r * f, b.color.g * f, b.color.b * f);
      }
      pos.needsUpdate = true; col.needsUpdate = true; b.tgeo.setDrawRange(0, n);
    }
  }

  // ── controls: grab+fling a world, scroll to change its mass, drag space to look ─
  let mode = null, drag = null, lastX = 0, lastY = 0, velY = 0;
  const FLING = 7, VMAX = 4;

  function setNDC(e) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  function pickBody(e) {
    setNDC(e); raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(bodyMeshes, false)[0];
    return hit ? hit.object.userData.body : null;
  }
  function pointerToNorm(e) {
    setNDC(e); raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return null;
    const local = root.worldToLocal(hitPoint.clone());
    return local.multiplyScalar(1 / SCALE);
  }

  function bindControls() {
    canvas.addEventListener('pointerdown', (e) => {
      const b = pickBody(e);
      if (b) {
        mode = 'body'; drag = b; b.pinned = true; b.vel.set(0, 0, 0);
        camera.getWorldDirection(planeNormal);
        const wp = new THREE.Vector3(); b.mesh.getWorldPosition(wp);
        dragPlane.setFromNormalAndCoplanarPoint(planeNormal, wp);
      } else {
        mode = 'cam'; lastX = e.clientX; lastY = e.clientY;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (mode === 'body' && drag) {
        const np = pointerToNorm(e); if (!np) return;
        drag.vel.copy(np).sub(drag.pos).multiplyScalar(FLING);
        if (drag.vel.length() > VMAX) drag.vel.setLength(VMAX);
        drag.pos.copy(np);
      } else if (mode === 'cam') {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        velY = dx * 0.005;
        root.rotation.y += velY;
        root.rotation.x = Math.max(-1.2, Math.min(0.6, root.rotation.x + dy * 0.004));
      }
    });
    const up = (e) => {
      if (mode === 'body' && drag) drag.pinned = false;   // release → keeps its fling velocity
      mode = null; drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      const b = pickBody(e);
      if (!b) return;                                     // not over a world → let the page scroll
      e.preventDefault();
      b.mass = Math.max(0.3, Math.min(12, b.mass * (e.deltaY < 0 ? 1.12 : 0.89)));
      b.mesh.scale.setScalar(Math.cbrt(b.mass));
    }, { passive: false });
  }

  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (!reduced) {
      for (let s = 0; s < SUBSTEPS; s++) step(DT);
      if (blewUp()) reseed();
    }
    place();
    if (mode !== 'cam') { root.rotation.y += (reduced ? 0 : 0.0011) + velY; velY *= 0.95; }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = section.clientWidth || window.innerWidth;
    const h = section.clientHeight || Math.round(window.innerHeight * 0.86);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

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
